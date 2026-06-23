// Day 24 e2e launcher: start the real Studio server for the
// Python e2e test_studio_export_e2e.py.
//
// Usage: node tests/_d24_studio_launcher.mjs
//   VIREO_PG_URL=postgresql://vireo@127.0.0.1:55432/vireo
//   VIREO_JWT_SECRET=...
//   VIREO_VIDEO_URL=http://127.0.0.1:8007   (any URL; the e2e
//     never makes an upstream call to the video-agent through
//     the Studio code path that needs it).
//   VIREO_MEDIA_ROOT=...  (where exports land)
//   PORT=...
//
// The launcher reads PORT/secret/env, calls the same buildServer
// that the dev server uses, and prints STUDIO_LISTENING:<port>
// when the listener is up so the Python test can synchronise.
//
// This file mirrors the working pattern from
// tests/test_studio_tus_proxy_e2e.mjs: the Studio `buildServer`
// returns an object with a `server` field (the actual http.Server),
// and `server.listen(port, host, cb)` returns a Promise — not the
// node-style callback-only API. The Python e2e uses the printed
// readiness marker to know when it's safe to start hitting HTTP.

const __filename = new URL(import.meta.url).pathname;
const __studioPath = __filename.replace(/[\\/]tests[\\/]_d24_studio_launcher\.mjs$/, "/agents/studio/src/server.js");
const { buildServer } = await import("file:///" + __studioPath.replace(/^\/+/, "").replace(/\//g, "/"));

const PORT = Number(process.env.PORT || 0);
const HOST = process.env.HOST || "127.0.0.1";
// Read the dev secret from a file rather than env: bash quoting
// in some environments mangles long JWT secrets, and the file
// path is always the same. The path comes from
// VIREO_D24_SECRET_FILE (a per-test path in a temp dir).
import { readFileSync } from "node:fs";
function readSecret() {
  const p = process.env["VIREO_D24_" + "SECRET_FILE"];
  if (p) {
    try {
      const s = readFileSync(p, "utf8").trim();
      if (s) return s;
    } catch { /* ignore */ }
  }
  // Backwards-compatible fallback: legacy .d24_secret.txt in
  // the cwd or repo root.
  for (const candidate of [".d24_secret.txt"]) {
    try {
      const s = readFileSync(candidate, "utf8").trim();
      if (s) return s;
    } catch { /* ignore */ }
  }
  return "";
}
const SECRET = readSecret();
if (!SECRET) {
  console.error("[launcher] VIREO_D24_SECRET_FILE is empty or missing — refusing to start");
  process.exit(2);
}

function mockLlm() {
  return {
    model: "mock-d24",
    isMock: () => true,
    costUsd: () => 0,
    chat: async () => ({ content: "mock", tool_calls: null, usage: {} }),
    getUsage: () => ({}) ,
  };
}

const { server } = buildServer({
  port: PORT,
  host: HOST,
  secret: SECRET,
  llm: mockLlm(),
});

// server.listen is callback-style in this codebase. Wrap it in a
// Promise so the test can wait for readiness.
await new Promise((resolve, reject) => {
  try {
    server.listen(PORT, HOST, () => resolve());
  } catch (e) {
    reject(e);
  }
});
const realPort = server.address()?.port || PORT;
// All Studio log lines go to stderr; the launcher only emits the
// readiness marker to stdout. The Python e2e reads stderr to
// surface useful debug info, and reads stdout for the marker.
process.on("uncaughtException", (e) => {
  process.stderr.write(`[launcher] uncaughtException: ${e.stack || e}\n`);
  process.exit(4);
});
process.on("unhandledRejection", (e) => {
  process.stderr.write(`[launcher] unhandledRejection: ${e?.stack || e}\n`);
});

process.stderr.write(`[studio] listening on http://${HOST}:${realPort}\n`);
process.stdout.write(`STUDIO_LISTENING:${realPort}\n`);

function shutdown(sig) {
  process.stdout.write(`STUDIO_STOPPING:${sig}\n`);
  try { server.close(); } catch (_) {}
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
