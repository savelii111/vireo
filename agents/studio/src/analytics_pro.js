/**
 * Advanced Analytics Module for Vireo Studio
 *
 * Provides 10 specialized analytics classes:
 *   1.  VideoPerformanceTracker – track / query video performance & retention
 *   2.  AudienceDemographics    – age, gender, geography breakdowns
 *   3.  EngagementAnalyzer      – likes, comments, shares per video
 *   4.  RevenueTracker          – track & report revenue by source / period
 *   5.  CPMAnalyzer             – CPM trends, benchmarks, best-performing videos
 *   6.  ContentOptimizer        – title / thumbnail / description scoring
 *   7.  CompetitorBenchmark     – channel comparisons & market share
 *   8.  TrendAnalyzer           – trending topics, seasonal patterns
 *   9.  PredictiveAnalytics     – forecast views, growth, revenue
 *  10.  ABRTesting              – A/B test creation, click tracking, significance
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

function daysBetween(a, b) {
  const msPerDay = 86400000;
  return Math.round(Math.abs(new Date(a) - new Date(b)) / msPerDay);
}

function parsePeriod(period) {
  const match = String(period).match(/^(\d+)([dhm])$/i);
  if (!match) return 30;
  const val = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  if (unit === 'd') return val;
  if (unit === 'h') return Math.ceil(val / 24);
  if (unit === 'm') return val * 30;
  return val;
}

function generateId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── 1. VideoPerformanceTracker ───────────────────────────────────────────────

class VideoPerformanceTracker {
  constructor() {
    /** @type {Map<string, object>} videoId → metadata */
    this.videos = new Map();
    /** @type {Map<string, Array<{views, watchTime, retention, timestamp}>>} */
    this.trackingData = new Map();
  }

  /**
   * Track a video's performance snapshot.
   * @param {string} videoId
   * @param {{ views: number, watch_time: number, retention?: number, timestamp?: string }} data
   */
  trackVideo(videoId, { views = 0, watch_time = 0, retention = 0, timestamp } = {}) {
    if (!videoId) throw new Error('videoId is required');
    if (views < 0) throw new Error('views must be non-negative');
    if (watch_time < 0) throw new Error('watch_time must be non-negative');
    if (!this.trackingData.has(videoId)) {
      this.videos.set(videoId, { videoId, created_at: new Date().toISOString() });
      this.trackingData.set(videoId, []);
    }
    const record = {
      views: Math.round(views),
      watch_time: round2(watch_time),
      retention: round2(Math.min(100, Math.max(0, retention))),
      timestamp: timestamp || new Date().toISOString(),
    };
    this.trackingData.get(videoId).push(record);
    return record;
  }

  /** Get latest performance snapshot for a video. */
  getPerformance(videoId) {
    const records = this.trackingData.get(videoId);
    if (!records || records.length === 0) return null;
    const latest = records[records.length - 1];
    const totalViews = records.reduce((s, r) => s + r.views, 0);
    const avgRetention = records.reduce((s, r) => s + r.retention, 0) / records.length;
    return {
      videoId,
      currentViews: latest.views,
      watchTime: latest.watch_time,
      retention: latest.retention,
      totalViewsTracked: totalViews,
      avgRetention: round2(avgRetention),
      dataPoints: records.length,
    };
  }

  /** Get trend data over a given period (e.g. '7d', '30d'). */
  getTrend(videoId, period = '30d') {
    const records = this.trackingData.get(videoId);
    if (!records || records.length === 0) return { videoId, points: [], direction: 'stable' };
    const days = parsePeriod(period);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const filtered = records.filter(r => new Date(r.timestamp) >= cutoff);
    if (filtered.length === 0) return { videoId, points: [], direction: 'stable' };

    const points = filtered.map(r => ({
      views: r.views,
      retention: r.retention,
      timestamp: r.timestamp,
    }));

    const first = filtered[0].views;
    const last = filtered[filtered.length - 1].views;
    const direction = last > first * 1.1 ? 'growing' : last < first * 0.9 ? 'declining' : 'stable';

    return { videoId, points, direction };
  }

  /** Get retention curve as an array of { time_pct, percent_remaining }. */
  getRetentionCurve(videoId) {
    const records = this.trackingData.get(videoId);
    if (!records || records.length === 0) return [];
    const buckets = 10;
    const curve = [];
    for (let i = 0; i <= buckets; i++) {
      const pct = (i / buckets) * 100;
      const avgRetained = records.reduce((s, r) => s + r.retention, 0) / records.length;
      const decay = Math.max(0, avgRetained * (1 - (i / buckets) * 0.5));
      curve.push({
        time_pct: round2(pct),
        percent_remaining: round2(Math.max(0, Math.min(100, decay))),
      });
    }
    return curve;
  }
}

