/**
 * personalization.js — Personalization Engine for Vireo Studio (2026-06-10).
 *
 * The AI that learns YOUR taste over time.
 * TasteProfile, TasteAnalyzer, PersonalizedRecommendations,
 * AdaptiveAI, and TasteSharing classes.
 */

// ── Utility helpers ──

function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function round2(n) { return Math.round(n * 100) / 100; }

function hashString(str) {
  let h = 5381;
  for (let i = 0; i < (str || '').length; i++)
    h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// Weighted average helper: merges existing value with new observation.
// weight = influence of new value (0–1). Higher = trusts new data more.
function weightedAvg(existing, newValue, weight) {
  if (existing === undefined || existing === null) return newValue;
  return existing * (1 - weight) + newValue * weight;
}

// ── Constants ──

const CATEGORIES = ['color', 'pacing', 'music', 'text', 'transitions', 'audio'];
const DECAY_FACTOR = 0.95;   // older edits slightly less influential
const MIN_EDITS_FOR_CONFIDENCE = 5;
const DEFAULT_LEARNING_RATE = 0.15;

// ══════════════════════════════════════════════════════════════════════
// 1. TasteProfile
// ══════════════════════════════════════════════════════════════════════

export class TasteProfile {
  constructor(userId) {
    this.userId = userId;
    this.editCount = 0;
    this.history = [];                 // chronological edits
    this.preferences = this._emptyPrefs();
    this.categoryWeights = {};         // per-category confidence counters
    this.styleTimeline = [];           // snapshots for evolution tracking
    this.createdAt = Date.now();
    this.lastUpdatedAt = Date.now();
  }

  // ── private helpers ──

  _emptyPrefs() {
    return {
      color: {
        temperature: null,
        contrast: null,
        saturation: null,
        favorite_presets: [],
      },
      pacing: {
        preferred_clip_duration: null,
        cut_frequency: null,
        rhythm_preference: null,
      },
      music: {
        preferred_genres: [],
        bpm_range: [80, 140],
        energy_preference: null,
      },
      text: {
        preferred_font: null,
        preferred_position: null,
        animation_style: null,
      },
      transitions: {
        preferred_types: [],
        avg_duration: null,
      },
      audio: {
        voice_music_ratio_preference: null,
        compression_preference: null,
      },
      overall: {
        styleDNA: null,
        confidence_score: 0,
        edit_count: 0,
      },
    };
  }

  _categoryForEdit(action) {
    const map = {
      color_grade: 'color',
      color_temperature: 'color',
      color_contrast: 'color',
      color_saturation: 'color',
      clip_select: 'pacing',
      cut_frequency: 'pacing',
      rhythm_change: 'pacing',
      music_choice: 'music',
      music_genre: 'music',
      music_bpm: 'music',
      text_add: 'text',
      text_font: 'text',
      text_position: 'text',
      transition_add: 'transitions',
      transition_type: 'transitions',
      audio_adjust: 'audio',
      audio_compression: 'audio',
    };
    return map[action] || null;
  }

  _learningRate() {
    // Adaptive: starts higher, decreases as more data arrives
    return DEFAULT_LEARNING_RATE * Math.max(0.3, 1 - this.editCount / 200);
  }

  _incrementConfidence(category) {
    if (!this.categoryWeights[category]) this.categoryWeights[category] = 0;
    this.categoryWeights[category] += 1;
  }

  _confidenceFor(category) {
    const w = this.categoryWeights[category] || 0;
    return clamp(w / MIN_EDITS_FOR_CONFIDENCE, 0, 1);
  }

  _snapshotStyleDNA() {
    return {
      timestamp: Date.now(),
      color: deepClone(this.preferences.color),
      pacing: deepClone(this.preferences.pacing),
      music: deepClone(this.preferences.music),
      text: deepClone(this.preferences.text),
      transitions: deepClone(this.preferences.transitions),
      audio: deepClone(this.preferences.audio),
    };
  }

  // ── Public API ──

  /**
   * Learn from a single edit.
   * edit: { action, before, after, context }
   * Returns updated profile preferences.
   */
  learnFromEdit(edit) {
    if (!edit || (!edit.action && edit.action !== '')) return this.preferences;
    if (edit.action === '') {
      this.editCount += 1;
      this.history.push({ ...edit, timestamp: Date.now() });
      this.lastUpdatedAt = Date.now();
      return this.preferences;
    }

    const lr = this._learningRate();
    const cat = this._categoryForEdit(edit.action);

    this.editCount += 1;
    this.history.push({ ...edit, timestamp: Date.now() });
    this.lastUpdatedAt = Date.now();
    this.preferences.overall.edit_count = this.editCount;

    if (cat) {
      this._incrementConfidence(cat);
    }

    // ── Color ──
    if (cat === 'color') {
      if (edit.action === 'color_grade' || edit.action === 'color_temperature') {
        const num = this._extractNumeric(edit.after);
        if (num !== null) {
          this.preferences.color.temperature =
            round2(weightedAvg(this.preferences.color.temperature, num, lr));
        }
        if (edit.after && !this.preferences.color.favorite_presets.includes(edit.after)) {
          this.preferences.color.favorite_presets.push(edit.after);
          if (this.preferences.color.favorite_presets.length > 10)
            this.preferences.color.favorite_presets.shift();
        }
      }
      if (edit.action === 'color_contrast') {
        const num = this._extractNumeric(edit.after);
        if (num !== null) {
          this.preferences.color.contrast =
            round2(weightedAvg(this.preferences.color.contrast, num, lr));
        }
      }
      if (edit.action === 'color_saturation') {
        const num = this._extractNumeric(edit.after);
        if (num !== null) {
          this.preferences.color.saturation =
            round2(weightedAvg(this.preferences.color.saturation, num, lr));
        }
      }
    }

    // ── Pacing ──
    if (cat === 'pacing') {
      if (edit.action === 'clip_select') {
        const dur = this._parseDuration(edit.after);
        if (dur !== null) {
          this.preferences.pacing.preferred_clip_duration =
            round2(weightedAvg(this.preferences.pacing.preferred_clip_duration, dur, lr));
        }
      }
      if (edit.action === 'cut_frequency') {
        const num = this._extractNumeric(edit.after);
        if (num !== null) {
          this.preferences.pacing.cut_frequency =
            round2(weightedAvg(this.preferences.pacing.cut_frequency, num, lr));
        }
      }
      if (edit.action === 'rhythm_change') {
        this.preferences.pacing.rhythm_preference = edit.after;
      }
    }

    // ── Music ──
    if (cat === 'music') {
      if (edit.action === 'music_choice' || edit.action === 'music_genre') {
        if (edit.after && !this.preferences.music.preferred_genres.includes(edit.after)) {
          this.preferences.music.preferred_genres.push(edit.after);
          if (this.preferences.music.preferred_genres.length > 8)
            this.preferences.music.preferred_genres.shift();
        }
      }
      if (edit.action === 'music_bpm') {
        const bpm = this._extractNumeric(edit.after);
        if (bpm !== null) {
          const lo = this.preferences.music.bpm_range[0];
          const hi = this.preferences.music.bpm_range[1];
          this.preferences.music.bpm_range = [
            round2(weightedAvg(lo, bpm, lr)),
            round2(weightedAvg(hi, bpm, lr)),
          ];
        }
      }
      const energy = this._parseEnergy(edit.context || edit.after);
      if (energy !== null) {
        this.preferences.music.energy_preference =
          round2(weightedAvg(this.preferences.music.energy_preference, energy, lr));
      }
    }

    // ── Text ──
    if (cat === 'text') {
      if (edit.action === 'text_font') {
        this.preferences.text.preferred_font = edit.after;
      }
      if (edit.action === 'text_position') {
        this.preferences.text.preferred_position = edit.after;
      }
      if (edit.action === 'text_add') {
        if (edit.after) {
          this.preferences.text.animation_style = edit.after;
        }
      }
    }

    // ── Transitions ──
    if (cat === 'transitions') {
      if (edit.action === 'transition_type' || edit.action === 'transition_add') {
        if (edit.after && !this.preferences.transitions.preferred_types.includes(edit.after)) {
          this.preferences.transitions.preferred_types.push(edit.after);
          if (this.preferences.transitions.preferred_types.length > 8)
            this.preferences.transitions.preferred_types.shift();
        }
        const dur = this._parseDuration(edit.context);
        if (dur !== null) {
          this.preferences.transitions.avg_duration =
            round2(weightedAvg(this.preferences.transitions.avg_duration, dur, lr));
        }
      }
    }

    // ── Audio ──
    if (cat === 'audio') {
      if (edit.action === 'audio_adjust') {
        const ratio = this._extractNumeric(edit.after);
        if (ratio !== null) {
          this.preferences.audio.voice_music_ratio_preference =
            round2(weightedAvg(this.preferences.audio.voice_music_ratio_preference, ratio, lr));
        }
      }
      if (edit.action === 'audio_compression') {
        this.preferences.audio.compression_preference = edit.after;
      }
    }

    // Snapshot for evolution tracking (every 5 edits)
    if (this.editCount % 5 === 0) {
      this.styleTimeline.push(this._snapshotStyleDNA());
    }

    // Update overall confidence
    this.preferences.overall.confidence_score =
      round2(this._overallConfidence());
    this.preferences.overall.styleDNA = this._buildStyleDNA();

    return this.preferences;
  }

  /**
   * Returns the full preferences object.
   */
  getPreferences() {
    return deepClone(this.preferences);
  }

  /**
   * Predicts user preference for a given category.
   * Returns: { predicted_value, confidence, alternatives[] }
   */
  predictPreference(category) {
    const confidence = this._confidenceFor(category);
    const preds = {
      color: () => ({
        predicted_value: {
          temperature: this.preferences.color.temperature,
          contrast: this.preferences.color.contrast,
          saturation: this.preferences.color.saturation,
          preset: this.preferences.color.favorite_presets.slice(-1)[0] || 'default',
        },
        confidence,
        alternatives: this.preferences.color.favorite_presets.slice(-3),
      }),
      pacing: () => ({
        predicted_value: {
          clip_duration: this.preferences.pacing.preferred_clip_duration,
          cut_frequency: this.preferences.pacing.cut_frequency,
          rhythm: this.preferences.pacing.rhythm_preference,
        },
        confidence,
        alternatives: ['steady', 'accelerating', 'varied'].filter(
          v => v !== this.preferences.pacing.rhythm_preference
        ),
      }),
      music: () => ({
        predicted_value: {
          genres: this.preferences.music.preferred_genres.slice(-3),
          bpm_range: this.preferences.music.bpm_range,
          energy: this.preferences.music.energy_preference,
        },
        confidence,
        alternatives: ['electronic', 'ambient', 'lofi', 'rock', 'pop', 'classical'].filter(
          g => !this.preferences.music.preferred_genres.includes(g)
        ),
      }),
      text: () => ({
        predicted_value: {
          font: this.preferences.text.preferred_font,
          position: this.preferences.text.preferred_position,
          animation: this.preferences.text.animation_style,
        },
        confidence,
        alternatives: ['fade', 'slide', 'typewriter'].filter(
          v => v !== this.preferences.text.animation_style
        ),
      }),
      transitions: () => ({
        predicted_value: {
          types: this.preferences.transitions.preferred_types.slice(-3),
          avg_duration: this.preferences.transitions.avg_duration,
        },
        confidence,
        alternatives: ['cut', 'crossfade', 'wipe', 'zoom', 'dissolve'].filter(
          v => !this.preferences.transitions.preferred_types.includes(v)
        ),
      }),
      audio: () => ({
        predicted_value: {
          voice_music_ratio: this.preferences.audio.voice_music_ratio_preference,
          compression: this.preferences.audio.compression_preference,
        },
        confidence,
        alternatives: ['light', 'medium', 'heavy'].filter(
          v => v !== this.preferences.audio.compression_preference
        ),
      }),
    };

    const builder = preds[category];
    if (!builder) {
      return { predicted_value: null, confidence: 0, alternatives: [] };
    }
    return builder();
  }

  /**
   * Returns evolution data: how taste changes over time.
   * Returns: { trend, dominant_style, style_drift, consistency_score }
   */
  getEvolution() {
    const timeline = this.styleTimeline.length > 0 ? this.styleTimeline : [this._snapshotStyleDNA()];

    // Dominant style from most recent preferences
    const dominant = this._detectDominantStyle();

    // Style drift = difference between earliest and latest snapshots
    const drift = this.styleTimeline.length >= 2
      ? this._computeDrift(this.styleTimeline[0], this.styleTimeline[this.styleTimeline.length - 1])
      : 0;

    // Consistency = inverse of variance in color preferences over time
    const consistency = this._computeConsistency();

    return {
      trend: dominant.trend,
      dominant_style: dominant.style,
      style_drift: round2(drift),
      consistency_score: round2(consistency),
      snapshot_count: this.styleTimeline.length,
      total_edits: this.editCount,
    };
  }

  // ── Internal builders ──

  _overallConfidence() {
    if (this.editCount === 0) return 0;
    const catConfs = CATEGORIES.map(c => this._confidenceFor(c));
    const avg = catConfs.reduce((a, b) => a + b, 0) / catConfs.length;
    return clamp(avg * (Math.min(this.editCount, 20) / 20), 0, 1);
  }

  _buildStyleDNA() {
    return {
      color: { ...this.preferences.color },
      pacing: { ...this.preferences.pacing },
      music: { ...this.preferences.music },
      text: { ...this.preferences.text },
      transitions: { ...this.preferences.transitions },
      audio: { ...this.preferences.audio },
    };
  }

  _detectDominantStyle() {
    const freq = {};
    for (const h of this.history) {
      const cat = this._categoryForEdit(h.action);
      if (cat) freq[cat] = (freq[cat] || 0) + 1;
    }
    let maxCat = 'unknown';
    let maxCount = 0;
    for (const [cat, count] of Object.entries(freq)) {
      if (count > maxCount) { maxCat = cat; maxCount = count; }
    }
    const trendMap = {
      color: 'cinematic',
      pacing: 'fast',
      music: 'rhythmic',
      text: 'minimal',
      transitions: 'smooth',
      audio: 'balanced',
    };
    return { style: maxCat, trend: trendMap[maxCat] || 'developing' };
  }

  _computeDrift(oldSnap, newSnap) {
    // Compute Euclidean-ish distance across numeric fields
    let sum = 0;
    let n = 0;
    const fields = [
      ['color', 'temperature'], ['color', 'contrast'], ['color', 'saturation'],
      ['pacing', 'preferred_clip_duration'], ['pacing', 'cut_frequency'],
      ['music', 'energy_preference'],
      ['transitions', 'avg_duration'],
      ['audio', 'voice_music_ratio_preference'],
    ];
    for (const [sec, key] of fields) {
      const a = oldSnap[sec]?.[key];
      const b = newSnap[sec]?.[key];
      if (a != null && b != null) { sum += Math.abs(b - a); n++; }
    }
    return n > 0 ? sum / n : 0;
  }

  _computeConsistency() {
    if (this.styleTimeline.length < 2) return 1;
    // Measure variance in clip_duration over timeline
    const vals = this.styleTimeline.map(s => s.pacing?.preferred_clip_duration).filter(v => v != null);
    if (vals.length < 2) return 1;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length;
    // Normalize: small variance → high consistency
    return clamp(1 - variance / 25, 0, 1);
  }

  _extractNumeric(val) {
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
      const m = val.match(/-?\d+(\.\d+)?/);
      if (m) return parseFloat(m[0]);
    }
    return null;
  }

  _parseDuration(val) {
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
      const m = val.match(/(\d+(?:\.\d+)?)\s*s/);
      if (m) return parseFloat(m[1]);
      const numeric = this._extractNumeric(val);
      if (numeric !== null) return numeric;
      // Map common text duration names
      const nameMap = { short: 1.5, medium: 3, long: 5, very_long: 8, ultra_short: 0.5 };
      if (nameMap[val.toLowerCase()]) return nameMap[val.toLowerCase()];
      return null;
    }
    return null;
  }

  _parseEnergy(val) {
    if (typeof val === 'number') return clamp(val, 0, 1);
    if (typeof val !== 'string') return null;
    const low = ['chill', 'relaxed', 'calm', 'ambient', 'soft'];
    const med = ['moderate', 'medium', 'steady'];
    const high = ['high', 'energetic', 'intense', 'loud', 'fast', 'upbeat'];
    const v = val.toLowerCase();
    if (low.some(w => v.includes(w))) return 0.3;
    if (med.some(w => v.includes(w))) return 0.6;
    if (high.some(w => v.includes(w))) return 0.9;
    return null;
  }

  // Serialization
  toJSON() {
    return {
      userId: this.userId,
      editCount: this.editCount,
      preferences: deepClone(this.preferences),
      categoryWeights: { ...this.categoryWeights },
      styleTimeline: deepClone(this.styleTimeline),
      history: deepClone(this.history),
      createdAt: this.createdAt,
      lastUpdatedAt: this.lastUpdatedAt,
    };
  }

  static fromJSON(data) {
    const p = new TasteProfile(data.userId);
    p.editCount = data.editCount || 0;
    p.preferences = data.preferences || p._emptyPrefs();
    p.categoryWeights = data.categoryWeights || {};
    p.styleTimeline = data.styleTimeline || [];
    p.history = data.history || [];
    p.createdAt = data.createdAt || Date.now();
    p.lastUpdatedAt = data.lastUpdatedAt || Date.now();
    return p;
  }
}

