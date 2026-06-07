// Integration tests for Analyst HTTP server.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildServer } from "../src/server.js";

const PORT = 18004;
const HOST = "127.0.0.1";

let bundle;
test.before(async () => {
  bundle = buildServer({ port: PORT, host: HOST });
  await new Promise((r) => bundle.server.listen(PORT, HOST, r));
});
test.after(() => bundle?.server?.close());

async function req(method, path, body) {
  const init = { method, headers: { "Content-Type": "application/json" } };
  if (body) init.body = JSON.stringify(body);
  const r = await fetch(`http://${HOST}:${PORT}${path}`, init);
  let json;
  try { json = await r.json(); } catch { json = null; }
  return { status: r.status, json };
}

test("GET /health", async () => {
  const r = await req("GET", "/health");
  assert.equal(r.status, 200);
  assert.equal(r.json.status, "ok");
});

test("GET /version", async () => {
  const r = await req("GET", "/version");
  assert.equal(r.json.version, "0.1.0");
});

test("POST /ingest stores a snapshot", async () => {
  const r = await req("POST", "/ingest", {
    content_id: "test-1",
    platform: "youtube",
    views: 1000,
    likes: 30,
    comments: 5,
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.snapshot.content_id, "test-1");
  assert.ok(r.json.snapshot.engagement_rate > 0);
});

test("POST /ingest-batch accepts array", async () => {
  const r = await req("POST", "/ingest-batch", {
    snapshots: [
      { content_id: "b-1", platform: "x", views: 100, likes: 5 },
      { content_id: "b-2", platform: "tiktok", views: 200, likes: 20 },
    ],
  });
  assert.equal(r.json.count, 2);
});

test("GET /report aggregates all snapshots", async () => {
  const r = await req("GET", "/report");
  assert.equal(r.json.ok, true);
  assert.ok(r.json.report.total_pieces >= 1);
  assert.ok(r.json.report.total_views > 0);
});

test("GET /report?platform=youtube filters", async () => {
  const r = await req("GET", "/report?platform=youtube");
  assert.equal(r.json.report.platform_filter, "youtube");
});

test("GET /content/:id returns snapshots for content", async () => {
  const r = await req("GET", "/content/test-1");
  assert.equal(r.json.content_id, "test-1");
  assert.ok(Array.isArray(r.json.snapshots));
});

test("GET /alerts returns alerts array", async () => {
  const r = await req("GET", "/alerts");
  assert.ok(Array.isArray(r.json.alerts));
});

test("POST /learn returns diff", async () => {
  const r = await req("POST", "/learn", {
    style_dna: { hook_patterns: ["curiosity"], topics: ["AI"] },
  });
  assert.equal(r.json.ok, true);
  assert.ok(r.json.current);
  assert.ok(r.json.recommended);
});

test("Unknown route 404", async () => {
  const r = await req("GET", "/nope");
  assert.equal(r.status, 404);
});

test("Bad JSON 400", async () => {
  const r = await fetch(`http://${HOST}:${PORT}/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "not json",
  });
  assert.equal(r.status, 400);
});
