// project_management.js — Project Management module for Vireo Studio.
//
// Provides 10 classes for full project lifecycle management:
//   1.  MultiProjectManager   — CRUD, archive, duplicate, search projects
//   2.  ProjectTemplate       — create / apply / list project templates
//   3.  VersionControl         — snapshots, diffs, revert, auto-save
//   4.  DeadlineTracker        — deadlines, overdue, upcoming
//   5.  TaskAssignment         — assign / complete / track tasks
//   6.  ProgressTracker        — milestones, progress percentage, history
//   7.  ClientPortal           — clients, sharing, feedback
//   8.  InvoiceGenerator       — invoices, payments, revenue reports
//   9.  Workspace              — teams, members, permissions
//   10. NotificationSystem     — notifications, subscriptions
//
// All classes are in-memory (no external deps) and follow the standard
// validation pattern: return { ok: true, ... } or { ok: false, error }.

import { randomUUID } from "node:crypto";

// ====================================================================
// 1. MultiProjectManager — CRUD, archive, duplicate, search
// ====================================================================

export class MultiProjectManager {
  constructor() {
    /** @type {Map<string, object>} projectId → project */
    this._projects = new Map();
  }

  /**
   * Create a new project.
   * @param {{ name: string, description?: string, template?: string }} opts
   * @returns {{ ok: boolean, project?: object, error?: string }}
   */
  createProject({ name, description = "", template = "blank" } = {}) {
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return { ok: false, error: "name_required" };
    }
    const project = {
      id: randomUUID(),
      name: name.trim(),
      description,
      template,
      status: "active",
      tracks: [],
      clips: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this._projects.set(project.id, project);
    return { ok: true, project };
  }

  /**
   * Get a project by id.
   * @param {string} id
   * @returns {{ ok: boolean, project?: object, error?: string }}
   */
  getProject(id) {
    if (!id) return { ok: false, error: "id_required" };
    const project = this._projects.get(id);
    if (!project) return { ok: false, error: "project_not_found" };
    return { ok: true, project };
  }

  /**
   * List projects with optional filter and sort.
   * @param {{ filter?: { status?: string }, sort?: { field?: string, dir?: string } }} opts
   * @returns {{ ok: boolean, projects: object[] }}
   */
  listProjects({ filter = {}, sort = {} } = {}) {
    let projects = Array.from(this._projects.values());

    if (filter.status) {
      projects = projects.filter((p) => p.status === filter.status);
    }

    const field = sort.field || "createdAt";
    const dir = sort.dir === "asc" ? 1 : -1;
    projects.sort((a, b) => {
      if (a[field] < b[field]) return -dir;
      if (a[field] > b[field]) return dir;
      return 0;
    });

    return { ok: true, projects };
  }

  /**
   * Delete a project (hard delete).
   * @param {string} id
   * @returns {{ ok: boolean, deleted?: boolean, error?: string }}
   */
  deleteProject(id) {
    if (!id) return { ok: false, error: "id_required" };
    if (!this._projects.has(id)) return { ok: false, error: "project_not_found" };
    this._projects.delete(id);
    return { ok: true, deleted: true };
  }

  /**
   * Archive a project (soft-delete).
   * @param {string} id
   * @returns {{ ok: boolean, project?: object, error?: string }}
   */
  archiveProject(id) {
    if (!id) return { ok: false, error: "id_required" };
    const project = this._projects.get(id);
    if (!project) return { ok: false, error: "project_not_found" };
    project.status = "archived";
    project.updatedAt = new Date().toISOString();
    return { ok: true, project };
  }

  /**
   * Duplicate a project with a new id.
   * @param {string} id
   * @returns {{ ok: boolean, project?: object, error?: string }}
   */
  duplicateProject(id) {
    if (!id) return { ok: false, error: "id_required" };
    const original = this._projects.get(id);
    if (!original) return { ok: false, error: "project_not_found" };
    const copy = {
      ...JSON.parse(JSON.stringify(original)),
      id: randomUUID(),
      name: original.name + " (copy)",
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this._projects.set(copy.id, copy);
    return { ok: true, project: copy };
  }
}

// ====================================================================
// 2. ProjectTemplate — create / apply / list / delete templates
// ====================================================================

export class ProjectTemplate {
  constructor(projectManager) {
    /** @type {MultiProjectManager} */
    this._pm = projectManager;
    /** @type {Map<string, object>} templateId → template */
    this._templates = new Map();
  }

