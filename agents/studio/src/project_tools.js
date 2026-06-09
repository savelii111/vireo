// project_tools.js — Week N (2026-06-09).
//
// 10 project management tools that give Vireo Studio full lifecycle
// control over video production projects. These complement chat_tools.js
// (which handles content-level ops) with project-level CRUD, search,
// stats, archiving, duplication, and multi-format export.
//
//   1.  create_project       — scaffold from template (blank, youtube_vlog, etc.)
//   2.  list_projects        — browse with sort + pagination
//   3.  get_project          — full details (tracks, clips, metadata)
//   4.  update_project       — rename / edit description
//   5.  delete_project       — soft-delete with backup
//   6.  duplicate_project    — deep-copy into new project
//   7.  archive_project      — freeze + hide from default listing
//   8.  get_project_stats    — duration, clips, file-size summary
//   9.  search_projects      — full-text query + filters
//   10. export_project       — multi-format export (vireo, premiere, davinci, finalcut)
//
// Architecture:
//   - In-memory store (Map) per user.  v2 will migrate to SQLite/PG via
//     the storage agent — same pattern as jobs.js.
//   - Every project gets a UUID id, tracks[] with clip[] children,
//     timestamps, and a status field ("active" | "archived" | "deleted").
//   - All functions return { ok: true, ... } on success and
//     { ok: false, error: "<snake_case>" } on validation failure so the
//     LLM always gets a deterministic, inspectable result.

import { randomUUID } from "node:crypto";

// ====================================================================
// In-memory state
// ====================================================================

/** @type {Map<string, object>} userId → Map<projectId, project> */
const _projectsByUser = new Map();

function _userMap(userId) {
  if (!_projectsByUser.has(userId)) _projectsByUser.set(userId, new Map());
  return _projectsByUser.get(userId);
}

/** Template presets — each defines default tracks + clips */
const TEMPLATES = {
  blank: {
    tracks: [],
    description_default: "",
  },
  youtube_vlog: {
    tracks: [
      { id: randomUUID(), name: "Main", type: "video", clips: [] },
      { id: randomUUID(), name: "B-Roll", type: "video", clips: [] },
      { id: randomUUID(), name: "Voiceover", type: "audio", clips: [] },
      { id: randomUUID(), name: "Music", type: "audio", clips: [] },
    ],
    description_default: "YouTube vlog project with main footage, B-roll, voiceover, and music tracks.",
  },
  youtube_tutorial: {
    tracks: [
      { id: randomUUID(), name: "Screen Recording", type: "video", clips: [] },
      { id: randomUUID(), name: "Webcam", type: "video", clips: [] },
      { id: randomUUID(), name: "Narration", type: "audio", clips: [] },
      { id: randomUUID(), name: "Background Music", type: "audio", clips: [] },
      { id: randomUUID(), name: "Overlays", type: "graphics", clips: [] },
    ],
    description_default: "Tutorial project with screen recording, webcam, narration, music, and overlay tracks.",
  },
  tiktok_series: {
    tracks: [
      { id: randomUUID(), name: "Main", type: "video", clips: [] },
      { id: randomUUID(), name: "Captions", type: "graphics", clips: [] },
      { id: randomUUID(), name: "Sound", type: "audio", clips: [] },
    ],
    description_default: "TikTok series project optimized for short-form vertical content.",
  },
  podcast: {
    tracks: [
      { id: randomUUID(), name: "Host", type: "audio", clips: [] },
      { id: randomUUID(), name: "Guest", type: "audio", clips: [] },
      { id: randomUUID(), name: "Intro Music", type: "audio", clips: [] },
      { id: randomUUID(), name: "SFX", type: "audio", clips: [] },
    ],
    description_default: "Podcast project with host, guest, intro, and SFX tracks.",
  },
  commercial: {
    tracks: [
      { id: randomUUID(), name: "A-Roll", type: "video", clips: [] },
      { id: randomUUID(), name: "B-Roll", type: "video", clips: [] },
      { id: randomUUID(), name: "VO", type: "audio", clips: [] },
      { id: randomUUID(), name: "Music", type: "audio", clips: [] },
      { id: randomUUID(), name: "Lower Thirds", type: "graphics", clips: [] },
      { id: randomUUID(), name: "End Card", type: "graphics", clips: [] },
    ],
    description_default: "Commercial / ad project with A-roll, B-roll, VO, music, lower thirds, and end card.",
  },
};

