// test_realtime_collab.js — Tests for the 7 real-time collaboration classes.
//
//   1. CollaborationServer     — WebSocket server lifecycle & connection tracking
//   2. CollaborationSession    — per-room join/leave, broadcasting, region locking
//   3. WebRTCSignaling         — WebRTC offer/answer/ICE candidate relay
//   4. CursorPresence          — live cursor positions & selection regions
//   5. CRDTSyncEngine          — operation log, merge, undo/redo, conflict resolution
//   6. PermissionSystem        — role-based access control
//   7. VersionHistory          — snapshots, diffs, auto-save

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CollaborationServer,
  CollaborationSession,
  WebRTCSignaling,
  CursorPresence,
  CRDTSyncEngine,
  PermissionSystem,
  VersionHistory,
  REALTIME_COLLAB_CLASSES,
} from "../src/realtime_collab.js";

// ====================================================================
// Shape / Export tests
// ====================================================================

test("RTCollab: all 7 classes are exported", () => {
  assert.equal(REALTIME_COLLAB_CLASSES.length, 7);
  assert.ok(REALTIME_COLLAB_CLASSES.includes("CollaborationServer"));
  assert.ok(REALTIME_COLLAB_CLASSES.includes("CollaborationSession"));
  assert.ok(REALTIME_COLLAB_CLASSES.includes("WebRTCSignaling"));
  assert.ok(REALTIME_COLLAB_CLASSES.includes("CursorPresence"));
  assert.ok(REALTIME_COLLAB_CLASSES.includes("CRDTSyncEngine"));
  assert.ok(REALTIME_COLLAB_CLASSES.includes("PermissionSystem"));
  assert.ok(REALTIME_COLLAB_CLASSES.includes("VersionHistory"));
});

test("RTCollab: CollaborationServer is instantiable", () => {
  const s = new CollaborationServer({ port: 9090 });
  assert.ok(s);
  assert.equal(typeof s.start, "function");
  assert.equal(typeof s.stop, "function");
  assert.equal(typeof s.getStatus, "function");
});

test("RTCollab: CollaborationSession is instantiable", () => {
  const s = new CollaborationSession("test-session");
  assert.ok(s);
  assert.equal(s.sessionId, "test-session");
});

test("RTCollab: WebRTCSignaling is instantiable", () => {
  const s = new WebRTCSignaling();
  assert.ok(s);
  assert.equal(typeof s.createRoom, "function");
});

test("RTCollab: CursorPresence is instantiable", () => {
  const p = new CursorPresence();
  assert.ok(p);
  assert.equal(typeof p.setCursor, "function");
});

test("RTCollab: CRDTSyncEngine is instantiable", () => {
  const e = new CRDTSyncEngine();
  assert.ok(e);
  assert.equal(typeof e.applyOperation, "function");
});

test("RTCollab: PermissionSystem is instantiable", () => {
  const p = new PermissionSystem();
  assert.ok(p);
  assert.equal(typeof p.setRole, "function");
});

test("RTCollab: VersionHistory is instantiable", () => {
  const h = new VersionHistory();
  assert.ok(h);
  assert.equal(typeof h.saveVersion, "function");
});

// ====================================================================
// 1. CollaborationServer
// ====================================================================

test("Server: start returns running status", () => {
  const s = new CollaborationServer({ port: 8081 });
  const r = s.start();
  assert.equal(r.port, 8081);
  assert.equal(r.status, "running");
});

test("Server: start when already running returns already_running", () => {
  const s = new CollaborationServer({ port: 8082 });
  s.start();
  const r = s.start();
  assert.equal(r.status, "already_running");
});

test("Server: stop returns stopped status", () => {
  const s = new CollaborationServer({ port: 8083 });
  s.start();
  const r = s.stop();
  assert.equal(r.status, "stopped");
});

test("Server: stop when not running returns already_stopped", () => {
  const s = new CollaborationServer({ port: 8084 });
  const r = s.stop();
  assert.equal(r.status, "already_stopped");
});

test("Server: getStatus returns correct structure", () => {
  const s = new CollaborationServer({ port: 8085 });
  s.start();
  const st = s.getStatus();
  assert.equal(st.running, true);
  assert.equal(st.connections, 0);
  assert.ok(st.uptime_ms >= 0);
});

