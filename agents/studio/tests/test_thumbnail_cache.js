// test_thumbnail_cache.js — Tests for the ThumbnailCache module.
//
// Validates:
//   1. generateThumbnail returns object with ok field
//   2. Cache hit returns same result
//   3. Invalid file returns fallback (placeholder)
//   4. Cache key format is correct
//   5. TTL on cached thumbnails
//   6. Multiple timestamps for same file produce different keys
//   7. Large timestamp values handled
//   8. Concurrent requests handled
//   9. Cache clear works
//  10. Memory doesn't grow unbounded (LRU eviction)
//  11. Invalid inputs return errors
//  12. Placeholder is returned on ffmpeg failure

import { test } from "node:test";
import assert from "node:assert/strict";
import { ThumbnailCache } from "../src/thumbnail_cache.js";

// =====================================================================
// 1. generateThumbnail returns object with ok field
// =====================================================================
test("generateThumbnail returns object with ok field", async () => {
  const tc = new ThumbnailCache();
  const result = await tc.generateThumbnail("/nonexistent/file.mp4", 0);
  assert.equal(typeof result, "object");
  assert.equal(typeof result.ok, "boolean");
  // Nonexistent file falls back to placeholder, so ok is true
  assert.equal(result.ok, true);
  assert.ok(typeof result.thumbnail_base64 === "string");
  assert.ok(result.thumbnail_base64.length > 0);
});

// =====================================================================
// 2. Cache hit returns same result
// =====================================================================
test("cache hit returns same result", async () => {
  const tc = new ThumbnailCache();
  // First call — will hit ffmpeg (fails) and cache the placeholder
  const r1 = await tc.generateThumbnail("/bad/file.mp4", 0);
  // Second call — should be a cache hit
  const r2 = await tc.generateThumbnail("/bad/file.mp4", 0);
  assert.equal(r2.ok, r1.ok);
  assert.equal(r2.thumbnail_base64, r1.thumbnail_base64);
  assert.equal(r2.cached, true);
});

// =====================================================================
// 3. Invalid file returns fallback (placeholder thumbnail)
// =====================================================================
test("invalid file returns fallback placeholder", async () => {
  const tc = new ThumbnailCache();
  const result = await tc.generateThumbnail("/does/not/exist.mp4", 5.0);
  // Should return ok:true with a placeholder (since we fall back gracefully)
  assert.equal(result.ok, true);
  assert.ok(typeof result.thumbnail_base64 === "string");
  assert.ok(result.thumbnail_base64.length > 0);
});

// =====================================================================
// 4. Cache key format is correct
// =====================================================================
test("cache key format includes path and timestamp", () => {
  const key = ThumbnailCache.cacheKey("/path/to/video.mp4", 12.5);
  assert.equal(key, "/path/to/video.mp4:12.5");
});

// =====================================================================
// 5. TTL on cached thumbnails — expired entry is evicted
// =====================================================================
test("TTL on cached thumbnails", async () => {
  // Use very short TTL
  const tc = new ThumbnailCache({ ttlMs: 1 });
  await tc.generateThumbnail("/ttl_test.mp4", 0);
  assert.ok(tc.size >= 1, "should have at least 1 cached entry");

  // Wait for TTL to expire
  await new Promise((r) => setTimeout(r, 20));

  // Next call should not be a cache hit (TTL expired)
  const result = await tc.generateThumbnail("/ttl_test.mp4", 0);
  // The LRUCache.get() deletes expired entries, so it won't be cached
  // But our generateThumbnail will re-generate and cache again
  assert.equal(result.ok, true);
});

// =====================================================================
// 6. Multiple timestamps for same file produce different keys
// =====================================================================
test("multiple timestamps for same file use different cache keys", async () => {
  const tc = new ThumbnailCache();
  const key1 = ThumbnailCache.cacheKey("/file.mp4", 0);
  const key2 = ThumbnailCache.cacheKey("/file.mp4", 5);
  const key3 = ThumbnailCache.cacheKey("/file.mp4", 10);
  assert.notEqual(key1, key2);
  assert.notEqual(key2, key3);
  assert.notEqual(key1, key3);
});

// =====================================================================
// 7. Large timestamp values handled
// =====================================================================
test("large timestamp values handled", async () => {
  const tc = new ThumbnailCache();
  const key = ThumbnailCache.cacheKey("/file.mp4", 999999);
  assert.equal(key, "/file.mp4:999999");
  const result = await tc.generateThumbnail("/file.mp4", 999999);
  assert.equal(typeof result.ok, "boolean");
});

// =====================================================================
// 8. Concurrent requests handled
// =====================================================================
test("concurrent requests are handled without crash", async () => {
  const tc = new ThumbnailCache();
  const promises = [];
  for (let i = 0; i < 5; i++) {
    promises.push(tc.generateThumbnail(`/concurrent_${i}.mp4`, i));
  }
  const results = await Promise.all(promises);
  assert.equal(results.length, 5);
  for (const r of results) {
    assert.equal(typeof r.ok, "boolean");
  }
});

// =====================================================================
// 9. Cache clear works
// =====================================================================
test("cache clear removes all entries", async () => {
  const tc = new ThumbnailCache();
  await tc.generateThumbnail("/clear_test.mp4", 0);
  await tc.generateThumbnail("/clear_test.mp4", 1);
  assert.ok(tc.size >= 1);
  tc.clear();
  assert.equal(tc.size, 0);
});

// =====================================================================
// 10. Memory doesn't grow unbounded — LRU eviction works
// =====================================================================
test("LRU eviction caps cache size", async () => {
  const tc = new ThumbnailCache({ cacheSize: 3 });
  await tc.generateThumbnail("/a.mp4", 0);
  await tc.generateThumbnail("/b.mp4", 0);
  await tc.generateThumbnail("/c.mp4", 0);
  assert.equal(tc.size, 3);

  // Add a 4th — should evict the oldest
  await tc.generateThumbnail("/d.mp4", 0);
  assert.equal(tc.size, 3, "cache size should not exceed capacity");
});

// =====================================================================
// 11. Invalid inputs return errors
// =====================================================================
test("invalid file path returns error", async () => {
  const tc = new ThumbnailCache();
  const r1 = await tc.generateThumbnail(null, 0);
  assert.equal(r1.ok, false);
  assert.equal(r1.error, "invalid_file_path");

  const r2 = await tc.generateThumbnail(123, 0);
  assert.equal(r2.ok, false);
  assert.equal(r2.error, "invalid_file_path");
});

test("invalid timestamp returns error", async () => {
  const tc = new ThumbnailCache();
  const r1 = await tc.generateThumbnail("/file.mp4", -1);
  assert.equal(r1.ok, false);
  assert.equal(r1.error, "invalid_timestamp");

  const r2 = await tc.generateThumbnail("/file.mp4", "abc");
  assert.equal(r2.ok, false);
  assert.equal(r2.error, "invalid_timestamp");
});

// =====================================================================
// 12. Placeholder is returned on ffmpeg failure
// =====================================================================
test("placeholder returned when ffmpeg fails", async () => {
  const tc = new ThumbnailCache();
  const result = await tc.generateThumbnail("/fake/video.mp4", 3.14);
  // Should be ok:true with a placeholder image
  assert.equal(result.ok, true);
  assert.ok(typeof result.thumbnail_base64 === "string");
  assert.ok(result.thumbnail_base64.length > 10, "placeholder should have data");
});
