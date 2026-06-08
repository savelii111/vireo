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
