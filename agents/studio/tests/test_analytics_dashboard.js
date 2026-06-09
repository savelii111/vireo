// test_analytics_dashboard.js — Comprehensive tests for the analytics dashboard.
//
// Validates:
//   1.  getDashboardSummary returns all fields
//   2.  getDashboardSummary top_video is most viewed
//   3.  getDashboardSummary worst_video is least viewed
//   4.  getPlatformComparison returns array
//   5.  getPlatformComparison sorted by views desc
//   6.  getTopVideos respects limit
//   7.  getTopVideos sorted by views desc
//   8.  getWorstPerforming returns low completion videos
//   9.  getEngagementTrend returns daily data
//  10.  getEngagementTrend correct length
//  11.  getOptimalPostTimes returns hours/days
//  12.  getOptimalPostTimes YouTube has weekday bias
//  13.  getContentRecommendations returns suggestions
//  14.  getContentRecommendations low completion suggests 'add_captions'
//  15.  exportReport JSON valid
//  16.  exportReport contains summary
//  17.  getDashboardSummary empty data = zeros
//  18.  getPlatformComparison single platform
//  19.  getTopVideos with limit 1
//  20.  getWorstPerforming with no data = empty
//  21.  getEngagementTrend future dates excluded
//  22.  exportReport format validation

import { test } from "node:test";
import assert from "node:assert/strict";
import { Dashboard } from "../src/analytics_dashboard.js";

// ── Fixtures ───────────────────────────────────────────────────────────────

function makeVideos() {
  return [
    { video_id: "v1", title: "Best Video", duration_sec: 300, completion_rate: 0.9, drop_off_point_sec: 270 },
    { video_id: "v2", title: "Good Video", duration_sec: 600, completion_rate: 0.7, drop_off_point_sec: 500 },
    { video_id: "v3", title: "Mediocre Video", duration_sec: 900, completion_rate: 0.4, drop_off_point_sec: 300 },
    { video_id: "v4", title: "Bad Video", duration_sec: 120, completion_rate: 0.15, drop_off_point_sec: 15 },
    { video_id: "v5", title: "Short Clip", duration_sec: 10, completion_rate: 0.6, drop_off_point_sec: 5 },
  ];
}

function makePlatformData() {
  const today = new Date();
  function dateStr(daysAgo) {
    const d = new Date(today);
    d.setDate(d.getDate() - daysAgo);
    return d.toISOString().substring(0, 10);
  }

  return {
    youtube: {
      views: 50000,
      engagement_rate: 0.08,
      revenue: 1200.5,
      videos: [
        { video_id: "v1", views: 25000, likes: 2000, comments: 500, shares: 300, revenue: 800 },
        { video_id: "v2", views: 15000, likes: 1000, comments: 200, shares: 100, revenue: 300 },
        { video_id: "v3", views: 8000, likes: 400, comments: 80, shares: 40, revenue: 80 },
        { video_id: "v4", views: 2000, likes: 50, comments: 10, shares: 5, revenue: 20.5 },
        {
          video_id: "v1", views: 1200, likes: 100, comments: 20, shares: 10,
          daily: [
            { date: dateStr(3), views: 600, likes: 50, comments: 10, shares: 5 },
            { date: dateStr(2), views: 400, likes: 30, comments: 8, shares: 3 },
            { date: dateStr(1), views: 200, likes: 20, comments: 2, shares: 2 },
          ],
        },
      ],
    },
    tiktok: {
      views: 30000,
      engagement_rate: 0.12,
      revenue: 600,
      videos: [
        { video_id: "v1", views: 18000, likes: 3000, comments: 800, shares: 500, revenue: 400 },
        { video_id: "v2", views: 7000, likes: 1000, comments: 300, shares: 200, revenue: 150 },
        { video_id: "v3", views: 4000, likes: 300, comments: 60, shares: 30, revenue: 40 },
        { video_id: "v5", views: 1000, likes: 150, comments: 20, shares: 10, revenue: 10 },
      ],
    },
    instagram_reels: {
      views: 15000,
      engagement_rate: 0.1,
      revenue: 200,
      videos: [
        { video_id: "v1", views: 10000, likes: 1500, comments: 300, shares: 200, revenue: 150 },
        { video_id: "v2", views: 3000, likes: 400, comments: 100, shares: 50, revenue: 40 },
        { video_id: "v3", views: 2000, likes: 150, comments: 30, shares: 15, revenue: 10 },
      ],
    },
  };
}

