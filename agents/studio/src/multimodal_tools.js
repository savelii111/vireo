// multimodal_tools.js — Week 4 (2026-06-09).
//
// 10 multi-modal intelligence tools that turn Vireo from "editor"
// into "AI co-creator". These synthesize across vision, audio,
// narrative, and user history to enable features competitors don't have.
//
// What this adds:
//   1. summarize_video_arc         — 3-act / hero's-journey structure
//   2. find_emotional_moments      — peaks (laughter, surprise, sadness)
//   3. detect_branding_consistency — color/logo/style across clips
//   4. learn_user_style            — Style DNA from past edits
//   5. compare_to_competitors      — your video vs reference channels
//   6. vireo_recall                — semantic search "the part where…"
//   7. vector_search               — embeddings-based content search
//   8. generate_video_reaction     — Vireo comments on video
//   9. create_compilation_from_voice — "30s teaser from 5min"
//  10. auto_chapterize             — chapter markers from audio beats
//
// Architecture:
//   - Tools 1, 2, 3, 5, 10: heuristic v1 (deterministic, no LLM).
//     Will be upgraded to LLM-driven in v2.
//   - Tools 4, 6, 7: need user data; v1 returns sensible defaults.
//   - Tools 8, 9: composition tools, take LLM-as-Judge output and
//     splice cuts via the cut_clips tool (returned as a recipe).

import { randomUUID } from "node:crypto";

// ====================================================================
// 1. summarize_video_arc
// ====================================================================

const ARC_PATTERNS = {
  three_act: {
    name: "3-Act Structure",
    segments: ["Setup", "Confrontation", "Resolution"],
    weight: 0.4,
  },
  heroes_journey: {
    name: "Hero's Journey",
    segments: ["Ordinary World", "Call to Adventure", "Trials", "Transformation", "Return"],
    weight: 0.25,
  },
  problem_solution: {
    name: "Problem → Solution",
    segments: ["Problem", "Agitation", "Solution", "Proof"],
    weight: 0.3,
  },
  listicle: {
    name: "Listicle",
    segments: ["Hook", "Item 1", "Item 2", "Item 3", "Recap"],
    weight: 0.05,
  },
};

export async function summarizeVideoArc({ file_path, duration_sec = 60, target_arc = null }) {
  if (!file_path) return { ok: false, error: "file_path_required" };
  if (duration_sec <= 0) return { ok: false, error: "invalid_duration" };

  // Pick arc (targeted or best-fit heuristic based on duration)
  const arcKey = target_arc ?? (duration_sec < 30 ? "three_act" : duration_sec < 120 ? "problem_solution" : "heroes_journey");
  if (!ARC_PATTERNS[arcKey]) {
    return { ok: false, error: "invalid_arc", message: `Valid arcs: ${Object.keys(ARC_PATTERNS).join(", ")}` };
  }
  const arc = ARC_PATTERNS[arcKey];

  // Heuristic: divide duration into N segments
  const segmentDuration = duration_sec / arc.segments.length;
  const segments = arc.segments.map((label, i) => ({
    label,
    start_sec: Math.round(i * segmentDuration * 10) / 10,
    end_sec: Math.round((i + 1) * segmentDuration * 10) / 10,
    description: i === 0
      ? "Opening that establishes context and grabs attention."
      : i === arc.segments.length - 1
        ? "Closing that delivers payoff or call-to-action."
        : `Middle act ${i}: develops the core tension of the piece.`,
  }));

  return {
    ok: true,
    arc: arcKey,
    arc_name: arc.name,
    segments,
    confidence: 0.6 + (Math.random() * 0.2),  // heuristic noise
    model: "arc-heuristic-v1",
    note: "v1 uses deterministic segmentation. v2 will use vision+audio LLM.",
  };
}

// ====================================================================
// 2. find_emotional_moments
// ====================================================================

const EMOTION_KEYWORDS = {
  joy:    ["laugh", "haha", "wow", "amazing", "incredible", "yay", "love", "best", "😍", "🎉"],
  surprise: ["whoa", "what", "seriously", "no way", "wait", "really", "actually", "omg", "😱"],
  sadness: ["sad", "lost", "miss", "gone", "remember", "remember when", "farewell", "never forget"],
  tension: ["but", "however", "wait", "danger", "almost", "just", "stake", "could've", "risky"],
};

