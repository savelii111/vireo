// Vireo Ingest — tests.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildServer, PieceStore } from "../src/server.js";
import { setTimeout as sleep } from "node:timers/promises";

function client(server) {
  const addr = server.address();
  return {
    get: (path, headers = {}) => fetch(`http://127.0.0.1:${addr.port}${path}`, { headers }),
    post: (path, body, headers = {}) => fetch(`http://127.0.0.1:${addr.port}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  };
}

// Build a multipart/form-data body.
function multipart(fields, boundary) {
  const parts = [];
  for (const [name, value] of Object.entries(fields)) {
    if (value && typeof value === "object" && value.filename) {
      parts.push(`--${boundary}\r\n`);
      parts.push(`Content-Disposition: form-data; name="${name}"; filename="${value.filename}"\r\n`);
      parts.push(`Content-Type: ${value.contentType || "application/octet-stream"}\r\n\r\n`);
      // value.data is a Buffer
      parts.push(value.data);
      parts.push("\r\n");
    } else {
      parts.push(`--${boundary}\r\n`);
      parts.push(`Content-Disposition: form-data; name="${name}"\r\n\r\n`);
      parts.push(String(value));
      parts.push("\r\n");
    }
  }
  parts.push(`--${boundary}--\r\n`);
  const body = parts.map((p) => typeof p === "string" ? Buffer.from(p, "utf-8") : p);
  return Buffer.concat(body);
}

// ---- PieceStore ----

test("PieceStore: add, get, bySource, clear", () => {
  const s = new PieceStore();
  s.add({ id: "p1", source_id: "src1", text: "hi" });
  s.add({ id: "p2", source_id: "src1", text: "ho" });
  s.add({ id: "p3", source_id: "src2", text: "ha" });
  assert.equal(s.size(), 3);
  assert.equal(s.all().length, 3);
  assert.equal(s.bySource("src1").length, 2);
  assert.equal(s.bySource("nope").length, 0);
  s.clear();
  assert.equal(s.size(), 0);
});

// ---- /health, /formats, /pieces ----

test("GET /health returns 200 with piece count", async () => {
  const { server } = buildServer({ port: 0 });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/health");
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.status, "ok");
  assert.equal(body.agent, "ingest");
  assert.equal(body.pieces, 0);
  await new Promise((r) => server.close(r));
});

test("GET /formats returns known formats", async () => {
  const { server } = buildServer({ port: 0 });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/formats");
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(body.formats[".mp3"]);
  assert.equal(body.formats[".mp3"].category, "audio");
  assert.equal(body.formats[".mp4"].category, "video");
  await new Promise((r) => server.close(r));
});

test("GET /pieces returns empty initially", async () => {
  const { server } = buildServer({ port: 0 });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/pieces");
  const body = await r.json();
  assert.deepEqual(body.pieces, []);
  await new Promise((r) => server.close(r));
});

// ---- /ingest/text ----

test("POST /ingest/text creates one piece for short text", async () => {
  const { server } = buildServer({ port: 0 });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.post("/ingest/text", { text: "Hello world this is a test." });
  assert.equal(r.status, 201);
  const body = await r.json();
  assert.equal(body.pieces.length, 1);
  assert.equal(body.pieces[0].text, "Hello world this is a test.");
  assert.ok(body.pieces[0].id.startsWith("piece_"));
  await new Promise((r) => server.close(r));
});

test("POST /ingest/text splits long text into chunks", async () => {
  const { server } = buildServer({ port: 0 });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  // 300 words = 2-3 chunks
  const text = Array.from({ length: 300 }, (_, i) => `Word${i}.`).join(" ");
  const r = await c.post("/ingest/text", { text, chunk_words: 100 });
  assert.equal(r.status, 201);
  const body = await r.json();
  assert.ok(body.pieces.length >= 2);
  for (const p of body.pieces) {
    assert.match(p.title, /part \d+\/\d+/);
  }
  await new Promise((r) => server.close(r));
});

test("POST /ingest/text returns 400 for missing text", async () => {
  const { server } = buildServer({ port: 0 });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.post("/ingest/text", {});
  assert.equal(r.status, 400);
  await new Promise((r) => server.close(r));
});

test("POST /ingest/text uses provided source_id and language", async () => {
  const { server } = buildServer({ port: 0 });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.post("/ingest/text", {
    text: "Привет мир! Это тест.",
    source_id: "my-source",
    language: "ru",
    title: "Приветствие",
  });
  assert.equal(r.status, 201);
  const body = await r.json();
  assert.equal(body.source_id, "my-source");
  assert.equal(body.pieces[0].language, "ru");
  assert.equal(body.pieces[0].title, "Приветствие");
  await new Promise((r) => server.close(r));
});

test("GET /pieces/by-source/:id returns matching pieces", async () => {
  const { server } = buildServer({ port: 0 });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  await c.post("/ingest/text", { text: "Source one", source_id: "src-1" });
  await c.post("/ingest/text", { text: "Source two", source_id: "src-2" });
  const r = await c.get("/pieces/by-source/src-1");
  const body = await r.json();
  assert.equal(body.pieces.length, 1);
  assert.equal(body.pieces[0].source_id, "src-1");
  await new Promise((r) => server.close(r));
});

// ---- /transcribe (multipart) ----

test("POST /transcribe with .txt file ingests as text", async () => {
  const { server } = buildServer({ port: 0 });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const boundary = "test-boundary-123";
  const body = multipart({
    file: {
      filename: "notes.txt",
      contentType: "text/plain",
      data: Buffer.from("Hello, this is a test transcript. It has multiple sentences. Yes it does."),
    },
  }, boundary);
  const r = await fetch(`http://127.0.0.1:${server.address().port}/transcribe`, {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body,
  });
  assert.equal(r.status, 201);
  const json = await r.json();
  assert.equal(json.format.category, "text");
  assert.ok(json.pieces.length >= 1);
  assert.match(json.pieces[0].text, /Hello/);
  await new Promise((r) => server.close(r));
});

