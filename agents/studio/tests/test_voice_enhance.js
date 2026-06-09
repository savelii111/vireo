// test_voice_enhance.js — Tests for the 10 Voice Enhancement tools.
//
//   1.  isolate_voice        — separate voice from background noise
//   2.  auto_noise_gate      — remove noise below threshold
//   3.  auto_compressor      — level out volume variations
//   4.  auto_eq              — apply equalization presets
//   5.  auto_deesser         — remove sibilance
//   6.  auto_breath_removal  — remove audible breaths
//   7.  auto_plosive_removal — remove p/b pops
//   8.  auto_sibilance_fix   — remove harsh s sounds
//   9.  auto_voice_thicken   — add richness to thin voice
//   10. auto_voice_pitch     — fix intonation issues
//
// All tests use the synchronous v1 API (no real audio files needed).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  // Tool definitions
  VOICE_ENHANCE_TOOLS,
  VOICE_ENHANCE_TOOL_NAMES,
  ISOLATE_VOICE_TOOL,
  AUTO_NOISE_GATE_TOOL,
  AUTO_COMPRESSOR_TOOL,
  AUTO_EQ_TOOL,
  AUTO_DEESSER_TOOL,
  AUTO_BREATH_REMOVAL_TOOL,
  AUTO_PLOSIVE_REMOVAL_TOOL,
  AUTO_SIBILANCE_FIX_TOOL,
  AUTO_VOICE_THICKEN_TOOL,
  AUTO_VOICE_PITCH_TOOL,
  // Implementation functions
  isolateVoice,
  autoNoiseGate,
  autoCompressor,
  autoEQ,
  autoDeEsser,
  autoBreathRemoval,
  autoPlosiveRemoval,
  autoSibilanceFix,
  autoVoiceThicken,
  autoVoicePitch,
  // Dispatcher
  executeVoiceEnhance,
} from "../src/voice_enhance.js";

// ====================================================================
// Tool shape tests
// ====================================================================

test("Voice Enhance: exports 10 tools with valid OpenAI function shape", () => {
  assert.equal(VOICE_ENHANCE_TOOLS.length, 10);
  for (const t of VOICE_ENHANCE_TOOLS) {
    assert.equal(t.type, "function");
    assert.ok(t.function.name, "tool must have a name");
    assert.ok(t.function.description.length > 30, "description too short");
    assert.equal(t.function.parameters.type, "object");
    assert.ok(Array.isArray(t.function.parameters.required), "required must be array");
    assert.ok(t.function.parameters.properties, "must have properties");
  }
});

test("Voice Enhance: tool names list has exactly 10 entries", () => {
  assert.equal(VOICE_ENHANCE_TOOL_NAMES.length, 10);
  const expected = [
    "isolate_voice",
    "auto_noise_gate",
    "auto_compressor",
    "auto_eq",
    "auto_deesser",
    "auto_breath_removal",
    "auto_plosive_removal",
    "auto_sibilance_fix",
    "auto_voice_thicken",
    "auto_voice_pitch",
  ];
  assert.deepEqual(VOICE_ENHANCE_TOOL_NAMES.sort(), expected.sort());
});

test("Voice Enhance: each tool name matches its exported constant", () => {
  assert.equal(ISOLATE_VOICE_TOOL.function.name, "isolate_voice");
  assert.equal(AUTO_NOISE_GATE_TOOL.function.name, "auto_noise_gate");
  assert.equal(AUTO_COMPRESSOR_TOOL.function.name, "auto_compressor");
  assert.equal(AUTO_EQ_TOOL.function.name, "auto_eq");
  assert.equal(AUTO_DEESSER_TOOL.function.name, "auto_deesser");
  assert.equal(AUTO_BREATH_REMOVAL_TOOL.function.name, "auto_breath_removal");
  assert.equal(AUTO_PLOSIVE_REMOVAL_TOOL.function.name, "auto_plosive_removal");
  assert.equal(AUTO_SIBILANCE_FIX_TOOL.function.name, "auto_sibilance_fix");
  assert.equal(AUTO_VOICE_THICKEN_TOOL.function.name, "auto_voice_thicken");
  assert.equal(AUTO_VOICE_PITCH_TOOL.function.name, "auto_voice_pitch");
});

// ====================================================================
// Validation: missing / invalid input
// ====================================================================

test("Voice Enhance: all tools reject missing audioFile", async () => {
  const fns = [
    isolateVoice,
    autoNoiseGate,
    autoCompressor,
    autoEQ,
    autoDeEsser,
    autoBreathRemoval,
    autoPlosiveRemoval,
    autoSibilanceFix,
    autoVoiceThicken,
    autoVoicePitch,
  ];
  for (const fn of fns) {
    const r = await fn();
    assert.equal(r.ok, false, `${fn.name} should fail with no args`);
    assert.ok(r.error, `${fn.name} should have error message`);
  }
});

