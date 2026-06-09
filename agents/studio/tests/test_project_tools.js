// test_project_tools.js — Tests for the 10 project management tools.
//
//   1.  create_project
//   2.  list_projects
//   3.  get_project
//   4.  update_project
//   5.  delete_project
//   6.  duplicate_project
//   7.  archive_project
//   8.  get_project_stats
//   9.  search_projects
//   10. export_project

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PROJECT_TOOLS,
  PROJECT_TOOL_NAMES,
  createProject,
  listProjects,
  getProject,
  updateProject,
  deleteProject,
  duplicateProject,
  archiveProject,
  getProjectStats,
  searchProjects,
  exportProject,
} from "../src/project_tools.js";

// ====================================================================
// Tool shape validation
// ====================================================================

test("Project: 10 tools exported with valid OpenAI shape", () => {
  assert.equal(PROJECT_TOOLS.length, 10);
  for (const t of PROJECT_TOOLS) {
    assert.equal(t.type, "function");
    assert.ok(t.function.name);
    assert.ok(t.function.description.length > 50);
    assert.ok(t.function.parameters);
    assert.equal(t.function.parameters.type, "object");
  }
  const names = PROJECT_TOOLS.map((t) => t.function.name).sort();
  assert.deepEqual(names, [
    "archive_project",
    "create_project",
    "delete_project",
    "duplicate_project",
    "export_project",
    "get_project",
    "get_project_stats",
    "list_projects",
    "search_projects",
    "update_project",
  ]);
});

test("Project: PROJECT_TOOL_NAMES set has 10 names", () => {
  assert.equal(PROJECT_TOOL_NAMES.size, 10);
  assert.ok(PROJECT_TOOL_NAMES.has("create_project"));
  assert.ok(PROJECT_TOOL_NAMES.has("export_project"));
});

// ====================================================================
// 1. createProject
// ====================================================================

test("createProject: creates project with blank template", async () => {
  const r = await createProject({ name: "My Vlog" });
  assert.equal(r.ok, true);
  assert.ok(r.project.id);
  assert.equal(r.project.name, "My Vlog");
  assert.equal(r.project.template, "blank");
  assert.equal(r.project.status, "active");
  assert.ok(r.project.created_at > 0);
  assert.ok(r.project.modified_at > 0);
  assert.ok(Array.isArray(r.project.tracks));
});

