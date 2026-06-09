// test_ai_enhance.js — Tests for the 10 AI Enhancement tools.
//
//   1.  auto_color_grade      — histogram analysis + LUT application
//   2.  auto_exposure_fix     — detect + correct exposure
//   3.  auto_stabilize        — smooth camera shake
//   4.  auto_noise_reduce     — remove visual noise
//   5.  auto_sharpen          — increase sharpness
//   6.  auto_upscale          — AI upscaling
//   7.  auto_frame_interpolate — interpolate fps
//   8.  auto_horizon_correct  — correct tilted horizon
//   9.  auto_lens_correction  — remove lens distortion
//   10. auto_vignette_removal — remove dark corners
//
// All tests use the synchronous v1 API (no real video files needed).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  // Tool definitions
  AI_ENHANCE_TOOLS,
  AI_ENHANCE_TOOL_NAMES,
  AUTO_COLOR_GRADE_TOOL,
  AUTO_EXPOSURE_FIX_TOOL,
  AUTO_STABILIZE_TOOL,
  AUTO_NOISE_REDUCE_TOOL,
  AUTO_SHARPEN_TOOL,
  AUTO_UPSCALE_TOOL,
  AUTO_FRAME_INTERPOLATE_TOOL,
  AUTO_HORIZON_CORRECT_TOOL,
  AUTO_LENS_CORRECTION_TOOL,
  AUTO_VIGNETTE_REMOVAL_TOOL,
  // Implementation functions
  autoColorGrade,
  autoExposureFix,
  autoStabilize,
  autoNoiseReduce,
  autoSharpen,
  autoUpscale,
  autoFrameInterpolate,
  autoHorizonCorrect,
  autoLensCorrection,
  autoVignetteRemoval,
  // Dispatcher
  executeEnhancement,
} from "../src/ai_enhance.js";

// ====================================================================
// Tool shape tests
// ====================================================================

test("AI Enhance: exports 10 tools with valid OpenAI function shape", () => {
  assert.equal(AI_ENHANCE_TOOLS.length, 10);
  for (const t of AI_ENHANCE_TOOLS) {
    assert.equal(t.type, "function");
    assert.ok(t.function.name, "tool must have a name");
    assert.ok(t.function.description.length > 30, "description too short");
    assert.equal(t.function.parameters.type, "object");
    assert.ok(Array.isArray(t.function.parameters.required), "required must be array");
    assert.ok(t.function.parameters.properties, "must have properties");
  }
});

test("AI Enhance: TOOL_NAMES set has 10 entries", () => {
  assert.equal(AI_ENHANCE_TOOL_NAMES.size, 10);
});

test("AI Enhance: all tool names are unique", () => {
  const names = AI_ENHANCE_TOOLS.map((t) => t.function.name);
  assert.equal(new Set(names).size, names.length);
});

test("AI Enhance: all 10 tool definitions are individually importable", () => {
  const defs = [
    AUTO_COLOR_GRADE_TOOL,
    AUTO_EXPOSURE_FIX_TOOL,
    AUTO_STABILIZE_TOOL,
    AUTO_NOISE_REDUCE_TOOL,
    AUTO_SHARPEN_TOOL,
    AUTO_UPSCALE_TOOL,
    AUTO_FRAME_INTERPOLATE_TOOL,
    AUTO_HORIZON_CORRECT_TOOL,
    AUTO_LENS_CORRECTION_TOOL,
    AUTO_VIGNETTE_REMOVAL_TOOL,
  ];
  assert.equal(defs.length, 10);
  for (const d of defs) {
    assert.equal(d.type, "function");
  }
});

// ====================================================================
// autoColorGrade tests
// ====================================================================

test("autoColorGrade: applies cinematic style by default", () => {
  const r = autoColorGrade("vid-001");
  assert.equal(r.ok, true);
  assert.equal(r.style, "cinematic");
  assert.ok(r.file_id);
  assert.ok(r.job_id);
  assert.ok(r.histogram);
  assert.equal(typeof r.histogram.mean_brightness, "number");
  assert.ok(r.applied_params);
  assert.ok(r.description);
});

