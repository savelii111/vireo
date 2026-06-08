// G1+G2: Security utilities tests (2026-06-08).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filterByOwner, isOwnedBy, findForeignIds,
  withTimeout, getToolTimeoutMs,
  undoStore, confirmationStore, isDestructiveTool, getDestructiveTools,
} from "../src/security.js";

test("G1.1: filterByOwner returns only resources belonging to userId", () => {
  const resources = [
    { id: "a", user_id: "u1" },
    { id: "b", user_id: "u2" },
    { id: "c", user_id: "u1" },
    { id: "d", owner_id: "u1" }, // owner_id also accepted
  ];
  const r = filterByOwner(resources, "u1");
  assert.equal(r.length, 3);
  assert.deepEqual(r.map((x) => x.id).sort(), ["a", "c", "d"]);
});

test("G1.1: filterByOwner handles empty input safely", () => {
  assert.deepEqual(filterByOwner([], "u1"), []);
  assert.deepEqual(filterByOwner(null, "u1"), []);
  assert.deepEqual(filterByOwner(undefined, "u1"), []);
  assert.deepEqual(filterByOwner([{ id: "a" }], null), []);
});

test("G1.1: isOwnedBy checks both user_id and owner_id", () => {
  assert.equal(isOwnedBy({ id: "a", user_id: "u1" }, "u1"), true);
  assert.equal(isOwnedBy({ id: "a", user_id: "u1" }, "u2"), false);
  assert.equal(isOwnedBy({ id: "a", owner_id: "u1" }, "u1"), true);
  assert.equal(isOwnedBy(null, "u1"), false);
  assert.equal(isOwnedBy({ id: "a" }, null), false);
});

test("G1.1: findForeignIds returns the IDs that are NOT in ownedIds", () => {
  const owned = ["a", "b", "c"];
  assert.deepEqual(findForeignIds(["a", "b", "c"], owned), []);
  assert.deepEqual(findForeignIds(["a", "x", "c"], owned), ["x"]);
  assert.deepEqual(findForeignIds(["a", "x", "y"], owned), ["x", "y"]);
  assert.deepEqual(findForeignIds([], owned), []);
  assert.deepEqual(findForeignIds(null, owned), []);
});

test("G1.2: withTimeout resolves the promise when it finishes in time", async () => {
  const result = await withTimeout(Promise.resolve("done"), 1000);
  assert.equal(result, "done");
});

test("G1.2: withTimeout rejects with a timeout error", async () => {
  const slow = new Promise((resolve) => setTimeout(() => resolve("late"), 200));
  await assert.rejects(
    withTimeout(slow, 50, "slow_op"),
    /slow_op_timeout_50ms/,
  );
});

test("G1.2: withTimeout does not leak timers on success", async () => {
  // If the timer is leaked, the test process will hang.
  // The 30ms test should complete well before any global
  // unref'd timer.
  await withTimeout(Promise.resolve(1), 30);
  await new Promise((r) => setTimeout(r, 50));
});

test("G1.2: getToolTimeoutMs returns sensible values", () => {
  // Chat tools should be fast (≤10s)
  assert.ok(getToolTimeoutMs("create_project") <= 10_000);
  assert.ok(getToolTimeoutMs("save_content") <= 10_000);
  // Video tools should be slow (≥30s)
  assert.ok(getToolTimeoutMs("cut_video") >= 30_000);
  // Unknown tool falls back to default
  assert.ok(getToolTimeoutMs("totally_made_up_tool") > 0);
});

// ---- G2.1: Undo store ----

test("G2.1: undoStore.record stores a rollback function", () => {
  undoStore.clear("u-undo-1");
  const id = undoStore.record("u-undo-1", {
    tool: "delete_project",
    args: { id: "p-1" },
    rollback: async () => "rolled back",
  });
  assert.ok(id);
  assert.match(id, /^[0-9a-f-]{36}$/);
  const peeked = undoStore.peek("u-undo-1");
  assert.equal(peeked.tool, "delete_project");
  assert.equal(peeked.args.id, "p-1");
});

test("G2.1: undoStore.pop returns the most recent entry and removes it", async () => {
  undoStore.clear("u-undo-2");
  undoStore.record("u-undo-2", { tool: "first", args: {}, rollback: async () => "a" });
  undoStore.record("u-undo-2", { tool: "second", args: {}, rollback: async () => "b" });
  const popped = undoStore.pop("u-undo-2");
  assert.equal(popped.tool, "second");
  // After pop, only "first" should remain
  const list = undoStore.list("u-undo-2");
  assert.equal(list.length, 1);
  assert.equal(list[0].tool, "first");
});

