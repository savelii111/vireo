// Tests for YouTube Publisher — real YouTube Data API v3 client.

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { YouTubePublisher, YouTubeError } from "../src/platforms/youtube.js";

function makeTmp() {
  const dir = join(tmpdir(), "vireo_yt_test_" + Math.random().toString(36).slice(2, 8));
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeMockTransport(handler) {
  return async (method, url, opts = {}) => {
    return handler(method, url, opts);
  };
}

test("constructor: requires accessToken", () => {
  assert.throws(() => new YouTubePublisher({}), /accessToken is required/);
});

test("uploadVideo: sends metadata via POST to upload endpoint", async () => {
  const dir = makeTmp();
  const file = join(dir, "video.mp4");
  writeFileSync(file, Buffer.from("fake video data"));

  const calls = [];
  const transport = makeMockTransport(async (method, url, opts) => {
    const body = typeof opts.body === "string" ? opts.body : (opts.body?.toString?.() || "");
    calls.push({ method, url, body });
    if (url.includes("uploadType=resumable")) {
      return {
        status: 200,
        body: {},
        headers: { get: (n) => n.toLowerCase() === "location" ? "https://upload.example/video" : null },
      };
    }
    return {
      status: 200,
      body: { id: "abc123", kind: "youtube#video", status: { uploadStatus: "uploaded" } },
      headers: { get: () => null },
    };
  });

  const yt = new YouTubePublisher({ accessToken: "fake-token", transport });
  const result = await yt.uploadVideo({
    filePath: file,
    title: "Test Video",
    description: "Description",
    tags: ["test", "vireo"],
  });
  assert.equal(result.id, "abc123");
  assert.equal(result.url, "https://youtu.be/abc123");
  // First call is the initiate request
  const init = JSON.parse(calls[0].body);
  assert.equal(init.snippet.title, "Test Video");
  assert.equal(init.status.privacyStatus, "private");
  assert.deepEqual(init.snippet.tags, ["test", "vireo"]);
  rmSync(dir, { recursive: true, force: true });
});

test("uploadVideo: uses provided privacyStatus", async () => {
  const dir = makeTmp();
  const file = join(dir, "v.mp4");
  writeFileSync(file, Buffer.from("x"));

  let capturedMetadata = null;
  const transport = makeMockTransport(async (method, url, opts) => {
    if (url.includes("uploadType=resumable")) {
      capturedMetadata = JSON.parse(opts.body);
      return { status: 200, body: {}, headers: { get: () => "https://upload.example/v" } };
    }
    return { status: 200, body: { id: "x" }, headers: { get: () => null } };
  });

  const yt = new YouTubePublisher({ accessToken: "t", transport });
  await yt.uploadVideo({ filePath: file, title: "T", privacyStatus: "unlisted" });
  assert.equal(capturedMetadata.status.privacyStatus, "unlisted");
  rmSync(dir, { recursive: true, force: true });
});

test("uploadVideo: rejects missing filePath", async () => {
  const yt = new YouTubePublisher({ accessToken: "t" });
  await assert.rejects(
    () => yt.uploadVideo({ title: "x" }),
    /filePath is required/,
  );
});

test("uploadVideo: rejects missing title", async () => {
  const yt = new YouTubePublisher({ accessToken: "t" });
  await assert.rejects(
    () => yt.uploadVideo({ filePath: "/some/path" }),
    /title is required/,
  );
});

test("uploadVideo: rejects non-existent file", async () => {
  const yt = new YouTubePublisher({ accessToken: "t" });
  await assert.rejects(
    () => yt.uploadVideo({ filePath: "/nonexistent/path.mp4", title: "x" }),
    /file not found/,
  );
});

test("uploadVideo: handles API error on init", async () => {
  const dir = makeTmp();
  const file = join(dir, "v.mp4");
  writeFileSync(file, Buffer.from("x"));
  const transport = makeMockTransport(async () => ({
    status: 403,
    body: { error: { message: "quota exceeded" } },
    headers: { get: () => null },
  }));
  const yt = new YouTubePublisher({ accessToken: "t", transport });
  await assert.rejects(
    () => yt.uploadVideo({ filePath: file, title: "x" }),
    /quota exceeded/,
  );
  rmSync(dir, { recursive: true, force: true });
});

test("uploadVideo: handles API error on upload", async () => {
  const dir = makeTmp();
  const file = join(dir, "v.mp4");
  writeFileSync(file, Buffer.from("x"));
  const transport = makeMockTransport(async (method, url) => {
    if (url.includes("uploadType=resumable")) {
      return { status: 200, body: {}, headers: { get: () => "https://upload.example/v" } };
    }
    return {
      status: 500,
      body: { error: { message: "server error" } },
      headers: { get: () => null },
    };
  });
  const yt = new YouTubePublisher({ accessToken: "t", transport });
  await assert.rejects(
    () => yt.uploadVideo({ filePath: file, title: "x" }),
    /server error/,
  );
  rmSync(dir, { recursive: true, force: true });
});

test("uploadVideo: truncates long title to 100 chars", async () => {
  const dir = makeTmp();
  const file = join(dir, "v.mp4");
  writeFileSync(file, Buffer.from("x"));

  let captured = null;
  const transport = makeMockTransport(async (method, url, opts) => {
    if (url.includes("uploadType=resumable")) {
      captured = JSON.parse(opts.body);
      return { status: 200, body: {}, headers: { get: () => "https://upload.example/v" } };
    }
    return { status: 200, body: { id: "x" }, headers: { get: () => null } };
  });

  const yt = new YouTubePublisher({ accessToken: "t", transport });
  await yt.uploadVideo({
    filePath: file,
    title: "A".repeat(150),
  });
  assert.equal(captured.snippet.title.length, 100);
  rmSync(dir, { recursive: true, force: true });
});

test("updateVideo: sends PUT with patch", async () => {
  const calls = [];
  const transport = makeMockTransport(async (method, url, opts) => {
    calls.push({ method, url, body: JSON.parse(opts.body) });
    return { status: 200, body: { id: "abc", status: { privacyStatus: "public" } }, headers: { get: () => null } };
  });
  const yt = new YouTubePublisher({ accessToken: "t", transport });
  const result = await yt.updateVideo("abc", { title: "New Title", privacyStatus: "public" });
  assert.equal(result.id, "abc");
  assert.equal(calls[0].method, "PUT");
  assert.equal(calls[0].body.id, "abc");
  assert.equal(calls[0].body.snippet.title, "New Title");
  assert.equal(calls[0].body.status.privacyStatus, "public");
});

test("updateVideo: rejects missing videoId", async () => {
  const yt = new YouTubePublisher({ accessToken: "t" });
  await assert.rejects(() => yt.updateVideo("", {}), /videoId is required/);
});

test("getVideoStats: parses statistics", async () => {
  const transport = makeMockTransport(async () => ({
    status: 200,
    body: {
      items: [{
        id: "abc",
        snippet: { title: "T" },
        statistics: { viewCount: "1000", likeCount: "50", commentCount: "10" },
      }],
    },
    headers: { get: () => null },
  }));
  const yt = new YouTubePublisher({ accessToken: "t", transport });
  const stats = await yt.getVideoStats("abc");
  assert.equal(stats.id, "abc");
  assert.equal(stats.title, "T");
  assert.equal(stats.views, 1000);
  assert.equal(stats.likes, 50);
  assert.equal(stats.comments, 10);
});

test("getVideoStats: returns null on empty items", async () => {
  const transport = makeMockTransport(async () => ({
    status: 200,
    body: { items: [] },
    headers: { get: () => null },
  }));
  const yt = new YouTubePublisher({ accessToken: "t", transport });
  const stats = await yt.getVideoStats("missing");
  assert.equal(stats, null);
});

test("setThumbnail: sends PNG bytes", async () => {
  const dir = makeTmp();
  const thumb = join(dir, "thumb.png");
  writeFileSync(thumb, Buffer.from([0x89, 0x50, 0x4e, 0x47])); // PNG signature

  const calls = [];
  const transport = makeMockTransport(async (method, url, opts) => {
    calls.push({ method, url, headers: opts.headers, bodyLen: opts.body.length });
    return { status: 200, body: { items: [] }, headers: { get: () => null } };
  });
  const yt = new YouTubePublisher({ accessToken: "t", transport });
  await yt.setThumbnail("vid", thumb);
  assert.equal(calls[0].method, "POST");
  assert.match(calls[0].url, /thumbnails\/set/);
  assert.match(calls[0].url, /videoId=vid/);
  assert.equal(calls[0].headers["Content-Type"], "image/png");
  rmSync(dir, { recursive: true, force: true });
});

test("setThumbnail: detects JPEG MIME", async () => {
  const dir = makeTmp();
  const thumb = join(dir, "thumb.jpg");
  writeFileSync(thumb, Buffer.from([0xff, 0xd8, 0xff]));

  let ct = null;
  const transport = makeMockTransport(async (method, url, opts) => {
    ct = opts.headers["Content-Type"];
    return { status: 200, body: {}, headers: { get: () => null } };
  });
  const yt = new YouTubePublisher({ accessToken: "t", transport });
  await yt.setThumbnail("vid", thumb);
  assert.equal(ct, "image/jpeg");
  rmSync(dir, { recursive: true, force: true });
});

test("YouTubeError: has status and code", () => {
  const e = new YouTubeError("test", 403, "quota");
  assert.equal(e.name, "YouTubeError");
  assert.equal(e.status, 403);
  assert.equal(e.code, "quota");
  assert.equal(e.message, "test");
});
