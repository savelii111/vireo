// graphics_overlay.js — Week 5 (2026-06-09).
//
// 10 graphics overlay tools for Vireo Studio. These handle visual
// elements that sit on top of video: logos, watermarks, social icons,
// subscribe reminders, end screens, info cards, progress bars,
// view counters, like reminders, and comment prompts.
//
// All tools follow the LLM-friendly contract:
//   - Validation upfront → return error
//   - Compute result → return {ok, ...}
//   - Heavy work delegated to ffmpeg canvas compositing (future)
//
// Architecture:
//   - Synchronous heuristics for positioning, sizing, timing.
//   - Actual rendering is ffmpeg overlay commands (stub for v1).
//   - Each tool returns a deterministic overlay descriptor so
//     downstream systems can build the ffmpeg filter chain.
//
// What this adds:
//   1.  addLogo                — place a logo at a position
//   2.  addWatermark           — text/logo/pattern watermark
//   3.  addSocialIcons         — platform social media icons
//   4.  addSubscribeReminder   — bell/button/animated sub CTA
//   5.  addEndScreen           — end screen with elements
//   6.  addInfoCards           — timestamped info cards
//   7.  addProgressBar          — video progress indicator
//   8.  addViewCounter         — animated view count overlay
//   9.  addLikeReminder        — like CTA overlay
//  10.  addCommentPrompt       — comment engagement prompt

// ====================================================================
// Constants
// ====================================================================

const VALID_POSITIONS = ["top-left", "top-right", "bottom-left", "bottom-right", "center"];
const VALID_WATERMARK_STYLES = ["text", "logo", "diagonal", "pattern"];
const VALID_PLATFORMS = ["youtube", "instagram", "tiktok", "twitter", "facebook"];
const VALID_SUBSCRIBE_STYLES = ["bell", "button", "text", "animated"];
const VALID_END_SCREEN_ELEMENTS = ["subscribe", "video", "playlist", "channel", "link"];
const VALID_PROGRESS_STYLES = ["minimal", "gradient", "segmented", "animated"];
const VALID_COUNTER_STYLES = ["number", "bar", "graph", "milestone"];
const VALID_LIKE_STYLES = ["thumb", "heart", "fire", "star"];

const POSITION_DEFAULTS = {
  "top-left": { x: 0.02, y: 0.02 },
  "top-right": { x: 0.98, y: 0.02 },
  "bottom-left": { x: 0.02, y: 0.98 },
  "bottom-right": { x: 0.98, y: 0.98 },
  "center": { x: 0.5, y: 0.5 },
};

const PLATFORM_ICONS = {
  youtube: "https://cdn.vireo.studio/icons/youtube.svg",
  instagram: "https://cdn.vireo.studio/icons/instagram.svg",
  tiktok: "https://cdn.vireo.studio/icons/tiktok.svg",
  twitter: "https://cdn.vireo.studio/icons/twitter.svg",
  facebook: "https://cdn.vireo.studio/icons/facebook.svg",
};

// ====================================================================
// Helper: compute overlay position from position name + offsets
// ====================================================================

function computePosition(name, customX, customY) {
  const base = POSITION_DEFAULTS[name] || POSITION_DEFAULTS["bottom-right"];
  return {
    x: customX !== undefined ? customX : base.x,
    y: customY !== undefined ? customY : base.y,
  };
}

// ====================================================================
// Helper: compute overlay size from position (percentage of frame)
// ====================================================================

function computeSize(position, sizePercent) {
  const defaultSizes = {
    "top-left": 0.12,
    "top-right": 0.12,
    "bottom-left": 0.12,
    "bottom-right": 0.12,
    center: 0.25,
  };
  const base = defaultSizes[position] || 0.12;
  return sizePercent !== undefined ? sizePercent : base;
}

// ====================================================================
// Helper: validate required fields
// ====================================================================

function requireFields(args, fields) {
  for (const f of fields) {
    if (!args[f] || (typeof args[f] === "string" && args[f].trim() === "")) {
      return `${f}_required`;
    }
  }
  return null;
}

