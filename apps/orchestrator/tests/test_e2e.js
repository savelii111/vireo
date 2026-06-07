// E2E test for the multi-agent pipeline.
//
// What we test:
//  1. Pipeline runs end-to-end (Style Learner → Editor → Distributor)
//  2. Style DNA reflects creator's past content
//  3. Editor cuts to target duration
//  4. Distributor schedules jobs for every platform
//  5. Tick publishes jobs
//  6. Analyst ingests metrics, recommends updated DNA
//  7. EU AI Act log is populated

import { test } from "node:test";
import assert from "node:assert/strict";
import { VireoPipeline } from "../index.js";

const ENERGETIC_CORPUS = [
  {
    text: "Bro, this is INSANE! AI can now clone your voice in 30 seconds. Hit subscribe!",
    title: "This AI Tech is INSANE",
    duration_sec: 600,
  },
  {
    text: "STOP. Before you buy that laptop, watch this. I just found the wildest deal.",
    title: "STOP! Don't Buy This Laptop",
    duration_sec: 480,
  },
  {
    text: "Yooo welcome back! Today I tested the new GPU and the results MIND BLOWN! Let's go!",
    title: "New GPU Test — MIND BLOWN",
    duration_sec: 720,
  },
];

const RAW_CONTENT = {
  id: "raw-1",
  text: "Um, like, today we're looking at the new phone. You know, it's pretty cool I guess. " +
        "The camera has 200 megapixels and the battery lasts 30 hours. " +
        "Basically, I think this is the best phone of 2026. " +
        "Anyway, the screen is also very nice. " +
        "So yeah, that's it. Subscribe for more!",
  duration_sec: 120,
};

test("E2E: pipeline runs end-to-end with energetic YouTuber corpus", async () => {
  const pipe = new VireoPipeline();
  const out = await pipe.run({
    corpus: ENERGETIC_CORPUS,
    userId: "yt_energetic",
    rawContent: RAW_CONTENT,
    targetSec: 30,
    platforms: ["youtube", "youtube_shorts", "instagram_reels", "tiktok", "x", "linkedin"],
  });

  // Style DNA reflects the corpus
  assert.equal(out.style_dna.user_id, "yt_energetic");
  assert.ok(["energetic", "casual"].includes(out.style_dna.tone),
    `Expected energetic, got ${out.style_dna.tone}`);
  assert.ok(out.style_dna.confidence > 0.4);

  // Edit plan honors target
  assert.ok(out.edit_plan.output_duration_sec <= 30,
    `Output ${out.edit_plan.output_duration_sec}s exceeds target 30s`);
  assert.ok(out.edit_plan.cuts.length > 0);

  // Distributor created jobs for every platform
  assert.equal(out.distribution.platforms, 6);
  assert.equal(out.distribution.jobs.length, 6);
  for (const job of out.distribution.jobs) {
    assert.ok(["youtube", "youtube_shorts", "instagram_reels", "tiktok", "x", "linkedin"]
      .includes(job.platform));
    assert.ok(job.scheduled_at);
    assert.equal(job.content_id, "raw-1");
  }
});

test("E2E: pipeline adapts content for each platform", async () => {
  const pipe = new VireoPipeline();
  const out = await pipe.run({
    corpus: ENERGETIC_CORPUS,
    userId: "yt",
    rawContent: RAW_CONTENT,
    targetSec: 30,
    platforms: ["youtube", "x", "linkedin"],
  });

  // The jobs contain platform-specific adapted content (we need to call adapt separately
  // to see the actual adapted output — but the pipeline returns the jobs).
  for (const job of out.distribution.jobs) {
    assert.ok(job.title !== undefined || job.caption !== undefined,
      "Job should have either title or caption from adapter");
  }
});

