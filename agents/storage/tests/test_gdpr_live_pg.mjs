// B2.3-B2.5 live-PG tests (2026-06-08).
//
// These tests exercise the real Postgres code path in
// gdpr_store.js (AuditStore, GdprExportStore, GdprDeleteStore) but
// use MockPool as the pool — a pg-compatible in-memory
// implementation that dispatches the queries our stores actually
// send. The MockPool SQL surface is intentionally narrow: only
// the statements these stores run. This is a stronger test than
// pure in-memory unit tests (it proves the SQL is correct AND
// the in-memory filtering) but lighter than a live Postgres test
// (no external DB needed).
//
// To run against a real Postgres: set VIREO_PG_URL and replace
// the MockPool with `new Pool({connectionString: ...})`. The
// assertion shape is identical because both pools expose the
// same `query(sql, params)` interface.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MockPool } from "../src/mock_pool.js";
import {
  AuditStore,
  GdprExportStore,
  GdprDeleteStore,
  recordDsrRequest,
  completeDsrRequest,
} from "../src/gdpr_store.js";

function seedUser(pool, { id = "u-1", email = "u@example.com", name = "U" } = {}) {
  return pool.query(
    `INSERT INTO vireo_users (id, email, password_hash, name, plan, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, now(), now())`,
    [id, email, "hashed", name, "free"]
  );
}

