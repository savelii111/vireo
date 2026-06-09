// test_collab_tools.js — Tests for the 10 collaboration tools.
//
//   1. share_project             — share project with users
//   2. add_comment               — timestamped comments
//   3. resolve_comment           — mark comments resolved
//   4. list_comments             — list with filters
//   5. get_presence              — real-time user presence
//   6. update_presence           — update cursor/selection
//   7. get_history               — edit history with limit
//   8. revert_to_version         — revert to previous version
//   9. create_approval           — create approval request
//   10. approve_video            — approve/reject/revision
//
// All return {ok, ...} and use in-memory stores for v1.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COLLAB_TOOLS,
  COLLAB_TOOL_NAMES,
  shareProject,
  addComment,
  resolveComment,
  listComments,
  getPresence,
  updatePresence,
  getHistory,
  revertToVersion,
  createApproval,
  approveVideo,
  executeCollabToolCall,
} from "../src/collab_tools.js";

// ---------- Tool shape ----------

test("Collab: 10 tools exported with valid OpenAI shape", () => {
  assert.equal(COLLAB_TOOLS.length, 10);
  for (const t of COLLAB_TOOLS) {
    assert.equal(t.type, "function");
    assert.ok(t.function.name);
    assert.ok(t.function.description.length > 50);
    assert.ok(t.function.parameters);
    assert.equal(t.function.parameters.type, "object");
  }
  const names = COLLAB_TOOLS.map((t) => t.function.name).sort();
  assert.deepEqual(names, [
    "add_comment",
    "approve_video",
    "create_approval",
    "get_history",
    "get_presence",
    "list_comments",
    "resolve_comment",
    "revert_to_version",
    "share_project",
    "update_presence",
  ]);
});

test("Collab: COLLAB_TOOL_NAMES set has 10 names", () => {
  assert.equal(COLLAB_TOOL_NAMES.size, 10);
});

// ---------- 1. shareProject ----------

test("shareProject: shares with a single user", async () => {
  const r = await shareProject("proj-1", { users: [{ email: "alice@x.com" }] });
  assert.equal(r.ok, true);
  assert.equal(r.shared, true);
  assert.equal(r.users.length, 1);
  assert.equal(r.users[0].email, "alice@x.com");
  assert.equal(r.users[0].permission, "view");
  assert.ok(r.share_link.includes("proj-1"));
});

test("shareProject: shares with multiple users and different permissions", async () => {
  const r = await shareProject("proj-2", {
    users: [
      { email: "bob@x.com", permission: "edit" },
      { email: "carol@x.com", permission: "admin" },
    ],
  });
  assert.equal(r.ok, true);
  assert.equal(r.users.length, 2);
  assert.equal(r.users[0].permission, "edit");
  assert.equal(r.users[1].permission, "admin");
});

test("shareProject: fails without project_id", async () => {
  const r = await shareProject(null, { users: [{ email: "x@x.com" }] });
  assert.equal(r.ok, false);
  assert.equal(r.error, "project_id_required");
});

test("shareProject: fails without users", async () => {
  const r = await shareProject("proj-1", { users: [] });
  assert.equal(r.ok, false);
  assert.equal(r.error, "users_required");
});

test("shareProject: fails with invalid permission", async () => {
  const r = await shareProject("proj-1", { users: [{ email: "x@x.com", permission: "superadmin" }] });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("invalid_permission"));
});

// ---------- 2. addComment ----------

test("addComment: adds a comment to a project", async () => {
  const r = await addComment({ projectId: "proj-1", text: "Great intro!", author: "alice" });
  assert.equal(r.ok, true);
  assert.ok(r.id);
  assert.equal(r.text, "Great intro!");
  assert.equal(r.author, "alice");
  assert.equal(r.time_sec, 0);
  assert.equal(r.resolved, false);
  assert.ok(r.created_at);
});

test("addComment: adds a timestamped comment on a track", async () => {
  const r = await addComment({ projectId: "proj-1", trackId: "track-5", time_sec: 30.5, text: "Cut here" });
  assert.equal(r.ok, true);
  assert.equal(r.track_id, "track-5");
  assert.equal(r.time_sec, 30.5);
});

