// test_collab_tools.js — Tests for the 6 real-time collaboration classes.
//
//   1. CollaborationHub       — session management & event broadcasting
//   2. CRDTDocument           — conflict-free replicated data type
//   3. ConflictResolver        — patch conflict resolution
//   4. CommentSystem           — threaded comments with @mentions
//   5. ApprovalWorkflow        — multi-step review & approval chains
//   6. PresenceManager         — cursor & selection presence tracking

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CollaborationHub,
  CRDTDocument,
  ConflictResolver,
  CommentSystem,
  ApprovalWorkflow,
  PresenceManager,
  COLLAB_CLASSES,
} from "../src/collab_tools.js";

// ====================================================================
// Shape / Export tests
// ====================================================================

test("Collab: all 6 classes are exported", () => {
  assert.equal(COLLAB_CLASSES.length, 6);
  assert.ok(COLLAB_CLASSES.includes("CollaborationHub"));
  assert.ok(COLLAB_CLASSES.includes("CRDTDocument"));
  assert.ok(COLLAB_CLASSES.includes("ConflictResolver"));
  assert.ok(COLLAB_CLASSES.includes("CommentSystem"));
  assert.ok(COLLAB_CLASSES.includes("ApprovalWorkflow"));
  assert.ok(COLLAB_CLASSES.includes("PresenceManager"));
});

test("Collab: CollaborationHub is instantiable", () => {
  const hub = new CollaborationHub();
  assert.ok(hub);
  assert.ok(typeof hub.joinSession === "function");
  assert.ok(typeof hub.leaveSession === "function");
  assert.ok(typeof hub.broadcast === "function");
});

// ====================================================================
// 1. CollaborationHub
// ====================================================================

test("Collab Hub: joinSession creates a session", () => {
  const hub = new CollaborationHub();
  const r = hub.joinSession("proj-1", { id: "u1", name: "Alice" });
  assert.equal(r.ok, true);
  assert.ok(r.session);
  assert.equal(r.session.projectId, "proj-1");
  assert.equal(r.session.userId, "u1");
  assert.equal(r.session.userName, "Alice");
  assert.ok(r.session.id);
  assert.ok(r.session.joinedAt);
});

