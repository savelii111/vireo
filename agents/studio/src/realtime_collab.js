// realtime_collab.js — Real-time Collaboration with WebRTC CRDT system for Vireo Studio.
//
// "Figma for video editing" — multiple users edit simultaneously.
//
// Provides 7 classes:
//   1. CollaborationServer    — WebSocket server lifecycle & connection tracking
//   2. CollaborationSession   — per-room join/leave, broadcasting, region locking
//   3. WebRTCSignaling        — WebRTC offer/answer/ICE candidate relay
//   4. CursorPresence         — live cursor positions & selection regions
//   5. CRDTSyncEngine         — operation log, merge, undo/redo, conflict resolution
//   6. PermissionSystem       — role-based access (owner/editor/commenter/viewer)
//   7. VersionHistory         — snapshots, diffs, auto-save
//
// All classes are in-memory (no external deps) and follow the same
// validation pattern: return meaningful results or descriptive errors.

import { randomUUID } from "node:crypto";

// ====================================================================
// 1. CollaborationServer — WebSocket server lifecycle & connection tracking
// ====================================================================

export class CollaborationServer {
  constructor({ port = 8080 } = {}) {
    this._port = port;
    this._running = false;
    this._startedAt = null;
    this._connections = new Map(); // connectionId → { userId, sessionId, joinedAt }
    this._sessions = new Map();   // sessionId → CollaborationSession
  }

  /** Start the collaboration server. */
  start() {
    if (this._running) return { port: this._port, status: "already_running" };
    this._running = true;
    this._startedAt = Date.now();
    return { port: this._port, status: "running" };
  }

  /** Stop the collaboration server. */
  stop() {
    if (!this._running) return { status: "already_stopped" };
    this._running = false;
    this._connections.clear();
    this._sessions.clear();
    return { status: "stopped" };
  }

  /** Get server status. */
  getStatus() {
    return {
      running: this._running,
      connections: this._connections.size,
      uptime_ms: this._running && this._startedAt ? Date.now() - this._startedAt : 0,
    };
  }

  /** Register a new connection (used internally). */
  addConnection(connectionId, info = {}) {
    this._connections.set(connectionId, {
      userId: info.userId || null,
      sessionId: info.sessionId || null,
      joinedAt: new Date().toISOString(),
    });
    return this._connections.get(connectionId);
  }

  /** Remove a connection. */
  removeConnection(connectionId) {
    return this._connections.delete(connectionId);
  }

  /** Get connection info. */
  getConnection(connectionId) {
    return this._connections.get(connectionId) || null;
  }
}

// ====================================================================
// 2. CollaborationSession — per-room join/leave, broadcasting, region locking
// ====================================================================

export class CollaborationSession {
  constructor(sessionId) {
    this.sessionId = sessionId || randomUUID();
    /** @type {Map<string, SessionMember>} */
    this._members = new Map();
    /** @type {Message[]} */
    this._messages = [];
    /** @type {Map<string, Lock>} regionId → Lock */
    this._locks = new Map();
  }

  /**
   * Join a user to the session.
   * @param {string} userId
   * @param {object} userInfo - { name?, color?, avatar? }
   * @returns {SessionMember}
   */
  join(userId, userInfo = {}) {
    if (!userId) return { error: "userId_required" };
    if (this._members.has(userId)) {
      return this._members.get(userId); // already joined
    }
    const member = {
      id: userId,
      name: userInfo.name || userId,
      color: userInfo.color || this._assignColor(this._members.size),
      avatar: userInfo.avatar || null,
      joinedAt: new Date().toISOString(),
      lastActive: new Date().toISOString(),
    };
    this._members.set(userId, member);
    this._messages.push({
      id: randomUUID(),
      type: "system",
      userId,
      text: `${member.name} joined`,
      timestamp: new Date().toISOString(),
    });
    return member;
  }

  /** Remove a user from the session. */
  leave(userId) {
    if (!this._members.has(userId)) return { error: "user_not_found" };
    const member = this._members.get(userId);
    this._members.delete(userId);
    this._messages.push({
      id: randomUUID(),
      type: "system",
      userId,
      text: `${member.name} left`,
      timestamp: new Date().toISOString(),
    });
    // Release any locks held by this user
    for (const [regionId, lock] of this._locks) {
      if (lock.userId === userId) this._locks.delete(regionId);
    }
    return { removed: true };
  }

  /** Get all current members. */
  getUsers() {
    return [...this._members.values()];
  }

