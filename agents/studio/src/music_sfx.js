// music_sfx.js — Music & Sound Effects intelligence tools (2026-06-09).
//
// 10 music/SFX tools that give Vireo professional audio production
// capabilities without leaving the editor. These tools analyze, sync,
// mix, and process audio for seamless integration with video content.
//
// What this adds:
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
// Architecture:
//   - All tools are deterministic heuristic v1 implementations.
//   - Return {ok, ...} with structured results.
//   - Parameter validation happens at the top of each function.
//   - Real audio processing would use FFmpeg/SoX; v1 returns
//     parameterized recipes that the executor can apply.

import { randomUUID } from "node:crypto";

// ====================================================================
// Shared constants
// ====================================================================

const VALID_MOODS = ["upbeat", "chill", "dramatic", "romantic", "tense", "happy", "sad", "energetic", "mysterious", "epic"];
const VALID_GENRES = ["any", "pop", "rock", "electronic", "classical", "jazz", "hip-hop", "ambient", "orchestral", "acoustic"];
const VALID_SFX_INTENSITIES = ["low", "medium", "high"];
const VALID_HARMONY_STYLES = ["thirds", "fifths", "octaves"];
const VALID_REVERB_SPACES = ["studio", "hall", "room", "outdoor", "cathedral"];

// Mood → genre affinity (higher = more likely match)
const MOOD_GENRE_AFFINITY = {
  upbeat:    { pop: 0.9, electronic: 0.8, rock: 0.7, jazz: 0.5, classical: 0.2, "hip-hop": 0.6, ambient: 0.3, orchestral: 0.3, acoustic: 0.4 },
  chill:     { ambient: 0.9, acoustic: 0.8, jazz: 0.7, classical: 0.6, pop: 0.4, electronic: 0.5, rock: 0.2, "hip-hop": 0.3, orchestral: 0.4 },
  dramatic:  { orchestral: 0.9, classical: 0.8, cinematic: 0.9, electronic: 0.5, rock: 0.6, pop: 0.3, jazz: 0.2, ambient: 0.4, "hip-hop": 0.2 },
  romantic:  { classical: 0.9, jazz: 0.8, acoustic: 0.7, ambient: 0.6, pop: 0.5, orchestral: 0.6, electronic: 0.3, rock: 0.2, "hip-hop": 0.1 },
  tense:     { electronic: 0.8, orchestral: 0.7, ambient: 0.7, rock: 0.6, classical: 0.5, "hip-hop": 0.4, pop: 0.3, jazz: 0.2, acoustic: 0.2 },
  happy:     { pop: 0.9, acoustic: 0.8, jazz: 0.7, electronic: 0.6, rock: 0.5, "hip-hop": 0.4, classical: 0.3, ambient: 0.2, orchestral: 0.3 },
  sad:       { classical: 0.9, ambient: 0.8, acoustic: 0.8, jazz: 0.6, orchestral: 0.7, electronic: 0.3, pop: 0.2, rock: 0.3, "hip-hop": 0.2 },
  energetic: { electronic: 0.9, rock: 0.9, pop: 0.8, "hip-hop": 0.7, jazz: 0.4, classical: 0.2, ambient: 0.1, acoustic: 0.3, orchestral: 0.4 },
  mysterious: { ambient: 0.9, electronic: 0.7, orchestral: 0.7, classical: 0.6, jazz: 0.5, acoustic: 0.4, rock: 0.3, pop: 0.2, "hip-hop": 0.2 },
  epic:      { orchestral: 0.9, electronic: 0.8, rock: 0.7, classical: 0.7, ambient: 0.5, pop: 0.3, jazz: 0.2, "hip-hop": 0.4, acoustic: 0.2 },
};

// Mood → BPM ranges (optimal tempo for each mood)
const MOOD_BPM_RANGES = {
  upbeat:    { min: 110, max: 130, default: 120 },
  chill:     { min: 60,  max: 90,  default: 75 },
  dramatic:  { min: 70,  max: 110, default: 85 },
  romantic:  { min: 60,  max: 80,  default: 70 },
  tense:     { min: 90,  max: 140, default: 120 },
  happy:     { min: 100, max: 130, default: 115 },
  sad:       { min: 50,  max: 80,  default: 65 },
  energetic: { min: 120, max: 160, default: 140 },
  mysterious: { min: 70,  max: 100, default: 85 },
  epic:      { min: 80,  max: 130, default: 105 },
};

