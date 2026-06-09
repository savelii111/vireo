// test_music_sfx.js — Tests for the 10 Music & SFX tools.
//
//   1. autoSelectMusic        — mood-based music matching
//   2. autoDuckMusic          — voice/music auto-ducking
//   3. autoLoopMusic          — seamless music looping
//   4. autoMusicFade          — smooth fade in/out curves
//   5. autoSFXPlacement       — smart sound effect placement
//   6. autoBeatMarkers        — beat detection & BPM analysis
//   7. autoTempoSync          — video cuts to music tempo sync
//   8. autoChordProgression   — chord analysis & progression detection
//   9. autoHarmony            — vocal harmony generation
//  10. autoReverbMatch        — reverb space matching
//
// All return {ok, ...} and use heuristic v1.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MUSIC_SFX_TOOLS,
  MUSIC_SFX_TOOL_NAMES,
  autoSelectMusic,
  autoDuckMusic,
  autoLoopMusic,
  autoMusicFade,
  autoSFXPlacement,
  autoBeatMarkers,
  autoTempoSync,
  autoChordProgression,
  autoHarmony,
  autoReverbMatch,
} from "../src/music_sfx.js";

// ---------- Tool shape ----------

test("MusicSFX: 10 tools exported with valid OpenAI shape", () => {
  assert.equal(MUSIC_SFX_TOOLS.length, 10);
  for (const t of MUSIC_SFX_TOOLS) {
    assert.equal(t.type, "function");
    assert.ok(t.function.name);
    assert.ok(t.function.description.length > 50);
    assert.equal(t.function.parameters.type, "object");
  }
  const names = MUSIC_SFX_TOOLS.map((t) => t.function.name).sort();
  assert.deepEqual(names, [
    "auto_beat_markers",
    "auto_chord_progression",
    "auto_duck_music",
    "auto_harmony",
    "auto_loop_music",
    "auto_music_fade",
    "auto_reverb_match",
    "auto_select_music",
    "auto_sfx_placement",
    "auto_tempo_sync",
  ]);
});

test("MusicSFX: MUSIC_SFX_TOOL_NAMES set has 10 names", () => {
  assert.equal(MUSIC_SFX_TOOL_NAMES.size, 10);
});

// ---------- 1. autoSelectMusic ----------

test("autoSelectMusic: returns valid selection for upbeat mood", async () => {
  const r = await autoSelectMusic(60, { mood: "upbeat" });
  assert.equal(r.ok, true);
  assert.ok(r.track);
  assert.ok(r.track.id);
  assert.ok(r.track.name);
  assert.equal(r.track.mood, "upbeat");
  assert.ok(r.bpm >= 100 && r.bpm <= 140);
  assert.ok(r.energy_match_score >= 0 && r.energy_match_score <= 1);
  assert.ok(r.duration_fit);
});

test("autoSelectMusic: works with default options", async () => {
  const r = await autoSelectMusic(120);
  assert.equal(r.ok, true);
  assert.equal(r.track.mood, "upbeat");
  // When genre='any', tool resolves to the best-matching genre
  assert.ok(r.track.genre);
  assert.ok(r.track.genre !== "any");
});

test("autoSelectMusic: returns error for zero duration", async () => {
  const r = await autoSelectMusic(0);
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_video_duration");
});

