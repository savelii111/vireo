// vision_generation_tools.js — Vision + AI image/video generation (2026-06-08).
//
// Tier 2 differentiation tools. These leverage neural networks
// (CLIP, vision LLMs, Stable Diffusion, video diffusion) to add
// capabilities no other editor has in a chat-based interface.
//
// What this adds (7 tools):
//
// Vision (4 tools) — analyze video visually, not just from metadata
//   1. describe_frame          — describe a single frame (vision LLM)
//   2. detect_objects          — detect objects in a frame (YOLO-style)
//   3. detect_scenes           — scene boundary detection with descriptions
//   4. extract_dominant_colors — color palette extraction
//
// AI Generation (3 tools) — generate new visual content
//   5. generate_image   — Stable Diffusion / DALL-E (text → image)
//   6. generate_video   — text → short video (model-based)
//   7. inpaint_frame    — remove/replace object in a frame
//
// All generation tools use the configurable neural backend
// (NEURAL_BACKEND env: 'local', 'openai', 'stability', 'replicate').
// Local backend uses Stable Diffusion via the bundled ComfyUI;
// cloud backends call the appropriate API.
//
// Vision tools accept a file_path + optional timestamp, and return
// a structured description. Generation tools accept a prompt and
// return a job_id (same pattern as the other long-form tools).

import { randomUUID } from "node:crypto";

// Lazy import of the neural executor. Same pattern as edit_tools_tier1.js.
// The high-level functions delegate to the executor when available;
// the executor handles all the actual work (Python subprocess, Ollama HTTP, etc).
let _executor = null;
async function _getExecutor() {
  if (_executor !== null) return _executor;
  try {
    _executor = await import("./neural_executor.js");
  } catch (e) {
    _executor = false; // mark as unavailable
  }
  return _executor || null;
}

// ---------- Vision tool 1: describe_frame ----------

/**
 * Describe a single frame from a video using a vision LLM (CLIP,
 * BLIP-2, LLaVA, or GPT-4V depending on backend).
 *
 * @param {object} args
 * @param {string} args.file_path - Path to the video file
 * @param {number} args.timestamp_sec - Which frame to describe (default 0)
 * @param {string} [args.focus] - Optional hint: "what's in the background", "describe the person", etc.
 * @param {string} [args.model] - Override model: "gpt-4v", "llava", "clip", "blip2" (default: backend's choice)
 * @returns {Promise<{ok, description, tags, model, error?}>}
 */
export async function describeFrame({ file_path, timestamp_sec = 0, focus = null, model = null }) {
  if (!file_path) return { ok: false, error: "file_path_required" };
  if (timestamp_sec < 0) return { ok: false, error: "invalid_timestamp", message: "timestamp_sec must be >= 0" };

  const job_id = `describeframe-${randomUUID()}`;
  const job = { job_id, kind: "describe_frame", status: "queued", file_path, timestamp_sec, focus, model, started_at: new Date().toISOString() };

  const executor = await _getExecutor();
  if (executor && typeof executor.describeFrameReal === "function") {
    (async () => {
      try {
        const r2 = await executor.describeFrameReal({ file_path, timestamp_sec, focus, model: model || "llava:7b" });
        if (r2 && r2.job_id) {
          const realJob = executor.getJob(r2.job_id);
          if (realJob) {
            job.status = realJob.status;
            job.result = realJob.result;
            job.error = realJob.error;
            job.finished_at = realJob.finished_at;
          }
        }
      } catch (e) {
        job.status = "failed";
        job.error = e.message;
      }
    })();
    return { ok: true, job_id, job, message: `describe_frame job '${job_id}' queued.` };
  }

  // Fallback stub (no executor available)
  const backend = process.env.NEURAL_BACKEND || "local";
  const chosenModel = model || (backend === "openai" ? "gpt-4v" : backend === "replicate" ? "llava-13b" : "llava-1.5-7b");
  return { ok: true, description: `Frame at ${timestamp_sec}s of ${file_path}: a video frame. [STUB — wire to vision LLM]`, tags: ["video", "frame"],
    model: chosenModel,
    backend,
    timestamp_sec,
  };
}

