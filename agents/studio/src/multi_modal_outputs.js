/**
 * Vireo Studio — Multi-Modal Outputs (Week 16)
 *
 * Two advanced multi-modal output tools that turn Vireo from "editor"
 * into "AI co-creator that produces new content":
 *
 *   1. ReactionEngine  — split-screen reaction video generation
 *   2. VoiceCompiler    — natural-language compilation from voice prompt
 *
 * Architecture:
 *   - ReactionEngine: manages reaction sessions, finds best moments,
 *     calculates split-screen layouts, generates persona scripts,
 *     plans final composition.
 *   - VoiceCompiler: parses voice prompts, ranks moments across videos,
 *     plans cuts/transitions, adapts for platforms, builds recipes.
 *
 * Both are pure-logic (no FFmpeg calls) — they output recipes that
 * the existing edit_tools_tier1 + multimodal_tools can execute.
 *
 * Exports:
 *   ReactionEngine, SplitScreenLayout, MomentDetector, ReactionScript, ReactionComposer
 *   VoiceCompiler, VoiceParser, MomentRanker, CompilationPlanner, PlatformAdapter, CompilationBuilder
 *   REACTION_PERSONAS, REACTION_LAYOUTS, PLATFORM_SPECS, MOMENT_SCORING_CRITERIA
 */

import { randomUUID } from "node:crypto";

// ─── Constants ────────────────────────────────────────────────────────────────

export const REACTION_PERSONAS = {
  curious_viewer: {
    label: "Curious Viewer",
    tone: "engaged",
    script_style: "wonder",
    emoji: "🧐",
    default_hooks: [
      "Wait, I need to see that again...",
      "Oh wow, I didn't expect that!",
      "Hmm, interesting approach here.",
    ],
    default_reactions: [
      "That's actually really clever.",
      "I'm curious where this goes next.",
      "Okay, I see what they're doing.",
    ],
  },
  skeptical_expert: {
    label: "Skeptical Expert",
    tone: "critical",
    script_style: "analysis",
    emoji: "🤨",
    default_hooks: [
      "Let me break this down carefully...",
      "So here's the thing about this technique...",
      "Technically, there's a better way to do this.",
    ],
    default_reactions: [
      "The timing is a bit off here.",
      "They could've used a different approach.",
      "Actually, that's not bad for v1.",
    ],
  },
  supportive_friend: {
    label: "Supportive Friend",
    tone: "enthusiastic",
    script_style: "encouragement",
    emoji: "🙌",
    default_hooks: [
      "OMG, this is going to be so good!",
      "Okay, let me watch this with you!",
      "I already know I'm going to love this.",
    ],
    default_reactions: [
      "I love this take!",
      "The energy is immaculate.",
      "Keep doing what you're doing!",
    ],
  },
  industry_insider: {
    label: "Industry Insider",
    tone: "professional",
    script_style: "commentary",
    emoji: "💼",
    default_hooks: [
      "From a production standpoint, let me share...",
      "Here's what I notice as a professional...",
      "This technique is trending right now.",
    ],
    default_reactions: [
      "This will perform well algorithmically.",
      "Smart use of retention hooks.",
      "Good pacing for the platform.",
    ],
  },
  first_time_viewer: {
    label: "First-Time Viewer",
    tone: "surprised",
    script_style: "discovery",
    emoji: "😲",
    default_hooks: [
      "Wait, what is this about?",
      "I've never seen anything like this...",
      "Okay, I'm intrigued already.",
    ],
    default_reactions: [
      "Oh! Now I get it!",
      "That was unexpected!",
      "I need to share this with someone.",
    ],
  },
  comedy_roast: {
    label: "Comedy Roast",
    tone: "humorous",
    script_style: "roast",
    emoji: "😂",
    default_hooks: [
      "Buckle up, because I have NOTES...",
      "Who approved this edit?!",
      "I can't with this transition...",
    ],
    default_reactions: [
      "The way they cut there is criminal.",
      "I'm screaming at the font choice.",
      "This is either genius or chaos.",
    ],
  },
  educational: {
    label: "Educational Breakdown",
    tone: "informative",
    script_style: "teaching",
    emoji: "📚",
    default_hooks: [
      "Let me explain what's happening here...",
      "This is a great example of...",
      "Pay attention to this technique.",
    ],
    default_reactions: [
      "See how they used that transition?",
      "The pacing here teaches you something.",
      "This is a masterclass in editing.",
    ],
  },
  dramatic_narrator: {
    label: "Dramatic Narrator",
    tone: "cinematic",
    script_style: "narration",
    emoji: "🎭",
    default_hooks: [
      "In a world where editing matters...",
      "What you're about to see changed everything...",
      "And then... it happened.",
    ],
    default_reactions: [
      "The tension builds perfectly here.",
      "Every frame tells a story.",
      "This is cinema.",
    ],
  },
};

export const REACTION_LAYOUTS = {
  side_by_side: {
    label: "Side by Side",
    description: "Original on left, reaction on right",
    split_ratio: 0.5,
    gap_px: 4,
    original_position: "left",
    reaction_position: "right",
    labels: { original: "Original", reaction: "Reaction" },
  },
  picture_in_picture: {
    label: "Picture-in-Picture",
    description: "Original full-screen, reaction in corner",
    split_ratio: 0.25,
    gap_px: 8,
    original_position: "full",
    reaction_position: "bottom_right",
    labels: { original: "", reaction: "" },
  },
  top_bottom: {
    label: "Top / Bottom",
    description: "Original on top, reaction on bottom",
    split_ratio: 0.5,
    gap_px: 4,
    original_position: "top",
    reaction_position: "bottom",
    labels: { original: "Original", reaction: "Reaction" },
  },
  reaction_focus: {
    label: "Reaction Focus",
    description: "Reaction full-screen, original small overlay",
    split_ratio: 0.25,
    gap_px: 8,
    original_position: "top_left",
    reaction_position: "full",
    labels: { original: "Source", reaction: "" },
  },
  vertical_stack: {
    label: "9:16 Vertical Stack",
    description: "Both stacked vertically for TikTok/Reels",
    split_ratio: 0.5,
    gap_px: 2,
    original_position: "top",
    reaction_position: "bottom",
    labels: { original: "Original", reaction: "Reaction" },
  },
};