  /**
   * Broadcast a message from one user to all others.
   * @param {string} userId - sender
   * @param {object} message - { type, payload }
   * @returns {BroadcastResult}
   */
  broadcast(userId, message) {
    if (!this._members.has(userId)) return { error: "sender_not_in_session" };
    const msg = {
      id: randomUUID(),
      type: message.type || "chat",
      userId,
      payload: message.payload || message,
      timestamp: new Date().toISOString(),
    };
    this._messages.push(msg);
    return {
      ok: true,
      message: msg,
      recipientCount: this._members.size - 1,
      recipients: [...this._members.keys()].filter((id) => id !== userId),
    };
  }

  /** Get full message history. */
  getMessageHistory() {
    return [...this._messages];
  }

  /**
   * Lock a timeline region so only one user edits it.
   * @param {string} userId
   * @param {{ track: string, start: number, end: number }} region
   * @returns {Lock}
   */
  lockRegion(userId, region) {
    if (!userId) return { error: "userId_required" };
    if (!region) return { error: "region_required" };
    if (!this._members.has(userId)) return { error: "user_not_in_session" };

    const regionId = `${region.track}:${region.start}:${region.end}`;
    // Check if already locked by someone else
    if (this._locks.has(regionId)) {
      const existing = this._locks.get(regionId);
      if (existing.userId !== userId) {
        return { error: "region_already_locked", lockedBy: existing.userId };
      }
      return existing; // already locked by same user
    }

    const lock = {
      id: randomUUID(),
      userId,
      regionId,
      track: region.track,
      start: region.start,
      end: region.end,
      lockedAt: new Date().toISOString(),
    };
    this._locks.set(regionId, lock);
    this._messages.push({
      id: randomUUID(),
      type: "lock",
      userId,
      text: `Locked region ${regionId}`,
      timestamp: lock.lockedAt,
    });
    return lock;
  }

  /** Unlock a previously locked region. */
  unlockRegion(userId, regionId) {
    if (!this._locks.has(regionId)) return { error: "lock_not_found" };
    const lock = this._locks.get(regionId);
    if (lock.userId !== userId) return { error: "not_lock_owner" };
    this._locks.delete(regionId);
    this._messages.push({
      id: randomUUID(),
      type: "unlock",
      userId,
      text: `Unlocked region ${regionId}`,
      timestamp: new Date().toISOString(),
    });
    return { unlocked: true };
  }

  /** Get all active locks. */
  getLocks() {
    return [...this._locks.values()];
  }

  /** @private */
  _assignColor(index) {
    const colors = [
      "#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4",
      "#FFEAA7", "#DDA0DD", "#98D8C8", "#F7DC6F",
      "#BB8FCE", "#85C1E9", "#F1948A", "#82E0AA",
    ];
    return colors[index % colors.length];
  }
}

// ====================================================================
// 3. WebRTCSignaling — WebRTC offer/answer/ICE candidate relay
// ====================================================================

export class WebRTCSignaling {
  constructor() {
    /** @type {Map<string, Room>} */
    this._rooms = new Map();
  }

  /**
   * Create a signaling room.
   * @param {string} roomId
   * @returns {Room}
   */
  createRoom(roomId) {
    const id = roomId || randomUUID();
    if (this._rooms.has(id)) return this._rooms.get(id);
    const room = {
      id,
      members: new Map(),
      createdAt: new Date().toISOString(),
    };
    this._rooms.set(id, room);
    return {
      id: room.id,
      members: [],
      createdAt: room.createdAt,
    };
  }

  /**
   * Join a user to a signaling room.
   * @param {string} roomId
   * @param {string} userId
   * @returns {RoomMember}
   */
  joinRoom(roomId, userId) {
    if (!this._rooms.has(roomId)) return { error: "room_not_found" };
    const room = this._rooms.get(roomId);
    if (room.members.has(userId)) return room.members.get(userId);
    const member = {
      userId,
      joinedAt: new Date().toISOString(),
    };
    room.members.set(userId, member);
    return member;
  }

  /** Leave a signaling room. */
  leaveRoom(roomId, userId) {
    if (!this._rooms.has(roomId)) return { error: "room_not_found" };
    const room = this._rooms.get(roomId);
    if (!room.members.has(userId)) return { error: "user_not_in_room" };
    room.members.delete(userId);
    return { removed: true };
  }

  /**
   * Send an SDP offer from one user to another.
   */
  sendOffer(roomId, from, to, offer) {
    return this._sendSignal(roomId, from, to, "offer", offer);
  }

