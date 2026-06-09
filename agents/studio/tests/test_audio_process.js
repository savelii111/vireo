// test_audio_process.js — Tests for Audio Processing module (2026-06-09).
//
// Validates:
//   1. All 10 tool definitions exist with valid OpenAI function-calling shape
//   2. autoTranscribe — happy path, language validation, segment structure
//   3. autoTranslate — translation with valid/invalid inputs
//   4. autoDubbing — dubbing with timing analysis
//   5. autoVoiceClone — clone with similarity/naturalness scores
//   6. autoTTS — voice selection, speed clamping
//   7. autoChapterGeneration — chapter detection from transcripts
//   8. autoPodcastExtract — audio extraction with format options
//   9. autoAudiogram — visualization styles
//  10. autoSoundDesign — ambient/foley placement
//  11. autoSpatialAudio — channel configurations
//  12. executeAudioProcessing dispatcher — all 10 tools + error cases

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  // Tool definitions
  AUTO_TRANSCRIBE_TOOL,
  AUTO_TRANSLATE_TOOL,
  AUTO_DUBBING_TOOL,
  AUTO_VOICE_CLONE_TOOL,
  AUTO_TTS_TOOL,
  AUTO_CHAPTER_GENERATION_TOOL,
  AUTO_PODCAST_EXTRACT_TOOL,
  AUTO_AUDIOGRAM_TOOL,
  AUTO_SOUND_DESIGN_TOOL,
  AUTO_SPATIAL_AUDIO_TOOL,
  // Tool definitions array
  AUDIO_PROCESS_TOOLS,
  AUDIO_PROCESS_TOOL_NAMES,
  // Processing functions
  autoTranscribe,
  autoTranslate,
  autoDubbing,
  autoVoiceClone,
  autoTTS,
  autoChapterGeneration,
  autoPodcastExtract,
  autoAudiogram,
  autoSoundDesign,
  autoSpatialAudio,
  // Dispatcher
  executeAudioProcessing,
} from "../src/audio_process.js";

// Helper: create a mock transcript for reuse
function makeTranscript(opts = {}) {
  const segments = opts.segments || [
    { start: 0, end: 5, text: "Welcome to this amazing presentation" },
    { start: 5, end: 10, text: "Where we explore the future" },
    { start: 10, end: 15, text: "Let us begin with a brief overview" },
    { start: 15, end: 20, text: "Conclusion and summary of the talk" },
  ];
  return {
    segments,
    language: opts.language || "en",
    duration: opts.duration || 20,
  };
}

// ====================================================================
// Tool definitions — shape validation
// ====================================================================

test("AUDIO_PROCESS_TOOLS contains all 10 tool definitions", () => {
  assert.equal(AUDIO_PROCESS_TOOLS.length, 10);
});

test("All tool definitions have valid OpenAI function-calling shape", () => {
  for (const tool of AUDIO_PROCESS_TOOLS) {
    assert.equal(tool.type, "function", `${tool.function?.name} missing type=function`);
    assert.ok(tool.function.name, `${tool.function?.name} missing function.name`);
    assert.ok(tool.function.description.length > 20, `${tool.function?.name} description too short`);
    assert.equal(tool.function.parameters.type, "object", `${tool.function?.name} missing parameters.type`);
    assert.ok(Array.isArray(tool.function.parameters.required), `${tool.function?.name} missing required array`);
  }
});

test("AUDIO_PROCESS_TOOL_NAMES has exactly 10 entries", () => {
  assert.equal(AUDIO_PROCESS_TOOL_NAMES.size, 10);
});

test("Tool names match expected set", () => {
  const expected = [
    "auto_transcribe", "auto_translate", "auto_dubbing", "auto_voice_clone",
    "auto_tts", "auto_chapter_generation", "auto_podcast_extract",
    "auto_audiogram", "auto_sound_design", "auto_spatial_audio",
  ];
  for (const name of expected) {
    assert.ok(AUDIO_PROCESS_TOOL_NAMES.has(name), `Missing tool: ${name}`);
  }
});