// ====================================================================
// 1. addLogo — place a logo overlay on the video
// ====================================================================

/**
 * Add a logo image overlay to a video at a specified position.
 *
 * @param {object} args
 * @param {string} args.video - video file path or URL
 * @param {string} args.logo - logo image file path or URL
 * @param {string} args.position - one of VALID_POSITIONS
 * @param {number} [args.size] - size as fraction of frame (0.05–0.4)
 * @param {number} [args.opacity] - opacity 0.0–1.0
 * @returns {{ ok: true, overlay_added, position, size, opacity }}
 */
export async function addLogo({ video, logo, position = "bottom-right", size, opacity = 1.0 } = {}) {
  const err = requireFields({ video, logo }, ["video", "logo"]);
  if (err) return { ok: false, error: err };

  if (!VALID_POSITIONS.includes(position)) {
    return { ok: false, error: "invalid_position", valid: VALID_POSITIONS };
  }
  if (opacity < 0 || opacity > 1) {
    return { ok: false, error: "invalid_opacity", valid: "0.0–1.0" };
  }
  const clampedOpacity = Math.max(0, Math.min(1, opacity));

  const finalSize = computeSize(position, size);
  const pos = computePosition(position);

  return {
    ok: true,
    overlay_added: true,
    position: { name: position, ...pos },
    size: finalSize,
    opacity: clampedOpacity,
    logo_path: logo,
    ffmpeg_filter: {
      type: "overlay",
      inputs: ["[0:v]", "[logo:v]"],
      output: "[out]",
      params: {
        x: `W*${pos.x}-W*${finalSize}*0.5`,
        y: `H*${pos.y}-H*${finalSize}*0.5`,
      },
    },
  };
}

// ====================================================================
// 2. addWatermark — text, logo, diagonal, or pattern watermark
// ====================================================================

/**
 * Add a watermark overlay to a video.
 *
 * @param {object} args
 * @param {string} args.video - video file path or URL
 * @param {string} [args.text] - watermark text (for text style)
 * @param {string} [args.style] - text|logo|diagonal|pattern
 * @param {number} [args.opacity] - opacity 0.0–1.0
 * @param {string} [args.position] - position name
 * @returns {{ ok: true, overlay_added, style, opacity, position }}
 */
export async function addWatermark({ video, text, style = "text", opacity = 0.3, position = "bottom-right" } = {}) {
  const err = requireFields({ video }, ["video"]);
  if (err) return { ok: false, error: err };

  if (!VALID_WATERMARK_STYLES.includes(style)) {
    return { ok: false, error: "invalid_style", valid: VALID_WATERMARK_STYLES };
  }
  if (style === "text" && (!text || text.trim() === "")) {
    return { ok: false, error: "text_required_for_text_style" };
  }
  if (opacity < 0 || opacity > 1) {
    return { ok: false, error: "invalid_opacity", valid: "0.0–1.0" };
  }
  if (!VALID_POSITIONS.includes(position)) {
    return { ok: false, error: "invalid_position", valid: VALID_POSITIONS };
  }

  const clampedOpacity = Math.max(0, Math.min(1, opacity));
  const pos = computePosition(position);

  // Style-specific sizing
  const styleDefaults = {
    text: { fontSize: 24, color: "#ffffff", font: "Arial" },
    logo: { size: 0.1 },
    diagonal: { fontSize: 20, color: "#ffffff80", rotation: -30, spacing: 150 },
    pattern: { size: 0.08, spacing: 200 },
  };

  return {
    ok: true,
    overlay_added: true,
    style,
    opacity: clampedOpacity,
    position: { name: position, ...pos },
    text: text || null,
    style_config: styleDefaults[style],
    ffmpeg_filter: {
      type: "drawtext",
      text: style === "text" ? text : undefined,
      enable: "between(t,0,duration)",
      fontcolor: `white@${clampedOpacity}`,
      fontsize: styleDefaults[style].fontSize || 24,
      x: `W*${pos.x}`,
      y: `H*${pos.y}`,
    },
  };
}

