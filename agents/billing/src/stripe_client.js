// Vireo Billing — real Stripe client with injectable transport + webhook verification.

import { createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_BASE_URL = "https://api.stripe.com";
const DEFAULT_TIMEOUT_MS = 30_000;

export class StripeError extends Error {
  constructor(message, status = 0, code = null) {
    super(message);
    this.name = "StripeError";
    this.status = status;
    this.code = code;
  }
}

function _defaultTransport() {
  // Late-bound so we can read this.apiKey / this.baseUrl at call time.
  return async (method, path, body, headers) => {
    if (!this.apiKey) {
      throw new StripeError("stripe_client_no_api_key", 0, "config_missing");
    }
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), DEFAULT_TIMEOUT_MS);
    try {
      const resp = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
          ...headers,
        },
        body: body || undefined,
        signal: ac.signal,
      });
      const text = await resp.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* not JSON */ }
      return { status: resp.status, ok: resp.ok, body: text, json };
    } catch (e) {
      if (e.name === "AbortError") {
        throw new StripeError("stripe_request_timeout", 0, "timeout");
      }
      throw new StripeError(`stripe_request_failed: ${e.message}`, 0, "network");
    } finally {
      clearTimeout(timer);
    }
  };
}

export class StripeClient {
  constructor({
    apiKey = null,
    baseUrl = DEFAULT_BASE_URL,
    transport = null,
    webhookSecret = null,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = {}) {
    this.apiKey = apiKey;
    this.baseUrl = String(baseUrl).replace(/\/+$/, "");
    this.webhookSecret = webhookSecret;
    this.timeoutMs = timeoutMs;
    this.transport = transport || _defaultTransport.call(this);
    this.calls = []; // for test inspection
  }

  _record(method, path, body) {
    this.calls.push({ method, path, body });
  }

  // ---- HTTP helpers ----
  async _post(path, params) {
    this._record("POST", path, params);
    const r = await this.transport("POST", path, params, {});
    if (!r.ok) {
      const msg = r.json?.error?.message || r.body || "stripe_post_failed";
      throw new StripeError(msg, r.status, r.json?.error?.code || null);
    }
    return r.json;
  }

  async _get(path) {
    this._record("GET", path, null);
    const r = await this.transport("GET", path, null, {});
    if (!r.ok) {
      const msg = r.json?.error?.message || r.body || "stripe_get_failed";
      throw new StripeError(msg, r.status, r.json?.error?.code || null);
    }
    return r.json;
  }

  async _delete(path) {
    this._record("DELETE", path, null);
    const r = await this.transport("DELETE", path, null, {});
    if (!r.ok) {
      const msg = r.json?.error?.message || r.body || "stripe_delete_failed";
      throw new StripeError(msg, r.status, r.json?.error?.code || null);
    }
    return r.json;
  }

  // ---- Customer ----
  async createCustomer({ email = null, name = null, metadata = {} } = {}) {
    const p = new URLSearchParams();
    if (email) p.set("email", email);
    if (name) p.set("name", name);
    for (const [k, v] of Object.entries(metadata)) {
      p.set(`metadata[${k}]`, String(v));
    }
    return this._post("/v1/customers", p.toString());
  }

  async retrieveCustomer(id) {
    return this._get(`/v1/customers/${encodeURIComponent(id)}`);
  }

  // ---- Checkout Session ----
  async createCheckoutSession({
    plan,
    customerEmail = null,
    customerId = null,
    successUrl,
    cancelUrl,
    metadata = {},
  } = {}) {
    if (!plan || !plan.amount_cents || !successUrl || !cancelUrl) {
      throw new StripeError("missing required fields for checkout session", 0, "validation");
    }
    const p = new URLSearchParams();
    p.set("mode", "subscription");
    p.set("success_url", successUrl);
    p.set("cancel_url", cancelUrl);
    p.set("line_items[0][quantity]", "1");
    p.set("line_items[0][price_data][currency]", plan.currency || "eur");
    p.set("line_items[0][price_data][unit_amount]", String(plan.amount_cents));
    p.set("line_items[0][price_data][recurring][interval]", plan.interval || "month");
    p.set("line_items[0][price_data][product_data][name]", plan.name || plan.id);
    if (customerId) p.set("customer", customerId);
    else if (customerEmail) p.set("customer_email", customerEmail);
    for (const [k, v] of Object.entries(metadata)) {
      p.set(`metadata[${k}]`, String(v));
      p.set(`subscription_data[metadata][${k}]`, String(v));
    }
    return this._post("/v1/checkout/sessions", p.toString());
  }

  async retrieveCheckoutSession(id) {
    return this._get(`/v1/checkout/sessions/${encodeURIComponent(id)}`);
  }

  // ---- Subscriptions ----
  async retrieveSubscription(id) {
    return this._get(`/v1/subscriptions/${encodeURIComponent(id)}`);
  }

  async setSubscriptionCancelAtPeriodEnd(id, cancel = true) {
    const p = new URLSearchParams();
    p.set("cancel_at_period_end", cancel ? "true" : "false");
    return this._post(`/v1/subscriptions/${encodeURIComponent(id)}`, p.toString());
  }

  async cancelSubscriptionImmediately(id) {
    return this._delete(`/v1/subscriptions/${encodeURIComponent(id)}`);
  }

  // ---- Customer Portal ----
  async createPortalSession({ customerId, returnUrl }) {
    if (!customerId || !returnUrl) {
      throw new StripeError("missing customerId or returnUrl", 0, "validation");
    }
    const p = new URLSearchParams();
    p.set("customer", customerId);
    p.set("return_url", returnUrl);
    return this._post("/v1/billing_portal/sessions", p.toString());
  }

  // ---- Webhook signature ----
  // Stripe sends header: "Stripe-Signature: t=TIMESTAMP,v1=SIG[,v1=SIG2...]"
  // We compute: HMAC_SHA256(`${t}.${rawBody}`, secret), then timingSafeEqual with v1.
  // The `secret` parameter overrides the instance's webhookSecret (useful for tests
  // and for servers that manage the secret separately).
  verifyWebhookSignature({ payload, signatureHeader, tolerance = 300, now = null, secret = null } = {}) {
    const useSecret = secret || this.webhookSecret;
    if (!useSecret) {
      throw new StripeError("webhook_secret not configured", 500, "config_missing");
    }
    if (typeof payload !== "string") {
      throw new StripeError("payload must be a string", 400, "validation");
    }
    if (!signatureHeader || typeof signatureHeader !== "string") {
      throw new StripeError("missing signature", 400, "missing_signature");
    }
    const parts = signatureHeader.split(",").map((s) => s.trim());
    let timestamp = null;
    const v1Sigs = [];
    for (const part of parts) {
      const eq = part.indexOf("=");
      if (eq < 0) continue;
      const k = part.slice(0, eq);
      const v = part.slice(eq + 1);
      if (k === "t") timestamp = Number(v);
      else if (k === "v1") v1Sigs.push(v);
    }
    if (timestamp == null || Number.isNaN(timestamp) || v1Sigs.length === 0) {
      throw new StripeError("malformed signature header", 400, "malformed_signature");
    }
    const nowSec = (now || Math.floor(Date.now() / 1000));
    const age = Math.abs(nowSec - timestamp);
    if (age > tolerance) {
      throw new StripeError(`timestamp outside tolerance (${age}s > ${tolerance}s)`, 400, "timestamp_expired");
    }
    const signedPayload = `${timestamp}.${payload}`;
    const expectedHex = createHmac("sha256", useSecret).update(signedPayload, "utf8").digest("hex");
    const expectedBuf = Buffer.from(expectedHex, "hex");
    let matched = false;
    for (const sig of v1Sigs) {
      let sigBuf;
      try {
        sigBuf = Buffer.from(sig, "hex");
      } catch {
        continue;
      }
      if (sigBuf.length === expectedBuf.length && timingSafeEqual(sigBuf, expectedBuf)) {
        matched = true;
        break;
      }
    }
    if (!matched) {
      throw new StripeError("signature mismatch", 400, "signature_mismatch");
    }
    let event;
    try {
      event = JSON.parse(payload);
    } catch (e) {
      throw new StripeError("payload is not valid JSON", 400, "invalid_json");
    }
    return { event, timestamp, age };
  }

  // ---- Static helper for tests / outbound signing ----
  static signWebhookPayload({ payload, secret, timestamp = null }) {
    const t = timestamp != null ? timestamp : Math.floor(Date.now() / 1000);
    const sig = createHmac("sha256", secret).update(`${t}.${payload}`, "utf8").digest("hex");
    return { header: `t=${t},v1=${sig}`, timestamp: t, signature: sig };
  }

  // Map a Stripe event to our internal event shape (used by SubscriptionStore.applyEvent).
  static normalizeEvent(stripeEvent) {
    if (!stripeEvent || !stripeEvent.type) return null;
    const obj = stripeEvent.data?.object || {};
    const out = {
      id: stripeEvent.id,
      type: stripeEvent.type,
      livemode: !!stripeEvent.livemode,
      created: stripeEvent.created,
      raw: stripeEvent,
    };
    if (stripeEvent.type === "customer.subscription.deleted") {
      out.subscription_id = obj.id;
      out.status = "cancelled"; // Stripe uses "canceled" (US); we use UK spelling internally.
      out.customer_id = obj.customer;
    } else if (stripeEvent.type === "customer.subscription.updated") {
      out.subscription_id = obj.id;
      out.status = obj.status === "canceled" ? "cancelled" : obj.status;
      out.cancel_at_period_end = !!obj.cancel_at_period_end;
      out.customer_id = obj.customer;
      if (obj.current_period_start) out.current_period_start = new Date(obj.current_period_start * 1000).toISOString();
      if (obj.current_period_end) out.current_period_end = new Date(obj.current_period_end * 1000).toISOString();
    } else if (stripeEvent.type === "customer.subscription.created") {
      out.subscription_id = obj.id;
      out.status = obj.status;
      out.customer_id = obj.customer;
    } else if (stripeEvent.type === "checkout.session.completed") {
      out.session_id = obj.id;
      out.customer_id = obj.customer;
      out.subscription_id = obj.subscription || null;
      out.customer_email = obj.customer_email || null;
    } else if (stripeEvent.type === "invoice.payment_succeeded") {
      out.invoice_id = obj.id;
      out.subscription_id = obj.subscription || null;
      out.customer_id = obj.customer || null;
      out.amount_paid = obj.amount_paid;
      out.currency = obj.currency;
    } else if (stripeEvent.type === "invoice.payment_failed") {
      out.invoice_id = obj.id;
      out.subscription_id = obj.subscription || null;
      out.customer_id = obj.customer || null;
    }
    return out;
  }
}
