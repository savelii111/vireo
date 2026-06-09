// collab_tools.js — Collaboration tools for Vireo Studio (2026-06-09).
//
// 10 tools that turn Vireo from a solo editor into a collaborative
// studio: sharing, commenting, real-time presence, version history,
// and approval workflows.
//
// All tools follow the same LLM-friendly contract:
//   - Validation upfront → return { ok: false, error }
//   - Compute result   → return { ok: true, ... }
//   - In-memory store  → no external deps for v1
//
// Architecture:
//   - Pure in-memory data stores (projects, comments, presence, etc.)
//   - Each tool is a standalone async function, easily testable
//   - Tool definitions follow OpenAI function-calling format

import { randomUUID } from "node:crypto";

// ====================================================================
// In-memory stores (v1 — will be replaced by DB)
// ====================================================================

/** @type {Map<string, object>} projectId → { id, name, shares, history } */
const _projects = new Map();

/** @type {Map<string, object[]>} projectId → [{id, text, author, time_sec, ...}] */
const _comments = new Map();

/** @type {Map<string, Map<string, object>>} projectId → userId → { position, selection, color } */
const _presence = new Map();

/** @type {Map<string, object[]>} projectId → [{action, user, timestamp, details}] */
const _history = new Map();

/** @type {Map<string, object>} approvalId → { id, projectId, reviewers, status } */
const _approvals = new Map();

const VALID_PERMISSIONS = ["view", "edit", "admin"];
const VALID_DECISIONS = ["approved", "rejected", "revision_needed"];
const VALID_COMMENT_FILTERS = ["all", "open", "resolved"];

// ====================================================================
// Helper: record an action in the project history
// ====================================================================

function _recordHistory(projectId, action, user, details = {}) {
  if (!_history.has(projectId)) _history.set(projectId, []);
  _history.get(projectId).push({
    action,
    user: user || "system",
    timestamp: new Date().toISOString(),
    details,
  });
}

// ====================================================================
// 1. shareProject — share a project with other users
// ====================================================================

/**
 * Share a project with one or more users. Each user gets a permission
 * level: view, edit, or admin.
 *
 * @param {string} projectId
 * @param {{ users: Array<{email: string, permission?: string}>, permission?: string }} opts
 * @returns {Promise<{ok: boolean, shared?: boolean, users?: object[], share_link?: string, error?: string}>}
 */
export async function shareProject(projectId, { users, permission = "view" } = {}) {
  if (!projectId) return { ok: false, error: "project_id_required" };
  if (!Array.isArray(users) || users.length === 0) return { ok: false, error: "users_required" };

  for (const u of users) {
    if (!u.email) return { ok: false, error: "each_user_must_have_email" };
    const p = u.permission || permission;
    if (!VALID_PERMISSIONS.includes(p)) return { ok: false, error: `invalid_permission: ${p}` };
  }

  if (!_projects.has(projectId)) {
    _projects.set(projectId, { id: projectId, shares: [], history: [] });
  }
  const project = _projects.get(projectId);

  const sharedUsers = [];
  for (const u of users) {
    const p = u.permission || permission;
    // upsert
    const existing = project.shares.find((s) => s.email === u.email);
    if (existing) {
      existing.permission = p;
    } else {
      project.shares.push({ email: u.email, permission: p });
    }
    sharedUsers.push({ email: u.email, permission: p });
  }

  const shareLink = `https://vireo.studio/p/${projectId}?t=${randomUUID().slice(0, 8)}`;
  _recordHistory(projectId, "share", null, { users: sharedUsers.map((u) => u.email) });

  return { ok: true, shared: true, users: sharedUsers, share_link: shareLink };
}

// ====================================================================
// 2. addComment — add a comment on a project
// ====================================================================

/**
 * Add a comment at a specific time on a track in a project.
 *
 * @param {{ projectId: string, trackId?: string, time_sec?: number, text: string, author?: string }} opts
 * @returns {Promise<{ok: boolean, id?: string, text?: string, author?: string, time_sec?: number, track_id?: string, created_at?: string, resolved?: boolean, error?: string}>}
 */
export async function addComment({ projectId, trackId = null, time_sec = 0, text, author = "anonymous" } = {}) {
  if (!projectId) return { ok: false, error: "project_id_required" };
  if (!text || typeof text !== "string" || text.trim().length === 0) return { ok: false, error: "text_required" };

  const comment = {
    id: randomUUID(),
    text: text.trim(),
    author,
    time_sec: Number(time_sec) || 0,
    track_id: trackId,
    project_id: projectId,
    created_at: new Date().toISOString(),
    resolved: false,
  };

  if (!_comments.has(projectId)) _comments.set(projectId, []);
  _comments.get(projectId).push(comment);

  _recordHistory(projectId, "add_comment", author, { comment_id: comment.id });

  return {
    ok: true,
    id: comment.id,
    text: comment.text,
    author: comment.author,
    time_sec: comment.time_sec,
    track_id: comment.track_id,
    created_at: comment.created_at,
    resolved: comment.resolved,
  };
}

