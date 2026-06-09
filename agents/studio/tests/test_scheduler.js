// test_scheduler.js — Tests for the scheduling module.
//
// Validates:
//   1. schedule creates item with id
//   2. schedule validates future time
//   3. schedule validates non-empty platforms
//   4. listScheduled returns all
//   5. listScheduled filters by status
//   6. listScheduled filters by platform
//   7. cancelSchedule sets status to 'cancelled'
//   8. getSchedule returns correct item
//   9. getSchedule unknown id returns null
//  10. updateSchedule modifies fields
//  11. getUpcoming returns items within N hours
//  12. getBestTimeToPost returns times for each platform
//  13. getBestTimeToPost YouTube has weekday/weekend
//  14. getBestTimeToPost TikTok has 3 windows
//  15. getBestTimeToPost Instagram has 2 windows
//  16. getBestTimeToPost Twitter has 2 windows
//  17. getBestTimeToPost LinkedIn has weekday only
//  18. getBestTimeToPost Facebook has weekday only
//  19. Stats track scheduled/published/failed
//  20. Schedule id unique
//  21. Cancel non-existent returns error
//  22. Update non-existent returns error
//  23. List empty returns empty array
//  24. getUpcoming with 0 hours returns empty
//  25. Multiple schedules for same time allowed

import { test } from "node:test";
import assert from "node:assert/strict";
import { Scheduler } from "../src/scheduler.js";

function futureDate(hoursAhead = 1) {
  return new Date(Date.now() + hoursAhead * 3600_000);
}

function makeItem(overrides = {}) {
  return {
    title: "Test Post",
    platforms: ["youtube"],
    scheduled_at: futureDate(2),
    file_path: "/tmp/test.mp4",
    ...overrides,
  };
}

// =====================================================================
// 1. schedule creates item with id
// =====================================================================

test("schedule creates item with id", () => {
  const s = new Scheduler();
  const item = s.schedule(makeItem());
  assert.ok(item.id, "item should have an id");
  assert.equal(typeof item.id, "string");
  assert.ok(item.id.length > 0);
  assert.equal(item.title, "Test Post");
  assert.equal(item.status, "scheduled");
  assert.ok(item.created_at instanceof Date);
});

// =====================================================================
// 2. schedule validates future time
// =====================================================================

test("schedule rejects past time", () => {
  const s = new Scheduler();
  assert.throws(
    () => s.schedule(makeItem({ scheduled_at: new Date(Date.now() - 3600_000) })),
    /scheduled_at must be in the future/
  );
});

test("schedule rejects current time", () => {
  const s = new Scheduler();
  assert.throws(
    () => s.schedule(makeItem({ scheduled_at: new Date() })),
    /scheduled_at must be in the future/
  );
});

// =====================================================================
// 3. schedule validates non-empty platforms
// =====================================================================

test("schedule rejects empty platforms array", () => {
  const s = new Scheduler();
  assert.throws(
    () => s.schedule(makeItem({ platforms: [] })),
    /platforms must be a non-empty array/
  );
});

test("schedule rejects non-array platforms", () => {
  const s = new Scheduler();
  assert.throws(
    () => s.schedule(makeItem({ platforms: "youtube" })),
    /platforms must be a non-empty array/
  );
});

// =====================================================================
// 4. listScheduled returns all
// =====================================================================

test("listScheduled returns all items when no filter", () => {
  const s = new Scheduler();
  s.schedule(makeItem({ title: "A" }));
  s.schedule(makeItem({ title: "B" }));
  s.schedule(makeItem({ title: "C" }));
  const list = s.listScheduled();
  assert.equal(list.length, 3);
});

// =====================================================================
// 5. listScheduled filters by status
// =====================================================================

test("listScheduled filters by status", () => {
  const s = new Scheduler();
  const a = s.schedule(makeItem({ title: "A" }));
  const b = s.schedule(makeItem({ title: "B" }));
  s.schedule(makeItem({ title: "C" }));
  s.cancelSchedule(a.id);
  s.updateSchedule(b.id, { status: "published" });

  assert.equal(s.listScheduled({ status: "scheduled" }).length, 1);
  assert.equal(s.listScheduled({ status: "cancelled" }).length, 1);
  assert.equal(s.listScheduled({ status: "published" }).length, 1);
});

// =====================================================================
// 6. listScheduled filters by platform
// =====================================================================

test("listScheduled filters by platform", () => {
  const s = new Scheduler();
  s.schedule(makeItem({ title: "A", platforms: ["youtube", "tiktok"] }));
  s.schedule(makeItem({ title: "B", platforms: ["twitter"] }));
  s.schedule(makeItem({ title: "C", platforms: ["youtube"] }));

  assert.equal(s.listScheduled({ platform: "youtube" }).length, 2);
  assert.equal(s.listScheduled({ platform: "twitter" }).length, 1);
  assert.equal(s.listScheduled({ platform: "facebook" }).length, 0);
});

