// test_project_management.js — Tests for the 10 project management classes.
//
//   1.  MultiProjectManager    — CRUD, archive, duplicate
//   2.  ProjectTemplate        — create / apply / list / delete
//   3.  VersionControl         — snapshots, diffs, revert, auto-save
//   4.  DeadlineTracker        — deadlines, overdue, upcoming
//   5.  TaskAssignment         — assign / complete / track tasks
//   6.  ProgressTracker        — milestones, percentage, history
//   7.  ClientPortal           — clients, sharing, feedback
//   8.  InvoiceGenerator       — invoices, payments, revenue
//   9.  Workspace              — teams, members, permissions
//   10. NotificationSystem     — notifications, subscriptions

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MultiProjectManager,
  ProjectTemplate,
  VersionControl,
  DeadlineTracker,
  TaskAssignment,
  ProgressTracker,
  ClientPortal,
  InvoiceGenerator,
  Workspace,
  NotificationSystem,
  PROJECT_MANAGEMENT_CLASSES,
} from "../src/project_management.js";

// ====================================================================
// Shape / Export tests
// ====================================================================

test("PM: all 10 classes are exported", () => {
  assert.equal(PROJECT_MANAGEMENT_CLASSES.length, 10);
  for (const name of PROJECT_MANAGEMENT_CLASSES) {
    assert.ok(PROJECT_MANAGEMENT_CLASSES.includes(name));
  }
});

test("PM: all classes are instantiable", () => {
  assert.ok(new MultiProjectManager());
  assert.ok(new ProjectTemplate(new MultiProjectManager()));
  assert.ok(new VersionControl(new MultiProjectManager()));
  assert.ok(new DeadlineTracker(new MultiProjectManager()));
  assert.ok(new TaskAssignment());
  assert.ok(new ProgressTracker());
  assert.ok(new ClientPortal());
  assert.ok(new InvoiceGenerator());
  assert.ok(new Workspace());
  assert.ok(new NotificationSystem());
});

// ====================================================================
// 1. MultiProjectManager
// ====================================================================

test("PM MPM: createProject succeeds with valid input", () => {
  const pm = new MultiProjectManager();
  const r = pm.createProject({ name: "My Video", description: "test" });
  assert.equal(r.ok, true);
  assert.ok(r.project);
  assert.equal(r.project.name, "My Video");
  assert.equal(r.project.description, "test");
  assert.equal(r.project.status, "active");
  assert.ok(r.project.id);
  assert.ok(r.project.createdAt);
});

test("PM MPM: createProject fails without name", () => {
  const pm = new MultiProjectManager();
  const r = pm.createProject({});
  assert.equal(r.ok, false);
  assert.equal(r.error, "name_required");
});

test("PM MPM: createProject fails with empty name", () => {
  const pm = new MultiProjectManager();
  const r = pm.createProject({ name: "   " });
  assert.equal(r.ok, false);
  assert.equal(r.error, "name_required");
});

test("PM MPM: getProject retrieves a project", () => {
  const pm = new MultiProjectManager();
  const created = pm.createProject({ name: "Test" }).project;
  const r = pm.getProject(created.id);
  assert.equal(r.ok, true);
  assert.equal(r.project.id, created.id);
});

test("PM MPM: getProject fails for missing id", () => {
  const pm = new MultiProjectManager();
  const r = pm.getProject(null);
  assert.equal(r.ok, false);
  assert.equal(r.error, "id_required");
});

test("PM MPM: getProject fails for non-existent id", () => {
  const pm = new MultiProjectManager();
  const r = pm.getProject("nonexistent");
  assert.equal(r.ok, false);
  assert.equal(r.error, "project_not_found");
});

test("PM MPM: listProjects returns all projects", () => {
  const pm = new MultiProjectManager();
  pm.createProject({ name: "A" });
  pm.createProject({ name: "B" });
  const r = pm.listProjects();
  assert.equal(r.ok, true);
  assert.equal(r.projects.length, 2);
});

test("PM MPM: listProjects filters by status", () => {
  const pm = new MultiProjectManager();
  const a = pm.createProject({ name: "A" }).project;
  pm.createProject({ name: "B" });
  pm.archiveProject(a.id);
  const active = pm.listProjects({ filter: { status: "active" } });
  assert.equal(active.projects.length, 1);
  const archived = pm.listProjects({ filter: { status: "archived" } });
  assert.equal(archived.projects.length, 1);
});

