/**
 * Vireo Studio - Multi-Agent Pipeline
 *
 * A team of 7 AI specialists working together under an AgentOrchestrator:
 *   1. DirectorAgent      — Creative direction: clip selection, story arc, pacing
 *   2. EditorAgent         — Editing: cuts, timeline, transitions
 *   3. ColoristAgent       — Color grading: LUTs, adjustments, mood matching
 *   4. SoundDesignerAgent  — Audio: mix, music, SFX, ducking
 *   5. MotionDesignerAgent — Graphics: text overlays, animations, lower thirds
 *   6. QualityAgent        — Quality review: issues, suggestions, pass/fail
 *   7. OptimizerAgent      — Platform optimization: formats, sizing, encoding
 *
 * AgentOrchestrator coordinates the pipeline with quality loops and retry logic.
 */

import { randomUUID } from "node:crypto";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function nowISO() {
  return new Date().toISOString();
}

/** Generate a short unique id */
function uid() {
  return randomUUID().split("-")[0];
}

// ─── 1. DirectorAgent ────────────────────────────────────────────────────────

/**
 * Decides what clips to use, what order, pacing, and story arc.
 */
export class DirectorAgent {
  constructor() {
    this.name = "DirectorAgent";
    this.lastRun = null;
    this.issueCount = 0;
  }

  /**
   * @param {Object} brief — Creative brief with description, target_duration_sec, etc.
   * @param {Object[]} footage — Array of clip objects
   * @returns {Object} DirectorOutput
   */
  process(brief, footage) {
    if (!brief || typeof brief !== "object") {
      throw new Error("DirectorAgent: brief is required");
    }
    if (!footage || !Array.isArray(footage) || footage.length === 0) {
      throw new Error("DirectorAgent: footage array is required and must be non-empty");
    }

    const targetDuration = brief.target_duration_sec || 30;
    const description = brief.description || "";
    const mood = brief.mood || "neutral";

    // Select clips: score each clip against brief keywords
    const keywords = description.toLowerCase().split(/\s+/).filter(Boolean);
    const scored = footage.map((clip) => {
      let score = (clip.quality_score || 0.5);
      // Boost score if clip mood matches brief mood
      if (clip.mood === mood) score += 0.2;
      // Boost for relevance keywords in scene_type or tags
      const clipText = `${clip.scene_type || ""} ${(clip.tags || []).join(" ")}`.toLowerCase();
      for (const kw of keywords) {
        if (clipText.includes(kw)) score += 0.1;
      }
      return { clip, score: clamp(score, 0, 1) };
    });

    scored.sort((a, b) => b.score - a.score);

    // Select clips up to target duration
    const selected = [];
    let accumulated = 0;
    for (const { clip } of scored) {
      if (accumulated + (clip.duration_sec || 2) <= targetDuration * 1.1) {
        selected.push(clip);
        accumulated += clip.duration_sec || 2;
      }
      if (accumulated >= targetDuration) break;
    }

    // If nothing selected, pick the best clip
    if (selected.length === 0 && scored.length > 0) {
      selected.push(scored[0].clip);
    }

    // Build story arc
    const storyArc = {
      intro: selected.length > 0 ? selected[0].scene_type || "opening" : "none",
      body: selected.slice(1, -1).map((c) => c.scene_type || "scene"),
      climax: selected.length > 2 ? selected[selected.length - 2].scene_type || "action" : "none",
      resolution: selected.length > 1 ? selected[selected.length - 1].scene_type || "closing" : "none",
    };

    // Pacing plan
    const pacingPlan = {
      overall_mood: mood,
      tempo: brief.tempo || "medium",
      cuts_per_minute: selected.length > 0 ? Math.round((selected.length / Math.max(accumulated, 1)) * 60) : 0,
      beat_markers: selected.map((c, i) => ({
        time_sec: selected.slice(0, i).reduce((s, x) => s + (x.duration_sec || 2), 0),
        type: c.scene_type || "scene",
      })),
    };

    // Creative direction
    const creativeDirection = {
      style: brief.style || "cinematic",
      color_palette: brief.color_palette || "natural",
      target_duration_sec: targetDuration,
      aspect_ratio: brief.aspect_ratio || "16:9",
      platform_hints: brief.platforms || ["youtube"],
    };

    // Confidence calculation
    const briefClarity = clamp(description.length / 50, 0.2, 1);
    const footageQuality = footage.reduce((s, c) => s + (c.quality_score || 0.5), 0) / footage.length;
    const confidence = clamp((briefClarity + footageQuality) / 2, 0, 1);

    const result = {
      selected_clips: selected,
      story_arc: storyArc,
      pacing_plan: pacingPlan,
      creative_direction: creativeDirection,
      confidence: Math.round(confidence * 100) / 100,
    };

    this.lastRun = nowISO();
    return result;
  }

