/**
 * Vireo Studio - Auto-Edit Module
 * 10 Smart Auto-Edit functions for video editing automation
 */

// ─── 1. detectSilences ───────────────────────────────────────────────────────

/**
 * Detects silent segments in audio data using RMS energy analysis.
 * @param {number[]} audioData - Array of audio sample amplitudes
 * @param {Object} opts
 * @param {number} opts.threshold_db - Silence threshold in dB (default: -30)
 * @param {number} opts.min_duration_sec - Minimum silence duration in seconds (default: 0.5)
 * @param {number} opts.sample_rate - Sample rate in Hz (default: 44100)
 * @returns {Array<{start_sec: number, end_sec: number, duration_sec: number}>}
 */
function detectSilences(audioData, { threshold_db = -30, min_duration_sec = 0.5, sample_rate = 44100 } = {}) {
  if (!audioData || !Array.isArray(audioData) || audioData.length === 0) {
    return [];
  }

  const linearThreshold = Math.pow(10, threshold_db / 20);
  const samplesPerWindow = Math.floor(sample_rate * 0.02); // 20ms windows
  const minSilenceSamples = Math.floor(min_duration_sec * sample_rate / samplesPerWindow);

  let silences = [];
  let silenceStart = null;

  for (let i = 0; i < audioData.length; i += samplesPerWindow) {
    const window = audioData.slice(i, i + samplesPerWindow);
    const rms = Math.sqrt(window.reduce((sum, s) => sum + s * s, 0) / window.length);
    const isSilent = rms <= linearThreshold;
    const timeSec = (i / sample_rate);

    if (isSilent) {
      if (silenceStart === null) {
        silenceStart = timeSec;
      }
    } else {
      if (silenceStart !== null) {
        const silenceWindows = Math.floor((timeSec - silenceStart) * sample_rate / samplesPerWindow);
        if (silenceWindows >= minSilenceSamples) {
          silences.push({
            start_sec: parseFloat(silenceStart.toFixed(3)),
            end_sec: parseFloat(timeSec.toFixed(3)),
            duration_sec: parseFloat((timeSec - silenceStart).toFixed(3)),
          });
        }
        silenceStart = null;
      }
    }
  }

  // Handle trailing silence
  if (silenceStart !== null) {
    const endTime = audioData.length / sample_rate;
    const silenceWindows = Math.floor((endTime - silenceStart) * sample_rate / samplesPerWindow);
    if (silenceWindows >= minSilenceSamples) {
      silences.push({
        start_sec: parseFloat(silenceStart.toFixed(3)),
        end_sec: parseFloat(endTime.toFixed(3)),
        duration_sec: parseFloat((endTime - silenceStart).toFixed(3)),
      });
    }
  }

  return silences;
}

// ─── 2. detectFillerWords ─────────────────────────────────────────────────────

/**
 * Detects filler words in a transcript with timestamps.
 * @param {Array<{word: string, start_sec: number, end_sec: number}>} transcript
 * @param {Object} opts
 * @param {string[]} opts.filler_words - List of filler words to detect
 * @returns {Array<{word: string, start_sec: number, end_sec: number, confidence: number}>}
 */
function detectFillerWords(transcript, { filler_words = ['um', 'uh', 'erm', 'like', 'you know', 'so', 'basically', 'actually'] } = {}) {
  if (!transcript || !Array.isArray(transcript) || transcript.length === 0) {
    return [];
  }

  const fillers = [];
  const lowerFillers = filler_words.map(f => f.toLowerCase());

  for (const entry of transcript) {
    if (!entry || !entry.word) continue;
    const wordLower = entry.word.toLowerCase().trim();
    const idx = lowerFillers.indexOf(wordLower);
    if (idx !== -1) {
      // Confidence higher for unambiguous fillers (um, uh, erm) vs contextual ones (like, so)
      const isUnambiguous = ['um', 'uh', 'erm'].includes(wordLower);
      fillers.push({
        word: entry.word,
        start_sec: entry.start_sec,
        end_sec: entry.end_sec,
        confidence: isUnambiguous ? 0.95 : 0.6,
      });
    }
  }

  return fillers;
}

// ─── 3. autoJumpCut ───────────────────────────────────────────────────────────

/**
 * Generates jump cuts to shorten a video by removing silences and fillers.
 * @param {Object} opts
 * @param {number} opts.video_duration_sec - Total video duration
 * @param {Array<{start_sec, end_sec}>} opts.silences - Detected silences
 * @param {Array<{start_sec, end_sec}>} opts.fillers - Detected filler words
 * @param {number} opts.target_ratio - Target reduction ratio (0.5 = 50% shorter)
 * @returns {Array<{remove_start: number, remove_end: number, reason: string}>}
 */