// ====================================================================
// 3. resolveComment — mark a comment as resolved
// ====================================================================

/**
 * Mark a comment as resolved by its ID.
 *
 * @param {string} commentId
 * @returns {Promise<{ok: boolean, resolved?: boolean, resolved_by?: string, resolved_at?: string, error?: string}>}
 */
export async function resolveComment(commentId) {
  if (!commentId) return { ok: false, error: "comment_id_required" };

  for (const [, comments] of _comments) {
    const c = comments.find((c) => c.id === commentId);
    if (c) {
      c.resolved = true;
      c.resolved_at = new Date().toISOString();
      return { ok: true, resolved: true, resolved_by: c.author, resolved_at: c.resolved_at };
    }
  }
  return { ok: false, error: "comment_not_found" };
}

// ====================================================================
// 4. listComments — list comments for a project
// ====================================================================

/**
 * List comments for a project, optionally filtered.
 *
 * @param {string} projectId
 * @param {{ filter?: string }} opts
 * @returns {Promise<{ok: boolean, comments?: object[], total_count?: number, error?: string}>}
 */
export async function listComments(projectId, { filter = "all" } = {}) {
  if (!projectId) return { ok: false, error: "project_id_required" };
  if (!VALID_COMMENT_FILTERS.includes(filter)) return { ok: false, error: `invalid_filter: ${filter}` };

  const all = _comments.get(projectId) || [];
  let filtered = all;
  if (filter === "open") filtered = all.filter((c) => !c.resolved);
  if (filter === "resolved") filtered = all.filter((c) => c.resolved);

  const comments = filtered.map(({ id, text, author, time_sec, track_id, created_at, resolved }) => ({
    id, text, author, time_sec, track_id, created_at, resolved,
  }));

  return { ok: true, comments, total_count: comments.length };
}

// ====================================================================
// 5. getPresence — get real-time user presence
// ====================================================================

/**
 * Get the list of users currently present in a project.
 *
 * @param {string} projectId
 * @returns {Promise<{ok: boolean, users?: object[], error?: string}>}
 */
export async function getPresence(projectId) {
  if (!projectId) return { ok: false, error: "project_id_required" };

  const usersMap = _presence.get(projectId) || new Map();
  const users = [];
  for (const [userId, data] of usersMap) {
    users.push({
      id: userId,
      name: data.name || userId,
      cursor_position: data.position || 0,
      color: data.color || "#000000",
      last_active: data.last_active || new Date().toISOString(),
    });
  }

  return { ok: true, users };
}

// ====================================================================
// 6. updatePresence — update the caller's presence
// ====================================================================

/**
 * Update the caller's cursor position and selection in a project.
 *
 * @param {string} projectId
 * @param {{ userId?: string, userName?: string, position?: number, selection?: object }} opts
 * @returns {Promise<{ok: boolean, updated?: boolean, position?: number, selection?: object, error?: string}>}
 */
export async function updatePresence(projectId, { userId = "default", userName = "user", position = 0, selection = null } = {}) {
  if (!projectId) return { ok: false, error: "project_id_required" };

  if (!_presence.has(projectId)) _presence.set(projectId, new Map());
  const usersMap = _presence.get(projectId);

  // Assign a deterministic color based on user index
  const userColors = ["#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FFEAA7", "#DDA0DD", "#98D8C8", "#F7DC6F"];
  const colorIndex = usersMap.size % userColors.length;

  const existing = usersMap.get(userId);
  const color = existing?.color || userColors[colorIndex];

  usersMap.set(userId, {
    name: userName,
    position: Number(position) || 0,
    selection,
    color,
    last_active: new Date().toISOString(),
  });

  return { ok: true, updated: true, position: Number(position) || 0, selection };
}

// ====================================================================
// 7. getHistory — get edit history for a project
// ====================================================================

/**
 * Get the edit history of a project, most recent first.
 *
 * @param {string} projectId
 * @param {{ limit?: number }} opts
 * @returns {Promise<{ok: boolean, history?: object[], total_actions?: number, error?: string}>}
 */
export async function getHistory(projectId, { limit = 50 } = {}) {
  if (!projectId) return { ok: false, error: "project_id_required" };

  const all = _history.get(projectId) || [];
  const limited = all.slice(-Math.min(limit, all.length)).reverse();

  return { ok: true, history: limited, total_actions: all.length };
}

// ====================================================================
// 8. revertToVersion — revert a project to a previous version
// ====================================================================