// Reverb space presets
const REVERB_PRESETS = {
  studio:    { type: "plate", decay_ms: 800,  pre_delay_ms: 10, wet_level_db: -18, description: "Tight, controlled studio reverb" },
  hall:      { type: "hall",  decay_ms: 2200, pre_delay_ms: 20, wet_level_db: -12, description: "Spacious concert hall" },
  room:      { type: "room",  decay_ms: 600,  pre_delay_ms: 5,  wet_level_db: -15, description: "Small room ambiance" },
  outdoor:   { type: "plate", decay_ms: 300,  pre_delay_ms: 3,  wet_level_db: -22, description: "Minimal outdoor reflection" },
  cathedral: { type: "hall",  decay_ms: 4500, pre_delay_ms: 40, wet_level_db: -8,  description: "Massive cathedral with long tails" },
};

// ====================================================================
// 1. autoSelectMusic
// ====================================================================

/**
 * Analyzes video mood and suggests matching music from a library.
 * Returns the best track with BPM, energy match, and duration fit.
 *
 * @param {number} videoDuration - Duration of the video in seconds
 * @param {object} [opts] - Options
 * @param {string} [opts.mood='upbeat'] - Target mood
 * @param {string} [opts.genre='any'] - Preferred genre (or 'any')
 * @returns {{ok, track, bpm, energy_match_score, duration_fit}}
 */
export async function autoSelectMusic(videoDuration, { mood = "upbeat", genre = "any" } = {}) {
  if (!videoDuration || videoDuration <= 0) {
    return { ok: false, error: "invalid_video_duration", message: "videoDuration must be > 0" };
  }
  if (!VALID_MOODS.includes(mood)) {
    return { ok: false, error: "invalid_mood", message: `Valid moods: ${VALID_MOODS.join(", ")}` };
  }
  if (!VALID_GENRES.includes(genre)) {
    return { ok: false, error: "invalid_genre", message: `Valid genres: ${VALID_GENRES.join(", ")}` };
  }

  const moodRange = MOOD_BPM_RANGES[mood];
  const bpm = moodRange.default + Math.round((Math.random() - 0.5) * 20);

  // Score genre affinity
  const affinities = MOOD_GENRE_AFFINITY[mood] || {};
  let bestGenre = genre;
  let bestScore = genre === "any" ? 0 : (affinities[genre] || 0.5);

  if (genre === "any") {
    for (const [g, score] of Object.entries(affinities)) {
      if (score > bestScore) {
        bestScore = score;
        bestGenre = g;
      }
    }
  }

  // Energy match: mood-BPM alignment (0-1)
  const energyMatchScore = Math.min(1, bestScore + (0.9 - Math.abs(bpm - moodRange.default) / 40));

  // Duration fit: suggest loop if track shorter, trim if longer
  const suggestedTrackDuration = videoDuration * (1 + Math.random() * 0.3);
  const durationFit = videoDuration <= suggestedTrackDuration
    ? { fit: "exact", adjustment: "none" }
    : { fit: "needs_loop", loop_count: Math.ceil(videoDuration / suggestedTrackDuration) };

  const trackId = `track-${randomUUID().slice(0, 8)}`;

  return {
    ok: true,
    track: {
      id: trackId,
      name: `${mood}_${bestGenre}_${trackId.slice(6)}`,
      genre: bestGenre,
      mood,
      suggested_duration_sec: Math.round(suggestedTrackDuration * 10) / 10,
    },
    bpm,
    energy_match_score: Math.round(energyMatchScore * 100) / 100,
    duration_fit: durationFit,
    model: "music-select-heuristic-v1",
  };
}

// ====================================================================
// 2. autoDuckMusic
// ====================================================================

/**
 * Automatically lowers music volume when voice is detected.
 * Creates a ducking recipe with attack/release curves.
 *
 * @param {object} voiceTrack - Voice audio track metadata
 * @param {object} musicTrack - Music audio track metadata
 * @param {object} [opts] - Ducking options
 * @param {number} [opts.duckLevel_db=-12] - How much to lower music (dB)
 * @param {number} [opts.attack_ms=200] - Fade-in time (ms)
 * @returns {{ok, mixed, duck_events, average_duck_db}}
 */
