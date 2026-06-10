/**
 * Tests for Advanced Analytics Module (analytics_pro.js)
 * 50+ tests covering all 10 classes.
 */

import assert from 'assert';
import {
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
  round2,
  parsePeriod,
  generateId,
  normalCDF,
} from '../src/analytics_pro.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. VideoPerformanceTracker
// ═════════════════════════════════════════════════════════════════════════════

console.log('\n── VideoPerformanceTracker ──');

test('trackVideo stores a record', () => {
  const tracker = new VideoPerformanceTracker();
  const record = tracker.trackVideo('v1', { views: 1000, watch_time: 5000, retention: 75 });
  assert.strictEqual(record.views, 1000);
  assert.strictEqual(record.retention, 75);
});

test('trackVideo rejects missing videoId', () => {
  const tracker = new VideoPerformanceTracker();
  assert.throws(() => tracker.trackVideo('', { views: 100 }), /videoId is required/);
});

test('trackVideo rejects negative views', () => {
  const tracker = new VideoPerformanceTracker();
  assert.throws(() => tracker.trackVideo('v1', { views: -5 }), /views must be non-negative/);
});

test('getPerformance returns latest snapshot', () => {
  const tracker = new VideoPerformanceTracker();
  tracker.trackVideo('v1', { views: 100, watch_time: 500, retention: 60 });
  tracker.trackVideo('v1', { views: 200, watch_time: 1000, retention: 70 });
  const perf = tracker.getPerformance('v1');
  assert.strictEqual(perf.currentViews, 200);
  assert.strictEqual(perf.dataPoints, 2);
  assert(perf.avgRetention > 0);
});

test('getPerformance returns null for unknown video', () => {
  const tracker = new VideoPerformanceTracker();
  assert.strictEqual(tracker.getPerformance('unknown'), null);
});

test('getTrend identifies growing direction', () => {
  const tracker = new VideoPerformanceTracker();
  const now = new Date();
  tracker.trackVideo('v1', { views: 100, timestamp: new Date(now - 86400000 * 6).toISOString() });
  tracker.trackVideo('v1', { views: 200, timestamp: new Date(now - 86400000 * 3).toISOString() });
  tracker.trackVideo('v1', { views: 300, timestamp: now.toISOString() });
  const trend = tracker.getTrend('v1', '7d');
  assert.strictEqual(trend.direction, 'growing');
});

test('getTrend returns empty for no data', () => {
  const tracker = new VideoPerformanceTracker();
  const trend = tracker.getTrend('nope', '7d');
  assert.deepStrictEqual(trend.points, []);
});

test('getRetentionCurve returns curve array', () => {
  const tracker = new VideoPerformanceTracker();
  tracker.trackVideo('v1', { views: 500, watch_time: 3000, retention: 80 });
  const curve = tracker.getRetentionCurve('v1');
  assert(curve.length > 0);
  assert(curve[0].time_pct === 0);
  assert(curve[curve.length - 1].time_pct === 100);
});

