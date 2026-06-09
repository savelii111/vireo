// test_audio_generation.js — Tests for the 10 Audio Generation tools.
//
//   1.  generate_music      — AI music generation (Suno/Udio)
//   2.  generate_sfx        — Sound effects generation
//   3.  generate_tts        — Text-to-speech (ElevenLabs)
//   4.  clone_voice         — Clone voice from reference audio
//   5.  continue_music      — Extend existing music track
//   6.  separate_stems      — Separate audio into stems
//   7.  remove_vocals       — Extract instrumental version
//   8.  change_tempo        — Time-stretch to target BPM
//   9.  change_key          — Pitch-shift to target key
//  10.  generate_harmony    — Generate vocal harmonies
//
// All tests use the synchronous v1 API (no real neural backends needed).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  // Tool definitions
  AUDIO_GENERATION_TOOLS,
  AUDIO_GENERATION_TOOL_NAMES,
  GENERATE_MUSIC_TOOL,
  GENERATE_SFX_TOOL,
  GENERATE_TTS_TOOL,
  CLONE_VOICE_TOOL,
  CONTINUE_MUSIC_TOOL,
  SEPARATE_STEMS_TOOL,
  REMOVE_VOCALS_TOOL,
  CHANGE_TEMPO_TOOL,
  CHANGE_KEY_TOOL,
  GENERATE_HARMONY_TOOL,
  // Implementation functions
  generateMusic,
  generateSFX,
  generateTTS,
  cloneVoice,
  continueMusic,
  separateStems,
  removeVocals,
  changeTempo,
  changeKey,
  generateHarmony,
  // Dispatcher
  executeAudioGeneration,
} from "../src/audio_generation.js";

// ====================================================================
// Tool shape tests
// ====================================================================

test("Audio Generation: exports 10 tools with valid OpenAI function shape", () => {
  assert.equal(AUDIO_GENERATION_TOOLS.length, 10);
  for (const t of AUDIO_GENERATION_TOOLS) {
    assert.equal(t.type, "function");
    assert.ok(t.function.name, "tool must have a name");
    assert.ok(t.function.description.length > 30, "description too short");
    assert.equal(t.function.parameters.type, "object");
    assert.ok(t.function.parameters.properties, "must have properties");
  }
});

test("Audio Generation: TOOL_NAMES set has 10 entries", () => {
  assert.equal(AUDIO_GENERATION_TOOL_NAMES.size, 10);
});

test("Audio Generation: all tool names are unique", () => {
  const names = AUDIO_GENERATION_TOOLS.map((t) => t.function.name);
  assert.equal(new Set(names).size, names.length);
});

test("Audio Generation: all 10 tool definitions are individually importable", () => {
  const defs = [
    GENERATE_MUSIC_TOOL,
    GENERATE_SFX_TOOL,
    GENERATE_TTS_TOOL,
    CLONE_VOICE_TOOL,
    CONTINUE_MUSIC_TOOL,
    SEPARATE_STEMS_TOOL,
    REMOVE_VOCALS_TOOL,
    CHANGE_TEMPO_TOOL,
    CHANGE_KEY_TOOL,
    GENERATE_HARMONY_TOOL,
  ];
  assert.equal(defs.length, 10);
  for (const d of defs) {
    assert.equal(d.type, "function");
  }
});

// ====================================================================
// generateMusic tests
// ====================================================================

test("generateMusic: generates with default genre and mood", () => {
  const r = generateMusic({ prompt: "upbeat pop song" });
  assert.equal(r.ok, true);
  assert.ok(r.url);
  assert.ok(r.job_id.startsWith("genmusic-"));
  assert.equal(r.genre, "pop");
  assert.equal(r.mood, "upbeat");
  assert.equal(r.duration_sec, 30);
  assert.ok(typeof r.bpm === "number");
  assert.ok(r.key);
});

test("generateMusic: accepts custom duration, genre, and mood", () => {
  const r = generateMusic({
    prompt: "dark ambient atmosphere",
    duration_sec: 120,
    genre: "ambient",
    mood: "dark",
  });
  assert.equal(r.ok, true);
  assert.equal(r.duration_sec, 120);
  assert.equal(r.genre, "ambient");
  assert.equal(r.mood, "dark");
  assert.ok(r.bpm >= 40 && r.bpm <= 240);
});

test("generateMusic: rejects missing prompt", () => {
  const r = generateMusic({});
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("prompt"));
});

test("generateMusic: rejects empty prompt", () => {
  const r = generateMusic({ prompt: "   " });
  assert.equal(r.ok, false);
});

test("generateMusic: rejects invalid genre", () => {
  const r = generateMusic({ prompt: "test", genre: "reggaeton" });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("genre"));
});

test("generateMusic: rejects invalid mood", () => {
  const r = generateMusic({ prompt: "test", mood: "funky" });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("mood"));
});

test("generateMusic: rejects out-of-range duration", () => {
  const r = generateMusic({ prompt: "test", duration_sec: 0 });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("duration_sec"));
});