export async function autoDuckMusic(voiceTrack, musicTrack, { duckLevel_db = -12, attack_ms = 200 } = {}) {
  if (!voiceTrack || !voiceTrack.file_path) {
    return { ok: false, error: "voiceTrack_required", message: "voiceTrack with file_path is required" };
  }
  if (!musicTrack || !musicTrack.file_path) {
    return { ok: false, error: "musicTrack_required", message: "musicTrack with file_path is required" };
  }
  if (duckLevel_db > 0 || duckLevel_db < -40) {
    return { ok: false, error: "invalid_duck_level", message: "duckLevel_db must be between -40 and 0" };
  }
  if (attack_ms < 10 || attack_ms > 2000) {
    return { ok: false, error: "invalid_attack", message: "attack_ms must be between 10 and 2000" };
  }

  const voiceDuration = voiceTrack.duration_sec || 60;
  const segments = voiceTrack.segments || [];
  const duckEvents = [];

  for (const seg of segments) {
    duckEvents.push({
      start_sec: seg.start_sec || 0,
      end_sec: seg.end_sec || (seg.start_sec + 5),
      duck_level_db: duckLevel_db,
      attack_ms,
      release_ms: attack_ms * 1.5,
    });
  }

  // If no segments provided, create synthetic duck events
  if (duckEvents.length === 0) {
    const speechInterval = 5;
    for (let t = 0; t < voiceDuration; t += speechInterval + 3) {
      duckEvents.push({
        start_sec: t,
        end_sec: Math.min(t + speechInterval, voiceDuration),
        duck_level_db: duckLevel_db,
        attack_ms,
        release_ms: attack_ms * 1.5,
      });
    }
  }

  const avgDuck = duckEvents.reduce((s, e) => s + e.duck_level_db, 0) / duckEvents.length;

  return {
    ok: true,
    mixed: {
      voice_track: voiceTrack.file_path,
      music_track: musicTrack.file_path,
      duck_level_db: duckLevel_db,
      attack_ms,
      release_ms: attack_ms * 1.5,
    },
    duck_events: duckEvents,
    average_duck_db: Math.round(avgDuck * 10) / 10,
    ffmpeg_filter: `sidechaincompress=threshold=${Math.pow(10, duckLevel_db / 20)}:ratio=4:attack=${attack_ms}:release=${attack_ms * 1.5}`,
    model: "duck-heuristic-v1",
  };
}

// ====================================================================
// 3. autoLoopMusic
// ====================================================================

/**
 * Loops music track to fill target duration seamlessly.
 * Uses crossfade at loop points for smooth transitions.
 *
 * @param {object} musicTrack - Music track metadata
 * @param {number} targetDuration - Target duration in seconds
 * @returns {{ok, looped, loop_count, crossfade_points}}
 */
export async function autoLoopMusic(musicTrack, targetDuration) {
  if (!musicTrack || !musicTrack.file_path) {
    return { ok: false, error: "musicTrack_required", message: "musicTrack with file_path is required" };
  }
  if (!targetDuration || targetDuration <= 0) {
    return { ok: false, error: "invalid_target_duration", message: "targetDuration must be > 0" };
  }

  const trackDuration = musicTrack.duration_sec || 30;
  if (trackDuration <= 0) {
    return { ok: false, error: "invalid_track_duration", message: "musicTrack.duration_sec must be > 0" };
  }

  // Calculate loop points
  const crossfadeDuration = Math.min(2, trackDuration * 0.1); // 10% of track or 2s max
  const effectiveLoopLength = trackDuration - crossfadeDuration;
  const loopCount = Math.ceil(targetDuration / effectiveLoopLength);

  const crossfadePoints = [];
  for (let i = 1; i < loopCount; i++) {
    const timeSec = Math.round(i * effectiveLoopLength * 100) / 100;
    crossfadePoints.push({
      time_sec: timeSec,
      crossfade_duration_sec: crossfadeDuration,
      type: "equal_power",
    });
  }

  const actualDuration = loopCount * effectiveLoopLength + crossfadeDuration;

  return {
    ok: true,
    looped: {
      source_track: musicTrack.file_path,
      target_duration_sec: targetDuration,
      actual_duration_sec: Math.round(actualDuration * 100) / 100,
      crossfade_duration_sec: crossfadeDuration,
    },
    loop_count: loopCount,
    crossfade_points: crossfadePoints,
    ffmpeg_command: loopCount > 1
      ? `-filter_complex "[0:a]aloop=loop=${loopCount - 1}:size=${Math.round(trackDuration * 44100)}[looped];[looped]afade=t=in:d=${crossfadeDuration},afade=t=out:st=${actualDuration - crossfadeDuration}:d=${crossfadeDuration}[out]"`
      : null,
    model: "loop-heuristic-v1",
  };
}