test("autoSelectMusic: returns error for invalid mood", async () => {
  const r = await autoSelectMusic(60, { mood: "invalid" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_mood");
});

test("autoSelectMusic: returns error for invalid genre", async () => {
  const r = await autoSelectMusic(60, { genre: "invalid" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_genre");
});

test("autoSelectMusic: specific genre selection works", async () => {
  const r = await autoSelectMusic(60, { mood: "chill", genre: "ambient" });
  assert.equal(r.ok, true);
  assert.equal(r.track.genre, "ambient");
});

test("autoSelectMusic: loops when track shorter than video", async () => {
  const r = await autoSelectMusic(300, { mood: "upbeat" });
  assert.equal(r.ok, true);
  assert.ok(r.duration_fit);
});

// ---------- 2. autoDuckMusic ----------

test("autoDuckMusic: returns valid ducking recipe", async () => {
  const r = await autoDuckMusic(
    { file_path: "/tmp/voice.wav", duration_sec: 60, segments: [{ start_sec: 5, end_sec: 15 }] },
    { file_path: "/tmp/music.wav" },
    { duckLevel_db: -12, attack_ms: 200 }
  );
  assert.equal(r.ok, true);
  assert.ok(r.mixed);
  assert.ok(Array.isArray(r.duck_events));
  assert.ok(r.duck_events.length > 0);
  assert.equal(r.duck_events[0].duck_level_db, -12);
  assert.ok(r.ffmpeg_filter);
});

test("autoDuckMusic: returns error without voiceTrack", async () => {
  const r = await autoDuckMusic(null, { file_path: "/tmp/music.wav" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "voiceTrack_required");
});

test("autoDuckMusic: returns error without musicTrack", async () => {
  const r = await autoDuckMusic({ file_path: "/tmp/voice.wav" }, null);
  assert.equal(r.ok, false);
  assert.equal(r.error, "musicTrack_required");
});

test("autoDuckMusic: returns error for invalid duck level", async () => {
  const r = await autoDuckMusic(
    { file_path: "/tmp/voice.wav" },
    { file_path: "/tmp/music.wav" },
    { duckLevel_db: 5 }
  );
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_duck_level");
});

test("autoDuckMusic: generates synthetic events when no segments", async () => {
  const r = await autoDuckMusic(
    { file_path: "/tmp/voice.wav", duration_sec: 30 },
    { file_path: "/tmp/music.wav" }
  );
  assert.equal(r.ok, true);
  assert.ok(r.duck_events.length > 0);
});

// ---------- 3. autoLoopMusic ----------

test("autoLoopMusic: returns valid loop recipe", async () => {
  const r = await autoLoopMusic(
    { file_path: "/tmp/music.wav", duration_sec: 30 },
    90
  );
  assert.equal(r.ok, true);
  assert.ok(r.looped);
  assert.ok(r.loop_count >= 3);
  assert.ok(Array.isArray(r.crossfade_points));
  assert.ok(r.crossfade_points.length > 0);
});

test("autoLoopMusic: returns error without musicTrack", async () => {
  const r = await autoLoopMusic(null, 60);
  assert.equal(r.ok, false);
  assert.equal(r.error, "musicTrack_required");
});

test("autoLoopMusic: returns error for zero target duration", async () => {
  const r = await autoLoopMusic({ file_path: "/tmp/music.wav", duration_sec: 30 }, 0);
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_target_duration");
});

test("autoLoopMusic: single loop when track is long enough", async () => {
  const r = await autoLoopMusic(
    { file_path: "/tmp/music.wav", duration_sec: 120 },
    60
  );
  assert.equal(r.ok, true);
  assert.equal(r.loop_count, 1);
  assert.equal(r.crossfade_points.length, 0);
});

// ---------- 4. autoMusicFade ----------

test("autoMusicFade: returns valid fade recipe", async () => {
  const r = await autoMusicFade(
    { file_path: "/tmp/music.wav", duration_sec: 60 },
    { fadeIn_sec: 2, fadeOut_sec: 3 }
  );
  assert.equal(r.ok, true);
  assert.ok(r.faded);
  assert.equal(r.fadeIn_curve.duration_sec, 2);
  assert.equal(r.fadeOut_curve.duration_sec, 3);
  assert.ok(r.ffmpeg_filter);
  assert.ok(r.fadeIn_curve.type);
  assert.ok(r.fadeOut_curve.type);
});

test("autoMusicFade: returns error without musicTrack", async () => {
  const r = await autoMusicFade(null);
  assert.equal(r.ok, false);
  assert.equal(r.error, "musicTrack_required");
});

test("autoMusicFade: returns error for invalid fadeIn", async () => {
  const r = await autoMusicFade({ file_path: "/tmp/music.wav" }, { fadeIn_sec: 50 });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_fadeIn");
});

test("autoMusicFade: works with zero fade in", async () => {
  const r = await autoMusicFade(
    { file_path: "/tmp/music.wav", duration_sec: 60 },
    { fadeIn_sec: 0, fadeOut_sec: 2 }
  );
  assert.equal(r.ok, true);
  assert.equal(r.faded.has_fade_in, false);
  assert.equal(r.faded.has_fade_out, true);
});

// ---------- 5. autoSFXPlacement ----------

test("autoSFXPlacement: returns valid SFX timeline", async () => {
  const r = await autoSFXPlacement(
    {
      events: [
        { type: "cut", time_sec: 5 },
        { type: "transition", time_sec: 15 },
        { type: "impact", time_sec: 25 },
      ],
      duration_sec: 60,
    },
    { intensity: "medium" }
  );
  assert.equal(r.ok, true);
  assert.ok(r.sfx_added);
  assert.ok(Array.isArray(r.placement_points));
  assert.ok(r.total_sfx_count > 0);
});

test("autoSFXPlacement: returns error without videoTimeline", async () => {
  const r = await autoSFXPlacement(null);
  assert.equal(r.ok, false);
  assert.equal(r.error, "videoTimeline_required");
});

test("autoSFXPlacement: returns error for invalid intensity", async () => {
  const r = await autoSFXPlacement(
    { events: [], duration_sec: 30 },
    { intensity: "extreme" }
  );
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_intensity");
});

test("autoSFXPlacement: high intensity adds more ambient SFX", async () => {
  const low = await autoSFXPlacement({ events: [], duration_sec: 30 }, { intensity: "low" });
  const high = await autoSFXPlacement({ events: [], duration_sec: 30 }, { intensity: "high" });
  assert.ok(high.total_sfx_count > low.total_sfx_count);
});

test("autoSFXPlacement: sorts placement points by time", async () => {
  const r = await autoSFXPlacement(
    {
      events: [
        { type: "cut", time_sec: 20 },
        { type: "cut", time_sec: 5 },
      ],
      duration_sec: 30,
    },
    { intensity: "low" }
  );
  assert.equal(r.ok, true);
  for (let i = 1; i < r.placement_points.length; i++) {
    assert.ok(r.placement_points[i].time_sec >= r.placement_points[i - 1].time_sec);
  }
});

// ---------- 6. autoBeatMarkers ----------

test("autoBeatMarkers: returns valid beat markers", async () => {
  const r = await autoBeatMarkers(
    { file_path: "/tmp/music.wav", duration_sec: 10, bpm: 120 }
  );
  assert.equal(r.ok, true);
  assert.ok(Array.isArray(r.beats));
  assert.ok(r.beats.length > 0);
  assert.equal(r.bpm, 120);
  assert.ok(r.time_signature);
  assert.equal(r.time_signature.numerator, 4);
});

test("autoBeatMarkers: returns error without musicTrack", async () => {
  const r = await autoBeatMarkers(null);
  assert.equal(r.ok, false);
  assert.equal(r.error, "musicTrack_required");
});

test("autoBeatMarkers: downbeats have highest strength", async () => {
  const r = await autoBeatMarkers(
    { file_path: "/tmp/music.wav", duration_sec: 5, bpm: 120 }
  );
  assert.equal(r.ok, true);
  const downbeats = r.beats.filter(b => b.is_downbeat);
  const nonDownbeats = r.beats.filter(b => !b.is_downbeat);
  assert.ok(downbeats.length > 0);
  assert.ok(nonDownbeats.length > 0);
  const avgDownbeat = downbeats.reduce((s, b) => s + b.strength, 0) / downbeats.length;
  const avgNonDownbeat = nonDownbeats.reduce((s, b) => s + b.strength, 0) / nonDownbeats.length;
  assert.ok(avgDownbeat > avgNonDownbeat);
});

// ---------- 7. autoTempoSync ----------

test("autoTempoSync: returns synced cuts aligned to beats", async () => {
  const r = await autoTempoSync([0, 2.5, 5, 7.8], 120);
  assert.equal(r.ok, true);
  assert.ok(Array.isArray(r.synced_cuts));
  assert.equal(r.synced_cuts.length, 4);
  assert.equal(r.original_bpm, 120);
  assert.equal(r.adjusted_bpm, 120);
  assert.ok(r.beat_interval_sec > 0);
});

test("autoTempoSync: returns error for empty cuts", async () => {
  const r = await autoTempoSync([], 120);
  assert.equal(r.ok, false);
  assert.equal(r.error, "videoCuts_required");
});

test("autoTempoSync: returns error for invalid BPM", async () => {
  const r = await autoTempoSync([0, 5], 0);
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_bpm");
});

test("autoTempoSync: identifies downbeats correctly", async () => {
  const r = await autoTempoSync([0, 0.5, 1, 1.5], 120);
  assert.equal(r.ok, true);
  assert.equal(r.synced_cuts[0].beat_type, "downbeat");
});

// ---------- 8. autoChordProgression ----------

test("autoChordProgression: returns chord sequence", async () => {
  const r = await autoChordProgression(
    { file_path: "/tmp/music.wav", duration_sec: 16, key: "C", mode: "major" }
  );
  assert.equal(r.ok, true);
  assert.ok(Array.isArray(r.chords));
  assert.ok(r.chords.length >= 4);
  assert.equal(r.key, "C");
  assert.equal(r.mode, "major");
  assert.ok(r.chords[0].chord);
  assert.ok(typeof r.chords[0].start === "number");
  assert.ok(typeof r.chords[0].duration === "number");
});

test("autoChordProgression: returns error without musicTrack", async () => {
  const r = await autoChordProgression(null);
  assert.equal(r.ok, false);
  assert.equal(r.error, "musicTrack_required");
});

test("autoChordProgression: minor key progression", async () => {
  const r = await autoChordProgression(
    { file_path: "/tmp/music.wav", duration_sec: 16, key: "Am", mode: "minor" }
  );
  assert.equal(r.ok, true);
  assert.equal(r.key, "Am");
  assert.equal(r.mode, "minor");
  // Minor chords use lowercase roman numerals
  assert.ok(r.chords[0].chord.match(/^[iiv]/));
});

test("autoChordProgression: blues progression with genre", async () => {
  const r = await autoChordProgression(
    { file_path: "/tmp/music.wav", duration_sec: 20, key: "G", mode: "major", genre: "blues" }
  );
  assert.equal(r.ok, true);
  assert.ok(r.total_chords >= 6);
});

// ---------- 9. autoHarmony ----------

test("autoHarmony: returns valid thirds harmony", async () => {
  const r = await autoHarmony(
    { file_path: "/tmp/vocals.wav" },
    { style: "thirds" }
  );
  assert.equal(r.ok, true);
  assert.ok(r.harmony_track);
  assert.equal(r.interval_used.name, "Major Third");
  assert.equal(r.interval_used.semitones, 4);
  assert.ok(typeof r.mix_level_db === "number");
  assert.ok(r.ffmpeg_filter);
});

test("autoHarmony: returns error without voiceTrack", async () => {
  const r = await autoHarmony(null);
  assert.equal(r.ok, false);
  assert.equal(r.error, "voiceTrack_required");
});

test("autoHarmony: returns error for invalid style", async () => {
  const r = await autoHarmony({ file_path: "/tmp/v.wav" }, { style: "fourths" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_style");
});

test("autoHarmony: fifths harmony has correct interval", async () => {
  const r = await autoHarmony(
    { file_path: "/tmp/vocals.wav" },
    { style: "fifths" }
  );
  assert.equal(r.ok, true);
  assert.equal(r.interval_used.semitones, 7);
  assert.equal(r.interval_used.name, "Perfect Fifth");
});

test("autoHarmony: octaves harmony uses pan center", async () => {
  const r = await autoHarmony(
    { file_path: "/tmp/vocals.wav" },
    { style: "octaves" }
  );
  assert.equal(r.ok, true);
  assert.equal(r.interval_used.semitones, 12);
  assert.equal(r.harmony_track.pan, 0);
});

// ---------- 10. autoReverbMatch ----------

test("autoReverbMatch: returns valid studio reverb", async () => {
  const r = await autoReverbMatch(
    { file_path: "/tmp/audio.wav" },
    { targetSpace: "studio" }
  );
  assert.equal(r.ok, true);
  assert.ok(r.processed);
  assert.equal(r.reverb_type, "plate");
  assert.ok(r.decay_time_ms > 0);
  assert.ok(r.ffmpeg_filter);
  assert.ok(r.ffmpeg_filter.includes("freeverb"));
});

test("autoReverbMatch: returns error without audioFile", async () => {
  const r = await autoReverbMatch(null);
  assert.equal(r.ok, false);
  assert.equal(r.error, "audioFile_required");
});

test("autoReverbMatch: returns error for invalid space", async () => {
  const r = await autoReverbMatch({ file_path: "/tmp/a.wav" }, { targetSpace: "space_station" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_targetSpace");
});

test("autoReverbMatch: cathedral has longest decay", async () => {
  const studio = await autoReverbMatch({ file_path: "/tmp/a.wav" }, { targetSpace: "studio" });
  const cathedral = await autoReverbMatch({ file_path: "/tmp/a.wav" }, { targetSpace: "cathedral" });
  assert.ok(cathedral.decay_time_ms > studio.decay_time_ms);
});

test("autoReverbMatch: outdoor has minimal reverb", async () => {
  const r = await autoReverbMatch({ file_path: "/tmp/a.wav" }, { targetSpace: "outdoor" });
  assert.equal(r.ok, true);
  assert.ok(r.wet_level_db < -18); // Very dry
});

// ---------- Cross-tool integration ----------

test("Integration: select music then get beat markers", async () => {
  const music = await autoSelectMusic(60, { mood: "upbeat", genre: "pop" });
  assert.equal(music.ok, true);

  const beats = await autoBeatMarkers({
    file_path: `/tmp/${music.track.name}.wav`,
    duration_sec: 60,
    bpm: music.bpm,
  });
  assert.equal(beats.ok, true);
  assert.ok(beats.beats.length > 0);
});

test("Integration: beat markers feed into tempo sync", async () => {
  const beats = await autoBeatMarkers(
    { file_path: "/tmp/music.wav", duration_sec: 10, bpm: 120 }
  );
  assert.equal(beats.ok, true);

  const videoCuts = [0.5, 1.2, 2.0, 2.8];
  const synced = await autoTempoSync(videoCuts, beats.bpm);
  assert.equal(synced.ok, true);
  assert.equal(synced.beat_interval_sec, 0.5);
});
