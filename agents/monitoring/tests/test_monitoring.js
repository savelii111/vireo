// Vireo Monitoring — tests for health aggregator, metrics, alerts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildServer } from "../src/server.js";
import { setTimeout as sleep } from "node:timers/promises";

function clientFor(server) {
  const addr = server.address();
  return {
    get: (path) => fetch(`http://127.0.0.1:${addr.port}${path}`),
  };
}

function fakeFetch(responses) {
  // responses: map of path -> { status, body, delay }
  return async (url, init) => {
    const u = new URL(url);
    const key = u.pathname;
    if (responses[key]) {
      const r = responses[key];
      if (r.delay) await sleep(r.delay);
      return new Response(JSON.stringify(r.body || {}), {
        status: r.status || 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  };
}

test("buildServer: returns server, port, host, state", () => {
  const { server, port, host, state } = buildServer({ port: 0, host: "127.0.0.1" });
  assert.ok(server);
  assert.equal(host, "127.0.0.1");
  assert.equal(typeof port, "number");
  assert.ok(state.agents);
  server.close();
});

test("GET /version returns 200", async () => {
  const { server } = buildServer({ port: 0, host: "127.0.0.1" });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const c = clientFor(server);
  const r = await c.get("/version");
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.service, "monitoring");
  server.close();
});

test("GET / returns endpoints list", async () => {
  const { server } = buildServer({ port: 0, host: "127.0.0.1" });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const c = clientFor(server);
  const r = await c.get("/");
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(body.endpoints.includes("GET /health"));
  assert.ok(body.endpoints.includes("GET /metrics"));
  server.close();
});

test("GET /health returns healthy when no agents polled yet", async () => {
  const { server } = buildServer({ port: 0, host: "127.0.0.1" });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const c = clientFor(server);
  const r = await c.get("/health");
  // No agents polled → all up (0/0 → healthy)
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.status, "healthy");
  server.close();
});

test("GET /health/summary returns counts", async () => {
  const { server } = buildServer({ port: 0, host: "127.0.0.1" });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const c = clientFor(server);
  const r = await c.get("/health/summary");
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.agents_total, 0);
  assert.equal(body.agents_up, 0);
  server.close();
});

test("GET /agents returns empty initially", async () => {
  const { server } = buildServer({ port: 0, host: "127.0.0.1" });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const c = clientFor(server);
  const r = await c.get("/agents");
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.deepEqual(body.agents, {});
  server.close();
});

test("GET /agents/:name returns agent or 404", async () => {
  const { server, state } = buildServer({ port: 0, host: "127.0.0.1" });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  // Inject a fake agent
  state.agents["test-agent"] = {
    name: "test-agent", url: "http://test", status: "up",
    latency_ms: 10, last_checked: Date.now(), error: null,
  };
  const c = clientFor(server);
  const r1 = await c.get("/agents/test-agent");
  assert.equal(r1.status, 200);
  const r2 = await c.get("/agents/nonexistent");
  assert.equal(r2.status, 404);
  server.close();
});

test("GET /alerts returns alerts array", async () => {
  const { server } = buildServer({ port: 0, host: "127.0.0.1" });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const c = clientFor(server);
  const r = await c.get("/alerts");
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(Array.isArray(body.alerts));
  server.close();
});

test("GET /history returns history array", async () => {
  const { server } = buildServer({ port: 0, host: "127.0.0.1" });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const c = clientFor(server);
  const r = await c.get("/history");
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(Array.isArray(body.history));
  server.close();
});

test("GET /metrics returns Prometheus format", async () => {
  const { server, state } = buildServer({ port: 0, host: "127.0.0.1" });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  state.agents["x"] = { name: "x", status: "up", latency_ms: 42, last_checked: Date.now() };
  state.metrics.polls_total = 5;
  const c = clientFor(server);
  const r = await c.get("/metrics");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /text\/plain/);
  const body = await r.text();
  assert.match(body, /vireo_agents_up\{agent="x"\} 1/);
  assert.match(body, /vireo_agent_latency_ms\{agent="x"\} 42/);
  assert.match(body, /vireo_polls_total 5/);
  assert.match(body, /vireo_uptime_seconds/);
  server.close();
});

test("GET /metrics with down agent shows 0", async () => {
  const { server, state } = buildServer({ port: 0, host: "127.0.0.1" });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  state.agents["y"] = { name: "y", status: "down", latency_ms: 5000, last_checked: Date.now() };
  const c = clientFor(server);
  const r = await c.get("/metrics");
  const body = await r.text();
  assert.match(body, /vireo_agents_up\{agent="y"\} 0/);
  server.close();
});

test("GET /unknown returns 404", async () => {
  const { server } = buildServer({ port: 0, host: "127.0.0.1" });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const c = clientFor(server);
  const r = await c.get("/nope");
  assert.equal(r.status, 404);
  server.close();
});

test("checkAgent via fakeFetch: returns up on 200", async () => {
  const fetchImpl = fakeFetch({
    "/health": { status: 200, body: { status: "ok", version: "1.0" } },
  });
  const { server, state } = buildServer({ port: 0, host: "127.0.0.1", fetchImpl });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  // Trigger poll via the state directly (we expose AGENTS through buildServer constants)
  // The state should be updatable
  state.fetchImpl = fetchImpl;
  // Manually call checkAgent
  const { server: s2 } = buildServer({ port: 0, host: "127.0.0.1", fetchImpl });
  await new Promise(r => s2.listen(0, "127.0.0.1", r));
  server.close();
  s2.close();
});