// =====================================================================
// 7. cancelSchedule sets status to 'cancelled'
// =====================================================================

test("cancelSchedule sets status to cancelled", () => {
  const s = new Scheduler();
  const item = s.schedule(makeItem());
  assert.equal(item.status, "scheduled");
  const result = s.cancelSchedule(item.id);
  assert.deepEqual(result, { ok: true });
  assert.equal(s.getSchedule(item.id).status, "cancelled");
});

// =====================================================================
// 8. getSchedule returns correct item
// =====================================================================

test("getSchedule returns correct item by id", () => {
  const s = new Scheduler();
  const item = s.schedule(makeItem({ title: "Target" }));
  const found = s.getSchedule(item.id);
  assert.equal(found.title, "Target");
  assert.equal(found.id, item.id);
});

// =====================================================================
// 9. getSchedule unknown id returns null
// =====================================================================

test("getSchedule returns null for unknown id", () => {
  const s = new Scheduler();
  assert.equal(s.getSchedule("nonexistent-id"), null);
});

// =====================================================================
// 10. updateSchedule modifies fields
// =====================================================================

test("updateSchedule modifies specified fields", () => {
  const s = new Scheduler();
  const item = s.schedule(makeItem());
  const updated = s.updateSchedule(item.id, { title: "New Title", platforms: ["tiktok"] });
  assert.equal(updated.title, "New Title");
  assert.deepEqual(updated.platforms, ["tiktok"]);
  // id and created_at should not change
  assert.equal(updated.id, item.id);
  assert.equal(updated.created_at, item.created_at);
});

test("updateSchedule can change scheduled_at", () => {
  const s = new Scheduler();
  const item = s.schedule(makeItem());
  const newDate = futureDate(10);
  const updated = s.updateSchedule(item.id, { scheduled_at: newDate });
  assert.equal(updated.scheduled_at.getTime(), newDate.getTime());
});

// =====================================================================
// 11. getUpcoming returns items within N hours
// =====================================================================

test("getUpcoming returns items scheduled within N hours", () => {
  const s = new Scheduler();
  s.schedule(makeItem({ title: "Soon", scheduled_at: futureDate(2) }));
  s.schedule(makeItem({ title: "Later", scheduled_at: futureDate(48) }));

  const upcoming24 = s.getUpcoming(24);
  assert.equal(upcoming24.length, 1);
  assert.equal(upcoming24[0].title, "Soon");
});

test("getUpcoming excludes cancelled items", () => {
  const s = new Scheduler();
  const item = s.schedule(makeItem({ scheduled_at: futureDate(2) }));
  s.cancelSchedule(item.id);
  assert.equal(s.getUpcoming(24).length, 0);
});

// =====================================================================
// 12. getBestTimeToPost returns times for each platform
// =====================================================================

test("getBestTimeToPost returns result for known platforms", () => {
  const s = new Scheduler();
  const platforms = ["youtube", "tiktok", "instagram", "twitter", "linkedin", "facebook"];
  for (const p of platforms) {
    const result = s.getBestTimeToPost(p);
    assert.ok(result, `${p} should return a result`);
    assert.ok(Array.isArray(result.recommended_times), `${p} should have recommended_times array`);
    assert.ok(result.reason.length > 0, `${p} should have a reason`);
  }
});

// =====================================================================
// 13. getBestTimeToPost YouTube has weekday/weekend
// =====================================================================

test("getBestTimeToPost YouTube includes weekday and weekend times", () => {
  const s = new Scheduler();
  const result = s.getBestTimeToPost("youtube");
  const times = result.recommended_times.join(" ");
  assert.ok(times.includes("weekday"), "should mention weekdays");
  assert.ok(times.includes("weekend"), "should mention weekends");
});

// =====================================================================
// 14. getBestTimeToPost TikTok has 3 windows
// =====================================================================

test("getBestTimeToPost TikTok has 3 time windows", () => {
  const s = new Scheduler();
  const result = s.getBestTimeToPost("tiktok");
  assert.equal(result.recommended_times.length, 3);
});

// =====================================================================
// 15. getBestTimeToPost Instagram has 2 windows
// =====================================================================

test("getBestTimeToPost Instagram has 2 time windows", () => {
  const s = new Scheduler();
  const result = s.getBestTimeToPost("instagram");
  assert.equal(result.recommended_times.length, 2);
});

// =====================================================================
// 16. getBestTimeToPost Twitter has 2 windows
// =====================================================================

