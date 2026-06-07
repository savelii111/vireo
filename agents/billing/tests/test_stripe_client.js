// Tests for Vireo StripeClient — no real network, all transport-injected.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { StripeClient, StripeError } from "../src/stripe_client.js";

// ---------- transport helpers ----------

function makeTransport(responses) {
  const calls = [];
  const transport = async (method, path, body, headers) => {
    calls.push({ method, path, body, headers });
    const r = responses.shift();
    if (!r) return { status: 500, ok: false, body: "no more mocks", json: null };
    if (typeof r === "function") return r(method, path, body, headers);
    return r;
  };
  return { transport, calls };
}

const okJson = (json) => ({ status: 200, ok: true, body: JSON.stringify(json), json });
const errJson = (status, message, code = "test_error") => ({
  status, ok: false, body: JSON.stringify({ error: { message, code } }), json: { error: { message, code } },
});
const createdJson = (json) => ({ status: 201, ok: true, body: JSON.stringify(json), json: { ...json, _created: true } });

// ============================================================
// StripeClient construction
// ============================================================

test("StripeClient: can be constructed without apiKey (uses default transport)", () => {
  const c = new StripeClient();
  assert.equal(c.apiKey, null);
  assert.equal(c.baseUrl, "https://api.stripe.com");
  assert.equal(typeof c.transport, "function");
  assert.equal(c.webhookSecret, null);
});

test("StripeClient: custom baseUrl strips trailing slashes", () => {
  const c = new StripeClient({ baseUrl: "https://stripe.example.com///" });
  assert.equal(c.baseUrl, "https://stripe.example.com");
});

test("StripeClient: explicit transport is used", () => {
  let invoked = 0;
  const c = new StripeClient({ transport: async () => { invoked++; return okJson({ id: "x" }); } });
  c._get("/v1/x");
  // _get is async; let microtask flush
  return new Promise((r) => setImmediate(() => {
    assert.equal(invoked, 1);
    r();
  }));
});

// ============================================================
// createCustomer
// ============================================================

test("StripeClient: createCustomer posts form-encoded to /v1/customers", async () => {
  const { transport, calls } = makeTransport([okJson({ id: "cus_123", email: "a@b.com" })]);
  const c = new StripeClient({ apiKey: "sk_test_xxx", transport });
  const cust = await c.createCustomer({ email: "a@b.com", name: "Alice" });
  assert.equal(cust.id, "cus_123");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].path, "/v1/customers");
  const body = new URLSearchParams(calls[0].body);
  assert.equal(body.get("email"), "a@b.com");
  assert.equal(body.get("name"), "Alice");
});

test("StripeClient: createCustomer adds metadata keys", async () => {
  const { transport, calls } = makeTransport([okJson({ id: "cus_1" })]);
  const c = new StripeClient({ transport });
  await c.createCustomer({ email: "x@y.com", metadata: { user_id: "u1", plan: "pro" } });
  const body = new URLSearchParams(calls[0].body);
  assert.equal(body.get("metadata[user_id]"), "u1");
  assert.equal(body.get("metadata[plan]"), "pro");
});

test("StripeClient: createCustomer on 4xx throws StripeError", async () => {
  const { transport } = makeTransport([errJson(400, "Invalid email", "invalid_email")]);
  const c = new StripeClient({ transport });
  await assert.rejects(
    () => c.createCustomer({ email: "bad" }),
    (e) => e instanceof StripeError && e.status === 400 && e.code === "invalid_email"
  );
});

// ============================================================
// createCheckoutSession
// ============================================================

test("StripeClient: createCheckoutSession builds line_items from plan", async () => {
  const { transport, calls } = makeTransport([okJson({ id: "cs_123", url: "https://checkout.stripe.com/c/pay/cs_123" })]);
  const c = new StripeClient({ transport });
  const plan = { id: "pro", amount_cents: 1900, currency: "eur", name: "Pro Plan", interval: "month" };
  const session = await c.createCheckoutSession({
    plan,
    customerEmail: "user@example.com",
    successUrl: "https://vireo.ai/success",
    cancelUrl: "https://vireo.ai/cancel",
    metadata: { user_id: "u1" },
  });
  assert.equal(session.id, "cs_123");
  assert.match(session.url, /checkout\.stripe\.com/);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].path, "/v1/checkout/sessions");
  const body = new URLSearchParams(calls[0].body);
  assert.equal(body.get("mode"), "subscription");
  assert.equal(body.get("customer_email"), "user@example.com");
  assert.equal(body.get("line_items[0][price_data][unit_amount]"), "1900");
  assert.equal(body.get("line_items[0][price_data][currency]"), "eur");
  assert.equal(body.get("line_items[0][price_data][recurring][interval]"), "month");
  assert.equal(body.get("metadata[user_id]"), "u1");
  assert.equal(body.get("subscription_data[metadata][user_id]"), "u1");
  assert.equal(body.get("success_url"), "https://vireo.ai/success");
  assert.equal(body.get("cancel_url"), "https://vireo.ai/cancel");
});

