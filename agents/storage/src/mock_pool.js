// Mock pg.Pool for testing. Simulates enough of pg's behavior to drive
// PostgresStore without a real database.
//
// B2.3-B2.5 (2026-06-08): extended with vireo_studio_audit,
// vireo_consent, vireo_dsr_requests, vireo_users, vireo_projects,
// vireo_conversations, vireo_messages, vireo_content_pieces,
// vireo_user_prefs, vireo_welcome_answers, vireo_style_dna,
// vireo_message_feedback tables. The DDL is no-op, but INSERT /
// SELECT / UPDATE / DELETE for these tables round-trips data
// through in-memory arrays. This lets the GDPR tests assert that
// `exportUser` returns the rows they inserted, and that
// `deleteUser` actually removes them.

export class MockPool {
  constructor() {
    this.tables = {
      vireo_jobs: [],
      vireo_audit: [],
      vireo_metrics: [],
      // GDPR / audit (B2.3-B2.5)
      vireo_studio_audit: [],
      vireo_consent: [],
      vireo_dsr_requests: [],
      // Export-side tables (subset of the full schema — just what
      // GdprExportStore / GdprDeleteStore touch)
      vireo_users: [],
      vireo_projects: [],
      vireo_conversations: [],
      vireo_messages: [],
      vireo_content_pieces: [],
      vireo_user_prefs: [],
      vireo_welcome_answers: [],
      vireo_style_dna: [],
      vireo_message_feedback: [],
    };
    this.queries = [];
    this.shouldFailNext = null;
    this.endCalled = false;
  }

