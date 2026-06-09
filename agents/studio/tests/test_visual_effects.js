// test_visual_effects.js — Tests for the 10 visual effects tools.
//
//   1. removeBackground     — background removal
//   2. greenScreenReplace   — chroma key compositing
//   3. skyReplacement       — sky replacement
//   4. objectRemoval        — object removal via inpainting
//   5. faceSwap             — face swapping
//   6. styleTransfer        — artistic style transfer
//   7. particleEffects      — particle overlays
//   8. lightLeaks           — light leak overlays
//   9. filmGrain            — film grain texture
//  10. vhsEffect            — VHS degradation effect

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VISUAL_EFFECTS_TOOLS,
  VISUAL_EFFECTS_TOOL_NAMES,
  removeBackground,
  greenScreenReplace,
  skyReplacement,
  objectRemoval,
  faceSwap,
  styleTransfer,
  particleEffects,
  lightLeaks,
  filmGrain,
  vhsEffect,
} from "../src/visual_effects.js";

// ====================================================================
// Tool shape tests
// ====================================================================

test("Visual Effects: 10 tools exported with valid OpenAI shape", () => {
  assert.equal(VISUAL_EFFECTS_TOOLS.length, 10);
  for (const t of VISUAL_EFFECTS_TOOLS) {
    assert.equal(t.type, "function");
    assert.ok(t.function.name);
    assert.ok(t.function.description.length > 50);
    assert.equal(t.function.parameters.type, "object");
  }
  const names = VISUAL_EFFECTS_TOOLS.map((t) => t.function.name).sort();
  assert.deepEqual(names, [
    "faceSwap",
    "filmGrain",
    "greenScreenReplace",
    "lightLeaks",
    "objectRemoval",
    "particleEffects",
    "removeBackground",
    "skyReplacement",
    "styleTransfer",
    "vhsEffect",
  ]);
});

test("Visual Effects: VISUAL_EFFECTS_TOOL_NAMES set has 10 names", () => {
  assert.equal(VISUAL_EFFECTS_TOOL_NAMES.size, 10);
  assert.ok(VISUAL_EFFECTS_TOOL_NAMES.has("removeBackground"));
  assert.ok(VISUAL_EFFECTS_TOOL_NAMES.has("vhsEffect"));
});

// ====================================================================
// 1. removeBackground
// ====================================================================

test("removeBackground: returns processed video with default ai method", async () => {
  const r = await removeBackground({ video: "/tmp/test_video.mp4" });
  assert.equal(r.ok, true);
  assert.ok(r.processed.startsWith("bg-removed-"));
  assert.equal(r.method, "ai");
  assert.equal(r.bg_color, "#000000");
  assert.equal(r.mask_quality, 0.95);
});