test("PM MPM: listProjects sorts by name", () => {
  const pm = new MultiProjectManager();
  pm.createProject({ name: "Zebra" });
  pm.createProject({ name: "Apple" });
  pm.createProject({ name: "Mango" });
  const r = pm.listProjects({ sort: { field: "name", dir: "asc" } });
  assert.equal(r.projects[0].name, "Apple");
  assert.equal(r.projects[1].name, "Mango");
  assert.equal(r.projects[2].name, "Zebra");
});

test("PM MPM: deleteProject removes it", () => {
  const pm = new MultiProjectManager();
  const p = pm.createProject({ name: "X" }).project;
  const r = pm.deleteProject(p.id);
  assert.equal(r.ok, true);
  assert.equal(r.deleted, true);
  assert.equal(pm.getProject(p.id).ok, false);
});

test("PM MPM: deleteProject fails for missing id", () => {
  const pm = new MultiProjectManager();
  assert.equal(pm.deleteProject(null).ok, false);
});

test("PM MPM: archiveProject sets status to archived", () => {
  const pm = new MultiProjectManager();
  const p = pm.createProject({ name: "Arch" }).project;
  const r = pm.archiveProject(p.id);
  assert.equal(r.ok, true);
  assert.equal(r.project.status, "archived");
});

test("PM MPM: duplicateProject creates a copy", () => {
  const pm = new MultiProjectManager();
  const p = pm.createProject({ name: "Original" }).project;
  const r = pm.duplicateProject(p.id);
  assert.equal(r.ok, true);
  assert.notEqual(r.project.id, p.id);
  assert.equal(r.project.name, "Original (copy)");
  assert.equal(r.project.status, "active");
});

// ====================================================================
// 2. ProjectTemplate
// ====================================================================

test("PM TPL: createTemplate succeeds", () => {
  const pm = new MultiProjectManager();
  const tpl = new ProjectTemplate(pm);
  const r = tpl.createTemplate({ name: "Vlog", tracks: [{ name: "Main" }] });
  assert.equal(r.ok, true);
  assert.ok(r.template.id);
  assert.equal(r.template.name, "Vlog");
  assert.equal(r.template.tracks.length, 1);
});

test("PM TPL: createTemplate fails without name", () => {
  const pm = new MultiProjectManager();
  const tpl = new ProjectTemplate(pm);
  const r = tpl.createTemplate({});
  assert.equal(r.ok, false);
  assert.equal(r.error, "name_required");
});

test("PM TPL: applyTemplate applies tracks and effects", () => {
  const pm = new MultiProjectManager();
  const tpl = new ProjectTemplate(pm);
  const p = pm.createProject({ name: "P1" }).project;
  const t = tpl.createTemplate({ name: "T1", tracks: [{ name: "V1" }], effects: [{ name: "Blur" }] }).template;
  const r = tpl.applyTemplate(p.id, t.id);
  assert.equal(r.ok, true);
  assert.equal(r.project.tracks.length, 1);
  assert.equal(r.project.tracks[0].name, "V1");
  assert.equal(r.project.effects.length, 1);
});

test("PM TPL: applyTemplate fails if template not found", () => {
  const pm = new MultiProjectManager();
  const tpl = new ProjectTemplate(pm);
  const p = pm.createProject({ name: "P1" }).project;
  const r = tpl.applyTemplate(p.id, "nonexistent");
  assert.equal(r.ok, false);
  assert.equal(r.error, "template_not_found");
});

test("PM TPL: listTemplates returns all", () => {
  const pm = new MultiProjectManager();
  const tpl = new ProjectTemplate(pm);
  tpl.createTemplate({ name: "A" });
  tpl.createTemplate({ name: "B" });
  assert.equal(tpl.listTemplates().templates.length, 2);
});

test("PM TPL: deleteTemplate removes it", () => {
  const pm = new MultiProjectManager();
  const tpl = new ProjectTemplate(pm);
  const t = tpl.createTemplate({ name: "X" }).template;
  const r = tpl.deleteTemplate(t.id);
  assert.equal(r.ok, true);
  assert.equal(tpl.listTemplates().templates.length, 0);
});

