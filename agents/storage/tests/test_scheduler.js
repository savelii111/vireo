// A1: Retention scheduler tests (2026-06-08).
//
// Verifies the in-process retention cron:
//   1. startRetentionScheduler runs immediately on boot
//   2. setInterval fires at the configured intervalMs
//   3. stop() halts the scheduler
//   4. runOnce() returns the run result
//   5. Overlapping runs are skipped
//   6. VIREO_AUDIT_RETENTION_DAYS env var respected
//   7. getActiveScheduler returns the active handle
//   8. Idempotent: second startRetentionScheduler returns same handle
//   9. Failures don't kill the scheduler
//  10. stopRetentionScheduler without arg stops active one
import { test } from "node:test";
import assert from "node:assert/strict";
import { MockPool } from "../src/mock_pool.js";
import { AuditStore } from "../src/gdpr_store.js";
import {
  startRetentionScheduler,
  stopRetentionScheduler,
  getActiveScheduler,
} from "../src/scheduler.js";

async function seedOldAudit(pool, { userId, count, ageDays }) {
  const store = new AuditStore(pool);
  for (let i = 0; i < count; i++) {
    const id = await store.log({ userId, action: "x", result: "ok" });
    const row = pool.tables.vireo_studio_audit.find((r) => r.id === id);
    row.created_at = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000).toISOString();
  }
}

test("A1: startRetentionScheduler purges on boot", async () => {
  const pool = new MockPool();
  await seedOldAudit(pool, { userId: "u-1", count: 3, ageDays: 100 });
  // runOnBoot defaults to true. We pass a fast intervalMs so the
  // test exits quickly. We need to wait for the boot run to finish.
  const handle = startRetentionScheduler({ pool, retentionDays: 30, intervalMs: 60_000, runOnBoot: true });
  try {
    // Wait for the boot run
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(handle.runCount, 1, "boot run should have executed");
    assert.equal(handle.lastResult.purged, 3, "should have purged 3 old rows");
    assert.equal(pool.tables.vireo_studio_audit.length, 0);
  } finally {
    handle.stop();
  }
});

test("A1: startRetentionScheduler is idempotent (returns same handle)", async () => {
  const pool = new MockPool();
  const h1 = startRetentionScheduler({ pool, intervalMs: 60_000, runOnBoot: false });
  const h2 = startRetentionScheduler({ pool, intervalMs: 60_000, runOnBoot: false });
  try {
    assert.strictEqual(h1, h2, "second start returns same handle");
  } finally {
    h1.stop();
  }
});

test("A1: stop() halts the scheduler", async () => {
  const pool = new MockPool();
  const handle = startRetentionScheduler({ pool, intervalMs: 60_000, runOnBoot: false });
  assert.equal(handle.enabled, true);
  const stopped = handle.stop();
  assert.equal(stopped, true);
  assert.equal(handle.enabled, false);
  // Stopping again returns false (no-op)
  assert.equal(handle.stop(), false);
});

test("A1: runOnce returns the result and updates lastRun", async () => {
  const pool = new MockPool();
  await seedOldAudit(pool, { userId: "u-1", count: 2, ageDays: 100 });
  const handle = startRetentionScheduler({ pool, retentionDays: 30, intervalMs: 60_000, runOnBoot: false });
  try {
    const result = await handle.runOnce();
    assert.equal(result.purged, 2);
    assert.ok(handle.lastRun, "lastRun should be set");
    assert.ok(handle.lastResult, "lastResult should be set");
  } finally {
    handle.stop();
  }
});

test("A1: overlapping runOnce calls are skipped", async () => {
  const pool = new MockPool();
  const handle = startRetentionScheduler({ pool, intervalMs: 60_000, runOnBoot: false });
  try {
    // Mark as already running
    handle._running = true;
    const result = await handle.runOnce();
    assert.equal(result.skipped, true, "second call should be skipped");
    assert.equal(result.reason, "previous_run_still_in_progress");
    handle._running = false;
  } finally {
    handle.stop();
  }
});

test("A1: getActiveScheduler returns null when not started, handle when started", () => {
  const pool = new MockPool();
  // Make sure no scheduler is active
  if (getActiveScheduler()) getActiveScheduler().stop();
  assert.equal(getActiveScheduler(), null);
  const handle = startRetentionScheduler({ pool, intervalMs: 60_000, runOnBoot: false });
  try {
    assert.strictEqual(getActiveScheduler(), handle);
  } finally {
    handle.stop();
    assert.equal(getActiveScheduler(), null);
  }
});

test("A1: stopRetentionScheduler without arg stops active handle", () => {
  const pool = new MockPool();
  if (getActiveScheduler()) getActiveScheduler().stop();
  startRetentionScheduler({ pool, intervalMs: 60_000, runOnBoot: false });
  const stopped = stopRetentionScheduler();
  assert.equal(stopped, true);
  assert.equal(getActiveScheduler(), null);
});

test("A1: stopRetentionScheduler with no active handle returns false", () => {
  if (getActiveScheduler()) getActiveScheduler().stop();
  const stopped = stopRetentionScheduler();
  assert.equal(stopped, false);
});

test("A1: scheduler respects VIREO_AUDIT_RETENTION_DAYS env", async () => {
  const pool = new MockPool();
  await seedOldAudit(pool, { userId: "u-1", count: 2, ageDays: 100 });
  await seedOldAudit(pool, { userId: "u-1", count: 2, ageDays: 30 });
  process.env.VIREO_AUDIT_RETENTION_DAYS = "60";
  const handle = startRetentionScheduler({ pool, intervalMs: 60_000, runOnBoot: false });
  try {
    assert.equal(handle.retentionDays, 60);
    const result = await handle.runOnce();
    assert.equal(result.purged, 2, "60d retention should purge 100-day rows, keep 30-day rows");
  } finally {
    handle.stop();
    delete process.env.VIREO_AUDIT_RETENTION_DAYS;
  }
});

test("A1: scheduler error is caught and counted, doesn't kill scheduler", async () => {
  const pool = new MockPool();
  // Stub pool.query to throw on DELETE
  const origQuery = pool.query.bind(pool);
  pool.query = (sql, ...rest) => {
    if (typeof sql === "string" && sql.toLowerCase().startsWith("delete from vireo_studio_audit")) {
      return Promise.reject(new Error("simulated DB error"));
    }
    return origQuery(sql, ...rest);
  };
  const handle = startRetentionScheduler({ pool, intervalMs: 60_000, runOnBoot: false });
  try {
    const result = await handle.runOnce();
    assert.ok(result.error, "runOnce should return { error }");
    assert.equal(handle.errorCount, 1);
    // Scheduler is still alive
    assert.equal(handle.enabled, true);
  } finally {
    handle.stop();
    pool.query = origQuery;
  }
});

test("A1: interval is set and nextRun is computed", () => {
  const pool = new MockPool();
  const handle = startRetentionScheduler({ pool, intervalMs: 5_000, runOnBoot: false });
  try {
    assert.ok(handle._interval, "setInterval handle should exist");
    assert.ok(handle.nextRun, "nextRun should be computed");
    const nextRunTime = new Date(handle.nextRun).getTime();
    const expected = Date.now() + 5_000;
    // Allow 200ms slop
    assert.ok(Math.abs(nextRunTime - expected) < 200);
  } finally {
    handle.stop();
  }
});
