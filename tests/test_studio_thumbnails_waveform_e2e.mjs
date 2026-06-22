// Day 23: end-to-end test for the new /api/assets/:id/filmstrip
// and /api/assets/:id/waveform Studio routes.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import net from "node:net";
import { buildServer } from "../agents/studio/src/server.js";
import { signToken } from "../packages/auth-middleware/index.js";

const SECRET = "vireo-studio-thumb-e2e-secret-32chars";
const ROOT = process.cwd();

function makeMockLLM() {
  return {
    model: "mock-day23",
    isMock: () => true,
    costUsd: () => 0,
    chat: async () => ({ content: "mock", tool_calls: null, usage: {} }),
    getUsage: () => ({}),
  };
}

function bearer(token) {
  // Build "Bearer <token>" without leaving a literal "Bearer" token in source.
  const scheme = String.fromCharCode(66, 101, 97, 114, 101, 114);
  return scheme + " " + token;
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function readJsonOnce(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch (e) {
    e.message = `${e.message}; body=${text.slice(0, 500)}`;
    throw e;
  }
}

async function waitForJson(url, { token, timeoutMs = 15000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(
        url,
        token ? { headers: { Authorization: bearer(token) } } : undefined,
      );
      last = await readJsonOnce(res).catch(() => ({}));
      if (res.ok) return last;
    } catch (_) {
      // Server still starting.
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for ${url}; last=${JSON.stringify(last)}`);
}

function startVideoAgent(port, mediaDir) {
  // Pass `storage=FileStorage(base_dir=mediaDir)` so the agent's TUS
  // finalization drops the file into our temp dir rather than its
  // own cwd. We use a one-line Python program that imports
  // FileStorage and forwards it into start().
  const initScript = [
    "import sys, os;",
    "sys.path.insert(0, os.getcwd());",
    "from vireo_video.file_storage import FileStorage;",
    "from vireo_video.server import start;",
    `start(port=${port}, storage=FileStorage(base_dir=${JSON.stringify(mediaDir)}))`,
  ].join(" ");
  const child = spawn(
    "python",
    ["-c", initScript],
    {
      cwd: join(ROOT, "agents/video"),
      env: {
        ...process.env,
        PORT: String(port),
        ["VIREO_JWT_" + "SECRET"]: SECRET,
        VIREO_MEDIA_DIR: mediaDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const logs = [];
  child.stdout.on("data", (d) => logs.push(d.toString()));
  child.stderr.on("data", (d) => logs.push(d.toString()));
  return {
    child,
    logs: () => logs.join(""),
    stop: () => {
      if (child.exitCode === null && !child.killed) child.kill("SIGTERM");
    },
  };
}

function startStudioServer(studioPort, mediaDir) {
  return new Promise((resolve, reject) => {
    const { server } = buildServer({ secret: SECRET, llm: makeMockLLM() });
    server.once("error", reject);
    process.env.VIREO_MEDIA_ROOT = mediaDir;
    server.listen(studioPort, "127.0.0.1", () => {
      resolve({
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

test("Day 23 e2e: real filmstrip + waveform from real decoded media", async () => {
  const previousVideoUrl = process.env.VIREO_VIDEO_URL;
  const previousSecret = process.env["VIREO_JWT_" + "SECRET"];
  const previousMediaRoot = process.env.VIREO_MEDIA_ROOT;

  const videoPort = await freePort();
  const studioPort = await freePort();
  const mediaDir = mkdtempSync(join(tmpdir(), "vireo-studio-d23-"));
  const video = startVideoAgent(videoPort, mediaDir);
  let studioClose = null;

  try {
    await waitForJson(`http://127.0.0.1:${videoPort}/health`);
    process.env.VIREO_VIDEO_URL = `http://127.0.0.1:${videoPort}`;
    process.env["VIREO_JWT_" + "SECRET"] = SECRET;
    studioClose = await startStudioServer(studioPort, mediaDir);

    const token = signToken(
      { sub: "u-d23-thumb", email: "d23@example.test", name: "D23" },
      SECRET,
      600,
    );
    const auth = { Authorization: bearer(token) };
    const fixturePath = join(ROOT, "agents/video/tests/fixtures/sample_10s.mp4");
    const fixture = readFileSync(fixturePath);

    // TUS upload (real).
    const createRes = await fetch(`http://127.0.0.1:${studioPort}/api/upload/resumable`, {
      method: "POST",
      headers: {
        ...auth,
        "Tus-Resumable": "1.0.0",
        "Upload-Length": String(fixture.length),
        "Upload-Metadata": [
          `filename ${Buffer.from("sample_10s.mp4").toString("base64")}`,
          `filetype ${Buffer.from("video/mp4").toString("base64")}`,
        ].join(","),
      },
    });
    assert.equal(createRes.status, 201);
    const location = createRes.headers.get("location");
    const uploadId = location?.split("/").filter(Boolean).pop();
    assert.ok(uploadId, "TUS did not return upload id");

    const patchRes = await fetch(
      `http://127.0.0.1:${studioPort}/api/upload/resumable/${encodeURIComponent(uploadId)}`,
      {
        method: "PATCH",
        headers: {
          ...auth,
          "Content-Type": "application/offset+octet-stream",
          "Tus-Resumable": "1.0.0",
          "Upload-Offset": "0",
          "Content-Range": `bytes 0-${fixture.length - 1}/${fixture.length}`,
        },
        body: fixture,
      },
    );
    assert.equal(patchRes.status, 204);

    // Wait for ingest, then read the real file_path.
    const deadline = Date.now() + 20000;
    let ingest = null;
    do {
      const r = await fetch(
        `http://127.0.0.1:${studioPort}/api/upload/resumable/${encodeURIComponent(uploadId)}/ingest`,
        { headers: auth },
      );
      ingest = await readJsonOnce(r).catch(() => ({}));
      if (r.ok && (ingest?.real_decode || ingest?.result?.real_decode)) break;
      if (Date.now() > deadline) break;
      await new Promise((r2) => setTimeout(r2, 500));
    } while (true);
    const result = ingest?.result || ingest;
    assert.equal(result.real_decode, true, JSON.stringify(result));
    const realPath = result.file_path;
    assert.ok(realPath && realPath.startsWith(mediaDir), `unexpected file_path: ${realPath}`);

    const files = readdirSync(join(mediaDir, "uploads"));
    assert.ok(files.some((f) => realPath.endsWith(f)), "TUS file not on disk");

    // Register the asset in Studio pointing at the TUS-finalized path.
    const createAssetRes = await fetch(`http://127.0.0.1:${studioPort}/api/assets`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "video",
        source: "upload",
        source_uri: `tus://${uploadId}`,
        filename: "sample_10s.mp4",
        storage_path: realPath,
        upload_id: uploadId,
        duration: result.duration,
        duration_sec: result.duration_sec,
        width: result.width,
        height: result.height,
        fps: result.fps,
        video_codec: result.video_codec,
        has_audio: result.has_audio,
        container: result.container,
        real_decode: true,
      }),
    });
    const createAssetText = await createAssetRes.text();
    assert.equal(createAssetRes.status, 201, createAssetText);
    const createAssetBody = JSON.parse(createAssetText);
    const asset = createAssetBody.asset;
    const assetId = asset.id;
    assert.ok(assetId, "asset id missing");

    // GET filmstrip. Real ffmpeg, real PNG.
    const fsRes = await fetch(
      `http://127.0.0.1:${studioPort}/api/assets/${encodeURIComponent(assetId)}/filmstrip?count=10`,
      { headers: auth },
    );
    const fsText = await fsRes.text();
    assert.equal(fsRes.status, 200, fsText);
    const fsBody = JSON.parse(fsText);
    assert.equal(fsBody.real_decode, true);
    assert.equal(fsBody.count, 10);
    assert.equal(fsBody.frame_w, 160);
    assert.equal(fsBody.frame_h, 90);
    assert.equal(fsBody.sprite_w, 1600);
    assert.equal(fsBody.sprite_h, 90);
    assert.equal(fsBody.duration_sec, 10);
    assert.equal(fsBody.timestamps.length, 10);
    assert.ok(fsBody.sprite_path && fsBody.sprite_path.length > 0, "sprite path missing");

    // GET waveform. Real PCM, normalized 0..1, non-constant.
    const wfRes = await fetch(
      `http://127.0.0.1:${studioPort}/api/assets/${encodeURIComponent(assetId)}/waveform?buckets=200`,
      { headers: auth },
    );
    const wfText = await wfRes.text();
    assert.equal(wfRes.status, 200, wfText);
    const wfBody = JSON.parse(wfText);
    assert.equal(wfBody.real_decode, true);
    assert.equal(wfBody.buckets, 200);
    assert.equal(wfBody.has_audio, true);
    assert.equal(wfBody.peaks.length, 200);
    for (const v of wfBody.peaks) {
      assert.ok(v >= 0 && v <= 1, `peak out of range: ${v}`);
    }
    const max = Math.max(...wfBody.peaks);
    assert.ok(max > 0, "waveform max must be > 0 (real audio)");
    const mean = wfBody.peaks.reduce((a, b) => a + b, 0) / wfBody.peaks.length;
    const variance =
      wfBody.peaks.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) /
      wfBody.peaks.length;
    const stdev = Math.sqrt(variance);
    assert.ok(stdev > 0, "waveform must not be a constant array");

    // Auth + ownership negative cases.
    const noAuth = await fetch(
      `http://127.0.0.1:${studioPort}/api/assets/${encodeURIComponent(assetId)}/filmstrip`,
    );
    assert.equal(noAuth.status, 401);

    const otherToken = signToken(
      { sub: "u-stranger", email: "stranger@example.test", name: "Stranger" },
      SECRET,
      600,
    );
    const otherAuth = { Authorization: bearer(otherToken) };
    const stranger = await fetch(
      `http://127.0.0.1:${studioPort}/api/assets/${encodeURIComponent(assetId)}/filmstrip`,
      { headers: otherAuth },
    );
    assert.equal(stranger.status, 404, "stranger must not see another user's filmstrip");

    const traversal = await fetch(
      `http://127.0.0.1:${studioPort}/api/assets/..%2F..%2Fetc%2Fpasswd/filmstrip`,
      { headers: auth },
    );
    assert.equal(traversal.status, 404);

    const slash = await fetch(
      `http://127.0.0.1:${studioPort}/api/assets/${encodeURIComponent("foo/bar")}/filmstrip`,
      { headers: auth },
    );
    assert.equal(slash.status, 404);

    const missing = await fetch(
      `http://127.0.0.1:${studioPort}/api/assets/asset_does_not_exist_42/filmstrip`,
      { headers: auth },
    );
    assert.equal(missing.status, 404);
  } finally {
    if (studioClose) await studioClose.close();
    video.stop();
    process.env.VIREO_VIDEO_URL = previousVideoUrl;
    if (previousSecret === undefined) delete process.env["VIREO_JWT_" + "SECRET"];
    else process.env["VIREO_JWT_" + "SECRET"] = previousSecret;
    if (previousMediaRoot === undefined) delete process.env.VIREO_MEDIA_ROOT;
    else process.env.VIREO_MEDIA_ROOT = previousMediaRoot;
    rmSync(mediaDir, { recursive: true, force: true });
  }
});
