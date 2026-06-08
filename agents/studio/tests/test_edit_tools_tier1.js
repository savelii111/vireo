// test_edit_tools_tier1.js — Tests for the 5 Tier 1 editing tools.
//
// We test:
//   1. Tool shape validation (OpenAI function-calling format)
//   2. Each tool's validation (required args, enums, ranges)
//   3. Each tool's happy path (returns job_id)
//   4. The presets object shapes (used for routing hints)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TIER1_EDIT_TOOLS,
  COLOR_PRESETS,
  SPEED_PRESETS,
  DUCK_PRESETS,
  VOICE_EQ_PRESETS,
  TEXT_PRESETS,
  applyColorGrade,
  applySpeedRamp,
  mixAudio,
  composeMultiClip,
  addTextOverlay,
} from "../src/edit_tools_tier1.js";

// ---------- Tool shape validation ----------

test("Tier 1: 5 tools exported with valid OpenAI shape", () => {
  assert.equal(TIER1_EDIT_TOOLS.length, 5);
  for (const t of TIER1_EDIT_TOOLS) {
    assert.equal(t.type, "function");
    assert.ok(t.function.name);
    assert.ok(t.function.description.length > 50);
    assert.ok(t.function.parameters);
    assert.equal(t.function.parameters.type, "object");
    assert.ok(Array.isArray(t.function.parameters.required));
  }
  const names = TIER1_EDIT_TOOLS.map((t) => t.function.name).sort();
  assert.deepEqual(names, ["add_text_overlay", "apply_color_grade", "apply_speed_ramp", "compose_multi_clip", "mix_audio"]);
});

test("Tier 1: each tool description contains trigger words for LLM routing", () => {
  const triggers = {
    apply_color_grade: ["cinematic", "warm", "vintage"],
    apply_speed_ramp: ["slow", "speed", "ramp"],
    mix_audio: ["audio", "music", "voice"],
    compose_multi_clip: ["cut between", "grid", "pip"],
    add_text_overlay: ["title", "lower-third", "subscribe"],
  };
  for (const tool of TIER1_EDIT_TOOLS) {
    const name = tool.function.name;
    for (const word of triggers[name] || []) {
      assert.ok(tool.function.description.toLowerCase().includes(word), `${name} description should mention "${word}"`);
    }
  }
});

// ---------- Preset shape validation ----------

test("Tier 1: COLOR_PRESETS has 8 presets each with ffmpeg_eq", () => {
  assert.ok(Object.keys(COLOR_PRESETS).length >= 6);
  for (const [name, p] of Object.entries(COLOR_PRESETS)) {
    assert.ok(p.name, `${name} missing name`);
    assert.ok(p.description, `${name} missing description`);
    assert.ok(p.ffmpeg_eq, `${name} missing ffmpeg_eq`);
  }
});

test("Tier 1: SPEED_PRESETS all have valid multipliers in (0, 4]", () => {
  for (const [name, p] of Object.entries(SPEED_PRESETS)) {
    assert.ok(p.name);
    assert.ok(Array.isArray(p.multipliers) && p.multipliers.length > 0, `${name} missing multipliers`);
    for (const m of p.multipliers) {
      assert.ok(m > 0 && m <= 4, `${name} has invalid multiplier ${m}`);
    }
  }
});

test("Tier 1: DUCK_PRESETS all have valid music_volume_when_speaking", () => {
  for (const [name, p] of Object.entries(DUCK_PRESETS)) {
    assert.ok(p.name);
    if (p.music_volume_when_speaking !== null) {
      assert.ok(p.music_volume_when_speaking >= 0 && p.music_volume_when_speaking <= 1, `${name} ducking out of range`);
    }
  }
});

test("Tier 1: VOICE_EQ_PRESETS all have valid band structure", () => {
  for (const [name, p] of Object.entries(VOICE_EQ_PRESETS)) {
    assert.ok(p.name);
    assert.ok(Array.isArray(p.bands));
    for (const band of p.bands) {
      assert.ok(band.freq > 0, `${name} band has invalid freq`);
      assert.equal(typeof band.gain, "number", `${name} band has invalid gain`);
    }
  }
});

