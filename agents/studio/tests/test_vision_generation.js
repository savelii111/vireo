// test_vision_generation.js — Tests for the 7 vision + generation tools.
//
// 4 vision tools: describe_frame, detect_objects, detect_scenes,
// extract_dominant_colors.
//
// 3 generation tools: generate_image, generate_video, inpaint_frame.
//
// All return {ok, job_id|description|...} and route through the
// dispatcher. The actual neural network calls are stubbed in dev —
// the tests verify validation, shape, and job_id generation.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VISION_GENERATION_TOOLS,
  VISION_GENERATION_TOOL_NAMES,
  describeFrame,
  detectObjects,
  detectScenes,
  extractDominantColors,
  generateImage,
  generateVideo,
  inpaintFrame,
} from "../src/vision_generation_tools.js";

// ---------- Tool shape ----------

test("Vision/Gen: 7 tools exported with valid OpenAI shape", () => {
  assert.equal(VISION_GENERATION_TOOLS.length, 7);
  for (const t of VISION_GENERATION_TOOLS) {
    assert.equal(t.type, "function");
    assert.ok(t.function.name);
    assert.ok(t.function.description.length > 50);
    assert.ok(t.function.parameters);
    assert.equal(t.function.parameters.type, "object");
  }
  const names = VISION_GENERATION_TOOLS.map((t) => t.function.name).sort();
  assert.deepEqual(names, [
    "describe_frame",
    "detect_objects",
    "detect_scenes",
    "extract_dominant_colors",
    "generate_image",
    "generate_video",
    "inpaint_frame",
  ]);
});

test("Vision/Gen: VISION_GENERATION_TOOL_NAMES set has 7 names", () => {
  assert.equal(VISION_GENERATION_TOOL_NAMES.size, 7);
});

// ---------- describe_frame ----------

test("describeFrame: returns description for valid input", async () => {
  const r = await describeFrame({ file_path: "/tmp/x.mp4", timestamp_sec: 5 });
  assert.equal(r.ok, true);
  assert.ok(r.description);
  assert.ok(r.model);
  assert.equal(r.timestamp_sec, 5);
});

