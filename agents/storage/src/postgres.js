// Postgres-backed Store. Uses the `pg` library.
//
// Schema (auto-created on init via migrations):
//   vireo_jobs, vireo_audit, vireo_metrics — content publishing
//   vireo_users — auth
//   vireo_subscriptions, vireo_usage, vireo_invoices — billing
//   vireo_oauth_tokens, vireo_oauth_states — OAuth
//   vireo_style_dna — style learning persistence
//
// All ops are async. We use a connection pool.

import { newId, nowIso } from "@vireo/shared";
import { applyMigrations } from "./migrations.js";

export class PostgresUnavailableError extends Error {
  constructor(reason) {
    super(`Postgres unavailable: ${reason}`);
    this.name = "PostgresUnavailableError";
  }
}

const SCHEMA = `SELECT 1`;  // Migrations are now in migrations.js

export class PostgresStore {
  constructor({ url, mockPool } = {}) {
    this.name = "postgres";
    this.url = url;
    this.mockPool = mockPool || null;
    this.pool = null;
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return this;
    if (this.mockPool) {
      this.pool = this.mockPool;
    } else if (this.url) {
      // Lazy import — `pg` is optional in dev
      let pg;
      try { pg = await import("pg"); } catch (e) {
        throw new PostgresUnavailableError("pg package not installed; npm install pg");
      }
      this.pool = new pg.Pool({ connectionString: this.url, max: 10 });
      // Smoke test the connection
      try {
        await this.pool.query("SELECT 1");
      } catch (e) {
        throw new PostgresUnavailableError(`Cannot connect: ${e.message}`);
      }
    } else {
      throw new PostgresUnavailableError("VIREO_PG_URL not set");
    }
    // Apply migrations (idempotent — tracked in vireo_migrations table)
    await applyMigrations(this.pool);
    this.initialized = true;
    return this;
  }

  async close() {
    if (this.pool && this.pool.end && !this.mockPool) {
      await this.pool.end();
    }
    this.initialized = false;
  }

  _ensure() {
    if (!this.initialized) throw new Error("PostgresStore.init() must be called first");
  }

  // ---- jobs ----

  async addJob(job) {
    this._ensure();
    const j = { id: job.id || newId(), created_at: nowIso(), ...job };
    await this.pool.query(
      `INSERT INTO vireo_jobs (id, content_id, platform, scheduled_at, status, metadata, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
      [j.id, j.content_id, j.platform, j.scheduled_at, j.status || "pending", JSON.stringify(j.metadata || {}), j.created_at],
    );
    return j;
  }

  async listJobs(filter = {}) {
    this._ensure();
    const conds = [];
    const args = [];
    if (filter.platform) { args.push(filter.platform); conds.push(`platform = $${args.length}`); }
    if (filter.status) { args.push(filter.status); conds.push(`status = $${args.length}`); }
    if (filter.content_id) { args.push(filter.content_id); conds.push(`content_id = $${args.length}`); }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const r = await this.pool.query(
      `SELECT id, content_id, platform, scheduled_at, published_at, status,
              platform_post_id, error, metadata, created_at, updated_at
       FROM vireo_jobs ${where} ORDER BY scheduled_at ASC`,
      args,
    );
    return r.rows.map(rowToJob);
  }

  async getJob(id) {
    this._ensure();
    const r = await this.pool.query("SELECT * FROM vireo_jobs WHERE id = $1", [id]);
    return r.rows[0] ? rowToJob(r.rows[0]) : null;
  }

  async updateJob(id, patch) {
    this._ensure();
    const j = await this.getJob(id);
    if (!j) return null;
    const merged = { ...j, ...patch, updated_at: nowIso() };
    await this.pool.query(
      `UPDATE vireo_jobs SET content_id=$2, platform=$3, scheduled_at=$4, published_at=$5,
              status=$6, platform_post_id=$7, error=$8, metadata=$9, updated_at=$10
       WHERE id = $1`,
      [id, merged.content_id, merged.platform, merged.scheduled_at, merged.published_at,
       merged.status, merged.platform_post_id, merged.error,
       JSON.stringify(merged.metadata || {}), merged.updated_at],
    );
    return merged;
  }

  // ---- audit ----

  async addAudit(entry) {
    this._ensure();
    const e = { id: entry.id || newId(), created_at: nowIso(), ...entry };
    await this.pool.query(
      `INSERT INTO vireo_audit (id, job_id, content_id, platform, platform_post_id,
                                published_at, ai_generated, eu_ai_act_logged, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [e.id, e.job_id, e.content_id, e.platform, e.platform_post_id,
       e.published_at, e.ai_generated !== false, e.eu_ai_act_logged !== false, e.created_at],
    );
    return e;
  }

  async listAudit(filter = {}) {
    this._ensure();
    const conds = [];
    const args = [];
    if (filter.platform) { args.push(filter.platform); conds.push(`platform = $${args.length}`); }
    if (filter.content_id) { args.push(filter.content_id); conds.push(`content_id = $${args.length}`); }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const r = await this.pool.query(`SELECT * FROM vireo_audit ${where} ORDER BY created_at DESC`, args);
    return r.rows;
  }

  // ---- metrics ----

  async addMetric(snap) {
    this._ensure();
    const s = { id: snap.id || newId(), created_at: nowIso(), ...snap };
    await this.pool.query(
      `INSERT INTO vireo_metrics (id, content_id, platform, views, likes, comments,
                                   shares, saves, watch_time_sec, engagement_rate, captured_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [s.id, s.content_id, s.platform, s.views || 0, s.likes || 0, s.comments || 0,
       s.shares || 0, s.saves || 0, s.watch_time_sec || 0, s.engagement_rate || 0,
       s.captured_at || nowIso(), s.created_at],
    );
    return s;
  }

  async listMetrics(filter = {}) {
    this._ensure();
    const conds = [];
    const args = [];
    if (filter.platform) { args.push(filter.platform); conds.push(`platform = $${args.length}`); }
    if (filter.content_id) { args.push(filter.content_id); conds.push(`content_id = $${args.length}`); }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const r = await this.pool.query(`SELECT * FROM vireo_metrics ${where} ORDER BY captured_at DESC`, args);
    return r.rows;
  }
}

function rowToJob(row) {
  return {
    id: row.id,
    content_id: row.content_id,
    platform: row.platform,
    scheduled_at: row.scheduled_at?.toISOString?.() || row.scheduled_at,
    published_at: row.published_at?.toISOString?.() || row.published_at || "",
    status: row.status,
    platform_post_id: row.platform_post_id || "",
    error: row.error || "",
    metadata: row.metadata || {},
    created_at: row.created_at?.toISOString?.() || row.created_at,
    updated_at: row.updated_at?.toISOString?.() || row.updated_at,
  };
}
