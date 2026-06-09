// test_distribution.js — Comprehensive tests for the distribution module.
//
// Validates all 10 distribution tools, platform configs, content validation,
// SEO generation, publish workflows, job management, and edge cases.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PLATFORMS,
  validateForPlatform,
  generateSEO,
  publish,
  getPublishStatus,
  listPublished,
  publishYouTube,
  publishTikTok,
  publishInstagramReels,
  publishInstagramStories,
  publishInstagramFeed,
  publishFacebook,
  publishTwitter,
  publishLinkedIn,
  publishAll,
  _resetJobs,
  _getJob,
} from "../src/distribution.js";

// Reset job store before each test
test.beforeEach(() => {
  _resetJobs();
});

// Helper: generate a future date string
function futureDate(ms = 3600_000) {
  return new Date(Date.now() + ms).toISOString();
}

// =====================================================================
// 1. publishYouTube — returns all required fields
// =====================================================================
test("publishYouTube returns all required fields", () => {
  const result = publishYouTube({
    video: "./test.mp4",
    title: "My YouTube Video",
    description: "A great video about coding",
    tags: "tutorial, coding, javascript",
    privacy: "public",
  });
  assert.ok(result.url.startsWith("https://youtube.com/watch?v="));
  assert.ok(result.video_id);
  assert.ok(result.channel_id.startsWith("UC"));
  assert.ok(result.scheduled_time);
  assert.equal(result.privacy, "public");
});

// =====================================================================
// 2. publishYouTube — throws without video
// =====================================================================
test("publishYouTube throws without video", () => {
  assert.throws(() => publishYouTube({ title: "Title" }), /video is required/);
});

// =====================================================================
// 3. publishYouTube — throws without title
// =====================================================================
test("publishYouTube throws without title", () => {
  assert.throws(() => publishYouTube({ video: "./test.mp4" }), /title is required/);
});

// =====================================================================
// 4. publishYouTube — validates privacy enum
// =====================================================================
test("publishYouTube validates privacy enum", () => {
  assert.throws(
    () => publishYouTube({ video: "./v.mp4", title: "T", privacy: "secret" }),
    /privacy must be/
  );
});

// =====================================================================
// 5. publishYouTube — unlisted privacy
// =====================================================================
test("publishYouTube supports unlisted privacy", () => {
  const r = publishYouTube({ video: "./v.mp4", title: "T", privacy: "unlisted" });
  assert.equal(r.privacy, "unlisted");
});

// =====================================================================
// 6. publishTikTok — returns all required fields
// =====================================================================
test("publishTikTok returns all required fields", () => {
  const result = publishTikTok({
    video: "./dance.mp4",
    caption: "Check this out!",
    hashtags: ["dance", "viral", "trending"],
    music: "original sound - DJ Mix",
  });
  assert.ok(result.url.startsWith("https://tiktok.com/@user/video/"));
  assert.ok(result.video_id);
  assert.equal(result.music_used, "original sound - DJ Mix");
  assert.equal(result.hashtags_count, 3);
});

// =====================================================================
// 7. publishTikTok — throws without video
// =====================================================================
test("publishTikTok throws without video", () => {
  assert.throws(() => publishTikTok({ caption: "Hi" }), /video is required/);
});

// =====================================================================
// 8. publishTikTok — default music is original sound
// =====================================================================
test("publishTikTok defaults music to original sound", () => {
  const r = publishTikTok({ video: "./v.mp4" });
  assert.equal(r.music_used, "original sound");
});

// =====================================================================
// 9. publishInstagramReels — returns all required fields
// =====================================================================
test("publishInstagramReels returns all required fields", () => {
  const result = publishInstagramReels({
    video: "./reel.mp4",
    caption: "Amazing reel!",
    hashtags: ["reels", "fun", "creative"],
    location: "New York, NY",
  });
  assert.ok(result.url.startsWith("https://instagram.com/reel/"));
  assert.ok(result.post_id);
  assert.equal(result.hashtags_count, 3);
  assert.equal(result.location, "New York, NY");
});

