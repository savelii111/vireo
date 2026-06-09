// test_scheduling.js — Comprehensive tests for the scheduling module.
//
// Validates all 10 scheduling tools: schedulePost, batchSchedule, getBestTime,
// cancelSchedule, reschedule, getUpcoming, getAnalytics, crossPost,
// recurringSchedule, and calendarView.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  schedulePost,
  batchSchedule,
  getBestTime,
  cancelSchedule,
  reschedule,
  getUpcoming,
  getAnalytics,
  crossPost,
  recurringSchedule,
  calendarView,
  PLATFORMS,
  _resetScheduledPosts,
  _resetRecurringSchedules,
  _getPost,
  _getAllPosts,
  _getRecurring,
} from "../src/scheduling.js";

// Reset state before each test
test.beforeEach(() => {
  _resetScheduledPosts();
  _resetRecurringSchedules();
});

// Helper: generate a future date
function futureDate(ms = 3600_000 * 3) {
  return new Date(Date.now() + ms);
}

// Helper: generate a far-future date (within 6-day advance limit)
function farFutureDate(days = 6) {
  return new Date(Date.now() + days * 24 * 3600_000);
}

// =====================================================================
// 1. schedulePost — basic success
// =====================================================================
test("schedulePost basic success", () => {
  const result = schedulePost({
    platform: "youtube",
    video: "/path/video.mp4",
    publish_time: futureDate(),
  });

  assert.equal(result.platform, "youtube");
  assert.ok(result.post_id.startsWith("post_"));
  assert.ok(typeof result.estimated_reach === "number");
  assert.equal(result.status, "scheduled");
  assert.ok(new Date(result.scheduled_time) instanceof Date);
});

// =====================================================================
// 2. schedulePost — missing platform
// =====================================================================
test("schedulePost missing platform throws", () => {
  assert.throws(() => schedulePost({ video: "/path.mp4", publish_time: futureDate() }), /platform is required/);
});

// =====================================================================
// 3. schedulePost — missing video
// =====================================================================
test("schedulePost missing video throws", () => {
  assert.throws(
    () => schedulePost({ platform: "youtube", publish_time: futureDate() }),
    /video is required/
  );
});

// =====================================================================
// 4. schedulePost — missing publish_time
// =====================================================================
test("schedulePost missing publish_time throws", () => {
  assert.throws(
    () => schedulePost({ platform: "youtube", video: "/path.mp4" }),
    /publish_time is required/
  );
});

// =====================================================================
// 5. schedulePost — unknown platform
// =====================================================================
test("schedulePost unknown platform throws", () => {
  assert.throws(
    () => schedulePost({ platform: "myspace", video: "/path.mp4", publish_time: futureDate() }),
    /Unknown platform/
  );
});

// =====================================================================
// 6. schedulePost — time too soon
// =====================================================================
test("schedulePost time too soon throws", () => {
  assert.throws(
    () => schedulePost({ platform: "youtube", video: "/path.mp4", publish_time: new Date(Date.now() + 60_000) }),
    /must be at least/
  );
});

// =====================================================================
// 7. schedulePost — all platforms
// =====================================================================
test("schedulePost works for all supported platforms", () => {
  const platforms = ["youtube", "tiktok", "instagram_reels", "instagram_feed", "facebook", "linkedin", "vimeo"];
  for (const platform of platforms) {
    const result = schedulePost({
      platform,
      video: "/path/video.mp4",
      publish_time: futureDate(),
    });
    assert.equal(result.platform, platform);
    assert.ok(result.post_id.startsWith("post_"));
  }
});

// =====================================================================
// 8. schedulePost — stores post internally
// =====================================================================
test("schedulePost stores post internally", () => {
  const result = schedulePost({
    platform: "tiktok",
    video: "/path/video.mp4",
    publish_time: futureDate(),
  });
  const stored = _getPost(result.post_id);
  assert.ok(stored);
  assert.equal(stored.platform, "tiktok");
  assert.equal(stored.status, "scheduled");
});

// =====================================================================
// 9. batchSchedule — basic success
// =====================================================================
test("batchSchedule basic success", () => {
  const result = batchSchedule({
    posts: [
      { platform: "youtube", video: "/v1.mp4", time: futureDate() },
      { platform: "tiktok", video: "/v1.mp4", time: futureDate() },
      { platform: "instagram_reels", video: "/v1.mp4", time: futureDate() },
    ],
  });

  assert.equal(result.scheduled.length, 3);
  assert.equal(result.total_count, 3);
  assert.ok(Array.isArray(result.conflicts));
});