  /**
   * Send an SDP answer from one user to another.
   */
  sendAnswer(roomId, from, to, answer) {
    return this._sendSignal(roomId, from, to, "answer", answer);
  }

  /**
   * Send an ICE candidate from one user to another.
   */
  sendCandidate(roomId, from, to, candidate) {
    return this._sendSignal(roomId, from, to, "candidate", candidate);
  }

  /** Get room info. */
  getRoom(roomId) {
    const room = this._rooms.get(roomId);
    if (!room) return null;
    return {
      id: room.id,
      members: [...room.members.keys()],
      createdAt: room.createdAt,
    };
  }

  /** Get all rooms. */
  getRooms() {
    return [...this._rooms.values()].map((r) => ({
      id: r.id,
      members: [...r.members.keys()],
      createdAt: r.createdAt,
    }));
  }

  /** @private */
  _sendSignal(roomId, from, to, signalType, data) {
    if (!this._rooms.has(roomId)) return { error: "room_not_found" };
    const room = this._rooms.get(roomId);
    if (!room.members.has(from)) return { error: "sender_not_in_room" };
    if (!room.members.has(to)) return { error: "recipient_not_in_room" };

    const msg = {
      id: randomUUID(),
      type: signalType,
      from,
      to,
      data,
      timestamp: new Date().toISOString(),
    };
    return msg;
  }
}

// ====================================================================
// 4. CursorPresence — live cursor positions & selection regions
// ====================================================================

export class CursorPresence {
  constructor() {
    /** @type {Map<string, Cursor>} */
    this._cursors = new Map();
    /** @type {Map<string, Selection>} */
    this._selections = new Map();
  }

  /**
   * Set a user's cursor position.
   * @param {string} userId
   * @param {{ x: number, y: number, track?: string, timecode?: string }} pos
   * @returns {Cursor}
   */
  setCursor(userId, pos) {
    if (!userId) return { error: "userId_required" };
    const cursor = {
      userId,
      x: pos.x ?? 0,
      y: pos.y ?? 0,
      track: pos.track || null,
      timecode: pos.timecode || null,
      updatedAt: new Date().toISOString(),
    };
    this._cursors.set(userId, cursor);
    return cursor;
  }

  /** Get all cursors. */
  getCursors() {
    return [...this._cursors.values()];
  }

  /** Get a single user's cursor. */
  getCursor(userId) {
    return this._cursors.get(userId) || null;
  }

  /**
   * Set a user's active selection on the timeline.
   * @param {string} userId
   * @param {{ track: string, start: number, end: number }} sel
   * @returns {Selection}
   */
  setSelection(userId, sel) {
    if (!userId) return { error: "userId_required" };
    if (!sel || !sel.track) return { error: "track_required" };
    const selection = {
      userId,
      track: sel.track,
      start: sel.start ?? 0,
      end: sel.end ?? 0,
      updatedAt: new Date().toISOString(),
    };
    this._selections.set(userId, selection);
    return selection;
  }

  /** Get all active selections. */
  getSelections() {
    return [...this._selections.values()];
  }

  /** Remove all presence data for a user. */
  removeUser(userId) {
    const hadCursor = this._cursors.delete(userId);
    const hadSelection = this._selections.delete(userId);
    return { removedCursor: hadCursor, removedSelection: hadSelection };
  }

  /** Get all users with presence data. */
  getUsers() {
    const userMap = new Map();
    for (const c of this._cursors.values()) {
      if (!userMap.has(c.userId)) userMap.set(c.userId, { userId: c.userId, cursor: c, selection: null });
      else userMap.get(c.userId).cursor = c;
    }
    for (const s of this._selections.values()) {
      if (!userMap.has(s.userId)) userMap.set(s.userId, { userId: s.userId, cursor: null, selection: s });
      else userMap.get(s.userId).selection = s;
    }
    return [...userMap.values()];
  }
}

// ====================================================================
// 5. CRDTSyncEngine — operation log, merge, undo/redo, conflict resolution
// ====================================================================

export class CRDTSyncEngine {
  constructor() {
    /** @type {Operation[]} */
    this._operations = [];
    /** @type {Map<string, Operation[]>} userId → undo stack */
    this._undoStacks = new Map();
    /** @type {Conflict[]} */
    this._conflicts = [];
    /** @type {State} */
    this._state = { tracks: [], metadata: {} };
  }