// ====================================================================
// 3. addSocialIcons — platform social media icons
// ====================================================================

/**
 * Add social media platform icons overlay.
 *
 * @param {object} args
 * @param {string} args.video - video file path or URL
 * @param {string[]} args.platforms - list of platform names
 * @param {string} [args.position] - position name
 * @returns {{ ok: true, icons_added, position }}
 */
export async function addSocialIcons({ video, platforms, position = "bottom-right" } = {}) {
  const err = requireFields({ video, platforms }, ["video", "platforms"]);
  if (err) return { ok: false, error: err };

  if (!Array.isArray(platforms) || platforms.length === 0) {
    return { ok: false, error: "platforms_required_non_empty" };
  }

  const invalid = platforms.filter((p) => !VALID_PLATFORMS.includes(p));
  if (invalid.length > 0) {
    return { ok: false, error: "invalid_platforms", invalid, valid: VALID_PLATFORMS };
  }

  if (!VALID_POSITIONS.includes(position)) {
    return { ok: false, error: "invalid_position", valid: VALID_POSITIONS };
  }

  const pos = computePosition(position);
  const icons = platforms.map((p) => ({
    platform: p,
    icon_url: PLATFORM_ICONS[p],
    size: 0.06,
  }));

  return {
    ok: true,
    icons_added: icons,
    position: { name: position, ...pos },
    ffmpeg_filters: icons.map((icon, i) => ({
      type: "overlay",
      inputs: ["[0:v]", `[icon${i}:v]`],
      output: `[v${i}]`,
      params: {
        x: `W*${pos.x}+W*0.07*${i}`,
        y: `H*${pos.y}`,
      },
    })),
  };
}

// ====================================================================
// 4. addSubscribeReminder — subscribe CTA overlay
// ====================================================================

/**
 * Add a subscribe reminder overlay (bell, button, text, animated).
 *
 * @param {object} args
 * @param {string} args.video - video file path or URL
 * @param {string} [args.position] - position name
 * @param {string} [args.style] - bell|button|text|animated
 * @param {number} [args.start_sec] - when to show (seconds)
 * @param {number} [args.duration_sec] - how long to show (seconds)
 * @returns {{ ok: true, overlay_added, position, duration_sec, animation }}
 */
export async function addSubscribeReminder({ video, position = "bottom-right", style = "button", start_sec = 5, duration_sec = 5 } = {}) {
  const err = requireFields({ video }, ["video"]);
  if (err) return { ok: false, error: err };

  if (!VALID_SUBSCRIBE_STYLES.includes(style)) {
    return { ok: false, error: "invalid_style", valid: VALID_SUBSCRIBE_STYLES };
  }
  if (!VALID_POSITIONS.includes(position)) {
    return { ok: false, error: "invalid_position", valid: VALID_POSITIONS };
  }
  if (start_sec < 0) return { ok: false, error: "invalid_start_sec" };
  if (duration_sec <= 0) return { ok: false, error: "invalid_duration_sec" };

  const pos = computePosition(position);

  const animationMap = {
    bell: "bell_ring",
    button: "fade_in_out",
    text: "slide_in",
    animated: "bounce",
  };

  return {
    ok: true,
    overlay_added: true,
    position: { name: position, ...pos },
    duration_sec,
    start_sec,
    animation: animationMap[style],
    style,
    ffmpeg_filter: {
      type: "overlay",
      enable: `between(t,${start_sec},${start_sec + duration_sec})`,
      inputs: ["[0:v]", "[sub:v]"],
      output: "[out]",
      params: {
        x: `W*${pos.x}`,
        y: `H*${pos.y}`,
      },
    },
  };
}

// ====================================================================
// 5. addEndScreen — end screen with multiple elements
// ====================================================================

