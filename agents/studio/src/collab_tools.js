// collab_tools.js — Real-time Collaboration module for Vireo Studio.
//
// Provides 6 classes for collaborative video editing:
//   1. CollaborationHub      — session management & event broadcasting
//   2. CRDTDocument          — conflict-free replicated data type document
//   3. ConflictResolver       — patch conflict resolution strategies
//   4. CommentSystem          — threaded comments with @mentions
//   5. ApprovalWorkflow       — multi-step review & approval chains
//   6. PresenceManager        — cursor & selection presence tracking
//
// All classes are in-memory (no external deps) and follow the same
// validation pattern: return meaningful results or descriptive errors.

import { randomUUID } from "node:crypto";

// ====================================================================
// 1. CollaborationHub — Session management & event broadcasting
// ====================================================================

export class CollaborationHub {
  constructor() {
    /** @type {Map<string, Map<string, object>>} projectId → userId → session */
    this._sessions = new Map();
    /** @type {Map<string, object[]>} projectId → event log */
    this._eventLog = new Map();
    /** @type {Map<string, Function[]>} eventName → listener[] */
    this._listeners = new Map();
  }

  /**
   * Join a collaborative session for a project.
   * @param {string} projectId
   * @param {{ id: string, name?: string, color?: string }} user
   * @returns {{ ok: boolean, session?: object, error?: string }}
   */
  joinSession(projectId, user) {
    if (!projectId) return { ok: false, error: "project_id_required" };
    if (!user || !user.id) return { ok: false, error: "user_required" };

    if (!this._sessions.has(projectId)) {
      this._sessions.set(projectId, new Map());
    }
    const projectSessions = this._sessions.get(projectId);

    const session = {
      id: randomUUID(),
      projectId,
      userId: user.id,
      userName: user.name || user.id,
      color: user.color || this._assignColor(projectSessions.size),
      joinedAt: new Date().toISOString(),
      lastActive: new Date().toISOString(),
    };

    projectSessions.set(user.id, session);
    this._broadcastEvent(projectId, "user_joined", user.id, { session });
    return { ok: true, session };
  }

  /**
   * Leave a collaborative session.
   * @param {string} projectId
   * @param {string} userId
   * @returns {{ ok: boolean, removed?: boolean, error?: string }}
   */
  leaveSession(projectId, userId) {
    if (!projectId) return { ok: false, error: "project_id_required" };
    if (!userId) return { ok: false, error: "user_id_required" };

    const projectSessions = this._sessions.get(projectId);
    if (!projectSessions || !projectSessions.has(userId)) {
      return { ok: false, error: "session_not_found" };
    }

    projectSessions.delete(userId);
    if (projectSessions.size === 0) this._sessions.delete(projectId);
    this._broadcastEvent(projectId, "user_left", userId, {});
    return { ok: true, removed: true };
  }

  /**
   * Broadcast an event to all users in a project session.
   * @param {string} projectId
   * @param {string} event
   * @param {string} fromUserId
   * @param {object} [data={}]
   * @returns {{ ok: boolean, delivered?: number, error?: string }}
   */
  broadcast(projectId, event, fromUserId, data = {}) {
    if (!projectId) return { ok: false, error: "project_id_required" };
    if (!event) return { ok: false, error: "event_required" };
    if (!fromUserId) return { ok: false, error: "from_user_id_required" };

    const projectSessions = this._sessions.get(projectId);
    const delivered = projectSessions ? projectSessions.size : 0;

    this._broadcastEvent(projectId, event, fromUserId, data);
    return { ok: true, delivered };
  }

  /**
   * Get all users in a project session.
   * @param {string} projectId
   * @returns {{ ok: boolean, users?: object[], error?: string }}
   */
  getUsers(projectId) {
    if (!projectId) return { ok: false, error: "project_id_required" };
    const projectSessions = this._sessions.get(projectId);
    if (!projectSessions) return { ok: true, users: [] };
    const users = Array.from(projectSessions.values()).map((s) => ({
      id: s.userId,
      name: s.userName,
      color: s.color,
      joinedAt: s.joinedAt,
    }));
    return { ok: true, users };
  }

  /**
   * Get cursors for all users in a project (delegates to PresenceManager if set).
   * @param {string} projectId
   * @returns {{ ok: boolean, cursors?: object[], error?: string }}
   */
  getCursors(projectId) {
    if (!this._presenceManager) {
      if (!projectId) return { ok: false, error: "project_id_required" };
      return { ok: true, cursors: [] };
    }
    return this._presenceManager.getCursors(projectId);
  }

