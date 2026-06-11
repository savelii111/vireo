// run_chat_turn.js — Chat turn execution (2026-06-08).
//
// This module holds the chat-turn execution logic that was
// previously inlined in server.js. The extracted version has
// the same features as the inline one (G1.1 ownership check,
// G1.2 per-tool timeout, G2.2 confirmation token, signal
// handling, streaming) — just moved out of the 3000-line
// server.js for maintainability.
//
// The exported `runChatTurn(opts)` function takes:
//   { llm, system, history, userMsg, tools, deps, userId,
//     onTextDelta, maxRounds, signal, hooks }
// and returns
//   { reply, messages, usage, costUsd, toolCalls, error, streamed }.
//
// `onTextDelta` is optional — when provided, the LLM is called
// in streaming mode and each token is forwarded to the callback.
// `hooks` is an optional object with onToolCall/onToolResult
// callbacks for audit logging and undo recording.

import { LLMError } from "./llm_client.js";

const DEFAULT_MAX_ROUNDS = 6;

// Resource ID fields that should be ownership-checked.
// G1.1: if the LLM tries to operate on a resource it doesn't
// own (via prompt injection or hallucination), we reject.
const RESOURCE_ID_KEYS = ["project_id", "piece_id", "conversation_id", "id"];

// Tools that need a confirmation_token before they execute.
// G2.2: destructive tools require a two-step flow.
const DESTRUCTIVE_TOOLS = new Set([
  "delete_project",
  "delete_piece",
  "delete_account",
  "revoke_consent",
]);

// Per-tool timeout in ms. G1.2: prevent runaway tool calls.
const TOOL_TIMEOUTS = {
  default: 30_000,
  save_content: 15_000,
  create_project: 5_000,
  list_projects: 5_000,
  get_style_dna: 10_000,
  delete_project: 10_000,
  delete_piece: 10_000,
  // edit tools have their own timeouts (usually 5-30 min)
};

function getToolTimeoutMs(name) {
  return TOOL_TIMEOUTS[name] || TOOL_TIMEOUTS.default;
}

