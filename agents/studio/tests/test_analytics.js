import assert from 'node:assert';
import { VideoAnalytics, CPM } from '../src/analytics.js';

let analytics;
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
  analytics = new VideoAnalytics();
  analytics.trackVideo({
    video_id: 'vid1',
    title: 'Test Video',
    platforms: ['youtube', 'tiktok'],
    duration_sec: 600,
    published_at: '2026-01-01T00:00:00Z',
  });
}

console.log('\n=== Analytics Tests ===\n');

// 1
test('trackVideo stores video', () => {
  setup();
  const stats = analytics.getVideoStats('vid1');
  assert.strictEqual(stats.views, 0);
});

// 2
test('recordView increments views', () => {
  setup();
  analytics.recordView({ video_id: 'vid1', platform: 'youtube', timestamp: '2026-01-01T10:00:00Z', watch_duration_sec: 300 });
  analytics.recordView({ video_id: 'vid1', platform: 'youtube', timestamp: '2026-01-01T10:05:00Z', watch_duration_sec: 400 });
  const stats = analytics.getVideoStats('vid1');
  assert.strictEqual(stats.views, 2);
});

// 3
test('getVideoStats returns correct views', () => {
  setup();
  for (let i = 0; i < 10; i++) {
    analytics.recordView({ video_id: 'vid1', platform: 'youtube', watch_duration_sec: 300 });
  }
  const stats = analytics.getVideoStats('vid1');
  assert.strictEqual(stats.views, 10);
});

// 4
test('getVideoStats avg_watch_pct calculated', () => {
  setup();
  analytics.recordView({ video_id: 'vid1', platform: 'youtube', watch_duration_sec: 600 });
  const stats = analytics.getVideoStats('vid1');
  assert.strictEqual(stats.avg_watch_pct, 100);
});

// 5
test('getRetentionCurve returns correct buckets', () => {
  setup();
  analytics.recordView({ video_id: 'vid1', platform: 'youtube', watch_duration_sec: 300 });
  const curve = analytics.getRetentionCurve('vid1', 5);
  assert.strictEqual(curve.length, 6);
});

// 6
test('getRetentionCurve first bucket = 100%', () => {
  setup();
  analytics.recordView({ video_id: 'vid1', platform: 'youtube', watch_duration_sec: 300 });
  const curve = analytics.getRetentionCurve('vid1');
  assert.strictEqual(curve[0].retained_pct, 100);
});

// 7
test('getRetentionCurve last bucket = completion rate', () => {
  setup();
  analytics.recordView({ video_id: 'vid1', platform: 'youtube', watch_duration_sec: 600 });
  analytics.recordView({ video_id: 'vid1', platform: 'youtube', watch_duration_sec: 300 });
  const curve = analytics.getRetentionCurve('vid1');
  const stats = analytics.getVideoStats('vid1');
  assert.strictEqual(curve[curve.length - 1].retained_pct, stats.completion_rate);
});

// 8
test('getAudienceDemographics returns all fields', () => {
  setup();
  analytics.recordView({ video_id: 'vid1', platform: 'youtube', watch_duration_sec: 300 });
  const demo = analytics.getAudienceDemographics('vid1');
  assert.ok(demo.age_groups);
  assert.ok(demo.gender);
  assert.ok(demo.top_countries);
});

// 9
test('getEngagementRate calculates correctly', () => {
  setup();
  analytics.recordView({ video_id: 'vid1', platform: 'youtube', watch_duration_sec: 300 });
  const eng = analytics.getEngagementRate('vid1');
  assert.ok(typeof eng.likes_per_view === 'number');
  assert.ok(typeof eng.comments_per_view === 'number');
  assert.ok(typeof eng.shares_per_view === 'number');
  assert.ok(typeof eng.overall === 'number');
});

// 10
test('getRevenueEstimate YouTube CPM $5', () => {
  setup();
  analytics.recordView({ video_id: 'vid1', platform: 'youtube', watch_duration_sec: 300 });
  analytics.recordView({ video_id: 'vid1', platform: 'youtube', watch_duration_sec: 300 });
  const rev = analytics.getRevenueEstimate('vid1', 'youtube');
  assert.strictEqual(rev.cpm, 5);
  assert.strictEqual(rev.estimated_revenue, 0.01);
});

// 11
test('getRevenueEstimate TikTok CPM $1', () => {
  setup();
  for (let i = 0; i < 2000; i++) analytics.recordView({ video_id: 'vid1', platform: 'tiktok', watch_duration_sec: 300 });
  const rev = analytics.getRevenueEstimate('vid1', 'tiktok');
  assert.strictEqual(rev.cpm, 1);
  assert.strictEqual(rev.estimated_revenue, 2);
});