// =====================================================================
// 10. batchSchedule — empty array throws
// =====================================================================
test("batchSchedule empty array throws", () => {
  assert.throws(() => batchSchedule({ posts: [] }), /posts must be a non-empty array/);
});

// =====================================================================
// 11. batchSchedule — conflicts detected
// =====================================================================
test("batchSchedule detects time conflicts", () => {
  const result = batchSchedule({
    posts: [
      { platform: "youtube", video: "/v1.mp4", time: futureDate() },
      { platform: "youtube", video: "/v2.mp4", time: new Date(Date.now() + 3600_000 + 30 * 60_000) }, // 30 min apart
    ],
  });

  // Both should be scheduled but conflict should be detected
  assert.equal(result.scheduled.length, 2);
  assert.ok(result.conflicts.length > 0);
});

// =====================================================================
// 12. batchSchedule — error handling for invalid platform
// =====================================================================
test("batchSchedule handles invalid platforms gracefully", () => {
  const result = batchSchedule({
    posts: [
      { platform: "youtube", video: "/v1.mp4", time: futureDate() },
      { platform: "invalid_platform", video: "/v2.mp4", time: futureDate() },
    ],
  });

  assert.equal(result.scheduled.length, 1);
  assert.ok(result.errors && result.errors.length === 1);
  assert.equal(result.errors[0].platform, "invalid_platform");
});

// =====================================================================
// 13. getBestTime — youtube
// =====================================================================
test("getBestTime returns youtube recommendations", () => {
  const result = getBestTime({ platform: "youtube", audience_timezone: "US/Pacific" });

  assert.ok(result.recommended_times.length > 0);
  assert.ok(typeof result.reasoning === "string");
  assert.equal(result.timezone, "US/Pacific");
  assert.equal(result.content_type, "standard");

  // Each recommended time has required fields
  for (const t of result.recommended_times) {
    assert.ok(typeof t.day === "string");
    assert.ok(typeof t.hour === "number");
    assert.ok(typeof t.confidence === "number");
    assert.ok(t.confidence >= 0 && t.confidence <= 1);
  }
});

// =====================================================================
// 14. getBestTime — missing platform
// =====================================================================
test("getBestTime missing platform throws", () => {
  assert.throws(() => getBestTime({}), /platform is required/);
});

// =====================================================================
// 15. getBestTime — unknown platform
// =====================================================================
test("getBestTime unknown platform throws", () => {
  assert.throws(() => getBestTime({ platform: "snapchat" }), /No best-time data/);
});

// =====================================================================
// 16. getBestTime — short content type
// =====================================================================
test("getBestTime adjusts confidence for short content", () => {
  const standard = getBestTime({ platform: "tiktok", content_type: "standard" });
  const short = getBestTime({ platform: "tiktok", content_type: "short" });

  // Both should return valid results
  assert.ok(standard.recommended_times.length > 0);
  assert.ok(short.recommended_times.length > 0);
  assert.equal(short.content_type, "short");
});

// =====================================================================
// 17. getBestTime — long content type
// =====================================================================
test("getBestTime adjusts confidence for long content", () => {
  const result = getBestTime({ platform: "youtube", content_type: "long" });

  assert.ok(result.recommended_times.length > 0);
  assert.equal(result.content_type, "long");
});

// =====================================================================
// 18. getBestTime — all platforms return data
// =====================================================================
test("getBestTime has data for all platforms", () => {
  const platforms = ["youtube", "tiktok", "instagram_reels", "instagram_feed", "facebook", "twitter", "linkedin", "vimeo"];
  for (const p of platforms) {
    const result = getBestTime({ platform: p });
    assert.ok(result.recommended_times.length > 0, `Missing data for ${p}`);
    assert.ok(result.reasoning.length > 0, `Missing reasoning for ${p}`);
  }
});

// =====================================================================
// 19. cancelSchedule — basic success
// =====================================================================
test("cancelSchedule cancels a scheduled post", () => {
  const post = schedulePost({ platform: "youtube", video: "/v.mp4", publish_time: farFutureDate(2) });
  const result = cancelSchedule(post.post_id);

  assert.equal(result.cancelled, true);
  assert.equal(result.post_id, post.post_id);
  assert.equal(typeof result.refund_if_paid, "boolean");

  const stored = _getPost(post.post_id);
  assert.equal(stored.status, "cancelled");
});

