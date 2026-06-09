// worker_pool.js — Background worker pool for Vireo jobs (2026-06-09).
//
// Polls the SQLite job store for queued jobs, claims them, executes
// via the appropriate executor (FFmpeg or Neural), updates progress,
// and marks done/failed.
//
// Architecture:
//   - Single shared pool per process
//   - Each worker is an async loop that claims and runs jobs
//   - Job routing by `type` field:
//       ffmpeg, batch_edit, export → ffmpeg_executor
//       describe_frame, detect_objects, etc. → neural_executor
//   - Default 2 workers, configurable via VIREO_WORKER_POOL_SIZE
//   - Cooperative shutdown via stopWorkerPool()
//
// In v1: claims jobs, executes synchronously inline, updates DB.
// In v2: would use child_process.fork for true parallelism.

import { claimNextJob, getJob, updateJob, completeJob, failJob, getJobEvents, dbStats } from "./jobs.js";
import * as ffmpegExecutor from "./ffmpeg_executor.js";
import * as neuralExecutor from "./neural_executor.js";

// Map of job.type → real function name (strip "Real" suffix in our executor)
const FFMPEG_TYPE_TO_FN = {
  ffmpeg: null, // generic ffmpeg, not yet implemented
  apply_color_grade: ffmpegExecutor.applyColorGradeReal,
  apply_speed_ramp: ffmpegExecutor.applySpeedRampReal,
  mix_audio: ffmpegExecutor.mixAudioReal,
  compose_multi_clip: ffmpegExecutor.composeMultiClipReal,
  add_text_overlay: ffmpegExecutor.addTextOverlayReal,
};

const NEURAL_TYPE_TO_FN = {
  describe_frame: neuralExecutor.describeFrameReal,
  detect_objects: neuralExecutor.detectObjectsReal,
  detect_scenes: neuralExecutor.detectScenesReal,
  extract_dominant_colors: neuralExecutor.extractDominantColorsReal,
  generate_image: neuralExecutor.generateImageReal,
  generate_video: neuralExecutor.generateVideoReal,
  inpaint_frame: neuralExecutor.inpaintFrameReal,
};

let _running = false;
let _workers = [];
let _pollIntervalMs = Number(process.env.VIREO_WORKER_POLL_MS || 500);
let _poolSize = Number(process.env.VIREO_WORKER_POOL_SIZE || 2);

// Job types that the ffmpeg executor can handle
const FFMPEG_TYPES = new Set([
  "apply_color_grade", "apply_speed_ramp", "mix_audio",
  "compose_multi_clip", "add_text_overlay", "batch_edit", "export",
]);

// Job types that the neural executor can handle
const NEURAL_TYPES = new Set([
  "describe_frame", "detect_objects", "detect_scenes",
  "extract_dominant_colors", "generate_image", "generate_video",
  "inpaint_frame",
]);

function _routeJob(job) {
  if (FFMPEG_TYPES.has(job.type)) return "ffmpeg";
  if (NEURAL_TYPES.has(job.type)) return "neural";
  return null;
}

async function _executeJob(job) {
  const route = _routeJob(job);
  if (!route) {
    failJob(job.id, `no_executor_for_type: ${job.type}`, { retry: false });
    return;
  }
  const args = job.args || {};
  try {
    if (route === "ffmpeg") {
      // For batch_edit/export we call the production tools directly
      if (job.type === "batch_edit") {
        const { batchEdit } = await import("./production_tools.js");
        const r = await batchEdit(args);
        if (r.ok) {
          completeJob(job.id, { result: r });
        } else {
          failJob(job.id, r.error || "batch_edit_failed", { retry: false });
        }
        return;
      }
      if (job.type === "export") {
        const { queueExport } = await import("./production_tools.js");
        const r = await queueExport(args);
        if (r.ok) {
          completeJob(job.id, { result: r });
        } else {
          failJob(job.id, r.error || "export_failed", { retry: false });
        }
        return;
      }
      // Generic ffmpeg call
      const fn = FFMPEG_TYPE_TO_FN[job.type];
      if (!fn) {
        failJob(job.id, `no_ffmpeg_executor_for_type: ${job.type}`, { retry: false });
        return;
      }
      const r = await fn(args);
      if (r?.ok) completeJob(job.id, { result: r });
      else failJob(job.id, r?.error || "ffmpeg_returned_error", { retry: true });
    } else if (route === "neural") {
      const fn = NEURAL_TYPE_TO_FN[job.type];
      if (!fn) {
        failJob(job.id, `no_neural_executor_for_type: ${job.type}`, { retry: false });
        return;
      }
      const r = await fn(args);
      if (r?.ok) completeJob(job.id, { result: r });
      else failJob(job.id, r?.error || "neural_returned_error", { retry: true });
    }
  } catch (e) {
    failJob(job.id, e?.message || String(e), { retry: true });
  }
}

async function _workerLoop(workerId) {
  while (_running) {
    const job = claimNextJob();
    if (!job) {
      await new Promise((r) => setTimeout(r, _pollIntervalMs));
      continue;
    }
    console.log(`[worker ${workerId}] claimed ${job.id} (type=${job.type})`);
    await _executeJob(job);
  }
}

export function startWorkerPool({ poolSize = _poolSize, pollIntervalMs = _pollIntervalMs } = {}) {
  if (_running) {
    console.warn("[worker_pool] already running");
    return;
  }
  _running = true;
  _poolSize = poolSize;
  _pollIntervalMs = pollIntervalMs;
  _workers = [];
  for (let i = 0; i < poolSize; i++) {
    _workers.push(_workerLoop(i));
  }
  console.log(`[worker_pool] started ${poolSize} workers, poll ${pollIntervalMs}ms`);
}

export async function stopWorkerPool() {
  _running = false;
  await Promise.allSettled(_workers);
  _workers = [];
  console.log("[worker_pool] stopped");
}

export function isWorkerPoolRunning() {
  return _running;
}

export function workerPoolStats() {
  return {
    running: _running,
    pool_size: _poolSize,
    poll_interval_ms: _pollIntervalMs,
    active_workers: _workers.length,
    db: dbStats(),
  };
}