/**
 * Add an end screen with configurable elements (subscribe, video,
 * playlist, channel, link). Elements are laid out in a grid.
 *
 * @param {object} args
 * @param {string} args.video - video file path or URL
 * @param {object[]} args.elements - list of { type, ... }
 * @param {number} [args.start_sec] - when end screen appears
 * @returns {{ ok: true, overlay_added, elements_count, layout }}
 */
export async function addEndScreen({ video, elements, start_sec } = {}) {
  const err = requireFields({ video, elements }, ["video", "elements"]);
  if (err) return { ok: false, error: err };

  if (!Array.isArray(elements) || elements.length === 0) {
    return { ok: false, error: "elements_required_non_empty" };
  }

  const invalidTypes = elements.filter((e) => !VALID_END_SCREEN_ELEMENTS.includes(e.type));
  if (invalidTypes.length > 0) {
    return { ok: false, error: "invalid_element_types", invalid: invalidTypes.map((e) => e.type), valid: VALID_END_SCREEN_ELEMENTS };
  }

  if (elements.length > 4) {
    return { ok: false, error: "max_4_elements" };
  }

  // Auto-compute start_sec: last 20 seconds if not given
  const autoStart = start_sec !== undefined ? start_sec : 0; // caller should provide or we default

  // Grid layout: up to 2x2
  const layoutGrid = {
    1: [{ x: 0.5, y: 0.5, w: 0.35, h: 0.35 }],
    2: [
      { x: 0.28, y: 0.5, w: 0.22, h: 0.35 },
      { x: 0.72, y: 0.5, w: 0.22, h: 0.35 },
    ],
    3: [
      { x: 0.18, y: 0.45, w: 0.2, h: 0.3 },
      { x: 0.5, y: 0.45, w: 0.2, h: 0.3 },
      { x: 0.82, y: 0.45, w: 0.2, h: 0.3 },
    ],
    4: [
      { x: 0.28, y: 0.28, w: 0.2, h: 0.3 },
      { x: 0.72, y: 0.28, w: 0.2, h: 0.3 },
      { x: 0.28, y: 0.72, w: 0.2, h: 0.3 },
      { x: 0.72, y: 0.72, w: 0.2, h: 0.3 },
    ],
  };

  const count = Math.min(elements.length, 4);
  const grid = layoutGrid[count];

  const positionedElements = elements.slice(0, 4).map((el, i) => ({
    type: el.type,
    data: el,
    position: { x: grid[i].x, y: grid[i].y, w: grid[i].w, h: grid[i].h },
  }));

  return {
    ok: true,
    overlay_added: true,
    elements_count: count,
    layout: {
      type: "grid",
      rows: count <= 2 ? 1 : 2,
      cols: count <= 2 ? count : 2,
    },
    elements: positionedElements,
    start_sec: autoStart,
    ffmpeg_filters: positionedElements.map((el, i) => ({
      type: "overlay",
      enable: `gte(t,${autoStart})`,
      inputs: ["[0:v]", `[es${i}:v]`],
      output: `[v${i}]`,
      params: {
        x: `W*${el.position.x - el.position.w * 0.5}`,
        y: `H*${el.position.y - el.position.h * 0.5}`,
        w: `W*${el.position.w}`,
        h: `H*${el.position.h}`,
      },
    })),
  };
}

// ====================================================================
// 6. addInfoCards — timestamped info cards
// ====================================================================

/**
 * Add info cards that appear at specific timestamps during playback.
 *
 * @param {object} args
 * @param {string} args.video - video file path or URL
 * @param {object[]} args.cards - [{ time_sec, title, url, type }]
 * @returns {{ ok: true, cards_added, total_count }}
 */