test("addComment: fails without text", async () => {
  const r = await addComment({ projectId: "proj-1", text: "" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "text_required");
});

test("addComment: fails without project_id", async () => {
  const r = await addComment({ text: "hello" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "project_id_required");
});

// ---------- 3. resolveComment ----------

test("resolveComment: resolves an existing comment", async () => {
  const added = await addComment({ projectId: "proj-res", text: "Fix this", author: "bob" });
  const r = await resolveComment(added.id);
  assert.equal(r.ok, true);
  assert.equal(r.resolved, true);
  assert.ok(r.resolved_at);
});

test("resolveComment: fails for non-existent comment", async () => {
  const r = await resolveComment("non-existent-id");
  assert.equal(r.ok, false);
  assert.equal(r.error, "comment_not_found");
});

test("resolveComment: fails without comment_id", async () => {
  const r = await resolveComment(null);
  assert.equal(r.ok, false);
  assert.equal(r.error, "comment_id_required");
});

// ---------- 4. listComments ----------

test("listComments: lists all comments for a project", async () => {
  await addComment({ projectId: "proj-lc", text: "Comment 1" });
  await addComment({ projectId: "proj-lc", text: "Comment 2" });
  const r = await listComments("proj-lc");
  assert.equal(r.ok, true);
  assert.equal(r.total_count, 2);
  assert.equal(r.comments.length, 2);
});

test("listComments: filters open comments", async () => {
  const c1 = await addComment({ projectId: "proj-filt", text: "Open" });
  await addComment({ projectId: "proj-filt", text: "Will resolve" });
  await resolveComment(c1.id);
  const r = await listComments("proj-filt", { filter: "open" });
  assert.equal(r.ok, true);
  assert.equal(r.total_count, 1);
  assert.equal(r.comments[0].text, "Will resolve");
});

test("listComments: filters resolved comments", async () => {
  const c1 = await addComment({ projectId: "proj-res2", text: "Resolved one" });
  await resolveComment(c1.id);
  const r = await listComments("proj-res2", { filter: "resolved" });
  assert.equal(r.ok, true);
  assert.equal(r.total_count, 1);
  assert.equal(r.comments[0].resolved, true);
});

test("listComments: fails with invalid filter", async () => {
  const r = await listComments("proj-1", { filter: "invalid" });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("invalid_filter"));
});

// ---------- 5. getPresence ----------

test("getPresence: returns empty list for new project", async () => {
  const r = await getPresence("proj-new-pres");
  assert.equal(r.ok, true);
  assert.equal(r.users.length, 0);
});

test("getPresence: returns users after updatePresence", async () => {
  await updatePresence("proj-pres", { userId: "u1", userName: "Alice", position: 10 });
  await updatePresence("proj-pres", { userId: "u2", userName: "Bob", position: 25 });
  const r = await getPresence("proj-pres");
  assert.equal(r.ok, true);
  assert.equal(r.users.length, 2);
  assert.equal(r.users[0].name, "Alice");
  assert.equal(r.users[1].name, "Bob");
  assert.equal(r.users[0].cursor_position, 10);
  assert.equal(r.users[1].cursor_position, 25);
  assert.ok(r.users[0].color);
  assert.ok(r.users[1].color);
});

// ---------- 6. updatePresence ----------

test("updatePresence: updates position and selection", async () => {
  const r = await updatePresence("proj-up", {
    userId: "u1",
    userName: "Alice",
    position: 42,
    selection: { start: 10, end: 30 },
  });
  assert.equal(r.ok, true);
  assert.equal(r.updated, true);
  assert.equal(r.position, 42);
  assert.deepEqual(r.selection, { start: 10, end: 30 });
});

test("updatePresence: fails without project_id", async () => {
  const r = await updatePresence(null, { position: 0 });
  assert.equal(r.ok, false);
  assert.equal(r.error, "project_id_required");
});

// ---------- 7. getHistory ----------

test("getHistory: returns history entries", async () => {
  // Add some comments to generate history
  await addComment({ projectId: "proj-hist", text: "First" });
  await addComment({ projectId: "proj-hist", text: "Second" });
  const r = await getHistory("proj-hist");
  assert.equal(r.ok, true);
  assert.ok(r.total_actions >= 2);
  assert.ok(r.history.length >= 2);
  // Most recent first
  assert.ok(r.history[0].action === "add_comment");
  assert.ok(r.history[0].timestamp);
});

test("getHistory: respects limit", async () => {
  for (let i = 0; i < 5; i++) {
    await addComment({ projectId: "proj-hist-lim", text: `Msg ${i}` });
  }
  const r = await getHistory("proj-hist-lim", { limit: 2 });
  assert.equal(r.ok, true);
  assert.equal(r.history.length, 2);
  assert.equal(r.total_actions, 5);
});

test("getHistory: fails without project_id", async () => {
  const r = await getHistory(null);
  assert.equal(r.ok, false);
  assert.equal(r.error, "project_id_required");
});

// ---------- 8. revertToVersion ----------

test("revertToVersion: reverts successfully", async () => {
  const r = await revertToVersion("proj-1", "v1.0.3");
  assert.equal(r.ok, true);
  assert.equal(r.reverted, true);
  assert.equal(r.version_id, "v1.0.3");
  assert.equal(r.restored_to, "v1.0.3");
});

test("revertToVersion: fails without version_id", async () => {
  const r = await revertToVersion("proj-1", null);
  assert.equal(r.ok, false);
  assert.equal(r.error, "version_id_required");
});

// ---------- 9. createApproval ----------

test("createApproval: creates an approval request", async () => {
  const r = await createApproval({
    projectId: "proj-appr",
    reviewers: [{ email: "reviewer1@x.com" }, { email: "reviewer2@x.com" }],
  });
  assert.equal(r.ok, true);
  assert.ok(r.id);
  assert.equal(r.reviewers.length, 2);
  assert.equal(r.status, "pending");
  assert.equal(r.reviewers[0].status, "pending");
});

test("createApproval: fails without reviewers", async () => {
  const r = await createApproval({ projectId: "proj-1", reviewers: [] });
  assert.equal(r.ok, false);
  assert.equal(r.error, "reviewers_required");
});

// ---------- 10. approveVideo ----------

test("approveVideo: approves a video", async () => {
  const appr = await createApproval({ projectId: "proj-av", reviewers: [{ email: "reviewer@x.com" }] });
  const r = await approveVideo(appr.id, { reviewer: "reviewer@x.com", decision: "approved", comment: "Looks good!" });
  assert.equal(r.ok, true);
  assert.equal(r.decision, "approved");
  assert.equal(r.reviewer, "reviewer@x.com");
  assert.equal(r.comment, "Looks good!");
  assert.ok(r.timestamp);
});

test("approveVideo: rejects a video", async () => {
  const appr = await createApproval({ projectId: "proj-av2", reviewers: [{ email: "r@x.com" }] });
  const r = await approveVideo(appr.id, { reviewer: "r@x.com", decision: "rejected", comment: "Needs work" });
  assert.equal(r.ok, true);
  assert.equal(r.decision, "rejected");
});

test("approveVideo: requests revision", async () => {
  const appr = await createApproval({ projectId: "proj-av3", reviewers: [{ email: "r@x.com" }] });
  const r = await approveVideo(appr.id, { reviewer: "r@x.com", decision: "revision_needed" });
  assert.equal(r.ok, true);
  assert.equal(r.decision, "revision_needed");
});

test("approveVideo: fails with invalid decision", async () => {
  const appr = await createApproval({ projectId: "proj-av4", reviewers: [{ email: "r@x.com" }] });
  const r = await approveVideo(appr.id, { reviewer: "r@x.com", decision: "maybe" });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("invalid_decision"));
});

test("approveVideo: fails for non-existent approval", async () => {
  const r = await approveVideo("fake-id", { decision: "approved" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "approval_not_found");
});

// ---------- executeCollabToolCall ----------

test("executeCollabToolCall: routes to correct functions", async () => {
  const r1 = await executeCollabToolCall("share_project", { project_id: "p1", users: [{ email: "a@x.com" }] });
  assert.equal(r1.ok, true);

  const r2 = await executeCollabToolCall("add_comment", { project_id: "p1", text: "hi" });
  assert.equal(r2.ok, true);

  const r3 = await executeCollabToolCall("get_history", { project_id: "p1" });
  assert.equal(r3.ok, true);

  const r4 = await executeCollabToolCall("unknown_tool", {});
  assert.equal(r4.ok, false);
  assert.ok(r4.error.includes("unknown_tool"));
});
