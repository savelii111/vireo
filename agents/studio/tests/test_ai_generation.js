// test_ai_generation.js — Tests for the 10 AI Generation tools.
//
//   1.  generate_image          — text-to-image generation
//   2.  generate_image_to_image — image-to-image transformation
//   3.  inpaint_image           — replace masked area
//   4.  outpaint_image          — extend image in direction
//   5.  upscale_image           — Real-ESRGAN upscaling
//   6.  generate_background     — compositing background
//   7.  generate_thumbnail      — YouTube-style thumbnail
//   8.  generate_avatar         — avatar / profile picture
//   9.  generate_logo           — logo / brand mark
//   10. generate_pattern        — seamless tileable pattern
//
// All tests use the synchronous v1 API (no real neural backends needed).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  // Tool definitions
  AI_GENERATION_TOOLS,
  AI_GENERATION_TOOL_NAMES,
  GENERATE_IMAGE_TOOL,
  GENERATE_IMAGE_TO_IMAGE_TOOL,
  INPAINT_IMAGE_TOOL,
  OUTPAINT_IMAGE_TOOL,
  UPSCALE_IMAGE_TOOL,
  GENERATE_BACKGROUND_TOOL,
  GENERATE_THUMBNAIL_TOOL,
  GENERATE_AVATAR_TOOL,
  GENERATE_LOGO_TOOL,
  GENERATE_PATTERN_TOOL,
  // Implementation functions
  generateImage,
  generateImageToImage,
  inpaintImage,
  outpaintImage,
  upscaleImage,
  generateBackground,
  generateThumbnail,
  generateAvatar,
  generateLogo,
  generatePattern,
  // Dispatcher
  executeGeneration,
} from "../src/ai_generation.js";

// ====================================================================
// Tool shape tests
// ====================================================================

test("AI Generation: exports 10 tools with valid OpenAI function shape", () => {
  assert.equal(AI_GENERATION_TOOLS.length, 10);
  for (const t of AI_GENERATION_TOOLS) {
    assert.equal(t.type, "function");
    assert.ok(t.function.name, "tool must have a name");
    assert.ok(t.function.description.length > 30, "description too short");
    assert.equal(t.function.parameters.type, "object");
    assert.ok(Array.isArray(t.function.parameters.required) || t.function.parameters.properties, "must have params");
    assert.ok(t.function.parameters.properties, "must have properties");
  }
});

test("AI Generation: TOOL_NAMES set has 10 entries", () => {
  assert.equal(AI_GENERATION_TOOL_NAMES.size, 10);
});

test("AI Generation: all tool names are unique", () => {
  const names = AI_GENERATION_TOOLS.map((t) => t.function.name);
  assert.equal(new Set(names).size, names.length);
});

test("AI Generation: all 10 tool definitions are individually importable", () => {
  const defs = [
    GENERATE_IMAGE_TOOL,
    GENERATE_IMAGE_TO_IMAGE_TOOL,
    INPAINT_IMAGE_TOOL,
    OUTPAINT_IMAGE_TOOL,
    UPSCALE_IMAGE_TOOL,
    GENERATE_BACKGROUND_TOOL,
    GENERATE_THUMBNAIL_TOOL,
    GENERATE_AVATAR_TOOL,
    GENERATE_LOGO_TOOL,
    GENERATE_PATTERN_TOOL,
  ];
  assert.equal(defs.length, 10);
  for (const d of defs) {
    assert.equal(d.type, "function");
  }
});

// ====================================================================
// generateImage tests
// ====================================================================

test("generateImage: generates with default style and aspect ratio", () => {
  const r = generateImage({ prompt: "a sunset over mountains" });
  assert.equal(r.ok, true);
  assert.ok(r.url);
  assert.ok(typeof r.seed === "number");
  assert.equal(r.style, "photorealistic");
  assert.equal(r.aspect_ratio, "1:1");
  assert.ok(r.resolution);
  assert.equal(r.resolution.width, 1024);
  assert.equal(r.resolution.height, 1024);
  assert.ok(r.job_id);
});

test("generateImage: accepts all valid styles", () => {
  const styles = [
    "photorealistic", "illustration", "anime", "cinematic",
    "3d_render", "oil_painting", "watercolor", "pixel_art",
  ];
  for (const style of styles) {
    const r = generateImage({ prompt: "test prompt", style });
    assert.equal(r.ok, true, `${style} should succeed`);
    assert.equal(r.style, style);
  }
});