test("Collab Hub: joinSession fails without projectId", () => {
  const hub = new CollaborationHub();
  const r = hub.joinSession(null, { id: "u1" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "project_id_required");
});

test("Collab Hub: joinSession fails without user", () => {
  const hub = new CollaborationHub();
  const r = hub.joinSession("proj-1", null);
  assert.equal(r.ok, false);
  assert.equal(r.error, "user_required");
});

test("Collab Hub: leaveSession removes user", () => {
  const hub = new CollaborationHub();
  hub.joinSession("proj-1", { id: "u1", name: "Alice" });
  const r = hub.leaveSession("proj-1", "u1");
  assert.equal(r.ok, true);
  assert.equal(r.removed, true);
  const users = hub.getUsers("proj-1");
  assert.equal(users.users.length, 0);
});

test("Collab Hub: leaveSession fails for unknown session", () => {
  const hub = new CollaborationHub();
  const r = hub.leaveSession("proj-1", "u1");
  assert.equal(r.ok, false);
  assert.equal(r.error, "session_not_found");
});

test("Collab Hub: getUsers returns all users in session", () => {
  const hub = new CollaborationHub();
  hub.joinSession("proj-1", { id: "u1", name: "Alice" });
  hub.joinSession("proj-1", { id: "u2", name: "Bob" });
  const r = hub.getUsers("proj-1");
  assert.equal(r.ok, true);
  assert.equal(r.users.length, 2);
  assert.equal(r.users[0].name, "Alice");
  assert.equal(r.users[1].name, "Bob");
});

test("Collab Hub: broadcast delivers to session", () => {
  const hub = new CollaborationHub();
  hub.joinSession("proj-1", { id: "u1", name: "Alice" });
  hub.joinSession("proj-1", { id: "u2", name: "Bob" });
  const r = hub.broadcast("proj-1", "cursor_move", "u1", { x: 10 });
  assert.equal(r.ok, true);
  assert.equal(r.delivered, 2);
});

test("Collab Hub: broadcast fails without event", () => {
  const hub = new CollaborationHub();
  const r = hub.broadcast("proj-1", "", "u1");
  assert.equal(r.ok, false);
  assert.equal(r.error, "event_required");
});

test("Collab Hub: on() receives broadcast events", () => {
  const hub = new CollaborationHub();
  hub.joinSession("proj-1", { id: "u1", name: "Alice" });
  let received = null;
  hub.on("cursor_move", (e) => { received = e; });
  hub.broadcast("proj-1", "cursor_move", "u1", { x: 5 });
  assert.ok(received);
  assert.equal(received.event, "cursor_move");
  assert.equal(received.fromUserId, "u1");
});

// ====================================================================
// 2. CRDTDocument
// ====================================================================

test("CRDT: apply set patch", () => {
  const doc = new CRDTDocument("doc-1", { title: "Hello" });
  const r = doc.apply({ type: "set", path: "title", value: "World" });
  assert.equal(r.ok, true);
  assert.equal(r.applied, true);
  const state = doc.getState();
  assert.equal(state.state.title, "World");
});

test("CRDT: apply merge patch", () => {
  const doc = new CRDTDocument("doc-1", { a: 1 });
  const r = doc.apply({ type: "merge", value: { b: 2 } });
  assert.equal(r.ok, true);
  const state = doc.getState();
  assert.equal(state.state.a, 1);
  assert.equal(state.state.b, 2);
});

test("CRDT: apply delete patch", () => {
  const doc = new CRDTDocument("doc-1", { a: 1, b: 2 });
  const r = doc.apply({ type: "delete", path: "b" });
  assert.equal(r.ok, true);
  const state = doc.getState();
  assert.equal(state.state.a, 1);
  assert.equal(state.state.b, undefined);
});

test("CRDT: apply array_push patch", () => {
  const doc = new CRDTDocument("doc-1", { items: [1, 2] });
  const r = doc.apply({ type: "array_push", path: "items", value: 3 });
  assert.equal(r.ok, true);
  const state = doc.getState();
  assert.deepEqual(state.state.items, [1, 2, 3]);
});

test("CRDT: apply array_remove patch", () => {
  const doc = new CRDTDocument("doc-1", { items: [1, 2, 3] });
  const r = doc.apply({ type: "array_remove", path: "items", value: 2 });
  assert.equal(r.ok, true);
  const state = doc.getState();
  assert.deepEqual(state.state.items, [1, 3]);
});

test("CRDT: apply replace patch", () => {
  const doc = new CRDTDocument("doc-1", { a: 1 });
  const r = doc.apply({ type: "replace", value: { x: 10 } });
  assert.equal(r.ok, true);
  const state = doc.getState();
  assert.deepEqual(state.state, { x: 10 });
});

test("CRDT: apply fails without patch type", () => {
  const doc = new CRDTDocument("doc-1");
  const r = doc.apply({});
  assert.equal(r.ok, false);
  assert.equal(r.error, "patch_required");
});

test("CRDT: apply fails on duplicate patch id", () => {
  const doc = new CRDTDocument("doc-1", { a: 1 });
  doc.apply({ type: "set", path: "a", value: 2, id: "p1" });
  const r = doc.apply({ type: "set", path: "a", value: 3, id: "p1" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "duplicate_patch");
});

test("CRDT: merge applies remote patch", () => {
  const doc = new CRDTDocument("doc-1", { a: 1 });
  const r = doc.merge({ type: "set", path: "a", value: 99 });
  assert.equal(r.ok, true);
  assert.equal(r.merged, true);
  assert.equal(doc.getState().state.a, 99);
});

test("CRDT: merge rejects duplicate patch", () => {
  const doc = new CRDTDocument("doc-1", { a: 1 });
  doc.merge({ type: "set", path: "a", value: 2, id: "m1" });
  const r = doc.merge({ type: "set", path: "a", value: 3, id: "m1" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "already_applied");
});

test("CRDT: undo reverts last patch", () => {
  const doc = new CRDTDocument("doc-1", { a: 1 });
  doc.apply({ type: "set", path: "a", value: 2 });
  const r = doc.undo();
  assert.equal(r.ok, true);
  assert.equal(r.undone, true);
  assert.equal(doc.getState().state.a, 1);
});

test("CRDT: undo fails when nothing to undo", () => {
  const doc = new CRDTDocument("doc-1", { a: 1 });
  const r = doc.undo();
  assert.equal(r.ok, false);
  assert.equal(r.error, "nothing_to_undo");
});

test("CRDT: redo re-applies undone patch", () => {
  const doc = new CRDTDocument("doc-1", { a: 1 });
  doc.apply({ type: "set", path: "a", value: 2 });
  doc.undo();
  const r = doc.redo();
  assert.equal(r.ok, true);
  assert.equal(r.redone, true);
  assert.equal(doc.getState().state.a, 2);
});

test("CRDT: redo fails when nothing to redo", () => {
  const doc = new CRDTDocument("doc-1", { a: 1 });
  const r = doc.redo();
  assert.equal(r.ok, false);
  assert.equal(r.error, "nothing_to_redo");
});

test("CRDT: getHistory returns full patch history", () => {
  const doc = new CRDTDocument("doc-1", { a: 1 });
  doc.apply({ type: "set", path: "a", value: 2 });
  doc.apply({ type: "set", path: "a", value: 3 });
  const r = doc.getHistory();
  assert.equal(r.ok, true);
  assert.equal(r.count, 2);
  assert.equal(r.history.length, 2);
});

// ====================================================================
// 3. ConflictResolver
// ====================================================================

test("ConflictResolver: default strategy is last-write-wins", () => {
  const cr = new ConflictResolver();
  assert.equal(cr.getStrategy(), "last-write-wins");
});

test("ConflictResolver: setStrategy changes strategy", () => {
  const cr = new ConflictResolver();
  const r = cr.setStrategy("merge");
  assert.equal(r.ok, true);
  assert.equal(r.strategy, "merge");
  assert.equal(cr.getStrategy(), "merge");
});

test("ConflictResolver: setStrategy rejects invalid strategy", () => {
  const cr = new ConflictResolver();
  const r = cr.setStrategy("invalid");
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("invalid_strategy"));
});

test("ConflictResolver: constructor rejects invalid strategy", () => {
  assert.throws(() => new ConflictResolver("invalid"), /invalid_strategy/);
});

test("ConflictResolver: resolve with last-write-wins picks newer patch", () => {
  const cr = new ConflictResolver("last-write-wins");
  const local = { type: "set", path: "a", value: 1, timestamp: "2026-01-01T00:00:00Z" };
  const remote = { type: "set", path: "a", value: 2, timestamp: "2026-01-02T00:00:00Z" };
  const r = cr.resolve(local, remote);
  assert.equal(r.ok, true);
  assert.equal(r.resolvedPatch.value, 2);
  assert.equal(r.strategy, "last-write-wins");
});

test("ConflictResolver: resolve with merge strategy merges patches", () => {
  const cr = new ConflictResolver("merge");
  const local = { id: "l1", type: "set", path: "a", value: 1 };
  const remote = { id: "r1", type: "set", path: "a", value: 2 };
  const r = cr.resolve(local, remote);
  assert.equal(r.ok, true);
  assert.equal(r.strategy, "merge");
  assert.ok(r.resolvedPatch.mergedFrom);
});

test("ConflictResolver: resolve with manual strategy requires manual resolution", () => {
  const cr = new ConflictResolver("manual");
  const local = { type: "set", path: "a", value: 1 };
  const remote = { type: "set", path: "a", value: 2 };
  const r = cr.resolve(local, remote);
  assert.equal(r.ok, false);
  assert.equal(r.error, "manual_resolution_required");
  assert.ok(r.conflict);
});

test("ConflictResolver: getConflicts returns recorded conflicts", () => {
  const cr = new ConflictResolver("last-write-wins");
  cr.resolve({ type: "set", path: "a", value: 1 }, { type: "set", path: "a", value: 2 });
  const r = cr.getConflicts();
  assert.equal(r.ok, true);
  assert.equal(r.count, 1);
  assert.ok(r.conflicts[0].localPatch);
  assert.ok(r.conflicts[0].remotePatch);
});

test("ConflictResolver: no conflict when paths differ", () => {
  const cr = new ConflictResolver("last-write-wins");
  const r = cr.resolve({ type: "set", path: "a", value: 1 }, { type: "set", path: "b", value: 2 });
  assert.equal(r.ok, true);
  assert.equal(r.strategy, "no_conflict");
});

// ====================================================================
// 4. CommentSystem
// ====================================================================

test("CommentSystem: addComment creates a comment", () => {
  const cs = new CommentSystem();
  const r = cs.addComment("proj-1", "u1", { text: "Nice edit!", timeCode: 30 });
  assert.equal(r.ok, true);
  assert.ok(r.comment);
  assert.equal(r.comment.text, "Nice edit!");
  assert.equal(r.comment.userId, "u1");
  assert.equal(r.comment.timeCode, 30);
  assert.equal(r.comment.resolved, false);
});

test("CommentSystem: addComment extracts @mentions", () => {
  const cs = new CommentSystem();
  const r = cs.addComment("proj-1", "u1", { text: "Hey @alice and @bob check this" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.comment.mentions, ["alice", "bob"]);
});

test("CommentSystem: addComment fails without text", () => {
  const cs = new CommentSystem();
  const r = cs.addComment("proj-1", "u1", { text: "" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "text_required");
});

test("CommentSystem: addComment fails without projectId", () => {
  const cs = new CommentSystem();
  const r = cs.addComment(null, "u1", { text: "hi" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "project_id_required");
});

test("CommentSystem: replyToComment adds a reply", () => {
  const cs = new CommentSystem();
  const c = cs.addComment("proj-1", "u1", { text: "Hello" });
  const r = cs.replyToComment(c.comment.id, "u2", "Reply here");
  assert.equal(r.ok, true);
  assert.ok(r.reply);
  assert.equal(r.reply.text, "Reply here");
  assert.equal(r.reply.commentId, c.comment.id);
});

test("CommentSystem: replyToComment fails for non-existent comment", () => {
  const cs = new CommentSystem();
  const r = cs.replyToComment("fake-id", "u2", "Reply");
  assert.equal(r.ok, false);
  assert.equal(r.error, "comment_not_found");
});

test("CommentSystem: resolveComment marks comment resolved", () => {
  const cs = new CommentSystem();
  const c = cs.addComment("proj-1", "u1", { text: "Fix this" });
  const r = cs.resolveComment(c.comment.id, "u2");
  assert.equal(r.ok, true);
  assert.equal(r.resolved, true);
});

test("CommentSystem: resolveComment fails for non-existent comment", () => {
  const cs = new CommentSystem();
  const r = cs.resolveComment("fake", "u1");
  assert.equal(r.ok, false);
  assert.equal(r.error, "comment_not_found");
});

test("CommentSystem: getComments returns all comments with replies", () => {
  const cs = new CommentSystem();
  const c = cs.addComment("proj-1", "u1", { text: "First" });
  cs.addComment("proj-1", "u2", { text: "Second" });
  cs.replyToComment(c.comment.id, "u3", "Reply to first");
  const r = cs.getComments("proj-1");
  assert.equal(r.ok, true);
  assert.equal(r.count, 2);
  assert.equal(r.comments[0].replies.length, 1);
});

test("CommentSystem: getUnresolved returns only unresolved", () => {
  const cs = new CommentSystem();
  const c1 = cs.addComment("proj-1", "u1", { text: "A" });
  cs.addComment("proj-1", "u2", { text: "B" });
  cs.resolveComment(c1.comment.id, "u1");
  const r = cs.getUnresolved("proj-1");
  assert.equal(r.ok, true);
  assert.equal(r.count, 1);
  assert.equal(r.comments[0].text, "B");
});

test("CommentSystem: getMentions returns comments mentioning a user", () => {
  const cs = new CommentSystem();
  cs.addComment("proj-1", "u1", { text: "Hey @alice check this" });
  cs.addComment("proj-1", "u2", { text: "Looks good" });
  const r = cs.getMentions("proj-1", "alice");
  assert.equal(r.ok, true);
  assert.equal(r.count, 1);
  assert.ok(r.mentions[0].text.includes("@alice"));
});

// ====================================================================
// 5. ApprovalWorkflow
// ====================================================================

test("ApprovalWorkflow: submitForReview creates review", () => {
  const aw = new ApprovalWorkflow();
  const r = aw.submitForReview("proj-1", "u1");
  assert.equal(r.ok, true);
  assert.ok(r.review);
  assert.equal(r.review.status, "pending");
  assert.equal(r.review.submittedBy, "u1");
});

test("ApprovalWorkflow: submitForReview fails without projectId", () => {
  const aw = new ApprovalWorkflow();
  const r = aw.submitForReview(null, "u1");
  assert.equal(r.ok, false);
  assert.equal(r.error, "project_id_required");
});

test("ApprovalWorkflow: approve marks review approved", () => {
  const aw = new ApprovalWorkflow();
  const rev = aw.submitForReview("proj-1", "u1");
  const r = aw.approve(rev.review.id, "reviewer1", { comment: "Looks great" });
  assert.equal(r.ok, true);
  assert.equal(r.approved, true);
});

test("ApprovalWorkflow: approve fails for duplicate approval", () => {
  const aw = new ApprovalWorkflow();
  const rev = aw.submitForReview("proj-1", "u1");
  aw.approve(rev.review.id, "reviewer1");
  const r = aw.approve(rev.review.id, "reviewer1");
  assert.equal(r.ok, false);
  assert.equal(r.error, "already_approved");
});

test("ApprovalWorkflow: approve fails for non-existent review", () => {
  const aw = new ApprovalWorkflow();
  const r = aw.approve("fake", "u1");
  assert.equal(r.ok, false);
  assert.equal(r.error, "review_not_found");
});

test("ApprovalWorkflow: reject marks review rejected", () => {
  const aw = new ApprovalWorkflow();
  const rev = aw.submitForReview("proj-1", "u1");
  const r = aw.reject(rev.review.id, "reviewer1", { reason: "Needs work" });
  assert.equal(r.ok, true);
  assert.equal(r.rejected, true);
});

test("ApprovalWorkflow: reject fails for duplicate review", () => {
  const aw = new ApprovalWorkflow();
  const rev = aw.submitForReview("proj-1", "u1");
  aw.reject(rev.review.id, "reviewer1");
  const r = aw.reject(rev.review.id, "reviewer1");
  assert.equal(r.ok, false);
  assert.equal(r.error, "already_reviewed");
});

test("ApprovalWorkflow: getReviews returns project reviews", () => {
  const aw = new ApprovalWorkflow();
  aw.submitForReview("proj-1", "u1");
  aw.submitForReview("proj-1", "u2");
  const r = aw.getReviews("proj-1");
  assert.equal(r.ok, true);
  assert.equal(r.count, 2);
});

test("ApprovalWorkflow: getApprovalChain returns steps", () => {
  const aw = new ApprovalWorkflow();
  const rev = aw.submitForReview("proj-1", "u1");
  aw.approve(rev.review.id, "reviewer1", { comment: "OK" });
  aw.reject(rev.review.id, "reviewer2", { reason: "Nope" });
  const r = aw.getApprovalChain("proj-1");
  assert.equal(r.ok, true);
  assert.equal(r.steps.length, 2);
  assert.equal(r.steps[0].decision, "approved");
  assert.equal(r.steps[1].decision, "rejected");
});

// ====================================================================
// 6. PresenceManager
// ====================================================================

test("PresenceManager: setUser registers a user", () => {
  const pm = new PresenceManager();
  const r = pm.setUser({ id: "u1", name: "Alice" });
  assert.equal(r.ok, true);
  assert.equal(r.user.id, "u1");
  assert.equal(r.user.name, "Alice");
  assert.ok(r.user.color);
});

test("PresenceManager: setUser fails without user", () => {
  const pm = new PresenceManager();
  const r = pm.setUser(null);
  assert.equal(r.ok, false);
  assert.equal(r.error, "user_required");
});

test("PresenceManager: setCursor tracks cursor position", () => {
  const pm = new PresenceManager();
  const r = pm.setCursor("u1", { x: 100, y: 200, trackId: "t1", timeCode: 30 });
  assert.equal(r.ok, true);
  assert.equal(r.cursor.x, 100);
  assert.equal(r.cursor.y, 200);
  assert.equal(r.cursor.trackId, "t1");
  assert.equal(r.cursor.timeCode, 30);
});

test("PresenceManager: setCursor fails without userId", () => {
  const pm = new PresenceManager();
  const r = pm.setCursor(null, { x: 0, y: 0 });
  assert.equal(r.ok, false);
  assert.equal(r.error, "user_id_required");
});

test("PresenceManager: setSelection tracks selection range", () => {
  const pm = new PresenceManager();
  const r = pm.setSelection("u1", { trackId: "t1", startFrame: 10, endFrame: 50 });
  assert.equal(r.ok, true);
  assert.equal(r.selection.trackId, "t1");
  assert.equal(r.selection.startFrame, 10);
  assert.equal(r.selection.endFrame, 50);
});

test("PresenceManager: setSelection fails without trackId", () => {
  const pm = new PresenceManager();
  const r = pm.setSelection("u1", { startFrame: 0, endFrame: 10 });
  assert.equal(r.ok, false);
  assert.equal(r.error, "track_id_required");
});

test("PresenceManager: removeUser removes user and cursor", () => {
  const pm = new PresenceManager();
  pm.setUser({ id: "u1", name: "Alice" });
  pm.setCursor("u1", { x: 10, y: 20 });
  const r = pm.removeUser("u1");
  assert.equal(r.ok, true);
  assert.equal(r.removed, true);
  assert.equal(pm.getUsers().count, 0);
  assert.equal(pm.getCursors().count, 0);
});

test("PresenceManager: removeUser returns false for unknown user", () => {
  const pm = new PresenceManager();
  const r = pm.removeUser("u1");
  assert.equal(r.ok, true);
  assert.equal(r.removed, false);
});

test("PresenceManager: getUsers returns all users", () => {
  const pm = new PresenceManager();
  pm.setUser({ id: "u1", name: "Alice" });
  pm.setUser({ id: "u2", name: "Bob" });
  const r = pm.getUsers();
  assert.equal(r.ok, true);
  assert.equal(r.count, 2);
});

test("PresenceManager: getCursors returns all cursors", () => {
  const pm = new PresenceManager();
  pm.setCursor("u1", { x: 10, y: 20 });
  pm.setCursor("u2", { x: 30, y: 40 });
  const r = pm.getCursors();
  assert.equal(r.ok, true);
  assert.equal(r.count, 2);
});

test("PresenceManager: cleanup removes inactive users", () => {
  const pm = new PresenceManager();
  pm.setUser({ id: "u1", name: "Alice" });
  // Backdate cursor update
  pm._cursors.set("u1", {
    userId: "u1", x: 0, y: 0, trackId: null, timeCode: 0,
    updatedAt: new Date(Date.now() - 600000).toISOString(), // 10 min ago
  });
  const r = pm.cleanup(300000); // 5 min threshold
  assert.equal(r.ok, true);
  assert.equal(r.removed, 1);
  assert.equal(pm.getUsers().count, 0);
});

test("PresenceManager: cleanup with invalid threshold fails", () => {
  const pm = new PresenceManager();
  const r = pm.cleanup(-1);
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_max_inactive_ms");
});