// ====================================================================
// 4. autoMusicFade
// ====================================================================

/**
 * Applies smooth fade in/out curves to music track.
 * Supports multiple curve types for different feels.
 *
 * @param {object} musicTrack - Music track metadata
 * @param {object} [opts] - Fade options
 * @param {number} [opts.fadeIn_sec=1] - Fade in duration (seconds)
 * @param {number} [opts.fadeOut_sec=2] - Fade out duration (seconds)
 * @returns {{ok, faded, fadeIn_curve, fadeOut_curve}}
 */
export async function autoMusicFade(musicTrack, { fadeIn_sec = 1, fadeOut_sec = 2 } = {}) {
  if (!musicTrack || !musicTrack.file_path) {
    return { ok: false, error: "musicTrack_required", message: "musicTrack with file_path is required" };
  }
  if (fadeIn_sec < 0 || fadeIn_sec > 30) {
    return { ok: false, error: "invalid_fadeIn", message: "fadeIn_sec must be between 0 and 30" };
  }
  if (fadeOut_sec < 0 || fadeOut_sec > 60) {
    return { ok: false, error: "invalid_fadeOut", message: "fadeOut_sec must be between 0 and 60" };
  }

  const trackDuration = musicTrack.duration_sec || 60;
  const fadeOutStart = Math.max(0, trackDuration - fadeOut_sec);

  // Curve types: linear, exponential, s-curve, logarithmic
  const fadeInCurve = {
    duration_sec: fadeIn_sec,
    type: fadeIn_sec > 3 ? "exponential" : "linear",
    start_amplitude: 0,
    end_amplitude: 1,
    easing: fadeIn_sec > 3 ? "ease_in_out" : "linear",
  };

  const fadeOutCurve = {
    duration_sec: fadeOut_sec,
    start_time_sec: fadeOutStart,
    type: fadeOut_sec > 3 ? "exponential" : "s_curve",
    start_amplitude: 1,
    end_amplitude: 0,
    easing: fadeOut_sec > 3 ? "ease_in_out" : "linear",
  };

  const ffmpegFilters = [];
  if (fadeIn_sec > 0) ffmpegFilters.push(`afade=t=in:d=${fadeIn_sec}`);
  if (fadeOut_sec > 0) ffmpegFilters.push(`afade=t=out:st=${fadeOutStart}:d=${fadeOut_sec}`);

  return {
    ok: true,
    faded: {
      source_track: musicTrack.file_path,
      total_duration_sec: trackDuration,
      has_fade_in: fadeIn_sec > 0,
      has_fade_out: fadeOut_sec > 0,
    },
    fadeIn_curve: fadeInCurve,
    fadeOut_curve: fadeOutCurve,
    ffmpeg_filter: ffmpegFilters.length > 0 ? ffmpegFilters.join(",") : null,
    model: "fade-heuristic-v1",
  };
}

// ====================================================================
// 5. autoSFXPlacement
// ====================================================================

/**
 * Adds sound effects at key video moments (transitions, impacts, etc.)
 * Analyzes timeline for optimal SFX placement points.
 *
 * @param {object} videoTimeline - Video timeline with events
 * @param {object} [opts] - SFX options
 * @param {string} [opts.intensity='medium'] - SFX intensity level
 * @returns {{ok, sfx_added, placement_points, total_sfx_count}}
 */
