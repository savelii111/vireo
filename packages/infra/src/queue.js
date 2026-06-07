// Vireo queue — Postgres-backed, fallback to in-memory.
//
// Schema (auto-applied):
//   vireo_queue (
//     id bigserial primary key,
//     queue text not null,
//     payload jsonb not null,
//     status text not null default 'pending',  -- pending|processing|done|failed
//     attempts int default 0,
//     max_attempts int default 5,
//     run_at timestamptz default now(),
//     locked_until timestamptz,
//     locked_by text,
//     last_error text,
//     created_at timestamptz default now(),
//     updated_at timestamptz default now()
//   )
//   index (queue, status, run_at) for FIFO claim
//   index (locked_until) for stalled-job reclaim

const QUEUE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS vireo_queue (
    id bigserial PRIMARY KEY,
    queue text NOT NULL,
    payload jsonb NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    attempts int NOT NULL DEFAULT 0,
    max_attempts int NOT NULL DEFAULT 5,
    run_at timestamptz NOT NULL DEFAULT now(),
    locked_until timestamptz,
    locked_by text,
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS vireo_queue_claim_idx ON vireo_queue (queue, status, run_at);
  CREATE INDEX IF NOT EXISTS vireo_queue_locked_idx ON vireo_queue (locked_until);
`;

/**
 * Abstract queue interface:
 *   enqueue(queue, payload, { delayMs, maxAttempts })
 *   claim(queue, owner, { visibilityMs }) -> { id, payload, attempts } | null
 *   complete(id)
 *   fail(id, error)
 *   size(queue, status)
 */
export class Queue {}

export class NullQueue extends Queue {
  async enqueue() { throw new Error("NullQueue: not configured"); }
  async claim() { return null; }
  async complete() {}
  async fail() {}
  async size() { return 0; }
}

export class InMemoryQueue extends Queue {
  constructor({ backoffMs = (attempts) => Math.min(60_000, 2 ** (attempts - 1) * 1000) } = {}) {
    super();
    this._items = []; // { id, queue, payload, status, attempts, maxAttempts, runAt, lockedUntil, lockedBy, lastError, createdAt }
    this._nextId = 1;
    this._timers = new Map();
    this._backoffMs = backoffMs;
  }
  async enqueue(queue, payload, { delayMs = 0, maxAttempts = 5 } = {}) {
    const item = {
      id: this._nextId++,
      queue,
      payload,
      status: "pending",
      attempts: 0,
      maxAttempts,
      runAt: Date.now() + delayMs,
      lockedUntil: 0,
      lockedBy: null,
      lastError: null,
      createdAt: Date.now(),
    };
    this._items.push(item);
    return item.id;
  }
  async claim(queue, owner, { visibilityMs = 30_000 } = {}) {
    const now = Date.now();
    // FIFO: pick earliest pending item with runAt <= now and not locked
    const candidates = this._items
      .filter((x) => x.queue === queue && x.status === "pending" && x.runAt <= now && x.lockedUntil < now)
      .sort((a, b) => a.runAt - b.runAt);
    const item = candidates[0];
    if (!item) return null;
    item.status = "processing";
    item.attempts += 1;
    item.lockedBy = owner;
    item.lockedUntil = now + visibilityMs;
    return { id: item.id, payload: item.payload, attempts: item.attempts };
  }
  async complete(id) {
    const item = this._items.find((x) => x.id === id);
    if (item) item.status = "done";
  }
  async fail(id, error) {
    const item = this._items.find((x) => x.id === id);
    if (!item) return;
    item.lastError = String(error?.message ?? error ?? "");
    if (item.attempts >= item.maxAttempts) {
      item.status = "failed";
    } else {
      // re-queue with backoff (configurable for tests)
      item.status = "pending";
      const backoff = this._backoffMs(item.attempts);
      item.runAt = Date.now() + backoff;
      item.lockedUntil = 0;
      item.lockedBy = null;
    }
  }
  async size(queue = null, status = null) {
    return this._items.filter((x) =>
      (!queue || x.queue === queue) && (!status || x.status === status)
    ).length;
  }
  // Test helper
  _all() { return this._items; }
}

export class PostgresQueue extends Queue {
  constructor({ url, mockPool } = {}) {
    super();
    this.url = url;
    this.mockPool = mockPool;
    this.pool = null;
  }

  async init() {
    if (this.pool) return;
    if (this.mockPool) {
      this.pool = this.mockPool;
    } else if (this.url) {
      const pg = await import("pg");
      this.pool = new pg.Pool({ connectionString: this.url, max: 5 });
      await this.pool.query("SELECT 1");
    } else {
      throw new Error("PostgresQueue: VIREO_PG_URL not set");
    }
    await this.pool.query(QUEUE_SCHEMA);
  }

  async _ensure() {
    if (!this.pool) await this.init();
  }

  async enqueue(queue, payload, { delayMs = 0, maxAttempts = 5 } = {}) {
    await this._ensure();
    const runAt = new Date(Date.now() + Math.max(0, delayMs));
    const r = await this.pool.query(
      `INSERT INTO vireo_queue (queue, payload, max_attempts, run_at)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [queue, JSON.stringify(payload), maxAttempts, runAt.toISOString()],
    );
    return Number(r.rows[0].id);
  }

  async claim(queue, owner, { visibilityMs = 30_000 } = {}) {
    await this._ensure();
    // Atomic claim via UPDATE ... RETURNING (Postgres 9.5+)
    const lockUntil = new Date(Date.now() + visibilityMs);
    const r = await this.pool.query(
      `UPDATE vireo_queue
         SET status = 'processing',
             attempts = attempts + 1,
             locked_until = $3,
             locked_by = $4,
             updated_at = now()
       WHERE id = (
         SELECT id FROM vireo_queue
          WHERE queue = $1
            AND status = 'pending'
            AND run_at <= now()
            AND (locked_until IS NULL OR locked_until < now())
          ORDER BY run_at
          FOR UPDATE SKIP LOCKED
          LIMIT 1
       )
       RETURNING id, payload, attempts`,
      [queue, lockUntil.toISOString(), owner],
    );
    if (r.rows.length === 0) return null;
    return {
      id: Number(r.rows[0].id),
      payload: typeof r.rows[0].payload === "string" ? JSON.parse(r.rows[0].payload) : r.rows[0].payload,
      attempts: r.rows[0].attempts,
    };
  }

  async complete(id) {
    await this._ensure();
    await this.pool.query(
      `UPDATE vireo_queue SET status = 'done', locked_until = NULL, updated_at = now() WHERE id = $1`,
      [id],
    );
  }

  async fail(id, error) {
    await this._ensure();
    const msg = String(error?.message ?? error ?? "");
    // Re-queue with backoff if attempts < max, else mark failed
    await this.pool.query(
      `UPDATE vireo_queue
          SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
              run_at = CASE WHEN attempts >= max_attempts THEN run_at ELSE now() + (LEAST(60, GREATEST(1, 2^(attempts-1))) * interval '1 second') END,
              locked_until = NULL,
              last_error = $2,
              updated_at = now()
        WHERE id = $1`,
      [id, msg],
    );
  }

  async size(queue = null, status = null) {
    await this._ensure();
    const params = [];
    let where = "1=1";
    if (queue) { params.push(queue); where += ` AND queue = $${params.length}`; }
    if (status) { params.push(status); where += ` AND status = $${params.length}`; }
    const r = await this.pool.query(`SELECT count(*)::int as c FROM vireo_queue WHERE ${where}`, params);
    return r.rows[0].c;
  }
}
