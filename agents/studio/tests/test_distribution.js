// test_distribution.js — Comprehensive tests for the distribution module.
//
// Validates platform configs, content validation, SEO generation,
// publish workflow, job management, and edge cases.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PLATFORMS,
  validateForPlatform,
  generateSEO,
  publish,
  getPublishStatus,
  listPublished,
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
// 1. validateForPlatform — YouTube valid
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
// 2. validateForPlatform — YouTube title too long
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
// 3. validateForPlatform — YouTube description too long
// =====================================================================
test("validateForPlatform YouTube description too long", () => {
  const result = validateForPlatform("youtube", {
    title: "Valid Title",
    description: "D".repeat(5001),
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("Description exceeds 5000")));
});

// =====================================================================
// 4. validateForPlatform — TikTok valid
// =====================================================================
test("validateForPlatform TikTok valid", () => {
  const result = validateForPlatform("tiktok", {
    title: "Fun video!",
    description: "Check out this amazing content",
  });
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

// =====================================================================
// 5. validateForPlatform — Instagram hashtags limit
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
// 6. validateForPlatform — Twitter description too long
// =====================================================================
test("validateForPlatform Twitter description too long", () => {
  const result = validateForPlatform("twitter", {
    title: "Tweet",
    description: "T".repeat(281),
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("Description exceeds 280")));
});

// =====================================================================
// 7. validateForPlatform — LinkedIn valid
// =====================================================================
test("validateForPlatform LinkedIn valid", () => {
  const result = validateForPlatform("linkedin", {
    title: "Professional Content",
    description: "A professional video for LinkedIn audiences.",
    tags: "professional, business, tips",
  });
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

// =====================================================================
// 8. validateForPlatform — unknown platform
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
// 9. publish — returns job with id
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
  assert.ok(result.job_id.length > 0);
});

// =====================================================================
// 10. publish — stores job
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
  assert.equal(job.file_path, "/videos/test.mp4");
  assert.equal(job.title, "Stored Video");
});

// =====================================================================
// 11. getPublishStatus — returns correct job
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
// 12. getPublishStatus — unknown id returns error
// =====================================================================
test("getPublishStatus unknown id returns error", () => {
  const status = getPublishStatus("nonexistent-id");
  assert.ok(status.error);
  assert.ok(status.error.includes("not found"));
});

// =====================================================================
// 13. listPublished — returns all
// =====================================================================
test("listPublished returns all jobs", () => {
  publish({ platform: "youtube", file_path: "a.mp4", title: "A", description: "Desc" });
  publish({ platform: "tiktok", file_path: "b.mp4", title: "B", description: "Desc" });
  publish({ platform: "twitter", file_path: "c.mp4", title: "C", description: "Tweet desc" });
  const all = listPublished();
  assert.equal(all.length, 3);
});

// =====================================================================
// 14. listPublished — filters by platform
// =====================================================================
test("listPublished filters by platform", () => {
  publish({ platform: "youtube", file_path: "a.mp4", title: "A", description: "Desc" });
  publish({ platform: "youtube", file_path: "b.mp4", title: "B", description: "Desc" });
  publish({ platform: "tiktok", file_path: "c.mp4", title: "C", description: "Desc" });
  const ytOnly = listPublished({ platform: "youtube" });
  assert.equal(ytOnly.length, 2);
  assert.ok(ytOnly.every((j) => j.platform === "youtube"));
});

// =====================================================================
// 15. generateSEO — returns all fields
// =====================================================================
test("generateSEO returns all fields", () => {
  const seo = generateSEO({
    title: "My Video",
    description: "Great content here",
    tags: "video, tutorial",
  });
  assert.ok(seo.optimized_title);
  assert.ok(seo.optimized_description);
  assert.ok(Array.isArray(seo.suggested_tags));
  assert.ok(Array.isArray(seo.suggested_hashtags));
  assert.ok(seo.estimated_reach);
});

// =====================================================================
// 16. generateSEO — optimized title shorter than 100
// =====================================================================
test("generateSEO optimized title shorter than 100", () => {
  const seo = generateSEO({
    title: "A".repeat(200),
    description: "Desc",
  });
  assert.ok(seo.optimized_title.length <= 100);
});

// =====================================================================
// 17. generateSEO — suggested hashtags count
// =====================================================================
test("generateSEO suggested hashtags count", () => {
  const seo = generateSEO({
    title: "Test",
    description: "Desc",
    tags: "action, adventure, comedy, drama, horror, sci-fi, romance, thriller",
  });
  assert.ok(seo.suggested_hashtags.length >= 2);
  assert.ok(seo.suggested_hashtags.length <= 12);
  // Should start with #video
  assert.equal(seo.suggested_hashtags[0], "#video");
});

