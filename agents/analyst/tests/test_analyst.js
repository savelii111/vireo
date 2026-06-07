// Unit tests for the Analyst + StyleLearner.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Analyst } from "../src/analyst.js";

function snap(platform, views, likes, opts = {}) {
  return {
    content_id: opts.content_id || "c1",
    platform,
    views,
    likes,
    comments: opts.comments || 0,
    shares: opts.shares || 0,
    saves: opts.saves || 0,
  };
}

test("Analyst: ingest adds snapshot with computed engagement_rate", () => {
  const a = new Analyst();
  const s = a.ingest(snap("youtube", 1000, 30));
  assert.ok(s.engagement_rate > 0);
  assert.equal(a.snapshots.length, 1);
});

test("Analyst: ingest detects viral anomaly", () => {
  const a = new Analyst();
  a.ingest(snap("tiktok", 1000, 1000));  // ER = 1.0, way above bench 0.065
  assert.equal(a.alerts.length, 1);
  assert.equal(a.alerts[0].kind, "viral");
});

test("Analyst: ingest detects flop anomaly", () => {
  const a = new Analyst();
  a.ingest(snap("x", 10000, 1));  // ER = 0.0001, way below 0.012
  assert.equal(a.alerts.length, 1);
  assert.equal(a.alerts[0].kind, "flop");
});

test("Analyst: forContent filters by content_id", () => {
  const a = new Analyst();
  a.ingest(snap("youtube", 100, 10, { content_id: "c1" }));
  a.ingest(snap("x", 100, 10, { content_id: "c2" }));
  assert.equal(a.forContent("c1").length, 1);
  assert.equal(a.forContent("c2").length, 1);
});

test("Analyst: forPlatform filters by platform", () => {
  const a = new Analyst();
  a.ingest(snap("youtube", 100, 10));
  a.ingest(snap("x", 100, 10));
  assert.equal(a.forPlatform("youtube").length, 1);
});

test("Analyst: report aggregates correctly", () => {
  const a = new Analyst();
  a.ingest(snap("youtube", 1000, 30, { content_id: "c1" }));
  a.ingest(snap("tiktok", 2000, 100, { content_id: "c2" }));
  a.ingest(snap("x", 500, 5, { content_id: "c3" }));
  const r = a.report({ days: 30 });
  assert.equal(r.total_pieces, 3);
  assert.equal(r.total_views, 3500);
  assert.equal(r.total_engagement, 135);
  assert.ok(r.avg_engagement_rate > 0);
  assert.ok(r.per_platform.youtube);
  assert.ok(r.per_platform.tiktok);
  assert.ok(r.per_platform.x);
});

test("Analyst: report filters by platform", () => {
  const a = new Analyst();
  a.ingest(snap("youtube", 1000, 30));
  a.ingest(snap("tiktok", 1000, 30));
  const r = a.report({ days: 30, platform: "youtube" });
  assert.equal(r.total_pieces, 1);
  assert.equal(r.platform_filter, "youtube");
});

test("Analyst: report includes recent_alerts", () => {
  const a = new Analyst();
  a.ingest(snap("tiktok", 100, 1000));
  const r = a.report({ days: 30 });
  assert.ok(r.recent_alerts.length >= 1);
});

test("Analyst: learn returns diff when observations differ from current", () => {
  const a = new Analyst();
  a.ingest({ ...snap("youtube", 1000, 30), _meta: { hook_used: "curiosity", cta_used: "engagement" } });
  // simulate meta by directly using observe
  const a2 = new Analyst();
  a2.ingest({ content_id: "c1", platform: "youtube", views: 1000, likes: 100, comments: 10, shares: 5 });
  // Note: Analyst doesn't take meta in ingest; that's via StyleLearner.observe.
  // Test the learn() path through StyleLearner directly:
  const result = a2.learn({ hook_patterns: ["curiosity"], cta_patterns: ["engagement"], topics: ["AI"] });
  assert.ok(result.current);
  assert.ok(result.recommended);
  assert.ok(result.diff);
  assert.equal(result.sample_count, 1);
});

test("Analyst: learn handles empty observations", () => {
  const a = new Analyst();
  const r = a.learn({ hook_patterns: ["x"] });
  assert.equal(r.sample_count, 0);
  assert.deepEqual(r.diff, []);
});

test("Analyst: alerts only fired for outliers", () => {
  const a = new Analyst();
  a.ingest(snap("youtube", 1000, 25)); // ER=0.025, exactly benchmark → no alert
  assert.equal(a.alerts.length, 0);
});
