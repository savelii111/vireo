// jobs.js — SQLite persistence for production jobs (2026-06-09).
//
// Replaces the in-memory Map in production_tools.js with a real
// SQLite-backed job store. Survives server restarts, queryable,
// transactional.
//
// Why SQLite (not PG):
//   - Zero infrastructure (single .db file)
//   - WAL mode for concurrent reads
//   - better-sqlite3 is sync and fast (no connection pool needed)
//   - Production-ready up to ~100K jobs (we'll switch to PG at scale)
//
// Schema:
//   jobs (id, type, status, args JSON, result JSON, progress, position,
//         user_id, parent_job_id, error, created_at, started_at,
//         completed_at, priority, attempt, max_attempts, last_error)
//
//   job_events (job_id, type, message, payload JSON, ts) — for audit log
//
// Lifecycle:
//   queued → running → done | failed | cancelled
//
// Retry: jobs with status=failed and attempt<max_attempts can be retried
// via retryJob(). Exponential backoff via backoff_ms column.

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_DB_PATH = process.env.VIREO_JOBS_DB
  || join(__dirname, '..', '..', 'vireo-jobs.db');

let _db = null;

function _getDb() {
  if (_db) return _db;
  const dir = dirname(DEFAULT_DB_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  _db = new Database(DEFAULT_DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _db.pragma('synchronous = NORMAL');
  _db.pragma('temp_store = MEMORY');
  _db.pragma('mmap_size = 30000000');
  _migrate(_db);
  return _db;
}

function _migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      args TEXT,
      result TEXT,
      progress REAL NOT NULL DEFAULT 0,
      position INTEGER,
      user_id TEXT,
      parent_job_id TEXT,
      error TEXT,
      last_error TEXT,
      priority INTEGER NOT NULL DEFAULT 5,
      attempt INTEGER NOT NULL DEFAULT 1,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      backoff_ms INTEGER NOT NULL DEFAULT 0,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER,
      next_run_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs(type);
    CREATE INDEX IF NOT EXISTS idx_jobs_user_id ON jobs(user_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);
    CREATE INDEX IF NOT EXISTS idx_jobs_next_run_at ON jobs(next_run_at)
      WHERE next_run_at IS NOT NULL;

    CREATE TABLE IF NOT EXISTS job_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      type TEXT NOT NULL,
      message TEXT,
      payload TEXT,
      ts INTEGER NOT NULL,
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_job_events_job_id ON job_events(job_id);
    CREATE INDEX IF NOT EXISTS idx_job_events_ts ON job_events(ts);
  `);
}

// ====================================================================
// Public API
// ====================================================================

export function createJob({
  type,
  args = null,
  user_id = null,
  parent_job_id = null,
  priority = 5,
  max_attempts = 3,
  metadata = null,
  id = null,
  created_at = Date.now(),
}) {
  const db = _getDb();
  const jobId = id ?? `${type}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  // Compute position: count of queued jobs of same type with priority<=this
  const position = db.prepare(`
    SELECT COUNT(*) AS n FROM jobs
    WHERE type = ? AND status = 'queued' AND priority <= ?
  `).get(type, priority).n + 1;

  db.prepare(`
    INSERT INTO jobs
      (id, type, status, args, progress, position, user_id,
       parent_job_id, priority, attempt, max_attempts, metadata, created_at)
    VALUES (?, ?, 'queued', ?, 0, ?, ?, ?, ?, 1, ?, ?, ?)
  `).run(
    jobId, type,
    args ? JSON.stringify(args) : null,
    position, user_id, parent_job_id,
    priority, max_attempts,
    metadata ? JSON.stringify(metadata) : null,
    created_at,
  );

  _recordEvent(jobId, 'created', `Job ${type} created`, { args });
  return getJob(jobId);
}

export function getJob(id) {
  if (!id) return null;
  const db = _getDb();
  const row = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(id);
  if (!row) return null;
  return _rowToJob(row);
}

export function listJobs({ type = null, status = null, user_id = null, limit = 50, offset = 0 } = {}) {
  const db = _getDb();
  const where = [];
  const params = [];
  if (type) { where.push('type = ?'); params.push(type); }
  if (status) { where.push('status = ?'); params.push(status); }
  if (user_id) { where.push('user_id = ?'); params.push(user_id); }
  const whereSql = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';
  const rows = db.prepare(`
    SELECT * FROM jobs ${whereSql}
    ORDER BY priority ASC, created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
  return rows.map(_rowToJob);
}

export function countJobs({ type = null, status = null, user_id = null } = {}) {
  const db = _getDb();
  const where = [];
  const params = [];
  if (type) { where.push('type = ?'); params.push(type); }
  if (status) { where.push('status = ?'); params.push(status); }
  if (user_id) { where.push('user_id = ?'); params.push(user_id); }
  const whereSql = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';
  return db.prepare(`SELECT COUNT(*) AS n FROM jobs ${whereSql}`).get(...params).n;
}

export function updateJob(id, patch) {
  if (!id) return null;
  const db = _getDb();
  const current = getJob(id);
  if (!current) return null;
  const updates = [];
  const values = [];
  const allowedFields = [
    'status', 'progress', 'position', 'error', 'last_error',
    'attempt', 'backoff_ms', 'started_at', 'completed_at', 'next_run_at',
  ];
  for (const f of allowedFields) {
    if (f in patch) {
      updates.push(`${f} = ?`);
      values.push(patch[f]);
    }
  }
  if ('result' in patch) {
    updates.push('result = ?');
    values.push(patch.result ? JSON.stringify(patch.result) : null);
  }
  if ('args' in patch) {
    updates.push('args = ?');
    values.push(patch.args ? JSON.stringify(patch.args) : null);
  }
  if ('metadata' in patch) {
    updates.push('metadata = ?');
    values.push(patch.metadata ? JSON.stringify(patch.metadata) : null);
  }
  if (updates.length === 0) return current;
  values.push(id);
  db.prepare(`UPDATE jobs SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  return getJob(id);
}

export function startJob(id) {
  return updateJob(id, { status: 'running', started_at: Date.now() });
}

export function completeJob(id, result = null) {
  return updateJob(id, {
    status: 'done',
    result,
    progress: 1,
    completed_at: Date.now(),
  });
}

export function failJob(id, error, { retry = true } = {}) {
  const current = getJob(id);
  if (!current) return null;
  if (retry && current.attempt < current.max_attempts) {
    // Schedule retry with exponential backoff (1s, 4s, 16s, ...)
    const backoff = Math.pow(4, current.attempt) * 1000;
    return updateJob(id, {
      status: 'queued',
      attempt: current.attempt + 1,
      backoff_ms: backoff,
      next_run_at: Date.now() + backoff,
      last_error: error,
    });
  }
  return updateJob(id, {
    status: 'failed',
    error,
    completed_at: Date.now(),
  });
}

export function cancelJob(id, reason = 'user_cancelled') {
  return updateJob(id, {
    status: 'cancelled',
    error: reason,
    completed_at: Date.now(),
  });
}

// Returns the next queued job (priority ASC, FIFO within priority).
// Skips jobs with next_run_at in the future (retry backoff).
export function claimNextJob(types = null) {
  const db = _getDb();
  const now = Date.now();
  const where = [`status = 'queued'`];
  const params = [];
  if (types && types.length > 0) {
    where.push(`type IN (${types.map(() => '?').join(',')})`);
    params.push(...types);
  }
  where.push('(next_run_at IS NULL OR next_run_at <= ?)');
  params.push(now);
  const whereSql = 'WHERE ' + where.join(' AND ');
  const row = db.prepare(`
    SELECT * FROM jobs ${whereSql}
    ORDER BY priority ASC, created_at ASC
    LIMIT 1
  `).get(...params);
  if (!row) return null;
  // Mark as running atomically
  const updated = db.prepare(`
    UPDATE jobs SET status = 'running', started_at = ?
    WHERE id = ? AND status = 'queued'
  `).run(now, row.id);
  if (updated.changes === 0) return null; // someone else claimed it
  return getJob(row.id);
}

export function getJobEvents(job_id, { limit = 50 } = {}) {
  const db = _getDb();
  const rows = db.prepare(`
    SELECT * FROM job_events WHERE job_id = ?
    ORDER BY ts DESC LIMIT ?
  `).all(job_id, limit);
  return rows.map((r) => ({
    id: r.id,
    job_id: r.job_id,
    type: r.type,
    message: r.message,
    payload: r.payload ? JSON.parse(r.payload) : null,
    ts: r.ts,
  }));
}

// ====================================================================
// Internals
// ====================================================================

function _recordEvent(job_id, type, message, payload = null) {
  const db = _getDb();
  db.prepare(`
    INSERT INTO job_events (job_id, type, message, payload, ts)
    VALUES (?, ?, ?, ?, ?)
  `).run(job_id, type, message, payload ? JSON.stringify(payload) : null, Date.now());
}

function _rowToJob(row) {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    args: row.args ? JSON.parse(row.args) : null,
    result: row.result ? JSON.parse(row.result) : null,
    progress: row.progress,
    position: row.position,
    user_id: row.user_id,
    parent_job_id: row.parent_job_id,
    error: row.error,
    last_error: row.last_error,
    priority: row.priority,
    attempt: row.attempt,
    max_attempts: row.max_attempts,
    backoff_ms: row.backoff_ms,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
    created_at: row.created_at,
    started_at: row.started_at,
    completed_at: row.completed_at,
    next_run_at: row.next_run_at,
  };
}

// ====================================================================
// Lifecycle helpers
// ====================================================================

export function dbStats() {
  const db = _getDb();
  return {
    total: db.prepare('SELECT COUNT(*) AS n FROM jobs').get().n,
    by_status: db.prepare(`
      SELECT status, COUNT(*) AS n FROM jobs GROUP BY status
    `).all(),
    by_type: db.prepare(`
      SELECT type, COUNT(*) AS n FROM jobs GROUP BY type
    `).all(),
    db_size_bytes: existsSync(DEFAULT_DB_PATH) ? statSync(DEFAULT_DB_PATH).size : 0,
  };
}

export function _getDbHandle() {
  return _getDb();
}

export function closeDb() {
  if (_db) { _db.close(); _db = null; }
}