  getStatus() {
    return {
      name: this.name,
      status: this.lastRun ? "ready" : "idle",
      last_run: this.lastRun,
      confidence: null,
      issue_count: this.issueCount,
    };
  }
}

// ─── 2. EditorAgent ──────────────────────────────────────────────────────────

/**
 * Cuts clips, arranges timeline, adds transitions.
 */
export class EditorAgent {
  constructor() {
    this.name = "EditorAgent";
    this.lastRun = null;
    this.issueCount = 0;
  }

  /**
   * @param {Object} directorOutput — Output from DirectorAgent
   * @param {Object[]} rawFootage — Original footage array
   * @returns {Object} EditorOutput
   */
  process(directorOutput, rawFootage) {
    if (!directorOutput || !directorOutput.selected_clips) {
      throw new Error("EditorAgent: directorOutput with selected_clips is required");
    }
    if (!rawFootage || !Array.isArray(rawFootage) || rawFootage.length === 0) {
      throw new Error("EditorAgent: rawFootage array is required");
    }

    const clips = directorOutput.selected_clips;
    const pacing = directorOutput.pacing_plan || {};

    // Build timeline
    let currentTime = 0;
    const timeline = [];
    const cuts = [];
    const transitions = [];

    const transitionTypes = ["cut", "crossfade", "wipe", "fade"];

    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      const duration = clip.duration_sec || 3;

      const segment = {
        clip_id: clip.id,
        clip_path: clip.path,
        start_sec: currentTime,
        end_sec: currentTime + duration,
        duration_sec: duration,
        scene_type: clip.scene_type || "scene",
      };
      timeline.push(segment);

      // Add cut point
      cuts.push({
        time_sec: currentTime,
        type: i === 0 ? "start" : "hard_cut",
        from_clip: i > 0 ? clips[i - 1].id : null,
        to_clip: clip.id,
      });

      // Add transition (except after last clip)
      if (i < clips.length - 1) {
        const transType = pacing.tempo === "fast" ? "cut" :
          transitionTypes[Math.min(i, transitionTypes.length - 1)];
        transitions.push({
          at_sec: currentTime + duration,
          type: transType,
          duration_sec: transType === "cut" ? 0 : 0.5,
        });
      }

      currentTime += duration;
    }

    const totalDuration = currentTime;

    // Confidence
    const footageQuality = rawFootage.reduce((s, c) => s + (c.quality_score || 0.5), 0) / rawFootage.length;
    const pacingMatch = clips.length > 0 ? clamp(1 - Math.abs(totalDuration - (directorOutput.creative_direction?.target_duration_sec || 30)) / 30, 0.3, 1) : 0.3;
    const confidence = clamp((footageQuality + pacingMatch) / 2, 0, 1);

    const result = {
      timeline,
      cuts,
      transitions,
      total_duration: Math.round(totalDuration * 100) / 100,
      confidence: Math.round(confidence * 100) / 100,
    };

    this.lastRun = nowISO();
    return result;
  }

  getStatus() {
    return {
      name: this.name,
      status: this.lastRun ? "ready" : "idle",
      last_run: this.lastRun,
      confidence: null,
      issue_count: this.issueCount,
    };
  }
}

// ─── 3. ColoristAgent ────────────────────────────────────────────────────────

/**
 * Applies color grading based on style and mood.
 */
export class ColoristAgent {
  constructor() {
    this.name = "ColoristAgent";
    this.lastRun = null;
    this.issueCount = 0;
  }