  /**
   * Get selections for all users in a project.
   * @param {string} projectId
   * @returns {{ ok: boolean, selections?: object[], error?: string }}
   */
  getSelections(projectId) {
    if (!this._presenceManager) {
      if (!projectId) return { ok: false, error: "project_id_required" };
      return { ok: true, selections: [] };
    }
    return this._presenceManager.getSelections(projectId);
  }

  /**
   * Subscribe to events.
   * @param {string} eventName
   * @param {Function} callback
   */
  on(eventName, callback) {
    if (!this._listeners.has(eventName)) this._listeners.set(eventName, []);
    this._listeners.get(eventName).push(callback);
  }

  /**
   * Set a presence manager reference for cursor/selection delegation.
   * @param {PresenceManager} pm
   */
  setPresenceManager(pm) {
    this._presenceManager = pm;
  }

  /** @private */
  _broadcastEvent(projectId, event, fromUserId, data) {
    if (!this._eventLog.has(projectId)) this._eventLog.set(projectId, []);
    const entry = { event, fromUserId, data, timestamp: new Date().toISOString() };
    this._eventLog.get(projectId).push(entry);

    const listeners = this._listeners.get(event) || [];
    for (const cb of listeners) {
      try { cb(entry); } catch { /* swallow listener errors */ }
    }
  }

  /** @private */
  _assignColor(index) {
    const colors = ["#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FFEAA7", "#DDA0DD", "#98D8C8", "#F7DC6F"];
    return colors[index % colors.length];
  }
}

// ====================================================================
// 2. CRDTDocument — Conflict-free replicated data type document
// ====================================================================

export class CRDTDocument {
  /**
   * @param {string} [docId]
   * @param {object} [initialState={}]
   */
  constructor(docId, initialState = {}) {
    this.id = docId || randomUUID();
    this._state = JSON.parse(JSON.stringify(initialState));
    /** @type {object[]} */
    this._history = [];
    /** @type {number} */
    this._historyIndex = -1;
    /** @type {Map<string, { patch: object, timestamp: string }>} */
    this._appliedPatches = new Map();
  }

  /**
   * Apply a local patch to the document.
   * @param {{ type: string, path?: string, value?: any, op?: string }} patch
   * @returns {{ ok: boolean, applied?: boolean, error?: string }}
   */
  apply(patch) {
    if (!patch || !patch.type) return { ok: false, error: "patch_required" };

    const patchId = patch.id || randomUUID();
    if (this._appliedPatches.has(patchId)) {
      return { ok: false, error: "duplicate_patch" };
    }

    try {
      this._applyPatchToState(patch);
      const entry = { ...patch, id: patchId, timestamp: new Date().toISOString(), appliedBy: "local" };
      // Trim redo history when applying new patch
      this._history = this._history.slice(0, this._historyIndex + 1);
      this._history.push(entry);
      this._historyIndex = this._history.length - 1;
      this._appliedPatches.set(patchId, { patch: entry, timestamp: entry.timestamp });
      return { ok: true, applied: true };
    } catch (e) {
      return { ok: false, error: `apply_failed: ${e.message}` };
    }
  }

  /**
   * Merge a remote patch into the document.
   * @param {{ type: string, path?: string, value?: any, op?: string, id?: string }} remotePatch
   * @returns {{ ok: boolean, merged?: boolean, error?: string }}
   */
  merge(remotePatch) {
    if (!remotePatch || !remotePatch.type) return { ok: false, error: "patch_required" };

    const patchId = remotePatch.id || randomUUID();
    if (this._appliedPatches.has(patchId)) {
      return { ok: false, error: "already_applied" };
    }

    try {
      this._applyPatchToState(remotePatch);
      const entry = { ...remotePatch, id: patchId, timestamp: new Date().toISOString(), appliedBy: "remote" };
      this._history.push(entry);
      this._historyIndex = this._history.length - 1;
      this._appliedPatches.set(patchId, { patch: entry, timestamp: entry.timestamp });
      return { ok: true, merged: true };
    } catch (e) {
      return { ok: false, error: `merge_failed: ${e.message}` };
    }
  }

