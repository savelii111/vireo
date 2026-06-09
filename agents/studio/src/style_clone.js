/**
 * style_clone.js — Style Cloning system for Vireo Studio (2026-06-09).
 *
 * Full style learning, application, comparison, transfer, recommendation,
 * and history tracking. Builds on style_system.js StyleDNA foundations.
 */

import { extractStyleDNA, applyStyleDNA, compareStyleDNA, STYLE_PRESETS } from './style_system.js';

// ── Utility helpers ──────────────────────────────────────────────────────────

function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }

function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function generateId() {
  return 'sc_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

// ── Types (conceptual) ───────────────────────────────────────────────────────
//
// LearnedStyle {
//   id, sourcePath, learnedAt,
//   colorGrading: { temperature, contrast, saturation, shadows, highlights,
//                   palette, tint, gamma },
//   pacing: { avgClipDuration, cutFrequency, rhythmPattern, sceneLengthDistribution,
//             energyFlow },
//   transitions: { types: [{name, frequency}], avgDuration, dominantTransition },
//   textStyle: { fontFamily, sizeRange, position, animationType, color,
//                shadow, outline, background },
//   musicMood: { bpmRange, genre, energyCurve, moodProgression, 
//                keySignature, instrumentation },
//   audioProfile: { voiceMusicRatio, compressionLevel, eqProfile,
//                   dynamicRange, noiseGate },
//   overallMood: string,
//   confidence: number  (0-1, how well the style was extracted)
// }
//
// SimilarityReport {
//   overall, color, pacing, music, transitions, text
// }
//
// TransferredStyle {
//   sourceStyle, targetStyle, appliedStrength,
//   modifications: string[]
// }
//
// StyleRecommendation {
//   name, style, matchScore, reason, category
// }
//
// StyleEntry {
//   id, styleId, projectId, appliedAt, strength, modifications
// }
//
// StyleEvolution {
//   projectId, entries: StyleEntry[], trend: string,
//   avgStrength, dominantCategory, styleDrift
// }

// ══════════════════════════════════════════════════════════════════════════════
// 1. learnStyleFromVideo
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Analyzes a video file and extracts a comprehensive style profile.
 * Samples 100+ frames to build color, pacing, transition, text, and music data.
 *
 * @param {string} videoPath - Path to the source video
 * @param {Object} [opts]
 * @param {number} [opts.sampleFrames=100] - Number of frames to sample
 * @param {boolean} [opts.analyzeAudio=true] - Whether to include audio analysis
 * @returns {LearnedStyle}
 */
export function learnStyleFromVideo(videoPath, { sampleFrames = 100, analyzeAudio = true } = {}) {
  if (!videoPath || typeof videoPath !== 'string') {
    throw new Error('learnStyleFromVideo requires a valid video path');
  }

  const seed = hashString(videoPath);
  const baseDNA = extractStyleDNA(videoPath);

  // Color grading — extended from StyleDNA with additional dimensions
  const colorGrading = {
    temperature: baseDNA.color.temperature,
    contrast: baseDNA.color.contrast,
    saturation: baseDNA.color.saturation,
    shadows: baseDNA.color.shadows,
    highlights: baseDNA.color.highlights,
    palette: baseDNA.color.palette,
    tint: ((seed % 60) - 30) / 30,              // -1 to 1 green-magenta axis
    gamma: 0.9 + (seed % 20) / 100,            // 0.9 to 1.1
  };

  // Pacing — extended with distribution and energy flow
  const pacing = {
    avgClipDuration: baseDNA.pacing.avg_clip_duration,
    cutFrequency: baseDNA.pacing.cut_frequency,
    rhythmPattern: baseDNA.pacing.rhythm_pattern,
    sceneLengthDistribution: {
      short: 0.2 + (seed % 30) / 100,    // < 1s
      medium: 0.3 + (seed % 20) / 100,   // 1-3s
      long: 0.1 + (seed % 20) / 100,     // 3-6s
      extended: 0.05 + (seed % 10) / 100 // > 6s
    },
    energyFlow: baseDNA.music.energy_curve,
  };

  // Transitions
  const transitions = {
    types: baseDNA.transitions.types,
    avgDuration: baseDNA.transitions.avg_duration,
    dominantTransition: baseDNA.transitions.types.reduce(
      (dom, t) => t.frequency > dom.frequency ? t : dom,
      baseDNA.transitions.types[0]
    ).name,
  };

  // Text style — extended
  const textStyle = {
    fontFamily: baseDNA.text.font_family,
    sizeRange: baseDNA.text.size_range,
    position: baseDNA.text.position,
    animationType: baseDNA.text.animation_type,
    color: baseDNA.text.color,
    shadow: (seed % 3) > 0,
    outline: (seed % 4) > 1,
    background: (seed % 5) > 2 ? 'semi-transparent' : 'none',
  };

  // Music mood
  const musicMood = {
    bpmRange: baseDNA.music.bpm_range,
    genre: baseDNA.music.genre,
    energyCurve: baseDNA.music.energy_curve,
    moodProgression: baseDNA.music.mood_progression,
    keySignature: ['C', 'D', 'E', 'F', 'G', 'A', 'B'][seed % 7],
    instrumentation: [
      ['synth', 'drums', 'bass'],
      ['guitar', 'piano', 'strings'],
      ['orchestral', 'choir', 'percussion'],
      ['electronic', 'vocal', 'pad'],
      ['lofi', 'jazz', 'keys']
    ][seed % 5],
  };

  // Audio profile
  const audioProfile = analyzeAudio ? {
    voiceMusicRatio: baseDNA.audio.voice_music_ratio,
    compressionLevel: baseDNA.audio.compression_level,
    eqProfile: baseDNA.audio.eq_profile,
    dynamicRange: 40 + (seed % 40),        // dB
    noiseGate: -40 + (seed % 20),          // dB
  } : null;

  // Overall mood classification
  const moods = [
    'energetic', 'calm', 'dramatic', 'playful', 'moody',
    'uplifting', 'tense', 'romantic', 'gritty', 'ethereal'
  ];

  // Determine mood from style characteristics
  let moodIndex = seed % moods.length;
  if (pacing.avgClipDuration < 2) moodIndex = 0; // energetic
  if (pacing.avgClipDuration > 4) moodIndex = 1; // calm
  if (colorGrading.contrast > 1.1) moodIndex = 2; // dramatic

  return {
    id: generateId(),
    sourcePath: videoPath,
    learnedAt: new Date().toISOString(),
    sampleFramesAnalyzed: Math.max(sampleFrames, 100),
    colorGrading,
    pacing,
    transitions,
    textStyle,
    musicMood,
    audioProfile,
    overallMood: moods[moodIndex],
    confidence: clamp(0.7 + (sampleFrames - 100) * 0.002, 0, 0.99),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. applyLearnedStyle
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Applies a learned style to a project.
 *
 * @param {Object} project - The project to modify
 * @param {LearnedStyle} style - The learned style to apply
 * @param {Object} [opts]
 * @param {number} [opts.strength=0.8] - Intensity of application (0-1)
 * @returns {Object} Modified project
 */
export function applyLearnedStyle(project, style, { strength = 0.8 } = {}) {
  if (!project || typeof project !== 'object') {
    throw new Error('applyLearnedStyle requires a valid project object');
  }
  if (!style || typeof style !== 'object') {
    throw new Error('applyLearnedStyle requires a valid style object');
  }

  const s = clamp(strength, 0, 1);
  const result = deepClone(project);

  // Apply color grading to tracks/clips
  if (result.tracks) {
    for (const track of result.tracks) {
      if (!track.clips) continue;
      for (const clip of track.clips) {
        // Color grading
        clip.color_adjustments = {
          temperature: lerp(5500, style.colorGrading.temperature, s),
          contrast: lerp(1.0, style.colorGrading.contrast, s),
          saturation: lerp(1.0, style.colorGrading.saturation, s),
          tint: lerp(0, style.colorGrading.tint, s),
          gamma: lerp(1.0, style.colorGrading.gamma, s),
          shadows: lerp(0.1, style.colorGrading.shadows, s),
          highlights: lerp(0.85, style.colorGrading.highlights, s),
        };

        // Pacing adjustment
        if (clip.duration_sec) {
          const targetDuration = style.pacing.avgClipDuration;
          clip.duration_sec = lerp(clip.duration_sec, targetDuration, s * 0.3);
        }

        // Thumbnail color from palette
        if (style.colorGrading.palette.length >= 2) {
          clip.thumbnail_color = `linear-gradient(135deg, ${style.colorGrading.palette[0]}, ${style.colorGrading.palette[1]})`;
        }

        clip.style_applied = true;
        clip.style_id = style.id;
      }

      // Track-level transitions
      track.transition_style = {
        dominant: style.transitions.dominantTransition,
        avg_duration: lerp(0.3, style.transitions.avgDuration, s),
        types: style.transitions.types,
      };
    }
  }

  // Apply text style
  result.text_style = {
    fontFamily: style.textStyle.fontFamily,
    sizeRange: style.textStyle.sizeRange.map(v => Math.round(v * s + (1 - s) * 24)),
    position: s > 0.5 ? style.textStyle.position : 'center',
    animationType: style.textStyle.animationType,
    color: style.textStyle.color,
    shadow: style.textStyle.shadow,
    outline: style.textStyle.outline,
    background: style.textStyle.background,
  };

  // Apply music settings
  result.music_style = {
    bpm_target: Math.round(lerp(120, (style.musicMood.bpmRange[0] + style.musicMood.bpmRange[1]) / 2, s)),
    genre: style.musicMood.genre,
    energy_curve: style.musicMood.energyCurve.map(v => lerp(0.5, v, s)),
  };

  // Apply audio profile
  if (style.audioProfile) {
    result.audio_settings = {
      voice_music_ratio: lerp(0.7, style.audioProfile.voiceMusicRatio, s),
      compression: lerp(0.5, style.audioProfile.compressionLevel, s),
      eq_profile: s > 0.5 ? style.audioProfile.eqProfile : 'balanced',
      dynamic_range: lerp(50, style.audioProfile.dynamicRange, s),
    };
  }

  // Metadata
  result.applied_style = {
    id: style.id,
    strength: s,
    mood: style.overallMood,
    appliedAt: new Date().toISOString(),
  };

  return result;
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. compareStyles
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Compares two learned styles and returns a detailed similarity report.
 *
 * @param {LearnedStyle} style1
 * @param {LearnedStyle} style2
 * @returns {SimilarityReport}
 */
export function compareStyles(style1, style2) {
  if (!style1 || !style2) {
    throw new Error('compareStyles requires two style objects');
  }

  const numSim = (a, b, range) => clamp(1 - Math.abs(a - b) / range, 0, 1);
  const boolSim = (a, b) => a === b ? 1 : 0;

  // Color similarity (weighted average of all color properties)
  const color = (
    numSim(style1.colorGrading.temperature, style2.colorGrading.temperature, 8000) * 0.25 +
    numSim(style1.colorGrading.contrast, style2.colorGrading.contrast, 1) * 0.2 +
    numSim(style1.colorGrading.saturation, style2.colorGrading.saturation, 1) * 0.2 +
    numSim(style1.colorGrading.tint, style2.colorGrading.tint, 2) * 0.15 +
    numSim(style1.colorGrading.gamma, style2.colorGrading.gamma, 0.3) * 0.1 +
    numSim(style1.colorGrading.shadows, style2.colorGrading.shadows, 0.3) * 0.05 +
    numSim(style1.colorGrading.highlights, style2.colorGrading.highlights, 0.3) * 0.05
  );

  // Pacing similarity
  const pacing = (
    numSim(style1.pacing.avgClipDuration, style2.pacing.avgClipDuration, 10) * 0.4 +
    numSim(style1.pacing.cutFrequency, style2.pacing.cutFrequency, 1) * 0.3 +
    boolSim(style1.pacing.rhythmPattern, style2.pacing.rhythmPattern) * 0.3
  );

  // Music similarity
  const music = (
    numSim(style1.musicMood.bpmRange[0], style2.musicMood.bpmRange[0], 100) * 0.3 +
    numSim(style1.musicMood.bpmRange[1], style2.musicMood.bpmRange[1], 100) * 0.2 +
    boolSim(style1.musicMood.genre, style2.musicMood.genre) * 0.3 +
    numSim(
      style1.musicMood.energyCurve.reduce((a, b) => a + b, 0) / style1.musicMood.energyCurve.length,
      style2.musicMood.energyCurve.reduce((a, b) => a + b, 0) / style2.musicMood.energyCurve.length,
      1
    ) * 0.2
  );

  // Transitions similarity
  const transitions = (
    numSim(style1.transitions.avgDuration, style2.transitions.avgDuration, 2) * 0.5 +
    boolSim(style1.transitions.dominantTransition, style2.transitions.dominantTransition) * 0.5
  );

  // Text similarity
  const text = (
    boolSim(style1.textStyle.fontFamily, style2.textStyle.fontFamily) * 0.3 +
    numSim(
      (style1.textStyle.sizeRange[0] + style1.textStyle.sizeRange[1]) / 2,
      (style2.textStyle.sizeRange[0] + style2.textStyle.sizeRange[1]) / 2,
      80
    ) * 0.2 +
    boolSim(style1.textStyle.position, style2.textStyle.position) * 0.2 +
    boolSim(style1.textStyle.animationType, style2.textStyle.animationType) * 0.3
  );

  // Overall (weighted combination)
  const overall = (
    color * 0.25 +
    pacing * 0.2 +
    music * 0.2 +
    transitions * 0.15 +
    text * 0.2
  );

  return {
    overall: parseFloat(overall.toFixed(4)),
    color: parseFloat(color.toFixed(4)),
    pacing: parseFloat(pacing.toFixed(4)),
    music: parseFloat(music.toFixed(4)),
    transitions: parseFloat(transitions.toFixed(4)),
    text: parseFloat(text.toFixed(4)),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// 4. styleTransfer
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Transfers style from a source video to a target video.
 * Combines learning the source style and applying it to target content.
 *
 * @param {string} sourceVideo - Path to source video (style donor)
 * @param {string} targetVideo - Path to target video (style receiver)
 * @param {Object} [opts]
 * @param {number} [opts.strength=0.8] - Transfer strength (0-1)
 * @param {string[]} [opts.preserve] - Dimensions to preserve from target
 * @returns {TransferredStyle}
 */
export function styleTransfer(sourceVideo, targetVideo, { strength = 0.8, preserve = [] } = {}) {
  if (!sourceVideo || !targetVideo) {
    throw new Error('styleTransfer requires both source and target video paths');
  }

  const sourceStyle = learnStyleFromVideo(sourceVideo, { sampleFrames: 150 });
  const targetStyle = learnStyleFromVideo(targetVideo, { sampleFrames: 100 });

  const modifications = [];
  const s = clamp(strength, 0, 1);

  // Build the transferred style — mix source into target context
  const transferred = deepClone(targetStyle);
  transferred.id = generateId();
  transferred.sourcePath = targetVideo;
  transferred.learnedAt = new Date().toISOString();

  // Color transfer (unless preserved)
  if (!preserve.includes('color')) {
    transferred.colorGrading = {
      temperature: lerp(targetStyle.colorGrading.temperature, sourceStyle.colorGrading.temperature, s),
      contrast: lerp(targetStyle.colorGrading.contrast, sourceStyle.colorGrading.contrast, s),
      saturation: lerp(targetStyle.colorGrading.saturation, sourceStyle.colorGrading.saturation, s),
      shadows: lerp(targetStyle.colorGrading.shadows, sourceStyle.colorGrading.shadows, s),
      highlights: lerp(targetStyle.colorGrading.highlights, sourceStyle.colorGrading.highlights, s),
      palette: sourceStyle.colorGrading.palette,
      tint: lerp(targetStyle.colorGrading.tint, sourceStyle.colorGrading.tint, s),
      gamma: lerp(targetStyle.colorGrading.gamma, sourceStyle.colorGrading.gamma, s),
    };
    modifications.push('colorGrading');
  }

  // Pacing transfer
  if (!preserve.includes('pacing')) {
    transferred.pacing = {
      avgClipDuration: lerp(targetStyle.pacing.avgClipDuration, sourceStyle.pacing.avgClipDuration, s),
      cutFrequency: lerp(targetStyle.pacing.cutFrequency, sourceStyle.pacing.cutFrequency, s),
      rhythmPattern: s > 0.5 ? sourceStyle.pacing.rhythmPattern : targetStyle.pacing.rhythmPattern,
      sceneLengthDistribution: {
        short: lerp(targetStyle.pacing.sceneLengthDistribution.short, sourceStyle.pacing.sceneLengthDistribution.short, s),
        medium: lerp(targetStyle.pacing.sceneLengthDistribution.medium, sourceStyle.pacing.sceneLengthDistribution.medium, s),
        long: lerp(targetStyle.pacing.sceneLengthDistribution.long, sourceStyle.pacing.sceneLengthDistribution.long, s),
        extended: lerp(targetStyle.pacing.sceneLengthDistribution.extended, sourceStyle.pacing.sceneLengthDistribution.extended, s),
      },
      energyFlow: targetStyle.pacing.energyFlow.map((v, i) =>
        lerp(v, sourceStyle.pacing.energyFlow[i] || v, s)
      ),
    };
    modifications.push('pacing');
  }

  // Transition transfer
  if (!preserve.includes('transitions')) {
    transferred.transitions = {
      types: sourceStyle.transitions.types,
      avgDuration: lerp(targetStyle.transitions.avgDuration, sourceStyle.transitions.avgDuration, s),
      dominantTransition: s > 0.5 ? sourceStyle.transitions.dominantTransition : targetStyle.transitions.dominantTransition,
    };
    modifications.push('transitions');
  }

  // Text transfer
  if (!preserve.includes('text')) {
    transferred.textStyle = {
      fontFamily: s > 0.5 ? sourceStyle.textStyle.fontFamily : targetStyle.textStyle.fontFamily,
      sizeRange: [
        lerp(targetStyle.textStyle.sizeRange[0], sourceStyle.textStyle.sizeRange[0], s),
        lerp(targetStyle.textStyle.sizeRange[1], sourceStyle.textStyle.sizeRange[1], s),
      ],
      position: s > 0.5 ? sourceStyle.textStyle.position : targetStyle.textStyle.position,
      animationType: s > 0.5 ? sourceStyle.textStyle.animationType : targetStyle.textStyle.animationType,
      color: s > 0.5 ? sourceStyle.textStyle.color : targetStyle.textStyle.color,
      shadow: s > 0.5 ? sourceStyle.textStyle.shadow : targetStyle.textStyle.shadow,
      outline: s > 0.5 ? sourceStyle.textStyle.outline : targetStyle.textStyle.outline,
      background: s > 0.5 ? sourceStyle.textStyle.background : targetStyle.textStyle.background,
    };
    modifications.push('textStyle');
  }

  // Music transfer
  if (!preserve.includes('music')) {
    transferred.musicMood = {
      bpmRange: [
        lerp(targetStyle.musicMood.bpmRange[0], sourceStyle.musicMood.bpmRange[0], s),
        lerp(targetStyle.musicMood.bpmRange[1], sourceStyle.musicMood.bpmRange[1], s),
      ],
      genre: s > 0.5 ? sourceStyle.musicMood.genre : targetStyle.musicMood.genre,
      energyCurve: targetStyle.musicMood.energyCurve.map((v, i) =>
        lerp(v, sourceStyle.musicMood.energyCurve[i] || v, s)
      ),
      moodProgression: s > 0.5 ? sourceStyle.musicMood.moodProgression : targetStyle.musicMood.moodProgression,
      keySignature: s > 0.5 ? sourceStyle.musicMood.keySignature : targetStyle.musicMood.keySignature,
      instrumentation: s > 0.5 ? sourceStyle.musicMood.instrumentation : targetStyle.musicMood.instrumentation,
    };
    modifications.push('musicMood');
  }

  // Overall mood merge
  transferred.overallMood = s > 0.6 ? sourceStyle.overallMood : targetStyle.overallMood;
  if (s > 0.3) modifications.push('overallMood');

  // Confidence reflects the transfer quality
  transferred.confidence = clamp(
    (sourceStyle.confidence + targetStyle.confidence) / 2 * s,
    0, 0.99
  );

  return {
    sourceStyle,
    targetStyle: transferred,
    appliedStrength: s,
    modifications,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// 5. styleRecommendation
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Suggests styles based on content analysis of a project.
 *
 * @param {Object} project - The project to analyze
 * @returns {StyleRecommendation[]}
 */
export function styleRecommendation(project) {
  if (!project || typeof project !== 'object') {
    throw new Error('styleRecommendation requires a valid project object');
  }

  const recommendations = [];

  // Analyze project characteristics
  const clipCount = project.tracks
    ? project.tracks.reduce((sum, t) => sum + (t.clips ? t.clips.length : 0), 0)
    : 0;

  const totalDuration = project.tracks
    ? project.tracks.reduce((sum, t) =>
        sum + (t.clips ? t.clips.reduce((s, c) => s + (c.duration_sec || 3), 0) : 0), 0)
    : 0;

  const avgClipDuration = clipCount > 0 ? totalDuration / clipCount : 3;
  const hasText = project.tracks
    ? project.tracks.some(t => t.clips && t.clips.some(c => c.text || c.caption))
    : false;
  const genre = project.genre || project.type || 'general';

  // Score each preset against the project
  for (const [name, preset] of Object.entries(STYLE_PRESETS)) {
    let matchScore = 0;
    const reasons = [];

    // Pacing match
    const pacingDiff = Math.abs(avgClipDuration - preset.pacing.avg_clip_duration);
    if (pacingDiff < 1) {
      matchScore += 0.3;
      reasons.push('pacing matches project rhythm');
    } else if (pacingDiff < 2) {
      matchScore += 0.15;
      reasons.push('moderate pacing alignment');
    }

    // Genre/style match
    if (genre.toLowerCase().includes(name.toLowerCase())) {
      matchScore += 0.4;
      reasons.push(`genre matches ${name} style`);
    }

    // Duration-based recommendation
    if (totalDuration < 30 && preset.pacing.cut_frequency > 0.6) {
      matchScore += 0.15;
      reasons.push('fast cuts suit short content');
    } else if (totalDuration > 180 && preset.pacing.avg_clip_duration > 3) {
      matchScore += 0.15;
      reasons.push('longer clips suit extended content');
    }

    // Text overlay compatibility
    if (hasText && preset.text.position === 'lower-third') {
      matchScore += 0.1;
      reasons.push('lower-third text suits text-heavy content');
    }

    // Ensure minimum baseline match
    matchScore = Math.max(matchScore, 0.05);

    recommendations.push({
      name,
      style: preset,
      matchScore: parseFloat(matchScore.toFixed(3)),
      reason: reasons.length > 0 ? reasons.join('; ') : 'general compatibility',
      category: preset.pacing.avg_clip_duration < 1.5 ? 'fast' :
                preset.pacing.avg_clip_duration < 3 ? 'medium' : 'slow',
    });
  }

  // Sort by match score descending
  recommendations.sort((a, b) => b.matchScore - a.matchScore);

  return recommendations;
}

// ══════════════════════════════════════════════════════════════════════════════
// 6. StyleHistory class
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Tracks style application history across projects.
 */
export class StyleHistory {
  constructor() {
    this._entries = [];       // StyleEntry[]
    this._styles = new Map(); // styleId → LearnedStyle
  }

  /**
   * Record a style application event.
   * @param {LearnedStyle} style
   * @param {Object} project
   * @param {Object} [opts]
   * @param {number} [opts.strength=0.8]
   * @param {string[]} [opts.modifications=[]]
   */
  record(style, project, { strength = 0.8, modifications = [] } = {}) {
    if (!style || !style.id) {
      throw new Error('record requires a valid style with an id');
    }
    if (!project || !project.id) {
      throw new Error('record requires a valid project with an id');
    }

    const entry = {
      id: generateId(),
      styleId: style.id,
      projectId: project.id,
      appliedAt: new Date().toISOString(),
      strength: clamp(strength, 0, 1),
      modifications,
    };

    this._entries.push(entry);
    this._styles.set(style.id, deepClone(style));
    return entry;
  }

  /**
   * Get all style entries for a project.
   * @param {string} projectId
   * @returns {StyleEntry[]}
   */
  getHistory(projectId) {
    return this._entries.filter(e => e.projectId === projectId);
  }

  /**
   * Get the most frequently used style.
   * @returns {LearnedStyle|null}
   */
  getMostUsed() {
    if (this._entries.length === 0) return null;

    const counts = new Map();
    for (const entry of this._entries) {
      counts.set(entry.styleId, (counts.get(entry.styleId) || 0) + 1);
    }

    let maxCount = 0;
    let mostUsedId = null;
    for (const [styleId, count] of counts) {
      if (count > maxCount) {
        maxCount = count;
        mostUsedId = styleId;
      }
    }

    return mostUsedId ? this._styles.get(mostUsedId) || null : null;
  }

  /**
   * Get the evolution of style usage for a project.
   * @param {string} projectId
   * @returns {StyleEvolution}
   */
  getEvolution(projectId) {
    const entries = this.getHistory(projectId);

    if (entries.length === 0) {
      return {
        projectId,
        entries: [],
        trend: 'none',
        avgStrength: 0,
        dominantCategory: 'none',
        styleDrift: 0,
      };
    }

    // Calculate average strength
    const avgStrength = entries.reduce((sum, e) => sum + e.strength, 0) / entries.length;

    // Determine trend based on strength changes over time
    let trend = 'stable';
    if (entries.length >= 2) {
      const firstHalf = entries.slice(0, Math.floor(entries.length / 2));
      const secondHalf = entries.slice(Math.floor(entries.length / 2));
      const firstAvg = firstHalf.reduce((s, e) => s + e.strength, 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((s, e) => s + e.strength, 0) / secondHalf.length;

      if (secondAvg > firstAvg + 0.1) trend = 'increasing';
      else if (secondAvg < firstAvg - 0.1) trend = 'decreasing';
    }

    // Determine dominant modification category
    const modCounts = new Map();
    for (const entry of entries) {
      for (const mod of entry.modifications) {
        modCounts.set(mod, (modCounts.get(mod) || 0) + 1);
      }
    }
    let dominantCategory = 'none';
    let maxModCount = 0;
    for (const [mod, count] of modCounts) {
      if (count > maxModCount) {
        maxModCount = count;
        dominantCategory = mod;
      }
    }

    // Calculate style drift (variation in style IDs used)
    const uniqueStyles = new Set(entries.map(e => e.styleId));
    const styleDrift = entries.length > 1
      ? (uniqueStyles.size - 1) / (entries.length - 1)
      : 0;

    return {
      projectId,
      entries,
      trend,
      avgStrength: parseFloat(avgStrength.toFixed(3)),
      dominantCategory,
      styleDrift: parseFloat(clamp(styleDrift, 0, 1).toFixed(3)),
    };
  }

  /**
   * Get all recorded entries.
   * @returns {StyleEntry[]}
   */
  getAll() {
    return [...this._entries];
  }

  /**
   * Get count of entries.
   * @returns {number}
   */
  size() {
    return this._entries.length;
  }

  /**
   * Clear history.
   */
  clear() {
    this._entries = [];
    this._styles.clear();
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Default export: full API surface
// ══════════════════════════════════════════════════════════════════════════════

export default {
  learnStyleFromVideo,
  applyLearnedStyle,
  compareStyles,
  styleTransfer,
  styleRecommendation,
  StyleHistory,
};
