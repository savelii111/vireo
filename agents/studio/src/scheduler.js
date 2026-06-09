// Scheduler — post scheduling with best-time-to-post recommendations.
//
// Provides an in-memory scheduler for queuing posts with platform-aware
// time recommendations based on engagement data.
//
// Usage:
//   import { Scheduler } from "./scheduler.js";
//   const sched = new Scheduler();
//   const item = sched.schedule({
//     title: "My Video",
//     platforms: ["youtube", "tiktok"],
//     scheduled_at: new Date(Date.now() + 3600_000),
//     file_path: "/path/to/video.mp4",
//   });

import { randomUUID } from "node:crypto";

/**
 * @typedef {Object} ScheduleItem
 * @property {string} id
 * @property {string} title
 * @property {string[]} platforms
 * @property {Date} scheduled_at
 * @property {'scheduled'|'published'|'cancelled'|'failed'} status
 * @property {string} file_path
 * @property {Date} created_at
 */

/**
 * @typedef {Object} BestTimeResult
 * @property {string[]} recommended_times
 * @property {string} reason
 */

/** @type {Record<string, BestTimeResult>} */
const BEST_TIME_MAP = {
  youtube: {
    recommended_times: ["14:00-16:00 weekdays", "09:00-11:00 weekends"],
    reason: "YouTube peaks 2-4pm on weekdays when users browse after work/school; 9-11am weekends catch leisure viewers.",
  },
  tiktok: {
    recommended_times: ["07:00-09:00", "12:00-15:00", "19:00-23:00"],
    reason: "TikTok engagement clusters around morning commute, lunch break, and evening wind-down.",
  },
  instagram: {
    recommended_times: ["11:00-13:00", "19:00-21:00"],
    reason: "Instagram sees highest interaction during lunch hours and prime evening scrolling.",
  },
  twitter: {
    recommended_times: ["08:00-10:00", "12:00-13:00"],
    reason: "Twitter usage spikes during morning news check and midday breaks.",
  },
  linkedin: {
    recommended_times: ["08:00-10:00 weekdays"],
    reason: "LinkedIn is business-focused; professionals engage during morning work hours on weekdays.",
  },
  facebook: {
    recommended_times: ["13:00-16:00 weekdays"],
    reason: "Facebook afternoon engagement peaks during post-lunch downtime on workdays.",
  },
};

export class Scheduler {
  constructor() {
    /** @type {Map<string, ScheduleItem>} */
    this._items = new Map();
  }

  /**
   * Create a new schedule item.
   *
   * @param {object} opts
   * @param {string} opts.title
   * @param {string[]} opts.platforms
   * @param {Date|string} opts.scheduled_at
   * @param {string} [opts.file_path=""]
   * @returns {ScheduleItem}
   */
  schedule({ title, platforms, scheduled_at, file_path = "" }) {
    if (!Array.isArray(platforms) || platforms.length === 0) {
      throw new Error("platforms must be a non-empty array");
    }

    const scheduledDate = scheduled_at instanceof Date ? scheduled_at : new Date(scheduled_at);
    if (isNaN(scheduledDate.getTime())) {
      throw new Error("scheduled_at is not a valid date");
    }
    if (scheduledDate.getTime() <= Date.now()) {
      throw new Error("scheduled_at must be in the future");
    }

    /** @type {ScheduleItem} */
    const item = {
      id: randomUUID(),
      title,
      platforms,
      scheduled_at: scheduledDate,
      status: "scheduled",
      file_path,
      created_at: new Date(),
    };

    this._items.set(item.id, item);
    return item;
  }

  /**
   * List scheduled items with optional filters.
   *
   * @param {object} [opts]
   * @param {string} [opts.status]
   * @param {string} [opts.platform]
   * @returns {ScheduleItem[]}
   */
  listScheduled({ status, platform } = {}) {
    let results = [...this._items.values()];
    if (status) {
      results = results.filter((i) => i.status === status);
    }
    if (platform) {
      results = results.filter((i) => i.platforms.includes(platform));
    }
    return results;
  }

  /**
   * Cancel a scheduled item.
   *
   * @param {string} id
   * @returns {{ ok: true }}
   */
  cancelSchedule(id) {
    const item = this._items.get(id);
    if (!item) throw new Error(`schedule not found: ${id}`);
    item.status = "cancelled";
    return { ok: true };
  }

  /**
   * Get a schedule item by id.
   *
   * @param {string} id
   * @returns {ScheduleItem | null}
   */
  getSchedule(id) {
    return this._items.get(id) || null;
  }

  /**
   * Update fields on a schedule item.
   *
   * @param {string} id
   * @param {object} patch
   * @returns {ScheduleItem}
   */
  updateSchedule(id, patch) {
    const item = this._items.get(id);
    if (!item) throw new Error(`schedule not found: ${id}`);
    for (const [key, val] of Object.entries(patch)) {
      if (key === "scheduled_at") {
        item.scheduled_at = val instanceof Date ? val : new Date(val);
      } else if (key !== "id" && key !== "created_at") {
        item[key] = val;
      }
    }
    return item;
  }

  /**
   * Get upcoming items scheduled within the next N hours.
   *
   * @param {number} [hours=24]
   * @returns {ScheduleItem[]}
   */
  getUpcoming(hours = 24) {
    const now = Date.now();
    const cutoff = now + hours * 3600_000;
    return [...this._items.values()].filter(
      (i) => i.status === "scheduled" && i.scheduled_at.getTime() > now && i.scheduled_at.getTime() <= cutoff
    );
  }

  /**
   * Get best time to post for a given platform.
   *
   * @param {string} platform
   * @returns {BestTimeResult | null}
   */
  getBestTimeToPost(platform) {
    return BEST_TIME_MAP[platform.toLowerCase()] || null;
  }

  /**
   * Get scheduling statistics.
   *
   * @returns {{ total_scheduled: number, total_published: number, total_failed: number }}
   */
  stats() {
    let total_scheduled = 0;
    let total_published = 0;
    let total_failed = 0;
    for (const item of this._items.values()) {
      if (item.status === "scheduled") total_scheduled++;
      else if (item.status === "published") total_published++;
      else if (item.status === "failed") total_failed++;
    }
    return { total_scheduled, total_published, total_failed };
  }
}