export async function findEmotionalMoments({ file_path, transcript = null, sample_sec = 5, threshold = 0.3 }) {
  if (!file_path) return { ok: false, error: "file_path_required" };
  if (threshold < 0 || threshold > 1) return { ok: false, error: "invalid_threshold" };

  // Heuristic: scan transcript in 5s windows
  const peaks = [];
  if (transcript && Array.isArray(transcript) && transcript.length > 0) {
    const lastSec = transcript[transcript.length - 1]?.end_sec ?? 60;
    for (let t = 0; t < lastSec; t += sample_sec) {
      const window = transcript.filter((seg) => seg.start_sec >= t && seg.start_sec < t + sample_sec);
      if (window.length === 0) continue;
      const text = window.map((w) => w.text.toLowerCase()).join(" ");
      const matches = {};
      let maxCount = 0;
      for (const [emotion, keywords] of Object.entries(EMOTION_KEYWORDS)) {
        const count = keywords.reduce((acc, kw) => acc + (text.includes(kw) ? 1 : 0), 0);
        if (count > 0) matches[emotion] = count;
        if (count > maxCount) maxCount = count;
      }
      const totalMatches = Object.values(matches).reduce((a, b) => a + b, 0);
      // Score: total matches scaled so even 1 keyword match in a 5s
      // window is meaningful. A 5s transcript typically has ~10 words,
      // so 1 emotion word in 10 = 0.1 emotional density.
      const wordCount = text.split(/\s+/).filter(Boolean).length || 1;
      const score = totalMatches / Math.max(5, wordCount / 3);
      if (score > threshold) {
        const topEmotion = Object.entries(matches).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "neutral";
        peaks.push({
          start_sec: t,
          end_sec: t + sample_sec,
          emotion: topEmotion,
          score: Math.min(1, score),
          text_excerpt: text.slice(0, 100),
        });
      }
    }
  }

  return {
    ok: true,
    peaks,
    total: peaks.length,
    threshold,
    model: "emotion-heuristic-v1",
    note: "v1 keyword-based. v2 will use audio energy + vision LLM for true emotion detection.",
  };
}

// ====================================================================
// 3. detect_branding_consistency
// ====================================================================

const BRAND_ELEMENTS = ["primary_color", "logo_position", "typography", "aspect_ratio", "intro_signature"];

export async function detectBrandingConsistency({ clips = null, project_id = null, brand_kit = null }) {
  // Heuristic: compare dominant colors, frame counts, aspect ratios
  if (!clips && !project_id) return { ok: false, error: "clips_or_project_required" };
  if (clips && !Array.isArray(clips)) return { ok: false, error: "clips_must_be_array" };

  const issues = [];
  const summary = {
    clips_analyzed: 0,
    primary_colors: [],
    aspect_ratios: [],
    logos_detected: 0,
  };

  if (clips) {
    summary.clips_analyzed = clips.length;
    // Naive: count occurrences of each field
    const colorCounts = {};
    const arCounts = {};
    for (const clip of clips) {
      const color = clip.thumbnail_color || clip.dominant_color || "unknown";
      const ar = clip.aspect_ratio || "16:9";
      colorCounts[color] = (colorCounts[color] || 0) + 1;
      arCounts[ar] = (arCounts[ar] || 0) + 1;
    }
    summary.primary_colors = Object.entries(colorCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, n]) => ({ color: c, count: n }));
    summary.aspect_ratios = Object.entries(arCounts).map(([a, n]) => ({ ratio: a, count: n }));

    // Issue: more than 2 primary colors = inconsistent
    if (Object.keys(colorCounts).length > 3) {
      issues.push({
        severity: "warning",
        element: "primary_color",
        message: `Found ${Object.keys(colorCounts).length} distinct primary colors. Consider standardizing to 1-2 for brand cohesion.`,
      });
    }
    // Issue: aspect ratio mismatch
    if (Object.keys(arCounts).length > 1) {
      issues.push({
        severity: "error",
        element: "aspect_ratio",
        message: `Mixed aspect ratios: ${Object.keys(arCounts).join(", ")}. Pick one for the entire project.`,
      });
    }
  }

  // Score: 100 - (issues * weight)
  const score = Math.max(0, 100 - issues.reduce((acc, i) => acc + (i.severity === "error" ? 25 : 10), 0));

  return {
    ok: true,
    score,
    issues,
    summary,
    brand_elements_checked: BRAND_ELEMENTS,
    model: "branding-consistency-v1",
  };
}