test("generateImage: accepts all valid aspect ratios with correct resolutions", () => {
  const ratios = [
    { ar: "1:1", w: 1024, h: 1024 },
    { ar: "16:9", w: 1344, h: 768 },
    { ar: "9:16", w: 768, h: 1344 },
    { ar: "4:3", w: 1152, h: 896 },
    { ar: "3:4", w: 896, h: 1152 },
    { ar: "21:9", w: 1536, h: 640 },
  ];
  for (const { ar, w, h } of ratios) {
    const r = generateImage({ prompt: "test", aspect_ratio: ar });
    assert.equal(r.ok, true, `${ar} should succeed`);
    assert.equal(r.resolution.width, w);
    assert.equal(r.resolution.height, h);
  }
});

test("generateImage: rejects missing prompt", () => {
  const r = generateImage({});
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("prompt"));
});

test("generateImage: rejects empty prompt", () => {
  const r = generateImage({ prompt: "   " });
  assert.equal(r.ok, false);
});

test("generateImage: rejects invalid style", () => {
  const r = generateImage({ prompt: "test", style: "neon_punk" });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("Invalid style"));
});

test("generateImage: rejects invalid aspect ratio", () => {
  const r = generateImage({ prompt: "test", aspect_ratio: "5:5" });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("Invalid aspect_ratio"));
});

// ====================================================================
// generateImageToImage tests
// ====================================================================

test("generateImageToImage: transforms with default strength", () => {
  const r = generateImageToImage({ source_image: "photo.jpg", prompt: "make it a painting" });
  assert.equal(r.ok, true);
  assert.ok(r.url);
  assert.ok(r.source_hash);
  assert.equal(r.strength, 0.75);
  assert.ok(r.transformations);
  assert.ok(typeof r.transformations.denoising_strength === "number");
  assert.ok(typeof r.transformations.guidance_scale === "number");
  assert.ok(typeof r.transformations.steps === "number");
});

test("generateImageToImage: accepts custom strength", () => {
  const r = generateImageToImage({
    source_image: "photo.jpg",
    prompt: "add rain",
    strength: 0.3,
  });
  assert.equal(r.ok, true);
  assert.equal(r.strength, 0.3);
  assert.equal(r.transformations.preserve_structure, true);
});

test("generateImageToImage: high strength disables structure preservation", () => {
  const r = generateImageToImage({
    source_image: "photo.jpg",
    prompt: "transform completely",
    strength: 0.9,
  });
  assert.equal(r.ok, true);
  assert.equal(r.transformations.preserve_structure, false);
});

test("generateImageToImage: rejects missing source_image", () => {
  const r = generateImageToImage({ prompt: "test" });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("source_image"));
});

test("generateImageToImage: rejects missing prompt", () => {
  const r = generateImageToImage({ source_image: "photo.jpg" });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("prompt"));
});

test("generateImageToImage: rejects strength out of range", () => {
  const r = generateImageToImage({
    source_image: "photo.jpg",
    prompt: "test",
    strength: 1.5,
  });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("strength"));
});

// ====================================================================
// inpaintImage tests
// ====================================================================

test("inpaintImage: inpaints with bbox mask", () => {
  const r = inpaintImage({
    image: "scene.png",
    mask: { bbox: { x: 100, y: 100, w: 200, h: 150 } },
    prompt: "fill with flowers",
  });
  assert.equal(r.ok, true);
  assert.ok(r.url);
  assert.equal(r.inpainted_area, 200 * 150);
  assert.equal(r.prompt_used, "fill with flowers");
  assert.ok(r.job_id);
});

test("inpaintImage: inpaints with polygon mask", () => {
  const r = inpaintImage({
    image: "scene.png",
    mask: { polygon: [[0, 0], [100, 0], [100, 100], [0, 100]] },
    prompt: "blue sky",
  });
  assert.equal(r.ok, true);
  assert.equal(r.inpainted_area, 10000);
});

test("inpaintImage: rejects missing image", () => {
  const r = inpaintImage({ mask: { bbox: { x: 0, y: 0, w: 10, h: 10 } }, prompt: "test" });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("image"));
});

test("inpaintImage: rejects missing mask", () => {
  const r = inpaintImage({ image: "scene.png", prompt: "test" });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("mask"));
});

