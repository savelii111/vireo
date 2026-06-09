// scheduling.js — Full-featured post scheduling with best-time analytics.
//
// Provides 10 scheduling tools: schedule posts, batch scheduling, best-time
// recommendations, cancel/reschedule, upcoming posts, analytics, cross-posting,
// recurring schedules, and calendar views.
//
// Usage:
//   import { schedulePost, batchSchedule, getBestTime, cancelSchedule,
//     reschedule, getUpcoming, getAnalytics, crossPost,
//     recurringSchedule, calendarView } from "./scheduling.js";
//
//   const post = await schedulePost({ platform: "youtube", video: "/path/video.mp4", publish_time: futureDate() });
//   const best = getBestTime({ platform: "tiktok", audience_timezone: "US/Eastern", content_type: "short" });

import crypto from "node:crypto";

// ── Platform Scheduling Configs ────────────────────────────────────────────

const PLATFORM_SCHED_CONFIG = {
  youtube:   { maxScheduledAdvanceDays: 14, minAdvanceMinutes: 60,  supportsSchedule: true,  maxStagger: 120 },
  tiktok:    { maxScheduledAdvanceDays: 10, minAdvanceMinutes: 120, supportsSchedule: true,  maxStagger: 60  },
  instagram_reels:  { maxScheduledAdvanceDays: 7,  minAdvanceMinutes: 30,  supportsSchedule: true,  maxStagger: 45  },
  instagram_feed:   { maxScheduledAdvanceDays: 7,  minAdvanceMinutes: 30,  supportsSchedule: true,  maxStagger: 45  },
  facebook:  { maxScheduledAdvanceDays: 30, minAdvanceMinutes: 10,  supportsSchedule: true,  maxStagger: 60  },
  twitter:   { maxScheduledAdvanceDays: 7,  minAdvanceMinutes: 30,  supportsSchedule: false, maxStagger: 30  },
  linkedin:  { maxScheduledAdvanceDays: 30, minAdvanceMinutes: 15,  supportsSchedule: true,  maxStagger: 60  },
  vimeo:     { maxScheduledAdvanceDays: 90, minAdvanceMinutes: 5,   supportsSchedule: true,  maxStagger: 120 },
};

// ── Best-Time Data ─────────────────────────────────────────────────────────