test("StripeClient: createCheckoutSession prefers customerId over customerEmail", async () => {
  const { transport, calls } = makeTransport([okJson({ id: "cs_1", url: "x" })]);
  const c = new StripeClient({ transport });
  const plan = { id: "pro", amount_cents: 1900, currency: "eur" };
  await c.createCheckoutSession({
    plan,
    customerId: "cus_42",
    customerEmail: "ignored@x.com",
    successUrl: "s", cancelUrl: "c",
  });
  const body = new URLSearchParams(calls[0].body);
  assert.equal(body.get("customer"), "cus_42");
  assert.equal(body.get("customer_email"), null);
});

test("StripeClient: createCheckoutSession validates required fields", async () => {
  const c = new StripeClient({ transport: async () => okJson({}) });
  await assert.rejects(() => c.createCheckoutSession({ plan: null }), (e) => e instanceof StripeError);
  await assert.rejects(() => c.createCheckoutSession({
    plan: { id: "x", amount_cents: 100 }, successUrl: null, cancelUrl: "c"
  }), (e) => e instanceof StripeError);
});

test("StripeClient: createCheckoutSession on 4xx throws", async () => {
  const { transport } = makeTransport([errJson(402, "Card declined", "card_declined")]);
  const c = new StripeClient({ transport });
  await assert.rejects(() => c.createCheckoutSession({
    plan: { id: "p", amount_cents: 100, currency: "eur" },
    successUrl: "s", cancelUrl: "c",
  }), (e) => e instanceof StripeError && e.status === 402);
});

// ============================================================
// retrieveSubscription
// ============================================================

test("StripeClient: retrieveSubscription GETs by id", async () => {
  const { transport, calls } = makeTransport([okJson({ id: "sub_1", status: "active" })]);
  const c = new StripeClient({ transport });
  const sub = await c.retrieveSubscription("sub_1");
  assert.equal(sub.id, "sub_1");
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].path, "/v1/subscriptions/sub_1");
});

test("StripeClient: retrieveSubscription encodes special chars in id", async () => {
  const { transport, calls } = makeTransport([okJson({ id: "sub/a" })]);
  const c = new StripeClient({ transport });
  await c.retrieveSubscription("sub/a");
  assert.equal(calls[0].path, "/v1/subscriptions/sub%2Fa");
});

// ============================================================
// cancelSubscription
// ============================================================

test("StripeClient: setSubscriptionCancelAtPeriodEnd posts flag", async () => {
  const { transport, calls } = makeTransport([okJson({ id: "sub_1", cancel_at_period_end: true })]);
  const c = new StripeClient({ transport });
  const sub = await c.setSubscriptionCancelAtPeriodEnd("sub_1", true);
  assert.equal(sub.cancel_at_period_end, true);
  const body = new URLSearchParams(calls[0].body);
  assert.equal(body.get("cancel_at_period_end"), "true");
});

test("StripeClient: cancelSubscriptionImmediately DELETEs", async () => {
  const { transport, calls } = makeTransport([okJson({ id: "sub_1", status: "canceled" })]);
  const c = new StripeClient({ transport });
  await c.cancelSubscriptionImmediately("sub_1");
  assert.equal(calls[0].method, "DELETE");
  assert.equal(calls[0].path, "/v1/subscriptions/sub_1");
});

// ============================================================
// Customer Portal
// ============================================================

test("StripeClient: createPortalSession posts customer + return_url", async () => {
  const { transport, calls } = makeTransport([okJson({ id: "bps_1", url: "https://billing.stripe.com/portal" })]);
  const c = new StripeClient({ transport });
  const session = await c.createPortalSession({ customerId: "cus_1", returnUrl: "https://vireo.ai/account" });
  assert.equal(session.id, "bps_1");
  const body = new URLSearchParams(calls[0].body);
  assert.equal(body.get("customer"), "cus_1");
  assert.equal(body.get("return_url"), "https://vireo.ai/account");
  assert.equal(calls[0].path, "/v1/billing_portal/sessions");
});

test("StripeClient: createPortalSession validates required fields", async () => {
  const c = new StripeClient({ transport: async () => okJson({}) });
  await assert.rejects(() => c.createPortalSession({}), (e) => e instanceof StripeError);
});

// ============================================================
// Webhook signature verification
// ============================================================