export async function addInfoCards({ video, cards } = {}) {
  const err = requireFields({ video, cards }, ["video", "cards"]);
  if (err) return { ok: false, error: err };

  if (!Array.isArray(cards) || cards.length === 0) {
    return { ok: false, error: "cards_required_non_empty" };
  }

  if (cards.length > 5) {
    return { ok: false, error: "max_5_cards" };
  }

  const cardTypes = ["video", "channel", "playlist", "link"];
  const validated = [];
  for (const card of cards) {
    if (!card.time_sec && card.time_sec !== 0) {
      return { ok: false, error: "card_time_sec_required" };
    }
    if (!card.title || card.title.trim() === "") {
      return { ok: false, error: "card_title_required" };
    }
    if (card.type && !cardTypes.includes(card.type)) {
      return { ok: false, error: "invalid_card_type", invalid: card.type, valid: cardTypes };
    }
    if (card.time_sec < 0) {
      return { ok: false, error: "invalid_card_time_sec" };
    }
    validated.push({
      time: card.time_sec,
      title: card.title,
      type: card.type || "video",
      url: card.url || null,
    });
  }

  // Sort by time
  validated.sort((a, b) => a.time - b.time);

  // Ensure minimum gap of 10 seconds between cards
  for (let i = 1; i < validated.length; i++) {
    if (validated[i].time - validated[i - 1].time < 10) {
      validated[i].time = validated[i - 1].time + 10;
    }
  }

  return {
    ok: true,
    cards_added: validated.map((c) => ({
      time: c.time,
      title: c.title,
      type: c.type,
    })),
    total_count: validated.length,
    full_cards: validated,
  };
}

// ====================================================================
// 7. addProgressBar — video progress indicator overlay
// ====================================================================

/**
 * Add a progress bar overlay to the video.
 *
 * @param {object} args
 * @param {string} args.video - video file path or URL
 * @param {string} [args.style] - minimal|gradient|segmented|animated
 * @param {string} [args.position] - position name
 * @param {string} [args.color] - hex color
 * @returns {{ ok: true, overlay_added, style, position, color }}
 */
export async function addProgressBar({ video, style = "minimal", position = "bottom-left", color } = {}) {
  const err = requireFields({ video }, ["video"]);
  if (err) return { ok: false, error: err };

  if (!VALID_PROGRESS_STYLES.includes(style)) {
    return { ok: false, error: "invalid_style", valid: VALID_PROGRESS_STYLES };
  }
  if (!VALID_POSITIONS.includes(position)) {
    return { ok: false, error: "invalid_position", valid: VALID_POSITIONS };
  }

  const defaultColors = {
    minimal: "#ff0000",
    gradient: "gradient:red:#ff0000,#ff8800",
    segmented: "#00ff00",
    animated: "#00ccff",
  };

  const finalColor = color || defaultColors[style];
  const pos = computePosition(position);

  const heightMap = {
    minimal: 4,
    gradient: 6,
    segmented: 8,
    animated: 6,
  };

  return {
    ok: true,
    overlay_added: true,
    style,
    position: { name: position, ...pos },
    color: finalColor,
    height: heightMap[style],
    ffmpeg_filter: {
      type: "drawbox",
      enable: "gte(t,0)",
      x: "0",
      y: position.includes("top") ? `H*${pos.y}` : `H*${pos.y} - ${heightMap[style]}`,
      width: `iw*t/duration`,
      height: heightMap[style],
      color: finalColor,
    },
  };
}

// ====================================================================
// 8. addViewCounter — animated view count overlay
// ====================================================================

/**
 * Add a view counter overlay that animates from a start count.
 *
 * @param {object} args
 * @param {string} args.video - video file path or URL
 * @param {number} [args.start_count] - starting view count
 * @param {string} [args.style] - number|bar|graph|milestone
 * @param {string} [args.position] - position name
 * @returns {{ ok: true, overlay_added, start_count, animation }}
 */