// ====================================================================
// 3. VersionControl
// ====================================================================

test("PM VC: createVersion creates a snapshot", () => {
  const pm = new MultiProjectManager();
  const vc = new VersionControl(pm);
  const p = pm.createProject({ name: "VP" }).project;
  const r = vc.createVersion(p.id, { name: "v1", description: "first" });
  assert.equal(r.ok, true);
  assert.equal(r.version.name, "v1");
  assert.equal(r.version.description, "first");
  assert.ok(r.version.snapshot);
});

test("PM VC: getVersions returns list", () => {
  const pm = new MultiProjectManager();
  const vc = new VersionControl(pm);
  const p = pm.createProject({ name: "VP" }).project;
  vc.createVersion(p.id);
  vc.createVersion(p.id);
  const r = vc.getVersions(p.id);
  assert.equal(r.versions.length, 2);
});

test("PM VC: revertToVersion restores snapshot", () => {
  const pm = new MultiProjectManager();
  const vc = new VersionControl(pm);
  const p = pm.createProject({ name: "VP" }).project;
  // create version 1
  const v1 = vc.createVersion(p.id, { name: "v1" }).version;
  // modify project
  pm.getProject(p.id).project.name = "Modified";
  // create version 2
  vc.createVersion(p.id, { name: "v2" });
  // revert to v1
  const r = vc.revertToVersion(p.id, v1.id);
  assert.equal(r.ok, true);
  assert.equal(r.project.name, "VP"); // original name from snapshot
});

test("PM VC: compareVersions shows diffs", () => {
  const pm = new MultiProjectManager();
  const vc = new VersionControl(pm);
  const p = pm.createProject({ name: "VP" }).project;
  const v1 = vc.createVersion(p.id, { name: "v1" }).version;
  pm.getProject(p.id).project.name = "New Name";
  const v2 = vc.createVersion(p.id, { name: "v2" }).version;
  const r = vc.compareVersions(p.id, v1.id, v2.id);
  assert.equal(r.ok, true);
  assert.equal(r.diff.identical, false);
  assert.ok(r.diff.changes.length > 0);
});

test("PM VC: autoSave returns an id", () => {
  const pm = new MultiProjectManager();
  const vc = new VersionControl(pm);
  const p = pm.createProject({ name: "VP" }).project;
  const r = vc.autoSave(p.id, 60000);
  assert.equal(r.ok, true);
  assert.ok(r.autoSaveId);
  vc.stopAutoSave(r.autoSaveId);
});

// ====================================================================
// 4. DeadlineTracker
// ====================================================================

test("PM DT: setDeadline creates a deadline", () => {
  const pm = new MultiProjectManager();
  const dt = new DeadlineTracker(pm);
  const p = pm.createProject({ name: "DP" }).project;
  const r = dt.setDeadline(p.id, "2026-12-31");
  assert.equal(r.ok, true);
  assert.equal(r.deadline.date, "2026-12-31");
  assert.equal(r.deadline.completed, false);
});

test("PM DT: getDeadline retrieves it", () => {
  const pm = new MultiProjectManager();
  const dt = new DeadlineTracker(pm);
  const p = pm.createProject({ name: "DP" }).project;
  dt.setDeadline(p.id, "2026-07-01");
  const r = dt.getDeadline(p.id);
  assert.equal(r.ok, true);
  assert.equal(r.deadline.date, "2026-07-01");
});

test("PM DT: markComplete marks done", () => {
  const pm = new MultiProjectManager();
  const dt = new DeadlineTracker(pm);
  const p = pm.createProject({ name: "DP" }).project;
  dt.setDeadline(p.id, "2026-12-31");
  const r = dt.markComplete(p.id);
  assert.equal(r.ok, true);
  assert.equal(r.deadline.completed, true);
});

test("PM DT: getOverdue finds past deadlines", () => {
  const pm = new MultiProjectManager();
  const dt = new DeadlineTracker(pm);
  const p1 = pm.createProject({ name: "Late" }).project;
  const p2 = pm.createProject({ name: "OnTime" }).project;
  dt.setDeadline(p1.id, "2020-01-01"); // past
  dt.setDeadline(p2.id, "2099-12-31"); // far future
  const r = dt.getOverdue();
  assert.equal(r.projects.length, 1);
  assert.equal(r.projects[0].name, "Late");
});