// ── 2. AudienceDemographics ──────────────────────────────────────────────────

class AudienceDemographics {
  constructor() {
    /** @type {Map<string, object>} channelId → demographic profile */
    this.demographics = new Map();
  }

  /** Seed demographic data for a channel. */
  setDemographics(channelId, data) {
    if (!channelId) throw new Error('channelId is required');
    const rng = seededRandom(hashStr(channelId));
    this.demographics.set(channelId, {
      channelId,
      ageDistribution: data.ageDistribution || this._generateAge(rng),
      genderSplit: data.genderSplit || this._generateGender(rng),
      geography: data.geography || this._generateGeography(rng),
    });
  }

  /** Get full demographics for a channel. */
  getDemographics(channelId) {
    if (!this.demographics.has(channelId)) {
      this.setDemographics(channelId, {});
    }
    return this.demographics.get(channelId);
  }

  /** Get age distribution [{ group, percentage }]. */
  getAgeDistribution(channelId) {
    return this.getDemographics(channelId).ageDistribution;
  }

  /** Get gender split { male, female, other }. */
  getGenderSplit(channelId) {
    return this.getDemographics(channelId).genderSplit;
  }

  /** Get geography [{ country, percentage }]. */
  getGeography(channelId) {
    return this.getDemographics(channelId).geography;
  }

  _generateAge(rng) {
    const groups = ['13-17', '18-24', '25-34', '35-44', '45-54', '55+'];
    const raw = groups.map(g => ({ group: g, val: rng() }));
    const sum = raw.reduce((s, r) => s + r.val, 0);
    return raw.map(r => ({ group: r.group, percentage: round2((r.val / sum) * 100) }));
  }

  _generateGender(rng) {
    const m = rng();
    const f = rng();
    const o = rng();
    const sum = m + f + o;
    return {
      male: round2((m / sum) * 100),
      female: round2((f / sum) * 100),
      other: round2((o / sum) * 100),
    };
  }

  _generateGeography(rng) {
    const countries = ['US', 'UK', 'IN', 'BR', 'DE', 'FR', 'JP', 'CA', 'AU', 'KR'];
    const raw = countries.map(c => ({ country: c, val: rng() }));
    const sum = raw.reduce((s, r) => s + r.val, 0);
    return raw
      .map(r => ({ country: r.country, percentage: round2((r.val / sum) * 100) }))
      .sort((a, b) => b.percentage - a.percentage);
  }
}

// ── 3. EngagementAnalyzer ────────────────────────────────────────────────────

class EngagementAnalyzer {
  constructor() {
    /** @type {Map<string, { views, likes, comments, shares, saves }>} */
    this.data = new Map();
  }

  /** Register engagement data for a video. */
  setData(videoId, { views = 0, likes = 0, comments = 0, shares = 0, saves = 0 } = {}) {
    if (!videoId) throw new Error('videoId is required');
    this.data.set(videoId, {
      views: Math.max(0, views),
      likes: Math.max(0, likes),
      comments: Math.max(0, comments),
      shares: Math.max(0, shares),
      saves: Math.max(0, saves),
    });
  }