// ══════════════════════════════════════════════════════════════════════
// 2. TasteAnalyzer
// ══════════════════════════════════════════════════════════════════════

export class TasteAnalyzer {
  /**
   * Analyze a single project.
   * project: { id, title?, duration?, genre?, tags?, mood?, complexity?, audience? }
   * Returns: { genre, mood, complexity, target_audience, detected_features }
   */
  analyzeProject(project) {
    if (!project) {
      return { genre: 'unknown', mood: 'neutral', complexity: 'simple', target_audience: 'general', detected_features: [] };
    }

    const title = (project.title || '').toLowerCase();
    const tags = (project.tags || []).map(t => t.toLowerCase());
    const allText = title + ' ' + tags.join(' ');

    // Genre detection
    const genreKeywords = {
      vlog: ['vlog', 'daily', 'day in', 'routine', 'life'],
      tutorial: ['tutorial', 'how to', 'learn', 'guide', 'course'],
      cinematic: ['cinematic', 'film', 'cinema', 'story'],
      gaming: ['gaming', 'game', 'play', 'stream', 'esport'],
      music_video: ['music', 'mv', 'clip', 'song'],
      review: ['review', 'unbox', 'test', 'compare'],
      comedy: ['funny', 'comedy', 'humor', 'meme', 'lol'],
      documentary: ['documentary', 'doc', 'real', 'true story'],
    };

    let detectedGenre = project.genre || 'general';
    for (const [genre, keywords] of Object.entries(genreKeywords)) {
      if (keywords.some(kw => allText.includes(kw))) {
        detectedGenre = genre;
        break;
      }
    }

    // Mood detection
    const moodKeywords = {
      happy: ['happy', 'joy', 'fun', 'excited', 'cheerful'],
      sad: ['sad', 'melancholy', 'emotional', 'tears', 'grief'],
      energetic: ['energetic', 'hype', 'fast', 'intense', 'power'],
      calm: ['calm', 'peaceful', 'relax', 'serene', 'zen'],
      dramatic: ['dramatic', 'epic', 'powerful', 'intense'],
      mysterious: ['mystery', 'dark', 'suspense', 'creepy'],
    };

    let detectedMood = project.mood || 'neutral';
    for (const [mood, keywords] of Object.entries(moodKeywords)) {
      if (keywords.some(kw => allText.includes(kw))) {
        detectedMood = mood;
        break;
      }
    }

    // Complexity
    const duration = project.duration || 60;
    let complexity = 'simple';
    if (duration > 600) complexity = 'complex';
    else if (duration > 180) complexity = 'moderate';

    if (tags.length > 5 || title.split(' ').length > 10) {
      complexity = complexity === 'simple' ? 'moderate' : 'complex';
    }

    // Target audience
    let audience = project.audience || 'general';
    if (detectedGenre === 'gaming') audience = 'youth';
    if (detectedGenre === 'tutorial') audience = 'learners';
    if (detectedGenre === 'documentary') audience = 'adults';

    const features = [];
    if (project.duration && project.duration > 300) features.push('long_form');
    if (project.duration && project.duration < 60) features.push('short_form');
    if (tags.includes('4k') || tags.includes('hd')) features.push('high_resolution');
    if (tags.includes('music')) features.push('music_driven');

    return {
      genre: detectedGenre,
      mood: detectedMood,
      complexity,
      target_audience: audience,
      detected_features: features,
    };
  }