test("PM DT: getUpcoming finds near deadlines", () => {
  const pm = new MultiProjectManager();
  const dt = new DeadlineTracker(pm);
  const p1 = pm.createProject({ name: "Soon" }).project;
  const p2 = pm.createProject({ name: "Far" }).project;
  const nextWeek = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const farFuture = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
  dt.setDeadline(p1.id, nextWeek);
  dt.setDeadline(p2.id, farFuture);
  const r = dt.getUpcoming(7);
  assert.equal(r.projects.length, 1);
  assert.equal(r.projects[0].name, "Soon");
});

// ====================================================================
// 5. TaskAssignment
// ====================================================================

test("PM TA: assignTask creates a task", () => {
  const ta = new TaskAssignment();
  const r = ta.assignTask("proj-1", { title: "Edit video", assignee: "alice" });
  assert.equal(r.ok, true);
  assert.equal(r.task.title, "Edit video");
  assert.equal(r.task.assignee, "alice");
  assert.equal(r.task.status, "pending");
});

test("PM TA: assignTask fails without title", () => {
  const ta = new TaskAssignment();
  const r = ta.assignTask("proj-1", { assignee: "alice" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "title_required");
});

test("PM TA: completeTask marks done", () => {
  const ta = new TaskAssignment();
  const task = ta.assignTask("proj-1", { title: "Edit", assignee: "a" }).task;
  const r = ta.completeTask(task.id);
  assert.equal(r.ok, true);
  assert.equal(r.task.status, "completed");
  assert.ok(r.task.completedAt);
});

test("PM TA: getTasks returns project tasks", () => {
  const ta = new TaskAssignment();
  ta.assignTask("p1", { title: "A", assignee: "a" });
  ta.assignTask("p1", { title: "B", assignee: "b" });
  ta.assignTask("p2", { title: "C", assignee: "a" });
  const r = ta.getTasks("p1");
  assert.equal(r.tasks.length, 2);
});

test("PM TA: getTasksByAssignee returns user tasks", () => {
  const ta = new TaskAssignment();
  ta.assignTask("p1", { title: "A", assignee: "alice" });
  ta.assignTask("p1", { title: "B", assignee: "bob" });
  ta.assignTask("p2", { title: "C", assignee: "alice" });
  const r = ta.getTasksByAssignee("alice");
  assert.equal(r.tasks.length, 2);
});

test("PM TA: updateTask adds comment", () => {
  const ta = new TaskAssignment();
  const task = ta.assignTask("p1", { title: "A", assignee: "a" }).task;
  const r = ta.updateTask(task.id, { status: "in_progress", comment: "Working on it" });
  assert.equal(r.ok, true);
  assert.equal(r.task.status, "in_progress");
  assert.equal(r.task.comments.length, 1);
  assert.equal(r.task.comments[0].text, "Working on it");
});

// ====================================================================
// 6. ProgressTracker
// ====================================================================

test("PM PT: updateProgress sets percent", () => {
  const pt = new ProgressTracker();
  const r = pt.updateProgress("proj-1", { percent: 42 });
  assert.equal(r.ok, true);
  assert.equal(r.progress.percent, 42);
});

test("PM PT: updateProgress with milestone", () => {
  const pt = new ProgressTracker();
  const r = pt.updateProgress("proj-1", { percent: 50, milestone: "Halfway" });
  assert.equal(r.ok, true);
  assert.equal(r.progress.milestones.length, 1);
  assert.equal(r.progress.milestones[0].name, "Halfway");
});

test("PM PT: updateProgress rejects invalid percent", () => {
  const pt = new ProgressTracker();
  assert.equal(pt.updateProgress("proj-1", { percent: -1 }).ok, false);
  assert.equal(pt.updateProgress("proj-1", { percent: 101 }).ok, false);
  assert.equal(pt.updateProgress("proj-1", { percent: "abc" }).ok, false);
});

test("PM PT: getProgress returns state", () => {
  const pt = new ProgressTracker();
  pt.updateProgress("proj-1", { percent: 30 });
  const r = pt.getProgress("proj-1");
  assert.equal(r.ok, true);
  assert.equal(r.progress.percent, 30);
});

test("PM PT: getHistory returns entries", () => {
  const pt = new ProgressTracker();
  pt.updateProgress("proj-1", { percent: 10 });
  pt.updateProgress("proj-1", { percent: 20, milestone: "M1" });
  pt.updateProgress("proj-1", { percent: 30 });
  const r = pt.getHistory("proj-1");
  assert.equal(r.history.length, 3);
  assert.equal(r.history[1].milestone, "M1");
});

test("PM PT: getMilestones returns milestones", () => {
  const pt = new ProgressTracker();
  pt.updateProgress("proj-1", { percent: 25, milestone: "M1" });
  pt.updateProgress("proj-1", { percent: 50, milestone: "M2" });
  const r = pt.getMilestones("proj-1");
  assert.equal(r.milestones.length, 2);
  assert.equal(r.milestones[0].name, "M1");
});

// ====================================================================
// 7. ClientPortal
// ====================================================================

test("PM CP: createClient succeeds", () => {
  const cp = new ClientPortal();
  const r = cp.createClient({ name: "Acme", email: "a@acme.com", company: "Acme Inc" });
  assert.equal(r.ok, true);
  assert.equal(r.client.name, "Acme");
  assert.equal(r.client.email, "a@acme.com");
});

test("PM CP: createClient fails without email", () => {
  const cp = new ClientPortal();
  assert.equal(cp.createClient({ name: "A" }).ok, false);
});

test("PM CP: shareProject generates share link", () => {
  const cp = new ClientPortal();
  const c = cp.createClient({ name: "A", email: "a@b.com" }).client;
  const r = cp.shareProject(c.id, "proj-1", { permissions: ["view", "comment"] });
  assert.equal(r.ok, true);
  assert.ok(r.shareLink.token);
  assert.deepEqual(r.shareLink.permissions, ["view", "comment"]);
});

test("PM CP: addFeedback records entry", () => {
  const cp = new ClientPortal();
  const c = cp.createClient({ name: "A", email: "a@b.com" }).client;
  const r = cp.addFeedback("proj-1", { client_id: c.id, text: "Looks great!", timeCode: "00:01:30" });
  assert.equal(r.ok, true);
  assert.equal(r.feedback.text, "Looks great!");
  assert.equal(r.feedback.timeCode, "00:01:30");
});

test("PM CP: getFeedback retrieves entries", () => {
  const cp = new ClientPortal();
  const c = cp.createClient({ name: "A", email: "a@b.com" }).client;
  cp.addFeedback("proj-1", { client_id: c.id, text: "Good" });
  cp.addFeedback("proj-1", { client_id: c.id, text: "Nice" });
  const r = cp.getFeedback(c.id, "proj-1");
  assert.equal(r.feedback.length, 2);
});

// ====================================================================
// 8. InvoiceGenerator
// ====================================================================

test("PM INV: createInvoice computes totals", () => {
  const inv = new InvoiceGenerator();
  const r = inv.createInvoice({
    client_id: "c1",
    items: [{ description: "Editing", amount: 500 }, { description: "Color", amount: 200 }],
    tax_rate: 0.1,
  });
  assert.equal(r.ok, true);
  assert.equal(r.invoice.subtotal, 700);
  assert.equal(r.invoice.tax, 70);
  assert.equal(r.invoice.total, 770);
  assert.equal(r.invoice.status, "unpaid");
});

test("PM INV: createInvoice fails without items", () => {
  const inv = new InvoiceGenerator();
  assert.equal(inv.createInvoice({ client_id: "c1", items: [] }).ok, false);
});

test("PM INV: markPaid updates status", () => {
  const inv = new InvoiceGenerator();
  const i = inv.createInvoice({ client_id: "c1", items: [{ description: "X", amount: 100 }] }).invoice;
  const r = inv.markPaid(i.id);
  assert.equal(r.ok, true);
  assert.equal(r.invoice.status, "paid");
  assert.ok(r.invoice.paidAt);
});

test("PM INV: getInvoices returns client invoices", () => {
  const inv = new InvoiceGenerator();
  inv.createInvoice({ client_id: "c1", items: [{ description: "A", amount: 10 }] });
  inv.createInvoice({ client_id: "c2", items: [{ description: "B", amount: 20 }] });
  inv.createInvoice({ client_id: "c1", items: [{ description: "C", amount: 30 }] });
  const r = inv.getInvoices("c1");
  assert.equal(r.invoices.length, 2);
});

test("PM INV: getTotalRevenue computes correctly", () => {
  const inv = new InvoiceGenerator();
  const i1 = inv.createInvoice({ client_id: "c1", items: [{ description: "A", amount: 100 }] }).invoice;
  const i2 = inv.createInvoice({ client_id: "c2", items: [{ description: "B", amount: 200 }] }).invoice;
  inv.markPaid(i1.id);
  const r = inv.getTotalRevenue();
  assert.equal(r.report.totalRevenue, 100);
  assert.equal(r.report.pendingRevenue, 200);
  assert.equal(r.report.invoiceCount, 2);
  assert.equal(r.report.paidCount, 1);
  assert.equal(r.report.unpaidCount, 1);
});

// ====================================================================
// 9. Workspace
// ====================================================================

test("PM WS: createWorkspace succeeds", () => {
  const ws = new Workspace();
  const r = ws.createWorkspace({ name: "Design Team", team: ["alice", "bob"] });
  assert.equal(r.ok, true);
  assert.equal(r.workspace.name, "Design Team");
  assert.equal(r.workspace.members.length, 2);
});

test("PM WS: createWorkspace fails without name", () => {
  const ws = new Workspace();
  assert.equal(ws.createWorkspace({}).ok, false);
});

test("PM WS: addMember adds user", () => {
  const ws = new Workspace();
  const w = ws.createWorkspace({ name: "T" }).workspace;
  const r = ws.addMember(w.id, "carol", "editor");
  assert.equal(r.ok, true);
  assert.equal(r.member.userId, "carol");
  assert.equal(r.member.role, "editor");
});

test("PM WS: addMember fails if already member", () => {
  const ws = new Workspace();
  const w = ws.createWorkspace({ name: "T", team: ["alice"] }).workspace;
  const r = ws.addMember(w.id, "alice");
  assert.equal(r.ok, false);
  assert.equal(r.error, "already_member");
});

test("PM WS: removeMember removes user", () => {
  const ws = new Workspace();
  const w = ws.createWorkspace({ name: "T", team: ["alice", "bob"] }).workspace;
  const r = ws.removeMember(w.id, "alice");
  assert.equal(r.ok, true);
  assert.equal(r.removed, true);
  const m = ws.getMembers(w.id);
  assert.equal(m.members.length, 1);
  assert.equal(m.members[0].userId, "bob");
});

test("PM WS: setPermissions stores permissions", () => {
  const ws = new Workspace();
  const r = ws.setPermissions("user-1", ["edit", "delete"]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.permissions, ["edit", "delete"]);
});

// ====================================================================
// 10. NotificationSystem
// ====================================================================

test("PM NS: sendNotification creates notification", () => {
  const ns = new NotificationSystem();
  const r = ns.sendNotification("u1", { type: "deadline", message: "Due soon", projectId: "p1" });
  assert.equal(r.ok, true);
  assert.equal(r.notification.type, "deadline");
  assert.equal(r.notification.read, false);
});

test("PM NS: sendNotification fails without message", () => {
  const ns = new NotificationSystem();
  assert.equal(ns.sendNotification("u1", { type: "x" }).ok, false);
});

test("PM NS: getNotifications returns all", () => {
  const ns = new NotificationSystem();
  ns.sendNotification("u1", { type: "a", message: "M1" });
  ns.sendNotification("u1", { type: "b", message: "M2" });
  const r = ns.getNotifications("u1");
  assert.equal(r.notifications.length, 2);
});

test("PM NS: markRead marks as read", () => {
  const ns = new NotificationSystem();
  const n = ns.sendNotification("u1", { type: "a", message: "M" }).notification;
  const r = ns.markRead(n.id);
  assert.equal(r.ok, true);
  assert.equal(r.notification.read, true);
});

test("PM NS: getUnread returns only unread", () => {
  const ns = new NotificationSystem();
  const n1 = ns.sendNotification("u1", { type: "a", message: "M1" }).notification;
  ns.sendNotification("u1", { type: "b", message: "M2" });
  ns.markRead(n1.id);
  const r = ns.getUnread("u1");
  assert.equal(r.notifications.length, 1);
  assert.equal(r.notifications[0].message, "M2");
});

test("PM NS: subscribe triggers callback on matching event", () => {
  const ns = new NotificationSystem();
  let received = null;
  ns.subscribe("u1", "deadline", (n) => { received = n; });
  ns.sendNotification("u1", { type: "deadline", message: "Hey" });
  assert.ok(received);
  assert.equal(received.message, "Hey");
});

test("PM NS: subscribe does not trigger for other events", () => {
  const ns = new NotificationSystem();
  let received = null;
  ns.subscribe("u1", "deadline", (n) => { received = n; });
  ns.sendNotification("u1", { type: "upload", message: "File ready" });
  assert.equal(received, null);
});

// ====================================================================
// Cross-class integration tests
// ====================================================================

test("PM Integration: full project lifecycle", () => {
  const pm = new MultiProjectManager();
  const tpl = new ProjectTemplate(pm);
  const vc = new VersionControl(pm);
  const dt = new DeadlineTracker(pm);
  const pt = new ProgressTracker();

  // Create project from template
  const p = pm.createProject({ name: "Commercial", description: "Brand spot" }).project;
  const t = tpl.createTemplate({ name: "Ad", tracks: [{ name: "Main" }] }).template;
  tpl.applyTemplate(p.id, t.id);
  assert.equal(pm.getProject(p.id).project.tracks.length, 1);

  // Version it
  vc.createVersion(p.id, { name: "initial" });
  assert.equal(vc.getVersions(p.id).versions.length, 1);

  // Set deadline
  dt.setDeadline(p.id, "2026-09-01");
  assert.equal(dt.getDeadline(p.id).ok, true);

  // Track progress
  pt.updateProgress(p.id, { percent: 25, milestone: "Rough Cut" });
  pt.updateProgress(p.id, { percent: 100, milestone: "Final" });
  assert.equal(pt.getMilestones(p.id).milestones.length, 2);

  // Archive
  pm.archiveProject(p.id);
  assert.equal(pm.getProject(p.id).project.status, "archived");
});

test("PM Integration: client workflow", () => {
  const cp = new ClientPortal();
  const inv = new InvoiceGenerator();

  // Client onboarding
  const client = cp.createClient({ name: "Acme", email: "acme@corp.com" }).client;
  cp.shareProject(client.id, "proj-1", { permissions: ["view", "comment"] });
  cp.addFeedback("proj-1", { client_id: client.id, text: "Love the intro!", timeCode: "00:00:05" });
  assert.equal(cp.getFeedback(client.id, "proj-1").feedback.length, 1);

  // Invoice
  const invoice = inv.createInvoice({
    client_id: client.id,
    items: [
      { description: "Video Production", amount: 2000 },
      { description: "Color Grading", amount: 500 },
    ],
    tax_rate: 0.08,
  }).invoice;
  assert.equal(invoice.total, 2700);
  inv.markPaid(invoice.id);
  assert.equal(inv.getTotalRevenue().report.totalRevenue, 2700);
});

test("PM Integration: team workspace with tasks", () => {
  const ws = new Workspace();
  const ta = new TaskAssignment();
  const ns = new NotificationSystem();

  const w = ws.createWorkspace({ name: "Studio", team: ["alice", "bob"] }).workspace;
  ws.addMember(w.id, "carol", "reviewer");

  // Assign tasks
  ta.assignTask("proj-1", { title: "Edit", assignee: "alice" });
  ta.assignTask("proj-1", { title: "Color", assignee: "bob" });
  ta.assignTask("proj-1", { title: "Review", assignee: "carol" });

  // Notify
  ns.sendNotification("alice", { type: "task", message: "Edit assigned", projectId: "proj-1" });
  ns.sendNotification("bob", { type: "task", message: "Color assigned", projectId: "proj-1" });

  assert.equal(ta.getTasks("proj-1").tasks.length, 3);
  assert.equal(ws.getMembers(w.id).members.length, 3);
  assert.equal(ns.getUnread("alice").notifications.length, 1);
  assert.equal(ns.getUnread("bob").notifications.length, 1);
});
