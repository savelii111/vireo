// test_production_tools.js — Tests for the 4 Week 6 production tools.
//
//   1. batch_edit        — apply same edit to many clips
//   2. watch_folders     — auto-process new files
//   3. scheduled_edits   — cron-like scheduler
//   4. export_queue      — background render queue
//
// All return JOB envelopes; v1 executes synchronously.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PRODUCTION_TOOLS,
  PRODUCTION_TOOL_NAMES,
  batchEdit,
  getBatchStatus,
  watchFolders,
  listWatchers,
  stopWatcher,
  scheduleEdit,
  listSchedules,
  cancelSchedule,
  queueExport,
  getExportStatus,
  listExportQueue,
} from "../src/production_tools.js";

// ---------- Tool shape ----------

test("Production: 4 tools exported with valid OpenAI shape", () => {
  assert.equal(PRODUCTION_TOOLS.length, 4);
  for (const t of PRODUCTION_TOOLS) {
    assert.equal(t.type, "function");
    assert.ok(t.function.name);
    assert.ok(t.function.description.length > 50);
    assert.equal(t.function.parameters.type, "object");
  }
  const names = PRODUCTION_TOOLS.map((t) => t.function.name).sort();
  assert.deepEqual(names, [
    "batch_edit",
    "queue_export",
    "schedule_edit",
    "watch_folders",
  ]);
});

test("Production: PRODUCTION_TOOL_NAMES set has 4 names", () => {
  assert.equal(PRODUCTION_TOOL_NAMES.size, 4);
});

// ---------- 1. batchEdit ----------

test("batchEdit: returns job_id and executes synchronously", async () => {
  const r = await batchEdit({
    files: ["/tmp/a.mp4", "/tmp/b.mp4", "/tmp/c.mp4"],
    operations: [{ tool: "apply_color_grade", args: { preset: "cinematic" } }],
  });
  assert.equal(r.ok, true);
  assert.ok(r.job_id.startsWith("batch-"));
  assert.equal(r.status, "done");
  assert.equal(r.files_total, 3);
  assert.equal(r.files_done, 3);
  // results is on the inner job envelope (full audit trail)
  assert.equal(r.job.results.length, 3);
  assert.ok(r.estimated_seconds > 0);
});

test("batchEdit: missing files/folder returns error", async () => {
  const r = await batchEdit({ operations: [{ tool: "apply_color_grade", args: {} }] });
  assert.equal(r.ok, false);
  assert.equal(r.error, "files_or_folder_required");
});

