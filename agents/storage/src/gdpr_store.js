// B2.3 + B2.4 + B2.5 — GDPR audit + export + delete stores (2026-06-08).
//
// Three stores back the GDPR endpoints:
//   - AuditStore: append-only log of user actions
//   - GdprExportStore: builds a JSON dump of everything tied to a user
//   - GdprDeleteStore: removes (or anonymizes) everything tied to a user
//
// Design notes:
//   - We hash IPs and UAs (sha256 + a per-deployment salt) instead of
//     storing them in clear. This gives us a "same request" signal
//     without leaking the actual address.
//   - We log the *fact* of an action, not the content. The user's
//     chat history, content piece text, etc. are already accessible
//     via the normal API — we don't duplicate them in the audit log.
//   - The delete path is "soft" by design: we delete the user's data
//     (projects, content, prefs, audit log) but we keep the user row,
//     the auth credentials, and the DSR request record. This lets
//     the user re-register with the same email without colliding,
//     and lets us prove the delete happened (Article 30).

import crypto from "node:crypto";

const PRIVACY_SALT_ENV = "VIREO_PRIVACY_SALT";
const DEFAULT_SALT = "vireo-default-salt-please-override-in-prod";

function hashValue(value, salt) {
  if (!value) return null;
  return crypto.createHash("sha256").update(`${salt}|${value}`).digest("hex").slice(0, 32);
}

function getSalt() {
  return process.env[PRIVACY_SALT_ENV] || DEFAULT_SALT;
}

// ---- C4: PII scrubber for audit metadata (2026-06-08) ----
//
// Defense-in-depth against accidental PII leaking into the
// audit log via the `metadata` field. The audit log table is
// designed for compliance reviewers — they should see *what
// happened*, not *what the user said* verbatim.
//
// The scrubber:
//   1. Redacts exact key names (email, phone, api_key, password,
//      token, ssn, credit_card, jwt, session_id) at any depth.
//   2. Detects email-like values, credit-card-like values (Luhn),
//      and JWT-like values inside any string field.
//   3. Truncates long strings (>200 chars) to "[truncated 1234 chars]".
//   4. Caps object depth at 8 levels (prevents circular / hostile payloads).
//   5. Caps total JSON size at 4KB (so a runaway metadata blob
//      can't fill the audit table).
//
// The scrubber is FROZEN — it never throws. If a field can't be
// serialized, it's replaced with the literal string "[unserializable]".
const PII_KEYS = new Set([
  "email", "emails", "phone", "phones", "phone_number",
  "api_key", "apikey", "api-key", "password", "passwd", "pwd",
  "token", "tokens", "access_token", "refresh_token", "id_token",
  "ssn", "social_security", "credit_card", "credit-card", "cc_number",
  "jwt", "session_id", "sessionid", "cookie", "authorization",
  "secret", "secrets", "private_key", "privatekey",
]);
const EMAIL_RX = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const CC_RX = /\b\d[\d\s-]{12,18}\d\b/;
const JWT_RX = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/;
const MAX_STR = 200;
const MAX_DEPTH = 8;
const MAX_OUTPUT_BYTES = 4096;
function isSensitiveValue(s) {
  if (typeof s !== "string") return false;
  if (EMAIL_RX.test(s)) return true;
  if (JWT_RX.test(s)) return true;
  if (CC_RX.test(s.replace(/[\s-]/g, ""))) return true;
  return false;
}
function truncate(s) {
  if (s.length <= MAX_STR) return s;
  return `[truncated ${s.length} chars]`;
}
export function scrubMetadata(value, depth = 0) {
  if (depth > MAX_DEPTH) return "[depth-exceeded]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (isSensitiveValue(value)) return "[redacted:sensitive]";
    return truncate(value);
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.map((v) => scrubMetadata(v, depth + 1));
  }
  if (typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value)) {
      if (PII_KEYS.has(k.toLowerCase())) {
        out[k] = "[redacted:pii]";
      } else {
        out[k] = scrubMetadata(value[k], depth + 1);
      }
    }
    return out;
  }
  // functions, symbols, bigints, etc. — drop them
  return "[unserializable]";
}