test("Server: getStatus when stopped shows uptime 0", () => {
  const s = new CollaborationServer({ port: 8086 });
  const st = s.getStatus();
  assert.equal(st.running, false);
  assert.equal(st.uptime_ms, 0);
});

test("Server: addConnection and getConnection work", () => {
  const s = new CollaborationServer();
  s.addConnection("conn-1", { userId: "u1", sessionId: "s1" });
  const c = s.getConnection("conn-1");
  assert.equal(c.userId, "u1");
  assert.equal(c.sessionId, "s1");
  assert.ok(c.joinedAt);
});

test("Server: removeConnection works", () => {
  const s = new CollaborationServer();
  s.addConnection("conn-1");
  assert.equal(s.removeConnection("conn-1"), true);
  assert.equal(s.getConnection("conn-1"), null);
});

test("Server: stop clears connections", () => {
  const s = new CollaborationServer();
  s.start();
  s.addConnection("conn-1");
  s.addConnection("conn-2");
  s.stop();
  assert.equal(s.getConnection("conn-1"), null);
  assert.equal(s.getStatus().connections, 0);
});

test("Server: default port is 8080", () => {
  const s = new CollaborationServer();
  const r = s.start();
  assert.equal(r.port, 8080);
});

// ====================================================================
// 2. CollaborationSession
// ====================================================================

test("Session: join adds a member", () => {
  const s = new CollaborationSession("s1");
  const member = s.join("u1", { name: "Alice" });
  assert.equal(member.id, "u1");
  assert.equal(member.name, "Alice");
  assert.ok(member.joinedAt);
});

test("Session: join without userId returns error", () => {
  const s = new CollaborationSession("s1");
  const r = s.join(null);
  assert.equal(r.error, "userId_required");
});

test("Session: re-joining returns existing member", () => {
  const s = new CollaborationSession("s1");
  const m1 = s.join("u1", { name: "Alice" });
  const m2 = s.join("u1", { name: "Alice2" });
  assert.equal(m1.name, "Alice");
  assert.equal(m2.name, "Alice"); // not overwritten
});

test("Session: getUsers returns all members", () => {
  const s = new CollaborationSession("s1");
  s.join("u1", { name: "Alice" });
  s.join("u2", { name: "Bob" });
  const users = s.getUsers();
  assert.equal(users.length, 2);
});

test("Session: leave removes a member", () => {
  const s = new CollaborationSession("s1");
  s.join("u1");
  const r = s.leave("u1");
  assert.equal(r.removed, true);
  assert.equal(s.getUsers().length, 0);
});

test("Session: leave unknown user returns error", () => {
  const s = new CollaborationSession("s1");
  const r = s.leave("nobody");
  assert.equal(r.error, "user_not_found");
});

test("Session: broadcast sends message to others", () => {
  const s = new CollaborationSession("s1");
  s.join("u1");
  s.join("u2");
  const r = s.broadcast("u1", { type: "chat", payload: { text: "hello" } });
  assert.equal(r.ok, true);
  assert.equal(r.recipientCount, 1);
  assert.ok(r.recipients.includes("u2"));
  assert.ok(!r.recipients.includes("u1"));
});

test("Session: broadcast from unknown user returns error", () => {
  const s = new CollaborationSession("s1");
  const r = s.broadcast("ghost", { text: "boo" });
  assert.equal(r.error, "sender_not_in_session");
});

test("Session: getMessageHistory returns all messages", () => {
  const s = new CollaborationSession("s1");
  s.join("u1");
  s.broadcast("u1", { type: "chat", payload: "hi" });
  const msgs = s.getMessageHistory();
  // 1 system (join) + 1 chat = 2
  assert.ok(msgs.length >= 2);
});

test("Session: lockRegion acquires lock", () => {
  const s = new CollaborationSession("s1");
  s.join("u1");
  const lock = s.lockRegion("u1", { track: "v1", start: 0, end: 10 });
  assert.ok(lock.id);
  assert.equal(lock.userId, "u1");
  assert.equal(lock.track, "v1");
});

test("Session: lockRegion fails when locked by another user", () => {
  const s = new CollaborationSession("s1");
  s.join("u1");
  s.join("u2");
  s.lockRegion("u1", { track: "v1", start: 0, end: 10 });
  const r = s.lockRegion("u2", { track: "v1", start: 0, end: 10 });
  assert.equal(r.error, "region_already_locked");
  assert.equal(r.lockedBy, "u1");
});

