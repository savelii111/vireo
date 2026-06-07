// Vireo Billing — HTTP server with plans, subscriptions, usage, webhooks.
// Supports both mock (no apiKey) and real Stripe (with StripeClient + webhookSecret).

import { createServer } from "node:http";
import { authMiddleware, corsHeaders, readJsonBody, readRawBody, RateLimiter } from "../../../packages/auth-middleware/index.js";
import { PLANS, PLAN_IDS, getPlan, listPlans, isLimitExceeded } from "./plans.js";
import { SubscriptionStore, ValidationError as SubValidationError, NotFoundError } from "./subscriptions.js";
import { UsageMeter, currentYearMonth } from "./usage.js";
import { createInvoice, payInvoice } from "./invoices.js";
import { StripeClient, StripeError } from "./stripe_client.js";

const DEFAULT_PORT = Number(process.env.PORT || 8006);
const DEFAULT_HOST = process.env.HOST || "127.0.0.1";
const JWT_SECRET = process.env.VIREO_JWT_SECRET || "";

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function publicSubscription(s) {
  if (!s) return null;
  return {
    id: s.id,
    user_id: s.user_id,
    plan_id: s.plan_id,
    status: s.status,
    current_period_start: s.current_period_start,
    current_period_end: s.current_period_end,
    cancel_at_period_end: s.cancel_at_period_end,
    created_at: s.created_at,
    cancelled_at: s.cancelled_at || null,
    stripe_subscription_id: s.stripe_subscription_id,
    stripe_customer_id: s.stripe_customer_id || null,
  };
}

function publicInvoice(inv) {
  return {
    id: inv.id,
    user_id: inv.user_id,
    plan_id: inv.plan_id,
    amount_due: inv.amount_due,
    amount_paid: inv.amount_paid,
    currency: inv.currency,
    status: inv.status,
    paid_at: inv.paid_at || null,
    created_at: inv.created_at,
  };
}