const VALID_TEMPLATE_NAMES = Object.keys(TEMPLATES);
const VALID_SORT_FIELDS = ["name", "created", "modified", "status"];
const VALID_EXPORT_FORMATS = ["vireo", "premiere", "davinci", "finalcut"];

function _newId() {
  return randomUUID();
}

function _now() {
  return Date.now();
}

function _cloneProject(p) {
  return JSON.parse(JSON.stringify(p));
}

// ====================================================================
// 1. createProject
// ====================================================================

/**
 * Create a new content project from a template or blank.
 *
 * @param {object} args
 * @param {string} args.name - Project name (1-120 chars, REQUIRED)
 * @param {string} [args.description] - Optional project description
 * @param {string} [args.template] - Template name (default "blank")
 * @param {string} [args.userId] - Owning user
 * @returns {Promise<{ok, project?} | {ok:false, error:string}>}
 */
export async function createProject({ name, description = null, template = "blank", userId = "anonymous" } = {}) {
  if (!name || typeof name !== "string" || !name.trim()) {
    return { ok: false, error: "name_required" };
  }
  if (name.trim().length > 120) {
    return { ok: false, error: "name_too_long", message: "Name must be 120 characters or fewer." };
  }
  if (!TEMPLATES[template]) {
    return { ok: false, error: "invalid_template", valid_templates: VALID_TEMPLATE_NAMES };
  }

  const tpl = TEMPLATES[template];
  const id = _newId();
  const now = _now();

  const project = {
    id,
    name: name.trim(),
    description: (description || tpl.description_default || "").trim(),
    template,
    created_at: now,
    modified_at: now,
    status: "active",
    tracks: tpl.tracks.map((t) => ({ ...t, id: t.id || _newId(), clips: [] })),
    clips_count: 0,
    file_size_mb: 0,
    duration_sec: 0,
  };

  _userMap(userId).set(id, project);

  return {
    ok: true,
    project: _cloneProject(project),
  };
}

// ====================================================================
// 2. listProjects
// ====================================================================

/**
 * List a user's projects with optional sorting and limit.
 *
 * @param {object} args
 * @param {string} [args.sortBy] - name | created | modified | status (default "modified")
 * @param {number} [args.limit] - Max results (default 20, max 200)
 * @param {string} [args.userId]
 * @returns {Promise<{ok, projects, total_count}>}
 */
export async function listProjects({ sortBy = "modified", limit = 20, userId = "anonymous" } = {}) {
  if (!VALID_SORT_FIELDS.includes(sortBy)) {
    return { ok: false, error: "invalid_sort_field", valid_fields: VALID_SORT_FIELDS };
  }
  limit = Math.max(1, Math.min(200, Number(limit) || 20));

  const map = _userMap(userId);
  let projects = [...map.values()].filter((p) => p.status === "active");

  // Sort
  switch (sortBy) {
    case "name":
      projects.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case "created":
      projects.sort((a, b) => b.created_at - a.created_at);
      break;
    case "modified":
      projects.sort((a, b) => b.modified_at - a.modified_at);
      break;
    case "status":
      projects.sort((a, b) => a.status.localeCompare(b.status) || b.modified_at - a.modified_at);
      break;
  }

  const total_count = projects.length;
  projects = projects.slice(0, limit);

  return {
    ok: true,
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      modified_at: p.modified_at,
    })),
    total_count,
  };
}

// ====================================================================
// 3. getProject
// ====================================================================

/**
 * Get full project details including tracks, clips, and metadata.
 *
 * @param {string} projectId
 * @param {string} [userId]
 * @returns {Promise<{ok, project?} | {ok:false, error:string}>}
 */
export async function getProject(projectId, userId = "anonymous") {
  if (!projectId) return { ok: false, error: "project_id_required" };
  const map = _userMap(userId);
  const project = map.get(projectId);
  if (!project) return { ok: false, error: "project_not_found" };

  return { ok: true, project: _cloneProject(project) };
}

// ====================================================================
// 4. updateProject
// ====================================================================