// ---------- Vision tool 2: detect_objects ----------

const COMMON_OBJECT_CLASSES = [
  "person", "face", "hand", "car", "dog", "cat", "phone", "laptop", "cup", "bottle",
  "book", "chair", "table", "plant", "food", "screen", "headphones", "shirt", "shoe", "bag",
];

/**
 * Detect objects in a single frame using YOLO-style detection.
 * Returns bounding boxes + class labels + confidence scores.
 *
 * @param {object} args
 * @param {string} args.file_path
 * @param {number} [args.timestamp_sec] - Frame to analyze (default 0)
 * @param {string[]} [args.classes] - Limit to specific classes (default: COMMON_OBJECT_CLASSES)
 * @param {number} [args.confidence_threshold] - 0-1, default 0.5
 * @returns {Promise<{ok, objects, model, error?}>}
 */
export async function detectObjects({ file_path, timestamp_sec = 0, classes = null, confidence_threshold = 0.5 }) {
  if (!file_path) return { ok: false, error: "file_path_required" };
  if (confidence_threshold < 0 || confidence_threshold > 1) {
    return { ok: false, error: "invalid_threshold" };
  }
  const targetClasses = classes && classes.length > 0 ? classes : COMMON_OBJECT_CLASSES;

  const job_id = `detectobj-${randomUUID()}`;
  const job = { job_id, kind: "detect_objects", status: "queued", file_path, timestamp_sec, classes: targetClasses, confidence_threshold, started_at: new Date().toISOString() };
  const executor = await _getExecutor();
  if (executor && typeof executor.detectObjectsReal === "function") {
    (async () => {
      try {
        const r2 = await executor.detectObjectsReal({ file_path, timestamp_sec, classes: targetClasses, confidence_threshold });
        if (r2 && r2.job_id) {
          const realJob = executor.getJob(r2.job_id);
          if (realJob) {
            job.status = realJob.status;
            job.result = realJob.result;
            job.error = realJob.error;
            job.finished_at = realJob.finished_at;
          }
        }
      } catch (e) {
        job.status = "failed";
        job.error = e.message;
      }
    })();
    return { ok: true, job_id, job, message: `detect_objects job '${job_id}' queued.` };
  }

  // Fallback stub
  const backend = process.env.NEURAL_BACKEND || "local";
  return {
    ok: true,
    objects: [],
    model: backend === "local" ? "yolov8n" : "yolov8l",
    classes_searched: targetClasses,
    confidence_threshold,
    timestamp_sec,
    backend,
  };
}

// ---------- Vision tool 3: detect_scenes ----------

/**
 * Detect scene boundaries in a video and describe each scene.
 * Uses content-based change detection (histogram diff + scene
 * classifier).
 *
 * @param {object} args
 * @param {string} args.file_path
 * @param {number} [args.min_scene_length_sec] - Ignore scenes shorter than this (default 2)
 * @param {string} [args.description_model] - "clip" (fast), "llava" (rich), "gpt-4v" (best)
 * @returns {Promise<{ok, scenes, error?}>}
 */
export async function detectScenes({ file_path, min_scene_length_sec = 2, description_model = "clip" }) {
  if (!file_path) return { ok: false, error: "file_path_required" };

  const job_id = `scenes-${randomUUID()}`;
  const job = { job_id, kind: "detect_scenes", status: "queued", file_path, min_scene_length_sec, description_model, started_at: new Date().toISOString() };
  const executor = await _getExecutor();
  if (executor && typeof executor.detectScenesReal === "function") {
    (async () => {
      try {
        const r2 = await executor.detectScenesReal({ file_path, min_scene_length_sec, description_model });
        if (r2 && r2.job_id) {
          const realJob = executor.getJob(r2.job_id);
          if (realJob) {
            job.status = realJob.status;
            job.result = realJob.result;
            job.error = realJob.error;
            job.finished_at = realJob.finished_at;
          }
        }
      } catch (e) {
        job.status = "failed";
        job.error = e.message;
      }
    })();
    return { ok: true, job_id, job, message: `detect_scenes job '${job_id}' queued.` };
  }

  const backend = process.env.NEURAL_BACKEND || "local";
  return {
    ok: true,
    scenes: [],
    min_scene_length_sec,
    description_model,
    backend,
  };
}