// 12
test('getRevenueEstimate Instagram CPM $4', () => {
  setup();
  for (let i = 0; i < 2000; i++) analytics.recordView({ video_id: 'vid1', platform: 'instagram', watch_duration_sec: 300 });
  const rev = analytics.getRevenueEstimate('vid1', 'instagram');
  assert.strictEqual(rev.cpm, 4);
  assert.strictEqual(rev.estimated_revenue, 8);
});

// 13
test('listVideos sorts by views', () => {
  setup();
  analytics.trackVideo({ video_id: 'vid2', title: 'Less Views', platforms: ['youtube'], duration_sec: 300 });
  analytics.trackVideo({ video_id: 'vid3', title: 'Most Views', platforms: ['youtube'], duration_sec: 300 });
  for (let i = 0; i < 5; i++) analytics.recordView({ video_id: 'vid1', platform: 'youtube', watch_duration_sec: 100 });
  for (let i = 0; i < 10; i++) analytics.recordView({ video_id: 'vid3', platform: 'youtube', watch_duration_sec: 100 });
  analytics.recordView({ video_id: 'vid2', platform: 'youtube', watch_duration_sec: 100 });
  const list = analytics.listVideos({ sort_by: 'views' });
  assert.strictEqual(list[0].video_id, 'vid3');
  assert.strictEqual(list[1].video_id, 'vid1');
  assert.strictEqual(list[2].video_id, 'vid2');
});

// 14
test('listVideos filters by platform', () => {
  setup();
  analytics.trackVideo({ video_id: 'vid2', title: 'TikTok Only', platforms: ['tiktok'], duration_sec: 300 });
  for (let i = 0; i < 3; i++) analytics.recordView({ video_id: 'vid1', platform: 'youtube', watch_duration_sec: 100 });
  for (let i = 0; i < 2; i++) analytics.recordView({ video_id: 'vid2', platform: 'tiktok', watch_duration_sec: 100 });
  const list = analytics.listVideos({ platform: 'youtube' });
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].video_id, 'vid1');
});

// 15
test('getOverallStats sums all videos', () => {
  setup();
  analytics.trackVideo({ video_id: 'vid2', platforms: ['youtube'], duration_sec: 300 });
  for (let i = 0; i < 5; i++) analytics.recordView({ video_id: 'vid1', platform: 'youtube', watch_duration_sec: 100 });
  for (let i = 0; i < 3; i++) analytics.recordView({ video_id: 'vid2', platform: 'youtube', watch_duration_sec: 100 });
  const overall = analytics.getOverallStats();
  assert.strictEqual(overall.total_views, 8);
  assert.strictEqual(overall.total_videos, 2);
});

// 16
test('Multiple views tracked correctly', () => {
  setup();
  for (let i = 0; i < 100; i++) {
    analytics.recordView({ video_id: 'vid1', platform: 'youtube', watch_duration_sec: 100 + i });
  }
  const stats = analytics.getVideoStats('vid1');
  assert.strictEqual(stats.views, 100);
  assert.ok(stats.total_watch_time_sec > 0);
});

// 17
test('Different platforms independent', () => {
  setup();
  for (let i = 0; i < 5; i++) analytics.recordView({ video_id: 'vid1', platform: 'youtube', watch_duration_sec: 300 });
  for (let i = 0; i < 3; i++) analytics.recordView({ video_id: 'vid1', platform: 'tiktok', watch_duration_sec: 200 });
  const yt = analytics.getPlatformStats('vid1', 'youtube');
  const tt = analytics.getPlatformStats('vid1', 'tiktok');
  assert.strictEqual(yt.views, 5);
  assert.strictEqual(tt.views, 3);
});

// 18
test('View with watch_duration > video duration capped', () => {
  setup();
  analytics.recordView({ video_id: 'vid1', platform: 'youtube', watch_duration_sec: 9999 });
  const stats = analytics.getVideoStats('vid1');
  assert.strictEqual(stats.total_watch_time_sec, 600);
});