  /**
   * Analyze a history of projects.
   * Returns: { common_patterns, style_evolution, strengths, areas_to_explore }
   */
  analyzeHistory(projects) {
    if (!projects || projects.length === 0) {
      return {
        common_patterns: [],
        style_evolution: 'no_data',
        strengths: [],
        areas_to_explore: [],
      };
    }

    const analyses = projects.map(p => this.analyzeProject(p));

    // Common patterns
    const genreCounts = {};
    const moodCounts = {};
    const complexityCounts = {};
    for (const a of analyses) {
      genreCounts[a.genre] = (genreCounts[a.genre] || 0) + 1;
      moodCounts[a.mood] = (moodCounts[a.mood] || 0) + 1;
      complexityCounts[a.complexity] = (complexityCounts[a.complexity] || 0) + 1;
    }

    const topGenre = Object.entries(genreCounts).sort((a, b) => b[1] - a[1])[0];
    const topMood = Object.entries(moodCounts).sort((a, b) => b[1] - a[1])[0];

    const common_patterns = [];
    if (topGenre) common_patterns.push({ pattern: `prefers_${topGenre[0]}`, frequency: topGenre[1] });
    if (topMood) common_patterns.push({ pattern: `favors_${topMood[0]}_mood`, frequency: topMood[1] });

    // Style evolution
    let styleEvolution = 'stable';
    if (analyses.length >= 3) {
      const early = analyses.slice(0, Math.floor(analyses.length / 2));
      const late = analyses.slice(Math.floor(analyses.length / 2));
      const earlyGenres = early.map(a => a.genre);
      const lateGenres = late.map(a => a.genre);
      const changed = earlyGenres[0] !== lateGenres[lateGenres.length - 1];
      styleEvolution = changed ? 'evolving' : 'stable';
    }

    // Strengths
    const strengths = [];
    if (topGenre && topGenre[1] >= 3) strengths.push(`strong_in_${topGenre[0]}`);
    if (analyses.every(a => a.complexity !== 'simple')) strengths.push('complex_works');
    const uniqueGenres = Object.keys(genreCounts).length;
    if (uniqueGenres >= 3) strengths.push('genre_versatility');

    // Areas to explore
    const allGenres = ['vlog', 'tutorial', 'cinematic', 'gaming', 'music_video', 'review', 'comedy', 'documentary'];
    const areasToExplore = allGenres.filter(g => !genreCounts[g]);
    const areas = areasToExplore.slice(0, 3).map(g => ({ area: g, reason: `unexplored_genre` }));

    return {
      common_patterns,
      style_evolution: styleEvolution,
      strengths,
      areas_to_explore: areas,
      total_projects: projects.length,
    };
  }