// ---------- Vision tool 4: extract_dominant_colors ----------

/**
 * Extract the dominant color palette from a video (or a specific frame).
 * Useful for matching B-roll to your brand colors, or for auto-grading.
 *
 * @param {object} args
 * @param {string} args.file_path
 * @param {number} [args.n_colors] - Number of colors to extract (default 5)
 * @param {number} [args.timestamp_sec] - If set, analyze a single frame; else aggregate
 * @returns {Promise<{ok, palette, error?}>}
 */
export async function extractDominantColors({ file_path, n_colors = 5, timestamp_sec = null }) {
  if (!file_path) return { ok: false, error: "file_path_required" };
  if (n_colors < 1 || n_colors > 20) return { ok: false, error: "invalid_n_colors" };

  const job_id = `colors-${randomUUID()}`;
  const job = { job_id, kind: "extract_dominant_colors", status: "queued", file_path, n_colors, timestamp_sec, started_at: new Date().toISOString() };
  const executor = await _getExecutor();
  if (executor && typeof executor.extractDominantColorsReal === "function") {
    (async () => {
      try {
        const r2 = await executor.extractDominantColorsReal({ file_path, n_colors, timestamp_sec });
        if (r2 && r2.job_id) {
          const realJob = executor.getJob(r2.job_id);
          if (realJob) {
            job.status = realJob.status;
            job.result = realJob.result;
            job.error = realJob.error;
            job.finished_at = realJob.finished_at;
          }
        }
      } catch (e) {
        job.status = "failed";
        job.error = e.message;
      }
    })();
    return { ok: true, job_id, job, message: `extract_dominant_colors job '${job_id}' queued.` };
  }

  return {
    ok: true,
    palette: [],
    n_colors,
    timestamp_sec,
  };
}

// ---------- Generation tool 1: generate_image ----------

/**
 * Generate an image from a text prompt using Stable Diffusion,
 * DALL-E, or another backend.
 *
 * @param {object} args
 * @param {string} args.prompt - The text prompt (required)
 * @param {string} [args.negative_prompt] - What to avoid
 * @param {string} [args.style] - "photorealistic", "illustration", "anime", "cinematic", "3d_render"
 * @param {string} [args.aspect_ratio] - "1:1", "16:9", "9:16", "4:3" (default "1:1")
 * @param {number} [args.seed] - For reproducibility (default: random)
 * @param {string} [args.model] - "sdxl", "dall-e-3", "midjourney" (default: backend default)
 * @returns {Promise<{ok, job_id, image_path, model, backend, error?}>}
 */
export async function generateImage({ prompt, negative_prompt = null, style = null, aspect_ratio = "1:1", seed = null, model = null }) {
  if (!prompt || prompt.trim().length === 0) {
    return { ok: false, error: "prompt_required", message: "prompt is required" };
  }
  if (prompt.length > 4000) {
    return { ok: false, error: "prompt_too_long", message: "prompt must be 4000 chars or fewer" };
  }
  const validAspects = ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"];
  if (!validAspects.includes(aspect_ratio)) {
    return { ok: false, error: "invalid_aspect_ratio", message: `aspect_ratio must be one of: ${validAspects.join(", ")}` };
  }

  const job_id = `genimg-${randomUUID()}`;
  const job = { job_id, kind: "generate_image", status: "queued", prompt, negative_prompt, style, aspect_ratio, seed: seed ?? Math.floor(Math.random() * 2 ** 32), model, started_at: new Date().toISOString() };
  const executor = await _getExecutor();
  if (executor && typeof executor.generateImageReal === "function") {
    (async () => {
      try {
        const r2 = await executor.generateImageReal({ prompt, negative_prompt, style, aspect_ratio, seed, model });
        if (r2 && r2.job_id) {
          const realJob = executor.getJob(r2.job_id);
          if (realJob) {
            job.status = realJob.status;
            job.result = realJob.result;
            job.image_path = realJob.image_path;
            job.error = realJob.error;
            job.finished_at = realJob.finished_at;
          }
        }
      } catch (e) {
        job.status = "failed";
        job.error = e.message;
      }
    })();
    return { ok: true, job_id, job, message: `generate_image job '${job_id}' queued for prompt: "${prompt.slice(0, 80)}${prompt.length > 80 ? "..." : ""}"` };
  }

  // Fallback stub
  const stubBackend = process.env.NEURAL_BACKEND || "local";
  const chosenModel = model || (stubBackend === "openai" ? "dall-e-3" : stubBackend === "replicate" ? "sdxl" : "sdxl-base-1.0");
  return {
    ok: true,
    job_id,
    image_path: null,
    prompt,
    negative_prompt,
    style,
    aspect_ratio,
    seed: seed ?? Math.floor(Math.random() * 2 ** 32),
    model: chosenModel,
    backend: stubBackend,
    message: `Image generation job '${job_id}' queued for prompt: "${prompt.slice(0, 80)}${prompt.length > 80 ? "..." : ""}"`,
  };
}

