// Vireo Studio — tests for src/tools.js (NL tool-use for video editing).
//
// Covers:
//   - EDIT_TOOLS schema validity
//   - parseToolCalls: function_calls / string-args / empty / shape handling
//   - SYSTEM_PROMPT: mentions every tool + video-editing keywords
//   - executeToolCall: timeout failure path via injected fetchImpl
//   - buildEditToolContext: shape & default values
//   - tool name uniqueness

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EDIT_TOOLS,
  SYSTEM_PROMPT,
  parseToolCalls,
  executeToolCall,
  buildEditToolContext,
} from "../src/tools.js";

// ---------- test_tools_schema_valid ----------

test("test_tools_schema_valid: every tool has name, description, parameters.type=object, parameters.properties", () => {
  assert.ok(Array.isArray(EDIT_TOOLS), "EDIT_TOOLS should be an array");
  assert.ok(EDIT_TOOLS.length >= 8, `expected at least 8 tools, got ${EDIT_TOOLS.length}`);

  for (const t of EDIT_TOOLS) {
    assert.equal(t.type, "function", `tool ${t?.function?.name} should have type=function`);
    assert.ok(t.function, `tool missing .function`);
    assert.equal(typeof t.function.name, "string", `tool missing string name`);
    assert.ok(t.function.name.length > 0, `tool has empty name`);
    assert.equal(typeof t.function.description, "string", `${t.function.name} missing description`);
    assert.ok(t.function.description.length > 10, `${t.function.name} description too short`);

    const p = t.function.parameters;
    assert.ok(p && typeof p === "object", `${t.function.name} missing parameters`);
    assert.equal(p.type, "object", `${t.function.name} parameters.type must be 'object'`);
    assert.ok(p.properties && typeof p.properties === "object", `${t.function.name} missing parameters.properties`);
    assert.ok(Object.keys(p.properties).length > 0, `${t.function.name} has empty properties`);
  }
});

// ---------- test_tools_have_unique_names ----------

test("test_tools_have_unique_names: no duplicate tool names", () => {
  const names = EDIT_TOOLS.map((t) => t.function.name);
  const unique = new Set(names);
  assert.equal(unique.size, names.length, `duplicate tool names: ${names.join(", ")}`);
});

// ---------- test_parse_tool_calls_extracts_function_calls ----------

test("test_parse_tool_calls_extracts_function_calls: parses tool_calls[].function.{name, arguments}", () => {
  const message = {
    role: "assistant",
    content: null,
    tool_calls: [
      {
        id: "call_abc123",
        type: "function",
        function: {
          name: "transcribe_video",
          arguments: { file_id: "file_xyz" },
        },
      },
      {
        id: "call_def456",
        type: "function",
        function: {
          name: "cut_clips",
          arguments: { file_id: "file_xyz", ranges: [[0, 5], [10, 15]] },
        },
      },
    ],
  };
  const calls = parseToolCalls(message);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].name, "transcribe_video");
  assert.deepEqual(calls[0].args, { file_id: "file_xyz" });
  assert.equal(calls[0].id, "call_abc123");
  assert.equal(calls[1].name, "cut_clips");
  assert.deepEqual(calls[1].args, { file_id: "file_xyz", ranges: [[0, 5], [10, 15]] });
  assert.equal(calls[1].id, "call_def456");
});

// ---------- test_parse_tool_calls_handles_string_args ----------

test("test_parse_tool_calls_handles_string_args: arguments may be a JSON string", () => {
  const message = {
    role: "assistant",
    content: null,
    tool_calls: [
      {
        id: "call_1",
        type: "function",
        function: {
          name: "add_zoom",
          arguments: '{"file_id":"f1","words":["amazing"],"intensity":1.5}',
        },
      },
    ],
  };
  const calls = parseToolCalls(message);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "add_zoom");
  assert.deepEqual(calls[0].args, { file_id: "f1", words: ["amazing"], intensity: 1.5 });
});

// ---------- test_parse_tool_calls_empty_when_no_tool_calls ----------