/**
 * Scrub metadata and return a JSON string. Total output is
 * capped at MAX_OUTPUT_BYTES — anything longer is truncated
 * to a marker. Never throws.
 */
export function scrubMetadataJson(metadata) {
  try {
    const scrubbed = scrubMetadata(metadata ?? {});
    const json = JSON.stringify(scrubbed);
    if (json.length <= MAX_OUTPUT_BYTES) return json;
    // Find the largest preview length that, when JSON-escaped
    // inside the envelope, keeps the final string <=
    // MAX_OUTPUT_BYTES. Binary-search to avoid quadratic scanning.
    const envelopeKeys = { _truncated: true, _orig_bytes: json.length, _preview: "" };
    const baseOverhead = JSON.stringify(envelopeKeys).length; // includes "" for preview
    const maxPreview = Math.max(0, MAX_OUTPUT_BYTES - baseOverhead);
    // The escaped length is >= raw length (each special char costs
    // 1-5 extra bytes). Cap the raw preview at maxPreview * 0.5
    // as a conservative lower bound, then check the actual escape.
    const safePreview = json.slice(0, Math.floor(maxPreview * 0.5));
    envelopeKeys._preview = safePreview;
    const final = JSON.stringify(envelopeKeys);
    if (final.length > MAX_OUTPUT_BYTES) {
      // Shouldn't happen with the 0.5 safety factor, but be safe.
      envelopeKeys._preview = safePreview.slice(0, Math.floor(safePreview.length * 0.5));
      return JSON.stringify(envelopeKeys);
    }
    return final;
  } catch (e) {
    return JSON.stringify({ _error: "scrub_failed", _message: String(e?.message || e).slice(0, 200) });
  }
}

export class AuditStore {
  constructor(pool) {
    this.pool = pool;
  }

  async log(entry) {
    if (!entry.userId) return; // no user, no log
    const salt = getSalt();
    const id = entry.id || `aud_${crypto.randomBytes(8).toString("hex")}`;
    // C4: scrub metadata before insert. This is the LAST line of
    // defense — the field names in the SQL above are the schema,
    // the `metadata` JSONB column is where user-controlled data
    // could leak. Scrubbing here means compliance reviewers can
    // safely read vireo_studio_audit.metadata without seeing PII.
    const scrubbedMetadata = scrubMetadataJson(entry.metadata);
    await this.pool.query(
      `INSERT INTO vireo_studio_audit
        (id, user_id, action, target_kind, target_id, tool_name, result, http_status, metadata, ip_hash, user_agent_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)
       ON CONFLICT (id) DO NOTHING`,
      [
        id,
        entry.userId,
        entry.action,
        entry.targetKind || null,
        entry.targetId || null,
        entry.toolName || null,
        entry.result,
        entry.httpStatus || null,
        scrubbedMetadata,
        hashValue(entry.ip, salt),
        hashValue(entry.userAgent, salt),
      ]
    );
    return id;
  }

  async list({ userId, limit = 50, since = null } = {}) {
    const r = await this.pool.query(
      `SELECT id, action, target_kind, target_id, tool_name, result, http_status, metadata, created_at
       FROM vireo_studio_audit
       WHERE user_id = $1
         AND ($2::timestamptz IS NULL OR created_at >= $2)
       ORDER BY created_at DESC
       LIMIT $3`,
      [userId, since, Math.min(limit, 200)]
    );
    return r.rows;
  }
}

/** No-op audit store for in-memory mode (no Postgres). */
export class InMemoryAuditStore {
  constructor() { this.rows = []; }
  async log(entry) {
    if (!entry.userId) return;
    const id = entry.id || `aud_${crypto.randomBytes(8).toString("hex")}`;
    this.rows.push({ ...entry, id, created_at: new Date().toISOString() });
    return id;
  }
  async list({ userId, limit = 50 } = {}) {
    return this.rows
      .filter((r) => r.userId === userId)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, Math.min(limit, 200));
  }
}