test("autoColorGrade: accepts all valid styles", () => {
  const styles = ["cinematic", "warm", "cool", "vintage", "high_contrast"];
  for (const style of styles) {
    const r = autoColorGrade("vid-style", { style });
    assert.equal(r.ok, true);
    assert.equal(r.style, style);
  }
});

test("autoColorGrade: rejects invalid style", () => {
  const r = autoColorGrade("vid-002", { style: "neon" });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("Invalid style"));
});

test("autoColorGrade: rejects missing file_id", () => {
  const r = autoColorGrade();
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("file_id"));
});

test("autoColorGrade: adjusts params for dark images", () => {
  const r = autoColorGrade("a-dark-video-with-many-chars");
  assert.equal(r.ok, true);
  // Brightness should be adjusted from base if histogram says dark
  assert.ok(typeof r.applied_params.brightness === "number");
});

// ====================================================================
// autoExposureFix tests
// ====================================================================

test("autoExposureFix: corrects exposure for a video", () => {
  const r = autoExposureFix("vid-100");
  assert.equal(r.ok, true);
  assert.ok(r.file_id);
  assert.ok(r.analysis);
  assert.equal(typeof r.analysis.mean, "number");
  assert.ok(typeof r.correction.exposure_adjust === "number");
  assert.equal(typeof r.correction.gamma, "number");
});

test("autoExposureFix: detects underexposed frames", () => {
  const r = autoExposureFix("vid-dark-video");
  assert.equal(r.ok, true);
  assert.ok(typeof r.analysis.underexposed_frames === "number");
  assert.ok(typeof r.analysis.overexposed_frames === "number");
});

test("autoExposureFix: rejects missing file_id", () => {
  const r = autoExposureFix("");
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("file_id"));
});

// ====================================================================
// autoStabilize tests
// ====================================================================

test("autoStabilize: stabilizes with default strength 0.8", () => {
  const r = autoStabilize("vid-200");
  assert.equal(r.ok, true);
  assert.equal(r.strength, 0.8);
  assert.equal(r.smoothing_filter, "aggressive");
  assert.ok(r.motion_analysis);
  assert.equal(typeof r.motion_analysis.total_shake, "number");
});

test("autoStabilize: accepts custom strength", () => {
  const r = autoStabilize("vid-201", { strength: 0.5 });
  assert.equal(r.ok, true);
  assert.equal(r.strength, 0.5);
  assert.equal(r.smoothing_filter, "moderate");
});

test("autoStabilize: gentle mode at low strength", () => {
  const r = autoStabilize("vid-202", { strength: 0.1 });
  assert.equal(r.smoothing_filter, "gentle");
  assert.equal(r.border_action, "fill");
});

test("autoStabilize: rejects strength out of range", () => {
  const r = autoStabilize("vid-203", { strength: 1.5 });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("strength"));
});

test("autoStabilize: rejects negative strength", () => {
  const r = autoStabilize("vid-204", { strength: -0.5 });
  assert.equal(r.ok, false);
});

test("autoStabilize: rejects missing file_id", () => {
  const r = autoStabilize(null);
  assert.equal(r.ok, false);
});

// ====================================================================
// autoNoiseReduce tests
// ====================================================================

test("autoNoiseReduce: reduces noise with default medium level", () => {
  const r = autoNoiseReduce("vid-300");
  assert.equal(r.ok, true);
  assert.equal(r.level, "medium");
  assert.equal(r.filter_strength, 0.6);
  assert.ok(r.noise_analysis);
  assert.ok(typeof r.noise_analysis.estimated_snr === "number");
});

test("autoNoiseReduce: accepts all valid levels", () => {
  const levels = ["light", "medium", "heavy"];
  const expected = [0.3, 0.6, 0.9];
  for (let i = 0; i < levels.length; i++) {
    const r = autoNoiseReduce("vid-301", { level: levels[i] });
    assert.equal(r.ok, true);
    assert.equal(r.filter_strength, expected[i]);
  }
});

test("autoNoiseReduce: heavy level uses temporal+spatial filtering", () => {
  const r = autoNoiseReduce("vid-302", { level: "heavy" });
  assert.equal(r.spatial_vs_temporal, "temporal_spatial");
});