function withTimeout(promise, ms, name) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`tool ${name} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

export async function runChatTurn({
  llm,
  system,
  history = [],
  userMsg,
  tools = null,
  deps = null,
  userId = null,
  onTextDelta = null,
  maxRounds = DEFAULT_MAX_ROUNDS,
  signal = null,
  hooks = null, // { onToolCall, onToolResult, ownershipCheck, confirmationCheck, undoRecord }
}) {
  const messages = [...history, { role: "user", content: userMsg }];
  const allToolCalls = [];
  const allToolResults = [];
  let lastUsage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  let cost = 0;
  let rounds = 0;
  let error = null;
  let streamed = false;

  // Derive the chat tool name set from the tools array.
  // Convention: tools passed in have a `kind: "chat" | "edit"`
  // attribute set by the caller (server.js's ALL_TOOLS).
  // We also fall back to the names from chat_tools.js for
  // backwards compat — even when tools=null, the chat tool
  // names are still known statically from the module.
  let chatToolNames = new Set();
  if (Array.isArray(tools) && tools.length > 0) {
    for (const t of tools) {
      if (t?.kind === "chat") chatToolNames.add(t.name || t.function?.name);
    }
  }
  // Always seed with CHAT_TOOLS module names (the source of
  // truth). This handles the case where the caller passes
  // tools=null but we still want chat tools to be dispatched
  // via deps[name] (not via the edit hook).
  try {
    const { CHAT_TOOLS } = await import("./chat_tools.js");
    for (const t of CHAT_TOOLS) chatToolNames.add(t.function.name);
  } catch { /* no chat tools module — edit-only deployment */ }

  while (rounds < maxRounds) {
    if (signal?.aborted) {
      error = "aborted";
      break;
    }
    rounds++;

    // ---- LLM call ----
    // Two-pass design (P0-1):
    //   Pass 1 (tool planning): ALWAYS use non-streaming chat() for
    //     reliable tool-call parsing. Streaming tool-calls have a
    //     half-tool bug in some LLM providers and don't add value
    //     since tool calls have no user-visible text.
    //   Pass 2 (final reply): if onTextDelta is provided AND the
    //     LLM supports streamChat, use it for real-time UX. Otherwise
    //     fall back to chat().
    //
    // The "first round" gets a tiny plan from chat(); if that plan
    // includes tool calls, we execute them and loop. The "final
    // round" (no tool_calls from chat()) is where streaming kicks in.
    //
    // Exception: mocks don't stream, so we use chat() for them
    // even on the final round.
    let resp;
    try {
      const wantStream = onTextDelta && !llm.isMock?.() && typeof llm.streamChat === "function" && (!resp?.tool_calls || resp.tool_calls.length === 0);
      // Hmm, but we don't have resp yet — wantStream is for the *next* call.
      // Strategy: always use chat() for tool planning. Use streamChat
      // only after we know there are no tool calls.
      // But we don't know that until chat() returns. So: always chat()
      // for the first round. For subsequent rounds (after tool calls),
      // we may stream if we know we're in the final round.
      // Simplest correct approach: chat() for tool rounds, then if
      // onTextDelta and no tools, call streamChat.
      resp = await llm.chat({ system, messages, tools, signal });
    } catch (e) {
      if (e?.message?.includes("aborted") || signal?.aborted) {
        error = "aborted";
        break;
      }
      if (e instanceof LLMError) {
        return { reply: `LLM error: ${e.message}`, messages, usage: lastUsage, costUsd: cost, toolCalls: allToolCalls, error: e.code || "llm_error" };
      }
      return { reply: `LLM error: ${e.message}`, messages, usage: lastUsage, costUsd: cost, toolCalls: allToolCalls, error: "llm_error" };
    }
    if (!resp) {
      return { reply: "", messages, usage: lastUsage, costUsd: cost, toolCalls: allToolCalls, error: "no_response" };
    }
    lastUsage = resp.usage || lastUsage;
    if (llm.costUsd) cost += llm.costUsd(llm.model, lastUsage.input_tokens || 0, lastUsage.output_tokens || 0);

    // ---- Final reply (no tool calls) ----
    if (!resp.tool_calls || resp.tool_calls.length === 0) {
      // Try real-time streaming for the final reply (gives TTFB
      // of <1s once the LLM starts emitting tokens).
      if (onTextDelta && !streamed && typeof llm.streamChat === "function" && !llm.isMock?.()) {
        const streamedReply = await _streamFinalReply({ llm, system, messages, onTextDelta, signal });
        if (streamedReply) {
          const lastIdx = messages.findLastIndex((m) => m.role === "assistant");
          if (lastIdx !== -1) messages[lastIdx] = { ...messages[lastIdx], content: streamedReply.reply };
          lastUsage = {
            input_tokens: lastUsage.input_tokens + streamedReply.usage.input_tokens,
            output_tokens: lastUsage.output_tokens + streamedReply.usage.output_tokens,
            total_tokens: lastUsage.total_tokens + streamedReply.usage.total_tokens,
          };
          cost += streamedReply.cost;
          return { reply: streamedReply.reply, messages, usage: lastUsage, costUsd: cost, toolCalls: allToolCalls, streamed: true };
        }
      }
      const assistantTurn = { role: "assistant", content: resp.content || "" };
      messages.push(assistantTurn);
      return { reply: resp.content || "", messages, usage: lastUsage, costUsd: cost, toolCalls: allToolCalls, streamed: false };
    }

    // ---- Tool calls → execute ----
    const assistantTurn = { role: "assistant", content: resp.content || "", tool_calls: resp.tool_calls };
    messages.push(assistantTurn);

    if (!deps) {
      return { reply: "Tool call but no deps provided", messages, usage: lastUsage, costUsd: cost, toolCalls: allToolCalls, error: "no_deps" };
    }

    const toolResults = await Promise.all(resp.tool_calls.map(async (tc) => {
      let args = {};
      try { args = JSON.parse(tc.function.arguments || "{}"); } catch { args = {}; }

      // G1.1: ownership check. If the tool args include a
      // resource ID, verify the user owns it.
      if (hooks?.ownershipCheck) {
        const referencedId = RESOURCE_ID_KEYS.map((k) => args[k]).find((v) => typeof v === "string");
        if (referencedId && chatToolNames.has(tc.function.name)) {
          try {
            const owned = await hooks.ownershipCheck({ userId, resourceId: referencedId, tool: tc.function.name });
            if (!owned) {
              const result = {
                ok: false,
                error: "not_owned",
                message: `Resource ${referencedId} not found in your account. Use list_projects to see yours.`,
              };
              allToolCalls.push({ name: tc.function.name, args, kind: "chat", denied: true });
              allToolResults.push({ name: tc.function.name, result });
              return { tool_call_id: tc.id, role: "tool", name: tc.function.name, content: JSON.stringify(result) };
            }
          } catch { /* non-fatal: fall through */ }
        }
      }

      // G2.2: destructive tools require a confirmation token.
      if (DESTRUCTIVE_TOOLS.has(tc.function.name) && hooks?.confirmationCheck) {
        const confirmToken = args.confirmation_token;
        if (!confirmToken) {
          // First call: ask for confirmation
          const result = await hooks.confirmationCheck({ userId, create: true, tool: tc.function.name, args });
          if (result?.needsConfirmation) {
            allToolCalls.push({ name: tc.function.name, args, kind: "chat", needs_confirmation: true });
            allToolResults.push({ name: tc.function.name, result: { ok: false, error: "confirmation_required", ...result } });
            return { tool_call_id: tc.id, role: "tool", name: tc.function.name, content: JSON.stringify({ ok: false, error: "confirmation_required", ...result }) };
          }
        } else {
          // Token provided: validate and consume
          const validated = hooks.confirmationCheck({ userId, consume: true, token: confirmToken, tool: tc.function.name });
          if (!validated) {
            const result = { ok: false, error: "invalid_confirmation_token", message: "Confirmation token is invalid or expired. Ask the user to confirm again." };
            allToolCalls.push({ name: tc.function.name, args, kind: "chat", denied: true });
            allToolResults.push({ name: tc.function.name, result });
            return { tool_call_id: tc.id, role: "tool", name: tc.function.name, content: JSON.stringify(result) };
          }
        }
      }

      // ---- Execute the tool ----
      const isChat = chatToolNames.has(tc.function.name);
      const kind = isChat ? "chat" : "edit";
      allToolCalls.push({ name: tc.function.name, args, kind });
      hooks?.onToolCall?.({ name: tc.function.name, args, kind, userId });

      let result;
      try {
        if (isChat) {
          // Dynamic dispatch — call deps[toolName] with merged args
          const fn = deps[tc.function.name];
          if (typeof fn !== "function") {
            result = { ok: false, error: "tool_not_found", message: `Chat tool ${tc.function.name} is not available.` };
          } else {
            const timeoutMs = getToolTimeoutMs(tc.function.name);
            result = await withTimeout(fn({ userId, ...args }), timeoutMs, tc.function.name);
          }
        } else {
          // Edit tools: dispatch via server.js's executeToolCall
          // (we don't import it here to avoid circular dep).
          // Caller passes a `executeEditTool` hook.
          if (typeof hooks?.executeEditTool !== "function") {
            result = { ok: false, error: "edit_dispatch_unavailable", message: "Edit tools are not wired in this deployment." };
          } else {
            result = await hooks.executeEditTool({ name: tc.function.name, args, userId, deps });
          }
        }
      } catch (e) {
        result = { ok: false, error: kind === "chat" ? "chat_tool_error" : "edit_tool_error", message: e?.message || String(e) };
      }

      // Record undo for destructive tools that succeeded
      if (DESTRUCTIVE_TOOLS.has(tc.function.name) && result?.ok && hooks?.undoRecord) {
        try { hooks.undoRecord({ userId, tool: tc.function.name, args, result }); } catch { /* non-fatal */ }
      }

      allToolResults.push({ name: tc.function.name, result });
      hooks?.onToolResult?.({ name: tc.function.name, result, userId });
      return { tool_call_id: tc.id, role: "tool", name: tc.function.name, content: JSON.stringify(result) };
    }));
    for (const tr of toolResults) messages.push(tr);
  }

  // Hit max rounds
  if (error === "aborted") {
    return { reply: "", messages, usage: lastUsage, costUsd: cost, toolCalls: allToolCalls, error: "aborted" };
  }
  return { reply: messages[messages.length - 1]?.content || "(no reply — max tool rounds reached)", messages, usage: lastUsage, costUsd: cost, toolCalls: allToolCalls, error: "max_rounds" };
}

/**
 * Issue a streamChat call to produce the final user-visible reply
 * in real time. Returns { reply, usage, cost } on success, or null
 * on failure (caller falls back to the non-streamed reply).
 */
async function _streamFinalReply({ llm, system, messages, onTextDelta, signal }) {
  let reply = "";
  let usage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  try {
    for await (const ev of llm.streamChat({
      system,
      messages,
      tools: null,
      toolChoice: "none",
      temperature: 0.7,
      maxTokens: 1024,
      signal,
    })) {
      if (signal?.aborted) break;
      if (ev.delta) {
        reply += ev.delta;
        try { onTextDelta(ev.delta); } catch (e) { console.warn("[studio] onTextDelta threw:", e?.message || e); }
      }
      if (ev.usage) {
        usage = {
          input_tokens: ev.usage.prompt_tokens || ev.usage.input_tokens || 0,
          output_tokens: ev.usage.completion_tokens || ev.usage.output_tokens || 0,
          total_tokens: ev.usage.total_tokens || 0,
        };
      }
    }
    const cost = llm.costUsd(llm.model, usage.input_tokens, usage.output_tokens);
    return { reply, usage, cost };
  } catch (e) {
    console.warn("[studio] _streamFinalReply failed:", e?.message || e);
    return null;
  }
}