  /**
   * Apply a single CRDT operation.
   * @param {Operation} op - { type, userId, target?, data?, vectorClock? }
   * @returns {ApplyResult}
   */
  applyOperation(op) {
    if (!op || !op.type) return { error: "op_type_required" };
    if (!op.userId) return { error: "userId_required" }

    const operation = {
      id: randomUUID(),
      type: op.type,
      userId: op.userId,
      target: op.target || null,
      data: op.data || {},
      vectorClock: op.vectorClock || {},
      timestamp: new Date().toISOString(),
    };

    // Detect conflicts with existing operations
    const conflict = this._detectConflict(operation);
    if (conflict) {
      this._conflicts.push(conflict);
      return { ok: true, operation, conflict: conflict.id };
    }

    this._operations.push(operation);
    this._applyToState(operation);

    // Push to undo stack
    if (!this._undoStacks.has(op.userId)) this._undoStacks.set(op.userId, []);
    this._undoStacks.get(op.userId).push(operation);

    return { ok: true, operation };
  }

  /**
   * Merge multiple operations in causal order.
   * @param {Operation[]} ops
   * @returns {MergedResult}
   */
  mergeOperations(ops) {
    if (!Array.isArray(ops)) return { error: "ops_must_be_array" };

    // Sort by timestamp to simulate causal ordering
    const sorted = [...ops]
      .filter((o) => o && o.type && o.userId)
      .sort((a, b) => (a.timestamp || "").localeCompare(b.timestamp || ""));

    const applied = [];
    const conflicts = [];

    for (const op of sorted) {
      const result = this.applyOperation(op);
      if (result.error) {
        conflicts.push({ op, error: result.error });
      } else if (result.conflict) {
        conflicts.push({ op: result.operation, conflictId: result.conflict });
      } else {
        applied.push(result.operation);
      }
    }

    return { applied: applied.length, conflicts: conflicts.length, details: { applied, conflicts } };
  }

  /** Get the full operation history. */
  getHistory() {
    return [...this._operations];
  }

  /** Get the current document state. */
  getState() {
    return structuredClone(this._state);
  }

  /**
   * Undo the last operation by a user.
   * @param {string} userId
   * @returns {UndoResult}
   */
  undo(userId) {
    const stack = this._undoStacks.get(userId);
    if (!stack || stack.length === 0) return { error: "nothing_to_undo" };
    const op = stack.pop();
    const inverseOp = {
      id: randomUUID(),
      type: "inverse_" + op.type,
      userId,
      target: op.target,
      data: { original: op.data },
      vectorClock: op.vectorClock,
      timestamp: new Date().toISOString(),
    };
    this._operations.push(inverseOp);
    this._applyToState(inverseOp);
    return { ok: true, undone: op, inverse: inverseOp };
  }

  /**
   * Redo the last undone operation by a user.
   * @param {string} userId
   * @returns {RedoResult}
   */
  redo(userId) {
    // Simplified: find last inverse operation and re-apply
    const inverseOps = this._operations.filter(
      (o) => o.userId === userId && o.type.startsWith("inverse_")
    );
    if (inverseOps.length === 0) return { error: "nothing_to_redo" };
    const lastInverse = inverseOps[inverseOps.length - 1];
    const redoOp = {
      id: randomUUID(),
      type: lastInverse.type.replace("inverse_", ""),
      userId,
      target: lastInverse.target,
      data: lastInverse.data?.original || {},
      vectorClock: lastInverse.vectorClock,
      timestamp: new Date().toISOString(),
    };
    this._operations.push(redoOp);
    this._applyToState(redoOp);
    // Push to undo stack
    if (!this._undoStacks.has(userId)) this._undoStacks.set(userId, []);
    this._undoStacks.get(userId).push(redoOp);
    return { ok: true, redone: redoOp };
  }

  /** Get all detected conflicts. */
  getConflicts() {
    return [...this._conflicts];
  }

  /**
   * Resolve a conflict with a chosen resolution.
   * @param {string} conflictId
   * @param {{ winner: string, mergedData?: object }} resolution
   * @returns {Resolved}
   */
  resolveConflict(conflictId, resolution) {
    const idx = this._conflicts.findIndex((c) => c.id === conflictId);
    if (idx === -1) return { error: "conflict_not_found" };
    const conflict = this._conflicts[idx];
    conflict.resolved = true;
    conflict.resolution = resolution;
    conflict.resolvedAt = new Date().toISOString();

    // Apply winning operation if available
    if (resolution.winner && conflict.operations) {
      const winner = conflict.operations.find((o) => o.userId === resolution.winner);
      if (winner) {
        this._operations.push(winner);
        this._applyToState(winner);
      }
    }

    return { ok: true, conflictId, resolution };
  }

