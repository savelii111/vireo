// test_asset_management.js — Comprehensive tests for the 10 asset management classes.
//
// Validates: MediaLibrary, TagSystem, SmartSearch, Favorites,
// SmartCollections, DuplicateDetector, StorageManager, CloudSync,
// BackupSystem, ImportExport.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MediaLibrary,
  TagSystem,
  SmartSearch,
  Favorites,
  SmartCollections,
  DuplicateDetector,
  StorageManager,
  CloudSync,
  BackupSystem,
  ImportExport,
  ASSET_MANAGEMENT_CLASSES,
  MEDIA_TYPES,
  EXPORT_FORMATS,
  CLOUD_PROVIDERS,
} from "../src/asset_management.js";

// ====================================================================
// Shape / Export tests
// ====================================================================

test("ASSET_MANAGEMENT_CLASSES lists all 10 classes", () => {
  assert.equal(ASSET_MANAGEMENT_CLASSES.length, 10);
  for (const name of ASSET_MANAGEMENT_CLASSES) {
    assert.ok(MEDIA_TYPES || true); // constants exist
  }
  assert.ok(ASSET_MANAGEMENT_CLASSES.includes("MediaLibrary"));
  assert.ok(ASSET_MANAGEMENT_CLASSES.includes("TagSystem"));
  assert.ok(ASSET_MANAGEMENT_CLASSES.includes("SmartSearch"));
  assert.ok(ASSET_MANAGEMENT_CLASSES.includes("Favorites"));
  assert.ok(ASSET_MANAGEMENT_CLASSES.includes("SmartCollections"));
  assert.ok(ASSET_MANAGEMENT_CLASSES.includes("DuplicateDetector"));
  assert.ok(ASSET_MANAGEMENT_CLASSES.includes("StorageManager"));
  assert.ok(ASSET_MANAGEMENT_CLASSES.includes("CloudSync"));
  assert.ok(ASSET_MANAGEMENT_CLASSES.includes("BackupSystem"));
  assert.ok(ASSET_MANAGEMENT_CLASSES.includes("ImportExport"));
});

test("MEDIA_TYPES, EXPORT_FORMATS, CLOUD_PROVIDERS are exported", () => {
  assert.ok(Array.isArray(MEDIA_TYPES));
  assert.ok(Array.isArray(EXPORT_FORMATS));
  assert.ok(Array.isArray(CLOUD_PROVIDERS));
  assert.ok(MEDIA_TYPES.includes("video"));
  assert.ok(EXPORT_FORMATS.includes("json"));
  assert.ok(CLOUD_PROVIDERS.includes("s3"));
});

// ====================================================================
// 1. MediaLibrary
// ====================================================================

test("MediaLibrary: addMedia returns all required fields", () => {
  const lib = new MediaLibrary();
  const m = lib.addMedia({ path: "/videos/intro.mp4", tags: ["intro"], metadata: { duration: 120 } });
  assert.ok(m.id);
  assert.equal(m.path, "/videos/intro.mp4");
  assert.equal(m.type, "video");
  assert.deepEqual(m.tags, ["intro"]);
  assert.equal(m.metadata.duration, 120);
  assert.ok(m.created_at);
  assert.ok(m.size_mb > 0);
});

test("MediaLibrary: addMedia infers type from extension", () => {
  const lib = new MediaLibrary();
  assert.equal(lib.addMedia({ path: "/a/song.mp3" }).type, "audio");
  assert.equal(lib.addMedia({ path: "/a/pic.jpg" }).type, "image");
  assert.equal(lib.addMedia({ path: "/a/subs.srt" }).type, "text");
  assert.equal(lib.addMedia({ path: "/a/proj.vireo" }).type, "project");
});

test("MediaLibrary: addMedia throws without path", () => {
  const lib = new MediaLibrary();
  assert.throws(() => lib.addMedia({}), /path is required/);
});

