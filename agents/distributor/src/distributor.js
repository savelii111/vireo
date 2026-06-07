// Main Distributor orchestrator.
//
// Given a content request {editPlan, styleDna, platforms}, produces adapted
// pieces for each platform, schedules them, registers jobs in the store.

import { PLATFORMS, newPublishJob, nowIso } from "@vireo/shared";
import { adaptToAllPlatforms } from "./adapters.js";
import { buildSchedule } from "./scheduler.js";

export class Distributor {
  constructor(store, opts = {}) {
    this.store = store;
    this.opts = opts;
  }

  distribute({ editPlan, styleDna, platforms = PLATFORMS, contentId = "" }) {
    if (!editPlan) throw new Error("editPlan required");
    if (!styleDna) throw new Error("styleDna required");
    if (!Array.isArray(platforms) || platforms.length === 0) {
      throw new Error("platforms must be a non-empty array");
    }
    // Cap to prevent DoS via huge platform lists. PLATFORMS is the canonical
    // set; an attacker passing 10k entries shouldn't get 10k jobs scheduled.
    const MAX_PLATFORMS = 64;
    if (platforms.length > MAX_PLATFORMS) {
      throw new Error(`too many platforms: ${platforms.length} (max ${MAX_PLATFORMS})`);
    }

    // Adapt for every target platform
    const adapted = adaptToAllPlatforms(editPlan, styleDna, platforms);

    // Stamp with contentId so Analyst can correlate metrics later
    const stamped = adapted.map((a) => ({
      ...a,
      content_id: contentId,
    }));

    // Schedule them
    const scheduled = buildSchedule(stamped);

    // Register in store
    const jobs = this.store.addMany(scheduled);

    return {
      content_id: contentId,
      platforms: jobs.length,
      jobs,
    };
  }

  // Run due jobs (worker tick)
  async runDue(publisher) {
    return this.store.tick(new Date(), publisher);
  }
}