  /**
   * Create a reusable template.
   * @param {{ name: string, tracks?: object[], effects?: object[], settings?: object }} opts
   * @returns {{ ok: boolean, template?: object, error?: string }}
   */
  createTemplate({ name, tracks = [], effects = [], settings = {} } = {}) {
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return { ok: false, error: "name_required" };
    }
    const template = {
      id: randomUUID(),
      name: name.trim(),
      tracks,
      effects,
      settings,
      createdAt: new Date().toISOString(),
    };
    this._templates.set(template.id, template);
    return { ok: true, template };
  }

  /**
   * Apply a template to a project (sets tracks and effects).
   * @param {string} projectId
   * @param {string} templateId
   * @returns {{ ok: boolean, project?: object, error?: string }}
   */
  applyTemplate(projectId, templateId) {
    if (!projectId) return { ok: false, error: "project_id_required" };
    if (!templateId) return { ok: false, error: "template_id_required" };
    const tmpl = this._templates.get(templateId);
    if (!tmpl) return { ok: false, error: "template_not_found" };
    const projResult = this._pm.getProject(projectId);
    if (!projResult.ok) return projResult;
    const project = projResult.project;
    project.tracks = JSON.parse(JSON.stringify(tmpl.tracks));
    project.effects = JSON.parse(JSON.stringify(tmpl.effects));
    project.settings = { ...JSON.parse(JSON.stringify(tmpl.settings)) };
    project.template = tmpl.name;
    project.updatedAt = new Date().toISOString();
    return { ok: true, project };
  }

  /**
   * List all templates.
   * @returns {{ ok: boolean, templates: object[] }}
   */
  listTemplates() {
    return { ok: true, templates: Array.from(this._templates.values()) };
  }

  /**
   * Delete a template.
   * @param {string} id
   * @returns {{ ok: boolean, deleted?: boolean, error?: string }}
   */
  deleteTemplate(id) {
    if (!id) return { ok: false, error: "id_required" };
    if (!this._templates.has(id)) return { ok: false, error: "template_not_found" };
    this._templates.delete(id);
    return { ok: true, deleted: true };
  }
}

// ====================================================================
// 3. VersionControl — snapshots, diffs, revert, auto-save
// ====================================================================

export class VersionControl {
  constructor(projectManager) {
    this._pm = projectManager;
    /** @type {Map<string, object[]>} projectId → version[] */
    this._versions = new Map();
    /** @type {Map<string, NodeJS.Timeout>} autoSaveId → timer */
    this._autoSaves = new Map();
  }

  /**
   * Create a snapshot version of a project.
   * @param {string} projectId
   * @param {{ name?: string, description?: string }} opts
   * @returns {{ ok: boolean, version?: object, error?: string }}
   */
  createVersion(projectId, { name = "", description = "" } = {}) {
    if (!projectId) return { ok: false, error: "project_id_required" };
    const projResult = this._pm.getProject(projectId);
    if (!projResult.ok) return projResult;
    const snapshot = JSON.parse(JSON.stringify(projResult.project));
    const version = {
      id: randomUUID(),
      projectId,
      name: name || `v${this._getVersionCount(projectId) + 1}`,
      description,
      snapshot,
      createdAt: new Date().toISOString(),
    };
    if (!this._versions.has(projectId)) this._versions.set(projectId, []);
    this._versions.get(projectId).push(version);
    return { ok: true, version };
  }

  /**
   * Get all versions for a project.
   * @param {string} projectId
   * @returns {{ ok: boolean, versions?: object[], error?: string }}
   */
  getVersions(projectId) {
    if (!projectId) return { ok: false, error: "project_id_required" };
    return { ok: true, versions: this._versions.get(projectId) || [] };
  }

