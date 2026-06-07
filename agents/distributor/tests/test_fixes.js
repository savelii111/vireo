// Regression tests for Distributor audit fixes (2026-06-06).
// See docs/DISTRIBUTOR_AUDIT_2026-06-06.md for context on each bug.

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// P0-2: error status code propagation
import { buildServer as buildDistributorServer } from "../src/server.js";
// P1-7: hot-reloadable CORS in auth-middleware
import { corsHeadersFor, corsHeaders } from "@vireo/auth-middleware";
// P1-9: setThumbnail MIME + size
import { YouTubePublisher, YouTubeError } from "../src/platforms/youtube.js";
// P1-13: X processing polling
import { XPublisher, XError } from "../src/platforms/x.js";
// P1-15: Instagram poll timer cleanup
import { InstagramPublisher, InstagramError } from "../src/platforms/instagram.js";
// P1-25: platforms cap, P2-1: pagination, P2-4: deep copy
import { JobStore } from "../src/store.js";
import { Distributor } from "../src/distributor.js";
import { PLATFORMS } from "@vireo/shared";

const editPlan = {
  source_id: "src-1",
  cuts: [{ start: 0, end: 5, text: "Hook", score: 0.9, role: "hook" }],
  output_duration_sec: 5,
  style_applied: {},
  notes: "",
};
const styleDna = { tone: "energetic", topics: ["test"] };

