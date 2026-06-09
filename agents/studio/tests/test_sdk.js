// test_sdk.js — 20 tests for the Vireo Studio JavaScript SDK.
//
// Uses node:test + node:assert/strict.  All network calls are stubbed
// via globalThis.fetch so the tests run without a real server.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { VireoClient, VireoError } from "../src/sdk.js";

// =====================================================================
// Fetch stub — records calls and returns canned responses
// =====================================================================

let fetchCalls = [];
let fetchHandler = () => ({ ok: true, status: 200, headers: { get: () => "application/json" }, json: async () => ({ ok: true }) });

function stubFetch() {
  globalThis.fetch = async (url, opts) => {
    fetchCalls.push({ url, ...opts });
    // Respect AbortController signal so timeout tests work
    if (opts && opts.signal) {
      if (opts.signal.aborted) {
        const e = new DOMException("The operation was aborted.", "AbortError");
        throw e;
      }
      return new Promise((resolve, reject) => {
        opts.signal.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        }, { once: true });
        // Run the handler and resolve when it completes
        Promise.resolve(fetchHandler()).then(resolve, reject);
      });
    }
    return fetchHandler();
  };
}

function jsonResponse(data, status = 200, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h) => headers[h] || (h === "content-type" ? "application/json" : null) },
    json: async () => data,
  };
}

function errorResponse(status, body = {}) {
  return {
    ok: false,
    status,
    headers: { get: (h) => (h === "content-type" ? "application/json" : null) },
    json: async () => body,
  };
}

beforeEach(() => {
  fetchCalls = [];
  fetchHandler = () => jsonResponse({ ok: true });
  stubFetch();
});

// =====================================================================
// Tests
// =====================================================================

// 1. VireoClient instantiates with baseUrl
test("VireoClient instantiates with baseUrl", () => {
  const client = new VireoClient({ baseUrl: "https://api.example.com" });
  assert.equal(client.baseUrl, "https://api.example.com");
});

// 2. VireoClient instantiates with apiKey
test("VireoClient instantiates with apiKey", () => {
  const client = new VireoClient({ baseUrl: "https://api.example.com", apiKey: "sk-test" });
  assert.equal(client.apiKey, "sk-test");
});

// 3. videos.create sends POST
test("videos.create sends POST to /api/videos", async () => {
  const client = new VireoClient({ baseUrl: "https://api.example.com" });
  fetchHandler = () => jsonResponse({ id: "v1", title: "Hello" });
  await client.videos.create("Hello", { format: "mp4" });

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].method, "POST");
  assert.ok(fetchCalls[0].url.includes("/api/videos"));
  const body = JSON.parse(fetchCalls[0].body);
  assert.equal(body.title, "Hello");
  assert.equal(body.format, "mp4");
});

// 4. videos.list sends GET with params
test("videos.list sends GET with query params", async () => {
  const client = new VireoClient({ baseUrl: "https://api.example.com" });
  fetchHandler = () => jsonResponse({ items: [] });
  await client.videos.list({ page: 2, limit: 10 });

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].method, "GET");
  assert.ok(fetchCalls[0].url.includes("/api/videos?page=2&limit=10"));
});

// 5. videos.get sends GET with id
test("videos.get sends GET with video id", async () => {
  const client = new VireoClient({ baseUrl: "https://api.example.com" });
  fetchHandler = () => jsonResponse({ id: "v42" });
  const res = await client.videos.get("v42");

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].method, "GET");
  assert.ok(fetchCalls[0].url.includes("/api/videos/v42"));
  assert.equal(res.id, "v42");
});

// 6. videos.update sends PATCH
test("videos.update sends PATCH with body", async () => {
  const client = new VireoClient({ baseUrl: "https://api.example.com" });
  fetchHandler = () => jsonResponse({ id: "v1", title: "Updated" });
  await client.videos.update("v1", { title: "Updated" });

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].method, "PATCH");
  assert.ok(fetchCalls[0].url.includes("/api/videos/v1"));
  const body = JSON.parse(fetchCalls[0].body);
  assert.equal(body.title, "Updated");
});

// 7. videos.delete sends DELETE
test("videos.delete sends DELETE", async () => {
  const client = new VireoClient({ baseUrl: "https://api.example.com" });
  await client.videos.delete("v1");

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].method, "DELETE");
  assert.ok(fetchCalls[0].url.includes("/api/videos/v1"));
});

// 8. videos.export sends POST with options
test("videos.export sends POST with export options", async () => {
  const client = new VireoClient({ baseUrl: "https://api.example.com" });
  fetchHandler = () => jsonResponse({ jobId: "j1" });
  const res = await client.videos.export("v1", { format: "4k", codec: "h265" });

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].method, "POST");
  assert.ok(fetchCalls[0].url.includes("/api/videos/v1/export"));
  const body = JSON.parse(fetchCalls[0].body);
  assert.equal(body.format, "4k");
  assert.equal(res.jobId, "j1");
});

// 9. publish.toPlatform sends POST
test("publish.toPlatform sends POST to /api/publish", async () => {
  const client = new VireoClient({ baseUrl: "https://api.example.com" });
  fetchHandler = () => jsonResponse({ publishId: "p1" });
  await client.publish.toPlatform({ platform: "youtube", videoId: "v1" });

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].method, "POST");
  assert.ok(fetchCalls[0].url.includes("/api/publish"));
});