// ====================================================================
// 1. autoTranscribe
// ====================================================================

test("autoTranscribe: transcribes with default language (en)", () => {
  const r = autoTranscribe("/tmp/audio.mp3");
  assert.equal(r.ok, true);
  assert.equal(r.language, "en");
  assert.equal(r.language_name, "English");
  assert.ok(Array.isArray(r.segments));
  assert.ok(r.segments.length > 0);
  assert.equal(typeof r.duration, "number");
  assert.ok(r.duration > 0);
  assert.ok(r.job_id.startsWith("transcribe-"));
  assert.equal(r.file_id, "/tmp/audio.mp3");
});

test("autoTranscribe: transcribes with Spanish", () => {
  const r = autoTranscribe("/tmp/audio.mp3", { language: "es" });
  assert.equal(r.ok, true);
  assert.equal(r.language, "es");
  assert.equal(r.language_name, "Spanish");
  assert.ok(r.segments.length > 0);
});

test("autoTranscribe: all segments have start, end, text", () => {
  const r = autoTranscribe("/tmp/test.wav");
  assert.equal(r.ok, true);
  for (const seg of r.segments) {
    assert.equal(typeof seg.start, "number");
    assert.equal(typeof seg.end, "number");
    assert.equal(typeof seg.text, "string");
    assert.ok(seg.start < seg.end, `Segment start (${seg.start}) should be < end (${seg.end})`);
    assert.ok(seg.text.length > 0);
  }
});

test("autoTranscribe: rejects missing audioFile", () => {
  const r = autoTranscribe();
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("audioFile"));
});

test("autoTranscribe: rejects empty audioFile", () => {
  const r = autoTranscribe("");
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("audioFile"));
});

test("autoTranscribe: rejects invalid language", () => {
  const r = autoTranscribe("/tmp/x.mp3", { language: "xx" });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("Invalid language"));
});

test("autoTranscribe: returns model info", () => {
  const r = autoTranscribe("/tmp/test.wav");
  assert.equal(r.model, "large-v3");
});

// ====================================================================
// 2. autoTranslate
// ====================================================================

test("autoTranslate: translates to Spanish by default", () => {
  const t = makeTranscript();
  const r = autoTranslate(t);
  assert.equal(r.ok, true);
  assert.equal(r.targetLanguage, "es");
  assert.equal(r.target_language_name, "Spanish");
  assert.ok(Array.isArray(r.segments));
  assert.equal(r.segments.length, t.segments.length);
  assert.ok(r.confidence > 0 && r.confidence <= 1);
});

test("autoTranslate: segments have original and translated text", () => {
  const t = makeTranscript();
  const r = autoTranslate(t, { targetLanguage: "fr" });
  assert.equal(r.ok, true);
  assert.equal(r.targetLanguage, "fr");
  for (const seg of r.segments) {
    assert.equal(typeof seg.original, "string");
    assert.equal(typeof seg.text, "string");
    assert.ok(seg.text.length > 0);
    assert.equal(typeof seg.start, "number");
    assert.equal(typeof seg.end, "number");
  }
});

test("autoTranslate: preserves timing from source", () => {
  const t = makeTranscript();
  const r = autoTranslate(t, { targetLanguage: "de" });
  for (let i = 0; i < t.segments.length; i++) {
    assert.equal(r.segments[i].start, t.segments[i].start);
    assert.equal(r.segments[i].end, t.segments[i].end);
  }
});

test("autoTranslate: rejects invalid target language", () => {
  const t = makeTranscript();
  const r = autoTranslate(t, { targetLanguage: "zz" });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("Invalid target language"));
});

test("autoTranslate: rejects same source and target language", () => {
  const t = makeTranscript({ language: "es" });
  const r = autoTranslate(t, { targetLanguage: "es" });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("same"));
});

test("autoTranslate: rejects missing transcript", () => {
  const r = autoTranslate(null);
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("transcript"));
});

test("autoTranslate: rejects transcript without segments array", () => {
  const r = autoTranslate({ notSegments: [] });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("segments"));
});

// ====================================================================
// 3. autoDubbing
// ====================================================================

