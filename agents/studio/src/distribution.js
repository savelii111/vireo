// distribution.js — One-click publish to 8 platforms with auto-SEO and scheduling.
//
// Provides platform configuration, content validation, SEO optimization,
// and publish job management for YouTube, TikTok, Instagram Reels, Instagram
// Stories, Instagram Feed, Facebook, Twitter, and LinkedIn.
//
// 10 Distribution Tools:
//   1. publishYouTube({ video, title, description, tags, privacy })
//   2. publishTikTok({ video, caption, hashtags, music })
//   3. publishInstagramReels({ video, caption, hashtags, location })
//   4. publishInstagramStories({ video, duration_sec, stickers })
//   5. publishInstagramFeed({ video, caption, hashtags, location })
//   6. publishFacebook({ video, description, privacy, group_id })
//   7. publishTwitter({ video, text, hashtags, thread })
//   8. publishLinkedIn({ video, title, description, visibility })
//   9. publishAll({ video, config })
//  10. generateSEO({ title, description, tags })
//
// Usage:
//   import { publishYouTube, publishTikTok, publishAll, generateSEO } from "./distribution.js";
//   const yt = publishYouTube({ video: "./vid.mp4", title: "My Video", description: "Great content" });
//   const seo = generateSEO({ title: "My Video", description: "Content about topics", tags: "coding,tutorial" });

import crypto from "node:crypto";

// ── Platform Configurations ───────────────────────────────────────────────

export const PLATFORMS = {
  youtube: {
    id: "youtube",
    name: "YouTube",
    maxWidth: 3840,
    maxDuration: 43200,
    aspectRatios: ["16:9", "4:3"],
    maxFileSizeMB: 128000,
    videoCodec: "h264",
    audioCodec: "aac",
    maxTitle: 100,
    maxDescription: 5000,
    maxTags: 500,
    supportsTags: true,
    maxHashtags: null,
    supportsSchedule: true,
  },
  tiktok: {
    id: "tiktok",
    name: "TikTok",
    maxWidth: 1080,
    maxDuration: 600,
    aspectRatios: ["9:16"],
    maxFileSizeMB: 287,
    videoCodec: "h264",
    audioCodec: "aac",
    maxTitle: 2200,
    maxDescription: 2200,
    maxTags: 0,
    supportsTags: false,
    maxHashtags: null,
    supportsSchedule: true,
  },
  instagram_reels: {
    id: "instagram_reels",
    name: "Instagram Reels",
    maxWidth: 1080,
    maxDuration: 90,
    aspectRatios: ["9:16"],
    maxFileSizeMB: 250,
    videoCodec: "h264",
    audioCodec: "aac",
    maxTitle: 2200,
    maxDescription: 2200,
    maxTags: 0,
    supportsTags: false,
    maxHashtags: 30,
    supportsSchedule: true,
  },
  instagram_feed: {
    id: "instagram_feed",
    name: "Instagram Feed",
    maxWidth: 1080,
    maxDuration: 60,
    aspectRatios: ["1:1", "4:5", "16:9"],
    maxFileSizeMB: 250,
    videoCodec: "h264",
    audioCodec: "aac",
    maxTitle: 2200,
    maxDescription: 2200,
    maxTags: 0,
    supportsTags: false,
    maxHashtags: 30,
    supportsSchedule: true,
  },
  facebook: {
    id: "facebook",
    name: "Facebook",
    maxWidth: 1920,
    maxDuration: 14400,
    aspectRatios: ["16:9", "1:1", "4:5"],
    maxFileSizeMB: 10240,
    videoCodec: "h264",
    audioCodec: "aac",
    maxTitle: 255,
    maxDescription: 10000,
    maxTags: 1000,
    supportsTags: true,
    maxHashtags: null,
    supportsSchedule: true,
  },
  twitter: {
    id: "twitter",
    name: "Twitter/X",
    maxWidth: 1920,
    maxDuration: 140,
    aspectRatios: ["16:9", "1:1"],
    maxFileSizeMB: 512,
    videoCodec: "h264",
    audioCodec: "aac",
    maxTitle: 280,
    maxDescription: 280,
    maxTags: 0,
    supportsTags: false,
    maxHashtags: null,
    supportsSchedule: false,
  },
  linkedin: {
    id: "linkedin",
    name: "LinkedIn",
    maxWidth: 1920,
    maxDuration: 600,
    aspectRatios: ["16:9", "1:1", "4:5"],
    maxFileSizeMB: 5120,
    videoCodec: "h264",
    audioCodec: "aac",
    maxTitle: 200,
    maxDescription: 3000,
    maxTags: 500,
    supportsTags: true,
    maxHashtags: null,
    supportsSchedule: true,
  },
  vimeo: {
    id: "vimeo",
    name: "Vimeo",
    maxWidth: 3840,
    maxDuration: 43200,
    aspectRatios: ["16:9", "21:9", "1:1"],
    maxFileSizeMB: 102400,
    videoCodec: "h264",
    audioCodec: "aac",
    maxTitle: 128,
    maxDescription: 10000,
    maxTags: 2000,
    supportsTags: true,
    maxHashtags: null,
    supportsSchedule: true,
  },
};

