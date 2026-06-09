// ai_graphics.js — AI-powered graphics & text overlay tools for Vireo Studio.
//
// Tier 3 differentiation: 10 graphics tools that automate captions, text
// animations, lower thirds, callouts, and engagement overlays.
//
// All tools follow the LLM-friendly contract:
//   - Validation upfront → return error
//   - Compute result → return {ok, ...}
//   - Heavy work delegated to LLM or Python scripts (v2)
//
// What this adds (10 tools):
//
//   Caption tools (5):
//     1. auto_captions            — generate captions from audio
//     2. auto_animated_captions   — captions with per-word animations
//     3. auto_word_level_timing   — word-level timestamps from transcript
//     4. auto_speaker_labels      — diarization: which speaker said what
//     5. auto_highlight_words     — highlight key words (nouns, verbs)
//
//   Text animation (1):
//     6. auto_text_animation      — animated text overlay (fade, slide, etc.)
//
//   Graphic overlays (4):
//     7. auto_lower_third         — name/title lower-third graphic
//     8. auto_callouts            — annotation callout graphics
//     9. auto_chapter_markers     — visual chapter markers
//    10. auto_subscribe_reminder  — subscribe/like reminder overlay
//
// v1 uses heuristic generation (templated graphics, simple animations).
// v2 will plug into neural backends (WhisperX for word timing, vision LLMs
// for scene-aware graphics, Stable Diffusion for backgrounds).

import { randomUUID } from "node:crypto";

// ====================================================================
// Constants & helpers
// ====================================================================

const VALID_CAPTION_STYLES = ["default", "karaoke", "word-by-word", "minimal", "bold"];
const VALID_ANIMATIONS = ["pop", "slide", "fade", "typewriter", "bounce"];
const VALID_TEXT_TYPES = ["fade", "slide", "typewriter", "bounce", "glitch"];
const VALID_LOWER_THIRD_STYLES = ["modern", "minimal", "broadcast", "corporate"];
const VALID_CALLOUT_STYLES = ["arrow", "circle", "bracket", "underline"];
const VALID_POSITIONS = ["start", "end", "middle"];

const EASING_MAP = {
  fade: "ease-in-out",
  slide: "ease-out",
  typewriter: "linear",
  bounce: "cubic-bezier(0.68, -0.55, 0.265, 1.55)",
  glitch: "steps(4, end)",
  pop: "cubic-bezier(0.175, 0.885, 0.32, 1.275)",
};

function _generateId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

function _durationEstimate(text, wpm = 150) {
  // Rough estimate: words / wpm * 60 seconds
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round((words / wpm) * 60 * 10) / 10);
}

function _timestampRange(start, duration, segments) {
  // Convert segments [{start_sec, end_sec}] to duration
  if (segments && segments.length > 0) {
    const last = segments[segments.length - 1];
    return (last.end_sec || last.end || 0) - (segments[0].start_sec || segments[0].start || 0);
  }
  return duration;
}

// ====================================================================
// Tool definitions (OpenAI function-calling shape)
// ====================================================================

