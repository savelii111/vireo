// HTTP server for Distributor agent.
import { createServer } from "node:http";
import { PLATFORMS } from "@vireo/shared";
import { authMiddleware, corsHeaders, readJsonBody, RateLimiter } from "../../../packages/auth-middleware/index.js";
import { JobStore } from "./store.js";
import { Distributor } from "./distributor.js";
import { mockPublisher } from "./mock_publisher.js";
import { adaptToAllPlatforms } from "./adapters.js";
import { nextSlotFor, PEAK_WINDOWS_PUBLIC } from "./scheduler.js";

const DEFAULT_PORT = Number(process.env.PORT || 8003);
const DEFAULT_HOST = process.env.HOST || "127.0.0.1";
const JWT_SECRET = process.env.VIREO_JWT_SECRET || "";

export function buildServer({ port = DEFAULT_PORT, host = DEFAULT_HOST, store: externalStore, secret = JWT_SECRET } = {}) {
  const store = externalStore || new JobStore();
  const dist = new Distributor(store);
  const auth = secret ? authMiddleware(secret) : null;
  const rateLimiter = new RateLimiter({ max: 60, windowMs: 60_000 });
  const cors = corsHeaders();

  function json(res, status, payload) {
    const body = JSON.stringify(payload, null, 2);
    res.writeHead(status, {
      ...cors,
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(body),
    });
    res.end(body);
  }

  const routes = {
    "GET /health": (_req, res) => json(res, 200, { status: "ok", agent: "distributor" }),
    "GET /version": (_req, res) => json(res, 200, { version: "0.1.0", agent: "distributor" }),
    "GET /platforms": (_req, res) => json(res, 200, { platforms: PLATFORMS, peak_windows: PEAK_WINDOWS_PUBLIC }),

    "GET /jobs": (req, res) => {
      const url = new URL(req.url, "http://x");
      const filter = {
        platform: url.searchParams.get("platform") || undefined,
        status: url.searchParams.get("status") || undefined,
        content_id: url.searchParams.get("content_id") || undefined,
      };
      json(res, 200, { ok: true, count: store.list(filter).length, jobs: store.list(filter) });
    },

    "GET /audit": (_req, res) => json(res, 200, { ok: true, log: store.auditLog() }),

    "POST /distribute": async (req, res) => {
      try {
        const body = await readJsonBody(req);
        const out = dist.distribute(body);
        json(res, 200, { ok: true, ...out });
      } catch (e) {
        // Respect the upstream statusCode (e.g. 413 from readJsonBody on
        // payload-too-large; 400 stays the default for validation errors).
        const status = e.statusCode || 400;
        json(res, status, { ok: false, error: e.message });
      }
    },

    "POST /adapt": async (req, res) => {
      try {
        const body = await readJsonBody(req);
        const { edit_plan, style_dna, platforms } = body;
        if (!edit_plan || !style_dna) {
          return json(res, 400, { ok: false, error: "edit_plan and style_dna required" });
        }
        const adapted = adaptToAllPlatforms(edit_plan, style_dna, platforms);
        json(res, 200, { ok: true, count: adapted.length, adapted });
      } catch (e) {
        const status = e.statusCode || 400;
        json(res, status, { ok: false, error: e.message });
      }
    },

    "POST /schedule": async (req, res) => {
      try {
        const body = await readJsonBody(req);
        const { platform, after } = body;
        if (!platform) return json(res, 400, { ok: false, error: "platform required" });
        const when = nextSlotFor(platform, after ? new Date(after) : new Date(), store.list());
        json(res, 200, { ok: true, platform, scheduled_at: when });
      } catch (e) {
        const status = e.statusCode || 400;
        json(res, status, { ok: false, error: e.message });
      }
    },

    "POST /tick": async (req, res) => {
      try {
        const ok = await dist.runDue(mockPublisher);
        json(res, 200, { ok: true, published: ok });
      } catch (e) {
        // runDue failures are infrastructure (e.g. publisher crashes) — 500
        // is the correct code (we don't want to mask this as 400 validation).
        json(res, 500, { ok: false, error: e.message });
      }
    },
  };

  const PUBLIC_ROUTES = new Set(["GET /health"]);

  const server = createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      res.end();
      return;
    }
    const url = new URL(req.url, "http://x");
    const key = `${req.method} ${url.pathname}`;
    const handler = routes[key];
    if (!handler) return json(res, 404, { error: "not_found", path: url.pathname });

    // Auth: skip for public routes
    if (!PUBLIC_ROUTES.has(key) && auth) {
      await new Promise((r) => auth(req, res, r));
      if (res.writableEnded) return;
    }

    // Rate limit API endpoints (60/min per IP)
    if (url.pathname !== "/health" && url.pathname !== "/version") {
      const rlKey = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "global").toString().split(",")[0].trim();
      const rl = rateLimiter.check(rlKey);
      res.setHeader("X-RateLimit-Limit", "60");
      res.setHeader("X-RateLimit-Remaining", String(Math.max(0, 60 - rl.count)));
      if (!rl.allowed) {
        res.setHeader("Retry-After", String(Math.ceil(rl.retryAfterMs / 1000)));
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "rate_limited", message: "too many requests" }));
        return;
      }
    }

    try {
      await handler(req, res);
    } catch (e) {
      json(res, 500, { error: "server_error", message: e.message });
    }
  });

  return { server, store, dist, port, host };
}

export function startServer(opts = {}) {
  const { server, port, host } = buildServer(opts);
  server.listen(port, host, () => {
    console.log(`[distributor] listening on http://${host}:${port}`);
  });
  return server;
}

// Run only when invoked directly, not when imported (for tests).
import { fileURLToPath } from "node:url";
import { resolve as pathResolve } from "node:path";
const isMain = (() => {
  if (!process.argv[1]) return false;
  const thisFile = fileURLToPath(import.meta.url);
  const argvFile = pathResolve(process.argv[1]);
  return thisFile === argvFile;
})();
if (isMain) {
  startServer();
}