  /**
   * Suggest experiments based on current taste profile.
   * Returns: { style, reason, expected_result, risk_level }[]
   */
  suggestExperiments(profile) {
    const prefs = profile.getPreferences ? profile.getPreferences() : profile;
    const experiments = [];

    // If user always uses same color temp, suggest opposite
    if (prefs.color?.temperature) {
      const current = prefs.color.temperature;
      experiments.push({
        style: 'color_temperature_shift',
        reason: `You typically use ${current}K — try ${current > 5500 ? 'warmer (4500K)' : 'cooler (6500K)'}`,
        expected_result: 'Fresh visual feel without changing content',
        risk_level: 'low',
      });
    }

    // If user never uses certain transitions
    const knownTrans = ['cut', 'crossfade', 'wipe', 'zoom', 'dissolve'];
    const unusedTrans = knownTrans.filter(t => !(prefs.transitions?.preferred_types || []).includes(t));
    if (unusedTrans.length > 0) {
      experiments.push({
        style: 'transition_' + unusedTrans[0],
        reason: `Try ${unusedTrans[0]} transitions — you haven't used this style yet`,
        expected_result: 'New visual rhythm and flow',
        risk_level: 'medium',
      });
    }

    // Music genre experiment
    const allGenres = ['electronic', 'ambient', 'rock', 'pop', 'lofi', 'classical', 'hip-hop', 'jazz'];
    const userGenres = prefs.music?.preferred_genres || [];
    const newGenres = allGenres.filter(g => !userGenres.includes(g));
    if (newGenres.length > 0) {
      experiments.push({
        style: 'music_genre_' + newGenres[0],
        reason: `Explore ${newGenres[0]} music — different energy for your content`,
        expected_result: 'New emotional tone and audience appeal',
        risk_level: 'medium',
      });
    }

    // Pacing experiment
    if (prefs.pacing?.preferred_clip_duration) {
      const dur = prefs.pacing.preferred_clip_duration;
      experiments.push({
        style: 'pacing_variety',
        reason: `Your clips average ${round2(dur)}s — try ${dur > 3 ? 'shorter cuts' : 'longer takes'}`,
        expected_result: 'Different storytelling energy',
        risk_level: 'low',
      });
    }

    // Text experiment
    if (prefs.text?.animation_style) {
      const allAnims = ['fade', 'slide', 'typewriter', 'bounce', 'scale'];
      const unused = allAnims.filter(a => a !== prefs.text.animation_style);
      if (unused.length > 0) {
        experiments.push({
          style: 'text_animation_' + unused[0],
          reason: `Try ${unused[0]} text animation — your current choice is ${prefs.text.animation_style}`,
          expected_result: 'Fresher text presentation',
          risk_level: 'low',
        });
      }
    }

    return experiments.slice(0, 5);
  }
}

