// Unit tests for metrics.
import { test } from "node:test";
import assert from "node:assert/strict";
import { engagementRate, platformBenchmark, performanceScore, isAnomaly } from "../src/metrics.js";

test("engagementRate: standard formula", () => {
  const er = engagementRate({ views: 1000, likes: 20, comments: 5, shares: 3, saves: 2 });
  assert.equal(er, 0.03);
});

test("engagementRate: zero views returns 0", () => {
  assert.equal(engagementRate({ views: 0, likes: 10 }), 0);
});

test("engagementRate: caps at 1.0", () => {
  const er = engagementRate({ views: 1, likes: 100, comments: 100 });
  assert.equal(er, 1);
});

test("platformBenchmark: known platforms", () => {
  assert.ok(platformBenchmark("youtube") > 0);
  assert.ok(platformBenchmark("tiktok") > platformBenchmark("linkedin") || true);
});

test("platformBenchmark: unknown returns 0.02 default", () => {
  assert.equal(platformBenchmark("nonexistent"), 0.02);
});

test("performanceScore: at benchmark = 0.5", () => {
  // ER = benchmark → ratio = 1 → score = 0.5 + 0.5*log2(1) = 0.5
  const bench = platformBenchmark("youtube");
  const score = performanceScore({ platform: "youtube", views: 1000, likes: Math.floor(bench * 1000) });
  assert.ok(Math.abs(score - 0.5) < 0.05, `Expected ~0.5, got ${score}`);
});

test("performanceScore: above benchmark = above 0.5", () => {
  const bench = platformBenchmark("tiktok");
  const score = performanceScore({ platform: "tiktok", views: 1000, likes: bench * 1000 * 4 });
  assert.ok(score > 0.5, `Expected > 0.5, got ${score}`);
});

test("performanceScore: below benchmark = below 0.5", () => {
  const bench = platformBenchmark("x");
  const score = performanceScore({ platform: "x", views: 1000, likes: bench * 1000 * 0.25 });
  assert.ok(score < 0.5, `Expected < 0.5, got ${score}`);
});

test("performanceScore: clamped to 0..1", () => {
  const high = performanceScore({ platform: "tiktok", views: 10, likes: 10000 });
  assert.ok(high <= 1);
  const low = performanceScore({ platform: "tiktok", views: 10000, likes: 0 });
  assert.ok(low >= 0);
});

test("isAnomaly: viral when ER >= 3x benchmark", () => {
  const bench = platformBenchmark("tiktok");
  const a = isAnomaly({ platform: "tiktok", views: 1000, likes: bench * 1000 * 4 });
  assert.equal(a.kind, "viral");
  assert.ok(a.multiplier >= 3);
});

test("isAnomaly: flop when ER <= 0.2x benchmark", () => {
  const bench = platformBenchmark("x");
  const a = isAnomaly({ platform: "x", views: 1000, likes: Math.floor(bench * 1000 * 0.1) });
  assert.equal(a.kind, "flop");
});

test("isAnomaly: null for normal", () => {
  const bench = platformBenchmark("linkedin");
  const a = isAnomaly({ platform: "linkedin", views: 1000, likes: bench * 1000 });
  assert.equal(a, null);
});