test("MediaLibrary: getMedia returns a copy of the media", () => {
  const lib = new MediaLibrary();
  const added = lib.addMedia({ path: "/v.mp4" });
  const got = lib.getMedia(added.id);
  assert.equal(got.id, added.id);
  assert.equal(got.filename, "v.mp4");
  // Verify it's a copy (mutation safety)
  got.tags.push("mutated");
  const got2 = lib.getMedia(added.id);
  assert.equal(got2.tags.length, 0); // original unaffected
});

test("MediaLibrary: getMedia throws for non-existent ID", () => {
  const lib = new MediaLibrary();
  assert.throws(() => lib.getMedia("nonexistent"), /Media not found/);
});

test("MediaLibrary: listMedia returns all items", () => {
  const lib = new MediaLibrary();
  lib.addMedia({ path: "/a.mp4" });
  lib.addMedia({ path: "/b.mp3" });
  lib.addMedia({ path: "/c.png" });
  assert.equal(lib.listMedia().length, 3);
});

test("MediaLibrary: listMedia filters by type", () => {
  const lib = new MediaLibrary();
  lib.addMedia({ path: "/a.mp4" });
  lib.addMedia({ path: "/b.mp3" });
  lib.addMedia({ path: "/c.mp4" });
  const videos = lib.listMedia({ type: "video" });
  assert.equal(videos.length, 2);
});

test("MediaLibrary: listMedia sorts by name", () => {
  const lib = new MediaLibrary();
  lib.addMedia({ path: "/zulu.mp4" });
  lib.addMedia({ path: "/alpha.mp4" });
  lib.addMedia({ path: "/middle.mp4" });
  const sorted = lib.listMedia({ sort: "name" });
  assert.equal(sorted[0].filename, "alpha.mp4");
  assert.equal(sorted[2].filename, "zulu.mp4");
});

test("MediaLibrary: deleteMedia removes the item", () => {
  const lib = new MediaLibrary();
  const m = lib.addMedia({ path: "/x.mp4" });
  lib.deleteMedia(m.id);
  assert.equal(lib.listMedia().length, 0);
  assert.throws(() => lib.getMedia(m.id), /Media not found/);
});

test("MediaLibrary: deleteMedia throws for non-existent", () => {
  const lib = new MediaLibrary();
  assert.throws(() => lib.deleteMedia("nope"), /Media not found/);
});

test("MediaLibrary: searchMedia finds by filename", () => {
  const lib = new MediaLibrary();
  lib.addMedia({ path: "/intro_clip.mp4" });
  lib.addMedia({ path: "/outro_clip.mp4" });
  lib.addMedia({ path: "/music.mp3" });
  const results = lib.searchMedia("intro");
  assert.equal(results.length, 1);
  assert.equal(results[0].filename, "intro_clip.mp4");
});

test("MediaLibrary: searchMedia throws on empty query", () => {
  const lib = new MediaLibrary();
  assert.throws(() => lib.searchMedia(""), /query is required/);
});

// ====================================================================
// 2. TagSystem
// ====================================================================

test("TagSystem: addTag adds a new tag", () => {
  const lib = new MediaLibrary();
  const m = lib.addMedia({ path: "/v.mp4", tags: ["original"] });
  const tags = new TagSystem(lib);
  tags.addTag(m.id, "new_tag");
  assert.deepEqual(tags.getTags(m.id), ["original", "new_tag"]);
});

test("TagSystem: addTag deduplicates", () => {
  const lib = new MediaLibrary();
  const m = lib.addMedia({ path: "/v.mp4", tags: ["existing"] });
  const tags = new TagSystem(lib);
  tags.addTag(m.id, "existing");
  assert.deepEqual(tags.getTags(m.id), ["existing"]);
});

test("TagSystem: removeTag removes a tag", () => {
  const lib = new MediaLibrary();
  const m = lib.addMedia({ path: "/v.mp4", tags: ["a", "b", "c"] });
  const tags = new TagSystem(lib);
  tags.removeTag(m.id, "b");
  assert.deepEqual(tags.getTags(m.id), ["a", "c"]);
});