  /**
   * Get the current document state.
   * @returns {{ ok: boolean, state?: object }}
   */
  getState() {
    return { ok: true, state: JSON.parse(JSON.stringify(this._state)) };
  }

  /**
   * Get the full patch history.
   * @returns {{ ok: boolean, history?: object[], count?: number }}
   */
  getHistory() {
    return { ok: true, history: [...this._history], count: this._history.length };
  }

  /**
   * Undo the last applied patch.
   * @returns {{ ok: boolean, undone?: boolean, patch?: object, error?: string }}
   */
  undo() {
    if (this._historyIndex < 0) return { ok: false, error: "nothing_to_undo" };

    const patch = this._history[this._historyIndex];
    try {
      this._reversePatch(patch);
      this._historyIndex--;
      return { ok: true, undone: true, patch };
    } catch (e) {
      return { ok: false, error: `undo_failed: ${e.message}` };
    }
  }

  /**
   * Redo the last undone patch.
   * @returns {{ ok: boolean, redone?: boolean, patch?: object, error?: string }}
   */
  redo() {
    if (this._historyIndex >= this._history.length - 1) return { ok: false, error: "nothing_to_redo" };

    const patch = this._history[this._historyIndex + 1];
    try {
      this._applyPatchToState(patch);
      this._historyIndex++;
      return { ok: true, redone: true, patch };
    } catch (e) {
      return { ok: false, error: `redo_failed: ${e.message}` };
    }
  }

  /** @private Apply a patch to the internal state. */
  _applyPatchToState(patch) {
    switch (patch.type) {
      case "set":
        if (!patch.path) throw new Error("path_required_for_set");
        patch._previousValue = this._getNested(this._state, patch.path);
        this._setNested(this._state, patch.path, patch.value);
        break;
      case "delete":
        if (!patch.path) throw new Error("path_required_for_delete");
        this._deleteNested(this._state, patch.path);
        break;
      case "merge":
        if (!patch.value || typeof patch.value !== "object") throw new Error("value_required_for_merge");
        this._state = { ...this._state, ...patch.value };
        break;
      case "replace":
        this._state = patch.value !== undefined ? JSON.parse(JSON.stringify(patch.value)) : {};
        break;
      case "array_push":
        if (!patch.path) throw new Error("path_required_for_array_push");
        const arrPush = this._getNested(this._state, patch.path);
        if (!Array.isArray(arrPush)) throw new Error(`not_an_array: ${patch.path}`);
        arrPush.push(patch.value);
        break;
      case "array_remove":
        if (!patch.path) throw new Error("path_required_for_array_remove");
        const arrRem = this._getNested(this._state, patch.path);
        if (!Array.isArray(arrRem)) throw new Error(`not_an_array: ${patch.path}`);
        const idx = arrRem.indexOf(patch.value);
        if (idx !== -1) arrRem.splice(idx, 1);
        break;
      default:
        throw new Error(`unknown_patch_type: ${patch.type}`);
    }
  }

  /** @private Reverse a patch (best-effort for undo). */
  _reversePatch(patch) {
    switch (patch.type) {
      case "set":
        if (patch._previousValue !== undefined) {
          this._setNested(this._state, patch.path, patch._previousValue);
        } else {
          this._deleteNested(this._state, patch.path);
        }
        break;
      case "delete":
        if (patch.value !== undefined) {
          this._setNested(this._state, patch.path, patch.value);
        }
        break;
      case "merge":
        // Best-effort: cannot perfectly undo a merge without snapshot
        break;
      case "replace":
        // Best-effort: cannot undo replace without previous state
        break;
      case "array_push":
        if (patch.path) {
          const arr = this._getNested(this._state, patch.path);
          if (Array.isArray(arr)) arr.pop();
        }
        break;
      case "array_remove":
        if (patch.path && patch.value !== undefined) {
          const arr = this._getNested(this._state, patch.path);
          if (Array.isArray(arr)) arr.push(patch.value);
        }
        break;
    }
  }

  /** @private */
  _getNested(obj, path) {
    const parts = path.split(".");
    let cur = obj;
    for (const p of parts) {
      if (cur == null) return undefined;
      cur = cur[p];
    }
    return cur;
  }

  /** @private */
  _setNested(obj, path, value) {
    const parts = path.split(".");
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (cur[parts[i]] == null || typeof cur[parts[i]] !== "object") {
        cur[parts[i]] = {};
      }
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
  }