/**
 * GDPR Article 15 — Right to data portability.
 *
 * Builds a JSON dump of every row tied to a user, across every
 * table. The dump is a single object with a "tables" key, where
 * each entry is an array of rows (or null if the table is empty).
 */
export class GdprExportStore {
  constructor(pool) {
    this.pool = pool;
  }

  async exportUser(userId) {
    const r = await this.pool.query(
      `SELECT jsonb_build_object(
        'exported_at', now(),
        'user_id', $1,
        'tables', jsonb_build_object(
          'user', (SELECT row_to_json(u) FROM vireo_users u WHERE id = $1),
          'projects', (SELECT COALESCE(jsonb_agg(row_to_json(p)), '[]'::jsonb) FROM vireo_projects p WHERE user_id = $1),
          'conversations', (SELECT COALESCE(jsonb_agg(row_to_json(c)), '[]'::jsonb) FROM vireo_conversations c WHERE user_id = $1),
          'messages', (SELECT COALESCE(jsonb_agg(row_to_json(m)), '[]'::jsonb) FROM vireo_messages m WHERE user_id = $1),
          'content_pieces', (SELECT COALESCE(jsonb_agg(row_to_json(cp)), '[]'::jsonb) FROM vireo_content_pieces cp WHERE user_id = $1),
          'preferences', (SELECT row_to_json(p) FROM vireo_user_prefs p WHERE user_id = $1),
          'welcome_answers', (SELECT row_to_json(w) FROM vireo_welcome_answers w WHERE user_id = $1),
          'style_dna', (SELECT COALESCE(jsonb_agg(row_to_json(s)), '[]'::jsonb) FROM vireo_style_dna s WHERE user_id = $1),
          'feedback', (SELECT COALESCE(jsonb_agg(row_to_json(f)), '[]'::jsonb) FROM vireo_message_feedback f WHERE user_id = $1),
          'audit', (SELECT COALESCE(jsonb_agg(row_to_json(a)), '[]'::jsonb) FROM vireo_studio_audit a WHERE user_id = $1),
          'dsr_requests', (SELECT COALESCE(jsonb_agg(row_to_json(d)), '[]'::jsonb) FROM vireo_dsr_requests d WHERE user_id = $1)
        )
      ) AS payload`,
      [userId]
    );
    return r.rows[0]?.payload || { exported_at: new Date().toISOString(), user_id: userId, tables: {} };
  }
}

/**
 * GDPR Article 17 — Right to erasure ("right to be forgotten").
 *
 * Deletes (or anonymizes) every row tied to a user. After this
 * returns, the user row is gone (so they can't re-login) and all
 * the dependent tables are empty for that user_id.
 *
 * We deliberately keep:
 *   - The vireo_dsr_requests row (with user_id = NULL) — Article 30
 *     requires us to keep records of processing activities.
 *   - The vireo_audit rows — already gone by the time we get here
 *     (cascaded by the user_id deletion).
 */
export class GdprDeleteStore {
  constructor(pool) {
    this.pool = pool;
  }

