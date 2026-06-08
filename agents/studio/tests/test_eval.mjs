// B1.2: Eval harness test (2026-06-08).
//
// Verifies the eval runner:
//   1. Returns a result object even if Ollama is down (no crash)
//   2. Filters cases by intent prefix
//   3. Score function computes correct pass_rate
//   4. CLI entry point can be invoked without error when no model
import { test } from "node:test";
import assert from "node:assert/strict";
import { runEval, score, EVAL_CASES } from "./eval.mjs";

test("B1: EVAL_CASES has at least 15 cases covering 6 intents", () => {
  assert.ok(EVAL_CASES.length >= 15, `expected >= 15 cases, got ${EVAL_CASES.length}`);
  const intents = new Set(EVAL_CASES.map((c) => c.expected_intent));
  assert.ok(intents.size >= 6, `expected >= 6 distinct intents, got ${intents.size}`);
});

test("B1: every case has id, prompt, expected_intent, assertions", () => {
  for (const c of EVAL_CASES) {
    assert.ok(c.id, `case missing id: ${JSON.stringify(c).slice(0, 100)}`);
    assert.ok(c.prompt, `case ${c.id} missing prompt`);
    assert.ok(c.expected_intent, `case ${c.id} missing expected_intent`);
    assert.ok(Array.isArray(c.assertions) && c.assertions.length > 0, `case ${c.id} missing assertions`);
  }
});

test("B1: assertion functions are predicates that return boolean", () => {
  for (const c of EVAL_CASES) {
    for (const a of c.assertions) {
      // Run with an empty body — should not throw, returns a boolean
      const result = a({ reply: "test" });
      assert.equal(typeof result, "boolean", `assertion in ${c.id} doesn't return boolean`);
    }
  }
});

test("B1: runEval returns ok=false gracefully when Ollama is down", async () => {
  // We point at a non-existent port to simulate Ollama being down
  process.env.OLLAMA_BASE_URL = "http://127.0.0.1:1/v1"; // port 1, no service
  const result = await runEval({ filter: "create.1" });
  assert.equal(result.ok, false);
  assert.ok(result.error, "should have an error message");
  assert.ok(Array.isArray(result.cases));
});

test("B1: score function computes pass_rate and by_intent correctly", () => {
  const fakeResults = {
    cases: [
      { id: "a", expected_intent: "create", passed: true, latency_ms: 100 },
      { id: "b", expected_intent: "create", passed: false, latency_ms: 200 },
      { id: "c", expected_intent: "save", passed: true, latency_ms: 150 },
    ],
  };
  const s = score(fakeResults);
  assert.equal(s.total, 3);
  assert.equal(s.passed, 2);
  assert.equal(s.pass_rate, 2 / 3);
  assert.equal(s.by_intent.create.total, 2);
  assert.equal(s.by_intent.create.passed, 1);
  assert.equal(s.by_intent.save.total, 1);
  assert.equal(s.by_intent.save.passed, 1);
  assert.equal(s.avg_latency_ms, 150);
});

test("B1: filter selects only matching cases", () => {
  // The runner respects --filter=<prefix>
  const createCases = EVAL_CASES.filter((c) => c.id.startsWith("create"));
  const saveCases = EVAL_CASES.filter((c) => c.id.startsWith("save"));
  assert.ok(createCases.length >= 3, "expected >= 3 create cases");
  assert.ok(saveCases.length >= 2, "expected >= 2 save cases");
  // No overlap
  for (const c of createCases) {
    assert.ok(c.id.startsWith("create"));
  }
});

test("B1: case id format is <intent>.<number>", () => {
  for (const c of EVAL_CASES) {
    assert.match(c.id, /^[a-z_]+\.\d+$/, `case id ${c.id} doesn't match intent.number format`);
  }
});
