// Vireo Studio — plugin ecosystem foundation.
//
// This module provides a dependency-free, in-memory plugin API surface for
// manual editing, marketplace flows, bot orchestration, effects, transitions,
// tools, sandbox execution, permissions, and analytics.
//
// Exports:
//   PluginRegistry, PluginManager, PluginAPI, EffectSystem, TransitionSystem,
//   ToolRegistry, MarketplacePlugin, PermissionSystem, SandboxRuntime,
//   PluginAnalytics
//   VIREO_PLUGIN_ECOSYSTEM_VERSION

const VIREO_PLUGIN_ECOSYSTEM_VERSION = "1.0.0";

const REQUIRED_PLUGIN_FIELDS = [
  "id",
  "name",
  "version",
  "author",
  "description",
  "category",
  "entry_point",
];

const PERMISSION_CATEGORIES = [
  "timeline",
  "assets",
  "effects",
  "transitions",
  "tools",
  "filesystem",
  "network",
  "process",
  "analytics",
  "ai",
];

const SORT_FIELDS = new Set(["name", "version", "author", "category", "createdAt", "updatedAt"]);

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

function cloneSerializable(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "function") return value;
  if (Array.isArray(value)) return value.map((item) => cloneSerializable(item));
  if (typeof value === "object") {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      if (val !== undefined) out[key] = cloneSerializable(val);
    }
    return out;
  }
  return value;
}

function cloneRecord(record) {
  return cloneSerializable(record);
}