function makeDailyPlatformData() {
  const today = new Date();
  function dateStr(daysAgo) {
    const d = new Date(today);
    d.setDate(d.getDate() - daysAgo);
    return d.toISOString().substring(0, 10);
  }

  const daily = [];
  for (let i = 29; i >= 0; i--) {
    daily.push({
      date: dateStr(i),
      views: 100 + Math.floor(Math.random() * 50),
      likes: 10 + Math.floor(Math.random() * 10),
      comments: 2 + Math.floor(Math.random() * 5),
      shares: 1 + Math.floor(Math.random() * 3),
    });
  }

  return {
    youtube: {
      views: 3000,
      engagement_rate: 0.08,
      revenue: 100,
      videos: [
        { video_id: "v1", views: 3000, likes: 300, comments: 60, shares: 30, revenue: 100, daily },
      ],
    },
  };
}

// =====================================================================
// 1. getDashboardSummary returns all fields
// =====================================================================
test("getDashboardSummary returns all fields", () => {
  const db = new Dashboard(makeVideos(), makePlatformData());
  const s = db.getDashboardSummary();

  assert.ok("total_views" in s, "missing total_views");
  assert.ok("total_watch_time_hours" in s, "missing total_watch_time_hours");
  assert.ok("avg_completion_rate" in s, "missing avg_completion_rate");
  assert.ok("top_video" in s, "missing top_video");
  assert.ok("worst_video" in s, "missing worst_video");
  assert.ok("trend" in s, "missing trend");
});

// =====================================================================
// 2. getDashboardSummary top_video is most viewed
// =====================================================================
test("getDashboardSummary top_video is most viewed", () => {
  const db = new Dashboard(makeVideos(), makePlatformData());
  const s = db.getDashboardSummary();

  assert.ok(s.top_video);
  assert.equal(s.top_video.video_id, "v1");
  assert.equal(s.top_video.title, "Best Video");
  assert.ok(s.top_video.views > 0);
});

// =====================================================================
// 3. getDashboardSummary worst_video is least viewed
// =====================================================================
test("getDashboardSummary worst_video is least viewed", () => {
  const db = new Dashboard(makeVideos(), makePlatformData());
  const s = db.getDashboardSummary();

  assert.ok(s.worst_video);
  // v5 only appears on tiktok with 1000 views
  assert.equal(s.worst_video.video_id, "v5");
  assert.equal(s.worst_video.title, "Short Clip");
});

// =====================================================================
// 4. getPlatformComparison returns array
// =====================================================================
test("getPlatformComparison returns array", () => {
  const db = new Dashboard(makeVideos(), makePlatformData());
  const result = db.getPlatformComparison();

  assert.ok(Array.isArray(result));
  assert.equal(result.length, 3);
});

// =====================================================================
// 5. getPlatformComparison sorted by views desc
// =====================================================================
test("getPlatformComparison sorted by views desc", () => {
  const db = new Dashboard(makeVideos(), makePlatformData());
  const result = db.getPlatformComparison();

  for (let i = 1; i < result.length; i++) {
    assert.ok(result[i - 1].views >= result[i].views,
      `Expected ${result[i - 1].views} >= ${result[i].views}`);
  }
  assert.equal(result[0].platform, "youtube");
});

// =====================================================================
// 6. getTopVideos respects limit
// =====================================================================
test("getTopVideos respects limit", () => {
  const db = new Dashboard(makeVideos(), makePlatformData());
  const top3 = db.getTopVideos(3);

  assert.equal(top3.length, 3);
  assert.ok(top3.every((v) => typeof v.video_id === "string"));
  assert.ok(top3.every((v) => typeof v.title === "string"));
  assert.ok(top3.every((v) => typeof v.views === "number"));
  assert.ok(top3.every((v) => typeof v.completion_rate === "number"));
  assert.ok(top3.every((v) => typeof v.revenue === "number"));
});

