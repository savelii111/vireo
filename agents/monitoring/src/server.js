// Vireo Monitoring — aggregate healthcheck, metrics, structured logging.
// Polls all agent /health endpoints and exposes unified view.

import { createServer } from "node:http";
import { readFile, writeFile, appendFile } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fireWebhooks, parseWebhookConfig } from "./webhooks.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..", "..");

const DEFAULT_PORT = Number(process.env.PORT || 8010);
const DEFAULT_HOST = process.env.HOST || "127.0.0.1";
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 10000);
const LOG_DIR = process.env.VIREO_LOG_DIR || join(ROOT, "logs");
const LOG_FILE = join(LOG_DIR, "monitoring.jsonl");

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
};

// In-memory state
const state = {
  agents: {},           // name -> { status, latency_ms, last_checked, version, error }
  metrics: {
    polls_total: 0,
    polls_failed: 0,
    checks_total: 0,    // per agent
    uptime_started: Date.now(),
  },
  history: [],          // last 100 polls (sliding window)
  alerts: [],           // active alerts
  fetchImpl: null,
};

// --- Structured logging ---

function ensureLogDir() {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
}

async function log(level, message, extra = {}) {
  ensureLogDir();
  const entry = {
    ts: new Date().toISOString(),
    level,
    service: "monitoring",
    message,
    ...extra,
  };
  const line = JSON.stringify(entry) + "\n";
  try {
    await appendFile(LOG_FILE, line, "utf8");
  } catch (e) {
    process.stderr.write(`[monitoring] log write failed: ${e.message}\n`);
  }
  // Also stderr in dev
  if (process.env.NODE_ENV !== "production") {
    process.stderr.write(line);
  }
}

function logSync(level, message, extra = {}) {
  ensureLogDir();
  const entry = {
    ts: new Date().toISOString(),
    level,
    service: "monitoring",
    message,
    ...extra,
  };
  const line = JSON.stringify(entry) + "\n";
  try {
    appendFileSync(LOG_FILE, line, "utf8");
  } catch (e) {
    process.stderr.write(`[monitoring] log write failed: ${e.message}\n`);
  }
}

// Use sync append for simplicity
import { appendFileSync } from "node:fs";


// --- Health poller ---

async function checkAgent(name, url) {
  const t0 = Date.now();
  const fetchFn = state.fetchImpl || globalThis.fetch;
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 5000);
    const resp = await fetchFn(`${url}/health`, {
      signal: controller.signal,
      headers: { "User-Agent": "vireo-monitoring/0.1" },
    });
    clearTimeout(t);
    const latency_ms = Date.now() - t0;
    if (!resp.ok) {
      return {
        name, url, status: "down", latency_ms, last_checked: Date.now(),
        error: `HTTP ${resp.status}`,
      };
    }
    const body = await resp.json().catch(() => ({}));
    return {
      name, url, status: "up", latency_ms, last_checked: Date.now(),
      version: body.version || null, error: null,
      details: body,
    };
  } catch (e) {
    return {
      name, url, status: "down", latency_ms: Date.now() - t0,
      last_checked: Date.now(), error: e.message || String(e),
    };
  }
}

async function pollAll() {
  state.metrics.polls_total++;
  const results = await Promise.all(
    Object.entries(AGENTS).map(([name, url]) => checkAgent(name, url))
  );
  const newState = {};
  const oldAlerts = new Set(state.alerts.map(a => `${a.name}:${a.status}`));
  const newAlerts = [];
  for (const r of results) {
    newState[r.name] = r;
    state.metrics.checks_total++;
    // Detect status change for alerting
    const wasUp = state.agents[r.name]?.status === "up";
    if (wasUp && r.status === "down") {
      newAlerts.push({
        name: r.name, status: "down", error: r.error,
        ts: Date.now(), kind: "agent_down",
      });
      logSync("error", "agent down", { agent: r.name, error: r.error });
    } else if (!wasUp && r.status === "up" && state.agents[r.name]) {
      newAlerts.push({
        name: r.name, status: "up", ts: Date.now(), kind: "agent_recovered",
      });
      logSync("info", "agent recovered", { agent: r.name });
    }
  }
  state.agents = newState;
  state.alerts = [...state.alerts.slice(-50), ...newAlerts].slice(-100);
  // Fire webhooks (Slack/Telegram/custom) for the new alerts
  if (newAlerts.length > 0) {
    fireWebhooks(newAlerts).catch((e) =>
      logSync("warn", "webhook dispatch failed", { error: String(e?.message || e) })
    );
  }
  // Update history (sliding window)
  state.history.push({
    ts: Date.now(),
    up: results.filter(r => r.status === "up").length,
    down: results.filter(r => r.status === "down").length,
  });
  if (state.history.length > 100) state.history.shift();
  return results;
}

function summary() {
  const agents = Object.values(state.agents);
  const up = agents.filter(a => a.status === "up").length;
  const down = agents.filter(a => a.status === "down").length;
  return {
    status: down === 0 ? "healthy" : (up === 0 ? "unhealthy" : "degraded"),
    agents_total: agents.length,
    agents_up: up,
    agents_down: down,
    last_poll: state.history[state.history.length - 1]?.ts || null,
  };
}

// --- Prometheus metrics ---