test('getRetentionCurve returns empty for unknown video', () => {
  const tracker = new VideoPerformanceTracker();
  assert.deepStrictEqual(tracker.getRetentionCurve('nope'), []);
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. AudienceDemographics
// ═════════════════════════════════════════════════════════════════════════════

console.log('\n── AudienceDemographics ──');

test('getDemographics generates data automatically', () => {
  const demo = new AudienceDemographics();
  const result = demo.getDemographics('ch1');
  assert(result.ageDistribution.length === 6);
  assert(typeof result.genderSplit.male === 'number');
  assert(result.geography.length > 0);
});

test('getAgeDistribution returns array', () => {
  const demo = new AudienceDemographics();
  const ages = demo.getAgeDistribution('ch1');
  assert(Array.isArray(ages));
  assert(ages.length === 6);
  const total = ages.reduce((s, a) => s + a.percentage, 0);
  assert(Math.abs(total - 100) < 1);
});

test('getGenderSplit sums to ~100', () => {
  const demo = new AudienceDemographics();
  const gender = demo.getGenderSplit('ch1');
  const total = gender.male + gender.female + gender.other;
  assert(Math.abs(total - 100) < 1);
});

test('getGeography returns sorted countries', () => {
  const demo = new AudienceDemographics();
  const geo = demo.getGeography('ch1');
  assert(geo.length > 0);
  for (let i = 1; i < geo.length; i++) {
    assert(geo[i - 1].percentage >= geo[i].percentage);
  }
});

test('setDemographics with custom data', () => {
  const demo = new AudienceDemographics();
  demo.setDemographics('ch2', {
    ageDistribution: [{ group: '18-24', percentage: 60 }, { group: '25-34', percentage: 40 }],
    genderSplit: { male: 70, female: 30, other: 0 },
    geography: [{ country: 'US', percentage: 100 }],
  });
  const result = demo.getDemographics('ch2');
  assert.strictEqual(result.ageDistribution.length, 2);
  assert.strictEqual(result.genderSplit.male, 70);
});

test('setDemographics rejects missing channelId', () => {
  const demo = new AudienceDemographics();
  assert.throws(() => demo.setDemographics('', {}), /channelId is required/);
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. EngagementAnalyzer
// ═════════════════════════════════════════════════════════════════════════════

console.log('\n── EngagementAnalyzer ──');

test('analyzeEngagement returns full report', () => {
  const eng = new EngagementAnalyzer();
  eng.setData('v1', { views: 10000, likes: 500, comments: 100, shares: 50, saves: 25 });
  const report = eng.analyzeEngagement('v1');
  assert.strictEqual(report.totalEngagements, 675);
  assert(report.engagementRate > 0);
});

test('analyzeEngagement returns null for unknown', () => {
  const eng = new EngagementAnalyzer();
  assert.strictEqual(eng.analyzeEngagement('nope'), null);
});

test('getEngagementRate calculates percentage', () => {
  const eng = new EngagementAnalyzer();
  eng.setData('v1', { views: 1000, likes: 50, comments: 10, shares: 5, saves: 5 });
  const rate = eng.getEngagementRate('v1');
  assert.strictEqual(rate, 7);
});

test('getEngagementRate returns 0 for no views', () => {
  const eng = new EngagementAnalyzer();
  eng.setData('v1', { views: 0, likes: 10 });
  assert.strictEqual(eng.getEngagementRate('v1'), 0);
});

test('getLikesToViews ratio', () => {
  const eng = new EngagementAnalyzer();
  eng.setData('v1', { views: 1000, likes: 100 });
  assert.strictEqual(eng.getLikesToViews('v1'), 0.1);
});

test('getCommentsPerVideo returns comment count', () => {
  const eng = new EngagementAnalyzer();
  eng.setData('v1', { views: 1000, comments: 42 });
  assert.strictEqual(eng.getCommentsPerVideo('v1'), 42);
});

test('setData rejects missing videoId', () => {
  const eng = new EngagementAnalyzer();
  assert.throws(() => eng.setData('', {}), /videoId is required/);
});

test('setData clamps negative values', () => {
  const eng = new EngagementAnalyzer();
  eng.setData('v1', { views: -10, likes: -5 });
  const report = eng.analyzeEngagement('v1');
  assert.strictEqual(report.views, 0);
  assert.strictEqual(report.likes, 0);
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. RevenueTracker
// ═════════════════════════════════════════════════════════════════════════════

console.log('\n── RevenueTracker ──');

test('trackRevenue stores a record', () => {
  const rt = new RevenueTracker();
  const record = rt.trackRevenue('v1', { source: 'ads', amount: 15.50 });
  assert.strictEqual(record.amount, 15.5);
  assert.strictEqual(record.source, 'ads');
});

test('trackRevenue rejects negative amount', () => {
  const rt = new RevenueTracker();
  assert.throws(() => rt.trackRevenue('v1', { amount: -5 }), /amount must be non-negative/);
});

test('getTotalRevenue aggregates', () => {
  const rt = new RevenueTracker();
  rt.trackRevenue('v1', { source: 'ads', amount: 10 });
  rt.trackRevenue('v2', { source: 'sponsor', amount: 20 });
  rt.trackRevenue('v3', { source: 'ads', amount: 5 });
  const total = rt.getTotalRevenue('30d');
  assert.strictEqual(total.totalRevenue, 35);
  assert.strictEqual(total.transactionCount, 3);
});

test('getRevenueBySource breaks down by source', () => {
  const rt = new RevenueTracker();
  rt.trackRevenue('v1', { source: 'ads', amount: 10 });
  rt.trackRevenue('v2', { source: 'sponsor', amount: 20 });
  rt.trackRevenue('v3', { source: 'ads', amount: 5 });
  const breakdown = rt.getRevenueBySource('30d');
  assert(breakdown.length >= 2);
  const ads = breakdown.find(b => b.source === 'ads');
  assert.strictEqual(ads.amount, 15);
});

test('getRevenuePerVideo sums correctly', () => {
  const rt = new RevenueTracker();
  rt.trackRevenue('v1', { source: 'ads', amount: 10 });
  rt.trackRevenue('v1', { source: 'sponsor', amount: 25 });
  rt.trackRevenue('v2', { source: 'ads', amount: 5 });
  assert.strictEqual(rt.getRevenuePerVideo('v1'), 35);
  assert.strictEqual(rt.getRevenuePerVideo('v2'), 5);
});

test('getTotalRevenue returns zero with no data', () => {
  const rt = new RevenueTracker();
  const total = rt.getTotalRevenue('30d');
  assert.strictEqual(total.totalRevenue, 0);
  assert.strictEqual(total.transactionCount, 0);
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. CPMAnalyzer
// ═════════════════════════════════════════════════════════════════════════════

console.log('\n── CPMAnalyzer ──');

test('getCPM returns average for a video', () => {
  const cpm = new CPMAnalyzer();
  cpm.recordCPM('v1', 5.0);
  cpm.recordCPM('v1', 7.0);
  assert.strictEqual(cpm.getCPM('v1'), 6);
});

test('getCPM returns 0 for unknown video', () => {
  const cpm = new CPMAnalyzer();
  assert.strictEqual(cpm.getCPM('nope'), 0);
});

test('getCPMTrend returns direction', () => {
  const cpm = new CPMAnalyzer();
  cpm.recordCPM('v1', 3.0);
  cpm.recordCPM('v1', 6.0);
  const trend = cpm.getCPMTrend('30d');
  assert.strictEqual(trend.direction, 'increasing');
  assert(trend.points.length > 0);
});

test('getBestCPMVideos returns sorted list', () => {
  const cpm = new CPMAnalyzer();
  cpm.recordCPM('v1', 5.0, 1000);
  cpm.recordCPM('v2', 10.0, 2000);
  cpm.recordCPM('v3', 7.0, 1500);
  const best = cpm.getBestCPMVideos(2);
  assert.strictEqual(best.length, 2);
  assert.strictEqual(best[0].videoId, 'v2');
  assert(best[0].avgCPM >= best[1].avgCPM);
});

test('compareWithBenchmark returns comparison', () => {
  const cpm = new CPMAnalyzer();
  cpm.recordCPM('v1', 8.0);
  const comp = cpm.compareWithBenchmark('v1', 'tech');
  assert.strictEqual(comp.benchmark, 8.0);
  assert.strictEqual(comp.difference, 0);
  assert.strictEqual(comp.performance, 'at');
});

test('compareWithBenchmark above benchmark', () => {
  const cpm = new CPMAnalyzer();
  cpm.recordCPM('v1', 12.0);
  const comp = cpm.compareWithBenchmark('v1', 'gaming');
  assert.strictEqual(comp.performance, 'above');
  assert(comp.difference > 0);
});

test('recordCPM rejects negative CPM', () => {
  const cpm = new CPMAnalyzer();
  assert.throws(() => cpm.recordCPM('v1', -1), /CPM must be non-negative/);
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. ContentOptimizer
// ═════════════════════════════════════════════════════════════════════════════

console.log('\n── ContentOptimizer ──');

test('analyzeTitle scores a good title highly', () => {
  const opt = new ContentOptimizer();
  const result = opt.analyzeTitle('TOP 10 Best Tips for YouTube Growth!');
  assert(result.score >= 70);
  assert(result.factors.length > 0);
});

test('analyzeTitle scores empty title as 0', () => {
  const opt = new ContentOptimizer();
  assert.strictEqual(opt.analyzeTitle('').score, 0);
});

test('analyzeTitle penalizes all caps', () => {
  const opt = new ContentOptimizer();
  const result = opt.analyzeTitle('THIS IS A VERY LONG ALL CAPS TITLE THAT IS BAD');
  assert(result.factors.some(f => f.includes('All caps')));
});

test('analyzeThumbnail scores a valid image', () => {
  const opt = new ContentOptimizer();
  const result = opt.analyzeThumbnail('thumbnail_bright_face.jpg');
  assert(result.score > 60);
  assert(result.factors.some(f => f.includes('image format') || f.includes('face')));
});

test('analyzeThumbnail scores empty as 0', () => {
  const opt = new ContentOptimizer();
  assert.strictEqual(opt.analyzeThumbnail('').score, 0);
});

test('analyzeThumbnail with object metadata', () => {
  const opt = new ContentOptimizer();
  const result = opt.analyzeThumbnail({ width: 1920, text: 'Click Me', faceDetected: true });
  assert(result.score > 70);
});

test('analyzeDescription scores detailed description', () => {
  const opt = new ContentOptimizer();
  const desc = 'Check out this amazing video about tech! Visit https://example.com for more. #tech #video\n\nThis is a detailed description with line breaks and useful content for viewers.';
  const result = opt.analyzeDescription(desc);
  assert(result.score >= 70);
});

test('analyzeDescription scores empty as 0', () => {
  const opt = new ContentOptimizer();
  assert.strictEqual(opt.analyzeDescription('').score, 0);
});

test('suggestImprovements returns suggestions for weak video', () => {
  const opt = new ContentOptimizer();
  opt.registerVideo('v1', { title: 'hi', description: 'short', thumbnail: 'bad.bmp' });
  const suggestions = opt.suggestImprovements('v1');
  assert(suggestions.length > 0);
  assert(suggestions.some(s => s.area === 'title'));
});

test('suggestImprovements returns empty for optimized video', () => {
  const opt = new ContentOptimizer();
  opt.registerVideo('v1', {
    title: 'TOP 10 Best Tips for YouTube Growth!',
    description: 'Check out this amazing video about tech! Visit https://example.com for more. #tech #video\n\nThis is a detailed description with line breaks and useful content for viewers.',
    thumbnail: 'thumbnail_bright_face.jpg',
  });
  const suggestions = opt.suggestImprovements('v1');
  assert.strictEqual(suggestions.length, 0);
});

test('registerVideo rejects missing videoId', () => {
  const opt = new ContentOptimizer();
  assert.throws(() => opt.registerVideo('', {}), /videoId is required/);
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. CompetitorBenchmark
// ═════════════════════════════════════════════════════════════════════════════

console.log('\n── CompetitorBenchmark ──');

test('addCompetitor stores competitor', () => {
  const cb = new CompetitorBenchmark();
  cb.addCompetitor('ch1', { name: 'Rival', subscribers: 100000 });
  const m = cb.getCompetitorMetrics('ch1');
  assert.strictEqual(m.subscribers, 100000);
});

test('addCompetitor rejects missing channelId', () => {
  const cb = new CompetitorBenchmark();
  assert.throws(() => cb.addCompetitor('', {}), /channelId is required/);
});

test('compareToOwn returns comparison', () => {
  const cb = new CompetitorBenchmark();
  cb.setOwnChannel({ subscribers: 50000, avgViews: 10000, growthRate: 5 });
  cb.addCompetitor('ch1', { name: 'Rival', subscribers: 100000, avgViews: 20000, growthRate: 8 });
  const comp = cb.compareToOwn('ch1');
  assert.strictEqual(comp.subscribers.difference, 50000);
  assert.strictEqual(comp.avgViews.difference, 10000);
});

test('compareToOwn returns null without own channel', () => {
  const cb = new CompetitorBenchmark();
  cb.addCompetitor('ch1', { name: 'Rival', subscribers: 100000 });
  assert.strictEqual(cb.compareToOwn('ch1'), null);
});

test('getMarketShare returns shares', () => {
  const cb = new CompetitorBenchmark();
  cb.setOwnChannel({ subscribers: 50000 });
  cb.addCompetitor('ch1', { name: 'Rival A', subscribers: 30000 });
  cb.addCompetitor('ch2', { name: 'Rival B', subscribers: 20000 });
  const shares = cb.getMarketShare();
  assert.strictEqual(shares.length, 3);
  const own = shares.find(s => s.channelId === 'own');
  assert.strictEqual(own.share, 50);
});

test('getCompetitorMetrics returns null for unknown', () => {
  const cb = new CompetitorBenchmark();
  assert.strictEqual(cb.getCompetitorMetrics('nope'), null);
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. TrendAnalyzer
// ═════════════════════════════════════════════════════════════════════════════

console.log('\n── TrendAnalyzer ──');

test('addTrend stores trend', () => {
  const ta = new TrendAnalyzer();
  const trend = ta.addTrend('tech', { name: 'AI Tools', volume: 5000, growth: 25 });
  assert.strictEqual(trend.name, 'AI Tools');
  assert.strictEqual(trend.volume, 5000);
});

test('addTrend rejects missing category', () => {
  const ta = new TrendAnalyzer();
  assert.throws(() => ta.addTrend('', {}), /category is required/);
});

test('analyzeTrends returns category trends', () => {
  const ta = new TrendAnalyzer();
  ta.addTrend('tech', { name: 'AI Tools', volume: 5000 });
  ta.addTrend('tech', { name: 'Cloud', volume: 3000 });
  const trends = ta.analyzeTrends('tech');
  assert.strictEqual(trends.length, 2);
});

test('analyzeTrends returns empty for unknown category', () => {
  const ta = new TrendAnalyzer();
  assert.deepStrictEqual(ta.analyzeTrends('unknown'), []);
});

test('getTrendingTopics returns top N', () => {
  const ta = new TrendAnalyzer();
  ta.addTrend('tech', { name: 'AI', volume: 10000 });
  ta.addTrend('gaming', { name: 'FPS', volume: 8000 });
  ta.addTrend('tech', { name: 'Cloud', volume: 3000 });
  const topics = ta.getTrendingTopics(2);
  assert.strictEqual(topics.length, 2);
  assert.strictEqual(topics[0].name, 'AI');
});

test('predictTrend returns prediction', () => {
  const ta = new TrendAnalyzer();
  const trend = ta.addTrend('tech', { name: 'AI Tools', volume: 5000, growth: 20 });
  const pred = ta.predictTrend(trend.id);
  assert.strictEqual(pred.predictedVolume, 6000);
  assert(pred.confidence > 0);
});

test('predictTrend returns null for unknown trend', () => {
  const ta = new TrendAnalyzer();
  assert.strictEqual(ta.predictTrend('nope'), null);
});

test('getSeasonalPatterns returns 12 months', () => {
  const ta = new TrendAnalyzer();
  const patterns = ta.getSeasonalPatterns('tech');
  assert.strictEqual(patterns.length, 12);
  assert.strictEqual(patterns[0].month, 'Jan');
  assert.strictEqual(patterns[11].month, 'Dec');
});

// ═════════════════════════════════════════════════════════════════════════════
// 9. PredictiveAnalytics
// ═════════════════════════════════════════════════════════════════════════════

console.log('\n── PredictiveAnalytics ──');

test('predictViews returns forecast', () => {
  const pa = new PredictiveAnalytics();
  pa.addDataPoint('v1', { views: 100 });
  pa.addDataPoint('v1', { views: 120 });
  pa.addDataPoint('v1', { views: 150 });
  const pred = pa.predictViews('v1', 30);
  assert(pred.predicted > 0);
  assert(pred.confidence > 0);
  assert.strictEqual(pred.days, 30);
});

test('predictViews returns zero for no data', () => {
  const pa = new PredictiveAnalytics();
  const pred = pa.predictViews('nope', 30);
  assert.strictEqual(pred.predicted, 0);
});

test('predictGrowth returns monthly forecasts', () => {
  const pa = new PredictiveAnalytics();
  for (let i = 0; i < 5; i++) {
    pa.addDataPoint('ch1', { views: 1000 + i * 100 });
  }
  const growth = pa.predictGrowth('ch1', 6);
  assert.strictEqual(growth.monthlyForecasts.length, 6);
  assert(growth.totalGrowth > 0);
});

test('predictRevenue returns forecasts', () => {
  const pa = new PredictiveAnalytics();
  pa.addDataPoint('ch1', { revenue: 100 });
  pa.addDataPoint('ch1', { revenue: 150 });
  pa.addDataPoint('ch1', { revenue: 200 });
  const rev = pa.predictRevenue('ch1', 3);
  assert.strictEqual(rev.monthlyForecasts.length, 3);
  assert(rev.totalRevenue > 0);
});

test('getConfidenceLevel returns valid range', () => {
  const pa = new PredictiveAnalytics();
  for (let i = 0; i < 10; i++) pa.addDataPoint('v1', { views: 100 });
  const conf = pa.getConfidenceLevel('views');
  assert(conf >= 0 && conf <= 1);
});

test('addDataPoint rejects missing id', () => {
  const pa = new PredictiveAnalytics();
  assert.throws(() => pa.addDataPoint('', {}), /id is required/);
});

test('predictGrowth returns empty for no data', () => {
  const pa = new PredictiveAnalytics();
  const g = pa.predictGrowth('nope', 12);
  assert.strictEqual(g.totalGrowth, 0);
  assert.strictEqual(g.monthlyForecasts.length, 0);
});

test('predictRevenue returns zero for no data', () => {
  const pa = new PredictiveAnalytics();
  const r = pa.predictRevenue('nope', 12);
  assert.strictEqual(r.totalRevenue, 0);
});

// ═════════════════════════════════════════════════════════════════════════════
// 10. ABRTesting
// ═════════════════════════════════════════════════════════════════════════════

console.log('\n── ABRTesting ──');

test('createTest stores test', () => {
  const abr = new ABRTesting();
  const test = abr.createTest({ videoId: 'v1', variants: [{ name: 'A' }, { name: 'B' }] });
  assert.strictEqual(test.videoId, 'v1');
  assert.strictEqual(test.variants.length, 2);
  assert.strictEqual(test.status, 'active');
});

test('createTest rejects missing videoId', () => {
  const abr = new ABRTesting();
  assert.throws(() => abr.createTest({ variants: [{ name: 'A' }, { name: 'B' }] }), /videoId is required/);
});

test('createTest requires at least 2 variants', () => {
  const abr = new ABRTesting();
  assert.throws(() => abr.createTest({ videoId: 'v1', variants: [{ name: 'A' }] }), /At least 2 variants/);
});

test('recordClick updates counts', () => {
  const abr = new ABRTesting();
  const test = abr.createTest({ videoId: 'v1', variants: [{ name: 'A' }, { name: 'B' }] });
  abr.recordClick(test.testId, test.variants[0].id);
  abr.recordClick(test.testId, test.variants[0].id);
  const results = abr.getResults(test.testId);
  assert.strictEqual(results.variants[0].clicks, 2);
});

test('recordClick rejects invalid testId', () => {
  const abr = new ABRTesting();
  assert.throws(() => abr.recordClick('nope', 'v1'), /Test not found/);
});

test('recordClick rejects invalid variantId', () => {
  const abr = new ABRTesting();
  const test = abr.createTest({ videoId: 'v1', variants: [{ name: 'A' }, { name: 'B' }] });
  assert.throws(() => abr.recordClick(test.testId, 'fake'), /Variant not found/);
});

test('getWinner returns highest CTR variant', () => {
  const abr = new ABRTesting();
  const test = abr.createTest({ videoId: 'v1', variants: [{ name: 'A' }, { name: 'B' }] });
  // Give variant A more clicks
  for (let i = 0; i < 10; i++) abr.recordClick(test.testId, test.variants[0].id);
  for (let i = 0; i < 3; i++) abr.recordClick(test.testId, test.variants[1].id);
  const winner = abr.getWinner(test.testId);
  assert.strictEqual(winner.name, 'A');
});

test('getWinner returns null for unknown test', () => {
  const abr = new ABRTesting();
  assert.strictEqual(abr.getWinner('nope'), null);
});

test('getStatisticalSignificance returns a number', () => {
  const abr = new ABRTesting();
  const test = abr.createTest({ videoId: 'v1', variants: [{ name: 'A' }, { name: 'B' }] });
  for (let i = 0; i < 50; i++) abr.recordClick(test.testId, test.variants[0].id);
  for (let i = 0; i < 10; i++) abr.recordClick(test.testId, test.variants[1].id);
  const sig = abr.getStatisticalSignificance(test.testId);
  assert(typeof sig === 'number');
  assert(sig >= 0 && sig <= 1);
});

test('getStatisticalSignificance returns 0 for no data', () => {
  const abr = new ABRTesting();
  assert.strictEqual(abr.getStatisticalSignificance('nope'), 0);
});

// ═════════════════════════════════════════════════════════════════════════════
// Helpers
// ═════════════════════════════════════════════════════════════════════════════

console.log('\n── Helpers ──');

test('round2 rounds to 2 decimals', () => {
  assert.strictEqual(round2(3.456), 3.46);
  assert.strictEqual(round2(1), 1);
  assert.strictEqual(round2(0.1 + 0.2), 0.3);
});

test('parsePeriod parses d/h/m', () => {
  assert.strictEqual(parsePeriod('7d'), 7);
  assert.strictEqual(parsePeriod('24h'), 1);
  assert.strictEqual(parsePeriod('2m'), 60);
  assert.strictEqual(parsePeriod('bad'), 30);
});

test('generateId returns unique ids', () => {
  const a = generateId('test');
  const b = generateId('test');
  assert.notStrictEqual(a, b);
  assert(a.startsWith('test_'));
});

test('normalCDF returns values between 0 and 1', () => {
  assert(Math.abs(normalCDF(0) - 0.5) < 0.001);
  assert(normalCDF(3) > 0.99);
  assert(normalCDF(-3) < 0.01);
});

// ═════════════════════════════════════════════════════════════════════════════
// Summary
// ═════════════════════════════════════════════════════════════════════════════

console.log('\n══════════════════════════════════════════════════════');
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log('══════════════════════════════════════════════════════');

if (failed > 0) process.exit(1);