  /** @private */
  _detectConflict(op) {
    // Check for concurrent operations on the same target
    const recentOps = this._operations.filter(
      (o) => o.target && op.target && o.target === op.target && o.userId !== op.userId && o.type === op.type
    );
    if (recentOps.length > 0) {
      return {
        id: randomUUID(),
        target: op.target,
        type: op.type,
        operations: [...recentOps, op],
        detectedAt: new Date().toISOString(),
        resolved: false,
      };
    }
    return null;
  }

  /** @private */
  _applyToState(op) {
    switch (op.type) {
      case "add_track":
        this._state.tracks.push(op.data);
        break;
      case "remove_track":
        this._state.tracks = this._state.tracks.filter((_, i) => i !== (op.data.index ?? -1));
        break;
      case "update_metadata":
        Object.assign(this._state.metadata, op.data);
        break;
      case "move_clip":
        // Simplified: log the move
        break;
      default:
        break;
    }
  }
}

// ====================================================================
// 6. PermissionSystem — role-based access control
// ====================================================================

export class PermissionSystem {
  constructor() {
    /** @type {Map<string, Role>} */
    this._roles = new Map();
    /** @type {Map<string, SharedAccess[]>} */
    this._shared = new Map();
    this._ROLE_HIERARCHY = { owner: 4, editor: 3, commenter: 2, viewer: 1 };
  }

  /**
   * Set a user's role.
   * @param {string} userId
   * @param {'owner'|'editor'|'commenter'|'viewer'} role
   * @returns {Role}
   */
  setRole(userId, role) {
    if (!userId) return { error: "userId_required" };
    const validRoles = ["owner", "editor", "commenter", "viewer"];
    if (!validRoles.includes(role)) return { error: "invalid_role", validRoles };
    const roleObj = {
      userId,
      role,
      setAt: new Date().toISOString(),
    };
    this._roles.set(userId, roleObj);
    return roleObj;
  }

  /** Get a user's role. */
  getRole(userId) {
    return this._roles.get(userId) || null;
  }

  /** Check if user can edit. */
  canEdit(userId) {
    const r = this._roles.get(userId);
    return r ? this._ROLE_HIERARCHY[r.role] >= this._ROLE_HIERARCHY["editor"] : false;
  }

  /** Check if user can comment. */
  canComment(userId) {
    const r = this._roles.get(userId);
    return r ? this._ROLE_HIERARCHY[r.role] >= this._ROLE_HIERARCHY["commenter"] : false;
  }

  /** Check if user can view. */
  canView(userId) {
    const r = this._roles.get(userId);
    return r ? this._ROLE_HIERARCHY[r.role] >= this._ROLE_HIERARCHY["viewer"] : false;
  }

  /** Check if user can share. */
  canShare(userId) {
    const r = this._roles.get(userId);
    return r ? this._ROLE_HIERARCHY[r.role] >= this._ROLE_HIERARCHY["owner"] : false;
  }

  /**
   * Get full permission set for a user.
   * @param {string} userId
   * @returns {PermissionSet}
   */
  getPermissions(userId) {
    const r = this._roles.get(userId);
    if (!r) return { userId, role: null, canEdit: false, canComment: false, canView: false, canShare: false };
    const lvl = this._ROLE_HIERARCHY[r.role];
    return {
      userId,
      role: r.role,
      canEdit: lvl >= this._ROLE_HIERARCHY["editor"],
      canComment: lvl >= this._ROLE_HIERARCHY["commenter"],
      canView: lvl >= this._ROLE_HIERARCHY["viewer"],
      canShare: lvl >= this._ROLE_HIERARCHY["owner"],
    };
  }

  /**
   * Share access with another user.
   * @param {string} userId
   * @param {'owner'|'editor'|'commenter'|'viewer'} role
   * @param {Date} [expires] - optional expiration
   * @returns {SharedAccess}
   */
  shareWith(userId, role, expires) {
    if (!userId) return { error: "userId_required" };
    const validRoles = ["owner", "editor", "commenter", "viewer"];
    if (!validRoles.includes(role)) return { error: "invalid_role" };
    const access = {
      id: randomUUID(),
      userId,
      role,
      sharedAt: new Date().toISOString(),
      expires: expires ? expires.toISOString() : null,
    };
    if (!this._shared.has(userId)) this._shared.set(userId, []);
    this._shared.get(userId).push(access);
    this.setRole(userId, role);
    return access;
  }