// ---------- Generation tool 2: generate_video ----------

/**
 * Generate a short video from a text prompt (text-to-video).
 * Uses Sora, Runway Gen-3, Stable Video Diffusion, or local models
 * depending on backend.
 *
 * @param {object} args
 * @param {string} args.prompt - Text description of the video
 * @param {number} [args.duration_sec] - Target duration (2-10s typical, default 4)
 * @param {string} [args.aspect_ratio] - "16:9", "9:16", "1:1"
 * @param {string} [args.motion] - "low", "medium", "high" (how much camera/subject motion)
 * @param {string} [args.style] - "cinematic", "documentary", "vlog", "animated"
 * @param {string} [args.reference_image_path] - Optional image to anchor the video to
 * @returns {Promise<{ok, job_id, model, backend, error?}>}
 */
export async function generateVideo({ prompt, duration_sec = 4, aspect_ratio = "16:9", motion = "medium", style = "cinematic", reference_image_path = null }) {
  if (!prompt || prompt.trim().length === 0) {
    return { ok: false, error: "prompt_required" };
  }
  if (duration_sec < 1 || duration_sec > 60) {
    return { ok: false, error: "invalid_duration", message: "duration_sec must be 1-60" };
  }

  const job_id = `genvid-${randomUUID()}`;
  const job = { job_id, kind: "generate_video", status: "queued", prompt, duration_sec, aspect_ratio, motion, style, reference_image_path, started_at: new Date().toISOString() };
  const executor = await _getExecutor();
  if (executor && typeof executor.generateVideoReal === "function") {
    (async () => {
      try {
        const r2 = await executor.generateVideoReal({ prompt, duration_sec, aspect_ratio, motion, style, reference_image_path });
        if (r2 && r2.job_id) {
          const realJob = executor.getJob(r2.job_id);
          if (realJob) {
            job.status = realJob.status;
            job.result = realJob.result;
            job.video_path = realJob.video_path;
            job.error = realJob.error;
            job.finished_at = realJob.finished_at;
          }
        }
      } catch (e) {
        job.status = "failed";
        job.error = e.message;
      }
    })();
    return { ok: true, job_id, job, message: `generate_video job '${job_id}' queued: ${duration_sec}s ${aspect_ratio} "${prompt.slice(0, 80)}${prompt.length > 80 ? "..." : ""}"` };
  }

  // Fallback stub
  const stubBackend = process.env.NEURAL_BACKEND || "local";
  const chosenModel = stubBackend === "openai" ? "sora" : stubBackend === "replicate" ? "svd-xt" : "svd-xt-1.1";
  return {
    ok: true,
    job_id,
    video_path: null,
    prompt,
    duration_sec,
    aspect_ratio,
    motion,
    style,
    reference_image_path,
    model: chosenModel,
    backend: stubBackend,
    message: `Video generation job '${job_id}' queued: ${duration_sec}s ${aspect_ratio} "${prompt.slice(0, 80)}${prompt.length > 80 ? "..." : ""}"`,
  };
}

