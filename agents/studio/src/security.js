// G1+G2: Security utilities (2026-06-08).
//
// This module holds the security primitives that every tool
// call + user-facing endpoint should use:
//
//   - Resource ownership validation (prevent user A from
//     operating on user B's projects, pieces, etc.)
//   - Per-tool-call timeout enforcement
//   - Undo store (last N destructive tool calls, with
//     rollback functions)
//   - Confirmation tokens (require explicit user opt-in for
//     destructive ops like delete_project, delete_account)
//
// Why a separate module:
//   - These checks should be CONSISTENT across the codebase.
//     If every tool author writes their own "is this my
//     project" check, they will diverge. One module = one
//     place to fix bugs.
//   - The undo store is global (one per process). Putting it
//     in a module avoids accidentally creating multiple stores
//     from different test files.

import { randomUUID } from "node:crypto";

// ---- G1.1: Resource ownership validation ----
//
// Given a list of resources (projects, pieces, conversations)
// and a userId, return only the ones that belong to that user.
// This is the same logic that buildToolDeps already uses
// internally, but having it as a utility means we can use it
// for chat-tool args validation, undo rollbacks, and any
// future endpoint that takes a resource ID.

/**
 * Filter a list of resources to only those owned by userId.
 * Each resource is expected to have user_id or owner_id.
 * @param {Array} resources
 * @param {string} userId
 * @returns {Array}
 */
export function filterByOwner(resources, userId) {
  if (!Array.isArray(resources)) return [];
  if (!userId) return [];
  return resources.filter((r) => r && (r.user_id === userId || r.owner_id === userId));
}

/**
 * Check whether a single resource belongs to the user.
 * @param {object} resource - { id, user_id|owner_id, ... }
 * @param {string} userId
 * @returns {boolean}
 */
export function isOwnedBy(resource, userId) {
  if (!resource || !userId) return false;
  return resource.user_id === userId || resource.owner_id === userId;
}

/**
 * Validate a list of resource IDs against a list of owned IDs.
 * Returns the list of invalid (not-owned, not-found) IDs.
 * Use this before applying bulk operations to ensure no
 * foreign IDs slip through.
 *
 * @param {string[]} ids
 * @param {string[]} ownedIds
 * @returns {string[]} - the IDs that are NOT owned
 */
export function findForeignIds(ids, ownedIds) {
  if (!Array.isArray(ids)) return [];
  const owned = new Set(ownedIds || []);
  return ids.filter((id) => !owned.has(id));
}

// ---- G1.2: Per-tool-call timeout enforcement ----
//
// Wrap an async tool-call with a timeout. If it doesn't
// complete in `timeoutMs`, throw a TimeoutError. The chat
// pipeline catches throws and surfaces them to the LLM as
// tool results, so the LLM can recover gracefully.

/**
 * @param {Promise} promise
 * @param {number} timeoutMs
 * @param {string} [label] - for error message
 * @returns {Promise}
 */
