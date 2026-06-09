/**
 * Analytics module for Vireo Studio
 * Video performance tracking, retention curves, demographics, engagement, revenue estimates
 */

const CPM = { youtube: 5, tiktok: 1, instagram: 4 };

function seededRandom(seed) {
  let s = seed;
  return function () {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function generateDemographics(videoId, totalViews) {
  const rng = seededRandom(hashStr(videoId));
  const ageRanges = ['13-17', '18-24', '25-34', '35-44', '45-54', '55+'];
  const genders = ['male', 'female', 'other'];
  const countries = ['US', 'UK', 'IN', 'BR', 'DE', 'FR', 'JP', 'CA', 'AU', 'KR'];

  let raw = ageRanges.map((r) => ({ range: r, pct: rng() }));
  let sum = raw.reduce((a, b) => a + b.pct, 0);
  let age_groups = raw.map((a) => ({ range: a.range, pct: round2((a.pct / sum) * 100) }));

  raw = genders.map((t) => ({ type: t, pct: rng() }));
  sum = raw.reduce((a, b) => a + b.pct, 0);
  let gender = raw.map((g) => ({ type: g.type, pct: round2((g.pct / sum) * 100) }));

  raw = countries.map((c) => ({ country: c, pct: rng() }));
  sum = raw.reduce((a, b) => a + b.pct, 0);
  let top_countries = raw.map((c) => ({ country: c.country, pct: round2((c.pct / sum) * 100) }));
  top_countries.sort((a, b) => b.pct - a.pct);

  return { age_groups, gender, top_countries };
}

function hashStr(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

class VideoAnalytics {
  constructor() {
    this.videos = new Map();
    this.views = new Map();
  }

  trackVideo({ video_id, title, platforms = [], duration_sec, published_at }) {
    if (!video_id || !duration_sec || duration_sec <= 0) {
      throw new Error('Invalid video parameters');
    }
    this.videos.set(video_id, {
      video_id,
      title: title || '',
      platforms: Array.isArray(platforms) ? platforms : [],
      duration_sec,
      published_at: published_at || new Date().toISOString(),
    });
    if (!this.views.has(video_id)) this.views.set(video_id, []);
  }

  recordView({ video_id, platform, timestamp, watch_duration_sec, user_agent }) {
    if (!this.videos.has(video_id)) throw new Error('Video not found');
    const video = this.videos.get(video_id);
    const capped = Math.min(Math.max(watch_duration_sec || 0, 0), video.duration_sec);
    const view = {
      platform: platform || 'unknown',
      timestamp: timestamp || new Date().toISOString(),
      watch_duration_sec: capped,
      user_agent: user_agent || null,
    };
    this.views.get(video_id).push(view);
  }

  getVideoStats(video_id) {
    if (!this.videos.has(video_id)) return null;
    const video = this.videos.get(video_id);
    const viewList = this.views.get(video_id) || [];
    const views = viewList.length;
    if (views === 0) return { views: 0, total_watch_time_sec: 0, avg_watch_pct: 0, retention_curve: this._retentionCurve(video_id, 10), completion_rate: 0 };

    const total_watch_time_sec = viewList.reduce((s, v) => s + v.watch_duration_sec, 0);
    const avg_watch_pct = round2((total_watch_time_sec / (views * video.duration_sec)) * 100);
    const completion_count = viewList.filter((v) => v.watch_duration_sec >= video.duration_sec).length;
    const completion_rate = round2((completion_count / views) * 100);

    return {
      views,
      total_watch_time_sec,
      avg_watch_pct,
      retention_curve: this._retentionCurve(video_id, 10),
      completion_rate,
    };
  }

  getPlatformStats(video_id, platform) {
    if (!this.videos.has(video_id)) return null;
    const video = this.videos.get(video_id);
    const viewList = (this.views.get(video_id) || []).filter((v) => v.platform === platform);
    const views = viewList.length;
    if (views === 0) return { views: 0, likes: 0, comments: 0, shares: 0, watch_time_sec: 0, avg_view_pct: 0 };

    const watch_time_sec = viewList.reduce((s, v) => s + v.watch_duration_sec, 0);
    const avg_view_pct = round2((watch_time_sec / (views * video.duration_sec)) * 100);

    const rng = seededRandom(hashStr(video_id + platform));
    const likes = Math.round(views * (0.03 + rng() * 0.12));
    const comments = Math.round(views * (0.005 + rng() * 0.03));
    const shares = Math.round(views * (0.01 + rng() * 0.05));

    return { views, likes, comments, shares, watch_time_sec, avg_view_pct };
  }

  _retentionCurve(video_id, buckets) {
    const video = this.videos.get(video_id);
    const viewList = this.views.get(video_id) || [];
    const views = viewList.length;
    if (views === 0) {
      return Array.from({ length: buckets + 1 }, (_, i) => ({
        time_pct: round2((i / buckets) * 100),
        retained_pct: 0,
      }));
    }

    const curve = [];
    for (let i = 0; i <= buckets; i++) {
      const threshold = (i / buckets) * video.duration_sec;
      const retained = viewList.filter((v) => v.watch_duration_sec >= threshold).length;
      curve.push({
        time_pct: round2((i / buckets) * 100),
        retained_pct: round2((retained / views) * 100),
      });
    }
    return curve;
  }

  getRetentionCurve(video_id, buckets = 10) {
    if (!this.videos.has(video_id)) return null;
    return this._retentionCurve(video_id, buckets);
  }

  getAudienceDemographics(video_id) {
    if (!this.videos.has(video_id)) return null;
    const viewList = this.views.get(video_id) || [];
    return generateDemographics(video_id, viewList.length);
  }

  getEngagementRate(video_id) {
    if (!this.videos.has(video_id)) return null;
    const viewList = this.views.get(video_id) || [];
    const views = viewList.length;
    if (views === 0) return { likes_per_view: 0, comments_per_view: 0, shares_per_view: 0, overall: 0 };

    const video = this.videos.get(video_id);
    const platform = video.platforms[0] || 'youtube';
    const stats = this.getPlatformStats(video_id, platform);
    const likes_per_view = views > 0 ? round2(stats.likes / views) : 0;
    const comments_per_view = views > 0 ? round2(stats.comments / views) : 0;
    const shares_per_view = views > 0 ? round2(stats.shares / views) : 0;
    const overall = round2(likes_per_view + comments_per_view + shares_per_view);

    return { likes_per_view, comments_per_view, shares_per_view, overall };
  }

  getRevenueEstimate(video_id, platform) {
    if (!this.videos.has(video_id)) return null;
    const viewList = (this.views.get(video_id) || []).filter((v) => v.platform === platform);
    const impressions = viewList.length;
    const cpm = CPM[platform] || 5;
    const estimated_revenue = round2((impressions / 1000) * cpm);
    return { estimated_revenue, cpm, impressions };
  }

  listVideos({ sort_by = 'views', limit = 50, platform } = {}) {
    let results = [];
    for (const [id] of this.videos) {
      const viewList = this.views.get(id) || [];
      const filtered = platform ? viewList.filter((v) => v.platform === platform) : viewList;
      results.push({ video_id: id, views: filtered.length });
    }

    if (platform) results = results.filter((r) => r.views > 0);
    if (sort_by === 'views') results.sort((a, b) => b.views - a.views);
    if (sort_by === 'title') results.sort((a, b) => a.video_id.localeCompare(b.video_id));

    if (limit) results = results.slice(0, limit);
    return results;
  }

  getOverallStats() {
    let total_views = 0;
    let total_watch_time = 0;
    let total_videos = this.videos.size;
    let total_completion = 0;
    let videos_with_views = 0;

    for (const [id] of this.videos) {
      const stats = this.getVideoStats(id);
      total_views += stats.views;
      total_watch_time += stats.total_watch_time_sec;
      if (stats.views > 0) {
        total_completion += stats.completion_rate;
        videos_with_views++;
      }
    }

    return {
      total_views,
      total_watch_time,
      total_videos,
      avg_completion: videos_with_views > 0 ? round2(total_completion / videos_with_views) : 0,
    };
  }
}

export { VideoAnalytics, CPM };
