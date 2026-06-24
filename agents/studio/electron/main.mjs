// Vireo Studio — Electron main process.
//
// We don't rewrite the app. The existing server.js is the
// backend (Express on Node). The existing Vite build
// (agents/studio/frontend/dist) is the frontend. Electron
// just embeds both: spawn server.js as a child process on
// 127.0.0.1:<random>, wait for it to start listening, then
// open a BrowserWindow pointing at it.
//
// In the desktop build there is no TUS upload, no
// /api/dev/issue-token, no dev video-agent. The user picks
// files from disk via a native dialog and we hand the
// local path straight to ffmpeg/ffprobe (see the
// file:import handler in the preload). server.js keeps
// its existing /api/assets and /api/exports endpoints and
// we wire them to a local file:// origin instead of a
// browser TUS stream.

import { app, BrowserWindow, ipcMain, dialog, shell, protocol } from "electron";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import net from "node:net";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// main.mjs lives in agents/studio/electron/. Three levels
// up is the monorepo root: agents/studio/electron -> agents/studio -> agents -> root.
const ROOT = path.resolve(__dirname, "..", "..", "..");

let mainWindow = null;
let serverProc = null;
let serverPort = null;
let serverSecret = randomBytes(24).toString("hex");
const SECRET = serverSecret;

// ---- pick a free port on 127.0.0.1 ----
function pickFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

// ---- spawn the existing Studio server as a child process ----
// We pass VIREO_JWT_SECRET, the absolute dist path, the
// picked port, and the Vireo PG url (if any). Everything
// else stays the same as the standalone server.js.
function startStudioServer() {
  const studioEntry = path.resolve(ROOT, "agents", "studio", "src", "server.js");
  if (!existsSync(studioEntry)) {
    throw new Error("Studio server.js not found at " + studioEntry);
  }
  const distDir = path.resolve(ROOT, "agents", "studio", "frontend", "dist");
  const env = {
    ...process.env,
    VIREO_JWT_SECRET: SECRET,
    STUDIO_STATIC_DIR: distDir,
    PORT: String(serverPort),
    VIREO_DEV_LOGIN: "1",
    VIREO_VIDEO_URL: process.env.VIREO_VIDEO_URL || "http://127.0.0.1:8007",
    VIREO_MEDIA_ROOT: process.env.VIREO_MEDIA_ROOT || path.join(app.getPath("userData"), "media"),
  };
  if (process.env.VIREO_PG_URL) env.VIREO_PG_URL = process.env.VIREO_PG_URL;
  serverProc = spawn(process.execPath, [studioEntry], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  serverProc.stdout.on("data", (b) => process.stdout.write(`[studio] ${b}`));
  serverProc.stderr.on("data", (b) => process.stderr.write(`[studio-err] ${b}`));
  serverProc.on("exit", (code, signal) => {
    console.log(`[electron] studio exited code=${code} signal=${signal}`);
    serverProc = null;
  });
}

// ---- wait for the server to accept connections ----
function waitForServer(port, timeoutMs = 30_000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const sock = net.createConnection({ host: "127.0.0.1", port }, () => {
        sock.end();
        resolve();
      });
      sock.on("error", () => {
        sock.destroy();
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`studio server didn't accept on :${port} within ${timeoutMs}ms`));
        } else {
          setTimeout(tick, 200);
        }
      });
    };
    tick();
  });
}

// ---- create the main window ----
async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 1280,
    minHeight: 720,
    backgroundColor: "#0a0a0c",
    title: "Vireo Studio",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.resolve(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload uses ipcRenderer + dialog
      webSecurity: true,
    },
  });
  // Block any external navigation; keep the app in the window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch(() => {});
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(`http://127.0.0.1:${serverPort}`)) {
      e.preventDefault();
      shell.openExternal(url).catch(() => {});
    }
  });
  // Inject the dev JWT into the page on first load so the
  // editor mounts as "logged in". localStorage is per-
  // origin so we need this before the React app reads it.
  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow.webContents
      .executeJavaScript(
        `localStorage.setItem("vireo_token", ${JSON.stringify(devToken)});` +
        `localStorage.setItem("vireo_active_project_id", localStorage.getItem("vireo_active_project_id") || "")`,
        true,
      )
      .catch((e) => console.error("[electron] inject token failed", e));
  });
  await mainWindow.loadURL(`http://127.0.0.1:${serverPort}/`);
}