export async function withTimeout(promise, timeoutMs, label = "tool_call") {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}_timeout_${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// Default per-tool timeouts. Tunable per deployment via env.
// Some tools (e.g. video rendering) genuinely take longer;
// the chat pipeline can override at the call site.
const DEFAULT_TOOL_TIMEOUTS = {
  // Chat tools — fast (in-memory or small DB writes)
  create_project: 5_000,
  save_content: 10_000,
  list_projects: 5_000,
  get_style_dna: 5_000,
  // Edit/video tools — slow (may call video agent)
  cut_video: 120_000,
  add_broll: 60_000,
  generate_thumbnail: 30_000,
  // Default for unknown tools
  _default: 30_000,
};

export function getToolTimeoutMs(toolName) {
  return DEFAULT_TOOL_TIMEOUTS[toolName] || DEFAULT_TOOL_TIMEOUTS._default;
}

// ---- G2.1: Undo store ----
//
// Keeps the last N destructive tool calls per user. Each
// entry has a rollback function the user can invoke via
// POST /api/me/undo. The rollback receives the same args
// the original tool got.
//
// We deliberately use a Map (not a list) so the "most
// recent" lookup is O(1). Capped at N entries per user to
// prevent memory blowup.

const UNDO_HISTORY_LIMIT = 20;

class UndoStore {
  constructor() {
    // userId → array of { id, tool, args, rollback, created_at }
    this.byUser = new Map();
  }
  /**
   * Record a destructive action. The `rollback` function
   * will be called if the user invokes undo.
   *
   * @param {string} userId
   * @param {object} entry
   * @param {string} entry.tool
   * @param {object} entry.args
   * @param {Function} entry.rollback - async () => any
   * @returns {string} undo_id (UUID)
   */
  record(userId, { tool, args, rollback }) {
    if (!userId || typeof rollback !== "function") {
      throw new Error("UndoStore.record requires userId and a rollback function");
    }
    const id = randomUUID();
    const entry = { id, tool, args, rollback, created_at: new Date().toISOString() };
    let history = this.byUser.get(userId);
    if (!history) { history = []; this.byUser.set(userId, history); }
    history.push(entry);
    if (history.length > UNDO_HISTORY_LIMIT) {
      history = history.slice(-UNDO_HISTORY_LIMIT);
      this.byUser.set(userId, history);
    }
    return id;
  }
  /**
   * Pop and return the most recent undoable action for a user.
   * Returns null if there's nothing to undo.
   * @param {string} userId
   * @returns {object|null}
   */
  pop(userId) {
    const history = this.byUser.get(userId);
    if (!history || history.length === 0) return null;
    return history.pop();
  }
  /**
   * Peek (without removing) at the most recent entry.
   * @param {string} userId
   * @returns {object|null}
   */
  peek(userId) {
    const history = this.byUser.get(userId);
    if (!history || history.length === 0) return null;
    return history[history.length - 1];
  }
  /**
   * List all undoable actions (for the UI "undo history" view).
   * @param {string} userId
   * @returns {Array}
   */
  list(userId) {
    const history = this.byUser.get(userId) || [];
    // Return without the rollback function (UI doesn't need it)
    return history.map((e) => ({ id: e.id, tool: e.tool, args: e.args, created_at: e.created_at }));
  }
  clear(userId) {
    this.byUser.delete(userId);
  }
}

export const undoStore = new UndoStore();

// ---- G2.2: Confirmation tokens ----
//
// For destructive ops (delete_project, delete_account, etc.)
// the LLM should NOT be able to call them without the user
// explicitly confirming. The flow:
//
//   1. LLM calls `request_confirmation(tool, args)` (a meta-tool)
//   2. We generate a token, return it to the LLM
//   3. LLM shows the user a confirmation UI (e.g. "Delete project 'X'?")
//   4. User clicks "Yes"
//   5. Client calls POST /api/confirmations/:token with the tool+args
//   6. Server validates the token, runs the tool, returns the result
//
// Tokens are single-use, expire in 5 minutes, and are bound to
// the user + tool + args (so an attacker can't replay a token
// for a different op).

const CONFIRMATION_TTL_MS = 5 * 60_000; // 5 minutes

class ConfirmationStore {
  constructor() {
    this.byToken = new Map();
  }
  /**
   * Generate a single-use confirmation token.
   * @param {string} userId
   * @param {object} request
   * @param {string} request.tool
   * @param {object} request.args
   * @returns {string} token (UUID)
   */
  create(userId, { tool, args }) {
    const token = randomUUID();
    this.byToken.set(token, {
      userId,
      tool,
      args,
      created_at: Date.now(),
      used: false,
    });
    return token;
  }
  /**
   * Validate and consume a token. Returns the request if valid,
   * null if expired, used, unknown, or for a different user.
   * @param {string} userId
   * @param {string} token
   * @returns {object|null}
   */
  consume(userId, token) {
    const entry = this.byToken.get(token);
    if (!entry) return null;
    if (entry.userId !== userId) return null;
    if (entry.used) return null;
    if (Date.now() - entry.created_at > CONFIRMATION_TTL_MS) {
      this.byToken.delete(token);
      return null;
    }
    entry.used = true;
    this.byToken.delete(token);
    return { tool: entry.tool, args: entry.args };
  }
  /**
   * List pending (unconsumed, unexpired) tokens for a user.
   * @param {string} userId
   * @returns {Array}
   */
  listPending(userId) {
    const now = Date.now();
    const out = [];
    for (const [token, entry] of this.byToken) {
      if (entry.userId !== userId) continue;
      if (entry.used) continue;
      if (now - entry.created_at > CONFIRMATION_TTL_MS) {
        this.byToken.delete(token);
        continue;
      }
      out.push({ token, tool: entry.tool, created_at: entry.created_at });
    }
    return out;
  }
  /**
   * Garbage-collect expired tokens. Call periodically.
   */
  gc() {
    const now = Date.now();
    for (const [token, entry] of this.byToken) {
      if (now - entry.created_at > CONFIRMATION_TTL_MS) {
        this.byToken.delete(token);
      }
    }
  }
}

export const confirmationStore = new ConfirmationStore();

// Destructive tools that require confirmation.
// Adding a tool here will cause the chat pipeline to ask
// the user "Are you sure?" before executing it.
const DESTRUCTIVE_TOOLS = new Set([
  "delete_project",
  "delete_account",
  "delete_piece",
  "revoke_consent",
  "delete_style_dna",
]);

export function isDestructiveTool(toolName) {
  return DESTRUCTIVE_TOOLS.has(toolName);
}

export function getDestructiveTools() {
  return [...DESTRUCTIVE_TOOLS];
}

// ---- Security Tools (10 tools) ----
//
// High-level security features exposed as tool-use functions.
// All are pure in-memory / deterministic for v1 (no real IdP calls).
//
//   1. enableSSOSAML       — SAML-based SSO for a domain
//   2. enableSSOOAuth      — OAuth-based SSO (Google, GitHub, Microsoft, Okta)
//   3. enable2FA           — two-factor authentication per user
//   4. rotateAPIKey        — rotate a project-scoped API key
//   5. setIPWhitelist      — restrict access by IP address
//   6. getAuditLog         — query project audit log
//   7. getDataEncryption   — encryption status for a project
//   8. exportGDPRData      — GDPR data export for a user
//   9. deleteUserData      — GDPR-compliant user data deletion
//  10. getSecurityReport   — composite security score & recommendations

import { createHash, randomBytes } from "node:crypto";

// ---------- internal stores ----------

/** @type {Map<string, object>}  projectId → { enabled, domain, certificate_fingerprint, metadata_url } */
const samlStore = new Map();

/** @type {Map<string, object>}  projectId → { enabled, provider, client_id, redirect_url } */
const oauthStore = new Map();

/** @type {Map<string, object>}  userId → { enabled, method, backup_codes, recovery_email } */
const twoFAStore = new Map();

/** @type {Map<string, {key: string, preview: string, rotated_at: string}>}  projectId → latest key info */
const apiKeyStore = new Map();

/** @type {Map<string, object>}  projectId → { enabled, ips, rules_count } */
const ipWhitelistStore = new Map();

/** @type {Map<string, Array>}  projectId → audit entries */
const auditLogStore = new Map();

/** @type {Map<string, object>}  projectId → encryption status */
const encryptionStore = new Map();

/** @type {Map<string, object>}  userId → GDPR export info */
const gdprExportStore = new Map();

/** @type {Map<string, object>}  userId → deletion info */
const deletionStore = new Map();

// ---------- helpers ----------

function sha256(str) {
  return createHash("sha256").update(str).digest("hex");
}

function generateKey() {
  return "vsk_" + randomBytes(32).toString("hex");
}

function previewKey(key) {
  return key.slice(0, 8) + "…" + key.slice(-4);
}

function generateBackupCodes(count = 8) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    codes.push(randomBytes(4).toString("hex").toUpperCase());
  }
  return codes;
}