// =====================================================================
// 7. getTopVideos sorted by views desc
// =====================================================================
test("getTopVideos sorted by views desc", () => {
  const db = new Dashboard(makeVideos(), makePlatformData());
  const top = db.getTopVideos(10);

  for (let i = 1; i < top.length; i++) {
    assert.ok(top[i - 1].views >= top[i].views,
      `Expected views ${top[i - 1].views} >= ${top[i].views}`);
  }
  assert.equal(top[0].video_id, "v1");
});

// =====================================================================
// 8. getWorstPerforming returns low completion videos
// =====================================================================
test("getWorstPerforming returns low completion videos", () => {
  const db = new Dashboard(makeVideos(), makePlatformData());
  const worst = db.getWorstPerforming(3);

  assert.equal(worst.length, 3);
  // Should be sorted ascending by completion_rate
  assert.ok(worst[0].completion_rate <= worst[1].completion_rate);
  assert.ok(worst[1].completion_rate <= worst[2].completion_rate);
  // v4 has 0.15 completion rate
  assert.equal(worst[0].video_id, "v4");
});

// =====================================================================
// 9. getEngagementTrend returns daily data
// =====================================================================
test("getEngagementTrend returns daily data", () => {
  const db = new Dashboard(makeVideos(), makeDailyPlatformData());
  const trend = db.getEngagementTrend("v1", 30);

  assert.ok(Array.isArray(trend));
  assert.ok(trend.length > 0);

  for (const entry of trend) {
    assert.ok("date" in entry, "missing date");
    assert.ok("views" in entry, "missing views");
    assert.ok("likes" in entry, "missing likes");
    assert.ok("comments" in entry, "missing comments");
    assert.ok("shares" in entry, "missing shares");
  }
});

// =====================================================================
// 10. getEngagementTrend correct length
// =====================================================================
test("getEngagementTrend correct length", () => {
  const db = new Dashboard(makeVideos(), makeDailyPlatformData());
  // 30 days of data, but some might be missing if random alignment
  const trend = db.getEngagementTrend("v1", 30);
  assert.ok(trend.length >= 25, `Expected at least 25 entries, got ${trend.length}`);
  assert.ok(trend.length <= 30, `Expected at most 30 entries, got ${trend.length}`);
});

// =====================================================================
// 11. getOptimalPostTimes returns hours/days
// =====================================================================
test("getOptimalPostTimes returns hours/days", () => {
  const db = new Dashboard(makeVideos(), makePlatformData());
  const yt = db.getOptimalPostTimes("youtube");

  assert.ok(Array.isArray(yt.best_hours));
  assert.ok(yt.best_hours.length > 0);
  assert.ok(Array.isArray(yt.best_days));
  assert.ok(yt.best_days.length > 0);
  assert.ok(typeof yt.reason === "string");
  assert.ok(yt.reason.length > 0);
});

// =====================================================================
// 12. getOptimalPostTimes YouTube has weekday bias
// =====================================================================
test("getOptimalPostTimes YouTube has weekday bias", () => {
  const db = new Dashboard(makeVideos(), makePlatformData());
  const yt = db.getOptimalPostTimes("youtube");

  // YouTube defaults should include weekdays
  const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
  const hasWeekday = yt.best_days.some((d) => weekdays.includes(d));
  assert.ok(hasWeekday, "YouTube should have weekday bias in best_days");
});

// =====================================================================
// 13. getContentRecommendations returns suggestions
// =====================================================================
test("getContentRecommendations returns suggestions", () => {
  const db = new Dashboard(makeVideos(), makePlatformData());
  const recs = db.getContentRecommendations("v3");

  assert.ok(Array.isArray(recs));
  assert.ok(recs.length > 0, "Should have at least one recommendation");
  for (const r of recs) {
    assert.equal(typeof r, "string");
  }
});

// =====================================================================
// 14. getContentRecommendations low completion suggests 'add_captions'
// =====================================================================
test("getContentRecommendations low completion suggests add_captions", () => {
  const db = new Dashboard(makeVideos(), makePlatformData());
  // v4 has 0.15 completion rate — well below 0.3 threshold
  const recs = db.getContentRecommendations("v4");

  assert.ok(recs.includes("add_captions"),
    "Low completion video should suggest add_captions");
  assert.ok(recs.includes("shorten_video_length"),
    "Low completion video should suggest shorten_video_length");
});

