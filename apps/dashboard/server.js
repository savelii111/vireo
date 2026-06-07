// Vireo Dashboard — serves static HTML/CSS/JS + proxies API calls to agents.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, "public");

const DEFAULT_PORT = Number(process.env.PORT || 3000);
const DEFAULT_HOST = process.env.HOST || "127.0.0.1";

const AGENTS = {
  style: process.env.VIREO_STYLE_URL || "http://127.0.0.1:8001",
  editor: process.env.VIREO_EDITOR_URL || "http://127.0.0.1:8002",
  distributor: process.env.VIREO_DISTRIBUTOR_URL || "http://127.0.0.1:8003",
  analyst: process.env.VIREO_ANALYST_URL || "http://127.0.0.1:8004",
  auth: process.env.VIREO_AUTH_URL || "http://127.0.0.1:8005",
  billing: process.env.VIREO_BILLING_URL || "http://127.0.0.1:8006",
  video: process.env.VIREO_VIDEO_URL || "http://127.0.0.1:8007",
  oauth: process.env.VIREO_OAUTH_URL || "http://127.0.0.1:8008",
  ingest: process.env.VIREO_INGEST_URL || "http://127.0.0.1:8009",
  monitoring: process.env.VIREO_MONITORING_URL || "http://127.0.0.1:8010",
  studio: process.env.VIREO_STUDIO_URL || "http://127.0.0.1:8011",
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
};

async function serveStatic(req, res) {
  let url = req.url.split("?")[0];
  if (url === "/") url = "/index.html";
  const path = resolve(join(PUBLIC, url));
  if (!path.startsWith(resolve(PUBLIC))) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  try {
    const body = await readFile(path);
    const mime = MIME[extname(path)] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": mime,
      "Content-Length": body.length,
      "Cache-Control": "public, max-age=60",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not_found");
  }
}

async function proxy(req, res, target, fetchImpl) {
  const _fetch = fetchImpl || globalThis.fetch;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const url = new URL(req.url, target);
    const headers = { "Content-Type": "application/json" };
    // Forward Authorization header to backend agents
    const authHeader = req.headers["authorization"];
    if (authHeader) headers["Authorization"] = authHeader;
    const init = { method: req.method, headers };
    if (req.method !== "GET" && req.method !== "HEAD") {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      init.body = Buffer.concat(chunks);
    }
    init.signal = ctrl.signal;
    const r = await _fetch(url, init);
    const body = await r.text();
    res.writeHead(r.status, {
      "Content-Type": r.headers.get("content-type") || "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(body);
  } catch (e) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "agent_unreachable", agent: target, message: e.message }));
  } finally {
    clearTimeout(t);
  }
}

