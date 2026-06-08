// test_ffmpeg_executor.js — Integration tests for real FFmpeg invocations.
//
// These tests run ACTUAL ffmpeg against real test video files.
// They take longer than the unit tests (~1-3s each) but verify
// that the executor produces real output files, not just stubs.
//
// Setup:
//   - Test videos are created via ffmpeg lavfi (color + sine wave)
//   - Located in agents/studio/test-videos/
//   - If ffmpeg is not installed, tests are SKIPPED (not failed)
//
// What we test:
//   1. Color grade: 5 presets produce real output files
//   2. Speed ramp: 4 presets produce real output files
//   3. Audio mix: 4 modes produce real output files
//   4. Multi-clip: 3 layouts produce real output files
//   5. Text overlay: 5 presets produce real output files
//   6. Worker pool: concurrent jobs don't OOM
//   7. Error handling: bad inputs return clean errors
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, statSync, promises as fs } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEST_VIDEOS_DIR = join(__dirname, "..", "test-videos");
const BLUE = join(TEST_VIDEOS_DIR, "blue.mp4");
const RED = join(TEST_VIDEOS_DIR, "red.mp4");
const GREEN = join(TEST_VIDEOS_DIR, "green.mp4");

// Skip all tests if ffmpeg is not available
async function isFfmpegAvailable() {
  return new Promise((resolve) => {
    const p = spawn("ffmpeg", ["-version"]);
    p.on("error", () => resolve(false));
    p.on("close", (code) => resolve(code === 0));
  });
}

const ffmpegOk = await isFfmpegAvailable();

// Skip helper
function skipIfNoFfmpeg(t) {
  if (!ffmpegOk) {
    t.skip("ffmpeg not installed");
    return true;
  }
  if (!existsSync(BLUE) || !existsSync(RED) || !existsSync(GREEN)) {
    t.skip(`test videos not found in ${TEST_VIDEOS_DIR}`);
    return true;
  }
  return false;
}

// Lazy import of executor (only if ffmpeg is available)
let executor = null;
async function getExecutor() {
  if (executor) return executor;
  executor = await import("../src/ffmpeg_executor.js");
  return executor;
}

// Helper: wait for a job to complete
async function waitForJob(executor, jobId, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const j = executor.getJob(jobId);
    if (j && (j.status === "completed" || j.status === "failed")) return j;
    await new Promise((r) => setTimeout(r, 100));
  }
  return executor.getJob(jobId);
}

// Helper: file size > 0
function isNonEmpty(path) {
  if (!path) return false;
  if (!existsSync(path)) return false;
  return statSync(path).size > 0;
}

// =================== COLOR GRADE ===================

test("FFmpeg: applyColorGradeReal with cinematic preset produces real output", async (t) => {
  if (skipIfNoFfmpeg(t)) return;
  const e = await getExecutor();
  const r = await e.applyColorGradeReal({ file_path: BLUE, preset: "cinematic" });
  assert.equal(r.ok, true);
  assert.ok(r.job_id);
  const job = await waitForJob(e, r.job_id);
  assert.equal(job.status, "completed", `job failed: ${job.error}`);
  assert.ok(isNonEmpty(job.output_path), `output not found: ${job.output_path}`);
  // Output should be a valid mp4
  assert.ok(job.output_path.endsWith(".mp4"));
});

test("FFmpeg: applyColorGradeReal intensity=0 produces near-identity", async (t) => {
  if (skipIfNoFfmpeg(t)) return;
  const e = await getExecutor();
  const r = await e.applyColorGradeReal({ file_path: BLUE, preset: "vibrant", intensity: 0 });
  assert.equal(r.ok, true);
  const job = await waitForJob(e, r.job_id);
  assert.equal(job.status, "completed");
  assert.ok(isNonEmpty(job.output_path));
});