// =====================================================================
// 15. exportReport JSON valid
// =====================================================================
test("exportReport JSON valid", () => {
  const db = new Dashboard(makeVideos(), makePlatformData());
  const raw = db.exportReport("json");

  assert.equal(typeof raw, "string");
  let parsed;
  assert.doesNotThrow(() => { parsed = JSON.parse(raw); });
  assert.ok(parsed);
});

// =====================================================================
// 16. exportReport contains summary
// =====================================================================
test("exportReport contains summary", () => {
  const db = new Dashboard(makeVideos(), makePlatformData());
  const report = JSON.parse(db.exportReport("json"));

  assert.ok(report.generated_at);
  assert.ok(report.summary);
  assert.ok(report.summary.total_views > 0);
  assert.ok(Array.isArray(report.platform_comparison));
  assert.ok(Array.isArray(report.top_videos));
  assert.ok(Array.isArray(report.worst_performing));
  assert.equal(report.video_count, 5);
  assert.equal(report.platform_count, 3);
});

// =====================================================================
// 17. getDashboardSummary empty data = zeros
// =====================================================================
test("getDashboardSummary empty data = zeros", () => {
  const db = new Dashboard([], {});
  const s = db.getDashboardSummary();

  assert.equal(s.total_views, 0);
  assert.equal(s.total_watch_time_hours, 0);
  assert.equal(s.avg_completion_rate, 0);
  assert.equal(s.top_video, null);
  assert.equal(s.worst_video, null);
  assert.equal(s.trend, "stable");
});

// =====================================================================
// 18. getPlatformComparison single platform
// =====================================================================
test("getPlatformComparison single platform", () => {
  const singleData = {
    youtube: { views: 10000, engagement_rate: 0.05, revenue: 200, videos: [] },
  };
  const db = new Dashboard(makeVideos(), singleData);
  const result = db.getPlatformComparison();

  assert.equal(result.length, 1);
  assert.equal(result[0].platform, "youtube");
  assert.equal(result[0].views, 10000);
});

// =====================================================================
// 19. getTopVideos with limit 1
// =====================================================================
test("getTopVideos with limit 1", () => {
  const db = new Dashboard(makeVideos(), makePlatformData());
  const top1 = db.getTopVideos(1);

  assert.equal(top1.length, 1);
  assert.equal(top1[0].video_id, "v1");
  assert.equal(top1[0].title, "Best Video");
});

// =====================================================================
// 20. getWorstPerforming with no data = empty
// =====================================================================
test("getWorstPerforming with no data returns empty", () => {
  const db = new Dashboard([], {});
  const worst = db.getWorstPerforming(10);

  assert.ok(Array.isArray(worst));
  assert.equal(worst.length, 0);
});

// =====================================================================
// 21. getEngagementTrend future dates excluded
// =====================================================================
test("getEngagementTrend future dates excluded", () => {
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + 5);
  const futureStr = futureDate.toISOString().substring(0, 10);

  const dataWithFuture = {
    youtube: {
      views: 1000,
      engagement_rate: 0.05,
      revenue: 50,
      videos: [
        {
          video_id: "v1", views: 1000, likes: 100, comments: 20, shares: 10, revenue: 50,
          daily: [
            { date: "2025-01-15", views: 500, likes: 50, comments: 10, shares: 5 },
            { date: futureStr, views: 999, likes: 999, comments: 999, shares: 999 },
          ],
        },
      ],
    },
  };

  const db = new Dashboard(makeVideos(), dataWithFuture);
  const trend = db.getEngagementTrend("v1", 60);

  for (const entry of trend) {
    const d = new Date(entry.date);
    assert.ok(d <= new Date(), `Future date ${entry.date} should not appear`);
    // Future-dated entry should not inflate counts
    assert.ok(entry.views < 999, "Future views should not be counted");
  }
});