  /** @private */
  _deleteNested(obj, path) {
    const parts = path.split(".");
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (cur[parts[i]] == null) return;
      cur = cur[parts[i]];
    }
    delete cur[parts[parts.length - 1]];
  }
}

// ====================================================================
// 3. ConflictResolver — Patch conflict resolution
// ====================================================================

export class ConflictResolver {
  /**
   * @param {"last-write-wins" | "merge" | "manual"} [strategy="last-write-wins"]
   */
  constructor(strategy = "last-write-wins") {
    if (!["last-write-wins", "merge", "manual"].includes(strategy)) {
      throw new Error(`invalid_strategy: ${strategy}`);
    }
    this._strategy = strategy;
    /** @type {object[]} */
    this._conflicts = [];
  }

  /** Get current strategy. */
  getStrategy() {
    return this._strategy;
  }

  /** Set resolution strategy. */
  setStrategy(strategy) {
    if (!["last-write-wins", "merge", "manual"].includes(strategy)) {
      return { ok: false, error: `invalid_strategy: ${strategy}` };
    }
    this._strategy = strategy;
    return { ok: true, strategy };
  }

  /**
   * Resolve a conflict between a local and remote patch.
   * @param {{ id?: string, type: string, path?: string, value?: any, timestamp?: string }} localPatch
   * @param {{ id?: string, type: string, path?: string, value?: any, timestamp?: string }} remotePatch
   * @returns {{ ok: boolean, resolvedPatch?: object, strategy?: string, error?: string }}
   */
  resolve(localPatch, remotePatch) {
    if (!localPatch) return { ok: false, error: "local_patch_required" };
    if (!remotePatch) return { ok: false, error: "remote_patch_required" };

    // No conflict if patches target different paths
    if (localPatch.path && remotePatch.path && localPatch.path !== remotePatch.path) {
      return { ok: true, resolvedPatch: localPatch, strategy: "no_conflict" };
    }

    // Record conflict
    this._conflicts.push({
      id: randomUUID(),
      localPatch,
      remotePatch,
      timestamp: new Date().toISOString(),
      strategy: this._strategy,
    });

    switch (this._strategy) {
      case "last-write-wins": {
        const localTime = localPatch.timestamp ? new Date(localPatch.timestamp).getTime() : 0;
        const remoteTime = remotePatch.timestamp ? new Date(remotePatch.timestamp).getTime() : 0;
        const winner = remoteTime > localTime ? remotePatch : localPatch;
        return { ok: true, resolvedPatch: winner, strategy: "last-write-wins" };
      }
      case "merge": {
        const merged = this._mergePatches(localPatch, remotePatch);
        return { ok: true, resolvedPatch: merged, strategy: "merge" };
      }
      case "manual": {
        return {
          ok: false,
          error: "manual_resolution_required",
          conflict: this._conflicts[this._conflicts.length - 1],
        };
      }
      default:
        return { ok: false, error: `unknown_strategy: ${this._strategy}` };
    }
  }

  /**
   * Get all recorded conflicts.
   * @returns {{ ok: boolean, conflicts?: object[], count?: number }}
   */
  getConflicts() {
    return { ok: true, conflicts: [...this._conflicts], count: this._conflicts.length };
  }

  /** @private Merge two patches. */
  _mergePatches(local, remote) {
    if (local.type === "set" && remote.type === "set" && local.path === remote.path) {
      // For same-path set: prefer remote value (most recent), keep local as fallback
      return {
        ...remote,
        id: randomUUID(),
        mergedFrom: [local.id, remote.id],
        value: remote.value !== undefined ? remote.value : local.value,
      };
    }
    if (local.type === "merge" && remote.type === "merge") {
      return {
        type: "merge",
        id: randomUUID(),
        mergedFrom: [local.id, remote.id],
        value: { ...(local.value || {}), ...(remote.value || {}) },
      };
    }
    // Default: combine as a merge
    return {
      type: "merge",
      id: randomUUID(),
      mergedFrom: [local.id, remote.id],
      value: {
        local: local.value,
        remote: remote.value,
      },
    };
  }
}

// ====================================================================
// 4. CommentSystem — Threaded comments with @mentions
// ====================================================================

export class CommentSystem {
  constructor() {
    /** @type {Map<string, object[]>} projectId → Comment[] */
    this._comments = new Map();
    /** @type {Map<string, object[]>} commentId → Reply[] */
    this._replies = new Map();
  }