  async query(sql, params = []) {
    this.queries.push({ sql: sql.trim().split(/\s+/).slice(0, 3).join(" "), params });
    if (this.shouldFailNext) {
      const err = this.shouldFailNext;
      this.shouldFailNext = null;
      throw err;
    }
    const s = sql.trim().toLowerCase();

    // DDL: CREATE TABLE / CREATE INDEX — no-op
    if (s.startsWith("create") || s.startsWith("select 1")) {
      return { rows: [], rowCount: 0 };
    }

    if (s.startsWith("insert into vireo_jobs")) {
      const row = jobFromParams(params);
      this.tables.vireo_jobs.push(row);
      return { rows: [row], rowCount: 1 };
    }

    if (s.startsWith("insert into vireo_audit")) {
      const row = auditFromParams(params);
      this.tables.vireo_audit.push(row);
      return { rows: [row], rowCount: 1 };
    }

    if (s.startsWith("insert into vireo_metrics")) {
      const row = metricFromParams(params);
      this.tables.vireo_metrics.push(row);
      return { rows: [row], rowCount: 1 };
    }

    if (s.startsWith("select * from vireo_jobs where id")) {
      const row = this.tables.vireo_jobs.find((r) => r.id === params[0]) || null;
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }

    if (s.startsWith("update vireo_jobs set")) {
      const id = params[0];
      const idx = this.tables.vireo_jobs.findIndex((r) => r.id === id);
      if (idx === -1) return { rows: [], rowCount: 0 };
      const updated = jobFromUpdateParams(id, params);
      this.tables.vireo_jobs[idx] = updated;
      return { rows: [updated], rowCount: 1 };
    }

    if (s.startsWith("select") && s.includes("from vireo_jobs")) {
      let rows = [...this.tables.vireo_jobs];
      // Filter parsing — simple
      if (params.length) {
        const conds = sql.match(/platform = \$|status = \$|content_id = \$/g) || [];
        for (let i = 0; i < conds.length; i++) {
          const field = conds[i].split(" ")[0];
          const v = params[i];
          rows = rows.filter((r) => String(r[field]) === String(v));
        }
      }
      rows.sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
      return { rows, rowCount: rows.length };
    }

    if (s.startsWith("select") && s.includes("from vireo_audit")) {
      let rows = [...this.tables.vireo_audit];
      if (params.length) {
        const conds = sql.match(/platform = \$|content_id = \$/g) || [];
        for (let i = 0; i < conds.length; i++) {
          const field = conds[i].split(" ")[0];
          const v = params[i];
          rows = rows.filter((r) => String(r[field]) === String(v));
        }
      }
      rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      return { rows, rowCount: rows.length };
    }

    if (s.startsWith("select") && s.includes("from vireo_metrics")) {
      let rows = [...this.tables.vireo_metrics];
      if (params.length) {
        const conds = sql.match(/platform = \$|content_id = \$/g) || [];
        for (let i = 0; i < conds.length; i++) {
          const field = conds[i].split(" ")[0];
          const v = params[i];
          rows = rows.filter((r) => String(r[field]) === String(v));
        }
      }
      rows.sort((a, b) => new Date(b.captured_at) - new Date(a.captured_at));
      return { rows, rowCount: rows.length };
    }

    // ---- vireo_studio_audit ----
    // V8 has a long-standing case-sensitivity bug: `/limit/.test("LIMIT ...")`
    // can return false depending on optimizer state. The fix is
    // to always use the `i` flag and lowercase the SQL before
    // matching. The /i flag is mandatory across all dispatch below.
    if (s.startsWith("insert into vireo_studio_audit")) {
      const row = auditRowFromParams(params);
      // ON CONFLICT (id) DO NOTHING — skip if id already exists
      if (this.tables.vireo_studio_audit.some((r) => r.id === row.id)) {
        return { rows: [], rowCount: 0 };
      }
      this.tables.vireo_studio_audit.push(row);
      return { rows: [row], rowCount: 1 };
    }
    if (s.startsWith("select") && s.includes("from vireo_studio_audit") && !s.includes("jsonb_build_object") && !s.startsWith("select count")) {
      // list for the AuditStore.list() / GET /api/me/audit
      let rows = [...this.tables.vireo_studio_audit];
      // V8 regex workaround: use /i flag + lowercase the haystack
      const userMatch = sql.match(/user_id = \$(\d+)/i);
      if (userMatch) {
        const pIdx = Number(userMatch[1]) - 1;
        rows = rows.filter((r) => r.user_id === params[pIdx]);
      }
      const sinceMatch = sql.match(/created_at >= \$(\d+)/i);
      if (sinceMatch) {
        const pIdx = Number(sinceMatch[1]) - 1;
        const since = new Date(params[pIdx]);
        rows = rows.filter((r) => new Date(r.created_at) >= since);
      }
      const limitMatch = sql.match(/limit \$(\d+)/i);
      if (limitMatch) {
        const pIdx = Number(limitMatch[1]) - 1;
        rows = rows.slice(0, Number(params[pIdx]));
      }
      // The store expects column ordering: id, action, target_kind,
      // target_id, tool_name, result, http_status, metadata, created_at
      rows = rows
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .map((r) => ({
          id: r.id, action: r.action, target_kind: r.target_kind,
          target_id: r.target_id, tool_name: r.tool_name, result: r.result,
          http_status: r.http_status, metadata: r.metadata,
          created_at: r.created_at,
        }));
      return { rows, rowCount: rows.length };
    }

    // ---- vireo_consent ----
    if (s.startsWith("insert into vireo_consent")) {
      const row = consentRowFromParams(params);
      const existing = this.tables.vireo_consent.findIndex((r) => r.user_id === row.user_id);
      if (existing >= 0) {
        this.tables.vireo_consent[existing] = { ...this.tables.vireo_consent[existing], ...row };
      } else {
        this.tables.vireo_consent.push(row);
      }
      return { rows: [row], rowCount: 1 };
    }
    if (s.startsWith("select") && s.includes("from vireo_consent")) {
      const userMatch = sql.match(/user_id = \$(\d+)/);
      if (userMatch) {
        const pIdx = Number(userMatch[1]) - 1;
        const rows = this.tables.vireo_consent.filter((r) => r.user_id === params[pIdx]);
        return { rows, rowCount: rows.length };
      }
      return { rows: [...this.tables.vireo_consent], rowCount: this.tables.vireo_consent.length };
    }

    // ---- vireo_dsr_requests ----
    if (s.startsWith("insert into vireo_dsr_requests")) {
      const row = dsrRowFromParams(params);
      this.tables.vireo_dsr_requests.push(row);
      return { rows: [row], rowCount: 1 };
    }
    if (s.startsWith("update vireo_dsr_requests set status")) {
      const status = params[0];
      const artifact = params[1];
      const id = params[2];
      const row = this.tables.vireo_dsr_requests.find((r) => r.id === id);
      if (row) {
        row.status = status;
        row.completed_at = new Date().toISOString();
        row.artifact_path = artifact;
        return { rows: [row], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    if (s.startsWith("update vireo_dsr_requests set user_id = null")) {
      // GDPR delete step 1: anonymize the DSR record's user_id
      const userId = params[0];
      for (const r of this.tables.vireo_dsr_requests) {
        if (r.user_id === userId) r.user_id = null;
      }
      return { rows: [], rowCount: 0 };
    }

    // ---- C3: Retention cron (purgeOldAudit) ----
    // Pattern: "delete from vireo_studio_audit where created_at < $1"
    // The cutoff is a timestamptz passed as ISO string.
    if (s.startsWith("delete from vireo_studio_audit where created_at")) {
      const cutoff = new Date(params[0]);
      const before = this.tables.vireo_studio_audit.length;
      this.tables.vireo_studio_audit = this.tables.vireo_studio_audit.filter(
        (r) => new Date(r.created_at) >= cutoff
      );
      return { rows: [], rowCount: before - this.tables.vireo_studio_audit.length };
    }
    // Dry-run: "select count(*) ... where created_at < $1"
    if (s.startsWith("select count(*)") && s.includes("from vireo_studio_audit") && s.includes("created_at <")) {
      const cutoff = new Date(params[0]);
      const n = this.tables.vireo_studio_audit.filter(
        (r) => new Date(r.created_at) < cutoff
      ).length;
      return { rows: [{ n }], rowCount: 1 };
    }

    // ---- generic table-by-name DML (for delete cascade) ----
    // Pattern: "delete from <table> where <col> = $1"  (with or
    // without trailing transaction-control keywords)
    const deleteMatch = s.match(/^delete from (\w+) where (\w+) = \$/);
    if (deleteMatch) {
      const [, table, col] = deleteMatch;
      if (this.tables[table]) {
        const before = this.tables[table].length;
        this.tables[table] = this.tables[table].filter((r) => String(r[col]) !== String(params[0]));
        return { rows: [], rowCount: before - this.tables[table].length };
      }
    }

    // ---- simple INSERT for the export-side tables (for test seeding) ----
    // Pattern: "insert into <table> (...) values ($1, $2, ...)"
    // The user_id is always $2, so we can filter exports by it.
    // For vireo_users we use the named-column inserter (the GDPR
    // export expects a `row_to_json`-shaped row with the real
    // column names: id, email, name, etc.).
    if (s.startsWith("insert into vireo_users")) {
      const row = userRowFromParams(params);
      this.tables.vireo_users.push(row);
      return { rows: [row], rowCount: 1 };
    }
    const insertMatch = s.match(/^insert into (\w+)/);
    if (insertMatch && this.tables[insertMatch[1]]) {
      const table = insertMatch[1];
      const row = simpleRowFromParams(params);
      this.tables[table].push(row);
      return { rows: [row], rowCount: 1 };
    }

    // ---- GdprExportStore.exportUser — the giant jsonb_build_object query ----
    // We can't run real SQL, so we synthesize the payload from the
    // in-memory tables filtered by user_id. vireo_users is keyed
    // by `id` (not `user_id`), so we use `single()` semantics
    // there: find the one row whose id matches the user.
    if (s.includes("jsonb_build_object") && s.includes("exported_at")) {
      const userId = params[0];
      const filter = (rows) => rows.filter((r) => r.user_id === userId);
      const single = (rows) => rows.find((r) => r.user_id === userId) || null;
      const payload = {
        exported_at: new Date().toISOString(),
        user_id: userId,
        tables: {
          user: this.tables.vireo_users.find((r) => r.id === userId) || null,
          projects: filter(this.tables.vireo_projects),
          conversations: filter(this.tables.vireo_conversations),
          messages: filter(this.tables.vireo_messages),
          content_pieces: filter(this.tables.vireo_content_pieces),
          preferences: single(this.tables.vireo_user_prefs),
          welcome_answers: single(this.tables.vireo_welcome_answers),
          style_dna: filter(this.tables.vireo_style_dna),
          feedback: filter(this.tables.vireo_message_feedback),
          audit: filter(this.tables.vireo_studio_audit),
          dsr_requests: filter(this.tables.vireo_dsr_requests),
        },
      };
      return { rows: [{ payload }], rowCount: 1 };
    }

    // Unknown query
    return { rows: [], rowCount: 0 };
  }

  async end() {
    this.endCalled = true;
  }

  // ---- BEGIN / COMMIT / ROLLBACK stub (for GdprDeleteStore transaction) ----
  // MockPool doesn't actually need transactional isolation — every
  // operation is synchronous against the in-memory arrays. We just
  // need to make the call sites happy.
  async connect() {
    return {
      query: async (sql, params) => this.query(sql, params),
      release: () => {},
    };
  }
}

function jobFromParams(params) {
  return {
    id: params[0],
    content_id: params[1],
    platform: params[2],
    scheduled_at: params[3],
    status: params[4] || "pending",
    metadata: typeof params[5] === "string" ? JSON.parse(params[5]) : (params[5] || {}),
    created_at: params[6],
    updated_at: params[6],
    published_at: null,
    platform_post_id: null,
    error: null,
  };
}

function jobFromUpdateParams(id, params) {
  return {
    id,
    content_id: params[1],
    platform: params[2],
    scheduled_at: params[3],
    published_at: params[4],
    status: params[5],
    platform_post_id: params[6],
    error: params[7],
    metadata: typeof params[8] === "string" ? JSON.parse(params[8]) : (params[8] || {}),
    created_at: new Date().toISOString(),
    updated_at: params[9],
  };
}

function auditFromParams(params) {
  return {
    id: params[0],
    job_id: params[1],
    content_id: params[2],
    platform: params[3],
    platform_post_id: params[4],
    published_at: params[5],
    ai_generated: params[6],
    eu_ai_act_logged: params[7],
    created_at: params[8],
  };
}

function metricFromParams(params) {
  return {
    id: params[0],
    content_id: params[1],
    platform: params[2],
    views: params[3],
    likes: params[4],
    comments: params[5],
    shares: params[6],
    saves: params[7],
    watch_time_sec: params[8],
    engagement_rate: params[9],
    captured_at: params[10],
    created_at: params[11],
  };
}

// ---- vireo_studio_audit ----
// INSERT cols: id, user_id, action, target_kind, target_id, tool_name,
//              result, http_status, metadata::jsonb, ip_hash, user_agent_hash
function auditRowFromParams(params) {
  return {
    id: params[0],
    user_id: params[1],
    action: params[2],
    target_kind: params[3],
    target_id: params[4],
    tool_name: params[5],
    result: params[6],
    http_status: params[7],
    metadata: typeof params[8] === "string" ? JSON.parse(params[8]) : (params[8] || {}),
    ip_hash: params[9],
    user_agent_hash: params[10],
    created_at: new Date().toISOString(),
  };
}

// ---- vireo_consent ----
// ON CONFLICT (user_id) DO UPDATE — we need to upsert in MockPool
function consentRowFromParams(params) {
  return {
    user_id: params[0],
    consent_kind: params[1],
    granted: params[2],
    revoked_at: params[3],
    ip_hash: params[4],
    user_agent_hash: params[4], // sql passes the same hash for both
    policy_version: params[5],
    granted_at: new Date().toISOString(),
  };
}

// ---- vireo_dsr_requests ----
function dsrRowFromParams(params) {
  return {
    id: params[0],
    user_id: params[1],
    request_kind: params[2],
    status: "pending",
    requested_at: new Date().toISOString(),
    completed_at: null,
    artifact_path: null,
    metadata: typeof params[3] === "string" ? JSON.parse(params[3]) : (params[3] || {}),
  };
}

// ---- vireo_users (export-only) ----
function userRowFromParams(params) {
  return {
    id: params[0],
    email: params[1],
    password_hash: params[2],
    name: params[3],
    plan: params[4] || "free",
    created_at: params[5] || new Date().toISOString(),
    updated_at: params[6] || new Date().toISOString(),
  };
}

// ---- generic simple table (for projects / content / etc.) ----
// Inserts a row with positional parameters. Columns are
// `id, user_id, ...extras`. For the GDPR tests we only care
// about round-tripping the user_id and a few extra fields, so
// this is good enough.
function simpleRowFromParams(params) {
  const row = { id: params[0], user_id: params[1] };
  for (let i = 2; i < params.length; i++) {
    row[`col_${i - 2}`] = params[i];
  }
  return row;
}