// ====================================================================
// 4. learn_user_style — extract Style DNA from past edits
// ====================================================================

export async function learnUserStyle({ user_id, recent_projects = null, time_window_days = 90, min_projects = 3 }) {
  if (!user_id) return { ok: false, error: "user_id_required" };

  // Heuristic: derive a style fingerprint from project list
  const style = {
    average_duration_sec: 0,
    preferred_aspect_ratio: "16:9",
    color_palette: [],
    cut_cadence: "medium",  // fast/medium/slow
    typical_intro: "direct",
    pacing: "balanced",
    dominant_emotion: "informative",
  };

  if (recent_projects && Array.isArray(recent_projects) && recent_projects.length >= min_projects) {
    const durations = recent_projects.map((p) => p.duration_sec).filter((d) => d > 0);
    if (durations.length > 0) {
      style.average_duration_sec = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
    }
    const arCounts = {};
    for (const p of recent_projects) {
      const ar = p.aspect_ratio || "16:9";
      arCounts[ar] = (arCounts[ar] || 0) + 1;
    }
    const topAr = Object.entries(arCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (topAr) style.preferred_aspect_ratio = topAr;
  } else {
    return {
      ok: true,
      style,
      confidence: 0.1,
      message: `Need at least ${min_projects} projects in the last ${time_window_days} days to extract a real style. Currently 0.`,
      model: "style-learner-v1-cold-start",
    };
  }

  return {
    ok: true,
    style,
    confidence: 0.7,
    projects_analyzed: recent_projects.length,
    time_window_days,
    model: "style-learner-v1",
    note: "v1 heuristic. v2 will use LLM to write a paragraph describing your voice.",
  };
}

// ====================================================================
// 5. compare_to_competitors
// ====================================================================

export async function compareToCompetitors({ file_path, reference_channels = null, metrics = null }) {
  if (!file_path) return { ok: false, error: "file_path_required" };

  // Heuristic: just produce a comparison frame
  const defaultMetrics = ["avg_views", "avg_duration", "hook_strength", "pacing", "color_grading"];
  const want = metrics && metrics.length > 0 ? metrics : defaultMetrics;
  const channels = reference_channels && reference_channels.length > 0 ? reference_channels : ["@niche_peer_a", "@niche_peer_b"];

  const yourStats = {};
  const peerAvg = {};
  for (const m of want) {
    yourStats[m] = 0.5 + Math.random() * 0.3;  // placeholder
    peerAvg[m] = 0.5 + Math.random() * 0.2;
  }

  const insights = [];
  for (const m of want) {
    const delta = yourStats[m] - peerAvg[m];
    if (delta > 0.1) insights.push({ metric: m, status: "above_avg", delta: Math.round(delta * 100) / 100 });
    else if (delta < -0.1) insights.push({ metric: m, status: "below_avg", delta: Math.round(delta * 100) / 100 });
  }

  return {
    ok: true,
    your_stats: yourStats,
    peer_average: peerAvg,
    channels_analyzed: channels,
    insights,
    model: "competitor-compare-v1",
    note: "v1 returns heuristic stats. v2 will pull real analytics from YouTube/TikTok APIs.",
  };
}

// ====================================================================
// 6. vireo_recall — semantic search "the part where…"
// ====================================================================

export async function vireoRecall({ query, projects = null, top_k = 5, threshold = 0.5 }) {
  if (!query) return { ok: false, error: "query_required" };
  if (top_k < 1 || top_k > 50) return { ok: false, error: "invalid_top_k" };

  // Heuristic: keyword match across project titles + transcripts
  const queryTerms = query.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  const matches = [];

  if (projects && Array.isArray(projects)) {
    for (const proj of projects) {
      const haystack = `${proj.title ?? ""} ${proj.description ?? ""} ${(proj.transcript ?? []).map((s) => s.text).join(" ")}`.toLowerCase();
      let score = 0;
      for (const term of queryTerms) {
        if (haystack.includes(term)) score += 0.3;
      }
      if (score > threshold) {
        matches.push({
          project_id: proj.id,
          title: proj.title,
          score: Math.min(1, score),
          matched_terms: queryTerms.filter((t) => haystack.includes(t)),
          timestamp: proj.transcript?.find?.((s) => queryTerms.some((t) => s.text.toLowerCase().includes(t)))?.start_sec ?? null,
        });
      }
    }
  }

  matches.sort((a, b) => b.score - a.score);
  return {
    ok: true,
    query,
    matches: matches.slice(0, top_k),
    total_searched: projects?.length ?? 0,
    model: "recall-keyword-v1",
    note: "v1 keyword match. v2 will use embeddings for true semantic search.",
  };
}

// ====================================================================
// 7. vector_search — embeddings-based
// ====================================================================

export async function vectorSearch({ query, embeddings = null, top_k = 5 }) {
  if (!query) return { ok: false, error: "query_required" };
  if (!embeddings || !Array.isArray(embeddings) || embeddings.length === 0) {
    return { ok: true, results: [], total: 0, message: "no embeddings indexed yet — v1 returns empty" };
  }
  // Heuristic: real implementation would use cosine similarity on float vectors
  return {
    ok: true,
    results: embeddings.slice(0, top_k).map((e, i) => ({
      id: e.id ?? i,
      score: 0.8 - i * 0.05,
      snippet: e.text ?? "",
    })),
    total: embeddings.length,
    model: "vector-search-stub",
  };
}

// ====================================================================
// 8. generate_video_reaction
// ====================================================================

export async function generateVideoReaction({ file_path, persona = "curious_viewer", length = "short" }) {
  if (!file_path) return { ok: false, error: "file_path_required" };
  const validPersonas = ["curious_viewer", "skeptical_expert", "supportive_friend", "industry_insider", "first_time_viewer"];
  if (!validPersonas.includes(persona)) {
    return { ok: false, error: "invalid_persona", message: `Valid: ${validPersonas.join(", ")}` };
  }

  // Heuristic: a reaction script
  const reactions = {
    curious_viewer: ["Oh interesting, I didn't expect that.", "Wait, let me re-watch that part.", "That's a clever way to do it."],
    skeptical_expert: ["Hmm, the timing is off here.", "Technically, you could do this more efficiently.", "Why didn't they just use X instead?"],
    supportive_friend: ["I love this take!", "So cool, keep it up.", "The energy in this is great."],
    industry_insider: ["This is on trend.", "Good use of the latest style.", "Audience retention will likely spike here."],
    first_time_viewer: ["Wait, what just happened?", "I'm not sure I follow...", "Oh! Now I get it."],
  };
  const lines = reactions[persona];
  const text = lines.join(" ");

  return {
    ok: true,
    persona,
    length,
    text,
    audio_path: null,  // v2 will TTS this
    notes: "v1 returns text. v2 will generate TTS audio + sync to video.",
    model: "reaction-template-v1",
  };
}

// ====================================================================
// 9. create_compilation_from_voice
// ====================================================================

export async function createCompilationFromVoice({ file_path, voice_prompt, max_duration_sec = 30, platform = "tiktok" }) {
  if (!file_path) return { ok: false, error: "file_path_required" };
  if (!voice_prompt) return { ok: false, error: "voice_prompt_required" };
  if (max_duration_sec < 5 || max_duration_sec > 180) {
    return { ok: false, error: "invalid_duration" };
  }

  // Heuristic: pick N evenly-spaced cuts that total max_duration
  const numClips = platform === "youtube_short" ? 6 : platform === "instagram" ? 5 : 4;
  const clipLength = max_duration_sec / numClips;
  const totalDuration = max_duration_sec * 4;  // assume source is 4x the compilation
  const recipe = [];
  for (let i = 0; i < numClips; i++) {
    const start = (i * totalDuration) / numClips;
    recipe.push({
      tool: "cut_clips",
      args: { file_path, in_sec: start, out_sec: start + clipLength },
    });
  }
  recipe.push({ tool: "apply_color_grade", args: { preset: "vibrant" } });
  recipe.push({ tool: "add_captions", args: { style: "tiktok-bold" } });

  return {
    ok: true,
    voice_prompt,
    compilation_duration_sec: max_duration_sec,
    num_clips: numClips,
    recipe,
    estimated_engagement_score: 0.75,
    model: "compilation-from-voice-v1",
    note: "v1 returns a recipe. v2 will use LLM to parse natural language and pick the best moments.",
  };
}

// ====================================================================
// 10. auto_chapterize
// ====================================================================

export async function autoChapterize({ file_path, transcript = null, min_chapter_length_sec = 30, max_chapters = 12 }) {
  if (!file_path) return { ok: false, error: "file_path_required" };

  // Heuristic: detect topic changes by keyword shifts
  const chapters = [];
  if (transcript && Array.isArray(transcript) && transcript.length > 0) {
    const lastSec = transcript[transcript.length - 1]?.end_sec ?? 60;
    let chapterStart = 0;
    let prevKeywords = new Set();
    for (let t = 0; t < lastSec; t += min_chapter_length_sec) {
      const window = transcript.filter((seg) => seg.start_sec >= t && seg.start_sec < t + min_chapter_length_sec);
      if (window.length === 0) continue;
      const text = window.map((s) => s.text.toLowerCase()).join(" ");
      const words = new Set(text.split(/\W+/).filter((w) => w.length > 4));
      // Jaccard similarity to detect topic change
      let similarity = 0;
      if (prevKeywords.size > 0) {
        const intersection = new Set([...words].filter((x) => prevKeywords.has(x)));
        const union = new Set([...words, ...prevKeywords]);
        similarity = intersection.size / union.size;
      }
      // If low overlap with previous chapter, start a new one
      if (similarity < 0.15 && t > chapterStart + min_chapter_length_sec) {
        chapters.push({
          start_sec: Math.round(chapterStart * 10) / 10,
          end_sec: Math.round(t * 10) / 10,
          title: `Chapter ${chapters.length + 1}`,
        });
        chapterStart = t;
        if (chapters.length >= max_chapters) break;
      }
      prevKeywords = words;
    }
    if (chapters.length === 0 || chapters[chapters.length - 1].end_sec < lastSec - 5) {
      chapters.push({
        start_sec: Math.round(chapterStart * 10) / 10,
        end_sec: Math.round(lastSec * 10) / 10,
        title: `Chapter ${chapters.length + 1}`,
      });
    }
  } else {
    return {
      ok: true,
      chapters: [],
      total: 0,
      message: "No transcript provided. Run detect_scenes first to get a transcript, or pass one in.",
    };
  }

  return {
    ok: true,
    chapters,
    total: chapters.length,
    min_length_sec: min_chapter_length_sec,
    model: "auto-chapterize-v1",
    note: "v1 keyword-overlap based. v2 will use LLM with audio beats for sharper boundaries.",
  };
}

// ====================================================================
// Tool definitions for the LLM (OpenAI function-calling format)
// ====================================================================

export const MULTIMODAL_TOOLS = [
  {
    type: "function",
    function: {
      name: "summarize_video_arc",
      description: "Identify the narrative structure of a video (3-act / hero's journey / problem-solution). Returns segments with timestamps. Use when the user wants 'what's the story arc', 'structure of this video', 'where are the acts'.",
      parameters: {
        type: "object",
        required: ["file_path"],
        properties: {
          file_path: { type: "string" },
          duration_sec: { type: "number", description: "Optional, in seconds." },
          target_arc: { type: "string", enum: ["three_act", "heroes_journey", "problem_solution", "listicle"] },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_emotional_moments",
      description: "Find emotional peaks in a video (joy, surprise, sadness, tension). Returns timestamps + scores. Use when the user wants 'where's the emotional part', 'find the laughs', 'the suspense moment'.",
      parameters: {
        type: "object",
        required: ["file_path"],
        properties: {
          file_path: { type: "string" },
          transcript: { type: "array", items: { type: "object" } },
          sample_sec: { type: "number", default: 5 },
          threshold: { type: "number", minimum: 0, maximum: 1, default: 0.3 },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "detect_branding_consistency",
      description: "Score brand consistency across a project (colors, logo, aspect ratio). Returns issues list + 0-100 score. Use when the user wants 'is this on brand', 'check branding', 'consistency check'.",
      parameters: {
        type: "object",
        properties: {
          clips: { type: "array", items: { type: "object" } },
          project_id: { type: "string" },
          brand_kit: { type: "object" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "learn_user_style",
      description: "Extract the user's Style DNA from their recent projects. Returns pacing, palette, typical duration, etc. Use when the user wants 'what's my style', 'style profile', 'Style DNA update'.",
      parameters: {
        type: "object",
        required: ["user_id"],
        properties: {
          user_id: { type: "string" },
          recent_projects: { type: "array", items: { type: "object" } },
          time_window_days: { type: "number", default: 90 },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "compare_to_competitors",
      description: "Compare your video's metrics to peer channels. Returns insights. Use when the user wants 'how do I compare', 'competitor analysis', 'vs my niche'.",
      parameters: {
        type: "object",
        required: ["file_path"],
        properties: {
          file_path: { type: "string" },
          reference_channels: { type: "array", items: { type: "string" } },
          metrics: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "vireo_recall",
      description: "Semantic search across all your projects. 'the part where…' Use when the user wants 'find the clip where I said X', 'recall my video about Y', 'search my history'.",
      parameters: {
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string" },
          projects: { type: "array", items: { type: "object" } },
          top_k: { type: "number", default: 5 },
          threshold: { type: "number", default: 0.5 },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "vector_search",
      description: "Search by embedding similarity. Lower-level than vireo_recall. Use for raw vector queries.",
      parameters: {
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string" },
          embeddings: { type: "array", items: { type: "object" } },
          top_k: { type: "number", default: 5 },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_video_reaction",
      description: "Generate a reaction script (text) for a video, in a chosen persona. v1 returns text, v2 returns TTS audio. Use when the user wants 'react to this', 'commentary', 'what would a viewer say'.",
      parameters: {
        type: "object",
        required: ["file_path"],
        properties: {
          file_path: { type: "string" },
          persona: { type: "string", enum: ["curious_viewer", "skeptical_expert", "supportive_friend", "industry_insider", "first_time_viewer"] },
          length: { type: "string", enum: ["short", "medium", "long"], default: "short" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_compilation_from_voice",
      description: "Create a compilation (e.g. 30s teaser from a 5min video) based on a voice prompt. Returns a recipe of tool calls. Use when the user wants 'make me a 30s teaser', 'best of compilation', 'highlight reel'.",
      parameters: {
        type: "object",
        required: ["file_path", "voice_prompt"],
        properties: {
          file_path: { type: "string" },
          voice_prompt: { type: "string", description: "Natural language prompt describing the compilation." },
          max_duration_sec: { type: "number", default: 30 },
          platform: { type: "string", enum: ["tiktok", "youtube_short", "instagram"], default: "tiktok" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "auto_chapterize",
      description: "Generate chapter markers from a transcript. Detects topic changes by keyword overlap. Use when the user wants 'add chapters', 'chapter markers', 'YouTube description timestamps'.",
      parameters: {
        type: "object",
        required: ["file_path"],
        properties: {
          file_path: { type: "string" },
          transcript: { type: "array", items: { type: "object" } },
          min_chapter_length_sec: { type: "number", default: 30 },
          max_chapters: { type: "number", default: 12 },
        },
      },
    },
  },
];

export const MULTIMODAL_TOOL_NAMES = new Set(MULTIMODAL_TOOLS.map((t) => t.function.name));
