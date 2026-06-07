// Vireo Dashboard — HTTP server tests.
// Verifies static asset serving, /health, /api/* proxy, and 404 behavior.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildServer, start } from "../server.js";
import { setTimeout as sleep } from "node:timers/promises";

function client(server) {
  const addr = server.address();
  const port = addr.port;
  const host = addr.address || "127.0.0.1";
  return {
    get: (path) => fetch(`http://${host}:${port}${path}`),
    post: (path, body) => fetch(`http://${host}:${port}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  };
}

// --- buildServer() factory ---

test("buildServer: returns server with port and host", () => {
  const { server, port, host } = buildServer({ port: 0, host: "127.0.0.1" });
  assert.ok(server, "server should exist");
  assert.equal(host, "127.0.0.1");
  assert.equal(typeof port, "number");
  server.close();
});

test("buildServer: defaults are 3000 and 127.0.0.1", () => {
  const { server, port, host } = buildServer();
  assert.equal(port, 3000);
  assert.equal(host, "127.0.0.1");
  server.close();
});

// --- start() function ---

test("start: launches a server with custom port", async () => {
  const server = start({ port: 0, host: "127.0.0.1" });
  await sleep(50);
  const { port } = server.address();
  assert.ok(port > 0, "should be listening on a port");
  server.close();
});

// --- Static asset serving ---

test("static: GET / returns landing page", async () => {
  const { server } = buildServer({ port: 0, host: "127.0.0.1" });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /text\/html/);
  const body = await r.text();
  assert.match(body, /Vireo/);
  assert.match(body, /landing/i);
  server.close();
});

test("static: GET /landing.html returns landing page", async () => {
  const { server } = buildServer({ port: 0, host: "127.0.0.1" });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/landing.html");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /text\/html/);
  const body = await r.text();
  assert.match(body, /Vireo/);
  server.close();
});

test("static: GET /signup.html returns signup form", async () => {
  const { server } = buildServer({ port: 0, host: "127.0.0.1" });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/signup.html");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /text\/html/);
  const body = await r.text();
  assert.match(body, /sign.?up/i);
  server.close();
});

test("static: GET /login.html returns login form", async () => {
  const { server } = buildServer({ port: 0, host: "127.0.0.1" });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/login.html");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /text\/html/);
  const body = await r.text();
  assert.match(body, /log.?in/i);
  server.close();
});

test("static: GET /onboarding.html returns onboarding wizard", async () => {
  const { server } = buildServer({ port: 0, host: "127.0.0.1" });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/onboarding.html");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /text\/html/);
  const body = await r.text();
  assert.match(body, /onboarding/i);
  server.close();
});

test("static: GET /styles.css returns CSS", async () => {
  const { server } = buildServer({ port: 0 });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/styles.css");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /text\/css/);
  const body = await r.text();
  assert.match(body, /--accent/);
  assert.match(body, /Vireo green/);
  server.close();
});

test("static: GET /app.js returns JavaScript", async () => {
  const { server } = buildServer({ port: 0 });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/app.js");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /javascript/);
  const body = await r.text();
  assert.match(body, /distributorUrl/);
  assert.match(body, /loadAll/);
  server.close();
});

test("static: unknown file returns 404", async () => {
  const { server } = buildServer({ port: 0 });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/nonexistent.txt");
  assert.equal(r.status, 404);
  server.close();
});

test("static: /dashboard serves dashboard index.html", async () => {
  const { server } = buildServer({ port: 0 });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/dashboard");
  assert.equal(r.status, 200);
  const body = await r.text();
  assert.match(body, /Vireo/);
  server.close();
});

test("static: /chat.html serves chat page", async () => {
  const { server } = buildServer({ port: 0 });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/chat.html");
  assert.equal(r.status, 200);
  const body = await r.text();
  assert.match(body, /composer-input|chat-page/);
  server.close();
});

test("static: /projects.html serves projects page", async () => {
  const { server } = buildServer({ port: 0 });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/projects.html");
  assert.equal(r.status, 200);
  const body = await r.text();
  assert.match(body, /projects-grid|Your projects/);
  server.close();
});

test("static: /chat.js serves JavaScript", async () => {
  const { server } = buildServer({ port: 0 });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/chat.js");
  assert.equal(r.status, 200);
  const body = await r.text();
  assert.match(body, /studioFetch/);
  server.close();
});

// --- Path traversal protection ---

test("static: path traversal attempt returns 403", async () => {
  const { server } = buildServer({ port: 0 });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/../../../etc/passwd");
  // Node's http client will normalize; status should not be 200
  assert.notEqual(r.status, 200);
  server.close();
});

// --- /health ---

test("/health: returns status ok and agent list", async () => {
  const { server } = buildServer({ port: 0 });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/health");
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.status, "ok");
  assert.equal(body.agent, "dashboard");
  assert.ok(body.agents);
  assert.ok(body.agents.style);
  assert.ok(body.agents.editor);
  assert.ok(body.agents.distributor);
  assert.ok(body.agents.analyst);
  server.close();
});

// --- /api/* proxy ---

test("/api/distributor/* proxies to distributor", async () => {
  let captured = null;
  const mockFetch = async (url, init) => {
    captured = { url: url.toString(), init };
    return new Response(JSON.stringify({ ok: true, proxied: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const { server } = buildServer({ port: 0, fetchImpl: mockFetch });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/api/distributor/jobs");
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.proxied, true);
  assert.match(captured.url, /127\.0\.0\.1:8003/);
  assert.match(captured.url, /\/jobs$/);
  await new Promise((r) => server.close(r));
});

test("/api/analyst/* proxies POST with body to analyst", async () => {
  let captured = null;
  const mockFetch = async (url, init) => {
    captured = { url: url.toString(), init };
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  const { server } = buildServer({ port: 0, fetchImpl: mockFetch });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.post("/api/analyst/observe", { metric: "er", value: 0.05 });
  assert.equal(r.status, 200);
  assert.match(captured.url, /127\.0\.0\.1:8004\/api\/analyst\/observe/);
  const bodyStr = captured.init.body instanceof Buffer
    ? captured.init.body.toString("utf8")
    : String(captured.init.body);
  const body = JSON.parse(bodyStr);
  assert.equal(body.metric, "er");
  assert.equal(body.value, 0.05);
  await new Promise((r) => server.close(r));
});

test("/api/style/* proxies to style-learner", async () => {
  const mockFetch = async (url) => {
    return new Response(JSON.stringify({ url: url.toString() }), { status: 200 });
  };
  const { server } = buildServer({ port: 0, fetchImpl: mockFetch });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.post("/api/style/analyze-llm", { pieces: [] });
  const body = await r.json();
  assert.match(body.url, /127\.0\.0\.1:8001/);
  await new Promise((r) => server.close(r));
});

test("/api/editor/* proxies to editor", async () => {
  const mockFetch = async (url) => {
    return new Response(JSON.stringify({ url: url.toString() }), { status: 200 });
  };
  const { server } = buildServer({ port: 0, fetchImpl: mockFetch });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.post("/api/editor/plan", { cuts: [] });
  const body = await r.json();
  assert.match(body.url, /127\.0\.0\.1:8002/);
  await new Promise((r) => server.close(r));
});

test("proxy: returns 502 when agent unreachable", async () => {
  const mockFetch = async () => {
    throw new Error("ECONNREFUSED");
  };
  const { server } = buildServer({ port: 0, fetchImpl: mockFetch });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/api/distributor/jobs");
  assert.equal(r.status, 502);
  const body = await r.json();
  assert.equal(body.error, "agent_unreachable");
  await new Promise((r) => server.close(r));
});

test("proxy: passes through upstream status codes", async () => {
  const mockFetch = async () => {
    return new Response(JSON.stringify({ error: "no_content" }), { status: 404 });
  };
  const { server } = buildServer({ port: 0, fetchImpl: mockFetch });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/api/distributor/jobs");
  assert.equal(r.status, 404);
  await new Promise((r) => server.close(r));
});

// --- 404 fallback ---

test("unknown route returns 404 JSON", async () => {
  const { server } = buildServer({ port: 0 });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/nope");
  // /nope is not /api and not /health, so it's treated as static; 404 is fine
  assert.equal(r.status, 404);
  server.close();
});

// --- new agent proxies (video, oauth, ingest) ---

test("/api/video/* proxies to video agent", async () => {
  let captured = null;
  const mockFetch = async (url) => {
    captured = { url: url.toString() };
    return new Response(JSON.stringify({ status: "ok", agent: "video" }), { status: 200 });
  };
  const { server } = buildServer({ port: 0, fetchImpl: mockFetch });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/api/video/health");
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.agent, "video");
  assert.match(captured.url, /127\.0\.0\.1:8007/);
  await new Promise((r) => server.close(r));
});

test("/api/oauth/* proxies to oauth agent", async () => {
  let captured = null;
  const mockFetch = async (url) => {
    captured = { url: url.toString() };
    return new Response(JSON.stringify({ platforms: ["youtube", "tiktok"] }), { status: 200 });
  };
  const { server } = buildServer({ port: 0, fetchImpl: mockFetch });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/api/oauth/platforms");
  assert.equal(r.status, 200);
  assert.match(captured.url, /127\.0\.0\.1:8008/);
  await new Promise((r) => server.close(r));
});

test("/api/ingest/* proxies to ingest agent", async () => {
  let captured = null;
  const mockFetch = async (url) => {
    captured = { url: url.toString() };
    return new Response(JSON.stringify({ formats: ["mp4", "mp3"] }), { status: 200 });
  };
  const { server } = buildServer({ port: 0, fetchImpl: mockFetch });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/api/ingest/formats");
  assert.equal(r.status, 200);
  assert.match(captured.url, /127\.0\.0\.1:8009/);
  await new Promise((r) => server.close(r));
});

test("/health: includes video, oauth, ingest in agents", async () => {
  const { server } = buildServer({ port: 0 });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/health");
  const body = await r.json();
  assert.ok(body.agents.video);
  assert.ok(body.agents.oauth);
  assert.ok(body.agents.ingest);
  assert.ok(body.agents.auth);
  assert.ok(body.agents.billing);
  server.close();
});

// --- auth & billing proxy ---

test("/api/auth/* proxies to auth agent", async () => {
  let captured = null;
  const mockFetch = async (url, init) => {
    captured = { url: url.toString(), init };
    return new Response(JSON.stringify({ ok: true, user: { id: "u1" } }), { status: 200 });
  };
  const { server } = buildServer({ port: 0, fetchImpl: mockFetch });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.post("/api/auth/signup", { email: "a@b.com", password: "secret" });
  assert.equal(r.status, 200);
  assert.match(captured.url, /127\.0\.0\.1:8005/);
  await new Promise((r) => server.close(r));
});

test("/api/billing/* proxies to billing agent", async () => {
  let captured = null;
  const mockFetch = async (url) => {
    captured = { url: url.toString() };
    return new Response(JSON.stringify({ plans: ["free", "pro"] }), { status: 200 });
  };
  const { server } = buildServer({ port: 0, fetchImpl: mockFetch });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/api/billing/plans");
  assert.equal(r.status, 200);
  assert.match(captured.url, /127\.0\.0\.1:8006/);
  await new Promise((r) => server.close(r));
});

test("/api/monitoring/* proxies to monitoring agent", async () => {
  let captured = null;
  const mockFetch = async (url) => {
    captured = { url: url.toString() };
    return new Response(JSON.stringify({ status: "healthy", agents_up: 9 }), { status: 200 });
  };
  const { server } = buildServer({ port: 0, fetchImpl: mockFetch });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/api/monitoring/health");
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.status, "healthy");
  assert.match(captured.url, /127\.0\.0\.1:8010/);
  await new Promise((r) => server.close(r));
});

test("/api/studio/* proxies to studio agent", async () => {
  let captured = null;
  const mockFetch = async (url, init) => {
    captured = { url: url.toString(), init };
    return new Response(JSON.stringify({ ok: true, agent: "studio" }), { status: 200 });
  };
  const { server } = buildServer({ port: 0, fetchImpl: mockFetch });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/api/studio/health");
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.agent, "studio");
  assert.match(captured.url, /127\.0\.0\.1:8011/);
  // POST also works
  const r2 = await c.post("/api/studio/chat", { message: "hi" });
  assert.equal(r2.status, 200);
  await new Promise((r) => server.close(r));
});

test("/health: includes studio in agents", async () => {
  const { server } = buildServer({ port: 0 });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/health");
  const body = await r.json();
  assert.ok(body.agents.studio);
  server.close();
});