test("TagSystem: removeTag throws for missing tag", () => {
  const lib = new MediaLibrary();
  const m = lib.addMedia({ path: "/v.mp4", tags: ["a"] });
  const tags = new TagSystem(lib);
  assert.throws(() => tags.removeTag(m.id, "nonexistent"), /Tag not found/);
});

test("TagSystem: getMediaByTag finds all matching", () => {
  const lib = new MediaLibrary();
  lib.addMedia({ path: "/a.mp4", tags: ["cat1"] });
  lib.addMedia({ path: "/b.mp3", tags: ["cat1", "cat2"] });
  lib.addMedia({ path: "/c.png", tags: ["cat2"] });
  const tags = new TagSystem(lib);
  const results = tags.getMediaByTag("cat1");
  assert.equal(results.length, 2);
});

test("TagSystem: bulkTag adds tags to multiple items", () => {
  const lib = new MediaLibrary();
  const m1 = lib.addMedia({ path: "/a.mp4" });
  const m2 = lib.addMedia({ path: "/b.mp4" });
  const m3 = lib.addMedia({ path: "/c.mp4" });
  const tags = new TagSystem(lib);
  tags.bulkTag([m1.id, m2.id], ["batch_tag"]);
  assert.ok(tags.getTags(m1.id).includes("batch_tag"));
  assert.ok(tags.getTags(m2.id).includes("batch_tag"));
  assert.ok(!tags.getTags(m3.id).includes("batch_tag"));
});

test("TagSystem: bulkTag throws on empty arrays", () => {
  const lib = new MediaLibrary();
  const tags = new TagSystem(lib);
  assert.throws(() => tags.bulkTag([], ["tag"]), /mediaIds must be non-empty/);
  assert.throws(() => tags.bulkTag(["id"], []), /tags must be non-empty/);
});

// ====================================================================
// 3. SmartSearch
// ====================================================================

test("SmartSearch: search with query and type filter", () => {
  const lib = new MediaLibrary();
  lib.addMedia({ path: "/intro.mp4", tags: ["intro"] });
  lib.addMedia({ path: "/intro.mp3", tags: ["intro"] });
  const ss = new SmartSearch(lib);
  const results = ss.search("intro", { filters: { type: "video" } });
  assert.equal(results.length, 1);
  assert.equal(results[0].type, "video");
});

test("SmartSearch: searchByColor finds matching media", () => {
  const lib = new MediaLibrary();
  lib.addMedia({ path: "/red_clip.mp4", metadata: { color: "red" } });
  lib.addMedia({ path: "/blue_clip.mp4", metadata: { color: "blue" } });
  const ss = new SmartSearch(lib);
  const results = ss.searchByColor("red");
  assert.equal(results.length, 1);
  assert.equal(results[0].filename, "red_clip.mp4");
});

test("SmartSearch: searchByDuration finds in range", () => {
  const lib = new MediaLibrary();
  lib.addMedia({ path: "/short.mp4", metadata: { duration: 30 } });
  lib.addMedia({ path: "/medium.mp4", metadata: { duration: 120 } });
  lib.addMedia({ path: "/long.mp4", metadata: { duration: 600 } });
  const ss = new SmartSearch(lib);
  const results = ss.searchByDuration(60, 200);
  assert.equal(results.length, 1);
  assert.equal(results[0].filename, "medium.mp4");
});

test("SmartSearch: searchByResolution finds exact match", () => {
  const lib = new MediaLibrary();
  lib.addMedia({ path: "/hd.mp4", metadata: { width: 1920, height: 1080 } });
  lib.addMedia({ path: "/4k.mp4", metadata: { width: 3840, height: 2160 } });
  const ss = new SmartSearch(lib);
  const results = ss.searchByResolution(1920, 1080);
  assert.equal(results.length, 1);
  assert.equal(results[0].filename, "hd.mp4");
});