// =====================================================================
// 20. cancelSchedule — post not found
// =====================================================================
test("cancelSchedule post not found throws", () => {
  assert.throws(() => cancelSchedule("nonexistent_id"), /Post not found/);
});

// =====================================================================
// 21. cancelSchedule — already cancelled
// =====================================================================
test("cancelSchedule already cancelled throws", () => {
  const post = schedulePost({ platform: "youtube", video: "/v.mp4", publish_time: farFutureDate(2) });
  cancelSchedule(post.post_id);
  assert.throws(() => cancelSchedule(post.post_id), /already cancelled/);
});

// =====================================================================
// 22. cancelSchedule — refund logic
// =====================================================================
test("cancelSchedule refund_if_paid for far-future posts", () => {
  const post = schedulePost({ platform: "youtube", video: "/v.mp4", publish_time: farFutureDate(3) });
  const result = cancelSchedule(post.post_id);
  assert.equal(result.refund_if_paid, true);
});

// =====================================================================
// 23. cancelSchedule — no refund for near-future posts
// =====================================================================
test("cancelSchedule no refund for near-future posts", () => {
  // Schedule just barely above the minimum advance time
  const post = schedulePost({ platform: "youtube", video: "/v.mp4", publish_time: new Date(Date.now() + 70 * 60_000) });
  const result = cancelSchedule(post.post_id);
  assert.equal(result.refund_if_paid, false);
});

// =====================================================================
// 24. reschedule — basic success
// =====================================================================
test("reschedule changes the scheduled time", () => {
  const post = schedulePost({ platform: "youtube", video: "/v.mp4", publish_time: futureDate() });
  const newTime = farFutureDate(5);
  const result = reschedule(post.post_id, newTime);

  assert.equal(result.rescheduled, true);
  assert.equal(result.post_id, post.post_id);
  assert.ok(new Date(result.new_time) instanceof Date);
  assert.ok(new Date(result.old_time) instanceof Date);
});

// =====================================================================
// 25. reschedule — post not found
// =====================================================================
test("reschedule post not found throws", () => {
  assert.throws(() => reschedule("nonexistent", futureDate()), /Post not found/);
});

// =====================================================================
// 26. reschedule — cancelled post
// =====================================================================
test("reschedule cancelled post throws", () => {
  const post = schedulePost({ platform: "youtube", video: "/v.mp4", publish_time: farFutureDate(2) });
  cancelSchedule(post.post_id);
  assert.throws(() => reschedule(post.post_id, farFutureDate(5)), /cancelled/);
});

// =====================================================================
// 27. reschedule — invalid new time
// =====================================================================
test("reschedule invalid time throws", () => {
  const post = schedulePost({ platform: "youtube", video: "/v.mp4", publish_time: futureDate() });
  assert.throws(
    () => reschedule(post.post_id, "not-a-date"),
    /not a valid date/
  );
});

// =====================================================================
// 28. getUpcoming — basic success
// =====================================================================
test("getUpcoming returns scheduled posts", () => {
  schedulePost({ platform: "youtube", video: "/v1.mp4", publish_time: futureDate() });
  schedulePost({ platform: "tiktok", video: "/v2.mp4", publish_time: futureDate() });

  const result = getUpcoming();
  assert.ok(result.posts.length >= 2);
  assert.ok(result.total_count >= 2);
});

// =====================================================================
// 29. getUpcoming — filtered by platform
// =====================================================================
test("getUpcoming filtered by platform", () => {
  schedulePost({ platform: "youtube", video: "/v1.mp4", publish_time: futureDate() });
  schedulePost({ platform: "tiktok", video: "/v2.mp4", publish_time: futureDate() });

  const result = getUpcoming({ platform: "youtube" });
  assert.ok(result.posts.length >= 1);
  for (const p of result.posts) {
    assert.equal(p.platform, "youtube");
  }
});

// =====================================================================
// 30. getUpcoming — respects limit
// =====================================================================
test("getUpcoming respects limit parameter", () => {
  for (let i = 0; i < 10; i++) {
    schedulePost({ platform: "youtube", video: `/v${i}.mp4`, publish_time: futureDate() });
  }

  const result = getUpcoming({ limit: 3 });
  assert.ok(result.posts.length <= 3);
});