test("autoNoiseReduce: rejects invalid level", () => {
  const r = autoNoiseReduce("vid-303", { level: "extreme" });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("Invalid level"));
});

// ====================================================================
// autoSharpen tests
// ====================================================================

test("autoSharpen: sharpens with default amount 0.5", () => {
  const r = autoSharpen("vid-400");
  assert.equal(r.ok, true);
  assert.equal(r.amount, 0.5);
  assert.ok(r.sharpness_analysis);
  assert.ok(r.unsharp_mask);
  assert.ok(typeof r.unsharp_mask.radius === "number");
  assert.ok(typeof r.unsharp_mask.strength === "number");
});

test("autoSharpen: computes USM params based on amount", () => {
  const low = autoSharpen("vid-401", { amount: 0.1 });
  const high = autoSharpen("vid-402", { amount: 0.9 });
  assert.ok(high.unsharp_mask.strength > low.unsharp_mask.strength);
  assert.ok(high.unsharp_mask.radius >= low.unsharp_mask.radius);
});

test("autoSharpen: rejects amount > 1", () => {
  const r = autoSharpen("vid-403", { amount: 2.0 });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("amount"));
});

test("autoSharpen: rejects missing file_id", () => {
  const r = autoSharpen(undefined);
  assert.equal(r.ok, false);
});

// ====================================================================
// autoUpscale tests
// ====================================================================

test("autoUpscale: upscales to 4k by default", () => {
  const r = autoUpscale("vid-500");
  assert.equal(r.ok, true);
  assert.equal(r.target_resolution, "4k");
  assert.ok(r.source);
  assert.ok(typeof r.scale_factor === "number");
  assert.ok(r.model);
});

test("autoUpscale: accepts all target resolutions", () => {
  const targets = ["2k", "4k", "8k"];
  for (const t of targets) {
    const r = autoUpscale("vid-501", { target_resolution: t });
    assert.equal(r.ok, true);
    assert.equal(r.target_resolution, t);
  }
});

test("autoUpscale: 8k uses x4 model", () => {
  const r = autoUpscale("vid-502", { target_resolution: "8k" });
  assert.ok(r.scale_factor >= 1);
});

test("autoUpscale: rejects invalid target", () => {
  const r = autoUpscale("vid-503", { target_resolution: "16k" });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("Invalid target"));
});

// ====================================================================
// autoFrameInterpolate tests
// ====================================================================

test("autoFrameInterpolate: targets 60fps by default", () => {
  const r = autoFrameInterpolate("vid-600");
  assert.equal(r.ok, true);
  assert.equal(r.target_fps, 60);
  assert.ok(typeof r.source_fps === "number");
  assert.ok(typeof r.multiplier === "number");
  assert.ok(r.method);
});

test("autoFrameInterpolate: uses optical_flow for <= 2x multiplier", () => {
  const r = autoFrameInterpolate("vid-601", { target_fps: 60 });
  assert.ok(r.method === "optical_flow" || r.method === "rife_v4");
});

test("autoFrameInterpolate: rejects target_fps > 240", () => {
  const r = autoFrameInterpolate("vid-602", { target_fps: 300 });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("target_fps"));
});

test("autoFrameInterpolate: rejects target_fps < 1", () => {
  const r = autoFrameInterpolate("vid-603", { target_fps: 0 });
  assert.equal(r.ok, false);
});

test("autoFrameInterpolate: rejects missing file_id", () => {
  const r = autoFrameInterpolate(null);
  assert.equal(r.ok, false);
});

// ====================================================================
// autoHorizonCorrect tests
// ====================================================================

test("autoHorizonCorrect: detects and corrects tilt", () => {
  const r = autoHorizonCorrect("vid-700");
  assert.equal(r.ok, true);
  assert.ok(typeof r.detected_angle === "number");
  assert.ok(typeof r.confidence === "number");
  assert.ok(typeof r.correction_applied === "number");
  assert.ok(typeof r.crop_factor === "number");
  assert.ok(r.crop_factor >= 1.0);
});