  /**
   * Revert a project to a specific version.
   * @param {string} projectId
   * @param {string} versionId
   * @returns {{ ok: boolean, project?: object, error?: string }}
   */
  revertToVersion(projectId, versionId) {
    if (!projectId) return { ok: false, error: "project_id_required" };
    if (!versionId) return { ok: false, error: "version_id_required" };
    const versions = this._versions.get(projectId) || [];
    const version = versions.find((v) => v.id === versionId);
    if (!version) return { ok: false, error: "version_not_found" };
    const projResult = this._pm.getProject(projectId);
    if (!projResult.ok) return projResult;
    const project = projResult.project;
    const snap = version.snapshot;
    Object.assign(project, {
      name: snap.name,
      description: snap.description,
      tracks: snap.tracks,
      clips: snap.clips,
      settings: snap.settings,
      effects: snap.effects,
      updatedAt: new Date().toISOString(),
    });
    return { ok: true, project };
  }

  /**
   * Compare two versions — returns added/removed/changed fields.
   * @param {string} projectId
   * @param {string} v1 — version id
   * @param {string} v2 — version id
   * @returns {{ ok: boolean, diff?: object, error?: string }}
   */
  compareVersions(projectId, v1, v2) {
    if (!projectId) return { ok: false, error: "project_id_required" };
    if (!v1 || !v2) return { ok: false, error: "two_version_ids_required" };
    const versions = this._versions.get(projectId) || [];
    const ver1 = versions.find((x) => x.id === v1);
    const ver2 = versions.find((x) => x.id === v2);
    if (!ver1) return { ok: false, error: "version1_not_found" };
    if (!ver2) return { ok: false, error: "version2_not_found" };
    const changes = [];
    for (const key of Object.keys(ver1.snapshot)) {
      const a = JSON.stringify(ver1.snapshot[key]);
      const b = JSON.stringify(ver2.snapshot[key]);
      if (a !== b) {
        changes.push({ field: key, oldValue: ver1.snapshot[key], newValue: ver2.snapshot[key] });
      }
    }
    return { ok: true, diff: { changes, identical: changes.length === 0 } };
  }

  /**
   * Auto-save a project at a given interval.
   * @param {string} projectId
   * @param {number} intervalMs
   * @returns {{ ok: boolean, autoSaveId?: string, error?: string }}
   */
  autoSave(projectId, intervalMs = 30000) {
    if (!projectId) return { ok: false, error: "project_id_required" };
    if (typeof intervalMs !== "number" || intervalMs <= 0) {
      return { ok: false, error: "invalid_interval" };
    }
    const id = randomUUID();
    const timer = setInterval(() => {
      this.createVersion(projectId, { name: "auto-save" });
    }, intervalMs);
    this._autoSaves.set(id, { projectId, timer });
    return { ok: true, autoSaveId: id };
  }

  /**
   * Stop an auto-save.
   * @param {string} autoSaveId
   * @returns {{ ok: boolean, stopped?: boolean, error?: string }}
   */
  stopAutoSave(autoSaveId) {
    if (!autoSaveId) return { ok: false, error: "auto_save_id_required" };
    const entry = this._autoSaves.get(autoSaveId);
    if (!entry) return { ok: false, error: "auto_save_not_found" };
    clearInterval(entry.timer);
    this._autoSaves.delete(autoSaveId);
    return { ok: true, stopped: true };
  }

  /** @private */
  _getVersionCount(projectId) {
    const v = this._versions.get(projectId);
    return v ? v.length : 0;
  }
}

// ====================================================================
// 4. DeadlineTracker — deadlines, overdue, upcoming
// ====================================================================

export class DeadlineTracker {
  constructor(projectManager) {
    this._pm = projectManager;
    /** @type {Map<string, object>} projectId → deadline */
    this._deadlines = new Map();
  }

  /**
   * Set or update a project deadline.
   * @param {string} projectId
   * @param {string} date — ISO date string
   * @returns {{ ok: boolean, deadline?: object, error?: string }}
   */
  setDeadline(projectId, date) {
    if (!projectId) return { ok: false, error: "project_id_required" };
    if (!date) return { ok: false, error: "date_required" };
    const deadline = {
      id: randomUUID(),
      projectId,
      date,
      completed: false,
      createdAt: new Date().toISOString(),
    };
    this._deadlines.set(projectId, deadline);
    return { ok: true, deadline };
  }

