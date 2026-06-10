/**
 * Vireo Studio - AI Director Module
 *
 * THE KILLER FEATURE: An AI that thinks like a film director.
 *
 * Full pipeline:
 *   Brief → Footage Analysis → Engagement Scoring → Clip Selection
 *   → Timeline Composition → Music Recommendation → Text Overlays → Export
 *
 * Classes:
 *   - DirectorAgent    — The brain: analyzes, scores, selects, composes
 *   - QualityScorer    — Evaluates and compares timelines
 *   - ExportPlanner    — Adapts timelines for every platform
 */

import { randomUUID } from "node:crypto";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Deterministic hash for strings → integer (for reproducible tests). */
function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** Seeded pseudo-random number generator (0-1). */
function seededRandom(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SCENE_TYPES = ['action', 'talking', 'landscape', 'closeup', 'transition'];
export { SCENE_TYPES };
const MOODS = ['energetic', 'calm', 'dramatic', 'funny'];
const MOTION_LEVELS = ['low', 'medium', 'high'];
const VALID_STYLES = ['fast', 'slow', 'dramatic'];
const TRANSITION_TYPES = ['cut', 'crossfade', 'wipe', 'dissolve', 'zoom'];

const PLATFORM_SPECS = {
  youtube: {
    aspect_ratio: '16:9',
    max_duration: 43200,
    resolution: '1920x1080',
    codec: 'h264',
    max_bitrate: '8M',
    file_size_per_min_mb: 50,
  },
  tiktok: {
    aspect_ratio: '9:16',
    max_duration: 600,
    resolution: '1080x1920',
    codec: 'h264',
    max_bitrate: '10M',
    file_size_per_min_mb: 60,
  },
  instagram_reels: {
    aspect_ratio: '9:16',
    max_duration: 90,
    resolution: '1080x1920',
    codec: 'h264',
    max_bitrate: '8M',
    file_size_per_min_mb: 50,
  },
  instagram_feed: {
    aspect_ratio: '1:1',
    max_duration: 60,
    resolution: '1080x1080',
    codec: 'h264',
    max_bitrate: '6M',
    file_size_per_min_mb: 40,
  },
  instagram_story: {
    aspect_ratio: '9:16',
    max_duration: 15,
    resolution: '1080x1920',
    codec: 'h264',
    max_bitrate: '8M',
    file_size_per_min_mb: 50,
  },
  twitter: {
    aspect_ratio: '16:9',
    max_duration: 140,
    resolution: '1280x720',
    codec: 'h264',
    max_bitrate: '5M',
    file_size_per_min_mb: 30,
  },
  facebook: {
    aspect_ratio: '16:9',
    max_duration: 240,
    resolution: '1920x1080',
    codec: 'h264',
    max_bitrate: '8M',
    file_size_per_min_mb: 50,
  },
  linkedin: {
    aspect_ratio: '16:9',
    max_duration: 600,
    resolution: '1920x1080',
    codec: 'h264',
    max_bitrate: '8M',
    file_size_per_min_mb: 50,
  },
  youtube_shorts: {
    aspect_ratio: '9:16',
    max_duration: 60,
    resolution: '1080x1920',
    codec: 'h264',
    max_bitrate: '10M',
    file_size_per_min_mb: 60,
  },
};

const MUSIC_GENRES = {
  energetic: ['electronic', 'pop', 'rock', 'hip-hop'],
  calm: ['ambient', 'acoustic', 'lofi', 'classical'],
  dramatic: ['cinematic', 'orchestral', 'trailer', 'epic'],
  funny: ['ukulele', 'quirky', 'comedy', 'ragtime'],
};

const TEXT_ANIMATIONS = ['fade', 'slide', 'typewriter', 'bounce', 'scale'];

// ═══════════════════════════════════════════════════════════════════════════════
// DirectorAgent — The AI Brain
// ═══════════════════════════════════════════════════════════════════════════════

export class DirectorAgent {
  constructor(options = {}) {
    this.seed = options.seed ?? Date.now();
    this.version = '1.0.0';
  }

  // ── 1. analyzeBrief ────────────────────────────────────────────────────

  /**
   * Analyze a creative brief to extract structure and direction.
   * @param {Object} brief
   * @param {string} brief.description - Creative direction text
   * @param {Object[]} [brief.footage] - Available footage references
   * @param {number} brief.duration_sec - Target duration
   * @param {string[]} brief.platforms - Target platforms
   * @param {string} [brief.style] - fast | slow | dramatic
   * @param {string} [brief.music_mood] - Desired music mood
   * @param {string} [brief.text_overlay] - Desired text overlay content
   * @returns {AnalyzedBrief}
   */
  analyzeBrief(brief) {
    if (!brief || typeof brief !== 'object') {
      throw new Error('brief is required and must be an object');
    }
    if (brief.duration_sec !== undefined && brief.duration_sec <= 0) {
      throw new Error('duration_sec must be positive');
    }
    if (brief.platforms && !Array.isArray(brief.platforms)) {
      throw new Error('platforms must be an array');
    }

    const desc = (brief.description || '').toLowerCase();
    const duration = brief.duration_sec || 30;
    const style = brief.style || this._inferStyle(duration, brief.platforms);
    const mood = brief.music_mood || this._inferMood(desc);
    const footageCount = (brief.footage || []).length;

    // Detect scenes from description keywords
    const scenes = this._detectScenes(desc, footageCount, duration);

    // Mood analysis
    const moodAnalysis = {
      primary: mood,
      secondary: this._secondaryMood(mood),
      intensity: this._moodIntensity(desc),
      keywords: this._extractMoodKeywords(desc),
    };

    // Pacing recommendation
    const pacing = this._recommendPacing(style, duration, brief.platforms);

    // Target audience inference
    const audience = this._inferAudience(desc, brief.platforms, style);

    return {
      scenes_detected: scenes,
      mood_analysis: moodAnalysis,
      pacing_recommendation: pacing,
      target_audience: audience,
      inferred_style: style,
      inferred_mood: mood,
      duration_sec: duration,
      platform_count: (brief.platforms || []).length,
    };
  }

  // ── 2. analyzeFootage ──────────────────────────────────────────────────

  /**
   * Analyze an array of footage clips.
   * @param {Object[]} footage - Array of clip objects with metadata
   * @returns {FootageAnalysis}
   */
  analyzeFootage(footage) {
    if (!Array.isArray(footage)) {
      throw new Error('footage must be an array');
    }

    const rand = seededRandom(this.seed);
    const clips = footage.map((clip, idx) => {
      const pathStr = clip.path || clip.url || clip.id || `clip_${idx}`;
      const clipSeed = hashString(pathStr);
      const clipRand = seededRandom(clipSeed);

      const duration = clip.duration_sec || (2 + clipRand() * 8);
      const sceneType = clip.scene_type || SCENE_TYPES[Math.floor(clipRand() * SCENE_TYPES.length)];
      const mood = clip.mood || MOODS[Math.floor(clipRand() * MOODS.length)];

      return {
        id: clip.id || `clip-${idx}-${randomUUID().slice(0, 8)}`,
        source: pathStr,
        scene_type: sceneType,
        mood,
        quality_score: clamp(clip.quality_score ?? (0.5 + clipRand() * 0.5), 0, 1),
        audio_quality: clamp(clip.audio_quality ?? (0.4 + clipRand() * 0.6), 0, 1),
        face_count: clip.face_count ?? Math.floor(clipRand() * 4),
        motion_level: clip.motion_level || MOTION_LEVELS[Math.floor(clipRand() * 3)],
        duration_sec: parseFloat(duration.toFixed(2)),
        resolution: clip.resolution || '1920x1080',
        fps: clip.fps || 30,
      };
    });

    const totalDuration = parseFloat(clips.reduce((sum, c) => sum + c.duration_sec, 0).toFixed(2));

    // Find best moments (top quality + engagement potential)
    const bestMoments = clips
      .map(c => ({
        clip_id: c.id,
        start_sec: 0,
        end_sec: c.duration_sec,
        score: (c.quality_score * 0.4) + (c.audio_quality * 0.2) +
          (c.face_count > 0 ? 0.2 : 0) +
          (c.motion_level === 'high' ? 0.15 : c.motion_level === 'medium' ? 0.1 : 0.05),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.min(5, clips.length));

    return {
      clips,
      total_duration: totalDuration,
      best_moments: bestMoments,
      clip_count: clips.length,
    };
  }

  // ── 3. scoreEngagement ─────────────────────────────────────────────────

  /**
   * Score each clip for engagement metrics.
   * @param {AnalyzedClip[]} clips - From analyzeFootage
   * @returns {ScoredClip[]}
   */
  scoreEngagement(clips) {
    if (!Array.isArray(clips)) {
      throw new Error('clips must be an array');
    }
    if (clips.length === 0) return [];

    return clips.map(clip => {
      const engagement = this._calcEngagement(clip);
      const hook = this._calcHookPotential(clip);
      const retention = this._calcRetentionImpact(clip);
      const share = this._calcShareability(clip);

      const totalScore = parseFloat(
        (engagement * 0.3 + hook * 0.3 + retention * 0.25 + share * 0.15).toFixed(3)
      );

      return {
        ...clip,
        engagement_score: engagement,
        hook_potential: hook,
        retention_impact: retention,
        shareability: share,
        total_score: totalScore,
      };
    }).sort((a, b) => b.total_score - a.total_score);
  }

  // ── 4. selectClips ─────────────────────────────────────────────────────

  /**
   * Select best clips for target duration, respecting style and variety.
   * @param {ScoredClip[]} scored - From scoreEngagement
   * @param {number} targetDuration - Target total duration in seconds
   * @param {string} [style] - fast | slow | dramatic
   * @returns {SelectedClips}
   */
  selectClips(scored, targetDuration, style = 'dramatic') {
    if (!Array.isArray(scored)) {
      throw new Error('scored must be an array');
    }
    if (typeof targetDuration !== 'number' || targetDuration <= 0) {
      throw new Error('targetDuration must be a positive number');
    }
    if (scored.length === 0) {
      return {
        selected: [],
        total_duration: 0,
        clips_used: 0,
        coverage_ratio: 0,
        variety_score: 0,
      };
    }

    const styleParams = this._getStyleParams(style);
    const selected = [];
    let remaining = targetDuration;
    const usedTypes = [];

    // Greedy selection with variety enforcement
    const candidates = [...scored];
    while (remaining > 0.1 && candidates.length > 0) {
      let bestIdx = -1;
      let bestScore = -1;

      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        const durationMultiplier = styleParams.clipDurationMult;
        const effectiveDuration = c.duration_sec * durationMultiplier;

        if (effectiveDuration > remaining + 0.5) continue; // too long

        // Variety bonus: penalize consecutive same type
        const lastType = usedTypes.length > 0 ? usedTypes[usedTypes.length - 1] : null;
        const varietyPenalty = c.scene_type === lastType ? -0.15 : 0;

        // Style alignment bonus
        const styleBonus = this._calcStyleAlignment(c, style);

        const adjustedScore = c.total_score + varietyPenalty + styleBonus;

        if (adjustedScore > bestScore) {
          bestScore = adjustedScore;
          bestIdx = i;
        }
      }

      if (bestIdx === -1) break;

      const chosen = candidates.splice(bestIdx, 1)[0];
      const effectiveDuration = chosen.duration_sec * styleParams.clipDurationMult;
      selected.push({
        ...chosen,
        adjusted_duration: parseFloat(effectiveDuration.toFixed(2)),
        selection_reason: `score=${chosen.total_score.toFixed(3)}, variety_ok`,
      });
      remaining -= effectiveDuration;
      usedTypes.push(chosen.scene_type);
    }

    const totalSelectedDuration = parseFloat(
      selected.reduce((sum, c) => sum + c.adjusted_duration, 0).toFixed(2)
    );

    // Calculate variety score
    const typeSet = new Set(selected.map(c => c.scene_type));
    const varietyScore = selected.length > 1
      ? parseFloat((typeSet.size / Math.min(selected.length, SCENE_TYPES.length)).toFixed(3))
      : 1.0;

    return {
      selected,
      total_duration: totalSelectedDuration,
      clips_used: selected.length,
      coverage_ratio: parseFloat((totalSelectedDuration / targetDuration).toFixed(3)),
      variety_score: varietyScore,
    };
  }

  // ── 5. composeTimeline ─────────────────────────────────────────────────

  /**
   * Arrange selected clips into a full timeline with transitions and timing.
   * @param {SelectedClips} selected - From selectClips
   * @param {Object} [options]
   * @param {string} [options.transition_style] - 'cut' | 'crossfade' | 'auto'
   * @param {number} [options.transition_duration] - Default transition duration (sec)
   * @param {boolean} [options.include_audio_track] - Add audio track
   * @returns {Timeline}
   */
  composeTimeline(selected, options = {}) {
    if (!selected) {
      throw new Error('selected must have a clips or selected array from selectClips');
    }
    if (selected.clips === null && selected.selected === null) {
      throw new Error('selected must have a clips or selected array from selectClips');
    }
    const clipsArr = selected.clips || selected.selected || [];
    if (clipsArr.length === 0) {
      return {
        id: `timeline-${randomUUID()}`,
        tracks: [{ id: 'video-track', type: 'video', clips: [] }],
        duration_sec: 0,
        transition_count: 0,
        total_clips: 0,
      };
    }

    const transitionStyle = options.transition_style || 'auto';
    const transitionDuration = options.transition_duration ?? 0.3;
    const includeAudio = options.include_audio_track !== false;

    const videoClips = [];
    let currentTime = 0;

    for (let i = 0; i < clipsArr.length; i++) {
      const clip = clipsArr[i];
      const clipDuration = clip.adjusted_duration || clip.duration_sec;

      // Determine transition
      let transition = null;
      if (i > 0) {
        const prevType = clipsArr[i - 1].scene_type;
        const currType = clip.scene_type;
        transition = this._chooseTransition(prevType, currType, transitionStyle);
      }

      const entry = {
        id: clip.id,
        source: clip.source || clip.id,
        in_point: 0,
        out_point: clip.duration_sec,
        start_sec: parseFloat(currentTime.toFixed(3)),
        end_sec: parseFloat((currentTime + clipDuration).toFixed(3)),
        duration_sec: parseFloat(clipDuration.toFixed(3)),
        transition,
        scene_type: clip.scene_type,
        mood: clip.mood,
      };

      videoClips.push(entry);
      currentTime += clipDuration;
    }

    // Build tracks
    const tracks = [
      { id: 'video-track', type: 'video', clips: videoClips },
    ];

    if (includeAudio) {
      tracks.push({
        id: 'audio-track',
        type: 'audio',
        clips: [{
          id: 'main-audio',
          start_sec: 0,
          end_sec: parseFloat(currentTime.toFixed(3)),
          duration_sec: parseFloat(currentTime.toFixed(3)),
        }],
      });
    }

    const transitionCount = videoClips.filter(c => c.transition !== null).length;

    return {
      id: `timeline-${randomUUID().slice(0, 8)}`,
      tracks,
      duration_sec: parseFloat(currentTime.toFixed(3)),
      transition_count: transitionCount,
      total_clips: videoClips.length,
      fps: 30,
      resolution: '1920x1080',
    };
  }

  // ── 6. generateMusicRecommendation ─────────────────────────────────────

  /**
   * Recommend music based on timeline pacing and mood.
   * @param {Timeline} timeline
   * @returns {MusicRecommendation}
   */
  generateMusicRecommendation(timeline) {
    if (!timeline || !timeline.tracks) {
      throw new Error('timeline must have tracks');
    }

    const videoTrack = timeline.tracks.find(t => t.type === 'video');
    if (!videoTrack || videoTrack.clips.length === 0) {
      return {
        bpm: 120,
        genre: 'ambient',
        energy_points: [],
        mood_arc: [],
        reason: 'No video clips to analyze',
      };
    }

    const clips = videoTrack.clips;
    const duration = timeline.duration_sec;

    // Analyze mood distribution
    const moodCounts = {};
    clips.forEach(c => {
      const m = c.mood || 'calm';
      moodCounts[m] = (moodCounts[m] || 0) + 1;
    });
    const primaryMood = Object.entries(moodCounts)
      .sort((a, b) => b[1] - a[1])[0][0];

    // Calculate BPM from pacing
    const avgClipDuration = clips.reduce((s, c) => s + c.duration_sec, 0) / clips.length;
    const cutFrequency = clips.length / duration; // cuts per second
    const bpm = this._pacingToBPM(cutFrequency, primaryMood);

    // Genre from mood
    const genrePool = MUSIC_GENRES[primaryMood] || MUSIC_GENRES.calm;
    const genre = genrePool[hashString(timeline.id || '') % genrePool.length];

    // Energy curve: map clip moods over time
    const energyPoints = clips.map((c, i) => ({
      time_sec: c.start_sec,
      energy: this._moodToEnergy(c.mood || primaryMood),
    }));

    // Mood arc
    const moodArc = this._buildMoodArc(clips, duration);

    return {
      bpm,
      genre,
      energy_points: energyPoints,
      mood_arc: moodArc,
      primary_mood: primaryMood,
      reason: `Pacing: ${cutFrequency.toFixed(2)} cuts/sec → ${bpm} BPM. Primary mood: ${primaryMood}`,
    };
  }

  // ── 7. generateTextOverlay ─────────────────────────────────────────────

  /**
   * Suggest text overlays for the timeline.
   * @param {Timeline} timeline
   * @returns {TextOverlay[]}
   */
  generateTextOverlay(timeline) {
    if (!timeline || !timeline.tracks) {
      throw new Error('timeline must have tracks');
    }

    const videoTrack = timeline.tracks.find(t => t.type === 'video');
    if (!videoTrack || videoTrack.clips.length === 0) return [];

    const overlays = [];
    const clips = videoTrack.clips;
    const duration = timeline.duration_sec;

    // Opening title (first 15% of timeline)
    if (clips.length > 0) {
      const openDuration = Math.min(duration * 0.15, 3);
      overlays.push({
        id: `text-${randomUUID().slice(0, 8)}`,
        position: 'center',
        text: 'TITLE',
        timing: {
          start_sec: 0,
          end_sec: parseFloat(openDuration.toFixed(2)),
        },
        animation: 'fade',
        style: {
          font_size: 48,
          color: '#ffffff',
          bg_opacity: 0.7,
        },
      });
    }

    // Middle section emphasis (around 40-60% mark)
    if (clips.length > 2) {
      const midStart = duration * 0.35;
      const midEnd = duration * 0.55;
      overlays.push({
        id: `text-${randomUUID().slice(0, 8)}`,
        position: 'lower-third',
        text: 'KEY MESSAGE',
        timing: {
          start_sec: parseFloat(midStart.toFixed(2)),
          end_sec: parseFloat(midEnd.toFixed(2)),
        },
        animation: 'slide',
        style: {
          font_size: 32,
          color: '#ffffff',
          bg_opacity: 0.6,
        },
      });
    }

    // End CTA (last 20% of timeline)
    if (duration > 5) {
      const endStart = duration * 0.75;
      overlays.push({
        id: `text-${randomUUID().slice(0, 8)}`,
        position: 'center',
        text: 'SUBSCRIBE',
        timing: {
          start_sec: parseFloat(endStart.toFixed(2)),
          end_sec: parseFloat(duration.toFixed(2)),
        },
        animation: 'bounce',
        style: {
          font_size: 36,
          color: '#ff4444',
          bg_opacity: 0.8,
        },
      });
    }

    return overlays;
  }

  // ── 8. produceFromBrief ────────────────────────────────────────────────

  /**
   * FULL PIPELINE: brief → finished production.
   * @param {Object} brief
   * @returns {Promise<ProductionResult>}
   */
  async produceFromBrief(brief) {
    // Step 1: Analyze brief
    const analyzedBrief = this.analyzeBrief(brief);

    // Step 2: Analyze footage
    const footage = brief.footage || [];
    const footageAnalysis = this.analyzeFootage(footage);

    // Step 3: Score engagement
    const scoredClips = this.scoreEngagement(footageAnalysis.clips);

    // Step 4: Select clips
    const selectedClips = this.selectClips(
      scoredClips,
      analyzedBrief.duration_sec,
      analyzedBrief.inferred_style
    );

    // Step 5: Compose timeline
    const timeline = this.composeTimeline(selectedClips, {
      transition_style: 'auto',
      transition_duration: analyzedBrief.inferred_style === 'fast' ? 0.2 : 0.5,
    });

    // Step 6: Music recommendation
    const musicRec = this.generateMusicRecommendation(timeline);

    // Step 7: Text overlays
    const textOverlays = this.generateTextOverlay(timeline);

    // Step 8: Estimate engagement
    const estimatedEngagement = this._estimateEngagement(
      scoredClips, timeline, analyzedBrief
    );

    // Step 9: Export specs for target platforms
    const exportSpecs = this._buildExportSpecs(timeline, brief.platforms);

    return {
      timeline,
      music_rec: musicRec,
      text_overlays: textOverlays,
      estimated_engagement: estimatedEngagement,
      export_specs: exportSpecs,
      brief_analysis: analyzedBrief,
      metadata: {
        pipeline_version: this.version,
        clips_available: footage.length,
        clips_selected: selectedClips.clips_used,
        duration_achieved: timeline.duration_sec,
        generated_at: new Date().toISOString(),
      },
    };
  }

  // ─── Private Helpers ───────────────────────────────────────────────────────

  _inferStyle(duration, platforms) {
    const hasShortForm = platforms?.some(p =>
      ['tiktok', 'instagram_reels', 'youtube_shorts'].includes(p)
    );
    if (hasShortForm && duration <= 30) return 'fast';
    if (duration > 120) return 'slow';
    return 'dramatic';
  }

  _inferMood(desc) {
    if (!desc) return 'calm';
    const lower = desc.toLowerCase();
    if (lower.includes('energetic') || lower.includes('exciting') || lower.includes('action')) return 'energetic';
    if (lower.includes('dramatic') || lower.includes('epic') || lower.includes('intense')) return 'dramatic';
    if (lower.includes('funny') || lower.includes('humor') || lower.includes('comedy')) return 'funny';
    if (lower.includes('calm') || lower.includes('peaceful') || lower.includes('serene')) return 'calm';
    return 'calm';
  }

  _secondaryMood(primary) {
    const map = {
      energetic: 'dramatic',
      calm: 'funny',
      dramatic: 'energetic',
      funny: 'calm',
    };
    return map[primary] || 'calm';
  }

  _moodIntensity(desc) {
    if (!desc) return 0.5;
    const lower = desc.toLowerCase();
    let intensity = 0.5;
    if (lower.includes('epic') || lower.includes('intense') || lower.includes('powerful')) intensity += 0.3;
    if (lower.includes('gentle') || lower.includes('soft') || lower.includes('subtle')) intensity -= 0.2;
    if (lower.includes('extreme') || lower.includes('crazy') || lower.includes('wild')) intensity += 0.2;
    return clamp(intensity, 0, 1);
  }

  _extractMoodKeywords(desc) {
    if (!desc) return [];
    const moodWords = [
      'energetic', 'calm', 'dramatic', 'funny', 'epic', 'intense',
      'peaceful', 'exciting', 'dark', 'bright', 'moody', 'vibrant',
      'mysterious', 'uplifting', 'melancholy', 'joyful',
    ];
    const lower = desc.toLowerCase();
    return moodWords.filter(w => lower.includes(w));
  }

  _detectScenes(desc, footageCount, duration) {
    const sceneCount = Math.max(2, Math.min(10, Math.ceil(duration / 5)));
    const scenes = [];
    const keywords = [
      'opening', 'establishing', 'action', 'reaction', 'transition',
      'climax', 'resolution', 'closing',
    ];

    for (let i = 0; i < sceneCount; i++) {
      const typeIdx = i % SCENE_TYPES.length;
      scenes.push({
        order: i + 1,
        type: SCENE_TYPES[typeIdx],
        estimated_duration_sec: parseFloat((duration / sceneCount).toFixed(2)),
        purpose: keywords[i % keywords.length],
      });
    }
    return scenes;
  }

  _recommendPacing(style, duration, platforms) {
    const isShortForm = platforms?.some(p =>
      ['tiktok', 'instagram_reels', 'youtube_shorts'].includes(p)
    );

    let basePacing;
    switch (style) {
      case 'fast':
        basePacing = { cuts_per_minute: 20, avg_clip_duration: 3 };
        break;
      case 'slow':
        basePacing = { cuts_per_minute: 6, avg_clip_duration: 10 };
        break;
      case 'dramatic':
      default:
        basePacing = { cuts_per_minute: 12, avg_clip_duration: 5 };
    }

    if (isShortForm) {
      basePacing.cuts_per_minute = Math.round(basePacing.cuts_per_minute * 1.5);
      basePacing.avg_clip_duration *= 0.7;
    }

    return {
      ...basePacing,
      total_cuts: Math.round(basePacing.cuts_per_minute * (duration / 60)),
      style,
    };
  }

  _inferAudience(desc, platforms, style) {
    const lower = (desc || '').toLowerCase();
    let ageRange = '18-34';
    let interests = [];

    if (lower.includes('kids') || lower.includes('children')) {
      ageRange = '6-12';
      interests = ['animation', 'fun', 'education'];
    } else if (lower.includes('professional') || lower.includes('corporate')) {
      ageRange = '25-54';
      interests = ['business', 'technology', 'career'];
    } else if (lower.includes('gaming')) {
      ageRange = '16-30';
      interests = ['gaming', 'esports', 'entertainment'];
    } else {
      interests = ['entertainment', 'lifestyle', 'social media'];
    }

    return {
      age_range: ageRange,
      interests,
      platform_focus: platforms || ['youtube'],
      style_fit: style,
    };
  }

  _getStyleParams(style) {
    const params = {
      fast: { clipDurationMult: 0.6, transitionType: 'cut', energyBias: 0.3 },
      slow: { clipDurationMult: 1.4, transitionType: 'crossfade', energyBias: -0.1 },
      dramatic: { clipDurationMult: 1.0, transitionType: 'dissolve', energyBias: 0.1 },
    };
    return params[style] || params.dramatic;
  }

  _calcStyleAlignment(clip, style) {
    if (style === 'fast' && clip.motion_level === 'high') return 0.1;
    if (style === 'fast' && clip.motion_level === 'low') return -0.05;
    if (style === 'slow' && (clip.scene_type === 'landscape' || clip.scene_type === 'closeup')) return 0.1;
    if (style === 'dramatic' && clip.mood === 'dramatic') return 0.1;
    return 0;
  }

  _calcEngagement(clip) {
    let score = 0;
    score += clip.quality_score * 0.3;
    score += clip.audio_quality * 0.2;
    score += (clip.face_count > 0 ? 0.2 : 0);
    score += (clip.motion_level === 'high' ? 0.15 : clip.motion_level === 'medium' ? 0.1 : 0.05);
    score += (clip.scene_type === 'action' ? 0.15 : clip.scene_type === 'closeup' ? 0.1 : 0.05);
    return clamp(parseFloat(score.toFixed(3)), 0, 1);
  }

  _calcHookPotential(clip) {
    let score = 0;
    // Action scenes hook better
    if (clip.scene_type === 'action') score += 0.35;
    else if (clip.scene_type === 'closeup') score += 0.25;
    else if (clip.scene_type === 'talking') score += 0.2;
    else score += 0.1;

    // High motion is attention-grabbing
    if (clip.motion_level === 'high') score += 0.3;
    else if (clip.motion_level === 'medium') score += 0.2;
    else score += 0.1;

    // Faces hook people
    if (clip.face_count > 0) score += 0.2;

    // Quality matters for first impression
    score += clip.quality_score * 0.15;

    return clamp(parseFloat(score.toFixed(3)), 0, 1);
  }

  _calcRetentionImpact(clip) {
    let score = 0;
    // Varied scenes retain attention
    const varietyBonus = {
      landscape: 0.2, talking: 0.25, action: 0.3, closeup: 0.2, transition: 0.1,
    };
    score += varietyBonus[clip.scene_type] || 0.15;

    // Mood matching helps retention
    if (clip.mood === 'dramatic' || clip.mood === 'energetic') score += 0.2;
    else score += 0.15;

    // Audio quality for talking heads
    if (clip.scene_type === 'talking') {
      score += clip.audio_quality * 0.25;
    }

    // Medium duration is best for retention
    if (clip.duration_sec >= 2 && clip.duration_sec <= 8) score += 0.15;
    else score += 0.05;

    return clamp(parseFloat(score.toFixed(3)), 0, 1);
  }

  _calcShareability(clip) {
    let score = 0;
    // Faces are shareable
    if (clip.face_count > 0) score += 0.25;

    // Dramatic moments get shared
    if (clip.mood === 'dramatic' || clip.mood === 'funny') score += 0.3;
    else if (clip.mood === 'energetic') score += 0.25;
    else score += 0.15;

    // Action scenes are shareable
    if (clip.scene_type === 'action') score += 0.2;

    // Quality matters for sharing
    score += clip.quality_score * 0.15;

    return clamp(parseFloat(score.toFixed(3)), 0, 1);
  }

  _chooseTransition(prevType, currType, style) {
    if (style === 'cut') return { type: 'cut', duration_sec: 0 };

    // Match transitions to content
    if (prevType === 'talking' && currType === 'talking') {
      return { type: 'cut', duration_sec: 0.1 };
    }
    if (prevType === 'landscape' || currType === 'landscape') {
      return { type: 'crossfade', duration_sec: 0.5 };
    }
    if (currType === 'action') {
      return { type: 'cut', duration_sec: 0 };
    }
    if (style === 'auto') {
      const types = ['cut', 'crossfade', 'dissolve'];
      return { type: types[hashString(`${prevType}-${currType}`) % types.length], duration_sec: 0.3 };
    }
    return { type: 'cut', duration_sec: 0.2 };
  }

  _pacingToBPM(cutsPerSecond, mood) {
    const baseBPM = cutsPerSecond * 60; // rough mapping
    const moodOffset = {
      energetic: 20,
      calm: -10,
      dramatic: 5,
      funny: 15,
    };
    return Math.round(clamp(baseBPM + (moodOffset[mood] || 0), 60, 180));
  }

  _moodToEnergy(mood) {
    const map = { energetic: 0.9, calm: 0.3, dramatic: 0.7, funny: 0.8 };
    return map[mood] || 0.5;
  }

  _buildMoodArc(clips, duration) {
    const arc = [];
    const segments = Math.min(5, Math.max(1, Math.ceil(duration / 10)));

    for (let i = 0; i < segments; i++) {
      const t = duration * (i / segments);
      const clip = clips.find(c => t >= c.start_sec && t < c.end_sec) || clips[0];
      arc.push({
        time_sec: parseFloat(t.toFixed(2)),
        mood: clip.mood || 'calm',
        energy: this._moodToEnergy(clip.mood || 'calm'),
      });
    }
    return arc;
  }

  _estimateEngagement(scoredClips, timeline, briefAnalysis) {
    if (scoredClips.length === 0) {
      return { score: 0, confidence: 0, factors: [] };
    }

    const avgScore = scoredClips.reduce((s, c) => s + c.total_score, 0) / scoredClips.length;
    const maxScore = Math.max(...scoredClips.map(c => c.total_score));
    const variety = new Set(scoredClips.map(c => c.scene_type)).size / SCENE_TYPES.length;

    const factors = [];
    let score = 0;

    // Quality factor
    const qualityContrib = avgScore * 0.4;
    score += qualityContrib;
    factors.push(`quality: ${qualityContrib.toFixed(3)}`);

    // Variety factor
    const varietyContrib = variety * 0.3;
    score += varietyContrib;
    factors.push(`variety: ${varietyContrib.toFixed(3)}`);

    // Pacing factor
    const pacingContrib = Math.min(timeline.transition_count / Math.max(timeline.total_clips, 1), 1) * 0.15;
    score += pacingContrib;
    factors.push(`pacing: ${pacingContrib.toFixed(3)}`);

    // Hook factor (first clip quality)
    if (scoredClips.length > 0) {
      const hookContrib = scoredClips[0].hook_potential * 0.15;
      score += hookContrib;
      factors.push(`hook: ${hookContrib.toFixed(3)}`);
    }

    const confidence = clamp(0.5 + (scoredClips.length / 20) * 0.3, 0, 0.9);

    return {
      score: clamp(parseFloat(score.toFixed(3)), 0, 1),
      confidence: parseFloat(confidence.toFixed(3)),
      factors,
      rating: score >= 0.7 ? 'excellent' : score >= 0.5 ? 'good' : score >= 0.3 ? 'average' : 'needs_improvement',
    };
  }

  _buildExportSpecs(timeline, platforms) {
    const specs = [];
    const targetPlatforms = platforms && platforms.length > 0 ? platforms : ['youtube'];

    for (const platform of targetPlatforms) {
      const pSpec = PLATFORM_SPECS[platform];
      if (!pSpec) continue;

      const durationMin = Math.min(timeline.duration_sec / 60, pSpec.max_duration / 60);
      specs.push({
        platform,
        aspect_ratio: pSpec.aspect_ratio,
        max_duration: pSpec.max_duration,
        resolution: pSpec.resolution,
        codec: pSpec.codec,
        file_size_estimated: parseFloat((durationMin * pSpec.file_size_per_min_mb).toFixed(1)),
      });
    }
    return specs;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// QualityScorer — Evaluate and Compare Timelines
// ═══════════════════════════════════════════════════════════════════════════════

export class QualityScorer {
  constructor(options = {}) {
    this.weights = options.weights || {
      pacing: 0.25,
      variety: 0.2,
      emotional_arc: 0.25,
      technical: 0.3,
    };
  }

  /**
   * Score a timeline's quality across multiple dimensions.
   * @param {Timeline} timeline
   * @returns {QualityReport}
   */
  scoreTimeline(timeline) {
    if (!timeline || !timeline.tracks) {
      throw new Error('timeline must have tracks');
    }

    const videoTrack = timeline.tracks.find(t => t.type === 'video');
    const clips = videoTrack ? videoTrack.clips : [];

    if (clips.length === 0) {
      return {
        pacing_score: 0,
        variety_score: 0,
        emotional_arc_score: 0,
        technical_score: 0,
        overall_score: 0,
        suggestions: ['Add video clips to the timeline'],
      };
    }

    const pacingScore = this._scorePacing(clips, timeline.duration_sec);
    const varietyScore = this._scoreVariety(clips);
    const emotionalArcScore = this._scoreEmotionalArc(clips, timeline.duration_sec);
    const technicalScore = this._scoreTechnical(timeline);

    const overall = parseFloat(
      (pacingScore * this.weights.pacing +
        varietyScore * this.weights.variety +
        emotionalArcScore * this.weights.emotional_arc +
        technicalScore * this.weights.technical
      ).toFixed(3)
    );

    const suggestions = this._generateSuggestions(
      pacingScore, varietyScore, emotionalArcScore, technicalScore, clips
    );

    return {
      pacing_score: pacingScore,
      variety_score: varietyScore,
      emotional_arc_score: emotionalArcScore,
      technical_score: technicalScore,
      overall_score: overall,
      suggestions,
    };
  }

  /**
   * Compare a timeline with a reference timeline.
   * @param {Timeline} timeline
   * @param {Timeline} referenceTimeline
   * @returns {ComparisonReport}
   */
  compareWithReference(timeline, referenceTimeline) {
    if (!timeline || !referenceTimeline) {
      throw new Error('Both timelines are required');
    }

    const videoTrack = timeline.tracks.find(t => t.type === 'video');
    const refVideoTrack = referenceTimeline.tracks.find(t => t.type === 'video');

    const clips = videoTrack ? videoTrack.clips : [];
    const refClips = refVideoTrack ? refVideoTrack.clips : [];

    // Duration similarity
    const durSim = 1 - Math.min(1, Math.abs(timeline.duration_sec - referenceTimeline.duration_sec) /
      Math.max(timeline.duration_sec, referenceTimeline.duration_sec, 1));

    // Clip count similarity
    const countSim = clips.length === 0 && refClips.length === 0 ? 1 :
      1 - Math.min(1, Math.abs(clips.length - refClips.length) /
        Math.max(clips.length, refClips.length, 1));

    // Type distribution similarity
    const typeSim = this._compareTypeDistribution(clips, refClips);

    // Mood distribution similarity
    const moodSim = this._compareMoodDistribution(clips, refClips);

    // Pacing similarity
    const pacing1 = this._scorePacing(clips, timeline.duration_sec);
    const pacing2 = this._scorePacing(refClips, referenceTimeline.duration_sec);
    const pacingSim = 1 - Math.abs(pacing1 - pacing2);

    const similarity = parseFloat(
      (durSim * 0.2 + countSim * 0.15 + typeSim * 0.25 + moodSim * 0.2 + pacingSim * 0.2).toFixed(3)
    );

    const strengths = [];
    const weaknesses = [];

    if (typeSim > 0.7) strengths.push('Good scene type variety matches reference');
    else weaknesses.push('Scene type distribution differs from reference');

    if (pacingSim > 0.8) strengths.push('Pacing closely matches reference');
    else weaknesses.push('Pacing significantly differs from reference');

    if (moodSim > 0.7) strengths.push('Mood progression aligns with reference');
    else weaknesses.push('Mood distribution differs from reference');

    if (durSim > 0.9) strengths.push('Duration closely matches reference');
    else weaknesses.push(`Duration differs: ${timeline.duration_sec}s vs ${referenceTimeline.duration_sec}s`);

    return {
      similarity,
      strengths,
      weaknesses,
      detail: {
        duration_similarity: durSim,
        clip_count_similarity: countSim,
        type_distribution_similarity: typeSim,
        mood_distribution_similarity: moodSim,
        pacing_similarity: pacingSim,
      },
    };
  }

  // ─── Private Helpers ───────────────────────────────────────────────────────

  _scorePacing(clips, duration) {
    if (clips.length <= 1 || duration <= 0) return 0.5;

    const durations = clips.map(c => c.duration_sec);
    const avgDuration = durations.reduce((s, d) => s + d, 0) / durations.length;
    const variance = durations.reduce((s, d) => s + Math.pow(d - avgDuration, 2), 0) / durations.length;
    const stdDev = Math.sqrt(variance);

    // Good pacing has some variety (stdDev > 0) but not too much
    const cv = avgDuration > 0 ? stdDev / avgDuration : 0; // coefficient of variation
    // Ideal CV: 0.2-0.6
    const varietyScore = cv >= 0.2 && cv <= 0.6 ? 1.0 :
      cv < 0.2 ? cv / 0.2 : Math.max(0, 1 - (cv - 0.6) / 0.4);

    // Cuts per minute should be reasonable (8-20)
    const cutsPerMinute = clips.length / (duration / 60);
    const cutsScore = cutsPerMinute >= 8 && cutsPerMinute <= 20 ? 1.0 :
      cutsPerMinute < 8 ? cutsPerMinute / 8 : Math.max(0, 1 - (cutsPerMinute - 20) / 20);

    return parseFloat(((varietyScore * 0.6 + cutsScore * 0.4)).toFixed(3));
  }

  _scoreVariety(clips) {
    if (clips.length <= 1) return clips.length === 1 ? 1.0 : 0;

    const types = new Set(clips.map(c => c.scene_type));
    const moods = new Set(clips.map(c => c.mood));
    const typeVariety = types.size / SCENE_TYPES.length;
    const moodVariety = moods.size / MOODS.length;

    // Check for consecutive same-type (penalty)
    let consecutiveSame = 0;
    for (let i = 1; i < clips.length; i++) {
      if (clips[i].scene_type === clips[i - 1].scene_type) consecutiveSame++;
    }
    const consecutivePenalty = clips.length > 1 ? consecutiveSame / (clips.length - 1) : 0;

    const score = clamp(
      typeVariety * 0.5 + moodVariety * 0.3 + (1 - consecutivePenalty) * 0.2,
      0, 1
    );

    return parseFloat(score.toFixed(3));
  }

  _scoreEmotionalArc(clips, duration) {
    if (clips.length < 3) return clips.length >= 2 ? 0.7 : 0.5;

    // Check for beginning-middle-end structure
    const energyValues = clips.map(c => {
      const energyMap = { energetic: 0.9, calm: 0.3, dramatic: 0.7, funny: 0.8 };
      return energyMap[c.mood] || 0.5;
    });

    // Divide into thirds
    const thirdSize = Math.ceil(clips.length / 3);
    const firstThird = energyValues.slice(0, thirdSize);
    const secondThird = energyValues.slice(thirdSize, thirdSize * 2);
    const thirdThird = energyValues.slice(thirdSize * 2);

    const avgFirst = firstThird.reduce((s, v) => s + v, 0) / firstThird.length;
    const avgSecond = secondThird.reduce((s, v) => s + v, 0) / (secondThird.length || 1);
    const avgThird = thirdThird.reduce((s, v) => s + v, 0) / (thirdThird.length || 1);

    // Good arc: build-up then resolve
    // Check if middle is higher than beginning (build)
    const hasBuild = avgSecond >= avgFirst * 0.9;
    // Check if ending provides resolution (slightly lower or sustained)
    const hasResolution = avgThird >= avgFirst * 0.7;

    // Energy progression score
    let arcScore = 0.3; // base
    if (hasBuild) arcScore += 0.35;
    if (hasResolution) arcScore += 0.15;

    // Check for monotony (all same energy = bad)
    const energyVariance = energyValues.reduce((s, v) =>
      s + Math.pow(v - (energyValues.reduce((a, b) => a + b, 0) / energyValues.length), 2), 0
    ) / energyValues.length;

    if (energyVariance > 0.01) arcScore += 0.2; // some variation

    return parseFloat(clamp(arcScore, 0, 1).toFixed(3));
  }

  _scoreTechnical(timeline) {
    let score = 0.7; // base score

    // Resolution check
    if (timeline.resolution === '1920x1080' || timeline.resolution === '1080x1920') {
      score += 0.1;
    } else if (timeline.resolution === '4K' || timeline.resolution === '3840x2160') {
      score += 0.15;
    }

    // FPS check
    if (timeline.fps === 30 || timeline.fps === 60) {
      score += 0.1;
    }

    // Has audio track
    const hasAudio = timeline.tracks?.some(t => t.type === 'audio');
    if (hasAudio) score += 0.1;

    return parseFloat(clamp(score, 0, 1).toFixed(3));
  }

  _compareTypeDistribution(clips1, clips2) {
    const count1 = {};
    const count2 = {};
    clips1.forEach(c => { count1[c.scene_type] = (count1[c.scene_type] || 0) + 1; });
    clips2.forEach(c => { count2[c.scene_type] = (count2[c.scene_type] || 0) + 1; });

    if (Object.keys(count1).length === 0 && Object.keys(count2).length === 0) return 1;
    if (Object.keys(count1).length === 0 || Object.keys(count2).length === 0) return 0;

    const allTypes = new Set([...Object.keys(count1), ...Object.keys(count2)]);
    let totalDiff = 0;
    for (const t of allTypes) {
      const p1 = (count1[t] || 0) / clips1.length;
      const p2 = (count2[t] || 0) / clips2.length;
      totalDiff += Math.abs(p1 - p2);
    }

    return parseFloat((1 - totalDiff / 2).toFixed(3));
  }

  _compareMoodDistribution(clips1, clips2) {
    const count1 = {};
    const count2 = {};
    clips1.forEach(c => { count1[c.mood] = (count1[c.mood] || 0) + 1; });
    clips2.forEach(c => { count2[c.mood] = (count2[c.mood] || 0) + 1; });

    if (Object.keys(count1).length === 0 && Object.keys(count2).length === 0) return 1;
    if (Object.keys(count1).length === 0 || Object.keys(count2).length === 0) return 0;

    const allMoods = new Set([...Object.keys(count1), ...Object.keys(count2)]);
    let totalDiff = 0;
    for (const m of allMoods) {
      const p1 = (count1[m] || 0) / clips1.length;
      const p2 = (count2[m] || 0) / clips2.length;
      totalDiff += Math.abs(p1 - p2);
    }

    return parseFloat((1 - totalDiff / 2).toFixed(3));
  }

  _generateSuggestions(pacing, variety, emotionalArc, technical, clips) {
    const suggestions = [];
    if (pacing < 0.5) {
      suggestions.push('Improve pacing by varying clip durations more (some short, some long)');
    }
    if (variety < 0.5) {
      suggestions.push('Add more scene type variety (mix action, talking, landscape, closeup)');
    }
    if (emotionalArc < 0.5) {
      suggestions.push('Strengthen emotional arc: start calm, build energy in middle, resolve at end');
    }
    if (technical < 0.7) {
      suggestions.push('Improve technical quality: ensure HD resolution, 30fps minimum, add audio');
    }
    if (clips.length < 3) {
      suggestions.push('Add more clips for a richer timeline');
    }
    // Check for consecutive same types
    for (let i = 1; i < clips.length; i++) {
      if (clips[i].scene_type === clips[i - 1].scene_type) {
        suggestions.push(`Clips ${i} and ${i + 1} are same type (${clips[i].scene_type}) — consider alternating`);
        break;
      }
    }
    return suggestions;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ExportPlanner — Platform-Specific Export
// ═══════════════════════════════════════════════════════════════════════════════

export class ExportPlanner {
  constructor() {
    this.platforms = { ...PLATFORM_SPECS };
  }

  /**
   * Plan exports for multiple platforms.
   * @param {Timeline} timeline
   * @param {string[]} platforms - e.g. ['youtube', 'tiktok', 'instagram_reels']
   * @returns {ExportPlan[]}
   */
  planExport(timeline, platforms) {
    if (!timeline || !timeline.tracks) {
      throw new Error('timeline must have tracks');
    }
    if (!Array.isArray(platforms) || platforms.length === 0) {
      throw new Error('platforms must be a non-empty array');
    }

    return platforms.map(platform => {
      const spec = this.platforms[platform];
      if (!spec) {
        return {
          platform,
          error: `Unknown platform: ${platform}`,
          supported: false,
        };
      }

      const needsTrim = timeline.duration_sec > spec.max_duration;
      const durationMin = Math.min(timeline.duration_sec, spec.max_duration) / 60;
      const estimatedSizeMB = parseFloat((durationMin * spec.file_size_per_min_mb).toFixed(1));

      return {
        platform,
        supported: true,
        aspect_ratio: spec.aspect_ratio,
        max_duration: spec.max_duration,
        resolution: spec.resolution,
        codec: spec.codec,
        needs_trim: needsTrim,
        trimmed_duration_sec: needsTrim ? spec.max_duration : timeline.duration_sec,
        file_size_estimated: estimatedSizeMB,
      };
    });
  }

  /**
   * Optimize a timeline for a specific platform.
   * @param {Timeline} timeline
   * @param {string} platform
   * @returns {OptimizedTimeline}
   */
  optimizeForPlatform(timeline, platform) {
    if (!timeline || !timeline.tracks) {
      throw new Error('timeline must have tracks');
    }

    const spec = this.platforms[platform];
    if (!spec) {
      throw new Error(`Unknown platform: ${platform}`);
    }

    const videoTrack = timeline.tracks.find(t => t.type === 'video');
    const clips = videoTrack ? [...videoTrack.clips] : [];

    // Determine if reframing is needed
    const currentRes = timeline.resolution || '1920x1080';
    const needsReframe = currentRes !== spec.resolution;

    // Trim if needed
    let trimmedClips = clips;
    let wasTrimmed = false;
    if (timeline.duration_sec > spec.max_duration) {
      wasTrimmed = true;
      let accumulated = 0;
      trimmedClips = [];
      for (const clip of clips) {
        if (accumulated >= spec.max_duration) break;
        const remaining = spec.max_duration - accumulated;
        if (clip.duration_sec <= remaining) {
          trimmedClips.push({ ...clip });
          accumulated += clip.duration_sec;
        } else {
          trimmedClips.push({
            ...clip,
            duration_sec: parseFloat(remaining.toFixed(2)),
            end_sec: parseFloat((clip.start_sec + remaining).toFixed(2)),
          });
          accumulated += remaining;
        }
      }
    }

    // Platform-specific adjustments
    const platformAdjustments = this._getPlatformAdjustments(platform);

    // Build optimized tracks
    const optimizedTracks = timeline.tracks.map(track => {
      if (track.type === 'video') {
        return { ...track, clips: trimmedClips };
      }
      return track;
    });

    // Add platform-specific track if needed
    if (platformAdjustments.add_watermark_track) {
      optimizedTracks.push({
        id: 'watermark-track',
        type: 'overlay',
        clips: [{
          id: 'watermark',
          start_sec: 0,
          end_sec: trimmedClips.reduce((s, c) => s + c.duration_sec, 0),
        }],
      });
    }

    return {
      id: `optimized-${platform}-${timeline.id}`,
      original_timeline_id: timeline.id,
      platform,
      resolution: spec.resolution,
      aspect_ratio: spec.aspect_ratio,
      codec: spec.codec,
      was_trimmed: wasTrimmed,
      was_reframed: needsReframe,
      tracks: optimizedTracks,
      duration_sec: parseFloat(trimmedClips.reduce((s, c) => s + c.duration_sec, 0).toFixed(2)),
      adjustments: platformAdjustments,
    };
  }

  // ─── Private Helpers ───────────────────────────────────────────────────────

  _getPlatformAdjustments(platform) {
    const adjustments = {
      add_watermark_track: false,
      safe_zones: { top: 0, bottom: 0, left: 0, right: 0 },
      text_restrictions: [],
      max_hashtags: 30,
    };

    switch (platform) {
      case 'tiktok':
      case 'youtube_shorts':
        adjustments.safe_zones = { top: 80, bottom: 120, left: 20, right: 20 };
        adjustments.text_restrictions = ['center area reserved for UI'];
        adjustments.add_watermark_track = platform === 'tiktok';
        break;
      case 'instagram_reels':
        adjustments.safe_zones = { top: 60, bottom: 100, left: 20, right: 20 };
        adjustments.text_restrictions = ['bottom 25% reserved for captions'];
        break;
      case 'instagram_story':
        adjustments.safe_zones = { top: 40, bottom: 80, left: 10, right: 10 };
        break;
      case 'youtube':
        adjustments.safe_zones = { top: 20, bottom: 20, left: 20, right: 20 };
        break;
      case 'twitter':
        adjustments.max_hashtags = 3;
        break;
      case 'facebook':
        adjustments.text_restrictions = ['keep text minimal for auto-play'];
        break;
      case 'linkedin':
        adjustments.text_restrictions = ['professional tone required'];
        break;
    }
    return adjustments;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Type Definitions (JSDoc)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} AnalyzedBrief
 * @property {Array} scenes_detected
 * @property {Object} mood_analysis
 * @property {Object} pacing_recommendation
 * @property {Object} target_audience
 * @property {string} inferred_style
 * @property {string} inferred_mood
 * @property {number} duration_sec
 * @property {number} platform_count
 */

/**
 * @typedef {Object} AnalyzedClip
 * @property {string} id
 * @property {string} scene_type - 'action'|'talking'|'landscape'|'closeup'|'transition'
 * @property {string} mood - 'energetic'|'calm'|'dramatic'|'funny'
 * @property {number} quality_score - 0-1
 * @property {number} audio_quality - 0-1
 * @property {number} face_count
 * @property {string} motion_level - 'low'|'medium'|'high'
 * @property {number} duration_sec
 */

/**
 * @typedef {Object} FootageAnalysis
 * @property {AnalyzedClip[]} clips
 * @property {number} total_duration
 * @property {Array} best_moments
 * @property {number} clip_count
 */

/**
 * @typedef {Object} ScoredClip
 * @property {number} engagement_score - 0-1
 * @property {number} hook_potential - 0-1
 * @property {number} retention_impact - 0-1
 * @property {number} shareability - 0-1
 * @property {number} total_score - 0-1
 */

/**
 * @typedef {Object} SelectedClips
 * @property {Array} selected
 * @property {number} total_duration
 * @property {number} clips_used
 * @property {number} coverage_ratio
 * @property {number} variety_score
 */

/**
 * @typedef {Object} Timeline
 * @property {string} id
 * @property {Array} tracks
 * @property {number} duration_sec
 * @property {number} transition_count
 * @property {number} total_clips
 */

/**
 * @typedef {Object} MusicRecommendation
 * @property {number} bpm
 * @property {string} genre
 * @property {Array} energy_points
 * @property {Array} mood_arc
 * @property {string} primary_mood
 * @property {string} reason
 */

/**
 * @typedef {Object} TextOverlay
 * @property {string} id
 * @property {string} position
 * @property {string} text
 * @property {Object} timing - { start_sec, end_sec }
 * @property {string} animation
 * @property {Object} style
 */

/**
 * @typedef {Object} ProductionResult
 * @property {Timeline} timeline
 * @property {MusicRecommendation} music_rec
 * @property {TextOverlay[]} text_overlays
 * @property {Object} estimated_engagement
 * @property {ExportPlan[]} export_specs
 * @property {AnalyzedBrief} brief_analysis
 * @property {Object} metadata
 */

/**
 * @typedef {Object} QualityReport
 * @property {number} pacing_score - 0-1
 * @property {number} variety_score - 0-1
 * @property {number} emotional_arc_score - 0-1
 * @property {number} technical_score - 0-1
 * @property {number} overall_score - 0-1 (weighted average)
 * @property {string[]} suggestions
 */

/**
 * @typedef {Object} ComparisonReport
 * @property {number} similarity - 0-1
 * @property {string[]} strengths
 * @property {string[]} weaknesses
 */

/**
 * @typedef {Object} ExportPlan
 * @property {string} platform
 * @property {boolean} supported
 * @property {string} aspect_ratio
 * @property {number} max_duration
 * @property {string} resolution
 * @property {string} codec
 * @property {boolean} needs_trim
 * @property {number} file_size_estimated
 */

/**
 * @typedef {Object} OptimizedTimeline
 * @property {string} id
 * @property {string} platform
 * @property {string} resolution
 * @property {string} aspect_ratio
 * @property {boolean} was_trimmed
 * @property {boolean} was_reframed
 * @property {Array} tracks
 * @property {number} duration_sec
 * @property {Object} adjustments
 */