// ══════════════════════════════════════════════════════════════════════
// 3. PersonalizedRecommendations
// ══════════════════════════════════════════════════════════════════════

export class PersonalizedRecommendations {
  /**
   * Recommend style for a project based on profile.
   * Returns: { style, confidence, reasoning, alternatives[] }
   */
  recommendStyle(project, profile) {
    const prefs = profile.getPreferences ? profile.getPreferences() : profile;
    const analyzer = new TasteAnalyzer();
    const analysis = analyzer.analyzeProject(project);

    const dominant = prefs.overall?.styleDNA;
    let style = 'balanced';
    let reasoning = '';

    // Match genre to color preference
    if (analysis.genre === 'cinematic') {
      style = 'warm_cinematic';
      reasoning = 'Your cinematic projects tend toward warm color grading with moderate pacing';
    } else if (analysis.genre === 'gaming') {
      style = 'high_energy';
      reasoning = 'Gaming content works well with high contrast and fast cuts';
    } else if (analysis.genre === 'tutorial') {
      style = 'clean_professional';
      reasoning = 'Tutorial content benefits from clean, readable text and steady pacing';
    } else if (analysis.mood === 'calm') {
      style = 'soft_ambient';
      reasoning = 'Calm mood pairs with soft lighting and gentle transitions';
    } else {
      // Fall back to profile preferences
      if (prefs.color?.saturation > 0.8) {
        style = 'vibrant';
        reasoning = 'Your profile shows preference for saturated, vivid colors';
      } else if (prefs.color?.contrast > 1.0) {
        style = 'high_contrast';
        reasoning = 'Your profile favors high contrast visuals';
      } else {
        style = 'natural';
        reasoning = 'Defaulting to natural, balanced styling';
      }
    }

    const confidence = prefs.overall?.confidence_score || 0;

    const alternatives = [];
    if (style !== 'warm_cinematic') alternatives.push('warm_cinematic');
    if (style !== 'high_energy') alternatives.push('high_energy');
    if (style !== 'clean_professional') alternatives.push('clean_professional');
    if (style !== 'soft_ambient') alternatives.push('soft_ambient');
    if (style !== 'natural') alternatives.push('natural');

    return { style, confidence: round2(confidence), reasoning, alternatives: alternatives.slice(0, 3) };
  }