  /**
   * Get deadline for a project.
   * @param {string} projectId
   * @returns {{ ok: boolean, deadline?: object, error?: string }}
   */
  getDeadline(projectId) {
    if (!projectId) return { ok: false, error: "project_id_required" };
    const d = this._deadlines.get(projectId);
    if (!d) return { ok: false, error: "deadline_not_found" };
    return { ok: true, deadline: d };
  }

  /**
   * Get all projects whose deadlines have passed and are not completed.
   * @returns {{ ok: boolean, projects: object[] }}
   */
  getOverdue() {
    const now = new Date();
    const overdue = [];
    for (const [projectId, d] of this._deadlines) {
      if (!d.completed && new Date(d.date) < now) {
        const projResult = this._pm.getProject(projectId);
        if (projResult.ok) overdue.push(projResult.project);
      }
    }
    return { ok: true, projects: overdue };
  }

  /**
   * Get projects with deadlines within the next N days.
   * @param {number} days
   * @returns {{ ok: boolean, projects: object[] }}
   */
  getUpcoming(days = 7) {
    const now = new Date();
    const future = new Date(now.getTime() + days * 86400000);
    const upcoming = [];
    for (const [projectId, d] of this._deadlines) {
      if (!d.completed) {
        const dl = new Date(d.date);
        if (dl >= now && dl <= future) {
          const projResult = this._pm.getProject(projectId);
          if (projResult.ok) upcoming.push(projResult.project);
        }
      }
    }
    return { ok: true, projects: upcoming };
  }

  /**
   * Mark a project's deadline as complete.
   * @param {string} projectId
   * @returns {{ ok: boolean, deadline?: object, error?: string }}
   */
  markComplete(projectId) {
    if (!projectId) return { ok: false, error: "project_id_required" };
    const d = this._deadlines.get(projectId);
    if (!d) return { ok: false, error: "deadline_not_found" };
    d.completed = true;
    return { ok: true, deadline: d };
  }
}

// ====================================================================
// 5. TaskAssignment — assign / complete / track tasks
// ====================================================================

export class TaskAssignment {
  constructor() {
    /** @type {Map<string, object>} taskId → task */
    this._tasks = new Map();
  }

  /**
   * Assign a task to a user in a project.
   * @param {string} projectId
   * @param {{ title: string, assignee: string, dueDate?: string }} opts
   * @returns {{ ok: boolean, task?: object, error?: string }}
   */
  assignTask(projectId, { title, assignee, dueDate = null } = {}) {
    if (!projectId) return { ok: false, error: "project_id_required" };
    if (!title || typeof title !== "string" || title.trim().length === 0) {
      return { ok: false, error: "title_required" };
    }
    if (!assignee) return { ok: false, error: "assignee_required" };
    const task = {
      id: randomUUID(),
      projectId,
      title: title.trim(),
      assignee,
      dueDate,
      status: "pending",
      comments: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this._tasks.set(task.id, task);
    return { ok: true, task };
  }

  /**
   * Mark a task as completed.
   * @param {string} taskId
   * @returns {{ ok: boolean, task?: object, error?: string }}
   */
  completeTask(taskId) {
    if (!taskId) return { ok: false, error: "task_id_required" };
    const task = this._tasks.get(taskId);
    if (!task) return { ok: false, error: "task_not_found" };
    task.status = "completed";
    task.completedAt = new Date().toISOString();
    task.updatedAt = new Date().toISOString();
    return { ok: true, task };
  }

  /**
   * Get all tasks for a project.
   * @param {string} projectId
   * @returns {{ ok: boolean, tasks?: object[], error?: string }}
   */
  getTasks(projectId) {
    if (!projectId) return { ok: false, error: "project_id_required" };
    const tasks = Array.from(this._tasks.values()).filter((t) => t.projectId === projectId);
    return { ok: true, tasks };
  }

  /**
   * Get all tasks assigned to a user across all projects.
   * @param {string} userId
   * @returns {{ ok: boolean, tasks: object[] }}
   */
  getTasksByAssignee(userId) {
    if (!userId) return { ok: false, error: "user_id_required" };
    const tasks = Array.from(this._tasks.values()).filter((t) => t.assignee === userId);
    return { ok: true, tasks };
  }

  /**
   * Update a task's status or add a comment.
   * @param {string} taskId
   * @param {{ status?: string, comment?: string }} opts
   * @returns {{ ok: boolean, task?: object, error?: string }}
   */
  updateTask(taskId, { status, comment } = {}) {
    if (!taskId) return { ok: false, error: "task_id_required" };
    const task = this._tasks.get(taskId);
    if (!task) return { ok: false, error: "task_not_found" };
    if (status) task.status = status;
    if (comment) {
      task.comments.push({ text: comment, createdAt: new Date().toISOString() });
    }
    task.updatedAt = new Date().toISOString();
    return { ok: true, task };
  }
}

// ====================================================================
// 6. ProgressTracker — milestones, percentage, history
// ====================================================================

export class ProgressTracker {
  constructor() {
    /** @type {Map<string, object>} projectId → progress state */
    this._progress = new Map();
  }