export async function addViewCounter({ video, start_count = 0, style = "number", position = "top-right" } = {}) {
  const err = requireFields({ video }, ["video"]);
  if (err) return { ok: false, error: err };

  if (!VALID_COUNTER_STYLES.includes(style)) {
    return { ok: false, error: "invalid_style", valid: VALID_COUNTER_STYLES };
  }
  if (typeof start_count !== "number" || start_count < 0) {
    return { ok: false, error: "invalid_start_count" };
  }
  if (!VALID_POSITIONS.includes(position)) {
    return { ok: false, error: "invalid_position", valid: VALID_POSITIONS };
  }

  const pos = computePosition(position);

  const formatCount = (n) => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return String(n);
  };

  const milestoneThresholds = [100, 500, 1000, 5000, 10000, 50000, 100000, 500000, 1000000];
  const nextMilestone = milestoneThresholds.find((m) => m > start_count) || start_count * 10;

  return {
    ok: true,
    overlay_added: true,
    start_count,
    display_count: formatCount(start_count),
    next_milestone: nextMilestone,
    style,
    position: { name: position, ...pos },
    animation: {
      type: style === "number" ? "count_up" : style === "bar" ? "fill" : style === "graph" ? "rise" : "celebrate",
      duration_sec: 3,
    },
    ffmpeg_filter: {
      type: "drawtext",
      text: `Views: ${formatCount(start_count)}`,
      fontsize: 28,
      fontcolor: "#ffffff",
      x: `W*${pos.x}`,
      y: `H*${pos.y}`,
      enable: "gte(t,0)",
    },
  };
}

// ====================================================================
// 9. addLikeReminder — like CTA overlay
// ====================================================================

/**
 * Add a like reminder overlay to prompt viewers to like the video.
 *
 * @param {object} args
 * @param {string} args.video - video file path or URL
 * @param {string} [args.position] - position name
 * @param {string} [args.style] - thumb|heart|fire|star
 * @param {number} [args.start_sec] - when to show (seconds)
 * @param {number} [args.duration_sec] - how long to show (seconds)
 * @returns {{ ok: true, overlay_added, position, duration_sec, animation }}
 */
export async function addLikeReminder({ video, position = "bottom-left", style = "thumb", start_sec = 10, duration_sec = 5 } = {}) {
  const err = requireFields({ video }, ["video"]);
  if (err) return { ok: false, error: err };

  if (!VALID_LIKE_STYLES.includes(style)) {
    return { ok: false, error: "invalid_style", valid: VALID_LIKE_STYLES };
  }
  if (!VALID_POSITIONS.includes(position)) {
    return { ok: false, error: "invalid_position", valid: VALID_POSITIONS };
  }
  if (start_sec < 0) return { ok: false, error: "invalid_start_sec" };
  if (duration_sec <= 0) return { ok: false, error: "invalid_duration_sec" };

  const pos = computePosition(position);

  const animationMap = {
    thumb: "thumbs_up_pop",
    heart: "heart_burst",
    fire: "flame_flicker",
    star: "star_spin",
  };

  return {
    ok: true,
    overlay_added: true,
    position: { name: position, ...pos },
    duration_sec,
    start_sec,
    animation: animationMap[style],
    style,
    ffmpeg_filter: {
      type: "overlay",
      enable: `between(t,${start_sec},${start_sec + duration_sec})`,
      inputs: ["[0:v]", `[like:v]`],
      output: "[out]",
      params: {
        x: `W*${pos.x}`,
        y: `H*${pos.y}`,
      },
    },
  };
}

// ====================================================================
// 10. addCommentPrompt — comment engagement prompt overlay
// ====================================================================

/**
 * Add a comment prompt overlay to encourage viewer comments.
 *
 * @param {object} args
 * @param {string} args.video - video file path or URL
 * @param {string} [args.prompt] - prompt text
 * @param {string} [args.position] - position name
 * @param {number} [args.start_sec] - when to show (seconds)
 * @param {number} [args.duration_sec] - how long to show (seconds)
 * @returns {{ ok: true, overlay_added, prompt_text, position, duration_sec }}
 */
