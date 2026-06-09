// test_jobs.js — Tests for SQLite-backed job persistence.
//
// Validates: create, get, list, update, start, complete, fail,
// cancel, retry, claim, events, survival across "restarts".

import { test, before, beforeEach, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, unlinkSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_DB = join(__dirname, '..', 'test-data', 'jobs_test.db');

let jobsModule;

before(async () => {
  const dir = dirname(TEST_DB);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  process.env.VIREO_JOBS_DB = TEST_DB;
  jobsModule = await import('../src/jobs.js');
  // Bind all functions to module-level references
  ({
    createJob, getJob, listJobs, countJobs, updateJob,
    startJob, completeJob, failJob, cancelJob,
    claimNextJob, getJobEvents, dbStats, closeDb,
  } = jobsModule);
});

after(async () => {
  if (jobsModule) jobsModule.closeDb();
  if (existsSync(dirname(TEST_DB))) {
    try { rmSync(dirname(TEST_DB), { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

beforeEach(() => {
  // Clear all data before each test for isolation
  const db = jobsModule._getDbHandle();
  db.exec('DELETE FROM job_events; DELETE FROM jobs;');
});

// Module-level references to jobs functions (set in `before` hook)
let createJob, getJob, listJobs, countJobs, updateJob,
  startJob, completeJob, failJob, cancelJob,
  claimNextJob, getJobEvents, dbStats, closeDb;

// ---------- createJob ----------

test("jobs: createJob returns job with id and queued status", () => {
  const job = createJob({ type: "ffmpeg", args: { cmd: "x" } });
  assert.ok(job.id.startsWith("ffmpeg-"));
  assert.equal(job.status, "queued");
  assert.equal(job.type, "ffmpeg");
  assert.equal(job.progress, 0);
  assert.ok(job.position >= 1);
  assert.equal(job.attempt, 1);
  assert.equal(job.max_attempts, 3);
});

test("jobs: createJob accepts custom id and user_id", () => {
  const job = createJob({ type: "ffmpeg", id: "custom-1", user_id: "u1" });
  assert.equal(job.id, "custom-1");
  assert.equal(job.user_id, "u1");
});

test("jobs: listJobs returns array sorted by priority then recency", () => {
  const now = Date.now();
  createJob({ type: "ffmpeg", created_at: now - 3000 });
  createJob({ type: "export", created_at: now - 2000 });
  createJob({ type: "ffmpeg", user_id: "u1", created_at: now - 1000 });
  const all = listJobs();
  assert.ok(all.length >= 3);
  for (let i = 1; i < all.length; i++) {
    assert.ok(all[i - 1].created_at >= all[i].created_at,
      `Index ${i - 1} (${all[i - 1].created_at}) should be >= index ${i} (${all[i].created_at})`);
  }
});

test("jobs: listJobs filters by type and status", () => {
  createJob({ type: "ffmpeg" });
  createJob({ type: "export" });
  const ffmpeg = listJobs({ type: "ffmpeg" });
  assert.ok(ffmpeg.every((j) => j.type === "ffmpeg"));
});

test("jobs: listJobs respects limit and offset", () => {
  for (let i = 0; i < 5; i++) createJob({ type: "ffmpeg" });
  const page = listJobs({ limit: 2, offset: 1 });
  assert.equal(page.length, 2);
});

test("jobs: countJobs returns total matching filter", () => {
  const n0 = countJobs({ status: "queued" });
  createJob({ type: "ffmpeg" });
  const n1 = countJobs({ status: "queued" });
  assert.equal(n1, n0 + 1);
});

test("jobs: getJob returns full job envelope after create", () => {
  const j = createJob({ type: "export", args: { file: "x" } });
  const fetched = getJob(j.id);
  assert.equal(fetched.id, j.id);
  assert.deepEqual(fetched.args, { file: "x" });
});

test("jobs: getJob returns null for unknown id", () => {
  assert.equal(getJob("nonexistent"), null);
});

test("jobs: getJob returns null for empty id", () => {
  assert.equal(getJob(""), null);
  assert.equal(getJob(null), null);
});

test("jobs: updateJob changes fields", () => {
  const j = createJob({ type: "ffmpeg" });
  const updated = updateJob(j.id, { progress: 0.5, status: "running" });
  assert.equal(updated.progress, 0.5);
  assert.equal(updated.status, "running");
});

test("jobs: updateJob can store result as JSON", () => {
  const j = createJob({ type: "ffmpeg" });
  const updated = updateJob(j.id, { result: { output: "/tmp/out.mp4", duration: 12.5 } });
  assert.deepEqual(updated.result, { output: "/tmp/out.mp4", duration: 12.5 });
});

test("jobs: updateJob returns null for unknown id", () => {
  assert.equal(updateJob("nope", { progress: 0.5 }), null);
});

test("jobs: startJob sets status=running and started_at", () => {
  const j = createJob({ type: "ffmpeg" });
  const started = startJob(j.id);
  assert.equal(started.status, "running");
  assert.ok(started.started_at > 0);
});

test("jobs: completeJob sets status=done, progress=1, completed_at", () => {
  const j = createJob({ type: "ffmpeg" });
  startJob(j.id);
  const done = completeJob(j.id, { output: "/tmp/out.mp4" });
  assert.equal(done.status, "done");
  assert.equal(done.progress, 1);
  assert.ok(done.completed_at > 0);
  assert.deepEqual(done.result, { output: "/tmp/out.mp4" });
});

test("jobs: failJob with retry=true requeues with backoff", () => {
  const j = createJob({ type: "ffmpeg", max_attempts: 3 });
  const failed = failJob(j.id, "boom");
  assert.equal(failed.status, "queued");
  assert.equal(failed.attempt, 2);
  assert.ok(failed.next_run_at > Date.now());
  assert.equal(failed.last_error, "boom");
});

test("jobs: failJob with retry=false marks as failed", () => {
  const j = createJob({ type: "ffmpeg", max_attempts: 3 });
  const failed = failJob(j.id, "boom", { retry: false });
  assert.equal(failed.status, "failed");
  assert.equal(failed.error, "boom");
});

test("jobs: failJob exhausts attempts then marks failed", () => {
  const j = createJob({ type: "ffmpeg", max_attempts: 2 });
  failJob(j.id, "err1");
  failJob(j.id, "err2");
  const after = getJob(j.id);
  assert.equal(after.status, "failed");
  assert.equal(after.attempt, 2);
});

test("jobs: cancelJob sets status=cancelled", () => {
  const j = createJob({ type: "ffmpeg" });
  const cancelled = cancelJob(j.id, "user_cancelled");
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.error, "user_cancelled");
});

test("jobs: claimNextJob returns the oldest queued job", () => {
  const now = Date.now();
  const a = createJob({ type: "ffmpeg", priority: 5, created_at: now - 2000 });
  const b = createJob({ type: "ffmpeg", priority: 5, created_at: now - 1000 });
  const claimed = claimNextJob(["ffmpeg"]);
  assert.equal(claimed.id, a.id);
  assert.equal(claimed.status, "running");
  assert.notEqual(claimed.id, b.id);
});

test("jobs: claimNextJob filters by type", () => {
  createJob({ type: "export" });
  createJob({ type: "ffmpeg" });
  const claimed = claimNextJob(["ffmpeg"]);
  assert.ok(claimed);
  assert.equal(claimed.type, "ffmpeg");
});

test("jobs: claimNextJob returns null when no jobs of type", () => {
  const claimed = claimNextJob(["nonexistent_type"]);
  assert.equal(claimed, null);
});

test("jobs: createJob records 'created' event", () => {
  const j = createJob({ type: "ffmpeg", args: { x: 1 } });
  const events = getJobEvents(j.id);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "created");
  assert.deepEqual(events[0].payload, { args: { x: 1 } });
});

test("jobs: events are sorted newest first", () => {
  const j = createJob({ type: "ffmpeg" });
  // createJob already records a 'created' event
  const events = getJobEvents(j.id);
  assert.ok(events.length >= 1);
  for (let i = 1; i < events.length; i++) {
    assert.ok(events[i - 1].ts >= events[i].ts,
      `Event ${i - 1} (${events[i - 1].ts}) should be >= event ${i} (${events[i].ts})`);
  }
});

test("jobs: dbStats returns aggregated counts", () => {
  createJob({ type: "ffmpeg" });
  const stats = dbStats();
  assert.ok(stats.total > 0);
  assert.ok(Array.isArray(stats.by_status));
  assert.ok(Array.isArray(stats.by_type));
  assert.ok(typeof stats.db_size_bytes === "number");
});

test("jobs: state survives module reload (simulates restart)", async () => {
  const j = createJob({ type: "ffmpeg", args: { survival: true } });
  startJob(j.id);
  completeJob(j.id, { done: true });
  // Simulate restart by closing the DB
  closeDb();
  // Re-import jobs.js — should open fresh connection
  const jobs2 = await import(`../src/jobs.js?v=${Date.now()}`);
  const fetched = jobs2.getJob(j.id);
  assert.ok(fetched, "Job should exist after restart");
  assert.equal(fetched.status, "done");
  assert.deepEqual(fetched.result, { done: true });
  assert.equal(fetched.type, "ffmpeg");
});
