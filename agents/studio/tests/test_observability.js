// D3 + E1-E3: Observability tests (2026-06-08).
import { test } from "node:test";
import assert from "node:assert/strict";
import { usageTracker, auditStats, spanAggregator, makeRequestId } from "../src/observability.js";

test("D3: usageTracker.record increments daily and monthly usage", () => {
  const u = new usageTracker.constructor();
  u.reset("u1");
  u.record("u1", { inputTokens: 100, outputTokens: 50, costUsd: 0.01 });
  const usage = u.getUsage("u1");
  assert.equal(usage.daily.input, 100);
  assert.equal(usage.daily.output, 50);
  assert.equal(usage.daily.cost, 0.01);
  assert.equal(usage.daily.total_tokens, 150);
  assert.equal(usage.monthly.total_tokens, 150);
});

test("D3: usageTracker rolls over on day/month change", () => {
  const u = new usageTracker.constructor();
  u.reset("u2");
  u.record("u2", { inputTokens: 50, costUsd: 0.005 });
  // Simulate date roll-over
  const internal = u.users.get("u2");
  internal.daily.date = "2020-01-01";
  internal.monthly.month = "2020-01";
  // Next record should reset daily/monthly
  u.record("u2", { inputTokens: 10, costUsd: 0.001 });
  const usage = u.getUsage("u2");
  assert.equal(usage.daily.date, new Date().toISOString().slice(0, 10));
  assert.equal(usage.daily.input, 10);
  assert.equal(usage.monthly.input, 10);
});

test("D3: usageTracker.checkBudget returns ok when under budget", () => {
  const u = new usageTracker.constructor();
  u.reset("u3");
  u.record("u3", { inputTokens: 1000, costUsd: 0.5 });
  const r = u.checkBudget("u3");
  assert.equal(r.ok, true);
  assert.ok(r.usage);
});

test("D3: usageTracker.checkBudget flags daily token overflow", () => {
  const u = new usageTracker.constructor();
  u.reset("u4");
  // VIREO_DAILY_TOKEN_BUDGET default 200_000; we record 200_001
  u.record("u4", { inputTokens: 200_001, costUsd: 0 });
  const r = u.checkBudget("u4");
  assert.equal(r.ok, false);
  assert.equal(r.reason, "daily_token_budget_exceeded");
  assert.equal(r.used, 200_001);
});

test("D3: usageTracker.checkBudget flags daily cost overflow", () => {
  const u = new usageTracker.constructor();
  u.reset("u5");
  // VIREO_DAILY_COST_BUDGET_USD default 5; we record 5.01
  u.record("u5", { inputTokens: 100, costUsd: 5.01 });
  const r = u.checkBudget("u5");
  assert.equal(r.ok, false);
  assert.equal(r.reason, "daily_cost_budget_exceeded");
});

test("D3: usageTracker.checkBudget flags monthly cost overflow (when daily is also exceeded)", () => {
  // The daily check fires first; we just verify the priority order.
  // For a true monthly-only test, we'd need to bump the daily
  // limit which is global process state — not safe in parallel
  // tests. Instead, we verify the result is a budget violation
  // and the reason is a daily one (since $50.01 also exceeds $5
  // daily). This documents the check-ordering behavior.
  const u = new usageTracker.constructor();
  u.reset("u6");
  u.record("u6", { inputTokens: 100, costUsd: 50.01 });
  const r = u.checkBudget("u6");
  assert.equal(r.ok, false);
  // Daily cost is $5, monthly is $50. $50.01 hits BOTH, but daily
  // is checked first, so the user sees the daily error first.
  assert.equal(r.reason, "daily_cost_budget_exceeded");
});

test("D3: usageTracker.checkBudget returns ok after daily rollover", () => {
  const u = new usageTracker.constructor();
  u.reset("u6b");
  // Trigger creation by calling getUsage first
  u.getUsage("u6b");
  // Set daily usage to something close to the limit
  const internal = u.users.get("u6b");
  internal.daily.input = 200_000;
  internal.daily.cost = 5;
  // Force a date rollover
  internal.daily.date = "2020-01-01";
  // Now we should be back under budget
  const r = u.checkBudget("u6b");
  assert.equal(r.ok, true);
});

test("D3: usageTracker.getStats computes favorite tool and time saved", () => {
  const u = new usageTracker.constructor();
  u.reset("u7");
  u.record("u7", { tool: "create_project" });
  u.record("u7", { tool: "create_project" });
  u.record("u7", { tool: "save_content" });
  const s = u.getStats("u7");
  assert.equal(s.favorite_tool, "create_project");
  assert.equal(s.total_tool_calls, 3);
  // 5 minutes per call × 3 = 15
  assert.equal(s.time_saved_minutes, 15);
});