function autoJumpCut({ video_duration_sec, silences = [], fillers = [], target_ratio = 0.5 }) {
  if (!video_duration_sec || video_duration_sec <= 0) return [];

  const removals = [];
  let removableDuration = 0;
  const targetRemoval = video_duration_sec * target_ratio;

  // Collect silence removals (sorted by duration desc)
  const silenceRemovals = silences
    .filter(s => s.start_sec < video_duration_sec && s.end_sec <= video_duration_sec)
    .map(s => ({
      remove_start: s.start_sec,
      remove_end: s.end_sec,
      reason: 'silence',
      duration: s.end_sec - s.start_sec,
    }))
    .sort((a, b) => b.duration - a.duration);

  // Collect filler removals
  const fillerRemovals = fillers
    .filter(f => f.start_sec < video_duration_sec && f.end_sec <= video_duration_sec)
    .map(f => ({
      remove_start: f.start_sec,
      remove_end: f.end_sec,
      reason: 'filler',
      duration: f.end_sec - f.start_sec,
    }))
    .sort((a, b) => b.duration - a.duration);

  // Merge and select removals that fit the target
  const candidates = [...silenceRemovals, ...fillerRemovals].sort((a, b) => b.duration - a.duration);

  // Prevent overlapping removals
  const occupied = [];

  for (const candidate of candidates) {
    if (removableDuration >= targetRemoval) break;

    const overlaps = occupied.some(o =>
      candidate.remove_start < o.end && candidate.remove_end > o.start
    );

    if (!overlaps) {
      const { duration, ...rest } = candidate;
      removals.push(rest);
      removableDuration += duration;
      occupied.push({ start: candidate.remove_start, end: candidate.remove_end });
    }
  }

  return removals.sort((a, b) => a.remove_start - b.remove_start);
}

// ─── 4. autoPacing ────────────────────────────────────────────────────────────

/**
 * Adjusts clip durations to match a target total duration with a given pacing style.
 * @param {Object} opts
 * @param {Array<{id: string, duration_sec: number, importance: number}>} opts.clips
 * @param {number} opts.target_duration_sec - Desired total output duration
 * @param {string} opts.style - 'fast' | 'medium' | 'slow'
 * @returns {{ clips: Array<{id: string, adjusted_duration_sec: number}>, total_duration_sec: number, pacing: string }}
 */
function autoPacing({ clips, target_duration_sec, style = 'medium' }) {
  if (!clips || clips.length === 0 || !target_duration_sec || target_duration_sec <= 0) {
    return { clips: [], total_duration_sec: 0, pacing: style };
  }

  const styleRanges = {
    fast: [1, 2],
    medium: [2, 4],
    slow: [4, 8],
  };

  const [minPerClip, maxPerClip] = styleRanges[style] || styleRanges.medium;

  // Sort by importance descending
  const sorted = [...clips].sort((a, b) => (b.importance || 0) - (a.importance || 0));

  // Budget per clip
  const budgetPerClip = target_duration_sec / sorted.length;

  // Clamp each clip within style range, then normalize to fit target
  let adjusted = sorted.map(clip => {
    let dur = Math.max(minPerClip, Math.min(maxPerClip, budgetPerClip));
    // Scale by importance (±20%)
    const importFactor = 0.8 + 0.4 * (clip.importance || 0.5);
    dur *= importFactor;
    return { id: clip.id, adjusted_duration_sec: parseFloat(dur.toFixed(2)) };
  });

  // Normalize to match target exactly
  const currentTotal = adjusted.reduce((s, c) => s + c.adjusted_duration_sec, 0);
  if (currentTotal > 0) {
    const scale = target_duration_sec / currentTotal;
    adjusted = adjusted.map(c => ({
      ...c,
      adjusted_duration_sec: parseFloat(Math.max(minPerClip, Math.min(maxPerClip, c.adjusted_duration_sec * scale)).toFixed(2)),
    }));
  }

  const total = adjusted.reduce((s, c) => s + c.adjusted_duration_sec, 0);

  return { clips: adjusted, total_duration_sec: parseFloat(total.toFixed(2)), pacing: style };
}

// ─── 5. autoHighlightReel ─────────────────────────────────────────────────────

/**
 * Selects the most engaging segments for a highlight reel.
 * @param {Object} opts
 * @param {Array<{id: string, start_sec: number, end_sec: number, engagement_score?: number}>} opts.footage
 * @param {number} opts.duration_sec - Target highlight reel length
 * @param {string} opts.scoring_model - 'engagement' | 'motion' | 'emotional'
 * @returns {{ selected: Array<{id: string, start_sec: number, end_sec: number, score: number}>, total_duration_sec: number, timeline: Array<{start_sec: number, end_sec: number, source_id: string}> }}
 */