test("inpaintImage: rejects mask without bbox or polygon", () => {
  const r = inpaintImage({
    image: "scene.png",
    mask: { coordinates: [1, 2, 3] },
    prompt: "test",
  });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("bbox"));
});

test("inpaintImage: rejects polygon with fewer than 3 points", () => {
  const r = inpaintImage({
    image: "scene.png",
    mask: { polygon: [[0, 0], [100, 0]] },
    prompt: "test",
  });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("3 points"));
});

test("inpaintImage: rejects missing prompt", () => {
  const r = inpaintImage({
    image: "scene.png",
    mask: { bbox: { x: 0, y: 0, w: 10, h: 10 } },
  });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("prompt"));
});

// ====================================================================
// outpaintImage tests
// ====================================================================

test("outpaintImage: extends image to the right", () => {
  const r = outpaintImage({ image: "photo.jpg", direction: "right" });
  assert.equal(r.ok, true);
  assert.ok(r.url);
  assert.equal(r.extended_direction, "right");
  assert.ok(r.new_dimensions.width > r.original_dimensions.width);
  assert.equal(r.new_dimensions.height, r.original_dimensions.height);
});

test("outpaintImage: extends image to the left", () => {
  const r = outpaintImage({ image: "photo.jpg", direction: "left" });
  assert.equal(r.ok, true);
  assert.equal(r.extended_direction, "left");
  assert.ok(r.new_dimensions.width > 1024);
});

test("outpaintImage: extends image downward", () => {
  const r = outpaintImage({ image: "photo.jpg", direction: "down" });
  assert.equal(r.ok, true);
  assert.equal(r.extended_direction, "down");
  assert.ok(r.new_dimensions.height > r.original_dimensions.height);
  assert.equal(r.new_dimensions.width, r.original_dimensions.width);
});

test("outpaintImage: extends image upward", () => {
  const r = outpaintImage({ image: "photo.jpg", direction: "up" });
  assert.equal(r.ok, true);
  assert.equal(r.extended_direction, "up");
  assert.ok(r.new_dimensions.height > 768);
});

test("outpaintImage: accepts optional prompt", () => {
  const r = outpaintImage({
    image: "photo.jpg",
    direction: "right",
    prompt: "continue the landscape",
  });
  assert.equal(r.ok, true);
});

test("outpaintImage: rejects missing image", () => {
  const r = outpaintImage({ direction: "right" });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("image"));
});

test("outpaintImage: rejects invalid direction", () => {
  const r = outpaintImage({ image: "photo.jpg", direction: "diagonal" });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("Invalid direction"));
});

// ====================================================================
// upscaleImage tests
// ====================================================================

test("upscaleImage: upscales to 4x by default", () => {
  const r = upscaleImage({ image: "small.png" });
  assert.equal(r.ok, true);
  assert.ok(r.url);
  assert.equal(r.scale, 4);
  assert.deepEqual(r.original_size, { width: 512, height: 512 });
  assert.deepEqual(r.new_size, { width: 2048, height: 2048 });
  assert.equal(r.model, "realesrgan-x4plus");
});

test("upscaleImage: accepts 2x scale", () => {
  const r = upscaleImage({ image: "small.png", scale: 2 });
  assert.equal(r.ok, true);
  assert.equal(r.scale, 2);
  assert.deepEqual(r.new_size, { width: 1024, height: 1024 });
});

test("upscaleImage: accepts 8x scale", () => {
  const r = upscaleImage({ image: "small.png", scale: 8 });
  assert.equal(r.ok, true);
  assert.equal(r.scale, 8);
  assert.deepEqual(r.new_size, { width: 4096, height: 4096 });
});

test("upscaleImage: rejects invalid scale", () => {
  const r = upscaleImage({ image: "small.png", scale: 3 });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("Invalid scale"));
});

test("upscaleImage: rejects missing image", () => {
  const r = upscaleImage({});
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("image"));
});

// ====================================================================
// generateBackground tests
// ====================================================================

test("generateBackground: generates with default gradient style", () => {
  const r = generateBackground({ prompt: "sunset sky" });
  assert.equal(r.ok, true);
  assert.ok(r.url);
  assert.equal(r.style, "gradient");
  assert.deepEqual(r.resolution, { width: 1920, height: 1080 });
  assert.equal(r.prompt, "sunset sky");
});