// =====================================================================
// 22. exportReport format validation
// =====================================================================
test("exportReport format validation", () => {
  const db = new Dashboard(makeVideos(), makePlatformData());

  // JSON format works
  const json = db.exportReport("json");
  assert.ok(json);
  const parsed = JSON.parse(json);
  assert.ok(parsed.summary);
  assert.ok(parsed.generated_at);

  // Unsupported format throws
  assert.throws(
    () => db.exportReport("csv"),
    /Unsupported format/
  );

  // Unknown format throws
  assert.throws(
    () => db.exportReport("xml"),
    /Unsupported format/
  );
});

// =====================================================================
// 23. getDashboardSummary computes watch time correctly
// =====================================================================
test("getDashboardSummary computes watch time correctly", () => {
  // Simple case: 1 video, 100 views, 600 sec duration, 50% completion
  // Watch time = 600 * 100 * 0.5 = 30000 sec = 8.3333 hours
  const simpleVideos = [
    { video_id: "v1", title: "Simple", duration_sec: 600, completion_rate: 0.5, drop_off_point_sec: 300 },
  ];
  const simpleData = {
    youtube: {
      views: 100,
      engagement_rate: 0.1,
      revenue: 10,
      videos: [{ video_id: "v1", views: 100, likes: 10, comments: 2, shares: 1, revenue: 10 }],
    },
  };

  const db = new Dashboard(simpleVideos, simpleData);
  const s = db.getDashboardSummary();

  // 600 * 100 * 0.5 = 30000 seconds = 8.3333 hours
  assert.ok(Math.abs(s.total_watch_time_hours - 8.3333) < 0.01,
    `Expected ~8.33 hours, got ${s.total_watch_time_hours}`);
});

// =====================================================================
// 24. getTopVideos aggregates across platforms
// =====================================================================
test("getTopVideos aggregates across platforms", () => {
  const db = new Dashboard(makeVideos(), makePlatformData());
  const top = db.getTopVideos(10);

  // v1 appears on youtube (25000+1200 daily) + tiktok (18000) + instagram (10000) = 54200
  const v1 = top.find((v) => v.video_id === "v1");
  assert.ok(v1);
  assert.equal(v1.views, 54200);
});

// =====================================================================
// 25. getContentRecommendations unknown video returns empty
// =====================================================================
test("getContentRecommendations unknown video returns empty", () => {
  const db = new Dashboard(makeVideos(), makePlatformData());
  const recs = db.getContentRecommendations("nonexistent");

  assert.ok(Array.isArray(recs));
  assert.equal(recs.length, 0);
});

// =====================================================================
// 26. getContentRecommendations short video suggests extending
// =====================================================================
test("getContentRecommendations short video suggests extending", () => {
  // v5 is 10 seconds
  const db = new Dashboard(makeVideos(), makePlatformData());
  const recs = db.getContentRecommendations("v5");

  assert.ok(recs.includes("consider_extending_content"),
    "Short video should suggest extending content");
});

// =====================================================================
// 27. getOptimalPostTimes unknown platform returns defaults or empty
// =====================================================================
test("getOptimalPostTimes unknown platform returns empty", () => {
  const db = new Dashboard(makeVideos(), makePlatformData());
  const result = db.getOptimalPostTimes("nonexistent");

  assert.ok(Array.isArray(result.best_hours));
  assert.ok(Array.isArray(result.best_days));
  assert.ok(typeof result.reason === "string");
});