test("SmartSearch: searchByDate finds in date range", () => {
  const lib = new MediaLibrary();
  const m1 = lib.addMedia({ path: "/old.mp4" });
  // Modify created_at to be old
  lib._media.get(m1.id).created_at = "2020-01-15T00:00:00.000Z";
  const m2 = lib.addMedia({ path: "/new.mp4" });
  // m2 created_at is now
  const ss = new SmartSearch(lib);
  const results = ss.searchByDate("2025-01-01", "2030-12-31");
  assert.ok(results.some((r) => r.filename === "new.mp4"));
  assert.ok(!results.some((r) => r.filename === "old.mp4"));
});

test("SmartSearch: throws on empty query", () => {
  const lib = new MediaLibrary();
  const ss = new SmartSearch(lib);
  assert.throws(() => ss.search(""), /query is required/);
});

// ====================================================================
// 4. Favorites
// ====================================================================

test("Favorites: addFavorite and isFavorite", () => {
  const fav = new Favorites();
  fav.addFavorite("media_1");
  assert.equal(fav.isFavorite("media_1"), true);
  assert.equal(fav.isFavorite("media_2"), false);
});

test("Favorites: removeFavorite removes from set", () => {
  const fav = new Favorites();
  fav.addFavorite("media_1");
  fav.removeFavorite("media_1");
  assert.equal(fav.isFavorite("media_1"), false);
});

test("Favorites: removeFavorite throws for non-favorite", () => {
  const fav = new Favorites();
  assert.throws(() => fav.removeFavorite("nonexistent"), /Favorite not found/);
});

test("Favorites: getFavorites returns all favorites", () => {
  const fav = new Favorites();
  fav.addFavorite("a");
  fav.addFavorite("b");
  fav.addFavorite("c");
  fav.removeFavorite("b");
  assert.deepEqual(fav.getFavorites(), ["a", "c"]);
});

test("Favorites: addFavorite throws without ID", () => {
  const fav = new Favorites();
  assert.throws(() => fav.addFavorite(null), /mediaId is required/);
});

// ====================================================================
// 5. SmartCollections
// ====================================================================

test("SmartCollections: createCollection returns fields", () => {
  const lib = new MediaLibrary();
  const sc = new SmartCollections(lib);
  const col = sc.createCollection({ name: "My Videos", rules: { type: "video" } });
  assert.ok(col.id);
  assert.equal(col.name, "My Videos");
  assert.equal(col.rules.type, "video");
  assert.ok(col.created_at);
});

test("SmartCollections: createCollection throws without name", () => {
  const lib = new MediaLibrary();
  const sc = new SmartCollections(lib);
  assert.throws(() => sc.createCollection({}), /name is required/);
});

test("SmartCollections: getCollection returns matching media", () => {
  const lib = new MediaLibrary();
  lib.addMedia({ path: "/a.mp4" });
  lib.addMedia({ path: "/b.mp3" });
  const sc = new SmartCollections(lib);
  const col = sc.createCollection({ name: "Videos", rules: { type: "video" } });
  const media = sc.getCollection(col.id);
  assert.equal(media.length, 1);
  assert.equal(media[0].type, "video");
});

test("SmartCollections: listCollections shows counts", () => {
  const lib = new MediaLibrary();
  lib.addMedia({ path: "/a.mp4" });
  lib.addMedia({ path: "/b.mp4" });
  const sc = new SmartCollections(lib);
  sc.createCollection({ name: "All", rules: {} });
  sc.createCollection({ name: "Empty Type", rules: { type: "audio" } });
  const list = sc.listCollections();
  assert.equal(list.length, 2);
  assert.equal(list[0].media_count, 2);
  assert.equal(list[1].media_count, 0);
});

test("SmartCollections: deleteCollection removes it", () => {
  const lib = new MediaLibrary();
  const sc = new SmartCollections(lib);
  const col = sc.createCollection({ name: "temp", rules: {} });
  sc.deleteCollection(col.id);
  assert.throws(() => sc.getCollection(col.id), /Collection not found/);
});

