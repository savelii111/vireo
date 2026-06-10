/**
 * Vireo Studio - One-Shot Creation Engine
 *
 * idea → published video in 2 minutes.
 * The ultimate user experience: type what you want, AI does everything.
 *
 * Classes:
 *   - OneShotEngine    — Orchestrates the full pipeline
 *   - IdeaParser       — Parses freeform text into structured intent
 *   - ThumbnailGenerator — Generates and ranks thumbnail variants
 *   - SEOGenerator     — Produces titles, descriptions, tags, hashtags
 *   - PublishingQueue  — Manages multi-platform publish jobs
 */

import { randomUUID } from "node:crypto";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function hashString(str) {
  let h = 0;
  for (let i = 0; i < (str || "").length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function seededRandom(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function now() {
  return Date.now();
}

function elapsed(start) {
  return now() - start;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const VALID_PLATFORMS = [
  "youtube", "tiktok", "instagram_reels", "instagram_feed",
  "instagram_story", "twitter", "facebook", "linkedin"
];

const DEFAULT_PLATFORMS = ["youtube", "tiktok", "instagram_reels"];

const STYLE_KEYWORDS = {
  cinematic: ["cinematic", "film", "movie", "dramatic", "epic", "professional"],
  fast: ["fast", "quick", "snappy", "energetic", "dynamic", "rapid"],
  slow: ["slow", "calm", "peaceful", "relaxed", "gentle", "chill"],
  funny: ["funny", "comedy", "meme", "hilarious", "silly", "laugh"],
  educational: ["tutorial", "how-to", "learn", "teach", "explain", "guide"],
  vlog: ["vlog", "daily", "day in the life", "morning routine", "travel"],
  product: ["product", "ad", "commercial", "promo", "showcase", "review"],
  music: ["music", "visualizer", "beat", "audio", "soundtrack", "lyrics"],
  news: ["news", "report", "update", "breaking", "headline", "press"],
};

const MOOD_KEYWORDS = {
  energetic: ["energetic", "hype", "excited", "pumped", "high-energy"],
  calm: ["calm", "peaceful", "serene", "zen", "relaxing", "chill", "lo-fi"],
  dramatic: ["dramatic", "intense", "epic", "powerful", "suspense"],
  funny: ["funny", "humorous", "silly", "wacky", "goofy"],
  sad: ["sad", "melancholy", "emotional", "touching", "heartfelt"],
  inspiring: ["inspiring", "motivational", "uplifting", "empowering"],
  professional: ["professional", "corporate", "formal", "business"],
  trendy: ["trending", "viral", "tiktok", "trendy", "hot"],
};

const SCENE_KEYWORDS = {
  landscape: ["landscape", "scenic", "nature", "mountain", "ocean", "sky", "sunset", "sunrise"],
  closeup: ["closeup", "macro", "detail", "face", "portrait", "eyes"],
  action: ["action", "运动", "sports", "running", "jumping", "extreme"],
  talking: ["talking", "speak", "explain", "interview", "host", "presenter"],
  transition: ["transition", "scene change", "cut", "wipe"],
  screen: ["screen", "screenshot", "desktop", "phone", "UI", "app"],
  aerial: ["aerial", "drone", "bird's eye", "overhead", "flyover"],
  timelapse: ["time lapse", "timelapse", "speed up", "fast forward"],
};

const THUMBNAIL_STYLES = ["bold_text", "face_closeup", "split_screen", "gradient_overlay", "minimal"];

const DEFAULT_DURATION = 30;

const CREDIT_COSTS = {
  idea_parsing: 0,
  video_generation: 10,
  ai_editing: 5,
  music_generation: 3,
  thumbnail_generation: 2,
  export: 1,
  seo_generation: 0,
};

// ═══════════════════════════════════════════════════════════════════════════════
// 1. IdeaParser
// ═══════════════════════════════════════════════════════════════════════════════

export class IdeaParser {
  /**
   * Parse a freeform idea string into structured intent.
   */
  parse(idea) {
    if (!idea || typeof idea !== "string") {
      throw new Error("Idea must be a non-empty string");
    }

    const lower = idea.toLowerCase();

    // Extract subject: strip common prefixes
    let subject = idea;
    const prefixes = [
      /^(make|create|build|generate|produce|film|shoot|edit)\s+(a\s+)?/i,
      /^(i want|make me|i need|can you|please)\s+/i,
    ];
    for (const p of prefixes) {
      subject = subject.replace(p, "");
    }
    // Remove trailing punctuation
    subject = subject.replace(/[.!?]+$/, "").trim();

    // Detect mood
    const mood = [];
    for (const [moodName, keywords] of Object.entries(MOOD_KEYWORDS)) {
      if (keywords.some((kw) => lower.includes(kw))) {
        mood.push(moodName);
      }
    }
    if (mood.length === 0) mood.push("neutral");

    // Detect style
    let style = "cinematic";
    let styleScore = 0;
    for (const [styleName, keywords] of Object.entries(STYLE_KEYWORDS)) {
      const score = keywords.filter((kw) => lower.includes(kw)).length;
      if (score > styleScore) {
        styleScore = score;
        style = styleName;
      }
    }

    // Detect scene types
    const sceneTypes = [];
    for (const [sceneName, keywords] of Object.entries(SCENE_KEYWORDS)) {
      if (keywords.some((kw) => lower.includes(kw))) {
        sceneTypes.push(sceneName);
      }
    }

    // Detect platforms
    const platforms = [];
    const platformKeywords = {
      youtube: ["youtube", "yt", "long-form"],
      tiktok: ["tiktok", "tt", "short-form", "viral"],
      instagram_reels: ["instagram reels", "ig reels", "reels"],
      instagram_feed: ["instagram feed", "ig post", "feed post"],
      instagram_story: ["instagram story", "ig story", "story"],
      twitter: ["twitter", "tweet", "x post"],
      facebook: ["facebook", "fb"],
      linkedin: ["linkedin"],
    };
    for (const [plat, keywords] of Object.entries(platformKeywords)) {
      if (keywords.some((kw) => lower.includes(kw))) {
        platforms.push(plat);
      }
    }

    // Detect duration preference
    let durationPreference = "auto";
    const durMatch = lower.match(/(\d+)\s*(seconds?|mins?|minutes?|sec|min)/);
    if (durMatch) {
      const val = parseInt(durMatch[1], 10);
      const unit = durMatch[2];
      if (unit.startsWith("min")) {
        durationPreference = `${val * 60}s`;
      } else {
        durationPreference = `${val}s`;
      }
    } else if (lower.includes("short") || lower.includes("quick")) {
      durationPreference = "15s";
    } else if (lower.includes("long") || lower.includes("extended")) {
      durationPreference = "120s";
    }

    // Detect music mood
    let musicMood = mood[0] || "neutral";
    const musicKw = {
      chill: ["chill", "lo-fi", "lofi", "relaxing", "ambient"],
      upbeat: ["upbeat", "energetic", "happy", "fun"],
      dramatic: ["dramatic", "intense", "orchestral", "epic"],
      hip_hop: ["hip hop", "trap", "rap", "beats"],
      electronic: ["electronic", "edm", "synth", "techno"],
      acoustic: ["acoustic", "guitar", "piano", "instrumental"],
    };
    for (const [moodName, keywords] of Object.entries(musicKw)) {
      if (keywords.some((kw) => lower.includes(kw))) {
        musicMood = moodName;
        break;
      }
    }

    // Text overlay detection
    const textOverlay = /\b(text|overlay|subtitle|caption|title card|lower third)\b/i.test(idea);

    // Face detection signal
    const faces = /\b(face|person|people|talking|host|presenter|interview|selfie)\b/i.test(idea);

    // Compute confidence based on how many signals we found
    let signalCount = 0;
    if (mood[0] !== "neutral") signalCount++;
    if (styleScore > 0) signalCount++;
    if (sceneTypes.length > 0) signalCount++;
    if (platforms.length > 0) signalCount++;
    if (durationPreference !== "auto") signalCount++;
    if (textOverlay) signalCount++;
    if (faces) signalCount++;
    const confidence = clamp(signalCount / 7, 0.1, 1.0);

    return {
      subject,
      mood,
      duration_preference: durationPreference,
      platforms: platforms.length > 0 ? platforms : [],
      style,
      music_mood: musicMood,
      text_overlay: textOverlay,
      faces,
      scene_types: sceneTypes,
      confidence: Math.round(confidence * 100) / 100,
    };
  }

  /**
   * Suggest optimal duration from parsed intent.
   */
  suggestDuration(intent) {
    if (intent.duration_preference !== "auto") {
      const num = parseInt(intent.duration_preference, 10);
      if (!isNaN(num) && num > 0) return num;
    }

    // Style-based defaults
    const styleDurations = {
      fast: 15,
      funny: 30,
      product: 30,
      vlog: 60,
      educational: 90,
      cinematic: 45,
      music: 30,
      news: 60,
    };

    return styleDurations[intent.style] || DEFAULT_DURATION;
  }

  /**
   * Suggest platforms from parsed intent.
   */
  suggestPlatform(intent) {
    if (intent.platforms && intent.platforms.length > 0) {
      return intent.platforms;
    }
    return [...DEFAULT_PLATFORMS];
  }

  /**
   * Suggest style from parsed intent.
   */
  suggestStyle(intent) {
    return intent.style || "cinematic";
  }

  /**
   * Enrich intent with template defaults and missing fields.
   */
  enrichIntent(intent, template = null) {
    const enriched = deepClone(intent);

    // Apply template overrides if provided
    if (template) {
      // Only apply template defaults for fields still at their default/empty values
      if (template.default_style && enriched.style === "cinematic") {
        enriched.style = template.default_style;
      }
      if (template.default_platforms && enriched.platforms.length === 0) {
        enriched.platforms = [...template.default_platforms];
      }
      if (template.default_mood && enriched.mood.length === 1 && enriched.mood[0] === "neutral") {
        enriched.mood = [template.default_mood];
      }
      if (template.default_duration && enriched.duration_preference === "auto") {
        enriched.duration_preference = `${template.default_duration}s`;
      }
      if (template.default_music_mood && enriched.music_mood === "neutral") {
        enriched.music_mood = template.default_music_mood;
      }
      if (template.scene_types && enriched.scene_types.length === 0) {
        enriched.scene_types = [...template.scene_types];
      }
      if (template.text_overlay !== undefined) enriched.text_overlay = template.text_overlay;
    }

    // Fill defaults
    if (enriched.platforms.length === 0) enriched.platforms = [...DEFAULT_PLATFORMS];
    if (enriched.mood.length === 0) enriched.mood = ["neutral"];
    if (!enriched.duration_preference || enriched.duration_preference === "auto") {
      enriched.duration_preference = `${this.suggestDuration(enriched)}s`;
    }

    return enriched;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. ThumbnailGenerator
// ═══════════════════════════════════════════════════════════════════════════════

export class ThumbnailGenerator {
  constructor() {
    this._variantsPerVideo = 3;
  }

  /**
   * Generate 3 thumbnail variants for a video result.
   */
  generate(videoResult) {
    if (!videoResult) throw new Error("videoResult is required");

    const subject = videoResult.metadata?.title || videoResult.video?.timeline?.title || "Video";
    const hash = hashString(subject);
    const rng = seededRandom(hash);

    const thumbnails = [];

    for (let i = 0; i < this._variantsPerVideo; i++) {
      const style = THUMBNAIL_STYLES[i % THUMBNAIL_STYLES.length];
      const textOverlay = this._generateTextOverlay(subject, style);
      const ctrScore = Math.round((0.3 + rng() * 0.6) * 100) / 100;

      thumbnails.push({
        url: `thumb://${randomUUID()}`,
        style,
        text_overlay: textOverlay,
        ctr_score: ctrScore,
        width: 1280,
        height: 720,
        format: "jpg",
      });
    }

    return thumbnails;
  }

  /**
   * Pick the thumbnail with the highest predicted CTR.
   */
  selectBest(thumbnails) {
    if (!thumbnails || thumbnails.length === 0) {
      throw new Error("At least one thumbnail required");
    }
    return thumbnails.reduce((best, t) =>
      t.ctr_score > best.ctr_score ? t : best
    );
  }

  /** @private */
  _generateTextOverlay(subject, style) {
    const words = subject.split(/\s+/).slice(0, 4);
    const text = words.join(" ");

    const overlays = {
      bold_text: { text, position: "center", font_size: 72, color: "#FFFFFF", shadow: true },
      face_closeup: { text: "", position: "none", font_size: 0, color: "", shadow: false },
      split_screen: { text, position: "right", font_size: 48, color: "#FFFFFF", shadow: true },
      gradient_overlay: { text, position: "bottom", font_size: 40, color: "#FFFFFF", shadow: false },
      minimal: { text, position: "top-left", font_size: 32, color: "#FFFFFF", shadow: false },
    };

    return overlays[style] || overlays.bold_text;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. SEOGenerator
// ═══════════════════════════════════════════════════════════════════════════════

export class SEOGenerator {
  constructor() {
    this._titleTemplates = [
      "{subject} — {mood} {style} Video",
      "{subject} | {mood} {style} Content",
      "🎬 {subject} ({mood})",
    ];
  }

  /**
   * Generate 3 title options.
   */
  generateTitle(videoResult) {
    const subject = videoResult.metadata?.title || "Amazing Video";
    const mood = videoResult.metadata?.tags?.[0] || "creative";
    const style = videoResult.video?.timeline?.style || "cinematic";

    return this._titleTemplates.map((tpl) =>
      tpl
        .replace("{subject}", subject)
        .replace("{mood}", mood)
        .replace("{style}", style)
    );
  }

  /**
   * Generate a description.
   */
  generateDescription(videoResult) {
    const subject = videoResult.metadata?.title || "This video";
    const tags = videoResult.metadata?.tags || [];
    const platforms = videoResult.platforms?.map((p) => p.platform) || [];

    let desc = `${subject}.\n\n`;
    if (tags.length > 0) {
      desc += `Topics: ${tags.slice(0, 5).join(", ")}.\n\n`;
    }
    if (platforms.length > 0) {
      const platNames = { youtube: "YouTube", tiktok: "TikTok", instagram_reels: "Instagram Reels",
        instagram_feed: "Instagram Feed", instagram_story: "Instagram Story", twitter: "Twitter",
        facebook: "Facebook", linkedin: "LinkedIn" };
      desc += `Available on: ${platforms.map((p) => platNames[p] || p.charAt(0).toUpperCase() + p.slice(1)).join(", ")}.\n\n`;
    }
    desc += `#VireoStudio #AIVideo`;
    return desc.trim();
  }

  /**
   * Generate tags array.
   */
  generateTags(videoResult) {
    const subject = videoResult.metadata?.title || "";
    const mood = videoResult.metadata?.tags || [];
    const words = subject.toLowerCase().split(/\s+/).filter((w) => w.length > 2);

    const tags = [...new Set([...words, ...mood])].slice(0, 20);
    return tags;
  }

  /**
   * Generate hashtags.
   */
  generateHashtags(videoResult) {
    const tags = this.generateTags(videoResult);
    const hashtags = tags
      .slice(0, 10)
      .map((t) => `#${t.replace(/[^a-zA-Z0-9]/g, "")}`)
      .filter((h) => h.length > 1);
    return ["#VireoStudio", ...hashtags];
  }

  /**
   * Generate complete SEO bundle.
   */
  generateComplete(videoResult) {
    const titles = this.generateTitle(videoResult);
    return {
      title: titles[0],
      title_options: titles,
      description: this.generateDescription(videoResult),
      tags: this.generateTags(videoResult),
      hashtags: this.generateHashtags(videoResult),
      optimal_post_time: this._optimalPostTime(),
    };
  }

  /** @private */
  _optimalPostTime() {
    // Returns best posting windows (simplified)
    return {
      weekday: "Tuesday",
      time_range: "10:00-14:00",
      timezone: "UTC",
      notes: "Mid-morning posts tend to get highest engagement",
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. PublishingQueue
// ═══════════════════════════════════════════════════════════════════════════════

export class PublishingQueue {
  constructor() {
    this._queue = new Map();
    this._processed = new Map();
  }

  /**
   * Add a video result to the publish queue for given platforms.
   */
  enqueue(videoResult, platforms) {
    if (!videoResult) throw new Error("videoResult is required");
    if (!platforms || platforms.length === 0) throw new Error("At least one platform required");

    const id = randomUUID();
    const item = {
      id,
      videoResult,
      platforms: platforms.map((p) => ({
        platform: p,
        status: "pending",
        url: null,
        error: null,
        attempts: 0,
      })),
      created_at: now(),
      status: "queued",
    };

    this._queue.set(id, item);
    return item;
  }

  /**
   * Process the next item in the queue.
   */
  processNext() {
    const firstKey = this._queue.keys().next().value;
    if (!firstKey) return null;

    const item = this._queue.get(firstKey);
    item.status = "processing";

    for (const plat of item.platforms) {
      if (plat.status === "pending") {
        plat.status = "processing";
        // Simulate processing
        plat.status = "published";
        plat.url = `https://${plat.platform}.com/video/${randomUUID().slice(0, 8)}`;
        plat.attempts++;
      }
    }

    item.status = "completed";
    item.completed_at = now();
    this._processed.set(item.id, item);
    this._queue.delete(item.id);

    return item;
  }

  /**
   * Get status of a queue item.
   */
  getStatus(queueId) {
    const item = this._queue.get(queueId) || this._processed.get(queueId);
    if (!item) return null;

    return {
      id: item.id,
      status: item.status,
      platforms: item.platforms.map((p) => ({
        platform: p.platform,
        status: p.status,
        url: p.url,
      })),
      created_at: item.created_at,
      completed_at: item.completed_at || null,
    };
  }

  /**
   * Get all queue items.
   */
  getQueue() {
    return Array.from(this._queue.values());
  }

  /**
   * Cancel a queue item.
   */
  cancel(queueId) {
    const item = this._queue.get(queueId);
    if (!item) return false;
    item.status = "cancelled";
    this._processed.set(queueId, item);
    this._queue.delete(queueId);
    return true;
  }

  /**
   * Retry a failed queue item.
   */
  retry(queueId) {
    const item = this._processed.get(queueId) || this._queue.get(queueId);
    if (!item) return null;

    item.status = "queued";
    for (const plat of item.platforms) {
      if (plat.status === "failed") {
        plat.status = "pending";
        plat.error = null;
      }
    }

    this._processed.delete(queueId);
    this._queue.set(queueId, item);
    return item;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. OneShotEngine
// ═══════════════════════════════════════════════════════════════════════════════

const TEMPLATES = {
  travel_vlog: {
    name: "Travel Vlog",
    description: "Auto-selects scenic footage with chill lo-fi music",
    default_style: "vlog",
    default_platforms: ["youtube", "instagram_reels"],
    default_mood: "calm",
    default_duration: 60,
    default_music_mood: "chill",
    scene_types: ["landscape", "aerial", "closeup"],
    text_overlay: true,
  },
  product_ad: {
    name: "Product Ad",
    description: "Closeup shots, energetic, strong CTA",
    default_style: "product",
    default_platforms: ["youtube", "tiktok", "instagram_reels"],
    default_mood: "energetic",
    default_duration: 30,
    default_music_mood: "upbeat",
    scene_types: ["closeup", "action"],
    text_overlay: true,
  },
  tutorial: {
    name: "Tutorial",
    description: "Screen recording style, calm, step-by-step",
    default_style: "educational",
    default_platforms: ["youtube"],
    default_mood: "calm",
    default_duration: 120,
    default_music_mood: "acoustic",
    scene_types: ["screen", "talking"],
    text_overlay: true,
  },
  social_reel: {
    name: "Social Reel",
    description: "9:16, fast cuts, trending audio",
    default_style: "fast",
    default_platforms: ["instagram_reels", "tiktok"],
    default_mood: "energetic",
    default_duration: 15,
    default_music_mood: "upbeat",
    scene_types: ["action", "closeup"],
    text_overlay: true,
  },
  podcast_clip: {
    name: "Podcast Clip",
    description: "Talking head with waveform and quote overlay",
    default_style: "cinematic",
    default_platforms: ["youtube", "twitter"],
    default_mood: "professional",
    default_duration: 60,
    default_music_mood: "chill",
    scene_types: ["talking"],
    text_overlay: true,
  },
  music_visualizer: {
    name: "Music Visualizer",
    description: "Beat-synced reactive graphics",
    default_style: "music",
    default_platforms: ["youtube", "instagram_reels"],
    default_mood: "energetic",
    default_duration: 30,
    default_music_mood: "electronic",
    scene_types: [],
    text_overlay: false,
  },
  news_report: {
    name: "News Report",
    description: "Formal style with lower thirds and breaking news format",
    default_style: "news",
    default_platforms: ["youtube", "twitter"],
    default_mood: "professional",
    default_duration: 90,
    default_music_mood: "dramatic",
    scene_types: ["talking", "landscape"],
    text_overlay: true,
  },
  meme_video: {
    name: "Meme Video",
    description: "Fast, funny, trending template",
    default_style: "funny",
    default_platforms: ["tiktok", "twitter"],
    default_mood: "funny",
    default_duration: 15,
    default_music_mood: "upbeat",
    scene_types: ["action", "closeup"],
    text_overlay: true,
  },
};

export class OneShotEngine {
  /**
   * @param {Object} opts
   * @param {Object} [opts.higgsfield_client]  - HiggsfieldClient instance
   * @param {Object} [opts.personalization]    - TasteProfile instance
   * @param {Object} [opts.ai_director]        - DirectorAgent instance
   */
  constructor({ higgsfield_client = null, personalization = null, ai_director = null } = {}) {
    this._higgsfield = higgsfield_client;
    this._personalization = personalization;
    this._director = ai_director;
    this._parser = new IdeaParser();
    this._thumbnailGen = new ThumbnailGenerator();
    this._seoGen = new SEOGenerator();
    this._publishQueue = new PublishingQueue();
    this._history = [];
  }

  /**
   * Create a complete video package from a text idea.
   *
   * @param {string} idea - Freeform text description
   * @param {Object} [options]
   * @param {string[]} [options.platforms] - Target platforms
   * @param {number}   [options.duration_sec] - Duration in seconds
   * @param {string}   [options.style] - Video style
   * @param {string}   [options.quality] - Quality preset
   * @returns {Promise<OneShotResult>}
   */
  async createFromIdea(idea, options = {}) {
    const startTime = now();
    const stages = [];
    const creditsUsed = { total: 0, breakdown: {} };

    // Stage 1: Parse idea
    const s1 = now();
    const intent = this._parser.parse(idea);
    const enriched = this._parser.enrichIntent(intent);
    // Apply option overrides
    if (options.platforms) enriched.platforms = options.platforms;
    if (options.duration_sec) enriched.duration_preference = `${options.duration_sec}s`;
    if (options.style) enriched.style = options.style;
    const duration = this._parser.suggestDuration(enriched);
    stages.push({ name: "idea_parsing", ms: elapsed(s1) });

    // Stage 2: Generate footage (via Higgsfield or placeholder)
    const s2 = now();
    const footage = await this._generateFootage(enriched, duration);
    creditsUsed.breakdown.video_gen = CREDIT_COSTS.video_generation;
    creditsUsed.total += CREDIT_COSTS.video_generation;
    stages.push({ name: "footage_generation", ms: elapsed(s2) });

    // Stage 3: AI Director pipeline
    const s3 = now();
    const timeline = await this._runDirectorPipeline(enriched, footage);
    creditsUsed.breakdown.ai_editing = CREDIT_COSTS.ai_editing;
    creditsUsed.total += CREDIT_COSTS.ai_editing;
    stages.push({ name: "ai_directing", ms: elapsed(s3) });

    // Stage 4: Apply personalization
    const s4 = now();
    const personalized = this._applyPersonalization(timeline, enriched);
    stages.push({ name: "personalization", ms: elapsed(s4) });

    // Stage 5: Export for all platforms
    const s5 = now();
    const exports = this._generateExports(enriched, personalized);
    creditsUsed.breakdown.export = CREDIT_COSTS.export * enriched.platforms.length;
    creditsUsed.total += creditsUsed.breakdown.export;
    stages.push({ name: "platform_export", ms: elapsed(s5) });

    // Stage 6: Generate thumbnails, titles, descriptions
    const s6 = now();
    const thumbnails = this._thumbnailGen.generate({
      metadata: { title: enriched.subject, tags: enriched.mood },
      video: { timeline: personalized },
    });
    const seo = this._seoGen.generateComplete({
      metadata: { title: enriched.subject, tags: enriched.mood },
      video: { timeline: personalized },
      platforms: enriched.platforms.map((p) => ({ platform: p })),
    });
    creditsUsed.breakdown.thumbnail_generation = CREDIT_COSTS.thumbnail_generation;
    creditsUsed.breakdown.seo_generation = CREDIT_COSTS.seo_generation;
    creditsUsed.total += CREDIT_COSTS.thumbnail_generation + CREDIT_COSTS.seo_generation;
    stages.push({ name: "thumbnail_seo", ms: elapsed(s6) });

    const bestThumbnail = this._thumbnailGen.selectBest(thumbnails);

    // Stage 7: Queue for publishing
    const s7 = now();
    const publishStatus = enriched.platforms.map((p) => ({
      platform: p,
      status: "ready_to_publish",
      url: null,
    }));
    stages.push({ name: "publish_prep", ms: elapsed(s7) });

    const totalTime = elapsed(startTime);

    const result = {
      video: {
        timeline: personalized,
        exports,
      },
      metadata: {
        title: seo.title,
        title_options: seo.title_options,
        description: seo.description,
        tags: seo.tags,
        thumbnail_url: bestThumbnail.url,
        thumbnail_best: bestThumbnail,
        all_thumbnails: thumbnails,
      },
      seo: {
        keywords: seo.tags,
        hashtags: seo.hashtags,
        optimal_post_time: seo.optimal_post_time,
      },
      platforms: publishStatus,
      timing: {
        total_ms: totalTime,
        stages,
      },
      credits_used: creditsUsed.total,
      credits_breakdown: creditsUsed.breakdown,
      id: randomUUID(),
      created_at: now(),
    };

    this._history.push({ idea, options, result_id: result.id, created_at: result.created_at });
    return result;
  }

  /**
   * Create video from an image reference + idea.
   */
  async createFromImage(imageUrl, idea, options = {}) {
    if (!imageUrl) throw new Error("imageUrl is required");
    if (!idea) throw new Error("idea is required");

    // Prepend image context to the idea
    const enrichedIdea = `Using reference image ${imageUrl}: ${idea}`;
    const result = await this.createFromIdea(enrichedIdea, options);

    // Add image reference metadata
    result.image_reference = imageUrl;
    result.video.timeline.reference_image = imageUrl;

    return result;
  }

  /**
   * Create multiple videos from multiple ideas.
   */
  async createBatch(ideas, options = {}) {
    if (!ideas || ideas.length === 0) throw new Error("At least one idea required");

    const results = [];
    for (const idea of ideas) {
      const result = await this.createFromIdea(idea, options);
      results.push(result);
    }
    return results;
  }

  /**
   * Get available pre-built templates.
   */
  getTemplates() {
    return Object.entries(TEMPLATES).map(([key, tpl]) => ({
      id: key,
      ...tpl,
    }));
  }

  /**
   * Create video from a template + customizations.
   */
  async createFromTemplate(templateName, customizations = {}) {
    const template = TEMPLATES[templateName];
    if (!template) {
      throw new Error(`Template "${templateName}" not found. Available: ${Object.keys(TEMPLATES).join(", ")}`);
    }

    // Build idea from template + customizations
    const idea = customizations.description || template.description;
    const intent = this._parser.parse(idea);
    const enriched = this._parser.enrichIntent(intent, template);

    // Apply customizations
    if (customizations.platforms) enriched.platforms = customizations.platforms;
    if (customizations.duration_sec) enriched.duration_preference = `${customizations.duration_sec}s`;
    if (customizations.style) enriched.style = customizations.style;
    if (customizations.mood) enriched.mood = [customizations.mood];
    if (customizations.music_mood) enriched.music_mood = customizations.music_mood;

    // Use the createFromIdea pipeline with enriched intent
    const duration = this._parser.suggestDuration(enriched);
    const result = await this.createFromIdea(enriched.subject, {
      platforms: enriched.platforms,
      duration_sec: duration,
      style: enriched.style,
    });

    result.template_used = templateName;
    return result;
  }

  /**
   * Estimate time for a given idea.
   */
  estimateTime(idea) {
    const intent = this._parser.parse(idea);
    const duration = this._parser.suggestDuration(intent);
    const platformCount = (intent.platforms.length || DEFAULT_PLATFORMS.length);

    // Rough estimates in ms
    const parsingMs = 10 + idea.length * 0.5;
    const generationMs = 5000 + duration * 100;
    const editingMs = 3000 + duration * 50;
    const exportMs = 1000 * platformCount;

    return {
      parsing_ms: Math.round(parsingMs),
      generation_ms: Math.round(generationMs),
      editing_ms: Math.round(editingMs),
      export_ms: Math.round(exportMs),
      total_ms: Math.round(parsingMs + generationMs + editingMs + exportMs),
    };
  }

  /**
   * Estimate credits for a given idea.
   */
  estimateCredits(idea) {
    const intent = this._parser.parse(idea);
    const platformCount = intent.platforms.length || DEFAULT_PLATFORMS.length;

    const videoGen = CREDIT_COSTS.video_generation;
    const editing = CREDIT_COSTS.ai_editing;
    const exportCost = CREDIT_COSTS.export * platformCount;
    const total = videoGen + editing + exportCost;

    let planRecommended = "free";
    if (total > 50) planRecommended = "enterprise";
    else if (total > 20) planRecommended = "pro";
    else if (total > 5) planRecommended = "starter";

    return {
      video_gen: videoGen,
      editing,
      export: exportCost,
      total,
      plan_recommended: planRecommended,
    };
  }

  // ── Private pipeline methods ──────────────────────────────────────────────

  async _generateFootage(intent, duration) {
    // If Higgsfield client is available, use it; otherwise simulate
    if (this._higgsfield && typeof this._higgsfield.generateVideo === "function") {
      try {
        return await this._higgsfield.generateVideo({
          prompt: intent.subject,
          duration,
          style: intent.style,
        });
      } catch {
        // Fall through to simulated footage
      }
    }

    // Simulated footage generation
    const clipCount = Math.max(2, Math.ceil(duration / 5));
    return Array.from({ length: clipCount }, (_, i) => ({
      id: `clip-${randomUUID().slice(0, 8)}`,
      path: `generated_clip_${i}.mp4`,
      duration_sec: duration / clipCount,
      scene_type: intent.scene_types[i % (intent.scene_types.length || 1)] || "action",
      mood: intent.mood[i % intent.mood.length] || "neutral",
      quality_score: 0.8,
      source: "higgsfield_simulated",
    }));
  }

  async _runDirectorPipeline(intent, footage) {
    // If AI Director is available, use it
    if (this._director && typeof this._director.composeTimeline === "function") {
      try {
        const brief = {
          description: intent.subject,
          footage: Array.isArray(footage) ? footage : [footage],
          duration_sec: this._parser.suggestDuration(intent),
          platforms: intent.platforms,
          style: intent.style,
          music_mood: intent.music_mood,
          text_overlay: intent.text_overlay,
        };
        return await this._director.composeTimeline(brief);
      } catch {
        // Fall through to simulated timeline
      }
    }

    // Simulated timeline composition
    const duration = this._parser.suggestDuration(intent);
    const clips = Array.isArray(footage) ? footage : [footage];

    return {
      title: intent.subject,
      duration_sec: duration,
      style: intent.style,
      clips: clips.slice(0, Math.ceil(duration / 5)),
      transitions: clips.slice(1).map(() => ({ type: "crossfade", duration: 0.5 })),
      music: {
        mood: intent.music_mood,
        volume: 0.3,
        source: "generated",
      },
      text_overlays: intent.text_overlay
        ? [{ text: intent.subject, position: "top", start: 0, end: 3 }]
        : [],
    };
  }

  _applyPersonalization(timeline, intent) {
    const result = deepClone(timeline);

    if (this._personalization) {
      // Apply learned preferences
      if (this._personalization.preferences) {
        const prefs = this._personalization.preferences;
        if (prefs.color) result.color_grade = prefs.color;
        if (prefs.pacing) result.pacing = prefs.pacing;
        if (prefs.transitions) {
          result.transitions = result.transitions.map((t) => ({
            ...t,
            type: prefs.transitions.preferred || t.type,
          }));
        }
      }
    }

    result.personalized = true;
    return result;
  }

  _generateExports(intent, timeline) {
    const exports = [];

    for (const platform of intent.platforms) {
      const specs = this._getPlatformSpec(platform);
      exports.push({
        platform,
        resolution: specs.resolution,
        aspect_ratio: specs.aspect_ratio,
        codec: specs.codec,
        duration_sec: Math.min(timeline.duration_sec, specs.max_duration),
        file: `${timeline.title || "video"}_${platform}.mp4`,
        status: "ready",
      });
    }

    return exports;
  }

  _getPlatformSpec(platform) {
    const specs = {
      youtube: { resolution: "1920x1080", aspect_ratio: "16:9", codec: "h264", max_duration: 43200 },
      tiktok: { resolution: "1080x1920", aspect_ratio: "9:16", codec: "h264", max_duration: 600 },
      instagram_reels: { resolution: "1080x1920", aspect_ratio: "9:16", codec: "h264", max_duration: 90 },
      instagram_feed: { resolution: "1080x1080", aspect_ratio: "1:1", codec: "h264", max_duration: 60 },
      instagram_story: { resolution: "1080x1920", aspect_ratio: "9:16", codec: "h264", max_duration: 15 },
      twitter: { resolution: "1280x720", aspect_ratio: "16:9", codec: "h264", max_duration: 140 },
      facebook: { resolution: "1920x1080", aspect_ratio: "16:9", codec: "h264", max_duration: 240 },
      linkedin: { resolution: "1920x1080", aspect_ratio: "16:9", codec: "h264", max_duration: 600 },
    };
    return specs[platform] || specs.youtube;
  }
}

export { TEMPLATES, VALID_PLATFORMS, DEFAULT_PLATFORMS, CREDIT_COSTS, THUMBNAIL_STYLES };
