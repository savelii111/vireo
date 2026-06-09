// test_ai_video_gen.js — Tests for the 10 AI Video Generation tools.
//
//   1.  generateVideo          — text → short video
//   2.  imageToVideo           — animate static image
//   3.  videoToVideo           — style transfer for video
//   4.  extendVideo            — extend video duration
//   5.  frameInterpolate       — optical flow interpolation
//   6.  slowMotion             — AI slow motion
//   7.  objectRemoval          — remove objects from video
//   8.  backgroundReplacement  — replace video background
//   9.  faceAnimation          — lip sync face from image + audio
//  10.  styleTransferVideo     — transfer style from image to video
//
// All return {ok, ...} and use the same job pattern as other tools.
// NOTE: When the neural_executor is available, tools return the executor
// job shape {ok, job_id, job, message} instead of the stub flat shape.
// Tests handle both paths.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AI_VIDEO_GEN_TOOLS,
  AI_VIDEO_GEN_TOOL_NAMES,
  generateVideo,
  imageToVideo,
  videoToVideo,
  extendVideo,
  frameInterpolate,
  slowMotion,
  objectRemoval,
  backgroundReplacement,
  faceAnimation,
  styleTransferVideo,
} from "../src/ai_video_gen.js";

// Helper: detect if response came from executor (has .job) or stub (flat fields)
const isExecutor = (r) => !!r.job;

// ---------- Tool shape ----------

test("AIVideoGen: 10 tools exported with valid OpenAI shape", () => {
  assert.equal(AI_VIDEO_GEN_TOOLS.length, 10);
  for (const t of AI_VIDEO_GEN_TOOLS) {
    assert.equal(t.type, "function");
    assert.ok(t.function.name);
    assert.ok(t.function.description.length > 50);
    assert.equal(t.function.parameters.type, "object");
  }
  const names = AI_VIDEO_GEN_TOOLS.map((t) => t.function.name).sort();
  assert.deepEqual(names, [
    "background_replacement",
    "extend_video",
    "face_animation",
    "frame_interpolate",
    "generate_video",
    "image_to_video",
    "object_removal",
    "slow_motion",
    "style_transfer_video",
    "video_to_video",
  ]);
});

test("AIVideoGen: AI_VIDEO_GEN_TOOL_NAMES set has 10 names", () => {
  assert.equal(AI_VIDEO_GEN_TOOL_NAMES.size, 10);
  assert.ok(AI_VIDEO_GEN_TOOL_NAMES.has("generate_video"));
  assert.ok(AI_VIDEO_GEN_TOOL_NAMES.has("face_animation"));
});

// ====================================================================
// 1. generateVideo
// ====================================================================

test("generateVideo: returns valid job for basic prompt", async () => {
  const r = await generateVideo({ prompt: "A cat walking on a beach at sunset" });
  assert.equal(r.ok, true);
  assert.ok(r.job_id.startsWith("vidgen-"));
  if (isExecutor(r)) {
    assert.equal(r.job.kind, "generate_video");
    assert.equal(r.job.duration_sec, 4);
  } else {
    assert.equal(r.duration_sec, 4);
    assert.equal(r.aspect_ratio, "16:9");
    assert.ok(r.model);
    assert.ok(typeof r.seed === "number");
  }
});

test("generateVideo: respects custom duration and aspect ratio", async () => {
  const r = await generateVideo({ prompt: "Mountain timelapse", duration_sec: 15, aspect_ratio: "9:16" });
  assert.equal(r.ok, true);
  if (isExecutor(r)) {
    assert.equal(r.job.duration_sec, 15);
    assert.equal(r.job.aspect_ratio, "9:16");
  } else {
    assert.equal(r.duration_sec, 15);
    assert.equal(r.aspect_ratio, "9:16");
  }
});

test("generateVideo: missing prompt returns error", async () => {
  const r = await generateVideo({});
  assert.equal(r.ok, false);
  assert.equal(r.error, "prompt_required");
});

test("generateVideo: empty prompt returns error", async () => {
  const r = await generateVideo({ prompt: "  " });
  assert.equal(r.ok, false);
  assert.equal(r.error, "prompt_required");
});

test("generateVideo: prompt too long returns error", async () => {
  const r = await generateVideo({ prompt: "x".repeat(4001) });
  assert.equal(r.ok, false);
  assert.equal(r.error, "prompt_too_long");
});

test("generateVideo: invalid duration returns error", async () => {
  const r = await generateVideo({ prompt: "test", duration_sec: 0 });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_duration");
});

test("generateVideo: duration > 60 returns error", async () => {
  const r = await generateVideo({ prompt: "test", duration_sec: 61 });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_duration");
});

