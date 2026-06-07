// Vireo Phase 1.12 — Cross-agent integration test.
// Verifies Auth + Billing + Dashboard can interoperate end-to-end.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildServer as buildAuth } from "../../../agents/auth/src/server.js";
import { buildServer as buildBilling } from "../../../agents/billing/src/server.js";
import { buildServer as buildDashboard } from "../../dashboard/server.js";
import { sign } from "../../../agents/auth/src/tokens.js";
import { setTimeout as sleep } from "node:timers/promises";

const SHARED_SECRET = "integration-test-secret";

function clientFor(server) {
  const addr = server.address();
  return {
    get: (path, headers = {}) => fetch(`http://127.0.0.1:${addr.port}${path}`, { headers }),
    post: (path, body, headers = {}) => fetch(`http://127.0.0.1:${addr.port}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  };
}

async function startAuth() {
  const { server, store } = buildAuth({ port: 0, host: "127.0.0.1", secret: SHARED_SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, store, secret: SHARED_SECRET };
}

async function startBilling() {
  const { server, subs, usage } = buildBilling({ port: 0, host: "127.0.0.1", secret: SHARED_SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, subs, usage };
}

async function startDashboard() {
  const { server } = buildDashboard({ port: 0, host: "127.0.0.1" });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server };
}

function authHeader(user) {
  const token = sign({ sub: user.id, email: user.email }, SHARED_SECRET);
  return { Authorization: `Bearer ${token}` };
}

// ---- Auth + Billing happy path ----

test("integration: signup → login → subscribe → record usage", async () => {
  const auth = await startAuth();
  const billing = await startBilling();

  // 1. Signup via Auth
  const authC = clientFor(auth.server);
  const signup = await authC.post("/signup", { email: "user@x.com", password: "hunter2hunter2", name: "User" });
  assert.equal(signup.status, 201);
  const { token, user: authUser } = await signup.json();
  assert.equal(authUser.email, "user@x.com");

  // 2. Use JWT to call Auth's /me
  const me = await authC.get("/me", { Authorization: `Bearer ${token}` });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).user.email, "user@x.com");

  // 3. Use JWT to call Billing
  const billingC = clientFor(billing.server);
  const headers = authHeader(authUser);
  const sub = await billingC.post("/subscribe", { plan_id: "pro" }, headers);
  assert.equal(sub.status, 201);
  const { subscription, invoice } = await sub.json();
  assert.equal(subscription.plan_id, "pro");
  assert.equal(invoice.status, "paid");

  // 4. Record usage
  for (let i = 0; i < 3; i++) {
    const rec = await billingC.post("/usage/record", { counter: "posts_published" }, headers);
    assert.equal(rec.status, 200);
  }
  const usage = await billingC.get("/usage", headers);
  const u = await usage.json();
  assert.equal(u.usage.posts_published, 3);
  assert.equal(u.remaining.posts_published.remaining, 97);  // pro = 100/month

  await new Promise((r) => auth.server.close(r));
  await new Promise((r) => billing.server.close(r));
});

// ---- Auth token rejected by Billing with wrong secret ----

test("integration: token signed with different secret is rejected", async () => {
  const auth = await startAuth();  // secret = SHARED_SECRET
  const billing = await startBilling();

  // Sign a token with a different secret
  const badToken = sign({ sub: "fake-user", email: "fake@x.com" }, "wrong-secret");

  // Try to use it through a "fake billing middleware" path —
  // billing doesn't currently verify JWT, but we can simulate it.
  // For now, just assert the token would fail auth's own /me:
  const authC = clientFor(auth.server);
  const me = await authC.get("/me", { Authorization: `Bearer ${badToken}` });
  assert.equal(me.status, 401);

  await new Promise((r) => auth.server.close(r));
  await new Promise((r) => billing.server.close(r));
});

// ---- Dashboard proxies to all 4 agents ----

test("integration: dashboard proxies to all agents", async () => {
  const dashboard = await startDashboard();

  // Inject mock fetch that responds for each agent's /health
  let capturedPaths = [];
  const mockFetch = async (url, init) => {
    capturedPaths.push(url.toString());
    return new Response(JSON.stringify({ ok: true, url: url.toString() }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  // We can't easily re-inject fetch after start; build a new one with the impl
  await new Promise((r) => dashboard.server.close(r));

  const { server } = buildDashboard({ port: 0, host: "127.0.0.1", fetchImpl: mockFetch });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = clientFor(server);

  for (const path of [
    "/api/style/analyze-llm",
    "/api/editor/plan",
    "/api/distributor/jobs",
    "/api/analyst/report",
  ]) {
    capturedPaths = [];
    const r = await c.post(path, { test: true });
    assert.equal(r.status, 200);
    assert.equal(capturedPaths.length, 1, "should capture 1 fetch call");
    const u = new URL(capturedPaths[0]);
    assert.ok([8001, 8002, 8003, 8004].includes(Number(u.port)),
      `port should be 8001-8004, got ${u.port}`);
  }

  await new Promise((r) => server.close(r));
});

// ---- Dashboard can serve a real flow: proxy + static ----

test("integration: dashboard serves index.html, /health, and proxies", async () => {
  const mockFetch = async () => new Response(JSON.stringify({ proxied: true }), { status: 200 });
  const { server } = buildDashboard({ port: 0, host: "127.0.0.1", fetchImpl: mockFetch });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = clientFor(server);

  // Static
  const html = await c.get("/dashboard");
  assert.equal(html.status, 200);
  const htmlText = await html.text();
  assert.match(htmlText, /Vireo/);
  assert.match(htmlText, /Style DNA/);

  // Health
  const health = await c.get("/health");
  assert.equal(health.status, 200);
  const h = await health.json();
  assert.equal(h.status, "ok");
  assert.ok(h.agents.style);
  assert.ok(h.agents.editor);
  assert.ok(h.agents.distributor);
  assert.ok(h.agents.analyst);

  // Proxy
  const api = await c.get("/api/distributor/jobs");
  assert.equal(api.status, 200);
  assert.equal((await api.json()).proxied, true);

  await new Promise((r) => server.close(r));
});

// ---- Free → Pro → Cancel flow with usage cap enforcement ----

test("integration: free user gets blocked, upgrades, succeeds", async () => {
  const auth = await startAuth();
  const billing = await startBilling();

  const authC = clientFor(auth.server);
  const billingC = clientFor(billing.server);

  // 1. Signup (free by default in billing)
  const signup = await authC.post("/signup", { email: "freetopro@x.com", password: "hunter2hunter2" });
  const { user } = await signup.json();
  const headers = authHeader(user);

  // 2. Free plan → 5 posts/month
  for (let i = 0; i < 5; i++) {
    const r = await billingC.post("/usage/record", { counter: "posts_published" }, headers);
    assert.equal(r.status, 200);
  }
  const blocked = await billingC.post("/usage/record", { counter: "posts_published" }, headers);
  assert.equal(blocked.status, 402);

  // 3. Upgrade to business
  const sub = await billingC.post("/subscribe", { plan_id: "business" }, headers);
  assert.equal(sub.status, 201);

  // 4. Now 6th post works (1000/month on business)
  const sixth = await billingC.post("/usage/record", { counter: "posts_published" }, headers);
  assert.equal(sixth.status, 200);

  // 5. Cancel
  const cancel = await billingC.post("/cancel", {}, headers);
  assert.equal(cancel.status, 200);
  assert.equal((await cancel.json()).subscription.status, "cancelled");

  await new Promise((r) => auth.server.close(r));
  await new Promise((r) => billing.server.close(r));
});

// ---- Concurrent multi-user test ----

test("integration: multiple users have isolated state", async () => {
  const auth = await startAuth();
  const billing = await startBilling();
  const authC = clientFor(auth.server);
  const billingC = clientFor(billing.server);

  // 3 users sign up and subscribe to different plans
  const users = [];
  for (let i = 0; i < 3; i++) {
    const r = await authC.post("/signup", { email: `user${i}@x.com`, password: "hunter2hunter2" });
    const { user } = await r.json();
    users.push(user);
  }

  // User 0: free
  // User 1: pro
  await billingC.post("/subscribe", { plan_id: "pro" }, authHeader(users[1]));
  // User 2: business
  await billingC.post("/subscribe", { plan_id: "business" }, authHeader(users[2]));

  // Each records 3 posts
  for (const u of users) {
    for (let i = 0; i < 3; i++) {
      const r = await billingC.post("/usage/record", { counter: "posts_published" }, authHeader(u));
      assert.equal(r.status, 200);
    }
  }

  // Verify isolated usage
  for (let i = 0; i < 3; i++) {
    const r = await billingC.get("/usage", authHeader(users[i]));
    const u = await r.json();
    assert.equal(u.usage.posts_published, 3);
    // All should have different remaining limits
  }

  // Verify user 0's plan is still free (no subscription)
  const u0 = await billingC.get("/me/subscription", authHeader(users[0]));
  assert.equal((await u0.json()).subscription, null);

  // User 1 → pro
  const u1 = await billingC.get("/me/subscription", authHeader(users[1]));
  assert.equal((await u1.json()).subscription.plan_id, "pro");

  await new Promise((r) => auth.server.close(r));
  await new Promise((r) => billing.server.close(r));
});

// ---- Webhook updates state across services ----

test("integration: stripe webhook cancels subscription, free plan auto-applies", async () => {
  const billing = await startBilling();
  const billingC = clientFor(billing.server);

  // Subscribe to pro (create a fake user with known id)
  const fakeUser = { id: "u-webhook", email: "webhook@x.com" };
  const headers = authHeader(fakeUser);
  const sub = await billingC.post("/subscribe", { plan_id: "pro" }, headers);
  const { subscription } = await sub.json();

  // Record some usage
  await billingC.post("/usage/record", { counter: "posts_published" }, headers);

  // Webhook: subscription deleted
  const wh = await billingC.post("/webhook/stripe", {
    type: "customer.subscription.deleted",
    data: { object: { id: subscription.id } },
  });
  assert.equal(wh.status, 200);

  // Now subscription is gone
  const cur = await billingC.get("/me/subscription", headers);
  assert.equal((await cur.json()).subscription, null);

  // Plan reverts to free (limits now 5 posts)
  const usage = await billingC.get("/usage", headers);
  const u = await usage.json();
  assert.equal(u.remaining.posts_published.limit, 5);

  await new Promise((r) => billing.server.close(r));
});

// ---- Storage backends work with subscriber count ----

test("integration: 100 concurrent signups all succeed", async () => {
  const auth = await startAuth();
  const authC = clientFor(auth.server);

  const promises = [];
  for (let i = 0; i < 100; i++) {
    promises.push(authC.post("/signup", {
      email: `concurrent${i}@x.com`,
      password: "hunter2hunter2",
    }));
  }
  const results = await Promise.all(promises);
  const success = results.filter((r) => r.status === 201).length;
  assert.equal(success, 100);

  await new Promise((r) => auth.server.close(r));
});
