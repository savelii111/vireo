// run_chat_turn.js — Unit tests for the extracted chat-turn function.
//
// We test the contract that runChatTurn satisfies, since it's the
// hot path that both /api/chat and /api/chat/stream use. The
// security hooks (G1.1, G2.2, G1.2) are tested in test_delete_flow.js
// (delete tools) and test_chat_tools.js (chat tool dispatch).
import { test } from "node:test";
import assert from "node:assert/strict";
import { runChatTurn } from "../src/run_chat_turn.js";

function makeLLM(behavior) {
  return {
    model: "test",
    isMock: () => behavior.isMock ?? true,
    costUsd: () => 0,
    chat: behavior.chat,
    streamChat: behavior.streamChat,
    getUsage: () => ({}),
  };
}

test("run_chat_turn: simple text reply returns reply and messages", async () => {
  const llm = makeLLM({ chat: async () => ({ content: "Hello, world.", tool_calls: null, usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 } }) });
  const result = await runChatTurn({ llm, system: "be Vireo", userMsg: "hi", history: [] });
  assert.equal(result.reply, "Hello, world.");
  assert.equal(result.error, undefined);
  assert.deepEqual(result.toolCalls, []);
  // messages should be [user, assistant]
  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[0].role, "user");
  assert.equal(result.messages[1].role, "assistant");
});

test("run_chat_turn: tool call is executed via deps[name]", async () => {
  const llm = makeLLM({ chat: async () => ({ content: "", tool_calls: [{ id: "t1", type: "function", function: { name: "create_project", arguments: JSON.stringify({ name: "X" }) } }], usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 } }) });
  let called = false;
  const deps = {
    create_project: async ({ userId, name }) => {
      called = true;
      assert.equal(userId, "u-1");
      assert.equal(name, "X");
      return { ok: true, project: { id: "p-1", name } };
    },
  };
  const result = await runChatTurn({ llm, system: "x", userMsg: "create", deps, userId: "u-1" });
  assert.equal(called, true);
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0].name, "create_project");
  assert.equal(result.toolCalls[0].kind, "chat");
});

test("run_chat_turn: edit tool dispatched via hooks.executeEditTool", async () => {
  const llm = makeLLM({ chat: async () => ({ content: "", tool_calls: [{ id: "t1", type: "function", function: { name: "cut_video", arguments: JSON.stringify({ file_id: "f-1" }) } }], usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 } }) });
  const calls = { editTool: 0, chatTool: 0 };
  const deps = { cut_video: async () => ({ ok: true, plan: "trimmed" }) };  // not used — we want hook dispatch
  const hooks = {
    executeEditTool: async ({ name }) => {
      calls.editTool++;
      assert.equal(name, "cut_video");
      return { ok: true, plan: "trimmed" };
    },
    onToolCall: ({ kind }) => { if (kind === "edit") calls.editTool++; },
  };
  const result = await runChatTurn({ llm, system: "x", userMsg: "cut", deps, userId: "u-1", hooks });
  assert.equal(calls.editTool >= 1, true, "edit tool should be dispatched via hook");
  assert.equal(result.toolCalls[0].kind, "edit");
});

test("run_chat_turn: chat tool dispatched via deps[name] (no executeEditTool hook needed)", async () => {
  const llm = makeLLM({ chat: async () => ({ content: "", tool_calls: [{ id: "t1", type: "function", function: { name: "list_projects", arguments: "{}" } }], usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 } }) });
  const deps = { list_projects: async () => ({ ok: true, projects: [], count: 0 }) };
  const result = await runChatTurn({ llm, system: "x", userMsg: "list", deps, userId: "u-1" });
  assert.equal(result.toolCalls[0].name, "list_projects");
  assert.equal(result.toolCalls[0].kind, "chat");
});

test("run_chat_turn: hooks.onToolCall fires for every tool call", async () => {
  const llm = makeLLM({ chat: async () => ({ content: "", tool_calls: [{ id: "t1", type: "function", function: { name: "create_project", arguments: "{}" } }, { id: "t2", type: "function", function: { name: "list_projects", arguments: "{}" } }], usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 } }) });
  const deps = { create_project: async () => ({ ok: true }), list_projects: async () => ({ ok: true }) };
  const calls = [];
  const hooks = { onToolCall: (info) => calls.push(info) };
  await runChatTurn({ llm, system: "x", userMsg: "x", deps, userId: "u-1", hooks });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((c) => c.name).sort(), ["create_project", "list_projects"]);
});