test("Session: lockRegion re-entrant for same user", () => {
  const s = new CollaborationSession("s1");
  s.join("u1");
  const l1 = s.lockRegion("u1", { track: "v1", start: 0, end: 10 });
  const l2 = s.lockRegion("u1", { track: "v1", start: 0, end: 10 });
  assert.equal(l1.id, l2.id); // same lock returned
});

test("Session: unlockRegion releases lock", () => {
  const s = new CollaborationSession("s1");
  s.join("u1");
  const lock = s.lockRegion("u1", { track: "v1", start: 0, end: 10 });
  const r = s.unlockRegion("u1", lock.regionId);
  assert.equal(r.unlocked, true);
  assert.equal(s.getLocks().length, 0);
});

test("Session: unlockRegion fails if not lock owner", () => {
  const s = new CollaborationSession("s1");
  s.join("u1");
  s.join("u2");
  const lock = s.lockRegion("u1", { track: "v1", start: 0, end: 10 });
  const r = s.unlockRegion("u2", lock.regionId);
  assert.equal(r.error, "not_lock_owner");
});

test("Session: leave releases user's locks", () => {
  const s = new CollaborationSession("s1");
  s.join("u1");
  s.lockRegion("u1", { track: "v1", start: 0, end: 10 });
  s.leave("u1");
  assert.equal(s.getLocks().length, 0);
});

test("Session: auto-generated sessionId if not provided", () => {
  const s = new CollaborationSession();
  assert.ok(s.sessionId);
  assert.ok(s.sessionId.length > 0);
});

// ====================================================================
// 3. WebRTCSignaling
// ====================================================================

test("Signaling: createRoom creates room", () => {
  const s = new WebRTCSignaling();
  const r = s.createRoom("room-1");
  assert.equal(r.id, "room-1");
  assert.deepEqual(r.members, []);
});

test("Signaling: createRoom re-entrant returns existing", () => {
  const s = new WebRTCSignaling();
  const r1 = s.createRoom("room-1");
  const r2 = s.createRoom("room-1");
  assert.equal(r1.id, r2.id);
});

test("Signaling: joinRoom adds member", () => {
  const s = new WebRTCSignaling();
  s.createRoom("room-1");
  const m = s.joinRoom("room-1", "u1");
  assert.equal(m.userId, "u1");
  assert.ok(m.joinedAt);
});

test("Signaling: joinRoom on missing room returns error", () => {
  const s = new WebRTCSignaling();
  const r = s.joinRoom("ghost", "u1");
  assert.equal(r.error, "room_not_found");
});

test("Signaling: leaveRoom removes member", () => {
  const s = new WebRTCSignaling();
  s.createRoom("room-1");
  s.joinRoom("room-1", "u1");
  const r = s.leaveRoom("room-1", "u1");
  assert.equal(r.removed, true);
});

test("Signaling: leaveRoom unknown user returns error", () => {
  const s = new WebRTCSignaling();
  s.createRoom("room-1");
  const r = s.leaveRoom("room-1", "ghost");
  assert.equal(r.error, "user_not_in_room");
});

test("Signaling: sendOffer works between two users", () => {
  const s = new WebRTCSignaling();
  s.createRoom("room-1");
  s.joinRoom("room-1", "u1");
  s.joinRoom("room-1", "u2");
  const msg = s.sendOffer("room-1", "u1", "u2", { sdp: "offer-data" });
  assert.equal(msg.type, "offer");
  assert.equal(msg.from, "u1");
  assert.equal(msg.to, "u2");
  assert.equal(msg.data.sdp, "offer-data");
});

test("Signaling: sendAnswer works", () => {
  const s = new WebRTCSignaling();
  s.createRoom("room-1");
  s.joinRoom("room-1", "u1");
  s.joinRoom("room-1", "u2");
  const msg = s.sendAnswer("room-1", "u2", "u1", { sdp: "answer-data" });
  assert.equal(msg.type, "answer");
  assert.equal(msg.data.sdp, "answer-data");
});

test("Signaling: sendCandidate works", () => {
  const s = new WebRTCSignaling();
  s.createRoom("room-1");
  s.joinRoom("room-1", "u1");
  s.joinRoom("room-1", "u2");
  const msg = s.sendCandidate("room-1", "u1", "u2", { candidate: "ice-candidate" });
  assert.equal(msg.type, "candidate");
});