  /**
   * @param {Object} editorOutput — Output from EditorAgent
   * @param {Object} [styleDNA] — Optional style overrides
   * @returns {Object} ColorOutput
   */
  process(editorOutput, styleDNA = {}) {
    if (!editorOutput || !editorOutput.timeline) {
      throw new Error("ColoristAgent: editorOutput with timeline is required");
    }

    const style = styleDNA.style || "cinematic";
    const mood = styleDNA.mood || "neutral";

    // Mood → color adjustments mapping
    const moodAdjustments = {
      warm: { temperature: 1.2, saturation: 1.1, contrast: 1.05, shadows: "#3d2b1f" },
      cool: { temperature: 0.8, saturation: 0.95, contrast: 1.1, shadows: "#1f2d3d" },
      dramatic: { temperature: 1.0, saturation: 1.2, contrast: 1.3, shadows: "#0a0a0a" },
      vintage: { temperature: 1.15, saturation: 0.8, contrast: 0.9, shadows: "#2d1f0f" },
      vivid: { temperature: 1.05, saturation: 1.4, contrast: 1.15, shadows: "#1a1a2e" },
      neutral: { temperature: 1.0, saturation: 1.0, contrast: 1.0, shadows: "#1a1a1a" },
    };

    // Style → LUT mapping
    const styleLUTs = {
      cinematic: "luts/cinematic_warm.cube",
      documentary: "luts/documentary_natural.cube",
      commercial: "luts/commercial_vibrant.cube",
      music_video: "luts/music_video_neon.cube",
      noir: "luts/film_noir_bw.cube",
      default: "luts/default_balanced.cube",
    };

    const adjustments = moodAdjustments[mood] || moodAdjustments.neutral;
    const lut = styleLUTs[style] || styleLUTs.default;

    // Per-segment adjustments
    const segmentAdjustments = editorOutput.timeline.map((seg) => ({
      clip_id: seg.clip_id,
      start_sec: seg.start_sec,
      end_sec: seg.end_sec,
      adjustments: deepClone(adjustments),
    }));

    // Mood match score
    const moodKeys = Object.keys(moodAdjustments);
    const moodMatch = moodKeys.includes(mood) ? 0.9 : 0.5;

    const confidence = clamp(moodMatch + (styleDNA.style ? 0.1 : 0), 0, 1);

    const result = {
      color_grade: {
        style,
        mood,
        lut_applied: lut,
        global_adjustments: deepClone(adjustments),
      },
      lut_applied: lut,
      adjustments: segmentAdjustments,
      mood_match: Math.round(moodMatch * 100) / 100,
      confidence: Math.round(confidence * 100) / 100,
    };

    this.lastRun = nowISO();
    return result;
  }

  getStatus() {
    return {
      name: this.name,
      status: this.lastRun ? "ready" : "idle",
      last_run: this.lastRun,
      confidence: null,
      issue_count: this.issueCount,
    };
  }
}

// ─── 4. SoundDesignerAgent ───────────────────────────────────────────────────

/**
 * Mixes audio: voice, music, SFX, ducking.
 */
export class SoundDesignerAgent {
  constructor() {
    this.name = "SoundDesignerAgent";
    this.lastRun = null;
    this.issueCount = 0;
  }

  /**
   * @param {Object} editorOutput — Output from EditorAgent
   * @param {Object} [music] — Optional music track info
   * @returns {Object} SoundOutput
   */
  process(editorOutput, music = {}) {
    if (!editorOutput || !editorOutput.timeline) {
      throw new Error("SoundDesignerAgent: editorOutput with timeline is required");
    }

    const totalDuration = editorOutput.total_duration || 30;
    const musicMood = music.mood || "neutral";
    const musicTrack = music.track || null;

    // Generate SFX events based on cuts
    const sfxEvents = (editorOutput.cuts || []).map((cut) => ({
      time_sec: cut.time_sec,
      type: cut.type === "start" ? "whoosh_in" :
        cut.type === "hard_cut" ? "impact" : "transition_sfx",
      volume_db: -12,
      duration_sec: 0.3,
    }));

    // Generate ducking points at scene transitions
    const duckingPoints = (editorOutput.transitions || [])
      .filter((t) => t.type !== "cut")
      .map((t) => ({
        time_sec: t.at_sec,
        duck_to_db: -18,
        duration_sec: t.duration_sec + 0.5,
        reason: "transition",
      }));

    // Audio levels per segment
    const levels = editorOutput.timeline.map((seg) => ({
      clip_id: seg.clip_id,
      voice_db: -6,
      music_db: -14,
      sfx_db: -12,
      master_db: -3,
    }));

    // Audio mix configuration
    const audioMix = {
      voice_track: {
        enabled: true,
        base_level_db: -6,
        compression: { threshold_db: -18, ratio: 4, attack_ms: 5, release_ms: 50 },
      },
      music_track: {
        enabled: !!musicTrack || musicMood !== "neutral",
        base_level_db: -14,
        file: musicTrack,
        mood: musicMood,
        fade_in_sec: 1,
        fade_out_sec: 2,
      },
      sfx_track: {
        enabled: sfxEvents.length > 0,
        base_level_db: -12,
        events: sfxEvents.length,
      },
      master: {
        limiter: { threshold_db: -1, release_ms: 50 },
        target_lufs: -14,
      },
    };

    // Confidence
    const hasMusic = !!musicTrack || musicMood !== "neutral";
    const hasSFX = sfxEvents.length > 0;
    const confidence = clamp(0.6 + (hasMusic ? 0.2 : 0) + (hasSFX ? 0.1 : 0), 0, 1);

    const result = {
      audio_mix: audioMix,
      music_track: musicTrack,
      sfx_events: sfxEvents,
      ducking_points: duckingPoints,
      levels,
      total_duration: totalDuration,
      confidence: Math.round(confidence * 100) / 100,
    };

    this.lastRun = nowISO();
    return result;
  }