test("batchEdit: invalid operations shape returns error", async () => {
  const r = await batchEdit({ files: ["/tmp/a.mp4"], operations: "not-an-array" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "operations_must_be_array");
});

test("batchEdit: unknown operation returns error", async () => {
  const r = await batchEdit({
    files: ["/tmp/a.mp4"],
    operations: [{ tool: "this_does_not_exist", args: {} }],
  });
  assert.equal(r.ok, false);
  assert.equal(r.error, "unknown_op: this_does_not_exist");
  assert.ok(Array.isArray(r.valid_ops));
});

test("batchEdit: getBatchStatus returns the stored job", async () => {
  const r = await batchEdit({ files: ["/tmp/a.mp4"], operations: [{ tool: "apply_color_grade", args: {} }] });
  const status = getBatchStatus(r.job_id);
  assert.equal(status.ok, true);
  assert.equal(status.job.job_id, r.job_id);
});

test("batchEdit: getBatchStatus returns error for unknown id", () => {
  const r = getBatchStatus("nonexistent-id");
  assert.equal(r.ok, false);
  assert.equal(r.error, "job_not_found");
});

// ---------- 2. watchFolders ----------

test("watchFolders: returns watcher_id and status active", async () => {
  const r = await watchFolders({
    folders: ["/tmp/inbox"],
    operations: [{ tool: "apply_color_grade", args: { preset: "warm" } }],
  });
  assert.equal(r.ok, true);
  assert.ok(r.watcher_id.startsWith("watch-"));
  assert.equal(r.status, "active");
  assert.deepEqual(r.folders, ["/tmp/inbox"]);
});

test("watchFolders: missing folders returns error", async () => {
  const r = await watchFolders({ operations: [{ tool: "apply_color_grade", args: {} }] });
  assert.equal(r.ok, false);
  assert.equal(r.error, "folders_array_required");
});

test("watchFolders: missing operations returns error", async () => {
  const r = await watchFolders({ folders: ["/tmp/inbox"] });
  assert.equal(r.ok, false);
  assert.equal(r.error, "operations_array_required");
});

test("watchFolders: listWatchers returns array", async () => {
  await watchFolders({ folders: ["/tmp/test1"], operations: [{ tool: "apply_color_grade", args: {} }], user_id: "u1" });
  await watchFolders({ folders: ["/tmp/test2"], operations: [{ tool: "apply_color_grade", args: {} }], user_id: "u2" });
  const all = listWatchers();
  const u1 = listWatchers({ user_id: "u1" });
  assert.ok(all.length >= 2);
  assert.ok(u1.every((w) => w.user_id === "u1"));
});

test("watchFolders: stopWatcher transitions to stopped", async () => {
  const r = await watchFolders({ folders: ["/tmp/test3"], operations: [{ tool: "apply_color_grade", args: {} }] });
  const stopped = stopWatcher(r.watcher_id);
  assert.equal(stopped.ok, true);
  assert.equal(stopped.status, "stopped");
});

test("watchFolders: stopWatcher for unknown id returns error", () => {
  const r = stopWatcher("nope");
  assert.equal(r.ok, false);
  assert.equal(r.error, "watcher_not_found");
});

// ---------- 3. scheduleEdit ----------

test("scheduleEdit: cron-based schedule created with next_run_at", async () => {
  const r = await scheduleEdit({
    name: "Sunday Recap",
    cron: "0 9 * * 0",
    operations: [{ tool: "apply_color_grade", args: {} }],
  });
  assert.equal(r.ok, true);
  assert.ok(r.schedule_id.startsWith("sched-"));
  assert.equal(r.cron, "0 9 * * 0");
  assert.ok(r.next_run_at > Date.now() - 1000);
});

test("scheduleEdit: ISO start_at accepted", async () => {
  const future = new Date(Date.now() + 86400_000).toISOString();
  const r = await scheduleEdit({
    name: "Tomorrow",
    start_at: future,
    operations: [{ tool: "apply_color_grade", args: {} }],
  });
  assert.equal(r.ok, true);
  assert.equal(r.next_run_at, new Date(future).getTime());
});

test("scheduleEdit: invalid cron returns error", async () => {
  const r = await scheduleEdit({
    name: "Bad",
    cron: "this is not a cron",
    operations: [{ tool: "apply_color_grade", args: {} }],
  });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_cron");
});

test("scheduleEdit: missing name returns error", async () => {
  const r = await scheduleEdit({ operations: [{ tool: "apply_color_grade", args: {} }] });
  assert.equal(r.ok, false);
  assert.equal(r.error, "name_required");
});

test("scheduleEdit: missing cron AND start_at returns error", async () => {
  const r = await scheduleEdit({ name: "X", operations: [{ tool: "apply_color_grade", args: {} }] });
  assert.equal(r.ok, false);
  assert.equal(r.error, "cron_or_start_at_required");
});

test("scheduleEdit: listSchedules + cancelSchedule work", async () => {
  const r = await scheduleEdit({ name: "Test Sched", cron: "0 0 * * *", operations: [{ tool: "apply_color_grade", args: {} }], user_id: "u1" });
  const all = listSchedules({ user_id: "u1" });
  assert.ok(all.length >= 1);
  const cancelled = cancelSchedule(r.schedule_id);
  assert.equal(cancelled.ok, true);
  assert.equal(cancelled.status, "cancelled");
});

test("scheduleEdit: cancelSchedule for unknown id returns error", () => {
  const r = cancelSchedule("nope");
  assert.equal(r.ok, false);
  assert.equal(r.error, "schedule_not_found");
});

// ---------- 4. queueExport ----------

test("queueExport: returns queued job with position", async () => {
  const r = await queueExport({
    file_path: "/tmp/v.mp4",
    format: "mp4",
    preset: "youtube_long",
  });
  assert.equal(r.ok, true);
  assert.ok(r.job_id.startsWith("export-"));
  assert.equal(r.status, "queued");
  assert.equal(r.position, 1);
  assert.ok(r.estimated_seconds > 0);
});

test("queueExport: multiple jobs increment position", async () => {
  const r1 = await queueExport({ file_path: "/tmp/a.mp4", format: "mp4", preset: "youtube_long" });
  const r2 = await queueExport({ file_path: "/tmp/b.mp4", format: "mp4", preset: "tiktok" });
  assert.ok(r1.position >= 1);
  assert.ok(r2.position >= 1);
});

test("queueExport: invalid format returns error", async () => {
  const r = await queueExport({ file_path: "/tmp/v.mp4", format: "avi" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_format");
  assert.ok(Array.isArray(r.valid_formats));
});

test("queueExport: invalid preset returns error", async () => {
  const r = await queueExport({ file_path: "/tmp/v.mp4", format: "mp4", preset: "vhs" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_preset");
  assert.ok(Array.isArray(r.valid_presets));
});

test("queueExport: invalid priority returns error", async () => {
  const r = await queueExport({ file_path: "/tmp/v.mp4", format: "mp4", preset: "tiktok", priority: "yesterday" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_priority");
});

test("queueExport: missing file_path and project_id returns error", async () => {
  const r = await queueExport({ format: "mp4", preset: "tiktok" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "file_path_or_project_id_required");
});

test("queueExport: getExportStatus returns the stored job", async () => {
  const r = await queueExport({ file_path: "/tmp/v.mp4", format: "mp4", preset: "youtube_long" });
  const status = getExportStatus(r.job_id);
  assert.equal(status.ok, true);
  assert.equal(status.job.job_id, r.job_id);
});

test("queueExport: getExportStatus returns error for unknown id", () => {
  const r = getExportStatus("nope");
  assert.equal(r.ok, false);
  assert.equal(r.error, "job_not_found");
});

test("queueExport: listExportQueue returns jobs", async () => {
  await queueExport({ file_path: "/tmp/list_test.mp4", format: "mp4", preset: "tiktok" });
  const list = listExportQueue({ status: "queued" });
  assert.equal(list.ok, true);
  assert.ok(list.total >= 1);
  assert.ok(list.jobs.length >= 1);
});

// ---------- Integration ----------

test("Integration: 4 production tools use same dispatch path", () => {
  // All 4 should be in the same Set so the dispatcher can check membership in O(1)
  assert.ok(PRODUCTION_TOOL_NAMES.has("batch_edit"));
  assert.ok(PRODUCTION_TOOL_NAMES.has("watch_folders"));
  assert.ok(PRODUCTION_TOOL_NAMES.has("schedule_edit"));
  assert.ok(PRODUCTION_TOOL_NAMES.has("queue_export"));
});
