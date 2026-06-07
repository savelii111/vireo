// Unit tests for the scheduler.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nextSlotFor, buildSchedule, PEAK_WINDOWS_PUBLIC } from "../src/scheduler.js";
import { PLATFORMS } from "@vireo/shared";

test("nextSlotFor: returns ISO string", () => {
  const slot = nextSlotFor("youtube", new Date("2026-06-15T08:00:00Z"));
  assert.match(slot, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
});

test("nextSlotFor: never returns a time in the past", () => {
  const past = new Date("2026-06-15T03:00:00Z");
  const slot = nextSlotFor("youtube", past);
  assert.ok(new Date(slot) > past, `Got slot ${slot} for past ${past.toISOString()}`);
});

test("nextSlotFor: lands within a peak window for the platform", () => {
  const after = new Date("2026-06-15T00:00:00Z");
  for (const p of PLATFORMS) {
    const slot = nextSlotFor(p, after);
    const hour = new Date(slot).getUTCHours();
    const window = PEAK_WINDOWS_PUBLIC[p] || [12];
    assert.ok(
      window.includes(hour),
      `${p}: hour ${hour} not in peak window ${JSON.stringify(window)} (got ${slot})`
    );
  }
});

test("nextSlotFor: respects existing jobs (no collision within 15 min)", () => {
  const after = new Date("2026-06-15T00:00:00Z");
  const existing = [{ scheduled_at: nextSlotFor("x", after) }];
  const slot = nextSlotFor("x", after, existing);
  const slotMs = new Date(slot).getTime();
  const existingMs = new Date(existing[0].scheduled_at).getTime();
  const diffMin = Math.abs(slotMs - existingMs) / 60000;
  assert.ok(diffMin >= 15, `Slots too close: ${diffMin} min`);
});

test("nextSlotFor: never crashes on weird existing data", () => {
  const after = new Date("2026-06-15T00:00:00Z");
  const slot = nextSlotFor("youtube", after, [null, undefined, {}, { scheduled_at: "garbage" }]);
  assert.ok(slot);
});

test("buildSchedule: produces one per platform, all distinct", () => {
  const adapted = PLATFORMS.map((p) => ({ platform: p }));
  const jobs = buildSchedule(adapted, new Date("2026-06-15T00:00:00Z"));
  assert.equal(jobs.length, PLATFORMS.length);
  // Sort by scheduled_at
  for (let i = 1; i < jobs.length; i++) {
    assert.ok(new Date(jobs[i].scheduled_at) >= new Date(jobs[i - 1].scheduled_at));
  }
});

test("buildSchedule: gap between consecutive jobs >= 0 (sorted)", () => {
  const adapted = PLATFORMS.map((p) => ({ platform: p }));
  const jobs = buildSchedule(adapted, new Date("2026-06-15T00:00:00Z"));
  for (let i = 1; i < jobs.length; i++) {
    const diff = new Date(jobs[i].scheduled_at) - new Date(jobs[i - 1].scheduled_at);
    assert.ok(diff >= 0);
  }
});