  getStatus() {
    return {
      name: this.name,
      status: this.lastRun ? "ready" : "idle",
      last_run: this.lastRun,
      confidence: null,
      issue_count: this.issueCount,
    };
  }
}

// ─── 5. MotionDesignerAgent ──────────────────────────────────────────────────

/**
 * Adds text overlays, lower thirds, graphics, animations.
 */
export class MotionDesignerAgent {
  constructor() {
    this.name = "MotionDesignerAgent";
    this.lastRun = null;
    this.issueCount = 0;
  }

  /**
   * @param {Object} editorOutput — Output from EditorAgent
   * @param {Object} [textOverlay] — Optional text overlay config
   * @returns {Object} MotionOutput
   */
  process(editorOutput, textOverlay = {}) {
    if (!editorOutput || !editorOutput.timeline) {
      throw new Error("MotionDesignerAgent: editorOutput with timeline is required");
    }

    const totalDuration = editorOutput.total_duration || 30;
    const title = textOverlay.title || "";
    const subtitle = textOverlay.subtitle || "";
    const lowerThird = textOverlay.lower_third || null;

    const graphics = [];
    const animations = [];
    const textOverlays = [];
    const timing = [];

    // Title card at start
    if (title) {
      const titleEntry = {
        id: `gfx-${uid()}`,
        type: "title_card",
        text: title,
        font: textOverlay.font || "Inter-Bold",
        size: textOverlay.font_size || 72,
        color: textOverlay.color || "#FFFFFF",
        position: { x: "center", y: "center" },
        animation: "fade_in",
        duration_sec: Math.min(3, totalDuration),
      };
      graphics.push(titleEntry);
      textOverlays.push(titleEntry);
      timing.push({ event: "title_in", time_sec: 0 });
      timing.push({ event: "title_out", time_sec: Math.min(3, totalDuration) });
    }

    // Subtitle
    if (subtitle) {
      const subEntry = {
        id: `gfx-${uid()}`,
        type: "subtitle",
        text: subtitle,
        font: textOverlay.subtitle_font || "Inter-Regular",
        size: textOverlay.subtitle_size || 36,
        color: textOverlay.subtitle_color || "#CCCCCC",
        position: { x: "center", y: "70%" },
        animation: "slide_up",
        delay_sec: title ? 1 : 0,
        duration_sec: Math.min(4, totalDuration),
      };
      graphics.push(subEntry);
      textOverlays.push(subEntry);
      timing.push({ event: "subtitle_in", time_sec: title ? 1 : 0 });
    }

    // Lower third
    if (lowerThird) {
      const ltEntry = {
        id: `gfx-${uid()}`,
        type: "lower_third",
        name: lowerThird.name || "",
        role: lowerThird.role || "",
        style: lowerThird.style || "modern",
        animation: "slide_in_left",
        duration_sec: 5,
      };
      graphics.push(ltEntry);
      timing.push({ event: "lower_third_in", time_sec: lowerThird.start_sec || 2 });
    }

    // Auto-generated segment labels
    editorOutput.timeline.forEach((seg, i) => {
      const labelEntry = {
        id: `gfx-${uid()}`,
        type: "segment_label",
        text: seg.scene_type || `Scene ${i + 1}`,
        font: "Inter-Medium",
        size: 24,
        color: "#888888",
        position: { x: "left", y: "bottom" },
        animation: "fade",
        duration_sec: 1.5,
      };
      graphics.push(labelEntry);
      timing.push({ event: `label_${i}_in`, time_sec: seg.start_sec });
    });

    // Animations summary
    const animationTypes = ["fade_in", "slide_up", "slide_in_left", "fade"];
    const usedAnims = [...new Set(graphics.map((g) => g.animation))];
    usedAnims.forEach((anim) => {
      animations.push({
        name: anim,
        easing: "ease_in_out",
        duration_sec: 0.5,
        instances: graphics.filter((g) => g.animation === anim).length,
      });
    });

    // Readability score: based on contrast and size
    const hasReadableText = graphics.some((g) => g.size >= 36);
    const hasGoodContrast = graphics.some((g) => g.color === "#FFFFFF" || g.color === "#000000");
    const confidence = clamp(
      0.5 + (hasReadableText ? 0.25 : 0) + (hasGoodContrast ? 0.15 : 0) + (graphics.length > 0 ? 0.1 : 0),
      0, 1
    );

    const result = {
      graphics,
      animations,
      text_overlays: textOverlays,
      timing,
      confidence: Math.round(confidence * 100) / 100,
    };

    this.lastRun = nowISO();
    return result;
  }

  getStatus() {
    return {
      name: this.name,
      status: this.lastRun ? "ready" : "idle",
      last_run: this.lastRun,
      confidence: null,
      issue_count: this.issueCount,
    };
  }
}

// ─── 6. QualityAgent ─────────────────────────────────────────────────────────

