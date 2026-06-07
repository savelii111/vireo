// In-memory Store. Used in dev + tests.

import { newId, nowIso } from "@vireo/shared";

export class MemoryStore {
  constructor() {
    this.name = "memory";
    this.jobs = [];
    this.audit = [];
    this.metrics = [];
  }

  async init() { return this; }
  async close() {}

  // ---- jobs ----

  async addJob(job) {
    const j = { id: job.id || newId(), created_at: nowIso(), ...job };
    this.jobs.push(j);
    return j;
  }

  async listJobs(filter = {}) {
    return this.jobs.filter((j) => {
      if (filter.platform && j.platform !== filter.platform) return false;
      if (filter.status && j.status !== filter.status) return false;
      if (filter.content_id && j.content_id !== filter.content_id) return false;
      return true;
    });
  }

  async getJob(id) {
    return this.jobs.find((j) => j.id === id) || null;
  }

  async updateJob(id, patch) {
    const j = this.jobs.find((x) => x.id === id);
    if (!j) return null;
    Object.assign(j, patch, { updated_at: nowIso() });
    return j;
  }

  // ---- audit ----

  async addAudit(entry) {
    const e = { id: newId(), created_at: nowIso(), ...entry };
    this.audit.push(e);
    return e;
  }

  async listAudit(filter = {}) {
    return this.audit.filter((a) => {
      if (filter.platform && a.platform !== filter.platform) return false;
      if (filter.content_id && a.content_id !== filter.content_id) return false;
      return true;
    });
  }

  // ---- metrics ----

  async addMetric(snap) {
    const s = { id: newId(), created_at: nowIso(), ...snap };
    this.metrics.push(s);
    return s;
  }

  async listMetrics(filter = {}) {
    return this.metrics.filter((m) => {
      if (filter.platform && m.platform !== filter.platform) return false;
      if (filter.content_id && m.content_id !== filter.content_id) return false;
      return true;
    });
  }
}