test("generateVideo: invalid aspect ratio returns error", async () => {
  const r = await generateVideo({ prompt: "test", aspect_ratio: "5:2" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_aspect_ratio");
});

test("generateVideo: resolution matches aspect ratio (stub mode)", async () => {
  const r169 = await generateVideo({ prompt: "test", aspect_ratio: "16:9" });
  if (!isExecutor(r169)) assert.equal(r169.resolution, "1920x1080");

  const r916 = await generateVideo({ prompt: "test", aspect_ratio: "9:16" });
  if (!isExecutor(r916)) assert.equal(r916.resolution, "1080x1920");

  const r11 = await generateVideo({ prompt: "test", aspect_ratio: "1:1" });
  if (!isExecutor(r11)) assert.equal(r11.resolution, "1080x1080");
});

test("generateVideo: uses custom seed when provided", async () => {
  const r = await generateVideo({ prompt: "test", seed: 42 });
  if (isExecutor(r)) {
    assert.equal(r.job.seed, 42);
  } else {
    assert.equal(r.seed, 42);
  }
});

// ====================================================================
// 2. imageToVideo
// ====================================================================

test("imageToVideo: returns valid job with defaults", async () => {
  const r = await imageToVideo({ image: "/tmp/photo.jpg" });
  assert.equal(r.ok, true);
  assert.ok(r.job_id.startsWith("img2vid-"));
  if (isExecutor(r)) {
    assert.equal(r.job.motion, "medium");
  } else {
    assert.equal(r.motion, "medium");
    assert.equal(r.duration_sec, 4);
    assert.equal(r.source_image, "/tmp/photo.jpg");
  }
});

test("imageToVideo: respects custom motion level", async () => {
  const rLow = await imageToVideo({ image: "/tmp/photo.jpg", motion: "low" });
  if (isExecutor(rLow)) {
    assert.equal(rLow.job.motion, "low");
  } else {
    assert.equal(rLow.motion, "low");
    assert.equal(rLow.duration_sec, 2);
  }

  const rHigh = await imageToVideo({ image: "/tmp/photo.jpg", motion: "high" });
  if (isExecutor(rHigh)) {
    assert.equal(rHigh.job.motion, "high");
  } else {
    assert.equal(rHigh.motion, "high");
    assert.equal(rHigh.duration_sec, 6);
  }
});

test("imageToVideo: missing image returns error", async () => {
  const r = await imageToVideo({});
  assert.equal(r.ok, false);
  assert.equal(r.error, "image_required");
});

test("imageToVideo: invalid motion returns error", async () => {
  const r = await imageToVideo({ image: "/tmp/photo.jpg", motion: "extreme" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_motion");
});

test("imageToVideo: includes optional prompt", async () => {
  const r = await imageToVideo({ image: "/tmp/photo.jpg", prompt: "gentle wind blowing" });
  assert.equal(r.ok, true);
  if (isExecutor(r)) {
    assert.equal(r.job.prompt, "gentle wind blowing");
  } else {
    assert.equal(r.prompt, "gentle wind blowing");
  }
});

// ====================================================================
// 3. videoToVideo
// ====================================================================

test("videoToVideo: returns valid job with default strength", async () => {
  const r = await videoToVideo({ video: "/tmp/clip.mp4", prompt: "oil painting style" });
  assert.equal(r.ok, true);
  assert.ok(r.job_id.startsWith("vid2vid-"));
  if (isExecutor(r)) {
    assert.equal(r.job.strength, 0.7);
  } else {
    assert.equal(r.strength, 0.7);
    assert.equal(r.style_applied, "oil painting style");
    assert.ok(Array.isArray(r.transformations));
  }
});

test("videoToVideo: respects custom strength", async () => {
  const r = await videoToVideo({ video: "/tmp/clip.mp4", prompt: "cyberpunk", strength: 1.0 });
  if (isExecutor(r)) {
    assert.equal(r.job.strength, 1.0);
  } else {
    assert.equal(r.strength, 1.0);
  }
});

test("videoToVideo: missing video returns error", async () => {
  const r = await videoToVideo({ prompt: "test" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "video_required");
});

test("videoToVideo: missing prompt returns error", async () => {
  const r = await videoToVideo({ video: "/tmp/clip.mp4" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "prompt_required");
});

test("videoToVideo: invalid strength returns error", async () => {
  const r = await videoToVideo({ video: "/tmp/clip.mp4", prompt: "test", strength: 1.5 });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_strength");
});

test("videoToVideo: strength = 0 is valid", async () => {
  const r = await videoToVideo({ video: "/tmp/clip.mp4", prompt: "test", strength: 0 });
  assert.equal(r.ok, true);
  if (isExecutor(r)) {
    assert.equal(r.job.strength, 0);
  } else {
    assert.equal(r.strength, 0);
  }
});

// ====================================================================
// 4. extendVideo
// ====================================================================

test("extendVideo: returns valid job with forward direction", async () => {
  const r = await extendVideo({ video: "/tmp/clip.mp4", duration_sec: 5 });
  assert.equal(r.ok, true);
  assert.ok(r.job_id.startsWith("extend-"));
  // Executor stores direction in the job object; stub stores at top level
  const dir = r.job?.direction ?? r.direction;
  const durAdded = r.job?.duration_sec ?? r.duration_added;
  assert.ok(dir !== undefined, "direction should be present");
  assert.equal(dir, "forward");
  if (!isExecutor(r)) {
    assert.equal(durAdded, 5);
    assert.equal(r.new_duration, 15);
  }
});

test("extendVideo: backward direction works", async () => {
  const r = await extendVideo({ video: "/tmp/clip.mp4", duration_sec: 3, direction: "backward" });
  assert.equal(r.ok, true);
  const dir = r.job?.direction ?? r.direction;
  assert.equal(dir, "backward");
  if (!isExecutor(r)) {
    assert.equal(r.duration_added, 3);
    assert.equal(r.extension_method, "backward");
  }
});

test("extendVideo: both directions doubles the addition", async () => {
  const r = await extendVideo({ video: "/tmp/clip.mp4", duration_sec: 5, direction: "both" });
  assert.equal(r.ok, true);
  if (isExecutor(r)) {
    assert.equal(r.job.direction, "both");
  } else {
    assert.equal(r.duration_added, 10);
    assert.equal(r.new_duration, 20);
    assert.equal(r.extension_method, "bidirectional");
  }
});

test("extendVideo: missing video returns error", async () => {
  const r = await extendVideo({ duration_sec: 5 });
  assert.equal(r.ok, false);
  assert.equal(r.error, "video_required");
});

test("extendVideo: invalid duration returns error", async () => {
  const r = await extendVideo({ video: "/tmp/clip.mp4", duration_sec: 0 });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_duration");
});

test("extendVideo: duration > 30 returns error", async () => {
  const r = await extendVideo({ video: "/tmp/clip.mp4", duration_sec: 31 });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_duration");
});

test("extendVideo: invalid direction returns error", async () => {
  const r = await extendVideo({ video: "/tmp/clip.mp4", duration_sec: 5, direction: "sideways" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_direction");
});

// ====================================================================
// 5. frameInterpolate
// ====================================================================

test("frameInterpolate: returns valid job with default 60fps", async () => {
  const r = await frameInterpolate({ video: "/tmp/clip.mp4" });
  assert.equal(r.ok, true);
  assert.ok(r.job_id.startsWith("interp-"));
  if (isExecutor(r)) {
    assert.equal(r.job.target_fps, 60);
  } else {
    assert.equal(r.original_fps, 30);
    assert.equal(r.new_fps, 60);
    assert.ok(r.frames_added > 0);
  }
});

test("frameInterpolate: respects custom target fps", async () => {
  const r = await frameInterpolate({ video: "/tmp/clip.mp4", target_fps: 120 });
  assert.equal(r.ok, true);
  if (isExecutor(r)) {
    assert.equal(r.job.target_fps, 120);
  } else {
    assert.equal(r.new_fps, 120);
    assert.ok(r.frames_added > 0);
  }
});

test("frameInterpolate: missing video returns error", async () => {
  const r = await frameInterpolate({});
  assert.equal(r.ok, false);
  assert.equal(r.error, "video_required");
});

test("frameInterpolate: fps < 24 returns error", async () => {
  const r = await frameInterpolate({ video: "/tmp/clip.mp4", target_fps: 20 });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_fps");
});

test("frameInterpolate: fps > 240 returns error", async () => {
  const r = await frameInterpolate({ video: "/tmp/clip.mp4", target_fps: 300 });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_fps");
});

// ====================================================================
// 6. slowMotion
// ====================================================================

test("slowMotion: returns valid job with 2x factor", async () => {
  const r = await slowMotion({ video: "/tmp/clip.mp4" });
  assert.equal(r.ok, true);
  assert.ok(r.job_id.startsWith("slowmo-"));
  if (isExecutor(r)) {
    assert.equal(r.job.factor, 2);
  } else {
    assert.equal(r.factor, 2);
    assert.equal(r.original_duration, 10);
    assert.equal(r.new_duration, 20);
  }
});

test("slowMotion: 8x factor doubles length correctly", async () => {
  const r = await slowMotion({ video: "/tmp/clip.mp4", factor: 8 });
  assert.equal(r.ok, true);
  if (isExecutor(r)) {
    assert.equal(r.job.factor, 8);
  } else {
    assert.equal(r.new_duration, 80);
  }
});

test("slowMotion: missing video returns error", async () => {
  const r = await slowMotion({});
  assert.equal(r.ok, false);
  assert.equal(r.error, "video_required");
});

test("slowMotion: invalid factor returns error", async () => {
  const r = await slowMotion({ video: "/tmp/clip.mp4", factor: 3 });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_factor");
});

test("slowMotion: factor 4 works", async () => {
  const r = await slowMotion({ video: "/tmp/clip.mp4", factor: 4 });
  assert.equal(r.ok, true);
  if (isExecutor(r)) {
    assert.equal(r.job.factor, 4);
  } else {
    assert.equal(r.factor, 4);
    assert.equal(r.new_duration, 40);
  }
});

// ====================================================================
// 7. objectRemoval
// ====================================================================

test("objectRemoval: returns valid job with bbox mask", async () => {
  const r = await objectRemoval({
    video: "/tmp/clip.mp4",
    object_mask: { bbox: { x: 100, y: 200, w: 150, h: 300 } },
  });
  assert.equal(r.ok, true);
  assert.ok(r.job_id.startsWith("objrem-"));
  if (isExecutor(r)) {
    assert.equal(r.job.kind, "object_removal");
  } else {
    assert.equal(r.objects_removed, 1);
    assert.ok(r.frames_processed > 0);
    assert.ok(r.quality_score > 0 && r.quality_score <= 1);
  }
});

test("objectRemoval: returns valid job with polygon mask", async () => {
  const r = await objectRemoval({
    video: "/tmp/clip.mp4",
    object_mask: { polygon: [[0, 0], [100, 0], [100, 100]] },
  });
  assert.equal(r.ok, true);
});

test("objectRemoval: missing video returns error", async () => {
  const r = await objectRemoval({ object_mask: { bbox: {} } });
  assert.equal(r.ok, false);
  assert.equal(r.error, "video_required");
});

test("objectRemoval: missing mask returns error", async () => {
  const r = await objectRemoval({ video: "/tmp/clip.mp4" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "mask_required");
});

test("objectRemoval: invalid mask (no bbox or polygon) returns error", async () => {
  const r = await objectRemoval({ video: "/tmp/clip.mp4", object_mask: { circle: {} } });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_mask");
});

// ====================================================================
// 8. backgroundReplacement
// ====================================================================

test("backgroundReplacement: returns valid job", async () => {
  const r = await backgroundReplacement({ video: "/tmp/clip.mp4", new_background: "/tmp/beach.jpg" });
  assert.equal(r.ok, true);
  assert.ok(r.job_id.startsWith("bgreplace-"));
  if (isExecutor(r)) {
    assert.equal(r.job.new_background, "/tmp/beach.jpg");
  } else {
    assert.equal(r.new_background, "/tmp/beach.jpg");
    assert.ok(r.mask_quality > 0 && r.mask_quality <= 1);
    assert.equal(r.segmentation_model, "sam2");
  }
});

test("backgroundReplacement: accepts text prompt as background", async () => {
  const r = await backgroundReplacement({ video: "/tmp/clip.mp4", new_background: "tropical beach at sunset" });
  assert.equal(r.ok, true);
  if (isExecutor(r)) {
    assert.equal(r.job.new_background, "tropical beach at sunset");
  } else {
    assert.equal(r.new_background, "tropical beach at sunset");
  }
});

test("backgroundReplacement: missing video returns error", async () => {
  const r = await backgroundReplacement({ new_background: "beach" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "video_required");
});

test("backgroundReplacement: missing background returns error", async () => {
  const r = await backgroundReplacement({ video: "/tmp/clip.mp4" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "new_background_required");
});

// ====================================================================
// 9. faceAnimation
// ====================================================================

test("faceAnimation: returns valid job with lip sync scores", async () => {
  const r = await faceAnimation({ image: "/tmp/face.jpg", audio: "/tmp/speech.wav" });
  assert.equal(r.ok, true);
  assert.ok(r.job_id.startsWith("faceanim-"));
  if (isExecutor(r)) {
    assert.equal(r.job.kind, "face_animation");
  } else {
    assert.ok(r.lip_sync_score > 0 && r.lip_sync_score <= 1);
    assert.ok(r.naturalness > 0 && r.naturalness <= 1);
    assert.ok(r.duration_sec > 0);
    assert.equal(r.model, "wav2lip-gan");
  }
});

test("faceAnimation: missing image returns error", async () => {
  const r = await faceAnimation({ audio: "/tmp/speech.wav" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "image_required");
});

test("faceAnimation: missing audio returns error", async () => {
  const r = await faceAnimation({ image: "/tmp/face.jpg" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "audio_required");
});

// ====================================================================
// 10. styleTransferVideo
// ====================================================================

test("styleTransferVideo: returns valid job", async () => {
  const r = await styleTransferVideo({ video: "/tmp/clip.mp4", style_image: "/tmp/impressionist.jpg" });
  assert.equal(r.ok, true);
  assert.ok(r.job_id.startsWith("stylevid-"));
  if (isExecutor(r)) {
    assert.equal(r.job.style_image, "/tmp/impressionist.jpg");
  } else {
    assert.equal(r.style_source, "/tmp/impressionist.jpg");
    assert.ok(r.style_strength > 0 && r.style_strength <= 1);
    assert.ok(r.consistency_score > 0 && r.consistency_score <= 1);
    assert.equal(r.model, "adain-video");
  }
});

test("styleTransferVideo: missing video returns error", async () => {
  const r = await styleTransferVideo({ style_image: "/tmp/style.jpg" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "video_required");
});

test("styleTransferVideo: missing style_image returns error", async () => {
  const r = await styleTransferVideo({ video: "/tmp/clip.mp4" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "style_image_required");
});

// ====================================================================
// Cross-cutting: all jobs have consistent shape
// ====================================================================

test("All 10 tools return ok=true with job_id on success", async () => {
  const results = await Promise.all([
    generateVideo({ prompt: "test" }),
    imageToVideo({ image: "/tmp/a.jpg" }),
    videoToVideo({ video: "/tmp/v.mp4", prompt: "style" }),
    extendVideo({ video: "/tmp/v.mp4", duration_sec: 3 }),
    frameInterpolate({ video: "/tmp/v.mp4" }),
    slowMotion({ video: "/tmp/v.mp4" }),
    objectRemoval({ video: "/tmp/v.mp4", object_mask: { bbox: { x: 0, y: 0, w: 10, h: 10 } } }),
    backgroundReplacement({ video: "/tmp/v.mp4", new_background: "beach" }),
    faceAnimation({ image: "/tmp/f.jpg", audio: "/tmp/a.wav" }),
    styleTransferVideo({ video: "/tmp/v.mp4", style_image: "/tmp/s.jpg" }),
  ]);
  for (const r of results) {
    assert.equal(r.ok, true, `Expected ok=true, got: ${JSON.stringify(r)}`);
    assert.ok(r.job_id, "Expected job_id to be set");
    assert.ok(r.job_id.length > 5, "job_id should be a meaningful string");
  }
});

test("All 10 tools return ok=false with error on missing required inputs", async () => {
  const results = await Promise.all([
    generateVideo({}),
    imageToVideo({}),
    videoToVideo({}),
    extendVideo({}),
    frameInterpolate({}),
    slowMotion({}),
    objectRemoval({}),
    backgroundReplacement({}),
    faceAnimation({}),
    styleTransferVideo({}),
  ]);
  for (const r of results) {
    assert.equal(r.ok, false, `Expected ok=false for missing inputs, got: ${JSON.stringify(r)}`);
    assert.ok(r.error, "Expected error string to be set");
  }
});

test("All 10 tools include either job (executor) or backend (stub) field", async () => {
  const results = await Promise.all([
    generateVideo({ prompt: "test" }),
    imageToVideo({ image: "/tmp/a.jpg" }),
    videoToVideo({ video: "/tmp/v.mp4", prompt: "s" }),
    extendVideo({ video: "/tmp/v.mp4", duration_sec: 3 }),
    frameInterpolate({ video: "/tmp/v.mp4" }),
    slowMotion({ video: "/tmp/v.mp4" }),
    objectRemoval({ video: "/tmp/v.mp4", object_mask: { bbox: {} } }),
    backgroundReplacement({ video: "/tmp/v.mp4", new_background: "b" }),
    faceAnimation({ image: "/tmp/f.jpg", audio: "/tmp/a.wav" }),
    styleTransferVideo({ video: "/tmp/v.mp4", style_image: "/tmp/s.jpg" }),
  ]);
  for (const r of results) {
    assert.equal(r.ok, true, `Expected ok=true, got: ${JSON.stringify(r)}`);
    // Executor returns {job_id, job, message}; stub returns {job_id, backend, ...}
    assert.ok(r.job || r.backend !== undefined, `Expected job or backend field, got: ${JSON.stringify(r)}`);
  }
});
