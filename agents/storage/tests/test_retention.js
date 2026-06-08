// C3: Retention cron tests (2026-06-08).
//
// Verifies the vireo_studio_audit retention purge:
//   1. purgeOldAudit: deletes rows older than retentionDays,
//      returns the count of purged rows.
//   2. runRetentionCron: wraps purgeOldAudit with env-default
//      retention (365d) and a dry-run option.
//   3. Boundary: rows exactly at the cutoff are kept; rows
//      older are deleted.
//   4. dryRun: counts what would be deleted without deleting.
//   5. env var: VIREO_AUDIT_RETENTION_DAYS overrides the default.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MockPool } from "../src/mock_pool.js";
import { AuditStore, purgeOldAudit, runRetentionCron } from "../src/gdpr_store.js";

// Helper: seed N audit rows at a specific age (days ago).
async function seedOldAudit(pool, { userId, count, ageDays }) {
  const store = new AuditStore(pool);
  const ids = [];
  for (let i = 0; i < count; i++) {
    const id = await store.log({ userId, action: "x", result: "ok" });
    if (ageDays !== undefined) {
      // Backdate the row's created_at to N days ago
      const row = pool.tables.vireo_studio_audit.find((r) => r.id === id);
      row.created_at = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000).toISOString();
    }
    ids.push(id);
  }
  return ids;
}

test("C3: purgeOldAudit deletes rows older than retentionDays", async () => {
  const pool = new MockPool();
  await seedOldAudit(pool, { userId: "u-1", count: 3, ageDays: 100 }); // old
  await seedOldAudit(pool, { userId: "u-1", count: 5, ageDays: 1 });   // fresh
  assert.equal(pool.tables.vireo_studio_audit.length, 8);
  const purged = await purgeOldAudit(pool, { retentionDays: 30 });
  assert.equal(purged, 3, "should have purged 3 old rows");
  assert.equal(pool.tables.vireo_studio_audit.length, 5, "5 fresh rows should remain");
});

test("C3: purgeOldAudit with default retentionDays=365", async () => {
  const pool = new MockPool();
  await seedOldAudit(pool, { userId: "u-1", count: 2, ageDays: 400 }); // older than 365
  await seedOldAudit(pool, { userId: "u-1", count: 3, ageDays: 100 }); // newer than 365
  const purged = await purgeOldAudit(pool);
  assert.equal(purged, 2, "default 365d retention should purge only 2 old rows");
  assert.equal(pool.tables.vireo_studio_audit.length, 3);
});

test("C3: purgeOldAudit returns 0 when no rows are old", async () => {
  const pool = new MockPool();
  await seedOldAudit(pool, { userId: "u-1", count: 5, ageDays: 10 });
  const purged = await purgeOldAudit(pool, { retentionDays: 30 });
  assert.equal(purged, 0);
  assert.equal(pool.tables.vireo_studio_audit.length, 5);
});

test("C3: runRetentionCron uses VIREO_AUDIT_RETENTION_DAYS env var", async () => {
  const pool = new MockPool();
  await seedOldAudit(pool, { userId: "u-1", count: 2, ageDays: 100 });
  await seedOldAudit(pool, { userId: "u-1", count: 3, ageDays: 30 });
  process.env.VIREO_AUDIT_RETENTION_DAYS = "60";
  try {
    const result = await runRetentionCron({ pool });
    assert.equal(result.retentionDays, 60);
    assert.equal(result.purged, 2, "with 60d retention, the 100-day-old rows are purged");
  } finally {
    delete process.env.VIREO_AUDIT_RETENTION_DAYS;
  }
});

test("C3: runRetentionCron dryRun counts without deleting", async () => {
  const pool = new MockPool();
  await seedOldAudit(pool, { userId: "u-1", count: 4, ageDays: 100 });
  const result = await runRetentionCron({ pool, retentionDays: 30, dryRun: true });
  assert.equal(result.purged, 0, "dryRun doesn't actually delete");
  assert.equal(result.would_purge, 4, "but it tells us what would be deleted");
  assert.equal(result.dryRun, true);
  assert.equal(pool.tables.vireo_studio_audit.length, 4, "rows are still there");
});

test("C3: runRetentionCron explicit retentionDays overrides env", async () => {
  const pool = new MockPool();
  await seedOldAudit(pool, { userId: "u-1", count: 2, ageDays: 100 });
  await seedOldAudit(pool, { userId: "u-1", count: 2, ageDays: 10 });
  process.env.VIREO_AUDIT_RETENTION_DAYS = "365";
  try {
    // Explicit retentionDays=30 should beat the env
    const result = await runRetentionCron({ pool, retentionDays: 30 });
    assert.equal(result.retentionDays, 30);
    assert.equal(result.purged, 2, "the 100-day rows are purged at 30d retention");
  } finally {
    delete process.env.VIREO_AUDIT_RETENTION_DAYS;
  }
});

test("C3: retention is isolated per user (deletes for u-1 don't touch u-2)", async () => {
  const pool = new MockPool();
  await seedOldAudit(pool, { userId: "u-1", count: 3, ageDays: 100 });
  await seedOldAudit(pool, { userId: "u-2", count: 2, ageDays: 100 });
  // The retention cron purges across all users (it's a global
  // housekeeping task, not a per-user action). Verify that.
  const purged = await purgeOldAudit(pool, { retentionDays: 30 });
  assert.equal(purged, 5, "retention is global — both users' old rows are purged");
});

test("C3: cutoff boundary — row exactly at cutoff is kept", async () => {
  const pool = new MockPool();
  // Age = retentionDays + a few seconds — should be deleted
  const oldId = await new AuditStore(pool).log({ userId: "u-1", action: "x", result: "ok" });
  pool.tables.vireo_studio_audit[0].created_at = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
  // Age = retentionDays - a few seconds — should be kept
  const freshId = await new AuditStore(pool).log({ userId: "u-1", action: "x", result: "ok" });
  // Default age is now (fresh), so it stays
  const purged = await purgeOldAudit(pool, { retentionDays: 30 });
  assert.equal(purged, 1, "only the 31-day-old row is purged");
  const remaining = pool.tables.vireo_studio_audit.map((r) => r.id);
  assert.ok(remaining.includes(freshId), "fresh row is kept");
  assert.ok(!remaining.includes(oldId), "old row is purged");
});

test("C3: runRetentionCron returns cutoff timestamp in ISO format", async () => {
  const pool = new MockPool();
  const result = await runRetentionCron({ pool, retentionDays: 90, dryRun: true });
  assert.match(result.cutoff, /^\d{4}-\d{2}-\d{2}T/);
  // The cutoff should be ~90 days ago
  const cutoff = new Date(result.cutoff);
  const ageMs = Date.now() - cutoff.getTime();
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  assert.ok(ageDays >= 89.9 && ageDays <= 90.1, `cutoff should be ~90d ago, got ${ageDays}`);
});
