// Vireo Billing — tests.

import { test } from "node:test";
import assert from "node:assert/strict";
import { PLANS, PLAN_IDS, getPlan, listPlans, isLimitExceeded } from "../src/plans.js";
import { SubscriptionStore, ValidationError, NotFoundError } from "../src/subscriptions.js";
import { UsageMeter, currentYearMonth } from "../src/usage.js";
import { createInvoice, payInvoice } from "../src/invoices.js";
import { buildServer, start } from "../src/server.js";
import { signToken } from "../../../packages/auth-middleware/index.js";

// =====================================================================
// plans.js
// =====================================================================

test("plans: 4 plans defined", () => {
  assert.equal(PLAN_IDS.length, 4);
  for (const id of ["free", "pro", "business", "enterprise"]) {
    assert.ok(PLANS[id], `plan ${id} should exist`);
  }
});

test("plans: free is free (0 cents), others are paid", () => {
  assert.equal(getPlan("free").price_cents, 0);
  assert.ok(getPlan("pro").price_cents > 0);
  assert.ok(getPlan("business").price_cents > 0);
  assert.ok(getPlan("enterprise").price_cents > 0);
});

test("plans: prices increase monotonically", () => {
  assert.ok(getPlan("free").price_cents < getPlan("pro").price_cents);
  assert.ok(getPlan("pro").price_cents < getPlan("business").price_cents);
  assert.ok(getPlan("business").price_cents < getPlan("enterprise").price_cents);
});

test("plans: each plan has limits and features", () => {
  for (const p of listPlans()) {
    assert.ok(p.limits, "plan must have limits");
    assert.ok(p.features, "plan must have features");
    assert.ok(typeof p.limits.posts_per_month === "number");
  }
});

test("plans: getPlan returns null for unknown", () => {
  assert.equal(getPlan("nope"), null);
});

test("plans: enterprise is unlimited (-1)", () => {
  const e = getPlan("enterprise");
  assert.equal(e.limits.posts_per_month, -1);
  assert.equal(e.limits.storage_mb, -1);
  assert.equal(e.limits.llm_tokens_per_month, -1);
});

test("plans: isLimitExceeded handles -1 (unlimited)", () => {
  assert.equal(isLimitExceeded("enterprise", "posts_per_month", 1_000_000), false);
  assert.equal(isLimitExceeded("free", "posts_per_month", 6), true);
  assert.equal(isLimitExceeded("free", "posts_per_month", 5), false);
  assert.equal(isLimitExceeded("free", "posts_per_month", 0), false);
});

test("plans: isLimitExceeded returns true for unknown plan", () => {
  assert.equal(isLimitExceeded("nope", "posts_per_month", 1), true);
});

// =====================================================================
// usage.js
// =====================================================================

test("usage: currentYearMonth returns YYYY-MM", () => {
  const ym = currentYearMonth(new Date("2026-06-02T12:00:00Z"));
  assert.equal(ym, "2026-06");
});

test("usage: record increments counter", () => {
  const m = new UsageMeter();
  m.record("u1", "posts_published");
  m.record("u1", "posts_published");
  m.record("u1", "posts_published");
  assert.equal(m.get("u1", "posts_published"), 3);
});

test("usage: get returns 0 for unrecorded counter", () => {
  const m = new UsageMeter();
  assert.equal(m.get("u1", "posts_published"), 0);
});

test("usage: different counters are independent", () => {
  const m = new UsageMeter();
  m.record("u1", "posts_published", 5);
  m.record("u1", "llm_tokens", 1000);
  assert.equal(m.get("u1", "posts_published"), 5);
  assert.equal(m.get("u1", "llm_tokens"), 1000);
});

test("usage: different users are isolated", () => {
  const m = new UsageMeter();
  m.record("u1", "posts_published");
  m.record("u2", "posts_published", 10);
  assert.equal(m.get("u1", "posts_published"), 1);
  assert.equal(m.get("u2", "posts_published"), 10);
});