test("autoDubbing: dubs with valid inputs", () => {
  const t = makeTranscript();
  const translated = autoTranslate(t, { targetLanguage: "es" });
  const r = autoDubbing("/tmp/video.mp4", translated);
  assert.equal(r.ok, true);
  assert.equal(r.dubbed, true);
  assert.equal(typeof r.lip_sync_score, "number");
  assert.ok(r.lip_sync_score > 0 && r.lip_sync_score <= 1);
  assert.equal(typeof r.timing_matches, "number");
  assert.ok(r.timing_matches > 0);
  assert.equal(r.target_language, "es");
  assert.ok(r.output_file_id.startsWith("dubbed-"));
});

test("autoDubbing: rejects missing videoAudio", () => {
  const t = makeTranscript();
  const r = autoDubbing(null, t);
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("audioFile"));
});

test("autoDubbing: rejects invalid translatedTranscript", () => {
  const r = autoDubbing("/tmp/video.mp4", null);
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("transcript"));
});

// ====================================================================
// 4. autoVoiceClone
// ====================================================================

test("autoVoiceClone: clones voice with valid inputs", () => {
  const r = autoVoiceClone("/tmp/ref_voice.wav", "Hello world, this is a test.");
  assert.equal(r.ok, true);
  assert.ok(r.cloned_audio.startsWith("clone-"));
  assert.ok(r.cloned_audio.endsWith(".wav"));
  assert.equal(typeof r.similarity_score, "number");
  assert.ok(r.similarity_score > 0.8 && r.similarity_score <= 1);
  assert.equal(typeof r.naturalness_score, "number");
  assert.ok(r.naturalness_score > 0.7 && r.naturalness_score <= 1);
  assert.equal(r.word_count, 6);
  assert.ok(r.estimated_duration_sec > 0);
  assert.equal(r.sample_rate, 22050);
});

test("autoVoiceClone: rejects missing referenceAudio", () => {
  const r = autoVoiceClone("", "speak this");
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("audioFile"));
});

test("autoVoiceClone: rejects missing textToSpeak", () => {
  const r = autoVoiceClone("/tmp/ref.wav", "");
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("textToSpeak"));
});

test("autoVoiceClone: rejects null textToSpeak", () => {
  const r = autoVoiceClone("/tmp/ref.wav", null);
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("textToSpeak"));
});

// ====================================================================
// 5. autoTTS
// ====================================================================

test("autoTTS: synthesizes with defaults", () => {
  const r = autoTTS("Hello world");
  assert.equal(r.ok, true);
  assert.ok(r.audio.startsWith("tts-"));
  assert.equal(r.voice, "default");
  assert.equal(r.speed, 1.0);
  assert.equal(r.word_count, 2);
  assert.ok(r.duration_sec > 0);
  assert.equal(r.sample_rate, 24000);
});

test("autoTTS: uses custom voice and speed", () => {
  const r = autoTTS("Testing voice selection", { voice: "alloy", speed: 1.5 });
  assert.equal(r.ok, true);
  assert.equal(r.voice, "alloy");
  assert.equal(r.speed, 1.5);
  // Faster speed should produce shorter duration
  const rSlow = autoTTS("Testing voice selection", { voice: "alloy", speed: 0.5 });
  assert.ok(r.duration_sec < rSlow.duration_sec, "Faster speed should yield shorter duration");
});

test("autoTTS: clamps speed to valid range", () => {
  const rLow = autoTTS("test", { speed: 0.1 });
  assert.equal(rLow.ok, true);
  assert.equal(rLow.speed, 0.5); // clamped to min

  const rHigh = autoTTS("test", { speed: 5.0 });
  assert.equal(rHigh.ok, true);
  assert.equal(rHigh.speed, 2.0); // clamped to max
});

test("autoTTS: rejects missing text", () => {
  const r = autoTTS("");
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("text"));
});

test("autoTTS: rejects invalid voice", () => {
  const r = autoTTS("Hello", { voice: "robot_voice_9000" });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("Invalid voice"));
});