export const PLATFORM_SPECS = {
  tiktok: {
    label: "TikTok",
    width: 1080,
    height: 1920,
    aspect_ratio: "9:16",
    max_duration_sec: 180,
    preferred_layout: "vertical_stack",
    caption_style: "tiktok-bold",
    hook_duration_sec: 3,
    max_clips: 8,
    transitions: ["cut", "zoom", "whip"],
  },
  youtube_short: {
    label: "YouTube Shorts",
    width: 1080,
    height: 1920,
    aspect_ratio: "9:16",
    max_duration_sec: 60,
    preferred_layout: "vertical_stack",
    caption_style: "bold_clean",
    hook_duration_sec: 3,
    max_clips: 6,
    transitions: ["cut", "fade", "zoom"],
  },
  youtube: {
    label: "YouTube",
    width: 1920,
    height: 1080,
    aspect_ratio: "16:9",
    max_duration_sec: 600,
    preferred_layout: "side_by_side",
    caption_style: "default",
    hook_duration_sec: 5,
    max_clips: 20,
    transitions: ["cut", "fade", "crossfade", "whip"],
  },
  instagram: {
    label: "Instagram Reels",
    width: 1080,
    height: 1920,
    aspect_ratio: "9:16",
    max_duration_sec: 90,
    preferred_layout: "vertical_stack",
    caption_style: "minimal",
    hook_duration_sec: 2,
    max_clips: 6,
    transitions: ["cut", "zoom"],
  },
  twitter: {
    label: "X/Twitter",
    width: 1280,
    height: 720,
    aspect_ratio: "16:9",
    max_duration_sec: 140,
    preferred_layout: "side_by_side",
    caption_style: "bold_clean",
    hook_duration_sec: 2,
    max_clips: 5,
    transitions: ["cut"],
  },
  custom: {
    label: "Custom",
    width: 1920,
    height: 1080,
    aspect_ratio: "16:9",
    max_duration_sec: 600,
    preferred_layout: "side_by_side",
    caption_style: "default",
    hook_duration_sec: 3,
    max_clips: 20,
    transitions: ["cut", "fade", "crossfade"],
  },
};

