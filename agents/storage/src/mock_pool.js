// Mock pg.Pool for testing. Simulates enough of pg's behavior to drive
// PostgresStore without a real database.

export class MockPool {
  constructor() {
    this.tables = {
      vireo_jobs: [],
      vireo_audit: [],
      vireo_metrics: [],
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

    // Unknown query
    return { rows: [], rowCount: 0 };
  }

  async end() {
    this.endCalled = true;
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