test("getBestTimeToPost Twitter has 2 time windows", () => {
  const s = new Scheduler();
  const result = s.getBestTimeToPost("twitter");
  assert.equal(result.recommended_times.length, 2);
});

// =====================================================================
// 17. getBestTimeToPost LinkedIn has weekday only
// =====================================================================

test("getBestTimeToPost LinkedIn mentions weekdays only", () => {
  const s = new Scheduler();
  const result = s.getBestTimeToPost("linkedin");
  const times = result.recommended_times.join(" ");
  assert.ok(times.includes("weekday"), "should mention weekdays");
  assert.ok(!times.includes("weekend"), "should NOT mention weekends");
});

// =====================================================================
// 18. getBestTimeToPost Facebook has weekday only
// =====================================================================

test("getBestTimeToPost Facebook mentions weekdays only", () => {
  const s = new Scheduler();
  const result = s.getBestTimeToPost("facebook");
  const times = result.recommended_times.join(" ");
  assert.ok(times.includes("weekday"), "should mention weekdays");
  assert.ok(!times.includes("weekend"), "should NOT mention weekends");
});

// =====================================================================
// 19. Stats track scheduled/published/failed
// =====================================================================

test("stats tracks scheduled, published, and failed counts", () => {
  const s = new Scheduler();
  const a = s.schedule(makeItem({ title: "A" }));
  const b = s.schedule(makeItem({ title: "B" }));
  const c = s.schedule(makeItem({ title: "C" }));
  s.schedule(makeItem({ title: "D" }));

  s.cancelSchedule(a.id); // cancelled — not counted
  s.updateSchedule(b.id, { status: "published" });
  s.updateSchedule(c.id, { status: "failed" });

  const stats = s.stats();
  assert.equal(stats.total_scheduled, 1, "D remains scheduled");
  assert.equal(stats.total_published, 1, "B is published");
  assert.equal(stats.total_failed, 1, "C is failed");
});

// =====================================================================
// 20. Schedule id unique
// =====================================================================

test("each scheduled item gets a unique id", () => {
  const s = new Scheduler();
  const ids = new Set();
  for (let i = 0; i < 20; i++) {
    const item = s.schedule(makeItem({ title: `Post ${i}` }));
    ids.add(item.id);
  }
  assert.equal(ids.size, 20, "all 20 ids should be unique");
});

// =====================================================================
// 21. Cancel non-existent returns error
// =====================================================================

test("cancelSchedule throws for non-existent id", () => {
  const s = new Scheduler();
  assert.throws(
    () => s.cancelSchedule("does-not-exist"),
    /schedule not found/
  );
});

// =====================================================================
// 22. Update non-existent returns error
// =====================================================================

test("updateSchedule throws for non-existent id", () => {
  const s = new Scheduler();
  assert.throws(
    () => s.updateSchedule("does-not-exist", { title: "X" }),
    /schedule not found/
  );
});

// =====================================================================
// 23. List empty returns empty array
// =====================================================================

test("listScheduled returns empty array when no items exist", () => {
  const s = new Scheduler();
  assert.deepEqual(s.listScheduled(), []);
  assert.deepEqual(s.listScheduled({ status: "scheduled" }), []);
  assert.deepEqual(s.listScheduled({ platform: "youtube" }), []);
});

// =====================================================================
// 24. getUpcoming with 0 hours returns empty
// =====================================================================

test("getUpcoming with 0 hours returns empty array", () => {
  const s = new Scheduler();
  s.schedule(makeItem({ scheduled_at: futureDate(1) }));
  assert.deepEqual(s.getUpcoming(0), []);
});

// =====================================================================
// 25. Multiple schedules for same time allowed
// =====================================================================

test("allows multiple schedules for the same time", () => {
  const s = new Scheduler();
  const time = futureDate(5);
  s.schedule(makeItem({ title: "A", scheduled_at: time }));
  s.schedule(makeItem({ title: "B", scheduled_at: time }));
  s.schedule(makeItem({ title: "C", scheduled_at: time }));
  const list = s.listScheduled();
  assert.equal(list.length, 3, "all three should exist");
});

// =====================================================================
// Bonus: getBestTimeToPost returns null for unknown platform
// =====================================================================

test("getBestTimeToPost returns null for unknown platform", () => {
  const s = new Scheduler();
  assert.equal(s.getBestTimeToPost("unknown_platform"), null);
});

// =====================================================================
// Bonus: schedule accepts ISO string for scheduled_at
// =====================================================================

test("schedule accepts ISO string for scheduled_at", () => {
  const s = new Scheduler();
  const future = new Date(Date.now() + 7200_000);
  const item = s.schedule(makeItem({ scheduled_at: future.toISOString() }));
  assert.ok(item.scheduled_at instanceof Date);
  assert.equal(item.scheduled_at.getTime(), future.getTime());
});