test("Signaling: sendOffer from non-member returns error", () => {
  const s = new WebRTCSignaling();
  s.createRoom("room-1");
  s.joinRoom("room-1", "u2");
  const msg = s.sendOffer("room-1", "ghost", "u2", {});
  assert.equal(msg.error, "sender_not_in_room");
});

test("Signaling: getRoom returns member list", () => {
  const s = new WebRTCSignaling();
  s.createRoom("room-1");
  s.joinRoom("room-1", "u1");
  s.joinRoom("room-1", "u2");
  const room = s.getRoom("room-1");
  assert.equal(room.members.length, 2);
  assert.ok(room.members.includes("u1"));
});

test("Signaling: getRoom for missing room returns null", () => {
  const s = new WebRTCSignaling();
  assert.equal(s.getRoom("none"), null);
});

test("Signaling: getRooms lists all rooms", () => {
  const s = new WebRTCSignaling();
  s.createRoom("r1");
  s.createRoom("r2");
  assert.equal(s.getRooms().length, 2);
});

// ====================================================================
// 4. CursorPresence
// ====================================================================

test("Cursor: setCursor stores position", () => {
  const p = new CursorPresence();
  const c = p.setCursor("u1", { x: 100, y: 200, track: "v1", timecode: "01:00:00" });
  assert.equal(c.userId, "u1");
  assert.equal(c.x, 100);
  assert.equal(c.y, 200);
  assert.equal(c.track, "v1");
  assert.equal(c.timecode, "01:00:00");
});

test("Cursor: setCursor without userId returns error", () => {
  const p = new CursorPresence();
  const r = p.setCursor(null, { x: 0, y: 0 });
  assert.equal(r.error, "userId_required");
});

test("Cursor: getCursors returns all", () => {
  const p = new CursorPresence();
  p.setCursor("u1", { x: 10, y: 20 });
  p.setCursor("u2", { x: 30, y: 40 });
  assert.equal(p.getCursors().length, 2);
});

test("Cursor: getCursor returns specific user", () => {
  const p = new CursorPresence();
  p.setCursor("u1", { x: 10, y: 20 });
  const c = p.getCursor("u1");
  assert.equal(c.x, 10);
});

test("Cursor: getCursor for unknown user returns null", () => {
  const p = new CursorPresence();
  assert.equal(p.getCursor("ghost"), null);
});

test("Cursor: setSelection stores selection", () => {
  const p = new CursorPresence();
  const s = p.setSelection("u1", { track: "v1", start: 10, end: 50 });
  assert.equal(s.userId, "u1");
  assert.equal(s.track, "v1");
  assert.equal(s.start, 10);
  assert.equal(s.end, 50);
});

test("Cursor: setSelection without track returns error", () => {
  const p = new CursorPresence();
  const r = p.setSelection("u1", {});
  assert.equal(r.error, "track_required");
});

test("Cursor: getSelections returns all", () => {
  const p = new CursorPresence();
  p.setSelection("u1", { track: "v1", start: 0, end: 10 });
  p.setSelection("u2", { track: "v2", start: 5, end: 20 });
  assert.equal(p.getSelections().length, 2);
});

test("Cursor: removeUser clears all presence", () => {
  const p = new CursorPresence();
  p.setCursor("u1", { x: 1, y: 1 });
  p.setSelection("u1", { track: "v1", start: 0, end: 10 });
  const r = p.removeUser("u1");
  assert.equal(r.removedCursor, true);
  assert.equal(r.removedSelection, true);
  assert.equal(p.getCursor("u1"), null);
  assert.equal(p.getSelections().length, 0);
});

test("Cursor: getUsers merges cursor and selection data", () => {
  const p = new CursorPresence();
  p.setCursor("u1", { x: 10, y: 20 });
  p.setSelection("u1", { track: "v1", start: 0, end: 10 });
  const users = p.getUsers();
  assert.equal(users.length, 1);
  assert.equal(users[0].userId, "u1");
  assert.ok(users[0].cursor);
  assert.ok(users[0].selection);
});

// ====================================================================
// 5. CRDTSyncEngine
// ====================================================================

test("CRDT: applyOperation returns operation", () => {
  const e = new CRDTSyncEngine();
  const r = e.applyOperation({ type: "add_track", userId: "u1", data: { name: "V1" } });
  assert.equal(r.ok, true);
  assert.ok(r.operation.id);
  assert.equal(r.operation.type, "add_track");
});

