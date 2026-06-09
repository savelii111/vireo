// analytics_dashboard.js — Aggregated analytics, platform comparison,
// content recommendations, and exportable reports for Vireo Studio.
//
// Provides a Dashboard class that ingests video metadata and per-platform
// analytics data, then exposes high-level summaries, trend analysis,
// engagement breakdowns, optimal-post-time suggestions, and content-
// improvement recommendations.
//
// Usage:
//   import { Dashboard } from "./analytics_dashboard.js";
//   const db = new Dashboard(videos, platformData);
//   const summary = db.getDashboardSummary();
//   const report  = db.exportReport("json");

// ── Platform Best-Post-Time Defaults ────────────────────────────────────────

/** @type {Record<string, { best_hours: number[], best_days: string[], reason: string }>} */
const PLATFORM_POST_TIMES = {
  youtube: {
    best_hours: [14, 15, 16],
    best_days: ["Tuesday", "Wednesday", "Thursday", "Friday"],
    reason: "YouTube engagement peaks on weekday afternoons when viewers browse after work or school.",
  },
  tiktok: {
    best_hours: [7, 8, 12, 13, 19, 20, 21],
    best_days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
    reason: "TikTok sees engagement clusters around morning commute, lunch break, and evening wind-down every day.",
  },
  instagram_reels: {
    best_hours: [11, 12, 13, 19, 20, 21],
    best_days: ["Monday", "Wednesday", "Friday", "Saturday"],
    reason: "Instagram Reels peak during lunch hours and prime evening scrolling on select days.",
  },
  instagram_feed: {
    best_hours: [12, 13, 19, 20],
    best_days: ["Monday", "Wednesday", "Friday"],
    reason: "Instagram Feed performs best during midday and evening on midweek days.",
  },
  facebook: {
    best_hours: [13, 14, 15, 16],
    best_days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    reason: "Facebook afternoon engagement peaks during post-lunch downtime on workdays.",
  },
  twitter: {
    best_hours: [8, 9, 10, 12, 13],
    best_days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    reason: "Twitter usage spikes during morning news check and midday breaks on weekdays.",
  },
  linkedin: {
    best_hours: [8, 9, 10],
    best_days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    reason: "LinkedIn is business-focused; professionals engage during morning work hours on weekdays.",
  },
  vimeo: {
    best_hours: [10, 11, 14, 15],
    best_days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    reason: "Vimeo content is often shared in professional contexts, peaking during work hours.",
  },
};

// ── Dashboard Class ─────────────────────────────────────────────────────────

export class Dashboard {
  /**
   * @param {Array<object>} videos — Array of video metadata objects.
   *   Each video: { video_id, title, duration_sec, completion_rate, drop_off_point_sec }
   * @param {object} platformData — Map of platform → analytics.
   *   platformData[platform] = {
   *     videos: [{ video_id, views, likes, comments, shares, revenue,
   *                daily: [{ date, views, likes, comments, shares }] }],
   *     views, engagement_rate, revenue
   *   }
   */
  constructor(videos = [], platformData = {}) {
    this._videos = videos;
    this._platformData = platformData;
  }

  // ── Dashboard Summary ───────────────────────────────────────────────────