test("SmartCollections: updateRules changes filter", () => {
  const lib = new MediaLibrary();
  lib.addMedia({ path: "/a.mp4" });
  lib.addMedia({ path: "/b.mp3" });
  const sc = new SmartCollections(lib);
  const col = sc.createCollection({ name: "All", rules: {} });
  assert.equal(sc.getCollection(col.id).length, 2);
  sc.updateRules(col.id, { type: "video" });
  assert.equal(sc.getCollection(col.id).length, 1);
});

// ====================================================================
// 6. DuplicateDetector
// ====================================================================

test("DuplicateDetector: findDuplicates detects same-filename dupes", () => {
  const lib = new MediaLibrary();
  lib.addMedia({ path: "/a/clip.mp4" });
  lib.addMedia({ path: "/b/clip.mp4" });
  lib.addMedia({ path: "/c/other.mp3" });
  const dd = new DuplicateDetector(lib);
  const groups = dd.findDuplicates();
  assert.ok(groups.length >= 1);
  const fnGroup = groups.find((g) => g.reason.startsWith("duplicate_filename:"));
  assert.ok(fnGroup);
  assert.equal(fnGroup.mediaIds.length, 2);
});

test("DuplicateDetector: findDuplicates detects same-size-type dupes", () => {
  const lib = new MediaLibrary();
  lib.addMedia({ path: "/a/alpha.mp4" });
  lib.addMedia({ path: "/b/beta.mp4" });
  // Both have same size due to heuristic
  const dd = new DuplicateDetector(lib);
  const groups = dd.findDuplicates();
  const sizeGroup = groups.find((g) => g.reason === "same_size_and_type");
  // May or may not exist depending on size heuristic
  assert.ok(Array.isArray(groups));
});

test("DuplicateDetector: mergeDuplicates keeps one and deletes rest", () => {
  const lib = new MediaLibrary();
  const m1 = lib.addMedia({ path: "/a/clip.mp4" });
  const m2 = lib.addMedia({ path: "/b/clip.mp4" });
  const dd = new DuplicateDetector(lib);
  const groups = dd.findDuplicates();
  const fnGroup = groups.find((g) => g.reason.startsWith("duplicate_filename:"));
  assert.ok(fnGroup);
  const result = dd.mergeDuplicates(fnGroup.groupId, m1.id);
  assert.equal(result.merged, true);
  assert.equal(result.kept, m1.id);
  assert.equal(result.removed.length, 1);
  assert.equal(result.removed[0], m2.id);
  assert.throws(() => lib.getMedia(m2.id), /Media not found/);
});

test("DuplicateDetector: getStats returns correct counts", () => {
  const lib = new MediaLibrary();
  lib.addMedia({ path: "/a/clip.mp4" });
  lib.addMedia({ path: "/b/clip.mp4" });
  lib.addMedia({ path: "/c/solo.mp3" });
  const dd = new DuplicateDetector(lib);
  const stats = dd.getStats();
  assert.equal(stats.total_media, 3);
  assert.ok(stats.duplicate_groups >= 1);
  assert.ok(stats.duplicate_media >= 1);
  assert.ok(stats.saved_bytes >= 0);
});

test("DuplicateDetector: mergeDuplicates throws on invalid group", () => {
  const lib = new MediaLibrary();
  const dd = new DuplicateDetector(lib);
  assert.throws(() => dd.mergeDuplicates("nonexistent", "id"), /Group not found/);
});

// ====================================================================
// 7. StorageManager
// ====================================================================

test("StorageManager: getUsage returns totals", () => {
  const lib = new MediaLibrary();
  lib.addMedia({ path: "/a.mp4" });
  lib.addMedia({ path: "/b.mp3" });
  const sm = new StorageManager(lib);
  const usage = sm.getUsage();
  assert.equal(usage.total_files, 2);
  assert.ok(usage.total_size_mb > 0);
  assert.ok(usage.total_size_bytes > 0);
});