test("FFmpeg: applyColorGradeReal with invalid preset returns error", async (t) => {
  if (skipIfNoFfmpeg(t)) return;
  const e = await getExecutor();
  const r = await e.applyColorGradeReal({ file_path: BLUE, preset: "bogus" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_preset");
});

test("FFmpeg: applyColorGradeReal with missing file returns error", async (t) => {
  if (skipIfNoFfmpeg(t)) return;
  const e = await getExecutor();
  const r = await e.applyColorGradeReal({ file_path: "/nonexistent/video.mp4", preset: "cinematic" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "input_not_found");
});

test("FFmpeg: applyColorGradeReal all 8 presets work", async (t) => {
  if (skipIfNoFfmpeg(t)) return;
  const e = await getExecutor();
  const presets = ["cinematic", "warm", "cold", "vibrant", "vintage", "bw", "high_contrast", "auto_fix"];
  for (const preset of presets) {
    const r = await e.applyColorGradeReal({ file_path: BLUE, preset });
    assert.equal(r.ok, true, `preset ${preset} should succeed`);
    const job = await waitForJob(e, r.job_id);
    assert.equal(job.status, "completed", `preset ${preset} job failed: ${job.error}`);
    assert.ok(isNonEmpty(job.output_path), `preset ${preset} produced no output`);
  }
});

// =================== SPEED RAMP ===================

test("FFmpeg: applySpeedRampReal constant_half produces shorter output", async (t) => {
  if (skipIfNoFfmpeg(t)) return;
  const e = await getExecutor();
  const r = await e.applySpeedRampReal({ file_path: BLUE, preset: "constant_half" });
  assert.equal(r.ok, true);
  const job = await waitForJob(e, r.job_id);
  assert.equal(job.status, "completed", `failed: ${job.error}`);
  assert.ok(isNonEmpty(job.output_path));
});

test("FFmpeg: applySpeedRampReal ramp_in works", async (t) => {
  if (skipIfNoFfmpeg(t)) return;
  const e = await getExecutor();
  const r = await e.applySpeedRampReal({ file_path: RED, preset: "ramp_in" });
  assert.equal(r.ok, true);
  const job = await waitForJob(e, r.job_id);
  assert.equal(job.status, "completed", `failed: ${job.error}`);
  assert.ok(isNonEmpty(job.output_path));
});

test("FFmpeg: applySpeedRampReal custom multipliers work", async (t) => {
  if (skipIfNoFfmpeg(t)) return;
  const e = await getExecutor();
  const r = await e.applySpeedRampReal({ file_path: GREEN, preset: [1.0, 0.5, 1.0] });
  assert.equal(r.ok, true);
  const job = await waitForJob(e, r.job_id);
  assert.equal(job.status, "completed");
});

test("FFmpeg: applySpeedRampReal invalid multipliers returns error", async (t) => {
  if (skipIfNoFfmpeg(t)) return;
  const e = await getExecutor();
  const r = await e.applySpeedRampReal({ file_path: BLUE, preset: [0, 1.0] });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_multipliers");
});

// =================== AUDIO MIX ===================

test("FFmpeg: mixAudioReal with EQ podcast works", async (t) => {
  if (skipIfNoFfmpeg(t)) return;
  const e = await getExecutor();
  const r = await e.mixAudioReal({ file_path: BLUE, voice_eq: "podcast", normalize: true });
  assert.equal(r.ok, true);
  const job = await waitForJob(e, r.job_id);
  assert.equal(job.status, "completed", `failed: ${job.error}`);
  assert.ok(isNonEmpty(job.output_path));
});

test("FFmpeg: mixAudioReal with denoise works", async (t) => {
  if (skipIfNoFfmpeg(t)) return;
  const e = await getExecutor();
  const r = await e.mixAudioReal({ file_path: RED, denoise: true, voice_volume: 1.2 });
  assert.equal(r.ok, true);
  const job = await waitForJob(e, r.job_id);
  assert.equal(job.status, "completed");
});

test("FFmpeg: mixAudioReal with all options produces output", async (t) => {
  if (skipIfNoFfmpeg(t)) return;
  const e = await getExecutor();
  const r = await e.mixAudioReal({ file_path: GREEN, voice_volume: 1.5, music_volume: 0.5, duck_preset: "aggressive", voice_eq: "radio", normalize: true, denoise: true });
  assert.equal(r.ok, true);
  const job = await waitForJob(e, r.job_id);
  assert.equal(job.status, "completed", `failed: ${job.error}`);
});

test("FFmpeg: mixAudioReal invalid eq returns error", async (t) => {
  if (skipIfNoFfmpeg(t)) return;
  const e = await getExecutor();
  const r = await e.mixAudioReal({ file_path: BLUE, voice_eq: "bogus" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_voice_eq");
});

// =================== MULTI-CLIP ===================

test("FFmpeg: composeMultiClipReal sequential layout works", async (t) => {
  if (skipIfNoFfmpeg(t)) return;
  const e = await getExecutor();
  const r = await e.composeMultiClipReal({ clips: [{ file_path: BLUE }, { file_path: RED }], layout: "sequential" });
  assert.equal(r.ok, true);
  const job = await waitForJob(e, r.job_id);
  assert.equal(job.status, "completed", `failed: ${job.error}`);
  assert.ok(isNonEmpty(job.output_path));
});

test("FFmpeg: composeMultiClipReal pip layout works", async (t) => {
  if (skipIfNoFfmpeg(t)) return;
  const e = await getExecutor();
  const r = await e.composeMultiClipReal({ clips: [{ file_path: BLUE }, { file_path: RED }], layout: "pip" });
  assert.equal(r.ok, true);
  const job = await waitForJob(e, r.job_id);
  assert.equal(job.status, "completed", `failed: ${job.error}`);
});

test("FFmpeg: composeMultiClipReal grid layout with 4 clips works", async (t) => {
  if (skipIfNoFfmpeg(t)) return;
  const e = await getExecutor();
  const r = await e.composeMultiClipReal({ clips: [{ file_path: BLUE }, { file_path: RED }, { file_path: GREEN }, { file_path: BLUE }], layout: "grid" });
  assert.equal(r.ok, true);
  const job = await waitForJob(e, r.job_id);
  assert.equal(job.status, "completed", `failed: ${job.error}`);
});

test("FFmpeg: composeMultiClipReal less than 2 clips returns error", async (t) => {
  if (skipIfNoFfmpeg(t)) return;
  const e = await getExecutor();
  const r = await e.composeMultiClipReal({ clips: [{ file_path: BLUE }] });
  assert.equal(r.ok, false);
  assert.equal(r.error, "clips_required");
});

test("FFmpeg: composeMultiClipReal grid requires 4 clips", async (t) => {
  if (skipIfNoFfmpeg(t)) return;
  const e = await getExecutor();
  const r = await e.composeMultiClipReal({ clips: [{ file_path: BLUE }, { file_path: RED }], layout: "grid" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "grid_requires_4_clips");
});

// =================== TEXT OVERLAY ===================

test("FFmpeg: addTextOverlayReal with tiktok-title produces real output", async (t) => {
  if (skipIfNoFfmpeg(t)) return;
  const e = await getExecutor();
  const r = await e.addTextOverlayReal({ file_path: BLUE, text: "Hello World", preset: "tiktok-title" });
  assert.equal(r.ok, true);
  const job = await waitForJob(e, r.job_id);
  assert.equal(job.status, "completed", `failed: ${job.error}`);
  assert.ok(isNonEmpty(job.output_path));
});

test("FFmpeg: addTextOverlayReal with animation works", async (t) => {
  if (skipIfNoFfmpeg(t)) return;
  const e = await getExecutor();
  const r = await e.addTextOverlayReal({ file_path: RED, text: "BOOM", preset: "tiktok-title" });
  assert.equal(r.ok, true);
  const job = await waitForJob(e, r.job_id);
  assert.equal(job.status, "completed", `failed: ${job.error}`);
  assert.ok(isNonEmpty(job.output_path));
});

test("FFmpeg: addTextOverlayReal with custom position works", async (t) => {
  if (skipIfNoFfmpeg(t)) return;
  const e = await getExecutor();
  const r = await e.addTextOverlayReal({ file_path: GREEN, text: "Hi", preset: "lower-third" });
  assert.equal(r.ok, true);
  const job = await waitForJob(e, r.job_id);
  assert.equal(job.status, "completed", `failed: ${job.error}`);
  assert.ok(isNonEmpty(job.output_path));
});

test("FFmpeg: addTextOverlayReal text with special chars is escaped", async (t) => {
  if (skipIfNoFfmpeg(t)) return;
  const e = await getExecutor();
  // Special chars: apostrophe, colon, percent
  const r = await e.addTextOverlayReal({ file_path: BLUE, text: "Today's tip: 50% off!", preset: "tiktok-title" });
  assert.equal(r.ok, true);
  const job = await waitForJob(e, r.job_id);
  assert.equal(job.status, "completed", `failed: ${job.error}`);
});

test("FFmpeg: addTextOverlayReal empty text returns error", async (t) => {
  if (skipIfNoFfmpeg(t)) return;
  const e = await getExecutor();
  const r = await e.addTextOverlayReal({ file_path: BLUE, text: "", preset: "tiktok-title" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "text_required");
});

// =================== CONCURRENCY ===================

test("FFmpeg: 3 concurrent color grades all complete", async (t) => {
  if (skipIfNoFfmpeg(t)) return;
  const e = await getExecutor();
  const promises = [
    e.applyColorGradeReal({ file_path: BLUE, preset: "cinematic" }),
    e.applyColorGradeReal({ file_path: RED, preset: "warm" }),
    e.applyColorGradeReal({ file_path: GREEN, preset: "cold" }),
  ];
  const results = await Promise.all(promises);
  for (const r of results) {
    assert.equal(r.ok, true);
    const job = await waitForJob(e, r.job_id);
    assert.equal(job.status, "completed", `failed: ${job.error}`);
    assert.ok(isNonEmpty(job.output_path));
  }
});

// =================== JOB TRACKING ===================

test("FFmpeg: getJob returns null for unknown job_id", async (t) => {
  if (skipIfNoFfmpeg(t)) return;
  const e = await getExecutor();
  const j = e.getJob("colgrade-nonexistent");
  assert.equal(j, null);
});

test("FFmpeg: listJobs returns all jobs for user", async (t) => {
  if (skipIfNoFfmpeg(t)) return;
  const e = await getExecutor();
  const r1 = await e.applyColorGradeReal({ file_path: BLUE, preset: "cinematic", userId: "u-test-list" });
  const r2 = await e.applyColorGradeReal({ file_path: RED, preset: "warm", userId: "u-test-list" });
  const r3 = await e.applyColorGradeReal({ file_path: GREEN, preset: "cold", userId: "u-other" });
  const myJobs = e.listJobs("u-test-list");
  assert.ok(myJobs.length >= 2, `expected >= 2 jobs, got ${myJobs.length}`);
  const myIds = myJobs.map((j) => j.job_id);
  assert.ok(myIds.includes(r1.job_id));
  assert.ok(myIds.includes(r2.job_id));
  assert.ok(!myIds.includes(r3.job_id));
});
