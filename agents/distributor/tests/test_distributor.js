// Unit tests for the store + distributor orchestrator.
import { test } from "node:test";
import assert from "node:assert/strict";
import { JobStore } from "../src/store.js";
import { Distributor } from "../src/distributor.js";
import { mockPublisher, flakyPublisher } from "../src/mock_publisher.js";

const editPlan = {
  source_id: "src-1",
  cuts: [
    { start: 0, end: 5, text: "Hook.", score: 0.9, role: "hook" },
    { start: 5, end: 15, text: "Body.", score: 0.7, role: "body" },
    { start: 15, end: 20, text: "Subscribe!", score: 0.6, role: "cta" },
  ],
  output_duration_sec: 20,
  style_applied: { tone: "energetic" },
  notes: "Test",
};

const styleDna = {
  user_id: "u1",
  tone: "energetic",
  topics: ["AI", "creators"],
  hook_patterns: ["curiosity"],
  cta_patterns: ["engagement"],
};

test("JobStore: add returns job with id", () => {
  const s = new JobStore();
  const j = s.add({ platform: "youtube", scheduled_at: "2026-06-15T15:00:00Z", content_id: "c1" });
  assert.ok(j.id);
  assert.equal(j.status, "pending");
});

test("JobStore: list filters by platform", () => {
  const s = new JobStore();
  s.add({ platform: "youtube", scheduled_at: "2026-06-15T15:00:00Z", content_id: "c1" });
  s.add({ platform: "x", scheduled_at: "2026-06-15T15:00:00Z", content_id: "c1" });
  assert.equal(s.list({ platform: "youtube" }).length, 1);
  assert.equal(s.list({ platform: "x" }).length, 1);
  assert.equal(s.list().length, 2);
});

test("JobStore: get returns single job", () => {
  const s = new JobStore();
  const j = s.add({ platform: "youtube", scheduled_at: "2026-06-15T15:00:00Z" });
  assert.equal(s.get(j.id).id, j.id);
});

test("JobStore: update patches job", () => {
  const s = new JobStore();
  const j = s.add({ platform: "youtube", scheduled_at: "2026-06-15T15:00:00Z" });
  s.update(j.id, { status: "failed", error: "oops" });
  assert.equal(s.get(j.id).status, "failed");
  assert.equal(s.get(j.id).error, "oops");
});

test("JobStore: pending finds due jobs", () => {
  const s = new JobStore();
  s.add({ platform: "youtube", scheduled_at: "2020-01-01T00:00:00Z" });
  s.add({ platform: "youtube", scheduled_at: "2099-01-01T00:00:00Z" });
  assert.equal(s.pending(new Date("2026-06-15T00:00:00Z")).length, 1);
});

test("JobStore: tick publishes due jobs", async () => {
  const s = new JobStore();
  s.add({ platform: "youtube", scheduled_at: "2020-01-01T00:00:00Z", content_id: "c1" });
  const n = await s.tick(new Date("2026-06-15T00:00:00Z"), mockPublisher);
  assert.equal(n, 1);
  assert.equal(s.list({ status: "published" }).length, 1);
  assert.ok(s.list({ status: "published" })[0].platform_post_id.startsWith("youtube_"));
});

test("JobStore: tick marks failures and doesn't crash", async () => {
  const s = new JobStore();
  s.add({ platform: "x", scheduled_at: "2020-01-01T00:00:00Z" });
  const n = await s.tick(new Date(), flakyPublisher(1.0)); // always fail
  assert.equal(n, 0);
  assert.equal(s.list({ status: "failed" }).length, 1);
});

test("JobStore: auditLog contains EU AI Act compliance flags", async () => {
  const s = new JobStore();
  s.add({ platform: "youtube", scheduled_at: "2020-01-01T00:00:00Z", content_id: "c1" });
  await s.tick(new Date(), mockPublisher);
  const log = s.auditLog();
  assert.equal(log.length, 1);
  assert.equal(log[0].ai_generated, true);
  assert.equal(log[0].eu_ai_act_logged, true);
});

test("Distributor: distribute creates N jobs for N platforms", () => {
  const s = new JobStore();
  const d = new Distributor(s);
  const out = d.distribute({ editPlan, styleDna, contentId: "c1" });
  assert.equal(out.platforms, 10);
  assert.equal(out.content_id, "c1");
  assert.equal(s.list().length, 10);
});

test("Distributor: distribute respects platform subset", () => {
  const s = new JobStore();
  const d = new Distributor(s);
  const out = d.distribute({ editPlan, styleDna, platforms: ["youtube", "x"], contentId: "c1" });
  assert.equal(out.platforms, 2);
  const platforms = s.list().map((j) => j.platform);
  assert.deepEqual(platforms.sort(), ["x", "youtube"]);
});

test("Distributor: distribute requires editPlan + styleDna", () => {
  const s = new JobStore();
  const d = new Distributor(s);
  assert.throws(() => d.distribute({ styleDna, contentId: "c" }), /editPlan/);
  assert.throws(() => d.distribute({ editPlan, contentId: "c" }), /styleDna/);
});

test("Distributor: distribute stamps content_id on every job", () => {
  const s = new JobStore();
  const d = new Distributor(s);
  d.distribute({ editPlan, styleDna, contentId: "c-42", platforms: ["youtube", "x"] });
  for (const j of s.list()) {
    assert.equal(j.content_id, "c-42");
  }
});

test("Distributor: distribute end-to-end (schedule + tick)", async () => {
  const s = new JobStore();
  const d = new Distributor(s);
  // Force all jobs to be due by passing a far-future after time
  // Easiest: schedule jobs, then force their scheduled_at to the past
  d.distribute({ editPlan, styleDna, contentId: "c1" });
  for (const j of s.list()) {
    s.update(j.id, { scheduled_at: "2020-01-01T00:00:00Z" });
  }
  const published = await d.runDue(mockPublisher);
  assert.equal(published, 10);
  assert.equal(s.list({ status: "published" }).length, 10);
});