/**
 * Reviews the entire pipeline output for issues and suggestions.
 */
export class QualityAgent {
  constructor() {
    this.name = "QualityAgent";
    this.lastRun = null;
    this.issueCount = 0;
    this.minPassScore = 0.6;
  }

  /**
   * @param {Object} fullOutput — Combined output from all agents
   * @returns {Object} QualityReport
   */
  process(fullOutput) {
    if (!fullOutput || typeof fullOutput !== "object") {
      throw new Error("QualityAgent: fullOutput is required");
    }

    const issues = [];
    const warnings = [];
    const suggestions = [];

    // Check Director output
    const director = fullOutput.director;
    if (director) {
      if (!director.selected_clips || director.selected_clips.length === 0) {
        issues.push({ agent: "DirectorAgent", severity: "critical", message: "No clips selected" });
      }
      if (director.confidence < 0.5) {
        warnings.push({ agent: "DirectorAgent", message: "Low director confidence" });
      }
      if (director.selected_clips && director.selected_clips.length < 2) {
        suggestions.push({ agent: "DirectorAgent", message: "Consider adding more clips for variety" });
      }
    } else {
      issues.push({ agent: "DirectorAgent", severity: "critical", message: "Director output missing" });
    }

    // Check Editor output
    const editor = fullOutput.editor;
    if (editor) {
      if (!editor.timeline || editor.timeline.length === 0) {
        issues.push({ agent: "EditorAgent", severity: "critical", message: "Empty timeline" });
      }
      if (editor.total_duration < 1) {
        issues.push({ agent: "EditorAgent", severity: "high", message: "Timeline too short" });
      }
      if (editor.total_duration > 600) {
        warnings.push({ agent: "EditorAgent", message: "Timeline exceeds 10 minutes" });
      }
    } else {
      issues.push({ agent: "EditorAgent", severity: "critical", message: "Editor output missing" });
    }

    // Check Colorist output
    const colorist = fullOutput.colorist;
    if (colorist) {
      if (colorist.mood_match < 0.5) {
        warnings.push({ agent: "ColoristAgent", message: "Low mood match score" });
      }
    } else {
      warnings.push({ agent: "ColoristAgent", message: "Colorist output missing" });
    }

    // Check SoundDesigner output
    const sound = fullOutput.sound;
    if (sound) {
      if (!sound.audio_mix) {
        warnings.push({ agent: "SoundDesignerAgent", message: "No audio mix configured" });
      }
    } else {
      warnings.push({ agent: "SoundDesignerAgent", message: "Sound output missing" });
    }

    // Check MotionDesigner output
    const motion = fullOutput.motion;
    if (motion) {
      if (!motion.graphics || motion.graphics.length === 0) {
        suggestions.push({ agent: "MotionDesignerAgent", message: "No graphics added" });
      }
    } else {
      suggestions.push({ agent: "MotionDesignerAgent", message: "Motion output missing" });
    }

    // Calculate overall score
    const criticalCount = issues.filter((i) => i.severity === "critical").length;
    const highCount = issues.filter((i) => i.severity === "high").length;
    const warningCount = warnings.length;
    const suggestionCount = suggestions.length;

    let score = 1.0;
    score -= criticalCount * 0.3;
    score -= highCount * 0.15;
    score -= warningCount * 0.05;
    score -= suggestionCount * 0.02;
    score = clamp(score, 0, 1);

    const pass = score >= this.minPassScore;

    this.issueCount = issues.length;

    const result = {
      overall_score: Math.round(score * 100) / 100,
      issues,
      warnings,
      suggestions,
      pass,
      summary: {
        total_issues: issues.length,
        total_warnings: warnings.length,
        total_suggestions: suggestions.length,
        critical: criticalCount,
        high: highCount,
      },
    };

    this.lastRun = nowISO();
    return result;
  }

  getStatus() {
    return {
      name: this.name,
      status: this.lastRun ? "ready" : "idle",
      last_run: this.lastRun,
      confidence: 0.95,
      issue_count: this.issueCount,
    };
  }
}

// ─── 7. OptimizerAgent ───────────────────────────────────────────────────────

/**
 * Optimizes the final output for each target platform.
 */
export class OptimizerAgent {
  constructor() {
    this.name = "OptimizerAgent";
    this.lastRun = null;
    this.issueCount = 0;
  }