test("StripeClient: verifyWebhookSignature accepts valid signature", () => {
  const c = new StripeClient({ webhookSecret: "whsec_test" });
  const payload = JSON.stringify({ id: "evt_1", type: "customer.subscription.deleted" });
  const { header } = StripeClient.signWebhookPayload({ payload, secret: "whsec_test" });
  const result = c.verifyWebhookSignature({ payload, signatureHeader: header });
  assert.equal(result.event.id, "evt_1");
  assert.equal(result.event.type, "customer.subscription.deleted");
  assert.ok(typeof result.timestamp === "number");
});

test("StripeClient: verifyWebhookSignature rejects missing header", () => {
  const c = new StripeClient({ webhookSecret: "whsec_test" });
  assert.throws(
    () => c.verifyWebhookSignature({ payload: "{}", signatureHeader: null }),
    (e) => e instanceof StripeError && e.code === "missing_signature"
  );
});

test("StripeClient: verifyWebhookSignature rejects malformed header", () => {
  const c = new StripeClient({ webhookSecret: "whsec_test" });
  assert.throws(
    () => c.verifyWebhookSignature({ payload: "{}", signatureHeader: "garbage_no_equals" }),
    (e) => e instanceof StripeError && e.code === "malformed_signature"
  );
});

test("StripeClient: verifyWebhookSignature rejects when no v1 sig present", () => {
  const c = new StripeClient({ webhookSecret: "whsec_test" });
  assert.throws(
    () => c.verifyWebhookSignature({ payload: "{}", signatureHeader: "t=1700000000" }),
    (e) => e instanceof StripeError && e.code === "malformed_signature"
  );
});

test("StripeClient: verifyWebhookSignature rejects wrong secret", () => {
  const c = new StripeClient({ webhookSecret: "whsec_correct" });
  const { header } = StripeClient.signWebhookPayload({ payload: "{}", secret: "whsec_wrong" });
  assert.throws(
    () => c.verifyWebhookSignature({ payload: "{}", signatureHeader: header }),
    (e) => e instanceof StripeError && e.code === "signature_mismatch"
  );
});

test("StripeClient: verifyWebhookSignature rejects expired timestamp", () => {
  const c = new StripeClient({ webhookSecret: "whsec_test" });
  const oldTs = Math.floor(Date.now() / 1000) - 3600;
  const { header } = StripeClient.signWebhookPayload({ payload: "{}", secret: "whsec_test", timestamp: oldTs });
  assert.throws(
    () => c.verifyWebhookSignature({ payload: "{}", signatureHeader: header, tolerance: 300 }),
    (e) => e instanceof StripeError && e.code === "timestamp_expired"
  );
});

test("StripeClient: verifyWebhookSignature accepts future timestamp within tolerance", () => {
  const c = new StripeClient({ webhookSecret: "whsec_test" });
  const futureTs = Math.floor(Date.now() / 1000) + 100;
  const { header } = StripeClient.signWebhookPayload({ payload: "{}", secret: "whsec_test", timestamp: futureTs });
  const result = c.verifyWebhookSignature({ payload: "{}", signatureHeader: header });
  assert.equal(result.timestamp, futureTs);
});

test("StripeClient: verifyWebhookSignature supports multiple v1 sigs (rotation)", () => {
  const c = new StripeClient({ webhookSecret: "whsec_new" });
  const payload = "{}";
  const oldSig = require_hmac_sha256_hex("whsec_old", `${1700000000}.${payload}`);
  const newSig = require_hmac_sha256_hex("whsec_new", `${1700000000}.${payload}`);
  const header = `t=1700000000,v1=${oldSig},v1=${newSig}`;
  // One of the sigs matches
  const result = c.verifyWebhookSignature({ payload, signatureHeader: header, now: 1700000000 });
  assert.equal(result.timestamp, 1700000000);
});

test("StripeClient: verifyWebhookSignature rejects when no v1 sigs match", () => {
  const c = new StripeClient({ webhookSecret: "whsec_test" });
  const ts = 1700000000;
  const sig1 = require_hmac_sha256_hex("whsec_other1", `${ts}.{}`);
  const sig2 = require_hmac_sha256_hex("whsec_other2", `${ts}.{}`);
  const header = `t=${ts},v1=${sig1},v1=${sig2}`;
  assert.throws(
    () => c.verifyWebhookSignature({ payload: "{}", signatureHeader: header, now: ts }),
    (e) => e instanceof StripeError && e.code === "signature_mismatch"
  );
});

test("StripeClient: verifyWebhookSignature rejects invalid hex in v1", () => {
  const c = new StripeClient({ webhookSecret: "whsec_test" });
  const ts = 1700000000;
  // Not valid hex; should be skipped, leaving no matches
  const header = `t=${ts},v1=NOT_HEX`;
  assert.throws(
    () => c.verifyWebhookSignature({ payload: "{}", signatureHeader: header, now: ts }),
    (e) => e instanceof StripeError && e.code === "signature_mismatch"
  );
});