// ─────────────────────────────────────────────────────────────────────
// P0-2: payload-too-large returns 413, not 400
// ─────────────────────────────────────────────────────────────────────
test("P0-2: /distribute returns 413 on payload too large (not 400)", async () => {
  const bundle = buildDistributorServer({ port: 0, host: "127.0.0.1" });
  // Use port 0 and a fixed listener so we know when it's ready
  const { port } = await new Promise((resolve) => {
    bundle.server.listen(0, "127.0.0.1", () => {
      resolve({ port: bundle.server.address().port });
    });
  });
  try {
    // 2MB payload — exceeds auth-middleware's default 1MB cap
    const huge = { editPlan, styleDna, platforms: ["youtube"], pad: "x".repeat(2 * 1024 * 1024) };
    const r = await fetch(`http://127.0.0.1:${port}/distribute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(huge),
    });
    assert.equal(r.status, 413, `expected 413, got ${r.status}`);
  } finally {
    await new Promise((r) => bundle.server.close(r));
  }
});

// ─────────────────────────────────────────────────────────────────────
// P1-7: hot-reloadable CORS via env var
// ─────────────────────────────────────────────────────────────────────
test("P1-7: corsHeadersFor echoes allowed origin (env-based, hot-reloadable)", () => {
  const origEnv = process.env.VIREO_CORS_ORIGINS;
  try {
    process.env.VIREO_CORS_ORIGINS = "https://app.vireo.io,https://staging.vireo.io";
    const r1 = corsHeadersFor({ headers: { origin: "https://app.vireo.io" } });
    assert.equal(r1["Access-Control-Allow-Origin"], "https://app.vireo.io");
    const r2 = corsHeadersFor({ headers: { origin: "https://evil.com" } });
    // Falls back to first allow-listed
    assert.equal(r2["Access-Control-Allow-Origin"], "https://app.vireo.io");
    // Vary header is set so caches don't return wrong origin
    assert.equal(r1["Vary"], "Origin");
  } finally {
    if (origEnv == null) delete process.env.VIREO_CORS_ORIGINS;
    else process.env.VIREO_CORS_ORIGINS = origEnv;
  }
});

test("P1-7: corsHeadersFor wildcard when no env set", () => {
  const origEnv = process.env.VIREO_CORS_ORIGINS;
  try {
    delete process.env.VIREO_CORS_ORIGINS;
    const r = corsHeadersFor({ headers: { origin: "https://anywhere.com" } });
    assert.equal(r["Access-Control-Allow-Origin"], "*");
  } finally {
    if (origEnv != null) process.env.VIREO_CORS_ORIGINS = origEnv;
  }
});

test("P1-7: legacy corsHeaders() still works (backward compat)", () => {
  const r = corsHeaders();
  assert.equal(r["Access-Control-Allow-Origin"], "*");
  assert.match(r["Access-Control-Allow-Headers"], /Authorization/);
});

// ─────────────────────────────────────────────────────────────────────
// P1-9: setThumbnail MIME validation + 2MB cap
// ─────────────────────────────────────────────────────────────────────
function makeTmp() {
  const dir = join(tmpdir(), "vireo_dx_test_" + Math.random().toString(36).slice(2, 8));
  mkdirSync(dir, { recursive: true });
  return dir;
}

test("P1-9: setThumbnail rejects .gif with clear error", async () => {
  const dir = makeTmp();
  const thumb = join(dir, "thumb.gif");
  writeFileSync(thumb, Buffer.from([0x47, 0x49, 0x46]));
  const yt = new YouTubePublisher({ accessToken: "t" });
  await assert.rejects(
    () => yt.setThumbnail("vid", thumb),
    (err) => err instanceof YouTubeError && err.code === "validation_error" && /gif/.test(err.message),
  );
  rmSync(dir, { recursive: true, force: true });
});

test("P1-9: setThumbnail rejects >2MB file", async () => {
  const dir = makeTmp();
  const thumb = join(dir, "big.png");
  writeFileSync(thumb, Buffer.alloc(3 * 1024 * 1024, 0xff));
  const yt = new YouTubePublisher({ accessToken: "t" });
  await assert.rejects(
    () => yt.setThumbnail("vid", thumb),
    (err) => err instanceof YouTubeError && /too large/.test(err.message),
  );
  rmSync(dir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────
// P1-13: X media processing polling
// ─────────────────────────────────────────────────────────────────────
test("P1-13: X uploadMedia polls processing_info until succeeded", async () => {
  const dir = makeTmp();
  const file = join(dir, "video.mp4");
  writeFileSync(file, Buffer.from("fake video bytes"));
  let calls = 0;
  const transport = async (method, url, opts = {}) => {
    calls++;
    const body = typeof opts.body === "string" ? opts.body : "";
    if (body.includes("command=INIT")) {
      return { status: 202, body: { media_id_string: "12345" }, headers: { get: () => null } };
    }
    if (body.includes("command=FINALIZE")) {
      return { status: 200, body: { processing_info: { state: "in_progress", check_after_secs: 1 } }, headers: { get: () => null } };
    }
    if (method === "GET" && url.includes("STATUS")) {
      // Return "in_progress" for first few polls, then "succeeded"
      if (calls < 6) {
        return { status: 200, body: { processing_info: { state: "in_progress", check_after_secs: 1 } }, headers: { get: () => null } };
      }
      return { status: 200, body: { processing_info: { state: "succeeded" } }, headers: { get: () => null } };
    }
    // APPEND returns 204
    return { status: 204, body: {}, headers: { get: () => null } };
  };
  const x = new XPublisher({ accessToken: "t", transport });
  const mediaId = await x.uploadMedia(file, "video/mp4", 1024 * 1024);
  assert.equal(mediaId, "12345");
  rmSync(dir, { recursive: true, force: true });
});

test("P1-13: X uploadMedia returns immediately when no processing_info", async () => {
  const dir = makeTmp();
  const file = join(dir, "img.png");
  writeFileSync(file, Buffer.from("x"));
  const transport = async (method, url, opts = {}) => {
    const body = typeof opts.body === "string" ? opts.body : "";
    if (body.includes("command=INIT")) return { status: 202, body: { media_id_string: "99" }, headers: { get: () => null } };
    if (body.includes("command=FINALIZE")) return { status: 200, body: {}, headers: { get: () => null } };
    return { status: 204, body: {}, headers: { get: () => null } };
  };
  const x = new XPublisher({ accessToken: "t", transport });
  const start = Date.now();
  const mediaId = await x.uploadMedia(file, "image/png", 1024);
  assert.equal(mediaId, "99");
  assert.ok(Date.now() - start < 2000, "should not poll when no processing_info");
  rmSync(dir, { recursive: true, force: true });
});

test("P1-13: X uploadMedia throws on processing failure", async () => {
  const dir = makeTmp();
  const file = join(dir, "v.mp4");
  writeFileSync(file, Buffer.from("x"));
  const transport = async (method, url, opts = {}) => {
    const body = typeof opts.body === "string" ? opts.body : "";
    if (body.includes("command=INIT")) return { status: 202, body: { media_id_string: "1" }, headers: { get: () => null } };
    if (body.includes("command=FINALIZE")) {
      return { status: 200, body: { processing_info: { state: "in_progress", check_after_secs: 1 } }, headers: { get: () => null } };
    }
    if (url.includes("STATUS")) {
      return { status: 200, body: { processing_info: { state: "failed", error: { message: "codec not supported" } } }, headers: { get: () => null } };
    }
    return { status: 204, body: {}, headers: { get: () => null } };
  };
  const x = new XPublisher({ accessToken: "t", transport });
  await assert.rejects(
    () => x.uploadMedia(file, "video/mp4", 1024),
    (err) => err instanceof XError && err.code === "processing_failed",
  );
  rmSync(dir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────
// P1-15: Instagram poll timer cleanup
// ─────────────────────────────────────────────────────────────────────
test("P1-15: Instagram poll timer is cleared on early ERROR (event loop released)", async () => {
  const transport = async (method, url) => {
    // First call: publish container (returns 200 with id)
    if (url.includes("media") && method === "POST") {
      return { status: 200, body: { id: "container_1" }, headers: { get: () => null } };
    }
    // Status check: immediately returns ERROR
    return { status: 200, body: { status_code: "ERROR" }, headers: { get: () => null } };
  };
  const ig = new InstagramPublisher({ accessToken: "t", igUserId: "u", transport });
  const start = Date.now();
  await assert.rejects(
    () => ig.publishReel({ videoUrl: "https://example.com/v.mp4", caption: "x" }),
    (err) => err instanceof InstagramError && err.code === "container_failed",
  );
  const elapsed = Date.now() - start;
  // If the timer leak is present, this takes ~5s (the leaked setTimeout fires).
  // With the fix, it should return quickly.
  assert.ok(elapsed < 2000, `Instagram returned in ${elapsed}ms — timer leak present?`);
});

// ─────────────────────────────────────────────────────────────────────
// P1-25: platforms cap (DoS protection)
// ─────────────────────────────────────────────────────────────────────
test("P1-25: distribute rejects >64 platforms (DoS cap)", () => {
  const s = new JobStore();
  const d = new Distributor(s);
  const huge = Array.from({ length: 100 }, (_, i) => `platform_${i}`);
  assert.throws(
    () => d.distribute({ editPlan, styleDna, platforms: huge, contentId: "c" }),
    /too many platforms.*max 64/,
  );
});

test("P1-25: distribute rejects empty platforms array", () => {
  const s = new JobStore();
  const d = new Distributor(s);
  assert.throws(
    () => d.distribute({ editPlan, styleDna, platforms: [], contentId: "c" }),
    /non-empty array/,
  );
});

test("P1-25: distribute rejects non-array platforms", () => {
  const s = new JobStore();
  const d = new Distributor(s);
  assert.throws(
    () => d.distribute({ editPlan, styleDna, platforms: "youtube", contentId: "c" }),
    /non-empty array/,
  );
});

// ─────────────────────────────────────────────────────────────────────
// P2-1: listPaged pagination
// ─────────────────────────────────────────────────────────────────────
test("P2-1: listPaged returns correct items + total + has_more", () => {
  const s = new JobStore();
  for (let i = 0; i < 25; i++) {
    s.add({ platform: "youtube", scheduled_at: `2026-06-15T${String(i).padStart(2, "0")}:00:00Z`, content_id: `c${i}` });
  }
  const p1 = s.listPaged({ offset: 0, limit: 10 });
  assert.equal(p1.items.length, 10);
  assert.equal(p1.total, 25);
  assert.equal(p1.has_more, true);
  const p2 = s.listPaged({ offset: 20, limit: 10 });
  assert.equal(p2.items.length, 5);
  assert.equal(p2.has_more, false);
});

test("P2-1: listPaged clamps limit to 500 max", () => {
  const s = new JobStore();
  const p = s.listPaged({ limit: 99999 });
  assert.equal(p.limit, 500);
});

test("P2-1: listPaged applies filter + pagination", () => {
  const s = new JobStore();
  for (let i = 0; i < 5; i++) s.add({ platform: "youtube", scheduled_at: "2026-06-15T00:00:00Z" });
  for (let i = 0; i < 3; i++) s.add({ platform: "x", scheduled_at: "2026-06-15T00:00:00Z" });
  const p = s.listPaged({ platform: "x", limit: 10 });
  assert.equal(p.items.length, 3);
  assert.equal(p.total, 3);
  assert.equal(p.has_more, false);
});

// ─────────────────────────────────────────────────────────────────────
// P2-4: auditLog returns deep copies (mutations don't corrupt store)
// ─────────────────────────────────────────────────────────────────────
test("P2-4: auditLog returns deep copies — mutating returned item doesn't affect store", async () => {
  const s = new JobStore();
  s.add({ platform: "youtube", scheduled_at: "2020-01-01T00:00:00Z", content_id: "c1" });
  const { mockPublisher } = await import("../src/mock_publisher.js");
  await s.tick(new Date(), mockPublisher);

  const log1 = s.auditLog();
  assert.equal(log1.length, 1);
  // Mutate the returned object
  log1[0].platform_post_id = "MUTATED";
  log1[0].ai_generated = false;

  // Store should be unaffected
  const log2 = s.auditLog();
  assert.notEqual(log2[0].platform_post_id, "MUTATED");
  assert.equal(log2[0].ai_generated, true);
});

// ─────────────────────────────────────────────────────────────────────
// P2-6: /tick endpoint actually exists and works
// ─────────────────────────────────────────────────────────────────────
test("P2-6: POST /tick runs due jobs and returns count", async () => {
  const bundle = buildDistributorServer({ port: 0, host: "127.0.0.1" });
  const { port } = await new Promise((resolve) => {
    bundle.server.listen(0, "127.0.0.1", () => resolve({ port: bundle.server.address().port }));
  });
  try {
    // First, create some jobs and force them to be due
    const dist = bundle.dist;
    dist.distribute({ editPlan, styleDna, platforms: ["youtube", "x"], contentId: "c1" });
    // Use the internal store to force-past dates
    for (const j of bundle.store.list()) {
      bundle.store.update(j.id, { scheduled_at: "2020-01-01T00:00:00Z" });
    }
    const r = await fetch(`http://127.0.0.1:${port}/tick`, { method: "POST" });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.ok, true);
    assert.equal(body.published, 2);
  } finally {
    await new Promise((r) => bundle.server.close(r));
  }
});