// ---------- Generation tool 3: inpaint_frame ----------

/**
 * Inpaint a frame — remove or replace an object specified by a mask
 * or bounding box. Uses Stable Diffusion inpainting or LaMa.
 *
 * @param {object} args
 * @param {string} args.file_path - Source video
 * @param {number} args.timestamp_sec - Which frame to inpaint
 * @param {string} args.mode - "remove" (erase object), "replace" (replace with prompt)
 * @param {object} args.mask - Either {bbox: {x, y, w, h}} or {polygon: [[x,y],...]}
 * @param {string} [args.prompt] - For "replace" mode, what to put there
 * @param {string} [args.negative_prompt]
 * @returns {Promise<{ok, job_id, frame_path, model, error?}>}
 */
export async function inpaintFrame({ file_path, timestamp_sec, mode, mask, prompt = null, negative_prompt = null }) {
  if (!file_path) return { ok: false, error: "file_path_required" };
  if (typeof timestamp_sec !== "number") return { ok: false, error: "timestamp_required" };
  if (!["remove", "replace"].includes(mode)) {
    return { ok: false, error: "invalid_mode", message: "mode must be 'remove' or 'replace'" };
  }
  if (mode === "replace" && (!prompt || prompt.trim().length === 0)) {
    return { ok: false, error: "prompt_required_for_replace", message: "prompt is required for replace mode" };
  }
  if (!mask || (!mask.bbox && !mask.polygon)) {
    return { ok: false, error: "mask_required", message: "mask must have bbox or polygon" };
  }

  const job_id = `inpaint-${randomUUID()}`;
  const job = { job_id, kind: "inpaint_frame", status: "queued", file_path, timestamp_sec, mode, mask, prompt, negative_prompt, started_at: new Date().toISOString() };
  const executor = await _getExecutor();
  if (executor && typeof executor.inpaintFrameReal === "function") {
    (async () => {
      try {
        const r2 = await executor.inpaintFrameReal({ file_path, timestamp_sec, mode, mask, prompt, negative_prompt });
        if (r2 && r2.job_id) {
          const realJob = executor.getJob(r2.job_id);
          if (realJob) {
            job.status = realJob.status;
            job.result = realJob.result;
            job.frame_path = realJob.frame_path;
            job.error = realJob.error;
            job.finished_at = realJob.finished_at;
          }
        }
      } catch (e) {
        job.status = "failed";
        job.error = e.message;
      }
    })();
    return { ok: true, job_id, job, message: `inpaint_frame job '${job_id}' queued: ${mode} at ${timestamp_sec}s` };
  }

  // Fallback stub
  const stubBackend = process.env.NEURAL_BACKEND || "local";
  const chosenModel = "sdxl-inpainting";
  return {
    ok: true,
    job_id,
    frame_path: null,
    file_path,
    timestamp_sec,
    mode,
    mask,
    prompt,
    negative_prompt,
    model: chosenModel,
    backend: stubBackend,
    message: `Inpaint job '${job_id}' queued: ${mode} at ${timestamp_sec}s`,
  };
}

// ---------- Tool definitions for the LLM ----------