  /** Full engagement report. */
  analyzeEngagement(videoId) {
    const d = this.data.get(videoId);
    if (!d) return null;
    const total = d.likes + d.comments + d.shares + d.saves;
    return {
      videoId,
      views: d.views,
      likes: d.likes,
      comments: d.comments,
      shares: d.shares,
      saves: d.saves,
      totalEngagements: total,
      engagementRate: d.views > 0 ? round2((total / d.views) * 100) : 0,
    };
  }

  /** Engagement rate as a percentage. */
  getEngagementRate(videoId) {
    const d = this.data.get(videoId);
    if (!d || d.views === 0) return 0;
    const total = d.likes + d.comments + d.shares + d.saves;
    return round2((total / d.views) * 100);
  }

  /** Likes to views ratio. */
  getLikesToViews(videoId) {
    const d = this.data.get(videoId);
    if (!d || d.views === 0) return 0;
    return round2(d.likes / d.views);
  }

  /** Comments per view (normalized). */
  getCommentsPerVideo(videoId) {
    const d = this.data.get(videoId);
    if (!d) return 0;
    return d.comments;
  }
}

// ── 4. RevenueTracker ────────────────────────────────────────────────────────

class RevenueTracker {
  constructor() {
    /** @type {Array<{ videoId, source, amount, timestamp }>} */
    this.records = [];
  }

  /** Track a revenue event. */
  trackRevenue(videoId, { source = 'ads', amount = 0, timestamp } = {}) {
    if (!videoId) throw new Error('videoId is required');
    if (amount < 0) throw new Error('amount must be non-negative');
    const record = {
      videoId,
      source,
      amount: round2(amount),
      timestamp: timestamp || new Date().toISOString(),
    };
    this.records.push(record);
    return record;
  }

  /** Get total revenue for a period. */
  getTotalRevenue(period = '30d') {
    const days = parsePeriod(period);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const filtered = this.records.filter(r => new Date(r.timestamp) >= cutoff);
    const total = filtered.reduce((s, r) => s + r.amount, 0);
    return {
      period,
      totalRevenue: round2(total),
      transactionCount: filtered.length,
      avgPerTransaction: filtered.length > 0 ? round2(total / filtered.length) : 0,
    };
  }

  /** Revenue breakdown by source. */
  getRevenueBySource(period = '30d') {
    const days = parsePeriod(period);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const filtered = this.records.filter(r => new Date(r.timestamp) >= cutoff);
    const bySource = {};
    for (const r of filtered) {
      bySource[r.source] = (bySource[r.source] || 0) + r.amount;
    }
    return Object.entries(bySource).map(([source, amount]) => ({
      source,
      amount: round2(amount),
    }));
  }

  /** Revenue per specific video. */
  getRevenuePerVideo(videoId) {
    const videoRecords = this.records.filter(r => r.videoId === videoId);
    return round2(videoRecords.reduce((s, r) => s + r.amount, 0));
  }
}

// ── 5. CPMAnalyzer ───────────────────────────────────────────────────────────

class CPMAnalyzer {
  constructor() {
    /** @type {Array<{ videoId, cpm, views, timestamp }>} */
    this.cpmRecords = [];
    /** @type {Map<string, number>} industry → benchmark CPM */
    this.benchmarks = new Map([
      ['gaming', 4.5],
      ['tech', 8.0],
      ['education', 6.0],
      ['entertainment', 5.0],
      ['lifestyle', 3.5],
      ['music', 2.0],
      ['news', 7.0],
    ]);
  }

  /** Record CPM for a video. */
  recordCPM(videoId, cpm, views = 0) {
    if (!videoId) throw new Error('videoId is required');
    if (cpm < 0) throw new Error('CPM must be non-negative');
    const record = { videoId, cpm: round2(cpm), views, timestamp: new Date().toISOString() };
    this.cpmRecords.push(record);
    return record;
  }

  /** Get average CPM for a video. */
  getCPM(videoId) {
    const records = this.cpmRecords.filter(r => r.videoId === videoId);
    if (records.length === 0) return 0;
    const total = records.reduce((s, r) => s + r.cpm, 0);
    return round2(total / records.length);
  }

