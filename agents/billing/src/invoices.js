// Vireo Billing — mock invoice generator.
// Produces invoice objects that look like Stripe's but for tests.

import { randomUUID } from "node:crypto";
import { getPlan } from "./plans.js";

export function createInvoice({ userId, planId, periodStart, periodEnd }) {
  const plan = getPlan(planId);
  if (!plan) throw new Error(`unknown plan: ${planId}`);
  const inv = {
    id: `in_${randomUUID().slice(0, 8)}`,
    user_id: userId,
    plan_id: planId,
    amount_due: plan.price_cents,
    amount_paid: 0,
    currency: plan.currency,
    status: "open",
    period_start: periodStart,
    period_end: periodEnd,
    created_at: new Date().toISOString(),
  };
  return inv;
}

export function payInvoice(inv) {
  if (inv.status === "paid") return inv;
  if (inv.amount_due === 0) {
    inv.status = "paid";
    inv.amount_paid = 0;
    inv.paid_at = new Date().toISOString();
    return inv;
  }
  // Mock: always succeeds
  inv.status = "paid";
  inv.amount_paid = inv.amount_due;
  inv.paid_at = new Date().toISOString();
  return inv;
}