function autoHighlightReel({ footage, duration_sec = 30, scoring_model = 'engagement' }) {
  if (!footage || footage.length === 0 || duration_sec <= 0) {
    return { selected: [], total_duration_sec: 0, timeline: [] };
  }

  // Score each segment
  const scored = footage.map(seg => {
    let score = seg.engagement_score || 0.5;

    // Adjust score by model
    if (scoring_model === 'motion') {
      score *= 1.2; // boost action
    } else if (scoring_model === 'emotional') {
      score *= 1.1;
    }

    const segDuration = seg.end_sec - seg.start_sec;
    return {
      id: seg.id,
      start_sec: seg.start_sec,
      end_sec: seg.end_sec,
      score: parseFloat(score.toFixed(3)),
      duration: segDuration,
    };
  }).sort((a, b) => b.score - a.score);

  // Greedily select segments that fit within duration
  const selected = [];
  let totalDuration = 0;

  for (const seg of scored) {
    if (totalDuration + seg.duration <= duration_sec) {
      selected.push(seg);
      totalDuration += seg.duration;
    }
    if (totalDuration >= duration_sec) break;
  }

  // Build timeline
  let cursor = 0;
  const timeline = selected.map(seg => {
    const dur = seg.end_sec - seg.start_sec;
    const entry = {
      start_sec: parseFloat(cursor.toFixed(3)),
      end_sec: parseFloat((cursor + dur).toFixed(3)),
      source_id: seg.id,
    };
    cursor += dur;
    return entry;
  });

  return {
    selected,
    total_duration_sec: parseFloat(totalDuration.toFixed(3)),
    timeline,
  };
}

// ─── 6. autoBrollMatch ────────────────────────────────────────────────────────

/**
 * Matches script keywords to available B-roll clips.
 * @param {Object} opts
 * @param {Array<{text: string, start_sec: number, end_sec: number}>} opts.script
 * @param {Array<{id: string, tags: string[], duration_sec: number, start_sec?: number}>} opts.available_broll
 * @returns {Array<{script_segment: {text, start_sec, end_sec}, broll: {id, tags, duration_sec}, match_score: number}>}
 */
function autoBrollMatch({ script, available_broll }) {
  if (!script || !available_broll || script.length === 0 || available_broll.length === 0) {
    return [];
  }

  const matches = [];

  for (const segment of script) {
    const words = segment.text.toLowerCase().split(/\s+/);
    let bestMatch = null;
    let bestScore = 0;

    for (const broll of available_broll) {
      const brollTags = broll.tags.map(t => t.toLowerCase());
      let matchCount = 0;

      for (const word of words) {
        if (brollTags.some(tag => tag.includes(word) || word.includes(tag))) {
          matchCount++;
        }
      }

      const score = words.length > 0 ? matchCount / words.length : 0;

      if (score > bestScore) {
        bestScore = score;
        bestMatch = broll;
      }
    }

    if (bestMatch && bestScore > 0) {
      matches.push({
        script_segment: {
          text: segment.text,
          start_sec: segment.start_sec,
          end_sec: segment.end_sec,
        },
        broll: {
          id: bestMatch.id,
          tags: bestMatch.tags,
          duration_sec: bestMatch.duration_sec,
        },
        match_score: parseFloat(bestScore.toFixed(3)),
      });
    }
  }

  return matches;
}

// ─── 7. autoTransitionSelect ──────────────────────────────────────────────────

/**
 * Selects the best transition between two clips based on mood.
 * @param {Object} opts
 * @param {Object} opts.clip_a - First clip metadata
 * @param {Object} opts.clip_b - Second clip metadata
 * @param {string} opts.mood - 'neutral' | 'energetic' | 'calm' | 'dramatic'
 * @returns {{ type: string, duration_sec: number, parameters: Object }}
 */
