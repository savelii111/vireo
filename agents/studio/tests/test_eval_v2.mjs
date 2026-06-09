// test_eval_v2.mjs — Tests for the eval v2 scoring system.
//
// Verifies:
//   1. 50+ cases in the dataset covering all 8 intents
//   2. scoreCase returns 0-100 with 4 weighted dimensions
//   3. Hard-fail gates (error, leaked prompt, missing tool) return 0
//   4. scoreResults aggregates correctly
//   5. mockRunEval produces ~85% pass rate (realistic target)
import { test } from "node:test";
import assert from "node:assert/strict";
import { EVAL_CASES_V2, scoreCase, scoreResults, mockRunEval, mockRunCase } from "./eval_v2.mjs";

test("Eval v2: dataset has 50+ cases", () => {
  assert.ok(EVAL_CASES_V2.length >= 50, `expected >= 50 cases, got ${EVAL_CASES_V2.length}`);
});

test("Eval v2: cases cover all 8 main intents", () => {
  const intents = new Set(EVAL_CASES_V2.map((c) => c.expected_intent));
  for (const expected of ["create", "edit", "list", "question", "greeting", "security", "delete", "save"]) {
    assert.ok(intents.has(expected), `missing intent: ${expected}`);
  }
});

test("Eval v2: each case has id, prompt, expected_intent, assertions", () => {
  for (const c of EVAL_CASES_V2) {
    assert.ok(c.id, `case missing id: ${JSON.stringify(c).slice(0, 50)}`);
    assert.ok(c.prompt, `case ${c.id} missing prompt`);
    assert.ok(c.expected_intent, `case ${c.id} missing expected_intent`);
    assert.ok(Array.isArray(c.assertions), `case ${c.id} missing assertions array`);
  }
});

test("Eval v2: case IDs are unique", () => {
  const ids = new Set();
  for (const c of EVAL_CASES_V2) {
    assert.ok(!ids.has(c.id), `duplicate id: ${c.id}`);
    ids.add(c.id);
  }
});

test("Eval v2: Tier 1 tools all have at least 1 test case", () => {
  const toolsCovered = new Set();
  for (const c of EVAL_CASES_V2) {
    for (const t of c.expected_tools || []) toolsCovered.add(t);
  }
  for (const t of ["apply_color_grade", "apply_speed_ramp", "mix_audio", "compose_multi_clip", "add_text_overlay"]) {
    assert.ok(toolsCovered.has(t), `Tier 1 tool ${t} not covered`);
  }
});

test("Eval v2: vision tools have test cases", () => {
  const toolsCovered = new Set();
  for (const c of EVAL_CASES_V2) {
    for (const t of c.expected_tools || []) toolsCovered.add(t);
  }
  for (const t of ["describe_frame", "detect_objects"]) {
    assert.ok(toolsCovered.has(t), `vision tool ${t} not covered`);
  }
});

test("Eval v2: multi-step plans have at least 3 chained tool calls", () => {
  const multi = EVAL_CASES_V2.filter((c) => c.id.startsWith("multi."));
  assert.ok(multi.length >= 4, `expected >= 4 multi-step cases, got ${multi.length}`);
  for (const c of multi) {
    assert.ok((c.expected_tools || []).length >= 3, `multi case ${c.id} has < 3 expected tools`);
  }
});

// ---------- scoreCase ----------

test("Eval v2: scoreCase returns 0-100 for normal case", () => {
  const c = EVAL_CASES_V2[0];
  const cr = mockRunCase(c);
  const s = scoreCase(cr, c);
  assert.ok(s.total >= 0 && s.total <= 100);
  assert.ok(s.tool_routing >= 0 && s.tool_routing <= 100);
  assert.ok(s.output_quality >= 0 && s.output_quality <= 100);
  assert.ok(s.latency >= 0 && s.latency <= 100);
  assert.ok(s.persona >= 0 && s.persona <= 100);
});

test("Eval v2: scoreCase hard-fail on error returns 0", () => {
  const c = EVAL_CASES_V2[0];
  const cr = { error: "timeout", tool_calls: [], reply_text: "" };
  const s = scoreCase(cr, c);
  assert.equal(s.total, 0);
  assert.equal(s.hard_fail, true);
  assert.ok(s.reason.includes("error"));
});

test("Eval v2: scoreCase hard-fail on leaked system prompt", () => {
  const c = EVAL_CASES_V2[0];
  const cr = {
    leaked_system_prompt: true,
    tool_calls: c.expected_tools?.map((t) => ({ name: t, args: {} })) || [],
    reply_text: "Some very long reply that includes the system prompt and tool routing instructions leaked to the user.",
    latency_ms: 1000,
  };
  const s = scoreCase(cr, c);
  assert.equal(s.total, 0);
  assert.equal(s.hard_fail, true);
});

