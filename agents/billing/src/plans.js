// Vireo Billing — Plan catalog.
// 4 tiers: Free, Pro, Business, Enterprise.
// Prices in EUR cents/month to avoid float math.

export const PLANS = {
  free: {
    id: "free",
    name: "Free",
    price_cents: 0,
    currency: "EUR",
    interval: "month",
    limits: {
      posts_per_month: 5,
      platforms: 2,
      storage_mb: 100,
      llm_tokens_per_month: 0,
      style_dna_samples: 10,
    },
    features: [
      "1 creator profile",
      "Basic style analysis (rule-based)",
      "2 platforms",
      "EU AI Act compliance",
    ],
  },
  pro: {
    id: "pro",
    name: "Pro",
    price_cents: 1900,
    currency: "EUR",
    interval: "month",
    stripe_price_id: "price_pro_monthly_mock",
    limits: {
      posts_per_month: 100,
      platforms: 5,
      storage_mb: 5_000,
      llm_tokens_per_month: 1_000_000,
      style_dna_samples: 1_000,
    },
    features: [
      "Everything in Free",
      "LLM-enhanced style analysis",
      "5 platforms",
      "100 posts/month",
      "Priority email support",
    ],
  },
  business: {
    id: "business",
    name: "Business",
    price_cents: 4900,
    currency: "EUR",
    interval: "month",
    stripe_price_id: "price_business_monthly_mock",
    limits: {
      posts_per_month: 1_000,
      platforms: 10,
      storage_mb: 50_000,
      llm_tokens_per_month: 10_000_000,
      style_dna_samples: 50_000,
    },
    features: [
      "Everything in Pro",
      "All 10 platforms",
      "1,000 posts/month",
      "Multi-creator team",
      "Custom style DNA blending",
    ],
  },
  enterprise: {
    id: "enterprise",
    name: "Enterprise",
    price_cents: 19900,
    currency: "EUR",
    interval: "month",
    stripe_price_id: "price_enterprise_monthly_mock",
    limits: {
      posts_per_month: -1,   // unlimited
      platforms: 10,
      storage_mb: -1,        // unlimited
      llm_tokens_per_month: -1,
      style_dna_samples: -1,
    },
    features: [
      "Everything in Business",
      "Unlimited posts",
      "Unlimited storage",
      "Dedicated success manager",
      "Custom integrations",
      "SLA 99.9%",
    ],
  },
};

export const PLAN_IDS = Object.keys(PLANS);

export function getPlan(id) {
  return PLANS[id] || null;
}

export function listPlans() {
  return Object.values(PLANS).map((p) => ({
    id: p.id,
    name: p.name,
    price_cents: p.price_cents,
    currency: p.currency,
    interval: p.interval,
    limits: p.limits,
    features: p.features,
  }));
}

export function isLimitExceeded(planId, metric, value) {
  const plan = getPlan(planId);
  if (!plan) return true;
  const limit = plan.limits[metric];
  if (limit === undefined) return false;
  if (limit === -1) return false;  // unlimited
  return value > limit;
}
