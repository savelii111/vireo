// Tests for migrations.js and extended.js — schema and extended Postgres stores.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "..", "src");

function readSource(name) {
  return readFileSync(join(SRC, name), "utf-8");
}

test("migrations.js: file exists", () => {
  const content = readSource("migrations.js");
  assert.ok(content.length > 100);
});

test("migrations.js: exports MIGRATIONS array and applyMigrations function", () => {
  const content = readSource("migrations.js");
  assert.match(content, /export const MIGRATIONS/);
  assert.match(content, /export async function applyMigrations/);
});

test("migrations.js: contains all required tables", () => {
  const content = readSource("migrations.js");
  const required = [
    "vireo_jobs", "vireo_audit", "vireo_metrics",
    "vireo_users",
    "vireo_subscriptions", "vireo_usage", "vireo_invoices",
    "vireo_oauth_tokens", "vireo_oauth_states",
    "vireo_style_dna",
    "vireo_projects", "vireo_content_pieces",
    "vireo_conversations", "vireo_messages",
  ];
  for (const table of required) {
    assert.ok(
      content.includes(`CREATE TABLE IF NOT EXISTS ${table}`),
      `Missing table: ${table}`,
    );
  }
});

test("migrations.js: all migrations have names", () => {
  const content = readSource("migrations.js");
  for (const name of ["001_initial", "002_auth", "003_billing", "004_oauth", "005_style_dna", "006_projects", "007_chat"]) {
    assert.ok(content.includes(`name: "${name}"`), `Missing migration: ${name}`);
  }
});

test("migrations.js: tracks applied migrations in vireo_migrations table", () => {
  const content = readSource("migrations.js");
  assert.match(content, /CREATE TABLE IF NOT EXISTS vireo_migrations/);
  assert.match(content, /INSERT INTO vireo_migrations/);
});

test("migrations.js: creates critical indexes", () => {
  const content = readSource("migrations.js");
  const indexes = [
    "vireo_jobs_status_idx",
    "vireo_jobs_scheduled_idx",
    "vireo_users_email_idx",
    "vireo_subs_user_idx",
    "vireo_oauth_user_idx",
    "vireo_style_dna_user_idx",
    "vireo_projects_user_idx",
    "vireo_content_pieces_user_idx",
    "vireo_conversations_user_idx",
    "vireo_messages_conversation_idx",
  ];
  for (const idx of indexes) {
    assert.ok(content.includes(idx), `Missing index: ${idx}`);
  }
});

test("migrations.js: idempotent (uses IF NOT EXISTS / ON CONFLICT)", () => {
  const content = readSource("migrations.js");
  const createCount = (content.match(/CREATE TABLE IF NOT EXISTS/g) || []).length;
  assert.ok(createCount >= 13, `Expected >=13 CREATE TABLE IF NOT EXISTS, got ${createCount}`);
});

test("extended.js: exports all required store classes", () => {
  const content = readSource("extended.js");
  for (const cls of [
    "PostgresUsersStore",
    "PostgresSubscriptionsStore",
    "PostgresUsageStore",
    "PostgresInvoicesStore",
    "PostgresOAuthTokensStore",
    "PostgresOAuthStatesStore",
    "PostgresStyleDNAStore",
  ]) {
    assert.ok(content.includes(`export class ${cls}`), `Missing class: ${cls}`);
  }
});

test("extended.js: UsersStore has CRUD methods", () => {
  const content = readSource("extended.js");
  assert.match(content, /findByEmail[\s\S]*email\.toLowerCase/);
  assert.match(content, /findById/);
  assert.match(content, /async create/);
  assert.match(content, /async update/);
});

test("extended.js: OAuth stores have TTL/state management", () => {
  const content = readSource("extended.js");
  // States store has TTL
  assert.match(content, /PostgresOAuthStatesStore[\s\S]*expires_at/);
  assert.match(content, /ttl_sec/);
  // Tokens store has upsert (CONFLICT handling)
  assert.match(content, /ON CONFLICT \(user_id, platform\)/);
});

test("extended.js: UsageStore increments on conflict", () => {
  const content = readSource("extended.js");
  assert.match(content, /ON CONFLICT \(user_id, counter, year_month\)/);
  assert.match(content, /value = vireo_usage\.value \+ /);
});

test("index.js: exports all extended stores", () => {
  const content = readSource("index.js");
  for (const cls of [
    "PostgresUsersStore",
    "PostgresSubscriptionsStore",
    "PostgresUsageStore",
    "PostgresInvoicesStore",
    "PostgresOAuthTokensStore",
    "PostgresOAuthStatesStore",
    "PostgresStyleDNAStore",
  ]) {
    assert.ok(content.includes(cls), `Missing export: ${cls}`);
  }
});

test("index.js: createPostgresBundle helper exists", () => {
  const content = readSource("index.js");
  assert.match(content, /export function createPostgresBundle/);
});

test("postgres.js: uses migrations module instead of inline SCHEMA", () => {
  const content = readSource("postgres.js");
  assert.match(content, /import \{ applyMigrations \}/);
  assert.match(content, /await applyMigrations\(this\.pool\)/);
});