/** @type {Record<string, { recommended_times: {day: string, hour: number, confidence: number}[], reasoning: string }>} */
const BEST_TIME_DATA = {
  youtube: {
    recommended_times: [
      { day: "Tuesday", hour: 14, confidence: 0.92 },
      { day: "Thursday", hour: 14, confidence: 0.90 },
      { day: "Saturday", hour: 9, confidence: 0.85 },
      { day: "Friday", hour: 15, confidence: 0.82 },
      { day: "Sunday", hour: 10, confidence: 0.80 },
    ],
    reasoning: "YouTube engagement peaks on weekday afternoons (2-4 PM) when users browse after school/work. Weekend mornings capture leisure viewers. Tuesday and Thursday consistently outperform other days.",
  },
  tiktok: {
    recommended_times: [
      { day: "Tuesday", hour: 7, confidence: 0.94 },
      { day: "Thursday", hour: 12, confidence: 0.91 },
      { day: "Friday", hour: 19, confidence: 0.93 },
      { day: "Wednesday", hour: 7, confidence: 0.88 },
      { day: "Saturday", hour: 20, confidence: 0.87 },
    ],
    reasoning: "TikTok engagement clusters around morning commute (7-9 AM), lunch break (12-2 PM), and evening wind-down (7-11 PM). Friday evenings show the highest viral potential.",
  },
  instagram_reels: {
    recommended_times: [
      { day: "Monday", hour: 11, confidence: 0.89 },
      { day: "Wednesday", hour: 19, confidence: 0.91 },
      { day: "Friday", hour: 12, confidence: 0.87 },
      { day: "Saturday", hour: 10, confidence: 0.85 },
      { day: "Thursday", hour: 20, confidence: 0.83 },
    ],
    reasoning: "Instagram Reels peak during lunch hours (11 AM-1 PM) and evening prime time (7-9 PM). Midweek posts see highest saves and shares.",
  },
  instagram_feed: {
    recommended_times: [
      { day: "Monday", hour: 11, confidence: 0.88 },
      { day: "Wednesday", hour: 19, confidence: 0.90 },
      { day: "Friday", hour: 12, confidence: 0.86 },
      { day: "Saturday", hour: 11, confidence: 0.84 },
      { day: "Thursday", hour: 20, confidence: 0.82 },
    ],
    reasoning: "Instagram Feed follows similar patterns to Reels but with slightly earlier peaks. Lunch-time scrolling drives weekday engagement.",
  },
  facebook: {
    recommended_times: [
      { day: "Wednesday", hour: 13, confidence: 0.88 },
      { day: "Thursday", hour: 15, confidence: 0.86 },
      { day: "Tuesday", hour: 14, confidence: 0.85 },
      { day: "Friday", hour: 12, confidence: 0.83 },
      { day: "Saturday", hour: 10, confidence: 0.79 },
    ],
    reasoning: "Facebook afternoon engagement peaks during post-lunch downtime on workdays (1-4 PM). Midweek posts generate more comments and shares.",
  },
  twitter: {
    recommended_times: [
      { day: "Monday", hour: 8, confidence: 0.87 },
      { day: "Wednesday", hour: 12, confidence: 0.89 },
      { day: "Friday", hour: 9, confidence: 0.85 },
      { day: "Tuesday", hour: 10, confidence: 0.84 },
      { day: "Thursday", hour: 13, confidence: 0.82 },
    ],
    reasoning: "Twitter usage spikes during morning news checks (8-10 AM) and midday breaks (12-1 PM). Business hours dominate engagement patterns.",
  },
  linkedin: {
    recommended_times: [
      { day: "Tuesday", hour: 9, confidence: 0.93 },
      { day: "Wednesday", hour: 9, confidence: 0.91 },
      { day: "Thursday", hour: 10, confidence: 0.89 },
      { day: "Monday", hour: 8, confidence: 0.86 },
      { day: "Friday", hour: 11, confidence: 0.82 },
    ],
    reasoning: "LinkedIn is business-focused; professionals engage during morning work hours on weekdays (8-10 AM). Tuesday and Wednesday mornings show peak engagement. Avoid weekends.",
  },
  vimeo: {
    recommended_times: [
      { day: "Tuesday", hour: 15, confidence: 0.84 },
      { day: "Thursday", hour: 14, confidence: 0.83 },
      { day: "Saturday", hour: 11, confidence: 0.80 },
      { day: "Monday", hour: 16, confidence: 0.78 },
      { day: "Sunday", hour: 12, confidence: 0.76 },
    ],
    reasoning: "Vimeo audiences are professional creators who browse during afternoon hours. Weekend mornings attract hobbyists exploring portfolios.",
  },
};

// ── Internal State ─────────────────────────────────────────────────────────

/** @type {Map<string, object>} */
const _scheduledPosts = new Map();

/** @type {Map<string, object>} */
const _recurringSchedules = new Map();

/** Counter for generating sequential IDs */
let _idCounter = 0;

// ── Helpers ────────────────────────────────────────────────────────────────

function generateId(prefix = "sch") {
  _idCounter++;
  return `${prefix}_${_idCounter}_${crypto.randomUUID().slice(0, 8)}`;
}

function estimateReach(platform) {
  const baseReach = {
    youtube: 1200, tiktok: 3500, instagram_reels: 2800, instagram_feed: 1500,
    facebook: 800, twitter: 600, linkedin: 450, vimeo: 200,
  };
  const base = baseReach[platform] || 500;
  // Add some variance based on time-of-day multiplier
  const hour = new Date().getHours();
  const timeMultiplier = hour >= 9 && hour <= 21 ? 1.2 : 0.8;
  return Math.round(base * timeMultiplier * (0.8 + Math.random() * 0.4));
}

function validatePlatform(platform) {
  const config = PLATFORM_SCHED_CONFIG[platform];
  if (!config) {
    throw new Error(`Unknown platform: ${platform}. Supported: ${Object.keys(PLATFORM_SCHED_CONFIG).join(", ")}`);
  }
  if (!config.supportsSchedule) {
    throw new Error(`${platform} does not support scheduled posting`);
  }
  return config;
}