export async function addCommentPrompt({ video, prompt = "Comment below!", position = "bottom-center", start_sec = 15, duration_sec = 7 } = {}) {
  const err = requireFields({ video }, ["video"]);
  if (err) return { ok: false, error: err };

  if (!prompt || prompt.trim() === "") {
    return { ok: false, error: "prompt_required" };
  }
  if (!VALID_POSITIONS.includes(position)) {
    // Allow bottom-center as a custom position
    const extendedPositions = [...VALID_POSITIONS, "bottom-center"];
    if (!extendedPositions.includes(position)) {
      return { ok: false, error: "invalid_position", valid: extendedPositions };
    }
  }
  if (start_sec < 0) return { ok: false, error: "invalid_start_sec" };
  if (duration_sec <= 0) return { ok: false, error: "invalid_duration_sec" };

  const pos = position === "bottom-center"
    ? { x: 0.5, y: 0.9 }
    : computePosition(position);

  return {
    ok: true,
    overlay_added: true,
    prompt_text: prompt,
    position: { name: position, ...pos },
    duration_sec,
    start_sec,
    animation: "fade_in_out",
    ffmpeg_filter: {
      type: "drawtext",
      text: prompt,
      fontsize: 30,
      fontcolor: "#ffffff",
      box: 1,
      boxcolor: "#00000080",
      boxborderw: 10,
      x: `W*${pos.x}-text_w/2`,
      y: `H*${pos.y}`,
      enable: `between(t,${start_sec},${start_sec + duration_sec})`,
    },
  };
}

// ====================================================================
// Tool definitions (OpenAI function-calling shape)
// ====================================================================