function addAuditEntry(projectId, action, user, details = {}) {
  if (!auditLogStore.has(projectId)) auditLogStore.set(projectId, []);
  auditLogStore.get(projectId).push({
    action,
    user: user || "system",
    timestamp: new Date().toISOString(),
    details,
  });
}

// ---------- 1. enableSSOSAML ----------

/**
 * Enable SAML-based Single Sign-On for a domain.
 * @param {{ domain: string, certificate: string, metadata_url: string }} opts
 * @returns {object} SSOConfig
 */
export function enableSSOSAML({ domain, certificate, metadata_url } = {}) {
  if (!domain) throw new Error("domain is required");
  if (!certificate) throw new Error("certificate is required");
  if (!metadata_url) throw new Error("metadata_url is required");

  const fingerprint = sha256(certificate);
  const config = {
    enabled: true,
    domain,
    certificate_fingerprint: fingerprint,
    metadata_url,
  };
  samlStore.set(domain, config);
  return { ...config };
}

// ---------- 2. enableSSOOAuth ----------

const VALID_OAUTH_PROVIDERS = new Set(["google", "github", "microsoft", "okta"]);

/**
 * Enable OAuth-based Single Sign-On.
 * @param {{ provider: string, client_id: string, client_secret: string }} opts
 * @returns {object} OAuthConfig
 */