// =====================================================================
// 10. publishInstagramReels — throws without video
// =====================================================================
test("publishInstagramReels throws without video", () => {
  assert.throws(() => publishInstagramReels({ caption: "Hi" }), /video is required/);
});

// =====================================================================
// 11. publishInstagramStories — returns all required fields
// =====================================================================
test("publishInstagramStories returns all required fields", () => {
  const result = publishInstagramStories({
    video: "./story.mp4",
    duration_sec: 30,
    stickers: ["emoji", "poll", "question"],
  });
  assert.ok(result.url.startsWith("https://instagram.com/stories/"));
  assert.ok(result.story_id);
  assert.equal(result.duration_sec, 30);
  assert.equal(result.sticker_count, 3);
});

// =====================================================================
// 12. publishInstagramStories — throws without video
// =====================================================================
test("publishInstagramStories throws without video", () => {
  assert.throws(() => publishInstagramStories(), /video is required/);
});

// =====================================================================
// 13. publishInstagramStories — clamps duration > 60
// =====================================================================
test("publishInstagramStories clamps duration to 60 max", () => {
  const r = publishInstagramStories({ video: "./v.mp4", duration_sec: 120 });
  assert.equal(r.duration_sec, 60);
});

// =====================================================================
// 15. publishInstagramFeed — returns all required fields
// =====================================================================
test("publishInstagramFeed returns all required fields", () => {
  const result = publishInstagramFeed({
    video: "./feed.mp4",
    caption: "Feed post",
    hashtags: ["feed", "photo"],
    location: "Paris, France",
  });
  assert.ok(result.url.startsWith("https://instagram.com/p/"));
  assert.ok(result.post_id);
  assert.equal(result.aspect_ratio, "1:1");
  assert.equal(result.hashtags_count, 2);
});

// =====================================================================
// 16. publishInstagramFeed — detects portrait aspect ratio
// =====================================================================
test("publishInstagramFeed detects portrait aspect ratio", () => {
  const r = publishInstagramFeed({ video: "portrait_video.mp4" });
  assert.equal(r.aspect_ratio, "4:5");
});

// =====================================================================
// 17. publishInstagramFeed — detects landscape aspect ratio
// =====================================================================
test("publishInstagramFeed detects landscape aspect ratio", () => {
  const r = publishInstagramFeed({ video: "landscape_wide.mp4" });
  assert.equal(r.aspect_ratio, "16:9");
});

// =====================================================================
// 18. publishFacebook — returns all required fields
// =====================================================================
test("publishFacebook returns all required fields", () => {
  const result = publishFacebook({
    video: "./fb_video.mp4",
    description: "Facebook video post",
    privacy: "public",
    group_id: "group123",
  });
  assert.ok(result.url.startsWith("https://facebook.com/watch/?v="));
  assert.ok(result.post_id);
  assert.equal(result.group_id, "group123");
  assert.equal(result.privacy, "public");
});

// =====================================================================
// 19. publishFacebook — throws without video
// =====================================================================
test("publishFacebook throws without video", () => {
  assert.throws(() => publishFacebook(), /video is required/);
});

// =====================================================================
// 20. publishFacebook — validates privacy enum
// =====================================================================
test("publishFacebook validates privacy enum", () => {
  assert.throws(
    () => publishFacebook({ video: "./v.mp4", privacy: "custom" }),
    /privacy must be/
  );
});

// =====================================================================
// 21. publishTwitter — returns all required fields
// =====================================================================
test("publishTwitter returns all required fields", () => {
  const result = publishTwitter({
    video: "./tweet.mp4",
    text: "Check out this video!",
    hashtags: ["viral", "trending"],
    thread: false,
  });
  assert.ok(result.url.startsWith("https://x.com/user/status/"));
  assert.ok(result.tweet_id);
  assert.equal(result.thread_count, 1);
  assert.deepEqual(result.hashtags, ["viral", "trending"]);
});