test("removeBackground: missing video returns error", async () => {
  const r = await removeBackground({ video: "" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "video_required");
});

test("removeBackground: invalid method returns error", async () => {
  const r = await removeBackground({ video: "/tmp/v.mp4", method: "lasers" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_method");
});

test("removeBackground: all valid methods produce correct mask_quality", async () => {
  const methods = { ai: 0.95, color: 0.82, depth: 0.78, magic: 0.70 };
  for (const [method, quality] of Object.entries(methods)) {
    const r = await removeBackground({ video: "/tmp/v.mp4", method });
    assert.equal(r.ok, true);
    assert.equal(r.method, method);
    assert.equal(r.mask_quality, quality);
  }
});

// ====================================================================
// 2. greenScreenReplace
// ====================================================================

test("greenScreenReplace: returns composited video", async () => {
  const r = await greenScreenReplace({ video: "/tmp/gs.mp4", new_background: "/tmp/bg.jpg" });
  assert.equal(r.ok, true);
  assert.ok(r.processed.startsWith("gs-composite-"));
  assert.equal(r.chroma_key, "#00ff00");
  assert.ok(r.spill_reduction > 0 && r.spill_reduction <= 1);
  assert.ok(r.composite_quality > 0 && r.composite_quality <= 1);
});

test("greenScreenReplace: missing video returns error", async () => {
  const r = await greenScreenReplace({ video: "", new_background: "/tmp/bg.jpg" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "video_required");
});

test("greenScreenReplace: missing new_background returns error", async () => {
  const r = await greenScreenReplace({ video: "/tmp/gs.mp4", new_background: "" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "new_background_required");
});

// ====================================================================
// 3. skyReplacement
// ====================================================================

test("skyReplacement: returns replaced video with default sunset", async () => {
  const r = await skyReplacement({ video: "/tmp/outdoor.mp4" });
  assert.equal(r.ok, true);
  assert.ok(r.processed.startsWith("sky-replaced-"));
  assert.equal(r.sky_type, "sunset");
  assert.ok(r.blend_quality > 0.8);
  assert.ok(r.mask_accuracy > 0.8);
});

test("skyReplacement: invalid sky type returns error", async () => {
  const r = await skyReplacement({ video: "/tmp/v.mp4", new_sky: "underwater" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_sky_type");
});

test("skyReplacement: all valid sky types accepted", async () => {
  const skyTypes = ["sunset", "blue", "cloudy", "night", "aurora", "custom"];
  for (const sky of skyTypes) {
    const r = await skyReplacement({ video: "/tmp/v.mp4", new_sky: sky });
    assert.equal(r.ok, true);
    assert.equal(r.sky_type, sky);
  }
});

// ====================================================================
// 4. objectRemoval
// ====================================================================

test("objectRemoval: returns cleaned video with object count", async () => {
  const r = await objectRemoval({ video: "/tmp/crowd.mp4", object_mask: "red car in center" });
  assert.equal(r.ok, true);
  assert.ok(r.processed.startsWith("obj-removed-"));
  assert.ok(r.objects_removed >= 1);
  assert.ok(r.inpaint_quality > 0.8);
  assert.ok(r.frames_processed > 0);
});

test("objectRemoval: missing video returns error", async () => {
  const r = await objectRemoval({ video: "", object_mask: "person" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "video_required");
});

test("objectRemoval: missing object_mask returns error", async () => {
  const r = await objectRemoval({ video: "/tmp/v.mp4", object_mask: "" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "object_mask_required");
});

// ====================================================================
// 5. faceSwap
// ====================================================================

test("faceSwap: returns swapped video with quality metrics", async () => {
  const r = await faceSwap({ video: "/tmp/interview.mp4", target_face: "/tmp/face.jpg" });
  assert.equal(r.ok, true);
  assert.ok(r.processed.startsWith("face-swapped-"));
  assert.ok(r.faces_swapped >= 1);
  assert.ok(r.blend_quality > 0.8);
  assert.ok(r.expression_match > 0.8);
});

test("faceSwap: missing video returns error", async () => {
  const r = await faceSwap({ video: "", target_face: "/tmp/face.jpg" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "video_required");
});

test("faceSwap: missing target_face returns error", async () => {
  const r = await faceSwap({ video: "/tmp/v.mp4", target_face: "" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "target_face_required");
});

// ====================================================================
// 6. styleTransfer
// ====================================================================

test("styleTransfer: returns styled video with consistency score", async () => {
  const r = await styleTransfer({ video: "/tmp/clip.mp4", style_image: "anime" });
  assert.equal(r.ok, true);
  assert.ok(r.processed.startsWith("styled-"));
  assert.equal(r.style_applied, "anime");
  assert.ok(r.consistency_score > 0.8);
});

test("styleTransfer: invalid style returns error", async () => {
  const r = await styleTransfer({ video: "/tmp/v.mp4", style_image: "cubism" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_style");
});

test("styleTransfer: all valid styles produce correct consistency", async () => {
  const styles = { anime: 0.94, comic: 0.91, painting: 0.88, sketch: 0.92, "pop-art": 0.90 };
  for (const [style, score] of Object.entries(styles)) {
    const r = await styleTransfer({ video: "/tmp/v.mp4", style_image: style });
    assert.equal(r.ok, true);
    assert.equal(r.style_applied, style);
    assert.equal(r.consistency_score, score);
  }
});

// ====================================================================
// 7. particleEffects
// ====================================================================

test("particleEffects: returns particle video with count and density", async () => {
  const r = await particleEffects({ video: "/tmp/winter.mp4", effect: "snow" });
  assert.equal(r.ok, true);
  assert.ok(r.processed.startsWith("particles-"));
  assert.equal(r.effect_type, "snow");
  assert.equal(r.particle_count, 800);
  assert.ok(r.density > 0);
});

test("particleEffects: invalid effect returns error", async () => {
  const r = await particleEffects({ video: "/tmp/v.mp4", effect: "volcano" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_effect");
});

test("particleEffects: all valid effects accepted", async () => {
  const effects = ["snow", "rain", "fire", "sparkles", "confetti", "smoke"];
  for (const effect of effects) {
    const r = await particleEffects({ video: "/tmp/v.mp4", effect });
    assert.equal(r.ok, true);
    assert.equal(r.effect_type, effect);
    assert.ok(r.particle_count > 0);
  }
});

// ====================================================================
// 8. lightLeaks
// ====================================================================

test("lightLeaks: returns light leak video with color and position", async () => {
  const r = await lightLeaks({ video: "/tmp/party.mp4", color: "warm", intensity: 0.7 });
  assert.equal(r.ok, true);
  assert.ok(r.processed.startsWith("light-leak-"));
  assert.equal(r.color, "warm");
  assert.equal(r.intensity, 0.7);
  assert.equal(r.position, "top-right");
});

test("lightLeaks: invalid color returns error", async () => {
  const r = await lightLeaks({ video: "/tmp/v.mp4", color: "purple", intensity: 0.5 });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_color");
});

test("lightLeaks: invalid intensity returns error", async () => {
  const r = await lightLeaks({ video: "/tmp/v.mp4", color: "warm", intensity: 1.5 });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_intensity");
});

test("lightLeaks: negative intensity returns error", async () => {
  const r = await lightLeaks({ video: "/tmp/v.mp4", color: "warm", intensity: -0.3 });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_intensity");
});

// ====================================================================
// 9. filmGrain
// ====================================================================

test("filmGrain: returns grain video with style-specific grain size", async () => {
  const r = await filmGrain({ video: "/tmp/film.mp4", amount: 0.5, style: "vintage" });
  assert.equal(r.ok, true);
  assert.ok(r.processed.startsWith("grain-"));
  assert.equal(r.amount, 0.5);
  assert.equal(r.style, "vintage");
  assert.equal(r.grain_size, 1.8);
});

test("filmGrain: invalid amount returns error", async () => {
  const r = await filmGrain({ video: "/tmp/v.mp4", amount: 2.0, style: "heavy" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_amount");
});

test("filmGrain: invalid style returns error", async () => {
  const r = await filmGrain({ video: "/tmp/v.mp4", amount: 0.5, style: "digital" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_style");
});

test("filmGrain: all valid styles produce correct grain sizes", async () => {
  const styles = { subtle: 0.8, medium: 1.2, heavy: 2.0, vintage: 1.8, "8mm": 2.5 };
  for (const [style, size] of Object.entries(styles)) {
    const r = await filmGrain({ video: "/tmp/v.mp4", amount: 0.6, style });
    assert.equal(r.ok, true);
    assert.equal(r.grain_size, size);
  }
});

// ====================================================================
// 10. vhsEffect
// ====================================================================

test("vhsEffect: returns VHS video with distortion params", async () => {
  const r = await vhsEffect({ video: "/tmp/retro.mp4", intensity: 0.8 });
  assert.equal(r.ok, true);
  assert.ok(r.processed.startsWith("vhs-"));
  assert.equal(r.intensity, 0.8);
  assert.ok(r.scanlines > 0);
  assert.ok(r.color_bleed > 0);
  assert.ok(r.noise > 0);
});

test("vhsEffect: invalid intensity returns error", async () => {
  const r = await vhsEffect({ video: "/tmp/v.mp4", intensity: 2.0 });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_intensity");
});

test("vhsEffect: intensity scales distortion parameters", async () => {
  const low = await vhsEffect({ video: "/tmp/v.mp4", intensity: 0.2 });
  const high = await vhsEffect({ video: "/tmp/v.mp4", intensity: 0.9 });
  assert.ok(high.scanlines > low.scanlines);
  assert.ok(high.color_bleed > low.color_bleed);
  assert.ok(high.noise > low.noise);
});
