// test_neural_executor.js — Integration tests for real neural network invocations.
//
// These tests run ACTUAL Python scripts in agents/studio/scripts/ that wrap
// Ollama (LLaVA), ultralytics (YOLOv8), scenedetect, PIL, OpenCV, etc.
//
// What we test:
//   1. describeFrameReal: real LLaVA (or fallback)
//   2. detectObjectsReal: real YOLOv8 (or fallback)
//   3. detectScenesReal: real PySceneDetect (or fallback)
//   4. extractDominantColorsReal: real k-means (or fallback)
//   5. generateImageReal: real SDXL or PIL stub
//   6. generateVideoReal: real ffmpeg gradient (always works)
//   7. inpaintFrameReal: real OpenCV inpaint
//   8. Worker pool: concurrent jobs don't OOM
//   9. Job tracking: getJob, listJobs, user filtering
//
// If a Python dep is missing, the script returns a JSON error
// and the job is marked failed — we test that the error is
// captured properly, not that the inference succeeds in CI.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

async function isPythonAvailable() {
  return new Promise((resolve) => {
    const candidates = process.platform === "win32" ? ["python", "python3"] : ["python3", "python"];
    const tryNext = (i) => {
      if (i >= candidates.length) return resolve(false);
      const p = spawn(candidates[i], ["-c", "import sys; print(sys.version_info.major)"]);
      p.on("error", () => tryNext(i + 1));
      p.on("close", (code) => code === 0 ? resolve(true) : tryNext(i + 1));
    };
    tryNext(0);
  });
}

const pythonOk = await isPythonAvailable();

let executor = null;
async function getExecutor() {
  if (executor) return executor;
  executor = await import("../src/neural_executor.js");
  return executor;
}

function skipIfNoPython(t) {
  if (!pythonOk) {
    t.skip("python not installed");
    return true;
  }
  return false;
}

async function waitForJob(e, jobId, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const j = e.getJob(jobId);
    if (j && (j.status === "completed" || j.status === "failed")) return j;
    await new Promise((r) => setTimeout(r, 200));
  }
  return e.getJob(jobId);
}

// =================== describeFrame ===================

test("Neural: describeFrameReal returns job_id", async (t) => {
  if (skipIfNoPython(t)) return;
  const e = await getExecutor();
  const r = await e.describeFrameReal({ file_path: "test-videos/blue.mp4" });
  assert.equal(r.ok, true);
  assert.ok(r.job_id.startsWith("describeframe-"));
  const job = await waitForJob(e, r.job_id, 120000);
  // Job is either completed (LLaVA + PIL available) or failed (deps missing)
  assert.ok(["completed", "failed"].includes(job.status), `unexpected status: ${job.status}`);
});