  /**
   * @param {Object} fullOutput — Combined output from all agents
   * @param {string[]} platforms — Target platforms
   * @returns {Object} OptimizedOutput
   */
  process(fullOutput, platforms = []) {
    if (!fullOutput || typeof fullOutput !== "object") {
      throw new Error("OptimizerAgent: fullOutput is required");
    }

    const editor = fullOutput.editor || {};
    const duration = editor.total_duration || 30;

    // Platform specifications
    const platformSpecs = {
      youtube: { resolution: "1920x1080", fps: 30, format: "mp4", max_duration: 43200, codec: "h264", bitrate: "8M" },
      tiktok: { resolution: "1080x1920", fps: 30, format: "mp4", max_duration: 180, codec: "h264", bitrate: "6M", vertical: true },
      instagram_reels: { resolution: "1080x1920", fps: 30, format: "mp4", max_duration: 90, codec: "h264", bitrate: "6M", vertical: true },
      instagram_feed: { resolution: "1080x1080", fps: 30, format: "mp4", max_duration: 60, codec: "h264", bitrate: "5M", square: true },
      twitter: { resolution: "1280x720", fps: 30, format: "mp4", max_duration: 140, codec: "h264", bitrate: "5M" },
      linkedin: { resolution: "1920x1080", fps: 30, format: "mp4", max_duration: 600, codec: "h264", bitrate: "8M" },
      facebook: { resolution: "1920x1080", fps: 30, format: "mp4", max_duration: 14400, codec: "h264", bitrate: "8M" },
      shorts: { resolution: "1080x1920", fps: 60, format: "mp4", max_duration: 60, codec: "h264", bitrate: "8M", vertical: true },
    };

    const platformVersions = [];
    const optimizationNotes = [];
    const fileEstimates = [];

    const activePlatforms = platforms.length > 0 ? platforms : ["youtube"];

    for (const platform of activePlatforms) {
      const spec = platformSpecs[platform] || platformSpecs.youtube;
      const trimmed = duration > spec.max_duration;

      const version = {
        platform,
        resolution: spec.resolution,
        fps: spec.fps,
        format: spec.format,
        codec: spec.codec,
        bitrate: spec.bitrate,
        trimmed,
        actual_duration: trimmed ? spec.max_duration : duration,
      };
      platformVersions.push(version);

      if (trimmed) {
        optimizationNotes.push({
          platform,
          note: `Duration ${duration}s exceeds ${platform} max ${spec.max_duration}s — will be trimmed`,
        });
      }

      if (spec.vertical || spec.square) {
        optimizationNotes.push({
          platform,
          note: `Aspect ratio adjusted to ${spec.vertical ? "9:16 vertical" : "1:1 square"}`,
        });
      }

      // Rough file size estimate: bitrate (Mbps) * duration (s) / 8
      const bitrateNum = parseFloat(spec.bitrate) || 8;
      const estSeconds = trimmed ? spec.max_duration : duration;
      const estSizeMB = Math.round((bitrateNum * estSeconds / 8) * 100) / 100;
      fileEstimates.push({
        platform,
        estimated_size_mb: estSizeMB,
        estimated_duration_sec: estSeconds,
      });
    }

    // Confidence based on platform compatibility
    const compatible = platformVersions.filter((v) => !v.trimmed).length;
    const confidence = clamp(compatible / Math.max(activePlatforms.length, 1), 0.5, 1);

    const result = {
      platform_versions: platformVersions,
      optimization_notes: optimizationNotes,
      file_estimates: fileEstimates,
      confidence: Math.round(confidence * 100) / 100,
    };

    this.lastRun = nowISO();
    return result;
  }

  getStatus() {
    return {
      name: this.name,
      status: this.lastRun ? "ready" : "idle",
      last_run: this.lastRun,
      confidence: null,
      issue_count: this.issueCount,
    };
  }
}

// ─── AgentOrchestrator ───────────────────────────────────────────────────────

/**
 * Coordinates the 7-agent pipeline with quality loops and retry logic.
 */
export class AgentOrchestrator {
  constructor() {
    this.director = new DirectorAgent();
    this.editor = new EditorAgent();
    this.colorist = new ColoristAgent();
    this.soundDesigner = new SoundDesignerAgent();
    this.motionDesigner = new MotionDesignerAgent();
    this.qualityAgent = new QualityAgent();
    this.optimizer = new OptimizerAgent();

    this.maxIterations = 3;
    this.pipelineHistory = [];
    this.agents = [
      this.director,
      this.editor,
      this.colorist,
      this.soundDesigner,
      this.motionDesigner,
      this.qualityAgent,
      this.optimizer,
    ];
  }

