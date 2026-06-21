import { test, expect } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildServer } from "../agents/studio/src/server.js";
import { signToken } from "../packages/auth-middleware/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SECRET = "studio-playwright-media-secret";

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
            r();
          });
          setTimeout(() => {
            for (const socket of sockets) socket.destroy();
            r();
          }, 1000).unref();
        }),
      });
    });
  });
}

function authHeader(userId) {
  return { Authorization: `Bearer ${signToken({ sub: userId, email: `${userId}@x.com` }, SECRET, 600)}` };
}

function bearerFrom(headers) {
  return headers.Authorization.replace(/^Bearer\s+/i, "");
}

function makeFixture(tempDir) {
  const fixture = path.join(tempDir, "sample_10s.webm");
  try {
    execFileSync("ffmpeg", [
      "-y",
      "-hide_banner",
      "-loglevel", "error",
      "-f", "lavfi",
      "-i", "testsrc2=size=320x180:rate=30:duration=3",
      "-t", "3",
      "-pix_fmt", "yuv420p",
      "-c:v", "libvpx-vp9",
      "-b:v", "250k",
      "-an",
      fixture,
    ]);
  } catch (err) {
    throw new Error(`failed to generate WebM fixture with ffmpeg: ${err?.message || err}`);
  }
  return fixture;
}

test("Day 22 C: Chromium decodes real Studio media endpoint bytes into a non-black video frame", async ({ page }) => {
  const consoleMessages = [];
  const pageErrors = [];
  page.on("console", (msg) => consoleMessages.push(`${msg.type()}: ${msg.text()}`));
  page.on("pageerror", (err) => pageErrors.push(err.message));
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "vireo-playwright-media-"));
  const mediaRoot = process.env.VIREO_MEDIA_ROOT;
  process.env.VIREO_MEDIA_ROOT = tempDir;
  const fixture = makeFixture(tempDir);

  const { server } = buildServer({ secret: SECRET, llm: mockLLM() });
  const { port, close } = await listen(server);
  const base = `http://127.0.0.1:${port}`;

  try {
    const createRes = await fetch(`${base}/api/assets`, {
      method: "POST",
      headers: { ...authHeader("alice"), "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "sample_10s.webm",
        storage_path: fixture,
        mime: "video/webm",
        real_decode: true,
        video_codec: "vp9",
        fps: 30,
        duration: 3,
        hasAudio: false,
      }),
    });
    const createText = await createRes.clone().text();
    expect(createRes.status, createText).toBe(201);
    const { asset } = JSON.parse(createText);
    const token = bearerFrom(authHeader("alice"));
    const mediaUrl = `${base}/api/assets/${asset.id}/media?access_token=${encodeURIComponent(token)}`;

    await page.goto(`${base}/`);
    await page.evaluate(({ mediaUrl }) => {
      document.body.innerHTML = `
        <video id="v" src="${mediaUrl}" muted playsinline preload="metadata"></video>
        <canvas id="c" width="64" height="64"></canvas>
        <button id="p">play</button>
      `;
      window.__playError = null;
      document.getElementById("v").addEventListener("click", async () => {
        try {
          await document.getElementById("v").play();
          window.__played = true;
        } catch (err) {
          window.__playError = String(err && err.message ? err.message : err);
        }
      });
      document.getElementById("p").addEventListener("click", async () => {
        try {
          await document.getElementById("v").play();
          window.__played = true;
        } catch (err) {
          window.__playError = String(err && err.message ? err.message : err);
        }
      });
    }, { mediaUrl });

    await page.click("#p");
    await page.waitForFunction(() => window.__played === true || !!window.__playError, null, { timeout: 5000 });
    const playError = await page.evaluate(() => window.__playError);
    if (playError) throw new Error(`video.play() failed: ${playError}`);
    try {
      await page.waitForFunction(() => {
        const video = /** @type {HTMLVideoElement | null} */ (document.getElementById("v"));
        return !!video && video.readyState >= 2 && video.currentTime > 0;
      }, null, { timeout: 15000 });
    } catch (err) {
      const videoState = await page.evaluate(() => {
        const video = /** @type {HTMLVideoElement | null} */ (document.getElementById("v"));
        return {
          exists: !!video,
          src: video?.src || "",
          currentTime: video?.currentTime ?? null,
          duration: video?.duration ?? null,
          readyState: video?.readyState ?? null,
          error: video?.error ? { code: video.error.code, message: video.error.message } : null,
          networkState: video?.networkState ?? null,
        };
      });
      throw new Error(`video did not become playable; state=${JSON.stringify(videoState)} console=${JSON.stringify(consoleMessages)} pageErrors=${JSON.stringify(pageErrors)}`);
    }

    const t0 = await page.evaluate(() => /** @type {HTMLVideoElement} */ (document.getElementById("v")).currentTime);
    await page.waitForTimeout(700);
    const t1 = await page.evaluate(() => /** @type {HTMLVideoElement} */ (document.getElementById("v")).currentTime);
    expect(t1, "video.currentTime should advance while playing").toBeGreaterThan(t0 + 0.1);

    const stats = await page.evaluate(() => {
      const video = /** @type {HTMLVideoElement} */ (document.getElementById("v"));
      const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("c"));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("2d canvas context unavailable");
      ctx.drawImage(video, 0, 0, 64, 64);
      const data = ctx.getImageData(0, 0, 64, 64).data;
      let sum = 0;
      let sumSq = 0;
      let nonBlack = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];
        if (a > 0 && r + g + b > 5) nonBlack += 1;
        const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        sum += y;
        sumSq += y * y;
      }
      const mean = sum / (64 * 64);
      const variance = sumSq / (64 * 64) - mean * mean;
      return { readyState: video.readyState, currentTime: video.currentTime, mean, variance, nonBlack };
    });

    expect(stats.readyState).toBeGreaterThanOrEqual(2);
    expect(stats.variance, `decoded frame variance should be non-black/non-homogeneous; stats=${JSON.stringify(stats)}`).toBeGreaterThan(5);
    expect(stats.nonBlack, `decoded frame should contain visible pixels; stats=${JSON.stringify(stats)}`).toBeGreaterThan(100);
  } finally {
    await close();
    if (mediaRoot === undefined) delete process.env.VIREO_MEDIA_ROOT;
    else process.env.VIREO_MEDIA_ROOT = mediaRoot;
    rmSync(tempDir, { recursive: true, force: true });
  }
});