  _ensure(projectId) {
    if (!this._progress.has(projectId)) {
      this._progress.set(projectId, {
        projectId,
        percent: 0,
        milestones: [],
        history: [],
      });
    }
    return this._progress.get(projectId);
  }

  /**
   * Update progress percentage and optionally add a milestone.
   * @param {string} projectId
   * @param {{ percent: number, milestone?: string }} opts
   * @returns {{ ok: boolean, progress?: object, error?: string }}
   */
  updateProgress(projectId, { percent, milestone } = {}) {
    if (!projectId) return { ok: false, error: "project_id_required" };
    if (typeof percent !== "number" || percent < 0 || percent > 100) {
      return { ok: false, error: "invalid_percent" };
    }
    const state = this._ensure(projectId);
    state.percent = percent;
    const entry = { percent, timestamp: new Date().toISOString() };
    if (milestone) {
      entry.milestone = milestone;
      state.milestones.push({ name: milestone, percent, reachedAt: entry.timestamp });
    }
    state.history.push(entry);
    return { ok: true, progress: { ...state } };
  }

  /**
   * Get current progress for a project.
   * @param {string} projectId
   * @returns {{ ok: boolean, progress?: object, error?: string }}
   */
  getProgress(projectId) {
    if (!projectId) return { ok: false, error: "project_id_required" };
    if (!this._progress.has(projectId)) return { ok: false, error: "progress_not_found" };
    return { ok: true, progress: { ...this._progress.get(projectId) } };
  }

  /**
   * Get milestones for a project.
   * @param {string} projectId
   * @returns {{ ok: boolean, milestones?: object[], error?: string }}
   */
  getMilestones(projectId) {
    if (!projectId) return { ok: false, error: "project_id_required" };
    const state = this._progress.get(projectId);
    return { ok: true, milestones: state ? state.milestones : [] };
  }

  /**
   * Get full progress history for a project.
   * @param {string} projectId
   * @returns {{ ok: boolean, history?: object[], error?: string }}
   */
  getHistory(projectId) {
    if (!projectId) return { ok: false, error: "project_id_required" };
    const state = this._progress.get(projectId);
    return { ok: true, history: state ? state.history : [] };
  }
}

// ====================================================================
// 7. ClientPortal — clients, sharing, feedback
// ====================================================================

export class ClientPortal {
  constructor() {
    /** @type {Map<string, object>} clientId → client */
    this._clients = new Map();
    /** @type {Map<string, object[]>} clientId:projectId → feedback[] */
    this._feedback = new Map();
    /** @type {Map<string, object>} shareKey → shareLink */
    this._shares = new Map();
  }