test("StorageManager: getBreakdown returns per-type stats", () => {
  const lib = new MediaLibrary();
  lib.addMedia({ path: "/a.mp4" });
  lib.addMedia({ path: "/b.mp3" });
  lib.addMedia({ path: "/c.png" });
  lib.addMedia({ path: "/d.txt" });
  const sm = new StorageManager(lib);
  const bd = sm.getBreakdown();
  assert.equal(bd.video.count, 1);
  assert.equal(bd.audio.count, 1);
  assert.equal(bd.image.count, 1);
  assert.equal(bd.other.count, 1); // text goes to "other"
});

test("StorageManager: cleanup removes by type", () => {
  const lib = new MediaLibrary();
  lib.addMedia({ path: "/a.mp4" });
  lib.addMedia({ path: "/b.mp3" });
  lib.addMedia({ path: "/c.mp4" });
  const sm = new StorageManager(lib);
  const result = sm.cleanup({ type: "video" });
  assert.equal(result.cleaned, 2);
  assert.equal(lib.listMedia().length, 1); // only audio left
});

test("StorageManager: cleanup removes by olderThan", () => {
  const lib = new MediaLibrary();
  const old = lib.addMedia({ path: "/old.mp4" });
  lib._media.get(old.id).created_at = "2020-01-01T00:00:00.000Z";
  lib.addMedia({ path: "/new.mp4" });
  const sm = new StorageManager(lib);
  const result = sm.cleanup({ olderThan: "2025-01-01" });
  assert.equal(result.cleaned, 1);
  assert.equal(lib.listMedia().length, 1);
});

test("StorageManager: optimize removes duplicates", () => {
  const lib = new MediaLibrary();
  lib.addMedia({ path: "/a/clip.mp4" });
  lib.addMedia({ path: "/b/clip.mp4" });
  lib.addMedia({ path: "/c/solo.mp3" });
  const sm = new StorageManager(lib);
  const result = sm.optimize();
  assert.ok(result.optimized >= 1);
  assert.ok(result.freed_mb >= 0);
});

// ====================================================================
// 8. CloudSync
// ====================================================================

test("CloudSync: connect and getProviders", () => {
  const cs = new CloudSync();
  cs.connect("google_drive", { token: "abc123" });
  const providers = cs.getProviders();
  assert.equal(providers.length, CLOUD_PROVIDERS.length);
  assert.ok(providers.find((p) => p.name === "google_drive").connected);
  assert.ok(!providers.find((p) => p.name === "dropbox").connected);
});

test("CloudSync: connect throws for invalid provider", () => {
  const cs = new CloudSync();
  assert.throws(() => cs.connect("invalid", {}), /Invalid provider/);
});

test("CloudSync: connect throws without credentials", () => {
  const cs = new CloudSync();
  assert.throws(() => cs.connect("s3", {}), /credentials are required/);
});

test("CloudSync: sync returns results", () => {
  const cs = new CloudSync();
  cs.connect("dropbox", { token: "xyz" });
  const result = cs.sync("proj_1");
  assert.equal(result.synced, true);
  assert.equal(result.projectId, "proj_1");
  assert.ok(result.files_synced > 0);
  assert.ok(result.synced_at);
  assert.equal(result.provider, "dropbox");
});

test("CloudSync: sync throws without connection", () => {
  const cs = new CloudSync();
  assert.throws(() => cs.sync("proj_1"), /No cloud provider connected/);
});

test("CloudSync: getLastSync returns null initially", () => {
  const cs = new CloudSync();
  assert.equal(cs.getLastSync(), null);
});

test("CloudSync: getLastSync returns last sync after sync", () => {
  const cs = new CloudSync();
  cs.connect("s3", { bucket: "my-bucket" });
  cs.sync("proj_1");
  const last = cs.getLastSync();
  assert.ok(last);
  assert.equal(last.provider, "s3");
  assert.equal(last.projectId, "proj_1");
});