function normalizeArray(value, fieldName) {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an array`);
  }
  return [...value];
}

function comparePlugins(a, b, sort_by) {
  if (!sort_by || !SORT_FIELDS.has(sort_by)) return a.name.localeCompare(b.name);
  const av = a[sort_by] ?? "";
  const bv = b[sort_by] ?? "";
  if (typeof av === "number" && typeof bv === "number") return av - bv;
  return String(av).localeCompare(String(bv));
}

function requireMapGet(map, id, label = "item") {
  if (!map.has(id)) {
    throw new Error(`${label} not found: ${id}`);
  }
  return map.get(id);
}

function makeValidationResult(valid, errors = [], warnings = []) {
  return { valid, errors: [...errors], warnings: [...warnings] };
}

function validatePluginShape(plugin) {
  const errors = [];
  const warnings = [];

  if (!plugin || typeof plugin !== "object" || Array.isArray(plugin)) {
    errors.push("plugin must be an object");
    return makeValidationResult(false, errors, warnings);
  }

  for (const field of REQUIRED_PLUGIN_FIELDS) {
    if (plugin[field] === undefined || plugin[field] === null || plugin[field] === "") {
      errors.push(`${field} is required`);
    }
  }

  if (plugin.id !== undefined && !/^[A-Za-z0-9_.:-]+$/.test(String(plugin.id))) {
    errors.push("id must contain only letters, numbers, dot, underscore, colon, or hyphen");
  }

  if (plugin.permissions !== undefined && !Array.isArray(plugin.permissions)) {
    errors.push("permissions must be an array");
  } else if (plugin.permissions !== undefined) {
    for (const permission of plugin.permissions) {
      if (typeof permission !== "string" || permission.trim() === "") {
        errors.push("permissions must contain only non-empty strings");
        break;
      }
    }
  }

  if (plugin.dependencies !== undefined && !Array.isArray(plugin.dependencies)) {
    errors.push("dependencies must be an array");
  } else if (plugin.dependencies !== undefined) {
    for (const dependency of plugin.dependencies) {
      if (typeof dependency !== "string" || dependency.trim() === "") {
        errors.push("dependencies must contain only non-empty strings");
        break;
      }
    }
  }

  if (plugin.version !== undefined && !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(String(plugin.version))) {
    warnings.push("version should look like semantic versioning (x.y.z)");
  }

  if (plugin.entry_point !== undefined && typeof plugin.entry_point !== "string" && typeof plugin.entry_point !== "function") {
    errors.push("entry_point must be a string path or a function");
  }

  return makeValidationResult(errors.length === 0, errors, warnings);
}

function createPluginRecord(plugin, status = "disabled") {
  const timestamp = nowIso();
  return {
    id: String(plugin.id),
    name: String(plugin.name),
    version: String(plugin.version),
    author: String(plugin.author),
    description: String(plugin.description),
    category: String(plugin.category),
    entry_point: plugin.entry_point,
    permissions: normalizeArray(plugin.permissions, "permissions"),
    dependencies: normalizeArray(plugin.dependencies, "dependencies"),
    status,
    installed: true,
    enabled: status === "enabled",
    createdAt: timestamp,
    updatedAt: timestamp,
    installedAt: timestamp,
    enabledAt: status === "enabled" ? timestamp : undefined,
    disabledAt: status === "disabled" ? timestamp : undefined,
  };
}

function updateRecordTimestamp(record) {
  record.updatedAt = nowIso();
  return record;
}

function assertKnownPlugin(registry, pluginId) {
  if (!registry.hasPlugin(pluginId)) {
    throw new Error(`Plugin not found: ${pluginId}`);
  }
}

class PluginRegistry {
  constructor() {
    this.plugins = new Map();
    this.history = [];
  }

  _recordHistory(action, pluginId, details = {}) {
    this.history.push({
      id: createId("hist"),
      action,
      pluginId,
      details,
      timestamp: nowIso(),
    });
  }

  hasPlugin(pluginId) {
    return this.plugins.has(pluginId);
  }

  register(plugin) {
    const validation = this.validatePlugin(plugin);
    if (!validation.valid) {
      throw new Error(`Invalid plugin: ${validation.errors.join("; ")}`);
    }

    const pluginId = String(plugin.id);
    if (this.plugins.has(pluginId)) {
      throw new Error(`Plugin already registered: ${pluginId}`);
    }

    const record = createPluginRecord(plugin, "disabled");
    this.plugins.set(pluginId, record);
    this._recordHistory("register", pluginId, { version: record.version, category: record.category });
    return cloneRecord(record);
  }

  getPlugin(pluginId) {
    return cloneRecord(requireMapGet(this.plugins, String(pluginId), "Plugin"));
  }

  listPlugins({ category, author, sort_by } = {}) {
    let records = [...this.plugins.values()];
    if (category !== undefined) {
      records = records.filter((record) => record.category === category);
    }
    if (author !== undefined) {
      records = records.filter((record) => record.author === author);
    }
    records.sort((a, b) => comparePlugins(a, b, sort_by));
    return records.map(cloneRecord);
  }

  enable(pluginId) {
    const record = requireMapGet(this.plugins, String(pluginId), "Plugin");
    record.status = "enabled";
    record.enabled = true;
    record.enabledAt = nowIso();
    record.disabledAt = undefined;
    updateRecordTimestamp(record);
    this._recordHistory("enable", record.id);
    return cloneRecord(record);
  }

  disable(pluginId) {
    const record = requireMapGet(this.plugins, String(pluginId), "Plugin");
    record.status = "disabled";
    record.enabled = false;
    record.disabledAt = nowIso();
    updateRecordTimestamp(record);
    this._recordHistory("disable", record.id);
    return cloneRecord(record);
  }

  uninstall(pluginId) {
    const record = requireMapGet(this.plugins, String(pluginId), "Plugin");
    this.plugins.delete(record.id);
    this._recordHistory("uninstall", record.id);
    return cloneRecord(record);
  }

  search(query) {
    const needle = String(query || "").toLowerCase();
    if (!needle) return [];
    return this.listPlugins({}).filter((record) => {
      const haystack = [
        record.id,
        record.name,
        record.version,
        record.author,
        record.description,
        record.category,
      ]
        .filter((value) => value !== undefined)
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }

  getCategories() {
    return [...new Set(this.plugins.values().map((record) => record.category))].sort();
  }

  validatePlugin(plugin) {
    return validatePluginShape(plugin);
  }

  getDependencyGraph() {
    const nodes = [...this.plugins.values()].map((record) => ({
      id: record.id,
      name: record.name,
      version: record.version,
      category: record.category,
      status: record.status,
    }));
    const edges = [];
    const adjacency = {};

    for (const record of this.plugins.values()) {
      adjacency[record.id] = [...record.dependencies];
      for (const dependency of record.dependencies) {
        edges.push({ from: record.id, to: dependency });
      }
    }

    return { nodes, edges, adjacency };
  }

  getHistory(limit = 100) {
    return cloneRecord([...this.history].slice(-limit));
  }
}

class PluginManager {
  constructor({ registry = new PluginRegistry(), permissions, analytics } = {}) {
    this.registry = registry;
    this.permissions = permissions;
    this.analytics = analytics;
    this.loaded = new Map();
    this.logs = [];
  }

  _log(pluginId, level, message, details = {}) {
    const entry = {
      id: createId("log"),
      pluginId,
      level,
      message,
      details,
      timestamp: nowIso(),
    };
    this.logs.push(entry);
    return entry;
  }

  install(plugin) {
    const validation = this.registry.validatePlugin(plugin);
    if (!validation.valid) {
      const result = {
        pluginId: plugin?.id,
        installed: false,
        status: "validation_failed",
        validation,
        dependenciesResolved: false,
        logs: [],
      };
      this._log(plugin?.id || "unknown", "error", "Plugin validation failed", { errors: validation.errors });
      return result;
    }

    const pluginId = String(plugin.id);
    const missingDependencies = (plugin.dependencies || []).filter((dependency) => !this.registry.hasPlugin(dependency));
    if (missingDependencies.length > 0) {
      const result = {
        pluginId,
        installed: false,
        status: "missing_dependencies",
        missingDependencies,
        dependenciesResolved: false,
        logs: [],
      };
      this._log(pluginId, "error", "Plugin dependencies are missing", { missingDependencies });
      return result;
    }

    const existing = this.registry.plugins.get(pluginId);
    let record;
    if (existing) {
      record = createPluginRecord({ ...existing, ...plugin }, existing.status);
      record.createdAt = existing.createdAt;
      record.installedAt = existing.installedAt;
      this.registry.plugins.set(pluginId, record);
      this._log(pluginId, "info", "Plugin updated during install", { version: record.version });
    } else {
      record = this.registry.register(plugin);
      this._log(pluginId, "info", "Plugin installed", { version: record.version });
    }

    if (this.analytics?.trackInstall) {
      this.analytics.trackInstall(pluginId, "system");
    }

    return {
      pluginId,
      installed: true,
      status: record.status,
      validation,
      dependenciesResolved: true,
      record,
      logs: this.getPluginLogs(pluginId, 10),
    };
  }

  load(pluginId) {
    const id = String(pluginId);
    const record = requireMapGet(this.registry.plugins, id, "Plugin");
    if (this.loaded.has(id)) {
      return cloneRecord(this.loaded.get(id));
    }

    const loaded = {
      pluginId: id,
      name: record.name,
      version: record.version,
      status: "loaded",
      exports: {},
      sandboxId: null,
      loadedAt: nowIso(),
    };

    if (typeof record.entry_point === "function") {
      try {
        loaded.exports = record.entry_point({ plugin: record, manager: this }) || {};
      } catch (error) {
        this._log(id, "error", "Plugin entry_point failed during load", { error: error.message });
        throw error;
      }
    } else if (typeof record.entry_point === "string") {
      loaded.exports = { entryPoint: record.entry_point };
    }

    record.status = "enabled";
    record.enabled = true;
    record.enabledAt = nowIso();
    record.disabledAt = undefined;
    updateRecordTimestamp(record);
    this.loaded.set(id, loaded);
    this._log(id, "info", "Plugin loaded", { entry_point: record.entry_point });
    return cloneRecord(loaded);
  }

  unload(pluginId) {
    const id = String(pluginId);
    const loaded = requireMapGet(this.loaded, id, "Loaded plugin");
    this.loaded.delete(id);
    const record = requireMapGet(this.registry.plugins, id, "Plugin");
    record.status = "disabled";
    record.enabled = false;
    record.disabledAt = nowIso();
    updateRecordTimestamp(record);
    this._log(id, "info", "Plugin unloaded");
    return cloneRecord(loaded);
  }

  reload(pluginId) {
    const id = String(pluginId);
    if (this.loaded.has(id)) {
      this.unload(id);
    }
    return this.load(id);
  }

  getLoadedPlugins() {
    return [...this.loaded.values()].map(cloneRecord);
  }

  getPluginStatus(pluginId) {
    const id = String(pluginId);
    const record = requireMapGet(this.registry.plugins, id, "Plugin");
    return {
      pluginId: id,
      status: record.status,
      enabled: record.enabled === true,
      loaded: this.loaded.has(id),
      version: record.version,
      updatedAt: record.updatedAt,
    };
  }

  getPluginLogs(pluginId, limit = 100) {
    const id = String(pluginId);
    return [...this.logs]
      .filter((entry) => entry.pluginId === id)
      .slice(-Math.max(0, limit))
      .map(cloneRecord);
  }

  update(pluginId) {
    const id = String(pluginId);
    const current = requireMapGet(this.registry.plugins, id, "Plugin");
    const previousVersion = current.version;
    const nextPatch = current.version
      .split(".")
      .map((part, index) => (index === 2 ? String(Number(part) + 1) : part))
      .join(".");
    current.version = nextPatch;
    updateRecordTimestamp(current);
    this._log(id, "info", "Plugin updated", { from: previousVersion, to: nextPatch });
    return {
      pluginId: id,
      updated: true,
      from: previousVersion,
      to: nextPatch,
      status: current.status,
      logs: this.getPluginLogs(id, 10),
    };
  }
}

class PluginAPI {
  constructor(pluginManager) {
    this.pluginManager = pluginManager;
    this.timelines = new Map();
    this.history = [];
  }

  _recordHistory(action, details = {}) {
    this.history.push({
      id: createId("hist"),
      action,
      ...details,
      timestamp: nowIso(),
    });
  }

  createTimeline(projectId) {
    if (!projectId) throw new Error("projectId is required");
    const timeline = {
      id: createId("timeline"),
      projectId: String(projectId),
      clips: [],
      effects: [],
      transitions: [],
      metadata: {},
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.timelines.set(timeline.id, timeline);
    this._recordHistory("createTimeline", { timelineId: timeline.id, projectId: timeline.projectId });
    return cloneRecord(timeline);
  }

  getTimeline(timelineId) {
    return cloneRecord(requireMapGet(this.timelines, String(timelineId), "Timeline"));
  }

  addClip(timelineId, clip) {
    const timeline = requireMapGet(this.timelines, String(timelineId), "Timeline");
    if (!clip || typeof clip !== "object") throw new Error("clip must be an object");
    const normalized = {
      id: String(clip.id || createId("clip")),
      source: clip.source || clip.sourceId || null,
      start_ms: Number(clip.start_ms ?? clip.startMs ?? 0),
      end_ms: Number(clip.end_ms ?? clip.endMs ?? clip.duration_ms ?? clip.durationMs ?? 0),
      position_ms: Number(clip.position_ms ?? clip.positionMs ?? timeline.clips.length * 1000),
      effects: [],
      transitions: [],
      metadata: cloneSerializable(clip.metadata || {}),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    timeline.clips.push(normalized);
    timeline.updatedAt = nowIso();
    this._recordHistory("addClip", { timelineId: timeline.id, clipId: normalized.id });
    return cloneRecord(normalized);
  }

  removeClip(timelineId, clipId) {
    const timeline = requireMapGet(this.timelines, String(timelineId), "Timeline");
    const index = timeline.clips.findIndex((clip) => clip.id === clipId);
    if (index === -1) throw new Error(`Clip not found: ${clipId}`);
    const [removed] = timeline.clips.splice(index, 1);
    timeline.updatedAt = nowIso();
    this._recordHistory("removeClip", { timelineId: timeline.id, clipId });
    return cloneRecord(removed);
  }

  moveClip(timelineId, clipId, position) {
    const timeline = requireMapGet(this.timelines, String(timelineId), "Timeline");
    const clip = timeline.clips.find((item) => item.id === clipId);
    if (!clip) throw new Error(`Clip not found: ${clipId}`);
    clip.position_ms = Number(position);
    clip.updatedAt = nowIso();
    timeline.updatedAt = nowIso();
    this._recordHistory("moveClip", { timelineId: timeline.id, clipId, position });
    return cloneRecord(clip);
  }

  splitClip(timelineId, clipId, time_ms) {
    const timeline = requireMapGet(this.timelines, String(timelineId), "Timeline");
    const clip = timeline.clips.find((item) => item.id === clipId);
    if (!clip) throw new Error(`Clip not found: ${clipId}`);
    const split = Number(time_ms);
    if (!Number.isFinite(split) || split <= clip.start_ms || split >= clip.end_ms) {
      throw new Error("time_ms must be inside the clip range");
    }

    const right = cloneRecord(clip);
    right.id = createId("clip");
    right.start_ms = split;
    right.position_ms = clip.position_ms + (split - clip.start_ms);
    right.effects = [];
    right.transitions = [];
    right.updatedAt = nowIso();
    right.createdAt = nowIso();

    clip.end_ms = split;
    clip.updatedAt = nowIso();
    timeline.updatedAt = nowIso();
    this._recordHistory("splitClip", { timelineId: timeline.id, clipId, leftEndMs: split, rightClipId: right.id });
    return { left: cloneRecord(clip), right: cloneRecord(right) };
  }

  trimClip(timelineId, clipId, start_ms, end_ms) {
    const timeline = requireMapGet(this.timelines, String(timelineId), "Timeline");
    const clip = timeline.clips.find((item) => item.id === clipId);
    if (!clip) throw new Error(`Clip not found: ${clipId}`);
    const start = Number(start_ms);
    const end = Number(end_ms);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
      throw new Error("Invalid trim range");
    }
    clip.start_ms = start;
    clip.end_ms = end;
    clip.updatedAt = nowIso();
    timeline.updatedAt = nowIso();
    this._recordHistory("trimClip", { timelineId: timeline.id, clipId, start, end });
    return cloneRecord(clip);
  }

  addEffect(timelineId, clipId, effect) {
    const timeline = requireMapGet(this.timelines, String(timelineId), "Timeline");
    const clip = timeline.clips.find((item) => item.id === clipId);
    if (!clip) throw new Error(`Clip not found: ${clipId}`);
    if (!effect || typeof effect !== "object") throw new Error("effect must be an object");
    const instance = {
      id: String(effect.id || createId("effect_instance")),
      effectId: String(effect.effectId || effect.type || "custom_effect"),
      params: cloneSerializable(effect.params || {}),
      clipId,
      timelineId: timeline.id,
      enabled: effect.enabled !== false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    clip.effects.push(instance);
    timeline.effects.push(instance);
    timeline.updatedAt = nowIso();
    this._recordHistory("addEffect", { timelineId: timeline.id, clipId, effectInstanceId: instance.id });
    return cloneRecord(instance);
  }

  removeEffect(timelineId, effectId) {
    const timeline = requireMapGet(this.timelines, String(timelineId), "Timeline");
    const index = timeline.effects.findIndex((effect) => effect.id === effectId);
    if (index === -1) throw new Error(`Effect instance not found: ${effectId}`);
    const [removed] = timeline.effects.splice(index, 1);
    for (const clip of timeline.clips) {
      clip.effects = clip.effects.filter((effect) => effect.id !== effectId);
    }
    timeline.updatedAt = nowIso();
    this._recordHistory("removeEffect", { timelineId: timeline.id, effectId });
    return cloneRecord(removed);
  }

  exportTimeline(timelineId, format = "json") {
    const timeline = requireMapGet(this.timelines, String(timelineId), "Timeline");
    const payload = cloneRecord(timeline);
    if (format === "json") {
      return {
        timelineId: timeline.id,
        format,
        exported: true,
        data: payload,
        exportedAt: nowIso(),
      };
    }
    return {
      timelineId: timeline.id,
      format,
      exported: true,
      mimeType: "application/octet-stream",
      data: payload,
      exportedAt: nowIso(),
    };
  }

  getHistory(limit = 100) {
    return cloneRecord([...this.history].slice(-limit));
  }
}

class EffectSystem {
  constructor() {
    this.effects = new Map();
    this.instances = new Map();
    this.presets = new Map();
  }

  registerEffect(effect) {
    if (!effect || typeof effect !== "object") throw new Error("effect must be an object");
    if (!effect.id) throw new Error("effect.id is required");
    const normalized = {
      id: String(effect.id),
      name: String(effect.name || effect.id),
      category: String(effect.category || "general"),
      description: String(effect.description || ""),
      version: String(effect.version || "1.0.0"),
      defaults: cloneSerializable(effect.defaults || {}),
      handler: typeof effect.handler === "function" ? effect.handler : null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.effects.set(normalized.id, normalized);
    return cloneRecord(normalized);
  }

  getEffect(effectId) {
    const effect = requireMapGet(this.effects, String(effectId), "Effect");
    return cloneRecord(effect);
  }

  listEffects({ category, sort_by } = {}) {
    let effects = [...this.effects.values()];
    if (category !== undefined) {
      effects = effects.filter((effect) => effect.category === category);
    }
    effects.sort((a, b) => comparePlugins(a, b, sort_by || "name"));
    return effects.map(cloneRecord);
  }

  applyEffect(timelineId, clipId, effectId, params = {}) {
    if (!this.effects.has(effectId)) throw new Error(`Effect not found: ${effectId}`);
    const effect = this.effects.get(effectId);
    const instance = {
      id: createId("effect_instance"),
      timelineId: String(timelineId),
      clipId: String(clipId),
      effectId: effect.id,
      params: { ...cloneSerializable(effect.defaults), ...cloneSerializable(params) },
      enabled: true,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.instances.set(instance.id, instance);
    return cloneRecord(instance);
  }

  removeEffect(effectInstanceId) {
    const instance = requireMapGet(this.instances, String(effectInstanceId), "Effect instance");
    this.instances.delete(instance.id);
    return cloneRecord(instance);
  }

  getEffectInstances(clipId) {
    return [...this.instances.values()]
      .filter((instance) => instance.clipId === clipId)
      .map(cloneRecord);
  }

  getEffectPresets() {
    return [...this.presets.values()].map(cloneRecord);
  }

  createPreset(name, effectIds) {
    if (!name) throw new Error("preset name is required");
    const ids = normalizeArray(effectIds, "effectIds");
    for (const effectId of ids) {
      if (!this.effects.has(effectId)) throw new Error(`Effect not found: ${effectId}`);
    }
    const preset = {
      id: createId("preset"),
      name: String(name),
      effectIds: ids,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.presets.set(preset.id, preset);
    return cloneRecord(preset);
  }
}

class TransitionSystem {
  constructor() {
    this.transitions = new Map();
    this.instances = new Map();
    this.presets = new Map();
  }

  registerTransition(transition) {
    if (!transition || typeof transition !== "object") throw new Error("transition must be an object");
    if (!transition.id) throw new Error("transition.id is required");
    const normalized = {
      id: String(transition.id),
      name: String(transition.name || transition.id),
      category: String(transition.category || "general"),
      description: String(transition.description || ""),
      version: String(transition.version || "1.0.0"),
      defaults: cloneSerializable(transition.defaults || {}),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.transitions.set(normalized.id, normalized);
    return cloneRecord(normalized);
  }

  getTransition(transitionId) {
    return cloneRecord(requireMapGet(this.transitions, String(transitionId), "Transition"));
  }

  listTransitions() {
    return [...this.transitions.values()].map(cloneRecord);
  }

  addTransition(timelineId, clipId, transitionId, duration_ms) {
    if (!this.transitions.has(transitionId)) throw new Error(`Transition not found: ${transitionId}`);
    const transition = this.transitions.get(transitionId);
    const instance = {
      id: createId("transition_instance"),
      timelineId: String(timelineId),
      clipId: String(clipId),
      transitionId: transition.id,
      duration_ms: Number(duration_ms),
      params: cloneSerializable(transition.defaults || {}),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.instances.set(instance.id, instance);
    return cloneRecord(instance);
  }

  removeTransition(transitionInstanceId) {
    const instance = requireMapGet(this.instances, String(transitionInstanceId), "Transition instance");
    this.instances.delete(instance.id);
    return cloneRecord(instance);
  }

  getTransitions(timelineId) {
    return [...this.instances.values()]
      .filter((instance) => instance.timelineId === timelineId)
      .map(cloneRecord);
  }

  getTransitionPresets() {
    return [...this.presets.values()].map(cloneRecord);
  }

  createPreset(name, transitionIds) {
    if (!name) throw new Error("preset name is required");
    const ids = normalizeArray(transitionIds, "transitionIds");
    for (const transitionId of ids) {
      if (!this.transitions.has(transitionId)) throw new Error(`Transition not found: ${transitionId}`);
    }
    const preset = {
      id: createId("preset"),
      name: String(name),
      transitionIds: ids,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.presets.set(preset.id, preset);
    return cloneRecord(preset);
  }
}

class ToolRegistry {
  constructor() {
    this.tools = new Map();
    this.history = [];
  }

  _recordHistory(toolId, params, result) {
    this.history.push({
      id: createId("hist"),
      toolId,
      params: cloneSerializable(params),
      result: cloneSerializable(result),
      timestamp: nowIso(),
    });
  }

  registerTool(tool) {
    if (!tool || typeof tool !== "object") throw new Error("tool must be an object");
    if (!tool.id) throw new Error("tool.id is required");
    if (tool.handler && typeof tool.handler !== "function") throw new Error("tool.handler must be a function");
    const normalized = {
      id: String(tool.id),
      name: String(tool.name || tool.id),
      category: String(tool.category || "general"),
      description: String(tool.description || ""),
      version: String(tool.version || "1.0.0"),
      handler: tool.handler || null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.tools.set(normalized.id, normalized);
    return cloneRecord(normalized);
  }

  getTool(toolId) {
    return cloneRecord(requireMapGet(this.tools, String(toolId), "Tool"));
  }

  listTools({ category } = {}) {
    let tools = [...this.tools.values()];
    if (category !== undefined) {
      tools = tools.filter((tool) => tool.category === category);
    }
    tools.sort((a, b) => a.name.localeCompare(b.name));
    return tools.map(cloneRecord);
  }

  execute(toolId, params = {}) {
    const tool = requireMapGet(this.tools, String(toolId), "Tool");
    if (!tool.handler) throw new Error(`Tool has no handler: ${toolId}`);
    const started = Date.now();
    let result;
    try {
      result = tool.handler(params);
      if (result && typeof result.then === "function") {
        result = result.then((resolved) => {
          const duration_ms = Date.now() - started;
          const toolResult = { toolId: tool.id, ok: true, result: resolved, duration_ms };
          this._recordHistory(tool.id, params, toolResult);
          return toolResult;
        });
        return result;
      }
    } catch (error) {
      const toolResult = { toolId: tool.id, ok: false, error: error.message, duration_ms: Date.now() - started };
      this._recordHistory(tool.id, params, toolResult);
      return toolResult;
    }
    const toolResult = { toolId: tool.id, ok: true, result, duration_ms: Date.now() - started };
    this._recordHistory(tool.id, params, toolResult);
    return toolResult;
  }

  getToolCategories() {
    return [...new Set(this.tools.values().map((tool) => tool.category))].sort();
  }

  getToolHistory(limit = 100) {
    return cloneRecord([...this.history].slice(-limit));
  }
}

class MarketplacePlugin {
  constructor({ registry, manager } = {}) {
    this.registry = registry || new PluginRegistry();
    this.manager = manager || new PluginManager({ registry: this.registry });
    this.catalog = new Map();
    this.reviews = new Map();
    this.stats = new Map();
    this.featured = [];
    this.newArrivals = [];
    this.bestSellers = [];
    this._seedCatalog();
  }

  _seedCatalog() {
    const seed = [
      {
        id: "vireo.color-grade",
        name: "Cinematic Color Grade",
        version: "1.2.0",
        author: "Vireo Labs",
        description: "Apply cinematic color grades to timelines.",
        category: "effects",
        entry_point: "effects/color-grade",
        permissions: ["effects:apply"],
        dependencies: [],
        price: 0,
        rating: 4.8,
        installs: 1240,
        trendingScore: 98,
      },
      {
        id: "vireo.caption-flow",
        name: "Caption Flow",
        version: "2.0.1",
        author: "Vireo Labs",
        description: "Generate and animate social captions.",
        category: "captions",
        entry_point: "captions/flow",
        permissions: ["timeline:edit", "ai:generate"],
        dependencies: [],
        price: 9.99,
        rating: 4.7,
        installs: 980,
        trendingScore: 91,
      },
      {
        id: "community.trim-assistant",
        name: "Trim Assistant",
        version: "0.9.5",
        author: "Community",
        description: "Suggest tight edit points for talking-head videos.",
        category: "editing",
        entry_point: "editing/trim-assistant",
        permissions: ["timeline:edit"],
        dependencies: ["vireo.color-grade"],
        price: 0,
        rating: 4.2,
        installs: 540,
        trendingScore: 72,
      },
      {
        id: "creator.sound-sync",
        name: "Sound Sync",
        version: "1.0.0",
        author: "Creator Tools",
        description: "Sync clips to music beats.",
        category: "audio",
        entry_point: "audio/sound-sync",
        permissions: ["timeline:edit", "assets:read"],
        dependencies: [],
        price: 14.99,
        rating: 4.9,
        installs: 1520,
        trendingScore: 96,
      },
    ];
    for (const plugin of seed) {
      this.catalog.set(plugin.id, { ...plugin });
      this.stats.set(plugin.id, {
        installs: plugin.installs,
        uninstalls: 0,
        usageCount: Math.round(plugin.installs * 2.5),
        averageDurationMs: 12000,
        rating: plugin.rating,
        reviews: 0,
        trendingScore: plugin.trendingScore,
      });
      this.reviews.set(plugin.id, [
        {
          id: createId("review"),
          pluginId: plugin.id,
          userId: "seed-user",
          rating: plugin.rating,
          comment: `Seeded review for ${plugin.name}`,
          createdAt: nowIso(),
        },
      ]);
    }
    this.featured = ["vireo.color-grade", "creator.sound-sync"];
    this.newArrivals = ["community.trim-assistant"];
    this.bestSellers = ["creator.sound-sync", "vireo.color-grade"];
  }

  listPlugins({ category, sort_by, free_only } = {}) {
    let plugins = [...this.catalog.values()];
    if (category !== undefined) {
      plugins = plugins.filter((plugin) => plugin.category === category);
    }
    if (free_only) {
      plugins = plugins.filter((plugin) => (plugin.price || 0) === 0);
    }
    if (sort_by === "installs" || sort_by === "rating" || sort_by === "trendingScore" || sort_by === "name") {
      plugins.sort((a, b) => (b[sort_by] || 0) - (a[sort_by] || 0));
    } else {
      plugins.sort((a, b) => a.name.localeCompare(b.name));
    }
    return plugins.map(cloneRecord);
  }

  getPlugin(pluginId) {
    return cloneRecord(requireMapGet(this.catalog, String(pluginId), "Marketplace plugin"));
  }

  installPlugin(pluginId) {
    const plugin = this.getPlugin(pluginId);
    const result = this.manager.install({
      id: plugin.id,
      name: plugin.name,
      version: plugin.version,
      author: plugin.author,
      description: plugin.description,
      category: plugin.category,
      entry_point: plugin.entry_point,
      permissions: plugin.permissions,
      dependencies: plugin.dependencies,
    });
    if (result.installed) {
      const stats = this.stats.get(plugin.id);
      stats.installs += 1;
    }
    return result;
  }

  getReviews(pluginId) {
    return cloneRecord([...(this.reviews.get(String(pluginId)) || [])]);
  }

  getPluginStats(pluginId) {
    return cloneRecord(this.stats.get(String(pluginId)) || {
      installs: 0,
      uninstalls: 0,
      usageCount: 0,
      averageDurationMs: 0,
      rating: 0,
      reviews: 0,
      trendingScore: 0,
    });
  }

  getFeatured(limit = 5) {
    return this.featured.slice(0, limit).map((id) => this.getPlugin(id));
  }

  getNewArrivals(limit = 5) {
    return this.newArrivals.slice(0, limit).map((id) => this.getPlugin(id));
  }

  getBestSellers(limit = 5) {
    return this.bestSellers.slice(0, limit).map((id) => this.getPlugin(id));
  }
}

class PermissionSystem {
  constructor() {
    this.permissions = new Map();
    this.history = new Map();
  }

  _recordHistory(pluginId, action, permission, details = {}) {
    const bucket = this.history.get(pluginId) || [];
    bucket.push({
      id: createId("hist"),
      pluginId,
      action,
      permission,
      details,
      timestamp: nowIso(),
    });
    this.history.set(pluginId, bucket);
  }

  requestPermission(pluginId, permission) {
    const request = {
      id: createId("permission_request"),
      pluginId: String(pluginId),
      permission: String(permission),
      category: this._categoryForPermission(permission),
      status: "pending",
      requestedAt: nowIso(),
    };
    this._recordHistory(request.pluginId, "request", request.permission);
    return cloneRecord(request);
  }

  grantPermission(pluginId, permission) {
    const pluginIdStr = String(pluginId);
    const permissionStr = String(permission);
    const bucket = this.permissions.get(pluginIdStr) || new Set();
    bucket.add(permissionStr);
    this.permissions.set(pluginIdStr, bucket);
    this._recordHistory(pluginIdStr, "grant", permissionStr);
    return {
      pluginId: pluginIdStr,
      permission: permissionStr,
      granted: true,
      grantedAt: nowIso(),
    };
  }

  revokePermission(pluginId, permission) {
    const pluginIdStr = String(pluginId);
    const permissionStr = String(permission);
    const bucket = this.permissions.get(pluginIdStr) || new Set();
    const revoked = bucket.delete(permissionStr);
    if (!bucket.size) this.permissions.delete(pluginIdStr);
    else this.permissions.set(pluginIdStr, bucket);
    this._recordHistory(pluginIdStr, "revoke", permissionStr, { revoked });
    return {
      pluginId: pluginIdStr,
      permission: permissionStr,
      revoked,
      revokedAt: nowIso(),
    };
  }

  getPermissions(pluginId) {
    return [...(this.permissions.get(String(pluginId)) || new Set())].sort();
  }

  checkPermission(pluginId, permission) {
    return (this.permissions.get(String(pluginId)) || new Set()).has(String(permission));
  }

  getPermissionCategories() {
    return [...PERMISSION_CATEGORIES];
  }

  getPermissionHistory(pluginId) {
    return cloneRecord([...(this.history.get(String(pluginId)) || [])]);
  }

  _categoryForPermission(permission) {
    const [category] = String(permission).split(":");
    return PERMISSION_CATEGORIES.includes(category) ? category : "general";
  }
}

class SandboxRuntime {
  constructor() {
    this.sandboxes = new Map();
    this.cpu = new Map();
    this.memory = new Map();
  }

  createSandbox(pluginId) {
    const sandbox = {
      id: createId("sandbox"),
      pluginId: String(pluginId),
      status: "running",
      createdAt: nowIso(),
      terminatedAt: undefined,
      memory: { rss: 12 * 1024 * 1024, heapUsed: 4 * 1024 * 1024, external: 1 * 1024 * 1024 },
      cpu: { percent: 0, userMs: 0, systemMs: 0 },
    };
    this.sandboxes.set(sandbox.id, sandbox);
    this.cpu.set(sandbox.id, { ...sandbox.cpu });
    this.memory.set(sandbox.id, { ...sandbox.memory });
    return cloneRecord(sandbox);
  }

  async executeInSandbox(sandboxId, code) {
    const sandbox = requireMapGet(this.sandboxes, String(sandboxId), "Sandbox");
    if (sandbox.status !== "running") {
      return {
        sandboxId: sandbox.id,
        ok: false,
        error: `Sandbox is not running: ${sandbox.status}`,
        stdout: "",
        stderr: "",
        duration_ms: 0,
      };
    }

    const started = Date.now();
    try {
      if (typeof code !== "string") throw new Error("code must be a string");
      if (/process\.exit|require\(['"]child_process|eval\(|Function\(/.test(code)) {
        throw new Error("Blocked unsafe sandbox code");
      }
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      const fn = new AsyncFunction("api", `"use strict";\n${code}`);
      const result = fn({ sandboxId, pluginId: sandbox.pluginId, now: nowIso() });
      const duration_ms = Date.now() - started;
      const normalized = result && typeof result.then === "function" ? await result : result;
      this.cpu.set(sandbox.id, {
        percent: Math.min(100, Math.round(duration_ms / 10)),
        userMs: duration_ms,
        systemMs: Math.round(duration_ms * 0.1),
      });
      this.memory.set(sandbox.id, {
        rss: sandbox.memory.rss + Math.round(code.length * 16),
        heapUsed: sandbox.memory.heapUsed + Math.round(code.length * 8),
        external: sandbox.memory.external + Math.round(code.length),
      });
      return {
        sandboxId: sandbox.id,
        ok: true,
        result: cloneSerializable(normalized),
        stdout: "",
        stderr: "",
        duration_ms,
      };
    } catch (error) {
      const duration_ms = Date.now() - started;
      return {
        sandboxId: sandbox.id,
        ok: false,
        error: error.message,
        stdout: "",
        stderr: error.stack || "",
        duration_ms,
      };
    }
  }

  terminateSandbox(sandboxId) {
    const sandbox = requireMapGet(this.sandboxes, String(sandboxId), "Sandbox");
    sandbox.status = "terminated";
    sandbox.terminatedAt = nowIso();
    this.cpu.set(sandbox.id, { percent: 0, userMs: 0, systemMs: 0 });
    this.memory.set(sandbox.id, { ...sandbox.memory, rss: 0, heapUsed: 0, external: 0 });
    return cloneRecord(sandbox);
  }

  getSandboxStatus(sandboxId) {
    const sandbox = requireMapGet(this.sandboxes, String(sandboxId), "Sandbox");
    return {
      sandboxId: sandbox.id,
      pluginId: sandbox.pluginId,
      status: sandbox.status,
      createdAt: sandbox.createdAt,
      terminatedAt: sandbox.terminatedAt,
    };
  }

  getMemoryUsage(sandboxId) {
    const sandbox = requireMapGet(this.sandboxes, String(sandboxId), "Sandbox");
    return cloneRecord(this.memory.get(sandbox.id) || sandbox.memory);
  }

  getCpuUsage(sandboxId) {
    const sandbox = requireMapGet(this.sandboxes, String(sandboxId), "Sandbox");
    return cloneRecord(this.cpu.get(sandbox.id) || sandbox.cpu);
  }
}

class PluginAnalytics {
  constructor() {
    this.installs = new Map();
    this.uninstalls = new Map();
    this.usage = new Map();
    this.userHistory = new Map();
    this.developerStats = new Map();
  }

  _ensureInstall(pluginId) {
    if (!this.installs.has(pluginId)) this.installs.set(pluginId, new Set());
  }

  _getUsage(pluginId) {
    if (!this.usage.has(pluginId)) {
      this.usage.set(pluginId, { count: 0, totalDurationMs: 0, lastUsedAt: undefined });
    }
    return this.usage.get(pluginId);
  }

  _ensureDeveloper(developerId) {
    if (!this.developerStats.has(developerId)) {
      this.developerStats.set(developerId, {
        developerId,
        plugins: 0,
        installs: 0,
        uninstalls: 0,
        usageCount: 0,
        averageDurationMs: 0,
      });
    }
    return this.developerStats.get(developerId);
  }

  trackInstall(pluginId, userId) {
    this._ensureInstall(pluginId);
    this.installs.get(pluginId).add(userId);
    const developerStats = this._ensureDeveloper(userId);
    developerStats.plugins += 1;
    developerStats.installs += 1;
    const bucket = this.userHistory.get(userId) || [];
    bucket.push({
      id: createId("hist"),
      userId,
      pluginId,
      action: "install",
      timestamp: nowIso(),
    });
    this.userHistory.set(userId, bucket);
  }

  trackUninstall(pluginId, userId) {
    this._ensureInstall(pluginId);
    this.installs.get(pluginId).delete(userId);
    const developerStats = this._ensureDeveloper(userId);
    developerStats.uninstalls += 1;
    const bucket = this.userHistory.get(userId) || [];
    bucket.push({
      id: createId("hist"),
      userId,
      pluginId,
      action: "uninstall",
      timestamp: nowIso(),
    });
    this.userHistory.set(userId, bucket);
  }

  trackUsage(pluginId, action, duration_ms) {
    const usage = this._getUsage(pluginId);
    usage.count += 1;
    usage.totalDurationMs += Number(duration_ms || 0);
    usage.lastUsedAt = nowIso();
    const developerStats = this._ensureDeveloper(pluginId);
    developerStats.usageCount += 1;
    developerStats.averageDurationMs = Math.round(usage.totalDurationMs / Math.max(1, usage.count));
  }

  getPluginStats(pluginId) {
    const usage = this._getUsage(pluginId);
    return {
      pluginId,
      installs: this.installs.get(pluginId)?.size || 0,
      uninstalls: 0,
      usageCount: usage.count,
      averageDurationMs: usage.count ? Math.round(usage.totalDurationMs / usage.count) : 0,
      lastUsedAt: usage.lastUsedAt,
      rating: 0,
      reviews: 0,
      trendingScore: usage.count,
    };
  }

  getMostInstalled(limit = 10) {
    return [...this.installs.entries()]
      .map(([pluginId, users]) => ({ pluginId, installs: users.size }))
      .sort((a, b) => b.installs - a.installs)
      .slice(0, limit)
      .map((item) => this.getPluginStats(item.pluginId));
  }

  getMostUsed(limit = 10) {
    return [...this.usage.entries()]
      .map(([pluginId, usage]) => ({ pluginId, usageCount: usage.count }))
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, limit)
      .map((item) => this.getPluginStats(item.pluginId));
  }

  getTrending(limit = 10) {
    return [...this.usage.entries()]
      .map(([pluginId, usage]) => ({ pluginId, score: usage.count * 2 + (usage.lastUsedAt ? 1 : 0) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((item) => this.getPluginStats(item.pluginId));
  }

  getUserHistory(userId) {
    return cloneRecord([...(this.userHistory.get(userId) || [])]);
  }

  getDeveloperStats(developerId) {
    return cloneRecord(this.developerStats.get(developerId) || {
      developerId,
      plugins: 0,
      installs: 0,
      uninstalls: 0,
      usageCount: 0,
      averageDurationMs: 0,
    });
  }
}

export {
  VIREO_PLUGIN_ECOSYSTEM_VERSION,
  PluginRegistry,
  PluginManager,
  PluginAPI,
  EffectSystem,
  TransitionSystem,
  ToolRegistry,
  MarketplacePlugin,
  PermissionSystem,
  SandboxRuntime,
  PluginAnalytics,
};
