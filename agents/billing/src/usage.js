// Vireo Billing — usage metering.
// Tracks per-user metrics (posts, tokens, storage) per calendar month.

const COUNTERS = ["posts_published", "llm_tokens", "storage_mb", "style_dna_samples"];

export class UsageMeter {
  constructor() {
    this.users = new Map(); // userId -> { months: { ym: { counter: value } } }
  }

  record(userId, counter, amount = 1) {
    if (!COUNTERS.includes(counter)) {
      throw new Error(`unknown counter: ${counter}`);
    }
    const ym = currentYearMonth();
    if (!this.users.has(userId)) this.users.set(userId, { months: {} });
    const userRec = this.users.get(userId);
    if (!userRec.months[ym]) userRec.months[ym] = {};
    userRec.months[ym][counter] = (userRec.months[ym][counter] || 0) + amount;
    return userRec.months[ym][counter];
  }

  get(userId, counter, ym = currentYearMonth()) {
    const u = this.users.get(userId);
    if (!u || !u.months[ym]) return 0;
    return u.months[ym][counter] || 0;
  }

  getAll(userId, ym = currentYearMonth()) {
    const u = this.users.get(userId);
    if (!u || !u.months[ym]) {
      return Object.fromEntries(COUNTERS.map((c) => [c, 0]));
    }
    return Object.fromEntries(COUNTERS.map((c) => [c, u.months[ym][c] || 0]));
  }

  has(userId) {
    return this.users.has(userId);
  }

  // For tests
  _reset() {
    this.users.clear();
  }
}

export function currentYearMonth(d = new Date()) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}
