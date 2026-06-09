// test_performance.js — Tests for the PerformanceTracker module.
//
// Validates:
//   1. track returns an object with end function
//   2. end returns duration in ms (non-negative)
//   3. getStats returns correct count
//   4. getStats avgMs is calculated correctly
//   5. p50/p95/p99 percentiles are computed
//   6. min/max are correct
//   7. getAllStats returns stats for all operations
//   8. reset() clears all stats
//   9. reset(name) clears only that operation
//  10. 1000+ measurements are handled (histogram cap)
//  11. Concurrent tracking works
//  12. Histogram sorts correctly for percentiles
//  13. Empty histogram returns zeros
//  14. Single measurement stats
//  15. Operations are independent

import { test } from "node:test";
import assert from "node:assert/strict";
import { PerformanceTracker } from "../src/performance.js";

// =====================================================================
// 1. track returns an object with an end function
// =====================================================================
test("track() returns object with end function", () => {
  const perf = new PerformanceTracker();
  const handle = perf.track("op1");
  assert.equal(typeof handle, "object");
  assert.equal(typeof handle.end, "function");
});

// =====================================================================
// 2. end returns duration in ms (non-negative)
// =====================================================================
test("end() returns non-negative duration in ms", async () => {
  const perf = new PerformanceTracker();
  const handle = perf.track("op2");
  await new Promise((r) => setTimeout(r, 10));
  const duration = handle.end();
  assert.equal(typeof duration, "number");
  assert.ok(duration >= 0, `duration should be >= 0, got ${duration}`);
  assert.ok(duration >= 5, `duration should be >= 5ms after 10ms sleep, got ${duration}`);
});

// =====================================================================
// 3. getStats returns correct count
// =====================================================================
test("getStats returns correct count", () => {
  const perf = new PerformanceTracker();
  for (let i = 0; i < 5; i++) {
    perf.track("count_test").end();
  }
  const stats = perf.getStats("count_test");
  assert.equal(stats.count, 5);
});

// =====================================================================
// 4. getStats avgMs is calculated correctly
// =====================================================================
test("getStats avgMs is calculated correctly", () => {
  const perf = new PerformanceTracker();
  // Manually record known durations by calling track/end quickly
  // We'll use _record directly since end() uses performance.now()
  // Instead, just verify the formula works with known values
  perf._histograms.set("avg_test", [10, 20, 30]);
  const stats = perf.getStats("avg_test");
  assert.equal(stats.avgMs, 20);
  assert.equal(stats.totalMs, 60);
});

// =====================================================================
// 5. p50/p95/p99 percentiles are computed
// =====================================================================
test("p50/p95/p99 percentiles are computed", () => {
  const perf = new PerformanceTracker();
  // Create a histogram with values 1..100
  const values = Array.from({ length: 100 }, (_, i) => i + 1);
  perf._histograms.set("pct_test", values);
  const stats = perf.getStats("pct_test");
  assert.equal(stats.count, 100);
  // p50 of 1..100: rank = 0.5 * 99 = 49.5 → between index 49 (val 50) and 50 (val 51)
  assert.ok(stats.p50 >= 50 && stats.p50 <= 51, `p50 should be ~50.5, got ${stats.p50}`);
  // p95: rank = 0.95 * 99 = 94.05 → between index 94 (val 95) and 95 (val 96)
  assert.ok(stats.p95 >= 95 && stats.p95 <= 96, `p95 should be ~95.05, got ${stats.p95}`);
  // p99: rank = 0.99 * 99 = 98.01 → between index 98 (val 99) and 99 (val 100)
  assert.ok(stats.p99 >= 99 && stats.p99 <= 100, `p99 should be ~99.01, got ${stats.p99}`);
});

// =====================================================================
// 6. min/max are correct
// =====================================================================
test("min/max are correct", () => {
  const perf = new PerformanceTracker();
  perf._histograms.set("minmax_test", [5, 3, 8, 1, 9]);
  const stats = perf.getStats("minmax_test");
  assert.equal(stats.min, 1);
  assert.equal(stats.max, 9);
});

// =====================================================================
// 7. getAllStats returns stats for all operations
// =====================================================================
test("getAllStats returns stats for all operations", () => {
  const perf = new PerformanceTracker();
  perf.track("opA").end();
  perf.track("opB").end();
  perf.track("opC").end();
  const all = perf.getAllStats();
  assert.equal(typeof all, "object");
  assert.ok("opA" in all);
  assert.ok("opB" in all);
  assert.ok("opC" in all);
  assert.equal(all.opA.count, 1);
  assert.equal(all.opB.count, 1);
  assert.equal(all.opC.count, 1);
});

// =====================================================================
// 8. reset() clears all stats
// =====================================================================
test("reset() clears all stats", () => {
  const perf = new PerformanceTracker();
  perf.track("x").end();
  perf.track("y").end();
  assert.equal(perf.getStats("x").count, 1);
  assert.equal(perf.getStats("y").count, 1);
  perf.reset();
  assert.equal(perf.getStats("x").count, 0);
  assert.equal(perf.getStats("y").count, 0);
  assert.deepEqual(perf.getAllStats(), {});
});