  /** Revoke a user's access. */
  revokeAccess(userId) {
    const removed = this._roles.delete(userId);
    this._shared.delete(userId);
    return { removed };
  }

  /** Get all users with shared access. */
  getSharedUsers() {
    const users = [];
    for (const [userId, accessList] of this._shared) {
      users.push({ userId, access: accessList });
    }
    return users;
  }
}

// ====================================================================
// 7. VersionHistory — snapshots, diffs, auto-save
// ====================================================================

export class VersionHistory {
  constructor() {
    /** @type {Map<string, Version[]>} projectId → versions */
    this._versions = new Map();
    /** @type {Map<string, AutoSave[]>} projectId → auto-saves */
    this._autoSaves = new Map();
  }

  /**
   * Save a named version of a project.
   * @param {string} projectId
   * @param {{ author: string, description?: string, state?: object }} opts
   * @returns {Version}
   */
  saveVersion(projectId, { author, description, state } = {}) {
    if (!projectId) return { error: "projectId_required" };
    if (!author) return { error: "author_required" };
    if (!this._versions.has(projectId)) this._versions.set(projectId, []);

    const versions = this._versions.get(projectId);
    const version = {
      id: randomUUID(),
      projectId,
      number: versions.length + 1,
      author,
      description: description || `Version ${versions.length + 1}`,
      state: state ? structuredClone(state) : null,
      createdAt: new Date().toISOString(),
    };
    versions.push(version);
    return version;
  }

  /** Get all versions for a project. */
  getVersions(projectId) {
    return this._versions.get(projectId) || [];
  }

  /**
   * Restore a project to a previous version.
   * @param {string} projectId
   * @param {string} versionId
   * @returns {RestoredState}
   */
  restoreVersion(projectId, versionId) {
    const versions = this._versions.get(projectId);
    if (!versions) return { error: "project_not_found" };
    const version = versions.find((v) => v.id === versionId);
    if (!version) return { error: "version_not_found" };
    return {
      ok: true,
      projectId,
      restoredTo: version.number,
      state: version.state ? structuredClone(version.state) : null,
      restoredAt: new Date().toISOString(),
    };
  }

  /**
   * Diff two versions.
   * @param {string} projectId
   * @param {string} v1 - version ID
   * @param {string} v2 - version ID
   * @returns {Diff}
   */
  diffVersions(projectId, v1, v2) {
    const versions = this._versions.get(projectId);
    if (!versions) return { error: "project_not_found" };
    const ver1 = versions.find((v) => v.id === v1);
    const ver2 = versions.find((v) => v.id === v2);
    if (!ver1 || !ver2) return { error: "version_not_found" };

    const s1 = ver1.state || {};
    const s2 = ver2.state || {};
    const changes = [];

    // Simple structural diff
    const allKeys = new Set([...Object.keys(s1), ...Object.keys(s2)]);
    for (const key of allKeys) {
      const inV1 = key in s1;
      const inV2 = key in s2;
      if (inV1 && !inV2) changes.push({ type: "removed", key, from: s1[key] });
      else if (!inV1 && inV2) changes.push({ type: "added", key, to: s2[key] });
      else if (JSON.stringify(s1[key]) !== JSON.stringify(s2[key])) {
        changes.push({ type: "modified", key, from: s1[key], to: s2[key] });
      }
    }

    return {
      projectId,
      version1: { id: ver1.id, number: ver1.number },
      version2: { id: ver2.id, number: ver2.number },
      changes,
      identical: changes.length === 0,
    };
  }

  /**
   * Auto-save project state.
   * @param {string} projectId
   * @param {object} state
   * @returns {AutoSave}
   */
  autoSave(projectId, state) {
    if (!projectId) return { error: "projectId_required" };
    if (!this._autoSaves.has(projectId)) this._autoSaves.set(projectId, []);
    const save = {
      id: randomUUID(),
      projectId,
      state: state ? structuredClone(state) : null,
      savedAt: new Date().toISOString(),
    };
    this._autoSaves.get(projectId).push(save);
    return save;
  }

  /** Get all auto-saves for a project. */
  getAutoSaves(projectId) {
    return this._autoSaves.get(projectId) || [];
  }
}

// ====================================================================
// Export metadata
// ====================================================================

export const REALTIME_COLLAB_CLASSES = [
  "CollaborationServer",
  "CollaborationSession",
  "WebRTCSignaling",
  "CursorPresence",
  "CRDTSyncEngine",
  "PermissionSystem",
  "VersionHistory",
];