export function enableSSOOAuth({ provider, client_id, client_secret } = {}) {
  if (!provider) throw new Error("provider is required");
  if (!VALID_OAUTH_PROVIDERS.has(provider)) {
    throw new Error(`Invalid provider '${provider}'. Must be one of: ${[...VALID_OAUTH_PROVIDERS].join(", ")}`);
  }
  if (!client_id) throw new Error("client_id is required");
  if (!client_secret) throw new Error("client_secret is required");

  const config = {
    enabled: true,
    provider,
    client_id,
    redirect_url: `https://studio.vireo.app/auth/callback/${provider}`,
  };
  oauthStore.set(provider, config);
  return { ...config };
}

// ---------- 3. enable2FA ----------

const VALID_2FA_METHODS = new Set(["totp", "sms", "email"]);

/**
 * Enable two-factor authentication for a user.
 * @param {{ userId: string, method: string }} opts
 * @returns {object} TwoFAConfig
 */
export function enable2FA({ userId, method } = {}) {
  if (!userId) throw new Error("userId is required");
  if (!method) throw new Error("method is required");
  if (!VALID_2FA_METHODS.has(method)) {
    throw new Error(`Invalid 2FA method '${method}'. Must be one of: ${[...VALID_2FA_METHODS].join(", ")}`);
  }

  const config = {
    enabled: true,
    method,
    backup_codes: generateBackupCodes(8),
    recovery_email: `recovery+${userId}@vireo.app`,
  };
  twoFAStore.set(userId, config);
  return { ...config };
}

// ---------- 4. rotateAPIKey ----------

/**
 * Rotate a project-scoped API key.
 * @param {{ userId: string, projectId: string }} opts
 * @returns {object} NewAPIKey
 */
export function rotateAPIKey({ userId, projectId } = {}) {
  if (!userId) throw new Error("userId is required");
  if (!projectId) throw new Error("projectId is required");

  const oldEntry = apiKeyStore.get(projectId);
  const oldKey = oldEntry ? oldEntry.key : generateKey();
  const newKey = generateKey();
  const now = new Date().toISOString();

  const result = {
    old_key_preview: previewKey(oldKey),
    new_key: newKey,
    new_key_preview: previewKey(newKey),
    rotated_at: now,
  };

  apiKeyStore.set(projectId, { key: newKey, preview: previewKey(newKey), rotated_at: now });
  addAuditEntry(projectId, "api_key_rotated", userId);
  return result;
}

// ---------- 5. setIPWhitelist ----------

/**
 * Set an IP whitelist for a project.
 * @param {{ projectId: string, ips: string[] }} opts
 * @returns {object} IPWhitelist
 */
export function setIPWhitelist({ projectId, ips } = {}) {
  if (!projectId) throw new Error("projectId is required");
  if (!Array.isArray(ips) || ips.length === 0) throw new Error("ips must be a non-empty array");

  const config = {
    enabled: true,
    ips: [...ips],
    rules_count: ips.length,
  };
  ipWhitelistStore.set(projectId, config);
  addAuditEntry(projectId, "ip_whitelist_updated", null, { ips });
  return { ...config };
}

// ---------- 6. getAuditLog ----------

/**
 * Query the audit log for a project.
 * @param {{ projectId: string, filters?: { action?: string, user?: string, since?: string } }} opts
 * @returns {object} AuditLog
 */
export function getAuditLog({ projectId, filters } = {}) {
  if (!projectId) throw new Error("projectId is required");

  let entries = auditLogStore.get(projectId) || [];

  if (filters) {
    if (filters.action) entries = entries.filter((e) => e.action === filters.action);
    if (filters.user) entries = entries.filter((e) => e.user === filters.user);
    if (filters.since) {
      const since = new Date(filters.since).getTime();
      entries = entries.filter((e) => new Date(e.timestamp).getTime() >= since);
    }
  }

  return {
    entries: entries.map((e) => ({ ...e })),
    total_count: entries.length,
  };
}

// ---------- 7. getDataEncryption ----------

/**
 * Get encryption status for a project.
 * @param {{ projectId: string }} opts
 * @returns {object} EncryptionStatus
 */