  /** Get CPM trend over a period. */
  getCPMTrend(period = '30d') {
    const days = parsePeriod(period);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const filtered = this.cpmRecords.filter(r => new Date(r.timestamp) >= cutoff);
    if (filtered.length === 0) return { points: [], direction: 'stable' };
    const points = filtered.map(r => ({ cpm: r.cpm, timestamp: r.timestamp }));
    const first = filtered[0].cpm;
    const last = filtered[filtered.length - 1].cpm;
    const direction = last > first * 1.05 ? 'increasing' : last < first * 0.95 ? 'decreasing' : 'stable';
    return { points, direction };
  }

  /** Get top N videos by CPM. */
  getBestCPMVideos(count = 5) {
    const byVideo = {};
    for (const r of this.cpmRecords) {
      if (!byVideo[r.videoId]) byVideo[r.videoId] = { total: 0, count: 0, views: 0 };
      byVideo[r.videoId].total += r.cpm;
      byVideo[r.videoId].count++;
      byVideo[r.videoId].views += r.views;
    }
    return Object.entries(byVideo)
      .map(([videoId, d]) => ({
        videoId,
        avgCPM: round2(d.total / d.count),
        views: d.views,
      }))
      .sort((a, b) => b.avgCPM - a.avgCPM)
      .slice(0, count);
  }

  /** Compare a video's CPM with an industry benchmark. */
  compareWithBenchmark(videoId, industry = 'entertainment') {
    const videoCPM = this.getCPM(videoId);
    const benchmark = this.benchmarks.get(industry) || 5.0;
    const diff = round2(videoCPM - benchmark);
    const pctDiff = benchmark > 0 ? round2((diff / benchmark) * 100) : 0;
    return {
      videoId,
      videoCPM,
      benchmark,
      industry,
      difference: diff,
      percentDifference: pctDiff,
      performance: diff > 0 ? 'above' : diff < 0 ? 'below' : 'at',
    };
  }
}

// ── 6. ContentOptimizer ──────────────────────────────────────────────────────

class ContentOptimizer {
  constructor() {
    /** @type {Map<string, object>} videoId → optimization data */
    this.videoData = new Map();
  }

  /** Register content data for a video. */
  registerVideo(videoId, { title = '', description = '', thumbnail = '' } = {}) {
    if (!videoId) throw new Error('videoId is required');
    this.videoData.set(videoId, { title, description, thumbnail });
  }

  /** Analyze a title and return a score. */
  analyzeTitle(title) {
    if (!title) return { score: 0, factors: ['No title provided'] };
    const factors = [];
    let score = 50;

    if (title.length >= 10 && title.length <= 60) {
      score += 15;
      factors.push('Good length (10-60 chars)');
    } else if (title.length < 10) {
      score -= 10;
      factors.push('Title too short');
    } else {
      score -= 5;
      factors.push('Title may be too long');
    }

    if (/[!?]/.test(title)) { score += 10; factors.push('Contains punctuation for emphasis'); }
    if (/\d/.test(title)) { score += 5; factors.push('Contains numbers'); }
    if (/TOP|BEST|HOW TO|WHY|WHAT/i.test(title)) { score += 10; factors.push('Contains power words'); }
    if (title === title.toUpperCase() && title.length > 5) { score -= 10; factors.push('All caps (discouraged)'); }

    return { score: Math.max(0, Math.min(100, score)), factors };
  }

  /** Analyze a thumbnail reference and return a score. */
  analyzeThumbnail(thumbnail) {
    if (!thumbnail) return { score: 0, factors: ['No thumbnail provided'] };
    const factors = [];
    let score = 60;

    if (typeof thumbnail === 'string') {
      if (/\.(jpg|jpeg|png|webp)$/i.test(thumbnail)) { score += 10; factors.push('Valid image format'); }
      else { score -= 10; factors.push('Non-standard format'); }
      if (thumbnail.includes('bright') || thumbnail.includes('color')) { score += 5; factors.push('Suggests vibrant colors'); }
      if (thumbnail.includes('face') || thumbnail.includes('person')) { score += 5; factors.push('Contains face/person'); }
    } else if (typeof thumbnail === 'object') {
      if (thumbnail.width >= 1280) { score += 10; factors.push('High resolution'); }
      if (thumbnail.text) { score += 5; factors.push('Has text overlay'); }
      if (thumbnail.faceDetected) { score += 5; factors.push('Face detected'); }
    }

    return { score: Math.max(0, Math.min(100, score)), factors };
  }