test("usage: getAll returns all counters with defaults of 0", () => {
  const m = new UsageMeter();
  const all = m.getAll("u1");
  for (const c of ["posts_published", "llm_tokens", "storage_mb", "style_dna_samples"]) {
    assert.equal(all[c], 0);
  }
});

test("usage: rejects unknown counter", () => {
  const m = new UsageMeter();
  assert.throws(() => m.record("u1", "made_up"), /unknown counter/);
});

// =====================================================================
// subscriptions.js
// =====================================================================

test("subs: createSubscription on free plan works without stripe", () => {
  const s = new SubscriptionStore();
  const sub = s.createSubscription({ userId: "u1", planId: "free" });
  assert.equal(sub.plan_id, "free");
  assert.equal(sub.status, "active");
  assert.equal(sub.stripe_subscription_id, null);
});

test("subs: createSubscription on paid plan gets mock stripe id", () => {
  const s = new SubscriptionStore();
  const sub = s.createSubscription({ userId: "u1", planId: "pro" });
  assert.ok(sub.stripe_subscription_id, "should have stripe id");
  assert.match(sub.stripe_subscription_id, /^sub_stripe_/);
});

test("subs: createSubscription rejects unknown plan", () => {
  const s = new SubscriptionStore();
  assert.throws(() => s.createSubscription({ userId: "u1", planId: "nope" }), ValidationError);
});

test("subs: createSubscription cancels previous active sub", () => {
  const s = new SubscriptionStore();
  const a = s.createSubscription({ userId: "u1", planId: "pro" });
  const b = s.createSubscription({ userId: "u1", planId: "business" });
  assert.equal(s.getById(a.id).status, "cancelled");
  assert.equal(b.status, "active");
});

test("subs: getForUser returns active subscription", () => {
  const s = new SubscriptionStore();
  s.createSubscription({ userId: "u1", planId: "pro" });
  const got = s.getForUser("u1");
  assert.equal(got.plan_id, "pro");
  assert.equal(got.status, "active");
});

test("subs: getForUser returns null when no active sub", () => {
  const s = new SubscriptionStore();
  assert.equal(s.getForUser("nope"), null);
});

test("subs: cancelSubscription sets status and flag", () => {
  const s = new SubscriptionStore();
  const sub = s.createSubscription({ userId: "u1", planId: "pro" });
  const cancelled = s.cancelSubscription(sub.id);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.cancel_at_period_end, true);
  assert.ok(cancelled.cancelled_at);
});

test("subs: cancelSubscription throws on unknown id", () => {
  const s = new SubscriptionStore();
  assert.throws(() => s.cancelSubscription("nope"), NotFoundError);
});

test("subs: applyEvent customer.subscription.deleted cancels local", () => {
  const s = new SubscriptionStore();
  const sub = s.createSubscription({ userId: "u1", planId: "pro" });
  const event = { type: "customer.subscription.deleted", data: { object: { id: sub.id } } };
  const updated = s.applyEvent(event);
  assert.equal(updated.status, "cancelled");
});

test("subs: applyEvent unknown type returns null", () => {
  const s = new SubscriptionStore();
  assert.equal(s.applyEvent({ type: "nope", data: {} }), null);
});

// =====================================================================
// invoices.js
// =====================================================================

test("invoices: createInvoice for free plan is 0 EUR", () => {
  const inv = createInvoice({ userId: "u1", planId: "free", periodStart: "x", periodEnd: "y" });
  assert.equal(inv.amount_due, 0);
  assert.equal(inv.currency, "EUR");
  assert.equal(inv.status, "open");
});

test("invoices: createInvoice for pro plan is 1900 cents", () => {
  const inv = createInvoice({ userId: "u1", planId: "pro", periodStart: "x", periodEnd: "y" });
  assert.equal(inv.amount_due, 1900);
});