test("describeFrame: missing file_path returns error", async () => {
  const r = await describeFrame({ file_path: "" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "file_path_required");
});

test("describeFrame: negative timestamp returns error", async () => {
  const r = await describeFrame({ file_path: "/tmp/x.mp4", timestamp_sec: -1 });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_timestamp");
});

// ---------- detect_objects ----------

test("detectObjects: returns empty objects array and model", async () => {
  const r = await detectObjects({ file_path: "/tmp/x.mp4" });
  assert.equal(r.ok, true);
  assert.ok(Array.isArray(r.objects));
  assert.ok(r.model);
});

test("detectObjects: confidence_threshold out of range returns error", async () => {
  const r = await detectObjects({ file_path: "/tmp/x.mp4", confidence_threshold: 1.5 });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_threshold");
});

test("detectObjects: custom classes are stored", async () => {
  const r = await detectObjects({ file_path: "/tmp/x.mp4", classes: ["person", "car"] });
  assert.deepEqual(r.classes_searched, ["person", "car"]);
});

// ---------- detect_scenes ----------

test("detectScenes: returns empty scenes array", async () => {
  const r = await detectScenes({ file_path: "/tmp/x.mp4" });
  assert.equal(r.ok, true);
  assert.ok(Array.isArray(r.scenes));
  assert.equal(r.min_scene_length_sec, 2);
});

test("detectScenes: custom min_scene_length is stored", async () => {
  const r = await detectScenes({ file_path: "/tmp/x.mp4", min_scene_length_sec: 5 });
  assert.equal(r.min_scene_length_sec, 5);
});

// ---------- extract_dominant_colors ----------

test("extractDominantColors: returns palette + n_colors", async () => {
  const r = await extractDominantColors({ file_path: "/tmp/x.mp4", n_colors: 8 });
  assert.equal(r.ok, true);
  assert.ok(Array.isArray(r.palette));
  assert.equal(r.n_colors, 8);
});

test("extractDominantColors: n_colors out of range returns error", async () => {
  const r1 = await extractDominantColors({ file_path: "/tmp/x.mp4", n_colors: 0 });
  assert.equal(r1.ok, false);
  const r2 = await extractDominantColors({ file_path: "/tmp/x.mp4", n_colors: 21 });
  assert.equal(r2.ok, false);
});

// ---------- generate_image ----------

test("generateImage: returns job_id and model", async () => {
  const r = await generateImage({ prompt: "A sunset over the ocean, photorealistic" });
  assert.equal(r.ok, true);
  assert.ok(r.job_id.startsWith("genimg-"));
  assert.ok(r.model);
  assert.ok(typeof r.seed === "number");
});

test("generateImage: empty prompt returns error", async () => {
  const r = await generateImage({ prompt: "" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "prompt_required");
});

test("generateImage: prompt > 4000 chars returns error", async () => {
  const r = await generateImage({ prompt: "x".repeat(4001) });
  assert.equal(r.ok, false);
  assert.equal(r.error, "prompt_too_long");
});

test("generateImage: invalid aspect_ratio returns error", async () => {
  const r = await generateImage({ prompt: "x", aspect_ratio: "2:3" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_aspect_ratio");
});

test("generateImage: valid aspect_ratios accepted", async () => {
  for (const ar of ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"]) {
    const r = await generateImage({ prompt: "x", aspect_ratio: ar });
    assert.equal(r.ok, true, `aspect_ratio ${ar} should be valid`);
    assert.equal(r.aspect_ratio, ar);
  }
});

test("generateImage: custom seed is preserved", async () => {
  const r = await generateImage({ prompt: "x", seed: 12345 });
  assert.equal(r.ok, true);
  assert.equal(r.seed, 12345);
});

// ---------- generate_video ----------

test("generateVideo: returns job_id", async () => {
  const r = await generateVideo({ prompt: "A drone shot of a mountain at sunrise" });
  assert.equal(r.ok, true);
  assert.ok(r.job_id.startsWith("genvid-"));
  assert.equal(r.duration_sec, 4);
});

test("generateVideo: empty prompt returns error", async () => {
  const r = await generateVideo({ prompt: "" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "prompt_required");
});

test("generateVideo: duration < 1 or > 60 returns error", async () => {
  const r1 = await generateVideo({ prompt: "x", duration_sec: 0 });
  assert.equal(r1.ok, false);
  const r2 = await generateVideo({ prompt: "x", duration_sec: 61 });
  assert.equal(r2.ok, false);
});

test("generateVideo: reference_image_path is stored", async () => {
  const r = await generateVideo({ prompt: "x", reference_image_path: "/ref.jpg" });
  assert.equal(r.ok, true);
  assert.equal(r.reference_image_path, "/ref.jpg");
});

// ---------- inpaint_frame ----------

test("inpaintFrame: remove mode with bbox mask works", async () => {
  const r = await inpaintFrame({ file_path: "/tmp/x.mp4", timestamp_sec: 10, mode: "remove", mask: { bbox: { x: 100, y: 100, w: 200, h: 200 } } });
  assert.equal(r.ok, true);
  assert.ok(r.job_id.startsWith("inpaint-"));
});

test("inpaintFrame: replace mode with prompt works", async () => {
  const r = await inpaintFrame({ file_path: "/tmp/x.mp4", timestamp_sec: 5, mode: "replace", mask: { bbox: { x: 0, y: 0, w: 100, h: 100 } }, prompt: "blue sky" });
  assert.equal(r.ok, true);
});

test("inpaintFrame: replace mode without prompt returns error", async () => {
  const r = await inpaintFrame({ file_path: "/tmp/x.mp4", timestamp_sec: 5, mode: "replace", mask: { bbox: { x: 0, y: 0, w: 100, h: 100 } } });
  assert.equal(r.ok, false);
  assert.equal(r.error, "prompt_required_for_replace");
});

test("inpaintFrame: invalid mode returns error", async () => {
  const r = await inpaintFrame({ file_path: "/tmp/x.mp4", timestamp_sec: 5, mode: "fill", mask: { bbox: { x: 0, y: 0, w: 100, h: 100 } } });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_mode");
});

test("inpaintFrame: missing mask returns error", async () => {
  const r = await inpaintFrame({ file_path: "/tmp/x.mp4", timestamp_sec: 5, mode: "remove" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "mask_required");
});

test("inpaintFrame: mask without bbox or polygon returns error", async () => {
  const r = await inpaintFrame({ file_path: "/tmp/x.mp4", timestamp_sec: 5, mode: "remove", mask: { foo: "bar" } });
  assert.equal(r.ok, false);
  assert.equal(r.error, "mask_required");
});

test("inpaintFrame: polygon mask works", async () => {
  const r = await inpaintFrame({ file_path: "/tmp/x.mp4", timestamp_sec: 5, mode: "remove", mask: { polygon: [[0, 0], [100, 0], [100, 100], [0, 100]] } });
  assert.equal(r.ok, true);
});