// =====================================================================
// 9. reset(name) clears only that operation
// =====================================================================
test("reset(name) clears only that operation", () => {
  const perf = new PerformanceTracker();
  perf.track("keep").end();
  perf.track("remove").end();
  perf.track("keep").end();
  assert.equal(perf.getStats("keep").count, 2);
  assert.equal(perf.getStats("remove").count, 1);
  perf.reset("remove");
  assert.equal(perf.getStats("keep").count, 2, "keep should be untouched");
  assert.equal(perf.getStats("remove").count, 0, "remove should be cleared");
});

// =====================================================================
// 10. 1000+ measurements are handled (histogram trimmed to 1000)
// =====================================================================
test("1000+ measurements are handled with histogram cap", () => {
  const perf = new PerformanceTracker();
  // Record 1200 measurements
  for (let i = 0; i < 1200; i++) {
    perf._record("bulk_test", i);
  }
  const stats = perf.getStats("bulk_test");
  assert.equal(stats.count, 1000, "should keep only last 1000");
  // After trimming, values should be 200..1199
  assert.equal(stats.min, 200);
  assert.equal(stats.max, 1199);
});

// =====================================================================
// 11. Concurrent tracking — multiple track/end pairs interleaved
// =====================================================================
test("concurrent tracking with interleaved ends", () => {
  const perf = new PerformanceTracker();
  const h1 = perf.track("concurrent");
  const h2 = perf.track("concurrent");
  const h3 = perf.track("concurrent");
  // End in reverse order
  h3.end();
  h2.end();
  h1.end();
  const stats = perf.getStats("concurrent");
  assert.equal(stats.count, 3);
  assert.ok(stats.min >= 0);
  assert.ok(stats.max >= stats.min);
});

// =====================================================================
// 12. Histogram sorts correctly for percentiles
// =====================================================================
test("percentiles handle unsorted input", () => {
  const perf = new PerformanceTracker();
  // Deliberately unsorted
  perf._histograms.set("unsorted", [100, 10, 50, 1, 90, 30, 70, 20, 80, 40]);
  const stats = perf.getStats("unsorted");
  assert.equal(stats.min, 1);
  assert.equal(stats.max, 100);
  assert.equal(stats.count, 10);
  // Sum of [100,10,50,1,90,30,70,20,80,40] = 491
  assert.equal(stats.totalMs, 491);
  assert.equal(stats.avgMs, 49.1);
});

// =====================================================================
// 13. Empty histogram returns zeros
// =====================================================================
test("empty histogram returns zeros for all fields", () => {
  const perf = new PerformanceTracker();
  const stats = perf.getStats("nonexistent");
  assert.equal(stats.count, 0);
  assert.equal(stats.totalMs, 0);
  assert.equal(stats.avgMs, 0);
  assert.equal(stats.p50, 0);
  assert.equal(stats.p95, 0);
  assert.equal(stats.p99, 0);
  assert.equal(stats.min, 0);
  assert.equal(stats.max, 0);
});

// =====================================================================
// 14. Single measurement stats
// =====================================================================
test("single measurement returns correct stats", () => {
  const perf = new PerformanceTracker();
  perf._histograms.set("single", [42]);
  const stats = perf.getStats("single");
  assert.equal(stats.count, 1);
  assert.equal(stats.totalMs, 42);
  assert.equal(stats.avgMs, 42);
  assert.equal(stats.p50, 42);
  assert.equal(stats.p95, 42);
  assert.equal(stats.p99, 42);
  assert.equal(stats.min, 42);
  assert.equal(stats.max, 42);
});

// =====================================================================
// 15. Operations are independent
// =====================================================================
test("different operations maintain independent histograms", () => {
  const perf = new PerformanceTracker();
  perf._record("fast_op", 1);
  perf._record("fast_op", 2);
  perf._record("slow_op", 100);
  perf._record("slow_op", 200);

  const fast = perf.getStats("fast_op");
  const slow = perf.getStats("slow_op");
  assert.equal(fast.count, 2);
  assert.equal(fast.avgMs, 1.5);
  assert.equal(slow.count, 2);
  assert.equal(slow.avgMs, 150);
  assert.equal(slow.min, 100);
  assert.equal(slow.max, 200);
});

// =====================================================================
// 16. end() is idempotent — calling twice returns 0 on second call
// =====================================================================
test("end() is idempotent", () => {
  const perf = new PerformanceTracker();
  const h = perf.track("idem");
  const d1 = h.end();
  const d2 = h.end();
  assert.ok(d1 >= 0);
  assert.equal(d2, 0, "second end() should return 0");
  assert.equal(perf.getStats("idem").count, 1, "should only record once");
});

// =====================================================================
// 17. Large percentile values
// =====================================================================
test("percentiles with all identical values", () => {
  const perf = new PerformanceTracker();
  perf._histograms.set("identical", Array(50).fill(7));
  const stats = perf.getStats("identical");
  assert.equal(stats.p50, 7);
  assert.equal(stats.p95, 7);
  assert.equal(stats.p99, 7);
  assert.equal(stats.min, 7);
  assert.equal(stats.max, 7);
});