// 10. publish.status sends GET
test("publish.status sends GET to /api/publish/:id/status", async () => {
  const client = new VireoClient({ baseUrl: "https://api.example.com" });
  fetchHandler = () => jsonResponse({ status: "processing" });
  const res = await client.publish.status("p1");

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].method, "GET");
  assert.ok(fetchCalls[0].url.includes("/api/publish/p1/status"));
  assert.equal(res.status, "processing");
});

// 11. chat.send sends POST with message
test("chat.send sends POST with message body", async () => {
  const client = new VireoClient({ baseUrl: "https://api.example.com" });
  fetchHandler = () => jsonResponse({ reply: "Hi!" });
  const res = await client.chat.send("Hello AI", { context: "edit" });

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].method, "POST");
  const body = JSON.parse(fetchCalls[0].body);
  assert.equal(body.message, "Hello AI");
  assert.equal(body.context, "edit");
  assert.equal(res.reply, "Hi!");
});

// 12. retry on network error
test("retries on network error up to maxRetries", async () => {
  let attempts = 0;
  fetchHandler = async () => {
    attempts++;
    throw new TypeError("fetch failed");
  };

  const client = new VireoClient({ baseUrl: "https://api.example.com", maxRetries: 2, timeout: 60_000 });
  try {
    await client.videos.get("v1");
    assert.fail("should have thrown");
  } catch (err) {
    assert.ok(err instanceof VireoError);
    assert.equal(err.code, "NETWORK_ERROR");
  }

  // 1 initial + 2 retries = 3 total attempts
  assert.equal(attempts, 3);
});

// 13. timeout after 30s (we test with 1ms to avoid real 30s wait)
test("throws VireoError TIMEOUT after timeout", async () => {
  // Override AbortController so signal never fires abort internally
  // Instead, make fetch hang until the controller fires.
  fetchHandler = () => new Promise(() => {}); // never resolves

  const client = new VireoClient({ baseUrl: "https://api.example.com", maxRetries: 0, timeout: 1 });
  try {
    await client.health.check();
    assert.fail("should have thrown");
  } catch (err) {
    assert.ok(err instanceof VireoError);
    assert.equal(err.code, "TIMEOUT");
    assert.ok(err.message.includes("timed out"));
  }
});

// 14. VireoError has status, message, code
test("VireoError carries status, message, code", () => {
  const err = new VireoError("Not found", 404, "VIDEO_NOT_FOUND");
  assert.equal(err.message, "Not found");
  assert.equal(err.status, 404);
  assert.equal(err.code, "VIDEO_NOT_FOUND");
  assert.equal(err.name, "VireoError");
  assert.ok(err instanceof Error);
});

// 15. health.check sends GET /health
test("health.check sends GET /health", async () => {
  const client = new VireoClient({ baseUrl: "https://api.example.com" });
  fetchHandler = () => jsonResponse({ status: "ok", uptime: 12345 });
  const res = await client.health.check();

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].method, "GET");
  assert.ok(fetchCalls[0].url.endsWith("/health"));
  assert.equal(res.status, "ok");
});

// 16. versions.list sends GET
test("versions.list sends GET to /api/videos/:id/versions", async () => {
  const client = new VireoClient({ baseUrl: "https://api.example.com" });
  fetchHandler = () => jsonResponse({ versions: [{ id: "v1" }] });
  const res = await client.versions.list("v1");

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].method, "GET");
  assert.ok(fetchCalls[0].url.includes("/api/videos/v1/versions"));
  assert.equal(res.versions.length, 1);
});

// 17. versions.save sends POST
test("versions.save sends POST with name", async () => {
  const client = new VireoClient({ baseUrl: "https://api.example.com" });
  fetchHandler = () => jsonResponse({ id: "ver-1", name: "v1.0" });
  await client.versions.save("v1", "v1.0");

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].method, "POST");
  assert.ok(fetchCalls[0].url.includes("/api/videos/v1/versions"));
  const body = JSON.parse(fetchCalls[0].body);
  assert.equal(body.name, "v1.0");
});

// 18. comments.add sends POST
test("comments.add sends POST to /api/comments", async () => {
  const client = new VireoClient({ baseUrl: "https://api.example.com" });
  fetchHandler = () => jsonResponse({ id: "c1" });
  await client.comments.add({ videoId: "v1", text: "Nice!" });

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].method, "POST");
  assert.ok(fetchCalls[0].url.includes("/api/comments"));
  const body = JSON.parse(fetchCalls[0].body);
  assert.equal(body.text, "Nice!");
});

// 19. comments.list sends GET
test("comments.list sends GET to /api/videos/:id/comments", async () => {
  const client = new VireoClient({ baseUrl: "https://api.example.com" });
  fetchHandler = () => jsonResponse({ comments: [] });
  await client.comments.list("v1");

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].method, "GET");
  assert.ok(fetchCalls[0].url.includes("/api/videos/v1/comments"));
});

// 20. schedule.create sends POST
test("schedule.create sends POST to /api/schedule", async () => {
  const client = new VireoClient({ baseUrl: "https://api.example.com" });
  fetchHandler = () => jsonResponse({ id: "sch-1" });
  await client.schedule.create({ videoId: "v1", publishAt: "2026-01-01T00:00:00Z" });

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].method, "POST");
  assert.ok(fetchCalls[0].url.includes("/api/schedule"));
  const body = JSON.parse(fetchCalls[0].body);
  assert.equal(body.publishAt, "2026-01-01T00:00:00Z");
});