let devToken = null;

app.whenReady().then(async () => {
  try {
    serverPort = await pickFreePort();
    // Sign a dev JWT for the desktop user. We use the
    // same SECRET the server is going to use, so the
    // server's authMiddleware will accept it.
    const authPath = path.resolve(ROOT, "packages", "auth-middleware", "index.js");
    const { signToken } = await import(pathToFileURL(authPath).href);
    devToken = signToken(
      { sub: "u-desktop", email: "desktop@vireo.local" },
      SECRET,
      24 * 3600,
    );
    startStudioServer();
    await waitForServer(serverPort);
    await createWindow();
  } catch (e) {
    console.error("[electron] fatal", e);
    dialog.showErrorBox("Vireo failed to start", String(e.stack || e));
    app.quit();
  }
});

app.on("window-all-closed", () => {
  // On Windows / Linux the app should exit when the
  // window is closed. On macOS it stays in the dock.
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (serverProc) {
    try { serverProc.kill(); } catch {}
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ---- IPC: native file picker for media import ----
// The renderer calls window.vireoImportFile() and gets
// back { path, name, size, kind } or null on cancel.
ipcMain.handle("vireo:importFile", async (_evt, options = {}) => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Import media",
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Video", extensions: ["mp4", "mov", "m4v", "webm", "mkv"] },
      { name: "Audio", extensions: ["mp3", "wav", "m4a", "aac", "ogg"] },
      { name: "Image", extensions: ["png", "jpg", "jpeg", "webp", "gif"] },
      { name: "All files", extensions: ["*"] },
    ],
    ...options,
  });
  if (result.canceled || !result.filePaths.length) return null;
  // ffprobe / ffmpeg will read these. We return the
  // absolute path; the renderer calls vireo:ffprobe to
  // get duration_sec/width/height and posts to
  // /api/assets with storage_path set to the local path.
  return result.filePaths.map((p) => ({
    path: p,
    name: path.basename(p),
    size: 0, // we fill this in the next IPC
  }));
});

// Day 27: ffprobe wrapper. The renderer hands us a
// local file path (already absolute, picked by the user
// through the native dialog). We invoke ffmpeg's ffprobe
// with -show_streams and return the parsed JSON. This
// is the same call the studio server makes for TUS
// ingests, but it runs on the local path the user
// already has on disk.
ipcMain.handle("vireo:ffprobe", async (_evt, absPath) => {
  if (typeof absPath !== "string" || !absPath) {
    return { ok: false, error: "absPath required" };
  }
  const { spawn } = await import("node:child_process");
  return new Promise((resolve) => {
    const proc = spawn("ffprobe", [
      "-v", "error",
      "-print_format", "json",
      "-show_streams",
      "-show_format",
      absPath,
    ]);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (c) => { stdout += c.toString("utf8"); });
    proc.stderr.on("data", (c) => { stderr += c.toString("utf8"); });
    proc.on("close", (code) => {
      if (code !== 0) {
        resolve({ ok: false, error: "ffprobe exited " + code, stderr });
        return;
      }
      try {
        const info = JSON.parse(stdout);
        const v = (info.streams || []).find((s) => s.codec_type === "video");
        const a = (info.streams || []).find((s) => s.codec_type === "audio");
        const duration = Number(info.format?.duration || 0);
        resolve({
          ok: true,
          duration_sec: duration,
          width: v?.width || 0,
          height: v?.height || 0,
          fps: v ? Number((v.r_frame_rate || "0/1").split("/")[0]) / Math.max(1, Number((v.r_frame_rate || "0/1").split("/")[1] || 1)) : 0,
          video_codec: v?.codec_name || null,
          audio_codec: a?.codec_name || null,
          container: info.format?.format_name || null,
          size: Number(info.format?.size || 0),
        });
      } catch (e) {
        resolve({ ok: false, error: "parse failed: " + e.message });
      }
    });
    proc.on("error", (e) => resolve({ ok: false, error: e.message }));
  });
});

// Day 27: stat a file. Used by the renderer to fill in
// `size` for the native dialog picker (the dialog itself
// doesn't return the byte count).
ipcMain.handle("vireo:stat", async (_evt, absPath) => {
  const { statSync } = await import("node:fs");
  try {
    const s = statSync(absPath);
    return { ok: true, size: s.size };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