test("run_chat_turn: hooks.ownershipCheck rejects foreign resources", async () => {
  const llm = makeLLM({ chat: async () => ({ content: "", tool_calls: [{ id: "t1", type: "function", function: { name: "save_content", arguments: JSON.stringify({ project_id: "not-mine", text: "x" }) } }], usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 } }) });
  const deps = { save_content: async () => ({ ok: true }) };
  const hooks = { ownershipCheck: async ({ resourceId }) => resourceId === "mine" };
  const result = await runChatTurn({ llm, system: "x", userMsg: "save", deps, userId: "u-1", hooks });
  // Tool was denied, not executed
  const denied = result.toolCalls.find((t) => t.denied);
  assert.ok(denied, "expected denied tool call");
  assert.equal(denied.name, "save_content");
});

test("run_chat_turn: hooks.confirmationCheck creates a token on first call", async () => {
  const llm = makeLLM({ chat: async () => ({ content: "", tool_calls: [{ id: "t1", type: "function", function: { name: "delete_project", arguments: JSON.stringify({ project_id: "p-1" }) } }], usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 } }) });
  const deps = { delete_project: async () => ({ ok: true }) };
  let createdToken = null;
  const hooks = {
    confirmationCheck: async ({ create, tool }) => {
      if (create) {
        createdToken = "tok-abc";
        return { needsConfirmation: true, confirmation_token: createdToken, message: "Are you sure?" };
      }
      return null;
    },
  };
  const result = await runChatTurn({ llm, system: "x", userMsg: "delete", deps, userId: "u-1", hooks });
  assert.equal(createdToken, "tok-abc");
  // tool call was marked needs_confirmation, not actually executed
  const needs = result.toolCalls.find((t) => t.needs_confirmation);
  assert.ok(needs);
  assert.equal(needs.name, "delete_project");
});

test("run_chat_turn: signal abort breaks the loop", async () => {
  let aborted = false;
  const llm = makeLLM({
    chat: async () => {
      await new Promise((r) => setTimeout(r, 500));
      if (aborted) throw new Error("aborted");
      return { content: "should not see", tool_calls: null, usage: {} };
    },
  });
  const ctrl = new AbortController();
  setTimeout(() => { aborted = true; ctrl.abort(); }, 50);
  const result = await runChatTurn({ llm, system: "x", userMsg: "x", signal: ctrl.signal });
  assert.equal(result.error, "aborted");
});

test("run_chat_turn: max_rounds returns max_rounds error", async () => {
  // Always emit a tool call, never a final reply
  const llm = makeLLM({
    chat: async () => ({ content: "", tool_calls: [{ id: "t1", type: "function", function: { name: "list_projects", arguments: "{}" } }], usage: {} }),
  });
  const deps = { list_projects: async () => ({ ok: true, projects: [], count: 0 }) };
  const result = await runChatTurn({ llm, system: "x", userMsg: "x", deps, userId: "u-1", maxRounds: 3 });
  assert.equal(result.error, "max_rounds");
  assert.equal(result.toolCalls.length, 3);  // 3 rounds × 1 tool call
});

test("run_chat_turn: LLM error returns error code", async () => {
  const llm = makeLLM({ chat: async () => { throw new Error("upstream timeout"); } });
  const result = await runChatTurn({ llm, system: "x", userMsg: "x" });
  assert.equal(result.error, "llm_error");
  assert.ok(result.reply.includes("upstream timeout"));
});

test("run_chat_turn: cost is accumulated across rounds", async () => {
  let n = 0;
  const llm = makeLLM({
    chat: async () => {
      n++;
      if (n === 1) return { content: "", tool_calls: [{ id: "t1", type: "function", function: { name: "list_projects", arguments: "{}" } }], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } };
      return { content: "final", tool_calls: null, usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 } };
    },
    costUsd: (model, in_t, out_t) => (in_t + out_t) * 0.000001,
  });
  const deps = { list_projects: async () => ({ ok: true, projects: [], count: 0 }) };
  const result = await runChatTurn({ llm, system: "x", userMsg: "x", deps, userId: "u-1" });
  // cost = (10+5)*0.000001 + (5+3)*0.000001 = 15e-6 + 8e-6 = 23e-6
  assert.ok(result.costUsd > 0);
  assert.equal(result.reply, "final");
});

test("run_chat_turn: streaming via onTextDelta accumulates deltas", async () => {
  // Mock LLM that always uses streamChat (not isMock)
  const llm = {
    model: "test",
    isMock: () => false,  // real LLM enables streaming
    costUsd: () => 0,
    chat: async () => ({ content: "fallback", tool_calls: null, usage: {} }),
    streamChat: async function* () {
      yield { delta: "Hel" };
      yield { delta: "lo!" };
      yield { delta: "", finish_reason: "stop", usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } };
    },
    getUsage: () => ({}),
  };
  const deltas = [];
  const result = await runChatTurn({
    llm,
    system: "x",
    userMsg: "hi",
    onTextDelta: (d) => deltas.push(d),
  });
  assert.deepEqual(deltas, ["Hel", "lo!"]);
  assert.equal(result.streamed, true);
  assert.equal(result.reply, "Hello!");
});