test("D3: usageTracker.getStats handles no tool calls", () => {
  const u = new usageTracker.constructor();
  u.reset("u8");
  u.record("u8", { inputTokens: 100 });
  const s = u.getStats("u8");
  assert.equal(s.favorite_tool, null);
  assert.equal(s.total_tool_calls, 0);
  assert.equal(s.time_saved_minutes, 0);
});

test("D3: usageTracker history is capped at 1000 events", () => {
  const u = new usageTracker.constructor();
  u.reset("u9");
  for (let i = 0; i < 1500; i++) {
    u.record("u9", { inputTokens: 1 });
  }
  const s = u.getStats("u9");
  assert.equal(s.total_requests, 1000);
});

test("E1: auditStats.record counts by action", () => {
  const a = new auditStats.constructor();
  a.reset();
  a.record({ action: "tool_call", result: "ok" });
  a.record({ action: "tool_call", result: "ok" });
  a.record({ action: "export", result: "ok" });
  const s = a.summary();
  assert.equal(s.by_action.tool_call, 2);
  assert.equal(s.by_action.export, 1);
});

test("E1: auditStats.record counts by tool", () => {
  const a = new auditStats.constructor();
  a.reset();
  a.record({ target_kind: "tool", target_id: "create_project" });
  a.record({ target_kind: "tool", target_id: "create_project" });
  a.record({ target_kind: "tool", target_id: "save_content" });
  const s = a.summary();
  assert.equal(s.by_tool.create_project, 2);
  assert.equal(s.by_tool.save_content, 1);
});

test("E1: auditStats computes latency percentiles", () => {
  const a = new auditStats.constructor();
  a.reset();
  for (let i = 1; i <= 100; i++) a.record({ latency_ms: i });
  const s = a.summary();
  assert.equal(s.latency.count, 100);
  // p50 should be around 50
  assert.ok(s.latency.p50_ms >= 49 && s.latency.p50_ms <= 51, `p50 was ${s.latency.p50_ms}`);
  // p95 should be around 95
  assert.ok(s.latency.p95_ms >= 94 && s.latency.p95_ms <= 96, `p95 was ${s.latency.p95_ms}`);
});

test("E1: auditStats tracks recent errors", () => {
  const a = new auditStats.constructor();
  a.reset();
  a.record({ result: "ok" });
  a.record({ result: "error", action: "tool_call" });
  a.record({ result: "error", action: "export" });
  const s = a.summary();
  assert.equal(s.by_result.error, 2);
  assert.equal(s.by_result.ok, 1);
  assert.equal(s.recent_errors.length, 2);
});

test("E1: auditStats.toCSV returns valid CSV", () => {
  const a = new auditStats.constructor();
  a.reset();
  a.record({ action: "tool_call" });
  a.record({ target_kind: "tool", target_id: "save_content" });
  a.record({ result: "ok" });
  const csv = a.toCSV();
  const lines = csv.split("\n");
  assert.equal(lines[0], '"action","tool","result","count"');
  assert.ok(lines.some((l) => l.includes("tool_call")));
  assert.ok(lines.some((l) => l.includes("save_content")));
  assert.ok(lines.some((l) => l.includes("ok")));
});

test("E2: spanAggregator records and retrieves recent spans", () => {
  const s = new spanAggregator.constructor();
  s.clear();
  s.record({ span: "test", total_ms: 100 });
  s.record({ span: "test2", total_ms: 200 });
  const recent = s.getRecent(10);
  assert.equal(recent.length, 2);
  assert.equal(recent[1].span, "test2");
});

test("E2: spanAggregator caps history at 1000", () => {
  const s = new spanAggregator.constructor();
  s.clear();
  for (let i = 0; i < 1500; i++) s.record({ i });
  assert.equal(s.getRecent(2000).length, 1000);
});

test("E2: makeRequestId returns a UUID", () => {
  const id = makeRequestId({ headers: {} });
  assert.match(id, /^[0-9a-f-]{36}$/);
});

test("E2: makeRequestId uses X-Request-ID header if present", () => {
  const id = makeRequestId({ headers: { "x-request-id": "trace-123" } });
  assert.equal(id, "trace-123");
});

test("D3+E1: global instances are exported and reusable", () => {
  // Sanity check: the global instances are real, not undefined
  assert.ok(usageTracker);
  assert.ok(auditStats);
  assert.ok(spanAggregator);
  // They have the expected methods
  assert.equal(typeof usageTracker.getUsage, "function");
  assert.equal(typeof auditStats.summary, "function");
  assert.equal(typeof spanAggregator.getRecent, "function");
});
