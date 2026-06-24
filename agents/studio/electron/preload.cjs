// Vireo Studio — Electron preload.
//
// Runs in the renderer's isolated world. Exposes a small
// `vireo.*` surface to window via contextBridge so the
// React app can call native dialogs and IPC without
// pulling nodeIntegration into the page.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("vireo", {
  // Open a native file picker for media import. Returns
  // an array of { path, name } or null on cancel.
  importFile: (options) => ipcRenderer.invoke("vireo:importFile", options),
  // Run ffprobe on a local file path. Returns
  // { ok, duration_sec, width, height, fps, video_codec,
  // audio_codec, container, size } or { ok: false, error }.
  ffprobe: (absPath) => ipcRenderer.invoke("vireo:ffprobe", absPath),
  // stat() a local path. Returns { ok, size }.
  stat: (absPath) => ipcRenderer.invoke("vireo:stat", absPath),
  // Is this renderer running inside the Electron app?
  isDesktop: true,
  // Get the dev JWT the main process injected into
  // localStorage (vireo_token). Returns null if missing.
  getToken: () => {
    try { return localStorage.getItem("vireo_token"); } catch { return null; }
  },
  // Get the local file:// URL the renderer can use as a
  // video src. We map an absolute disk path to a
  // file:// URL the browser can fetch without the
  // server. This is the desktop equivalent of the
  // /api/assets/<id>/media endpoint.
  toFileUrl: (absPath) => {
    if (!absPath) return null;
    // encodeURI keeps Windows backslashes safe. The
    // resulting URL works as an <video src> directly.
    const normalized = absPath.replace(/\\/g, "/");
    if (/^[a-zA-Z]:/.test(normalized)) {
      return "file:///" + encodeURI(normalized);
    }
    return "file://" + encodeURI(normalized);
  },
});