/**
 * Revert a project to a specific version. In v1, this is a stub that
 * records the action and returns success. v2 will restore actual state.
 *
 * @param {string} projectId
 * @param {string} versionId
 * @returns {Promise<{ok: boolean, reverted?: boolean, version_id?: string, restored_to?: string, error?: string}>}
 */
export async function revertToVersion(projectId, versionId) {
  if (!projectId) return { ok: false, error: "project_id_required" };
  if (!versionId) return { ok: false, error: "version_id_required" };

  _recordHistory(projectId, "revert", null, { version_id: versionId });

  return {
    ok: true,
    reverted: true,
    version_id: versionId,
    restored_to: versionId,
  };
}

// ====================================================================
// 9. createApproval — create an approval request
// ====================================================================

/**
 * Create an approval request for a video with designated reviewers.
 *
 * @param {{ projectId: string, reviewers: Array<{email: string}> }} opts
 * @returns {Promise<{ok: boolean, id?: string, reviewers?: object[], status?: string, error?: string}>}
 */
export async function createApproval({ projectId, reviewers = [] } = {}) {
  if (!projectId) return { ok: false, error: "project_id_required" };
  if (!Array.isArray(reviewers) || reviewers.length === 0) return { ok: false, error: "reviewers_required" };

  const id = randomUUID();
  const reviewerList = reviewers.map((r) => ({
    email: r.email,
    status: "pending",
  }));

  const approval = { id, projectId, reviewers: reviewerList, status: "pending" };
  _approvals.set(id, approval);

  _recordHistory(projectId, "create_approval", null, { approval_id: id });

  return { ok: true, id, reviewers: reviewerList, status: "pending" };
}

// ====================================================================
// 10. approveVideo — approve, reject, or request revision
// ====================================================================

/**
 * A reviewer makes a decision on an approval request.
 *
 * @param {string} approvalId
 * @param {{ reviewer?: string, decision: string, comment?: string }} opts
 * @returns {Promise<{ok: boolean, decision?: string, reviewer?: string, comment?: string, timestamp?: string, error?: string}>}
 */
export async function approveVideo(approvalId, { reviewer = "anonymous", decision, comment = "" } = {}) {
  if (!approvalId) return { ok: false, error: "approval_id_required" };
  if (!VALID_DECISIONS.includes(decision)) return { ok: false, error: `invalid_decision: ${decision}` };

  const approval = _approvals.get(approvalId);
  if (!approval) return { ok: false, error: "approval_not_found" };

  // Update the specific reviewer's status
  const reviewerEntry = approval.reviewers.find((r) => r.email === reviewer);
  if (reviewerEntry) {
    reviewerEntry.status = decision;
  } else {
    approval.reviewers.push({ email: reviewer, status: decision });
  }

  // If all reviewers have decided, update overall status
  const allDecided = approval.reviewers.every((r) => r.status !== "pending");
  if (allDecided) {
    const allApproved = approval.reviewers.every((r) => r.status === "approved");
    const anyRejected = approval.reviewers.some((r) => r.status === "rejected");
    const anyRevision = approval.reviewers.some((r) => r.status === "revision_needed");

    if (allApproved) approval.status = "approved";
    else if (anyRejected) approval.status = "rejected";
    else if (anyRevision) approval.status = "revision_needed";
    else approval.status = "pending";
  }

  _recordHistory(approval.projectId, "approval_decision", reviewer, {
    approval_id: approvalId,
    decision,
    comment,
  });

  const timestamp = new Date().toISOString();
  return { ok: true, decision, reviewer, comment, timestamp };
}

// ====================================================================
// Tool definitions (OpenAI function-calling format)
// ====================================================================