// =====================================================================
// 28. getDashboardSummary trend with growing data
// =====================================================================
test("getDashboardSummary trend with growing data", () => {
  const today = new Date();
  function dateStr(daysAgo) {
    const d = new Date(today);
    d.setDate(d.getDate() - daysAgo);
    return d.toISOString().substring(0, 10);
  }

  const growingData = {
    youtube: {
      views: 10000,
      engagement_rate: 0.1,
      revenue: 100,
      videos: [
        {
          video_id: "v1", views: 10000, likes: 500, comments: 100, shares: 50, revenue: 100,
          daily: [
            // Previous 7 days (14-8 days ago): 100 views each = 700 total
            { date: dateStr(14), views: 100, likes: 10, comments: 2, shares: 1 },
            { date: dateStr(13), views: 100, likes: 10, comments: 2, shares: 1 },
            { date: dateStr(12), views: 100, likes: 10, comments: 2, shares: 1 },
            { date: dateStr(11), views: 100, likes: 10, comments: 2, shares: 1 },
            { date: dateStr(10), views: 100, likes: 10, comments: 2, shares: 1 },
            { date: dateStr(9), views: 100, likes: 10, comments: 2, shares: 1 },
            { date: dateStr(8), views: 100, likes: 10, comments: 2, shares: 1 },
            // Recent 7 days (7-1 days ago): 200 views each = 1400 total → 100% increase
            { date: dateStr(7), views: 200, likes: 20, comments: 4, shares: 2 },
            { date: dateStr(6), views: 200, likes: 20, comments: 4, shares: 2 },
            { date: dateStr(5), views: 200, likes: 20, comments: 4, shares: 2 },
            { date: dateStr(4), views: 200, likes: 20, comments: 4, shares: 2 },
            { date: dateStr(3), views: 200, likes: 20, comments: 4, shares: 2 },
            { date: dateStr(2), views: 200, likes: 20, comments: 4, shares: 2 },
            { date: dateStr(1), views: 200, likes: 20, comments: 4, shares: 2 },
          ],
        },
      ],
    },
  };

  const db = new Dashboard(makeVideos(), growingData);
  const s = db.getDashboardSummary();
  assert.equal(s.trend, "up", "Growing views should produce 'up' trend");
});

// =====================================================================
// 29. getDashboardSummary trend with declining data
// =====================================================================
test("getDashboardSummary trend with declining data", () => {
  const today = new Date();
  function dateStr(daysAgo) {
    const d = new Date(today);
    d.setDate(d.getDate() - daysAgo);
    return d.toISOString().substring(0, 10);
  }

  const decliningData = {
    youtube: {
      views: 10000,
      engagement_rate: 0.1,
      revenue: 100,
      videos: [
        {
          video_id: "v1", views: 10000, likes: 500, comments: 100, shares: 50, revenue: 100,
          daily: [
            // Previous 7 days: 200 views each = 1400
            { date: dateStr(14), views: 200, likes: 20, comments: 4, shares: 2 },
            { date: dateStr(13), views: 200, likes: 20, comments: 4, shares: 2 },
            { date: dateStr(12), views: 200, likes: 20, comments: 4, shares: 2 },
            { date: dateStr(11), views: 200, likes: 20, comments: 4, shares: 2 },
            { date: dateStr(10), views: 200, likes: 20, comments: 4, shares: 2 },
            { date: dateStr(9), views: 200, likes: 20, comments: 4, shares: 2 },
            { date: dateStr(8), views: 200, likes: 20, comments: 4, shares: 2 },
            // Recent 7 days: 50 views each = 350 → 75% decrease
            { date: dateStr(7), views: 50, likes: 5, comments: 1, shares: 0 },
            { date: dateStr(6), views: 50, likes: 5, comments: 1, shares: 0 },
            { date: dateStr(5), views: 50, likes: 5, comments: 1, shares: 0 },
            { date: dateStr(4), views: 50, likes: 5, comments: 1, shares: 0 },
            { date: dateStr(3), views: 50, likes: 5, comments: 1, shares: 0 },
            { date: dateStr(2), views: 50, likes: 5, comments: 1, shares: 0 },
            { date: dateStr(1), views: 50, likes: 5, comments: 1, shares: 0 },
          ],
        },
      ],
    },
  };

  const db = new Dashboard(makeVideos(), decliningData);
  const s = db.getDashboardSummary();
  assert.equal(s.trend, "down", "Declining views should produce 'down' trend");
});

// =====================================================================
// 30. getPlatformComparison each entry has required fields
// =====================================================================
test("getPlatformComparison each entry has required fields", () => {
  const db = new Dashboard(makeVideos(), makePlatformData());
  const result = db.getPlatformComparison();

  for (const entry of result) {
    assert.ok(typeof entry.platform === "string");
    assert.ok(typeof entry.views === "number");
    assert.ok(typeof entry.engagement_rate === "number");
    assert.ok(typeof entry.revenue === "number");
  }
});