  /**
   * Recommend music for a project.
   * Returns: { genre, bpm, energy, mood_match, alternatives[] }
   */
  recommendMusic(project, profile) {
    const prefs = profile.getPreferences ? profile.getPreferences() : profile;
    const analyzer = new TasteAnalyzer();
    const analysis = analyzer.analyzeProject(project);

    const userGenres = prefs.music?.preferred_genres || [];
    let genre = userGenres.length > 0 ? userGenres[userGenres.length - 1] : 'ambient';

    // Adjust based on mood
    if (analysis.mood === 'energetic') genre = 'electronic';
    if (analysis.mood === 'calm') genre = 'ambient';
    if (analysis.mood === 'sad') genre = 'classical';

    const bpmRange = prefs.music?.bpm_range || [80, 140];
    const avgBpm = Math.round((bpmRange[0] + bpmRange[1]) / 2);

    let energy = prefs.music?.energy_preference || 0.5;
    if (analysis.mood === 'energetic') energy = Math.min(energy + 0.2, 1);
    if (analysis.mood === 'calm') energy = Math.max(energy - 0.2, 0);

    const moodMatch = analysis.mood !== 'unknown';

    const alternatives = userGenres
      .filter(g => g !== genre)
      .slice(0, 3);

    return {
      genre,
      bpm: avgBpm,
      energy: round2(energy),
      mood_match: moodMatch,
      alternatives,
    };
  }

  /**
   * Recommend pacing for a project.
   * Returns: { clip_duration, cut_frequency, rhythm, reasoning }
   */
  recommendPacing(project, profile) {
    const prefs = profile.getPreferences ? profile.getPreferences() : profile;
    const analyzer = new TasteAnalyzer();
    const analysis = analyzer.analyzeProject(project);

    let clipDuration = prefs.pacing?.preferred_clip_duration || 3;
    let cutFrequency = prefs.pacing?.cut_frequency || 0.5;
    let rhythm = prefs.pacing?.rhythm_preference || 'steady';

    // Adjust for genre
    if (analysis.genre === 'cinematic') {
      clipDuration = Math.max(clipDuration, 4); // longer takes
      rhythm = 'steady';
    } else if (analysis.genre === 'gaming') {
      clipDuration = Math.min(clipDuration, 2); // faster cuts
      cutFrequency = Math.min(cutFrequency + 0.2, 1);
      rhythm = 'accelerating';
    } else if (analysis.genre === 'tutorial') {
      clipDuration = Math.max(clipDuration, 5);
      rhythm = 'steady';
    } else if (analysis.mood === 'calm') {
      rhythm = 'steady';
      cutFrequency = Math.max(cutFrequency - 0.1, 0);
    }

    return {
      clip_duration: round2(clipDuration),
      cut_frequency: round2(cutFrequency),
      rhythm,
      reasoning: `Based on ${analysis.genre} genre, ${analysis.mood} mood, and your preference for ${rhythm} pacing`,
    };
  }

  /**
   * Recommend thumbnail style.
   * Returns: { color_scheme, text_placement, style, confidence }
   */
  recommendThumbnail(project, profile) {
    const prefs = profile.getPreferences ? profile.getPreferences() : profile;
    const analyzer = new TasteAnalyzer();
    const analysis = analyzer.analyzeProject(project);

    let colorScheme = 'high_contrast';
    let textPlacement = prefs.text?.preferred_position || 'center';
    let style = 'clean';

    if (analysis.genre === 'gaming') {
      colorScheme = 'vibrant';
      style = 'bold';
      textPlacement = 'center';
    } else if (analysis.genre === 'cinematic') {
      colorScheme = 'warm_muted';
      style = 'minimal';
      textPlacement = 'lower-third';
    } else if (analysis.genre === 'tutorial') {
      colorScheme = 'clean_white';
      style = 'professional';
      textPlacement = 'center';
    }

    return {
      color_scheme: colorScheme,
      text_placement: textPlacement,
      style,
      confidence: round2(prefs.overall?.confidence_score || 0.3),
    };
  }
}