function validateTime(publishTime, config) {
  const dt = publishTime instanceof Date ? publishTime : new Date(publishTime);
  if (isNaN(dt.getTime())) {
    throw new Error("publish_time is not a valid date");
  }
  const now = Date.now();
  const minAdvance = config.minAdvanceMinutes * 60_000;
  if (dt.getTime() <= now + minAdvance) {
    throw new Error(`publish_time must be at least ${config.minAdvanceMinutes} minutes in the future`);
  }
  const maxAdvance = config.maxScheduledAdvanceDays * 24 * 3600_000;
  if (dt.getTime() > now + maxAdvance) {
    throw new Error(`publish_time cannot be more than ${config.maxScheduledAdvanceDays} days in advance`);
  }
  return dt;
}

function findConflicts(posts) {
  const conflicts = [];
  for (let i = 0; i < posts.length; i++) {
    for (let j = i + 1; j < posts.length; j++) {
      const a = posts[i];
      const b = posts[j];
      if (a.platform === b.platform) {
        const diff = Math.abs(new Date(a.time).getTime() - new Date(b.time).getTime());
        const config = PLATFORM_SCHED_CONFIG[a.platform];
        if (config && diff < config.maxStagger * 60_000) {
          conflicts.push({
            post_a: i,
            post_b: j,
            platform: a.platform,
            gap_minutes: Math.round(diff / 60_000),
            required_gap: config.maxStagger,
          });
        }
      }
    }
  }
  return conflicts;
}

// ── Tool 1: schedulePost ───────────────────────────────────────────────────

/**
 * Schedule a single video post on a specific platform.
 *
 * @param {object} opts
 * @param {string} opts.platform - Platform ID (e.g. "youtube", "tiktok")
 * @param {string} opts.video - Path or URL to the video file
 * @param {Date|string} opts.publish_time - When to publish
 * @returns {{ post_id: string, platform: string, scheduled_time: string, estimated_reach: number, status: string }}
 */
export function schedulePost({ platform, video, publish_time }) {
  if (!platform) throw new Error("platform is required");
  if (!video) throw new Error("video is required");
  if (!publish_time) throw new Error("publish_time is required");

  const config = validatePlatform(platform);
  const dt = validateTime(publish_time, config);
  const postId = generateId("post");
  const estimated_reach = estimateReach(platform);

  const post = {
    post_id: postId,
    platform,
    video,
    scheduled_time: dt,
    estimated_reach,
    status: "scheduled",
    created_at: new Date(),
    is_recurring: false,
    recurring_id: null,
  };

  _scheduledPosts.set(postId, post);

  return {
    post_id: postId,
    platform,
    scheduled_time: dt.toISOString(),
    estimated_reach,
    status: "scheduled",
  };
}

// ── Tool 2: batchSchedule ──────────────────────────────────────────────────

/**
 * Schedule multiple posts in a single batch operation.
 *
 * @param {object} opts
 * @param {{ platform: string, video: string, time: Date|string }[]} opts.posts
 * @returns {{ scheduled: {post_id: string, platform: string}[], total_count: number, conflicts: object[] }}
 */
export function batchSchedule({ posts }) {
  if (!Array.isArray(posts) || posts.length === 0) {
    throw new Error("posts must be a non-empty array");
  }

  // Check for conflicts first
  const conflicts = findConflicts(posts);

  const scheduled = [];
  const errors = [];

  for (const item of posts) {
    try {
      const result = schedulePost({
        platform: item.platform,
        video: item.video,
        publish_time: item.time,
      });
      scheduled.push({ post_id: result.post_id, platform: result.platform });
    } catch (err) {
      errors.push({ platform: item.platform, error: err.message });
    }
  }

  return {
    scheduled,
    total_count: scheduled.length,
    conflicts,
    errors: errors.length > 0 ? errors : undefined,
  };
}

// ── Tool 3: getBestTime ────────────────────────────────────────────────────

/**
 * Get recommended posting times for a platform and audience.
 *
 * @param {object} opts
 * @param {string} opts.platform - Platform ID
 * @param {string} [opts.audience_timezone] - IANA timezone (e.g. "US/Eastern")
 * @param {string} [opts.content_type] - Content type hint ("short", "long", "live", "story")
 * @returns {{ recommended_times: {day: string, hour: number, confidence: number}[], reasoning: string, timezone: string }}
 */