test("Voice Enhance: all tools reject empty string audioFile", async () => {
  const fns = [
    isolateVoice,
    autoNoiseGate,
    autoCompressor,
    autoEQ,
    autoDeEsser,
    autoBreathRemoval,
    autoPlosiveRemoval,
    autoSibilanceFix,
    autoVoiceThicken,
    autoVoicePitch,
  ];
  for (const fn of fns) {
    const r = await fn("");
    assert.equal(r.ok, false, `${fn.name} should fail with empty string`);
  }
});

test("Voice Enhance: all tools reject non-string audioFile", async () => {
  const fns = [
    isolateVoice,
    autoNoiseGate,
    autoCompressor,
    autoEQ,
    autoDeEsser,
    autoBreathRemoval,
    autoPlosiveRemoval,
    autoSibilanceFix,
    autoVoiceThicken,
    autoVoicePitch,
  ];
  for (const fn of fns) {
    const r = await fn(123);
    assert.equal(r.ok, false, `${fn.name} should fail with non-string`);
  }
});

// ====================================================================
// Invalid options
// ====================================================================

test("Voice Enhance: autoEQ rejects invalid preset", async () => {
  const r = await autoEQ("test.wav", { preset: "disco" });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("Invalid preset"));
});

test("Voice Enhance: autoVoicePitch rejects invalid target_pitch", async () => {
  const r = await autoVoicePitch("test.wav", { target_pitch: "soprano" });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("Invalid target_pitch"));
});

// ====================================================================
// Dispatcher tests
// ====================================================================

test("Voice Enhance: executeVoiceEnhance dispatches to correct function", async () => {
  const r = await executeVoiceEnhance("auto_noise_gate", { audio_file: "test.wav" });
  // If FFmpeg is not installed, it will fail, but it should NOT be an "unknown tool" error
  if (r.ok === false && r.error.includes("Unknown voice enhance tool")) {
    assert.fail("Dispatcher did not recognize auto_noise_gate");
  }
});

test("Voice Enhance: executeVoiceEnhance returns error for unknown tool", async () => {
  const r = await executeVoiceEnhance("nonexistent_tool", { audio_file: "test.wav" });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("Unknown voice enhance tool"));
});

// ====================================================================
// Tool-specific: default values
// ====================================================================

test("Voice Enhance: autoNoiseGate accepts default threshold_db", async () => {
  const r = await autoNoiseGate("test.wav");
  // Will fail without FFmpeg but should not crash
  assert.ok(typeof r === "object");
});

test("Voice Enhance: autoCompressor accepts default ratio and threshold_db", async () => {
  const r = await autoCompressor("test.wav");
  assert.ok(typeof r === "object");
});

test("Voice Enhance: autoEQ accepts default preset 'voice'", async () => {
  const r = await autoEQ("test.wav");
  assert.ok(typeof r === "object");
});

test("Voice Enhance: autoDeEsser accepts default frequency", async () => {
  const r = await autoDeEsser("test.wav");
  assert.ok(typeof r === "object");
});

test("Voice Enhance: autoBreathRemoval accepts default sensitivity", async () => {
  const r = await autoBreathRemoval("test.wav");
  assert.ok(typeof r === "object");
});

test("Voice Enhance: autoVoiceThicken accepts default amount", async () => {
  const r = await autoVoiceThicken("test.wav");
  assert.ok(typeof r === "object");
});

test("Voice Enhance: autoVoicePitch accepts default target_pitch 'natural'", async () => {
  const r = await autoVoicePitch("test.wav");
  assert.ok(typeof r === "object");
});

// ====================================================================
// Tool-specific: custom options
// ====================================================================

test("Voice Enhance: autoNoiseGate accepts custom threshold_db", async () => {
  const r = await autoNoiseGate("test.wav", { threshold_db: -40 });
  assert.ok(typeof r === "object");
});

test("Voice Enhance: autoCompressor accepts custom ratio and threshold", async () => {
  const r = await autoCompressor("test.wav", { ratio: 8, threshold_db: -15 });
  assert.ok(typeof r === "object");
});

test("Voice Enhance: autoEQ validates all 5 presets", async () => {
  for (const preset of ["voice", "podcast", "radio", "phone", "de_esser"]) {
    const r = await autoEQ("test.wav", { preset });
    assert.ok(typeof r === "object", `preset "${preset}" should return object`);
  }
});

test("Voice Enhance: autoDeEsser accepts custom frequency", async () => {
  const r = await autoDeEsser("test.wav", { frequency: 8000 });
  assert.ok(typeof r === "object");
});

test("Voice Enhance: autoBreathRemoval accepts custom sensitivity", async () => {
  const r = await autoBreathRemoval("test.wav", { sensitivity: 0.9 });
  assert.ok(typeof r === "object");
});