export const MOMENT_SCORING_CRITERIA = {
  engagement: {
    weight: 0.3,
    factors: ["visual_interest", "audio_energy", "motion_level", "text_overlay"],
  },
  humor: {
    weight: 0.25,
    factors: ["unexpected_timing", "facial_expression", "punchline_delivery", "absurdity"],
  },
  emotional: {
    weight: 0.2,
    factors: ["music_crescendo", "facial_emotion", "dialogue_impact", "visual_metaphor"],
  },
  educational: {
    weight: 0.15,
    factors: ["clarity", "step_progression", "before_after", "demonstration"],
  },
  shareability: {
    weight: 0.1,
    factors: ["meme_potential", "quote_worthy", "controversial", "relatable"],
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function hashString(str) {
  let h = 0;
  for (let i = 0; i < (str || "").length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function uid() {
  return randomUUID().slice(0, 8);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. MomentDetector — find best moments in a video for reactions
// ═══════════════════════════════════════════════════════════════════════════════

export class MomentDetector {
  constructor({ scoring_criteria = null, min_moment_gap_sec = 2 } = {}) {
    this._criteria = scoring_criteria || deepClone(MOMENT_SCORING_CRITERIA);
    this._minGap = min_moment_gap_sec;
  }

  /**
   * Detect moments from transcript segments + optional metadata.
   * Returns scored moments sorted by engagement potential.
   */
  detect({ transcript = [], duration_sec = 60, metadata = {} }) {
    if (!Array.isArray(transcript) || transcript.length === 0) {
      return { ok: true, moments: [], total: 0, note: "No transcript to analyze." };
    }
    if (duration_sec <= 0) return { ok: false, error: "invalid_duration" };

    const windowSize = Math.max(3, Math.min(10, duration_sec / 10));
    const moments = [];
    let lastMomentTime = -Infinity;

    for (let t = 0; t < duration_sec; t += windowSize) {
      const window = transcript.filter(
        (seg) => seg.start_sec >= t && seg.start_sec < t + windowSize
      );
      if (window.length === 0) continue;

      const text = window.map((s) => s.text || "").join(" ").toLowerCase();
      const wordCount = text.split(/\s+/).filter(Boolean).length || 1;

      // Score each criterion
      const scores = {};
      let totalScore = 0;

      for (const [criterion, config] of Object.entries(this._criteria)) {
        const factorScores = config.factors.map((factor) =>
          this._scoreFactor(factor, text, wordCount, window, metadata)
        );
        const avg = factorScores.reduce((a, b) => a + b, 0) / factorScores.length;
        scores[criterion] = Math.round(avg * 100) / 100;
        totalScore += avg * config.weight;
      }

      totalScore = Math.round(totalScore * 100) / 100;

      // Only keep moments above threshold and respecting min gap
      if (totalScore > 0.3 && t - lastMomentTime >= this._minGap) {
        const dominantCategory = Object.entries(scores).sort((a, b) => b[1] - a[1])[0]?.[0] || "general";
        moments.push({
          start_sec: Math.round(t * 10) / 10,
          end_sec: Math.round((t + windowSize) * 10) / 10,
          score: totalScore,
          category: dominantCategory,
          scores,
          text_excerpt: text.slice(0, 120),
          reaction_potential: totalScore > 0.7 ? "high" : totalScore > 0.5 ? "medium" : "low",
        });
        lastMomentTime = t;
      }
    }

    moments.sort((a, b) => b.score - a.score);

    return {
      ok: true,
      moments,
      total: moments.length,
      duration_sec,
      window_size_sec: windowSize,
      model: "moment-detector-v1",
    };
  }

  _scoreFactor(factor, text, wordCount, window, metadata) {
    switch (factor) {
      case "visual_interest":
        return (text.match(/\b(bright|color|flash|neon|glow|sparkle|fire|light)\b/gi) || []).length > 0 ? 0.8 : 0.4;
      case "audio_energy":
        return wordCount > 8 ? 0.7 : wordCount > 4 ? 0.5 : 0.3;
      case "motion_level":
        return (text.match(/\b(run|jump|fly|fast|zoom|rush|sprint|dance)\b/gi) || []).length > 0 ? 0.8 : 0.4;
      case "text_overlay":
        return (text.match(/\b(title|text|caption|subtitle|overlay|label)\b/gi) || []).length > 0 ? 0.7 : 0.3;
      case "unexpected_timing":
        return (text.match(/\b(wait|whoa|what|omg|no way|surprise|unexpected)\b/gi) || []).length > 0 ? 0.9 : 0.3;
      case "facial_expression":
        return (text.match(/\b(laugh|smile|cry|shock|angry|face|expression)\b/gi) || []).length > 0 ? 0.8 : 0.3;
      case "punchline_delivery":
        return (text.match(/\b(joke|funny|hilarious|laugh|punchline|roast)\b/gi) || []).length > 0 ? 0.9 : 0.2;
      case "absurdity":
        return (text.match(/\b(crazy|insane|wild|unreal|impossible|absurd)\b/gi) || []).length > 0 ? 0.8 : 0.3;
      case "music_crescendo":
        return (text.match(/\b(music|beat|drop|bass|rhythm|melody|choir)\b/gi) || []).length > 0 ? 0.7 : 0.3;
      case "facial_emotion":
        return (text.match(/\b(happy|sad|angry|scared|surprised|love|hate)\b/gi) || []).length > 0 ? 0.8 : 0.3;
      case "dialogue_impact":
        return wordCount > 6 ? 0.7 : 0.4;
      case "visual_metaphor":
        return (text.match(/\b(like|as if|resembles|symbolize|metaphor)\b/gi) || []).length > 0 ? 0.7 : 0.3;
      case "clarity":
        return wordCount > 3 && wordCount < 15 ? 0.7 : 0.4;
      case "step_progression":
        return (text.match(/\b(first|then|next|finally|step|1st|2nd|3rd)\b/gi) || []).length > 0 ? 0.8 : 0.3;
      case "before_after":
        return (text.match(/\b(before|after|compare|transform|change|before and after)\b/gi) || []).length > 0 ? 0.9 : 0.2;
      case "demonstration":
        return (text.match(/\b(show|demonstrate|prove|example|watch|look)\b/gi) || []).length > 0 ? 0.7 : 0.3;
      case "meme_potential":
        return (text.match(/\b(meme|viral|share|trending|fyp|for you)\b/gi) || []).length > 0 ? 0.8 : 0.3;
      case "quote_worthy":
        return wordCount >= 4 && wordCount <= 12 ? 0.7 : 0.3;
      case "controversial":
        return (text.match(/\b(wrong|disagree|debate|hot take|unpopular)\b/gi) || []).length > 0 ? 0.8 : 0.2;
      case "relatable":
        return (text.match(/\b(everyone|always|never|you know|literally|same)\b/gi) || []).length > 0 ? 0.7 : 0.3;
      default:
        return 0.5;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. SplitScreenLayout — calculate positions for split-screen composition
// ═══════════════════════════════════════════════════════════════════════════════

export class SplitScreenLayout {
  constructor({ layout = "side_by_side", canvas_width = 1920, canvas_height = 1080 } = {}) {
    this._layoutKey = (REACTION_LAYOUTS[layout] ? layout : "side_by_side");
    this._layout = REACTION_LAYOUTS[this._layoutKey];
    this._canvasW = canvas_width;
    this._canvasH = canvas_height;
  }

  /** Calculate the position rects for original + reaction. */
  calculate() {
    const L = this._layout;
    const W = this._canvasW;
    const H = this._canvasH;
    const gap = L.gap_px;

    let original, reaction;

    switch (this._layoutKey) {
      case "side_by_side": {
        const halfW = Math.floor((W - gap) / 2);
        original = { x: 0, y: 0, width: halfW, height: H };
        reaction = { x: halfW + gap, y: 0, width: W - halfW - gap, height: H };
        break;
      }
      case "picture_in_picture": {
        const pipW = Math.floor(W * L.split_ratio);
        const pipH = Math.floor(H * L.split_ratio);
        original = { x: 0, y: 0, width: W, height: H };
        reaction = { x: W - pipW - gap, y: H - pipH - gap, width: pipW, height: pipH };
        break;
      }
      case "top_bottom": {
        const halfH = Math.floor((H - gap) / 2);
        original = { x: 0, y: 0, width: W, height: halfH };
        reaction = { x: 0, y: halfH + gap, width: W, height: H - halfH - gap };
        break;
      }
      case "reaction_focus": {
        const pipW = Math.floor(W * L.split_ratio);
        const pipH = Math.floor(H * L.split_ratio);
        original = { x: gap, y: gap, width: pipW, height: pipH };
        reaction = { x: 0, y: 0, width: W, height: H };
        break;
      }
      case "vertical_stack": {
        const halfH = Math.floor((H - gap) / 2);
        original = { x: 0, y: 0, width: W, height: halfH };
        reaction = { x: 0, y: halfH + gap, width: W, height: H - halfH - gap };
        break;
      }
      default: {
        const halfW = Math.floor((W - gap) / 2);
        original = { x: 0, y: 0, width: halfW, height: H };
        reaction = { x: halfW + gap, y: 0, width: W - halfW - gap, height: H };
      }
    }

    return {
      ok: true,
      layout: this._layoutKey,
      canvas: { width: W, height: H },
      original,
      reaction,
      labels: L.labels,
      gap_px: gap,
    };
  }

  /** Validate that layout fits within canvas. */
  validate() {
    const result = this.calculate();
    if (!result.ok) return result;

    const issues = [];
    if (result.original.width < 100 || result.original.height < 100) {
      issues.push({ severity: "error", message: "Original region too small for readable output." });
    }
    if (result.reaction.width < 100 || result.reaction.height < 100) {
      issues.push({ severity: "error", message: "Reaction region too small for readable output." });
    }
    if (result.original.x + result.original.width > this._canvasW) {
      issues.push({ severity: "error", message: "Original region overflows canvas width." });
    }
    if (result.reaction.y + result.reaction.height > this._canvasH) {
      issues.push({ severity: "error", message: "Reaction region overflows canvas height." });
    }

    return {
      ok: issues.filter((i) => i.severity === "error").length === 0,
      issues,
      layout: result,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. ReactionScript — generate persona-based reaction scripts
// ═══════════════════════════════════════════════════════════════════════════════

export class ReactionScript {
  constructor({ persona = "curious_viewer", length = "short" } = {}) {
    this._personaKey = persona;
    this._persona = REACTION_PERSONAS[persona] || REACTION_PERSONAS.curious_viewer;
    this._length = length;
  }

  /** Generate a reaction script for the given moments. */
  generate({ moments = [], duration_sec = 30 }) {
    if (!Array.isArray(moments) || moments.length === 0) {
      return { ok: false, error: "moments_required", message: "Provide at least 1 moment to react to." };
    }

    const targetLines = this._length === "long" ? 8 : this._length === "medium" ? 5 : 3;
    const p = this._persona;

    // Pick hooks from persona
    const hooks = [...p.default_hooks];
    const reactions = [...p.default_reactions];

    // Build script segments
    const segments = [];
    let currentTime = 0;

    // Opening hook
    segments.push({
      type: "hook",
      timestamp_sec: 0,
      text: hooks[0],
      emotion: p.tone,
    });
    currentTime = 1;

    // React to each moment
    const momentsToReact = moments.slice(0, targetLines);
    for (let i = 0; i < momentsToReact.length; i++) {
      const m = momentsToReact[i];
      const reactionText = reactions[i % reactions.length];
      segments.push({
        type: "reaction",
        timestamp_sec: Math.round(m.start_sec),
        text: reactionText,
        emotion: p.tone,
        moment_score: m.score,
        moment_category: m.category,
      });
      currentTime = m.end_sec + 1;
    }

    // Closing
    const closing = p.default_hooks[p.default_hooks.length - 1] || "That was interesting!";
    segments.push({
      type: "closing",
      timestamp_sec: Math.round(currentTime),
      text: closing,
      emotion: p.tone,
    });

    // Full text
    const fullText = segments.map((s) => s.text).join(" ");

    return {
      ok: true,
      persona: this._personaKey,
      persona_label: p.label,
      length: this._length,
      segments,
      full_text: fullText,
      total_segments: segments.length,
      estimated_duration_sec: Math.min(duration_sec, segments.length * 4),
      model: "reaction-script-v1",
    };
  }

  /** List available personas. */
  static listPersonas() {
    return Object.entries(REACTION_PERSONAS).map(([key, val]) => ({
      key,
      label: val.label,
      tone: val.tone,
      emoji: val.emoji,
    }));
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. ReactionComposer — plan the final reaction video composition
// ═══════════════════════════════════════════════════════════════════════════════

export class ReactionComposer {
  constructor({
    layout = "side_by_side",
    canvas_width = 1920,
    canvas_height = 1080,
    platform = "youtube",
  } = {}) {
    this._layoutKey = layout;
    this._canvasW = canvas_width;
    this._canvasH = canvas_height;
    this._platform = platform;
  }

  /**
   * Compose a reaction video plan from moments + script + layout.
   * Returns a recipe (array of tool calls) and metadata.
   */
  compose({ moments = [], script = null, reaction_video_path = null, original_video_path = null }) {
    if (!original_video_path) return { ok: false, error: "original_video_path_required" };
    if (!reaction_video_path) return { ok: false, error: "reaction_video_path_required" };

    // Layout
    const layoutCalc = new SplitScreenLayout({
      layout: this._layoutKey,
      canvas_width: this._canvasW,
      canvas_height: this._canvasH,
    });
    const layoutResult = layoutCalc.calculate();
    if (!layoutResult.ok) return { ok: false, error: "layout_calculation_failed" };

    // Platform spec
    const platformSpec = PLATFORM_SPECS[this._platform] || PLATFORM_SPECS.youtube;

    // Build recipe
    const recipe = [];

    // Step 1: Split-screen overlay
    recipe.push({
      tool: "compose_multi_clip",
      args: {
        mode: "pip",
        clips: [
          { file_path: original_video_path, position: layoutResult.original },
          { file_path: reaction_video_path, position: layoutResult.reaction },
        ],
        output_width: this._canvasW,
        output_height: this._canvasH,
      },
      description: `Split-screen layout: ${layoutResult.layout} (${this._canvasW}x${this._canvasH})`,
    });

    // Step 2: Add labels if the layout has them
    if (layoutResult.labels.original || layoutResult.labels.reaction) {
      if (layoutResult.labels.original) {
        recipe.push({
          tool: "add_text_overlay",
          args: {
            text: layoutResult.labels.original,
            position: "top_left",
            style: "label",
            region: layoutResult.original,
          },
          description: `Label: "${layoutResult.labels.original}" on original region`,
        });
      }
      if (layoutResult.labels.reaction) {
        recipe.push({
          tool: "add_text_overlay",
          args: {
            text: layoutResult.labels.reaction,
            position: "top_right",
            style: "label",
            region: layoutResult.reaction,
          },
          description: `Label: "${layoutResult.labels.reaction}" on reaction region`,
        });
      }
    }

    // Step 3: Script-based cuts (if script provided)
    if (script && script.segments) {
      for (const seg of script.segments) {
        if (seg.type === "reaction") {
          recipe.push({
            tool: "add_text_overlay",
            args: {
              text: seg.text,
              position: "bottom_center",
              style: "subtitle",
              start_sec: seg.timestamp_sec,
              duration_sec: 4,
            },
            description: `Reaction subtitle: "${seg.text.slice(0, 40)}..."`,
          });
        }
      }
    }

    // Step 4: Platform formatting
    if (this._platform !== "custom") {
      recipe.push({
        tool: "reframe_for_platform",
        args: {
          platform: this._platform,
          width: platformSpec.width,
          height: platformSpec.height,
        },
        description: `Reframe for ${platformSpec.label} (${platformSpec.aspect_ratio})`,
      });
    }

    // Step 5: Captions
    recipe.push({
      tool: "add_captions",
      args: { style: platformSpec.caption_style },
      description: `Add ${platformSpec.caption_style} captions`,
    });

    return {
      ok: true,
      platform: this._platform,
      layout: this._layoutKey,
      canvas: { width: this._canvasW, height: this._canvasH },
      recipe,
      total_steps: recipe.length,
      estimated_output: {
        width: platformSpec.width,
        height: platformSpec.height,
        aspect_ratio: platformSpec.aspect_ratio,
      },
      model: "reaction-composer-v1",
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. ReactionEngine — orchestrates the full reaction video pipeline
// ═══════════════════════════════════════════════════════════════════════════════

export class ReactionEngine {
  constructor({
    persona = "curious_viewer",
    layout = "side_by_side",
    platform = "youtube",
    canvas_width = 1920,
    canvas_height = 1080,
    length = "short",
  } = {}) {
    this._persona = persona;
    this._layout = layout;
    this._platform = platform;
    this._canvasW = canvas_width;
    this._canvasH = canvas_height;
    this._length = length;
    this._sessionId = uid();
  }

  /**
   * Full pipeline: detect moments → generate script → compose recipe.
   */
  async process({
    original_video_path,
    reaction_video_path,
    transcript = [],
    duration_sec = 60,
    metadata = {},
  }) {
    const startTime = Date.now();

    // Step 1: Detect best moments
    const detector = new MomentDetector();
    const detection = detector.detect({ transcript, duration_sec, metadata });
    if (!detection.ok) return { ok: false, error: "moment_detection_failed", details: detection };
    // If no moments found, return a valid result with empty script
    if (detection.moments.length === 0) {
      const scriptGen = new ReactionScript({ persona: this._persona, length: this._length });
      const script = scriptGen.generate({ moments: [{ start_sec: 0, end_sec: 3, score: 0.5, category: "general" }], duration_sec });
      const composer = new ReactionComposer({ layout: this._layout, canvas_width: this._canvasW, canvas_height: this._canvasH, platform: this._platform });
      const composition = composer.compose({ moments: [], script, reaction_video_path, original_video_path });
      const elapsed = Date.now() - startTime;
      return { ok: true, session_id: this._sessionId, persona: this._persona, layout: this._layout, platform: this._platform, moments: [], total_moments: 0, script, composition, timing: { total_ms: elapsed, stages: ["detect", "script", "compose"] }, model: "reaction-engine-v1" };
    }

    // Step 2: Generate reaction script
    const scriptGen = new ReactionScript({ persona: this._persona, length: this._length });
    const script = scriptGen.generate({ moments: detection.moments, duration_sec });
    if (!script.ok) return { ok: false, error: "script_generation_failed", details: script };

    // Step 3: Compose final video plan
    const composer = new ReactionComposer({
      layout: this._layout,
      canvas_width: this._canvasW,
      canvas_height: this._canvasH,
      platform: this._platform,
    });
    const composition = composer.compose({
      moments: detection.moments,
      script,
      reaction_video_path,
      original_video_path,
    });
    if (!composition.ok) return { ok: false, error: "composition_failed", details: composition };

    const elapsed = Date.now() - startTime;

    return {
      ok: true,
      session_id: this._sessionId,
      persona: this._persona,
      layout: this._layout,
      platform: this._platform,
      moments: detection.moments.slice(0, 5),
      total_moments: detection.total,
      script,
      composition,
      timing: { total_ms: elapsed, stages: ["detect", "script", "compose"] },
      model: "reaction-engine-v1",
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. VoiceParser — parse natural language into compilation spec
// ═══════════════════════════════════════════════════════════════════════════════

export class VoiceParser {
  constructor() {
    this._durationPatterns = [
      { regex: /(\d+)\s*(?:sec|seconds?)/i, unit: "sec" },
      { regex: /(\d+)\s*(?:min|minutes?)/i, unit: "min" },
      { regex: /(\d+)\s*s\b/i, unit: "sec" },
      { regex: /(\d+)\s*m\b/i, unit: "min" },
    ];
    this._moodPatterns = {
      funny: ["funny", "hilarious", "comedy", "laugh", "humor", "joke", "roast", "meme"],
      epic: ["epic", "amazing", "incredible", "best", "greatest", "top", "fire"],
      chill: ["chill", "relaxing", "calm", "peaceful", "mellow", "smooth"],
      dramatic: ["dramatic", "intense", "suspense", "tension", "thriller"],
      educational: ["educational", "tutorial", "learn", "teach", "explain", "how to"],
      sad: ["sad", "emotional", "touching", "heartfelt", "memorial"],
      motivational: ["motivational", "inspiring", "uplifting", "powerful", "hustle"],
    };
    this._platformHints = {
      tiktok: ["tiktok", "tik tok", "fyp", "for you"],
      youtube_short: ["youtube short", "shorts", "yt short"],
      youtube: ["youtube", "long form", "full video"],
      instagram: ["instagram", "reel", "reels", "ig"],
      twitter: ["twitter", "tweet", "x post", "x.com"],
    };
  }

  /**
   * Parse a voice prompt into a structured compilation spec.
   */
  parse(prompt) {
    if (!prompt || typeof prompt !== "string") {
      return { ok: false, error: "prompt_required" };
    }

    const lower = prompt.toLowerCase().trim();

    // Extract duration
    let max_duration_sec = 30; // default
    for (const pat of this._durationPatterns) {
      const match = lower.match(pat.regex);
      if (match) {
        const val = parseInt(match[1], 10);
        max_duration_sec = pat.unit === "min" ? val * 60 : val;
        break;
      }
    }
    max_duration_sec = clamp(max_duration_sec, 5, 600);

    // Extract mood/theme
    let mood = "general";
    for (const [moodKey, keywords] of Object.entries(this._moodPatterns)) {
      if (keywords.some((kw) => lower.includes(kw))) {
        mood = moodKey;
        break;
      }
    }

    // Extract platform
    let platform = "tiktok"; // default
    for (const [platKey, hints] of Object.entries(this._platformHints)) {
      if (hints.some((h) => lower.includes(h))) {
        platform = platKey;
        break;
      }
    }

    // Extract count hint (e.g., "top 5 moments")
    let max_clips = null;
    const countMatch = lower.match(/(?:top|best|first|last|select)\s*(\d+)/);
    if (countMatch) {
      max_clips = parseInt(countMatch[1], 10);
      max_clips = clamp(max_clips, 2, 20);
    }

    // Detect "from" references (e.g., "from my last 5 videos")
    let source_count = null;
    const sourceMatch = lower.match(/(?:from|of)\s*(?:my\s*)?(?:last|recent|past)\s*(\d+)\s*(?:video|clip)s?/);
    if (sourceMatch) {
      source_count = parseInt(sourceMatch[1], 10);
      source_count = clamp(source_count, 1, 50);
    }

    // Detect compilation type
    let compilation_type = "highlight";
    if (lower.match(/\b(teaser|trailer|preview)\b/)) compilation_type = "teaser";
    else if (lower.match(/\b(best of|top|greatest|highlights?)\b/)) compilation_type = "highlight";
    else if (lower.match(/\b(blooper|outtake|fail|fails)\b/)) compilation_type = "bloopers";
    else if (lower.match(/\b(montage|compilation|supercut)\b/)) compilation_type = "montage";
    else if (lower.match(/\b(summary|recap|review)\b/)) compilation_type = "summary";
    else if (lower.match(/\b(tutorial|how.?to|guide)\b/)) compilation_type = "tutorial";

    return {
      ok: true,
      prompt,
      max_duration_sec,
      mood,
      platform,
      max_clips,
      source_count,
      compilation_type,
      confidence: 0.6 + (max_clips ? 0.1 : 0) + (source_count ? 0.1 : 0),
      model: "voice-parser-v1",
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 7. MomentRanker — score and rank moments across multiple videos
// ═══════════════════════════════════════════════════════════════════════════════

export class MomentRanker {
  constructor({ criteria = null } = {}) {
    this._criteria = criteria || deepClone(MOMENT_SCORING_CRITERIA);
    this._detector = new MomentDetector({ scoring_criteria: this._criteria });
  }

  /**
   * Rank moments from multiple videos.
   * Input: array of { video_id, transcript, duration_sec, metadata }
   * Output: ranked moments with video provenance.
   */
  rank({ videos = [], max_moments = 10, mood = "general", compilation_type = "highlight" }) {
    if (!Array.isArray(videos) || videos.length === 0) {
      return { ok: false, error: "videos_required" };
    }
    max_moments = clamp(max_moments, 1, 50);

    const allMoments = [];
    for (const video of videos) {
      if (!video.video_id) continue;
      const detection = this._detector.detect({
        transcript: video.transcript || [],
        duration_sec: video.duration_sec || 60,
        metadata: video.metadata || {},
      });
      if (!detection.ok || detection.moments.length === 0) continue;

      for (const moment of detection.moments) {
        allMoments.push({
          ...moment,
          video_id: video.video_id,
          video_title: video.title || video.video_id,
          video_duration_sec: video.duration_sec || 60,
        });
      }
    }

    // Boost scores based on mood alignment
    if (mood !== "general") {
      for (const m of allMoments) {
        if (m.category === mood || m.scores?.[mood] > 0.5) {
          m.score = Math.min(1, m.score * 1.3);
          m.mood_boost = true;
        }
      }
    }

    // Boost compilation-type relevant moments
    if (compilation_type === "bloopers") {
      for (const m of allMoments) {
        if (m.category === "humor") m.score = Math.min(1, m.score * 1.2);
      }
    } else if (compilation_type === "tutorial") {
      for (const m of allMoments) {
        if (m.category === "educational") m.score = Math.min(1, m.score * 1.2);
      }
    }

    // Sort and deduplicate (no two moments from same video within 5s)
    allMoments.sort((a, b) => b.score - a.score);
    const selected = [];
    const usedVideoWindows = new Map(); // video_id → Set of occupied time windows

    for (const m of allMoments) {
      if (selected.length >= max_moments) break;
      const vidWindows = usedVideoWindows.get(m.video_id) || new Set();
      const timeKey = Math.floor(m.start_sec / 5);
      if (vidWindows.has(timeKey)) continue; // too close to another selected moment from same video
      vidWindows.add(timeKey);
      usedVideoWindows.set(m.video_id, vidWindows);
      selected.push(m);
    }

    return {
      ok: true,
      total_candidates: allMoments.length,
      selected: selected.length,
      moments: selected,
      videos_analyzed: videos.length,
      mood,
      compilation_type,
      model: "moment-ranker-v1",
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 8. CompilationPlanner — plan cuts, transitions, and flow
// ═══════════════════════════════════════════════════════════════════════════════

export class CompilationPlanner {
  constructor({ platform = "tiktok" } = {}) {
    this._platform = platform;
    this._spec = PLATFORM_SPECS[platform] || PLATFORM_SPECS.tiktok;
  }

  /**
   * Plan the compilation: assign time budgets, pick transitions, order clips.
   */
  plan({ moments = [], max_duration_sec = 30, mood = "general" }) {
    if (!Array.isArray(moments) || moments.length === 0) {
      return { ok: false, error: "moments_required" };
    }

    max_duration_sec = clamp(max_duration_sec, 5, this._spec.max_duration_sec);
    const numClips = Math.min(moments.length, this._spec.max_clips);
    const selectedMoments = moments.slice(0, numClips);

    // Time budget per clip (equal distribution)
    const transitionDuration = 0.3; // 300ms transitions
    const totalTransitionTime = transitionDuration * (numClips - 1);
    const clipDuration = (max_duration_sec - totalTransitionTime) / numClips;

    // Pick transitions based on mood
    const availableTransitions = this._spec.transitions;
    const transitionMap = {
      funny: "cut",
      epic: "whip",
      chill: "fade",
      dramatic: "crossfade",
      educational: "cut",
      sad: "fade",
      motivational: "whip",
      general: "cut",
    };
    const primaryTransition = transitionMap[mood] || "cut";

    // Build timeline
    const timeline = [];
    let currentTime = 0;

    for (let i = 0; i < selectedMoments.length; i++) {
      const m = selectedMoments[i];
      const clipStart = currentTime;
      const clipEnd = currentTime + clipDuration;

      timeline.push({
        index: i,
        video_id: m.video_id,
        moment_start_sec: m.start_sec,
        moment_end_sec: m.end_sec,
        clip_start_sec: Math.round(clipStart * 10) / 10,
        clip_end_sec: Math.round(clipEnd * 10) / 10,
        clip_duration_sec: Math.round(clipDuration * 10) / 10,
        score: m.score,
        category: m.category,
        transition: i < selectedMoments.length - 1 ? primaryTransition : null,
        transition_duration_sec: i < selectedMoments.length - 1 ? transitionDuration : 0,
        text_excerpt: m.text_excerpt,
      });

      currentTime = clipEnd + (i < selectedMoments.length - 1 ? transitionDuration : 0);
    }

    return {
      ok: true,
      platform: this._platform,
      total_clips: numClips,
      total_duration_sec: Math.round(currentTime * 10) / 10,
      max_duration_sec,
      primary_transition: primaryTransition,
      available_transitions: availableTransitions,
      timeline,
      model: "compilation-planner-v1",
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 9. PlatformAdapter — adapt compilation for different platforms
// ═══════════════════════════════════════════════════════════════════════════════

export class PlatformAdapter {
  constructor() {}

  /**
   * Adapt a compilation plan to a specific platform's constraints.
   */
  adapt({ plan, target_platform }) {
    if (!plan || !plan.ok) return { ok: false, error: "valid_plan_required" };
    if (!target_platform) return { ok: false, error: "target_platform_required" };

    const spec = PLATFORM_SPECS[target_platform];
    if (!spec) return { ok: false, error: "unknown_platform", valid: Object.keys(PLATFORM_SPECS) };

    const adapted = deepClone(plan);
    adapted.platform = target_platform;
    adapted.platform_spec = spec;

    // Adjust duration if over limit
    if (adapted.total_duration_sec > spec.max_duration_sec) {
      const ratio = spec.max_duration_sec / adapted.total_duration_sec;
      adapted.total_duration_sec = spec.max_duration_sec;
      for (const clip of adapted.timeline) {
        clip.clip_duration_sec = Math.round(clip.clip_duration_sec * ratio * 10) / 10;
        clip.clip_end_sec = clip.clip_start_sec + clip.clip_duration_sec;
      }
    }

    // Adjust clip count if over limit
    if (adapted.timeline.length > spec.max_clips) {
      adapted.timeline = adapted.timeline.slice(0, spec.max_clips);
      adapted.total_clips = spec.max_clips;
      // Re-distribute time
      const newClipDuration = adapted.total_duration_sec / spec.max_clips;
      let t = 0;
      for (const clip of adapted.timeline) {
        clip.clip_start_sec = Math.round(t * 10) / 10;
        clip.clip_duration_sec = Math.round(newClipDuration * 10) / 10;
        clip.clip_end_sec = Math.round((t + newClipDuration) * 10) / 10;
        t += newClipDuration + (clip.transition ? 0.3 : 0);
      }
    }

    // Add platform-specific recipe steps
    adapted.platform_recipe = [
      {
        tool: "reframe_for_platform",
        args: { platform: target_platform, width: spec.width, height: spec.height },
        description: `Reframe for ${spec.label} (${spec.aspect_ratio})`,
      },
      {
        tool: "add_captions",
        args: { style: spec.caption_style },
        description: `Add ${spec.caption_style} captions`,
      },
    ];

    return {
      ok: true,
      original_platform: plan.platform,
      target_platform,
      adapted,
      model: "platform-adapter-v1",
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 10. CompilationBuilder — build the final compilation recipe
// ═══════════════════════════════════════════════════════════════════════════════

export class CompilationBuilder {
  constructor({ platform = "tiktok" } = {}) {
    this._platform = platform;
    this._spec = PLATFORM_SPECS[platform] || PLATFORM_SPECS.tiktok;
  }

  /**
   * Build a full recipe (array of tool calls) from a compilation plan.
   */
  build({ plan, source_videos = [] }) {
    if (!plan || !plan.ok) return { ok: false, error: "valid_plan_required" };

    const recipe = [];
    const videoMap = {};
    for (const v of source_videos) {
      if (v.video_id) videoMap[v.video_id] = v;
    }

    // Step 1: Cut each clip from its source video
    for (const clip of plan.timeline) {
      const source = videoMap[clip.video_id];
      const filePath = source?.file_path || clip.video_id;
      recipe.push({
        tool: "cut_clips",
        args: {
          file_path: filePath,
          ranges: [[clip.moment_start_sec, clip.moment_end_sec]],
          mode: "keep",
        },
        description: `Cut moment from ${clip.video_id} (${clip.moment_start_sec}s-${clip.moment_end_sec}s)`,
        metadata: { score: clip.score, category: clip.category },
      });
    }

    // Step 2: Concatenate with transitions
    recipe.push({
      tool: "compose_multi_clip",
      args: {
        mode: "sequential",
        transitions: plan.timeline
          .filter((c) => c.transition)
          .map((c) => ({
            type: c.transition,
            duration_sec: c.transition_duration_sec,
          })),
      },
      description: `Concatenate ${plan.total_clips} clips with ${plan.primary_transition} transitions`,
    });

    // Step 3: Platform-specific formatting
    const spec = this._spec;
    recipe.push({
      tool: "reframe_for_platform",
      args: {
        platform: this._platform,
        width: spec.width,
        height: spec.height,
      },
      description: `Reframe for ${spec.label} (${spec.aspect_ratio})`,
    });

    // Step 4: Add captions
    recipe.push({
      tool: "add_captions",
      args: { style: spec.caption_style },
      description: `Add ${spec.caption_style} captions`,
    });

    // Step 5: Color grade
    recipe.push({
      tool: "apply_color_grade",
      args: { preset: "vibrant" },
      description: "Apply vibrant color grade",
    });

    return {
      ok: true,
      platform: this._platform,
      recipe,
      total_steps: recipe.length,
      total_clips: plan.total_clips,
      total_duration_sec: plan.total_duration_sec,
      model: "compilation-builder-v1",
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 11. VoiceCompiler — orchestrates the full compilation-from-voice pipeline
// ═══════════════════════════════════════════════════════════════════════════════

export class VoiceCompiler {
  constructor({ platform = "tiktok" } = {}) {
    this._platform = platform;
    this._sessionId = uid();
  }

  /**
   * Full pipeline: parse voice → rank moments → plan → build recipe.
   */
  async compile({
    voice_prompt,
    videos = [],
    max_duration_sec = null,
    platform = null,
  }) {
    const startTime = Date.now();
    const targetPlatform = platform || this._platform;

    // Step 1: Parse voice prompt
    const parser = new VoiceParser();
    const parsed = parser.parse(voice_prompt);
    if (!parsed.ok) return { ok: false, error: "voice_parse_failed", details: parsed };

    const duration = max_duration_sec || parsed.max_duration_sec;

    // Step 2: Rank moments across videos
    const ranker = new MomentRanker();
    const ranked = ranker.rank({
      videos,
      max_moments: parsed.max_clips || 10,
      mood: parsed.mood,
      compilation_type: parsed.compilation_type,
    });
    if (!ranked.ok) return { ok: false, error: "moment_ranking_failed", details: ranked };

    // Step 3: Plan compilation
    const planner = new CompilationPlanner({ platform: targetPlatform });
    const plan = planner.plan({
      moments: ranked.moments,
      max_duration_sec: duration,
      mood: parsed.mood,
    });
    if (!plan.ok) return { ok: false, error: "planning_failed", details: plan };

    // Step 4: Adapt for platform if needed
    const adapter = new PlatformAdapter();
    let finalPlan = plan;
    if (targetPlatform !== this._platform) {
      const adapted = adapter.adapt({ plan, target_platform: targetPlatform });
      if (adapted.ok) finalPlan = adapted.adapted;
    }

    // Step 5: Build recipe
    const builder = new CompilationBuilder({ platform: targetPlatform });
    const recipe = builder.build({ plan: finalPlan, source_videos: videos });
    if (!recipe.ok) return { ok: false, error: "recipe_build_failed", details: recipe };

    const elapsed = Date.now() - startTime;

    return {
      ok: true,
      session_id: this._sessionId,
      voice_prompt,
      parsed,
      moments_found: ranked.total_candidates,
      moments_selected: ranked.selected,
      plan: finalPlan,
      recipe,
      timing: { total_ms: elapsed, stages: ["parse", "rank", "plan", "adapt", "build"] },
      model: "voice-compiler-v1",
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Exports summary
// ═══════════════════════════════════════════════════════════════════════════════

export const MULTI_MODAL_OUTPUT_CLASSES = [
  "ReactionEngine",
  "SplitScreenLayout",
  "MomentDetector",
  "ReactionScript",
  "ReactionComposer",
  "VoiceCompiler",
  "VoiceParser",
  "MomentRanker",
  "CompilationPlanner",
  "PlatformAdapter",
  "CompilationBuilder",
];