export const GRAPHICS_OVERLAY_TOOLS = [
  {
    type: "function",
    function: {
      name: "add_logo",
      description:
        "Add a logo image overlay to a video at a specified position (top-left, top-right, bottom-left, bottom-right, center). Use when the user wants 'add my logo', 'put logo on video', 'brand watermark'.",
      parameters: {
        type: "object",
        required: ["video", "logo"],
        properties: {
          video: { type: "string", description: "Video file path or URL." },
          logo: { type: "string", description: "Logo image file path or URL." },
          position: { type: "string", enum: VALID_POSITIONS, default: "bottom-right" },
          size: { type: "number", minimum: 0.05, maximum: 0.4, description: "Size as fraction of frame." },
          opacity: { type: "number", minimum: 0, maximum: 1, default: 1.0 },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_watermark",
      description:
        "Add a watermark overlay to a video. Supports text, logo, diagonal repeating, and pattern styles. Use when the user wants 'watermark', 'brand my video', 'add text overlay'.",
      parameters: {
        type: "object",
        required: ["video"],
        properties: {
          video: { type: "string", description: "Video file path or URL." },
          text: { type: "string", description: "Watermark text (required for text style)." },
          style: { type: "string", enum: VALID_WATERMARK_STYLES, default: "text" },
          opacity: { type: "number", minimum: 0, maximum: 1, default: 0.3 },
          position: { type: "string", enum: VALID_POSITIONS, default: "bottom-right" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_social_icons",
      description:
        "Add social media platform icons (YouTube, Instagram, TikTok, Twitter, Facebook) as an overlay. Use when the user wants 'add social icons', 'show my social media', 'follow me overlay'.",
      parameters: {
        type: "object",
        required: ["video", "platforms"],
        properties: {
          video: { type: "string", description: "Video file path or URL." },
          platforms: {
            type: "array",
            items: { type: "string", enum: VALID_PLATFORMS },
            description: "List of social media platforms.",
          },
          position: { type: "string", enum: VALID_POSITIONS, default: "bottom-right" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_subscribe_reminder",
      description:
        "Add a subscribe call-to-action overlay. Styles: bell icon, button, text, or animated. Use when the user wants 'remind to subscribe', 'sub button overlay', 'YouTube subscribe prompt'.",
      parameters: {
        type: "object",
        required: ["video"],
        properties: {
          video: { type: "string", description: "Video file path or URL." },
          position: { type: "string", enum: VALID_POSITIONS, default: "bottom-right" },
          style: { type: "string", enum: VALID_SUBSCRIBE_STYLES, default: "button" },
          start_sec: { type: "number", minimum: 0, default: 5 },
          duration_sec: { type: "number", minimum: 1, default: 5 },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_end_screen",
      description:
        "Add an end screen with elements like subscribe, video, playlist, channel, or link. Up to 4 elements in a grid layout. Use when the user wants 'end screen', 'outro overlay', 'YouTube end card'.",
      parameters: {
        type: "object",
        required: ["video", "elements"],
        properties: {
          video: { type: "string", description: "Video file path or URL." },
          elements: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: { type: "string", enum: VALID_END_SCREEN_ELEMENTS },
                title: { type: "string" },
                url: { type: "string" },
              },
            },
            description: "End screen elements (max 4).",
          },
          start_sec: { type: "number", minimum: 0 },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_info_cards",
      description:
        "Add timestamped info cards that appear during playback. Max 5 cards with minimum 10s gap. Use when the user wants 'info cards', 'YouTube cards', 'timestamped links'.",
      parameters: {
        type: "object",
        required: ["video", "cards"],
        properties: {
          video: { type: "string", description: "Video file path or URL." },
          cards: {
            type: "array",
            items: {
              type: "object",
              properties: {
                time_sec: { type: "number", minimum: 0 },
                title: { type: "string" },
                url: { type: "string" },
                type: { type: "string", enum: ["video", "channel", "playlist", "link"] },
              },
            },
            description: "Info cards (max 5, 10s gap enforced).",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_progress_bar",
      description:
        "Add a video progress bar overlay. Styles: minimal, gradient, segmented, animated. Use when the user wants 'progress bar', 'timeline indicator', 'video progress overlay'.",
      parameters: {
        type: "object",
        required: ["video"],
        properties: {
          video: { type: "string", description: "Video file path or URL." },
          style: { type: "string", enum: VALID_PROGRESS_STYLES, default: "minimal" },
          position: { type: "string", enum: VALID_POSITIONS, default: "bottom-left" },
          color: { type: "string", description: "Hex color code." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_view_counter",
      description:
        "Add an animated view counter overlay. Styles: number display, bar graph, rising graph, milestone celebration. Use when the user wants 'view counter', 'view count overlay', 'subscriber count'.",
      parameters: {
        type: "object",
        required: ["video"],
        properties: {
          video: { type: "string", description: "Video file path or URL." },
          start_count: { type: "number", minimum: 0, default: 0 },
          style: { type: "string", enum: VALID_COUNTER_STYLES, default: "number" },
          position: { type: "string", enum: VALID_POSITIONS, default: "top-right" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_like_reminder",
      description:
        "Add a like reminder overlay to prompt viewers to like the video. Styles: thumbs up, heart, fire, star. Use when the user wants 'like reminder', 'smash that like button', 'like overlay'.",
      parameters: {
        type: "object",
        required: ["video"],
        properties: {
          video: { type: "string", description: "Video file path or URL." },
          position: { type: "string", enum: VALID_POSITIONS, default: "bottom-left" },
          style: { type: "string", enum: VALID_LIKE_STYLES, default: "thumb" },
          start_sec: { type: "number", minimum: 0, default: 10 },
          duration_sec: { type: "number", minimum: 1, default: 5 },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_comment_prompt",
      description:
        "Add a comment prompt overlay to encourage viewer comments. Shows a text prompt with a fade animation. Use when the user wants 'comment prompt', 'ask for comments', 'engagement overlay'.",
      parameters: {
        type: "object",
        required: ["video"],
        properties: {
          video: { type: "string", description: "Video file path or URL." },
          prompt: { type: "string", default: "Comment below!" },
          position: { type: "string", enum: [...VALID_POSITIONS, "bottom-center"], default: "bottom-center" },
          start_sec: { type: "number", minimum: 0, default: 15 },
          duration_sec: { type: "number", minimum: 1, default: 7 },
        },
      },
    },
  },
];

export const GRAPHICS_OVERLAY_TOOL_NAMES = new Set(GRAPHICS_OVERLAY_TOOLS.map((t) => t.function.name));