test("generateBackground: accepts all valid styles", () => {
  const styles = ["gradient", "bokeh", "studio", "nature", "abstract", "solid", "textured", "minimal"];
  for (const style of styles) {
    const r = generateBackground({ prompt: "test bg", style });
    assert.equal(r.ok, true, `${style} should succeed`);
    assert.equal(r.style, style);
  }
});

test("generateBackground: rejects missing prompt", () => {
  const r = generateBackground({});
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("prompt"));
});

test("generateBackground: rejects invalid style", () => {
  const r = generateBackground({ prompt: "test", style: "psychedelic" });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("Invalid style"));
});

// ====================================================================
// generateThumbnail tests
// ====================================================================

test("generateThumbnail: generates with default gaming style", () => {
  const r = generateThumbnail({ video_frame: "frame001.png", text: "EPIC MOMENT!" });
  assert.equal(r.ok, true);
  assert.ok(r.url);
  assert.equal(r.style, "gaming");
  assert.ok(r.text_overlay);
  assert.equal(r.text_overlay.text, "EPIC MOMENT!");
  assert.equal(r.text_overlay.shadow, true);
  assert.ok(r.face_highlight);
  assert.deepEqual(r.resolution, { width: 1280, height: 720 });
});

test("generateThumbnail: accepts all valid styles", () => {
  const styles = ["gaming", "vlog", "tutorial", "reaction", "news"];
  for (const style of styles) {
    const r = generateThumbnail({ video_frame: "f.png", text: "Title", style });
    assert.equal(r.ok, true, `${style} should succeed`);
    assert.equal(r.style, style);
  }
});

test("generateThumbnail: news style uses smaller font", () => {
  const r = generateThumbnail({ video_frame: "f.png", text: "Breaking", style: "news" });
  assert.equal(r.text_overlay.font_size, 48);
});

test("generateThumbnail: gaming style uses bottom-right position", () => {
  const r = generateThumbnail({ video_frame: "f.png", text: "GG", style: "gaming" });
  assert.equal(r.text_overlay.position, "bottom-right");
});

test("generateThumbnail: rejects missing video_frame", () => {
  const r = generateThumbnail({ text: "test" });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("video_frame"));
});

test("generateThumbnail: rejects missing text", () => {
  const r = generateThumbnail({ video_frame: "f.png" });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("text"));
});

// ====================================================================
// generateAvatar tests
// ====================================================================

test("generateAvatar: generates with default realistic style", () => {
  const r = generateAvatar({ prompt: "a friendly robot" });
  assert.equal(r.ok, true);
  assert.ok(r.url);
  assert.equal(r.style, "realistic");
  assert.equal(r.resolution.width, 1024);
  assert.equal(r.resolution.height, 1024);
  assert.ok(typeof r.seed === "number");
});

test("generateAvatar: pixel style uses 256x256", () => {
  const r = generateAvatar({ prompt: "pixel warrior", style: "pixel" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.resolution, { width: 256, height: 256 });
});

test("generateAvatar: anime style uses 512x512", () => {
  const r = generateAvatar({ prompt: "anime girl", style: "anime" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.resolution, { width: 512, height: 512 });
});

test("generateAvatar: rejects missing prompt", () => {
  const r = generateAvatar({});
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("prompt"));
});

test("generateAvatar: rejects invalid style", () => {
  const r = generateAvatar({ prompt: "test", style: "gothic" });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("Invalid style"));
});

// ====================================================================
// generateLogo tests
// ====================================================================

test("generateLogo: generates minimal logo with colors", () => {
  const r = generateLogo({
    text: "Vireo",
    style: "minimal",
    colors: ["#FF5500", "#00AAFF"],
  });
  assert.equal(r.ok, true);
  assert.ok(r.url);
  assert.equal(r.text, "Vireo");
  assert.equal(r.style, "minimal");
  assert.deepEqual(r.colors, ["#FF5500", "#00AAFF"]);
  assert.ok(r.style_params);
  assert.equal(r.style_params.complexity, "low");
});

test("generateLogo: accepts all valid styles", () => {
  const styles = ["minimal", "geometric", "gradient", "3d", "hand-drawn"];
  for (const style of styles) {
    const r = generateLogo({ text: "Brand", style });
    assert.equal(r.ok, true, `${style} should succeed`);
    assert.equal(r.style, style);
  }
});

test("generateLogo: rejects missing text", () => {
  const r = generateLogo({ style: "minimal" });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("text"));
});

test("generateLogo: rejects missing style", () => {
  const r = generateLogo({ text: "Brand" });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("style"));
});

