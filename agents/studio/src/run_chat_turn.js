// run_chat_turn.js — Chat turn execution (2026-06-08).
//
// This module holds the chat-turn execution logic that was
// previously inlined in server.js. Extracting it gives us:
//   1. Easier to read (server.js down from 3000 → ~2700 lines)
//   2. Independently testable
//   3. Clear separation between HTTP routing (server.js) and
//      LLM/tool execution (this file)
//
// The exported `runChatTurn(opts)` function takes:
//   { llm, system, history, userMsg, tools, deps, userId,
//     onTextDelta, maxRounds }
// and returns
//   { reply, messages, usage, costUsd, toolCalls, error, streamed }
//
// `onTextDelta` is optional — when provided, the LLM is called
// in streaming mode and each token is forwarded to the callback.
// The non-streaming code path (used by /api/chat) doesn't pass
// the callback, and the function returns the final reply.

import { LLMError } from "./llm_client.js";

const DEFAULT_MAX_ROUNDS = 6;

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
}) {
  const messages = [
    ...history,
    { role: "user", content: userMsg },
  ];
  const allToolCalls = [];
  const allToolResults = [];
  let lastUsage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  let cost = 0;
  let error = null;
  let streamed = false;

  for (let round = 0; round < maxRounds; round++) {
    let resp;
    try {
      if (onTextDelta) {
        streamed = true;
        resp = await llm.streamChat({ system, messages, tools, onTextDelta });
        if (resp?.usage) lastUsage = resp.usage;
      } else {
        resp = await llm.chat({ system, messages, tools });
        if (resp?.usage) lastUsage = resp.usage;
      }
      if (llm.costUsd) {
        cost += llm.costUsd(llm.model, lastUsage.input_tokens || 0, lastUsage.output_tokens || 0);
      }
    } catch (e) {
      console.error(`[studio] LLM call failed in runChatTurn:`, e);
      const errReply = `LLM error: ${e?.message || "unknown"}`;
      return {
        reply: errReply,
        messages,
        usage: lastUsage,
        costUsd: cost,
        toolCalls: allToolCalls,
        error: e instanceof LLMError ? e.code : "llm_error",
      };
    }

    if (!resp) {
      return {
        reply: "",
        messages,
        usage: lastUsage,
        costUsd: cost,
        toolCalls: allToolCalls,
        error: "no_response",
      };
    }

    // No tool calls — final reply
    if (!resp.tool_calls || resp.tool_calls.length === 0) {
      return {
        reply: resp.content || "",
        messages: [...messages, { role: "assistant", content: resp.content || "" }],
        usage: lastUsage,
        costUsd: cost,
        toolCalls: allToolCalls,
        streamed,
      };
    }

    // Has tool calls — push assistant turn + execute tools + loop
    messages.push({
      role: "assistant",
      content: resp.content || "",
      tool_calls: resp.tool_calls,
    });

    if (!deps) {
      return {
        reply: "Tool call but no deps provided",
        messages,
        usage: lastUsage,
        costUsd: cost,
        toolCalls: allToolCalls,
        error: "no_deps",
      };
    }

    const { toolCalls } = resp;
    const chatToolNames = tools?.filter((t) => t.kind === "chat").map((t) => t.name) || [];

    // Execute tools in parallel
    const toolResults = await Promise.all(toolCalls.map(async (tc) => {
      let args = {};
      try { args = JSON.parse(tc.function.arguments || "{}"); } catch { args = {}; }
      let result;
      // chat_tools vs edit_tools routing
      if (chatToolNames.includes(tc.function.name)) {
        allToolCalls.push({ name: tc.function.name, args, kind: "chat" });
        try {
          result = await deps[tc.function.name]({ userId, ...args });
        } catch (e) {
          result = { ok: false, error: "chat_tool_error", message: e?.message || String(e) };
        }
      } else {
        allToolCalls.push({ name: tc.function.name, args, kind: "edit" });
        try {
          result = await deps[tc.function.name]({ userId, ...args });
        } catch (e) {
          result = { ok: false, error: "edit_tool_error", message: e?.message || String(e) };
        }
      }
      allToolResults.push({ name: tc.function.name, result });
      return { tool_call_id: tc.id, role: "tool", name: tc.function.name, content: JSON.stringify(result) };
    }));
    for (const tr of toolResults) messages.push(tr);
  }

  // Hit max rounds
  return {
    reply: messages[messages.length - 1]?.content || "(no reply — max tool rounds reached)",
    messages,
    usage: lastUsage,
    costUsd: cost,
    toolCalls: allToolCalls,
    error: "max_rounds",
  };
}