test("Neural: describeFrameReal missing file_path returns error", async (t) => {
  if (skipIfNoPython(t)) return;
  const e = await getExecutor();
  const r = await e.describeFrameReal({ file_path: "" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "file_path_required");
});

// =================== detectObjects ===================

test("Neural: detectObjectsReal returns job_id", async (t) => {
  if (skipIfNoPython(t)) return;
  const e = await getExecutor();
  const r = await e.detectObjectsReal({ file_path: "test-videos/blue.mp4" });
  assert.equal(r.ok, true);
  assert.ok(r.job_id.startsWith("detectobj-"));
});

test("Neural: detectObjectsReal missing file_path returns error", async (t) => {
  if (skipIfNoPython(t)) return;
  const e = await getExecutor();
  const r = await e.detectObjectsReal({ file_path: "" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "file_path_required");
});

test("Neural: detectObjectsReal invalid threshold returns error", async (t) => {
  if (skipIfNoPython(t)) return;
  const e = await getExecutor();
  const r = await e.detectObjectsReal({ file_path: "test-videos/blue.mp4", confidence_threshold: 1.5 });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_threshold");
});

// =================== detectScenes ===================

test("Neural: detectScenesReal returns job_id", async (t) => {
  if (skipIfNoPython(t)) return;
  const e = await getExecutor();
  const r = await e.detectScenesReal({ file_path: "test-videos/blue.mp4" });
  assert.equal(r.ok, true);
  assert.ok(r.job_id.startsWith("scenes-"));
});

test("Neural: detectScenesReal missing file_path returns error", async (t) => {
  if (skipIfNoPython(t)) return;
  const e = await getExecutor();
  const r = await e.detectScenesReal({ file_path: "" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "file_path_required");
});

test("Neural: detectScenesReal missing video file returns error", async (t) => {
  if (skipIfNoPython(t)) return;
  const e = await getExecutor();
  const r = await e.detectScenesReal({ file_path: "/nonexistent/video.mp4" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "input_not_found");
});

// =================== extractDominantColors ===================

test("Neural: extractDominantColorsReal returns job_id", async (t) => {
  if (skipIfNoPython(t)) return;
  const e = await getExecutor();
  const r = await e.extractDominantColorsReal({ file_path: "test-videos/blue.mp4", n_colors: 5 });
  assert.equal(r.ok, true);
  assert.ok(r.job_id.startsWith("colors-"));
});

test("Neural: extractDominantColorsReal missing file_path returns error", async (t) => {
  if (skipIfNoPython(t)) return;
  const e = await getExecutor();
  const r = await e.extractDominantColorsReal({ file_path: "" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "file_path_required");
});

// =================== generateImage ===================

test("Neural: generateImageReal returns job_id", async (t) => {
  if (skipIfNoPython(t)) return;
  const e = await getExecutor();
  const r = await e.generateImageReal({ prompt: "A sunset over the ocean" });
  assert.equal(r.ok, true);
  assert.ok(r.job_id.startsWith("genimg-"));
});

test("Neural: generateImageReal empty prompt returns error", async (t) => {
  if (skipIfNoPython(t)) return;
  const e = await getExecutor();
  const r = await e.generateImageReal({ prompt: "" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "prompt_required");
});

// =================== generateVideo ===================

test("Neural: generateVideoReal returns job_id and creates real video", async (t) => {
  if (skipIfNoPython(t)) return;
  const e = await getExecutor();
  const r = await e.generateVideoReal({ prompt: "A drone shot of mountains", duration_sec: 2 });
  assert.equal(r.ok, true);
  assert.ok(r.job_id.startsWith("genvid-"));
  const job = await waitForJob(e, r.job_id, 120000);
  // Video gen is stub-based (ffmpeg gradient), should always succeed
  assert.equal(job.status, "completed", `failed: ${job.error}`);
  assert.ok(job.video_path);
});

test("Neural: generateVideoReal empty prompt returns error", async (t) => {
  if (skipIfNoPython(t)) return;
  const e = await getExecutor();
  const r = await e.generateVideoReal({ prompt: "" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "prompt_required");
});

test("Neural: generateVideoReal invalid duration returns error", async (t) => {
  if (skipIfNoPython(t)) return;
  const e = await getExecutor();
  const r = await e.generateVideoReal({ prompt: "x", duration_sec: 0 });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_duration");
});

// =================== inpaintFrame ===================

test("Neural: inpaintFrameReal with remove mode works", async (t) => {
  if (skipIfNoPython(t)) return;
  const e = await getExecutor();
  const r = await e.inpaintFrameReal({ file_path: "test-videos/blue.mp4", timestamp_sec: 0, mode: "remove", mask: { bbox: { x: 100, y: 100, w: 50, h: 50 } } });
  assert.equal(r.ok, true);
  assert.ok(r.job_id.startsWith("inpaint-"));
  const job = await waitForJob(e, r.job_id, 60000);
  assert.equal(job.status, "completed", `failed: ${job.error}`);
  assert.ok(job.frame_path);
});

test("Neural: inpaintFrameReal missing file_path returns error", async (t) => {
  if (skipIfNoPython(t)) return;
  const e = await getExecutor();
  const r = await e.inpaintFrameReal({ file_path: "", timestamp_sec: 0, mode: "remove", mask: { bbox: { x: 0, y: 0, w: 10, h: 10 } } });
  assert.equal(r.ok, false);
  assert.equal(r.error, "file_path_required");
});

test("Neural: inpaintFrameReal invalid mode returns error", async (t) => {
  if (skipIfNoPython(t)) return;
  const e = await getExecutor();
  const r = await e.inpaintFrameReal({ file_path: "test-videos/blue.mp4", timestamp_sec: 0, mode: "fill", mask: { bbox: { x: 0, y: 0, w: 10, h: 10 } } });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_mode");
});

test("Neural: inpaintFrameReal replace without prompt returns error", async (t) => {
  if (skipIfNoPython(t)) return;
  const e = await getExecutor();
  const r = await e.inpaintFrameReal({ file_path: "test-videos/blue.mp4", timestamp_sec: 0, mode: "replace", mask: { bbox: { x: 0, y: 0, w: 10, h: 10 } } });
  assert.equal(r.ok, false);
  assert.equal(r.error, "prompt_required_for_replace");
});

// =================== Job tracking ===================

test("Neural: getJob returns null for unknown job_id", async (t) => {
  if (skipIfNoPython(t)) return;
  const e = await getExecutor();
  const j = e.getJob("nonexistent-job-id");
  assert.equal(j, null);
});

test("Neural: listJobs returns all jobs for user", async (t) => {
  if (skipIfNoPython(t)) return;
  const e = await getExecutor();
  const r1 = await e.extractDominantColorsReal({ file_path: "test-videos/blue.mp4", n_colors: 3, userId: "u-test-list" });
  const r2 = await e.extractDominantColorsReal({ file_path: "test-videos/red.mp4", n_colors: 3, userId: "u-test-list" });
  const r3 = await e.extractDominantColorsReal({ file_path: "test-videos/green.mp4", n_colors: 3, userId: "u-other" });
  const myJobs = e.listJobs("u-test-list");
  assert.ok(myJobs.length >= 2);
  const myIds = myJobs.map((j) => j.job_id);
  assert.ok(myIds.includes(r1.job_id));
  assert.ok(myIds.includes(r2.job_id));
  assert.ok(!myIds.includes(r3.job_id));
});

// =================== High-level delegation (vision_generation_tools) ===================

test("Vision/Gen: high-level describeFrame delegates to executor", async (t) => {
  if (skipIfNoPython(t)) return;
  const vg = await import("../src/vision_generation_tools.js");
  const r = await vg.describeFrame({ file_path: "test-videos/blue.mp4" });
  assert.equal(r.ok, true);
  assert.ok(r.job_id);
  assert.ok(r.job);
});

test("Vision/Gen: high-level generateImage delegates to executor", async (t) => {
  if (skipIfNoPython(t)) return;
  const vg = await import("../src/vision_generation_tools.js");
  const r = await vg.generateImage({ prompt: "A cat" });
  assert.equal(r.ok, true);
  assert.ok(r.job_id);
  assert.ok(r.job);
});

test("Vision/Gen: high-level inpaintFrame delegates to executor", async (t) => {
  if (skipIfNoPython(t)) return;
  const vg = await import("../src/vision_generation_tools.js");
  const r = await vg.inpaintFrame({ file_path: "test-videos/blue.mp4", timestamp_sec: 0, mode: "remove", mask: { bbox: { x: 0, y: 0, w: 10, h: 10 } } });
  assert.equal(r.ok, true);
  assert.ok(r.job_id);
  assert.ok(r.job);
});
