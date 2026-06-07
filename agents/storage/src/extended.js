// Extended Postgres store classes for users, subscriptions, usage, invoices,
// OAuth tokens, and StyleDNA. Built on top of the migrations system.

import { newId, nowIso } from "@vireo/shared";

export class PostgresUsersStore {
  constructor(store) { this.store = store; this.pool = store.pool; }
  _ensure() { this.store._ensure(); }

  async findByEmail(email) {
    this._ensure();
    const r = await this.pool.query("SELECT * FROM vireo_users WHERE email = $1", [email.toLowerCase()]);
    return r.rows[0] || null;
  }

  async findById(id) {
    this._ensure();
    const r = await this.pool.query("SELECT * FROM vireo_users WHERE id = $1", [id]);
    return r.rows[0] || null;
  }

  async create({ email, password_hash, name = null, plan = "free" }) {
    this._ensure();
    const u = { id: newId(), email: email.toLowerCase(), password_hash, name, plan,
                created_at: nowIso(), updated_at: nowIso() };
    await this.pool.query(
      `INSERT INTO vireo_users (id, email, password_hash, name, plan, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [u.id, u.email, u.password_hash, u.name, u.plan, u.created_at, u.updated_at],
    );
    return u;
  }

  async update(id, patch) {
    this._ensure();
    const u = await this.findById(id);
    if (!u) return null;
    const merged = { ...u, ...patch, updated_at: nowIso() };
    await this.pool.query(
      `UPDATE vireo_users SET email=$2, password_hash=$3, name=$4, plan=$5, updated_at=$6 WHERE id=$1`,
      [id, merged.email, merged.password_hash, merged.name, merged.plan, merged.updated_at],
    );
    return merged;
  }

  async count() {
    this._ensure();
    const r = await this.pool.query("SELECT COUNT(*)::int AS c FROM vireo_users");
    return r.rows[0]?.c || 0;
  }
}

export class PostgresSubscriptionsStore {
  constructor(store) { this.store = store; this.pool = store.pool; }
  _ensure() { this.store._ensure(); }

  async create({ user_id, plan, stripe_subscription_id = null, stripe_customer_id = null, current_period_end = null }) {
    this._ensure();
    const sub = { id: newId(), user_id, plan, status: "active",
                  cancel_at_period_end: false,
                  stripe_subscription_id, stripe_customer_id, current_period_end,
                  created_at: nowIso(), updated_at: nowIso() };
    await this.pool.query(
      `INSERT INTO vireo_subscriptions
       (id, user_id, plan, status, cancel_at_period_end, stripe_subscription_id, stripe_customer_id, current_period_end, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [sub.id, sub.user_id, sub.plan, sub.status, sub.cancel_at_period_end,
       sub.stripe_subscription_id, sub.stripe_customer_id, sub.current_period_end,
       sub.created_at, sub.updated_at],
    );
    return sub;
  }

  async getForUser(user_id) {
    this._ensure();
    const r = await this.pool.query(
      `SELECT * FROM vireo_subscriptions WHERE user_id = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
      [user_id],
    );
    return r.rows[0] || null;
  }

  async update(id, patch) {
    this._ensure();
    const r = await this.pool.query("SELECT * FROM vireo_subscriptions WHERE id = $1", [id]);
    if (!r.rows[0]) return null;
    const sub = r.rows[0];
    const merged = { ...sub, ...patch, updated_at: nowIso() };
    await this.pool.query(
      `UPDATE vireo_subscriptions SET plan=$2, status=$3, cancel_at_period_end=$4,
       stripe_subscription_id=$5, stripe_customer_id=$6, current_period_end=$7, updated_at=$8 WHERE id=$1`,
      [id, merged.plan, merged.status, merged.cancel_at_period_end,
       merged.stripe_subscription_id, merged.stripe_customer_id, merged.current_period_end, merged.updated_at],
    );
    return merged;
  }

  async cancelByUser(user_id) {
    this._ensure();
    const r = await this.pool.query(
      `UPDATE vireo_subscriptions SET status='cancelled', updated_at=now() WHERE user_id=$1 AND status='active' RETURNING *`,
      [user_id],
    );
    return r.rows[0] || null;
  }
}

export class PostgresUsageStore {
  constructor(store) { this.store = store; this.pool = store.pool; }
  _ensure() { this.store._ensure(); }

  _ym() { return new Date().toISOString().slice(0, 7); }

  async record({ user_id, counter, value = 1, year_month = null }) {
    this._ensure();
    const ym = year_month || this._ym();
    const id = newId();
    await this.pool.query(
      `INSERT INTO vireo_usage (id, user_id, counter, year_month, value, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, now(), now())
       ON CONFLICT (user_id, counter, year_month) DO UPDATE SET value = vireo_usage.value + $5, updated_at = now()
       RETURNING *`,
      [id, user_id, counter, ym, value],
    );
    return { user_id, counter, year_month: ym, value };
  }

  async get(user_id, counter, year_month = null) {
    this._ensure();
    const ym = year_month || this._ym();
    const r = await this.pool.query(
      `SELECT * FROM vireo_usage WHERE user_id=$1 AND counter=$2 AND year_month=$3`,
      [user_id, counter, ym],
    );
    return r.rows[0]?.value || 0;
  }

  async getAll(user_id, year_month = null) {
    this._ensure();
    const ym = year_month || this._ym();
    const r = await this.pool.query(
      `SELECT counter, value FROM vireo_usage WHERE user_id=$1 AND year_month=$2`,
      [user_id, ym],
    );
    return r.rows;
  }
}

export class PostgresInvoicesStore {
  constructor(store) { this.store = store; this.pool = store.pool; }
  _ensure() { this.store._ensure(); }

  async create({ user_id, amount_cents, currency = "EUR", plan, status = "pending", stripe_invoice_id = null }) {
    this._ensure();
    const inv = { id: newId(), user_id, amount_cents, currency, plan, status, stripe_invoice_id, created_at: nowIso() };
    await this.pool.query(
      `INSERT INTO vireo_invoices (id, user_id, amount_cents, currency, plan, status, stripe_invoice_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [inv.id, inv.user_id, inv.amount_cents, inv.currency, inv.plan, inv.status, inv.stripe_invoice_id, inv.created_at],
    );
    return inv;
  }

  async markPaid(id) {
    this._ensure();
    const r = await this.pool.query(
      `UPDATE vireo_invoices SET status='paid', paid_at=now() WHERE id=$1 RETURNING *`,
      [id],
    );
    return r.rows[0] || null;
  }

  async listForUser(user_id) {
    this._ensure();
    const r = await this.pool.query(
      `SELECT * FROM vireo_invoices WHERE user_id=$1 ORDER BY created_at DESC`,
      [user_id],
    );
    return r.rows;
  }
}

export class PostgresOAuthTokensStore {
  constructor(store) { this.store = store; this.pool = store.pool; }
  _ensure() { this.store._ensure(); }

  async upsert({ user_id, platform, access_token, refresh_token = null, expires_at = null, scope = null, profile = {} }) {
    this._ensure();
    const id = newId();
    await this.pool.query(
      `INSERT INTO vireo_oauth_tokens
       (id, user_id, platform, access_token, refresh_token, expires_at, scope, profile, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), now())
       ON CONFLICT (user_id, platform) DO UPDATE SET
         access_token = EXCLUDED.access_token,
         refresh_token = EXCLUDED.refresh_token,
         expires_at = EXCLUDED.expires_at,
         scope = EXCLUDED.scope,
         profile = EXCLUDED.profile,
         updated_at = now()
       RETURNING *`,
      [id, user_id, platform, access_token, refresh_token, expires_at, scope, JSON.stringify(profile)],
    );
    return { user_id, platform };
  }

  async listForUser(user_id) {
    this._ensure();
    const r = await this.pool.query(
      `SELECT platform, scope, profile, expires_at, updated_at FROM vireo_oauth_tokens WHERE user_id = $1`,
      [user_id],
    );
    return r.rows;
  }

  async get(user_id, platform) {
    this._ensure();
    const r = await this.pool.query(
      `SELECT * FROM vireo_oauth_tokens WHERE user_id = $1 AND platform = $2`,
      [user_id, platform],
    );
    return r.rows[0] || null;
  }

  async delete(user_id, platform) {
    this._ensure();
    const r = await this.pool.query(
      `DELETE FROM vireo_oauth_tokens WHERE user_id = $1 AND platform = $2`,
      [user_id, platform],
    );
    return r.rowCount > 0;
  }
}

export class PostgresOAuthStatesStore {
  constructor(store) { this.store = store; this.pool = store.pool; }
  _ensure() { this.store._ensure(); }

  async put({ state, user_id, platform, code_verifier = null, ttl_sec = 600 }) {
    this._ensure();
    const expires_at = new Date(Date.now() + ttl_sec * 1000).toISOString();
    await this.pool.query(
      `INSERT INTO vireo_oauth_states (state, user_id, platform, code_verifier, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (state) DO UPDATE SET user_id=$2, platform=$3, code_verifier=$4, expires_at=$5`,
      [state, user_id, platform, code_verifier, expires_at],
    );
    return { state, expires_at };
  }

  async get(state) {
    this._ensure();
    const r = await this.pool.query(
      `SELECT * FROM vireo_oauth_states WHERE state = $1 AND expires_at > now()`,
      [state],
    );
    return r.rows[0] || null;
  }

  async delete(state) {
    this._ensure();
    await this.pool.query("DELETE FROM vireo_oauth_states WHERE state = $1", [state]);
  }
}

/**
 * Accepts either:
 *   - a PostgresStore (with .pool and ._ensure())
 *   - a plain { pool } object (auto-wrap)
 *   - a bare pool (auto-wrap with a stub store)
 */
function bindStore(arg) {
  if (arg && typeof arg.query === "function") return { pool: arg, _ensure: () => {} };
  if (arg && arg.pool && typeof arg._ensure === "function") return arg;
  if (arg && arg.pool) return { pool: arg.pool, _ensure: () => {} };
  throw new Error("PostgresStyleDNAStore: needs {pool} or PostgresStore");
}

export class PostgresStyleDNAStore {
  constructor(arg) { this.store = bindStore(arg); this.pool = this.store.pool; }
  _ensure() { this.store._ensure(); }

  async upsert({ user_id, name = "default", tone = null, pacing = null, vocabulary = [],
                  humor = null, hooks = [], ctas = [], topics = [],
                  confidence = 0, source_corpus_size = 0 }) {
    this._ensure();
    const id = newId();
    const r = await this.pool.query(
      `INSERT INTO vireo_style_dna
       (id, user_id, name, tone, pacing, vocabulary, humor, hooks, ctas, topics, confidence, source_corpus_size, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now(), now())
       ON CONFLICT (user_id, name) DO UPDATE SET
         tone = EXCLUDED.tone, pacing = EXCLUDED.pacing,
         vocabulary = EXCLUDED.vocabulary, humor = EXCLUDED.humor,
         hooks = EXCLUDED.hooks, ctas = EXCLUDED.ctas, topics = EXCLUDED.topics,
         confidence = EXCLUDED.confidence, source_corpus_size = EXCLUDED.source_corpus_size,
         updated_at = now()
       RETURNING id, user_id, name, tone, pacing, vocabulary, humor, hooks, ctas, topics, confidence, source_corpus_size, created_at, updated_at`,
      [id, user_id, name, tone, pacing, JSON.stringify(vocabulary), humor,
       JSON.stringify(hooks), JSON.stringify(ctas), JSON.stringify(topics),
       confidence, source_corpus_size],
    );
    return _rowToDna(r.rows[0]);
  }

  async get(user_id, name = "default") {
    this._ensure();
    const r = await this.pool.query(
      `SELECT id, user_id, name, tone, pacing, vocabulary, humor, hooks, ctas, topics, confidence, source_corpus_size, created_at, updated_at
       FROM vireo_style_dna WHERE user_id = $1 AND name = $2`,
      [user_id, name],
    );
    return r.rows[0] ? _rowToDna(r.rows[0]) : null;
  }

  async listForUser(user_id) {
    this._ensure();
    const r = await this.pool.query(
      `SELECT id, user_id, name, tone, pacing, vocabulary, humor, hooks, ctas, topics, confidence, source_corpus_size, created_at, updated_at
       FROM vireo_style_dna WHERE user_id = $1 ORDER BY updated_at DESC`,
      [user_id],
    );
    return r.rows.map(_rowToDna);
  }

  async delete(user_id, name) {
    this._ensure();
    const r = await this.pool.query(
      "DELETE FROM vireo_style_dna WHERE user_id = $1 AND name = $2",
      [user_id, name],
    );
    return r.rowCount > 0;
  }
}

function _rowToDna(row) {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    tone: row.tone,
    pacing: row.pacing,
    vocabulary: typeof row.vocabulary === "string" ? JSON.parse(row.vocabulary) : (row.vocabulary || []),
    humor: row.humor,
    hooks: typeof row.hooks === "string" ? JSON.parse(row.hooks) : (row.hooks || []),
    ctas: typeof row.ctas === "string" ? JSON.parse(row.ctas) : (row.ctas || []),
    topics: typeof row.topics === "string" ? JSON.parse(row.topics) : (row.topics || []),
    confidence: parseFloat(row.confidence) || 0,
    source_corpus_size: row.source_corpus_size,
    created_at: row.created_at?.toISOString?.() || row.created_at,
    updated_at: row.updated_at?.toISOString?.() || row.updated_at,
  };
}
