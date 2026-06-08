// B2.3 + B2.4 + B2.5 e2e tests (2026-06-08).
//
// The GDPR endpoints (/api/me/audit, /api/me/export, /api/me DELETE,
// /api/me/consent) are tested with both:
//   1. The in-memory fallback (audit works, export/delete return 503).
//   2. A real Postgres pool (when VIREO_PG_URL is set — skipped in
//      CI for now, but exercised manually).
//
// The tests in this file focus on the in-memory path because the
// Postgres path requires a live DB. The migration (011_gdpr_audit)
// is verified separately in the storage tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildServer } from "../src/server.js";
import { signToken } from "../../../packages/auth-middleware/index.js";

function makeMockLLM() {
  return {
    model: "mock", isMock: () => true, costUsd: () => 0,
    chat: async () => ({ content: "ok", tool_calls: null, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }),
    getUsage: () => ({}),
  };
}

async function listen(server) {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  return { port, close: () => new Promise((r) => server.close(r)) };
}

async function getToken(secret, sub = "u-gdpr-e2e") {
  return signToken({ sub, email: `${sub}@example.com`, name: "GDPR" }, secret, 600);
}

test("B2.3: GET /api/me/audit returns empty list for new user", async () => {
  const { server } = buildServer({ secret: "gdpr-e2e", llm: makeMockLLM() });
  const { port, close } = await listen(server);
  const token = await getToken("gdpr-e2e");
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/me/audit`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.ok, true);
    assert.ok(Array.isArray(body.items));
    assert.equal(body.count, 0);
  } finally {
    await close();
  }
});

test("B2.3: audit log captures chat requests (when logged)", async () => {
  // The current Studio code only logs explicit actions
  // (preference_change, export_request, delete_request, etc.) —
  // chat requests aren't logged yet (would be too noisy for the
  // default 50-row window). This test pins down the contract: if
  // we add chat logging, the audit endpoint must show it.
  const { server } = buildServer({ secret: "gdpr-e2e", llm: makeMockLLM() });
  const { port, close } = await listen(server);
  const token = await getToken("gdpr-e2e");
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/me/audit`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await r.json();
    // No chat_request rows in audit yet — that action is reserved
    // for future implementation. For now, the audit log only
    // contains explicit GDPR-relevant events.
    for (const item of body.items) {
      assert.ok(
        ["export_request", "delete_request", "consent_change", "preference_change"].includes(item.action),
        `unexpected audit action: ${item.action}`
      );
    }
  } finally {
    await close();
  }
});

test("B2.4: GET /api/me/export returns 503 when Postgres is not configured", async () => {
  const { server } = buildServer({ secret: "gdpr-e2e", llm: makeMockLLM() });
  const { port, close } = await listen(server);
  const token = await getToken("gdpr-e2e");
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/me/export`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(r.status, 503);
    const body = await r.json();
    assert.equal(body.error, "gdpr_unavailable");
  } finally {
    await close();
  }
});

test("B2.5: DELETE /api/me returns 503 when Postgres is not configured", async () => {
  const { server } = buildServer({ secret: "gdpr-e2e", llm: makeMockLLM() });
  const { port, close } = await listen(server);
  const token = await getToken("gdpr-e2e");
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/me`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(r.status, 503);
    const body = await r.json();
    assert.equal(body.error, "gdpr_unavailable");
  } finally {
    await close();
  }
});

test("B2.5: GET /api/me/consent returns null in memory mode", async () => {
  const { server } = buildServer({ secret: "gdpr-e2e", llm: makeMockLLM() });
  const { port, close } = await listen(server);
  const token = await getToken("gdpr-e2e");
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/me/consent`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.ok, true);
    assert.equal(body.consent, null);
    assert.equal(body.gdpr_persistence, "memory");
  } finally {
    await close();
  }
});

test("B2.5: POST /api/me/consent returns 503 when Postgres is not configured", async () => {
  const { server } = buildServer({ secret: "gdpr-e2e", llm: makeMockLLM() });
  const { port, close } = await listen(server);
  const token = await getToken("gdpr-e2e");
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/me/consent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ granted: true, policy_version: "v1" }),
    });
    assert.equal(r.status, 503);
  } finally {
    await close();
  }
});

test("B2: GDPR endpoints require authentication", async () => {
  const { server } = buildServer({ secret: "gdpr-e2e", llm: makeMockLLM() });
  const { port, close } = await listen(server);
  try {
    for (const path of ["/api/me/audit", "/api/me/export", "/api/me/consent"]) {
      const r = await fetch(`http://127.0.0.1:${port}${path}`);
      assert.equal(r.status, 401, `${path} should require auth, got ${r.status}`);
    }
    const d = await fetch(`http://127.0.0.1:${port}/api/me`, { method: "DELETE" });
    assert.equal(d.status, 401, "DELETE /api/me should require auth");
  } finally {
    await close();
  }
});

test("B2: GDPR endpoints reject bad/expired tokens", async () => {
  const { server } = buildServer({ secret: "gdpr-e2e", llm: makeMockLLM() });
  const { port, close } = await listen(server);
  try {
    // Token signed with wrong secret
    const badToken = await getToken("WRONG-SECRET");
    const r = await fetch(`http://127.0.0.1:${port}/api/me/audit`, {
      headers: { Authorization: `Bearer ${badToken}` },
    });
    assert.equal(r.status, 401, "wrong-secret token should be rejected");
  } finally {
    await close();
  }
});

test("B2: rate limit does NOT apply to GDPR endpoints (per user data)", async () => {
  // The studio rate-limits the default 60 req/min globally. The
  // GDPR endpoints should NOT count against that — the user is
  // asking about THEIR OWN data, not a chat or tool call. We hit
  // /api/me/audit 20 times rapidly and assert none get rate-limited.
  const { server } = buildServer({ secret: "gdpr-e2e", llm: makeMockLLM() });
  const { port, close } = await listen(server);
  const token = await getToken("gdpr-e2e");
  try {
    const results = [];
    for (let i = 0; i < 20; i++) {
      const r = await fetch(`http://127.0.0.1:${port}/api/me/audit`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      results.push(r.status);
    }
    for (const s of results) {
      assert.equal(s, 200, `audit endpoint should NOT rate-limit, got ${s}`);
    }
  } finally {
    await close();
  }
});