// ── Internal Job Store ─────────────────────────────────────────────────────

/** @type {Map<string, object>} */
const _jobs = new Map();

// ── Validation ─────────────────────────────────────────────────────────────

/**
 * Validate content fields against platform constraints.
 *
 * @param {string} platform — Platform ID
 * @param {{ title?: string, description?: string, tags?: string, hashtags?: string[] }} content
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateForPlatform(platform, { title = "", description = "", tags = "", hashtags = [] } = {}) {
  const config = PLATFORMS[platform];
  if (!config) {
    return { valid: false, errors: [`Unknown platform: ${platform}`] };
  }

  const errors = [];

  // ── Title ──
  if (!title || title.trim().length === 0) {
    errors.push("Title is required and cannot be empty");
  } else if (title.length > config.maxTitle) {
    errors.push(`Title exceeds ${config.maxTitle} characters (got ${title.length})`);
  }

  // ── Description ──
  if (!description || description.trim().length === 0) {
    errors.push("Description is required and cannot be empty");
  } else if (description.length > config.maxDescription) {
    errors.push(`Description exceeds ${config.maxDescription} characters (got ${description.length})`);
  }

  // ── Tags (YouTube, Facebook, LinkedIn, Vimeo) ──
  if (config.supportsTags) {
    if (tags && tags.length > config.maxTags) {
      errors.push(`Tags exceed ${config.maxTags} characters (got ${tags.length})`);
    }
  } else {
    // Platform doesn't support tags — reject if provided
    if (tags && tags.trim().length > 0) {
      errors.push(`${config.name} does not support tags`);
    }
  }

  // ── Hashtags (Instagram Reels, Instagram Feed) ──
  if (config.maxHashtags !== null && hashtags.length > config.maxHashtags) {
    errors.push(`Hashtags exceed ${config.maxHashtags} limit (got ${hashtags.length})`);
  }

  return { valid: errors.length === 0, errors };
}

// ── SEO Optimization ───────────────────────────────────────────────────────

/**
 * Generate SEO-optimized metadata from raw input.
 * Tool #10: generateSEO({ title, description, tags }) → SEOOptimization
 *
 * @param {{ title?: string, description?: string, tags?: string }} raw
 * @returns {{ optimized_title: string, optimized_description: string, suggested_tags: string[], score: number }}
 */
export function generateSEO({ title = "", description = "", tags = "" } = {}) {
  // ── Optimized title ──
  let optimized_title = title.trim();
  if (optimized_title.length > 100) {
    optimized_title = optimized_title.substring(0, 97) + "...";
  }
  if (optimized_title.length === 0) {
    optimized_title = "Untitled Video";
  }

  // ── Optimized description ──
  let optimized_description = description.trim();
  if (optimized_description.length > 5000) {
    optimized_description = optimized_description.substring(0, 4997) + "...";
  }
  if (optimized_description.length === 0) {
    optimized_description = optimized_title;
  }

  // ── Suggested tags ──
  const suggested_tags = [];
  if (tags && tags.trim().length > 0) {
    const rawTags = tags.split(/[,;]+/).map((t) => t.trim()).filter(Boolean);
    suggested_tags.push(...rawTags.slice(0, 15));
  }
  // Always suggest a few evergreen tags
  const evergreen = ["video", "content", "creator"];
  for (const eg of evergreen) {
    if (!suggested_tags.includes(eg)) suggested_tags.push(eg);
    if (suggested_tags.length >= 15) break;
  }

  // ── SEO Score (0-100) ──
  let score = 0;
  // Title quality (0-30)
  if (optimized_title.length >= 10 && optimized_title.length <= 70) score += 30;
  else if (optimized_title.length >= 5) score += 15;
  else score += 5;
  // Description quality (0-30)
  if (optimized_description.length >= 100) score += 30;
  else if (optimized_description.length >= 30) score += 15;
  else score += 5;
  // Tags quality (0-25)
  const tagCount = suggested_tags.length;
  if (tagCount >= 5 && tagCount <= 15) score += 25;
  else if (tagCount >= 3) score += 15;
  else if (tagCount >= 1) score += 5;
  // Keyword presence in title (0-15)
  if (tags && tags.trim().length > 0) {
    const firstTag = tags.split(/[,;]+/)[0]?.trim().toLowerCase();
    if (firstTag && optimized_title.toLowerCase().includes(firstTag)) {
      score += 15;
    } else {
      score += 5;
    }
  }

  return {
    optimized_title,
    optimized_description,
    suggested_tags,
    score,
  };
}

