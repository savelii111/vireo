// Tests for the billing server's Stripe integration mode.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildServer } from "../src/server.js";
import { StripeClient } from "../src/stripe_client.js";
import { signToken } from "../../../packages/auth-middleware/index.js";

const SECRET = "test-billing-stripe-secret";
function makeToken(userId) {
  return signToken({ sub: userId, email: `${userId}@test.com`, name: userId }, SECRET, 3600);
}

const okJson = (json, status = 200) => ({
  status, ok: status < 400, body: JSON.stringify(json), json,
});

// Minimal HTTP client (same shape as in test_billing.js).
function client(server) {
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  async function req(method, path, body, headers = {}) {
    const init = { method, headers: { ...headers } };
    if (body !== undefined) {
      if (typeof body === "string") {
        init.body = body;
        if (!init.headers["Content-Type"]) init.headers["Content-Type"] = "application/json";
      } else {
        init.body = JSON.stringify(body);
        init.headers["Content-Type"] = "application/json";
      }
    }
    return fetch(base + path, init);
  }
  return {
    get: (p, h) => req("GET", p, undefined, h),
    post: (p, b, h) => req("POST", p, b, h),
    delete: (p, h) => req("DELETE", p, undefined, h),
  };
}

function makeMockStripe(responses) {
  const calls = [];
  const transport = async (method, path, body, headers) => {
    calls.push({ method, path, body });
    const r = responses.shift();
    if (!r) return okJson({ id: "fallback" });
    if (typeof r === "function") return r(method, path, body, headers);
    return r;
  };
  const client = new StripeClient({ apiKey: "sk_test_mock", transport, webhookSecret: "whsec_test" });
  return { client, calls };
}

// ============================================================
// Health & mode
// ============================================================