// 19
test('Retention curve decreasing monotonic', () => {
  setup();
  const durs = [580, 520, 480, 400, 350, 300, 250, 200, 150, 100, 80, 60, 40, 20, 10, 5, 3, 2, 1, 0];
  durs.forEach((d) => analytics.recordView({ video_id: 'vid1', platform: 'youtube', watch_duration_sec: d }));
  const curve = analytics.getRetentionCurve('vid1');
  for (let i = 1; i < curve.length; i++) {
    assert.ok(curve[i].retained_pct <= curve[i - 1].retained_pct,
      `Bucket ${i}: ${curve[i].retained_pct} > ${curve[i - 1].retained_pct}`);
  }
});

// 20
test('Engagement rate with zero views = 0', () => {
  setup();
  const eng = analytics.getEngagementRate('vid1');
  assert.strictEqual(eng.overall, 0);
});

// 21
test('Revenue with zero views = $0', () => {
  setup();
  const rev = analytics.getRevenueEstimate('vid1', 'youtube');
  assert.strictEqual(rev.estimated_revenue, 0);
});

// 22
test('getVideoStats unknown id returns null', () => {
  setup();
  assert.strictEqual(analytics.getVideoStats('nonexistent'), null);
});

// 23
test('listVideos respects limit', () => {
  setup();
  analytics.trackVideo({ video_id: 'vid2', platforms: ['youtube'], duration_sec: 300 });
  analytics.trackVideo({ video_id: 'vid3', platforms: ['youtube'], duration_sec: 300 });
  analytics.trackVideo({ video_id: 'vid4', platforms: ['youtube'], duration_sec: 300 });
  const list = analytics.listVideos({ limit: 2 });
  assert.strictEqual(list.length, 2);
});

// 24
test('getOverallStats empty = zeros', () => {
  analytics = new VideoAnalytics();
  const overall = analytics.getOverallStats();
  assert.strictEqual(overall.total_views, 0);
  assert.strictEqual(overall.total_watch_time, 0);
  assert.strictEqual(overall.total_videos, 0);
  assert.strictEqual(overall.avg_completion, 0);
});

// 25
test('recordView with user_agent stored', () => {
  setup();
  analytics.recordView({ video_id: 'vid1', platform: 'youtube', watch_duration_sec: 300, user_agent: 'Mozilla/5.0' });
  const viewList = analytics.views.get('vid1');
  assert.strictEqual(viewList[0].user_agent, 'Mozilla/5.0');
});

// 26
test('Demographics age groups sum to 100%', () => {
  setup();
  analytics.recordView({ video_id: 'vid1', platform: 'youtube', watch_duration_sec: 300 });
  const demo = analytics.getAudienceDemographics('vid1');
  const sum = demo.age_groups.reduce((a, g) => a + g.pct, 0);
  assert.ok(Math.abs(sum - 100) < 0.1, `Sum was ${sum}`);
});

// 27
test('Demographics gender sums to 100%', () => {
  setup();
  analytics.recordView({ video_id: 'vid1', platform: 'youtube', watch_duration_sec: 300 });
  const demo = analytics.getAudienceDemographics('vid1');
  const sum = demo.gender.reduce((a, g) => a + g.pct, 0);
  assert.ok(Math.abs(sum - 100) < 0.1, `Sum was ${sum}`);
});

// 28
test('Demographics top_countries sorted desc', () => {
  setup();
  analytics.recordView({ video_id: 'vid1', platform: 'youtube', watch_duration_sec: 300 });
  const demo = analytics.getAudienceDemographics('vid1');
  for (let i = 1; i < demo.top_countries.length; i++) {
    assert.ok(demo.top_countries[i].pct <= demo.top_countries[i - 1].pct);
  }
});

// 29
test('Multiple records for same video', () => {
  setup();
  analytics.recordView({ video_id: 'vid1', platform: 'youtube', watch_duration_sec: 100 });
  analytics.recordView({ video_id: 'vid1', platform: 'tiktok', watch_duration_sec: 200 });
  analytics.recordView({ video_id: 'vid1', platform: 'youtube', watch_duration_sec: 300 });
  const stats = analytics.getVideoStats('vid1');
  assert.strictEqual(stats.views, 3);
  assert.strictEqual(stats.total_watch_time_sec, 600);
});

// 30
test('getRetentionCurve with 5 buckets', () => {
  setup();
  analytics.recordView({ video_id: 'vid1', platform: 'youtube', watch_duration_sec: 300 });
  analytics.recordView({ video_id: 'vid1', platform: 'youtube', watch_duration_sec: 600 });
  const curve = analytics.getRetentionCurve('vid1', 5);
  assert.strictEqual(curve.length, 6);
  assert.strictEqual(curve[0].time_pct, 0);
  assert.strictEqual(curve[curve.length - 1].time_pct, 100);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