  /**
   * Create a client record.
   * @param {{ name: string, email: string, company?: string }} opts
   * @returns {{ ok: boolean, client?: object, error?: string }}
   */
  createClient({ name, email, company = "" } = {}) {
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return { ok: false, error: "name_required" };
    }
    if (!email || typeof email !== "string" || email.trim().length === 0) {
      return { ok: false, error: "email_required" };
    }
    const client = {
      id: randomUUID(),
      name: name.trim(),
      email: email.trim(),
      company,
      createdAt: new Date().toISOString(),
    };
    this._clients.set(client.id, client);
    return { ok: true, client };
  }

  /**
   * Share a project with a client (generate a share link).
   * @param {string} clientId
   * @param {string} projectId
   * @param {{ permissions?: string[] }} opts
   * @returns {{ ok: boolean, shareLink?: object, error?: string }}
   */
  shareProject(clientId, projectId, { permissions = ["view"] } = {}) {
    if (!clientId) return { ok: false, error: "client_id_required" };
    if (!projectId) return { ok: false, error: "project_id_required" };
    if (!this._clients.has(clientId)) return { ok: false, error: "client_not_found" };
    const shareLink = {
      id: randomUUID(),
      clientId,
      projectId,
      permissions,
      token: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    this._shares.set(shareLink.id, shareLink);
    return { ok: true, shareLink };
  }

  /**
   * Get feedback for a project from a specific client.
   * @param {string} clientId
   * @param {string} projectId
   * @returns {{ ok: boolean, feedback?: object[], error?: string }}
   */
  getFeedback(clientId, projectId) {
    if (!clientId) return { ok: false, error: "client_id_required" };
    if (!projectId) return { ok: false, error: "project_id_required" };
    const key = `${clientId}:${projectId}`;
    return { ok: true, feedback: this._feedback.get(key) || [] };
  }

  /**
   * Add feedback for a project.
   * @param {string} projectId
   * @param {{ client_id: string, text: string, timeCode?: string }} opts
   * @returns {{ ok: boolean, feedback?: object, error?: string }}
   */
  addFeedback(projectId, { client_id, text, timeCode } = {}) {
    if (!projectId) return { ok: false, error: "project_id_required" };
    if (!client_id) return { ok: false, error: "client_id_required" };
    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return { ok: false, error: "text_required" };
    }
    const entry = {
      id: randomUUID(),
      clientId: client_id,
      projectId,
      text: text.trim(),
      timeCode: timeCode || null,
      createdAt: new Date().toISOString(),
    };
    const key = `${client_id}:${projectId}`;
    if (!this._feedback.has(key)) this._feedback.set(key, []);
    this._feedback.get(key).push(entry);
    return { ok: true, feedback: entry };
  }
}

// ====================================================================
// 8. InvoiceGenerator — invoices, payments, revenue reports
// ====================================================================

export class InvoiceGenerator {
  constructor() {
    /** @type {Map<string, object>} invoiceId → invoice */
    this._invoices = new Map();
  }

  /**
   * Create an invoice with line items and optional tax.
   * @param {{ client_id: string, items: { description: string, amount: number }[], tax_rate?: number }} opts
   * @returns {{ ok: boolean, invoice?: object, error?: string }}
   */
  createInvoice({ client_id, items = [], tax_rate = 0 } = {}) {
    if (!client_id) return { ok: false, error: "client_id_required" };
    if (!Array.isArray(items) || items.length === 0) {
      return { ok: false, error: "items_required" };
    }
    const subtotal = items.reduce((sum, i) => sum + (i.amount || 0), 0);
    const tax = subtotal * tax_rate;
    const invoice = {
      id: randomUUID(),
      clientId: client_id,
      items,
      subtotal,
      taxRate: tax_rate,
      tax,
      total: subtotal + tax,
      status: "unpaid",
      createdAt: new Date().toISOString(),
    };
    this._invoices.set(invoice.id, invoice);
    return { ok: true, invoice };
  }

  /**
   * Mark an invoice as paid.
   * @param {string} invoiceId
   * @returns {{ ok: boolean, invoice?: object, error?: string }}
   */
  markPaid(invoiceId) {
    if (!invoiceId) return { ok: false, error: "invoice_id_required" };
    const inv = this._invoices.get(invoiceId);
    if (!inv) return { ok: false, error: "invoice_not_found" };
    inv.status = "paid";
    inv.paidAt = new Date().toISOString();
    return { ok: true, invoice: inv };
  }