test("generateLogo: rejects invalid style", () => {
  const r = generateLogo({ text: "Brand", style: "retro" });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("Invalid style"));
});

test("generateLogo: rejects invalid hex color", () => {
  const r = generateLogo({ text: "Brand", style: "minimal", colors: ["red"] });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("Invalid color format"));
});

test("generateLogo: rejects non-array colors", () => {
  const r = generateLogo({ text: "Brand", style: "minimal", colors: "#FF0000" });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("colors must be an array"));
});

// ====================================================================
// generatePattern tests
// ====================================================================

test("generatePattern: generates with default geometric style", () => {
  const r = generatePattern();
  assert.equal(r.ok, true);
  assert.ok(r.url);
  assert.equal(r.style, "geometric");
  assert.equal(r.seamless, true);
  assert.equal(r.scale, 1);
  assert.ok(r.tile_size);
  assert.equal(r.tile_size.width, 128);
  assert.equal(r.tile_size.height, 128);
});

test("generatePattern: accepts all valid styles", () => {
  const styles = ["geometric", "organic", "noise", "grid", "dots"];
  for (const style of styles) {
    const r = generatePattern({ style });
    assert.equal(r.ok, true, `${style} should succeed`);
    assert.equal(r.style, style);
  }
});

test("generatePattern: scales tile size correctly", () => {
  const r = generatePattern({ style: "geometric", scale: 2 });
  assert.equal(r.ok, true);
  assert.equal(r.tile_size.width, 256);
  assert.equal(r.tile_size.height, 256);
  assert.equal(r.scale, 2);
});

test("generatePattern: accepts custom colors", () => {
  const r = generatePattern({
    style: "grid",
    colors: ["#000000", "#FFFFFF"],
    scale: 1,
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.colors, ["#000000", "#FFFFFF"]);
});

test("generatePattern: rejects invalid style", () => {
  const r = generatePattern({ style: "stripes" });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("Invalid style"));
});

test("generatePattern: rejects scale out of range", () => {
  const r = generatePattern({ scale: 15 });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("scale"));
});

test("generatePattern: rejects invalid hex color", () => {
  const r = generatePattern({ colors: ["#GGGGGG"] });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("Invalid color format"));
});

// ====================================================================
// executeGeneration dispatcher tests
// ====================================================================

test("executeGeneration: dispatches generate_image correctly", () => {
  const r = executeGeneration("generate_image", { prompt: "a cat" });
  assert.equal(r.ok, true);
  assert.equal(r.style, "photorealistic");
});

test("executeGeneration: dispatches upscale_image correctly", () => {
  const r = executeGeneration("upscale_image", { image: "pic.png", scale: 2 });
  assert.equal(r.ok, true);
  assert.equal(r.scale, 2);
});

test("executeGeneration: dispatches all 10 tools by name", () => {
  const toolNames = [
    "generate_image",
    "generate_image_to_image",
    "inpaint_image",
    "outpaint_image",
    "upscale_image",
    "generate_background",
    "generate_thumbnail",
    "generate_avatar",
    "generate_logo",
    "generate_pattern",
  ];
  for (const name of toolNames) {
    // Provide minimal required args per tool
    const args = {
      generate_image: { prompt: "test" },
      generate_image_to_image: { source_image: "a.jpg", prompt: "test" },
      inpaint_image: { image: "a.png", mask: { bbox: { x: 0, y: 0, w: 10, h: 10 } }, prompt: "fill" },
      outpaint_image: { image: "a.jpg", direction: "right" },
      upscale_image: { image: "a.png" },
      generate_background: { prompt: "test bg" },
      generate_thumbnail: { video_frame: "f.png", text: "Title" },
      generate_avatar: { prompt: "test avatar" },
      generate_logo: { text: "Brand", style: "minimal" },
      generate_pattern: {},
    };
    const r = executeGeneration(name, args[name] || {});
    assert.equal(r.ok, true, `${name} should succeed`);
  }
});

test("executeGeneration: rejects unknown tool name", () => {
  const r = executeGeneration("generate_magic");
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("Unknown"));
});

test("executeGeneration: handles missing tool name", () => {
  const r = executeGeneration(null);
  assert.equal(r.ok, false);
});

test("executeGeneration: passes through validation errors", () => {
  const r = executeGeneration("generate_image", { prompt: "" });
  assert.equal(r.ok, false);
  assert.ok(r.error);
});