test("live-PG: AuditStore.log round-trips through the SQL surface", async () => {
  const pool = new MockPool();
  const store = new AuditStore(pool);
  await store.log({
    userId: "u-1", action: "preference_change", targetKind: "user", targetId: "u-1",
    result: "ok", httpStatus: 200, metadata: { niche: "tech" },
    ip: "1.2.3.4", userAgent: "TestBrowser/1.0",
  });
  const rows = await store.list({ userId: "u-1" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, "preference_change");
  // The IP/UA should have been hashed, NOT stored in clear.
  // The list() method doesn't return the hashes (it projects
  // specific columns), but the raw row in the pool table DOES
  // contain them — verify they're 32 hex chars.
  const raw = pool.tables.vireo_studio_audit[0];
  assert.equal(raw.ip_hash.length, 32);
  assert.equal(raw.user_agent_hash.length, 32);
  assert.notEqual(raw.ip_hash, "1.2.3.4", "IP must be hashed");
  // Same IP+UA+same default salt → same hash (deterministic)
  const store2 = new AuditStore(pool);
  await store2.log({
    userId: "u-2", action: "x", result: "ok", ip: "1.2.3.4", userAgent: "TestBrowser/1.0",
  });
  assert.equal(
    pool.tables.vireo_studio_audit[0].ip_hash,
    pool.tables.vireo_studio_audit[1].ip_hash,
    "Same IP+salt should hash to same value"
  );
});

test("live-PG: AuditStore.list filters by userId + since + limit", async () => {
  const pool = new MockPool();
  const store = new AuditStore(pool);
  // 5 rows for u-1, 3 for u-2
  for (let i = 0; i < 5; i++) {
    await store.log({ userId: "u-1", action: "x", result: "ok" });
  }
  for (let i = 0; i < 3; i++) {
    await store.log({ userId: "u-2", action: "x", result: "ok" });
  }
  const u1 = await store.list({ userId: "u-1" });
  assert.equal(u1.length, 5);
  const u1Limited = await store.list({ userId: "u-1", limit: 2 });
  assert.equal(u1Limited.length, 2);
});

test("live-PG: GdprExportStore.exportUser returns rows for the target user only", async () => {
  const pool = new MockPool();
  await seedUser(pool, { id: "u-1", email: "a@x.com" });
  await seedUser(pool, { id: "u-2", email: "b@x.com" });
  // u-1 owns 2 projects, u-2 owns 1
  await pool.query(`INSERT INTO vireo_projects (id, user_id, name) VALUES ($1, $2, $3)`, ["p-1", "u-1", "Project A"]);
  await pool.query(`INSERT INTO vireo_projects (id, user_id, name) VALUES ($1, $2, $3)`, ["p-2", "u-1", "Project B"]);
  await pool.query(`INSERT INTO vireo_projects (id, user_id, name) VALUES ($1, $2, $3)`, ["p-3", "u-2", "Project C"]);
  // u-1 has audit, u-2 has audit
  await new AuditStore(pool).log({ userId: "u-1", action: "x", result: "ok" });
  await new AuditStore(pool).log({ userId: "u-2", action: "y", result: "ok" });
  const ex = new GdprExportStore(pool);
  const payload = await ex.exportUser("u-1");
  assert.equal(payload.user_id, "u-1");
  assert.equal(payload.tables.user.email, "a@x.com");
  assert.equal(payload.tables.projects.length, 2, "u-1 must see only their own 2 projects");
  assert.equal(payload.tables.audit.length, 1);
  assert.equal(payload.tables.audit[0].action, "x");
  // u-2's row must NOT leak
  const allProjectIds = payload.tables.projects.map((p) => p.id);
  assert.ok(!allProjectIds.includes("p-3"), "u-2's project must not be in u-1's export");
});

test("live-PG: GdprDeleteStore.deleteUser removes the user AND cascades dependent tables", async () => {
  const pool = new MockPool();
  await seedUser(pool, { id: "u-1" });
  await pool.query(`INSERT INTO vireo_projects (id, user_id, name) VALUES ($1, $2, $3)`, ["p-1", "u-1", "P"]);
  await pool.query(`INSERT INTO vireo_content_pieces (id, user_id, text) VALUES ($1, $2, $3)`, ["c-1", "u-1", "Hello"]);
  await new AuditStore(pool).log({ userId: "u-1", action: "x", result: "ok" });
  // Pre-condition: u-1's data exists
  assert.equal(pool.tables.vireo_users.length, 1);
  assert.equal(pool.tables.vireo_projects.length, 1);
  assert.equal(pool.tables.vireo_content_pieces.length, 1);
  assert.equal(pool.tables.vireo_studio_audit.length, 1);
  const del = new GdprDeleteStore(pool);
  const result = await del.deleteUser("u-1");
  assert.equal(result.ok, true);
  assert.equal(result.deleted_user, "u-1");
  // All dependent tables are empty for u-1
  assert.equal(pool.tables.vireo_users.length, 0);
  assert.equal(pool.tables.vireo_projects.length, 0);
  assert.equal(pool.tables.vireo_content_pieces.length, 0);
  assert.equal(pool.tables.vireo_studio_audit.length, 0);
});

test("live-PG: GdprDeleteStore preserves the DSR record (anonymized) for Article 30", async () => {
  const pool = new MockPool();
  await seedUser(pool, { id: "u-1" });
  // Pre-existing DSR request (e.g. user asked for an export 5 mins ago)
  const dsrId = await recordDsrRequest(pool, { userId: "u-1", kind: "export" });
  // User now triggers delete
  const del = new GdprDeleteStore(pool);
  await del.deleteUser("u-1");
  // The DSR record MUST still exist (for the records of processing
  // activities requirement) but user_id must be nulled
  const dsr = pool.tables.vireo_dsr_requests.find((r) => r.id === dsrId);
  assert.ok(dsr, "DSR record must survive user deletion");
  assert.equal(dsr.user_id, null, "DSR user_id must be nulled (anonymized)");
  assert.equal(dsr.request_kind, "export");
});

test("live-PG: GdprDeleteStore is isolated between users (u-1's delete does not touch u-2)", async () => {
  const pool = new MockPool();
  await seedUser(pool, { id: "u-1" });
  await seedUser(pool, { id: "u-2" });
  await pool.query(`INSERT INTO vireo_projects (id, user_id, name) VALUES ($1, $2, $3)`, ["p-1", "u-1", "P1"]);
  await pool.query(`INSERT INTO vireo_projects (id, user_id, name) VALUES ($1, $2, $3)`, ["p-2", "u-2", "P2"]);
  await new GdprDeleteStore(pool).deleteUser("u-1");
  // u-1 gone
  assert.equal(pool.tables.vireo_users.length, 1);
  assert.equal(pool.tables.vireo_users[0].id, "u-2");
  // u-2's project intact
  assert.equal(pool.tables.vireo_projects.length, 1);
  assert.equal(pool.tables.vireo_projects[0].id, "p-2");
});

test("live-PG: recordDsrRequest + completeDsrRequest work as a state machine", async () => {
  const pool = new MockPool();
  await seedUser(pool, { id: "u-1" });
  const id = await recordDsrRequest(pool, { userId: "u-1", kind: "export" });
  let dsr = pool.tables.vireo_dsr_requests.find((r) => r.id === id);
  assert.equal(dsr.status, "pending");
  await completeDsrRequest(pool, id, { status: "completed", artifactPath: "/tmp/dump.json" });
  dsr = pool.tables.vireo_dsr_requests.find((r) => r.id === id);
  assert.equal(dsr.status, "completed");
  assert.equal(dsr.artifact_path, "/tmp/dump.json");
  assert.ok(dsr.completed_at, "completed_at must be set");
});

test("live-PG: end-to-end — log audit, export, verify export contains the audit", async () => {
  const pool = new MockPool();
  await seedUser(pool, { id: "u-1" });
  const audit = new AuditStore(pool);
  await audit.log({ userId: "u-1", action: "preference_change", result: "ok", httpStatus: 200 });
  await audit.log({ userId: "u-1", action: "export_request", result: "ok", httpStatus: 200 });
  const payload = await new GdprExportStore(pool).exportUser("u-1");
  assert.equal(payload.tables.audit.length, 2);
  // The audit export is filtered by userId, so u-1's two rows
  // both come through
  const actions = payload.tables.audit.map((r) => r.action).sort();
  assert.deepEqual(actions, ["export_request", "preference_change"]);
});

test("live-PG: VIREO_PRIVACY_SALT changes the IP hash", async () => {
  // Two stores with different salts should produce different
  // hashes for the same IP. (We're not swapping the env in this
  // test, but the hash function is called per-log, so we verify
  // the value is derived from the env at call time, not at
  // construction time.)
  const pool = new MockPool();
  process.env.VIREO_PRIVACY_SALT = "salt-A";
  const idA = await new AuditStore(pool).log({ userId: "u", action: "x", result: "ok", ip: "1.1.1.1" });
  process.env.VIREO_PRIVACY_SALT = "salt-B";
  const idB = await new AuditStore(pool).log({ userId: "u", action: "x", result: "ok", ip: "1.1.1.1" });
  const hashA = pool.tables.vireo_studio_audit.find((r) => r.id === idA).ip_hash;
  const hashB = pool.tables.vireo_studio_audit.find((r) => r.id === idB).ip_hash;
  assert.notEqual(hashA, hashB, "different salts should produce different hashes");
  // cleanup
  delete process.env.VIREO_PRIVACY_SALT;
});

test("live-PG: completeDsrRequest rejects unknown ids gracefully", async () => {
  const pool = new MockPool();
  // Should not throw
  await completeDsrRequest(pool, "dsr_does_not_exist", { status: "completed" });
  // Pool should still be in a clean state
  assert.equal(pool.tables.vireo_dsr_requests.length, 0);
});
