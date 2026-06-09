import assert from 'node:assert';
import { AnalyticsPro, CPM_RATES } from '../src/analytics_pro.js';

let ap;
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
  }
}

function setup() {
  ap = new AnalyticsPro();
  ap.registerChannel({ channelId: 'UC1', name: 'Test Channel', subscribers: 50000, platforms: ['youtube', 'tiktok'] });
  ap.registerVideo({ videoId: 'v1', channelId: 'UC1', title: 'First Video', platform: 'youtube', duration_sec: 600, published_at: '2026-01-01T00:00:00Z' });
  ap.registerVideo({ videoId: 'v2', channelId: 'UC1', title: 'Second Video', platform: 'tiktok', duration_sec: 300, published_at: '2026-02-01T00:00:00Z' });
  ap.registerVideo({ videoId: 'v3', channelId: 'UC1', title: 'Third Video', platform: 'youtube', duration_sec: 120, published_at: '2026-03-01T00:00:00Z' });

  // Add views
  for (let i = 0; i < 20; i++) ap.addView({ videoId: 'v1', platform: 'youtube', watch_duration_sec: 300, timestamp: `2026-01-${String(i + 1).padStart(2, '0')}T10:00:00Z` });
  for (let i = 0; i < 10; i++) ap.addView({ videoId: 'v2', platform: 'tiktok', watch_duration_sec: 200, timestamp: `2026-02-${String(i + 1).padStart(2, '0')}T10:00:00Z` });
  for (let i = 0; i < 5; i++) ap.addView({ videoId: 'v3', platform: 'youtube', watch_duration_sec: 120, timestamp: `2026-03-${String(i + 1).padStart(2, '0')}T10:00:00Z` });

  // Add revenue within last 30 days from now
  const now = new Date();
  for (let i = 0; i < 30; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - (30 - i));
    ap.addRevenueRecord({ channelId: 'UC1', date: d.toISOString(), revenue: 10 + i * 0.5, videoId: 'v1' });
  }
  for (let i = 0; i < 30; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - (30 - i));
    ap.addRevenueRecord({ channelId: 'UC1', date: d.toISOString(), revenue: 5 + i * 0.3, videoId: 'v2' });
  }

  // Add subscriber data within last 30 days from now
  for (let i = 0; i < 30; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - (30 - i));
    ap.addSubscriberDataPoint({ channelId: 'UC1', date: d.toISOString(), new_subs: 50 + i * 5, lost_subs: 5 + i });
  }
}

console.log('\n=== Analytics Pro Tests ===\n');

// ═══════════════════════════════════════════════════════════════════════════════
// Tool 1: getVideoMetrics
// ═══════════════════════════════════════════════════════════════════════════════

// 1
test('getVideoMetrics returns all required fields', () => {
  setup();
  const m = ap.getVideoMetrics({ videoId: 'v1', platform: 'youtube' });
  assert.ok(m !== null);
  assert.ok(typeof m.views === 'number');
  assert.ok(typeof m.likes === 'number');
  assert.ok(typeof m.comments === 'number');
  assert.ok(typeof m.shares === 'number');
  assert.ok(typeof m.watch_time_sec === 'number');
  assert.ok(typeof m.retention_rate === 'number');
});

// 2
test('getVideoMetrics returns correct view count', () => {
  setup();
  const m = ap.getVideoMetrics({ videoId: 'v1', platform: 'youtube' });
  assert.strictEqual(m.views, 20);
});

// 3
test('getVideoMetrics retention_rate calculated correctly', () => {
  setup();
  // 20 views × 300s each = 6000s total, video = 600s, so 6000 / (20×600) = 50%
  const m = ap.getVideoMetrics({ videoId: 'v1', platform: 'youtube' });
  assert.strictEqual(m.retention_rate, 50);
});

// 4
test('getVideoMetrics for unknown video returns null', () => {
  setup();
  const m = ap.getVideoMetrics({ videoId: 'nonexistent', platform: 'youtube' });
  assert.strictEqual(m, null);
});