// ══════════════════════════════════════════════════════════════════════
// 4. AdaptiveAI
// ══════════════════════════════════════════════════════════════════════

export class AdaptiveAI {
  constructor() {
    this.feedbackLog = [];
    this.adaptationHistory = [];
    this.totalAdjustments = 0;
    this.acceptedAdjustments = 0;
  }

  /**
   * Takes AI Director output and adjusts to user taste.
   * aiOutput: { color?, pacing?, music?, text?, transitions?, audio?, ... }
   * Returns: AdjustedOutput
   */
  adjustForUser(aiOutput, profile) {
    if (!aiOutput) return {};
    const prefs = profile.getPreferences ? profile.getPreferences() : profile;
    const level = Math.max(this.getAdaptationLevel(), 0.1); // minimum base adaptation
    const adjusted = deepClone(aiOutput);

    // Apply color preferences
    if (adjusted.color && prefs.color) {
      if (prefs.color.temperature && level >= 0.1) {
        const blend = clamp(level, 0, 1);
        adjusted.color.temperature = Math.round(
          lerp(adjusted.color.temperature || 5500, prefs.color.temperature, blend)
        );
      }
      if (prefs.color.saturation && level > 0.2) {
        const blend = clamp(level, 0, 1);
        adjusted.color.saturation = round2(
          lerp(adjusted.color.saturation || 1.0, prefs.color.saturation, blend)
        );
      }
      if (prefs.color.contrast && level > 0.2) {
        const blend = clamp(level, 0, 1);
        adjusted.color.contrast = round2(
          lerp(adjusted.color.contrast || 1.0, prefs.color.contrast, blend)
        );
      }
    }

    // Apply pacing preferences
    if (adjusted.pacing && prefs.pacing) {
      if (prefs.pacing.preferred_clip_duration && level > 0.15) {
        const blend = clamp(level, 0, 1);
        adjusted.pacing.clip_duration = round2(
          lerp(adjusted.pacing.clip_duration || 3, prefs.pacing.preferred_clip_duration, blend)
        );
      }
      if (prefs.pacing.rhythm_preference && level > 0.3) {
        adjusted.pacing.rhythm = prefs.pacing.rhythm_preference;
      }
    }

    // Apply music preferences
    if (adjusted.music && prefs.music) {
      if (prefs.music.preferred_genres.length > 0 && level > 0.2) {
        const preferred = prefs.music.preferred_genres[prefs.music.preferred_genres.length - 1];
        adjusted.music.genre = preferred;
      }
    }

    // Apply text preferences
    if (adjusted.text && prefs.text) {
      if (prefs.text.preferred_font && level > 0.2) {
        adjusted.text.font = prefs.text.preferred_font;
      }
      if (prefs.text.animation_style && level > 0.3) {
        adjusted.text.animation = prefs.text.animation_style;
      }
    }

    this.totalAdjustments += 1;

    return {
      ...adjusted,
      _adaptation: {
        level: round2(level),
        applied: true,
        original: aiOutput,
      },
    };
  }

  /**
   * Learn from user feedback.
   * feedback: { accepted: bool, rating: 1-5, comment? }
   * Returns: updated state
   */
  learnFromFeedback(output, feedback) {
    if (!feedback) return this;

    this.feedbackLog.push({
      output: deepClone(output),
      feedback: { ...feedback },
      timestamp: Date.now(),
    });

    if (feedback.accepted) {
      this.acceptedAdjustments += 1;
    }

    // High rating = reinforce adaptation; low = reduce
    if (feedback.rating >= 4) {
      this.adaptationHistory.push({ direction: 'increase', magnitude: feedback.rating / 5 });
    } else if (feedback.rating <= 2) {
      this.adaptationHistory.push({ direction: 'decrease', magnitude: (6 - feedback.rating) / 5 });
    }

    // Cap history
    if (this.feedbackLog.length > 500) {
      this.feedbackLog = this.feedbackLog.slice(-500);
    }
    if (this.adaptationHistory.length > 500) {
      this.adaptationHistory = this.adaptationHistory.slice(-500);
    }

    return this;
  }

  /**
   * Returns adaptation level (0-1).
   * Higher = more adapted to user taste.
   */
  getAdaptationLevel() {
    if (this.totalAdjustments === 0) return 0;

    // Base: ratio of accepted adjustments
    const acceptRate = this.acceptedAdjustments / this.totalAdjustments;

    // Bonus from recent high ratings
    const recent = this.adaptationHistory.slice(-20);
    const recentBoost = recent.length > 0
      ? recent.reduce((s, h) => s + (h.direction === 'increase' ? h.magnitude : -h.magnitude), 0) / recent.length
      : 0;

    // Grow with more data, cap at 1
    const dataGrowth = clamp(this.totalAdjustments / 50, 0, 0.5);

    return clamp(acceptRate * 0.5 + (recentBoost + 1) * 0.25 + dataGrowth, 0, 1);
  }
}

// ══════════════════════════════════════════════════════════════════════
// 5. TasteSharing
// ══════════════════════════════════════════════════════════════════════

