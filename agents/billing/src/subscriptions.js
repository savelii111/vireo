// Vireo Billing — Subscription store (in-memory).
// Mocks Stripe: customers, subscriptions, invoices.

import { randomUUID } from "node:crypto";
import { getPlan } from "./plans.js";

export class SubscriptionStore {
  constructor() {
    /** @type {Map<string, object>} id -> subscription */
    this.subs = new Map();
  }

  createSubscription({ userId, planId, stripeCustomerId = null, stripeSubscriptionId = null, currentPeriodStart = null, currentPeriodEnd = null }) {
    const plan = getPlan(planId);
    if (!plan) throw new ValidationError(`unknown plan: ${planId}`);
    if (plan.price_cents === 0 && planId !== "free") {
      throw new ValidationError("only 'free' is non-paid");
    }
    // Cancel any existing active sub for this user
    for (const existing of this.subs.values()) {
      if (existing.user_id === userId && existing.status === "active") {
        existing.status = "cancelled";
        existing.cancelled_at = new Date().toISOString();
      }
    }
    const id = `sub_${randomUUID().slice(0, 8)}`;
    const sub = {
      id,
      user_id: userId,
      plan_id: planId,
      status: "active",
      stripe_customer_id: stripeCustomerId || `cus_${randomUUID().slice(0, 8)}`,
      stripe_subscription_id: stripeSubscriptionId || (planId === "free" ? null : `sub_stripe_${randomUUID().slice(0, 8)}`),
      current_period_start: currentPeriodStart || new Date().toISOString(),
      current_period_end: currentPeriodEnd || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      cancel_at_period_end: false,
      created_at: new Date().toISOString(),
    };
    this.subs.set(id, sub);
    return sub;
  }

  getForUser(userId) {
    for (const s of this.subs.values()) {
      if (s.user_id === userId && s.status === "active") return s;
    }
    return null;
  }

  getById(id) {
    return this.subs.get(id) || null;
  }

  // Look up a local subscription by its Stripe subscription id.
  getByStripeId(stripeSubId) {
    if (!stripeSubId) return null;
    for (const s of this.subs.values()) {
      if (s.stripe_subscription_id === stripeSubId) return s;
    }
    return null;
  }

  cancelSubscription(id) {
    const s = this.subs.get(id);
    if (!s) throw new NotFoundError(`subscription not found: ${id}`);
    s.status = "cancelled";
    s.cancelled_at = new Date().toISOString();
    s.cancel_at_period_end = true;
    return s;
  }

  // Apply a Stripe webhook event to update state.
  // Accepts both raw Stripe events ({ data: { object: {...} } }) and our normalized
  // events (top-level subscription_id, status, etc).
  applyEvent(event) {
    if (!event || !event.type) throw new ValidationError("event missing type");
    switch (event.type) {
      case "customer.subscription.deleted": {
        const local = this._resolveLocal(event);
        if (local) {
          local.status = "cancelled";
          local.cancelled_at = new Date().toISOString();
        }
        return local;
      }
      case "customer.subscription.updated": {
        const local = this._resolveLocal(event);
        if (local) {
          if (event.status) local.status = event.status;
          if (typeof event.cancel_at_period_end === "boolean") {
            local.cancel_at_period_end = event.cancel_at_period_end;
          }
          if (event.current_period_end) local.current_period_end = event.current_period_end;
          if (event.current_period_start) local.current_period_start = event.current_period_start;
        }
        return local;
      }
      case "invoice.payment_succeeded":
      case "invoice.payment_failed":
        return event.data?.object || event.raw?.data?.object || null;
      default:
        return null;
    }
  }

  // Find a local subscription by either normalized (subscription_id) or raw (data.object.id) shape.
  // Tries local id first (mock / self-sent webhooks) then stripe subscription id (real Stripe).
  _resolveLocal(event) {
    const candidate = event.subscription_id || event.data?.object?.id;
    if (!candidate) return null;
    const direct = this.subs.get(candidate);
    if (direct) return direct;
    return this.getByStripeId(candidate);
  }

  // For tests
  _reset() {
    this.subs.clear();
  }
}

export class ValidationError extends Error {
  constructor(message) { super(message); this.name = "ValidationError"; }
}
export class NotFoundError extends Error {
  constructor(message) { super(message); this.name = "NotFoundError"; }
}
