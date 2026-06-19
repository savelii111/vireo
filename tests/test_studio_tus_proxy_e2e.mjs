import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import net from "node:net";
import { buildServer } from "../agents/studio/src/server.js";
import { signToken } from "../packages/auth-middleware/index.js";

const SECRET = "vireo-dev-secret-32-chars-minimum-000";
const ROOT = process.cwd();

function makeMockLLM() {
  return {
    model: "mock",
    isMock: () => true,
    costUsd: () => 0,
    chat: async () => ({ content: "mock", tool_calls: null, usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } }),
    getUsage: () => ({ input_tokens: 0, output_tokens: 0, request_count: 0, error_count: 0, retry_count: 0, total_cost_usd: 0 }),
  };
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
      const res = await fetch(url, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
      last = await readJsonOnce(res).catch(() => ({}));
      if (res.ok) return last;
    } catch (_) {
      // Server is still starting.
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for ${url}; last=${JSON.stringify(last)}`);
}

function startVideoAgent(port, mediaDir) {
  const child = spawn("python", ["-c", "import os; from vireo_video.server import start; start(port=int(os.environ.get('PORT', '8007')))"], {
    cwd: join(ROOT, "agents/video"),
    env: {
      ...process.env,
      PORT: String(port),
      VIREO_JWT_SECRET: SECRET,
      VIREO_MEDIA_DIR: mediaDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
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

test("studio TUS proxy -> video-agent ingest uses real auth and real ffprobe", async () => {
  const previousVideoUrl = process.env.VIREO_VIDEO_URL;
  const previousSecret = process.env.VIREO_JWT_SECRET;
  const videoPort = await freePort();
  const mediaDir = mkdtempSync(join(tmpdir(), "vireo-studio-tus-e2e-"));
  const video = startVideoAgent(videoPort, mediaDir);
  let studioClose = null;

  try {
    await waitForJson(`http://127.0.0.1:${videoPort}/health`);

    process.env.VIREO_VIDEO_URL = `http://127.0.0.1:${videoPort}`;
    process.env.VIREO_JWT_SECRET = SECRET;
    const { server } = buildServer({ secret: SECRET, llm: makeMockLLM() });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const studioPort = server.address().port;
    studioClose = () => new Promise((resolve) => server.close(resolve));

    const token = signToken({ sub: "u-tus-e2e", email: "tus-e2e@example.test" }, SECRET, 600);
    const fixturePath = join(ROOT, "agents/video/tests/fixtures/sample_10s.mp4");
    const fixture = readFileSync(fixturePath);
    const metadata = [
      `filename ${Buffer.from("sample_10s.mp4").toString("base64")}`,
      `filetype ${Buffer.from("video/mp4").toString("base64")}`,
    ].join(",");

    const createRes = await fetch(`http://127.0.0.1:${studioPort}/api/upload/resumable`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Tus-Resumable": "1.0.0",
        "Upload-Length": String(fixture.length),
        "Upload-Metadata": metadata,
      },
    });
    const createBody = await readJsonOnce(createRes);
    assert.equal(createRes.status, 201, JSON.stringify(createBody));
    const uploadId = createRes.headers.get("location")?.split("/").filter(Boolean).pop() || createBody.id;
    assert.ok(uploadId, `missing upload id: ${JSON.stringify(createBody)}`);

    const patchRes = await fetch(`http://127.0.0.1:${studioPort}/api/upload/resumable/${encodeURIComponent(uploadId)}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/offset+octet-stream",
        "Tus-Resumable": "1.0.0",
        "Upload-Offset": "0",
        "Content-Range": `bytes 0-${fixture.length - 1}/${fixture.length}`,
      },
      body: fixture,
    });
    const patchText = await patchRes.text();
    assert.equal(patchRes.status, 204, patchText);
    assert.equal(patchRes.headers.get("upload-offset"), String(fixture.length));

    const deadline = Date.now() + 20000;
    let ingest;
    do {
      const ingestRes = await fetch(`http://127.0.0.1:${studioPort}/api/upload/resumable/${encodeURIComponent(uploadId)}/ingest`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      ingest = await readJsonOnce(ingestRes).catch(() => ({}));
      if (ingestRes.ok && ingest?.result?.real_decode) break;
      if (Date.now() > deadline) break;
      await new Promise((r) => setTimeout(r, 500));
    } while (true);

    const result = ingest?.result || ingest;
    assert.equal(result.real_decode, true, JSON.stringify(result));
    assert.ok(result.duration > 9.5 && result.duration < 10.5, JSON.stringify(result));
    assert.equal(result.width, 1280, JSON.stringify(result));
    assert.equal(result.height, 720, JSON.stringify(result));
    assert.equal(result.fps, 30, JSON.stringify(result));
    assert.equal(result.hasAudio, true, JSON.stringify(result));
    assert.equal(result.video_codec, "h264", JSON.stringify(result));
  } finally {
    if (studioClose) await studioClose();
    video.stop();
    process.env.VIREO_VIDEO_URL = previousVideoUrl;
    process.env.VIREO_JWT_SECRET = previousSecret;
    rmSync(mediaDir, { recursive: true, force: true });
  }
});