export function getBestTime({ platform, audience_timezone = "UTC", content_type = "standard" }) {
  if (!platform) throw new Error("platform is required");

  const data = BEST_TIME_DATA[platform.toLowerCase()];
  if (!data) {
    throw new Error(`No best-time data for platform: ${platform}`);
  }

  // Filter or adjust recommendations based on content_type
  let times = [...data.recommended_times];

  if (content_type === "short") {
    // Short-form content performs better in evening hours
    times = times.map((t) => ({
      ...t,
      confidence: t.hour >= 18 && t.hour <= 23 ? Math.min(t.confidence + 0.05, 1.0) : Math.max(t.confidence - 0.03, 0.0),
    }));
  } else if (content_type === "long") {
    // Long-form performs better during daytime
    times = times.map((t) => ({
      ...t,
      confidence: t.hour >= 9 && t.hour <= 17 ? Math.min(t.confidence + 0.04, 1.0) : Math.max(t.confidence - 0.05, 0.0),
    }));
  } else if (content_type === "live") {
    // Live content peaks in evening prime time
    times = times.map((t) => ({
      ...t,
      confidence: t.hour >= 19 && t.hour <= 22 ? Math.min(t.confidence + 0.08, 1.0) : Math.max(t.confidence - 0.06, 0.0),
    }));
  }

  // Sort by confidence descending
  times.sort((a, b) => b.confidence - a.confidence);

  return {
    recommended_times: times,
    reasoning: data.reasoning,
    timezone: audience_timezone,
    content_type,
  };
}

// ── Tool 4: cancelSchedule ─────────────────────────────────────────────────

/**
 * Cancel a scheduled post.
 *
 * @param {string} postId
 * @returns {{ cancelled: boolean, post_id: string, refund_if_paid: boolean }}
 */
export function cancelSchedule(postId) {
  if (!postId) throw new Error("postId is required");

  const post = _scheduledPosts.get(postId);
  if (!post) throw new Error(`Post not found: ${postId}`);

  if (post.status === "cancelled") {
    throw new Error(`Post ${postId} is already cancelled`);
  }

  if (post.status === "published") {
    throw new Error(`Post ${postId} has already been published and cannot be cancelled`);
  }

  post.status = "cancelled";
  post.cancelled_at = new Date();

  // Refund if scheduled more than 24 hours in advance (simulated paid scheduling)
  const hoursUntilPost = (post.scheduled_time.getTime() - Date.now()) / 3600_000;
  const refund_if_paid = hoursUntilPost > 24;

  return {
    cancelled: true,
    post_id: postId,
    refund_if_paid,
  };
}

// ── Tool 5: reschedule ─────────────────────────────────────────────────────

/**
 * Reschedule a post to a new time.
 *
 * @param {string} postId
 * @param {Date|string} newTime
 * @returns {{ rescheduled: boolean, old_time: string, new_time: string, post_id: string }}
 */
export function reschedule(postId, newTime) {
  if (!postId) throw new Error("postId is required");
  if (!newTime) throw new Error("newTime is required");

  const post = _scheduledPosts.get(postId);
  if (!post) throw new Error(`Post not found: ${postId}`);

  if (post.status === "cancelled") {
    throw new Error(`Post ${postId} is cancelled and cannot be rescheduled`);
  }

  if (post.status === "published") {
    throw new Error(`Post ${postId} has already been published`);
  }

  const config = PLATFORM_SCHED_CONFIG[post.platform];
  const dt = validateTime(newTime, config);
  const old_time = post.scheduled_time.toISOString();

  post.scheduled_time = dt;
  post.status = "scheduled";

  return {
    rescheduled: true,
    old_time,
    new_time: dt.toISOString(),
    post_id: postId,
  };
}

// ── Tool 6: getUpcoming ────────────────────────────────────────────────────

/**
 * Get upcoming scheduled posts.
 *
 * @param {object} [opts]
 * @param {string} [opts.platform] - Filter by platform
 * @param {number} [opts.limit=20] - Max posts to return
 * @returns {{ posts: {id: string, platform: string, time: string, status: string}[], total_count: number }}
 */
export function getUpcoming({ platform, limit = 20 } = {}) {
  let results = [..._scheduledPosts.values()];

  // Only scheduled posts in the future
  const now = Date.now();
  results = results.filter((p) => p.status === "scheduled" && p.scheduled_time.getTime() > now);

  if (platform) {
    results = results.filter((p) => p.platform === platform);
  }

  // Sort by scheduled time ascending
  results.sort((a, b) => a.scheduled_time.getTime() - b.scheduled_time.getTime());

  const total_count = results.length;
  const posts = results.slice(0, limit).map((p) => ({
    id: p.post_id,
    platform: p.platform,
    time: p.scheduled_time.toISOString(),
    status: p.status,
  }));

  return { posts, total_count };
}