// 5
test('getVideoMetrics for video with zero views returns zeros', () => {
  ap = new AnalyticsPro();
  ap.registerChannel({ channelId: 'UC2', name: 'Empty', subscribers: 100 });
  ap.registerVideo({ videoId: 'v_empty', channelId: 'UC2', title: 'Empty', duration_sec: 300 });
  const m = ap.getVideoMetrics({ videoId: 'v_empty', platform: 'youtube' });
  assert.strictEqual(m.views, 0);
  assert.strictEqual(m.likes, 0);
  assert.strictEqual(m.retention_rate, 0);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tool 2: getRetentionCurve
// ═══════════════════════════════════════════════════════════════════════════════

// 6
test('getRetentionCurve returns points and drop_offs', () => {
  setup();
  const rc = ap.getRetentionCurve({ videoId: 'v1', buckets: 10 });
  assert.ok(rc !== null);
  assert.ok(Array.isArray(rc.points));
  assert.ok(Array.isArray(rc.drop_offs));
  assert.strictEqual(rc.points.length, 11); // buckets + 1
});

// 7
test('getRetentionCurve first point is 100%', () => {
  setup();
  const rc = ap.getRetentionCurve({ videoId: 'v1' });
  assert.strictEqual(rc.points[0].percent_remaining, 100);
});

// 8
test('getRetentionCurve points are decreasing (monotonic)', () => {
  setup();
  const rc = ap.getRetentionCurve({ videoId: 'v1' });
  for (let i = 1; i < rc.points.length; i++) {
    assert.ok(
      rc.points[i].percent_remaining <= rc.points[i - 1].percent_remaining,
      `Point ${i}: ${rc.points[i].percent_remaining} > ${rc.points[i - 1].percent_remaining}`
    );
  }
});

// 9
test('getRetentionCurve first point time_sec is 0', () => {
  setup();
  const rc = ap.getRetentionCurve({ videoId: 'v1' });
  assert.strictEqual(rc.points[0].time_sec, 0);
});

// 10
test('getRetentionCurve for unknown video returns null', () => {
  setup();
  const rc = ap.getRetentionCurve({ videoId: 'nonexistent' });
  assert.strictEqual(rc, null);
});

// 11
test('getRetentionCurve empty video has all-zero points', () => {
  ap = new AnalyticsPro();
  ap.registerChannel({ channelId: 'UC2', name: 'Empty', subscribers: 100 });
  ap.registerVideo({ videoId: 'v_empty', channelId: 'UC2', title: 'Empty', duration_sec: 300 });
  const rc = ap.getRetentionCurve({ videoId: 'v_empty', buckets: 5 });
  assert.strictEqual(rc.points.length, 6);
  for (const p of rc.points) {
    assert.strictEqual(p.percent_remaining, 0);
  }
  assert.strictEqual(rc.drop_offs.length, 0);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tool 3: getDemographics
// ═══════════════════════════════════════════════════════════════════════════════

// 12
test('getDemographics returns age, gender, top_countries', () => {
  setup();
  const d = ap.getDemographics({ channelId: 'UC1', timeRange: '30d' });
  assert.ok(d !== null);
  assert.ok(Array.isArray(d.age));
  assert.ok(Array.isArray(d.gender));
  assert.ok(Array.isArray(d.top_countries));
});

// 13
test('getDemographics age percentages sum to ~100', () => {
  setup();
  const d = ap.getDemographics({ channelId: 'UC1' });
  const sum = d.age.reduce((a, g) => a + g.percent, 0);
  assert.ok(Math.abs(sum - 100) < 0.1, `Age sum was ${sum}`);
});

// 14
test('getDemographics gender percentages sum to ~100', () => {
  setup();
  const d = ap.getDemographics({ channelId: 'UC1' });
  const sum = d.gender.reduce((a, g) => a + g.percent, 0);
  assert.ok(Math.abs(sum - 100) < 0.1, `Gender sum was ${sum}`);
});

// 15
test('getDemographics top_countries sorted descending', () => {
  setup();
  const d = ap.getDemographics({ channelId: 'UC1' });
  for (let i = 1; i < d.top_countries.length; i++) {
    assert.ok(d.top_countries[i].percent <= d.top_countries[i - 1].percent);
  }
});

// 16
test('getDemographics for unknown channel returns null', () => {
  setup();
  const d = ap.getDemographics({ channelId: 'UC_UNKNOWN' });
  assert.strictEqual(d, null);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tool 4: getEngagementMetrics
// ═══════════════════════════════════════════════════════════════════════════════

// 17
test('getEngagementMetrics returns all rate fields', () => {
  setup();
  const e = ap.getEngagementMetrics({ videoId: 'v1' });
  assert.ok(e !== null);
  assert.ok(typeof e.like_rate === 'number');
  assert.ok(typeof e.comment_rate === 'number');
  assert.ok(typeof e.share_rate === 'number');
  assert.ok(typeof e.save_rate === 'number');
  assert.ok(typeof e.engagement_score === 'number');
});

// 18
test('getEngagementMetrics for zero-view video returns zeros', () => {
  ap = new AnalyticsPro();
  ap.registerChannel({ channelId: 'UC2', name: 'Empty', subscribers: 100 });
  ap.registerVideo({ videoId: 'v_empty', channelId: 'UC2', title: 'Empty', duration_sec: 300 });
  const e = ap.getEngagementMetrics({ videoId: 'v_empty' });
  assert.strictEqual(e.engagement_score, 0);
});

// 19
test('getEngagementMetrics for unknown video returns null', () => {
  setup();
  const e = ap.getEngagementMetrics({ videoId: 'nonexistent' });
  assert.strictEqual(e, null);
});

// 20
test('getEngagementMetrics engagement_score is sum of rates', () => {
  setup();
  const e = ap.getEngagementMetrics({ videoId: 'v1' });
  const expected = e.like_rate + e.comment_rate + e.share_rate + e.save_rate;
  assert.strictEqual(e.engagement_score, expected);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tool 5: getRevenueMetrics
// ═══════════════════════════════════════════════════════════════════════════════

// 21
test('getRevenueMetrics returns all required fields', () => {
  setup();
  const r = ap.getRevenueMetrics({ channelId: 'UC1', timeRange: '30d' });
  assert.ok(r !== null);
  assert.ok(typeof r.ad_revenue === 'number');
  assert.ok(typeof r.rpm === 'number');
  assert.ok(typeof r.cpm === 'number');
  assert.ok(typeof r.estimated_monthly === 'number');
  assert.ok(Array.isArray(r.revenue_by_video));
});

// 22
test('getRevenueMetrics ad_revenue is positive', () => {
  setup();
  const r = ap.getRevenueMetrics({ channelId: 'UC1', timeRange: '30d' });
  assert.ok(r.ad_revenue > 0, `ad_revenue was ${r.ad_revenue}`);
});

// 23
test('getRevenueMetrics revenue_by_video has entries', () => {
  setup();
  const r = ap.getRevenueMetrics({ channelId: 'UC1', timeRange: '30d' });
  assert.ok(r.revenue_by_video.length > 0);
});

// 24
test('getRevenueMetrics for unknown channel returns null', () => {
  setup();
  const r = ap.getRevenueMetrics({ channelId: 'UC_UNKNOWN' });
  assert.strictEqual(r, null);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tool 6: getSubscriberGrowth
// ═══════════════════════════════════════════════════════════════════════════════

// 25
test('getSubscriberGrowth returns all required fields', () => {
  setup();
  const g = ap.getSubscriberGrowth({ channelId: 'UC1', timeRange: '30d' });
  assert.ok(g !== null);
  assert.ok(typeof g.new_subs === 'number');
  assert.ok(typeof g.lost_subs === 'number');
  assert.ok(typeof g.net_growth === 'number');
  assert.ok(typeof g.growth_rate === 'number');
  assert.ok(typeof g.projections === 'object');
});

// 26
test('getSubscriberGrowth net_growth = new_subs - lost_subs', () => {
  setup();
  const g = ap.getSubscriberGrowth({ channelId: 'UC1', timeRange: '30d' });
  assert.strictEqual(g.net_growth, g.new_subs - g.lost_subs);
});

// 27
test('getSubscriberGrowth projections has 30, 90, 365 day estimates', () => {
  setup();
  const g = ap.getSubscriberGrowth({ channelId: 'UC1', timeRange: '30d' });
  assert.ok(typeof g.projections.in_30_days === 'number');
  assert.ok(typeof g.projections.in_90_days === 'number');
  assert.ok(typeof g.projections.in_365_days === 'number');
});

// 28
test('getSubscriberGrowth projections grow over time when net positive', () => {
  setup();
  const g = ap.getSubscriberGrowth({ channelId: 'UC1', timeRange: '30d' });
  if (g.net_growth > 0) {
    assert.ok(g.projections.in_90_days >= g.projections.in_30_days);
    assert.ok(g.projections.in_365_days >= g.projections.in_90_days);
  }
});

// 29
test('getSubscriberGrowth for unknown channel returns null', () => {
  setup();
  const g = ap.getSubscriberGrowth({ channelId: 'UC_UNKNOWN' });
  assert.strictEqual(g, null);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tool 7: getTopVideos
// ═══════════════════════════════════════════════════════════════════════════════

// 30
test('getTopVideos returns videos and total_count', () => {
  setup();
  const top = ap.getTopVideos({ channelId: 'UC1', sortBy: 'views', limit: 10 });
  assert.ok(top !== null);
  assert.ok(Array.isArray(top.videos));
  assert.ok(typeof top.total_count === 'number');
});

// 31
test('getTopVideos sorted by views descending', () => {
  setup();
  const top = ap.getTopVideos({ channelId: 'UC1', sortBy: 'views', limit: 10 });
  for (let i = 1; i < top.videos.length; i++) {
    assert.ok(top.videos[i].views <= top.videos[i - 1].views);
  }
});

// 32
test('getTopVideos sorted by revenue descending', () => {
  setup();
  const top = ap.getTopVideos({ channelId: 'UC1', sortBy: 'revenue', limit: 10 });
  for (let i = 1; i < top.videos.length; i++) {
    assert.ok(top.videos[i].revenue <= top.videos[i - 1].revenue);
  }
});

// 33
test('getTopVideos respects limit', () => {
  setup();
  const top = ap.getTopVideos({ channelId: 'UC1', sortBy: 'views', limit: 2 });
  assert.strictEqual(top.videos.length, 2);
});

// 34
test('getTopVideos total_count reflects all channel videos', () => {
  setup();
  const top = ap.getTopVideos({ channelId: 'UC1', sortBy: 'views', limit: 1 });
  assert.strictEqual(top.total_count, 3);
});

// 35
test('getTopVideos for unknown channel returns null', () => {
  setup();
  const top = ap.getTopVideos({ channelId: 'UC_UNKNOWN' });
  assert.strictEqual(top, null);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tool 8: getContentRecommendations
// ═══════════════════════════════════════════════════════════════════════════════

// 36
test('getContentRecommendations returns recommendations array', () => {
  setup();
  const recs = ap.getContentRecommendations({ channelId: 'UC1' });
  assert.ok(recs !== null);
  assert.ok(Array.isArray(recs.recommendations));
  assert.ok(recs.recommendations.length > 0);
});

// 37
test('getContentRecommendations each has topic, reason, estimated_views, competition', () => {
  setup();
  const recs = ap.getContentRecommendations({ channelId: 'UC1' });
  for (const r of recs.recommendations) {
    assert.ok(typeof r.topic === 'string');
    assert.ok(typeof r.reason === 'string');
    assert.ok(typeof r.estimated_views === 'number');
    assert.ok(['low', 'medium', 'high'].includes(r.competition));
  }
});

// 38
test('getContentRecommendations sorted by estimated_views descending', () => {
  setup();
  const recs = ap.getContentRecommendations({ channelId: 'UC1' });
  for (let i = 1; i < recs.recommendations.length; i++) {
    assert.ok(recs.recommendations[i].estimated_views <= recs.recommendations[i - 1].estimated_views);
  }
});

// 39
test('getContentRecommendations for unknown channel returns null', () => {
  setup();
  const recs = ap.getContentRecommendations({ channelId: 'UC_UNKNOWN' });
  assert.strictEqual(recs, null);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tool 9: getCompetitorAnalysis
// ═══════════════════════════════════════════════════════════════════════════════

// 40
test('getCompetitorAnalysis returns channels and opportunities', () => {
  setup();
  ap.registerChannel({ channelId: 'UC2', name: 'Competitor A', subscribers: 100000 });
  ap.registerVideo({ videoId: 'vc1', channelId: 'UC2', title: 'Comp Vid', platform: 'youtube', duration_sec: 300 });
  for (let i = 0; i < 50; i++) ap.addView({ videoId: 'vc1', platform: 'youtube', watch_duration_sec: 200 });
  ap.addCompetitorData({ channelId: 'UC2', name: 'Competitor A', subscribers: 100000, avg_views: 5000, growth_rate: 5, strengths: ['thumbnails', 'SEO'] });

  const result = ap.getCompetitorAnalysis({ channelIds: ['UC1', 'UC2'] });
  assert.ok(result !== null);
  assert.ok(Array.isArray(result.channels));
  assert.ok(result.channels.length >= 2);
  assert.ok(Array.isArray(result.opportunities));
});

// 41
test('getCompetitorAnalysis channels have required fields', () => {
  setup();
  ap.addCompetitorData({ channelId: 'UC2', subscribers: 100000, avg_views: 5000, growth_rate: 5, strengths: ['thumbnails'] });
  const result = ap.getCompetitorAnalysis({ channelIds: ['UC1', 'UC2'] });
  for (const ch of result.channels) {
    assert.ok(typeof ch.id === 'string');
    assert.ok(typeof ch.subs === 'number');
    assert.ok(typeof ch.avg_views === 'number');
    assert.ok(typeof ch.growth_rate === 'number');
    assert.ok(Array.isArray(ch.strengths));
  }
});

// 42
test('getCompetitorAnalysis empty channelIds returns null', () => {
  setup();
  const result = ap.getCompetitorAnalysis({ channelIds: [] });
  assert.strictEqual(result, null);
});

// 43
test('getCompetitorAnalysis for unknown channels returns null', () => {
  setup();
  const result = ap.getCompetitorAnalysis({ channelIds: ['UNKNOWN'] });
  assert.strictEqual(result, null);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tool 10: exportReport
// ═══════════════════════════════════════════════════════════════════════════════

// 44
test('exportReport json format returns all fields', () => {
  setup();
  const rpt = ap.exportReport({ channelId: 'UC1', format: 'json', timeRange: '30d' });
  assert.ok(rpt !== null);
  assert.ok(typeof rpt.report_url === 'string');
  assert.strictEqual(rpt.format, 'json');
  assert.ok(typeof rpt.page_count === 'number');
  assert.ok(typeof rpt.generated_at === 'string');
});

// 45
test('exportReport csv format accepted', () => {
  setup();
  const rpt = ap.exportReport({ channelId: 'UC1', format: 'csv' });
  assert.strictEqual(rpt.format, 'csv');
});

// 46
test('exportReport pdf format accepted', () => {
  setup();
  const rpt = ap.exportReport({ channelId: 'UC1', format: 'pdf' });
  assert.strictEqual(rpt.format, 'pdf');
});

// 47
test('exportReport html format accepted', () => {
  setup();
  const rpt = ap.exportReport({ channelId: 'UC1', format: 'html' });
  assert.strictEqual(rpt.format, 'html');
});

// 48
test('exportReport invalid format throws error', () => {
  setup();
  assert.throws(() => ap.exportReport({ channelId: 'UC1', format: 'xml' }), /Invalid format/);
});

// 49
test('exportReport for unknown channel returns null', () => {
  setup();
  const rpt = ap.exportReport({ channelId: 'UC_UNKNOWN', format: 'json' });
  assert.strictEqual(rpt, null);
});

// 50
test('exportReport page_count >= 2', () => {
  setup();
  const rpt = ap.exportReport({ channelId: 'UC1', format: 'json' });
  assert.ok(rpt.page_count >= 2);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Registration / Edge Cases
// ═══════════════════════════════════════════════════════════════════════════════

// 51
test('registerChannel with zero subscribers works', () => {
  ap = new AnalyticsPro();
  ap.registerChannel({ channelId: 'UC_ZERO', subscribers: 0 });
  assert.ok(ap.channels.has('UC_ZERO'));
  assert.strictEqual(ap.channels.get('UC_ZERO').subscribers, 0);
});

// 52
test('registerChannel throws on invalid parameters', () => {
  ap = new AnalyticsPro();
  assert.throws(() => ap.registerChannel({ channelId: '', subscribers: 100 }), /Invalid/);
  assert.throws(() => ap.registerChannel({ channelId: 'UC', subscribers: -10 }), /Invalid/);
});

// 53
test('registerVideo throws on invalid duration', () => {
  ap = new AnalyticsPro();
  ap.registerChannel({ channelId: 'UC1', subscribers: 1000 });
  assert.throws(() => ap.registerVideo({ videoId: 'v', channelId: 'UC1', duration_sec: 0 }), /Invalid/);
  assert.throws(() => ap.registerVideo({ videoId: 'v', channelId: 'UC1', duration_sec: -5 }), /Invalid/);
});

// 54
test('addView throws on unknown video', () => {
  ap = new AnalyticsPro();
  assert.throws(() => ap.addView({ videoId: 'nonexistent' }), /Video not found/);
});

// 55
test('addRevenueRecord throws on unknown channel', () => {
  ap = new AnalyticsPro();
  assert.throws(() => ap.addRevenueRecord({ channelId: 'UNKNOWN', revenue: 10 }), /Channel not found/);
});

// 56
test('addSubscriberDataPoint throws on unknown channel', () => {
  ap = new AnalyticsPro();
  assert.throws(() => ap.addSubscriberDataPoint({ channelId: 'UNKNOWN', new_subs: 10 }), /Channel not found/);
});

// 57
test('CPM_RATES has expected platforms', () => {
  assert.ok(CPM_RATES.youtube > 0);
  assert.ok(CPM_RATES.tiktok > 0);
  assert.ok(CPM_RATES.instagram > 0);
  assert.ok(CPM_RATES.facebook > 0);
  assert.ok(CPM_RATES.twitter > 0);
});

// 58
test('getVideoMetrics with TikTok platform', () => {
  setup();
  const m = ap.getVideoMetrics({ videoId: 'v2', platform: 'tiktok' });
  assert.strictEqual(m.views, 10);
});

// 59
test('getRetentionCurve with 5 buckets has 6 points', () => {
  setup();
  const rc = ap.getRetentionCurve({ videoId: 'v1', buckets: 5 });
  assert.strictEqual(rc.points.length, 6);
});

// 60
test('exportReport URL contains channel ID', () => {
  setup();
  const rpt = ap.exportReport({ channelId: 'UC1', format: 'json' });
  assert.ok(rpt.report_url.includes('UC1'));
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
