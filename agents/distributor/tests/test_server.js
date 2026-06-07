// Integration tests for Distributor HTTP server.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildServer } from "../src/server.js";

const PORT = 18003;
const HOST = "127.0.0.1";

let bundle;

test.before(async () => {
  bundle = buildServer({ port: PORT, host: HOST });
  await new Promise((r) => bundle.server.listen(PORT, HOST, r));
});

test.after(() => {
  bundle?.server?.close();
});

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
  assert.deepEqual(r.json, { status: "ok", agent: "distributor" });
});

test("GET /version", async () => {
  const r = await req("GET", "/version");
  assert.equal(r.status, 200);
  assert.equal(r.json.version, "0.1.0");
});

test("GET /platforms", async () => {
  const r = await req("GET", "/platforms");
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json.platforms));
  assert.ok(r.json.platforms.length >= 5);
});

test("POST /distribute creates jobs", async () => {
  const editPlan = {
    source_id: "src-1",
    cuts: [{ start: 0, end: 10, text: "Hello world", score: 0.9, role: "hook" }],
    output_duration_sec: 10,
    style_applied: {},
    notes: "",
  };
  const styleDna = { tone: "energetic", topics: ["test"] };
  const r = await req("POST", "/distribute", {
    editPlan,
    styleDna,
    platforms: ["youtube", "x", "tiktok"],
    contentId: "test-1",
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.platforms, 3);
  assert.equal(r.json.jobs.length, 3);
});

test("POST /adapt returns platform-specific adaptations", async () => {
  const r = await req("POST", "/adapt", {
    edit_plan: {
      cuts: [
        { start: 0, end: 5, text: "Hook here", score: 0.9, role: "hook" },
        { start: 5, end: 15, text: "Body", score: 0.7, role: "body" },
      ],
      output_duration_sec: 15,
    },
    style_dna: { tone: "energetic", topics: ["AI"] },
    platforms: ["youtube", "x"],
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.count, 2);
  const xPiece = r.json.adapted.find((p) => p.platform === "x");
  assert.ok(xPiece.caption.length <= 280);
});

test("POST /schedule returns a slot", async () => {
  const r = await req("POST", "/schedule", { platform: "youtube" });
  assert.equal(r.status, 200);
  assert.match(r.json.scheduled_at, /^\d{4}-\d{2}-\d{2}T/);
});

test("GET /jobs lists jobs", async () => {
  const r = await req("GET", "/jobs?platform=youtube");
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json.jobs));
});

test("GET /audit returns EU AI Act log", async () => {
  const r = await req("GET", "/audit");
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json.log));
});

test("POST /distribute with bad payload returns 400", async () => {
  const r = await req("POST", "/distribute", { foo: "bar" });
  assert.equal(r.status, 400);
  assert.equal(r.json.ok, false);
});

test("Unknown route returns 404", async () => {
  const r = await req("GET", "/nope");
  assert.equal(r.status, 404);
});