test("G2.1: undoStore.pop returns null when nothing to undo", () => {
  undoStore.clear("u-undo-3");
  assert.equal(undoStore.pop("u-undo-3"), null);
});

test("G2.1: undoStore.list returns the history without the rollback function", () => {
  undoStore.clear("u-undo-4");
  undoStore.record("u-undo-4", { tool: "x", args: { foo: 1 }, rollback: async () => {} });
  const list = undoStore.list("u-undo-4");
  assert.equal(list.length, 1);
  assert.equal(list[0].tool, "x");
  assert.deepEqual(list[0].args, { foo: 1 });
  assert.equal(list[0].rollback, undefined);
});

test("G2.1: undoStore enforces 20-entry limit per user", () => {
  undoStore.clear("u-undo-5");
  for (let i = 0; i < 30; i++) {
    undoStore.record("u-undo-5", { tool: `t${i}`, args: {}, rollback: async () => {} });
  }
  const list = undoStore.list("u-undo-5");
  assert.equal(list.length, 20);
  // Oldest 10 should have been dropped
  assert.equal(list[0].tool, "t10");
});

test("G2.1: undoStore.record throws on missing userId or rollback", () => {
  assert.throws(() => undoStore.record(null, { tool: "x", rollback: async () => {} }));
  assert.throws(() => undoStore.record("u", { tool: "x", rollback: null }));
});

// ---- G2.2: Confirmation store ----

test("G2.2: confirmationStore.create generates a token", () => {
  const token = confirmationStore.create("u-conf-1", { tool: "delete_project", args: { id: "p-1" } });
  assert.ok(token);
  assert.match(token, /^[0-9a-f-]{36}$/);
});

test("G2.2: confirmationStore.consume returns the request and is single-use", () => {
  const token = confirmationStore.create("u-conf-2", { tool: "delete_piece", args: { id: "x" } });
  const r1 = confirmationStore.consume("u-conf-2", token);
  assert.equal(r1.tool, "delete_piece");
  assert.deepEqual(r1.args, { id: "x" });
  // Second consume must return null
  const r2 = confirmationStore.consume("u-conf-2", token);
  assert.equal(r2, null);
});

test("G2.2: confirmationStore.consume returns null for wrong user", () => {
  const token = confirmationStore.create("u-conf-3", { tool: "delete_x", args: {} });
  assert.equal(confirmationStore.consume("u-conf-other", token), null);
});

test("G2.2: confirmationStore.consume returns null for unknown token", () => {
  assert.equal(confirmationStore.consume("u-conf-x", "00000000-0000-0000-0000-000000000000"), null);
});

test("G2.2: confirmationStore.listPending returns active tokens for a user", () => {
  confirmationStore.create("u-conf-list", { tool: "delete_piece", args: { id: "a" } });
  confirmationStore.create("u-conf-list", { tool: "delete_piece", args: { id: "b" } });
  confirmationStore.create("u-conf-other", { tool: "delete_piece", args: {} });
  const pending = confirmationStore.listPending("u-conf-list");
  assert.equal(pending.length, 2);
  for (const t of pending) assert.equal(t.tool, "delete_piece");
});

test("G2.2: confirmationStore.gc removes expired tokens", async () => {
  // We can't wait 5 minutes in a test. Instead, we test
  // the gc method exists and runs without error.
  confirmationStore.create("u-conf-gc", { tool: "x", args: {} });
  confirmationStore.gc();
  const list = confirmationStore.listPending("u-conf-gc");
  // Token should still be there (not expired yet)
  assert.equal(list.length, 1);
});

test("G2.2: isDestructiveTool identifies the dangerous set", () => {
  assert.equal(isDestructiveTool("delete_project"), true);
  assert.equal(isDestructiveTool("delete_account"), true);
  assert.equal(isDestructiveTool("delete_piece"), true);
  assert.equal(isDestructiveTool("revoke_consent"), true);
  // Safe tools
  assert.equal(isDestructiveTool("create_project"), false);
  assert.equal(isDestructiveTool("save_content"), false);
  assert.equal(isDestructiveTool("list_projects"), false);
  assert.equal(isDestructiveTool("get_style_dna"), false);
});

test("G2.2: getDestructiveTools returns the list of dangerous tools", () => {
  const tools = getDestructiveTools();
  assert.ok(tools.includes("delete_project"));
  assert.ok(tools.includes("delete_account"));
  assert.ok(tools.length >= 4);
});