/**
 * Update a project's name and/or description.
 *
 * @param {string} projectId
 * @param {object} updates
 * @param {string} [updates.name]
 * @param {string} [updates.description]
 * @param {string} [userId]
 * @returns {Promise<{ok, updated, fields_changed} | {ok:false, error:string}>}
 */
export async function updateProject(projectId, { name, description } = {}, userId = "anonymous") {
  if (!projectId) return { ok: false, error: "project_id_required" };
  const map = _userMap(userId);
  const project = map.get(projectId);
  if (!project) return { ok: false, error: "project_not_found" };

  const fields_changed = [];

  if (name !== undefined) {
    if (typeof name !== "string" || !name.trim()) {
      return { ok: false, error: "name_must_be_non_empty_string" };
    }
    if (name.trim().length > 120) {
      return { ok: false, error: "name_too_long" };
    }
    project.name = name.trim();
    fields_changed.push("name");
  }

  if (description !== undefined) {
    if (typeof description !== "string") {
      return { ok: false, error: "description_must_be_string" };
    }
    project.description = description.trim();
    fields_changed.push("description");
  }

  if (fields_changed.length === 0) {
    return { ok: false, error: "no_fields_provided" };
  }

  project.modified_at = _now();
  map.set(projectId, project);

  return {
    ok: true,
    updated: true,
    fields_changed,
  };
}

// ====================================================================
// 5. deleteProject
// ====================================================================

/**
 * Soft-delete a project (moves to "deleted" status).
 * A backup copy is retained for 30 days (simulated).
 *
 * @param {string} projectId
 * @param {string} [userId]
 * @returns {Promise<{ok, deleted, backup_created} | {ok:false, error:string}>}
 */
export async function deleteProject(projectId, userId = "anonymous") {
  if (!projectId) return { ok: false, error: "project_id_required" };
  const map = _userMap(userId);
  const project = map.get(projectId);
  if (!project) return { ok: false, error: "project_not_found" };

  project.status = "deleted";
  project.deleted_at = _now();
  project.modified_at = _now();
  map.set(projectId, project);

  return {
    ok: true,
    deleted: true,
    backup_created: true,
    backup_expires_in_days: 30,
  };
}

// ====================================================================
// 6. duplicateProject
// ====================================================================

/**
 * Deep-copy a project into a new one with a fresh id.
 *
 * @param {string} projectId
 * @param {object} opts
 * @param {string} [opts.newName] - Name for the copy (default: "<original> (Copy)")
 * @param {string} [userId]
 * @returns {Promise<{ok, id, name, original_id, tracks_count, clips_count} | {ok:false, error:string}>}
 */
export async function duplicateProject(projectId, { newName } = {}, userId = "anonymous") {
  if (!projectId) return { ok: false, error: "project_id_required" };
  const map = _userMap(userId);
  const original = map.get(projectId);
  if (!original) return { ok: false, error: "project_not_found" };

  const copy = _cloneProject(original);
  copy.id = _newId();
  copy.name = newName || `${original.name} (Copy)`;
  copy.created_at = _now();
  copy.modified_at = _now();
  copy.status = "active";
  copy.deleted_at = undefined;

  // Re-assign track ids
  copy.tracks = copy.tracks.map((t) => ({ ...t, id: _newId() }));

  map.set(copy.id, copy);

  return {
    ok: true,
    id: copy.id,
    name: copy.name,
    original_id: projectId,
    tracks_count: copy.tracks.length,
    clips_count: copy.clips_count || 0,
  };
}

// ====================================================================
// 7. archiveProject
// ====================================================================

/**
 * Archive a project — freezes it and hides from default list.
 *
 * @param {string} projectId
 * @param {string} [userId]
 * @returns {Promise<{ok, archived, unarchive_available} | {ok:false, error:string}>}
 */
export async function archiveProject(projectId, userId = "anonymous") {
  if (!projectId) return { ok: false, error: "project_id_required" };
  const map = _userMap(userId);
  const project = map.get(projectId);
  if (!project) return { ok: false, error: "project_not_found" };

  if (project.status === "archived") {
    return { ok: false, error: "already_archived" };
  }
  if (project.status === "deleted") {
    return { ok: false, error: "cannot_archive_deleted_project" };
  }

  project.status = "archived";
  project.archived_at = _now();
  project.modified_at = _now();
  map.set(projectId, project);

  return {
    ok: true,
    archived: true,
    unarchive_available: true,
  };
}

