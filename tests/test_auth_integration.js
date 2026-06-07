// Tests for auth middleware integration across Node.js agents.
// Verifies that servers reject unauthorized requests when VIREO_JWT_SECRET is set,
// and accept valid JWT tokens.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { signToken, verifyToken } from "../packages/auth-middleware/index.js";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

function agentUrl(rel) {
  return pathToFileURL(resolve(ROOT, rel)).href;
}

const SECRET = "test-integration-secret-key-32chars!!!";

function makeToken(overrides = {}) {
  return signToken({ sub: "user_test", email: "test@vireo.ai", name: "Test User", ...overrides }, SECRET, 3600);
}

// ---------- Auth Middleware Unit Tests ----------

describe("auth-middleware", () => {
  test("signToken creates a valid JWT", () => {
    const token = makeToken();
    assert.ok(typeof token === "string");
    assert.equal(token.split(".").length, 3);
  });

  test("verifyToken validates a correct token", () => {
    const token = makeToken({ sub: "u1", plan: "pro" });
    const claims = verifyToken(token, SECRET);
    assert.ok(claims);
    assert.equal(claims.sub, "u1");
    assert.equal(claims.plan, "pro");
  });

  test("verifyToken rejects wrong secret", () => {
    const token = makeToken();
    const claims = verifyToken(token, "wrong-secret");
    assert.equal(claims, null);
  });

  test("verifyToken rejects expired token", () => {
    const token = signToken({ sub: "u1" }, SECRET, -100);
    const claims = verifyToken(token, SECRET);
    assert.equal(claims, null);
  });

  test("verifyToken accepts token within clock skew", () => {
    const token = signToken({ sub: "u1" }, SECRET, -20);
    const claims = verifyToken(token, SECRET, { clockSkewSec: 30 });
    assert.ok(claims);
  });

  test("verifyToken rejects tampered token", () => {
    const token = makeToken();
    const parts = token.split(".");
    const tampered = parts[0] + "." + parts[1] + ".TAMPERED";
    assert.equal(verifyToken(tampered, SECRET), null);
  });

  test("verifyToken handles empty/null inputs", () => {
    assert.equal(verifyToken("", SECRET), null);
    assert.equal(verifyToken(null, SECRET), null);
    assert.equal(verifyToken("abc", ""), null);
    assert.equal(verifyToken(null, null), null);
  });
});

// ---------- Distributor Auth ----------

describe("Distributor server auth", () => {
  let bundle;
  const PORT = 19101;

  test.before(async () => {
    const { buildServer } = await import(agentUrl("agents/distributor/src/server.js"));
    bundle = buildServer({ port: PORT, host: "127.0.0.1", secret: SECRET });
    await new Promise((r) => bundle.server.listen(PORT, "127.0.0.1", r));
  });

  test.after(() => bundle?.server?.close());

  test("GET /health is public (no auth needed)", async () => {
    const r = await fetch(`http://127.0.0.1:${PORT}/health`);
    assert.equal(r.status, 200);
  });

  test("GET /version requires auth", async () => {
    const r = await fetch(`http://127.0.0.1:${PORT}/version`);
    assert.equal(r.status, 401);
  });

  test("GET /version with valid token", async () => {
    const token = makeToken();
    const r = await fetch(`http://127.0.0.1:${PORT}/version`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.version, "0.1.0");
  });

  test("POST /distribute requires auth", async () => {
    const r = await fetch(`http://127.0.0.1:${PORT}/distribute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content_id: "test" }),
    });
    assert.equal(r.status, 401);
  });

  test("POST /distribute with valid token", async () => {
    const token = makeToken();
    const r = await fetch(`http://127.0.0.1:${PORT}/distribute`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        editPlan: { source_id: "test-1", cuts: [] },
        styleDna: { user_id: "u1", tone: "energetic" },
        platforms: ["youtube"],
        contentId: "test-1",
      }),
    });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.ok, true);
  });

  test("POST /distribute with invalid token", async () => {
    const r = await fetch(`http://127.0.0.1:${PORT}/distribute`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer invalid.token.here" },
      body: JSON.stringify({ content_id: "test" }),
    });
    assert.equal(r.status, 401);
  });
});

// ---------- Analyst Auth ----------

describe("Analyst server auth", () => {
  let bundle;
  const PORT = 19104;

  test.before(async () => {
    const { buildServer } = await import(agentUrl("agents/analyst/src/server.js"));
    bundle = buildServer({ port: PORT, host: "127.0.0.1", secret: SECRET });
    await new Promise((r) => bundle.server.listen(PORT, "127.0.0.1", r));
  });

  test.after(() => bundle?.server?.close());

  test("GET /health is public", async () => {
    const r = await fetch(`http://127.0.0.1:${PORT}/health`);
    assert.equal(r.status, 200);
  });

  test("POST /ingest requires auth", async () => {
    const r = await fetch(`http://127.0.0.1:${PORT}/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content_id: "c1" }),
    });
    assert.equal(r.status, 401);
  });

  test("POST /ingest with valid token", async () => {
    const token = makeToken();
    const r = await fetch(`http://127.0.0.1:${PORT}/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ content_id: "c1", platform: "youtube", views: 100 }),
    });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.ok, true);
  });
});

// ---------- Billing Auth ----------