test("POST /transcribe with audio file calls transcribeFn and stores pieces", async () => {
  let called = null;
  const transcribeFn = async (filename, data, opts) => {
    called = { filename, size: data.length, opts };
    return {
      text: "Today we are testing things. This is the second sentence. And a third one.",
      language: "en",
      duration_sec: 30.0,
      cost_cents: 0.03,
      segments: [
        { start: 0.0, end: 5.0, text: "Today we are testing things." },
        { start: 5.0, end: 15.0, text: "This is the second sentence." },
        { start: 15.0, end: 30.0, text: "And a third one." },
      ],
    };
  };
  const { server } = buildServer({ port: 0, transcribeFn });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const boundary = "test-boundary-456";
  const body = multipart({
    file: { filename: "episode.mp3", contentType: "audio/mpeg", data: Buffer.from("fake-mp3-bytes") },
    language: "en",
    source_id: "ep-1",
    title: "Episode 1",
  }, boundary);
  const r = await fetch(`http://127.0.0.1:${server.address().port}/transcribe`, {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body,
  });
  assert.equal(r.status, 201);
  const json = await r.json();
  assert.equal(called.filename, "episode.mp3");
  assert.equal(called.opts.sourceId, "ep-1");
  assert.equal(json.transcript.text.length > 0, true);
  assert.equal(json.transcript.segments.length, 3);
  assert.equal(json.transcript.cost_cents, 0.03);
  assert.equal(json.format.category, "audio");
  assert.ok(json.pieces.length >= 1);
  // All pieces should have source_id = "ep-1"
  for (const p of json.pieces) {
    assert.equal(p.source_id, "ep-1");
    assert.equal(p.language, "en");
  }
  await new Promise((r) => server.close(r));
});

test("POST /transcribe with video file works", async () => {
  const transcribeFn = async () => ({
    text: "Video transcript here. Second sentence. Third sentence for good measure.",
    language: "en",
    duration_sec: 60.0,
    cost_cents: 0.06,
    segments: [],
  });
  const { server } = buildServer({ port: 0, transcribeFn });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const boundary = "vid-boundary";
  const body = multipart({
    file: { filename: "video.mp4", contentType: "video/mp4", data: Buffer.from("fake-video-bytes") },
  }, boundary);
  const r = await fetch(`http://127.0.0.1:${server.address().port}/transcribe`, {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body,
  });
  assert.equal(r.status, 201);
  const json = await r.json();
  assert.equal(json.format.category, "video");
  await new Promise((r) => server.close(r));
});

test("POST /transcribe returns 400 for missing file", async () => {
  const { server } = buildServer({ port: 0 });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const boundary = "no-file-boundary";
  const body = multipart({ language: "en" }, boundary);
  const r = await fetch(`http://127.0.0.1:${server.address().port}/transcribe`, {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body,
  });
  assert.equal(r.status, 400);
  const json = await r.json();
  assert.equal(json.error, "missing_file");
  await new Promise((r) => server.close(r));
});

test("POST /transcribe returns 400 for non-multipart", async () => {
  const { server } = buildServer({ port: 0 });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const r = await fetch(`http://127.0.0.1:${server.address().port}/transcribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(r.status, 400);
  await new Promise((r) => server.close(r));
});

test("POST /transcribe returns 415 for unsupported format", async () => {
  const { server } = buildServer({ port: 0 });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const boundary = "weird-boundary";
  const body = multipart({
    file: { filename: "weird.xyz", data: Buffer.from("x") },
  }, boundary);
  const r = await fetch(`http://127.0.0.1:${server.address().port}/transcribe`, {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body,
  });
  assert.equal(r.status, 415);
  await new Promise((r) => server.close(r));
});

test("POST /transcribe returns 502 when transcribeFn throws", async () => {
  const transcribeFn = async () => { throw new Error("upstream down"); };
  const { server } = buildServer({ port: 0, transcribeFn });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const boundary = "fail-boundary";
  const body = multipart({
    file: { filename: "song.mp3", data: Buffer.from("x") },
  }, boundary);
  const r = await fetch(`http://127.0.0.1:${server.address().port}/transcribe`, {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body,
  });
  assert.equal(r.status, 502);
  const json = await r.json();
  assert.equal(json.error, "transcription_failed");
  assert.match(json.message, /upstream down/);
  await new Promise((r) => server.close(r));
});

// ---- 404 ----

test("GET /unknown returns 404", async () => {
  const { server } = buildServer({ port: 0 });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/nope");
  assert.equal(r.status, 404);
  await new Promise((r) => server.close(r));
});

// ---- OPTIONS ----

test("OPTIONS preflight returns 204", async () => {
  const { server } = buildServer({ port: 0 });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const r = await fetch(`http://127.0.0.1:${server.address().port}/transcribe`, { method: "OPTIONS" });
  assert.equal(r.status, 204);
  await new Promise((r) => server.close(r));
});

// ---- Custom store injection ----

test("buildServer accepts a custom PieceStore", async () => {
  const custom = new PieceStore();
  custom.add({ id: "preset", source_id: "x", text: "preset" });
  const { server } = buildServer({ port: 0, store: custom });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/pieces");
  const body = await r.json();
  assert.equal(body.pieces.length, 1);
  assert.equal(body.pieces[0].id, "preset");
  await new Promise((r) => server.close(r));
});
