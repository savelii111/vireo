import { test } from "node:test";
import assert from "node:assert/strict";
import {
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
  VIREO_PLUGIN_ECOSYSTEM_VERSION,
} from "../src/plugin_ecosystem.js";

function pluginFactory(overrides = {}) {
  return {
    id: "plugin.base",
    name: "Base Plugin",
    version: "1.0.0",
    author: "Vireo Labs",
    description: "A minimal test plugin",
    category: "editing",
    entry_point: "plugins/base.js",
    permissions: ["timeline:edit"],
    dependencies: [],
    ...overrides,
  };
}

function effectFactory(overrides = {}) {
  return {
    id: "effect.blur",
    name: "Blur",
    category: "visual",
    description: "Blurs the clip",
    version: "1.0.0",
    defaults: { amount: 10 },
    ...overrides,
  };
}

function transitionFactory(overrides = {}) {
  return {
    id: "transition.fade",
    name: "Fade",
    category: "visual",
    description: "Fades the clip",
    version: "1.0.0",
    defaults: { opacity: 1 },
    ...overrides,
  };
}

function toolFactory(overrides = {}) {
  return {
    id: "tool.echo",
    name: "Echo Tool",
    category: "utility",
    description: "Echoes params",
    version: "1.0.0",
    handler: (params) => ({ ok: true, params }),
    ...overrides,
  };
}

// ---------- PluginRegistry ----------

test("test_plugin_registry_version_constant_exists", () => {
  assert.equal(typeof VIREO_PLUGIN_ECOSYSTEM_VERSION, "string");
  assert.ok(VIREO_PLUGIN_ECOSYSTEM_VERSION.length > 0);
});

test("test_plugin_registry_constructor_starts_empty", () => {
  const registry = new PluginRegistry();
  assert.deepEqual(registry.listPlugins(), []);
  assert.deepEqual(registry.getCategories(), []);
});