describe("Billing server auth", () => {
  let bundle;
  const PORT = 19106;

  test.before(async () => {
    const { buildServer } = await import(agentUrl("agents/billing/src/server.js"));
    bundle = buildServer({ port: PORT, host: "127.0.0.1", secret: SECRET });
    await new Promise((r) => bundle.server.listen(PORT, "127.0.0.1", r));
  });

  test.after(() => bundle?.server?.close());

  test("GET /health is public", async () => {
    const r = await fetch(`http://127.0.0.1:${PORT}/health`);
    assert.equal(r.status, 200);
  });

  test("GET /plans is public", async () => {
    const r = await fetch(`http://127.0.0.1:${PORT}/plans`);
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.ok(Array.isArray(body.plans));
  });

  test("GET /me/subscription requires auth", async () => {
    const r = await fetch(`http://127.0.0.1:${PORT}/me/subscription`);
    assert.equal(r.status, 401);
  });

  test("GET /me/subscription with valid token", async () => {
    const token = makeToken();
    const r = await fetch(`http://127.0.0.1:${PORT}/me/subscription`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.subscription, null);
    assert.equal(body.plan.id, "free");
  });

  test("POST /subscribe requires auth", async () => {
    const r = await fetch(`http://127.0.0.1:${PORT}/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan_id: "pro" }),
    });
    assert.equal(r.status, 401);
  });

  test("POST /webhook/stripe is public (uses Stripe signature)", async () => {
    const r = await fetch(`http://127.0.0.1:${PORT}/webhook/stripe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "customer.subscription.updated" }),
    });
    assert.notEqual(r.status, 401);
  });
});

// ---------- OAuth Auth ----------

describe("OAuth server auth", () => {
  let bundle;
  const PORT = 19108;

  // Bug O-12: buildServer now requires an explicit `oauth` module (in
  // production: Python child_process bridge; in tests: a mock object).
  // The auth-integration suite doesn't exercise OAuth flow logic — just
  // /health and /me/accounts — so an empty mock is enough.
  const mockOauth = {
    PLATFORMS: {},
    listPlatforms: () => [],
    getPlatform: () => null,
  };

  test.before(async () => {
    const { buildServer } = await import(agentUrl("agents/oauth/src/server.js"));
    bundle = buildServer({ port: PORT, host: "127.0.0.1", secret: SECRET, oauth: mockOauth });
    await new Promise((r) => bundle.server.listen(PORT, "127.0.0.1", r));
  });

  test.after(() => bundle?.server?.close());

  test("GET /health is public", async () => {
    const r = await fetch(`http://127.0.0.1:${PORT}/health`);
    assert.equal(r.status, 200);
  });

  test("GET /me/accounts requires auth", async () => {
    const r = await fetch(`http://127.0.0.1:${PORT}/me/accounts`);
    assert.equal(r.status, 401);
  });

  test("GET /me/accounts with valid token", async () => {
    const token = makeToken();
    const r = await fetch(`http://127.0.0.1:${PORT}/me/accounts`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.ok(Array.isArray(body.accounts));
  });
});

// ---------- Ingest Auth ----------

describe("Ingest server auth", () => {
  let bundle;
  const PORT = 19109;

  test.before(async () => {
    const { buildServer } = await import(agentUrl("agents/ingest/src/server.js"));
    bundle = buildServer({ port: PORT, host: "127.0.0.1", secret: SECRET });
    await new Promise((r) => bundle.server.listen(PORT, "127.0.0.1", r));
  });

  test.after(() => bundle?.server?.close());

  test("GET /health is public", async () => {
    const r = await fetch(`http://127.0.0.1:${PORT}/health`);
    assert.equal(r.status, 200);
  });

  test("GET /formats is public", async () => {
    const r = await fetch(`http://127.0.0.1:${PORT}/formats`);
    assert.equal(r.status, 200);
  });

  test("POST /ingest/text requires auth", async () => {
    const r = await fetch(`http://127.0.0.1:${PORT}/ingest/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hello world" }),
    });
    assert.equal(r.status, 401);
  });

  test("POST /ingest/text with valid token", async () => {
    const token = makeToken();
    const r = await fetch(`http://127.0.0.1:${PORT}/ingest/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ text: "This is a test sentence. And another one." }),
    });
    assert.equal(r.status, 201);
    const body = await r.json();
    assert.ok(body.pieces.length > 0);
  });
});

// ---------- No-secret mode (optional auth) ----------

describe("Optional auth when no secret", () => {
  let bundle;
  const PORT = 19110;

  test.before(async () => {
    const { buildServer } = await import(agentUrl("agents/distributor/src/server.js"));
    bundle = buildServer({ port: PORT, host: "127.0.0.1", secret: "" });
    await new Promise((r) => bundle.server.listen(PORT, "127.0.0.1", r));
  });

  test.after(() => bundle?.server?.close());

  test("POST /distribute works without token when no secret", async () => {
    const r = await fetch(`http://127.0.0.1:${PORT}/distribute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        editPlan: { source_id: "test-1", cuts: [] },
        styleDna: { user_id: "u1", tone: "energetic" },
        platforms: ["youtube"],
        contentId: "test-1",
      }),
    });
    assert.equal(r.status, 200);
  });
});