// ====================================================================
// generateSFX tests
// ====================================================================

test("generateSFX: generates with default duration", () => {
  const r = generateSFX({ prompt: "thunder crack" });
  assert.equal(r.ok, true);
  assert.ok(r.url);
  assert.ok(r.job_id.startsWith("gensfx-"));
  assert.equal(r.duration_sec, 2);
  assert.ok(r.category);
  assert.ok(typeof r.volume_db === "number");
});

test("generateSFX: auto-categorizes nature sounds", () => {
  const r = generateSFX({ prompt: "rain falling on leaves" });
  assert.equal(r.ok, true);
  assert.equal(r.category, "nature");
});

test("generateSFX: auto-categorizes UI sounds", () => {
  const r = generateSFX({ prompt: "button click notification" });
  assert.equal(r.ok, true);
  assert.equal(r.category, "ui");
});

test("generateSFX: rejects missing prompt", () => {
  const r = generateSFX({});
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("prompt"));
});

test("generateSFX: rejects out-of-range duration", () => {
  const r = generateSFX({ prompt: "test", duration_sec: 100 });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("duration_sec"));
});

// ====================================================================
// generateTTS tests
// ====================================================================

test("generateTTS: generates with defaults", () => {
  const r = generateTTS({ text: "Hello world" });
  assert.equal(r.ok, true);
  assert.ok(r.url);
  assert.ok(r.job_id.startsWith("tts-"));
  assert.equal(r.word_count, 2);
  assert.equal(r.emotion, "neutral");
  assert.equal(r.voice_name, "default");
  assert.ok(r.duration_sec > 0);
});

test("generateTTS: accepts all options", () => {
  const r = generateTTS({
    text: "This is a test of the emergency broadcast system",
    voice: "shimmer",
    speed: 1.5,
    emotion: "dramatic",
  });
  assert.equal(r.ok, true);
  assert.equal(r.voice_name, "shimmer");
  assert.equal(r.emotion, "dramatic");
  assert.ok(r.duration_sec > 0);
});

test("generateTTS: rejects missing text", () => {
  const r = generateTTS({});
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("text"));
});

test("generateTTS: rejects invalid voice", () => {
  const r = generateTTS({ text: "test", voice: "robot" });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("voice"));
});

test("generateTTS: rejects out-of-range speed", () => {
  const r = generateTTS({ text: "test", speed: 5.0 });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("speed"));
});

// ====================================================================
// cloneVoice tests
// ====================================================================

test("cloneVoice: clones with valid inputs", () => {
  const r = cloneVoice({ reference_audio: "sample.wav", text: "Hello from the clone" });
  assert.equal(r.ok, true);
  assert.ok(r.url);
  assert.ok(r.job_id.startsWith("voiceclone-"));
  assert.ok(typeof r.similarity_score === "number");
  assert.ok(typeof r.naturalness === "number");
  assert.ok(r.duration_sec > 0);
});

test("cloneVoice: rejects missing reference_audio", () => {
  const r = cloneVoice({ text: "test" });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("reference_audio"));
});

test("cloneVoice: rejects missing text", () => {
  const r = cloneVoice({ reference_audio: "sample.wav" });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("text"));
});

// ====================================================================
// continueMusic tests
// ====================================================================

test("continueMusic: extends music with valid inputs", () => {
  const r = continueMusic({ music_file: "track.wav", extend_duration: 30 });
  assert.equal(r.ok, true);
  assert.ok(r.url);
  assert.ok(r.job_id.startsWith("continuemusic-"));
  assert.ok(typeof r.original_duration === "number");
  assert.equal(r.new_duration, Math.round((r.original_duration + 30) * 10) / 10);
  assert.ok(typeof r.seam_quality === "number");
});

test("continueMusic: rejects missing music_file", () => {
  const r = continueMusic({ extend_duration: 30 });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("music_file"));
});

test("continueMusic: rejects out-of-range extend_duration", () => {
  const r = continueMusic({ music_file: "track.wav", extend_duration: 500 });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("extend_duration"));
});

// ====================================================================
// separateStems tests
// ====================================================================

test("separateStems: separates into 4 stems", () => {
  const r = separateStems({ audio_file: "mixed_song.mp3" });
  assert.equal(r.ok, true);
  assert.ok(r.vocals_url);
  assert.ok(r.drums_url);
  assert.ok(r.bass_url);
  assert.ok(r.other_url);
  assert.ok(r.job_id.startsWith("stems-"));
  assert.ok(typeof r.separation_quality === "number");
});

test("separateStems: rejects missing audio_file", () => {
  const r = separateStems({});
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("audio_file"));
});

// ====================================================================
// removeVocals tests
// ====================================================================

test("removeVocals: produces instrumental", () => {
  const r = removeVocals({ audio_file: "vocal_track.wav" });
  assert.equal(r.ok, true);
  assert.ok(r.url);
  assert.ok(r.job_id.startsWith("vocalremoval-"));
  assert.ok(typeof r.vocal_removal_quality === "number");
  assert.ok(r.frequency_range);
  assert.ok(r.frequency_range.low_hz === 80);
  assert.ok(r.frequency_range.high_hz === 12000);
});

