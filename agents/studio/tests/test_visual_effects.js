// test_visual_effects.js — Tests for the 10 visual effects tools.
//
//   1. autoBackgroundRemoval — background removal
//   2. autoGreenScreen       — chroma key removal
//   3. autoSkyReplacement    — sky replacement
//   4. autoObjectRemoval     — object removal via inpainting
//   5. autoFaceSwap          — face swapping
//   6. autoStyleTransfer     — artistic style transfer
//   7. autoParticleEffects   — particle overlays
//   8. autoLightLeaks        — light leak overlays
//   9. autoFilmGrain         — film grain texture
//  10. autoVHSEffect         — VHS/CRT distortion effect

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VISUAL_EFFECTS_TOOLS,
  VISUAL_EFFECTS_TOOL_NAMES,
  autoBackgroundRemoval,
  autoGreenScreen,
  autoSkyReplacement,
  autoObjectRemoval,
  autoFaceSwap,
  autoStyleTransfer,
  autoParticleEffects,
  autoLightLeaks,
  autoFilmGrain,
  autoVHSEffect,
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
    "autoBackgroundRemoval",
    "autoFaceSwap",
    "autoFilmGrain",
    "autoGreenScreen",
    "autoLightLeaks",
    "autoObjectRemoval",
    "autoParticleEffects",
    "autoSkyReplacement",
    "autoStyleTransfer",
    "autoVHSEffect",
  ]);
});

test("Visual Effects: VISUAL_EFFECTS_TOOL_NAMES set has 10 names", () => {
  assert.equal(VISUAL_EFFECTS_TOOL_NAMES.size, 10);
  assert.ok(VISUAL_EFFECTS_TOOL_NAMES.has("autoBackgroundRemoval"));
  assert.ok(VISUAL_EFFECTS_TOOL_NAMES.has("autoVHSEffect"));
});

// ====================================================================
// 1. autoBackgroundRemoval
// ====================================================================

test("autoBackgroundRemoval: returns processed video with mask quality", async () => {
  const r = await autoBackgroundRemoval({ video: "/tmp/test_video.mp4" });
  assert.equal(r.ok, true);
  assert.ok(r.video.startsWith("bg-removed-"));
  assert.equal(r.mask_quality, 0.95);
  assert.ok(typeof r.processing_time_ms === "number");
  assert.ok(r.processing_time_ms >= 0);
});