  /**
   * Aggregated dashboard summary across all platforms.
   * @returns {{ total_views, total_watch_time_hours, avg_completion_rate,
   *             top_video, worst_video, trend }}
   */
  getDashboardSummary() {
    const videos = this._videos;
    const platformData = this._platformData;

    if (videos.length === 0) {
      return {
        total_views: 0,
        total_watch_time_hours: 0,
        avg_completion_rate: 0,
        top_video: null,
        worst_video: null,
        trend: "stable",
      };
    }

    // Aggregate total views across all platforms
    let total_views = 0;
    const videoViews = new Map();

    for (const [platform, data] of Object.entries(platformData)) {
      for (const v of data.videos || []) {
        total_views += v.views || 0;
        videoViews.set(v.video_id, (videoViews.get(v.video_id) || 0) + (v.views || 0));
      }
    }

    // Compute total watch time from video duration × views × completion_rate
    let total_watch_time_sec = 0;
    for (const video of videos) {
      const views = videoViews.get(video.video_id) || 0;
      const rate = video.completion_rate || 0;
      total_watch_time_sec += video.duration_sec * views * rate;
    }

    // Average completion rate
    const avg_completion_rate =
      videos.reduce((sum, v) => sum + (v.completion_rate || 0), 0) / videos.length;

    // Top and worst video by views
    let top_video = null;
    let worst_video = null;
    if (videoViews.size > 0) {
      const sorted = [...videoViews.entries()].sort((a, b) => b[1] - a[1]);
      const topId = sorted[0][0];
      const worstId = sorted[sorted.length - 1][0];
      const topMeta = videos.find((v) => v.video_id === topId);
      const worstMeta = videos.find((v) => v.video_id === worstId);
      top_video = {
        video_id: topId,
        title: topMeta ? topMeta.title : "",
        views: sorted[0][1],
      };
      worst_video = {
        video_id: worstId,
        title: worstMeta ? worstMeta.title : "",
        views: sorted[sorted.length - 1][1],
      };
    }

    // Trend: compare recent 7 days vs previous 7 days across all platforms
    const trend = this._computeTrend();

    return {
      total_views,
      total_watch_time_hours: Math.round((total_watch_time_sec / 3600) * 100) / 100,
      avg_completion_rate: Math.round(avg_completion_rate * 10000) / 10000,
      top_video,
      worst_video,
      trend,
    };
  }

  // ── Platform Comparison ──────────────────────────────────────────────────

  /**
   * Compare analytics across platforms.
   * @returns {Array<{ platform, views, engagement_rate, revenue }>}
   */
  getPlatformComparison() {
    const result = [];
    for (const [platform, data] of Object.entries(this._platformData)) {
      result.push({
        platform,
        views: data.views || 0,
        engagement_rate: data.engagement_rate || 0,
        revenue: data.revenue || 0,
      });
    }
    // Sort by views descending
    result.sort((a, b) => b.views - a.views);
    return result;
  }

  // ── Top Videos ──────────────────────────────────────────────────────────

  /**
   * Get top-performing videos sorted by views.
   * @param {number} [limit=10]
   * @returns {Array<{ video_id, title, views, completion_rate, revenue }>}
   */
  getTopVideos(limit = 10) {
    // Build a map of video_id → total views + revenue
    const agg = new Map();
    for (const data of Object.values(this._platformData)) {
      for (const v of data.videos || []) {
        const existing = agg.get(v.video_id) || { views: 0, revenue: 0 };
        existing.views += v.views || 0;
        existing.revenue += v.revenue || 0;
        agg.set(v.video_id, existing);
      }
    }

    // Merge with video metadata
    const results = [];
    for (const [video_id, stats] of agg) {
      const meta = this._videos.find((v) => v.video_id === video_id);
      results.push({
        video_id,
        title: meta ? meta.title : "",
        views: stats.views,
        completion_rate: meta ? meta.completion_rate || 0 : 0,
        revenue: stats.revenue,
      });
    }

    results.sort((a, b) => b.views - a.views);
    return results.slice(0, limit);
  }

  // ── Worst Performing ────────────────────────────────────────────────────

  /**
   * Get worst-performing videos sorted by completion rate (ascending).
   * @param {number} [limit=10]
   * @returns {Array<{ video_id, title, views, completion_rate, drop_off_point_sec }>}
   */
  getWorstPerforming(limit = 10) {
    // Aggregate views
    const agg = new Map();
    for (const data of Object.values(this._platformData)) {
      for (const v of data.videos || []) {
        agg.set(v.video_id, (agg.get(v.video_id) || 0) + (v.views || 0));
      }
    }

    const results = [];
    for (const video of this._videos) {
      results.push({
        video_id: video.video_id,
        title: video.title,
        views: agg.get(video.video_id) || 0,
        completion_rate: video.completion_rate || 0,
        drop_off_point_sec: video.drop_off_point_sec || 0,
      });
    }

    // Sort by completion rate ascending (worst first)
    results.sort((a, b) => a.completion_rate - b.completion_rate);
    return results.slice(0, limit);
  }