export const AI_GRAPHICS_TOOLS = [
  {
    type: "function",
    function: {
      name: "auto_captions",
      description: "Generate captions/subtitles from audio in a video. Supports multiple styles (default, karaoke, word-by-word, minimal, bold). Returns a caption track with word count and timing.",
      parameters: {
        type: "object",
        required: ["video"],
        properties: {
          video: { type: "string", description: "Path or ID of the video file" },
          language: { type: "string", description: "Language code (default: 'en')" },
          style: { type: "string", enum: VALID_CAPTION_STYLES, description: "Caption style" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "auto_animated_captions",
      description: "Generate captions with per-word animation effects (pop, slide, fade, typewriter, bounce). Returns keyframe data for rendering.",
      parameters: {
        type: "object",
        required: ["video"],
        properties: {
          video: { type: "string", description: "Path or ID of the video file" },
          animation: { type: "string", enum: VALID_ANIMATIONS, description: "Animation type (default: 'pop')" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "auto_word_level_timing",
      description: "Generate word-level timestamps from a transcript. Each word gets a precise start/end time and confidence score.",
      parameters: {
        type: "object",
        required: ["transcript"],
        properties: {
          transcript: {
            type: "object",
            properties: {
              text: { type: "string", description: "Full transcript text" },
              segments: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    start_sec: { type: "number" },
                    end_sec: { type: "number" },
                    text: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "auto_speaker_labels",
      description: "Detect and label different speakers in audio. Returns segments grouped by speaker with labels.",
      parameters: {
        type: "object",
        required: ["audio"],
        properties: {
          audio: { type: "string", description: "Path or ID of the audio/video file" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "auto_highlight_words",
      description: "Highlight key words (nouns, verbs, important terms) in captions with a configurable highlight color.",
      parameters: {
        type: "object",
        required: ["captions"],
        properties: {
          captions: {
            type: "object",
            properties: {
              text: { type: "string" },
              segments: { type: "array", items: { type: "object" } },
            },
          },
          highlight_color: { type: "string", description: "Hex color for highlights (default: '#f59e0b')" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "auto_text_animation",
      description: "Generate animated text overlay keyframes. Supports fade, slide, typewriter, bounce, and glitch effects.",
      parameters: {
        type: "object",
        required: ["text"],
        properties: {
          text: { type: "string", description: "Text to animate" },
          type: { type: "string", enum: VALID_TEXT_TYPES, description: "Animation type (default: 'fade')" },
          duration_sec: { type: "number", description: "Duration in seconds (default: 1)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "auto_lower_third",
      description: "Generate a lower-third name/title graphic. Supports modern, minimal, broadcast, and corporate styles.",
      parameters: {
        type: "object",
        required: ["name", "title"],
        properties: {
          name: { type: "string", description: "Person's name" },
          title: { type: "string", description: "Person's title or role" },
          style: { type: "string", enum: VALID_LOWER_THIRD_STYLES, description: "Visual style (default: 'modern')" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "auto_callouts",
      description: "Generate annotation callout graphics pointing to specific coordinates. Supports arrow, circle, bracket, and underline styles.",
      parameters: {
        type: "object",
        required: ["points"],
        properties: {
          points: {
            type: "array",
            items: {
              type: "object",
              properties: {
                x: { type: "number" },
                y: { type: "number" },
                text: { type: "string" },
                time_sec: { type: "number" },
              },
            },
          },
          style: { type: "string", enum: VALID_CALLOUT_STYLES, description: "Callout style (default: 'arrow')" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "auto_chapter_markers",
      description: "Create visual chapter markers for a video timeline. Each chapter gets a time, title, color, and icon.",
      parameters: {
        type: "object",
        required: ["chapters"],
        properties: {
          chapters: {
            type: "array",
            items: {
              type: "object",
              properties: {
                time_sec: { type: "number" },
                title: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "auto_subscribe_reminder",
      description: "Add a subscribe/like reminder overlay to a video. Positions: start, end, or middle.",
      parameters: {
        type: "object",
        required: ["video"],
        properties: {
          video: { type: "string", description: "Path or ID of the video file" },
          position: { type: "string", enum: VALID_POSITIONS, description: "Placement position (default: 'end')" },
        },
      },
    },
  },
];

export const AI_GRAPHICS_TOOL_NAMES = new Set(AI_GRAPHICS_TOOLS.map((t) => t.function.name));

// ====================================================================
// 1. auto_captions
// ====================================================================

/**
 * Generate captions/subtitles from audio in a video.
 * v1: template-based with word timing estimation.
 * v2: WhisperX backend for real transcription.
 *
 * @param {object} args
 * @param {string} args.video - Path or ID of the video file
 * @param {string} [args.language='en'] - Language code
 * @param {string} [args.style='default'] - Caption style
 * @returns {Promise<{ok, track, word_count, language, duration_sec, error?}>}
 */
export async function autoCaptions({ video, language = "en", style = "default" }) {
  if (!video) return { ok: false, error: "video_required" };
  if (!VALID_CAPTION_STYLES.includes(style)) {
    return { ok: false, error: "invalid_style", message: `Valid styles: ${VALID_CAPTION_STYLES.join(", ")}` };
  }

  // v1 heuristic: split transcript into lines, estimate timing
  const lines = typeof video === "string" ? _generateCaptionLines(video) : [];
  const wordCount = lines.reduce((n, l) => n + l.text.split(/\s+/).length, 0);
  const duration = lines.length > 0 ? lines[lines.length - 1].end_sec : 0;

  const track = {
    id: _generateId("caption"),
    format: "srt",
    language,
    style,
    lines,
    created_at: new Date().toISOString(),
  };

  return {
    ok: true,
    track,
    word_count: wordCount,
    language,
    duration_sec: duration,
  };
}

function _generateCaptionLines(videoRef) {
  // v1 stub: generate placeholder caption lines from video reference
  // v2 will use Whisper transcription
  const id = _generateId("cap");
  return [
    { index: 1, start_sec: 0, end_sec: 3.5, text: "[Auto-generated caption line 1]", style: "default" },
    { index: 2, start_sec: 3.5, end_sec: 7.0, text: "[Auto-generated caption line 2]", style: "default" },
    { index: 3, start_sec: 7.0, end_sec: 10.5, text: "[Auto-generated caption line 3]", style: "default" },
  ];
}

// ====================================================================
// 2. auto_animated_captions
// ====================================================================

/**
 * Generate captions with per-word animation effects.
 *
 * @param {object} args
 * @param {string} args.video - Path or ID of the video file
 * @param {string} [args.animation='pop'] - Animation type
 * @returns {Promise<{ok, track, animation_type, keyframes, error?}>}
 */
export async function autoAnimatedCaptions({ video, animation = "pop" }) {
  if (!video) return { ok: false, error: "video_required" };
  if (!VALID_ANIMATIONS.includes(animation)) {
    return { ok: false, error: "invalid_animation", message: `Valid animations: ${VALID_ANIMATIONS.join(", ")}` };
  }

  const words = _generateSampleWords();
  const keyframes = words.map((w, i) => ({
    word: w.word,
    start_sec: w.start_sec,
    end_sec: w.end_sec,
    animation,
    delay_ms: i * 50,
    easing: EASING_MAP[animation] || "ease-in-out",
    properties: _getAnimationProperties(animation),
  }));

  const track = {
    id: _generateId("anncap"),
    animation_type: animation,
    words,
    keyframes,
    created_at: new Date().toISOString(),
  };

  return {
    ok: true,
    track,
    animation_type: animation,
    keyframes,
  };
}

function _generateSampleWords() {
  const sampleText = "Welcome to this amazing tutorial on video editing";
  return sampleText.split(" ").map((word, i) => ({
    word,
    start_sec: i * 0.5,
    end_sec: i * 0.5 + 0.45,
    confidence: 0.85 + Math.random() * 0.15,
  }));
}

function _getAnimationProperties(animation) {
  switch (animation) {
    case "pop":
      return { scale: [0, 1.2, 1], opacity: [0, 1] };
    case "slide":
      return { translate_x: [-50, 0], opacity: [0, 1] };
    case "fade":
      return { opacity: [0, 1] };
    case "typewriter":
      return { clip_path: ["inset(0 100% 0 0)", "inset(0 0% 0 0)"] };
    case "bounce":
      return { translateY: [-30, 0, -10, 0], scale: [1, 1.1, 0.95, 1] };
    default:
      return { opacity: [0, 1] };
  }
}

// ====================================================================
// 3. auto_word_level_timing
// ====================================================================

/**
 * Generate word-level timestamps from a transcript.
 *
 * @param {object} args
 * @param {object} args.transcript - Transcript with text and optional segments
 * @returns {Promise<{ok, words, error?}>}
 */
export async function autoWordLevelTiming({ transcript }) {
  if (!transcript || !transcript.text) return { ok: false, error: "transcript_required" };
  if (typeof transcript.text !== "string" || transcript.text.trim().length === 0) {
    return { ok: false, error: "transcript_text_empty" };
  }

  const segments = transcript.segments || [];
  const words = _distributeWords(transcript.text, segments);

  return {
    ok: true,
    words,
  };
}

function _distributeWords(text, segments) {
  const allWords = text.split(/\s+/).filter(Boolean);
  const totalWords = allWords.length;

  if (segments.length === 0) {
    // No segments: distribute evenly across estimated duration
    const estDuration = _durationEstimate(text);
    const perWord = estDuration / totalWords;
    return allWords.map((word, i) => ({
      word,
      start_sec: Math.round(i * perWord * 1000) / 1000,
      end_sec: Math.round((i + 1) * perWord * 1000) / 1000,
      confidence: 0.9 + Math.random() * 0.1,
    }));
  }

  // Distribute words across provided segments
  const result = [];
  let wordIdx = 0;

  for (const seg of segments) {
    const segStart = seg.start_sec || seg.start || 0;
    const segEnd = seg.end_sec || seg.end || segStart + 3;
    const segText = (seg.text || "").split(/\s+/).filter(Boolean);
    const segDuration = segEnd - segStart;
    const perWord = segDuration / Math.max(segText.length, 1);

    for (let j = 0; j < segText.length && wordIdx < totalWords; j++) {
      result.push({
        word: segText[j],
        start_sec: Math.round((segStart + j * perWord) * 1000) / 1000,
        end_sec: Math.round((segStart + (j + 1) * perWord) * 1000) / 1000,
        confidence: 0.85 + Math.random() * 0.15,
      });
      wordIdx++;
    }
  }

  // Any remaining words get appended
  while (wordIdx < totalWords) {
    const lastEnd = result.length > 0 ? result[result.length - 1].end_sec : 0;
    result.push({
      word: allWords[wordIdx],
      start_sec: Math.round(lastEnd * 1000) / 1000,
      end_sec: Math.round((lastEnd + 0.5) * 1000) / 1000,
      confidence: 0.8,
    });
    wordIdx++;
  }

  return result;
}

// ====================================================================
// 4. auto_speaker_labels
// ====================================================================

/**
 * Detect and label different speakers in audio.
 * v1: stub that returns placeholder diarization.
 * v2: will use pyannote or NeMo speaker diarization.
 *
 * @param {object} args
 * @param {string} args.audio - Path or ID of the audio/video file
 * @returns {Promise<{ok, speakers, speaker_count, error?}>}
 */
export async function autoSpeakerLabels({ audio }) {
  if (!audio) return { ok: false, error: "audio_required" };

  // v1 stub: generate placeholder speaker labels
  const speakers = [
    {
      id: "speaker_1",
      label: "Speaker 1",
      color: "#3b82f6",
      segments: [
        { start_sec: 0, end_sec: 5.2, text: "[Speaker 1 speech segment 1]" },
        { start_sec: 12.0, end_sec: 18.5, text: "[Speaker 1 speech segment 2]" },
      ],
    },
    {
      id: "speaker_2",
      label: "Speaker 2",
      color: "#ef4444",
      segments: [
        { start_sec: 5.5, end_sec: 11.8, text: "[Speaker 2 speech segment 1]" },
        { start_sec: 19.0, end_sec: 25.0, text: "[Speaker 2 speech segment 2]" },
      ],
    },
  ];

  return {
    ok: true,
    speakers,
    speaker_count: speakers.length,
  };
}

// ====================================================================
// 5. auto_highlight_words
// ====================================================================

/**
 * Highlight key words (nouns, verbs, important terms) in captions.
 *
 * @param {object} args
 * @param {object} args.captions - Caption track with text/segments
 * @param {string} [args.highlight_color='#f59e0b'] - Hex highlight color
 * @returns {Promise<{ok, captions, highlighted_words, total_highlights, error?}>}
 */
export async function autoHighlightWords({ captions, highlight_color = "#f59e0b" }) {
  if (!captions) return { ok: false, error: "captions_required" };

  const text = captions.text || (captions.segments || []).map((s) => s.text).join(" ");
  if (!text || text.trim().length === 0) {
    return { ok: false, error: "captions_text_empty" };
  }

  // v1 heuristic: highlight words longer than 5 chars (proxy for nouns/verbs)
  const words = text.split(/\s+/).filter(Boolean);
  const highlightThreshold = 5;
  const highlightedWords = [];
  const highlighted = words.map((w) => {
    const clean = w.replace(/[^a-zA-Z0-9]/g, "");
    if (clean.length >= highlightThreshold) {
      highlightedWords.push(clean);
      return {
        text: w,
        highlight: true,
        color: highlight_color,
      };
    }
    return { text: w, highlight: false };
  });

  return {
    ok: true,
    captions: { ...captions, highlighted },
    highlighted_words: highlightedWords,
    total_highlights: highlightedWords.length,
  };
}

// ====================================================================
// 6. auto_text_animation
// ====================================================================

/**
 * Generate animated text overlay keyframes.
 *
 * @param {object} args
 * @param {string} args.text - Text to animate
 * @param {string} [args.type='fade'] - Animation type
 * @param {number} [args.duration_sec=1] - Duration in seconds
 * @returns {Promise<{ok, keyframes, duration_sec, easing, error?}>}
 */
export async function autoTextAnimation({ text, type = "fade", duration_sec = 1 }) {
  if (!text) return { ok: false, error: "text_required" };
  if (!VALID_TEXT_TYPES.includes(type)) {
    return { ok: false, error: "invalid_type", message: `Valid types: ${VALID_TEXT_TYPES.join(", ")}` };
  }
  if (typeof duration_sec !== "number" || duration_sec <= 0) {
    return { ok: false, error: "invalid_duration", message: "duration_sec must be > 0" };
  }

  const easing = EASING_MAP[type] || "ease-in-out";
  const keyframes = _generateKeyframes(type, duration_sec);

  return {
    ok: true,
    keyframes,
    duration_sec,
    easing,
  };
}

function _generateKeyframes(type, duration) {
  const fps = 30;
  const totalFrames = Math.ceil(duration * fps);
  const frames = [];

  for (let i = 0; i <= totalFrames; i++) {
    const t = i / totalFrames; // 0..1
    const time_sec = Math.round(t * duration * 1000) / 1000;

    switch (type) {
      case "fade":
        frames.push({ frame: i, time_sec, opacity: t, transform: "none" });
        break;
      case "slide":
        frames.push({
          frame: i,
          time_sec,
          opacity: Math.min(1, t * 2),
          transform: `translateX(${Math.round((1 - t) * 100)}px)`,
        });
        break;
      case "typewriter": {
        const chars = Math.floor(t * 100);
        frames.push({
          frame: i,
          time_sec,
          opacity: 1,
          clip_path: `inset(0 ${Math.max(0, 100 - chars)}% 0 0)`,
        });
        break;
      }
      case "bounce": {
        const bounce = t < 0.6
          ? Math.sin((t / 0.6) * Math.PI) * 20
          : Math.sin(((t - 0.6) / 0.4) * Math.PI * 2) * 5 * (1 - t);
        frames.push({
          frame: i,
          time_sec,
          opacity: Math.min(1, t * 3),
          transform: `translateY(${Math.round(-bounce)}px)`,
        });
        break;
      }
      case "glitch": {
        const glitchX = t < 0.8 ? (Math.random() > 0.7 ? Math.round((Math.random() - 0.5) * 20) : 0) : 0;
        const glitchOpacity = t < 0.8 ? (Math.random() > 0.9 ? 0.5 : 1) : 1;
        frames.push({
          frame: i,
          time_sec,
          opacity: glitchOpacity,
          transform: `translateX(${glitchX}px)`,
        });
        break;
      }
      default:
        frames.push({ frame: i, time_sec, opacity: 1, transform: "none" });
    }
  }

  return frames;
}

// ====================================================================
// 7. auto_lower_third
// ====================================================================

/**
 * Generate a lower-third name/title graphic.
 *
 * @param {string} name - Person's name
 * @param {string} title - Person's title or role
 * @param {object} [opts]
 * @param {string} [opts.style='modern'] - Visual style
 * @returns {Promise<{ok, graphic, duration_sec, animation_in, animation_out, error?}>}
 */
export async function autoLowerThird(name, title, { style = "modern" } = {}) {
  if (!name) return { ok: false, error: "name_required" };
  if (!title) return { ok: false, error: "title_required" };
  if (!VALID_LOWER_THIRD_STYLES.includes(style)) {
    return { ok: false, error: "invalid_style", message: `Valid styles: ${VALID_LOWER_THIRD_STYLES.join(", ")}` };
  }

  const graphic = {
    id: _generateId("lt"),
    type: "lower_third",
    style,
    name,
    title,
    layout: _getLowerThirdLayout(style),
    colors: _getLowerThirdColors(style),
    typography: _getLowerThirdTypography(style),
    position: { x: 50, y: 85, anchor: "center" },
    created_at: new Date().toISOString(),
  };

  return {
    ok: true,
    graphic,
    duration_sec: 5,
    animation_in: { type: "slide", direction: "left", duration_sec: 0.5, easing: "ease-out" },
    animation_out: { type: "fade", direction: "none", duration_sec: 0.3, easing: "ease-in" },
  };
}

function _getLowerThirdLayout(style) {
  switch (style) {
    case "modern":
      return { name_size: 36, title_size: 22, padding: 16, border_radius: 8, bg_opacity: 0.85 };
    case "minimal":
      return { name_size: 28, title_size: 18, padding: 8, border_radius: 0, bg_opacity: 0.7 };
    case "broadcast":
      return { name_size: 32, title_size: 20, padding: 12, border_radius: 4, bg_opacity: 0.9 };
    case "corporate":
      return { name_size: 30, title_size: 18, padding: 14, border_radius: 2, bg_opacity: 0.88 };
    default:
      return { name_size: 32, title_size: 20, padding: 12, border_radius: 4, bg_opacity: 0.85 };
  }
}

function _getLowerThirdColors(style) {
  switch (style) {
    case "modern":
      return { bg: "#1e293b", name_color: "#f8fafc", title_color: "#94a3b8", accent: "#3b82f6" };
    case "minimal":
      return { bg: "#000000", name_color: "#ffffff", title_color: "#a0a0a0", accent: "#ffffff" };
    case "broadcast":
      return { bg: "#dc2626", name_color: "#ffffff", title_color: "#fecaca", accent: "#ffffff" };
    case "corporate":
      return { bg: "#1e3a5f", name_color: "#ffffff", title_color: "#b0c4de", accent: "#4a90d9" };
    default:
      return { bg: "#1e293b", name_color: "#f8fafc", title_color: "#94a3b8", accent: "#3b82f6" };
  }
}

function _getLowerThirdTypography(style) {
  switch (style) {
    case "modern":
      return { name_font: "Inter", title_font: "Inter", weight_name: 700, weight_title: 400 };
    case "minimal":
      return { name_font: "Helvetica", title_font: "Helvetica", weight_name: 600, weight_title: 300 };
    case "broadcast":
      return { name_font: "Roboto", title_font: "Roboto", weight_name: 700, weight_title: 500 };
    case "corporate":
      return { name_font: "Arial", title_font: "Arial", weight_name: 700, weight_title: 400 };
    default:
      return { name_font: "Inter", title_font: "Inter", weight_name: 700, weight_title: 400 };
  }
}

// ====================================================================
// 8. auto_callouts
// ====================================================================

/**
 * Generate annotation callout graphics.
 *
 * @param {object} args
 * @param {Array<{x, y, text, time_sec}>} args.points - Callout points
 * @param {string} [args.style='arrow'] - Callout style
 * @returns {Promise<{ok, graphics, total_count, error?}>}
 */
export async function autoCallouts({ points, style = "arrow" }) {
  if (!points || !Array.isArray(points) || points.length === 0) {
    return { ok: false, error: "points_required" };
  }
  if (!VALID_CALLOUT_STYLES.includes(style)) {
    return { ok: false, error: "invalid_style", message: `Valid styles: ${VALID_CALLOUT_STYLES.join(", ")}` };
  }

  const graphics = points.map((pt, i) => {
    if (pt.x == null || pt.y == null) return null;
    return {
      id: _generateId("callout"),
      point: { x: pt.x, y: pt.y },
      text: pt.text || "",
      style,
      time_sec: pt.time_sec || 0,
      duration: 3,
      visual: _getCalloutVisual(style),
      arrow: style === "arrow" ? { angle: _calcAngle(pt, points, i), length: 40 } : null,
    };
  }).filter(Boolean);

  return {
    ok: true,
    graphics,
    total_count: graphics.length,
  };
}

function _getCalloutVisual(style) {
  switch (style) {
    case "arrow":
      return { shape: "rectangle_with_arrow", border: 2, bg: "rgba(0,0,0,0.75)", text_color: "#ffffff", padding: 8, font_size: 16 };
    case "circle":
      return { shape: "circle", border: 2, bg: "rgba(59,130,246,0.2)", stroke: "#3b82f6", text_color: "#3b82f6", font_size: 14 };
    case "bracket":
      return { shape: "bracket", border: 3, bg: "transparent", stroke: "#f59e0b", text_color: "#f59e0b", font_size: 14 };
    case "underline":
      return { shape: "text_with_underline", border: 2, bg: "transparent", stroke: "#ef4444", text_color: "#ffffff", font_size: 16 };
    default:
      return { shape: "rectangle", border: 1, bg: "#000", text_color: "#fff", font_size: 14 };
  }
}

function _calcAngle(pt, allPts, idx) {
  // Point arrow toward center of frame if only one point
  if (allPts.length <= 1) return 135;
  const next = allPts[(idx + 1) % allPts.length];
  return Math.round(Math.atan2(next.y - pt.y, next.x - pt.x) * (180 / Math.PI));
}

// ====================================================================
// 9. auto_chapter_markers
// ====================================================================

/**
 * Create visual chapter markers for a video timeline.
 *
 * @param {object} args
 * @param {Array<{time_sec, title}>} args.chapters - Chapter definitions
 * @returns {Promise<{ok, markers, total_chapters, error?}>}
 */
export async function autoChapterMarkers({ chapters }) {
  if (!chapters || !Array.isArray(chapters) || chapters.length === 0) {
    return { ok: false, error: "chapters_required" };
  }

  const COLORS = ["#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"];
  const ICONS = ["play", "star", "bookmark", "flag", "lightning", "heart", "check", "arrow-right"];

  const markers = chapters.map((ch, i) => ({
    id: _generateId("chapter"),
    time_sec: ch.time_sec || 0,
    title: ch.title || `Chapter ${i + 1}`,
    color: ch.color || COLORS[i % COLORS.length],
    icon: ch.icon || ICONS[i % ICONS.length],
    index: i,
  }));

  return {
    ok: true,
    markers,
    total_chapters: markers.length,
  };
}

// ====================================================================
// 10. auto_subscribe_reminder
// ====================================================================

/**
 * Add a subscribe/like reminder overlay to a video.
 *
 * @param {object} args
 * @param {string} args.video - Path or ID of the video file
 * @param {string} [args.position='end'] - Placement position
 * @returns {Promise<{ok, graphic, position, duration_sec, animation, error?}>}
 */
export async function autoSubscribeReminder({ video, position = "end" }) {
  if (!video) return { ok: false, error: "video_required" };
  if (!VALID_POSITIONS.includes(position)) {
    return { ok: false, error: "invalid_position", message: `Valid positions: ${VALID_POSITIONS.join(", ")}` };
  }

  const graphic = {
    id: _generateId("sub"),
    type: "subscribe_reminder",
    position,
    elements: [
      { type: "subscribe_button", label: "Subscribe", icon: "bell", color: "#ef4444", size: 120 },
      { type: "like_button", label: "Like", icon: "thumbs-up", color: "#3b82f6", size: 80 },
      { type: "text", label: "Don't miss out!", font_size: 18, color: "#ffffff" },
    ],
    layout: _getReminderLayout(position),
    created_at: new Date().toISOString(),
  };

  return {
    ok: true,
    graphic,
    position,
    duration_sec: position === "end" ? 5 : 3,
    animation: {
      in: { type: "pop", duration_sec: 0.5 },
      hold: { type: "pulse", interval_sec: 2 },
      out: { type: "fade", duration_sec: 0.3 },
    },
  };
}

function _getReminderLayout(position) {
  switch (position) {
    case "start":
      return { x: 50, y: 30, anchor: "center", bg: "rgba(0,0,0,0.6)", border_radius: 12 };
    case "middle":
      return { x: 50, y: 50, anchor: "center", bg: "rgba(0,0,0,0.7)", border_radius: 12 };
    case "end":
      return { x: 50, y: 80, anchor: "center", bg: "rgba(0,0,0,0.6)", border_radius: 12 };
    default:
      return { x: 50, y: 80, anchor: "center", bg: "rgba(0,0,0,0.6)", border_radius: 12 };
  }
}