test("autoBackgroundRemoval: missing video returns error", async () => {
  const r = await autoBackgroundRemoval({ video: "" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "video_required");
});

test("autoBackgroundRemoval: undefined video returns error", async () => {
  const r = await autoBackgroundRemoval({});
  assert.equal(r.ok, false);
  assert.equal(r.error, "video_required");
});

// ====================================================================
// 2. autoGreenScreen
// ====================================================================

test("autoGreenScreen: returns keyed video with default green color", async () => {
  const r = await autoGreenScreen({ video: "/tmp/gs.mp4" });
  assert.equal(r.ok, true);
  assert.ok(r.video.startsWith("gs-keyed-"));
  assert.equal(r.key_color, "#00ff00");
  assert.ok(r.spill_suppression > 0 && r.spill_suppression <= 1);
  assert.ok(r.edge_feather > 0);
});

test("autoGreenScreen: missing video returns error", async () => {
  const r = await autoGreenScreen({ video: "" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "video_required");
});

test("autoGreenScreen: invalid color returns error", async () => {
  const r = await autoGreenScreen({ video: "/tmp/gs.mp4", color: "purple" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_color");
});

test("autoGreenScreen: all valid colors produce correct key_color", async () => {
  const colorMap = {
    green: "#00ff00",
    blue: "#0000ff",
    white: "#ffffff",
    black: "#000000",
  };
  for (const [color, hex] of Object.entries(colorMap)) {
    const r = await autoGreenScreen({ video: "/tmp/gs.mp4", color });
    assert.equal(r.ok, true);
    assert.equal(r.key_color, hex);
  }
});

// ====================================================================
// 3. autoSkyReplacement
// ====================================================================

test("autoSkyReplacement: returns replaced video with default sunset", async () => {
  const r = await autoSkyReplacement({ video: "/tmp/outdoor.mp4" });
  assert.equal(r.ok, true);
  assert.ok(r.video.startsWith("sky-replaced-"));
  assert.equal(r.new_sky, "sunset");
  assert.equal(r.original_sky, "detected");
  assert.ok(r.blend_quality > 0.8);
});

test("autoSkyReplacement: invalid sky type returns error", async () => {
  const r = await autoSkyReplacement({ video: "/tmp/v.mp4", sky: "underwater" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_sky");
});

test("autoSkyReplacement: all valid sky types accepted", async () => {
  const skyTypes = ["sunset", "blue", "stormy", "night", "dramatic", "cloudy"];
  for (const sky of skyTypes) {
    const r = await autoSkyReplacement({ video: "/tmp/v.mp4", sky });
    assert.equal(r.ok, true);
    assert.equal(r.new_sky, sky);
  }
});

test("autoSkyReplacement: missing video returns error", async () => {
  const r = await autoSkyReplacement({ video: "" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "video_required");
});

// ====================================================================
// 4. autoObjectRemoval
// ====================================================================

test("autoObjectRemoval: returns cleaned video with object count", async () => {
  const r = await autoObjectRemoval({ video: "/tmp/crowd.mp4", objects: ["car", "person"] });
  assert.equal(r.ok, true);
  assert.ok(r.video.startsWith("obj-removed-"));
  assert.equal(r.objects_removed, 2);
  assert.ok(r.frames_processed > 0);
  assert.ok(r.quality_score > 0.8);
});

test("autoObjectRemoval: missing video returns error", async () => {
  const r = await autoObjectRemoval({ video: "", objects: ["car"] });
  assert.equal(r.ok, false);
  assert.equal(r.error, "video_required");
});

test("autoObjectRemoval: empty objects returns error", async () => {
  const r = await autoObjectRemoval({ video: "/tmp/v.mp4", objects: [] });
  assert.equal(r.ok, false);
  assert.equal(r.error, "objects_required_non_empty");
});

test("autoObjectRemoval: non-array objects returns error", async () => {
  const r = await autoObjectRemoval({ video: "/tmp/v.mp4", objects: "car" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "objects_must_be_array");
});

test("autoObjectRemoval: single object returns count 1", async () => {
  const r = await autoObjectRemoval({ video: "/tmp/v.mp4", objects: ["trash can"] });
  assert.equal(r.ok, true);
  assert.equal(r.objects_removed, 1);
});

// ====================================================================
// 5. autoFaceSwap
// ====================================================================

test("autoFaceSwap: returns swapped video with quality metrics", async () => {
  const r = await autoFaceSwap({ video: "/tmp/interview.mp4", target_face: "/tmp/face.jpg" });
  assert.equal(r.ok, true);
  assert.ok(r.video.startsWith("face-swapped-"));
  assert.ok(r.faces_swapped >= 1);
  assert.ok(r.consistency_score > 0.8);
  assert.ok(r.swap_quality > 0.8);
});

test("autoFaceSwap: missing video returns error", async () => {
  const r = await autoFaceSwap({ video: "", target_face: "/tmp/face.jpg" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "video_required");
});

test("autoFaceSwap: missing target_face returns error", async () => {
  const r = await autoFaceSwap({ video: "/tmp/v.mp4", target_face: "" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "target_face_required");
});

// ====================================================================
// 6. autoStyleTransfer
// ====================================================================

test("autoStyleTransfer: returns styled video with consistency score", async () => {
  const r = await autoStyleTransfer({ video: "/tmp/clip.mp4", style: "anime" });
  assert.equal(r.ok, true);
  assert.ok(r.video.startsWith("styled-"));
  assert.equal(r.style_applied, "anime");
  assert.ok(r.consistency_score > 0.8);
});

test("autoStyleTransfer: invalid style returns error", async () => {
  const r = await autoStyleTransfer({ video: "/tmp/v.mp4", style: "cubism" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_style");
});

test("autoStyleTransfer: default style is anime", async () => {
  const r = await autoStyleTransfer({ video: "/tmp/v.mp4" });
  assert.equal(r.ok, true);
  assert.equal(r.style_applied, "anime");
  assert.equal(r.consistency_score, 0.94);
});

test("autoStyleTransfer: all valid styles produce correct consistency", async () => {
  const styles = { anime: 0.94, comic: 0.91, oil_painting: 0.88, watercolor: 0.86, pixel: 0.92, sketch: 0.90 };
  for (const [style, score] of Object.entries(styles)) {
    const r = await autoStyleTransfer({ video: "/tmp/v.mp4", style });
    assert.equal(r.ok, true);
    assert.equal(r.style_applied, style);
    assert.equal(r.consistency_score, score);
  }
});

test("autoStyleTransfer: missing video returns error", async () => {
  const r = await autoStyleTransfer({ video: "" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "video_required");
});

// ====================================================================
// 7. autoParticleEffects
// ====================================================================

test("autoParticleEffects: returns particle video with count and blend mode", async () => {
  const r = await autoParticleEffects({ video: "/tmp/winter.mp4", type: "snow" });
  assert.equal(r.ok, true);
  assert.ok(r.video.startsWith("particles-"));
  assert.equal(r.particles_added, true);
  assert.equal(r.particle_count, 800);
  assert.equal(r.blend_mode, "screen");
});

test("autoParticleEffects: invalid type returns error", async () => {
  const r = await autoParticleEffects({ video: "/tmp/v.mp4", type: "volcano" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_type");
});

test("autoParticleEffects: default type is snow", async () => {
  const r = await autoParticleEffects({ video: "/tmp/v.mp4" });
  assert.equal(r.ok, true);
  assert.equal(r.particle_count, 800);
  assert.equal(r.blend_mode, "screen");
});

test("autoParticleEffects: all valid types accepted", async () => {
  const types = ["snow", "rain", "fire", "sparks", "confetti", "fog"];
  for (const type of types) {
    const r = await autoParticleEffects({ video: "/tmp/v.mp4", type });
    assert.equal(r.ok, true);
    assert.ok(r.particle_count > 0);
    assert.ok(r.blend_mode);
  }
});

test("autoParticleEffects: missing video returns error", async () => {
  const r = await autoParticleEffects({ video: "" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "video_required");
});

// ====================================================================
// 8. autoLightLeaks
// ====================================================================

test("autoLightLeaks: returns light leak video with count and positions", async () => {
  const r = await autoLightLeaks({ video: "/tmp/party.mp4", intensity: 0.7 });
  assert.equal(r.ok, true);
  assert.ok(r.video.startsWith("light-leak-"));
  assert.ok(r.leak_count > 0);
  assert.ok(Array.isArray(r.leak_positions));
  assert.equal(r.leak_positions.length, r.leak_count);
  assert.equal(r.intensity, 0.7);
});

test("autoLightLeaks: default intensity is 0.5", async () => {
  const r = await autoLightLeaks({ video: "/tmp/v.mp4" });
  assert.equal(r.ok, true);
  assert.equal(r.intensity, 0.5);
  assert.ok(r.leak_count >= 2);
});

test("autoLightLeaks: invalid intensity returns error", async () => {
  const r = await autoLightLeaks({ video: "/tmp/v.mp4", intensity: 1.5 });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_intensity");
});

test("autoLightLeaks: negative intensity returns error", async () => {
  const r = await autoLightLeaks({ video: "/tmp/v.mp4", intensity: -0.3 });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_intensity");
});

test("autoLightLeaks: missing video returns error", async () => {
  const r = await autoLightLeaks({ video: "" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "video_required");
});

test("autoLightLeaks: intensity scales leak count", async () => {
  const low = await autoLightLeaks({ video: "/tmp/v.mp4", intensity: 0.1 });
  const high = await autoLightLeaks({ video: "/tmp/v.mp4", intensity: 0.9 });
  assert.ok(high.leak_count > low.leak_count);
});

// ====================================================================
// 9. autoFilmGrain
// ====================================================================

test("autoFilmGrain: returns grain video with type and ISO", async () => {
  const r = await autoFilmGrain({ video: "/tmp/film.mp4", amount: 0.5 });
  assert.equal(r.ok, true);
  assert.ok(r.video.startsWith("grain-"));
  assert.equal(r.amount, 0.5);
  assert.equal(r.grain_type, "medium");
  assert.equal(r.iso_simulation, 800);
});

test("autoFilmGrain: default amount is 0.3", async () => {
  const r = await autoFilmGrain({ video: "/tmp/v.mp4" });
  assert.equal(r.ok, true);
  assert.equal(r.amount, 0.3);
  assert.equal(r.grain_type, "medium");
});

test("autoFilmGrain: invalid amount returns error", async () => {
  const r = await autoFilmGrain({ video: "/tmp/v.mp4", amount: 2.0 });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_amount");
});

test("autoFilmGrain: amount ranges map to correct grain types", async () => {
  const fine = await autoFilmGrain({ video: "/tmp/v.mp4", amount: 0.1 });
  assert.equal(fine.grain_type, "fine");
  assert.equal(fine.iso_simulation, 200);

  const heavy = await autoFilmGrain({ video: "/tmp/v.mp4", amount: 0.7 });
  assert.equal(heavy.grain_type, "heavy");
  assert.equal(heavy.iso_simulation, 1600);

  const extreme = await autoFilmGrain({ video: "/tmp/v.mp4", amount: 0.9 });
  assert.equal(extreme.grain_type, "extreme");
  assert.equal(extreme.iso_simulation, 3200);
});

test("autoFilmGrain: missing video returns error", async () => {
  const r = await autoFilmGrain({ video: "" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "video_required");
});

// ====================================================================
// 10. autoVHSEffect
// ====================================================================

test("autoVHSEffect: returns VHS video with distortion params", async () => {
  const r = await autoVHSEffect({ video: "/tmp/retro.mp4", intensity: 0.8 });
  assert.equal(r.ok, true);
  assert.ok(r.video.startsWith("vhs-"));
  assert.equal(r.intensity, 0.8);
  assert.ok(r.scan_lines > 0);
  assert.ok(r.tracking_error > 0);
  assert.ok(r.color_bleed > 0);
});

test("autoVHSEffect: default intensity is 0.5", async () => {
  const r = await autoVHSEffect({ video: "/tmp/v.mp4" });
  assert.equal(r.ok, true);
  assert.equal(r.intensity, 0.5);
});

test("autoVHSEffect: invalid intensity returns error", async () => {
  const r = await autoVHSEffect({ video: "/tmp/v.mp4", intensity: 2.0 });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_intensity");
});

test("autoVHSEffect: intensity scales distortion parameters", async () => {
  const low = await autoVHSEffect({ video: "/tmp/v.mp4", intensity: 0.2 });
  const high = await autoVHSEffect({ video: "/tmp/v.mp4", intensity: 0.9 });
  assert.ok(high.scan_lines > low.scan_lines);
  assert.ok(high.tracking_error > low.tracking_error);
  assert.ok(high.color_bleed > low.color_bleed);
});

test("autoVHSEffect: missing video returns error", async () => {
  const r = await autoVHSEffect({ video: "" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "video_required");
});