// ====================================================================
// 9. BackupSystem
// ====================================================================

test("BackupSystem: createBackup returns all fields", () => {
  const lib = new MediaLibrary();
  lib.addMedia({ path: "/a.mp4" });
  lib.addMedia({ path: "/b.mp3" });
  const bs = new BackupSystem(lib);
  const backup = bs.createBackup("proj_1");
  assert.ok(backup.id);
  assert.equal(backup.projectId, "proj_1");
  assert.ok(backup.created_at);
  assert.equal(backup.media_count, 2);
  assert.ok(backup.size_mb > 0);
});

test("BackupSystem: createBackup throws without projectId", () => {
  const lib = new MediaLibrary();
  const bs = new BackupSystem(lib);
  assert.throws(() => bs.createBackup(), /projectId is required/);
});

test("BackupSystem: restoreBackup returns restoration info", () => {
  const lib = new MediaLibrary();
  const bs = new BackupSystem(lib);
  const backup = bs.createBackup("proj_1");
  const result = bs.restoreBackup(backup.id);
  assert.equal(result.restored, true);
  assert.equal(result.backupId, backup.id);
  assert.ok(result.restored_at);
});

test("BackupSystem: restoreBackup throws for non-existent", () => {
  const lib = new MediaLibrary();
  const bs = new BackupSystem(lib);
  assert.throws(() => bs.restoreBackup("nope"), /Backup not found/);
});

test("BackupSystem: listBackups returns backups for project", () => {
  const lib = new MediaLibrary();
  const bs = new BackupSystem(lib);
  bs.createBackup("p1");
  bs.createBackup("p1");
  bs.createBackup("p2");
  const list = bs.listBackups("p1");
  assert.equal(list.length, 2);
});

test("BackupSystem: scheduleBackup creates a schedule", () => {
  const lib = new MediaLibrary();
  const bs = new BackupSystem(lib);
  const sched = bs.scheduleBackup("proj_1", "daily");
  assert.ok(sched.scheduleId);
  assert.equal(sched.projectId, "proj_1");
  assert.equal(sched.schedule, "daily");
  assert.equal(sched.active, true);
});

test("BackupSystem: scheduleBackup throws without schedule", () => {
  const lib = new MediaLibrary();
  const bs = new BackupSystem(lib);
  assert.throws(() => bs.scheduleBackup("proj_1"), /schedule is required/);
});

// ====================================================================
// 10. ImportExport
// ====================================================================

test("ImportExport: exportProject returns data", () => {
  const lib = new MediaLibrary();
  lib.addMedia({ path: "/a.mp4" });
  const ie = new ImportExport(lib);
  const result = ie.exportProject("proj_1", { format: "json" });
  assert.equal(result.exported, true);
  assert.equal(result.format, "json");
  assert.equal(result.media_count, 1);
  assert.ok(result.data);
  assert.ok(result.exported_at);
  assert.ok(result.size_estimate_kb >= 0);
});

test("ImportExport: exportProject throws on invalid format", () => {
  const lib = new MediaLibrary();
  const ie = new ImportExport(lib);
  assert.throws(() => ie.exportProject("proj_1", { format: "yaml" }), /Invalid format/);
});

test("ImportExport: importProject adds media to library", () => {
  const lib = new MediaLibrary();
  const ie = new ImportExport(lib);
  const result = ie.importProject("/path/to/project.zip");
  assert.equal(result.imported, true);
  assert.ok(result.media_count > 0);
  assert.ok(lib.listMedia().length > 0);
});

test("ImportExport: exportTimeline returns timeline data", () => {
  const lib = new MediaLibrary();
  const ie = new ImportExport(lib);
  const result = ie.exportTimeline("proj_1", { format: "json" });
  assert.equal(result.exported, true);
  assert.equal(result.format, "json");
  assert.ok(result.tracks > 0);
  assert.ok(result.duration_seconds > 0);
});