  /**
   * Run the full pipeline from brief to optimized output.
   * @param {Object} brief — Creative brief
   * @param {Object[]} footage — Raw footage clips
   * @param {Object} [options] — Pipeline options (platforms, styleDNA, music, textOverlay, qualityThreshold)
   * @returns {Object} PipelineResult
   */
  runPipeline(brief, footage, options = {}) {
    if (!brief) throw new Error("AgentOrchestrator: brief is required");
    if (!footage || !Array.isArray(footage) || footage.length === 0) {
      throw new Error("AgentOrchestrator: footage array is required");
    }

    const platforms = options.platforms || ["youtube"];
    const styleDNA = options.styleDNA || {};
    const music = options.music || {};
    const textOverlay = options.textOverlay || {};
    const qualityThreshold = options.qualityThreshold || 0.6;

    const startTime = Date.now();
    const agentHistory = [];
    let iterations = 0;
    let pipelineOutput = {};

    // Pipeline stages with quality loop
    let passed = false;
    while (iterations < this.maxIterations && !passed) {
      iterations++;

      // 1. Director
      const t1 = Date.now();
      const directorOutput = this.director.process(brief, footage);
      agentHistory.push({
        agent: "DirectorAgent",
        iteration: iterations,
        confidence: directorOutput.confidence,
        duration_ms: Date.now() - t1,
      });

      // 2. Editor
      const t2 = Date.now();
      const editorOutput = this.editor.process(directorOutput, footage);
      agentHistory.push({
        agent: "EditorAgent",
        iteration: iterations,
        confidence: editorOutput.confidence,
        duration_ms: Date.now() - t2,
      });

      // 3. Colorist
      const t3 = Date.now();
      const colorOutput = this.colorist.process(editorOutput, styleDNA);
      agentHistory.push({
        agent: "ColoristAgent",
        iteration: iterations,
        confidence: colorOutput.confidence,
        duration_ms: Date.now() - t3,
      });

      // 4. SoundDesigner
      const t4 = Date.now();
      const soundOutput = this.soundDesigner.process(editorOutput, music);
      agentHistory.push({
        agent: "SoundDesignerAgent",
        iteration: iterations,
        confidence: soundOutput.confidence,
        duration_ms: Date.now() - t4,
      });

      // 5. MotionDesigner
      const t5 = Date.now();
      const motionOutput = this.motionDesigner.process(editorOutput, textOverlay);
      agentHistory.push({
        agent: "MotionDesignerAgent",
        iteration: iterations,
        confidence: motionOutput.confidence,
        duration_ms: Date.now() - t5,
      });

      // 6. Quality check
      pipelineOutput = {
        director: directorOutput,
        editor: editorOutput,
        colorist: colorOutput,
        sound: soundOutput,
        motion: motionOutput,
      };

      const t6 = Date.now();
      const qualityReport = this.qualityAgent.process(pipelineOutput);
      agentHistory.push({
        agent: "QualityAgent",
        iteration: iterations,
        confidence: 0.95,
        duration_ms: Date.now() - t6,
        quality_score: qualityReport.overall_score,
        pass: qualityReport.pass,
      });

      if (qualityReport.pass || qualityReport.overall_score >= qualityThreshold) {
        passed = true;
      }
    }

    // 7. Optimizer (runs once on final output)
    const t7 = Date.now();
    const optimizedOutput = this.optimizer.process(pipelineOutput, platforms);
    agentHistory.push({
      agent: "OptimizerAgent",
      iteration: iterations,
      confidence: optimizedOutput.confidence,
      duration_ms: Date.now() - t7,
    });

    // Assemble final result
    const result = {
      ...pipelineOutput,
      optimized: optimizedOutput,
      quality_report: this.qualityAgent.process(pipelineOutput),
    };

    // Calculate total confidence
    const confidences = agentHistory
      .filter((h) => h.confidence != null)
      .map((h) => h.confidence);
    const totalConfidence = confidences.length > 0
      ? Math.round((confidences.reduce((s, c) => s + c, 0) / confidences.length) * 100) / 100
      : 0;

    const qualityScore = result.quality_report.overall_score;
    const totalTimeMs = Date.now() - startTime;

    const pipelineResult = {
      result,
      agent_history: agentHistory,
      total_confidence: totalConfidence,
      iterations,
      quality_score: qualityScore,
      timing: {
        total_ms: totalTimeMs,
        per_agent: agentHistory.map((h) => ({ agent: h.agent, ms: h.duration_ms })),
      },
    };

    // Record in history
    this.pipelineHistory.push({
      id: uid(),
      timestamp: nowISO(),
      brief: { description: brief.description || "" },
      result: pipelineResult,
      agents_used: agentHistory.map((h) => h.agent),
      timing: pipelineResult.timing,
      quality_score: qualityScore,
    });

    return pipelineResult;
  }

  /**
   * Get status of all agents.
   * @returns {Object[]}
   */
  getAgentStatus() {
    return this.agents.map((a) => a.getStatus());
  }

  /**
   * Get full pipeline run history.
   * @returns {Object[]}
   */
  getPipelineHistory() {
    return deepClone(this.pipelineHistory);
  }