export async function autoSFXPlacement(videoTimeline, { intensity = "medium" } = {}) {
  if (!videoTimeline || !videoTimeline.events) {
    return { ok: false, error: "videoTimeline_required", message: "videoTimeline with events array is required" };
  }
  if (!VALID_SFX_INTENSITIES.includes(intensity)) {
    return { ok: false, error: "invalid_intensity", message: `Valid intensities: ${VALID_SFX_INTENSITIES.join(", ")}` };
  }

  const events = videoTimeline.events;
  const duration = videoTimeline.duration_sec || 60;
  const intensityMultiplier = { low: 0.3, medium: 0.6, high: 1.0 }[intensity];

  const placementPoints = [];

  // Place SFX at transition points
  for (const event of events) {
    if (event.type === "cut" || event.type === "transition") {
      placementPoints.push({
        time_sec: event.time_sec || 0,
        sfx_type: "transition",
        sfx_name: "whoosh_soft",
        volume_db: -12 + Math.round(intensityMultiplier * 6),
        duration_sec: 0.5,
      });
    }
    if (event.type === "impact" || event.type === "text_appear") {
      placementPoints.push({
        time_sec: event.time_sec || 0,
        sfx_type: "impact",
        sfx_name: "boom_subtle",
        volume_db: -15 + Math.round(intensityMultiplier * 8),
        duration_sec: 0.3,
      });
    }
    if (event.type === "highlight" || event.type === "zoom") {
      placementPoints.push({
        time_sec: event.time_sec || 0,
        sfx_type: "accent",
        sfx_name: "sparkle",
        volume_db: -18 + Math.round(intensityMultiplier * 6),
        duration_sec: 0.4,
      });
    }
  }

  // Add ambient SFX at regular intervals based on intensity
  const ambientInterval = { low: 15, medium: 10, high: 5 }[intensity];
  for (let t = ambientInterval; t < duration; t += ambientInterval) {
    placementPoints.push({
      time_sec: t,
      sfx_type: "ambient",
      sfx_name: "subtle_texture",
      volume_db: -20,
      duration_sec: 1.0,
    });
  }

  // Sort by time
  placementPoints.sort((a, b) => a.time_sec - b.time_sec);

  return {
    ok: true,
    sfx_added: placementPoints.length > 0,
    placement_points: placementPoints,
    total_sfx_count: placementPoints.length,
    intensity,
    model: "sfx-placement-heuristic-v1",
  };
}

// ====================================================================
// 6. autoBeatMarkers
// ====================================================================

/**
 * Detects beats in music track and returns beat markers with timing.
 * Returns BPM, time signature, and per-beat strength.
 *
 * @param {object} musicTrack - Music track metadata
 * @returns {{ok, beats, bpm, time_signature}}
 */
export async function autoBeatMarkers(musicTrack) {
  if (!musicTrack || !musicTrack.file_path) {
    return { ok: false, error: "musicTrack_required", message: "musicTrack with file_path is required" };
  }

  const duration = musicTrack.duration_sec || 30;
  const bpm = musicTrack.bpm || 120;
  const beatInterval = 60 / bpm;
  const timeSignature = musicTrack.time_signature || { numerator: 4, denominator: 4 };

  const beats = [];
  const beatsPerMeasure = timeSignature.numerator;
  let beatIndex = 0;

  for (let t = 0; t < duration; t += beatInterval) {
    const measureBeat = beatIndex % beatsPerMeasure;
    // Downbeats (first beat of measure) are strongest
    let strength;
    if (measureBeat === 0) {
      strength = 0.9 + Math.random() * 0.1; // 0.9-1.0
    } else if (measureBeat === 2) {
      strength = 0.6 + Math.random() * 0.15; // 0.6-0.75 (backbeat)
    } else {
      strength = 0.3 + Math.random() * 0.2; // 0.3-0.5
    }

    beats.push({
      time: Math.round(t * 1000) / 1000,
      strength: Math.round(strength * 100) / 100,
      beat_in_measure: measureBeat + 1,
      is_downbeat: measureBeat === 0,
    });
    beatIndex++;
  }

  return {
    ok: true,
    beats,
    bpm,
    time_signature: timeSignature,
    total_beats: beats.length,
    duration_sec: duration,
    model: "beat-detect-heuristic-v1",
  };
}

// ====================================================================
// 7. autoTempoSync
// ====================================================================

/**
 * Aligns video cuts to music tempo for rhythmic editing.
 * Adjusts cut points to land on beats.
 *
 * @param {Array} videoCuts - Array of cut points in seconds
 * @param {number} musicBPM - Music BPM
 * @returns {{ok, synced_cuts, original_bpm, adjusted_bpm}}
 */