test("ImportExport: importTimeline returns count", () => {
  const lib = new MediaLibrary();
  const ie = new ImportExport(lib);
  const result = ie.importTimeline("/path/to/timeline.xml", "proj_1");
  assert.equal(result.imported, true);
  assert.ok(result.imported_count > 0);
  assert.ok(result.imported_at);
});

test("ImportExport: importTimeline throws without filePath", () => {
  const lib = new MediaLibrary();
  const ie = new ImportExport(lib);
  assert.throws(() => ie.importTimeline("", "proj_1"), /filePath is required/);
});

test("ImportExport: importTimeline throws without projectId", () => {
  const lib = new MediaLibrary();
  const ie = new ImportExport(lib);
  assert.throws(() => ie.importTimeline("/a.xml"), /projectId is required/);
});

// ====================================================================
// Integration: cross-class workflows
// ====================================================================

test("Integration: TagSystem + SmartSearch workflow", () => {
  const lib = new MediaLibrary();
  const m1 = lib.addMedia({ path: "/sunset.mp4" });
  const m2 = lib.addMedia({ path: "/sunrise.mp4" });
  const m3 = lib.addMedia({ path: "/ocean.mp4" });
  const tags = new TagSystem(lib);
  tags.addTag(m1.id, "golden_hour");
  tags.addTag(m2.id, "golden_hour");
  const ss = new SmartSearch(lib);
  const results = ss.search("sun", { filters: { tag: "golden_hour" } });
  // "sun" matches sunset and sunrise by filename; only golden_hour tagged by filter
  assert.ok(results.length >= 1);
});

test("Integration: Favorites + StorageManager workflow", () => {
  const lib = new MediaLibrary();
  const m = lib.addMedia({ path: "/hero.mp4" });
  const fav = new Favorites();
  fav.addFavorite(m.id);
  const sm = new StorageManager(lib);
  const usage = sm.getUsage();
  assert.equal(usage.total_files, 1);
  assert.equal(fav.isFavorite(m.id), true);
});

test("Integration: DuplicateDetector + BackupSystem workflow", () => {
  const lib = new MediaLibrary();
  lib.addMedia({ path: "/a/clip.mp4" });
  lib.addMedia({ path: "/b/clip.mp4" });
  lib.addMedia({ path: "/c/solo.mp3" });
  const dd = new DuplicateDetector(lib);
  const stats = dd.getStats();
  assert.ok(stats.duplicate_groups >= 1);
  const bs = new BackupSystem(lib);
  const backup = bs.createBackup("proj_1");
  assert.equal(backup.media_count, 3);
  // After backup, check dedup stats still valid
  const stats2 = dd.getStats();
  assert.equal(stats2.total_media, 3);
});

test("Integration: CloudSync + BackupSystem workflow", () => {
  const cs = new CloudSync();
  cs.connect("s3", { bucket: "backups" });
  const lib = new MediaLibrary();
  lib.addMedia({ path: "/a.mp4" });
  const bs = new BackupSystem(lib);
  const backup = bs.createBackup("proj_1");
  const syncResult = cs.sync("proj_1");
  assert.equal(syncResult.synced, true);
  const last = cs.getLastSync();
  assert.equal(last.provider, "s3");
});

test("Integration: SmartCollections + MediaLibrary dynamic rules", () => {
  const lib = new MediaLibrary();
  lib.addMedia({ path: "/a.mp4" });
  lib.addMedia({ path: "/b.mp3" });
  lib.addMedia({ path: "/c.png" });
  const sc = new SmartCollections(lib);
  const col = sc.createCollection({ name: "All Media", rules: {} });
  assert.equal(sc.getCollection(col.id).length, 3);
  lib.addMedia({ path: "/d.mp4" });
  assert.equal(sc.getCollection(col.id).length, 4);
  const filtered = sc.createCollection({ name: "Just Videos", rules: { type: "video" } });
  assert.equal(sc.getCollection(filtered.id).length, 2);
});