  /**
   * Add a comment to a project.
   * @param {string} projectId
   * @param {string} userId
   * @param {{ text: string, timeCode?: number, trackId?: string }} opts
   * @returns {{ ok: boolean, comment?: object, error?: string }}
   */
  addComment(projectId, userId, { text, timeCode = 0, trackId = null } = {}) {
    if (!projectId) return { ok: false, error: "project_id_required" };
    if (!userId) return { ok: false, error: "user_id_required" };
    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return { ok: false, error: "text_required" };
    }

    const comment = {
      id: randomUUID(),
      projectId,
      userId,
      text: text.trim(),
      timeCode: Number(timeCode) || 0,
      trackId,
      mentions: this._extractMentions(text),
      resolved: false,
      createdAt: new Date().toISOString(),
    };

    if (!this._comments.has(projectId)) this._comments.set(projectId, []);
    this._comments.get(projectId).push(comment);

    return { ok: true, comment };
  }

  /**
   * Reply to an existing comment.
   * @param {string} commentId
   * @param {string} userId
   * @param {string} text
   * @returns {{ ok: boolean, reply?: object, error?: string }}
   */
  replyToComment(commentId, userId, text) {
    if (!commentId) return { ok: false, error: "comment_id_required" };
    if (!userId) return { ok: false, error: "user_id_required" };
    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return { ok: false, error: "text_required" };
    }

    const comment = this._findComment(commentId);
    if (!comment) return { ok: false, error: "comment_not_found" };

    const reply = {
      id: randomUUID(),
      commentId,
      userId,
      text: text.trim(),
      mentions: this._extractMentions(text),
      createdAt: new Date().toISOString(),
    };

    if (!this._replies.has(commentId)) this._replies.set(commentId, []);
    this._replies.get(commentId).push(reply);

    return { ok: true, reply };
  }

  /**
   * Resolve a comment.
   * @param {string} commentId
   * @param {string} userId
   * @returns {{ ok: boolean, resolved?: boolean, error?: string }}
   */
  resolveComment(commentId, userId) {
    if (!commentId) return { ok: false, error: "comment_id_required" };
    if (!userId) return { ok: false, error: "user_id_required" };

    const comment = this._findComment(commentId);
    if (!comment) return { ok: false, error: "comment_not_found" };

    comment.resolved = true;
    comment.resolvedBy = userId;
    comment.resolvedAt = new Date().toISOString();

    return { ok: true, resolved: true };
  }

  /**
   * Get all comments for a project.
   * @param {string} projectId
   * @returns {{ ok: boolean, comments?: object[], count?: number, error?: string }}
   */
  getComments(projectId) {
    if (!projectId) return { ok: false, error: "project_id_required" };
    const comments = this._comments.get(projectId) || [];
    const enriched = comments.map((c) => ({
      ...c,
      replies: this._replies.get(c.id) || [],
    }));
    return { ok: true, comments: enriched, count: enriched.length };
  }

  /**
   * Get unresolved comments for a project.
   * @param {string} projectId
   * @returns {{ ok: boolean, comments?: object[], count?: number, error?: string }}
   */
  getUnresolved(projectId) {
    if (!projectId) return { ok: false, error: "project_id_required" };
    const comments = (this._comments.get(projectId) || []).filter((c) => !c.resolved);
    const enriched = comments.map((c) => ({
      ...c,
      replies: this._replies.get(c.id) || [],
    }));
    return { ok: true, comments: enriched, count: enriched.length };
  }

  /**
   * Get comments that mention a specific user.
   * @param {string} projectId
   * @param {string} userId
   * @returns {{ ok: boolean, mentions?: object[], count?: number, error?: string }}
   */
  getMentions(projectId, userId) {
    if (!projectId) return { ok: false, error: "project_id_required" };
    if (!userId) return { ok: false, error: "user_id_required" };

    const comments = this._comments.get(projectId) || [];
    const mentions = comments.filter((c) => c.mentions && c.mentions.includes(userId));
    return { ok: true, mentions, count: mentions.length };
  }

  /** @private Find a comment by ID across all projects. */
  _findComment(commentId) {
    for (const [, comments] of this._comments) {
      const found = comments.find((c) => c.id === commentId);
      if (found) return found;
    }
    return null;
  }

  /** @private Extract @mentions from text. */
  _extractMentions(text) {
    const matches = text.match(/@(\w+)/g) || [];
    return matches.map((m) => m.slice(1));
  }
}