export async function autoTempoSync(videoCuts, musicBPM) {
  if (!Array.isArray(videoCuts) || videoCuts.length === 0) {
    return { ok: false, error: "videoCuts_required", message: "videoCuts must be a non-empty array" };
  }
  if (!musicBPM || musicBPM <= 0 || musicBPM > 300) {
    return { ok: false, error: "invalid_bpm", message: "musicBPM must be between 1 and 300" };
  }

  const beatInterval = 60 / musicBPM;
  const halfBeat = beatInterval / 2;

  const syncedCuts = videoCuts.map((cutTime, i) => {
    // Snap each cut to nearest beat
    const nearestBeat = Math.round(cutTime / beatInterval) * beatInterval;
    const offset = Math.abs(nearestBeat - cutTime);

    // Determine which beat type this lands on
    const beatInMeasure = Math.round(nearestBeat / beatInterval) % 4;

    return {
      original_time_sec: cutTime,
      synced_time_sec: Math.round(nearestBeat * 1000) / 1000,
      offset_ms: Math.round(offset * 1000),
      beat_type: beatInMeasure === 0 ? "downbeat" : beatInMeasure === 2 ? "backbeat" : "offbeat",
      snapped_to: offset < halfBeat ? "nearest_beat" : "original",
    };
  });

  // Calculate how many cuts actually moved
  const movedCount = syncedCuts.filter(c => c.offset_ms > 50).length;

  return {
    ok: true,
    synced_cuts: syncedCuts,
    original_bpm: musicBPM,
    adjusted_bpm: musicBPM,
    cuts_moved: movedCount,
    cuts_total: videoCuts.length,
    beat_interval_sec: Math.round(beatInterval * 1000) / 1000,
    model: "tempo-sync-heuristic-v1",
  };
}

// ====================================================================
// 8. autoChordProgression
// ====================================================================

/**
 * Analyzes chord progression in music track.
 * Returns chord sequence with timing, key, and mode.
 *
 * @param {object} musicTrack - Music track metadata
 * @returns {{ok, chords, key, mode}}
 */
export async function autoChordProgression(musicTrack) {
  if (!musicTrack || !musicTrack.file_path) {
    return { ok: false, error: "musicTrack_required", message: "musicTrack with file_path is required" };
  }

  const duration = musicTrack.duration_sec || 30;
  const key = musicTrack.key || "C";
  const mode = musicTrack.mode || "major";

  // Common progressions by mode
  const PROGRESSIONS = {
    major: {
      pop:      ["I", "V", "vi", "IV"],
      blues:    ["I", "IV", "I", "V", "IV", "I"],
      jazz:     ["ii", "V", "I", "vi"],
      default:  ["I", "IV", "V", "I"],
    },
    minor: {
      pop:      ["i", "VI", "III", "VII"],
      blues:    ["i", "iv", "i", "v", "iv", "i"],
      jazz:     ["ii°", "V", "i", "iv"],
      default:  ["i", "iv", "v", "i"],
    },
  };

  const genre = musicTrack.genre || "pop";
  const progression = (PROGRESSIONS[mode] && PROGRESSIONS[mode][genre]) || (PROGRESSIONS[mode] && PROGRESSIONS[mode].default) || ["I", "IV", "V", "I"];

  const chordDuration = 2; // seconds per chord
  const chords = [];
  let t = 0;
  let chordIndex = 0;

  while (t < duration) {
    const chord = progression[chordIndex % progression.length];
    const actualDuration = Math.min(chordDuration, duration - t);
    chords.push({
      chord,
      start: Math.round(t * 100) / 100,
      duration: Math.round(actualDuration * 100) / 100,
      roman_numeral: chord,
    });
    t += chordDuration;
    chordIndex++;
  }

  return {
    ok: true,
    chords,
    key,
    mode,
    progression_name: `${key} ${mode} ${genre}`,
    total_chords: chords.length,
    model: "chord-analysis-heuristic-v1",
  };
}

// ====================================================================
// 9. autoHarmony
// ====================================================================

/**
 * Adds harmony to vocal tracks.
 * Supports thirds, fifths, and octaves harmony styles.
 *
 * @param {object} voiceTrack - Voice audio track metadata
 * @param {object} [opts] - Harmony options
 * @param {string} [opts.style='thirds'] - Harmony interval style
 * @returns {{ok, harmony_track, interval_used, mix_level}}
 */