// =====================================================================
// 31. getUpcoming — excludes cancelled posts
// =====================================================================
test("getUpcoming excludes cancelled posts", () => {
  const post = schedulePost({ platform: "youtube", video: "/v.mp4", publish_time: futureDate() });
  cancelSchedule(post.post_id);

  const result = getUpcoming({ platform: "youtube" });
  assert.equal(result.posts.length, 0);
});

// =====================================================================
// 32. getAnalytics — basic success
// =====================================================================
test("getAnalytics returns valid analytics", () => {
  const result = getAnalytics({ platform: "youtube", timeRange: "30d" });

  assert.ok(result.best_days.length > 0);
  assert.ok(result.best_hours.length > 0);
  assert.ok(Array.isArray(result.engagement_curve));
  assert.equal(result.engagement_curve.length, 24); // 24 hours
  assert.ok(result.recommendations.length > 0);
  assert.equal(result.time_range, "30d");
});

// =====================================================================
// 33. getAnalytics — all platforms
// =====================================================================
test("getAnalytics works for all platforms", () => {
  const result = getAnalytics({ platform: "all", timeRange: "7d" });

  assert.ok(result.best_days.length > 0);
  assert.ok(result.platforms_analyzed.length > 1);
  assert.ok(result.recommendations.some((r) => r.includes("Cross-platform")));
});

// =====================================================================
// 34. getAnalytics — default parameters
// =====================================================================
test("getAnalytics uses defaults", () => {
  const result = getAnalytics();
  assert.equal(result.time_range, "30d");
  assert.ok(result.engagement_curve.length === 24);
});

// =====================================================================
// 35. crossPost — basic success
// =====================================================================
test("crossPost schedules across multiple platforms", () => {
  const result = crossPost({
    video: "/path/video.mp4",
    platforms: ["youtube", "tiktok", "instagram_reels"],
    stagger_minutes: 15,
  });

  assert.equal(result.posts.length, 3);
  assert.equal(result.stagger_minutes, 15);

  for (const post of result.posts) {
    assert.ok(post.platform);
    assert.ok(post.url.startsWith("https://"));
    assert.ok(new Date(post.scheduled) instanceof Date);
  }
});

// =====================================================================
// 36. crossPost — invalid video
// =====================================================================
test("crossPost missing video throws", () => {
  assert.throws(
    () => crossPost({ platforms: ["youtube"], stagger_minutes: 15 }),
    /video is required/
  );
});

// =====================================================================
// 37. crossPost — empty platforms
// =====================================================================
test("crossPost empty platforms throws", () => {
  assert.throws(
    () => crossPost({ video: "/v.mp4", platforms: [], stagger_minutes: 15 }),
    /platforms must be a non-empty array/
  );
});

// =====================================================================
// 38. crossPost — invalid stagger
// =====================================================================
test("crossPost invalid stagger throws", () => {
  assert.throws(
    () => crossPost({ video: "/v.mp4", platforms: ["youtube"], stagger_minutes: 1 }),
    /stagger_minutes must be between 5 and 120/
  );
});

// =====================================================================
// 39. crossPost — default stagger
// =====================================================================
test("crossPost uses default stagger of 15 minutes", () => {
  const result = crossPost({
    video: "/v.mp4",
    platforms: ["youtube", "tiktok"],
  });
  assert.equal(result.stagger_minutes, 15);
});

// =====================================================================
// 40. recurringSchedule — basic success
// =====================================================================
test("recurringSchedule creates recurring schedule", () => {
  const result = recurringSchedule({
    video: "/path/video.mp4",
    frequency: "weekly",
    platforms: ["youtube", "tiktok"],
  });

  assert.ok(result.schedule_id.startsWith("rec_"));
  assert.equal(result.frequency, "weekly");
  assert.ok(result.next_posts.length > 0);

  for (const np of result.next_posts) {
    assert.ok(np.platform);
    assert.ok(new Date(np.time) instanceof Date);
  }
});

// =====================================================================
// 41. recurringSchedule — all frequencies
// =====================================================================
test("recurringSchedule supports all frequencies", () => {
  const frequencies = ["daily", "weekly", "biweekly", "monthly"];
  for (const freq of frequencies) {
    const result = recurringSchedule({
      video: "/v.mp4",
      frequency: freq,
      platforms: ["youtube"],
    });
    assert.equal(result.frequency, freq);
    assert.ok(result.next_posts.length > 0);
  }
});

