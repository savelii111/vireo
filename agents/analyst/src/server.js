// HTTP server for Analyst agent.
import { createServer } from "node:http";
import { authMiddleware, corsHeaders, readJsonBody, RateLimiter } from "../../../packages/auth-middleware/index.js";
import { Analyst } from "./analyst.js";

const PORT = Number(process.env.PORT || 8004);
const HOST = process.env.HOST || "127.0.0.1";
const JWT_SECRET = process.env.VIREO_JWT_SECRET || "";

export function buildServer({ port = PORT, host = HOST, analyst: externalAnalyst, secret = JWT_SECRET } = {}) {
  const analyst = externalAnalyst || new Analyst();
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
    "GET /health": (_req, res) => json(res, 200, { status: "ok", agent: "analyst" }),
    "GET /version": (_req, res) => json(res, 200, { version: "0.1.0", agent: "analyst" }),

    "POST /ingest": async (req, res) => {
      try {
        const body = await readJsonBody(req);
        const s = analyst.ingest(body);
        json(res, 200, { ok: true, snapshot: s });
      } catch (e) {
        json(res, 400, { ok: false, error: e.message });
      }
    },

    "POST /ingest-batch": async (req, res) => {
      try {
        const body = await readJsonBody(req);
        const snaps = Array.isArray(body.snapshots) ? body.snapshots : [];
        const out = snaps.map((s) => analyst.ingest(s));
        json(res, 200, { ok: true, count: out.length, snapshots: out });
      } catch (e) {
        json(res, 400, { ok: false, error: e.message });
      }
    },

    "GET /report": (req, res) => {
      const url = new URL(req.url, "http://x");
      const days = Number(url.searchParams.get("days") || 7);
      const platform = url.searchParams.get("platform") || null;
      json(res, 200, { ok: true, report: analyst.report({ days, platform }) });
    },

    "GET /content/:id": (req, res) => {
      const url = new URL(req.url, "http://x");
      const id = url.pathname.split("/").pop();
      json(res, 200, { ok: true, content_id: id, snapshots: analyst.forContent(id) });
    },

    "GET /alerts": (_req, res) => {
      json(res, 200, { ok: true, alerts: analyst.alerts });
    },

    "POST /learn": async (req, res) => {
      try {
        const body = await readJsonBody(req);
        const out = analyst.learn(body.style_dna || {});
        json(res, 200, { ok: true, ...out });
      } catch (e) {
        json(res, 400, { ok: false, error: e.message });
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
    let key = `${req.method} ${url.pathname}`;
    let handler = routes[key];
    if (!handler) {
      if (req.method === "GET" && url.pathname.startsWith("/content/")) {
        handler = routes["GET /content/:id"];
        key = "GET /content/:id";
      }
    }
    if (!handler) return json(res, 404, { error: "not_found", path: url.pathname });

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

  return { server, analyst, port, host };
}

export function startServer(opts = {}) {
  const { server, port, host } = buildServer(opts);
  server.listen(port, host, () => {
    console.log(`[analyst] listening on http://${host}:${port}`);
  });
  return server;
}

const isMain = import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}` ||
               import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  startServer();
}