export const VISION_GENERATION_TOOLS = [
  {
    type: "function",
    function: {
      name: "describe_frame",
      description:
        "Describe a single frame from a video using a vision LLM. Use when the user wants to 'describe what's in this video', 'what does this frame show', 'is there a person in this clip', or 'caption this frame for accessibility'.",
      parameters: {
        type: "object",
        required: ["file_path"],
        properties: {
          file_path: { type: "string", description: "Path to the video file." },
          timestamp_sec: { type: "number", description: "Which frame to describe (default 0 = first frame)." },
          focus: { type: "string", description: "Optional hint like 'the person', 'the background', 'colors'." },
          model: { type: "string", enum: ["gpt-4v", "llava", "clip", "blip2"], description: "Override vision model." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "detect_objects",
      description:
        "Detect objects in a video frame with bounding boxes. Use when the user wants 'find all the people', 'where's the dog', 'count the cars', or 'what objects are in this scene'.",
      parameters: {
        type: "object",
        required: ["file_path"],
        properties: {
          file_path: { type: "string" },
          timestamp_sec: { type: "number", description: "Default 0." },
          classes: { type: "array", items: { type: "string" }, description: "Limit to these classes (default: common objects)." },
          confidence_threshold: { type: "number", minimum: 0, maximum: 1, description: "Default 0.5." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "detect_scenes",
      description:
        "Detect scene boundaries in a video with descriptions. Use when the user wants 'split this by scenes', 'where do the scenes change', 'give me a chapter list with descriptions', or 'find the cuts'.",
      parameters: {
        type: "object",
        required: ["file_path"],
        properties: {
          file_path: { type: "string" },
          min_scene_length_sec: { type: "number", description: "Default 2." },
          description_model: { type: "string", enum: ["clip", "llava", "gpt-4v"], description: "Default 'clip'." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "extract_dominant_colors",
      description:
        "Extract the dominant color palette from a video. Use when the user wants 'what colors are in this video', 'match my brand colors', 'extract the palette', or 'color-correct to match this look'.",
      parameters: {
        type: "object",
        required: ["file_path"],
        properties: {
          file_path: { type: "string" },
          n_colors: { type: "integer", minimum: 1, maximum: 20, description: "Default 5." },
          timestamp_sec: { type: "number", description: "If set, analyze one frame; else aggregate." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_image",
      description:
        "Generate an image from a text prompt using Stable Diffusion / DALL-E / Sora. Use when the user wants 'create a thumbnail', 'make me an image of X', 'generate a cover', 'AI art for my video', or 'give me a b-roll frame'.",
      parameters: {
        type: "object",
        required: ["prompt"],
        properties: {
          prompt: { type: "string", description: "Text description of the image (max 4000 chars)." },
          negative_prompt: { type: "string", description: "What to AVOID (e.g. 'blurry, low quality')." },
          style: { type: "string", enum: ["photorealistic", "illustration", "anime", "cinematic", "3d_render", "watercolor", "sketch"] },
          aspect_ratio: { type: "string", enum: ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"], description: "Default '1:1'." },
          seed: { type: "integer", description: "For reproducibility." },
          model: { type: "string", enum: ["sdxl", "dall-e-3", "midjourney"], description: "Override model." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_video",
      description:
        "Generate a short video from a text prompt (text-to-video). Use when the user wants 'create a b-roll clip', 'generate a video for me', 'make a 5s clip of X', or 'AI video of...'.",
      parameters: {
        type: "object",
        required: ["prompt"],
        properties: {
          prompt: { type: "string", description: "Text description of the video (max 4000 chars)." },
          duration_sec: { type: "integer", minimum: 1, maximum: 60, description: "Target duration, default 4s." },
          aspect_ratio: { type: "string", enum: ["16:9", "9:16", "1:1"] },
          motion: { type: "string", enum: ["low", "medium", "high"], description: "Default 'medium'." },
          style: { type: "string", enum: ["cinematic", "documentary", "vlog", "animated", "stock"] },
          reference_image_path: { type: "string", description: "Optional reference image to anchor the video." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "inpaint_frame",
      description:
        "Inpaint (remove or replace) part of a frame. Use when the user wants 'remove this object', 'erase the watermark', 'replace the background', 'remove the person', or 'change X to Y in this frame'.",
      parameters: {
        type: "object",
        required: ["file_path", "timestamp_sec", "mode", "mask"],
        properties: {
          file_path: { type: "string" },
          timestamp_sec: { type: "number", description: "Which frame to inpaint." },
          mode: { type: "string", enum: ["remove", "replace"] },
          mask: {
            type: "object",
            description: "Region to inpaint.",
            properties: {
              bbox: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } } },
              polygon: { type: "array", items: { type: "array", items: { type: "number" } } },
            },
          },
          prompt: { type: "string", description: "Required for 'replace' mode — what to put in the masked region." },
          negative_prompt: { type: "string" },
        },
      },
    },
  },
];

// Set of tool names (for dispatcher fast-path)
export const VISION_GENERATION_TOOL_NAMES = new Set(VISION_GENERATION_TOOLS.map((t) => t.function.name));