function autoTransitionSelect({ clip_a, clip_b, mood = 'neutral' }) {
  const transitions = {
    energetic: [
      { type: 'hard_cut', duration_sec: 0, parameters: {} },
      { type: 'wipe', duration_sec: 0.3, parameters: { direction: 'left' } },
      { type: 'whip_pan', duration_sec: 0.2, parameters: { intensity: 0.8 } },
    ],
    calm: [
      { type: 'crossfade', duration_sec: 1.0, parameters: { curve: 'ease-in-out' } },
      { type: 'dissolve', duration_sec: 0.8, parameters: { opacity_curve: 'linear' } },
      { type: 'dip_to_black', duration_sec: 1.5, parameters: {} },
    ],
    dramatic: [
      { type: 'zoom', duration_sec: 0.5, parameters: { scale: 1.2, easing: 'ease-in' } },
      { type: 'glitch', duration_sec: 0.4, parameters: { intensity: 0.9, rgb_split: true } },
      { type: 'flash', duration_sec: 0.2, parameters: { color: 'white', brightness: 2.0 } },
    ],
    neutral: [
      { type: 'hard_cut', duration_sec: 0, parameters: {} },
      { type: 'crossfade', duration_sec: 0.5, parameters: { curve: 'linear' } },
      { type: 'dissolve', duration_sec: 0.5, parameters: {} },
    ],
  };

  const pool = transitions[mood] || transitions.neutral;

  // Select based on clip similarity (shorter clips get faster transitions)
  const durationA = clip_a?.duration_sec || 5;
  const durationB = clip_b?.duration_sec || 5;
  const avgDuration = (durationA + durationB) / 2;

  let idx = 0;
  if (avgDuration < 2) idx = 0;      // fast clips → hard cuts
  else if (avgDuration < 5) idx = 1;  // medium clips → mid transition
  else idx = 2;                        // long clips → longer transition

  return pool[idx] || pool[0];
}

// ─── 8. autoMusicSync ─────────────────────────────────────────────────────────

/**
 * Aligns video cut points to music beats.
 * @param {Object} opts
 * @param {Array<{start_sec: number, end_sec: number}>} opts.video_cuts
 * @param {number[]} opts.music_beats - Beat timestamps in seconds
 * @returns {{ adjusted_cuts: Array<{start_sec: number, end_sec: number, snapped_to_beat: boolean}>, beat_count: number, sync_score: number }}
 */
function autoMusicSync({ video_cuts, music_beats }) {
  if (!video_cuts || video_cuts.length === 0) {
    return { adjusted_cuts: [], beat_count: 0, sync_score: 0 };
  }

  if (!music_beats || music_beats.length === 0) {
    return {
      adjusted_cuts: video_cuts.map(c => ({
        start_sec: c.start_sec,
        end_sec: c.end_sec,
        snapped_to_beat: false,
      })),
      beat_count: 0,
      sync_score: 0,
    };
  }

  const sortedBeats = [...music_beats].sort((a, b) => a - b);

  function findNearestBeat(time) {
    let nearest = sortedBeats[0];
    let minDiff = Math.abs(time - nearest);
    for (const beat of sortedBeats) {
      const diff = Math.abs(time - beat);
      if (diff < minDiff) {
        minDiff = diff;
        nearest = beat;
      }
    }
    return { beat: nearest, diff: minDiff };
  }

  const adjusted_cuts = video_cuts.map(cut => {
    const startSnap = findNearestBeat(cut.start_sec);
    const endSnap = findNearestBeat(cut.end_sec);

    return {
      start_sec: parseFloat(startSnap.beat.toFixed(3)),
      end_sec: parseFloat(endSnap.beat.toFixed(3)),
      snapped_to_beat: true,
    };
  });

  // Calculate sync score (0-1, higher = better sync)
  const maxSnap = adjusted_cuts.reduce((sum, c, i) => {
    return sum + findNearestBeat(video_cuts[i]?.start_sec || 0).diff;
  }, 0) / adjusted_cuts.length;

  const sync_score = parseFloat(Math.max(0, 1 - maxSnap).toFixed(3));

  return {
    adjusted_cuts,
    beat_count: sortedBeats.length,
    sync_score,
  };
}

// ─── 9. autoBeatEdit ──────────────────────────────────────────────────────────

/**
 * Cuts video on each detected music beat.
 * @param {Object} opts
 * @param {{ duration_sec: number }} opts.video
 * @param {{ beats: number[], bpm?: number }} opts.music
 * @param {number} opts.beat_threshold - Minimum beat confidence (0-1)
 * @returns {Array<{start_sec: number, end_sec: number, beat_index: number, beat_time: number}>}
 */
function autoBeatEdit({ video, music, beat_threshold = 0.7 }) {
  if (!video || !music || !music.beats || music.beats.length === 0) {
    return [];
  }

  const videoDuration = video.duration_sec || 0;
  if (videoDuration <= 0) return [];

  // Filter beats within video duration and above threshold
  const validBeats = music.beats
    .map((time, idx) => ({ time, index: idx }))
    .filter(b => b.time >= 0 && b.time <= videoDuration);

  if (validBeats.length === 0) return [];

  const cuts = [];
  for (let i = 0; i < validBeats.length; i++) {
    const start = validBeats[i].time;
    const end = i + 1 < validBeats.length ? validBeats[i + 1].time : videoDuration;

    cuts.push({
      start_sec: parseFloat(start.toFixed(3)),
      end_sec: parseFloat(end.toFixed(3)),
      beat_index: validBeats[i].index,
      beat_time: parseFloat(start.toFixed(3)),
    });
  }

  return cuts;
}