  // ── Engagement Trend ────────────────────────────────────────────────────

  /**
   * Daily engagement data for a specific video over N days.
   * @param {string} video_id
   * @param {number} [days=30]
   * @returns {Array<{ date, views, likes, comments, shares }>}
   */
  getEngagementTrend(video_id, days = 30) {
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    const cutoffDate = new Date(today);
    cutoffDate.setDate(cutoffDate.getDate() - days + 1);
    cutoffDate.setHours(0, 0, 0, 0);

    // Collect daily data for the video across all platforms
    const dailyMap = new Map(); // date string → { views, likes, comments, shares }

    for (const data of Object.values(this._platformData)) {
      for (const v of data.videos || []) {
        if (v.video_id !== video_id) continue;
        for (const day of v.daily || []) {
          const dayDate = new Date(day.date);
          // Only include dates within range and not in the future
          if (dayDate >= cutoffDate && dayDate <= today) {
            const key = day.date.substring(0, 10); // YYYY-MM-DD
            const existing = dailyMap.get(key) || { date: key, views: 0, likes: 0, comments: 0, shares: 0 };
            existing.views += day.views || 0;
            existing.likes += day.likes || 0;
            existing.comments += day.comments || 0;
            existing.shares += day.shares || 0;
            dailyMap.set(key, existing);
          }
        }
      }
    }

    // Convert to sorted array
    const result = [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date));
    return result;
  }

  // ── Optimal Post Times ──────────────────────────────────────────────────

  /**
   * Get optimal posting times for a platform.
   * If actual data is available, derive from aggregated views; otherwise
   * fall back to industry defaults.
   *
   * @param {string} platform
   * @returns {{ best_hours: number[], best_days: string[], reason: string }}
   */
  getOptimalPostTimes(platform) {
    const pd = this._platformData[platform];
    if (!pd) {
      return PLATFORM_POST_TIMES[platform] || { best_hours: [], best_days: [], reason: "No data available for this platform." };
    }

    // Aggregate daily data to find peak hours and days
    const hourViews = new Map();
    const dayViews = new Map();

    for (const v of pd.videos || []) {
      for (const day of v.daily || []) {
        // Derive hour from daily data if available, otherwise use hour of date
        if (day.hour !== undefined) {
          hourViews.set(day.hour, (hourViews.get(day.hour) || 0) + (day.views || 0));
        }
      }
      // Use the date's day-of-week for day analysis
      for (const day of v.daily || []) {
        const d = new Date(day.date);
        const dayName = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d.getDay()];
        dayViews.set(dayName, (dayViews.get(dayName) || 0) + (day.views || 0));
      }
    }

    // If we have enough data, derive from it
    if (hourViews.size > 0 && dayViews.size > 0) {
      const sortedHours = [...hourViews.entries()].sort((a, b) => b[1] - a[1]);
      const best_hours = sortedHours.slice(0, 5).map(([h]) => h);

      const sortedDays = [...dayViews.entries()].sort((a, b) => b[1] - a[1]);
      const best_days = sortedDays.slice(0, 4).map(([d]) => d);

      return {
        best_hours,
        best_days,
        reason: "Derived from your actual engagement data for this platform.",
      };
    }

    // Fall back to defaults
    return PLATFORM_POST_TIMES[platform] || { best_hours: [], best_days: [], reason: "No data available for this platform." };
  }

  // ── Content Recommendations ─────────────────────────────────────────────

  /**
   * Generate improvement recommendations for a specific video.
   * @param {string} video_id
   * @returns {string[]}
   */
  getContentRecommendations(video_id) {
    const video = this._videos.find((v) => v.video_id === video_id);
    if (!video) return [];

    const recommendations = [];

    // Low completion rate → suggest captions, shorter length, better hooks
    if (video.completion_rate < 0.3) {
      recommendations.push("add_captions");
      recommendations.push("shorten_video_length");
      recommendations.push("improve_hook");
    } else if (video.completion_rate < 0.5) {
      recommendations.push("add_captions");
      recommendations.push("improve_pacing");
    } else if (video.completion_rate < 0.7) {
      recommendations.push("improve_pacing");
    }

    // High drop-off point → suggest improved thumbnail at that point
    if (video.drop_off_point_sec !== undefined && video.duration_sec) {
      const dropOffRatio = video.drop_off_point_sec / video.duration_sec;
      if (dropOffRatio < 0.2) {
        recommendations.push("improve_thumbnail");
        recommendations.push("improve_hook");
      } else if (dropOffRatio < 0.5) {
        recommendations.push("improve_thumbnail");
      }
    }

    // Duration-based suggestions
    if (video.duration_sec > 1200) {
      recommendations.push("consider_shorter_version");
    } else if (video.duration_sec < 15) {
      recommendations.push("consider_extending_content");
    }

    // Cross-platform engagement check
    const totalViews = this._getTotalViewsForVideo(video_id);
    if (totalViews < 100) {
      recommendations.push("improve_seo_title");
      recommendations.push("improve_thumbnail");
    }

    // Check like-to-view ratio
    const { likes, views } = this._getEngagementForVideo(video_id);
    if (views > 0 && likes / views < 0.02) {
      recommendations.push("improve_thumbnail");
    }

    return [...new Set(recommendations)]; // Deduplicate
  }

  // ── Export Report ────────────────────────────────────────────────────────

  /**
   * Export a comprehensive analytics report.
   * @param {string} [format='json'] — 'json' for now
   * @returns {string} JSON string
   */
  exportReport(format = "json") {
    if (format !== "json") {
      throw new Error(`Unsupported format: ${format}. Use 'json'.`);
    }

    const summary = this.getDashboardSummary();
    const platforms = this.getPlatformComparison();
    const topVideos = this.getTopVideos(10);
    const worstVideos = this.getWorstPerforming(10);

    const report = {
      generated_at: new Date().toISOString(),
      summary,
      platform_comparison: platforms,
      top_videos: topVideos,
      worst_performing: worstVideos,
      video_count: this._videos.length,
      platform_count: Object.keys(this._platformData).length,
    };

    return JSON.stringify(report, null, 2);
  }

  // ── Internal Helpers ────────────────────────────────────────────────────

  /**
   * Compute trend by comparing recent 7 days vs previous 7 days.
   * @returns {'up' | 'down' | 'stable'}
   */
  _computeTrend() {
    let recentViews = 0;
    let previousViews = 0;
    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const fourteenDaysAgo = new Date(now);
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    for (const data of Object.values(this._platformData)) {
      for (const v of data.videos || []) {
        for (const day of v.daily || []) {
          const d = new Date(day.date);
          if (d >= sevenDaysAgo && d <= now) {
            recentViews += day.views || 0;
          } else if (d >= fourteenDaysAgo && d < sevenDaysAgo) {
            previousViews += day.views || 0;
          }
        }
      }
    }

    if (previousViews === 0 && recentViews === 0) return "stable";
    if (previousViews === 0) return "up";

    const change = (recentViews - previousViews) / previousViews;
    if (change > 0.05) return "up";
    if (change < -0.05) return "down";
    return "stable";
  }

  /**
   * Get total views for a video across all platforms.
   */
  _getTotalViewsForVideo(video_id) {
    let total = 0;
    for (const data of Object.values(this._platformData)) {
      for (const v of data.videos || []) {
        if (v.video_id === video_id) {
          total += v.views || 0;
        }
      }
    }
    return total;
  }

  /**
   * Get aggregate likes and views for a video across all platforms.
   */
  _getEngagementForVideo(video_id) {
    let likes = 0;
    let views = 0;
    for (const data of Object.values(this._platformData)) {
      for (const v of data.videos || []) {
        if (v.video_id === video_id) {
          likes += v.likes || 0;
          views += v.views || 0;
        }
      }
    }
    return { likes, views };
  }
}