test("invoices: payInvoice marks as paid", () => {
  const inv = createInvoice({ userId: "u1", planId: "pro", periodStart: "x", periodEnd: "y" });
  const paid = payInvoice(inv);
  assert.equal(paid.status, "paid");
  assert.equal(paid.amount_paid, 1900);
  assert.ok(paid.paid_at);
});

test("invoices: payInvoice on already-paid is no-op", () => {
  const inv = payInvoice(createInvoice({ userId: "u1", planId: "pro", periodStart: "x", periodEnd: "y" }));
  const again = payInvoice(inv);
  assert.equal(again.status, "paid");
  assert.equal(again.amount_paid, 1900);
});

test("invoices: payInvoice on free is immediate", () => {
  const inv = payInvoice(createInvoice({ userId: "u1", planId: "free", periodStart: "x", periodEnd: "y" }));
  assert.equal(inv.status, "paid");
  assert.equal(inv.amount_paid, 0);
});

// =====================================================================
// server.js (HTTP integration)
// =====================================================================

function client(server) {
  const addr = server.address();
  return {
    get: (path, headers = {}) => fetch(`http://127.0.0.1:${addr.port}${path}`, { headers }),
    post: (path, body, headers = {}) => fetch(`http://127.0.0.1:${addr.port}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
    postRaw: (path, raw, headers = {}) => fetch(`http://127.0.0.1:${addr.port}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: raw,
    }),
  };
}

const SECRET = "test-billing-secret";
function makeToken(userId) {
  return signToken({ sub: userId, email: `${userId}@test.com`, name: userId }, SECRET, 3600);
}