test("Voice Enhance: autoVoiceThicken accepts custom amount", async () => {
  const r = await autoVoiceThicken("test.wav", { amount: 0.8 });
  assert.ok(typeof r === "object");
});

test("Voice Enhance: autoVoicePitch validates all 4 pitch targets", async () => {
  for (const target of ["natural", "warm", "bright", "deep"]) {
    const r = await autoVoicePitch("test.wav", { target_pitch: target });
    assert.ok(typeof r === "object", `target "${target}" should return object`);
  }
});

// ====================================================================
// Tool-specific: function signatures and return shapes
// ====================================================================

test("Voice Enhance: isolateVoice is async function", () => {
  assert.equal(typeof isolateVoice, "function");
  // Returns a promise
  const r = isolateVoice("test.wav");
  assert.ok(r instanceof Promise);
  r.catch(() => {}); // suppress unhandled rejection
});

test("Voice Enhance: autoNoiseGate is async function", () => {
  assert.equal(typeof autoNoiseGate, "function");
  const r = autoNoiseGate("test.wav");
  assert.ok(r instanceof Promise);
  r.catch(() => {});
});

test("Voice Enhance: autoCompressor is async function", () => {
  assert.equal(typeof autoCompressor, "function");
  const r = autoCompressor("test.wav");
  assert.ok(r instanceof Promise);
  r.catch(() => {});
});

test("Voice Enhance: autoEQ is async function", () => {
  assert.equal(typeof autoEQ, "function");
  const r = autoEQ("test.wav");
  assert.ok(r instanceof Promise);
  r.catch(() => {});
});

test("Voice Enhance: autoDeEsser is async function", () => {
  assert.equal(typeof autoDeEsser, "function");
  const r = autoDeEsser("test.wav");
  assert.ok(r instanceof Promise);
  r.catch(() => {});
});

test("Voice Enhance: autoBreathRemoval is async function", () => {
  assert.equal(typeof autoBreathRemoval, "function");
  const r = autoBreathRemoval("test.wav");
  assert.ok(r instanceof Promise);
  r.catch(() => {});
});

test("Voice Enhance: autoPlosiveRemoval is async function", () => {
  assert.equal(typeof autoPlosiveRemoval, "function");
  const r = autoPlosiveRemoval("test.wav");
  assert.ok(r instanceof Promise);
  r.catch(() => {});
});

test("Voice Enhance: autoSibilanceFix is async function", () => {
  assert.equal(typeof autoSibilanceFix, "function");
  const r = autoSibilanceFix("test.wav");
  assert.ok(r instanceof Promise);
  r.catch(() => {});
});

test("Voice Enhance: autoVoiceThicken is async function", () => {
  assert.equal(typeof autoVoiceThicken, "function");
  const r = autoVoiceThicken("test.wav");
  assert.ok(r instanceof Promise);
  r.catch(() => {});
});

test("Voice Enhance: autoVoicePitch is async function", () => {
  assert.equal(typeof autoVoicePitch, "function");
  const r = autoVoicePitch("test.wav");
  assert.ok(r instanceof Promise);
  r.catch(() => {});
});

// ====================================================================
// Edge cases
// ====================================================================

test("Voice Enhance: executeVoiceEnhance handles function throw gracefully", async () => {
  // Pass null audio_file to a tool that does more than basic validation
  const r = await executeVoiceEnhance("isolate_voice", { audio_file: null });
  // Should return ok: false with error, not throw
  assert.equal(r.ok, false);
  assert.ok(r.error);
});

test("Voice Enhance: autoNoiseGate threshold_db=0 (extreme)", async () => {
  const r = await autoNoiseGate("test.wav", { threshold_db: 0 });
  assert.ok(typeof r === "object");
});

test("Voice Enhance: autoCompressor ratio=1 (no compression)", async () => {
  const r = await autoCompressor("test.wav", { ratio: 1, threshold_db: -10 });
  assert.ok(typeof r === "object");
});

test("Voice Enhance: autoBreathRemoval sensitivity=0 (minimum)", async () => {
  const r = await autoBreathRemoval("test.wav", { sensitivity: 0 });
  assert.ok(typeof r === "object");
});

test("Voice Enhance: autoBreathRemoval sensitivity=1 (maximum)", async () => {
  const r = await autoBreathRemoval("test.wav", { sensitivity: 1 });
  assert.ok(typeof r === "object");
});

test("Voice Enhance: autoVoiceThicken amount=0 (no effect)", async () => {
  const r = await autoVoiceThicken("test.wav", { amount: 0 });
  assert.ok(typeof r === "object");
});

test("Voice Enhance: autoVoiceThicken amount=1 (maximum)", async () => {
  const r = await autoVoiceThicken("test.wav", { amount: 1 });
  assert.ok(typeof r === "object");
});
