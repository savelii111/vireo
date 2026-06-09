// muapi_client.js — MuAPI HTTP client (2026-06-09).
//
// Unified gateway to 200+ AI video/image/music models (Sora,
// Runway, Flux, SDXL, Kling, VEO3, Midjourney, Suno, Higgsfield).
//
// Video generation on Vireo uses Higgsfield (higgsfield.ai) as the
// open-source backbone; images/audio route through MuAPI where needed.
//
// Auth: x-api-key header (NOT Authorization: Bearer). User sets
// the key in the chat UI (or it's configured per workspace).
//
// Endpoints used:
//   POST /api/v1/{model-id}        — submit a job
//   GET  /api/v1/predictions/{id}  — poll for results
//   GET  /app/get_file_upload_url  — get a pre-signed upload URL
//
// The client is OPTIONAL. If MUAPI_API_KEY is not set, all
// generation tools fall back to local Python (SDXL/SVD stub).
// This lets us develop and test without an account, then opt
// into MuAPI for production.

const MUAPI_BASE = process.env.MUAPI_BASE || "https://api.muapi.ai";

function getKey() {
  // Priority: env var > workspace config > empty
  return process.env.MUAPI_API_KEY || "";
}

export function isMuapiConfigured() {
  return getKey().length > 0;
}

async function apiFetch(path, opts = {}) {
  const key = getKey();
  if (!key) {
    throw new Error("MUAPI_API_KEY not set");
  }
  const url = `${MUAPI_BASE}${path}`;
  const headers = {
    "Content-Type": "application/json",
    "x-api-key": key,
    ...(opts.headers || {}),
  };
  const res = await fetch(url, { ...opts, headers });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`MuAPI ${res.status}: ${errText.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Submit a generation job. Returns the request_id (or full
 * result if the endpoint returns synchronously).
 *
 * @param {string} model - e.g. "flux-dev", "kling-v2.6-pro-t2v"
 * @param {object} payload - { prompt, aspect_ratio, ... }
 * @returns {Promise<{request_id: string}|object>}
 */
export async function submitJob(model, payload) {
  return apiFetch(`/api/v1/${model}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/**
 * Poll for a result. Returns when status is completed/succeeded
 * (or throws on failed/cancelled).
 *
 * @param {string} requestId
 * @param {object} [opts]
 * @param {number} [opts.maxAttempts=120] - default ~4 minutes at 2s/attempt
 * @param {number} [opts.intervalMs=2000]
 * @param {function} [opts.onProgress] - callback({attempt, status, eta_seconds})
 * @returns {Promise<{url?: string, urls?: string[], outputs?: any[], status: string}>}
 */
export async function pollForResult(requestId, opts = {}) {
  const maxAttempts = opts.maxAttempts || 120;
  const intervalMs = opts.intervalMs || 2000;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await apiFetch(`/api/v1/predictions/${requestId}/result`, {
      method: "GET",
    });
    const status = (res.status || "").toLowerCase();
    if (opts.onProgress) opts.onProgress({ attempt, status, eta_seconds: (maxAttempts - attempt) * (intervalMs / 1000) });
    if (status === "completed" || status === "succeeded" || status === "success") {
      // Normalize — MuAPI varies output structure
      const url = res.outputs?.[0] || res.url || res.output?.url || res.video_url || res.image_url;
      return { ...res, url };
    }
    if (status === "failed" || status === "cancelled" || status === "error") {
      throw new Error(`MuAPI job ${requestId} ${status}: ${res.error || ""}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`MuAPI job ${requestId} timed out after ${maxAttempts} attempts`);
}

/**
 * Get a pre-signed upload URL for a binary file (image/video).
 * Used to upload reference images to MuAPI for I2I/I2V jobs.
 */
export async function getUploadUrl() {
  return apiFetch(`/app/get_file_upload_url`, { method: "GET" });
}

/**
 * Submit + poll in one call. Returns the result URL(s).
 */
export async function generate(model, payload, opts = {}) {
  const submitted = await submitJob(model, payload);
  const requestId = submitted.request_id || submitted.id;
  if (!requestId) {
    // Some endpoints return the result directly
    return submitted;
  }
  return pollForResult(requestId, opts);
}

// ---------- High-level convenience wrappers ----------

/**
 * Generate an image via MuAPI. Returns the image URL.
 * Caller downloads it and stores it locally.
 */
export async function generateImageMuapi({ prompt, negative_prompt, aspect_ratio, model, seed, reference_image_url, style }) {
  const finalModel = model || "flux-dev";
  const payload = { prompt };
  if (negative_prompt) payload.negative_prompt = negative_prompt;
  if (aspect_ratio) payload.aspect_ratio = aspect_ratio;
  if (seed && seed !== -1) payload.seed = seed;
  if (reference_image_url) payload.image_url = reference_image_url;
  if (style) payload.style = style;
  return generate(finalModel, payload, { maxAttempts: 60, intervalMs: 3000 });
}

/**
 * Generate a video via MuAPI (Kling/Runway/VEO3). Returns the
 * video URL. Videos take longer — default 6 minute timeout.
 */
export async function generateVideoMuapi({ prompt, negative_prompt, duration_sec, aspect_ratio, model, motion, reference_image_url, style }) {
  const finalModel = model || "kling-v2.6-pro-t2v";
  const payload = { prompt };
  if (negative_prompt) payload.negative_prompt = negative_prompt;
  if (duration_sec) payload.duration = String(duration_sec);
  if (aspect_ratio) payload.aspect_ratio = aspect_ratio;
  if (motion) payload.motion = motion;
  if (style) payload.style = style;
  if (reference_image_url) payload.image_url = reference_image_url;
  return generate(finalModel, payload, { maxAttempts: 180, intervalMs: 3000 });
}

/**
 * Upscale an image via MuAPI.
 */
export async function upscaleImageMuapi({ image_url, scale = 2 }) {
  return generate("ai-image-upscaler", { image_url, scale: String(scale) }, { maxAttempts: 60, intervalMs: 2000 });
}

/**
 * Inpaint via MuAPI (uses flux-kontext or similar).
 */
export async function inpaintMuapi({ image_url, mask_url, prompt, mode = "replace" }) {
  return generate("flux-kontext-dev-i2i", { image_url, mask_url, prompt, mode }, { maxAttempts: 60, intervalMs: 2000 });
}

/**
 * Generate music via Suno.
 */
export async function generateMusicMuapi({ prompt, duration_sec, style, title }) {
  const payload = { prompt };
  if (duration_sec) payload.duration = String(duration_sec);
  if (style) payload.style = style;
  if (title) payload.title = title;
  return generate("suno-create-music", payload, { maxAttempts: 90, intervalMs: 3000 });
}