  /** Analyze a description and return a score. */
  analyzeDescription(desc) {
    if (!desc) return { score: 0, factors: ['No description provided'] };
    const factors = [];
    let score = 30;

    if (desc.length >= 100) { score += 20; factors.push('Good length (100+ chars)'); }
    if (desc.length >= 300) { score += 15; factors.push('Detailed description (300+ chars)'); }
    if (/https?:\/\//i.test(desc)) { score += 10; factors.push('Contains links'); }
    if (/#\w+/i.test(desc)) { score += 5; factors.push('Contains hashtags'); }
    if (/\n/.test(desc)) { score += 5; factors.push('Uses line breaks for readability'); }
    if (desc.length < 50) { factors.push('Description very short'); }

    return { score: Math.max(0, Math.min(100, score)), factors };
  }

  /** Suggest improvements for a registered video. */
  suggestImprovements(videoId) {
    const data = this.videoData.get(videoId);
    if (!data) return [];
    const suggestions = [];

    const titleResult = this.analyzeTitle(data.title);
    if (titleResult.score < 70) {
      suggestions.push({
        area: 'title',
        currentScore: titleResult.score,
        suggestion: 'Improve title: use power words, keep 10-60 chars, add numbers',
      });
    }

    const thumbResult = this.analyzeThumbnail(data.thumbnail);
    if (thumbResult.score < 70) {
      suggestions.push({
        area: 'thumbnail',
        currentScore: thumbResult.score,
        suggestion: 'Improve thumbnail: use high-res image, add text overlay, include face',
      });
    }

    const descResult = this.analyzeDescription(data.description);
    if (descResult.score < 70) {
      suggestions.push({
        area: 'description',
        currentScore: descResult.score,
        suggestion: 'Improve description: add 300+ chars, include links and hashtags',
      });
    }

    return suggestions;
  }
}

// ── 7. CompetitorBenchmark ───────────────────────────────────────────────────

class CompetitorBenchmark {
  constructor() {
    /** @type {Map<string, { name, subscribers, avgViews, growthRate, strengths }>} */
    this.competitors = new Map();
    /** @type {object|null} own channel data */
    this.ownChannel = null;
  }

  /** Set own channel data for comparison. */
  setOwnChannel({ subscribers = 0, avgViews = 0, growthRate = 0 } = {}) {
    this.ownChannel = { subscribers, avgViews, growthRate };
  }

  /** Add a competitor channel. */
  addCompetitor(channelId, { name = '', subscribers = 0, avgViews = 0, growthRate = 0, strengths = [] } = {}) {
    if (!channelId) throw new Error('channelId is required');
    this.competitors.set(channelId, {
      channelId,
      name: name || channelId,
      subscribers: Math.max(0, subscribers),
      avgViews: Math.max(0, avgViews),
      growthRate: round2(growthRate),
      strengths: Array.isArray(strengths) ? strengths : [],
    });
  }

  /** Get metrics for a competitor. */
  getCompetitorMetrics(channelId) {
    return this.competitors.get(channelId) || null;
  }

  /** Compare a competitor to own channel. */
  compareToOwn(channelId) {
    const comp = this.competitors.get(channelId);
    if (!comp || !this.ownChannel) return null;
    return {
      channelId,
      name: comp.name,
      subscribers: {
        own: this.ownChannel.subscribers,
        theirs: comp.subscribers,
        difference: comp.subscribers - this.ownChannel.subscribers,
      },
      avgViews: {
        own: this.ownChannel.avgViews,
        theirs: comp.avgViews,
        difference: comp.avgViews - this.ownChannel.avgViews,
      },
      growthRate: {
        own: this.ownChannel.growthRate,
        theirs: comp.growthRate,
        difference: round2(comp.growthRate - this.ownChannel.growthRate),
      },
    };
  }

  /** Get market share based on subscriber counts. */
  getMarketShare() {
    const total = this.ownChannel ? this.ownChannel.subscribers : 0;
    const shares = [];
    for (const [id, comp] of this.competitors) {
      shares.push({ channelId: id, name: comp.name, subscribers: comp.subscribers });
    }
    const grandTotal = shares.reduce((s, c) => s + c.subscribers, 0) + (this.ownChannel ? this.ownChannel.subscribers : 0);

    if (this.ownChannel) {
      shares.unshift({
        channelId: 'own',
        name: 'Own Channel',
        subscribers: this.ownChannel.subscribers,
      });
    }

    return shares.map(s => ({
      channelId: s.channelId,
      name: s.name,
      subscribers: s.subscribers,
      share: grandTotal > 0 ? round2((s.subscribers / grandTotal) * 100) : 0,
    }));
  }
}

// ── 8. TrendAnalyzer ─────────────────────────────────────────────────────────

class TrendAnalyzer {
  constructor() {
    /** @type {Map<string, Array<object>>} category → trend data */
    this.trends = new Map();
    /** @type {Map<string, object>} trendId → prediction */
    this.predictions = new Map();
  }

  /** Seed trend data for a category. */
  addTrend(category, trend) {
    if (!category) throw new Error('category is required');
    if (!this.trends.has(category)) this.trends.set(category, []);
    const record = {
      id: trend.id || generateId('trend'),
      name: trend.name || 'Unknown',
      volume: trend.volume || 0,
      growth: trend.growth || 0,
      sentiment: trend.sentiment || 'neutral',
      timestamp: new Date().toISOString(),
    };
    this.trends.get(category).push(record);
    return record;
  }

  /** Analyze trends in a category. */
  analyzeTrends(category) {
    return this.trends.get(category) || [];
  }

  /** Get top N trending topics across all categories. */
  getTrendingTopics(count = 10) {
    const all = [];
    for (const [cat, trends] of this.trends) {
      for (const t of trends) {
        all.push({ ...t, category: cat });
      }
    }
    return all.sort((a, b) => b.volume - a.volume).slice(0, count);
  }

  /** Predict future trend trajectory. */
  predictTrend(trendId) {
    for (const [, trends] of this.trends) {
      const t = trends.find(t => t.id === trendId);
      if (t) {
        const prediction = {
          trendId,
          name: t.name,
          currentVolume: t.volume,
          predictedVolume: Math.round(t.volume * (1 + t.growth / 100)),
          confidence: round2(0.5 + Math.random() * 0.4),
          timeframe: '30d',
        };
        this.predictions.set(trendId, prediction);
        return prediction;
      }
    }
    return null;
  }

  /** Get seasonal patterns for a category. */
  getSeasonalPatterns(category) {
    const rng = seededRandom(hashStr(category));
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months.map(month => ({
      month,
      relativeVolume: round2(0.5 + rng() * 1.0),
      category,
    }));
  }
}

// ── 9. PredictiveAnalytics ───────────────────────────────────────────────────

class PredictiveAnalytics {
  constructor() {
    /** @type {Map<string, Array<{ views, timestamp }>>} */
    this.history = new Map();
    /** @type {Map<string, Array<{ revenue, timestamp }>>} */
    this.revenueHistory = new Map();
  }

  /** Add a historical data point for a video or channel. */
  addDataPoint(id, { views = 0, revenue = 0, timestamp } = {}) {
    if (!id) throw new Error('id is required');
    if (!this.history.has(id)) this.history.set(id, []);
    if (!this.revenueHistory.has(id)) this.revenueHistory.set(id, []);
    const ts = timestamp || new Date().toISOString();
    this.history.get(id).push({ views, timestamp: ts });
    if (revenue > 0) this.revenueHistory.get(id).push({ revenue, timestamp: ts });
  }

  /** Predict views for a video over N days. */
  predictViews(videoId, days = 30) {
    const records = this.history.get(videoId);
    if (!records || records.length === 0) {
      return { videoId, predicted: 0, confidence: 0, days };
    }
    const recentViews = records.slice(-10).map(r => r.views);
    const avgViews = recentViews.reduce((s, v) => s + v, 0) / recentViews.length;
    const trend = recentViews.length > 1
      ? (recentViews[recentViews.length - 1] - recentViews[0]) / recentViews.length
      : 0;
    const predicted = Math.round(avgViews + trend * days);
    const variance = recentViews.length > 1
      ? Math.sqrt(recentViews.reduce((s, v) => s + (v - avgViews) ** 2, 0) / recentViews.length)
      : avgViews;
    const confidence = Math.max(0, Math.min(1, 1 - (variance / (avgViews || 1))));

    return {
      videoId,
      predicted: Math.max(0, predicted),
      confidence: round2(confidence),
      days,
      basis: records.length,
    };
  }

  /** Predict channel growth over N months. */
  predictGrowth(channelId, months = 12) {
    const records = this.history.get(channelId);
    if (!records || records.length === 0) {
      return { channelId, monthlyForecasts: [], totalGrowth: 0, confidence: 0 };
    }
    const monthlyViews = records.slice(-30).map(r => r.views);
    const avgMonthly = monthlyViews.reduce((s, v) => s + v, 0) / monthlyViews.length;
    const growthRate = monthlyViews.length > 1
      ? (monthlyViews[monthlyViews.length - 1] - monthlyViews[0]) / monthlyViews.length
      : 0;

    const forecasts = [];
    for (let m = 1; m <= months; m++) {
      forecasts.push({
        month: m,
        projectedViews: Math.max(0, Math.round(avgMonthly + growthRate * m)),
      });
    }
    const totalGrowth = forecasts.reduce((s, f) => s + f.projectedViews, 0);
    return {
      channelId,
      monthlyForecasts: forecasts,
      totalGrowth: Math.round(totalGrowth),
      confidence: round2(Math.min(1, 0.6 + records.length * 0.02)),
    };
  }

  /** Predict revenue over N months. */
  predictRevenue(channelId, months = 12) {
    const records = this.revenueHistory.get(channelId);
    if (!records || records.length === 0) {
      return { channelId, monthlyForecasts: [], totalRevenue: 0, confidence: 0 };
    }
    const recentRevenue = records.slice(-30).map(r => r.revenue);
    const avgRevenue = recentRevenue.reduce((s, v) => s + v, 0) / recentRevenue.length;
    const trend = recentRevenue.length > 1
      ? (recentRevenue[recentRevenue.length - 1] - recentRevenue[0]) / recentRevenue.length
      : 0;

    const forecasts = [];
    for (let m = 1; m <= months; m++) {
      forecasts.push({
        month: m,
        projectedRevenue: round2(Math.max(0, avgRevenue + trend * m)),
      });
    }
    const totalRevenue = forecasts.reduce((s, f) => s + f.projectedRevenue, 0);
    return {
      channelId,
      monthlyForecasts: forecasts,
      totalRevenue: round2(totalRevenue),
      confidence: round2(Math.min(1, 0.5 + records.length * 0.03)),
    };
  }

  /** Get confidence level for a prediction model. */
  getConfidenceLevel(model = 'views') {
    const totalPoints = [...this.history.values()].reduce((s, arr) => s + arr.length, 0);
    const baseConfidence = Math.min(0.95, 0.3 + totalPoints * 0.005);
    const modelMultiplier = {
      views: 1.0,
      revenue: 0.85,
      growth: 0.8,
      engagement: 0.75,
    }[model] || 0.8;
    return round2(baseConfidence * modelMultiplier);
  }
}

// ── 10. ABRTesting ───────────────────────────────────────────────────────────

class ABRTesting {
  constructor() {
    /** @type {Map<string, object>} testId → AB test definition */
    this.tests = new Map();
    /** @type {Map<string, Map<string, { clicks, impressions }>>} */
    this.results = new Map();
  }

  /** Create a new A/B test. */
  createTest({ videoId, variants = [] } = {}) {
    if (!videoId) throw new Error('videoId is required');
    if (!Array.isArray(variants) || variants.length < 2) {
      throw new Error('At least 2 variants required');
    }
    const testId = generateId('ab');
    const test = {
      testId,
      videoId,
      variants: variants.map((v, i) => ({
        id: v.id || `variant_${i}`,
        name: v.name || `Variant ${i + 1}`,
        weight: v.weight || 1,
      })),
      status: 'active',
      createdAt: new Date().toISOString(),
    };
    this.tests.set(testId, test);
    const clickMap = new Map();
    test.variants.forEach(v => clickMap.set(v.id, { clicks: 0, impressions: 0 }));
    this.results.set(testId, clickMap);
    return test;
  }

  /** Record a click for a variant. */
  recordClick(testId, variantId) {
    const clicks = this.results.get(testId);
    if (!clicks) throw new Error('Test not found');
    if (!clicks.has(variantId)) throw new Error('Variant not found');
    const data = clicks.get(variantId);
    data.clicks++;
    data.impressions++;
    // Add impressions to other variants (random assignment simulation)
    for (const [id, d] of clicks) {
      if (id !== variantId) d.impressions++;
    }
  }

  /** Get results for a test. */
  getResults(testId) {
    const test = this.tests.get(testId);
    if (!test) return null;
    const clicks = this.results.get(testId);
    const variants = [];
    for (const v of test.variants) {
      const data = clicks.get(v.id);
      variants.push({
        id: v.id,
        name: v.name,
        clicks: data.clicks,
        impressions: data.impressions,
        ctr: data.impressions > 0 ? round2((data.clicks / data.impressions) * 100) : 0,
      });
    }
    return { testId, videoId: test.videoId, variants, status: test.status };
  }

  /** Determine the winning variant. */
  getWinner(testId) {
    const results = this.getResults(testId);
    if (!results) return null;
    const sorted = [...results.variants].sort((a, b) => b.ctr - a.ctr);
    if (sorted.length === 0) return null;
    return sorted[0];
  }

  /** Calculate statistical significance using a simple Z-test. */
  getStatisticalSignificance(testId) {
    const results = this.getResults(testId);
    if (!results || results.variants.length < 2) return 0;
    const sorted = [...results.variants].sort((a, b) => b.ctr - a.ctr);
    const a = sorted[0];
    const b = sorted[1];
    if (a.impressions === 0 || b.impressions === 0) return 0;

    const pA = a.clicks / a.impressions;
    const pB = b.clicks / b.impressions;
    const pPool = (a.clicks + b.clicks) / (a.impressions + b.impressions);
    const se = Math.sqrt(pPool * (1 - pPool) * (1 / a.impressions + 1 / b.impressions));
    if (se === 0) return 0;

    const z = Math.abs(pA - pB) / se;
    // Approximate p-value using normal CDF approximation
    const pValue = 2 * (1 - normalCDF(z));
    return round2(Math.max(0, Math.min(1, 1 - pValue)));
  }
}

/** Approximate normal CDF using Abramowitz & Stegun formula. */
function normalCDF(x) {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
  return 0.5 * (1.0 + sign * y);
}

// ── Exports ──────────────────────────────────────────────────────────────────

export {
  VideoPerformanceTracker,
  AudienceDemographics,
  EngagementAnalyzer,
  RevenueTracker,
  CPMAnalyzer,
  ContentOptimizer,
  CompetitorBenchmark,
  TrendAnalyzer,
  PredictiveAnalytics,
  ABRTesting,
  // Re-export helpers for testing
  seededRandom,
  hashStr,
  round2,
  parsePeriod,
  generateId,
  normalCDF,
};