// ── Tool 7: getAnalytics ───────────────────────────────────────────────────

/**
 * Get scheduling analytics for a platform and time range.
 *
 * @param {object} [opts]
 * @param {string} [opts.platform] - Platform ID, or "all" for cross-platform
 * @param {string} [opts.timeRange="30d"] - Time range ("7d", "30d", "90d")
 * @returns {{ best_days: string[], best_hours: number[], engagement_curve: object[], recommendations: string[] }}
 */
export function getAnalytics({ platform = "all", timeRange = "30d" } = {}) {
  const rangeDays = timeRange === "7d" ? 7 : timeRange === "90d" ? 90 : 30;

  const platforms = platform === "all" ? Object.keys(BEST_TIME_DATA) : [platform];

  // Aggregate best days across platforms
  const dayScores = {};
  const hourScores = {};

  for (const plat of platforms) {
    const data = BEST_TIME_DATA[plat];
    if (!data) continue;

    for (const t of data.recommended_times) {
      dayScores[t.day] = (dayScores[t.day] || 0) + t.confidence;
      hourScores[t.hour] = (hourScores[t.hour] || 0) + t.confidence;
    }
  }

  const best_days = Object.entries(dayScores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([day]) => day);

  const best_hours = Object.entries(hourScores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([hour]) => parseInt(hour, 10));

  // Build engagement curve (hourly, 0-23)
  const engagement_curve = [];
  for (let h = 0; h < 24; h++) {
    const score = hourScores[h] || 0;
    const normalizedScore = Math.round((score / (platforms.length * 0.95)) * 100);
    engagement_curve.push({ hour: h, engagement: Math.min(normalizedScore, 100) });
  }

  // Generate recommendations
  const recommendations = [];
  if (best_days.length > 0) {
    recommendations.push(`Focus posting on ${best_days.join(" and ")} for maximum engagement`);
  }
  if (best_hours.length > 0) {
    const hourStr = best_hours.map((h) => `${h}:00`).join(", ");
    recommendations.push(`Optimal posting hours: ${hourStr}`);
  }
  if (rangeDays <= 7) {
    recommendations.push("Consider a 30-day analysis for more reliable patterns");
  }
  if (platform === "all") {
    recommendations.push("Cross-platform posting during overlapping peak hours maximizes reach");
  }

  return {
    best_days,
    best_hours,
    engagement_curve,
    time_range: timeRange,
    platforms_analyzed: platforms,
    recommendations,
  };
}

// ── Tool 8: crossPost ──────────────────────────────────────────────────────

/**
 * Schedule a video across multiple platforms with staggered timing.
 *
 * @param {object} opts
 * @param {string} opts.video - Path or URL to the video
 * @param {string[]} opts.platforms - Target platforms
 * @param {number} [opts.stagger_minutes=15] - Minutes between each platform post
 * @returns {{ posts: {platform: string, url: string, scheduled: string}[], stagger_minutes: number }}
 */
export function crossPost({ video, platforms, stagger_minutes = 15 }) {
  if (!video) throw new Error("video is required");
  if (!Array.isArray(platforms) || platforms.length === 0) {
    throw new Error("platforms must be a non-empty array");
  }
  if (stagger_minutes < 5 || stagger_minutes > 120) {
    throw new Error("stagger_minutes must be between 5 and 120");
  }

  const posts = [];
  const baseTime = new Date(Date.now() + 2 * 3600_000); // Start 2 hours from now

  for (let i = 0; i < platforms.length; i++) {
    const platform = platforms[i];
    const config = validatePlatform(platform);
    const stagger = new Date(baseTime.getTime() + i * stagger_minutes * 60_000);

    const result = schedulePost({
      platform,
      video,
      publish_time: stagger,
    });

    posts.push({
      platform,
      url: `https://${platform}.com/video/${result.post_id}`,
      scheduled: result.scheduled_time,
    });
  }

  return { posts, stagger_minutes };
}

// ── Tool 9: recurringSchedule ──────────────────────────────────────────────

/**
 * Set up a recurring schedule for a video across platforms.
 *
 * @param {object} opts
 * @param {string} opts.video - Path or URL to the video
 * @param {string} opts.frequency - "daily", "weekly", "biweekly", "monthly"
 * @param {string[]} opts.platforms - Target platforms
 * @returns {{ schedule_id: string, frequency: string, next_posts: {platform: string, time: string}[] }}
 */
