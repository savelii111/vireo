// neural_executor.js — Real neural network invocations for Tier 2 tools (2026-06-09).
//
// Sister module to ffmpeg_executor.js. Instead of ffmpeg subprocess
// we spawn Python scripts in agents/studio/scripts/ that wrap
// PyTorch / diffusers / Ollama / scenedetect / ultralytics / OpenCV.
//
// What this adds:
//   - describeFrameReal         — describe_frame.py   (LLaVA via Ollama)
//   - detectObjectsReal         — detect_objects.py   (YOLOv8)
//   - detectScenesReal          — detect_scenes.py    (PySceneDetect)
//   - extractDominantColorsReal — extract_dominant_colors.py (k-means)
//   - generateImageReal         — generate_image.py   (SDXL or PIL stub)
//   - generateVideoReal         — generate_video.py   (SVD stub, ffmpeg gradient)
//   - inpaintFrameReal          — inpaint_frame.py    (OpenCV inpaint)
//
// Architecture mirrors ffmpeg_executor.js:
//   - Worker pool (max 2 concurrent Python jobs)
//   - Job tracking in process map
//   - Returns {ok, job_id, ...} for sync, file is written to disk
//   - Errors are captured with stderr tail for debugging
//
// All Python scripts are pure-stdlib + optional heavy deps (the
// fallback paths in each script avoid heavy deps for testing).

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { existsSync, mkdirSync } from "node:fs";
import { join, dirname, extname, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCRIPTS_DIR = join(__dirname, "..", "scripts");
const JOBS_DIR = process.env.VIREO_JOBS_DIR || join(process.cwd(), "vireo-jobs");
const MAX_CONCURRENT_JOBS = Number(process.env.VIREO_MAX_CONCURRENT_JOBS) || 2;
const PYTHON_BIN = process.env.PYTHON_BIN || (process.platform === "win32" ? "python" : "python3");
const DEFAULT_TIMEOUT_MS = Number(process.env.VIREO_NEURAL_TIMEOUT_MS) || 5 * 60 * 1000; // 5 min

if (!existsSync(JOBS_DIR)) {
  try { mkdirSync(JOBS_DIR, { recursive: true }); } catch { /* readonly FS */ }
}

const _jobs = new Map();
const _queue = [];
let _running = 0;

export function getJob(job_id) {
  return _jobs.get(job_id) || null;
}

export function listJobs(userId) {
  const all = [];
  for (const j of _jobs.values()) {
    if (!userId || j.user_id === userId) all.push(j);
  }
  return all;
}

function _withSlot(fn) {
  return new Promise((resolve_, reject_) => {
    const wrapped = async () => {
      _running++;
      try { resolve_(await fn()); } catch (e) { reject_(e); } finally {
        _running--;
        const next = _queue.shift();
        if (next) next();
      }
    };
    if (_running < MAX_CONCURRENT_JOBS) wrapped();
    else _queue.push(wrapped);
  });
}

function _runPython(scriptName, args, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve_, reject_) => {
    const scriptPath = join(SCRIPTS_DIR, scriptName);
    if (!existsSync(scriptPath)) {
      reject_(new Error(`script not found: ${scriptPath}`));
      return;
    }
    const proc = spawn(PYTHON_BIN, [scriptPath, ...args.map((a) => String(a))], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      try { proc.kill("SIGKILL"); } catch {}
      reject_(new Error(`python timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });

    proc.on("error", (e) => { clearTimeout(timer); reject_(e); });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (killed) return;
      if (code !== 0) {
        reject_(new Error(`python exited ${code}: ${stderr.slice(-1500)} | stdout: ${stdout.slice(-500)}`));
        return;
      }
      // Try to parse JSON from stdout (last non-empty line)
      const lines = stdout.trim().split("\n").filter((l) => l.trim());
      const lastLine = lines[lines.length - 1] || "";
      let parsed = null;
      try {
        parsed = JSON.parse(lastLine);
      } catch (e) {
        reject_(new Error(`python output not JSON: ${lastLine.slice(0, 500)}`));
        return;
      }
      resolve_({ stdout, stderr, result: parsed });
    });
  });
}

async function _inputExists(file_path) {
  try { await fs.access(file_path); return true; } catch { return false; }
}

function _nowMs() { return Date.now(); }

// ============================================================
// 1. describeFrame — real LLaVA via Ollama
// ============================================================

export async function describeFrameReal({ file_path, timestamp_sec = 0, focus = null, model = "llava:7b", userId = "anon" }) {
  if (!file_path) return { ok: false, error: "file_path_required" };
  const job_id = `describeframe-${randomUUID()}`;
  const job = { job_id, user_id: userId, kind: "describe_frame", status: "queued", started_at: _nowMs(), file_path, timestamp_sec, focus, model };
  _jobs.set(job_id, job);

  // Extract frame to a temp PNG if the input is a video
  let framePath = file_path;
  let tempFrame = null;
  if (/\.(mp4|mov|avi|mkv|webm)$/i.test(file_path)) {
    if (!(await _inputExists(file_path))) return { ok: false, error: "input_not_found" };
    tempFrame = join(JOBS_DIR, `${job_id}-frame.png`);
    // Use ffmpeg via shell to extract frame
    const { spawn: spawn_ } = await import("node:child_process");
    await new Promise((res, rej) => {
      const p = spawn_("ffmpeg", ["-y", "-ss", String(timestamp_sec), "-i", file_path, "-frames:v", "1", tempFrame]);
      p.on("close", (code) => code === 0 ? res() : rej(new Error(`ffmpeg extract failed: ${code}`)));
      p.on("error", rej);
    });
    framePath = tempFrame;
  }

  const args = [framePath, focus || "", model];

  _withSlot(async () => {
    job.status = "running";
    try {
      const r = await _runPython("describe_frame.py", args);
      job.status = "completed";
      job.finished_at = _nowMs();
      job.result = r.result;
      // Clean up temp frame
      if (tempFrame && existsSync(tempFrame)) {
        try { await fs.unlink(tempFrame); } catch {}
      }
    } catch (e) {
      job.status = "failed";
      job.finished_at = _nowMs();
      job.error = e.message;
      job.stderr_tail = e.message.slice(-1000);
      if (tempFrame && existsSync(tempFrame)) {
        try { await fs.unlink(tempFrame); } catch {}
      }
    }
  });

  return { ok: true, job_id, message: `describe_frame job '${job_id}' queued.` };
}

// ============================================================
// 2. detectObjects — real YOLOv8
// ============================================================

export async function detectObjectsReal({ file_path, timestamp_sec = 0, classes = null, confidence_threshold = 0.5, userId = "anon" }) {
  if (!file_path) return { ok: false, error: "file_path_required" };
  if (confidence_threshold < 0 || confidence_threshold > 1) return { ok: false, error: "invalid_threshold" };
  const job_id = `detectobj-${randomUUID()}`;
  const job = { job_id, user_id: userId, kind: "detect_objects", status: "queued", started_at: _nowMs(), file_path, timestamp_sec, classes, confidence_threshold };
  _jobs.set(job_id, job);

  let framePath = file_path;
  let tempFrame = null;
  if (/\.(mp4|mov|avi|mkv|webm)$/i.test(file_path)) {
    if (!(await _inputExists(file_path))) return { ok: false, error: "input_not_found" };
    tempFrame = join(JOBS_DIR, `${job_id}-frame.png`);
    const { spawn: spawn_ } = await import("node:child_process");
    await new Promise((res, rej) => {
      const p = spawn_("ffmpeg", ["-y", "-ss", String(timestamp_sec), "-i", file_path, "-frames:v", "1", tempFrame]);
      p.on("close", (code) => code === 0 ? res() : rej(new Error(`ffmpeg extract failed: ${code}`)));
      p.on("error", rej);
    });
    framePath = tempFrame;
  }

  const args = [framePath, String(confidence_threshold), classes ? classes.join(",") : ""];

  _withSlot(async () => {
    job.status = "running";
    try {
      const r = await _runPython("detect_objects.py", args, { timeoutMs: 3 * 60 * 1000 });
      job.status = "completed";
      job.finished_at = _nowMs();
      job.result = r.result;
      if (tempFrame && existsSync(tempFrame)) {
        try { await fs.unlink(tempFrame); } catch {}
      }
    } catch (e) {
      job.status = "failed";
      job.finished_at = _nowMs();
      job.error = e.message;
      job.stderr_tail = e.message.slice(-1000);
      if (tempFrame && existsSync(tempFrame)) {
        try { await fs.unlink(tempFrame); } catch {}
      }
    }
  });

  return { ok: true, job_id, message: `detect_objects job '${job_id}' queued.` };
}

// ============================================================
// 3. detectScenes — real PySceneDetect
// ============================================================

export async function detectScenesReal({ file_path, min_scene_length_sec = 2, description_model = "clip", userId = "anon" }) {
  if (!file_path) return { ok: false, error: "file_path_required" };
  if (!(await _inputExists(file_path))) return { ok: false, error: "input_not_found" };
  const job_id = `scenes-${randomUUID()}`;
  const job = { job_id, user_id: userId, kind: "detect_scenes", status: "queued", started_at: _nowMs(), file_path, min_scene_length_sec, description_model };
  _jobs.set(job_id, job);

  const args = [file_path, String(min_scene_length_sec)];

  _withSlot(async () => {
    job.status = "running";
    try {
      const r = await _runPython("detect_scenes.py", args, { timeoutMs: 3 * 60 * 1000 });
      job.status = "completed";
      job.finished_at = _nowMs();
      job.result = r.result;
    } catch (e) {
      job.status = "failed";
      job.finished_at = _nowMs();
      job.error = e.message;
      job.stderr_tail = e.message.slice(-1000);
    }
  });

  return { ok: true, job_id, message: `detect_scenes job '${job_id}' queued.` };
}

// ============================================================
// 4. extractDominantColors — real k-means (numpy + PIL + sklearn)
// ============================================================

export async function extractDominantColorsReal({ file_path, n_colors = 5, timestamp_sec = null, userId = "anon" }) {
  if (!file_path) return { ok: false, error: "file_path_required" };
  const job_id = `colors-${randomUUID()}`;
  const job = { job_id, user_id: userId, kind: "extract_dominant_colors", status: "queued", started_at: _nowMs(), file_path, n_colors, timestamp_sec };
  _jobs.set(job_id, job);

  let imgPath = file_path;
  let tempFrame = null;
  if (timestamp_sec !== null && /\.(mp4|mov|avi|mkv|webm)$/i.test(file_path)) {
    if (!(await _inputExists(file_path))) return { ok: false, error: "input_not_found" };
    tempFrame = join(JOBS_DIR, `${job_id}-frame.png`);
    const { spawn: spawn_ } = await import("node:child_process");
    await new Promise((res, rej) => {
      const p = spawn_("ffmpeg", ["-y", "-ss", String(timestamp_sec), "-i", file_path, "-frames:v", "1", tempFrame]);
      p.on("close", (code) => code === 0 ? res() : rej(new Error(`ffmpeg extract failed: ${code}`)));
      p.on("error", rej);
    });
    imgPath = tempFrame;
  }

  const args = [imgPath, String(n_colors)];

  _withSlot(async () => {
    job.status = "running";
    try {
      const r = await _runPython("extract_dominant_colors.py", args, { timeoutMs: 60 * 1000 });
      job.status = "completed";
      job.finished_at = _nowMs();
      job.result = r.result;
      if (tempFrame && existsSync(tempFrame)) {
        try { await fs.unlink(tempFrame); } catch {}
      }
    } catch (e) {
      job.status = "failed";
      job.finished_at = _nowMs();
      job.error = e.message;
      job.stderr_tail = e.message.slice(-1000);
      if (tempFrame && existsSync(tempFrame)) {
        try { await fs.unlink(tempFrame); } catch {}
      }
    }
  });

  return { ok: true, job_id, message: `extract_dominant_colors job '${job_id}' queued.` };
}

// ============================================================
// 5. generateImage — real SDXL (or PIL stub)
// ============================================================

export async function generateImageReal({ prompt, negative_prompt = null, style = null, aspect_ratio = "1:1", seed = null, model = null, userId = "anon" }) {
  if (!prompt || !prompt.trim()) return { ok: false, error: "prompt_required" };
  const job_id = `genimg-${randomUUID()}`;
  const actualSeed = seed ?? Math.floor(Math.random() * 2 ** 32);
  const output_path = join(JOBS_DIR, `${job_id}.png`);
  const job = { job_id, user_id: userId, kind: "generate_image", status: "queued", started_at: _nowMs(), prompt, negative_prompt, style, aspect_ratio, seed: actualSeed, model, output_path };
  _jobs.set(job_id, job);

  const args = [prompt, negative_prompt || "", aspect_ratio, String(actualSeed), style || "", output_path];

  _withSlot(async () => {
    job.status = "running";
    try {
      const r = await _runPython("generate_image.py", args, { timeoutMs: 10 * 60 * 1000 });
      job.status = "completed";
      job.finished_at = _nowMs();
      job.result = r.result;
      job.image_path = r.result?.image_path || output_path;
    } catch (e) {
      job.status = "failed";
      job.finished_at = _nowMs();
      job.error = e.message;
      job.stderr_tail = e.message.slice(-1000);
    }
  });

  return { ok: true, job_id, message: `generate_image job '${job_id}' queued for prompt: "${prompt.slice(0, 60)}".` };
}

// ============================================================
// 6. generateVideo — real (stub: ffmpeg gradient based on prompt hash)
// ============================================================

export async function generateVideoReal({ prompt, duration_sec = 4, aspect_ratio = "16:9", motion = "medium", style = "cinematic", reference_image_path = null, userId = "anon" }) {
  if (!prompt || !prompt.trim()) return { ok: false, error: "prompt_required" };
  if (duration_sec < 1 || duration_sec > 60) return { ok: false, error: "invalid_duration" };
  const job_id = `genvid-${randomUUID()}`;
  const output_path = join(JOBS_DIR, `${job_id}.mp4`);
  const job = { job_id, user_id: userId, kind: "generate_video", status: "queued", started_at: _nowMs(), prompt, duration_sec, aspect_ratio, motion, style, reference_image_path, output_path };
  _jobs.set(job_id, job);

  const args = [prompt, String(duration_sec), aspect_ratio, motion, style, reference_image_path || "_", output_path];

  _withSlot(async () => {
    job.status = "running";
    try {
      const r = await _runPython("generate_video.py", args, { timeoutMs: 10 * 60 * 1000 });
      job.status = "completed";
      job.finished_at = _nowMs();
      job.result = r.result;
      job.video_path = r.result?.video_path || output_path;
    } catch (e) {
      job.status = "failed";
      job.finished_at = _nowMs();
      job.error = e.message;
      job.stderr_tail = e.message.slice(-1000);
    }
  });

  return { ok: true, job_id, message: `generate_video job '${job_id}' queued.` };
}

// ============================================================
// 7. inpaintFrame — real OpenCV inpainting (SDXL in production)
// ============================================================

export async function inpaintFrameReal({ file_path, timestamp_sec, mode, mask, prompt = null, negative_prompt = null, userId = "anon" }) {
  if (!file_path) return { ok: false, error: "file_path_required" };
  if (typeof timestamp_sec !== "number") return { ok: false, error: "timestamp_required" };
  if (!["remove", "replace"].includes(mode)) return { ok: false, error: "invalid_mode" };
  if (!mask || (!mask.bbox && !mask.polygon)) return { ok: false, error: "mask_required" };
  if (mode === "replace" && (!prompt || !prompt.trim())) return { ok: false, error: "prompt_required_for_replace" };
  if (!(await _inputExists(file_path))) return { ok: false, error: "input_not_found" };

  const job_id = `inpaint-${randomUUID()}`;
  const output_path = join(JOBS_DIR, `${job_id}.png`);
  const job = { job_id, user_id: userId, kind: "inpaint_frame", status: "queued", started_at: _nowMs(), file_path, timestamp_sec, mode, mask, prompt, output_path };
  _jobs.set(job_id, job);

  const args = [file_path, String(timestamp_sec), mode, JSON.stringify(mask), prompt || "_", output_path];

  _withSlot(async () => {
    job.status = "running";
    try {
      const r = await _runPython("inpaint_frame.py", args, { timeoutMs: 5 * 60 * 1000 });
      job.status = "completed";
      job.finished_at = _nowMs();
      job.result = r.result;
      job.frame_path = r.result?.frame_path || output_path;
    } catch (e) {
      job.status = "failed";
      job.finished_at = _nowMs();
      job.error = e.message;
      job.stderr_tail = e.message.slice(-1000);
    }
  });

  return { ok: true, job_id, message: `inpaint_frame job '${job_id}' queued.` };
}

export async function waitForJob(job_id, { timeoutMs = 5 * 60 * 1000, pollMs = 250 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const j = getJob(job_id);
    if (!j) return null;
    if (j.status === "completed" || j.status === "failed") return j;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return getJob(job_id);
}