  /**
   * Re-run with feedback from a previous run.
   * @param {Object} pipelineResult — Previous pipeline result
   * @param {Object} feedback — Feedback object with per-agent adjustments
   * @returns {Object} PipelineResult
   */
  retryWithFeedback(pipelineResult, feedback = {}) {
    if (!pipelineResult || !pipelineResult.result) {
      throw new Error("retryWithFeedback: valid pipelineResult is required");
    }

    // Extract the original brief context from pipeline history
    const prevRun = this.pipelineHistory[this.pipelineHistory.length - 1];
    const briefDescription = prevRun?.brief?.description || "retry";

    // Build adjusted brief from feedback
    const brief = {
      description: feedback.brief_description || briefDescription,
      target_duration_sec: feedback.target_duration_sec || 30,
      mood: feedback.mood || "neutral",
      style: feedback.style || "cinematic",
      tempo: feedback.tempo || "medium",
      platforms: feedback.platforms || ["youtube"],
    };

    // Use previous footage selections with any overrides
    const prevDirector = pipelineResult.result.director;
    const selectedClips = prevDirector?.selected_clips || [];

    // Create synthetic footage from previous selections
    const footage = selectedClips.length > 0 ? selectedClips : [{
      id: `clip-${uid()}`,
      path: "fallback_clip.mp4",
      duration_sec: 5,
      scene_type: "scene",
      mood: "neutral",
      quality_score: 0.7,
    }];

    // Run pipeline with adjusted parameters
    return this.runPipeline(brief, footage, {
      platforms: feedback.platforms || ["youtube"],
      styleDNA: feedback.styleDNA || {},
      music: feedback.music || {},
      textOverlay: feedback.textOverlay || {},
      qualityThreshold: feedback.qualityThreshold || 0.6,
    });
  }

  /**
   * Compare two pipeline runs.
   * @param {Object} run1 — First pipeline result
   * @param {Object} run2 — Second pipeline result
   * @returns {Object} ComparisonReport
   */
  compareRuns(run1, run2) {
    if (!run1 || !run2) {
      throw new Error("compareRuns: both runs are required");
    }

    const differences = [];
    const improvements = [];
    const regressions = [];

    // Compare quality scores
    const q1 = run1.quality_score || 0;
    const q2 = run2.quality_score || 0;
    if (q1 !== q2) {
      differences.push({ metric: "quality_score", run1: q1, run2: q2 });
      if (q2 > q1) improvements.push({ metric: "quality_score", change: Math.round((q2 - q1) * 100) / 100 });
      else regressions.push({ metric: "quality_score", change: Math.round((q2 - q1) * 100) / 100 });
    }

    // Compare confidence
    const c1 = run1.total_confidence || 0;
    const c2 = run2.total_confidence || 0;
    if (c1 !== c2) {
      differences.push({ metric: "total_confidence", run1: c1, run2: c2 });
      if (c2 > c1) improvements.push({ metric: "total_confidence", change: Math.round((c2 - c1) * 100) / 100 });
      else regressions.push({ metric: "total_confidence", change: Math.round((c2 - c1) * 100) / 100 });
    }

    // Compare iterations
    const i1 = run1.iterations || 1;
    const i2 = run2.iterations || 1;
    if (i1 !== i2) {
      differences.push({ metric: "iterations", run1: i1, run2: i2 });
      if (i2 < i1) improvements.push({ metric: "iterations", change: i2 - i1 });
      else regressions.push({ metric: "iterations", change: i2 - i1 });
    }

    // Compare clip counts
    const clips1 = run1.result?.director?.selected_clips?.length || 0;
    const clips2 = run2.result?.director?.selected_clips?.length || 0;
    if (clips1 !== clips2) {
      differences.push({ metric: "clip_count", run1: clips1, run2: clips2 });
    }

    // Compare durations
    const dur1 = run1.result?.editor?.total_duration || 0;
    const dur2 = run2.result?.editor?.total_duration || 0;
    if (Math.abs(dur1 - dur2) > 0.01) {
      differences.push({ metric: "total_duration", run1: dur1, run2: dur2 });
    }

    // Compare platform versions
    const plat1 = run1.result?.optimized?.platform_versions?.length || 0;
    const plat2 = run2.result?.optimized?.platform_versions?.length || 0;
    if (plat1 !== plat2) {
      differences.push({ metric: "platform_count", run1: plat1, run2: plat2 });
    }

    return {
      differences,
      improvements,
      regressions,
      summary: {
        total_differences: differences.length,
        total_improvements: improvements.length,
        total_regressions: regressions.length,
        overall: improvements.length > regressions.length ? "improved" :
          regressions.length > improvements.length ? "regressed" : "similar",
      },
    };
  }
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export default {
  DirectorAgent,
  EditorAgent,
  ColoristAgent,
  SoundDesignerAgent,
  MotionDesignerAgent,
  QualityAgent,
  OptimizerAgent,
  AgentOrchestrator,
};