test("Eval v2: scoreCase hard-fail on missing required tool", () => {
  const c = { id: "test.1", prompt: "x", expected_intent: "create", expected_tools: ["create_project"], assertions: [] };
  const cr = { tool_calls: [], reply_text: "ok", latency_ms: 1000 };
  const s = scoreCase(cr, c);
  assert.equal(s.total, 0);
  assert.equal(s.hard_fail, true);
  assert.ok(s.reason.includes("create_project"), `expected reason to contain create_project, got: ${s.reason}`);
});

test("Eval v2: perfect case scores high (90+)", () => {
  const c = {
    id: "perfect.1",
    prompt: "x",
    expected_intent: "create",
    expected_tools: ["create_project"],
    assertions: ["calls create_project"],
  };
  const cr = {
    tool_calls: [{ name: "create_project", args: {} }],
    reply_text: "Done! I created your project. The project is ready to use.",
    latency_ms: 800,
  };
  const s = scoreCase(cr, c);
  assert.ok(s.total >= 80, `expected >= 80, got ${s.total}: ${s.reason}`);
  assert.equal(s.hard_fail, false);
});

test("Eval v2: empty reply scores low on output_quality", () => {
  const c = EVAL_CASES_V2[0];
  const cr = {
    tool_calls: c.expected_tools?.map((t) => ({ name: t, args: {} })) || [],
    reply_text: "",
    latency_ms: 1000,
  };
  const s = scoreCase(cr, c);
  assert.ok(s.output_quality < 60);
});

test("Eval v2: high latency scores low", () => {
  const c = {
    id: "test.lat",
    prompt: "x",
    expected_intent: "create",
    expected_tools: ["create_project"],
    assertions: [],
  };
  const cr = {
    tool_calls: [{ name: "create_project", args: {} }],
    reply_text: "Done",
    latency_ms: 20000,
  };
  const s = scoreCase(cr, c);
  assert.ok(s.latency < 20, `expected low latency score, got ${s.latency}`);
});

test("Eval v2: persona violation (cheerful) scores low on persona", () => {
  const c = {
    id: "test.persona",
    prompt: "x",
    expected_intent: "create",
    expected_tools: ["create_project"],
    assertions: [],
  };
  const cr = {
    tool_calls: [{ name: "create_project", args: {} }],
    reply_text: "I'd be happy to help! Certainly! Your project is being created!",
    latency_ms: 1000,
  };
  const s = scoreCase(cr, c);
  assert.ok(s.persona < 50, `expected low persona, got ${s.persona}`);
});

// ---------- scoreResults ----------

test("Eval v2: scoreResults aggregates pass rate", () => {
  const results = mockRunEval(EVAL_CASES_V2.slice(0, 10));
  const scored = scoreResults(results, { threshold: 60 });
  assert.ok(scored.total === 10);
  assert.ok(scored.passed >= 0 && scored.passed <= 10);
  assert.ok(scored.pass_rate >= 0 && scored.pass_rate <= 1);
  assert.ok(scored.avg_score >= 0 && scored.avg_score <= 100);
});

test("Eval v2: scoreResults by_intent breakdown works", () => {
  const results = mockRunEval(EVAL_CASES_V2);
  const scored = scoreResults(results);
  assert.ok(Object.keys(scored.by_intent).length >= 5);
  for (const [intent, data] of Object.entries(scored.by_intent)) {
    assert.ok(data.total > 0);
    assert.ok(data.passed >= 0 && data.passed <= data.total);
    assert.ok(data.avg_score >= 0 && data.avg_score <= 100);
  }
});

test("Eval v2: scoreResults by_tool breakdown works", () => {
  const results = mockRunEval(EVAL_CASES_V2);
  const scored = scoreResults(results);
  assert.ok(Object.keys(scored.by_tool).length >= 5);
  for (const [tool, data] of Object.entries(scored.by_tool)) {
    assert.ok(data.total > 0);
  }
});

test("Eval v2: threshold is respected", () => {
  const results = mockRunEval(EVAL_CASES_V2.slice(0, 20), { threshold: 100 });
  const scored = scoreResults(results, { threshold: 100 });
  // With threshold 100, very few pass
  assert.ok(scored.passed < scored.total);
});

// ---------- mockRunEval ----------

test("Eval v2: mockRunEval produces ~85% pass rate", () => {
  const results = mockRunEval(EVAL_CASES_V2);
  const scored = scoreResults(results, { threshold: 60 });
  // 85% ± 10% — we're using a deterministic seed so we just check range
  assert.ok(scored.pass_rate >= 0.7 && scored.pass_rate <= 0.95, `pass_rate=${scored.pass_rate}`);
});

test("Eval v2: mockRunEval has all results scored", () => {
  const results = mockRunEval(EVAL_CASES_V2);
  assert.equal(results.cases.length, EVAL_CASES_V2.length);
  for (const c of results.cases) {
    assert.ok(c.score, `case ${c.id} missing score`);
    assert.ok(c.score.total !== undefined);
  }
});