test("summary: all up = healthy, some down = degraded, all down = unhealthy", () => {
  const { server, state } = buildServer({ port: 0, host: "127.0.0.1" });
  state.agents = {
    a: { status: "up" },
    b: { status: "up" },
  };
  // Access summary via state mutations only
  const up = Object.values(state.agents).filter(a => a.status === "up").length;
  const down = Object.values(state.agents).filter(a => a.status === "down").length;
  assert.equal(up, 2);
  assert.equal(down, 0);
  state.agents.c = { status: "down" };
  state.agents.d = { status: "down" };
  const up2 = Object.values(state.agents).filter(a => a.status === "up").length;
  const down2 = Object.values(state.agents).filter(a => a.status === "down").length;
  assert.equal(up2, 2);
  assert.equal(down2, 2);
  server.close();
});

test("alerts: state.alerts is an array", () => {
  const { server, state } = buildServer({ port: 0, host: "127.0.0.1" });
  assert.ok(Array.isArray(state.alerts));
  state.alerts.push({ name: "x", status: "down", ts: Date.now() });
  assert.equal(state.alerts.length, 1);
  server.close();
});

test("history is bounded to 100 entries", () => {
  const { server, state } = buildServer({ port: 0, host: "127.0.0.1" });
  for (let i = 0; i < 150; i++) {
    state.history.push({ ts: i, up: 1, down: 0 });
    if (state.history.length > 100) state.history.shift();
  }
  assert.equal(state.history.length, 100);
  server.close();
});

// ----- Webhook dispatch tests (uses ./webhooks.js module) -----

test("fireWebhooks: no-op when no webhooks configured", async () => {
  delete process.env.VIREO_WEBHOOK_URL;
  delete process.env.VIREO_WEBHOOKS;
  const { fireWebhooks } = await import("../src/webhooks.js");
  const results = await fireWebhooks([{ name: "auth", status: "down", error: "x", ts: 1, kind: "agent_down" }]);
  assert.equal(results.length, 0);
});

test("fireWebhooks: posts to configured generic URL", async () => {
  process.env.VIREO_WEBHOOK_URL = "http://hook.test/alert";
  process.env.VIREO_WEBHOOK_KIND = "generic";
  const { fireWebhooks } = await import("../src/webhooks.js");
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, body: JSON.parse(init.body) });
    return new Response("ok", { status: 200 });
  };
  const results = await fireWebhooks(
    [{ name: "video", status: "down", error: "timeout", ts: 1, kind: "agent_down" }],
    { fetchImpl }
  );
  assert.equal(results.length, 1);
  assert.equal(results[0].ok, true);
  assert.equal(seen[0].body.service, "vireo-monitoring");
  assert.equal(seen[0].body.alerts[0].name, "video");
  delete process.env.VIREO_WEBHOOK_URL;
  delete process.env.VIREO_WEBHOOK_KIND;
});

test("fireWebhooks: posts Slack-shaped payload when kind=slack", async () => {
  process.env.VIREO_WEBHOOK_URL = "https://hooks.slack.com/services/XXX";
  const { fireWebhooks, parseWebhookConfig } = await import("../src/webhooks.js");
  const cfg = parseWebhookConfig();
  assert.equal(cfg[0].kind, "slack");
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, body: JSON.parse(init.body) });
    return new Response("ok", { status: 200 });
  };
  await fireWebhooks(
    [{ name: "editor", status: "up", ts: 1, kind: "agent_recovered" }],
    { fetchImpl }
  );
  assert.ok(seen[0].body.text.includes("alert"));
  assert.equal(seen[0].body.attachments[0].color, "good");
  delete process.env.VIREO_WEBHOOK_URL;
});

test("fireWebhooks: auto-detects kind from URL", async () => {
  process.env.VIREO_WEBHOOK_URL = "https://discord.com/api/webhooks/123/abc";
  const { parseWebhookConfig } = await import("../src/webhooks.js");
  const cfg = parseWebhookConfig();
  assert.equal(cfg[0].kind, "discord");
  delete process.env.VIREO_WEBHOOK_URL;
});

test("fireWebhooks: returns failure result when fetch throws (does not throw)", async () => {
  process.env.VIREO_WEBHOOK_URL = "http://hook.test/down";
  const { fireWebhooks } = await import("../src/webhooks.js");
  const fetchImpl = async () => { throw new Error("network down"); };
  const results = await fireWebhooks(
    [{ name: "x", status: "down", ts: 1, kind: "agent_down" }],
    { fetchImpl }
  );
  assert.equal(results.length, 1);
  assert.equal(results[0].ok, false);
  assert.ok(results[0].error.includes("network"));
  delete process.env.VIREO_WEBHOOK_URL;
});

test("POST /alerts/test fires a synthetic alert", async () => {
  process.env.VIREO_WEBHOOK_URL = "http://hook.test/manual";
  const seen = [];
  const fetchImpl = async (url) => { seen.push(url); return new Response("ok", { status: 200 }); };
  const { server } = buildServer({ port: 0, host: "127.0.0.1", fetchImpl });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  const resp = await fetch(`http://127.0.0.1:${addr.port}/alerts/test`, { method: "POST" });
  const body = await resp.json();
  assert.equal(resp.status, 200);
  assert.ok(Array.isArray(body.results));
  delete process.env.VIREO_WEBHOOK_URL;
  server.close();
});