export class TasteSharing {
  constructor() {
    this.profiles = new Map(); // userId → TasteProfile (in-memory store)
  }

  /**
   * Register a profile for sharing.
   */
  registerProfile(profile) {
    if (profile && profile.userId) {
      this.profiles.set(profile.userId, profile);
    }
  }

  /**
   * Export taste as JSON string.
   * Returns: { userId, exported_at, preferences, edit_count }
   */
  exportTaste(userId) {
    const profile = this.profiles.get(userId);
    if (!profile) return null;

    const data = profile.toJSON ? profile.toJSON() : profile;
    return {
      userId: data.userId,
      exported_at: Date.now(),
      preferences: data.preferences,
      edit_count: data.editCount,
    };
  }

  /**
   * Import another user's taste.
   * Returns: TasteProfile or null
   */
  importTaste(userId, data) {
    if (!data || !data.preferences) return null;

    let profile = this.profiles.get(userId);
    if (!profile) {
      profile = new TasteProfile(userId);
      this.profiles.set(userId, profile);
    }

    // Merge: take imported values, don't overwrite existing stronger preferences
    const imported = data.preferences;
    const prefs = profile.getPreferences();

    for (const cat of CATEGORIES) {
      if (imported[cat]) {
        for (const [key, val] of Object.entries(imported[cat])) {
          if (val !== null && val !== undefined && prefs[cat][key] === null) {
            prefs[cat][key] = val;
          }
        }
      }
    }

    // Merge list preferences (genres, presets, transitions)
    if (imported.music?.preferred_genres) {
      for (const g of imported.music.preferred_genres) {
        if (!prefs.music.preferred_genres.includes(g)) {
          prefs.music.preferred_genres.push(g);
        }
      }
    }
    if (imported.color?.favorite_presets) {
      for (const p of imported.color.favorite_presets) {
        if (!prefs.color.favorite_presets.includes(p)) {
          prefs.color.favorite_presets.push(p);
        }
      }
    }
    if (imported.transitions?.preferred_types) {
      for (const t of imported.transitions.preferred_types) {
        if (!prefs.transitions.preferred_types.includes(t)) {
          prefs.transitions.preferred_types.push(t);
        }
      }
    }

    // Apply merged
    profile.preferences = prefs;

    // Snapshot
    profile.styleTimeline.push(profile._snapshotStyleDNA());

    return profile;
  }

  /**
   * Find users with similar taste.
   * Returns: { userId, similarity_score }[]
   */
  findSimilarUsers(userId) {
    const target = this.profiles.get(userId);
    if (!target) return [];

    const targetPrefs = target.getPreferences ? target.getPreferences() : target;
    const results = [];

    for (const [uid, profile] of this.profiles) {
      if (uid === userId) continue;

      const otherPrefs = profile.getPreferences ? profile.getPreferences() : profile;
      const similarity = this._computeSimilarity(targetPrefs, otherPrefs);

      if (similarity > 0.3) {
        results.push({ userId: uid, similarity_score: round2(similarity) });
      }
    }

    results.sort((a, b) => b.similarity_score - a.similarity_score);
    return results.slice(0, 10);
  }

  /**
   * Share taste with another user (copies key preferences).
   * Returns: boolean
   */
  shareTaste(userId, targetUserId) {
    const source = this.profiles.get(userId);
    const target = this.profiles.get(targetUserId);
    if (!source || !target) return false;

    const sourceData = source.toJSON ? source.toJSON() : source;
    this.importTaste(targetUserId, { preferences: sourceData.preferences });

    return true;
  }

  // ── Similarity computation ──

  _computeSimilarity(a, b) {
    let score = 0;
    let total = 0;

    // Color similarity (only count fields where at least one has data)
    const colorFields = ['temperature', 'contrast', 'saturation'];
    for (const f of colorFields) {
      const va = a.color?.[f];
      const vb = b.color?.[f];
      if (va != null || vb != null) {
        if (va != null && vb != null) {
          const maxRange = f === 'temperature' ? 10000 : 2;
          const diff = Math.abs(va - vb) / maxRange;
          score += 1 - diff;
        } else {
          score += 0.4; // partial match: one has data, other doesn't
        }
        total += 1;
      }
    }

    // Music genre overlap
    const genresA = new Set(a.music?.preferred_genres || []);
    const genresB = new Set(b.music?.preferred_genres || []);
    if (genresA.size > 0 || genresB.size > 0) {
      const union = new Set([...genresA, ...genresB]);
      const inter = new Set([...genresA].filter(g => genresB.has(g)));
      score += union.size > 0 ? inter.size / union.size : 0;
      total += 1;
    }

    // Pacing similarity (only count if at least one has data)
    const durA = a.pacing?.preferred_clip_duration;
    const durB = b.pacing?.preferred_clip_duration;
    if (durA != null || durB != null) {
      if (durA != null && durB != null) {
        score += 1 - clamp(Math.abs(durA - durB) / 10, 0, 1);
      } else {
        score += 0.4;
      }
      total += 1;
    }

    // Transition overlap
    const transA = new Set(a.transitions?.preferred_types || []);
    const transB = new Set(b.transitions?.preferred_types || []);
    if (transA.size > 0 || transB.size > 0) {
      const union = new Set([...transA, ...transB]);
      const inter = new Set([...transA].filter(t => transB.has(t)));
      score += union.size > 0 ? inter.size / union.size : 0;
      total += 1;
    }

    return total > 0 ? score / total : 0;
  }
}
