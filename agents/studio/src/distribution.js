// distribution.js — One-click publish to 8 platforms with auto-SEO and scheduling.
//
// Provides platform configuration, content validation, SEO optimization,
// and publish job management for YouTube, TikTok, Instagram Reels, Instagram
// Feed, Facebook, Twitter, LinkedIn, and Vimeo.
//
// Usage:
//   import { publish, getPublishStatus, listPublished, validateForPlatform, generateSEO } from "./distribution.js";
//   const job = await publish({ platform: "youtube", file_path: "./video.mp4", title: "My Video" });
//   getPublishStatus(job.job_id);
//
// Design:
//   - Platform configs encode codec, resolution, and aspect-ratio constraints.
//   - Validation enforces per-platform content limits (title, description, tags).
//   - generateSEO produces optimized metadata with hashtag suggestions.
//   - Publish jobs are stored in-memory with unique UUIDs.

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
 *
 * @param {{ title?: string, description?: string, tags?: string }} raw
 * @returns {{ optimized_title: string, optimized_description: string, suggested_tags: string[], suggested_hashtags: string[], estimated_reach: string }}
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

  // ── Suggested hashtags ──
  const suggested_hashtags = [];
  if (tags && tags.trim().length > 0) {
    const words = tags.split(/[,;\s]+/).filter((w) => w.length > 2);
    for (const w of words) {
      const tag = w.replace(/[^a-zA-Z0-9]/g, "");
      if (tag.length > 2) suggested_hashtags.push("#" + tag.toLowerCase());
      if (suggested_hashtags.length >= 10) break;
    }
  }
  if (!suggested_hashtags.includes("#video")) suggested_hashtags.unshift("#video");
  if (!suggested_hashtags.includes("#creator")) suggested_hashtags.push("#creator");

  // ── Estimated reach ──
  let estimated_reach = "medium";
  const combinedLength = (optimized_title + optimized_description).length;
  if (combinedLength > 200) estimated_reach = "high";
  else if (combinedLength < 50) estimated_reach = "low";

  return {
    optimized_title,
    optimized_description,
    suggested_tags,
    suggested_hashtags,
    estimated_reach,
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

// ── Internal helpers (for testing) ────────────────────────────────────────

/** Reset internal job store (test helper). */
export function _resetJobs() {
  _jobs.clear();
}

/** Get raw job object by ID (test helper). */
export function _getJob(job_id) {
  return _jobs.get(job_id) || null;
}
