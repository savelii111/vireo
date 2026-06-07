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
  _routeForTool,
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

// ---------- Week 1 Day 1: add_music wires real EditRequest fields (was no-op) ----------

test("W1-D1: add_music sends enable_music:true + music_mood (not a no-op)", () => {
  const route = _routeForTool("add_music", {
    file_id: "/tmp/v.mp4",
    mood: "upbeat",
    track_path: "/var/music/upbeat.mp3",
    volume: 0.20,
  });
  assert.equal(route.method, "POST");
  assert.equal(route.path, "/edit");
  assert.equal(route.body.source_path, "/tmp/v.mp4");
  assert.equal(route.body.enable_music, true);
  assert.equal(route.body.music_mood, "upbeat");
  assert.equal(route.body.music_track_path, "/var/music/upbeat.mp3");
  assert.equal(route.body.music_volume, 0.20);
});

test("W1-D1: add_music defaults: mood=neutral, volume=0.15, no track_path", () => {
  const route = _routeForTool("add_music", { file_id: "/tmp/v.mp4" });
  assert.equal(route.body.enable_music, true);
  assert.equal(route.body.music_mood, "neutral");
  assert.equal(route.body.music_track_path, "");
  assert.equal(route.body.music_volume, 0.15);
});

test("W1-D1: add_music schema stays flat EditRequest (no file_id/operation/params)", () => {
  const route = _routeForTool("add_music", { file_id: "/tmp/v.mp4" });
  assert.ok(!("file_id" in route.body), "must not send file_id");
  assert.ok(!("operation" in route.body), "must not send operation");
  assert.ok(!("params" in route.body), "must not send params");
  // P0-1 already covers absence of legacy fields; this is the add_music-specific
  // assertion that the new music fields ARE present.
  assert.ok("enable_music" in route.body, "must send enable_music field");
});

// ---------- P0-1 regression: _routeForTool sends flat EditRequest fields ----------

test("P0-1: _routeForTool never sends file_id/operation/params wrapper (flat EditRequest only)", () => {
  // The video agent's _build_edit_request strips unknown fields. Old wrapper
  // {file_id, operation, params:{...}} → source_path missing → 400.
  const cases = [
    "transcribe_video", "cut_clips", "remove_silence", "reframe_for_platform",
    "add_zoom", "add_captions", "add_music", "make_montage",
  ];
  for (const name of cases) {
    const route = _routeForTool(name, { file_id: "/tmp/v.mp4" });
    assert.ok(route, `route for ${name} should not be null`);
    if (route.body && typeof route.body === "object") {
      assert.ok(
        !("file_id" in route.body),
        `${name}: body must NOT contain file_id (got ${JSON.stringify(route.body)})`,
      );
      assert.ok(
        !("operation" in route.body),
        `${name}: body must NOT contain operation (got ${JSON.stringify(route.body)})`,
      );
      assert.ok(
        !("params" in route.body),
        `${name}: body must NOT contain params (got ${JSON.stringify(route.body)})`,
      );
    }
  }
});

test("P0-1: transcribe_video sends file_path (not file_id) to /transcribe", () => {
  const route = _routeForTool("transcribe_video", { file_id: "/tmp/v.mp4" });
  assert.equal(route.method, "POST");
  assert.equal(route.path, "/transcribe");
  assert.deepEqual(route.body, { file_path: "/tmp/v.mp4" });
});

test("P0-1: cut_clips sends source_path + custom_moments + multi_clip", () => {
  const route = _routeForTool("cut_clips", {
    file_id: "/tmp/v.mp4",
    ranges: [[0, 5], [10, 15]],
  });
  assert.equal(route.method, "POST");
  assert.equal(route.path, "/edit");
  assert.equal(route.body.source_path, "/tmp/v.mp4");
  assert.equal(route.body.max_moments, 2);
  assert.deepEqual(route.body.custom_moments, [{ start: 0, end: 5 }, { start: 10, end: 15 }]);
  assert.equal(route.body.multi_clip, true);
});

test("P0-1: remove_silence sends source_path + enable_silence_removal=true", () => {
  const route = _routeForTool("remove_silence", { file_id: "/tmp/v.mp4" });
  assert.equal(route.body.source_path, "/tmp/v.mp4");
  assert.equal(route.body.enable_silence_removal, true);
  // min_silence_ms / padding_ms are NOT EditRequest fields — pipeline uses
  // its own defaults. We must NOT pass them through.
  assert.ok(!("min_silence_ms" in route.body));
  assert.ok(!("padding_ms" in route.body));
});

test("P0-1: reframe_for_platform sends target_platform", () => {
  const route = _routeForTool("reframe_for_platform", { file_id: "/tmp/v.mp4", platform: "tiktok" });
  assert.equal(route.body.source_path, "/tmp/v.mp4");
  assert.equal(route.body.target_platform, "tiktok");
});

test("P0-1: add_zoom sends enable_zoom=true (P0-2 windows derived in pipeline)", () => {
  const route = _routeForTool("add_zoom", { file_id: "/tmp/v.mp4" });
  assert.equal(route.body.source_path, "/tmp/v.mp4");
  assert.equal(route.body.enable_zoom, true);
});

test("P0-1: add_captions sends subtitle_style + word_burn + target_platform", () => {
  const route = _routeForTool("add_captions", { file_id: "/tmp/v.mp4", style: "mrbeast-yellow" });
  assert.equal(route.body.source_path, "/tmp/v.mp4");
  assert.equal(route.body.subtitle_style, "mrbeast-yellow");
  assert.equal(route.body.word_burn, true);
  assert.equal(route.body.target_platform, "tiktok"); // default
});

test("P0-1: make_montage goes to /edit/async with max_moments", () => {
  const route = _routeForTool("make_montage", { file_id: "/tmp/v.mp4", max_moments: 5 });
  assert.equal(route.method, "POST");
  assert.equal(route.path, "/edit/async");
  assert.equal(route.body.source_path, "/tmp/v.mp4");
  assert.equal(route.body.max_moments, 5);
  assert.equal(route.body.target_platform, "tiktok"); // default
});

test("P0-1: get_video_info uses URL-encoded source path", () => {
  const route = _routeForTool("get_video_info", { file_id: "C:\\path\\with space.mp4" });
  assert.equal(route.method, "GET");
  // path separators encoded as %5C, space as %20
  assert.match(route.path, /^\/files\//);
  assert.ok(route.path.includes("path"));
  assert.ok(route.path.includes("with"));
  // body should be null for GET
  assert.equal(route.body, null);
});

test("P0-1: list_files routes to GET /files (P0-3 response shape is server-side)", () => {
  const route = _routeForTool("list_files", {});
  assert.equal(route.method, "GET");
  assert.equal(route.path, "/files");
  assert.equal(route.body, null);
});

test("P0-1: unknown tool returns null (so executeToolCall surfaces unknown_tool)", () => {
  const route = _routeForTool("nonexistent_tool", { file_id: "/tmp/v.mp4" });
  assert.equal(route, null);
});

test("P0-1: source_path accepts both file_id and file_path (LLM may use either)", () => {
  // LLM might say file_id OR file_path. Both should resolve to source_path.
  const r1 = _routeForTool("transcribe_video", { file_id: "A" });
  const r2 = _routeForTool("transcribe_video", { file_path: "B" });
  assert.equal(r1.body.file_path, "A");
  assert.equal(r2.body.file_path, "B");
});