  /**
   * Get all invoices for a client.
   * @param {string} clientId
   * @returns {{ ok: boolean, invoices?: object[], error?: string }}
   */
  getInvoices(clientId) {
    if (!clientId) return { ok: false, error: "client_id_required" };
    const invoices = Array.from(this._invoices.values()).filter(
      (i) => i.clientId === clientId
    );
    return { ok: true, invoices };
  }

  /**
   * Get total revenue across all paid invoices.
   * @returns {{ ok: boolean, report: object }}
   */
  getTotalRevenue() {
    const all = Array.from(this._invoices.values());
    const paid = all.filter((i) => i.status === "paid");
    const unpaid = all.filter((i) => i.status === "unpaid");
    return {
      ok: true,
      report: {
        totalRevenue: paid.reduce((s, i) => s + i.total, 0),
        pendingRevenue: unpaid.reduce((s, i) => s + i.total, 0),
        invoiceCount: all.length,
        paidCount: paid.length,
        unpaidCount: unpaid.length,
      },
    };
  }
}

// ====================================================================
// 9. Workspace — teams, members, permissions
// ====================================================================

export class Workspace {
  constructor() {
    /** @type {Map<string, object>} workspaceId → workspace */
    this._workspaces = new Map();
    /** @type {Map<string, string[]>} userId → permissions[] */
    this._permissions = new Map();
  }

  /**
   * Create a workspace for a team.
   * @param {{ name: string, team?: string[] }} opts
   * @returns {{ ok: boolean, workspace?: object, error?: string }}
   */
  createWorkspace({ name, team = [] } = {}) {
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return { ok: false, error: "name_required" };
    }
    const ws = {
      id: randomUUID(),
      name: name.trim(),
      members: team.map((userId) => ({ userId, role: "member", joinedAt: new Date().toISOString() })),
      createdAt: new Date().toISOString(),
    };
    this._workspaces.set(ws.id, ws);
    return { ok: true, workspace: ws };
  }

  /**
   * Add a member to a workspace.
   * @param {string} workspaceId
   * @param {string} userId
   * @param {string} role
   * @returns {{ ok: boolean, member?: object, error?: string }}
   */
  addMember(workspaceId, userId, role = "member") {
    if (!workspaceId) return { ok: false, error: "workspace_id_required" };
    if (!userId) return { ok: false, error: "user_id_required" };
    const ws = this._workspaces.get(workspaceId);
    if (!ws) return { ok: false, error: "workspace_not_found" };
    if (ws.members.find((m) => m.userId === userId)) {
      return { ok: false, error: "already_member" };
    }
    const member = { userId, role, joinedAt: new Date().toISOString() };
    ws.members.push(member);
    return { ok: true, member };
  }

  /**
   * Remove a member from a workspace.
   * @param {string} workspaceId
   * @param {string} userId
   * @returns {{ ok: boolean, removed?: boolean, error?: string }}
   */
  removeMember(workspaceId, userId) {
    if (!workspaceId) return { ok: false, error: "workspace_id_required" };
    if (!userId) return { ok: false, error: "user_id_required" };
    const ws = this._workspaces.get(workspaceId);
    if (!ws) return { ok: false, error: "workspace_not_found" };
    const idx = ws.members.findIndex((m) => m.userId === userId);
    if (idx === -1) return { ok: false, error: "member_not_found" };
    ws.members.splice(idx, 1);
    return { ok: true, removed: true };
  }

  /**
   * Get all members in a workspace.
   * @param {string} workspaceId
   * @returns {{ ok: boolean, members?: object[], error?: string }}
   */
  getMembers(workspaceId) {
    if (!workspaceId) return { ok: false, error: "workspace_id_required" };
    const ws = this._workspaces.get(workspaceId);
    if (!ws) return { ok: false, error: "workspace_not_found" };
    return { ok: true, members: ws.members };
  }

  /**
   * Set global permissions for a user.
   * @param {string} userId
   * @param {string[]} permissions
   * @returns {{ ok: boolean, permissions?: string[], error?: string }}
   */
  setPermissions(userId, permissions) {
    if (!userId) return { ok: false, error: "user_id_required" };
    if (!Array.isArray(permissions)) return { ok: false, error: "permissions_must_be_array" };
    this._permissions.set(userId, permissions);
    return { ok: true, permissions };
  }
}