// =====================================================================
// 22. publishTwitter — throws without video
// =====================================================================
test("publishTwitter throws without video", () => {
  assert.throws(() => publishTwitter({ text: "Hello" }), /video is required/);
});

// =====================================================================
// 23. publishTwitter — throws if text > 280 chars
// =====================================================================
test("publishTwitter throws if text exceeds 280 characters", () => {
  assert.throws(
    () => publishTwitter({ video: "./v.mp4", text: "x".repeat(281) }),
    /cannot exceed 280/
  );
});

// =====================================================================
// 24. publishTwitter — thread mode splits into multiple tweets
// =====================================================================
test("publishTwitter thread mode splits into multiple tweets", () => {
  const r = publishTwitter({
    video: "./v.mp4",
    text: "A".repeat(400),
    thread: true,
  });
  assert.ok(r.thread_count >= 2);
});

// =====================================================================
// 25. publishLinkedIn — returns all required fields
// =====================================================================
test("publishLinkedIn returns all required fields", () => {
  const result = publishLinkedIn({
    video: "./linkedin_vid.mp4",
    title: "Professional Insight",
    description: "A deep dive into industry trends",
    visibility: "public",
  });
  assert.ok(result.url.startsWith("https://linkedin.com/feed/update/urn:li:activity:"));
  assert.ok(result.post_id);
  assert.equal(result.visibility, "public");
  assert.ok(result.impressions_estimate > 0);
});

// =====================================================================
// 26. publishLinkedIn — throws without video
// =====================================================================
test("publishLinkedIn throws without video", () => {
  assert.throws(() => publishLinkedIn({ title: "T" }), /video is required/);
});

// =====================================================================
// 27. publishLinkedIn — validates visibility enum
// =====================================================================
test("publishLinkedIn validates visibility enum", () => {
  assert.throws(
    () => publishLinkedIn({ video: "./v.mp4", visibility: "worldwide" }),
    /visibility must be/
  );
});

// =====================================================================
// 28. publishLinkedIn — higher impressions for public
// =====================================================================
test("publishLinkedIn public visibility has higher impressions", () => {
  const pub = publishLinkedIn({ video: "./v.mp4", title: "T", description: "D", visibility: "public" });
  const priv = publishLinkedIn({ video: "./v.mp4", title: "T", description: "D", visibility: "private" });
  assert.ok(pub.impressions_estimate > priv.impressions_estimate);
});

// =====================================================================
// 29. publishAll — publishes to all platforms
// =====================================================================
test("publishAll publishes to all platforms", () => {
  const result = publishAll({ video: "./video.mp4", config: {} });
  assert.ok(Array.isArray(result.results));
  assert.ok(result.results.length >= 8);
  assert.ok(result.total_published >= 8);
  assert.equal(result.failures, 0);
});

// =====================================================================
// 30. publishAll — throws without video
// =====================================================================
test("publishAll throws without video", () => {
  assert.throws(() => publishAll({}), /video is required/);
});

// =====================================================================
// 31. publishAll — all results have success flag
// =====================================================================
test("publishAll all results have success flag", () => {
  const result = publishAll({ video: "./v.mp4" });
  for (const r of result.results) {
    assert.equal(r.success, true);
    assert.ok(r.url);
    assert.ok(r.platform);
  }
});

// =====================================================================
// 32. publishAll — passes config per platform
// =====================================================================
test("publishAll passes config per platform", () => {
  const result = publishAll({
    video: "./v.mp4",
    config: {
      youtube: { title: "Custom YT Title", privacy: "unlisted" },
      tiktok: { caption: "TikTok caption", music: "Song X" },
    },
  });
  const yt = result.results.find((r) => r.platform === "youtube");
  assert.ok(yt);
  assert.equal(yt.success, true);
  const tt = result.results.find((r) => r.platform === "tiktok");
  assert.ok(tt);
  assert.equal(tt.success, true);
});