// ====================================================================
// 6. autoChapterGeneration
// ====================================================================

test("autoChapterGeneration: generates chapters from transcript", () => {
  const t = makeTranscript();
  const r = autoChapterGeneration(t);
  assert.equal(r.ok, true);
  assert.ok(Array.isArray(r.chapters));
  assert.ok(r.chapters.length > 0);
  assert.equal(typeof r.total_chapters, "number");
  assert.equal(typeof r.duration, "number");
});

test("autoChapterGeneration: chapters have correct structure", () => {
  const t = makeTranscript();
  const r = autoChapterGeneration(t);
  for (const ch of r.chapters) {
    assert.equal(typeof ch.time, "number");
    assert.equal(typeof ch.timestamp, "string");
    assert.ok(ch.timestamp.match(/^\d{2}:\d{2}$/), `Invalid timestamp: ${ch.timestamp}`);
    assert.equal(typeof ch.title, "string");
    assert.ok(ch.title.length > 0);
    assert.equal(typeof ch.description, "string");
    assert.equal(typeof ch.segment_index, "number");
  }
});

test("autoChapterGeneration: rejects missing transcript", () => {
  const r = autoChapterGeneration(null);
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("transcript"));
});

test("autoChapterGeneration: rejects empty segments", () => {
  const r = autoChapterGeneration({ segments: [], language: "en", duration: 0 });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("no segments"));
});

// ====================================================================
// 7. autoPodcastExtract
// ====================================================================

test("autoPodcastExtract: extracts with defaults (mp3)", () => {
  const r = autoPodcastExtract("/tmp/video.mp4");
  assert.equal(r.ok, true);
  assert.ok(r.podcast_audio.endsWith(".mp3"));
  assert.equal(r.format, "mp3");
  assert.ok(r.duration > 0);
  assert.equal(r.sample_rate, 44100);
  assert.equal(r.channels, 1);
  assert.equal(r.normalize, true);
  assert.ok(r.estimated_size_kb > 0);
});

test("autoPodcastExtract: supports wav format", () => {
  const r = autoPodcastExtract("/tmp/video.mp4", { format: "wav" });
  assert.equal(r.ok, true);
  assert.ok(r.podcast_audio.endsWith(".wav"));
  assert.equal(r.format, "wav");
});

test("autoPodcastExtract: supports flac format", () => {
  const r = autoPodcastExtract("/tmp/video.mp4", { format: "flac" });
  assert.equal(r.ok, true);
  assert.ok(r.podcast_audio.endsWith(".flac"));
});

test("autoPodcastExtract: respects normalize=false", () => {
  const r = autoPodcastExtract("/tmp/video.mp4", { normalize: false });
  assert.equal(r.ok, true);
  assert.equal(r.normalize, false);
});

test("autoPodcastExtract: rejects missing file", () => {
  const r = autoPodcastExtract("");
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("audioFile"));
});

test("autoPodcastExtract: rejects invalid format", () => {
  const r = autoPodcastExtract("/tmp/v.mp4", { format: "wma" });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("Invalid format"));
});

// ====================================================================
// 8. autoAudiogram
// ====================================================================

test("autoAudiogram: creates waveform by default", () => {
  const r = autoAudiogram("/tmp/audio.wav");
  assert.equal(r.ok, true);
  assert.ok(r.video.startsWith("audiogram-"));
  assert.equal(r.style, "waveform");
  assert.equal(r.fps, 30);
  assert.equal(r.resolution.width, 1080);
  assert.equal(r.resolution.height, 1080);
  assert.ok(r.params.color);
  assert.ok(r.params.description);
});

test("autoAudiogram: supports all 4 styles", () => {
  const styles = ["waveform", "spectrum", "bars", "circular"];
  for (const style of styles) {
    const r = autoAudiogram("/tmp/audio.wav", { style });
    assert.equal(r.ok, true, `${style} should succeed`);
    assert.equal(r.style, style);
    assert.ok(r.params, `${style} should have params`);
  }
});