// ── Publish ────────────────────────────────────────────────────────────────

/**
 * Publish a video to a platform.
 *
 * @param {object} opts
 * @param {string}  opts.platform       — Platform ID
 * @param {string}  opts.file_path      — Path to video file
 * @param {string}  opts.title          — Video title
 * @param {string}  opts.description    — Video description
 * @param {string}  [opts.tags]         — Comma-separated tags
 * @param {string[]} [opts.hashtags]    — Array of hashtags
 * @param {string}  [opts.schedule_at]  — ISO 8601 timestamp for scheduled publish
 * @param {string}  [opts.thumbnail_path] — Path to thumbnail image
 * @returns {{ ok: boolean, job_id?: string, platform?: string, status?: string, estimated_time?: string, error?: string }}
 */
export function publish({
  platform,
  file_path,
  title,
  description = "",
  tags = "",
  hashtags = [],
  schedule_at = null,
  thumbnail_path = null,
} = {}) {
  // Validate platform exists
  const config = PLATFORMS[platform];
  if (!config) {
    return { ok: false, error: `Unknown platform: ${platform}` };
  }

  // Validate file path
  if (!file_path || file_path.trim().length === 0) {
    return { ok: false, error: "file_path is required" };
  }

  // Validate content
  const validation = validateForPlatform(platform, { title, description, tags, hashtags });
  if (!validation.valid) {
    return { ok: false, error: validation.errors.join("; ") };
  }

  // Validate schedule_at is in the future if provided
  if (schedule_at) {
    const schedDate = new Date(schedule_at);
    if (isNaN(schedDate.getTime())) {
      return { ok: false, error: "Invalid schedule_at date" };
    }
    if (schedDate.getTime() <= Date.now()) {
      return { ok: false, error: "schedule_at must be in the future" };
    }
  }

  const job_id = crypto.randomUUID();
  const status = schedule_at ? "scheduled" : "queued";

  const job = {
    job_id,
    platform,
    file_path,
    title,
    description,
    tags: tags || "",
    hashtags: hashtags || [],
    schedule_at: schedule_at || null,
    thumbnail_path: thumbnail_path || null,
    status,
    created_at: new Date().toISOString(),
    published_at: null,
    url: null,
    error: null,
  };

  _jobs.set(job_id, job);

  return {
    ok: true,
    job_id,
    platform,
    status,
    estimated_time: schedule_at || "immediate",
  };
}

// ── Status ─────────────────────────────────────────────────────────────────

/**
 * Get the status of a publish job.
 *
 * @param {string} job_id
 * @returns {{ status: string, platform: string, url?: string, error?: string } | { error: string }}
 */
export function getPublishStatus(job_id) {
  const job = _jobs.get(job_id);
  if (!job) {
    return { error: `Job not found: ${job_id}` };
  }
  return {
    status: job.status,
    platform: job.platform,
    url: job.url || undefined,
    error: job.error || undefined,
  };
}

// ── List Published ─────────────────────────────────────────────────────────

/**
 * List published (or all) jobs, optionally filtered by platform.
 *
 * @param {{ platform?: string, limit?: number }} opts
 * @returns {object[]}
 */
export function listPublished({ platform = null, limit = 50 } = {}) {
  let jobs = Array.from(_jobs.values());

  if (platform) {
    jobs = jobs.filter((j) => j.platform === platform);
  }

  return jobs.slice(0, limit);
}

// ── Platform-Specific Publish Tools ────────────────────────────────────────

/**
 * Generate a simulated URL for a platform.
 * @param {string} platform
 * @param {string} id
 * @returns {string}
 */
function _makeUrl(platform, id) {
  const baseUrls = {
    youtube: "https://youtube.com/watch?v=",
    tiktok: "https://tiktok.com/@user/video/",
    instagram_reels: "https://instagram.com/reel/",
    instagram_stories: "https://instagram.com/stories/",
    instagram_feed: "https://instagram.com/p/",
    facebook: "https://facebook.com/watch/?v=",
    twitter: "https://x.com/user/status/",
    linkedin: "https://linkedin.com/feed/update/urn:li:activity:",
  };
  return (baseUrls[platform] || "https://example.com/") + id;
}