function buildRoutes(fetchImpl) {
  return {
    "GET /": (_req, res) => serveStaticFile("landing.html", res),
    "GET /landing.html": (_req, res) => serveStaticFile("landing.html", res),
    "GET /signup.html": (_req, res) => serveStaticFile("signup.html", res),
    "GET /login.html": (_req, res) => serveStaticFile("login.html", res),
    "GET /onboarding.html": (_req, res) => serveStaticFile("onboarding.html", res),
    "GET /dashboard": (_req, res) => serveStaticFile("index.html", res),
    "GET /dashboard/": (_req, res) => serveStaticFile("index.html", res),
    "GET /chat.html": (_req, res) => serveStaticFile("chat.html", res),
    "GET /projects.html": (_req, res) => serveStaticFile("projects.html", res),
    "GET /chat.css": (_req, res) => serveStaticFile("chat.css", res),
    "GET /chat.js": (_req, res) => serveStaticFile("chat.js", res),
    "GET /projects.js": (_req, res) => serveStaticFile("projects.js", res),
    "GET /health": (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", agent: "dashboard", agents: AGENTS }));
    },
    "GET /api/style/*": (req, res) => proxy(req, res, AGENTS.style, fetchImpl),
    "POST /api/style/*": (req, res) => proxy(req, res, AGENTS.style, fetchImpl),
    "GET /api/editor/*": (req, res) => proxy(req, res, AGENTS.editor, fetchImpl),
    "POST /api/editor/*": (req, res) => proxy(req, res, AGENTS.editor, fetchImpl),
    "GET /api/distributor/*": (req, res) => proxy(req, res, AGENTS.distributor, fetchImpl),
    "POST /api/distributor/*": (req, res) => proxy(req, res, AGENTS.distributor, fetchImpl),
    "GET /api/analyst/*": (req, res) => proxy(req, res, AGENTS.analyst, fetchImpl),
    "POST /api/analyst/*": (req, res) => proxy(req, res, AGENTS.analyst, fetchImpl),
    "GET /api/auth/*": (req, res) => proxy(req, res, AGENTS.auth, fetchImpl),
    "POST /api/auth/*": (req, res) => proxy(req, res, AGENTS.auth, fetchImpl),
    "GET /api/billing/*": (req, res) => proxy(req, res, AGENTS.billing, fetchImpl),
    "POST /api/billing/*": (req, res) => proxy(req, res, AGENTS.billing, fetchImpl),
    "GET /api/video/*": (req, res) => proxy(req, res, AGENTS.video, fetchImpl),
    "POST /api/video/*": (req, res) => proxy(req, res, AGENTS.video, fetchImpl),
    "GET /api/oauth/*": (req, res) => proxy(req, res, AGENTS.oauth, fetchImpl),
    "POST /api/oauth/*": (req, res) => proxy(req, res, AGENTS.oauth, fetchImpl),
    "GET /api/ingest/*": (req, res) => proxy(req, res, AGENTS.ingest, fetchImpl),
    "POST /api/ingest/*": (req, res) => proxy(req, res, AGENTS.ingest, fetchImpl),
    "GET /api/monitoring/*": (req, res) => proxy(req, res, AGENTS.monitoring, fetchImpl),
    "POST /api/monitoring/*": (req, res) => proxy(req, res, AGENTS.monitoring, fetchImpl),
    "GET /api/studio/*": (req, res) => proxy(req, res, AGENTS.studio, fetchImpl),
    "POST /api/studio/*": (req, res) => proxy(req, res, AGENTS.studio, fetchImpl),
    "PUT /api/studio/*": (req, res) => proxy(req, res, AGENTS.studio, fetchImpl),
    "PATCH /api/studio/*": (req, res) => proxy(req, res, AGENTS.studio, fetchImpl),
    "DELETE /api/studio/*": (req, res) => proxy(req, res, AGENTS.studio, fetchImpl),
  };
}

async function serveStaticFile(name, res) {
  const path = resolve(join(PUBLIC, name));
  if (!path.startsWith(resolve(PUBLIC))) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  try {
    const body = await readFile(path);
    const mime = MIME[extname(path)] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": mime,
      "Content-Length": body.length,
      "Cache-Control": "public, max-age=60",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not_found");
  }
}

export function buildServer({ port = DEFAULT_PORT, host = DEFAULT_HOST, fetchImpl } = {}) {
  const routes = buildRoutes(fetchImpl);
  const server = createServer(async (req, res) => {
    if (req.method === "GET" && !req.url.startsWith("/api/") && req.url !== "/health") {
      const url = req.url.split("?")[0];
      const key = `GET ${url}`;
      const handler = routes[key];
      if (handler) {
        try { await handler(req, res); } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "server_error", message: e.message }));
        }
        return;
      }
      return serveStatic(req, res);
    }
    const url = req.url.split("?")[0];
    const key = `${req.method} ${url}`;
    let handler = routes[key];
    if (!handler) {
      const m = url.match(/^(\/api\/\w+)(\/.*)?$/);
      if (m) {
        const wildKey = `${req.method} ${m[1]}/*`;
        handler = routes[wildKey];
      }
    }
    if (!handler) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not_found", path: url }));
      return;
    }
    try {
      await handler(req, res);
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "server_error", message: e.message }));
    }
  });
  return { server, port, host, fetchImpl };
}

export function start(opts = {}) {
  const { server, port, host } = buildServer(opts);
  server.listen(port, host, () => {
    console.log(`[dashboard] listening on http://${host}:${port}`);
    console.log(`[dashboard] API proxy:`);
    for (const [k, v] of Object.entries(AGENTS)) {
      console.log(`  /api/${k}/* -> ${v}`);
    }
  });
  return server;
}

// Auto-start when invoked directly; tests call start() explicitly via the import path.
import { fileURLToPath as _toPath } from "node:url";
import { resolve as pathResolve } from "node:path";
const isMain = (() => {
  if (!process.argv[1]) return false;
  const thisFile = _toPath(import.meta.url);
  const argvFile = pathResolve(process.argv[1]);
  return thisFile === argvFile;
})();
if (isMain) {
  start();
}
