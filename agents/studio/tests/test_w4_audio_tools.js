// test_w4_audio_tools.js — Tests for W4 audio features.
//
// Validates:
//   1. Audio-related ops exist in BATCH_EDIT_OPS (production_tools.js)
//   2. mix_audio tool definition shape (Tier 1, edit_tools_tier1.js)
//   3. mix_audio parameter validation (valid / invalid)
//   4. Audio ducking preset validation
//   5. Voice EQ preset validation
//   6. analyze_audio tool definition exists in EDIT_TOOLS (tools.js)
//   7. add_music tool definition exists in EDIT_TOOLS (tools.js)
//   8. Volume normalization params (normalize flag, LUFS target)
//
// All audio tools are already in the codebase — this test locks their
// contracts so future refactors don't break them silently.

import { test } from "node:test";
import assert from "node:assert/strict";

// ── Tier 1 audio tools (edit_tools_tier1.js) ──────────────────────────
import {
  TIER1_EDIT_TOOLS,
  DUCK_PRESETS,
  VOICE_EQ_PRESETS,
  mixAudio,
} from "../src/edit_tools_tier1.js";

// ── Production tools (production_tools.js) ─────────────────────────────
// BATCH_EDIT_OPS is not exported — we test it indirectly via batchEdit()
// which returns the valid ops list in error responses.
import { batchEdit } from "../src/production_tools.js";

// ── Edit tools (tools.js) — EDIT_TOOLS array ──────────────────────────
import { EDIT_TOOLS } from "../src/tools.js";

// =====================================================================
// 1. BATCH_EDIT_OPS includes audio ops
// =====================================================================

test("batchEdit rejects unknown op and exposes valid ops including apply_audio_normalize", async () => {
  const r = await batchEdit({
    files: ["/tmp/a.mp4"],
    operations: [{ tool: "nonexistent_op", args: {} }],
  });
  assert.equal(r.ok, false);
  assert.equal(r.error, "unknown_op: nonexistent_op");
  assert.ok(Array.isArray(r.valid_ops), "error should include valid_ops list");
  assert.ok(
    r.valid_ops.includes("apply_audio_normalize"),
    "apply_audio_normalize should be in valid_ops"
  );
});

test("batchEdit: valid_ops list is an array of strings", async () => {
  const r = await batchEdit({
    files: ["/tmp/a.mp4"],
    operations: [{ tool: "no_such_thing", args: {} }],
  });
  assert.ok(Array.isArray(r.valid_ops));
  for (const op of r.valid_ops) {
    assert.equal(typeof op, "string");
    assert.ok(op.length > 0);
  }
});

// =====================================================================
// 2. mix_audio tool definition exists with valid shape
// =====================================================================

test("mix_audio tool definition exists in TIER1_EDIT_TOOLS", () => {
  const tool = TIER1_EDIT_TOOLS.find((t) => t.function.name === "mix_audio");
  assert.ok(tool, "mix_audio should be in TIER1_EDIT_TOOLS");
  assert.equal(tool.type, "function");
  assert.ok(tool.function.description.length > 50);
  assert.equal(tool.function.parameters.type, "object");
  assert.ok(
    tool.function.parameters.required.includes("file_path"),
    "file_path must be required"
  );
});

test("mix_audio accepts valid params (file_path, voice_volume, music_volume)", async () => {
  const r = await mixAudio({
    file_path: "/tmp/test_video.mp4",
    voice_volume: 1.0,
    music_volume: 0.2,
  });
  assert.equal(r.ok, true);
  assert.ok(r.job_id.startsWith("audiomix-"));
  assert.equal(r.job.file_path, "/tmp/test_video.mp4");
  assert.equal(r.job.voice_volume, 1.0);
  assert.equal(r.job.music_volume, 0.2);
});