test("CRDT: applyOperation without type returns error", () => {
  const e = new CRDTSyncEngine();
  const r = e.applyOperation({ userId: "u1" });
  assert.equal(r.error, "op_type_required");
});

test("CRDT: applyOperation without userId returns error", () => {
  const e = new CRDTSyncEngine();
  const r = e.applyOperation({ type: "add_track" });
  assert.equal(r.error, "userId_required");
});

test("CRDT: state reflects add_track operation", () => {
  const e = new CRDTSyncEngine();
  e.applyOperation({ type: "add_track", userId: "u1", data: { name: "V1" } });
  const state = e.getState();
  assert.equal(state.tracks.length, 1);
  assert.equal(state.tracks[0].name, "V1");
});

test("CRDT: getHistory returns all operations", () => {
  const e = new CRDTSyncEngine();
  e.applyOperation({ type: "add_track", userId: "u1", data: {} });
  e.applyOperation({ type: "update_metadata", userId: "u1", data: { title: "Test" } });
  assert.equal(e.getHistory().length, 2);
});

test("CRDT: undo removes last user operation", () => {
  const e = new CRDTSyncEngine();
  e.applyOperation({ type: "add_track", userId: "u1", data: { name: "V1" } });
  const r = e.undo("u1");
  assert.equal(r.ok, true);
  assert.equal(r.undone.type, "add_track");
  // State should have inverse
  assert.equal(e.getHistory().length, 2); // original + inverse
});

test("CRDT: undo with no operations returns error", () => {
  const e = new CRDTSyncEngine();
  const r = e.undo("u1");
  assert.equal(r.error, "nothing_to_undo");
});

test("CRDT: redo re-applies undone operation", () => {
  const e = new CRDTSyncEngine();
  e.applyOperation({ type: "add_track", userId: "u1", data: { name: "V1" } });
  e.undo("u1");
  const r = e.redo("u1");
  assert.equal(r.ok, true);
  assert.equal(r.redone.type, "add_track");
});

test("CRDT: redo with no inverse operations returns error", () => {
  const e = new CRDTSyncEngine();
  const r = e.redo("u1");
  assert.equal(r.error, "nothing_to_redo");
});

test("CRDT: mergeOperations applies in order", () => {
  const e = new CRDTSyncEngine();
  const r = e.mergeOperations([
    { type: "add_track", userId: "u1", data: { name: "A" }, timestamp: "2025-01-01T00:00:00Z" },
    { type: "add_track", userId: "u2", data: { name: "B" }, timestamp: "2025-01-01T00:00:01Z" },
  ]);
  assert.equal(r.applied, 2);
  assert.equal(r.conflicts, 0);
});

test("CRDT: mergeOperations with non-array returns error", () => {
  const e = new CRDTSyncEngine();
  const r = e.mergeOperations("not-an-array");
  assert.equal(r.error, "ops_must_be_array");
});

test("CRDT: conflict detection on same target", () => {
  const e = new CRDTSyncEngine();
  e.applyOperation({ type: "move_clip", userId: "u1", target: "clip-1", data: { position: 10 } });
  const r = e.applyOperation({ type: "move_clip", userId: "u2", target: "clip-1", data: { position: 20 } });
  assert.ok(r.conflict); // conflict detected
  assert.equal(e.getConflicts().length, 1);
});

test("CRDT: resolveConflict picks winner", () => {
  const e = new CRDTSyncEngine();
  e.applyOperation({ type: "move_clip", userId: "u1", target: "clip-1", data: {} });
  const r = e.applyOperation({ type: "move_clip", userId: "u2", target: "clip-1", data: {} });
  const resolved = e.resolveConflict(r.conflict, { winner: "u2" });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.resolution.winner, "u2");
});

test("CRDT: resolveConflict for unknown conflict returns error", () => {
  const e = new CRDTSyncEngine();
  const r = e.resolveConflict("fake-id", { winner: "u1" });
  assert.equal(r.error, "conflict_not_found");
});

test("CRDT: state clone is independent", () => {
  const e = new CRDTSyncEngine();
  const s1 = e.getState();
  s1.tracks.push({ name: "injected" });
  const s2 = e.getState();
  assert.equal(s2.tracks.length, 0); // original state unchanged
});