test("Tier 1: TEXT_PRESETS all have position and animation", () => {
  const validPositions = ["top-left", "top-center", "top-right", "center-left", "center", "center-right", "bottom-left", "bottom-center", "bottom-right"];
  const validAnimations = ["fade", "slide_in", "type_on", "pop", "static"];
  for (const [name, p] of Object.entries(TEXT_PRESETS)) {
    assert.ok(p.name, `${name} missing name`);
    assert.ok(p.font, `${name} missing font`);
    assert.ok(p.color, `${name} missing color`);
    assert.ok(validPositions.includes(p.position), `${name} has invalid position ${p.position}`);
    assert.ok(validAnimations.includes(p.animation), `${name} has invalid animation ${p.animation}`);
  }
});

// ---------- applyColorGrade ----------

test("applyColorGrade: returns job_id and validates preset", async () => {
  const r = await applyColorGrade({ file_path: "/tmp/x.mp4", preset: "cinematic" });
  assert.equal(r.ok, true);
  assert.ok(r.job_id.startsWith("colgrade-"));
  assert.equal(r.job.preset, "cinematic");
});

test("applyColorGrade: invalid preset returns error", async () => {
  const r = await applyColorGrade({ file_path: "/tmp/x.mp4", preset: "nope" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_preset");
});

test("applyColorGrade: missing file_path returns error", async () => {
  const r = await applyColorGrade({ file_path: "" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "file_path_required");
});

test("applyColorGrade: intensity out of range returns error", async () => {
  const r = await applyColorGrade({ file_path: "/tmp/x.mp4", intensity: 1.5 });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_intensity");
});

test("applyColorGrade: custom_lut_path works without preset", async () => {
  const r = await applyColorGrade({ file_path: "/tmp/x.mp4", custom_lut_path: "/luts/custom.cube" });
  assert.equal(r.ok, true);
  assert.equal(r.job.custom_lut_path, "/luts/custom.cube");
});

// ---------- applySpeedRamp ----------

test("applySpeedRamp: preset name works", async () => {
  const r = await applySpeedRamp({ file_path: "/tmp/x.mp4", preset: "ramp_in" });
  assert.equal(r.ok, true);
  assert.ok(r.job_id.startsWith("speedramp-"));
  assert.deepEqual(r.job.multipliers, [0.5, 0.7, 0.9, 1.0]);
});

test("applySpeedRamp: custom multipliers array works", async () => {
  const r = await applySpeedRamp({ file_path: "/tmp/x.mp4", preset: [1.0, 0.3, 1.0] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.job.multipliers, [1.0, 0.3, 1.0]);
});

test("applySpeedRamp: invalid preset returns error", async () => {
  const r = await applySpeedRamp({ file_path: "/tmp/x.mp4", preset: "nope" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_preset");
});

test("applySpeedRamp: multipliers <= 0 or > 4 return error", async () => {
  const r = await applySpeedRamp({ file_path: "/tmp/x.mp4", preset: [0, 1.0] });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_multipliers");
});

test("applySpeedRamp: optical_flow flag is persisted", async () => {
  const r = await applySpeedRamp({ file_path: "/tmp/x.mp4", preset: "constant_half", optical_flow: true });
  assert.equal(r.ok, true);
  assert.equal(r.job.optical_flow, true);
});

// ---------- mixAudio ----------

test("mixAudio: returns job with all parameters", async () => {
  const r = await mixAudio({ file_path: "/tmp/x.mp4", voice_volume: 1.2, music_volume: 0.3, duck_preset: "aggressive", voice_eq: "podcast", normalize: true, denoise: true });
  assert.equal(r.ok, true);
  assert.ok(r.job_id.startsWith("audiomix-"));
  assert.equal(r.job.voice_volume, 1.2);
  assert.equal(r.job.duck_preset, "aggressive");
  assert.equal(r.job.normalize, true);
});

test("mixAudio: invalid duck_preset returns error", async () => {
  const r = await mixAudio({ file_path: "/tmp/x.mp4", duck_preset: "bogus" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_duck_preset");
});

test("mixAudio: invalid voice_eq returns error", async () => {
  const r = await mixAudio({ file_path: "/tmp/x.mp4", voice_eq: "bogus" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_voice_eq");
});

// ---------- composeMultiClip ----------

test("composeMultiClip: 3 clips in sequential layout returns job", async () => {
  const r = await composeMultiClip({ clips: [{ file_path: "/a.mp4" }, { file_path: "/b.mp4" }, { file_path: "/c.mp4" }] });
  assert.equal(r.ok, true);
  assert.ok(r.job_id.startsWith("composite-"));
  assert.equal(r.job.layout, "sequential");
});

test("composeMultiClip: less than 2 clips returns error", async () => {
  const r = await composeMultiClip({ clips: [{ file_path: "/a.mp4" }] });
  assert.equal(r.ok, false);
  assert.equal(r.error, "clips_required");
});

test("composeMultiClip: more than 10 clips returns error", async () => {
  const clips = Array.from({ length: 11 }, (_, i) => ({ file_path: `/x${i}.mp4` }));
  const r = await composeMultiClip({ clips });
  assert.equal(r.ok, false);
  assert.equal(r.error, "too_many_clips");
});

test("composeMultiClip: grid layout requires exactly 4 clips", async () => {
  const r = await composeMultiClip({ clips: [{ file_path: "/a.mp4" }, { file_path: "/b.mp4" }], layout: "grid" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "grid_requires_4_clips");
});

test("composeMultiClip: pip layout requires exactly 2 clips", async () => {
  const r = await composeMultiClip({ clips: [{ file_path: "/a.mp4" }, { file_path: "/b.mp4" }, { file_path: "/c.mp4" }], layout: "pip" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "pip_requires_2_clips");
});

test("composeMultiClip: grid with 4 clips works", async () => {
  const r = await composeMultiClip({ clips: [{ file_path: "/a.mp4" }, { file_path: "/b.mp4" }, { file_path: "/c.mp4" }, { file_path: "/d.mp4" }], layout: "grid" });
  assert.equal(r.ok, true);
});

test("composeMultiClip: transition and aspect are persisted", async () => {
  const r = await composeMultiClip({ clips: [{ file_path: "/a.mp4" }, { file_path: "/b.mp4" }], transition: "crossfade", transition_duration_ms: 800, output_aspect: "9:16" });
  assert.equal(r.ok, true);
  assert.equal(r.job.transition, "crossfade");
  assert.equal(r.job.transition_duration_ms, 800);
  assert.equal(r.job.output_aspect, "9:16");
});

// ---------- addTextOverlay ----------

test("addTextOverlay: returns job with style", async () => {
  const r = await addTextOverlay({ file_path: "/tmp/x.mp4", text: "Subscribe!", preset: "tiktok-title" });
  assert.equal(r.ok, true);
  assert.ok(r.job_id.startsWith("textovl-"));
  assert.equal(r.job.text, "Subscribe!");
  assert.equal(r.job.style.font, "Arial Black");
});

test("addTextOverlay: empty text returns error", async () => {
  const r = await addTextOverlay({ file_path: "/tmp/x.mp4", text: "" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "text_required");
});

test("addTextOverlay: text > 200 chars returns error", async () => {
  const r = await addTextOverlay({ file_path: "/tmp/x.mp4", text: "x".repeat(201) });
  assert.equal(r.ok, false);
  assert.equal(r.error, "text_too_long");
});

test("addTextOverlay: style_override merges over preset", async () => {
  const r = await addTextOverlay({ file_path: "/tmp/x.mp4", text: "Hi", preset: "tiktok-title", style_override: { color: "red", position: "bottom-center" } });
  assert.equal(r.ok, true);
  assert.equal(r.job.style.color, "red");
  assert.equal(r.job.style.position, "bottom-center");
  // font should still come from the preset
  assert.equal(r.job.style.font, "Arial Black");
});

test("addTextOverlay: default end_sec = start_sec + 3", async () => {
  const r = await addTextOverlay({ file_path: "/tmp/x.mp4", text: "Hi", preset: "tiktok-title", start_sec: 10 });
  assert.equal(r.ok, true);
  assert.equal(r.job.end_sec, 13);
  assert.equal(r.job.duration_sec, 3);
});

test("addTextOverlay: end_sec before start_sec returns error", async () => {
  const r = await addTextOverlay({ file_path: "/tmp/x.mp4", text: "Hi", preset: "tiktok-title", start_sec: 10, end_sec: 5 });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_duration");
});