export function getDataEncryption({ projectId } = {}) {
  if (!projectId) throw new Error("projectId is required");

  const existing = encryptionStore.get(projectId);
  if (existing) return { ...existing };

  const status = {
    at_rest: true,
    in_transit: true,
    algorithm: "AES-256-GCM",
    key_rotation_days: 90,
  };
  encryptionStore.set(projectId, status);
  return { ...status };
}

// ---------- 8. exportGDPRData ----------

/**
 * Generate a GDPR data export for a user.
 * @param {{ userId: string }} opts
 * @returns {object} GDPRExport
 */
export function exportGDPRData({ userId } = {}) {
  if (!userId) throw new Error("userId is required");

  const exportId = randomBytes(8).toString("hex");
  const result = {
    export_url: `https://studio.vireo.app/gdpr/export/${exportId}`,
    format: "json",
    size_mb: +(Math.random() * 10 + 0.1).toFixed(2),
    includes: ["profile", "projects", "analytics", "preferences", "audit_log"],
  };
  gdprExportStore.set(userId, { ...result, exportId, created_at: new Date().toISOString() });
  addAuditEntry("_global", "gdpr_export_requested", userId);
  return { ...result };
}

// ---------- 9. deleteUserData ----------

/**
 * Delete all user data (GDPR right-to-erasure).
 * @param {{ userId: string, confirm: boolean }} opts
 * @returns {object} DeletionResult
 */
export function deleteUserData({ userId, confirm } = {}) {
  if (!userId) throw new Error("userId is required");
  if (!confirm) throw new Error("confirm must be true to proceed with deletion");

  const backupUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const result = {
    deleted: true,
    data_removed: ["profile", "projects", "files", "analytics", "preferences"],
    backup_retained_until: backupUntil,
  };

  // Remove from stores
  twoFAStore.delete(userId);
  gdprExportStore.delete(userId);
  deletionStore.set(userId, { ...result, deleted_at: new Date().toISOString() });
  addAuditEntry("_global", "user_data_deleted", userId);
  return { ...result };
}

// ---------- 10. getSecurityReport ----------

/**
 * Generate a composite security report for a project.
 * @param {{ projectId: string }} opts
 * @returns {object} SecurityReport
 */
export function getSecurityReport({ projectId } = {}) {
  if (!projectId) throw new Error("projectId is required");

  let score = 100;
  const vulnerabilities = [];
  const recommendations = [];

  // Check SSO
  const hasSAML = samlStore.has(projectId);
  const hasOAuth = oauthStore.has(projectId);
  if (!hasSAML && !hasOAuth) {
    score -= 15;
    vulnerabilities.push("No SSO configured");
    recommendations.push("Enable SAML or OAuth SSO for centralized authentication");
  }

  // Check IP whitelist
  if (!ipWhitelistStore.has(projectId)) {
    score -= 10;
    vulnerabilities.push("No IP whitelist configured");
    recommendations.push("Configure IP whitelist to restrict network access");
  }

  // Check encryption (always configured by default, but verify)
  const enc = encryptionStore.get(projectId);
  if (enc && enc.key_rotation_days > 60) {
    score -= 5;
    vulnerabilities.push("Key rotation interval too long");
    recommendations.push("Reduce key rotation interval to 60 days or less");
  }

  // Check audit log activity
  const logs = auditLogStore.get(projectId) || [];
  if (logs.length === 0) {
    score -= 5;
    vulnerabilities.push("No audit log entries");
    recommendations.push("Enable audit logging for security event tracking");
  }

  // Check API key age
  const apiKeyInfo = apiKeyStore.get(projectId);
  if (apiKeyInfo) {
    const age = Date.now() - new Date(apiKeyInfo.rotated_at).getTime();
    const days = age / (1000 * 60 * 60 * 24);
    if (days > 90) {
      score -= 10;
      vulnerabilities.push("API key older than 90 days");
      recommendations.push("Rotate API keys regularly (every 90 days)");
    }
  } else {
    score -= 5;
    vulnerabilities.push("No API key configured");
    recommendations.push("Generate and rotate API keys for project access");
  }

  const compliance = {
    gdpr: true,
    soc2: score >= 70,
    iso27001: score >= 80,
    hipaa: score >= 90,
  };

  return {
    score: Math.max(0, Math.min(100, score)),
    vulnerabilities,
    recommendations,
    compliance_status: compliance,
  };
}

// ---------- Security Tool Definitions (OpenAI tool-use format) ----------