function metricsToProm() {
  const lines = [];
  lines.push("# HELP vireo_agents_up Number of agents up (1) or down (0)");
  lines.push("# TYPE vireo_agents_up gauge");
  for (const [name, a] of Object.entries(state.agents)) {
    lines.push(`vireo_agents_up{agent="${name}"} ${a.status === "up" ? 1 : 0}`);
  }
  lines.push("# HELP vireo_agent_latency_ms Agent response latency in ms");
  lines.push("# TYPE vireo_agent_latency_ms gauge");
  for (const [name, a] of Object.entries(state.agents)) {
    lines.push(`vireo_agent_latency_ms{agent="${name}"} ${a.latency_ms}`);
  }
  lines.push("# HELP vireo_polls_total Total number of poll cycles");
  lines.push("# TYPE vireo_polls_total counter");
  lines.push(`vireo_polls_total ${state.metrics.polls_total}`);
  lines.push("# HELP vireo_uptime_seconds Service uptime in seconds");
  lines.push("# TYPE vireo_uptime_seconds gauge");
  lines.push(`vireo_uptime_seconds ${Math.floor((Date.now() - state.metrics.uptime_started) / 1000)}`);
  lines.push("# HELP vireo_alerts_total Total number of alerts fired");
  lines.push("# TYPE vireo_alerts_total counter");
  lines.push(`vireo_alerts_total ${state.alerts.length}`);
  return lines.join("\n") + "\n";
}

// --- HTTP server ---

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function text(res, status, body, contentType = "text/plain") {
  res.writeHead(status, { "Content-Type": contentType });
  res.end(body);
}

function buildHandler() {
  return async (req, res) => {
    const url = req.url.split("?")[0];
    try {
      if (url === "/health") {
        const s = summary();
        const code = s.status === "healthy" ? 200 : (s.status === "degraded" ? 200 : 503);
        return json(res, code, {
          status: s.status,
          service: "monitoring",
          timestamp: new Date().toISOString(),
          ...s,
          agents: state.agents,
        });
      }
      if (url === "/health/summary") {
        return json(res, 200, summary());
      }
      if (url === "/agents") {
        return json(res, 200, { agents: state.agents });
      }
      if (url === "/agents/:name" || /^\/agents\/[\w-]+$/.test(url)) {
        const name = url.split("/")[2];
        const a = state.agents[name];
        if (!a) return json(res, 404, { error: "agent_not_found" });
        return json(res, 200, a);
      }
      if (url === "/alerts") {
        return json(res, 200, { alerts: state.alerts });
      }
      if (url === "/webhooks") {
        return json(res, 200, { webhooks: parseWebhookConfig() });
      }
      if (url === "/alerts/test" && req.method === "POST") {
        // Manual webhook test: re-fire a synthetic alert
        const testAlerts = [{
          name: "test", status: "down", error: "manual test",
          ts: Date.now(), kind: "agent_down",
        }];
        const results = await fireWebhooks(testAlerts);
        return json(res, 200, { results });
      }
      if (url === "/history") {
        return json(res, 200, { history: state.history });
      }
      if (url === "/metrics") {
        return text(res, 200, metricsToProm(), "text/plain; version=0.0.4; charset=utf-8");
      }
      if (url === "/version") {
        return json(res, 200, { version: "0.1.0", service: "monitoring" });
      }
      if (url === "/" || url === "/dashboard") {
        return json(res, 200, {
          service: "monitoring",
          endpoints: [
            "GET /health",
            "GET /health/summary",
            "GET /agents",
            "GET /agents/:name",
            "GET /alerts",
            "GET /history",
            "GET /metrics",
          ],
        });
      }
      return json(res, 404, { error: "not_found", path: url });
    } catch (e) {
      return json(res, 500, { error: "server_error", message: e.message });
    }
  };
}

// --- Webhook dispatch is handled by ./webhooks.js (Slack, Discord, Telegram, generic) ---
// Configure via VIREO_WEBHOOKS (JSON list) or VIREO_WEBHOOK_URL + VIREO_WEBHOOK_KIND.

export function buildServer({ port = DEFAULT_PORT, host = DEFAULT_HOST, fetchImpl = null } = {}) {
  state.fetchImpl = fetchImpl;
  const server = createServer(buildHandler());
  return { server, port, host, state };
}

export function start({ port = DEFAULT_PORT, host = DEFAULT_HOST, fetchImpl = null } = {}) {
  const { server } = buildServer({ port, host, fetchImpl });
  server.listen(port, host, () => {
    logSync("info", "monitoring started", { port, host, poll_interval_ms: POLL_INTERVAL_MS });
    console.log(`[monitoring] listening on http://${host}:${port}`);
  });
  // Start poller
  pollAll().catch(e => logSync("error", "initial poll failed", { error: e.message }));
  const interval = setInterval(() => {
    pollAll().catch(e => logSync("error", "poll failed", { error: e.message }));
  }, POLL_INTERVAL_MS);
  // Graceful shutdown
  const shutdown = () => {
    clearInterval(interval);
    server.close(() => {
      logSync("info", "monitoring stopped");
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  return { server, port, host, state };
}

// Auto-start when invoked directly
import { resolve as pathResolve } from "node:path";
const isMain = (() => {
  if (!process.argv[1]) return false;
  const thisFile = fileURLToPath(import.meta.url);
  const argvFile = pathResolve(process.argv[1]);
  return thisFile === argvFile;
})();
if (isMain) {
  start();
}