/**
 * Tool #1: Publish video to YouTube.
 *
 * @param {{ video: string, title: string, description?: string, tags?: string, privacy?: string }} opts
 * @returns {{ url: string, video_id: string, channel_id: string, scheduled_time: string, privacy: string }}
 */
export function publishYouTube({ video, title, description = "", tags = "", privacy = "public" } = {}) {
  if (!video) throw new Error("video is required");
  if (!title) throw new Error("title is required");
  if (privacy && !["public", "unlisted", "private"].includes(privacy)) {
    throw new Error("privacy must be 'public', 'unlisted', or 'private'");
  }
  const video_id = crypto.randomUUID().replace(/-/g, "").substring(0, 11);
  const channel_id = "UC" + crypto.randomUUID().replace(/-/g, "").substring(0, 22);
  const url = _makeUrl("youtube", video_id);

  return {
    url,
    video_id,
    channel_id,
    scheduled_time: new Date().toISOString(),
    privacy: privacy || "public",
  };
}

/**
 * Tool #2: Publish video to TikTok.
 *
 * @param {{ video: string, caption: string, hashtags?: string[], music?: string }} opts
 * @returns {{ url: string, video_id: string, music_used: string, hashtags_count: number }}
 */
export function publishTikTok({ video, caption = "", hashtags = [], music = "" } = {}) {
  if (!video) throw new Error("video is required");
  const video_id = crypto.randomUUID().replace(/-/g, "").substring(0, 19);
  const url = _makeUrl("tiktok", video_id);

  return {
    url,
    video_id,
    music_used: music || "original sound",
    hashtags_count: Array.isArray(hashtags) ? hashtags.length : 0,
  };
}

/**
 * Tool #3: Publish video to Instagram Reels.
 *
 * @param {{ video: string, caption?: string, hashtags?: string[], location?: string }} opts
 * @returns {{ url: string, post_id: string, hashtags_count: number, location: string }}
 */
export function publishInstagramReels({ video, caption = "", hashtags = [], location = "" } = {}) {
  if (!video) throw new Error("video is required");
  const post_id = crypto.randomUUID().replace(/-/g, "").substring(0, 11);
  const url = _makeUrl("instagram_reels", post_id);

  return {
    url,
    post_id,
    hashtags_count: Array.isArray(hashtags) ? hashtags.length : 0,
    location: location || "",
  };
}

/**
 * Tool #4: Publish video to Instagram Stories.
 *
 * @param {{ video: string, duration_sec?: number, stickers?: string[] }} opts
 * @returns {{ url: string, story_id: string, duration_sec: number, sticker_count: number }}
 */
export function publishInstagramStories({ video, duration_sec = 15, stickers = [] } = {}) {
  if (!video) throw new Error("video is required");
  const story_id = crypto.randomUUID().replace(/-/g, "").substring(0, 12);
  const url = _makeUrl("instagram_stories", story_id);

  // Clamp duration to Instagram Stories limits (1-60 seconds)
  const clampedDuration = Math.max(1, Math.min(Math.floor(duration_sec || 15), 60));

  return {
    url,
    story_id,
    duration_sec: clampedDuration,
    sticker_count: Array.isArray(stickers) ? stickers.length : 0,
  };
}

/**
 * Tool #5: Publish video to Instagram Feed.
 *
 * @param {{ video: string, caption?: string, hashtags?: string[], location?: string }} opts
 * @returns {{ url: string, post_id: string, aspect_ratio: string, hashtags_count: number }}
 */
export function publishInstagramFeed({ video, caption = "", hashtags = [], location = "" } = {}) {
  if (!video) throw new Error("video is required");
  const post_id = crypto.randomUUID().replace(/-/g, "").substring(0, 11);
  const url = _makeUrl("instagram_feed", post_id);

  // Determine aspect ratio from video name hint
  let aspect_ratio = "1:1";
  if (video.includes("portrait") || video.includes("vertical")) {
    aspect_ratio = "4:5";
  } else if (video.includes("landscape") || video.includes("wide")) {
    aspect_ratio = "16:9";
  }

  return {
    url,
    post_id,
    aspect_ratio,
    hashtags_count: Array.isArray(hashtags) ? hashtags.length : 0,
  };
}

/**
 * Tool #6: Publish video to Facebook.
 *
 * @param {{ video: string, description?: string, privacy?: string, group_id?: string }} opts
 * @returns {{ url: string, post_id: string, group_id: string, privacy: string }}
 */