test("mix_audio accepts all optional params", async () => {
  const r = await mixAudio({
    file_path: "/tmp/test.mp4",
    voice_volume: 1.5,
    music_volume: 0.4,
    duck_preset: "aggressive",
    voice_eq: "podcast",
    normalize: true,
    denoise: true,
  });
  assert.equal(r.ok, true);
  assert.equal(r.job.voice_volume, 1.5);
  assert.equal(r.job.music_volume, 0.4);
  assert.equal(r.job.duck_preset, "aggressive");
  assert.equal(r.job.voice_eq, "podcast");
  assert.equal(r.job.normalize, true);
  assert.equal(r.job.denoise, true);
  assert.ok(r.message.includes("normalize ON"));
  assert.ok(r.message.includes("denoise ON"));
});

// =====================================================================
// 3. mix_audio rejects invalid params
// =====================================================================

test("mix_audio rejects missing file_path", async () => {
  const r = await mixAudio({ voice_volume: 1.0 });
  assert.equal(r.ok, false);
  assert.equal(r.error, "file_path_required");
});

test("mix_audio rejects empty file_path", async () => {
  const r = await mixAudio({ file_path: "" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "file_path_required");
});

test("mix_audio rejects invalid duck_preset", async () => {
  const r = await mixAudio({ file_path: "/tmp/x.mp4", duck_preset: "turbo" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_duck_preset");
  assert.ok(r.message.includes("Valid:"));
});

test("mix_audio rejects invalid voice_eq", async () => {
  const r = await mixAudio({ file_path: "/tmp/x.mp4", voice_eq: "bass_boost" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_voice_eq");
  assert.ok(r.message.includes("Valid:"));
});

test("mix_audio defaults are sane", async () => {
  const r = await mixAudio({ file_path: "/tmp/x.mp4" });
  assert.equal(r.ok, true);
  assert.equal(r.job.voice_volume, 1.0);
  assert.equal(r.job.music_volume, 0.2);
  assert.equal(r.job.duck_preset, "normal");
  assert.equal(r.job.voice_eq, "flat");
  assert.equal(r.job.normalize, false);
  assert.equal(r.job.denoise, false);
});

// =====================================================================
// 4. Audio ducking preset validation
// =====================================================================

test("DUCK_PRESETS has exactly 4 presets: subtle, normal, aggressive, off", () => {
  const keys = Object.keys(DUCK_PRESETS).sort();
  assert.deepEqual(keys, ["aggressive", "normal", "off", "subtle"]);
});

test("DUCK_PRESETS: each preset has a name and music_volume_when_speaking", () => {
  for (const [name, p] of Object.entries(DUCK_PRESETS)) {
    assert.ok(p.name, `${name} missing name`);
    // music_volume_when_speaking is either a number (0-1) or null (for "off")
    if (p.music_volume_when_speaking !== null) {
      assert.equal(typeof p.music_volume_when_speaking, "number");
      assert.ok(
        p.music_volume_when_speaking >= 0 && p.music_volume_when_speaking <= 1,
        `${name} music_volume_when_speaking out of range: ${p.music_volume_when_speaking}`
      );
    }
  }
});

test("DUCK_PRESETS: 'off' has null music_volume_when_speaking", () => {
  assert.equal(DUCK_PRESETS.off.music_volume_when_speaking, null);
});

test("DUCK_PRESETS: volumes decrease from subtle to aggressive", () => {
  assert.ok(
    DUCK_PRESETS.subtle.music_volume_when_speaking >
      DUCK_PRESETS.normal.music_volume_when_speaking,
    "subtle should duck less than normal"
  );
  assert.ok(
    DUCK_PRESETS.normal.music_volume_when_speaking >
      DUCK_PRESETS.aggressive.music_volume_when_speaking,
    "normal should duck less than aggressive"
  );
});

// =====================================================================
// 5. Voice EQ preset validation
// =====================================================================

test("VOICE_EQ_PRESETS has at least 5 presets", () => {
  assert.ok(Object.keys(VOICE_EQ_PRESETS).length >= 5);
});

test("VOICE_EQ_PRESETS: each preset has name and bands array", () => {
  for (const [name, p] of Object.entries(VOICE_EQ_PRESETS)) {
    assert.ok(p.name, `${name} missing name`);
    assert.ok(Array.isArray(p.bands), `${name} missing bands array`);
    for (const band of p.bands) {
      assert.ok(typeof band.freq === "number" && band.freq > 0, `${name} band invalid freq`);
      assert.equal(typeof band.gain, "number", `${name} band invalid gain`);
    }
  }
});

test("VOICE_EQ_PRESETS: flat has empty bands", () => {
  assert.deepEqual(VOICE_EQ_PRESETS.flat.bands, []);
});

test("VOICE_EQ_PRESETS: preset names match tool definition enum", () => {
  const tool = TIER1_EDIT_TOOLS.find((t) => t.function.name === "mix_audio");
  const enumValues = tool.function.parameters.properties.voice_eq.enum;
  const presetKeys = Object.keys(VOICE_EQ_PRESETS).sort();
  assert.deepEqual(enumValues.sort(), presetKeys);
});

// =====================================================================
// 6. analyze_audio tool definition exists in EDIT_TOOLS
// =====================================================================

test("analyze_audio tool definition exists in EDIT_TOOLS", () => {
  const tool = EDIT_TOOLS.find((t) => t.function.name === "analyze_audio");
  assert.ok(tool, "analyze_audio should be in EDIT_TOOLS");
  assert.equal(tool.type, "function");
  assert.ok(tool.function.description.includes("loudness"));
  assert.ok(tool.function.parameters.properties.file_path);
  assert.ok(tool.function.parameters.required.includes("file_path"));
});

// =====================================================================
// 7. add_music tool definition exists in EDIT_TOOLS
// =====================================================================

test("add_music tool definition exists in EDIT_TOOLS", () => {
  const tool = EDIT_TOOLS.find((t) => t.function.name === "add_music");
  assert.ok(tool, "add_music should be in EDIT_TOOLS");
  assert.equal(tool.type, "function");
  assert.ok(tool.function.description.includes("ducking"));
  assert.ok(tool.function.parameters.required.includes("file_id"));
});

test("add_music: volume param is 0-1 range with default 0.2", () => {
  const tool = EDIT_TOOLS.find((t) => t.function.name === "add_music");
  const vol = tool.function.parameters.properties.volume;
  assert.equal(vol.minimum, 0);
  assert.equal(vol.maximum, 1);
  assert.equal(vol.default, 0.2);
});

// =====================================================================
// 8. Volume normalization params
// =====================================================================

test("mix_audio: normalize param is boolean, default false", () => {
  const tool = TIER1_EDIT_TOOLS.find((t) => t.function.name === "mix_audio");
  const norm = tool.function.parameters.properties.normalize;
  assert.equal(norm.type, "boolean");
  assert.equal(norm.default, false);
  assert.ok(norm.description.includes("LUFS"));
});

test("mix_audio: denoise param is boolean, default false", () => {
  const tool = TIER1_EDIT_TOOLS.find((t) => t.function.name === "mix_audio");
  const dn = tool.function.parameters.properties.denoise;
  assert.equal(dn.type, "boolean");
  assert.equal(dn.default, false);
});

test("mix_audio: voice_volume range is 0-2 in tool definition", () => {
  const tool = TIER1_EDIT_TOOLS.find((t) => t.function.name === "mix_audio");
  const vv = tool.function.parameters.properties.voice_volume;
  assert.equal(vv.minimum, 0);
  assert.equal(vv.maximum, 2);
  assert.equal(vv.default, 1.0);
});

test("mix_audio: music_volume range is 0-1 in tool definition", () => {
  const tool = TIER1_EDIT_TOOLS.find((t) => t.function.name === "mix_audio");
  const mv = tool.function.parameters.properties.music_volume;
  assert.equal(mv.minimum, 0);
  assert.equal(mv.maximum, 1);
  assert.equal(mv.default, 0.2);
});

test("mix_audio: duck_preset enum matches DUCK_PRESETS keys", () => {
  const tool = TIER1_EDIT_TOOLS.find((t) => t.function.name === "mix_audio");
  const enumValues = tool.function.parameters.properties.duck_preset.enum;
  assert.deepEqual(enumValues.sort(), Object.keys(DUCK_PRESETS).sort());
});