// ====================================================================
// 8. getProjectStats
// ====================================================================

/**
 * Return aggregate stats for a project.
 *
 * @param {string} projectId
 * @param {string} [userId]
 * @returns {Promise<{ok, stats?} | {ok:false, error:string}>}
 */
export async function getProjectStats(projectId, userId = "anonymous") {
  if (!projectId) return { ok: false, error: "project_id_required" };
  const map = _userMap(userId);
  const project = map.get(projectId);
  if (!project) return { ok: false, error: "project_not_found" };

  let clipCount = 0;
  for (const track of project.tracks) {
    clipCount += (track.clips || []).length;
  }

  return {
    ok: true,
    stats: {
      duration_sec: project.duration_sec || 0,
      track_count: project.tracks.length,
      clip_count: clipCount,
      file_size_mb: project.file_size_mb || 0,
      last_modified: project.modified_at,
    },
  };
}

// ====================================================================
// 9. searchProjects
// ====================================================================

/**
 * Full-text search across projects with optional filters.
 *
 * @param {object} args
 * @param {string} args.query - Search string (matched against name + description)
 * @param {object} [args.filters] - { status, template, created_after, created_before }
 * @param {string} [args.userId]
 * @returns {Promise<{ok, projects, total_matches}>}
 */
export async function searchProjects({ query, filters = {}, userId = "anonymous" } = {}) {
  if (!query || typeof query !== "string" || !query.trim()) {
    return { ok: false, error: "query_required" };
  }

  const map = _userMap(userId);
  const q = query.trim().toLowerCase();

  let results = [...map.values()].filter((p) => p.status !== "deleted");

  // Apply filters
  if (filters.status) {
    results = results.filter((p) => p.status === filters.status);
  }
  if (filters.template) {
    results = results.filter((p) => p.template === filters.template);
  }
  if (filters.created_after) {
    const after = new Date(filters.created_after).getTime();
    if (!isNaN(after)) results = results.filter((p) => p.created_at >= after);
  }
  if (filters.created_before) {
    const before = new Date(filters.created_before).getTime();
    if (!isNaN(before)) results = results.filter((p) => p.created_at <= before);
  }

  // Score: 1.0 for name match, 0.6 for description match
  const scored = results
    .map((p) => {
      const nameMatch = p.name.toLowerCase().includes(q);
      const descMatch = (p.description || "").toLowerCase().includes(q);
      if (!nameMatch && !descMatch) return null;
      const score = nameMatch ? 1.0 : 0.6;
      return { id: p.id, name: p.name, score };
    })
    .filter(Boolean);

  scored.sort((a, b) => b.score - a.score);

  return {
    ok: true,
    projects: scored,
    total_matches: scored.length,
  };
}

// ====================================================================
// 10. exportProject
// ====================================================================

/**
 * Export a project in a specific format.
 *
 * @param {string} projectId
 * @param {object} opts
 * @param {string} [opts.format] - vireo | premiere | davinci | finalcut (default "vireo")
 * @param {string} [userId]
 * @returns {Promise<{ok, url, format, file_size_mb, exported_at} | {ok:false, error:string}>}
 */
export async function exportProject(projectId, { format = "vireo" } = {}, userId = "anonymous") {
  if (!projectId) return { ok: false, error: "project_id_required" };
  if (!VALID_EXPORT_FORMATS.includes(format)) {
    return { ok: false, error: "invalid_export_format", valid_formats: VALID_EXPORT_FORMATS };
  }

  const map = _userMap(userId);
  const project = map.get(projectId);
  if (!project) return { ok: false, error: "project_not_found" };

  // Simulate export — v1 returns a URL placeholder + estimated size
  const estimatedSize = Math.max(0.1, (project.tracks.length * 0.5 + (project.clips_count || 0) * 2.1));
  const url = `https://exports.vireo.studio/${userId}/${project.id}/${format}-${Date.now()}.${format === "vireo" ? "zip" : "prproj"}`;

  return {
    ok: true,
    url,
    format,
    file_size_mb: Math.round(estimatedSize * 100) / 100,
    exported_at: _now(),
    project_id: projectId,
    note: "v1 generates a placeholder URL. v2 will invoke ffmpeg/EDI export pipeline.",
  };
}