test("test_plugin_registry_validate_plugin_accepts_valid_plugin", () => {
  const result = new PluginRegistry().validatePlugin(pluginFactory());
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test("test_plugin_registry_validate_plugin_rejects_missing_id", () => {
  const result = new PluginRegistry().validatePlugin(pluginFactory({ id: "" }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("id")));
});

test("test_plugin_registry_validate_plugin_rejects_non_object", () => {
  const result = new PluginRegistry().validatePlugin(null);
  assert.equal(result.valid, false);
  assert.equal(result.errors[0], "plugin must be an object");
});

test("test_plugin_registry_validate_plugin_rejects_bad_permissions", () => {
  const result = new PluginRegistry().validatePlugin(pluginFactory({ permissions: "timeline:edit" }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("permissions")));
});

test("test_plugin_registry_validate_plugin_rejects_bad_dependencies", () => {
  const result = new PluginRegistry().validatePlugin(pluginFactory({ dependencies: "plugin.base" }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("dependencies")));
});

test("test_plugin_registry_register_returns_plugin_record", () => {
  const registry = new PluginRegistry();
  const record = registry.register(pluginFactory());
  assert.equal(record.id, "plugin.base");
  assert.equal(record.status, "disabled");
  assert.equal(record.installed, true);
});

test("test_plugin_registry_register_rejects_duplicate", () => {
  const registry = new PluginRegistry();
  registry.register(pluginFactory());
  assert.throws(() => registry.register(pluginFactory()), /already registered/);
});

test("test_plugin_registry_get_plugin_returns_record", () => {
  const registry = new PluginRegistry();
  registry.register(pluginFactory());
  const record = registry.getPlugin("plugin.base");
  assert.equal(record.name, "Base Plugin");
});

test("test_plugin_registry_get_plugin_throws_when_missing", () => {
  assert.throws(() => new PluginRegistry().getPlugin("missing"), /not found/);
});

test("test_plugin_registry_list_plugins_filters_by_category", () => {
  const registry = new PluginRegistry();
  registry.register(pluginFactory({ id: "plugin.a", category: "effects" }));
  registry.register(pluginFactory({ id: "plugin.b", category: "audio" }));
  assert.equal(registry.listPlugins({ category: "effects" }).length, 1);
});

test("test_plugin_registry_list_plugins_filters_by_author", () => {
  const registry = new PluginRegistry();
  registry.register(pluginFactory({ author: "Alice" }));
  registry.register(pluginFactory({ id: "plugin.other", author: "Bob" }));
  assert.equal(registry.listPlugins({ author: "Alice" }).length, 1);
});

test("test_plugin_registry_list_plugins_sorts_by_name", () => {
  const registry = new PluginRegistry();
  registry.register(pluginFactory({ id: "plugin.b", name: "Zeta" }));
  registry.register(pluginFactory({ id: "plugin.a", name: "Alpha" }));
  assert.deepEqual(registry.listPlugins({ sort_by: "name" }).map((plugin) => plugin.name), ["Alpha", "Zeta"]);
});

test("test_plugin_registry_enable_changes_status", () => {
  const registry = new PluginRegistry();
  registry.register(pluginFactory());
  const record = registry.enable("plugin.base");
  assert.equal(record.status, "enabled");
  assert.equal(record.enabled, true);
});

test("test_plugin_registry_disable_changes_status", () => {
  const registry = new PluginRegistry();
  registry.register(pluginFactory());
  registry.enable("plugin.base");
  const record = registry.disable("plugin.base");
  assert.equal(record.status, "disabled");
  assert.equal(record.enabled, false);
});

test("test_plugin_registry_uninstall_removes_plugin", () => {
  const registry = new PluginRegistry();
  registry.register(pluginFactory());
  registry.uninstall("plugin.base");
  assert.throws(() => registry.getPlugin("plugin.base"), /not found/);
});

test("test_plugin_registry_search_finds_matching_plugin", () => {
  const registry = new PluginRegistry();
  registry.register(pluginFactory({ description: "Adds captions" }));
  assert.equal(registry.search("captions").length, 1);
});

test("test_plugin_registry_get_categories_returns_unique_sorted_categories", () => {
  const registry = new PluginRegistry();
  registry.register(pluginFactory({ id: "plugin.a", category: "beta" }));
  registry.register(pluginFactory({ id: "plugin.b", category: "alpha" }));
  assert.deepEqual(registry.getCategories(), ["alpha", "beta"]);
});

test("test_plugin_registry_dependency_graph_includes_nodes_edges_adjacency", () => {
  const registry = new PluginRegistry();
  registry.register(pluginFactory({ id: "plugin.base" }));
  registry.register(pluginFactory({ id: "plugin.child", dependencies: ["plugin.base"] }));
  const graph = registry.getDependencyGraph();
  assert.equal(graph.nodes.length, 2);
  assert.equal(graph.edges.length, 1);
  assert.deepEqual(graph.adjacency["plugin.child"], ["plugin.base"]);
});

// ---------- PluginManager ----------

test("test_plugin_manager_install_valid_plugin", () => {
  const registry = new PluginRegistry();
  const manager = new PluginManager({ registry });
  const result = manager.install(pluginFactory());
  assert.equal(result.installed, true);
  assert.equal(result.dependenciesResolved, true);
});

test("test_plugin_manager_install_missing_dependencies", () => {
  const registry = new PluginRegistry();
  const manager = new PluginManager({ registry });
  const result = manager.install(pluginFactory({ dependencies: ["plugin.missing"] }));
  assert.equal(result.installed, false);
  assert.equal(result.status, "missing_dependencies");
});

test("test_plugin_manager_install_invalid_plugin", () => {
  const registry = new PluginRegistry();
  const manager = new PluginManager({ registry });
  const result = manager.install(pluginFactory({ id: "" }));
  assert.equal(result.installed, false);
  assert.equal(result.status, "validation_failed");
});

test("test_plugin_manager_load_function_entry_point", () => {
  const registry = new PluginRegistry();
  const manager = new PluginManager({ registry });
  registry.register(pluginFactory({ entry_point: ({ plugin }) => ({ name: plugin.name }) }));
  const loaded = manager.load("plugin.base");
  assert.equal(loaded.status, "loaded");
  assert.equal(loaded.exports.name, "Base Plugin");
});

test("test_plugin_manager_load_string_entry_point", () => {
  const registry = new PluginRegistry();
  const manager = new PluginManager({ registry });
  registry.register(pluginFactory({ entry_point: "plugins/base.js" }));
  const loaded = manager.load("plugin.base");
  assert.equal(loaded.exports.entryPoint, "plugins/base.js");
});

test("test_plugin_manager_unload_disables_plugin", () => {
  const registry = new PluginRegistry();
  const manager = new PluginManager({ registry });
  registry.register(pluginFactory());
  manager.load("plugin.base");
  manager.unload("plugin.base");
  assert.equal(manager.getPluginStatus("plugin.base").status, "disabled");
});

test("test_plugin_manager_reload_reloads_plugin", () => {
  const registry = new PluginRegistry();
  const manager = new PluginManager({ registry });
  let calls = 0;
  registry.register(pluginFactory({ entry_point: () => { calls += 1; return { calls }; } }));
  manager.load("plugin.base");
  manager.reload("plugin.base");
  assert.equal(calls, 2);
});

test("test_plugin_manager_get_loaded_plugins", () => {
  const registry = new PluginRegistry();
  const manager = new PluginManager({ registry });
  registry.register(pluginFactory());
  manager.load("plugin.base");
  assert.equal(manager.getLoadedPlugins().length, 1);
});

test("test_plugin_manager_get_plugin_status", () => {
  const registry = new PluginRegistry();
  const manager = new PluginManager({ registry });
  registry.register(pluginFactory());
  manager.load("plugin.base");
  const status = manager.getPluginStatus("plugin.base");
  assert.equal(status.loaded, true);
  assert.equal(status.enabled, true);
});

test("test_plugin_manager_get_plugin_logs", () => {
  const registry = new PluginRegistry();
  const manager = new PluginManager({ registry });
  registry.register(pluginFactory());
  manager.load("plugin.base");
  assert.ok(manager.getPluginLogs("plugin.base").length >= 1);
});

test("test_plugin_manager_update_increments_patch_version", () => {
  const registry = new PluginRegistry();
  const manager = new PluginManager({ registry });
  registry.register(pluginFactory({ version: "1.0.0" }));
  const result = manager.update("plugin.base");
  assert.equal(result.from, "1.0.0");
  assert.equal(result.to, "1.0.1");
});

test("test_plugin_manager_install_existing_plugin_updates_record", () => {
  const registry = new PluginRegistry();
  const manager = new PluginManager({ registry });
  registry.register(pluginFactory({ version: "1.0.0" }));
  const result = manager.install(pluginFactory({ version: "1.1.0" }));
  assert.equal(result.installed, true);
  assert.equal(result.record.version, "1.1.0");
});

test("test_plugin_manager_load_missing_plugin_throws", () => {
  assert.throws(() => new PluginManager().load("missing"), /not found/);
});

test("test_plugin_manager_unload_missing_plugin_throws", () => {
  assert.throws(() => new PluginManager().unload("missing"), /not found/);
});

test("test_plugin_manager_install_tracks_analytics_when_available", () => {
  const analytics = { trackInstall: (pluginId, userId) => ({ pluginId, userId }) };
  const registry = new PluginRegistry();
  const manager = new PluginManager({ registry, analytics });
  manager.install(pluginFactory());
  assert.equal(analytics.trackInstall("plugin.base", "system").pluginId, "plugin.base");
});

// ---------- PluginAPI ----------

test("test_plugin_api_create_timeline", () => {
  const api = new PluginAPI(new PluginManager());
  const timeline = api.createTimeline("project-1");
  assert.equal(timeline.projectId, "project-1");
  assert.equal(timeline.clips.length, 0);
});

test("test_plugin_api_create_timeline_requires_project_id", () => {
  assert.throws(() => new PluginAPI(new PluginManager()).createTimeline(), /projectId/);
});

test("test_plugin_api_add_clip", () => {
  const api = new PluginAPI(new PluginManager());
  const timeline = api.createTimeline("project-1");
  const clip = api.addClip(timeline.id, { source: "asset-1", start_ms: 0, end_ms: 1000 });
  assert.equal(clip.source, "asset-1");
  assert.equal(clip.end_ms, 1000);
});

test("test_plugin_api_remove_clip", () => {
  const api = new PluginAPI(new PluginManager());
  const timeline = api.createTimeline("project-1");
  const clip = api.addClip(timeline.id, { source: "asset-1" });
  const removed = api.removeClip(timeline.id, clip.id);
  assert.equal(removed.id, clip.id);
  assert.equal(api.getTimeline(timeline.id).clips.length, 0);
});

test("test_plugin_api_move_clip", () => {
  const api = new PluginAPI(new PluginManager());
  const timeline = api.createTimeline("project-1");
  const clip = api.addClip(timeline.id, { source: "asset-1" });
  const moved = api.moveClip(timeline.id, clip.id, 2500);
  assert.equal(moved.position_ms, 2500);
});

test("test_plugin_api_split_clip", () => {
  const api = new PluginAPI(new PluginManager());
  const timeline = api.createTimeline("project-1");
  const clip = api.addClip(timeline.id, { source: "asset-1", start_ms: 0, end_ms: 1000 });
  const split = api.splitClip(timeline.id, clip.id, 500);
  assert.equal(split.left.end_ms, 500);
  assert.equal(split.right.start_ms, 500);
});

test("test_plugin_api_trim_clip", () => {
  const api = new PluginAPI(new PluginManager());
  const timeline = api.createTimeline("project-1");
  const clip = api.addClip(timeline.id, { source: "asset-1", start_ms: 0, end_ms: 1000 });
  const trimmed = api.trimClip(timeline.id, clip.id, 100, 800);
  assert.equal(trimmed.start_ms, 100);
  assert.equal(trimmed.end_ms, 800);
});

test("test_plugin_api_add_effect", () => {
  const api = new PluginAPI(new PluginManager());
  const timeline = api.createTimeline("project-1");
  const clip = api.addClip(timeline.id, { source: "asset-1" });
  const effect = api.addEffect(timeline.id, clip.id, { effectId: "blur", params: { amount: 5 } });
  assert.equal(effect.effectId, "blur");
  assert.equal(effect.params.amount, 5);
});

test("test_plugin_api_remove_effect", () => {
  const api = new PluginAPI(new PluginManager());
  const timeline = api.createTimeline("project-1");
  const clip = api.addClip(timeline.id, { source: "asset-1" });
  const effect = api.addEffect(timeline.id, clip.id, { effectId: "blur" });
  const removed = api.removeEffect(timeline.id, effect.id);
  assert.equal(removed.id, effect.id);
  assert.equal(api.getTimeline(timeline.id).effects.length, 0);
});

test("test_plugin_api_get_timeline", () => {
  const api = new PluginAPI(new PluginManager());
  const timeline = api.createTimeline("project-1");
  assert.equal(api.getTimeline(timeline.id).projectId, "project-1");
});

test("test_plugin_api_export_timeline_json", () => {
  const api = new PluginAPI(new PluginManager());
  const timeline = api.createTimeline("project-1");
  const exported = api.exportTimeline(timeline.id, "json");
  assert.equal(exported.format, "json");
  assert.equal(exported.data.id, timeline.id);
});

test("test_plugin_api_export_timeline_non_json", () => {
  const api = new PluginAPI(new PluginManager());
  const timeline = api.createTimeline("project-1");
  const exported = api.exportTimeline(timeline.id, "mp4");
  assert.equal(exported.format, "mp4");
  assert.equal(exported.mimeType, "application/octet-stream");
});

test("test_plugin_api_missing_timeline_throws", () => {
  assert.throws(() => new PluginAPI(new PluginManager()).getTimeline("missing"), /not found/);
});

test("test_plugin_api_add_invalid_clip_throws", () => {
  const api = new PluginAPI(new PluginManager());
  const timeline = api.createTimeline("project-1");
  assert.throws(() => api.addClip(timeline.id, null), /clip must be an object/);
});

test("test_plugin_api_split_invalid_range_throws", () => {
  const api = new PluginAPI(new PluginManager());
  const timeline = api.createTimeline("project-1");
  const clip = api.addClip(timeline.id, { source: "asset-1", start_ms: 0, end_ms: 1000 });
  assert.throws(() => api.splitClip(timeline.id, clip.id, 1500), /inside the clip range/);
});

test("test_plugin_api_history_records_actions", () => {
  const api = new PluginAPI(new PluginManager());
  const timeline = api.createTimeline("project-1");
  assert.ok(api.getHistory().some((entry) => entry.action === "createTimeline"));
});

// ---------- EffectSystem ----------

test("test_effect_system_register_effect", () => {
  const system = new EffectSystem();
  const effect = system.registerEffect(effectFactory());
  assert.equal(effect.id, "effect.blur");
  assert.equal(effect.category, "visual");
});

test("test_effect_system_get_effect", () => {
  const system = new EffectSystem();
  system.registerEffect(effectFactory());
  assert.equal(system.getEffect("effect.blur").name, "Blur");
});

test("test_effect_system_list_effects_category", () => {
  const system = new EffectSystem();
  system.registerEffect(effectFactory({ category: "audio" }));
  system.registerEffect(effectFactory({ id: "effect.two", category: "visual" }));
  assert.equal(system.listEffects({ category: "audio" }).length, 1);
});

test("test_effect_system_list_effects_sorts_by_name", () => {
  const system = new EffectSystem();
  system.registerEffect(effectFactory({ id: "effect.z", name: "Zeta" }));
  system.registerEffect(effectFactory({ id: "effect.a", name: "Alpha" }));
  assert.deepEqual(system.listEffects({ sort_by: "name" }).map((effect) => effect.name), ["Alpha", "Zeta"]);
});

test("test_effect_system_apply_effect", () => {
  const system = new EffectSystem();
  system.registerEffect(effectFactory());
  const instance = system.applyEffect("timeline-1", "clip-1", "effect.blur", { amount: 20 });
  assert.equal(instance.effectId, "effect.blur");
  assert.equal(instance.params.amount, 20);
});

test("test_effect_system_apply_effect_merges_defaults", () => {
  const system = new EffectSystem();
  system.registerEffect(effectFactory({ defaults: { amount: 5, radius: 10 } }));
  const instance = system.applyEffect("timeline-1", "clip-1", "effect.blur", { radius: 20 });
  assert.equal(instance.params.amount, 5);
  assert.equal(instance.params.radius, 20);
});

test("test_effect_system_remove_effect", () => {
  const system = new EffectSystem();
  system.registerEffect(effectFactory());
  const instance = system.applyEffect("timeline-1", "clip-1", "effect.blur");
  const removed = system.removeEffect(instance.id);
  assert.equal(removed.id, instance.id);
  assert.equal(system.getEffectInstances("clip-1").length, 0);
});

test("test_effect_system_get_effect_instances_by_clip", () => {
  const system = new EffectSystem();
  system.registerEffect(effectFactory());
  system.applyEffect("timeline-1", "clip-a", "effect.blur");
  system.applyEffect("timeline-1", "clip-b", "effect.blur");
  assert.equal(system.getEffectInstances("clip-a").length, 1);
});

test("test_effect_system_create_preset", () => {
  const system = new EffectSystem();
  system.registerEffect(effectFactory({ id: "effect.blur" }));
  system.registerEffect(effectFactory({ id: "effect.sharpen" }));
  const preset = system.createPreset("Sharp Blur", ["effect.blur", "effect.sharpen"]);
  assert.equal(preset.effectIds.length, 2);
});

test("test_effect_system_create_preset_missing_effect_throws", () => {
  assert.throws(() => new EffectSystem().createPreset("Bad", ["missing"]), /Effect not found/);
});

test("test_effect_system_missing_effect_throws", () => {
  assert.throws(() => new EffectSystem().getEffect("missing"), /not found/);
});

test("test_effect_system_apply_missing_effect_throws", () => {
  assert.throws(() => new EffectSystem().applyEffect("timeline", "clip", "missing"), /Effect not found/);
});

// ---------- TransitionSystem ----------

test("test_transition_system_register_transition", () => {
  const system = new TransitionSystem();
  const transition = system.registerTransition(transitionFactory());
  assert.equal(transition.id, "transition.fade");
});

test("test_transition_system_get_transition", () => {
  const system = new TransitionSystem();
  system.registerTransition(transitionFactory());
  assert.equal(system.getTransition("transition.fade").name, "Fade");
});

test("test_transition_system_list_transitions", () => {
  const system = new TransitionSystem();
  system.registerTransition(transitionFactory());
  assert.equal(system.listTransitions().length, 1);
});

test("test_transition_system_add_transition", () => {
  const system = new TransitionSystem();
  system.registerTransition(transitionFactory());
  const instance = system.addTransition("timeline-1", "clip-1", "transition.fade", 500);
  assert.equal(instance.duration_ms, 500);
});

test("test_transition_system_remove_transition", () => {
  const system = new TransitionSystem();
  system.registerTransition(transitionFactory());
  const instance = system.addTransition("timeline-1", "clip-1", "transition.fade", 500);
  const removed = system.removeTransition(instance.id);
  assert.equal(removed.id, instance.id);
  assert.equal(system.getTransitions("timeline-1").length, 0);
});

test("test_transition_system_get_transitions_by_timeline", () => {
  const system = new TransitionSystem();
  system.registerTransition(transitionFactory());
  system.addTransition("timeline-a", "clip-1", "transition.fade", 100);
  system.addTransition("timeline-b", "clip-1", "transition.fade", 200);
  assert.equal(system.getTransitions("timeline-a").length, 1);
});

test("test_transition_system_create_preset", () => {
  const system = new TransitionSystem();
  system.registerTransition(transitionFactory({ id: "transition.fade" }));
  system.registerTransition(transitionFactory({ id: "transition.wipe" }));
  const preset = system.createPreset("Fade Wipe", ["transition.fade", "transition.wipe"]);
  assert.equal(preset.transitionIds.length, 2);
});

test("test_transition_system_create_preset_missing_transition_throws", () => {
  assert.throws(() => new TransitionSystem().createPreset("Bad", ["missing"]), /Transition not found/);
});

test("test_transition_system_missing_transition_throws", () => {
  assert.throws(() => new TransitionSystem().getTransition("missing"), /not found/);
});

test("test_transition_system_add_missing_transition_throws", () => {
  assert.throws(() => new TransitionSystem().addTransition("timeline", "clip", "missing", 100), /Transition not found/);
});

// ---------- ToolRegistry ----------

test("test_tool_registry_register_tool", () => {
  const registry = new ToolRegistry();
  const tool = registry.registerTool(toolFactory());
  assert.equal(tool.id, "tool.echo");
});

test("test_tool_registry_execute_sync_tool", () => {
  const registry = new ToolRegistry();
  registry.registerTool(toolFactory());
  const result = registry.execute("tool.echo", { value: 1 });
  assert.equal(result.ok, true);
  assert.equal(result.result.params.value, 1);
});

test("test_tool_registry_execute_async_tool", async () => {
  const registry = new ToolRegistry();
  registry.registerTool(toolFactory({ handler: async (params) => ({ value: params.value + 1 }) }));
  const result = await registry.execute("tool.echo", { value: 1 });
  assert.equal(result.result.value, 2);
});

test("test_tool_registry_execute_error", () => {
  const registry = new ToolRegistry();
  registry.registerTool(toolFactory({ handler: () => { throw new Error("boom"); } }));
  const result = registry.execute("tool.echo", {});
  assert.equal(result.ok, false);
  assert.equal(result.error, "boom");
});

test("test_tool_registry_get_tool_history", () => {
  const registry = new ToolRegistry();
  registry.registerTool(toolFactory());
  registry.execute("tool.echo", { value: 1 });
  assert.equal(registry.getToolHistory().length, 1);
});

test("test_tool_registry_list_tools_by_category", () => {
  const registry = new ToolRegistry();
  registry.registerTool(toolFactory({ category: "alpha" }));
  registry.registerTool(toolFactory({ id: "tool.two", category: "beta" }));
  assert.equal(registry.listTools({ category: "alpha" }).length, 1);
});

test("test_tool_registry_get_tool_categories", () => {
  const registry = new ToolRegistry();
  registry.registerTool(toolFactory({ category: "alpha" }));
  registry.registerTool(toolFactory({ id: "tool.two", category: "beta" }));
  assert.deepEqual(registry.getToolCategories(), ["alpha", "beta"]);
});

test("test_tool_registry_execute_missing_tool_throws", () => {
  assert.throws(() => new ToolRegistry().execute("missing", {}), /not found/);
});

test("test_tool_registry_execute_tool_without_handler_throws", () => {
  const registry = new ToolRegistry();
  registry.registerTool(toolFactory({ handler: null }));
  assert.throws(() => registry.execute("tool.echo", {}), /has no handler/);
});

// ---------- MarketplacePlugin ----------

test("test_marketplace_plugin_list_plugins", () => {
  const marketplace = new MarketplacePlugin();
  assert.ok(marketplace.listPlugins().length >= 4);
});

test("test_marketplace_plugin_list_plugins_by_category", () => {
  const marketplace = new MarketplacePlugin();
  assert.ok(marketplace.listPlugins({ category: "effects" }).length >= 1);
});

test("test_marketplace_plugin_free_only", () => {
  const marketplace = new MarketplacePlugin();
  const plugins = marketplace.listPlugins({ free_only: true });
  assert.ok(plugins.every((plugin) => plugin.price === 0));
});

test("test_marketplace_plugin_get_plugin", () => {
  const marketplace = new MarketplacePlugin();
  assert.equal(marketplace.getPlugin("vireo.color-grade").name, "Cinematic Color Grade");
});

test("test_marketplace_plugin_install_plugin", () => {
  const marketplace = new MarketplacePlugin();
  const result = marketplace.installPlugin("vireo.color-grade");
  assert.equal(result.installed, true);
});

test("test_marketplace_plugin_install_missing_dependency_plugin", () => {
  const marketplace = new MarketplacePlugin();
  const result = marketplace.installPlugin("community.trim-assistant");
  assert.equal(result.installed, false);
  assert.equal(result.status, "missing_dependencies");
});

test("test_marketplace_plugin_get_reviews", () => {
  const marketplace = new MarketplacePlugin();
  assert.ok(marketplace.getReviews("vireo.color-grade").length >= 1);
});

test("test_marketplace_plugin_get_plugin_stats", () => {
  const marketplace = new MarketplacePlugin();
  assert.ok(marketplace.getPluginStats("vireo.color-grade").installs > 0);
});

test("test_marketplace_plugin_get_featured", () => {
  const marketplace = new MarketplacePlugin();
  assert.equal(marketplace.getFeatured(1)[0].id, "vireo.color-grade");
});

test("test_marketplace_plugin_get_new_arrivals", () => {
  const marketplace = new MarketplacePlugin();
  assert.equal(marketplace.getNewArrivals(1)[0].id, "community.trim-assistant");
});

test("test_marketplace_plugin_get_best_sellers", () => {
  const marketplace = new MarketplacePlugin();
  assert.equal(marketplace.getBestSellers(1)[0].id, "creator.sound-sync");
});

// ---------- PermissionSystem ----------

test("test_permission_system_request_permission", () => {
  const system = new PermissionSystem();
  const request = system.requestPermission("plugin.base", "timeline:edit");
  assert.equal(request.status, "pending");
  assert.equal(request.category, "timeline");
});

test("test_permission_system_grant_permission", () => {
  const system = new PermissionSystem();
  const grant = system.grantPermission("plugin.base", "timeline:edit");
  assert.equal(grant.granted, true);
});

test("test_permission_system_revoke_permission", () => {
  const system = new PermissionSystem();
  system.grantPermission("plugin.base", "timeline:edit");
  const revoke = system.revokePermission("plugin.base", "timeline:edit");
  assert.equal(revoke.revoked, true);
});

test("test_permission_system_get_permissions", () => {
  const system = new PermissionSystem();
  system.grantPermission("plugin.base", "timeline:edit");
  assert.deepEqual(system.getPermissions("plugin.base"), ["timeline:edit"]);
});

test("test_permission_system_check_permission", () => {
  const system = new PermissionSystem();
  system.grantPermission("plugin.base", "timeline:edit");
  assert.equal(system.checkPermission("plugin.base", "timeline:edit"), true);
});

test("test_permission_system_check_missing_permission", () => {
  const system = new PermissionSystem();
  assert.equal(system.checkPermission("plugin.base", "missing"), false);
});

test("test_permission_system_get_permission_categories", () => {
  const system = new PermissionSystem();
  assert.ok(system.getPermissionCategories().includes("timeline"));
});

test("test_permission_system_get_permission_history", () => {
  const system = new PermissionSystem();
  system.grantPermission("plugin.base", "timeline:edit");
  assert.equal(system.getPermissionHistory("plugin.base").length, 1);
});

// ---------- SandboxRuntime ----------

test("test_sandbox_runtime_create_sandbox", () => {
  const runtime = new SandboxRuntime();
  const sandbox = runtime.createSandbox("plugin.base");
  assert.equal(sandbox.status, "running");
});

test("test_sandbox_runtime_execute_safe_code", async () => {
  const runtime = new SandboxRuntime();
  const sandbox = runtime.createSandbox("plugin.base");
  const result = await runtime.executeInSandbox(sandbox.id, "return 1 + 1;");
  assert.equal(result.ok, true);
  assert.equal(result.result, 2);
});

test("test_sandbox_runtime_execute_code_with_api", async () => {
  const runtime = new SandboxRuntime();
  const sandbox = runtime.createSandbox("plugin.base");
  const result = await runtime.executeInSandbox(sandbox.id, "return api.sandboxId;");
  assert.equal(result.result, sandbox.id);
});

test("test_sandbox_runtime_execute_async_code", async () => {
  const runtime = new SandboxRuntime();
  const sandbox = runtime.createSandbox("plugin.base");
  const result = await runtime.executeInSandbox(sandbox.id, "return await Promise.resolve(42);");
  assert.equal(result.result, 42);
});

test("test_sandbox_runtime_blocks_unsafe_code", async () => {
  const runtime = new SandboxRuntime();
  const sandbox = runtime.createSandbox("plugin.base");
  const result = await runtime.executeInSandbox(sandbox.id, "eval('1+1');");
  assert.equal(result.ok, false);
  assert.match(result.error, /Blocked unsafe/);
});

test("test_sandbox_runtime_terminate_sandbox", () => {
  const runtime = new SandboxRuntime();
  const sandbox = runtime.createSandbox("plugin.base");
  const terminated = runtime.terminateSandbox(sandbox.id);
  assert.equal(terminated.status, "terminated");
});

test("test_sandbox_runtime_status_after_terminate", () => {
  const runtime = new SandboxRuntime();
  const sandbox = runtime.createSandbox("plugin.base");
  runtime.terminateSandbox(sandbox.id);
  assert.equal(runtime.getSandboxStatus(sandbox.id).status, "terminated");
});

test("test_sandbox_runtime_memory_usage", async () => {
  const runtime = new SandboxRuntime();
  const sandbox = runtime.createSandbox("plugin.base");
  await runtime.executeInSandbox(sandbox.id, "return 'x'.repeat(100);");
  assert.ok(runtime.getMemoryUsage(sandbox.id).rss > 0);
});

test("test_sandbox_runtime_cpu_usage", async () => {
  const runtime = new SandboxRuntime();
  const sandbox = runtime.createSandbox("plugin.base");
  await runtime.executeInSandbox(sandbox.id, "return 123;");
  assert.ok("percent" in runtime.getCpuUsage(sandbox.id));
});

test("test_sandbox_runtime_missing_sandbox_throws", () => {
  assert.throws(() => new SandboxRuntime().getSandboxStatus("missing"), /not found/);
});

// ---------- PluginAnalytics ----------

test("test_plugin_analytics_track_install", () => {
  const analytics = new PluginAnalytics();
  analytics.trackInstall("plugin.base", "user-1");
  assert.equal(analytics.getPluginStats("plugin.base").installs, 1);
});

test("test_plugin_analytics_track_uninstall", () => {
  const analytics = new PluginAnalytics();
  analytics.trackInstall("plugin.base", "user-1");
  analytics.trackUninstall("plugin.base", "user-1");
  assert.equal(analytics.getPluginStats("plugin.base").installs, 0);
});

test("test_plugin_analytics_track_usage", () => {
  const analytics = new PluginAnalytics();
  analytics.trackUsage("plugin.base", "render", 1000);
  analytics.trackUsage("plugin.base", "render", 3000);
  const stats = analytics.getPluginStats("plugin.base");
  assert.equal(stats.usageCount, 2);
  assert.equal(stats.averageDurationMs, 2000);
});

test("test_plugin_analytics_get_most_installed", () => {
  const analytics = new PluginAnalytics();
  analytics.trackInstall("plugin.a", "u1");
  analytics.trackInstall("plugin.a", "u2");
  analytics.trackInstall("plugin.b", "u3");
  assert.equal(analytics.getMostInstalled(1)[0].pluginId, "plugin.a");
});

test("test_plugin_analytics_get_most_used", () => {
  const analytics = new PluginAnalytics();
  analytics.trackUsage("plugin.a", "render", 1);
  analytics.trackUsage("plugin.a", "render", 1);
  analytics.trackUsage("plugin.b", "render", 1);
  assert.equal(analytics.getMostUsed(1)[0].pluginId, "plugin.a");
});

test("test_plugin_analytics_get_trending", () => {
  const analytics = new PluginAnalytics();
  analytics.trackUsage("plugin.a", "render", 1);
  analytics.trackUsage("plugin.b", "render", 1);
  assert.equal(analytics.getTrending(1)[0].pluginId, "plugin.a");
});

test("test_plugin_analytics_get_user_history", () => {
  const analytics = new PluginAnalytics();
  analytics.trackInstall("plugin.base", "user-1");
  const history = analytics.getUserHistory("user-1");
  assert.equal(history.length, 1);
  assert.equal(history[0].action, "install");
});

test("test_plugin_analytics_get_developer_stats", () => {
  const analytics = new PluginAnalytics();
  analytics.trackInstall("plugin.base", "dev-1");
  const stats = analytics.getDeveloperStats("dev-1");
  assert.equal(stats.installs, 1);
});

test("test_plugin_analytics_empty_plugin_stats", () => {
  const analytics = new PluginAnalytics();
  const stats = analytics.getPluginStats("missing");
  assert.equal(stats.installs, 0);
  assert.equal(stats.usageCount, 0);
});

test("test_plugin_analytics_empty_developer_stats", () => {
  const analytics = new PluginAnalytics();
  const stats = analytics.getDeveloperStats("missing");
  assert.equal(stats.developerId, "missing");
  assert.equal(stats.plugins, 0);
});
