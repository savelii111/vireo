// In-memory job store. Replace with Postgres + Redis in production.
//
// Schema: jobs[] with {id, content_id, platform, scheduled_at, status, ...}
// Supports basic CRUD + a worker tick() that runs due jobs.

import { newPublishJob, nowIso } from "@vireo/shared";

export class JobStore {
  constructor() {
    this.jobs = [];
    this.publishedLog = []; // immutable audit log for EU AI Act
  }

  add(job) {
    const j = { ...newPublishJob(), ...job };
    this.jobs.push(j);
    return j;
  }

  addMany(jobs) {
    return jobs.map((j) => this.add(j));
  }

  list(filter = {}) {
    return this.jobs.filter((j) => {
      if (filter.platform && j.platform !== filter.platform) return false;
      if (filter.status && j.status !== filter.status) return false;
      if (filter.content_id && j.content_id !== filter.content_id) return false;
      return true;
    });
  }

  // Paginated list. Returns { items, total, offset, limit, has_more } so
  // large job queues don't blow up the response payload.
  listPaged({ offset = 0, limit = 50, ...filter } = {}) {
    const all = this.list(filter);
    const safeOffset = Math.max(0, Number(offset) || 0);
    const safeLimit = Math.min(500, Math.max(1, Number(limit) || 50));
    return {
      items: all.slice(safeOffset, safeOffset + safeLimit),
      total: all.length,
      offset: safeOffset,
      limit: safeLimit,
      has_more: safeOffset + safeLimit < all.length,
    };
  }

  get(id) {
    return this.jobs.find((j) => j.id === id);
  }

  update(id, patch) {
    const j = this.jobs.find((x) => x.id === id);
    if (!j) return null;
    Object.assign(j, patch);
    return j;
  }

  pending(now = new Date()) {
    return this.jobs.filter(
      (j) => j.status === "pending" && new Date(j.scheduled_at) <= now
    );
  }

  // Mark a job as published and append to audit log (EU AI Act compliance)
  markPublished(id, platform_post_id, metadata = {}) {
    const job = this.get(id);
    if (!job) return null;
    const mergedMetadata = { ...(job.metadata || {}), ...metadata };
    const j = this.update(id, {
      status: "published",
      published_at: nowIso(),
      platform_post_id,
      metadata: mergedMetadata,
    });
    if (j) {
      this.publishedLog.push({
        job_id: j.id,
        content_id: j.content_id,
        platform: j.platform,
        platform_post_id,
        published_at: j.published_at,
        // EU AI Act: every AI-generated publish is auto-logged
        ai_generated: true,
        eu_ai_act_logged: true,
      });
    }
    return j;
  }

  markFailed(id, error) {
    return this.update(id, { status: "failed", error: String(error) });
  }

  // Run all due jobs through the given publisher. Returns count.
  async tick(now = new Date(), publisher) {
    const due = this.pending(now);
    let ok = 0;
    for (const job of due) {
      try {
        const result = await publisher(job);
        this.markPublished(job.id, result.platform_post_id, result.metadata || {});
        ok += 1;
      } catch (e) {
        this.markFailed(job.id, e.message || String(e));
      }
    }
    return ok;
  }

  auditLog() {
    // Deep copy so callers can mutate items without corrupting the store.
    // Audit logs are immutable by EU AI Act — but the API surface should
    // also be safe.
    return this.publishedLog.map((entry) => ({ ...entry }));
  }
}