export const COLLAB_TOOLS = [
  {
    type: "function",
    function: {
      name: "share_project",
      description:
        "Share a video project with other users. Each user gets a " +
        "permission level (view, edit, admin). Returns a share link " +
        "and the list of shared users. Use when the user wants to " +
        "collaborate or share their project with teammates.",
      parameters: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "The project to share." },
          users: {
            type: "array",
            items: {
              type: "object",
              properties: {
                email: { type: "string", description: "Email of the user to share with." },
                permission: { type: "string", enum: ["view", "edit", "admin"], description: "Permission level. Default: view." },
              },
              required: ["email"],
            },
            description: "Users to share with.",
          },
          permission: { type: "string", enum: ["view", "edit", "admin"], description: "Default permission for all users." },
        },
        required: ["project_id", "users"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_comment",
      description:
        "Add a comment on a project at a specific time on a track. " +
        "Use for leaving feedback, notes, or timestamped annotations.",
      parameters: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "The project ID." },
          track_id: { type: "string", description: "Optional track ID to attach comment to." },
          time_sec: { type: "number", description: "Timestamp in seconds where the comment applies." },
          text: { type: "string", description: "The comment text (required, 1-2000 chars)." },
          author: { type: "string", description: "Comment author name or email." },
        },
        required: ["project_id", "text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "resolve_comment",
      description:
        "Mark a comment as resolved. Use after feedback has been " +
        "addressed or the issue is no longer relevant.",
      parameters: {
        type: "object",
        properties: {
          comment_id: { type: "string", description: "The comment ID to resolve." },
        },
        required: ["comment_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_comments",
      description:
        "List all comments for a project. Optionally filter by " +
        "status (all, open, resolved). Use to review feedback.",
      parameters: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "The project ID." },
          filter: { type: "string", enum: ["all", "open", "resolved"], description: "Filter comments by status. Default: all." },
        },
        required: ["project_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_presence",
      description:
        "Get the list of users currently present in a project. " +
        "Shows their cursor positions and last active time. " +
        "Use for real-time collaboration awareness.",
      parameters: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "The project ID." },
        },
        required: ["project_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_presence",
      description:
        "Update the caller's cursor position and selection in a " +
        "project for real-time collaboration. Call whenever the " +
        "user's timeline position changes.",
      parameters: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "The project ID." },
          user_id: { type: "string", description: "Caller's user ID." },
          user_name: { type: "string", description: "Caller's display name." },
          position: { type: "number", description: "Current cursor position in seconds." },
          selection: { type: "object", description: "Current time selection {start, end}." },
        },
        required: ["project_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_history",
      description:
        "Get the edit history for a project. Shows all actions " +
        "(edits, comments, shares, etc.) with timestamps. " +
        "Use for audit trail or undo decisions.",
      parameters: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "The project ID." },
          limit: { type: "number", description: "Max history entries to return. Default: 50." },
        },
        required: ["project_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "revert_to_version",
      description:
        "Revert a project to a specific version. Use when the " +
        "user wants to undo changes and go back to a known good " +
        "state.",
      parameters: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "The project ID." },
          version_id: { type: "string", description: "The version ID to revert to." },
        },
        required: ["project_id", "version_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_approval",
      description:
        "Create an approval request for a video. Designates " +
        "reviewers who must approve before the video is finalized. " +
        "Use for formal review workflows.",
      parameters: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "The project ID." },
          reviewers: {
            type: "array",
            items: {
              type: "object",
              properties: {
                email: { type: "string", description: "Reviewer's email." },
              },
              required: ["email"],
            },
            description: "List of reviewers.",
          },
        },
        required: ["project_id", "reviewers"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "approve_video",
      description:
        "A reviewer makes a decision on an approval request. " +
        "Decisions: approved, rejected, revision_needed. " +
        "Use when a reviewer provides their verdict.",
      parameters: {
        type: "object",
        properties: {
          approval_id: { type: "string", description: "The approval request ID." },
          reviewer: { type: "string", description: "Reviewer's email or name." },
          decision: { type: "string", enum: ["approved", "rejected", "revision_needed"], description: "The decision." },
          comment: { type: "string", description: "Optional comment explaining the decision." },
        },
        required: ["approval_id", "decision"],
      },
    },
  },
];

// ====================================================================
// Tool name set (for quick lookup)
// ====================================================================

export const COLLAB_TOOL_NAMES = new Set(COLLAB_TOOLS.map((t) => t.function.name));

// ====================================================================
// Execute a tool call by name (for LLM integration)
// ====================================================================

/**
 * Execute a collaboration tool by name with the given arguments.
 * This is the bridge between the LLM tool_call and the actual function.
 *
 * @param {string} name - tool function name
 * @param {object} args - tool arguments
 * @returns {Promise<object>}
 */
export async function executeCollabToolCall(name, args) {
  switch (name) {
    case "share_project":
      return shareProject(args.project_id, { users: args.users, permission: args.permission });
    case "add_comment":
      return addComment({ projectId: args.project_id, trackId: args.track_id, time_sec: args.time_sec, text: args.text, author: args.author });
    case "resolve_comment":
      return resolveComment(args.comment_id);
    case "list_comments":
      return listComments(args.project_id, { filter: args.filter });
    case "get_presence":
      return getPresence(args.project_id);
    case "update_presence":
      return updatePresence(args.project_id, { userId: args.user_id, userName: args.user_name, position: args.position, selection: args.selection });
    case "get_history":
      return getHistory(args.project_id, { limit: args.limit });
    case "revert_to_version":
      return revertToVersion(args.project_id, args.version_id);
    case "create_approval":
      return createApproval({ projectId: args.project_id, reviewers: args.reviewers });
    case "approve_video":
      return approveVideo(args.approval_id, { reviewer: args.reviewer, decision: args.decision, comment: args.comment });
    default:
      return { ok: false, error: `unknown_tool: ${name}` };
  }
}
