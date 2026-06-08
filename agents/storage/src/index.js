// Vireo storage adapters.
//
// Three implementations of the same `Store` interface:
//   - MemoryStore: in-process Map. Used in tests and dev. Zero deps.
//   - PostgresStore: real Postgres via `pg`. Used in production.
//   - NullStore: throws on every op. Safety sentinel for unconfigured deploys.
//
// Extended stores (Postgres only) for users, subscriptions, usage, invoices,
// OAuth tokens, OAuth states, and StyleDNA.

import { MemoryStore } from "./memory.js";
import { PostgresStore, PostgresUnavailableError } from "./postgres.js";
import {
  PostgresUsersStore,
  PostgresSubscriptionsStore,
  PostgresUsageStore,
  PostgresInvoicesStore,
  PostgresOAuthTokensStore,
  PostgresOAuthStatesStore,
  PostgresStyleDNAStore,
} from "./extended.js";
import { applyMigrations, listAppliedMigrations } from "./migrations.js";
import {
  AuditStore,
  InMemoryAuditStore,
  GdprExportStore,
  GdprDeleteStore,
  recordDsrRequest,
  completeDsrRequest,
} from "./gdpr_store.js";

export { MemoryStore, PostgresStore, PostgresUnavailableError };
export {
  PostgresUsersStore,
  PostgresSubscriptionsStore,
  PostgresUsageStore,
  PostgresInvoicesStore,
  PostgresOAuthTokensStore,
  PostgresOAuthStatesStore,
  PostgresStyleDNAStore,
};
export { applyMigrations, listAppliedMigrations };
export { AuditStore, InMemoryAuditStore, GdprExportStore, GdprDeleteStore, recordDsrRequest, completeDsrRequest };

/**
 * Pick a store based on env.
 *
 *   VIREO_STORE=memory        -> MemoryStore (default, no setup)
 *   VIREO_STORE=postgres      -> PostgresStore using VIREO_PG_URL
 *   VIREO_STORE=null          -> throws on every op
 */
export function createStore({ kind, url, mockPool } = {}) {
  const envKind = (kind ?? process.env.VIREO_STORE ?? "memory").toLowerCase();
  if (envKind === "postgres") {
    return new PostgresStore({ url: url ?? process.env.VIREO_PG_URL, mockPool });
  }
  if (envKind === "memory") {
    return new MemoryStore();
  }
  if (envKind === "null") {
    return new NullStore();
  }
  throw new Error(`Unknown store kind: ${envKind}`);
}

/**
 * Wrap a PostgresStore with all the extended domain stores.
 * Use this to get a single object with all CRUD methods.
 */
export function createPostgresBundle({ url, mockPool } = {}) {
  const store = new PostgresStore({ url, mockPool });
  return {
    store,
    init: () => store.init(),
    close: () => store.close(),
    jobs: { bind: (s) => s },
    users: () => new PostgresUsersStore(store),
    subscriptions: () => new PostgresSubscriptionsStore(store),
    usage: () => new PostgresUsageStore(store),
    invoices: () => new PostgresInvoicesStore(store),
    oauthTokens: () => new PostgresOAuthTokensStore(store),
    oauthStates: () => new PostgresOAuthStatesStore(store),
    styleDNA: () => new PostgresStyleDNAStore(store),
  };
}

export class NullStore {
  constructor() { this.name = "null"; }
  async init() {}
  async close() {}
  async addJob() { throw new Error("NullStore: not configured"); }
  async listJobs() { throw new Error("NullStore: not configured"); }
  async getJob() { throw new Error("NullStore: not configured"); }
  async updateJob() { throw new Error("NullStore: not configured"); }
  async addAudit() { throw new Error("NullStore: not configured"); }
  async listAudit() { throw new Error("NullStore: not configured"); }
  async addMetric() { throw new Error("NullStore: not configured"); }
  async listMetrics() { throw new Error("NullStore: not configured"); }
}