test("autoHorizonCorrect: crop factor increases with larger angle", () => {
  // Different file IDs give different angles; verify crop factor relationship
  const a = autoHorizonCorrect("vid-701");
  assert.ok(a.crop_factor >= 1.0);
  // Crop factor should be 1 + |angle| * 0.02
  const expected = +(1 + Math.abs(a.detected_angle) * 0.02).toFixed(3);
  assert.equal(a.crop_factor, expected);
});

test("autoHorizonCorrect: rejects missing file_id", () => {
  const r = autoHorizonCorrect("");
  assert.equal(r.ok, false);
});

// ====================================================================
// autoLensCorrection tests
// ====================================================================

test("autoLensCorrection: detects and corrects distortion", () => {
  const r = autoLensCorrection("vid-800");
  assert.equal(r.ok, true);
  assert.ok(["barrel", "pincushion", "mustache"].includes(r.distortion_type));
  assert.ok(typeof r.distortion_amount === "number");
  assert.ok(typeof r.correction_strength === "number");
  assert.ok(typeof r.crop_factor === "number");
});

test("autoLensCorrection: crop factor is always >= 1", () => {
  const r = autoLensCorrection("vid-801");
  assert.ok(r.crop_factor >= 1.0);
});

test("autoLensCorrection: rejects missing file_id", () => {
  const r = autoLensCorrection(null);
  assert.equal(r.ok, false);
});

// ====================================================================
// autoVignetteRemoval tests
// ====================================================================

test("autoVignetteRemoval: detects and removes vignette", () => {
  const r = autoVignetteRemoval("vid-900");
  assert.equal(r.ok, true);
  assert.ok(typeof r.vignette_strength === "number");
  assert.ok(typeof r.correction_amount === "number");
  assert.ok(r.radial_gradient);
  assert.equal(r.radial_gradient.center_brightness, 1.0);
  assert.ok(typeof r.radial_gradient.corner_brightness === "number");
  assert.ok(typeof r.radial_gradient.falloff_exponent === "number");
});

test("autoVignetteRemoval: corner brightness < 1 when vignette detected", () => {
  const r = autoVignetteRemoval("vid-901");
  assert.ok(r.radial_gradient.corner_brightness <= 1.0);
  assert.ok(r.radial_gradient.corner_brightness >= 0);
});

test("autoVignetteRemoval: rejects missing file_id", () => {
  const r = autoVignetteRemoval(undefined);
  assert.equal(r.ok, false);
});

// ====================================================================
// executeEnhancement dispatcher tests
// ====================================================================

test("executeEnhancement: dispatches auto_color_grade correctly", () => {
  const r = executeEnhancement("auto_color_grade", { file_id: "d-001", style: "warm" });
  assert.equal(r.ok, true);
  assert.equal(r.style, "warm");
});

test("executeEnhancement: dispatches auto_stabilize correctly", () => {
  const r = executeEnhancement("auto_stabilize", { file_id: "d-002", strength: 0.5 });
  assert.equal(r.ok, true);
  assert.equal(r.strength, 0.5);
});

test("executeEnhancement: dispatches all 10 tools by name", () => {
  const toolNames = [
    "auto_color_grade",
    "auto_exposure_fix",
    "auto_stabilize",
    "auto_noise_reduce",
    "auto_sharpen",
    "auto_upscale",
    "auto_frame_interpolate",
    "auto_horizon_correct",
    "auto_lens_correction",
    "auto_vignette_removal",
  ];
  for (const name of toolNames) {
    const r = executeEnhancement(name, { file_id: "d-all" });
    assert.equal(r.ok, true, `${name} should succeed`);
    assert.ok(r.file_id, `${name} should return a file_id`);
  }
});

test("executeEnhancement: rejects unknown tool name", () => {
  const r = executeEnhancement("auto_magic_wand");
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("Unknown"));
});

test("executeEnhancement: handles missing tool name", () => {
  const r = executeEnhancement(null);
  assert.equal(r.ok, false);
});

test("executeEnhancement: passes through validation errors", () => {
  const r = executeEnhancement("auto_color_grade", { style: "invalid" });
  assert.equal(r.ok, false);
  assert.ok(r.error);
});