test("server (stripe mode): /health reports stripe_mode: true", async () => {
  const { client: sc } = makeMockStripe([]);
  const { server } = buildServer({ port: 0, stripeClient: sc, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/health");
  const body = await r.json();
  assert.equal(body.stripe_mode, true);
  await new Promise((r) => server.close(r));
});

test("server (mock mode): /health reports stripe_mode: false", async () => {
  const { server } = buildServer({ port: 0, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/health");
  const body = await r.json();
  assert.equal(body.stripe_mode, false);
  await new Promise((r) => server.close(r));
});

// ============================================================
// /subscribe in stripe mode
// ============================================================

test("server (stripe mode): /subscribe to pro returns checkout_url", async () => {
  const { client: sc, calls } = makeMockStripe([
    okJson({ id: "cus_1" }),                            // createCustomer
    okJson({ id: "cs_1", url: "https://stripe.example/cs_1" }), // createCheckoutSession
  ]);
  const { server, customers } = buildServer({ port: 0, stripeClient: sc, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.post("/subscribe", { plan_id: "pro" }, { "Authorization": `Bearer ${makeToken("u1")}` });
  assert.equal(r.status, 201);
  const body = await r.json();
  assert.equal(body.mode, "stripe_checkout");
  assert.equal(body.checkout_url, "https://stripe.example/cs_1");
  assert.equal(body.session_id, "cs_1");
  // Should have called createCustomer then createCheckoutSession
  assert.equal(calls.length, 2);
  assert.equal(calls[0].path, "/v1/customers");
  assert.equal(calls[1].path, "/v1/checkout/sessions");
  // Customer should be cached
  assert.equal(customers.get("u1"), "cus_1");
  await new Promise((r) => server.close(r));
});

test("server (stripe mode): /subscribe reuses customer on second call", async () => {
  const { client: sc, calls } = makeMockStripe([
    okJson({ id: "cus_1" }),
    okJson({ id: "cs_1", url: "https://stripe.example/cs_1" }),
    // No createCustomer response needed for the second subscribe
    okJson({ id: "cs_2", url: "https://stripe.example/cs_2" }),
  ]);
  const { server } = buildServer({ port: 0, stripeClient: sc, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  await c.post("/subscribe", { plan_id: "pro" }, { "Authorization": `Bearer ${makeToken("u1")}` });
  await c.post("/subscribe", { plan_id: "business" }, { "Authorization": `Bearer ${makeToken("u1")}` });
  // Only 1 createCustomer call (the 2nd subscribe reuses the cached id)
  const customerCalls = calls.filter((call) => call.path === "/v1/customers");
  assert.equal(customerCalls.length, 1);
  // Two checkout sessions
  const checkoutCalls = calls.filter((call) => call.path === "/v1/checkout/sessions");
  assert.equal(checkoutCalls.length, 2);
  await new Promise((r) => server.close(r));
});

test("server (stripe mode): /subscribe to free plan uses mock flow (no Stripe)", async () => {
  const { client: sc, calls } = makeMockStripe([]);
  const { server } = buildServer({ port: 0, stripeClient: sc, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.post("/subscribe", { plan_id: "free" }, { "Authorization": `Bearer ${makeToken("u1")}` });
  assert.equal(r.status, 201);
  const body = await r.json();
  assert.equal(body.mode, "mock");
  assert.equal(calls.length, 0, "no Stripe calls for free plan");
  await new Promise((r) => server.close(r));
});

test("server (stripe mode): /subscribe with invalid plan returns 400", async () => {
  const { client: sc } = makeMockStripe([]);
  const { server } = buildServer({ port: 0, stripeClient: sc, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.post("/subscribe", { plan_id: "nope" }, { "Authorization": `Bearer ${makeToken("u1")}` });
  assert.equal(r.status, 400);
  await new Promise((r) => server.close(r));
});

test("server (stripe mode): /subscribe propagates Stripe errors as 502", async () => {
  const { client: sc } = makeMockStripe([
    { status: 402, ok: false, body: JSON.stringify({ error: { message: "Card declined", code: "card_declined" } }), json: { error: { message: "Card declined", code: "card_declined" } } },
  ]);
  const { server } = buildServer({ port: 0, stripeClient: sc, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.post("/subscribe", { plan_id: "pro" }, { "Authorization": `Bearer ${makeToken("u1")}` });
  assert.equal(r.status, 402);
  const body = await r.json();
  assert.equal(body.error, "stripe_error");
  assert.equal(body.code, "card_declined");
  await new Promise((r) => server.close(r));
});

// ============================================================
// /cancel in stripe mode
// ============================================================

test("server (stripe mode): /cancel calls Stripe to set cancel_at_period_end", async () => {
  const { client: sc, calls } = makeMockStripe([
    okJson({ id: "cus_1" }),
    okJson({ id: "cs_1", url: "https://stripe.example/cs_1" }),
    okJson({ id: "sub_1", cancel_at_period_end: true }),
  ]);
  const { server } = buildServer({ port: 0, stripeClient: sc, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  // 1. Subscribe (creates checkout session, no local sub yet)
  await c.post("/subscribe", { plan_id: "pro" }, { "Authorization": `Bearer ${makeToken("u1")}` });
  // 2. Send webhook so the local sub is created with stripe_subscription_id
  const payload = JSON.stringify({
    id: "evt_cs", type: "checkout.session.completed",
    data: { object: { id: "cs_1", customer: "cus_1", subscription: "sub_stripe_xyz", metadata: { user_id: "u1", plan_id: "pro" } } },
  });
  const { header: h1 } = StripeClient.signWebhookPayload({ payload, secret: "whsec_test" });
  await c.post("/webhook/stripe", payload, { "Stripe-Signature": h1, "Content-Type": "application/json" });
  // 3. Now cancel — should call Stripe
  const r = await c.post("/cancel", {}, { "Authorization": `Bearer ${makeToken("u1")}` });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.subscription.status, "cancelled");
  // Stripe cancel was called
  const cancelCalls = calls.filter((call) => call.method === "POST" && call.path.startsWith("/v1/subscriptions/"));
  assert.ok(cancelCalls.length >= 1);
  await new Promise((r) => server.close(r));
});

// ============================================================
// /portal
// ============================================================

test("server (stripe mode): POST /portal returns a URL", async () => {
  const { client: sc, calls } = makeMockStripe([
    okJson({ id: "cus_1" }),
    okJson({ id: "bps_1", url: "https://billing.stripe.com/portal" }),
  ]);
  const { server } = buildServer({ port: 0, stripeClient: sc, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.post("/portal", {}, { "Authorization": `Bearer ${makeToken("u1")}` });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.url, "https://billing.stripe.com/portal");
  assert.equal(calls[1].path, "/v1/billing_portal/sessions");
  await new Promise((r) => server.close(r));
});

test("server (mock mode): POST /portal returns 400", async () => {
  const { server } = buildServer({ port: 0, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.post("/portal", {}, { "Authorization": `Bearer ${makeToken("u1")}` });
  assert.equal(r.status, 400);
  await new Promise((r) => server.close(r));
});

// ============================================================
// /me/customer
// ============================================================

test("server (stripe mode): GET /me/customer returns customer_id", async () => {
  const { client: sc } = makeMockStripe([okJson({ id: "cus_42" })]);
  const { server } = buildServer({ port: 0, stripeClient: sc, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/me/customer", { "Authorization": `Bearer ${makeToken("u1")}` });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.customer_id, "cus_42");
  await new Promise((r) => server.close(r));
});

// ============================================================
// /webhook/stripe with signature verification
// ============================================================

test("server (stripe mode): /webhook/stripe accepts valid signed event", async () => {
  const { client: sc } = makeMockStripe([]);
  const { server } = buildServer({ port: 0, stripeClient: sc, webhookSecret: "whsec_test", secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const payload = JSON.stringify({
    id: "evt_1",
    type: "customer.subscription.deleted",
    data: { object: { id: "sub_stripe_x", customer: "cus_x" } },
  });
  const { header } = StripeClient.signWebhookPayload({ payload, secret: "whsec_test" });
  const r = await c.post("/webhook/stripe", payload, { "Stripe-Signature": header, "Content-Type": "application/json" });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.received, true);
  assert.equal(body.type, "customer.subscription.deleted");
  assert.equal(body.note, "no_local_match");
  await new Promise((r) => server.close(r));
});

test("server (stripe mode): /webhook/stripe rejects missing signature", async () => {
  const { client: sc } = makeMockStripe([]);
  const { server } = buildServer({ port: 0, stripeClient: sc, webhookSecret: "whsec_test", secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const payload = JSON.stringify({ id: "evt_1", type: "x" });
  const r = await c.post("/webhook/stripe", payload, { "Content-Type": "application/json" });
  assert.equal(r.status, 400);
  const body = await r.json();
  assert.equal(body.code, "missing_signature");
  await new Promise((r) => server.close(r));
});

test("server (stripe mode): /webhook/stripe rejects bad signature", async () => {
  const { client: sc } = makeMockStripe([]);
  const { server } = buildServer({ port: 0, stripeClient: sc, webhookSecret: "whsec_test", secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const payload = JSON.stringify({ id: "evt_1", type: "x" });
  // Use a recent timestamp (so we hit signature check, not timestamp check) with a bad v1.
  const now = Math.floor(Date.now() / 1000);
  const r = await c.post("/webhook/stripe", payload, {
    "Stripe-Signature": `t=${now},v1=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef`,
    "Content-Type": "application/json",
  });
  assert.equal(r.status, 400);
  const body = await r.json();
  assert.equal(body.code, "signature_mismatch");
  await new Promise((r) => server.close(r));
});

test("server (stripe mode): /webhook/stripe rejects expired timestamp", async () => {
  const { client: sc } = makeMockStripe([]);
  const { server } = buildServer({ port: 0, stripeClient: sc, webhookSecret: "whsec_test", secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const payload = JSON.stringify({ id: "evt_1", type: "x" });
  const oldTs = Math.floor(Date.now() / 1000) - 3600;
  const { header } = StripeClient.signWebhookPayload({ payload, secret: "whsec_test", timestamp: oldTs });
  const r = await c.post("/webhook/stripe", payload, { "Stripe-Signature": header, "Content-Type": "application/json" });
  assert.equal(r.status, 400);
  const body = await r.json();
  assert.equal(body.code, "timestamp_expired");
  await new Promise((r) => server.close(r));
});

test("server (stripe mode): checkout.session.completed creates local subscription", async () => {
  const { client: sc } = makeMockStripe([]);
  const { server } = buildServer({ port: 0, stripeClient: sc, webhookSecret: "whsec_test", secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const payload = JSON.stringify({
    id: "evt_cs",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_1",
        customer: "cus_1",
        subscription: "sub_stripe_xyz",
        customer_email: "u1@vireo.ai",
        metadata: { user_id: "u1", plan_id: "pro" },
      },
    },
  });
  const { header } = StripeClient.signWebhookPayload({ payload, secret: "whsec_test" });
  const r = await c.post("/webhook/stripe", payload, { "Stripe-Signature": header, "Content-Type": "application/json" });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.note, "subscription_created");
  // Verify the local sub exists for u1
  const me = await c.get("/me/subscription", { "Authorization": `Bearer ${makeToken("u1")}` });
  const meBody = await me.json();
  assert.equal(meBody.subscription.plan_id, "pro");
  assert.equal(meBody.subscription.stripe_subscription_id, "sub_stripe_xyz");
  await new Promise((r) => server.close(r));
});

test("server (stripe mode): customer.subscription.deleted cancels local sub", async () => {
  const { client: sc } = makeMockStripe([]);
  const { server } = buildServer({ port: 0, stripeClient: sc, webhookSecret: "whsec_test", secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  // 1. Create a local sub via checkout.session.completed
  const completedPayload = JSON.stringify({
    id: "evt_cs", type: "checkout.session.completed",
    data: { object: { id: "cs_1", customer: "cus_1", subscription: "sub_stripe_xyz", metadata: { user_id: "u1", plan_id: "pro" } } },
  });
  const { header: h1 } = StripeClient.signWebhookPayload({ payload: completedPayload, secret: "whsec_test" });
  await c.post("/webhook/stripe", completedPayload, { "Stripe-Signature": h1, "Content-Type": "application/json" });
  // 2. Send customer.subscription.deleted
  const deletedPayload = JSON.stringify({
    id: "evt_del", type: "customer.subscription.deleted",
    data: { object: { id: "sub_stripe_xyz", customer: "cus_1", status: "canceled" } },
  });
  const { header: h2 } = StripeClient.signWebhookPayload({ payload: deletedPayload, secret: "whsec_test" });
  const r = await c.post("/webhook/stripe", deletedPayload, { "Stripe-Signature": h2, "Content-Type": "application/json" });
  assert.equal(r.status, 200);
  // 3. Verify local is gone
  const me = await c.get("/me/subscription", { "Authorization": `Bearer ${makeToken("u1")}` });
  const meBody = await me.json();
  assert.equal(meBody.subscription, null);
  await new Promise((r) => server.close(r));
});

test("server (stripe mode): webhookSecret set without stripeClient returns 500", async () => {
  const { server } = buildServer({ port: 0, webhookSecret: "whsec_test", secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.post("/webhook/stripe", "{}", { "Stripe-Signature": "t=1,v1=x", "Content-Type": "application/json" });
  assert.equal(r.status, 500);
  await new Promise((r) => server.close(r));
});

test("server (mock mode): /webhook/stripe still accepts raw JSON (backward compat)", async () => {
  const { server } = buildServer({ port: 0, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  // Subscribe first
  const sub = await c.post("/subscribe", { plan_id: "pro" }, { "Authorization": `Bearer ${makeToken("u1")}` });
  const { subscription } = await sub.json();
  // Send webhook with local id
  const r = await c.post("/webhook/stripe", {
    type: "customer.subscription.deleted",
    data: { object: { id: subscription.id } },
  });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.applied_to, subscription.id);
  await new Promise((r) => server.close(r));
});

// ============================================================
// End-to-end: checkout → webhook → access
// ============================================================

test("server (stripe mode): end-to-end — checkout → webhook → user can use paid features", async () => {
  // 1. User subscribes (returns checkout URL)
  const { client: sc } = makeMockStripe([
    okJson({ id: "cus_e2e" }),
    okJson({ id: "cs_e2e", url: "https://stripe.example/cs_e2e" }),
  ]);
  const { server } = buildServer({ port: 0, stripeClient: sc, webhookSecret: "whsec_e2e", secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const sub = await c.post("/subscribe", { plan_id: "pro" }, { "Authorization": `Bearer ${makeToken("u_e2e")}` });
  const subBody = await sub.json();
  assert.equal(subBody.mode, "stripe_checkout");

  // 2. At this point the user is NOT yet on a paid plan (mock_mode flag stays but no local sub)
  let me = await c.get("/me/subscription", { "Authorization": `Bearer ${makeToken("u_e2e")}` });
  let meBody = await me.json();
  assert.equal(meBody.subscription, null);

  // 3. Stripe sends the checkout.session.completed webhook
  const payload = JSON.stringify({
    id: "evt_e2e", type: "checkout.session.completed",
    data: { object: { id: "cs_e2e", customer: "cus_e2e", subscription: "sub_stripe_e2e", metadata: { user_id: "u_e2e", plan_id: "pro" } } },
  });
  const { header } = StripeClient.signWebhookPayload({ payload, secret: "whsec_e2e" });
  const wh = await c.post("/webhook/stripe", payload, { "Stripe-Signature": header, "Content-Type": "application/json" });
  assert.equal(wh.status, 200);

  // 4. Now the user IS on pro
  me = await c.get("/me/subscription", { "Authorization": `Bearer ${makeToken("u_e2e")}` });
  meBody = await me.json();
  assert.equal(meBody.subscription.plan_id, "pro");
  assert.equal(meBody.subscription.stripe_subscription_id, "sub_stripe_e2e");

  // 5. Usage limits reflect pro plan (pro allows 100 posts)
  for (let i = 0; i < 5; i++) {
    await c.post("/usage/record", { counter: "posts_published" }, { "Authorization": `Bearer ${makeToken("u_e2e")}` });
  }
  const u = await c.get("/usage", { "Authorization": `Bearer ${makeToken("u_e2e")}` });
  const uBody = await u.json();
  assert.equal(uBody.usage.posts_published, 5);
  assert.equal(uBody.remaining.posts_published.limit, 100);
  await new Promise((r) => server.close(r));
});