// ====================================================================
// 6. PermissionSystem
// ====================================================================

test("Permissions: setRole stores role", () => {
  const p = new PermissionSystem();
  const r = p.setRole("u1", "editor");
  assert.equal(r.userId, "u1");
  assert.equal(r.role, "editor");
});

test("Permissions: setRole with invalid role returns error", () => {
  const p = new PermissionSystem();
  const r = p.setRole("u1", "admin");
  assert.equal(r.error, "invalid_role");
  assert.ok(r.validRoles);
});

test("Permissions: getRole returns role or null", () => {
  const p = new PermissionSystem();
  assert.equal(p.getRole("nobody"), null);
  p.setRole("u1", "viewer");
  assert.equal(p.getRole("u1").role, "viewer");
});

test("Permissions: canEdit for editor returns true", () => {
  const p = new PermissionSystem();
  p.setRole("u1", "editor");
  assert.equal(p.canEdit("u1"), true);
});

test("Permissions: canEdit for viewer returns false", () => {
  const p = new PermissionSystem();
  p.setRole("u1", "viewer");
  assert.equal(p.canEdit("u1"), false);
});

test("Permissions: canEdit for unknown user returns false", () => {
  const p = new PermissionSystem();
  assert.equal(p.canEdit("ghost"), false);
});

test("Permissions: canComment for commenter or above", () => {
  const p = new PermissionSystem();
  p.setRole("u1", "commenter");
  assert.equal(p.canComment("u1"), true);
  p.setRole("u2", "viewer");
  assert.equal(p.canComment("u2"), false);
});

test("Permissions: canView for any role returns true", () => {
  const p = new PermissionSystem();
  p.setRole("u1", "viewer");
  assert.equal(p.canView("u1"), true);
});

test("Permissions: canShare only for owner", () => {
  const p = new PermissionSystem();
  p.setRole("u1", "owner");
  assert.equal(p.canShare("u1"), true);
  p.setRole("u2", "editor");
  assert.equal(p.canShare("u2"), false);
});

test("Permissions: getPermissions returns full set", () => {
  const p = new PermissionSystem();
  p.setRole("u1", "editor");
  const perms = p.getPermissions("u1");
  assert.equal(perms.role, "editor");
  assert.equal(perms.canEdit, true);
  assert.equal(perms.canComment, true);
  assert.equal(perms.canView, true);
  assert.equal(perms.canShare, false);
});

test("Permissions: shareWith grants access", () => {
  const p = new PermissionSystem();
  const r = p.shareWith("u1", "commenter");
  assert.ok(r.id);
  assert.equal(r.role, "commenter");
  assert.equal(p.canComment("u1"), true);
});

test("Permissions: shareWith with expiry", () => {
  const p = new PermissionSystem();
  const exp = new Date("2026-12-31");
  const r = p.shareWith("u1", "viewer", exp);
  assert.equal(r.expires, exp.toISOString());
});

test("Permissions: revokeAccess removes role", () => {
  const p = new PermissionSystem();
  p.setRole("u1", "editor");
  const r = p.revokeAccess("u1");
  assert.equal(r.removed, true);
  assert.equal(p.getRole("u1"), null);
});

test("Permissions: getSharedUsers lists users", () => {
  const p = new PermissionSystem();
  p.shareWith("u1", "editor");
  p.shareWith("u2", "viewer");
  const users = p.getSharedUsers();
  assert.equal(users.length, 2);
});

// ====================================================================
// 7. VersionHistory
// ====================================================================

test("Versions: saveVersion creates version", () => {
  const h = new VersionHistory();
  const v = h.saveVersion("proj-1", { author: "Alice", description: "First cut" });
  assert.ok(v.id);
  assert.equal(v.number, 1);
  assert.equal(v.author, "Alice");
  assert.equal(v.description, "First cut");
});

test("Versions: saveVersion without projectId returns error", () => {
  const h = new VersionHistory();
  const r = h.saveVersion(null, { author: "Alice" });
  assert.equal(r.error, "projectId_required");
});

test("Versions: saveVersion without author returns error", () => {
  const h = new VersionHistory();
  const r = h.saveVersion("proj-1", {});
  assert.equal(r.error, "author_required");
});

test("Versions: getVersions returns all", () => {
  const h = new VersionHistory();
  h.saveVersion("proj-1", { author: "Alice" });
  h.saveVersion("proj-1", { author: "Bob" });
  assert.equal(h.getVersions("proj-1").length, 2);
});

