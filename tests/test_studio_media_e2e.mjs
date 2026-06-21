// End-to-end test for the Studio media endpoint.
//
// Verifies that HTML5 video can read real asset bytes through a query-token URL:
//   GET /api/assets/:id/media?access_token=<jwt>
// The route resolves :id -> DB asset row -> storage_path from TUS/ingest, never
// from user input, and streams bytes with Range support.

import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildServer } from "../agents/studio/src/server.js";
import { signToken } from "../packages/auth-middleware/index.js";

const SECRET = "studio-media-e2e-secret";

function mockLLM() {
  return {
    model: "mock",
    isMock: () => true,
    costUsd: () => 0,
    chat: async () => ({ content: "mock", tool_calls: null, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }),
    getUsage: () => ({}),
  };
}

function listen(server) {
  const sockets = new Set();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        port,
        close: () => new Promise((r) => {
          server.close(() => {
            for (const socket of sockets) socket.destroy();
            setImmediate(r);
          });
          setTimeout(() => {
            for (const socket of sockets) socket.destroy();
            setImmediate(r);
          }, 250).unref();
        }),
      });
    });
  });
}

function authHeader(userId, secret = SECRET) {
  return {
    Authorization: `Bearer ${signToken({ sub: userId, email: `${userId}@x.com` }, secret, 600)}`,
  };
}

function bearerFrom(headers) {
  return headers.Authorization.replace(/^Bearer\s+/i, "");
}

test("E2E: Studio media endpoint streams real asset bytes with query-token auth and Range", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "vireo-media-"));
  const fixturePath = path.join(tempDir, "sample_10s.mp4");
  const fixture = Buffer.alloc(2048);
  for (let i = 0; i < fixture.length; i += 1) fixture[i] = i % 251;
  writeFileSync(fixturePath, fixture);

  const previousMediaRoot = process.env.VIREO_MEDIA_ROOT;
  process.env.VIREO_MEDIA_ROOT = tempDir;

  const { server } = buildServer({ secret: SECRET, llm: mockLLM() });
  const { port, close } = await listen(server);
  const base = `http://127.0.0.1:${port}`;
  const token = bearerFrom(authHeader("alice"));

  try {
    const createRes = await fetch(`${base}/api/assets`, {
      method: "POST",
      headers: { ...authHeader("alice"), "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "sample_10s.mp4",
        storage_path: fixturePath,
        mime: "video/mp4",
        real_decode: true,
        video_codec: "h264",
        fps: 30,
        duration: 10,
        hasAudio: true,
      }),
    });
    const createText = await createRes.text();
    assert.equal(createRes.status, 201, createText);
    const { asset } = JSON.parse(createText);

    const mediaUrl = `${base}/api/assets/${asset.id}/media?access_token=${encodeURIComponent(token)}`;

    const fullRes = await fetch(mediaUrl);
    assert.equal(fullRes.status, 200, await fullRes.clone().text());
    assert.equal(fullRes.headers.get("content-type"), "video/mp4");
    assert.equal(fullRes.headers.get("accept-ranges"), "bytes");
    const fullBody = Buffer.from(await fullRes.arrayBuffer());
    assert.deepEqual(fullBody, fixture);

    const rangeRes = await fetch(mediaUrl, { headers: { Range: "bytes=0-1023" } });
    const rangeText = await rangeRes.clone().text();
    assert.equal(rangeRes.status, 206, rangeText);
    assert.equal(rangeRes.headers.get("content-range"), `bytes 0-1023/${fixture.length}`);
    const rangeBody = Buffer.from(await rangeRes.arrayBuffer());
    assert.equal(rangeBody.length, 1024);
    assert.deepEqual(rangeBody, fixture.subarray(0, 1024));

    const noTokenRes = await fetch(`${base}/api/assets/${asset.id}/media`);
    assert.equal(noTokenRes.status, 401);

    const badTokenRes = await fetch(`${base}/api/assets/${asset.id}/media?access_token=bad`);
    assert.equal(badTokenRes.status, 401);

    const traversalCreateRes = await fetch(`${base}/api/assets`, {
      method: "POST",
      headers: { ...authHeader("alice"), "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "outside.mp4",
        storage_path: "../outside.mp4",
        mime: "video/mp4",
        real_decode: true,
        video_codec: "h264",
        fps: 30,
        duration: 1,
        hasAudio: false,
      }),
    });
    assert.equal(traversalCreateRes.status, 201, await traversalCreateRes.clone().text());
    const { asset: traversalAsset } = JSON.parse(await traversalCreateRes.text());
    const traversalRes = await fetch(`${base}/api/assets/${traversalAsset.id}/media?access_token=${encodeURIComponent(token)}`);
    assert.equal(traversalRes.status, 404);
  } finally {
    await close();
    if (previousMediaRoot === undefined) delete process.env.VIREO_MEDIA_ROOT;
    else process.env.VIREO_MEDIA_ROOT = previousMediaRoot;
    rmSync(tempDir, { recursive: true, force: true });
  }
});