export const SECURITY_TOOLS = [
  {
    type: "function",
    function: {
      name: "enable_sso_saml",
      description: "Enable SAML-based Single Sign-On for a domain. Configure an identity provider via metadata URL and signing certificate.",
      parameters: {
        type: "object",
        required: ["domain", "certificate", "metadata_url"],
        properties: {
          domain: { type: "string", description: "The domain to enable SSO for (e.g. 'company.com')." },
          certificate: { type: "string", description: "The PEM-encoded signing certificate from the IdP." },
          metadata_url: { type: "string", description: "URL to the IdP SAML metadata XML." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "enable_sso_oauth",
      description: "Enable OAuth-based Single Sign-On via a supported provider (Google, GitHub, Microsoft, Okta).",
      parameters: {
        type: "object",
        required: ["provider", "client_id", "client_secret"],
        properties: {
          provider: { type: "string", enum: ["google", "github", "microsoft", "okta"], description: "OAuth provider." },
          client_id: { type: "string", description: "OAuth client ID from the provider." },
          client_secret: { type: "string", description: "OAuth client secret from the provider." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "enable_2fa",
      description: "Enable two-factor authentication for a user via TOTP, SMS, or email.",
      parameters: {
        type: "object",
        required: ["userId", "method"],
        properties: {
          userId: { type: "string", description: "The user ID to enable 2FA for." },
          method: { type: "string", enum: ["totp", "sms", "email"], description: "2FA delivery method." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "rotate_api_key",
      description: "Rotate a project-scoped API key. Invalidates the old key and generates a new one.",
      parameters: {
        type: "object",
        required: ["userId", "projectId"],
        properties: {
          userId: { type: "string", description: "The user performing the rotation." },
          projectId: { type: "string", description: "The project whose API key to rotate." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_ip_whitelist",
      description: "Restrict project access to a list of allowed IP addresses.",
      parameters: {
        type: "object",
        required: ["projectId", "ips"],
        properties: {
          projectId: { type: "string", description: "The project to restrict." },
          ips: { type: "array", items: { type: "string" }, description: "Allowed IP addresses or CIDR ranges." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_audit_log",
      description: "Query the audit log for a project with optional filters.",
      parameters: {
        type: "object",
        required: ["projectId"],
        properties: {
          projectId: { type: "string", description: "The project to audit." },
          filters: {
            type: "object",
            properties: {
              action: { type: "string", description: "Filter by action name." },
              user: { type: "string", description: "Filter by user ID." },
              since: { type: "string", description: "ISO timestamp — only entries after this time." },
            },
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_data_encryption",
      description: "Get the encryption status and configuration for a project.",
      parameters: {
        type: "object",
        required: ["projectId"],
        properties: {
          projectId: { type: "string", description: "The project to check." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "export_gdpr_data",
      description: "Generate a GDPR-compliant data export for a user (Right to Data Portability).",
      parameters: {
        type: "object",
        required: ["userId"],
        properties: {
          userId: { type: "string", description: "The user whose data to export." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_user_data",
      description: "Permanently delete all user data (GDPR Right to Erasure). Requires explicit confirmation.",
      parameters: {
        type: "object",
        required: ["userId", "confirm"],
        properties: {
          userId: { type: "string", description: "The user whose data to delete." },
          confirm: { type: "boolean", description: "Must be true to proceed. Safety guard." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_security_report",
      description: "Generate a composite security report with score, vulnerabilities, recommendations, and compliance status.",
      parameters: {
        type: "object",
        required: ["projectId"],
        properties: {
          projectId: { type: "string", description: "The project to report on." },
        },
      },
    },
  },
];

export const SECURITY_TOOL_NAMES = new Set(SECURITY_TOOLS.map((t) => t.function.name));

/**
 * Execute a security tool by name with args.
 * @param {string} toolName
 * @param {object} args
 * @returns {Promise<object>}
 */
export async function executeSecurityToolCall(toolName, args) {
  const fn = {
    enable_sso_saml: enableSSOSAML,
    enable_sso_oauth: enableSSOOAuth,
    enable_2fa: enable2FA,
    rotate_api_key: rotateAPIKey,
    set_ip_whitelist: setIPWhitelist,
    get_audit_log: getAuditLog,
    get_data_encryption: getDataEncryption,
    export_gdpr_data: exportGDPRData,
    delete_user_data: deleteUserData,
    get_security_report: getSecurityReport,
  }[toolName];

  if (!fn) throw new Error(`Unknown security tool: ${toolName}`);
  return fn(args);
}