test("Versions: version numbers increment", () => {
  const h = new VersionHistory();
  const v1 = h.saveVersion("proj-1", { author: "A" });
  const v2 = h.saveVersion("proj-1", { author: "A" });
  assert.equal(v1.number, 1);
  assert.equal(v2.number, 2);
});

test("Versions: restoreVersion returns state", () => {
  const h = new VersionHistory();
  const v = h.saveVersion("proj-1", { author: "A", state: { tracks: [{ name: "V1" }] } });
  const r = h.restoreVersion("proj-1", v.id);
  assert.equal(r.ok, true);
  assert.equal(r.restoredTo, 1);
  assert.equal(r.state.tracks[0].name, "V1");
});

test("Versions: restoreVersion unknown project returns error", () => {
  const h = new VersionHistory();
  const r = h.restoreVersion("none", "fake");
  assert.equal(r.error, "project_not_found");
});

test("Versions: restoreVersion unknown version returns error", () => {
  const h = new VersionHistory();
  h.saveVersion("proj-1", { author: "A" });
  const r = h.restoreVersion("proj-1", "fake-id");
  assert.equal(r.error, "version_not_found");
});

test("Versions: diffVersions shows changes", () => {
  const h = new VersionHistory();
  const v1 = h.saveVersion("proj-1", { author: "A", state: { title: "Old", duration: 60 } });
  const v2 = h.saveVersion("proj-1", { author: "A", state: { title: "New", duration: 60 } });
  const diff = h.diffVersions("proj-1", v1.id, v2.id);
  assert.equal(diff.identical, false);
  assert.equal(diff.changes.length, 1);
  assert.equal(diff.changes[0].key, "title");
  assert.equal(diff.changes[0].type, "modified");
});

test("Versions: diffVersions identical returns no changes", () => {
  const h = new VersionHistory();
  const v1 = h.saveVersion("proj-1", { author: "A", state: { title: "X" } });
  const v2 = h.saveVersion("proj-1", { author: "A", state: { title: "X" } });
  const diff = h.diffVersions("proj-1", v1.id, v2.id);
  assert.equal(diff.identical, true);
  assert.equal(diff.changes.length, 0);
});

test("Versions: diffVersions detects added/removed keys", () => {
  const h = new VersionHistory();
  const v1 = h.saveVersion("proj-1", { author: "A", state: { a: 1 } });
  const v2 = h.saveVersion("proj-1", { author: "A", state: { b: 2 } });
  const diff = h.diffVersions("proj-1", v1.id, v2.id);
  const added = diff.changes.filter((c) => c.type === "added");
  const removed = diff.changes.filter((c) => c.type === "removed");
  assert.ok(added.length > 0);
  assert.ok(removed.length > 0);
});

test("Versions: autoSave creates snapshot", () => {
  const h = new VersionHistory();
  const s = h.autoSave("proj-1", { tracks: [] });
  assert.ok(s.id);
  assert.equal(s.projectId, "proj-1");
  assert.ok(s.savedAt);
});

test("Versions: autoSave without projectId returns error", () => {
  const h = new VersionHistory();
  const r = h.autoSave(null, {});
  assert.equal(r.error, "projectId_required");
});

test("Versions: getAutoSaves returns all", () => {
  const h = new VersionHistory();
  h.autoSave("proj-1", { a: 1 });
  h.autoSave("proj-1", { a: 2 });
  assert.equal(h.getAutoSaves("proj-1").length, 2);
});

test("Versions: restored state is cloned", () => {
  const h = new VersionHistory();
  const state = { tracks: [{ name: "V1" }] };
  const v = h.saveVersion("proj-1", { author: "A", state });
  const r = h.restoreVersion("proj-1", v.id);
  r.state.tracks.push({ name: "injected" });
  const r2 = h.restoreVersion("proj-1", v.id);
  assert.equal(r2.state.tracks.length, 1); // original unaffected
});

test("Versions: getVersions for unknown project returns empty", () => {
  const h = new VersionHistory();
  assert.deepEqual(h.getVersions("none"), []);
});

test("Versions: getAutoSaves for unknown project returns empty", () => {
  const h = new VersionHistory();
  assert.deepEqual(h.getAutoSaves("none"), []);
});