// ====================================================================
// 5. ApprovalWorkflow — Multi-step review & approval chains
// ====================================================================

export class ApprovalWorkflow {
  constructor() {
    /** @type {Map<string, object>} reviewId → Review */
    this._reviews = new Map();
    /** @type {Map<string, object[]>} projectId → Review[] */
    this._projectReviews = new Map();
  }

  /**
   * Submit a project for review.
   * @param {string} projectId
   * @param {string} userId
   * @returns {{ ok: boolean, review?: object, error?: string }}
   */
  submitForReview(projectId, userId) {
    if (!projectId) return { ok: false, error: "project_id_required" };
    if (!userId) return { ok: false, error: "user_id_required" };

    const review = {
      id: randomUUID(),
      projectId,
      submittedBy: userId,
      status: "pending",
      submittedAt: new Date().toISOString(),
      approvals: [],
    };

    this._reviews.set(review.id, review);
    if (!this._projectReviews.has(projectId)) this._projectReviews.set(projectId, []);
    this._projectReviews.get(projectId).push(review);

    return { ok: true, review };
  }

  /**
   * Approve a review.
   * @param {string} reviewId
   * @param {string} userId
   * @param {{ comment?: string }} [opts={}]
   * @returns {{ ok: boolean, approved?: boolean, error?: string }}
   */
  approve(reviewId, userId, { comment = "" } = {}) {
    if (!reviewId) return { ok: false, error: "review_id_required" };
    if (!userId) return { ok: false, error: "user_id_required" };

    const review = this._reviews.get(reviewId);
    if (!review) return { ok: false, error: "review_not_found" };

    // Check for duplicate approval from same user
    const existing = review.approvals.find((a) => a.userId === userId);
    if (existing) return { ok: false, error: "already_approved" };

    review.approvals.push({
      userId,
      decision: "approved",
      comment,
      timestamp: new Date().toISOString(),
    });

    review.status = "approved";
    return { ok: true, approved: true };
  }

  /**
   * Reject a review.
   * @param {string} reviewId
   * @param {string} userId
   * @param {{ reason?: string }} [opts={}]
   * @returns {{ ok: boolean, rejected?: boolean, error?: string }}
   */
  reject(reviewId, userId, { reason = "" } = {}) {
    if (!reviewId) return { ok: false, error: "review_id_required" };
    if (!userId) return { ok: false, error: "user_id_required" };

    const review = this._reviews.get(reviewId);
    if (!review) return { ok: false, error: "review_not_found" };

    const existing = review.approvals.find((a) => a.userId === userId);
    if (existing) return { ok: false, error: "already_reviewed" };

    review.approvals.push({
      userId,
      decision: "rejected",
      reason,
      timestamp: new Date().toISOString(),
    });

    review.status = "rejected";
    return { ok: true, rejected: true };
  }

  /**
   * Get all reviews for a project.
   * @param {string} projectId
   * @returns {{ ok: boolean, reviews?: object[], count?: number, error?: string }}
   */
  getReviews(projectId) {
    if (!projectId) return { ok: false, error: "project_id_required" };
    const reviews = this._projectReviews.get(projectId) || [];
    return { ok: true, reviews: [...reviews], count: reviews.length };
  }

  /**
   * Get the approval chain (ordered steps) for a project's latest review.
   * @param {string} projectId
   * @returns {{ ok: boolean, steps?: object[], error?: string }}
   */
  getApprovalChain(projectId) {
    if (!projectId) return { ok: false, error: "project_id_required" };
    const reviews = this._projectReviews.get(projectId) || [];
    if (reviews.length === 0) return { ok: true, steps: [] };

    const latest = reviews[reviews.length - 1];
    const steps = latest.approvals.map((a, i) => ({
      step: i + 1,
      userId: a.userId,
      decision: a.decision,
      comment: a.comment || a.reason || "",
      timestamp: a.timestamp,
    }));

    return { ok: true, steps };
  }
}

// ====================================================================
// 6. PresenceManager — Cursor & selection presence tracking
// ====================================================================

export class PresenceManager {
  constructor() {
    /** @type {Map<string, object>} userId → User */
    this._users = new Map();
    /** @type {Map<string, object>} userId → Cursor */
    this._cursors = new Map();
    /** @type {Map<string, object>} userId → Selection */
    this._selections = new Map();
  }