export function recurringSchedule({ video, frequency, platforms }) {
  if (!video) throw new Error("video is required");
  if (!frequency) throw new Error("frequency is required");
  if (!Array.isArray(platforms) || platforms.length === 0) {
    throw new Error("platforms must be a non-empty array");
  }

  const validFrequencies = ["daily", "weekly", "biweekly", "monthly"];
  if (!validFrequencies.includes(frequency)) {
    throw new Error(`Invalid frequency: ${frequency}. Must be one of: ${validFrequencies.join(", ")}`);
  }

  const scheduleId = generateId("rec");
  const now = Date.now();

  // Calculate intervals
  const intervals = {
    daily: 24 * 3600_000,
    weekly: 7 * 24 * 3600_000,
    biweekly: 14 * 24 * 3600_000,
    monthly: 30 * 24 * 3600_000,
  };

  const interval = intervals[frequency];
  const nextPosts = [];

  // Generate next 5 upcoming posts
  for (let cycle = 1; cycle <= 5; cycle++) {
    const cycleTime = new Date(now + cycle * interval);
    for (const platform of platforms) {
      const config = PLATFORM_SCHED_CONFIG[platform];
      if (config && config.supportsSchedule) {
        nextPosts.push({
          platform,
          time: cycleTime.toISOString(),
        });
      }
    }
  }

  // Store the recurring schedule
  const recurring = {
    schedule_id: scheduleId,
    video,
    frequency,
    platforms,
    created_at: new Date(),
    next_execution: new Date(now + interval),
    active: true,
  };
  _recurringSchedules.set(scheduleId, recurring);

  return {
    schedule_id: scheduleId,
    frequency,
    next_posts: nextPosts,
  };
}

// ── Tool 10: calendarView ──────────────────────────────────────────────────

/**
 * Get a calendar view of scheduled posts for a given month.
 *
 * @param {object} [opts]
 * @param {number} [opts.month] - Month (1-12), defaults to current
 * @param {number} [opts.year] - Year, defaults to current
 * @returns {{ days: {date: string, posts: {platform: string, time: string, status: string}[], post_count: number}[], total_posts: number, month: number, year: number }}
 */
export function calendarView({ month, year } = {}) {
  const now = new Date();
  const targetMonth = month != null ? month : (now.getMonth() + 1);
  const targetYear = year != null ? year : now.getFullYear();

  if (targetMonth < 1 || targetMonth > 12) {
    throw new Error("month must be between 1 and 12");
  }

  const daysInMonth = new Date(targetYear, targetMonth, 0).getDate();
  const days = [];
  let total_posts = 0;

  for (let d = 1; d <= daysInMonth; d++) {
    const dayStart = new Date(targetYear, targetMonth - 1, d, 0, 0, 0);
    const dayEnd = new Date(targetYear, targetMonth - 1, d, 23, 59, 59);

    const dayPosts = [..._scheduledPosts.values()].filter((post) => {
      const st = post.scheduled_time;
      return st >= dayStart && st <= dayEnd;
    });

    const posts = dayPosts.map((p) => ({
      platform: p.platform,
      time: p.scheduled_time.toISOString(),
      status: p.status,
    }));

    total_posts += posts.length;

    days.push({
      date: `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
      posts,
      post_count: posts.length,
    });
  }

  return { days, total_posts, month: targetMonth, year: targetYear };
}

// ── Internal Accessors (for testing) ───────────────────────────────────────

/** Reset all scheduled posts. For testing only. */
export function _resetScheduledPosts() {
  _scheduledPosts.clear();
  _idCounter = 0;
}

/** Reset recurring schedules. For testing only. */
export function _resetRecurringSchedules() {
  _recurringSchedules.clear();
}

/** Get a post by ID. For testing only. */
export function _getPost(postId) {
  return _scheduledPosts.get(postId) || null;
}

/** Get all scheduled posts. For testing only. */
export function _getAllPosts() {
  return [..._scheduledPosts.values()];
}

/** Get a recurring schedule by ID. For testing only. */
export function _getRecurring(scheduleId) {
  return _recurringSchedules.get(scheduleId) || null;
}

/** Exported platform configs for inspection */
export const PLATFORMS = { ...PLATFORM_SCHED_CONFIG };