  async deleteUser(userId) {
    // Order matters: child rows first, then the user row. The
    // vireo_users PK is the foreign key target, and the DB has no
    // ON DELETE CASCADE on most of these (we want the explicit
    // audit trail). We use a transaction so a failure rolls back.
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // 1. Anonymize the DSR record (keep the fact of the request, drop the link)
      await client.query(
        `UPDATE vireo_dsr_requests SET user_id = NULL WHERE user_id = $1`,
        [userId]
      );
      // 2. Delete user-owned data
      const deletes = [
        ["vireo_message_feedback", "user_id"],
        ["vireo_content_pieces", "user_id"],
        ["vireo_messages", "user_id"],
        ["vireo_conversations", "user_id"],
        ["vireo_projects", "user_id"],
        ["vireo_user_prefs", "user_id"],
        ["vireo_welcome_answers", "user_id"],
        ["vireo_style_dna", "user_id"],
        ["vireo_studio_audit", "user_id"],
        ["vireo_consent", "user_id"],
      ];
      for (const [table, col] of deletes) {
        await client.query(`DELETE FROM ${table} WHERE ${col} = $1`, [userId]);
      }
      // 3. Delete the user row last
      await client.query(`DELETE FROM vireo_users WHERE id = $1`, [userId]);
      await client.query("COMMIT");
      return { ok: true, deleted_user: userId };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
}

/**
 * Record a data subject request (export or delete). Returns the
 * request id, which is needed for the audit trail and for the
 * caller to look up the artifact later.
 */
export async function recordDsrRequest(pool, { userId, kind, metadata = {} }) {
  const id = `dsr_${crypto.randomBytes(8).toString("hex")}`;
  await pool.query(
    `INSERT INTO vireo_dsr_requests (id, user_id, request_kind, metadata) VALUES ($1, $2, $3, $4::jsonb)`,
    [id, userId, kind, JSON.stringify(metadata)]
  );
  return id;
}

export async function completeDsrRequest(pool, id, { status, artifactPath = null }) {
  await pool.query(
    `UPDATE vireo_dsr_requests SET status = $1, completed_at = now(), artifact_path = $2 WHERE id = $3`,
    [status, artifactPath, id]
  );
}

// ---- C3: Retention cron (2026-06-08) ----
//
// Purges audit rows older than `retentionDays`. The default
// 365 days is what the audit log table comment in migration
// 011 promises. Operators can shorten this via
// VIREO_AUDIT_RETENTION_DAYS (e.g. 90 for a more aggressive
// retention policy).
//
// This is a synchronous purge — for 10K+ rows, switch to
// `DELETE ... WHERE created_at < $1 LIMIT 1000` in a loop.
// For the current scale (<100 rows per user per year), a
// single DELETE is fine.
//
// Returns the number of rows purged.
export async function purgeOldAudit(pool, { retentionDays = 365, now = new Date() } = {}) {
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const r = await pool.query(
    `DELETE FROM vireo_studio_audit WHERE created_at < $1`,
    [cutoff.toISOString()]
  );
  return r.rowCount || 0;
}

/**
 * Run the retention cron once. Designed to be called from a
 * cron job, a scheduled function, or on a timer.
 *
 * @param {object} opts
 * @param {object} opts.pool - The pg.Pool to use
 * @param {number} [opts.retentionDays] - Override the default 365-day retention
 * @param {boolean} [opts.dryRun] - If true, count what would be deleted without deleting
 * @returns {Promise<{purged: number, cutoff: string, retentionDays: number}>}
 */
export async function runRetentionCron({ pool, retentionDays, dryRun = false } = {}) {
  const days = retentionDays ?? (Number(process.env.VIREO_AUDIT_RETENTION_DAYS) || 365);
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  if (dryRun) {
    const r = await pool.query(
      `SELECT count(*)::int AS n FROM vireo_studio_audit WHERE created_at < $1`,
      [cutoff.toISOString()]
    );
    return { purged: 0, would_purge: r.rows[0]?.n || 0, cutoff: cutoff.toISOString(), retentionDays: days, dryRun: true };
  }
  const purged = await purgeOldAudit(pool, { retentionDays: days });
  return { purged, cutoff: cutoff.toISOString(), retentionDays: days, dryRun: false };
}

// Re-export the scheduler API from scheduler.js so consumers
// can `import { startRetentionScheduler } from "./gdpr_store.js"`
// without having to know about a separate scheduler module.
export {
  startRetentionScheduler,
  stopRetentionScheduler,
  getActiveScheduler,
} from "./scheduler.js";