export function publishFacebook({ video, description = "", privacy = "public", group_id = "" } = {}) {
  if (!video) throw new Error("video is required");
  if (privacy && !["public", "friends", "only_me", "group"].includes(privacy)) {
    throw new Error("privacy must be 'public', 'friends', 'only_me', or 'group'");
  }
  const post_id = crypto.randomUUID().replace(/-/g, "").substring(0, 16);
  const url = _makeUrl("facebook", post_id);

  return {
    url,
    post_id,
    group_id: group_id || "",
    privacy: privacy || "public",
  };
}

/**
 * Tool #7: Publish video to Twitter/X.
 *
 * @param {{ video: string, text?: string, hashtags?: string[], thread?: boolean }} opts
 * @returns {{ url: string, tweet_id: string, thread_count: number, hashtags: string[] }}
 */
export function publishTwitter({ video, text = "", hashtags = [], thread = false } = {}) {
  if (!video) throw new Error("video is required");
  // Only enforce 280-char limit when NOT in thread mode
  if (!thread && text && text.length > 280) throw new Error("Tweet text cannot exceed 280 characters");
  const tweet_id = crypto.randomUUID().replace(/-/g, "").substring(0, 19);
  const url = _makeUrl("twitter", tweet_id);

  let thread_count = 1;
  if (thread) {
    // Simulate thread splitting by tweet text length
    const effectiveLength = text.length + (Array.isArray(hashtags) ? hashtags.join(" ").length : 0);
    thread_count = Math.max(1, Math.ceil(effectiveLength / 280));
  }

  return {
    url,
    tweet_id,
    thread_count,
    hashtags: Array.isArray(hashtags) ? hashtags : [],
  };
}

/**
 * Tool #8: Publish video to LinkedIn.
 *
 * @param {{ video: string, title?: string, description?: string, visibility?: string }} opts
 * @returns {{ url: string, post_id: string, visibility: string, impressions_estimate: number }}
 */
export function publishLinkedIn({ video, title = "", description = "", visibility = "public" } = {}) {
  if (!video) throw new Error("video is required");
  if (visibility && !["public", "connections", "private"].includes(visibility)) {
    throw new Error("visibility must be 'public', 'connections', or 'private'");
  }
  const post_id = crypto.randomUUID().replace(/-/g, "").substring(0, 16);
  const url = _makeUrl("linkedin", post_id);

  // Estimate impressions based on content length and visibility
  let base_impressions = 100;
  if (visibility === "public") base_impressions = 500;
  else if (visibility === "connections") base_impressions = 200;
  const content_bonus = Math.floor((title.length + description.length) / 10);
  const impressions_estimate = base_impressions + content_bonus;

  return {
    url,
    post_id,
    visibility: visibility || "public",
    impressions_estimate,
  };
}

/**
 * Tool #9: Publish video to all configured platforms simultaneously.
 *
 * @param {{ video: string, config: Record<string, object> }} opts
 * @returns {{ results: Array<{platform: string, url: string, success: boolean, error?: string}>, total_published: number, failures: number }}
 */
export function publishAll({ video, config = {} } = {}) {
  if (!video) throw new Error("video is required");

  const platformFns = {
    youtube: publishYouTube,
    tiktok: publishTikTok,
    instagram_reels: publishInstagramReels,
    instagram_stories: publishInstagramStories,
    instagram_feed: publishInstagramFeed,
    facebook: publishFacebook,
    twitter: publishTwitter,
    linkedin: publishLinkedIn,
  };

  const results = [];
  let total_published = 0;
  let failures = 0;

  for (const [platform, fn] of Object.entries(platformFns)) {
    const platformConfig = config[platform] || {};
    try {
      // Build args based on platform requirements
      let args = { video, ...platformConfig };
      if (platform === "youtube" && !args.title) args.title = "Video Title";
      if (platform === "tiktok" && !args.caption) args.caption = "";
      if (platform === "facebook" && !args.description) args.description = "";
      if (platform === "twitter" && !args.text) args.text = "";
      if (platform === "linkedin" && !args.title) args.title = "Video Title";

      const result = fn(args);
      results.push({ platform, url: result.url, success: true });
      total_published++;
    } catch (err) {
      results.push({ platform, url: "", success: false, error: err.message });
      failures++;
    }
  }

  return { results, total_published, failures };
}

// ── Internal helpers (for testing) ────────────────────────────────────────

/** Reset internal job store (test helper). */
export function _resetJobs() {
  _jobs.clear();
}

/** Get raw job object by ID (test helper). */
export function _getJob(job_id) {
  return _jobs.get(job_id) || null;
}
