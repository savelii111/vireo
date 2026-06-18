// Migration test for Day 2 storage schema.
// Uses a schema-recording fake pool so the test is deterministic and does not
// require a local Postgres server.

import { test } from "node:test";
import assert from "node:assert/strict";
import { applyMigrations, listAppliedMigrations } from "../src/migrations.js";

class SchemaRecordingPool {
  constructor() {
    this.tables = new Set();
    this.indexes = new Set();
    this.applied = [];
    this.queries = [];
  }

  async query(sql, params = []) {
    const trimmed = sql.replace(/\s+/g, " ").trim();
    this.queries.push({ sql: trimmed, params });
    const lower = trimmed.toLowerCase();

    if (lower.startsWith("create table if not exists vireo_migrations")) {
      return { rows: [], rowCount: 0 };
    }

    if (lower.startsWith("select 1 from vireo_migrations where name = $1")) {
      return { rows: this.applied.includes(params[0]) ? [{ name: params[0] }] : [], rowCount: this.applied.includes(params[0]) ? 1 : 0 };
    }

    if (lower.startsWith("insert into vireo_migrations")) {
      if (!this.applied.includes(params[0])) this.applied.push(params[0]);
      return { rows: [], rowCount: 1 };
    }

    if (lower.startsWith("select name, applied_at from vireo_migrations")) {
      return {
        rows: this.applied.map((name) => ({ name, applied_at: new Date().toISOString() })),
        rowCount: this.applied.length,
      };
    }

    const statements = String(sql).split(";").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
    for (const stmt of statements) {
      const lowerStmt = stmt.toLowerCase();
      const table = lowerStmt.match(/create table if not exists (\w+)/)?.[1];
      if (table) this.tables.add(table);

      const index = lowerStmt.match(/create (?:unique )?index if not exists (\w+)/)?.[1];
      if (index) this.indexes.add(index);
    }

    return { rows: [], rowCount: statements.length };
  }
}

test("013_studio_exports migration is idempotent and registers export tables", async () => {
  const pool = new SchemaRecordingPool();

  await applyMigrations(pool);
  await applyMigrations(pool);

  assert.ok(pool.applied.includes("013_studio_exports"), "013_studio_exports should be applied once");
  assert.equal(pool.applied.filter((name) => name === "013_studio_exports").length, 1, "migration should not re-run on second apply");

  for (const table of ["vireo_assets", "vireo_timelines", "vireo_timeline_ops", "vireo_generations", "vireo_exports"]) {
    assert.ok(pool.tables.has(table), `${table} should be declared by migrations`);
  }

  for (const index of [
    "vireo_assets_user_idx",
    "vireo_assets_project_idx",
    "vireo_timelines_project_uidx",
    "vireo_timelines_user_idx",
    "vireo_timeline_ops_seq_uidx",
    "vireo_timeline_ops_project_idx",
    "vireo_generations_user_idx",
    "vireo_generations_status_idx",
    "vireo_exports_project_idx",
    "vireo_exports_user_state_idx",
  ]) {
    assert.ok(pool.indexes.has(index), `${index} should be declared by migrations`);
  }

  const applied = await listAppliedMigrations(pool);
  assert.equal(applied.at(-1).name, "013_studio_exports", "013_studio_exports should be the last applied migration");
});