// ─── 10. autoEmotionalArc ─────────────────────────────────────────────────────

/**
 * Reorders clips to match a target emotional arc.
 * @param {Object} opts
 * @param {Array<{id: string, emotion?: string, intensity?: number, duration_sec: number}>} opts.clips
 * @param {string} opts.target_arc - 'hero' | 'tragedy' | 'comedy' | 'documentary'
 * @returns {{ arc: string, phases: Array<{name: string, clips: Array<{id: string, duration_sec: number}>, total_duration_sec: number}>, total_duration_sec: number }}
 */
function autoEmotionalArc({ clips, target_arc = 'hero' }) {
  if (!clips || clips.length === 0) {
    return { arc: target_arc, phases: [], total_duration_sec: 0 };
  }

  const arcDefinitions = {
    hero: {
      phases: [
        { name: 'setup', emotion_preference: ['neutral', 'happy', 'calm'], intensity_range: [0, 0.4] },
        { name: 'conflict', emotion_preference: ['tense', 'angry', 'fearful', 'neutral'], intensity_range: [0.5, 0.8] },
        { name: 'resolution', emotion_preference: ['happy', 'triumphant', 'relieved', 'neutral'], intensity_range: [0.3, 1.0] },
      ],
    },
    tragedy: {
      phases: [
        { name: 'happy', emotion_preference: ['happy', 'joyful', 'calm', 'neutral'], intensity_range: [0.6, 1.0] },
        { name: 'decline', emotion_preference: ['neutral', 'tense', 'confused'], intensity_range: [0.3, 0.7] },
        { name: 'sad', emotion_preference: ['sad', 'angry', 'fearful', 'neutral'], intensity_range: [0.5, 1.0] },
      ],
    },
    comedy: {
      phases: [
        { name: 'setup', emotion_preference: ['neutral', 'calm', 'happy'], intensity_range: [0, 0.3] },
        { name: 'escalation', emotion_preference: ['confused', 'tense', 'surprised', 'neutral'], intensity_range: [0.4, 0.8] },
        { name: 'punchline', emotion_preference: ['happy', 'surprised', 'joyful', 'neutral'], intensity_range: [0.7, 1.0] },
      ],
    },
    documentary: {
      phases: [
        { name: 'context', emotion_preference: ['neutral', 'calm'], intensity_range: [0, 0.3] },
        { name: 'exploration', emotion_preference: ['curious', 'neutral', 'tense', 'surprised'], intensity_range: [0.3, 0.7] },
        { name: 'conclusion', emotion_preference: ['neutral', 'happy', 'reflective'], intensity_range: [0.2, 0.5] },
      ],
    },
  };

  const arcDef = arcDefinitions[target_arc] || arcDefinitions.hero;
  const clipsCopy = clips.map(c => ({ ...c }));

  const phases = arcDef.phases.map(phase => {
    const phaseClips = [];

    for (const pref of phase.emotion_preference) {
      const idx = clipsCopy.findIndex(c =>
        c.emotion === pref &&
        (c.intensity || 0.5) >= phase.intensity_range[0] &&
        (c.intensity || 0.5) <= phase.intensity_range[1]
      );
      if (idx !== -1) {
        phaseClips.push(clipsCopy.splice(idx, 1)[0]);
      }
    }

    // Fill remaining with unassigned clips if needed
    while (phaseClips.length < 2 && clipsCopy.length > 0) {
      phaseClips.push(clipsCopy.shift());
    }

    return {
      name: phase.name,
      clips: phaseClips.map(c => ({ id: c.id, duration_sec: c.duration_sec })),
      total_duration_sec: parseFloat(phaseClips.reduce((s, c) => s + (c.duration_sec || 0), 0).toFixed(3)),
    };
  });

  const totalDuration = phases.reduce((s, p) => s + p.total_duration_sec, 0);

  return {
    arc: target_arc,
    phases,
    total_duration_sec: parseFloat(totalDuration.toFixed(3)),
  };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  detectSilences,
  detectFillerWords,
  autoJumpCut,
  autoPacing,
  autoHighlightReel,
  autoBrollMatch,
  autoTransitionSelect,
  autoMusicSync,
  autoBeatEdit,
  autoEmotionalArc,
};