test("test_parse_tool_calls_empty_when_no_tool_calls: returns [] for messages without tool_calls", () => {
  assert.deepEqual(parseToolCalls({ role: "assistant", content: "hi" }), []);
  assert.deepEqual(parseToolCalls({ role: "assistant", tool_calls: [] }), []);
  assert.deepEqual(parseToolCalls(null), []);
  assert.deepEqual(parseToolCalls(undefined), []);
  assert.deepEqual(parseToolCalls({}), []);
});

// ---------- test_system_prompt_mentions_all_tools ----------

test("test_system_prompt_mentions_all_tools: every tool name appears in the system prompt", () => {
  assert.equal(typeof SYSTEM_PROMPT, "string");
  assert.ok(SYSTEM_PROMPT.length > 100, "system prompt too short");
  for (const t of EDIT_TOOLS) {
    assert.ok(
      SYSTEM_PROMPT.includes(t.function.name),
      `system prompt missing tool name: ${t.function.name}`,
    );
  }
});

// ---------- test_system_prompt_mentions_video_editing ----------

test("test_system_prompt_mentions_video_editing: prompt contains Vireo Studio + video editing keywords", () => {
  assert.match(SYSTEM_PROMPT, /Vireo Studio/i, "should identify as Vireo Studio");
  // At least one of the canonical video-editing keywords must be present.
  const keywords = [
    "video",
    "edit",
    "transcribe",
    "cut",
    "caption",
    "tool",
    "Tool",
  ];
  const found = keywords.filter((kw) => new RegExp(kw, "i").test(SYSTEM_PROMPT));
  assert.ok(found.length >= 3, `expected several video-editing keywords, found: ${found.join(", ")}`);

  // Should also tell the LLM to use tools, not just describe.
  assert.match(SYSTEM_PROMPT, /tool/i, "should reference tools");
  assert.match(SYSTEM_PROMPT, /(always|must|use a tool)/i, "should instruct LLM to always use tools");
});

// ---------- test_build_edit_tool_context_has_ids ----------

test("test_build_edit_tool_context_has_ids: returns object with userId/projectId/conversationId", () => {
  const ctx = buildEditToolContext({
    userId: "u-123",
    projectId: "p-456",
    conversationId: "c-789",
  });
  assert.equal(ctx.userId, "u-123");
  assert.equal(ctx.projectId, "p-456");
  assert.equal(ctx.conversationId, "c-789");
  // Should also have a baseUrl, timeoutMs, fetchImpl
  assert.equal(typeof ctx.baseUrl, "string");
  assert.ok(ctx.baseUrl.length > 0, "baseUrl should be non-empty");
  assert.equal(typeof ctx.timeoutMs, "number");
  assert.ok(ctx.timeoutMs > 0, "timeoutMs should be positive");
  assert.equal(typeof ctx.fetchImpl, "function");
});

// ---------- test_execute_tool_call_timeout ----------

test("test_execute_tool_call_timeout: tool with 100ms timeout fails gracefully", async () => {
  // A fetch that never resolves — the AbortController must fire.
  const hangingFetch = (_url, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        reject(err);
      });
    });

  const ctx = buildEditToolContext({
    userId: "u1",
    projectId: "p1",
    conversationId: "c1",
    baseUrl: "http://127.0.0.1:8004", // would refuse connection normally, but we'll never reach it
    timeoutMs: 100,
    fetchImpl: hangingFetch,
  });

  const t0 = Date.now();
  const result = await executeToolCall(
    { name: "transcribe_video", args: { file_id: "file-1" } },
    ctx,
  );
  const elapsed = Date.now() - t0;

  assert.equal(result.ok, false, "hanging tool should not return ok=true");
  assert.ok(result.error, "should include an error message");
  assert.match(result.error, /timeout|abort/i, `expected timeout-like error, got: ${result.error}`);
  // Should fail fast: well under the default 30s.
  assert.ok(elapsed < 2_000, `should fail fast, took ${elapsed}ms`);
  // And it should have actually been near the 100ms mark, not a connection refusal.
  assert.ok(elapsed >= 80, `should honour the 100ms timeout, returned in ${elapsed}ms`);
});