  /**
   * Set a user's cursor position.
   * @param {string} userId
   * @param {{ x: number, y: number, trackId?: string, timeCode?: number }} pos
   * @returns {{ ok: boolean, cursor?: object, error?: string }}
   */
  setCursor(userId, { x = 0, y = 0, trackId = null, timeCode = 0 } = {}) {
    if (!userId) return { ok: false, error: "user_id_required" };

    const cursor = {
      userId,
      x: Number(x) || 0,
      y: Number(y) || 0,
      trackId,
      timeCode: Number(timeCode) || 0,
      updatedAt: new Date().toISOString(),
    };

    this._cursors.set(userId, cursor);
    return { ok: true, cursor };
  }

  /**
   * Set a user's selection range.
   * @param {string} userId
   * @param {{ trackId: string, startFrame: number, endFrame: number }} sel
   * @returns {{ ok: boolean, selection?: object, error?: string }}
   */
  setSelection(userId, { trackId, startFrame, endFrame } = {}) {
    if (!userId) return { ok: false, error: "user_id_required" };
    if (!trackId) return { ok: false, error: "track_id_required" };

    const selection = {
      userId,
      trackId,
      startFrame: Number(startFrame) || 0,
      endFrame: Number(endFrame) || 0,
      updatedAt: new Date().toISOString(),
    };

    this._selections.set(userId, selection);
    return { ok: true, selection };
  }

  /**
   * Set/register a user.
   * @param {{ id: string, name?: string, color?: string }} user
   * @returns {{ ok: boolean, user?: object, error?: string }}
   */
  setUser(user) {
    if (!user || !user.id) return { ok: false, error: "user_required" };

    const entry = {
      id: user.id,
      name: user.name || user.id,
      color: user.color || this._assignColor(this._users.size),
      lastActive: new Date().toISOString(),
    };

    this._users.set(user.id, entry);
    return { ok: true, user: entry };
  }

  /**
   * Remove a user from presence.
   * @param {string} userId
   * @returns {{ ok: boolean, removed?: boolean, error?: string }}
   */
  removeUser(userId) {
    if (!userId) return { ok: false, error: "user_id_required" };

    const existed = this._users.has(userId);
    this._users.delete(userId);
    this._cursors.delete(userId);
    this._selections.delete(userId);

    return { ok: true, removed: existed };
  }

  /**
   * Get all tracked users.
   * @returns {{ ok: boolean, users?: object[], count?: number }}
   */
  getUsers() {
    const users = Array.from(this._users.values());
    return { ok: true, users, count: users.length };
  }

  /**
   * Get all cursors.
   * @returns {{ ok: boolean, cursors?: object[], count?: number }}
   */
  getCursors() {
    const cursors = Array.from(this._cursors.values());
    return { ok: true, cursors, count: cursors.length };
  }

  /**
   * Get all selections.
   * @returns {{ ok: boolean, selections?: object[], count?: number }}
   */
  getSelections() {
    const selections = Array.from(this._selections.values());
    return { ok: true, selections, count: selections.length };
  }

  /**
   * Remove users inactive longer than maxInactiveMs.
   * @param {number} [maxInactiveMs=300000] — default 5 minutes
   * @returns {{ ok: boolean, removed?: number, error?: string }}
   */
  cleanup(maxInactiveMs = 300000) {
    if (typeof maxInactiveMs !== "number" || maxInactiveMs <= 0) {
      return { ok: false, error: "invalid_max_inactive_ms" };
    }

    const now = Date.now();
    let removed = 0;

    for (const [userId, cursor] of this._cursors) {
      const elapsed = now - new Date(cursor.updatedAt).getTime();
      if (elapsed > maxInactiveMs) {
        this.removeUser(userId);
        removed++;
      }
    }

    return { ok: true, removed };
  }

  /** @private */
  _assignColor(index) {
    const colors = ["#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FFEAA7", "#DDA0DD", "#98D8C8", "#F7DC6F"];
    return colors[index % colors.length];
  }
}

// ====================================================================
// Exported class names for convenience
// ====================================================================

export const COLLAB_CLASSES = [
  "CollaborationHub",
  "CRDTDocument",
  "ConflictResolver",
  "CommentSystem",
  "ApprovalWorkflow",
  "PresenceManager",
];