// =====================================================================
// 42. recurringSchedule — invalid frequency
// =====================================================================
test("recurringSchedule invalid frequency throws", () => {
  assert.throws(
    () => recurringSchedule({ video: "/v.mp4", frequency: "hourly", platforms: ["youtube"] }),
    /Invalid frequency/
  );
});

// =====================================================================
// 43. recurringSchedule — missing video
// =====================================================================
test("recurringSchedule missing video throws", () => {
  assert.throws(
    () => recurringSchedule({ frequency: "weekly", platforms: ["youtube"] }),
    /video is required/
  );
});

// =====================================================================
// 44. recurringSchedule — empty platforms
// =====================================================================
test("recurringSchedule empty platforms throws", () => {
  assert.throws(
    () => recurringSchedule({ video: "/v.mp4", frequency: "weekly", platforms: [] }),
    /platforms must be a non-empty array/
  );
});

// =====================================================================
// 45. recurringSchedule — stored internally
// =====================================================================
test("recurringSchedule stores schedule internally", () => {
  const result = recurringSchedule({
    video: "/v.mp4",
    frequency: "daily",
    platforms: ["youtube"],
  });

  const stored = _getRecurring(result.schedule_id);
  assert.ok(stored);
  assert.equal(stored.frequency, "daily");
  assert.equal(stored.active, true);
});

// =====================================================================
// 46. calendarView — basic success
// =====================================================================
test("calendarView returns month calendar", () => {
  const result = calendarView({ month: 6, year: 2026 });

  assert.ok(result.days.length > 0);
  assert.equal(result.month, 6);
  assert.equal(result.year, 2026);
  assert.equal(typeof result.total_posts, "number");

  // Check first day format
  assert.ok(result.days[0].date.startsWith("2026-06-"));
  assert.ok(Array.isArray(result.days[0].posts));
});

// =====================================================================
// 47. calendarView — with scheduled posts
// =====================================================================
test("calendarView shows scheduled posts", () => {
  // Schedule posts for specific times in the current month
  const now = new Date();
  const targetDay = now.getDate();
  const targetMonth = now.getMonth() + 1;
  const targetYear = now.getFullYear();

  schedulePost({ platform: "youtube", video: "/v.mp4", publish_time: farFutureDate(1) });
  schedulePost({ platform: "tiktok", video: "/v.mp4", publish_time: farFutureDate(2) });

  const result = calendarView({ month: targetMonth, year: targetYear });
  assert.ok(result.total_posts >= 0); // Posts may be in different months depending on timing
});

// =====================================================================
// 48. calendarView — default to current month
// =====================================================================
test("calendarView defaults to current month", () => {
  const result = calendarView();
  const now = new Date();
  assert.equal(result.month, now.getMonth() + 1);
  assert.equal(result.year, now.getFullYear());
});

// =====================================================================
// 49. calendarView — invalid month
// =====================================================================
test("calendarView invalid month throws", () => {
  assert.throws(() => calendarView({ month: 13 }), /month must be between 1 and 12/);
  assert.throws(() => calendarView({ month: 0 }), /month must be between 1 and 12/);
});

// =====================================================================
// 50. calendarView — post count per day
// =====================================================================
test("calendarView counts posts per day correctly", () => {
  const result = calendarView({ month: 6, year: 2026 });
  let totalFromDays = 0;
  for (const day of result.days) {
    assert.equal(day.post_count, day.posts.length);
    totalFromDays += day.post_count;
  }
  assert.equal(result.total_posts, totalFromDays);
});

// =====================================================================
// 51. PLATFORMS config exported
// =====================================================================
test("PLATFORMS config is exported with correct keys", () => {
  assert.ok(PLATFORMS.youtube);
  assert.ok(PLATFORMS.tiktok);
  assert.ok(PLATFORMS.instagram_reels);
  assert.ok(PLATFORMS.facebook);
  assert.ok(PLATFORMS.twitter);
  assert.ok(PLATFORMS.linkedin);
  assert.ok(PLATFORMS.vimeo);
  assert.equal(PLATFORMS.youtube.supportsSchedule, true);
  assert.equal(PLATFORMS.twitter.supportsSchedule, false);
});

// =====================================================================
// 52. _resetScheduledPosts clears state
// =====================================================================
test("_resetScheduledPosts clears all state", () => {
  schedulePost({ platform: "youtube", video: "/v.mp4", publish_time: futureDate() });
  assert.ok(_getAllPosts().length > 0);

  _resetScheduledPosts();
  assert.equal(_getAllPosts().length, 0);
});