// ====================================================================
// 10. NotificationSystem — notifications, subscriptions
// ====================================================================

export class NotificationSystem {
  constructor() {
    /** @type {Map<string, object[]>} userId → notification[] */
    this._notifications = new Map();
    /** @type {Map<string, Function[]>} userId:event → callback[] */
    this._subscriptions = new Map();
  }

  /**
   * Send a notification to a user.
   * @param {string} userId
   * @param {{ type: string, message: string, projectId?: string }} opts
   * @returns {{ ok: boolean, notification?: object, error?: string }}
   */
  sendNotification(userId, { type, message, projectId } = {}) {
    if (!userId) return { ok: false, error: "user_id_required" };
    if (!type) return { ok: false, error: "type_required" };
    if (!message) return { ok: false, error: "message_required" };
    const notification = {
      id: randomUUID(),
      userId,
      type,
      message,
      projectId: projectId || null,
      read: false,
      createdAt: new Date().toISOString(),
    };
    if (!this._notifications.has(userId)) this._notifications.set(userId, []);
    this._notifications.get(userId).push(notification);

    // trigger subscriptions
    const subs = this._subscriptions.get(`${userId}:${type}`) || [];
    for (const cb of subs) {
      try { cb(notification); } catch (_) { /* subscriber error ignored */ }
    }

    return { ok: true, notification };
  }

  /**
   * Get all notifications for a user.
   * @param {string} userId
   * @returns {{ ok: boolean, notifications?: object[], error?: string }}
   */
  getNotifications(userId) {
    if (!userId) return { ok: false, error: "user_id_required" };
    return { ok: true, notifications: this._notifications.get(userId) || [] };
  }

  /**
   * Mark a notification as read.
   * @param {string} notificationId
   * @returns {{ ok: boolean, notification?: object, error?: string }}
   */
  markRead(notificationId) {
    if (!notificationId) return { ok: false, error: "notification_id_required" };
    for (const notifs of this._notifications.values()) {
      const n = notifs.find((x) => x.id === notificationId);
      if (n) {
        n.read = true;
        return { ok: true, notification: n };
      }
    }
    return { ok: false, error: "notification_not_found" };
  }

  /**
   * Get unread notifications for a user.
   * @param {string} userId
   * @returns {{ ok: boolean, notifications?: object[], error?: string }}
   */
  getUnread(userId) {
    if (!userId) return { ok: false, error: "user_id_required" };
    const all = this._notifications.get(userId) || [];
    return { ok: true, notifications: all.filter((n) => !n.read) };
  }

  /**
   * Subscribe to a notification event for a user.
   * @param {string} userId
   * @param {string} event — notification type to listen for
   * @param {Function} callback
   * @returns {{ ok: boolean, subscriptionId?: string, error?: string }}
   */
  subscribe(userId, event, callback) {
    if (!userId) return { ok: false, error: "user_id_required" };
    if (!event) return { ok: false, error: "event_required" };
    if (typeof callback !== "function") return { ok: false, error: "callback_required" };
    const key = `${userId}:${event}`;
    if (!this._subscriptions.has(key)) this._subscriptions.set(key, []);
    this._subscriptions.get(key).push(callback);
    return { ok: true, subscriptionId: key };
  }
}

// ====================================================================
// Convenience export
// ====================================================================

export const PROJECT_MANAGEMENT_CLASSES = [
  "MultiProjectManager",
  "ProjectTemplate",
  "VersionControl",
  "DeadlineTracker",
  "TaskAssignment",
  "ProgressTracker",
  "ClientPortal",
  "InvoiceGenerator",
  "Workspace",
  "NotificationSystem",
];