export function buildServer({
  port = DEFAULT_PORT,
  host = DEFAULT_HOST,
  subs = null,
  usage = null,
  stripeClient = null,
  webhookSecret = null,
  customerStore = null,
  returnUrlBase = "https://vireo.ai",
  secret = JWT_SECRET,
} = {}) {
  const subStore = subs || new SubscriptionStore();
  const usageMeter = usage || new UsageMeter();
  const customers = customerStore || new Map();
  const auth = secret ? authMiddleware(secret) : null;
  const rateLimiter = new RateLimiter({ max: 60, windowMs: 60_000 });
  const cors = corsHeaders();

  const stripeMode = !!stripeClient;
  // In real mode, the webhook secret can come from constructor or from this option.
  // Prefer the option (so tests can inject) but fall back to the client's.
  const effectiveWebhookSecret = webhookSecret !== null
    ? webhookSecret
    : (stripeClient?.webhookSecret || null);

  // Helper: build a "redirect-after-checkout" success URL.
  function successUrl() { return `${returnUrlBase}/billing/success?session_id={CHECKOUT_SESSION_ID}`; }
  function cancelUrl() { return `${returnUrlBase}/billing/cancel`; }
  function portalReturnUrl() { return `${returnUrlBase}/account`; }

  // Helper: get or create a Stripe customer for the user.
  async function getOrCreateCustomer(user) {
    if (!stripeClient) throw new StripeError("no stripe client", 0, "config_missing");
    const existing = customers.get(user.id);
    if (existing) return existing;
    const cust = await stripeClient.createCustomer({
      email: user.email || null,
      name: user.name || null,
      metadata: { user_id: user.id },
    });
    customers.set(user.id, cust.id);
    return cust.id;
  }

  // Helper: apply a normalized Stripe event to the local subscription store.
  // Returns { updated: subscription|null, note: string }
  function applyStripeEvent(normalized) {
    if (!normalized) return { updated: null, note: "ignored" };
    const type = normalized.type;
    if (type === "customer.subscription.deleted" || type === "customer.subscription.updated") {
      const subId = normalized.subscription_id;
      const local = subStore.getByStripeId ? subStore.getByStripeId(subId) : null;
      if (!local) return { updated: null, note: "no_local_match" };
      const result = subStore.applyEvent(normalized);
      return { updated: result, note: "subscription_updated" };
    }
    if (type === "checkout.session.completed") {
      // The user has just paid. Create a local subscription tied to the stripe id.
      const stripeSubId = normalized.subscription_id;
      const stripeCustomerId = normalized.customer_id;
      const userId = (normalized.raw?.data?.object?.metadata?.user_id) || null;
      const planId = (normalized.raw?.data?.object?.metadata?.plan_id) || null;
      if (!stripeSubId || !planId) {
        return { updated: null, note: "missing_metadata" };
      }
      // Cancel any existing active sub for this user.
      const existing = userId ? subStore.getForUser(userId) : null;
      if (existing) subStore.cancelSubscription(existing.id);
      const now = new Date();
      const periodEnd = new Date(now);
      periodEnd.setMonth(periodEnd.getMonth() + 1);
      const s = subStore.createSubscription({
        userId: userId || `stripe_${stripeCustomerId}`,
        planId,
        stripeSubscriptionId: stripeSubId,
        stripeCustomerId,
        currentPeriodStart: now.toISOString(),
        currentPeriodEnd: periodEnd.toISOString(),
      });
      return { updated: s, note: "subscription_created" };
    }
    if (type === "invoice.payment_succeeded") {
      return { updated: null, note: "invoice_paid" };
    }
    return { updated: null, note: "unhandled_event_type" };
  }

  const server = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Stripe-Signature");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

    const url = req.url.split("?")[0];

    // Rate limit API endpoints (60/min per IP)
    if (url !== "/health" && url !== "/version") {
      const rlKey = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "global").toString().split(",")[0].trim();
      const rl = rateLimiter.check(rlKey);
      res.setHeader("X-RateLimit-Limit", "60");
      res.setHeader("X-RateLimit-Remaining", String(Math.max(0, 60 - rl.count)));
      if (!rl.allowed) {
        res.setHeader("Retry-After", String(Math.ceil(rl.retryAfterMs / 1000)));
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "rate_limited", message: "too many requests" }));
        return;
      }
    }

    try {
      // ---- public ----
      if (req.method === "GET" && url === "/health") {
        return json(res, 200, {
          status: "ok",
          agent: "billing",
          plans: PLAN_IDS.length,
          subscriptions: subStore.subs.size,
          stripe_mode: stripeMode,
        });
      }
      if (req.method === "GET" && url === "/plans") {
        return json(res, 200, { plans: listPlans() });
      }
      if (req.method === "GET" && url === "/plans/free") {
        return json(res, 200, getPlan("free"));
      }
      if (req.method === "GET" && url.startsWith("/plans/")) {
        const planId = url.split("/")[2];
        const p = getPlan(planId);
        if (!p) return json(res, 404, { error: "plan_not_found" });
        return json(res, 200, p);
      }

      // ---- authenticated ----
      if (req.method === "GET" && url === "/me/subscription") {
        if (auth) { await new Promise((r) => auth(req, res, r)); if (res.writableEnded) return; }
        const s = subStore.getForUser(req.user.id);
        if (!s) return json(res, 200, { subscription: null, plan: getPlan("free"), stripe_mode: stripeMode });
        return json(res, 200, { subscription: publicSubscription(s), plan: getPlan(s.plan_id), stripe_mode: stripeMode });
      }

      // POST /subscribe
      //   - Mock mode: creates local subscription + invoice immediately
      //   - Stripe mode: creates a Checkout Session and returns the URL
      if (req.method === "POST" && url === "/subscribe") {
        if (auth) { await new Promise((r) => auth(req, res, r)); if (res.writableEnded) return; }
        let body; try { body = await readJsonBody(req, res); } catch { return; }
        const planId = body.plan_id;
        const plan = getPlan(planId);
        if (!planId || !plan) return json(res, 400, { error: "validation_error", message: "invalid or missing plan_id" });

        if (stripeMode && plan.price_cents > 0) {
          // Real Stripe flow
          try {
            const customerId = await getOrCreateCustomer(req.user);
            const session = await stripeClient.createCheckoutSession({
              plan: {
                id: plan.id,
                name: plan.name,
                amount_cents: plan.price_cents,
                currency: plan.currency,
                interval: plan.interval || "month",
              },
              customerId,
              successUrl: successUrl(),
              cancelUrl: cancelUrl(),
              metadata: { user_id: req.user.id, plan_id: planId },
            });
            return json(res, 201, {
              mode: "stripe_checkout",
              checkout_url: session.url,
              session_id: session.id,
              plan: getPlan(planId),
            });
          } catch (e) {
            if (e instanceof StripeError) {
              return json(res, e.status || 502, { error: "stripe_error", code: e.code, message: e.message });
            }
            throw e;
          }
        }

        // Mock (or free) flow
        try {
          const s = subStore.createSubscription({ userId: req.user.id, planId });
          const inv = createInvoice({
            userId: req.user.id,
            planId: s.plan_id,
            periodStart: s.current_period_start,
            periodEnd: s.current_period_end,
          });
          payInvoice(inv);
          return json(res, 201, { mode: "mock", subscription: publicSubscription(s), invoice: publicInvoice(inv) });
        } catch (e) {
          if (e instanceof SubValidationError) return json(res, 400, { error: "validation_error", message: e.message });
          throw e;
        }
      }

      // POST /cancel
      if (req.method === "POST" && url === "/cancel") {
        if (auth) { await new Promise((r) => auth(req, res, r)); if (res.writableEnded) return; }
        const s = subStore.getForUser(req.user.id);
        if (!s) return json(res, 404, { error: "no_active_subscription" });
        // In stripe mode, also call Stripe to schedule cancellation.
        if (stripeMode && s.stripe_subscription_id) {
          try {
            await stripeClient.setSubscriptionCancelAtPeriodEnd(s.stripe_subscription_id, true);
          } catch (e) {
            if (e instanceof StripeError) {
              return json(res, e.status || 502, { error: "stripe_error", code: e.code, message: e.message });
            }
            throw e;
          }
        }
        const cancelled = subStore.cancelSubscription(s.id);
        return json(res, 200, { subscription: publicSubscription(cancelled) });
      }

      // POST /portal — Stripe customer portal session (requires stripeClient)
      if (req.method === "POST" && url === "/portal") {
        if (auth) { await new Promise((r) => auth(req, res, r)); if (res.writableEnded) return; }
        if (!stripeMode) return json(res, 400, { error: "stripe_mode_required" });
        try {
          const customerId = await getOrCreateCustomer(req.user);
          const session = await stripeClient.createPortalSession({
            customerId,
            returnUrl: portalReturnUrl(),
          });
          return json(res, 200, { url: session.url });
        } catch (e) {
          if (e instanceof StripeError) {
            return json(res, e.status || 502, { error: "stripe_error", code: e.code, message: e.message });
          }
          throw e;
        }
      }

      // GET /me/customer — return Stripe customer id (create if missing)
      if (req.method === "GET" && url === "/me/customer") {
        if (auth) { await new Promise((r) => auth(req, res, r)); if (res.writableEnded) return; }
        if (!stripeMode) return json(res, 400, { error: "stripe_mode_required" });
        try {
          const customerId = await getOrCreateCustomer(req.user);
          return json(res, 200, { customer_id: customerId });
        } catch (e) {
          if (e instanceof StripeError) {
            return json(res, e.status || 502, { error: "stripe_error", code: e.code, message: e.message });
          }
          throw e;
        }
      }

      // GET /usage
      if (req.method === "GET" && url === "/usage") {
        if (auth) { await new Promise((r) => auth(req, res, r)); if (res.writableEnded) return; }
        const usage = usageMeter.getAll(req.user.id);
        const s = subStore.getForUser(req.user.id);
        const planId = s ? s.plan_id : "free";
        const plan = getPlan(planId);
        const remaining = {};
        for (const [counter, value] of Object.entries(usage)) {
          const limit = plan.limits[counter === "posts_published" ? "posts_per_month" : counter];
          if (limit === -1) {
            remaining[counter] = { used: value, limit: -1, remaining: -1 };
          } else {
            remaining[counter] = { used: value, limit, remaining: Math.max(0, limit - value) };
          }
        }
        return json(res, 200, { usage, remaining, plan_id: planId, year_month: currentYearMonth() });
      }

      // POST /usage/record
      if (req.method === "POST" && url === "/usage/record") {
        if (auth) { await new Promise((r) => auth(req, res, r)); if (res.writableEnded) return; }
        let body; try { body = await readJsonBody(req, res); } catch { return; }
        try {
          const newValue = usageMeter.record(req.user.id, body.counter, body.amount || 1);
          const s = subStore.getForUser(req.user.id);
          const planId = s ? s.plan_id : "free";
          const limitKey = body.counter === "posts_published" ? "posts_per_month" : body.counter;
          if (isLimitExceeded(planId, limitKey, newValue)) {
            return json(res, 402, { error: "limit_exceeded", counter: body.counter, value: newValue, plan_id: planId });
          }
          return json(res, 200, { counter: body.counter, value: newValue, plan_id: planId });
        } catch (e) {
          return json(res, 400, { error: "validation_error", message: e.message });
        }
      }

      // POST /webhook/stripe
      //   - With effectiveWebhookSecret: verify signature, then parse and apply
      //   - Without: accept raw JSON (mock mode for tests)
      if (req.method === "POST" && url === "/webhook/stripe") {
        const raw = await readRawBody(req, res);
        if (res.writableEnded) return; // size limit or other early-exit

        if (effectiveWebhookSecret) {
          if (!stripeClient) {
            return json(res, 500, { error: "config_error", message: "webhook_secret set but no stripe client" });
          }
          const sig = req.headers["stripe-signature"] || req.headers["Stripe-Signature"];
          let verified;
          try {
            verified = stripeClient.verifyWebhookSignature({
              payload: raw,
              signatureHeader: sig,
              secret: effectiveWebhookSecret,
            });
          } catch (e) {
            if (e instanceof StripeError) {
              return json(res, e.status || 400, { error: "signature_invalid", code: e.code, message: e.message });
            }
            throw e;
          }
          const normalized = StripeClient.normalizeEvent(verified.event);
          const result = applyStripeEvent(normalized);
          return json(res, 200, { received: true, type: normalized?.type, note: result.note });
        }

        // Mock mode: accept JSON directly
        let body;
        try { body = JSON.parse(raw || "{}"); }
        catch { return json(res, 400, { error: "invalid_json" }); }
        try {
          const updated = subStore.applyEvent(body);
          return json(res, 200, { received: true, applied_to: updated?.id || null });
        } catch (e) {
          return json(res, 400, { error: "invalid_event", message: e.message });
        }
      }

      return json(res, 404, { error: "not_found", path: url });
    } catch (e) {
      if (res.writableEnded) return;
      json(res, 500, { error: "server_error", message: e.message });
    }
  });

  return {
    server, port, host,
    subs: subStore,
    usage: usageMeter,
    customers,
    applyStripeEvent,
  };
}

export function start(opts = {}) {
  const { server, port, host } = buildServer(opts);
  server.listen(port, host, () => {
    console.log(`[billing] listening on http://${host}:${port}${opts.stripeClient ? " (stripe_mode)" : " (mock)"}`);
  });
  return server;
}

if (false && import.meta.url === `file://${process.argv[1]}`) {
  start();
}