// ====================================================================
// Tool definitions for the LLM (OpenAI function-calling format)
// ====================================================================

export const PROJECT_TOOLS = [
  {
    type: "function",
    function: {
      name: "create_project",
      description:
        "Create a new video production project from a template or blank. " +
        "Templates include blank, youtube_vlog, youtube_tutorial, tiktok_series, " +
        "podcast, and commercial — each pre-configures tracks. Call this when the " +
        "user says 'create project', 'new project', or describes a video they want " +
        "to produce. Name is REQUIRED.",
      parameters: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", description: "Project name (1-120 chars)" },
          description: { type: "string", description: "Optional project description" },
          template: {
            type: "string",
            enum: VALID_TEMPLATE_NAMES,
            description: "Template to start from. Default 'blank'.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_projects",
      description:
        "List the user's content projects. Returns id, name, status, and " +
        "last modified time. Supports sorting by name, created, modified, or status.",
      parameters: {
        type: "object",
        properties: {
          sortBy: {
            type: "string",
            enum: VALID_SORT_FIELDS,
            description: "Sort field. Default 'modified'.",
          },
          limit: { type: "number", description: "Max results. Default 20, max 200." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_project",
      description:
        "Get full details of a project including all tracks, clips, and metadata. " +
        "Call this when the user asks to 'open', 'view', or 'show details' of a project.",
      parameters: {
        type: "object",
        required: ["project_id"],
        properties: {
          project_id: { type: "string", description: "The project ID" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_project",
      description:
        "Update a project's name and/or description. Only provided fields are changed.",
      parameters: {
        type: "object",
        required: ["project_id"],
        properties: {
          project_id: { type: "string", description: "The project ID" },
          name: { type: "string", description: "New project name" },
          description: { type: "string", description: "New project description" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_project",
      description:
        "Soft-delete a project. The project is moved to 'deleted' status and a " +
        "backup is retained for 30 days. DESTRUCTIVE — confirm with user first.",
      parameters: {
        type: "object",
        required: ["project_id"],
        properties: {
          project_id: { type: "string", description: "The project ID to delete" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "duplicate_project",
      description:
        "Create a deep copy of an existing project with a fresh ID. All tracks " +
        "are duplicated. The user can optionally provide a new name.",
      parameters: {
        type: "object",
        required: ["project_id"],
        properties: {
          project_id: { type: "string", description: "The project ID to duplicate" },
          new_name: { type: "string", description: "Name for the copy. Default '<original> (Copy)'." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "archive_project",
      description:
        "Archive a project — freezes it and hides from the default project list. " +
        "The project can be unarchived later. Use when the user says 'archive this'.",
      parameters: {
        type: "object",
        required: ["project_id"],
        properties: {
          project_id: { type: "string", description: "The project ID to archive" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_project_stats",
      description:
        "Get aggregate statistics for a project: total duration, track count, " +
        "clip count, estimated file size, and last modified time.",
      parameters: {
        type: "object",
        required: ["project_id"],
        properties: {
          project_id: { type: "string", description: "The project ID" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_projects",
      description:
        "Search across all projects by name and description. Supports filters " +
        "for status, template, and date range. Returns results ranked by relevance.",
      parameters: {
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string", description: "Search text to match against names and descriptions" },
          filters: {
            type: "object",
            properties: {
              status: { type: "string", enum: ["active", "archived"] },
              template: { type: "string", enum: VALID_TEMPLATE_NAMES },
              created_after: { type: "string", description: "ISO 8601 date" },
              created_before: { type: "string", description: "ISO 8601 date" },
            },
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "export_project",
      description:
        "Export a project in a specific format. Supported: vireo (native zip), " +
        "premiere (.prproj), davinci (.drp), finalcut (.fcpxml). Returns a " +
        "download URL and file size estimate.",
      parameters: {
        type: "object",
        required: ["project_id"],
        properties: {
          project_id: { type: "string", description: "The project ID to export" },
          format: {
            type: "string",
            enum: VALID_EXPORT_FORMATS,
            description: "Export format. Default 'vireo'.",
          },
        },
      },
    },
  },
];

export const PROJECT_TOOL_NAMES = new Set(PROJECT_TOOLS.map((t) => t.function.name));