test("E2E: tick publishes all due jobs and populates EU AI Act log", async () => {
  const pipe = new VireoPipeline();
  await pipe.run({
    corpus: ENERGETIC_CORPUS,
    userId: "yt",
    rawContent: RAW_CONTENT,
    targetSec: 30,
    platforms: ["youtube", "x", "tiktok"],
  });

  // Force all jobs to be due
  for (const j of pipe.store.list()) {
    pipe.store.update(j.id, { scheduled_at: "2020-01-01T00:00:00Z" });
  }

  const published = await pipe.tick();
  assert.equal(published, 3);
  assert.equal(pipe.store.list({ status: "published" }).length, 3);

  // EU AI Act log populated
  const log = pipe.store.auditLog();
  assert.equal(log.length, 3);
  for (const entry of log) {
    assert.equal(entry.ai_generated, true);
    assert.equal(entry.eu_ai_act_logged, true);
  }
});

test("E2E: feedback loop — analyst ingests metrics and recommends next-gen DNA", async () => {
  const pipe = new VireoPipeline();
  await pipe.run({
    corpus: ENERGETIC_CORPUS,
    userId: "yt",
    rawContent: RAW_CONTENT,
    targetSec: 30,
    platforms: ["youtube", "tiktok", "x"],
  });
  for (const j of pipe.store.list()) {
    pipe.store.update(j.id, { scheduled_at: "2020-01-01T00:00:00Z" });
  }
  await pipe.tick();

  // Ingest fake metrics — YouTube crushes it, TikTok does well, X underperforms
  const snapshots = [
    { content_id: "raw-1", platform: "youtube", views: 10000, likes: 500, comments: 50, shares: 20 },
    { content_id: "raw-1", platform: "tiktok", views: 5000, likes: 300, comments: 30, shares: 15 },
    { content_id: "raw-1", platform: "x", views: 200, likes: 0, comments: 0, shares: 0 },
  ];
  const nextDna = await pipe.feedback(snapshots);
  assert.ok(nextDna.current);
  assert.ok(nextDna.recommended);
  assert.equal(nextDna.sample_count, 3);

  // Analyst detected at least one anomaly
  const report = pipe.report();
  assert.ok(report.recent_alerts.length >= 1, "Expected at least one alert");
});

test("E2E: pipeline is deterministic for the same input", async () => {
  const p1 = new VireoPipeline();
  const p2 = new VireoPipeline();
  const [o1, o2] = await Promise.all([
    p1.run({ corpus: ENERGETIC_CORPUS, userId: "u", rawContent: RAW_CONTENT, targetSec: 30, platforms: ["youtube", "x"] }),
    p2.run({ corpus: ENERGETIC_CORPUS, userId: "u", rawContent: RAW_CONTENT, targetSec: 30, platforms: ["youtube", "x"] }),
  ]);
  // DNA + edit plan + job count identical
  assert.equal(o1.style_dna.tone, o2.style_dna.tone);
  assert.equal(o1.edit_plan.cuts.length, o2.edit_plan.cuts.length);
  assert.equal(o1.distribution.platforms, o2.distribution.platforms);
  // Scheduled times should be very close (within seconds)
  for (let i = 0; i < o1.distribution.jobs.length; i++) {
    const d1 = new Date(o1.distribution.jobs[i].scheduled_at);
    const d2 = new Date(o2.distribution.jobs[i].scheduled_at);
    assert.ok(Math.abs(d1 - d2) < 5000, "Schedule should be stable");
  }
});

test("E2E: cold-start (empty corpus) still works", async () => {
  const pipe = new VireoPipeline();
  const out = await pipe.run({
    corpus: [],
    userId: "cold",
    rawContent: RAW_CONTENT,
    targetSec: 30,
    platforms: ["youtube", "x"],
  });
  // DNA exists but confidence is 0
  assert.equal(out.style_dna.confidence, 0);
  // Edit plan still produced
  assert.ok(out.edit_plan.cuts.length > 0);
  // Jobs still scheduled
  assert.equal(out.distribution.platforms, 2);
});