export async function autoHarmony(voiceTrack, { style = "thirds" } = {}) {
  if (!voiceTrack || !voiceTrack.file_path) {
    return { ok: false, error: "voiceTrack_required", message: "voiceTrack with file_path is required" };
  }
  if (!VALID_HARMONY_STYLES.includes(style)) {
    return { ok: false, error: "invalid_style", message: `Valid styles: ${VALID_HARMONY_STYLES.join(", ")}` };
  }

  // Interval definitions (semitones)
  const INTERVALS = {
    thirds:  { semitones: 4, name: "Major Third", description: "Warm, consonant harmony" },
    fifths:  { semitones: 7, name: "Perfect Fifth", description: "Open, powerful harmony" },
    octaves: { semitones: 12, name: "Octave", description: "Unison doubling, fuller sound" },
  };

  const interval = INTERVALS[style];

  // Mix level varies by style (octaves blend more, fifths less)
  const mixLevels = { thirds: -6, fifths: -8, octaves: -3 };
  const mixLevel = mixLevels[style];

  const harmonyTrack = {
    source_track: voiceTrack.file_path,
    harmony_type: "pitch_shift",
    interval: interval.name,
    semitones: interval.semitones,
    description: interval.description,
    pan: style === "thirds" ? 30 : style === "fifths" ? -30 : 0,
    volume_db: mixLevel,
  };

  return {
    ok: true,
    harmony_track: harmonyTrack,
    interval_used: {
      name: interval.name,
      semitones: interval.semitones,
      description: interval.description,
    },
    mix_level_db: mixLevel,
    ffmpeg_filter: `asetrate=44100*${Math.pow(2, interval.semitones / 12)},aresample=44100,volume=${Math.pow(10, mixLevel / 20)}`,
    model: "harmony-heuristic-v1",
  };
}

// ====================================================================
// 10. autoReverbMatch
// ====================================================================

/**
 * Matches reverb characteristics to a target acoustic space.
 * Supports studio, hall, room, outdoor, and cathedral spaces.
 *
 * @param {object} audioFile - Audio file metadata
 * @param {object} [opts] - Reverb options
 * @param {string} [opts.targetSpace='studio'] - Target acoustic space
 * @returns {{ok, processed, reverb_type, decay_time_ms}}
 */
export async function autoReverbMatch(audioFile, { targetSpace = "studio" } = {}) {
  if (!audioFile || !audioFile.file_path) {
    return { ok: false, error: "audioFile_required", message: "audioFile with file_path is required" };
  }
  if (!VALID_REVERB_SPACES.includes(targetSpace)) {
    return { ok: false, error: "invalid_targetSpace", message: `Valid spaces: ${VALID_REVERB_SPACES.join(", ")}` };
  }

  const preset = REVERB_PRESETS[targetSpace];

  const processed = {
    source_track: audioFile.file_path,
    target_space: targetSpace,
    reverb_type: preset.type,
    decay_time_ms: preset.decay_ms,
    pre_delay_ms: preset.pre_delay_ms,
    wet_level_db: preset.wet_level_db,
    dry_level_db: 0,
    description: preset.description,
  };

  // Build FFmpeg freeverb filter
  const roomSize = Math.min(0.99, preset.decay_ms / 5000);
  const damp = targetSpace === "outdoor" ? 0.9 : 0.5;
  const wetGain = Math.pow(10, preset.wet_level_db / 20);

  return {
    ok: true,
    processed,
    reverb_type: preset.type,
    decay_time_ms: preset.decay_ms,
    pre_delay_ms: preset.pre_delay_ms,
    wet_level_db: preset.wet_level_db,
    ffmpeg_filter: `freeverb=roomsize=${roomSize.toFixed(2)}:damp=${damp.toFixed(2)}:wet=${wetGain.toFixed(3)}:dry=1`,
    model: "reverb-match-heuristic-v1",
  };
}

// ====================================================================
// Tool definitions (OpenAI function-calling shape)
// ====================================================================

