/**
 * Analytics Pro module for Vireo Studio
 * Advanced analytics: retention curves, demographics, engagement, revenue,
 * competitor analysis, content recommendations, and exportable reports.
 *
 * Provides an AnalyticsPro class with 10 tool methods:
 *   1. getVideoMetrics({ videoId, platform })
 *   2. getRetentionCurve({ videoId })
 *   3. getDemographics({ channelId, timeRange })
 *   4. getEngagementMetrics({ videoId })
 *   5. getRevenueMetrics({ channelId, timeRange })
 *   6. getSubscriberGrowth({ channelId, timeRange })
 *   7. getTopVideos({ channelId, sortBy, limit })
 *   8. getContentRecommendations({ channelId })
 *   9. getCompetitorAnalysis({ channelIds })
 *  10. exportReport({ channelId, format, timeRange })
 *
 * Usage:
 *   import { AnalyticsPro } from "./analytics_pro.js";
 *   const ap = new AnalyticsPro();
 *   ap.registerChannel({ channelId: 'UC123', name: 'My Channel', subscribers: 50000 });
 *   ap.registerVideo({ videoId: 'v1', channelId: 'UC123', title: 'Hello', platform: 'youtube', duration_sec: 600, published_at: '2026-01-01' });
 *   const metrics = ap.getVideoMetrics({ videoId: 'v1', platform: 'youtube' });
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

function seededRandom(seed) {
  let s = Math.abs(seed) || 1;
  return function () {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function hashStr(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function daysBetween(dateA, dateB) {
  const msPerDay = 86400000;
  return Math.round(Math.abs(new Date(dateA) - new Date(dateB)) / msPerDay);
}

const CPM_RATES = { youtube: 5, tiktok: 1, instagram: 4, facebook: 3, twitter: 2 };

// ── AnalyticsPro Class ───────────────────────────────────────────────────────

class AnalyticsPro {
  constructor() {
    /** @type {Map<string, object>} channelId → channel metadata */
    this.channels = new Map();
    /** @type {Map<string, object>} videoId → video metadata */
    this.videos = new Map();
    /** @type {Map<string, Array<object>>} videoId → view records */
    this.viewRecords = new Map();
    /** @type {Map<string, object>} videoId → engagement snapshot */
    this.engagementData = new Map();
    /** @type {Map<string, object>} channelId → subscriber history */
    this.subscriberHistory = new Map();
    /** @type {Map<string, object[]>} channelId → revenue records */
    this.revenueRecords = new Map();
  }

  // ── Registration ─────────────────────────────────────────────────────────

  registerChannel({ channelId, name = '', subscribers = 0, platforms = ['youtube'] }) {
    if (!channelId || subscribers < 0) throw new Error('Invalid channel parameters');
    this.channels.set(channelId, {
      channelId,
      name: name || channelId,
      subscribers: Math.max(0, Math.floor(subscribers)),
      platforms: Array.isArray(platforms) ? platforms : ['youtube'],
      created_at: new Date().toISOString(),
    });
    if (!this.subscriberHistory.has(channelId)) {
      this.subscriberHistory.set(channelId, []);
    }
    if (!this.revenueRecords.has(channelId)) {
      this.revenueRecords.set(channelId, []);
    }
  }

  registerVideo({ videoId, channelId, title = '', platform = 'youtube', duration_sec = 300, published_at }) {
    if (!videoId || !duration_sec || duration_sec <= 0) throw new Error('Invalid video parameters');
    this.videos.set(videoId, {
      videoId,
      channelId: channelId || null,
      title: title || videoId,
      platform,
      duration_sec,
      published_at: published_at || new Date().toISOString(),
    });
    if (!this.viewRecords.has(videoId)) this.viewRecords.set(videoId, []);
    if (!this.engagementData.has(videoId)) {
      this.engagementData.set(videoId, {
        likes: 0,
        comments: 0,
        shares: 0,
        saves: 0,
      });
    }
  }

  addView({ videoId, platform = 'youtube', watch_duration_sec = 0, timestamp }) {
    if (!this.videos.has(videoId)) throw new Error('Video not found');
    const video = this.videos.get(videoId);
    const capped = Math.min(Math.max(watch_duration_sec, 0), video.duration_sec);
    const view = {
      platform,
      timestamp: timestamp || new Date().toISOString(),
      watch_duration_sec: capped,
    };
    this.viewRecords.get(videoId).push(view);

    // Increment engagement counters based on probability
    const rng = seededRandom(hashStr(videoId + (timestamp || '')));
    const eng = this.engagementData.get(videoId);
    eng.likes += rng() < 0.08 ? 1 : 0;
    eng.comments += rng() < 0.02 ? 1 : 0;
    eng.shares += rng() < 0.03 ? 1 : 0;
    eng.saves += rng() < 0.01 ? 1 : 0;

    return view;
  }

  addRevenueRecord({ channelId, date, revenue, videoId }) {
    if (!this.channels.has(channelId)) throw new Error('Channel not found');
    this.revenueRecords.get(channelId).push({
      date: date || new Date().toISOString(),
      revenue: Math.max(0, revenue || 0),
      videoId: videoId || null,
    });
  }

  addSubscriberDataPoint({ channelId, date, new_subs, lost_subs }) {
    if (!this.channels.has(channelId)) throw new Error('Channel not found');
    const history = this.subscriberHistory.get(channelId);
    history.push({
      date: date || new Date().toISOString(),
      new_subs: Math.max(0, new_subs || 0),
      lost_subs: Math.max(0, lost_subs || 0),
    });
  }

  addCompetitorData({ channelId, name = '', subscribers = 0, avg_views = 0, growth_rate = 0, strengths = [] }) {
    // Register a channel as a known competitor (can be external)
    if (!this.channels.has(channelId)) {
      this.channels.set(channelId, {
        channelId,
        name: name || channelId,
        subscribers: Math.max(0, Math.floor(subscribers)),
        platforms: [],
        created_at: new Date().toISOString(),
        is_competitor: true,
      });
    }
    const ch = this.channels.get(channelId);
    ch.avg_views = avg_views;
    ch.growth_rate = growth_rate;
    ch.strengths = Array.isArray(strengths) ? strengths : [];
    ch.is_competitor = true;
  }

  // ── Tool 1: getVideoMetrics ──────────────────────────────────────────────

  /**
   * Returns metrics for a specific video.
   * @param {{ videoId: string, platform?: string }} params
   * @returns {{ views, likes, comments, shares, watch_time_sec, retention_rate } | null}
   */
  getVideoMetrics({ videoId, platform = 'youtube' }) {
    if (!this.videos.has(videoId)) return null;
    const video = this.videos.get(videoId);
    const views = this.viewRecords.get(videoId) || [];
    const filteredViews = views.filter(v => v.platform === platform);
    const viewCount = views.length;
    const filteredCount = filteredViews.length;

    if (viewCount === 0) {
      return { views: 0, likes: 0, comments: 0, shares: 0, watch_time_sec: 0, retention_rate: 0 };
    }

    const totalWatchTime = views.reduce((s, v) => s + v.watch_duration_sec, 0);
    const retentionRate = round2((totalWatchTime / (viewCount * video.duration_sec)) * 100);

    const eng = this.engagementData.get(videoId);
    return {
      views: filteredCount > 0 ? filteredCount : viewCount,
      likes: eng.likes,
      comments: eng.comments,
      shares: eng.shares,
      watch_time_sec: totalWatchTime,
      retention_rate: retentionRate,
    };
  }

  // ── Tool 2: getRetentionCurve ────────────────────────────────────────────

  /**
   * Returns a retention curve and drop-off analysis for a video.
   * @param {{ videoId: string, buckets?: number }} params
   * @returns {{ points: Array<{time_sec, percent_remaining}>, drop_offs: Array<{time, rate}> } | null}
   */
  getRetentionCurve({ videoId, buckets = 10 }) {
    if (!this.videos.has(videoId)) return null;
    const video = this.videos.get(videoId);
    const viewList = this.viewRecords.get(videoId) || [];
    const viewCount = viewList.length;

    if (viewCount === 0) {
      const points = Array.from({ length: buckets + 1 }, (_, i) => ({
        time_sec: Math.round((i / buckets) * video.duration_sec),
        percent_remaining: 0,
      }));
      return { points, drop_offs: [] };
    }

    const points = [];
    const drop_offs = [];
    let prevRetained = 100;

    for (let i = 0; i <= buckets; i++) {
      const timeSec = Math.round((i / buckets) * video.duration_sec);
      const retained = viewList.filter(v => v.watch_duration_sec >= timeSec).length;
      const percentRemaining = round2((retained / viewCount) * 100);

      points.push({ time_sec: timeSec, percent_remaining: percentRemaining });

      if (i > 0) {
        const dropRate = round2(prevRetained - percentRemaining);
        if (dropRate > 0) {
          drop_offs.push({ time: timeSec, rate: dropRate });
        }
      }
      prevRetained = percentRemaining;
    }

    return { points, drop_offs };
  }

  // ── Tool 3: getDemographics ──────────────────────────────────────────────

  /**
   * Returns audience demographics for a channel.
   * @param {{ channelId: string, timeRange?: string }} params
   * @returns {{ age: Array<{range, percent}>, gender: Array<{type, percent}>, top_countries: Array<{country, percent}> } | null}
   */
  getDemographics({ channelId, timeRange = '30d' }) {
    if (!this.channels.has(channelId)) return null;
    const rng = seededRandom(hashStr(channelId + timeRange));

    const ageRanges = ['13-17', '18-24', '25-34', '35-44', '45-54', '55+'];
    const genders = ['male', 'female', 'other'];
    const countries = ['US', 'UK', 'IN', 'BR', 'DE', 'FR', 'JP', 'CA', 'AU', 'KR', 'MX', 'IT'];

    let raw = ageRanges.map(r => ({ range: r, val: rng() }));
    let sum = raw.reduce((a, b) => a + b.val, 0);
    const age = raw.map(a => ({ range: a.range, percent: round2((a.val / sum) * 100) }));

    raw = genders.map(t => ({ type: t, val: rng() }));
    sum = raw.reduce((a, b) => a + b.val, 0);
    const gender = raw.map(g => ({ type: g.type, percent: round2((g.val / sum) * 100) }));

    raw = countries.map(c => ({ country: c, val: rng() }));
    sum = raw.reduce((a, b) => a + b.val, 0);
    const top_countries = raw.map(c => ({ country: c.country, percent: round2((c.val / sum) * 100) }));
    top_countries.sort((a, b) => b.percent - a.percent);

    return { age, gender, top_countries };
  }

  // ── Tool 4: getEngagementMetrics ─────────────────────────────────────────

  /**
   * Returns engagement metrics for a specific video.
   * @param {{ videoId: string }} params
   * @returns {{ like_rate, comment_rate, share_rate, save_rate, engagement_score } | null}
   */
  getEngagementMetrics({ videoId }) {
    if (!this.videos.has(videoId)) return null;
    const views = (this.viewRecords.get(videoId) || []).length;
    if (views === 0) {
      return { like_rate: 0, comment_rate: 0, share_rate: 0, save_rate: 0, engagement_score: 0 };
    }

    const eng = this.engagementData.get(videoId);
    const like_rate = round2(eng.likes / views);
    const comment_rate = round2(eng.comments / views);
    const share_rate = round2(eng.shares / views);
    const save_rate = round2(eng.saves / views);
    const engagement_score = round2(like_rate + comment_rate + share_rate + save_rate);

    return { like_rate, comment_rate, share_rate, save_rate, engagement_score };
  }

  // ── Tool 5: getRevenueMetrics ────────────────────────────────────────────

  /**
   * Returns revenue metrics for a channel over a time range.
   * @param {{ channelId: string, timeRange?: string }} params
   * @returns {{ ad_revenue, rpm, cpm, estimated_monthly, revenue_by_video: Array<{videoId, revenue}> } | null}
   */
  getRevenueMetrics({ channelId, timeRange = '30d' }) {
    if (!this.channels.has(channelId)) return null;
    const records = this.revenueRecords.get(channelId) || [];

    const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : timeRange === '90d' ? 90 : 30;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const filtered = records.filter(r => new Date(r.date) >= cutoff);
    const ad_revenue = round2(filtered.reduce((s, r) => s + r.revenue, 0));

    // Count total views for the channel
    let totalViews = 0;
    for (const [vid, video] of this.videos) {
      if (video.channelId === channelId) {
        totalViews += (this.viewRecords.get(vid) || []).length;
      }
    }

    const cpm = totalViews > 0 ? round2((ad_revenue / totalViews) * 1000) : 5;
    const rpm = totalViews > 0 ? round2((ad_revenue / totalViews) * 1000) : 0;
    const estimated_monthly = round2((ad_revenue / days) * 30);

    // Revenue by video
    const revByVideo = new Map();
    for (const r of filtered) {
      if (r.videoId) {
        revByVideo.set(r.videoId, (revByVideo.get(r.videoId) || 0) + r.revenue);
      }
    }
    const revenue_by_video = [...revByVideo.entries()].map(([videoId, revenue]) => ({
      videoId,
      revenue: round2(revenue),
    }));

    return { ad_revenue, rpm, cpm, estimated_monthly, revenue_by_video };
  }

  // ── Tool 6: getSubscriberGrowth ──────────────────────────────────────────

  /**
   * Returns subscriber growth metrics for a channel.
   * @param {{ channelId: string, timeRange?: string }} params
   * @returns {{ new_subs, lost_subs, net_growth, growth_rate, projections } | null}
   */
  getSubscriberGrowth({ channelId, timeRange = '30d' }) {
    if (!this.channels.has(channelId)) return null;
    const channel = this.channels.get(channelId);
    const history = this.subscriberHistory.get(channelId) || [];

    const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : timeRange === '90d' ? 90 : 30;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const filtered = history.filter(h => new Date(h.date) >= cutoff);
    const new_subs = filtered.reduce((s, h) => s + h.new_subs, 0);
    const lost_subs = filtered.reduce((s, h) => s + h.lost_subs, 0);
    const net_growth = new_subs - lost_subs;
    const baseSubs = channel.subscribers || 1;
    const growth_rate = round2((net_growth / baseSubs) * 100);

    // Projection: extrapolate daily rate to 90 days
    const dailyRate = days > 0 ? net_growth / days : 0;
    const projections = {
      in_30_days: Math.round(baseSubs + dailyRate * 30),
      in_90_days: Math.round(baseSubs + dailyRate * 90),
      in_365_days: Math.round(baseSubs + dailyRate * 365),
    };

    return { new_subs, lost_subs, net_growth, growth_rate, projections };
  }

  // ── Tool 7: getTopVideos ─────────────────────────────────────────────────

  /**
   * Returns top videos for a channel sorted by the specified metric.
   * @param {{ channelId: string, sortBy?: string, limit?: number }} params
   * @returns {{ videos: Array<{id, title, views, revenue, age_days}>, total_count: number } | null}
   */
  getTopVideos({ channelId, sortBy = 'views', limit = 10 }) {
    if (!this.channels.has(channelId)) return null;

    const channelVideos = [];
    for (const [vid, video] of this.videos) {
      if (video.channelId !== channelId) continue;
      const views = (this.viewRecords.get(vid) || []).length;
      const age_days = daysBetween(new Date(), video.published_at);

      // Estimate revenue based on CPM
      const cpm = CPM_RATES[video.platform] || 5;
      const revenue = round2((views / 1000) * cpm);

      channelVideos.push({
        id: vid,
        title: video.title,
        views,
        revenue,
        age_days,
      });
    }

    const sortKey = sortBy === 'revenue' ? 'revenue' : sortBy === 'age' ? 'age_days' : 'views';
    if (sortKey === 'age_days') {
      channelVideos.sort((a, b) => a.age_days - b.age_days);
    } else {
      channelVideos.sort((a, b) => b[sortKey] - a[sortKey]);
    }

    const total_count = channelVideos.length;
    const videos = channelVideos.slice(0, limit);

    return { videos, total_count };
  }

  // ── Tool 8: getContentRecommendations ────────────────────────────────────

  /**
   * Returns content recommendations for a channel based on its performance.
   * @param {{ channelId: string }} params
   * @returns {{ recommendations: Array<{topic, reason, estimated_views, competition}> } | null}
   */
  getContentRecommendations({ channelId }) {
    if (!this.channels.has(channelId)) return null;
    const rng = seededRandom(hashStr(channelId));
    const channel = this.channels.get(channelId);

    // Analyze channel's existing video performance
    let totalViews = 0;
    let totalVideos = 0;
    let avgEngagement = 0;

    for (const [vid, video] of this.videos) {
      if (video.channelId !== channelId) continue;
      totalVideos++;
      const views = (this.viewRecords.get(vid) || []).length;
      totalViews += views;
      const eng = this.engagementData.get(vid);
      if (views > 0) {
        avgEngagement += (eng.likes + eng.comments + eng.shares) / views;
      }
    }

    avgEngagement = totalVideos > 0 ? avgEngagement / totalVideos : 0;

    // Generate recommendations based on channel performance
    const topicPool = [
      { topic: 'Tutorial Series', baseViews: 15000, competition: 'medium' },
      { topic: 'Behind the Scenes', baseViews: 8000, competition: 'low' },
      { topic: 'Trending Challenges', baseViews: 25000, competition: 'high' },
      { topic: 'Q&A with Audience', baseViews: 10000, competition: 'low' },
      { topic: 'Collaboration Video', baseViews: 20000, competition: 'medium' },
      { topic: 'Product Review', baseViews: 12000, competition: 'high' },
      { topic: 'Day in My Life', baseViews: 18000, competition: 'medium' },
      { topic: 'Compilation/Best Of', baseViews: 22000, competition: 'high' },
      { topic: 'How-To Guide', baseViews: 14000, competition: 'medium' },
      { topic: 'Reaction Video', baseViews: 16000, competition: 'high' },
    ];

    const subs = channel.subscribers;
    const recommendations = topicPool.map(t => {
      const estimated_views = Math.round(t.baseViews * (subs / 100000) * (0.8 + rng() * 0.4));
      let reason = '';
      if (avgEngagement > 0.1) {
        reason = `High engagement (${round2(avgEngagement * 100)}%) suggests audience wants interactive content`;
      } else if (subs > 50000) {
        reason = 'Large subscriber base can support mainstream topics';
      } else if (subs < 10000) {
        reason = 'Growing channel benefits from discoverable content';
      } else {
        reason = 'Balanced approach for steady growth';
      }

      return {
        topic: t.topic,
        reason,
        estimated_views: Math.max(100, estimated_views),
        competition: t.competition,
      };
    });

    // Sort by estimated_views descending
    recommendations.sort((a, b) => b.estimated_views - a.estimated_views);

    return { recommendations };
  }

  // ── Tool 9: getCompetitorAnalysis ────────────────────────────────────────

  /**
   * Returns a competitive analysis comparing channels.
   * @param {{ channelIds: string[] }} params
   * @returns {{ channels: Array<{id, subs, avg_views, growth_rate, strengths}>, opportunities: string[] } | null}
   */
  getCompetitorAnalysis({ channelIds = [] }) {
    if (!channelIds || channelIds.length === 0) return null;

    const channels = [];
    for (const cid of channelIds) {
      const ch = this.channels.get(cid);
      if (!ch) continue;

      // Compute avg_views from video data
      let totalViews = 0;
      let videoCount = 0;
      for (const [vid, video] of this.videos) {
        if (video.channelId !== cid) continue;
        videoCount++;
        totalViews += (this.viewRecords.get(vid) || []).length;
      }
      const avg_views = videoCount > 0 ? Math.round(totalViews / videoCount) : ch.avg_views || 0;

      channels.push({
        id: cid,
        subs: ch.subscribers || 0,
        avg_views,
        growth_rate: ch.growth_rate || 0,
        strengths: ch.strengths || [],
      });
    }

    if (channels.length === 0) return null;

    // Identify opportunities
    const maxSubs = Math.max(...channels.map(c => c.subs));
    const maxAvgViews = Math.max(...channels.map(c => c.avg_views));
    const opportunities = [];

    for (const ch of channels) {
      if (ch.subs === maxSubs && ch.avg_views < maxAvgViews) {
        opportunities.push(`${ch.id} has the most subscribers but lower avg views — content quality improvement opportunity`);
      }
      if (ch.avg_views === maxAvgViews && ch.subs < maxSubs) {
        opportunities.push(`${ch.id} gets high views per video but has fewer subscribers — conversion opportunity`);
      }
      if (ch.growth_rate > 0 && ch.subs < maxSubs * 0.5) {
        opportunities.push(`${ch.id} is growing quickly but still small — partnership or feature opportunity`);
      }
    }

    if (opportunities.length === 0) {
      opportunities.push('Channels are evenly matched — differentiate with unique content niches');
    }

    return { channels, opportunities };
  }

  // ── Tool 10: exportReport ────────────────────────────────────────────────

  /**
   * Exports a comprehensive analytics report in the specified format.
   * @param {{ channelId: string, format?: string, timeRange?: string }} params
   * @returns {{ report_url, format, page_count, generated_at } | null}
   */
  exportReport({ channelId, format = 'json', timeRange = '30d' }) {
    if (!this.channels.has(channelId)) return null;
    const validFormats = ['pdf', 'csv', 'json', 'html'];
    if (!validFormats.includes(format)) {
      throw new Error(`Invalid format: ${format}. Supported: ${validFormats.join(', ')}`);
    }

    const channel = this.channels.get(channelId);
    const metrics = this.getTopVideos({ channelId, sortBy: 'views', limit: 100 });
    const demographics = this.getDemographics({ channelId, timeRange });
    const revenue = this.getRevenueMetrics({ channelId, timeRange });
    const growth = this.getSubscriberGrowth({ channelId, timeRange });

    // Estimate page count based on data volume
    const videoCount = metrics ? metrics.total_count : 0;
    let page_count = 1; // cover page
    page_count += 1; // summary
    page_count += Math.ceil(videoCount / 20); // videos table (20 per page)
    page_count += 1; // demographics
    page_count += 1; // revenue
    page_count += 1; // growth
    page_count = Math.max(page_count, 2);

    const generated_at = new Date().toISOString();
    const reportId = `RPT-${channelId}-${Date.now()}`;
    const report_url = `reports/${reportId}.${format}`;

    return {
      report_url,
      format,
      page_count,
      generated_at,
    };
  }
}

export { AnalyticsPro, CPM_RATES };
