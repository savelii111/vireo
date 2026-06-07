// Tests for TikTok, Instagram, X, LinkedIn publishers.

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { TikTokPublisher, TikTokError } from "../src/platforms/tiktok.js";
import { InstagramPublisher, InstagramError } from "../src/platforms/instagram.js";
import { XPublisher, XError } from "../src/platforms/x.js";
import { LinkedInPublisher, LinkedInError } from "../src/platforms/linkedin.js";

function makeTmp() {
  const dir = join(tmpdir(), "vireo_pub_" + Math.random().toString(36).slice(2, 8));
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeMockTransport(handler) {
  return async (method, url, opts = {}) => handler(method, url, opts);
}

// ========== TikTok ==========

test("TikTok: constructor requires accessToken", () => {
  assert.throws(() => new TikTokPublisher({}), /accessToken is required/);
});

test("TikTok: publishVideo three-step flow", async () => {
  const dir = makeTmp();
  const file = join(dir, "v.mp4");
  writeFileSync(file, Buffer.from("x".repeat(1000)));

  const calls = [];
  const transport = makeMockTransport(async (method, url, opts) => {
    calls.push({ method, url, body: opts.body });
    if (url.includes("/init/")) {
      return { status: 200, body: { data: { publish_id: "pub_123", upload_url: "https://upload.tiktok/v" } } };
    }
    if (url.includes("upload.tiktok")) {
      return { status: 201, body: {} };
    }
    return { status: 200, body: { data: { share_url: "https://tiktok.com/@me/v/123" } } };
  });

  const tt = new TikTokPublisher({ accessToken: "t", transport });
  const result = await tt.publishVideo({
    filePath: file,
    title: "My TikTok",
    tags: ["vireo", "ai"],
  });
  assert.equal(result.publishId, "pub_123");
  assert.equal(result.shareUrl, "https://tiktok.com/@me/v/123");
  // 3 calls: init, upload, publish
  assert.equal(calls.length, 3);
  // Init body should have caption with hashtags
  const initBody = JSON.parse(calls[0].body);
  assert.match(initBody.post_info.title, /#vireo/);
  assert.match(initBody.post_info.title, /#ai/);
  rmSync(dir, { recursive: true, force: true });
});

test("TikTok: rejects missing filePath", async () => {
  const tt = new TikTokPublisher({ accessToken: "t" });
  await assert.rejects(() => tt.publishVideo({ title: "x" }), /filePath/);
});

test("TikTok: rejects missing title", async () => {
  const tt = new TikTokPublisher({ accessToken: "t" });
  await assert.rejects(() => tt.publishVideo({ filePath: "/tmp/x.mp4" }), /title/);
});

test("TikTok: handles API error on init", async () => {
  const dir = makeTmp();
  const file = join(dir, "v.mp4");
  writeFileSync(file, Buffer.from("x"));
  const transport = makeMockTransport(async () => ({
    status: 200,
    body: { error: { code: "quota_exceeded", message: "Daily quota reached" } },
  }));
  const tt = new TikTokPublisher({ accessToken: "t", transport });
  await assert.rejects(
    () => tt.publishVideo({ filePath: file, title: "x" }),
    /Daily quota/,
  );
  rmSync(dir, { recursive: true, force: true });
});

test("TikTok: getVideoMetrics requires non-empty array", async () => {
  const tt = new TikTokPublisher({ accessToken: "t" });
  await assert.rejects(() => tt.getVideoMetrics([]), /non-empty/);
});

test("TikTok: getVideoMetrics returns parsed data", async () => {
  const transport = makeMockTransport(async () => ({
    status: 200,
    body: { data: { videos: [{ id: "v1", view_count: 1000, like_count: 50 }] } },
  }));
  const tt = new TikTokPublisher({ accessToken: "t", transport });
  const vids = await tt.getVideoMetrics(["v1"]);
  assert.equal(vids.length, 1);
  assert.equal(vids[0].view_count, 1000);
});

test("TikTokError: has status and code", () => {
  const e = new TikTokError("m", 403, "c");
  assert.equal(e.name, "TikTokError");
  assert.equal(e.status, 403);
  assert.equal(e.code, "c");
});

// ========== Instagram ==========

test("Instagram: constructor requires accessToken and igUserId", () => {
  assert.throws(() => new InstagramPublisher({}), /accessToken/);
  assert.throws(() => new InstagramPublisher({ accessToken: "x" }), /igUserId/);
});

test("Instagram: publishReel three-step flow", async () => {
  const calls = [];
  let pollCount = 0;
  const transport = makeMockTransport(async (method, url, opts) => {
    calls.push({ method, url });
    if (url.endsWith("/media") && method === "POST" && !opts.body?.includes("creation_id")) {
      return { status: 200, body: { id: "container_123" } };
    }
    if (url.includes("/container_123?fields")) {
      pollCount++;
      return { status: 200, body: { status_code: pollCount >= 2 ? "FINISHED" : "IN_PROGRESS" } };
    }
    if (url.endsWith("/media_publish") || url.includes("media_publish")) {
      return { status: 200, body: { id: "media_456" } };
    }
    return { status: 200, body: {} };
  });

  const ig = new InstagramPublisher({ accessToken: "tok", igUserId: "ig_1", transport });
  const result = await ig.publishReel({ videoUrl: "https://cdn.example.com/v.mp4", caption: "Hello!" });
  assert.equal(result.containerId, "container_123");
  assert.equal(result.mediaId, "media_456");
  assert.equal(pollCount, 2);
});

test("Instagram: rejects missing videoUrl", async () => {
  const ig = new InstagramPublisher({ accessToken: "t", igUserId: "i" });
  await assert.rejects(() => ig.publishReel({ caption: "x" }), /videoUrl/);
});

test("Instagram: handles container ERROR", async () => {
  const transport = makeMockTransport(async (method, url) => {
    if (url.endsWith("/media") || url.endsWith("/media?")) {
      return { status: 200, body: { id: "c1" } };
    }
    return { status: 200, body: { status_code: "ERROR" } };
  });
  const ig = new InstagramPublisher({ accessToken: "t", igUserId: "i", transport });
  await assert.rejects(
    () => ig.publishReel({ videoUrl: "https://x.com/v", caption: "x" }),
    /ERROR/,
  );
});

test("Instagram: getMediaInsights parses metrics", async () => {
  const transport = makeMockTransport(async () => ({
    status: 200,
    body: {
      data: [
        { name: "plays", values: [{ value: 1000 }] },
        { name: "likes", values: [{ value: 50 }] },
        { name: "comments", values: [{ value: 5 }] },
      ],
    },
  }));
  const ig = new InstagramPublisher({ accessToken: "t", igUserId: "i", transport });
  const stats = await ig.getMediaInsights("m1");
  assert.equal(stats.plays, 1000);
  assert.equal(stats.likes, 50);
  assert.equal(stats.comments, 5);
});

test("InstagramError: has status and code", () => {
  const e = new InstagramError("m", 400, "c");
  assert.equal(e.name, "InstagramError");
});

// ========== X (Twitter) ==========

test("X: constructor requires accessToken", () => {
  assert.throws(() => new XPublisher({}), /accessToken/);
});

test("X: uploadMedia three-step (INIT/APPEND/FINALIZE)", async () => {
  const dir = makeTmp();
  const file = join(dir, "v.mp4");
  writeFileSync(file, Buffer.alloc(6 * 1024 * 1024)); // 6MB

  const calls = [];
  const transport = makeMockTransport(async (method, url, opts) => {
    calls.push({ method, url });
    if (opts.body?.includes?.("command=INIT")) {
      return { status: 202, body: { media_id_string: "media_123" } };
    }
    if (opts.body?.includes?.("command=FINALIZE")) {
      return { status: 200, body: { media_id_string: "media_123" } };
    }
    if (url === "https://upload.twitter.com/1.1/media/upload.json" && method === "POST" &&
        (opts.body?.includes?.("command=APPEND") || (typeof opts.body === "object" && opts.body?.get?.("command") === "APPEND"))) {
      return { status: 204, body: {} };
    }
    return { status: 200, body: {} };
  });

  const x = new XPublisher({ accessToken: "t", transport });
  const mediaId = await x.uploadMedia(file, "video/mp4", 5 * 1024 * 1024);
  assert.equal(mediaId, "media_123");
  // 1 init + 2 appends (6MB / 5MB chunks) + 1 finalize = 4
  assert.equal(calls.length, 4);
  rmSync(dir, { recursive: true, force: true });
});

test("X: postTweet sends to /2/tweets with media_ids", async () => {
  const transport = makeMockTransport(async (method, url, opts) => {
    if (url.includes("/2/tweets")) {
      const body = JSON.parse(opts.body);
      assert.equal(body.text, "Hello world");
      assert.deepEqual(body.media.media_ids, ["m1", "m2"]);
      return { status: 201, body: { data: { id: "tweet_1", text: "Hello world" } } };
    }
    return { status: 200, body: {} };
  });
  const x = new XPublisher({ accessToken: "t", transport });
  const result = await x.postTweet({ text: "Hello world", mediaIds: ["m1", "m2"] });
  assert.equal(result.id, "tweet_1");
  assert.equal(result.text, "Hello world");
});

test("X: rejects tweet without text", async () => {
  const x = new XPublisher({ accessToken: "t" });
  await assert.rejects(() => x.postTweet({}), /text is required/);
});

test("X: truncates text to 280 chars", async () => {
  let captured = null;
  const transport = makeMockTransport(async (method, url, opts) => {
    captured = JSON.parse(opts.body);
    return { status: 201, body: { data: { id: "t1" } } };
  });
  const x = new XPublisher({ accessToken: "t", transport });
  await x.postTweet({ text: "A".repeat(500) });
  assert.equal(captured.text.length, 280);
});

test("X: getTweetMetrics parses public_metrics", async () => {
  const transport = makeMockTransport(async () => ({
    status: 200,
    body: {
      data: {
        id: "t1",
        public_metrics: {
          impression_count: 1000,
          like_count: 50,
          retweet_count: 10,
          reply_count: 5,
          quote_count: 1,
          bookmark_count: 2,
        },
      },
    },
  }));
  const x = new XPublisher({ accessToken: "t", transport });
  const stats = await x.getTweetMetrics("t1");
  assert.equal(stats.views, 1000);
  assert.equal(stats.likes, 50);
  assert.equal(stats.retweets, 10);
  assert.equal(stats.bookmarks, 2);
});

test("XError: has status and code", () => {
  const e = new XError("m", 401, "c");
  assert.equal(e.name, "XError");
});

// ========== LinkedIn ==========

test("LinkedIn: constructor requires accessToken and authorUrn", () => {
  assert.throws(() => new LinkedInPublisher({}), /accessToken/);
  assert.throws(() => new LinkedInPublisher({ accessToken: "x" }), /authorUrn/);
});

test("LinkedIn: publishVideo three-step flow", async () => {
  const dir = makeTmp();
  const file = join(dir, "v.mp4");
  writeFileSync(file, Buffer.from("x".repeat(1000)));

  const calls = [];
  const transport = makeMockTransport(async (method, url, opts) => {
    calls.push({ method, url });
    if (url.includes("initializeUpload")) {
      return {
        status: 200,
        body: {
          value: {
            uploadMechanism: {
              "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest": {
                uploadUrl: "https://upload.linkedin/x",
              },
            },
            mediaArtifact: "urn:li:digitalmediaAsset:C123",
          },
        },
      };
    }
    if (url.startsWith("https://upload.linkedin")) {
      return { status: 201, body: {} };
    }
    if (url.endsWith("/posts") && method === "POST" && opts.body?.includes("media")) {
      // Post body (has "media" key)
      return {
        status: 201,
        body: {},
        headers: { get: (n) => n === "x-restli-id" ? "urn:li:share:789" : null },
      };
    }
    return { status: 200, body: {} };
  });

  const li = new LinkedInPublisher({ accessToken: "t", authorUrn: "urn:li:person:abc", transport });
  const result = await li.publishVideo({ filePath: file, text: "My post", title: "Cool" });
  assert.equal(result.postUrn, "urn:li:share:789");
  assert.equal(result.mediaUrn, "urn:li:digitalmediaAsset:C123");
  rmSync(dir, { recursive: true, force: true });
});

test("LinkedIn: rejects missing filePath", async () => {
  const li = new LinkedInPublisher({ accessToken: "t", authorUrn: "u" });
  await assert.rejects(() => li.publishVideo({ text: "x" }), /filePath/);
});

test("LinkedIn: rejects missing text", async () => {
  const li = new LinkedInPublisher({ accessToken: "t", authorUrn: "u" });
  await assert.rejects(() => li.publishVideo({ filePath: "/tmp/x" }), /text/);
});

test("LinkedInError: has status and code", () => {
  const e = new LinkedInError("m", 403, "c");
  assert.equal(e.name, "LinkedInError");
});
