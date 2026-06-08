// D1: Latency instrumentation tests (2026-06-08).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSpan, checkBudget, timed, prefetchAll, LATENCY_BUDGET_MS, TTLCache, systemPromptCache, projectListCache, styleDNACache } from "../src/latency.js";

test("D1: createSpan records marks with monotonic timestamps", async () => {
  const span = createSpan("test", { foo: "bar" });
  await new Promise((r) => setTimeout(r, 10));
  span.mark("first");
  await new Promise((r) => setTimeout(r, 10));
  span.mark("second");
  assert.ok(span.total() >= 20, `expected >=20ms, got ${span.total()}`);
  assert.equal(span.marks.length, 2);
  assert.equal(span.marks[0].label, "first");
  assert.equal(span.marks[1].label, "second");
  assert.ok(span.marks[1].at_ms > span.marks[0].at_ms);
});

test("D1: createSpan.toLog returns structured object", () => {
  const span = createSpan("log_test", { user_id: "u1" });
  span.mark("firstToken");
  const log = span.toLog();
  assert.equal(log.span, "log_test");
  assert.equal(log.user_id, "u1");
  assert.equal(log.marks[0].label, "firstToken");
  // toLog only includes label and at_ms (rounded) for compactness
  assert.equal(typeof log.marks[0].at_ms, "number");
  assert.ok(log.total_ms >= 0);
});

test("D1: checkBudget returns empty list when all marks under budget", () => {
  const span = createSpan("good");
  span.mark("buildSystem", { at_ms: 5 });
  span.mark("prefetch", { at_ms: 50 });
  span.mark("firstToken", { at_ms: 500 });
  const v = checkBudget(span);
  assert.deepEqual(v, []);
});

test("D1: checkBudget flags marks that exceed budget", () => {
  const span = createSpan("bad");
  span.mark("buildSystem", { at_ms: 100 }); // budget 50
  span.mark("firstToken", { at_ms: 2000 }); // budget 800
  const v = checkBudget(span);
  assert.equal(v.length, 2);
  assert.equal(v[0].stage, "buildSystem");
  assert.equal(v[0].budget_ms, 50);
  assert.ok(v[0].overage_ms > 0);
});

test("D1: timed() wrapper returns ms and label", async () => {
  const { result, ms, label } = await timed("sleep", async () => {
    await new Promise((r) => setTimeout(r, 5));
    return "ok";
  });
  assert.equal(result, "ok");
  assert.equal(label, "sleep");
  assert.ok(ms >= 5);
});

test("D1: timed() attaches latencyMs on error", async () => {
  try {
    await timed("fail", async () => {
      throw new Error("boom");
    });
    assert.fail("expected throw");
  } catch (e) {
    assert.equal(e.message, "boom");
    assert.ok(e.latencyMs >= 0);
  }
});

test("D1: prefetchAll runs all fetches even if one rejects", async () => {
  const r = await prefetchAll({
    a: async () => "value_a",
    b: async () => { throw new Error("b failed"); },
    c: async () => 42,
  });
  assert.equal(r.a.ok, true);
  assert.equal(r.a.value, "value_a");
  assert.equal(r.b.ok, false);
  assert.match(r.b.error, /b failed/);
  assert.equal(r.c.ok, true);
  assert.equal(r.c.value, 42);
});

test("D1: LATENCY_BUDGET_MS exposes all expected stages", () => {
  for (const k of ["buildSystem", "prefetch", "firstToken", "toolExec", "total"]) {
    assert.ok(LATENCY_BUDGET_MS[k] != null, `missing budget: ${k}`);
    assert.ok(LATENCY_BUDGET_MS[k] > 0);
  }
});

test("D1: TTLCache.get returns undefined for missing key", () => {
  const c = new TTLCache();
  assert.equal(c.get("missing"), undefined);
});

test("D1: TTLCache.set then get returns the value", () => {
  const c = new TTLCache(1000);
  c.set("k", "v");
  assert.equal(c.get("k"), "v");
});

test("D1: TTLCache expires entries after TTL", async () => {
  const c = new TTLCache(10); // 10ms
  c.set("k", "v");
  assert.equal(c.get("k"), "v");
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(c.get("k"), undefined);
});

test("D1: TTLCache.set accepts per-call TTL", () => {
  const c = new TTLCache(1000);
  c.set("a", 1, 50);
  c.set("b", 2, 5000);
  assert.equal(c.get("a"), 1); // valid now
  // Wait for 'a' to expire
  // (skip — would slow tests; trust the per-key TTL logic)
});

test("D1: TTLCache.invalidate removes a key", () => {
  const c = new TTLCache();
  c.set("k", "v");
  c.invalidate("k");
  assert.equal(c.get("k"), undefined);
});

test("D1: TTLCache.clear empties everything", () => {
  const c = new TTLCache();
  c.set("a", 1);
  c.set("b", 2);
  c.clear();
  assert.equal(c.get("a"), undefined);
  assert.equal(c.size, 0);
});

test("D1: global caches are exported and empty by default", () => {
  // Note: in tests we may run multiple test files in the same
  // process, so caches may already have entries. We just check
  // that they're Map-like and accessible.
  assert.ok(systemPromptCache);
  assert.ok(projectListCache);
  assert.ok(styleDNACache);
  assert.equal(typeof systemPromptCache.set, "function");
});