test("autoAudiogram: rejects invalid style", () => {
  const r = autoAudiogram("/tmp/audio.wav", { style: "3d_hologram" });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("Invalid style"));
});

test("autoAudiogram: rejects missing file", () => {
  const r = autoAudiogram(undefined);
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("audioFile"));
});

// ====================================================================
// 9. autoSoundDesign
// ====================================================================

test("autoSoundDesign: processes scenes with ambient and foley", () => {
  const timeline = {
    scenes: [
      { start: 0, end: 10, type: "indoor" },
      { start: 10, end: 25, type: "outdoor" },
      { start: 25, end: 40, type: "city" },
    ],
  };
  const r = autoSoundDesign(timeline);
  assert.equal(r.ok, true);
  assert.ok(Array.isArray(r.ambient_tracks));
  assert.ok(r.ambient_tracks.length === 3);
  assert.ok(Array.isArray(r.foley_points));
  assert.ok(r.total_sfx > 0);
  assert.equal(r.scenes_processed, 3);
});

test("autoSoundDesign: ambient tracks have correct structure", () => {
  const timeline = {
    scenes: [{ start: 0, end: 15, type: "nature" }],
  };
  const r = autoSoundDesign(timeline);
  assert.equal(r.ok, true);
  for (const track of r.ambient_tracks) {
    assert.equal(typeof track.type, "string");
    assert.equal(typeof track.start, "number");
    assert.equal(typeof track.end, "number");
    assert.ok(track.end > track.start);
    assert.equal(typeof track.duration, "number");
    assert.equal(typeof track.volume, "number");
    assert.ok(track.volume > 0 && track.volume <= 1);
  }
});

test("autoSoundDesign: foley points have correct structure", () => {
  const timeline = {
    scenes: [{ start: 0, end: 20, type: "indoor" }],
  };
  const r = autoSoundDesign(timeline);
  assert.equal(r.ok, true);
  for (const f of r.foley_points) {
    assert.equal(typeof f.type, "string");
    assert.equal(typeof f.time, "number");
    assert.ok(f.time >= 0);
    assert.equal(typeof f.duration, "number");
    assert.ok(f.duration > 0);
    assert.equal(typeof f.volume, "number");
    assert.ok(f.volume > 0 && f.volume <= 1);
  }
});

test("autoSoundDesign: rejects missing timeline", () => {
  const r = autoSoundDesign(null);
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("videoTimeline"));
});

test("autoSoundDesign: rejects empty scenes", () => {
  const r = autoSoundDesign({ scenes: [] });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("non-empty"));
});

// ====================================================================
// 10. autoSpatialAudio
// ====================================================================

test("autoSpatialAudio: creates 5.1 mix by default", () => {
  const r = autoSpatialAudio("/tmp/stereo.wav");
  assert.equal(r.ok, true);
  assert.equal(r.processed, true);
  assert.equal(r.channel_config, "5.1");
  assert.equal(r.channel_count, 6);
  assert.equal(r.channel_layout, "L R C LFE Ls Rs");
  assert.equal(typeof r.spatial_score, "number");
  assert.ok(r.spatial_score > 0 && r.spatial_score <= 1);
  assert.ok(r.output_file_id.startsWith("spatial-"));
  assert.equal(r.sample_rate, 48000);
});

test("autoSpatialAudio: supports all channel configs", () => {
  const configs = ["stereo", "5.1", "7.1", "atmos"];
  for (const ch of configs) {
    const r = autoSpatialAudio("/tmp/audio.wav", { channels: ch });
    assert.equal(r.ok, true, `${ch} should succeed`);
    assert.equal(r.channel_config, ch);
    assert.equal(typeof r.channel_count, "number");
    assert.ok(r.channel_count >= 2);
    assert.ok(r.upmix_ratio > 0);
  }
});

test("autoSpatialAudio: Atmos has most channels", () => {
  const stereo = autoSpatialAudio("/tmp/a.wav", { channels: "stereo" });
  const atmos = autoSpatialAudio("/tmp/a.wav", { channels: "atmos" });
  assert.ok(atmos.channel_count > stereo.channel_count);
});

