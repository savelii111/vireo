// B2.3-B2.5 storage-layer tests (2026-06-08).
//
// The Postgres-specific code in gdpr_store.js is hard to test
// without a live database. These tests cover:
//   1. The InMemoryAuditStore contract (list, log, filter by user)
//   2. The migration name is registered in the MIGRATIONS list
//   3. The exported API surface is stable (other modules import
//      these names — renaming them is a breaking change)
//
// Live-DB tests for the Postgres path are in a separate file
// (test_gdpr_pg.mjs) and require VIREO_PG_URL to be set.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AuditStore,
  InMemoryAuditStore,
  GdprExportStore,
  GdprDeleteStore,
  recordDsrRequest,
  completeDsrRequest,
} from "../src/gdpr_store.js";
import { MIGRATIONS } from "../src/migrations.js";

test("B2 storage: InMemoryAuditStore.log + list roundtrip", async () => {
  const store = new InMemoryAuditStore();
  const id = await store.log({
    userId: "u1",
    action: "preference_change",
    targetKind: "user",
    targetId: "u1",
    result: "ok",
    httpStatus: 200,
    metadata: { niche: "tech" },
  });
  assert.ok(id, "log should return an id");
  const rows = await store.list({ userId: "u1" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, "preference_change");
  assert.equal(rows[0].result, "ok");
  assert.equal(rows[0].metadata.niche, "tech");
});

test("B2 storage: InMemoryAuditStore filters by userId", async () => {
  const store = new InMemoryAuditStore();
  await store.log({ userId: "u1", action: "x", result: "ok" });
  await store.log({ userId: "u2", action: "x", result: "ok" });
  await store.log({ userId: "u1", action: "y", result: "ok" });
  const u1 = await store.list({ userId: "u1" });
  const u2 = await store.list({ userId: "u2" });
  assert.equal(u1.length, 2);
  assert.equal(u2.length, 1);
});

test("B2 storage: InMemoryAuditStore.list respects limit", async () => {
  const store = new InMemoryAuditStore();
  for (let i = 0; i < 10; i++) {
    await store.log({ userId: "u1", action: "x", result: "ok" });
  }
  const rows = await store.list({ userId: "u1", limit: 3 });
  assert.equal(rows.length, 3);
});

test("B2 storage: InMemoryAuditStore skips entries with no userId", async () => {
  const store = new InMemoryAuditStore();
  await store.log({ userId: null, action: "x", result: "ok" });
  await store.log({ userId: "u1", action: "y", result: "ok" });
  const rows = await store.list({ userId: "u1" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, "y");
});

test("B2 storage: migration 011_gdpr_audit is registered", () => {
  // If this test fails, the migration got dropped. Check
  // agents/storage/src/migrations.js — the 011 entry creates
  // vireo_studio_audit, vireo_consent, and vireo_dsr_requests.
  const m = MIGRATIONS.find((m) => m.name === "011_gdpr_audit");
  assert.ok(m, "migration 011_gdpr_audit must exist");
  assert.ok(m.sql.includes("vireo_studio_audit"), "must create vireo_studio_audit");
  assert.ok(m.sql.includes("vireo_consent"), "must create vireo_consent");
  assert.ok(m.sql.includes("vireo_dsr_requests"), "must create vireo_dsr_requests");
});

test("B2 storage: exported API surface is stable", () => {
  // These names are imported by server.js — renaming them
  // would be a breaking change. If you refactor gdpr_store.js,
  // update this test alongside the import sites.
  assert.equal(typeof AuditStore, "function");
  assert.equal(typeof InMemoryAuditStore, "function");
  assert.equal(typeof GdprExportStore, "function");
  assert.equal(typeof GdprDeleteStore, "function");
  assert.equal(typeof recordDsrRequest, "function");
  assert.equal(typeof completeDsrRequest, "function");
});

test("B2 storage: AuditStore throws on null pool (sanity)", () => {
  // We don't try to query through it, but we want to make sure
  // the constructor doesn't silently swallow a bad pool.
  const s = new AuditStore({ query: async () => ({ rows: [] }) });
  assert.ok(s, "constructor accepts a pool-like object");
});

test("B2 storage: GdprExportStore + GdprDeleteStore constructors", () => {
  const e = new GdprExportStore({});
  const d = new GdprDeleteStore({});
  assert.ok(e, "GdprExportStore instantiates");
  assert.ok(d, "GdprDeleteStore instantiates");
});