// =====================================================================
// 18. publish — schedule_at in future
// =====================================================================
test("publish schedule_at in future", () => {
  const result = publish({
    platform: "youtube",
    file_path: "/vid.mp4",
    title: "Scheduled",
    description: "Future publish",
    schedule_at: futureDate(7200_000),
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, "scheduled");
});

// =====================================================================
// 19. Platform config has correct codecs
// =====================================================================
test("Platform config has correct codecs", () => {
  assert.equal(PLATFORMS.youtube.videoCodec, "h264");
  assert.equal(PLATFORMS.youtube.audioCodec, "aac");
  assert.equal(PLATFORMS.vimeo.videoCodec, "h264");
  assert.equal(PLATFORMS.vimeo.audioCodec, "aac");
  assert.equal(PLATFORMS.twitter.videoCodec, "h264");
  assert.equal(PLATFORMS.twitter.audioCodec, "aac");
});

// =====================================================================
// 20. Platform config has correct aspect ratios
// =====================================================================
test("Platform config has correct aspect ratios", () => {
  assert.deepEqual(PLATFORMS.youtube.aspectRatios, ["16:9", "4:3"]);
  assert.deepEqual(PLATFORMS.tiktok.aspectRatios, ["9:16"]);
  assert.deepEqual(PLATFORMS.instagram_reels.aspectRatios, ["9:16"]);
  assert.deepEqual(PLATFORMS.twitter.aspectRatios, ["16:9", "1:1"]);
});

// =====================================================================
// 21. Multiple publishes create unique IDs
// =====================================================================
test("Multiple publishes create unique IDs", () => {
  const ids = new Set();
  for (let i = 0; i < 20; i++) {
    const r = publish({
      platform: "youtube",
      file_path: `v${i}.mp4`,
      title: `Vid ${i}`,
      description: `Desc ${i}`,
    });
    ids.add(r.job_id);
  }
  assert.equal(ids.size, 20);
});

// =====================================================================
// 22. listPublished respects limit
// =====================================================================
test("listPublished respects limit", () => {
  for (let i = 0; i < 10; i++) {
    publish({ platform: "youtube", file_path: `v${i}.mp4`, title: `V${i}`, description: `D${i}` });
  }
  const result = listPublished({ limit: 3 });
  assert.equal(result.length, 3);
});

// =====================================================================
// 23. validateForPlatform — empty title rejected
// =====================================================================
test("validateForPlatform empty title rejected", () => {
  const result = validateForPlatform("youtube", {
    title: "",
    description: "Some description",
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("Title is required")));
});

// =====================================================================
// 24. validateForPlatform — empty description rejected
// =====================================================================
test("validateForPlatform empty description rejected", () => {
  const result = validateForPlatform("vimeo", {
    title: "My Vimeo",
    description: "",
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("Description is required")));
});

// =====================================================================
// 25. generateSEO — handles empty input
// =====================================================================
test("generateSEO handles empty input", () => {
  const seo = generateSEO({});
  assert.equal(seo.optimized_title, "Untitled Video");
  assert.equal(seo.optimized_description, "Untitled Video");
  assert.ok(Array.isArray(seo.suggested_tags));
  assert.ok(Array.isArray(seo.suggested_hashtags));
  assert.ok(seo.estimated_reach);
});

// =====================================================================
// 26. publish — without schedule_at defaults to immediate
// =====================================================================
test("publish without schedule_at defaults to immediate", () => {
  const result = publish({
    platform: "youtube",
    file_path: "/v.mp4",
    title: "Immediate",
    description: "No schedule",
  });
  assert.equal(result.status, "queued");
  assert.equal(result.estimated_time, "immediate");
});

// =====================================================================
// 27. getPublishStatus — after publish shows 'queued'
// =====================================================================
test("getPublishStatus after publish shows queued", () => {
  const r = publish({
    platform: "facebook",
    file_path: "/fb.mp4",
    title: "FB Video",
    description: "Facebook content",
  });
  const s = getPublishStatus(r.job_id);
  assert.equal(s.status, "queued");
  assert.equal(s.platform, "facebook");
});

// =====================================================================
// 28. Platform YouTube allows 4K
// =====================================================================
test("Platform YouTube allows 4K", () => {
  assert.equal(PLATFORMS.youtube.maxWidth, 3840);
});

// =====================================================================
// 29. Platform TikTok allows 1080p only
// =====================================================================
test("Platform TikTok allows 1080p only", () => {
  assert.equal(PLATFORMS.tiktok.maxWidth, 1080);
});

// =====================================================================
// 30. All platforms have required fields
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
// 31. publish — invalid platform returns error
// =====================================================================
test("publish invalid platform returns error", () => {
  const result = publish({
    platform: "nonexistent",
    file_path: "/v.mp4",
    title: "Title",
    description: "Desc",
  });
  assert.equal(result.ok, false);
  assert.ok(result.error.includes("Unknown platform"));
});

// =====================================================================
// 32. publish — missing file_path returns error
// =====================================================================
test("publish missing file_path returns error", () => {
  const result = publish({
    platform: "youtube",
    file_path: "",
    title: "Title",
    description: "Desc",
  });
  assert.equal(result.ok, false);
  assert.ok(result.error.includes("file_path is required"));
});

// =====================================================================
// 33. publish — schedule_at in past returns error
// =====================================================================
test("publish schedule_at in past returns error", () => {
  const result = publish({
    platform: "youtube",
    file_path: "/v.mp4",
    title: "Title",
    description: "Desc",
    schedule_at: new Date(Date.now() - 3600_000).toISOString(),
  });
  assert.equal(result.ok, false);
  assert.ok(result.error.includes("future"));
});

// =====================================================================
// 34. validateForPlatform — TikTok rejects tags
// =====================================================================
test("validateForPlatform TikTok rejects tags", () => {
  const result = validateForPlatform("tiktok", {
    title: "TikTok Vid",
    description: "Fun content",
    tags: "some,tags",
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("does not support tags")));
});

// =====================================================================
// 35. listPublished — empty when no jobs
// =====================================================================
test("listPublished returns empty when no jobs", () => {
  const result = listPublished();
  assert.equal(result.length, 0);
});

// =====================================================================
// 36. generateSEO — long title gets truncated
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
test("generateSEO long description gets truncated with ellipsis", () => {
  const seo = generateSEO({
    title: "Title",
    description: "D".repeat(6000),
  });
  assert.ok(seo.optimized_description.endsWith("..."));
  assert.ok(seo.optimized_description.length <= 5000);
});