// =====================================================================
// 33. generateSEO — returns all required fields
// =====================================================================
test("generateSEO returns all required fields", () => {
  const seo = generateSEO({
    title: "My Video",
    description: "Great content here",
    tags: "video, tutorial",
  });
  assert.ok(seo.optimized_title);
  assert.ok(seo.optimized_description);
  assert.ok(Array.isArray(seo.suggested_tags));
  assert.equal(typeof seo.score, "number");
  assert.ok(seo.score >= 0 && seo.score <= 100);
});

// =====================================================================
// 34. generateSEO — optimized title shorter than 100
// =====================================================================
test("generateSEO optimized title shorter than 100", () => {
  const seo = generateSEO({
    title: "A".repeat(200),
    description: "Desc",
  });
  assert.ok(seo.optimized_title.length <= 100);
});

// =====================================================================
// 35. generateSEO — handles empty input
// =====================================================================
test("generateSEO handles empty input", () => {
  const seo = generateSEO({});
  assert.equal(seo.optimized_title, "Untitled Video");
  assert.equal(seo.optimized_description, "Untitled Video");
  assert.ok(Array.isArray(seo.suggested_tags));
  assert.equal(typeof seo.score, "number");
});

// =====================================================================
// 36. generateSEO — long title gets truncated with ellipsis
// =====================================================================
test("generateSEO long title gets truncated with ellipsis", () => {
  const seo = generateSEO({
    title: "A".repeat(150),
    description: "Desc",
  });
  assert.ok(seo.optimized_title.endsWith("..."));
  assert.ok(seo.optimized_title.length <= 100);
});

// =====================================================================
// 37. generateSEO — long description gets truncated
// =====================================================================
test("generateSEO long description gets truncated", () => {
  const seo = generateSEO({
    title: "Title",
    description: "D".repeat(6000),
  });
  assert.ok(seo.optimized_description.endsWith("..."));
  assert.ok(seo.optimized_description.length <= 5000);
});

// =====================================================================
// 38. generateSEO — includes evergreen tags
// =====================================================================
test("generateSEO includes evergreen tags", () => {
  const seo = generateSEO({ title: "T", description: "D" });
  assert.ok(seo.suggested_tags.includes("video"));
  assert.ok(seo.suggested_tags.includes("content"));
  assert.ok(seo.suggested_tags.includes("creator"));
});

// =====================================================================
// 39. generateSEO — score is higher with more tags
// =====================================================================
test("generateSEO score is higher with more tags", () => {
  const low = generateSEO({ title: "T", description: "D", tags: "" });
  const high = generateSEO({ title: "T", description: "D", tags: "a,b,c,d,e,f,g,h" });
  assert.ok(high.score > low.score);
});