test("removeVocals: rejects missing audio_file", () => {
  const r = removeVocals({});
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("audio_file"));
});

// ====================================================================
// changeTempo tests
// ====================================================================

test("changeTempo: changes BPM with quality score", () => {
  const r = changeTempo({ audio_file: "song.mp3", target_bpm: 128 });
  assert.equal(r.ok, true);
  assert.ok(r.url);
  assert.ok(r.job_id.startsWith("tempochange-"));
  assert.equal(r.new_bpm, 128);
  assert.ok(typeof r.original_bpm === "number");
  assert.ok(typeof r.quality_score === "number");
  assert.ok(r.quality_score >= 0.4 && r.quality_score <= 1.0);
});

test("changeTempo: rejects out-of-range BPM", () => {
  const r = changeTempo({ audio_file: "song.mp3", target_bpm: 300 });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("target_bpm"));
});

// ====================================================================
// changeKey tests
// ====================================================================

test("changeKey: shifts to target key", () => {
  const r = changeKey({ audio_file: "vocal.wav", target_key: "Am" });
  assert.equal(r.ok, true);
  assert.ok(r.url);
  assert.ok(r.job_id.startsWith("keychange-"));
  assert.equal(r.new_key, "Am");
  assert.ok(typeof r.original_key === "string");
  assert.ok(typeof r.semitones_shifted === "number");
  assert.ok(r.semitones_shifted >= -6 && r.semitones_shifted <= 6);
});

test("changeKey: rejects invalid key", () => {
  const r = changeKey({ audio_file: "vocal.wav", target_key: "X" });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("target_key"));
});

// ====================================================================
// generateHarmony tests
// ====================================================================

test("generateHarmony: generates with thirds", () => {
  const r = generateHarmony({ audio_file: "vocal.wav", interval: "thirds" });
  assert.equal(r.ok, true);
  assert.ok(r.url);
  assert.ok(r.job_id.startsWith("harmony-"));
  assert.equal(r.interval_used, "thirds");
  assert.equal(r.harmony_count, 2);
  assert.equal(r.mix_level, 0.7);
});

test("generateHarmony: generates with fifths", () => {
  const r = generateHarmony({ audio_file: "vocal.wav", interval: "fifths" });
  assert.equal(r.ok, true);
  assert.equal(r.interval_used, "fifths");
  assert.equal(r.semitones_applied, 7);
});

test("generateHarmony: generates with octaves", () => {
  const r = generateHarmony({ audio_file: "vocal.wav", interval: "octaves" });
  assert.equal(r.ok, true);
  assert.equal(r.harmony_count, 1);
  assert.equal(r.semitones_applied, 12);
});

test("generateHarmony: accepts custom mix_level", () => {
  const r = generateHarmony({
    audio_file: "vocal.wav",
    interval: "custom",
    mix_level: 0.3,
  });
  assert.equal(r.ok, true);
  assert.equal(r.mix_level, 0.3);
});

test("generateHarmony: rejects invalid interval", () => {
  const r = generateHarmony({ audio_file: "vocal.wav", interval: "fourths" });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("interval"));
});

test("generateHarmony: rejects out-of-range mix_level", () => {
  const r = generateHarmony({ audio_file: "vocal.wav", interval: "thirds", mix_level: 1.5 });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("mix_level"));
});

// ====================================================================
// Dispatcher tests
// ====================================================================

test("executeAudioGeneration: dispatches all 10 tools", () => {
  const toolNames = [
    "generate_music", "generate_sfx", "generate_tts", "clone_voice",
    "continue_music", "separate_stems", "remove_vocals",
    "change_tempo", "change_key", "generate_harmony",
  ];
  const args = {
    generate_music: { prompt: "test" },
    generate_sfx: { prompt: "test" },
    generate_tts: { text: "test" },
    clone_voice: { reference_audio: "ref.wav", text: "test" },
    continue_music: { music_file: "track.wav", extend_duration: 10 },
    separate_stems: { audio_file: "mix.wav" },
    remove_vocals: { audio_file: "vocal.wav" },
    change_tempo: { audio_file: "song.wav", target_bpm: 120 },
    change_key: { audio_file: "song.wav", target_key: "C" },
    generate_harmony: { audio_file: "vocal.wav", interval: "thirds" },
  };
  for (const name of toolNames) {
    const r = executeAudioGeneration(name, args[name] || {});
    assert.equal(r.ok, true, `${name} should succeed`);
  }
});

test("executeAudioGeneration: rejects unknown tool name", () => {
  const r = executeAudioGeneration("generate_podcast");
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("Unknown"));
});

test("executeAudioGeneration: handles missing tool name", () => {
  const r = executeAudioGeneration(null);
  assert.equal(r.ok, false);
});

test("executeAudioGeneration: passes through validation errors", () => {
  const r = executeAudioGeneration("generate_music", { prompt: "" });
  assert.equal(r.ok, false);
  assert.ok(r.error);
});