test("autoSpatialAudio: rejects missing file", () => {
  const r = autoSpatialAudio("");
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("audioFile"));
});

test("autoSpatialAudio: rejects invalid channels", () => {
  const r = autoSpatialAudio("/tmp/a.wav", { channels: "3.0" });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("Invalid channels"));
});

// ====================================================================
// executeAudioProcessing dispatcher
// ====================================================================

test("executeAudioProcessing: dispatches auto_transcribe correctly", () => {
  const r = executeAudioProcessing("auto_transcribe", { audioFile: "/tmp/t.wav" });
  assert.equal(r.ok, true);
  assert.ok(r.segments);
  assert.equal(r.language, "en");
});

test("executeAudioProcessing: dispatches auto_tts correctly", () => {
  const r = executeAudioProcessing("auto_tts", { text: "Hello world" });
  assert.equal(r.ok, true);
  assert.equal(r.word_count, 2);
});

test("executeAudioProcessing: dispatches all 10 tools by name", () => {
  const toolNames = [
    "auto_transcribe",
    "auto_translate",
    "auto_dubbing",
    "auto_voice_clone",
    "auto_tts",
    "auto_chapter_generation",
    "auto_podcast_extract",
    "auto_audiogram",
    "auto_sound_design",
    "auto_spatial_audio",
  ];
  for (const name of toolNames) {
    // Use minimal valid args for each
    let args;
    switch (name) {
      case "auto_transcribe":
        args = { audioFile: "/tmp/test.wav" };
        break;
      case "auto_translate":
        args = { transcript: makeTranscript(), targetLanguage: "fr" };
        break;
      case "auto_dubbing":
        args = { videoAudio: "/tmp/v.mp4", translatedTranscript: makeTranscript({ segments: [
          { start: 0, end: 5, text: "hola" }, { start: 5, end: 10, text: "mundo" },
        ]}) };
        break;
      case "auto_voice_clone":
        args = { referenceAudio: "/tmp/ref.wav", textToSpeak: "speak this" };
        break;
      case "auto_tts":
        args = { text: "hello" };
        break;
      case "auto_chapter_generation":
        args = { transcript: makeTranscript() };
        break;
      case "auto_podcast_extract":
        args = { videoAudio: "/tmp/v.mp4" };
        break;
      case "auto_audiogram":
        args = { audioFile: "/tmp/a.wav" };
        break;
      case "auto_sound_design":
        args = { videoTimeline: { scenes: [{ start: 0, end: 10, type: "indoor" }] } };
        break;
      case "auto_spatial_audio":
        args = { audioFile: "/tmp/a.wav" };
        break;
    }
    const r = executeAudioProcessing(name, args);
    assert.equal(r.ok, true, `${name} should succeed`);
  }
});

test("executeAudioProcessing: rejects unknown tool name", () => {
  const r = executeAudioProcessing("auto_magic_wand");
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("Unknown"));
});

test("executeAudioProcessing: handles missing tool name", () => {
  const r = executeAudioProcessing(null);
  assert.equal(r.ok, false);
});

test("executeAudioProcessing: passes through validation errors", () => {
  const r = executeAudioProcessing("auto_transcribe", { audioFile: "" });
  assert.equal(r.ok, false);
  assert.ok(r.error);
});

test("executeAudioProcessing: dispatches auto_translate with proper flow", () => {
  const t = makeTranscript();
  const r = executeAudioProcessing("auto_translate", {
    transcript: t,
    targetLanguage: "de",
  });
  assert.equal(r.ok, true);
  assert.equal(r.targetLanguage, "de");
  assert.ok(r.segments.length > 0);
});

test("executeAudioProcessing: dispatches auto_sound_design correctly", () => {
  const r = executeAudioProcessing("auto_sound_design", {
    videoTimeline: { scenes: [
      { start: 0, end: 10, type: "indoor" },
      { start: 10, end: 20, type: "outdoor" },
    ]},
  });
  assert.equal(r.ok, true);
  assert.equal(r.scenes_processed, 2);
  assert.ok(r.ambient_tracks.length === 2);
});