// =====================================================================
// 40. validateForPlatform — YouTube valid
// =====================================================================
test("validateForPlatform YouTube valid", () => {
  const result = validateForPlatform("youtube", {
    title: "My Great Video",
    description: "This is a detailed description of the video.",
    tags: "video, tutorial, coding",
  });
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

// =====================================================================
// 41. validateForPlatform — YouTube title too long
// =====================================================================
test("validateForPlatform YouTube title too long", () => {
  const result = validateForPlatform("youtube", {
    title: "A".repeat(101),
    description: "Short description",
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("Title exceeds 100")));
});

// =====================================================================
// 42. validateForPlatform — TikTok valid
// =====================================================================
test("validateForPlatform TikTok valid", () => {
  const result = validateForPlatform("tiktok", {
    title: "Fun video!",
    description: "Check out this amazing content",
  });
  assert.equal(result.valid, true);
});

// =====================================================================
// 43. validateForPlatform — Instagram hashtags limit
// =====================================================================
test("validateForPlatform Instagram hashtags limit", () => {
  const result = validateForPlatform("instagram_reels", {
    title: "Reel title",
    description: "Reel description",
    hashtags: Array(31).fill("tag"),
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("Hashtags exceed 30")));
});

// =====================================================================
// 44. validateForPlatform — unknown platform
// =====================================================================
test("validateForPlatform unknown platform", () => {
  const result = validateForPlatform("myspace", {
    title: "Title",
    description: "Desc",
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("Unknown platform")));
});

// =====================================================================
// 45. publish — returns job with id
// =====================================================================
test("publish returns job with id", () => {
  const result = publish({
    platform: "youtube",
    file_path: "/videos/test.mp4",
    title: "Test Video",
    description: "A test video.",
  });
  assert.equal(result.ok, true);
  assert.ok(result.job_id);
  assert.equal(typeof result.job_id, "string");
});

// =====================================================================
// 46. publish — stores job internally
// =====================================================================
test("publish stores job internally", () => {
  const result = publish({
    platform: "youtube",
    file_path: "/videos/test.mp4",
    title: "Stored Video",
    description: "Will be stored.",
  });
  const job = _getJob(result.job_id);
  assert.ok(job);
  assert.equal(job.platform, "youtube");
  assert.equal(job.title, "Stored Video");
});

// =====================================================================
// 47. getPublishStatus — returns correct job
// =====================================================================
test("getPublishStatus returns correct job", () => {
  const result = publish({
    platform: "tiktok",
    file_path: "/videos/tik.mp4",
    title: "TikTok Video",
    description: "Short form.",
  });
  const status = getPublishStatus(result.job_id);
  assert.equal(status.status, "queued");
  assert.equal(status.platform, "tiktok");
});

// =====================================================================
// 48. getPublishStatus — unknown id returns error
// =====================================================================
test("getPublishStatus unknown id returns error", () => {
  const status = getPublishStatus("nonexistent-id");
  assert.ok(status.error);
  assert.ok(status.error.includes("not found"));
});

// =====================================================================
// 49. listPublished — returns all
// =====================================================================
test("listPublished returns all jobs", () => {
  publish({ platform: "youtube", file_path: "a.mp4", title: "A", description: "Desc" });
  publish({ platform: "tiktok", file_path: "b.mp4", title: "B", description: "Desc" });
  const all = listPublished();
  assert.equal(all.length, 2);
});

// =====================================================================
// 50. listPublished — filters by platform
// =====================================================================
test("listPublished filters by platform", () => {
  publish({ platform: "youtube", file_path: "a.mp4", title: "A", description: "Desc" });
  publish({ platform: "youtube", file_path: "b.mp4", title: "B", description: "Desc" });
  publish({ platform: "tiktok", file_path: "c.mp4", title: "C", description: "Desc" });
  const ytOnly = listPublished({ platform: "youtube" });
  assert.equal(ytOnly.length, 2);
});

// =====================================================================
// 51. listPublished — respects limit
// =====================================================================
test("listPublished respects limit", () => {
  for (let i = 0; i < 10; i++) {
    publish({ platform: "youtube", file_path: `v${i}.mp4`, title: `V${i}`, description: `D${i}` });
  }
  const result = listPublished({ limit: 3 });
  assert.equal(result.length, 3);
});

// =====================================================================
// 52. listPublished — empty when no jobs
// =====================================================================
test("listPublished returns empty when no jobs", () => {
  assert.equal(listPublished().length, 0);
});

// =====================================================================
// 53. Multiple publishes create unique IDs
// =====================================================================
test("Multiple publishes create unique IDs", () => {
  const ids = new Set();
  for (let i = 0; i < 20; i++) {
    const r = publish({ platform: "youtube", file_path: `v${i}.mp4`, title: `V${i}`, description: `D${i}` });
    ids.add(r.job_id);
  }
  assert.equal(ids.size, 20);
});

// =====================================================================
// 54. Platform config has correct codecs
// =====================================================================
test("Platform config has correct codecs", () => {
  assert.equal(PLATFORMS.youtube.videoCodec, "h264");
  assert.equal(PLATFORMS.youtube.audioCodec, "aac");
  assert.equal(PLATFORMS.tiktok.videoCodec, "h264");
  assert.equal(PLATFORMS.tiktok.audioCodec, "aac");
});

// =====================================================================
// 55. Platform config has correct aspect ratios
// =====================================================================
test("Platform config has correct aspect ratios", () => {
  assert.deepEqual(PLATFORMS.youtube.aspectRatios, ["16:9", "4:3"]);
  assert.deepEqual(PLATFORMS.tiktok.aspectRatios, ["9:16"]);
  assert.deepEqual(PLATFORMS.instagram_reels.aspectRatios, ["9:16"]);
  assert.deepEqual(PLATFORMS.twitter.aspectRatios, ["16:9", "1:1"]);
});

// =====================================================================
// 56. All platforms have required fields
// =====================================================================
test("All platforms have required fields", () => {
  const requiredFields = [
    "id", "name", "maxWidth", "maxDuration", "aspectRatios",
    "maxFileSizeMB", "videoCodec", "audioCodec",
  ];
  for (const [key, config] of Object.entries(PLATFORMS)) {
    for (const field of requiredFields) {
      assert.ok(
        config[field] !== undefined,
        `Platform "${key}" is missing field "${field}"`
      );
    }
    assert.ok(config.aspectRatios.length > 0, `Platform "${key}" has no aspect ratios`);
  }
});

// =====================================================================
// 57. publishAll — total_published + failures = results.length
// =====================================================================
test("publishAll total_published + failures equals results length", () => {
  const r = publishAll({ video: "./v.mp4" });
  assert.equal(r.total_published + r.failures, r.results.length);
});

// =====================================================================
// 58. publishYouTube — default privacy is public
// =====================================================================
test("publishYouTube defaults privacy to public", () => {
  const r = publishYouTube({ video: "./v.mp4", title: "T" });
  assert.equal(r.privacy, "public");
});

// =====================================================================
// 59. publishTikTok — empty hashtags returns 0 count
// =====================================================================
test("publishTikTok empty hashtags returns 0 count", () => {
  const r = publishTikTok({ video: "./v.mp4" });
  assert.equal(r.hashtags_count, 0);
});

// =====================================================================
// 60. publishInstagramStories — default duration is 15
// =====================================================================
test("publishInstagramStories defaults duration to 15", () => {
  const r = publishInstagramStories({ video: "./v.mp4" });
  assert.equal(r.duration_sec, 15);
});

// =====================================================================
// 61. publishInstagramFeed — default aspect ratio is 1:1
// =====================================================================
test("publishInstagramFeed defaults aspect ratio to 1:1", () => {
  const r = publishInstagramFeed({ video: "generic_video.mp4" });
  assert.equal(r.aspect_ratio, "1:1");
});

// =====================================================================
// 62. publishFacebook — default privacy is public
// =====================================================================
test("publishFacebook defaults privacy to public", () => {
  const r = publishFacebook({ video: "./v.mp4" });
  assert.equal(r.privacy, "public");
});

// =====================================================================
// 63. publishTwitter — empty hashtags returns empty array
// =====================================================================
test("publishTwitter empty hashtags returns empty array", () => {
  const r = publishTwitter({ video: "./v.mp4" });
  assert.deepEqual(r.hashtags, []);
});

// =====================================================================
// 64. publishLinkedIn — default visibility is public
// =====================================================================
test("publishLinkedIn defaults visibility to public", () => {
  const r = publishLinkedIn({ video: "./v.mp4", title: "T" });
  assert.equal(r.visibility, "public");
});