test("StripeClient: verifyWebhookSignature rejects non-JSON payload gracefully", () => {
  const c = new StripeClient({ webhookSecret: "whsec_test" });
  const { header } = StripeClient.signWebhookPayload({ payload: "not json", secret: "whsec_test" });
  assert.throws(
    () => c.verifyWebhookSignature({ payload: "not json", signatureHeader: header }),
    (e) => e instanceof StripeError && e.code === "invalid_json"
  );
});

test("StripeClient: verifyWebhookSignature rejects non-string payload", () => {
  const c = new StripeClient({ webhookSecret: "whsec_test" });
  assert.throws(
    () => c.verifyWebhookSignature({ payload: { x: 1 }, signatureHeader: "t=1,v1=ab" }),
    (e) => e instanceof StripeError && e.code === "validation"
  );
});

test("StripeClient: verifyWebhookSignature throws if secret not configured", () => {
  const c = new StripeClient({});
  assert.throws(
    () => c.verifyWebhookSignature({ payload: "{}", signatureHeader: "t=1,v1=ab" }),
    (e) => e instanceof StripeError && e.code === "config_missing"
  );
});

// ============================================================
// normalizeEvent
// ============================================================

test("StripeClient.normalizeEvent: customer.subscription.deleted", () => {
  const ev = {
    id: "evt_1",
    type: "customer.subscription.deleted",
    livemode: false,
    created: 1700000000,
    data: { object: { id: "sub_1", customer: "cus_1", status: "canceled" } },
  };
  const norm = StripeClient.normalizeEvent(ev);
  assert.equal(norm.id, "evt_1");
  assert.equal(norm.type, "customer.subscription.deleted");
  assert.equal(norm.subscription_id, "sub_1");
  assert.equal(norm.status, "cancelled");
  assert.equal(norm.customer_id, "cus_1");
});

test("StripeClient.normalizeEvent: customer.subscription.updated with cancel_at_period_end", () => {
  const ev = {
    id: "evt_2", type: "customer.subscription.updated", livemode: false, created: 1700000000,
    data: { object: { id: "sub_2", customer: "cus_2", status: "active", cancel_at_period_end: true, current_period_start: 1700000000, current_period_end: 1702592000 } },
  };
  const norm = StripeClient.normalizeEvent(ev);
  assert.equal(norm.cancel_at_period_end, true);
  assert.equal(norm.subscription_id, "sub_2");
  assert.ok(norm.current_period_start);
  assert.ok(norm.current_period_end);
});

test("StripeClient.normalizeEvent: checkout.session.completed", () => {
  const ev = {
    id: "evt_3", type: "checkout.session.completed", livemode: false, created: 1700000000,
    data: { object: { id: "cs_1", customer: "cus_3", subscription: "sub_3", customer_email: "a@b.com" } },
  };
  const norm = StripeClient.normalizeEvent(ev);
  assert.equal(norm.session_id, "cs_1");
  assert.equal(norm.subscription_id, "sub_3");
  assert.equal(norm.customer_email, "a@b.com");
});

test("StripeClient.normalizeEvent: invoice.payment_succeeded", () => {
  const ev = {
    id: "evt_4", type: "invoice.payment_succeeded", livemode: false, created: 1700000000,
    data: { object: { id: "in_1", subscription: "sub_4", customer: "cus_4", amount_paid: 1900, currency: "eur" } },
  };
  const norm = StripeClient.normalizeEvent(ev);
  assert.equal(norm.invoice_id, "in_1");
  assert.equal(norm.amount_paid, 1900);
  assert.equal(norm.currency, "eur");
});

test("StripeClient.normalizeEvent: returns null for empty input", () => {
  assert.equal(StripeClient.normalizeEvent(null), null);
  assert.equal(StripeClient.normalizeEvent({}), null);
});

// ============================================================
// Default transport (no apiKey) fails fast
// ============================================================

test("StripeClient: default transport throws if apiKey missing", async () => {
  const c = new StripeClient({});
  await assert.rejects(
    () => c.createCustomer({ email: "x@y.com" }),
    (e) => e instanceof StripeError && e.code === "config_missing"
  );
});

// ============================================================
// Call recording
// ============================================================

test("StripeClient: records every call to this.calls", async () => {
  const { transport } = makeTransport([
    okJson({ id: "cus_1" }),
    okJson({ id: "sub_1" }),
  ]);
  const c = new StripeClient({ transport });
  await c.createCustomer({ email: "a@b.com" });
  await c.retrieveSubscription("sub_1");
  assert.equal(c.calls.length, 2);
  assert.equal(c.calls[0].path, "/v1/customers");
  assert.equal(c.calls[1].path, "/v1/subscriptions/sub_1");
});

// ============================================================
// helpers
// ============================================================

function require_hmac_sha256_hex(secret, message) {
  return createHmac("sha256", secret).update(message, "utf8").digest("hex");
}