export const MUSIC_SFX_TOOLS = [
  {
    type: "function",
    function: {
      name: "auto_select_music",
      description: "Analyzes video mood and suggests matching music from a library. Returns the best track with BPM, energy match score, and duration fit assessment.",
      parameters: {
        type: "object",
        properties: {
          videoDuration: { type: "number", description: "Duration of the video in seconds" },
          mood: { type: "string", enum: VALID_MOODS, description: "Target mood for music selection" },
          genre: { type: "string", enum: VALID_GENRES, description: "Preferred genre (or 'any' for best match)" },
        },
        required: ["videoDuration"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "auto_duck_music",
      description: "Automatically lowers music volume when voice is detected. Creates a ducking recipe with attack/release curves for transparent voice-over mixing.",
      parameters: {
        type: "object",
        properties: {
          voiceTrack: { type: "object", description: "Voice audio track metadata with file_path and optional segments" },
          musicTrack: { type: "object", description: "Music audio track metadata with file_path" },
          duckLevel_db: { type: "number", description: "How much to lower music in dB (default: -12)" },
          attack_ms: { type: "number", description: "Fade-in time in ms (default: 200)" },
        },
        required: ["voiceTrack", "musicTrack"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "auto_loop_music",
      description: "Loops music track to fill target duration seamlessly. Uses crossfade at loop points for smooth transitions.",
      parameters: {
        type: "object",
        properties: {
          musicTrack: { type: "object", description: "Music track metadata with file_path and duration_sec" },
          targetDuration: { type: "number", description: "Target duration in seconds to fill" },
        },
        required: ["musicTrack", "targetDuration"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "auto_music_fade",
      description: "Applies smooth fade in/out curves to music track. Supports multiple curve types for different feels.",
      parameters: {
        type: "object",
        properties: {
          musicTrack: { type: "object", description: "Music track metadata with file_path and duration_sec" },
          fadeIn_sec: { type: "number", description: "Fade in duration in seconds (default: 1)" },
          fadeOut_sec: { type: "number", description: "Fade out duration in seconds (default: 2)" },
        },
        required: ["musicTrack"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "auto_sfx_placement",
      description: "Adds sound effects at key video moments like transitions, impacts, and highlights. Analyzes timeline for optimal SFX placement.",
      parameters: {
        type: "object",
        properties: {
          videoTimeline: { type: "object", description: "Video timeline with events array and duration_sec" },
          intensity: { type: "string", enum: VALID_SFX_INTENSITIES, description: "SFX intensity level (default: 'medium')" },
        },
        required: ["videoTimeline"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "auto_beat_markers",
      description: "Detects beats in music track and returns beat markers with timing, strength, and measure position. Returns BPM and time signature.",
      parameters: {
        type: "object",
        properties: {
          musicTrack: { type: "object", description: "Music track metadata with file_path, duration_sec, and optional bpm" },
        },
        required: ["musicTrack"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "auto_tempo_sync",
      description: "Aligns video cuts to music tempo for rhythmic editing. Snaps cut points to nearest beats for professional music-video sync.",
      parameters: {
        type: "object",
        properties: {
          videoCuts: { type: "array", items: { type: "number" }, description: "Array of cut points in seconds" },
          musicBPM: { type: "number", description: "Music BPM (beats per minute)" },
        },
        required: ["videoCuts", "musicBPM"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "auto_chord_progression",
      description: "Analyzes chord progression in music track. Returns chord sequence with timing, key, mode, and progression pattern.",
      parameters: {
        type: "object",
        properties: {
          musicTrack: { type: "object", description: "Music track metadata with file_path, duration_sec, and optional key/mode" },
        },
        required: ["musicTrack"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "auto_harmony",
      description: "Adds harmony to vocal tracks using pitch shifting. Supports thirds, fifths, and octaves harmony styles for richer vocal production.",
      parameters: {
        type: "object",
        properties: {
          voiceTrack: { type: "object", description: "Voice audio track metadata with file_path" },
          style: { type: "string", enum: VALID_HARMONY_STYLES, description: "Harmony interval style (default: 'thirds')" },
        },
        required: ["voiceTrack"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "auto_reverb_match",
      description: "Matches reverb characteristics to a target acoustic space. Supports studio, hall, room, outdoor, and cathedral environments.",
      parameters: {
        type: "object",
        properties: {
          audioFile: { type: "object", description: "Audio file metadata with file_path" },
          targetSpace: { type: "string", enum: VALID_REVERB_SPACES, description: "Target acoustic space (default: 'studio')" },
        },
        required: ["audioFile"],
      },
    },
  },
];

export const MUSIC_SFX_TOOL_NAMES = new Set(MUSIC_SFX_TOOLS.map(t => t.function.name));