test("server: GET /health returns 200", async () => {
  const { server } = buildServer({ port: 0, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/health");
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.status, "ok");
  assert.equal(body.agent, "billing");
  await new Promise((r) => server.close(r));
});

test("server: GET /plans returns 4 plans (no auth)", async () => {
  const { server } = buildServer({ port: 0, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/plans");
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.plans.length, 4);
  assert.ok(body.plans.find((p) => p.id === "pro"));
  await new Promise((r) => server.close(r));
});

test("server: GET /plans/pro returns pro plan details", async () => {
  const { server } = buildServer({ port: 0, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/plans/pro");
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.id, "pro");
  assert.equal(body.price_cents, 1900);
  await new Promise((r) => server.close(r));
});

test("server: GET /plans/nope returns 404", async () => {
  const { server } = buildServer({ port: 0, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/plans/nope");
  assert.equal(r.status, 404);
  await new Promise((r) => server.close(r));
});

test("server: GET /me/subscription without user returns 401", async () => {
  const { server } = buildServer({ port: 0, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/me/subscription");
  assert.equal(r.status, 401);
  await new Promise((r) => server.close(r));
});

test("server: GET /me/subscription for new user returns null + free plan", async () => {
  const { server } = buildServer({ port: 0, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/me/subscription", { "Authorization": `Bearer ${makeToken("u-new")}` });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.subscription, null);
  assert.equal(body.plan.id, "free");
  await new Promise((r) => server.close(r));
});

test("server: POST /subscribe to pro creates subscription and invoice", async () => {
  const { server } = buildServer({ port: 0, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.post("/subscribe", { plan_id: "pro" }, { "Authorization": `Bearer ${makeToken("u1")}` });
  assert.equal(r.status, 201);
  const body = await r.json();
  assert.equal(body.subscription.plan_id, "pro");
  assert.equal(body.invoice.amount_due, 1900);
  assert.equal(body.invoice.status, "paid");
  await new Promise((r) => server.close(r));
});

test("server: POST /subscribe with invalid plan returns 400", async () => {
  const { server } = buildServer({ port: 0, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.post("/subscribe", { plan_id: "nope" }, { "Authorization": `Bearer ${makeToken("u1")}` });
  assert.equal(r.status, 400);
  await new Promise((r) => server.close(r));
});

test("server: GET /me/subscription shows pro after subscribing", async () => {
  const { server } = buildServer({ port: 0, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  await c.post("/subscribe", { plan_id: "pro" }, { "Authorization": `Bearer ${makeToken("u1")}` });
  const r = await c.get("/me/subscription", { "Authorization": `Bearer ${makeToken("u1")}` });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.subscription.plan_id, "pro");
  assert.equal(body.plan.id, "pro");
  await new Promise((r) => server.close(r));
});

test("server: POST /cancel cancels active subscription", async () => {
  const { server } = buildServer({ port: 0, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  await c.post("/subscribe", { plan_id: "pro" }, { "Authorization": `Bearer ${makeToken("u1")}` });
  const r = await c.post("/cancel", {}, { "Authorization": `Bearer ${makeToken("u1")}` });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.subscription.status, "cancelled");
  assert.equal(body.subscription.cancel_at_period_end, true);
  await new Promise((r) => server.close(r));
});

test("server: POST /cancel with no active returns 404", async () => {
  const { server } = buildServer({ port: 0, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.post("/cancel", {}, { "Authorization": `Bearer ${makeToken("u1")}` });
  assert.equal(r.status, 404);
  await new Promise((r) => server.close(r));
});

test("server: POST /subscribe upgrades from pro to business", async () => {
  const { server } = buildServer({ port: 0, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const a = await c.post("/subscribe", { plan_id: "pro" }, { "Authorization": `Bearer ${makeToken("u1")}` });
  assert.equal(a.status, 201);
  const b = await c.post("/subscribe", { plan_id: "business" }, { "Authorization": `Bearer ${makeToken("u1")}` });
  assert.equal(b.status, 201);
  // Verify only business is active
  const cur = await c.get("/me/subscription", { "Authorization": `Bearer ${makeToken("u1")}` });
  const body = await cur.json();
  assert.equal(body.subscription.plan_id, "business");
  await new Promise((r) => server.close(r));
});

test("server: GET /usage returns all counters with limits", async () => {
  const { server } = buildServer({ port: 0, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/usage", { "Authorization": `Bearer ${makeToken("u1")}` });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.usage.posts_published, 0);
  assert.equal(body.remaining.posts_published.limit, 5);  // free plan default
  assert.equal(body.remaining.posts_published.remaining, 5);
  assert.match(body.year_month, /^\d{4}-\d{2}$/);
  await new Promise((r) => server.close(r));
});

test("server: POST /usage/record increments counter", async () => {
  const { server } = buildServer({ port: 0, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.post("/usage/record", { counter: "posts_published", amount: 3 }, { "Authorization": `Bearer ${makeToken("u1")}` });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.value, 3);
  await new Promise((r) => server.close(r));
});

test("server: POST /usage/record rejects unknown counter", async () => {
  const { server } = buildServer({ port: 0, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.post("/usage/record", { counter: "nope" }, { "Authorization": `Bearer ${makeToken("u1")}` });
  assert.equal(r.status, 400);
  await new Promise((r) => server.close(r));
});

test("server: free plan blocks 6th post with 402", async () => {
  const { server } = buildServer({ port: 0, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  for (let i = 0; i < 5; i++) {
    const r = await c.post("/usage/record", { counter: "posts_published" }, { "Authorization": `Bearer ${makeToken("u1")}` });
    assert.equal(r.status, 200);
  }
  const r = await c.post("/usage/record", { counter: "posts_published" }, { "Authorization": `Bearer ${makeToken("u1")}` });
  assert.equal(r.status, 402);
  const body = await r.json();
  assert.equal(body.error, "limit_exceeded");
  assert.equal(body.plan_id, "free");
  await new Promise((r) => server.close(r));
});

test("server: enterprise plan allows unlimited", async () => {
  const { server } = buildServer({ port: 0, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  await c.post("/subscribe", { plan_id: "enterprise" }, { "Authorization": `Bearer ${makeToken("u1")}` });
  for (let i = 0; i < 50; i++) {
    const r = await c.post("/usage/record", { counter: "posts_published" }, { "Authorization": `Bearer ${makeToken("u1")}` });
    assert.equal(r.status, 200, `post #${i+1} should succeed`);
  }
  const r = await c.get("/usage", { "Authorization": `Bearer ${makeToken("u1")}` });
  const body = await r.json();
  assert.equal(body.usage.posts_published, 50);
  assert.equal(body.remaining.posts_published.limit, -1);
  await new Promise((r) => server.close(r));
});

test("server: POST /webhook/stripe receives event and updates local", async () => {
  const { server } = buildServer({ port: 0, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  // Create a subscription
  const sub = await c.post("/subscribe", { plan_id: "pro" }, { "Authorization": `Bearer ${makeToken("u1")}` });
  const { subscription } = await sub.json();
  // Send a webhook
  const wh = await c.post("/webhook/stripe", {
    type: "customer.subscription.deleted",
    data: { object: { id: subscription.id } },
  });
  assert.equal(wh.status, 200);
  const whBody = await wh.json();
  assert.equal(whBody.applied_to, subscription.id);
  // Verify it's cancelled
  const cur = await c.get("/me/subscription", { "Authorization": `Bearer ${makeToken("u1")}` });
  const curBody = await cur.json();
  assert.equal(curBody.subscription, null);
  await new Promise((r) => server.close(r));
});

test("server: POST /webhook/stripe with bad event returns 400", async () => {
  const { server } = buildServer({ port: 0, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.postRaw("/webhook/stripe", "not json");
  assert.equal(r.status, 400);
  await new Promise((r) => server.close(r));
});

test("server: full lifecycle — signup-free, post 5, get blocked, upgrade, post more", async () => {
  const { server } = buildServer({ port: 0, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);

  // Free plan by default
  let r = await c.get("/usage", { "Authorization": `Bearer ${makeToken("u1")}` });
  assert.equal((await r.json()).plan_id, "free");

  // Post 5 times
  for (let i = 0; i < 5; i++) {
    const rr = await c.post("/usage/record", { counter: "posts_published" }, { "Authorization": `Bearer ${makeToken("u1")}` });
    assert.equal(rr.status, 200);
  }
  // 6th blocked
  r = await c.post("/usage/record", { counter: "posts_published" }, { "Authorization": `Bearer ${makeToken("u1")}` });
  assert.equal(r.status, 402);

  // Upgrade to business (1000 posts/month)
  r = await c.post("/subscribe", { plan_id: "business" }, { "Authorization": `Bearer ${makeToken("u1")}` });
  assert.equal(r.status, 201);

  // Now 7th post works
  r = await c.post("/usage/record", { counter: "posts_published" }, { "Authorization": `Bearer ${makeToken("u1")}` });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).plan_id, "business");

  await new Promise((r) => server.close(r));
});

test("server: GET /unknown returns 404", async () => {
  const { server } = buildServer({ port: 0, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/nope");
  assert.equal(r.status, 404);
  await new Promise((r) => server.close(r));
});

test("server: OPTIONS preflight returns 204", async () => {
  const { server } = buildServer({ port: 0, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const r = await fetch(`http://127.0.0.1:${server.address().port}/plans`, { method: "OPTIONS" });
  assert.equal(r.status, 204);
  await new Promise((r) => server.close(r));
});

test("server: JWT auth populates req.user", async () => {
  const { server } = buildServer({ port: 0, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const token = makeToken("u1");
  const r = await fetch(`http://127.0.0.1:${server.address().port}/me/subscription`, {
    headers: { "Authorization": `Bearer ${token}` },
  });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.subscription, null);  // no sub for this user
  await new Promise((r) => server.close(r));
});