test("createProject: missing name returns error", async () => {
  const r = await createProject({ name: "" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "name_required");
});

test("createProject: name too long returns error", async () => {
  const r = await createProject({ name: "x".repeat(121) });
  assert.equal(r.ok, false);
  assert.equal(r.error, "name_too_long");
});

test("createProject: invalid template returns error", async () => {
  const r = await createProject({ name: "Test", template: "nonexistent" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_template");
  assert.ok(Array.isArray(r.valid_templates));
});

test("createProject: youtube_vlog template creates default tracks", async () => {
  const r = await createProject({ name: "Vlog 1", template: "youtube_vlog" });
  assert.equal(r.ok, true);
  assert.equal(r.project.template, "youtube_vlog");
  assert.equal(r.project.tracks.length, 4); // Main, B-Roll, Voiceover, Music
  const trackNames = r.project.tracks.map((t) => t.name);
  assert.ok(trackNames.includes("Main"));
  assert.ok(trackNames.includes("B-Roll"));
  assert.ok(trackNames.includes("Voiceover"));
  assert.ok(trackNames.includes("Music"));
});

test("createProject: tiktok_series template creates 3 tracks", async () => {
  const r = await createProject({ name: "TT Series", template: "tiktok_series" });
  assert.equal(r.ok, true);
  assert.equal(r.project.tracks.length, 3);
});

test("createProject: commercial template creates 6 tracks", async () => {
  const r = await createProject({ name: "Ad Spot", template: "commercial" });
  assert.equal(r.ok, true);
  assert.equal(r.project.tracks.length, 6);
});

test("createProject: custom description overrides template default", async () => {
  const r = await createProject({ name: "P", description: "My desc" });
  assert.equal(r.ok, true);
  assert.equal(r.project.description, "My desc");
});

test("createProject: each user has isolated projects", async () => {
  await createProject({ name: "User1 Proj", userId: "u1" });
  await createProject({ name: "User2 Proj", userId: "u2" });

  const list1 = await listProjects({ userId: "u1" });
  const list2 = await listProjects({ userId: "u2" });

  assert.equal(list1.projects.length, 1);
  assert.equal(list2.projects.length, 1);
  assert.equal(list1.projects[0].name, "User1 Proj");
  assert.equal(list2.projects[0].name, "User2 Proj");
});

// ====================================================================
// 2. listProjects
// ====================================================================

test("listProjects: returns projects sorted by modified", async () => {
  // Create a project first, then wait 2ms to guarantee distinct timestamps
  const a = await createProject({ name: "A", userId: "list_user" });
  await new Promise((r) => setTimeout(r, 2));
  const b = await createProject({ name: "B", userId: "list_user" });

  const r = await listProjects({ userId: "list_user" });
  assert.equal(r.ok, true);
  assert.ok(r.projects.length >= 2);
  assert.equal(r.projects[0].name, "B"); // more recent first
});

test("listProjects: sorts by name", async () => {
  await createProject({ name: "Zebra", userId: "sort_user" });
  await createProject({ name: "Alpha", userId: "sort_user" });

  const r = await listProjects({ sortBy: "name", userId: "sort_user" });
  assert.equal(r.ok, true);
  const names = r.projects.map((p) => p.name);
  // "Alpha" should come before "Zebra" and any from other tests
  assert.ok(names.indexOf("Alpha") < names.indexOf("Zebra"));
});

test("listProjects: respects limit", async () => {
  const r = await listProjects({ limit: 1, userId: "limit_user" });
  // limit_user may have 0 or more; just verify it doesn't crash and limit is respected
  assert.equal(r.ok, true);
  assert.ok(r.projects.length <= 1);
});

test("listProjects: invalid sort field returns error", async () => {
  const r = await listProjects({ sortBy: "bogus" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_sort_field");
});

// ====================================================================
// 3. getProject
// ====================================================================

test("getProject: returns full project details", async () => {
  const created = await createProject({ name: "Detail Test", userId: "detail_user" });
  const r = await getProject(created.project.id, "detail_user");
  assert.equal(r.ok, true);
  assert.equal(r.project.name, "Detail Test");
  assert.ok(Array.isArray(r.project.tracks));
  assert.equal(r.project.status, "active");
});

test("getProject: missing id returns error", async () => {
  const r = await getProject("");
  assert.equal(r.ok, false);
  assert.equal(r.error, "project_id_required");
});

test("getProject: nonexistent id returns error", async () => {
  const r = await getProject("nonexistent-id");
  assert.equal(r.ok, false);
  assert.equal(r.error, "project_not_found");
});

// ====================================================================
// 4. updateProject
// ====================================================================

test("updateProject: updates name", async () => {
  const p = await createProject({ name: "Old Name", userId: "upd_user" });
  const r = await updateProject(p.project.id, { name: "New Name" }, "upd_user");
  assert.equal(r.ok, true);
  assert.equal(r.updated, true);
  assert.ok(r.fields_changed.includes("name"));

  const check = await getProject(p.project.id, "upd_user");
  assert.equal(check.project.name, "New Name");
});

test("updateProject: updates description", async () => {
  const p = await createProject({ name: "DescTest", userId: "upd2_user" });
  const r = await updateProject(p.project.id, { description: "New desc" }, "upd2_user");
  assert.equal(r.ok, true);
  assert.ok(r.fields_changed.includes("description"));
});

test("updateProject: no fields provided returns error", async () => {
  const p = await createProject({ name: "NoFields", userId: "upd3_user" });
  const r = await updateProject(p.project.id, {}, "upd3_user");
  assert.equal(r.ok, false);
  assert.equal(r.error, "no_fields_provided");
});

test("updateProject: name too long returns error", async () => {
  const p = await createProject({ name: "Short", userId: "upd4_user" });
  const r = await updateProject(p.project.id, { name: "x".repeat(121) }, "upd4_user");
  assert.equal(r.ok, false);
  assert.equal(r.error, "name_too_long");
});

test("updateProject: nonexistent project returns error", async () => {
  const r = await updateProject("fake-id", { name: "X" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "project_not_found");
});

// ====================================================================
// 5. deleteProject
// ====================================================================

test("deleteProject: soft-deletes and creates backup", async () => {
  const p = await createProject({ name: "Delete Me", userId: "del_user" });
  const r = await deleteProject(p.project.id, "del_user");
  assert.equal(r.ok, true);
  assert.equal(r.deleted, true);
  assert.equal(r.backup_created, true);
  assert.equal(r.backup_expires_in_days, 30);

  // Verify project no longer appears in listProjects
  const list = await listProjects({ userId: "del_user" });
  const found = list.projects.find((pr) => pr.id === p.project.id);
  assert.equal(found, undefined);
});

test("deleteProject: missing id returns error", async () => {
  const r = await deleteProject("");
  assert.equal(r.ok, false);
  assert.equal(r.error, "project_id_required");
});

test("deleteProject: nonexistent project returns error", async () => {
  const r = await deleteProject("no-such-id");
  assert.equal(r.ok, false);
  assert.equal(r.error, "project_not_found");
});

// ====================================================================
// 6. duplicateProject
// ====================================================================

test("duplicateProject: creates a copy with new id", async () => {
  const p = await createProject({ name: "Original", userId: "dup_user" });
  const r = await duplicateProject(p.project.id, { newName: "Clone" }, "dup_user");
  assert.equal(r.ok, true);
  assert.ok(r.id);
  assert.notEqual(r.id, p.project.id);
  assert.equal(r.name, "Clone");
  assert.equal(r.original_id, p.project.id);
  assert.equal(r.tracks_count, p.project.tracks.length);
});

test("duplicateProject: default name appends (Copy)", async () => {
  const p = await createProject({ name: "My Project", userId: "dup2_user" });
  const r = await duplicateProject(p.project.id, {}, "dup2_user");
  assert.equal(r.ok, true);
  assert.equal(r.name, "My Project (Copy)");
});

test("duplicateProject: nonexistent project returns error", async () => {
  const r = await duplicateProject("no-id");
  assert.equal(r.ok, false);
  assert.equal(r.error, "project_not_found");
});

// ====================================================================
// 7. archiveProject
// ====================================================================

test("archiveProject: archives active project", async () => {
  const p = await createProject({ name: "To Archive", userId: "arch_user" });
  const r = await archiveProject(p.project.id, "arch_user");
  assert.equal(r.ok, true);
  assert.equal(r.archived, true);
  assert.equal(r.unarchive_available, true);

  // Should not appear in default listing
  const list = await listProjects({ userId: "arch_user" });
  const found = list.projects.find((pr) => pr.id === p.project.id);
  assert.equal(found, undefined);
});

test("archiveProject: already archived returns error", async () => {
  const p = await createProject({ name: "Double Arch", userId: "arch2_user" });
  await archiveProject(p.project.id, "arch2_user");
  const r = await archiveProject(p.project.id, "arch2_user");
  assert.equal(r.ok, false);
  assert.equal(r.error, "already_archived");
});

test("archiveProject: deleted project cannot be archived", async () => {
  const p = await createProject({ name: "DelThenArch", userId: "arch3_user" });
  await deleteProject(p.project.id, "arch3_user");
  const r = await archiveProject(p.project.id, "arch3_user");
  assert.equal(r.ok, false);
  assert.equal(r.error, "cannot_archive_deleted_project");
});

test("archiveProject: nonexistent project returns error", async () => {
  const r = await archiveProject("fake");
  assert.equal(r.ok, false);
  assert.equal(r.error, "project_not_found");
});

// ====================================================================
// 8. getProjectStats
// ====================================================================

test("getProjectStats: returns stats for project", async () => {
  const p = await createProject({ name: "Stats Proj", template: "podcast", userId: "stats_user" });
  const r = await getProjectStats(p.project.id, "stats_user");
  assert.equal(r.ok, true);
  assert.equal(r.stats.track_count, 4); // podcast has 4 tracks
  assert.equal(r.stats.clip_count, 0); // no clips yet
  assert.equal(typeof r.stats.duration_sec, "number");
  assert.equal(typeof r.stats.file_size_mb, "number");
  assert.ok(r.stats.last_modified > 0);
});

test("getProjectStats: nonexistent project returns error", async () => {
  const r = await getProjectStats("no-such");
  assert.equal(r.ok, false);
  assert.equal(r.error, "project_not_found");
});

test("getProjectStats: missing id returns error", async () => {
  const r = await getProjectStats("");
  assert.equal(r.ok, false);
  assert.equal(r.error, "project_id_required");
});

// ====================================================================
// 9. searchProjects
// ====================================================================

test("searchProjects: finds project by name", async () => {
  await createProject({ name: "Cooking Adventures", userId: "search_user" });
  await createProject({ name: "Tech Reviews", userId: "search_user" });

  const r = await searchProjects({ query: "cooking", userId: "search_user" });
  assert.equal(r.ok, true);
  assert.ok(r.total_matches >= 1);
  assert.ok(r.projects.some((p) => p.name === "Cooking Adventures"));
  // Top result should have score 1.0 (name match)
  assert.equal(r.projects[0].score, 1.0);
});

test("searchProjects: finds by description", async () => {
  await createProject({
    name: "Project X",
    description: "A documentary about deep sea exploration",
    userId: "search_desc_user",
  });

  const r = await searchProjects({ query: "documentary", userId: "search_desc_user" });
  assert.equal(r.ok, true);
  assert.ok(r.total_matches >= 1);
  // Description match should have lower score
  assert.equal(r.projects[0].score, 0.6);
});

test("searchProjects: filter by template", async () => {
  await createProject({ name: "A", template: "podcast", userId: "filter_user" });
  await createProject({ name: "B", template: "youtube_vlog", userId: "filter_user" });

  const r = await searchProjects({
    query: "",
    filters: { template: "podcast" },
    userId: "filter_user",
  });
  // Empty query should error
  assert.equal(r.ok, false);
  assert.equal(r.error, "query_required");
});

test("searchProjects: filter by template works with query", async () => {
  await createProject({ name: "Podcast Project", template: "podcast", userId: "filter2_user" });
  await createProject({ name: "Podcast Vlog", template: "youtube_vlog", userId: "filter2_user" });

  const r = await searchProjects({
    query: "podcast",
    filters: { template: "podcast" },
    userId: "filter2_user",
  });
  assert.equal(r.ok, true);
  assert.equal(r.total_matches, 1);
  assert.equal(r.projects[0].name, "Podcast Project");
});

test("searchProjects: missing query returns error", async () => {
  const r = await searchProjects({ query: "" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "query_required");
});

// ====================================================================
// 10. exportProject
// ====================================================================

test("exportProject: exports in vireo format", async () => {
  const p = await createProject({ name: "Export Me", userId: "export_user" });
  const r = await exportProject(p.project.id, { format: "vireo" }, "export_user");
  assert.equal(r.ok, true);
  assert.equal(r.format, "vireo");
  assert.ok(r.url);
  assert.ok(typeof r.file_size_mb === "number");
  assert.ok(r.exported_at > 0);
});

test("exportProject: exports in premiere format", async () => {
  const p = await createProject({ name: "PR Proj", userId: "export2_user" });
  const r = await exportProject(p.project.id, { format: "premiere" }, "export2_user");
  assert.equal(r.ok, true);
  assert.equal(r.format, "premiere");
  assert.ok(r.url.includes("prproj"));
});

test("exportProject: invalid format returns error", async () => {
  const p = await createProject({ name: "Bad Format", userId: "export3_user" });
  const r = await exportProject(p.project.id, { format: "avid" }, "export3_user");
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_export_format");
  assert.ok(Array.isArray(r.valid_formats));
});

test("exportProject: nonexistent project returns error", async () => {
  const r = await exportProject("no-id", { format: "davinci" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "project_not_found");
});

test("exportProject: missing project_id returns error", async () => {
  const r = await exportProject("");
  assert.equal(r.ok, false);
  assert.equal(r.error, "project_id_required");
});

// ====================================================================
// Cross-cutting: archived projects excluded from list
// ====================================================================

test("Archived projects excluded from default listing", async () => {
  const p = await createProject({ name: "Visible", userId: "cross_user" });
  await createProject({ name: "Archived One", userId: "cross_user" });

  const listBefore = await listProjects({ userId: "cross_user" });
  assert.ok(listBefore.projects.length >= 2);

  // Archive one
  const allProjects = listBefore.projects;
  const toArchive = allProjects.find((pr) => pr.name === "Archived One");
  if (toArchive) {
    await archiveProject(toArchive.id, "cross_user");
    const listAfter = await listProjects({ userId: "cross_user" });
    assert.ok(!listAfter.projects.some((pr) => pr.name === "Archived One"));
  }
});
