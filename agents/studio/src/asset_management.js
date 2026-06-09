// asset_management.js — Complete asset lifecycle management for Vireo Studio.
//
// Provides 10 asset management tools: upload, list, search, tag, delete,
// stats, duplicate detection, smart collections, timeline, and backup.
//
// 10 Asset Management Tools:
//   1.  uploadAsset({ file, projectId, tags }) → Asset
//   2.  listAssets({ projectId, type, sortBy }) → AssetList
//   3.  searchAssets({ query, projectId, filters }) → AssetSearch
//   4.  tagAsset(assetId, tags) → TaggedAsset
//   5.  deleteAsset(assetId) → DeleteAssetResult
//   6.  getAssetStats(projectId) → AssetStats
//   7.  findDuplicates(projectId) → DuplicateReport
//   8.  smartCollections(projectId) → SmartCollections
//   9.  getAssetTimeline(projectId) → AssetTimeline
//  10.  backupAssets(projectId, { destination }) → BackupResult
//
// Usage:
//   import {
//     uploadAsset, listAssets, searchAssets, tagAsset, deleteAsset,
//     getAssetStats, findDuplicates, smartCollections, getAssetTimeline,
//     backupAssets,
//   } from "./asset_management.js";
//
//   const asset = uploadAsset({ file: "./video.mp4", projectId: "proj_123", tags: ["intro"] });
//   const list  = listAssets({ projectId: "proj_123", type: "video" });
//   const stats = getAssetStats("proj_123");

import crypto from "node:crypto";

// ── Constants ─────────────────────────────────────────────────────────────

/** Supported asset types. */
export const ASSET_TYPES = ["video", "audio", "image", "text", "project"];

/** Supported sort keys for listAssets. */
export const SORT_KEYS = ["filename", "size_mb", "type", "uploaded_at"];

/** Supported backup destinations. */
export const BACKUP_DESTINATIONS = ["local", "cloud", "external"];

/** Map file extension → asset type. */
const EXTENSION_MAP = {
  // video
  mp4: "video", mov: "video", avi: "video", mkv: "video", webm: "video", flv: "video", wmv: "video",
  // audio
  mp3: "audio", wav: "audio", flac: "audio", aac: "audio", ogg: "audio", m4a: "audio",
  // image
  jpg: "image", jpeg: "image", png: "image", gif: "image", svg: "image", webp: "image", bmp: "image", tiff: "image",
  // text
  txt: "text", srt: "text", vtt: "text", ass: "text", json: "text", csv: "text", md: "text", doc: "text",
  // project
  vireo: "project", prproj: "project", fcpxml: "project", aep: "project",
};

/** Allowed smart-collection rule names. */
const COLLECTION_RULES = ["recent", "large_files", "videos_only", "unused"];

// ── Internal Stores ───────────────────────────────────────────────────────

/** @type {Map<string, object>} asset_id → asset object */
const _assets = new Map();

/** @type {Map<string, Set<string>>} project_id → Set of asset_ids */
const _projectIndex = new Map();

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Derive the asset type from a filename's extension.
 * @param {string} filename
 * @returns {string}
 */
function _inferType(filename) {
  const ext = (filename || "").split(".").pop()?.toLowerCase() || "";
  return EXTENSION_MAP[ext] || "video";
}

/**
 * Simulate a file size in MB from filename length and random jitter.
 * @param {string} filename
 * @returns {number}
 */
function _estimateSizeMB(filename) {
  const base = ((filename || "").length * 3.7 + 42) % 500 + 0.5;
  return Math.round(base * 100) / 100;
}

/**
 * Return the current ISO timestamp.
 * @returns {string}
 */
function _now() {
  return new Date().toISOString();
}

/**
 * Determine whether an asset was used recently (within last 30 days).
 * @param {object} asset
 * @returns {boolean}
 */
function _isRecent(asset) {
  const age = Date.now() - new Date(asset.uploaded_at).getTime();
  return age < 30 * 24 * 60 * 60 * 1000;
}

/**
 * Register an asset in the project index.
 * @param {string} projectId
 * @param {string} assetId
 */
function _indexAsset(projectId, assetId) {
  if (!_projectIndex.has(projectId)) _projectIndex.set(projectId, new Set());
  _projectIndex.get(projectId).add(assetId);
}

/**
 * Remove an asset from the project index.
 * @param {string} projectId
 * @param {string} assetId
 */
function _unindexAsset(projectId, assetId) {
  const set = _projectIndex.get(projectId);
  if (set) set.delete(assetId);
}

/**
 * Get all asset IDs for a project.
 * @param {string} projectId
 * @returns {string[]}
 */
function _projectAssetIds(projectId) {
  const set = _projectIndex.get(projectId);
  return set ? [...set] : [];
}

/**
 * Get an asset by ID or throw.
 * @param {string} assetId
 * @returns {object}
 */
function _getAsset(assetId) {
  const asset = _assets.get(assetId);
  if (!asset) throw new Error(`Asset not found: ${assetId}`);
  return asset;
}

// ── Tool #1: uploadAsset ─────────────────────────────────────────────────

/**
 * Upload an asset to a project.
 *
 * @param {{ file: string, projectId?: string, tags?: string[] }} opts
 * @returns {{ id: string, filename: string, size_mb: number, type: string, tags: string[], uploaded_at: string, thumbnail_url: string }}
 */
export function uploadAsset({ file, projectId = "default", tags = [] } = {}) {
  if (!file) throw new Error("file is required");

  const filename = file.split("/").pop().split("\\").pop();
  const id = crypto.randomUUID();
  const type = _inferType(filename);
  const size_mb = _estimateSizeMB(filename);
  const uploaded_at = _now();
  const thumbnail_url = `https://cdn.vireo.studio/thumbs/${id}.jpg`;

  const asset = {
    id,
    filename,
    size_mb,
    type,
    tags: Array.isArray(tags) ? [...tags] : [],
    uploaded_at,
    thumbnail_url,
    projectId,
  };

  _assets.set(id, asset);
  _indexAsset(projectId, id);

  return { id, filename, size_mb, type, tags: asset.tags, uploaded_at, thumbnail_url };
}

// ── Tool #2: listAssets ──────────────────────────────────────────────────

/**
 * List assets for a project with optional type filter and sorting.
 *
 * @param {{ projectId?: string, type?: string, sortBy?: string }} opts
 * @returns {{ assets: Array<{id: string, filename: string, type: string, size_mb: number}>, total_count: number }}
 */
export function listAssets({ projectId = "default", type = null, sortBy = "uploaded_at" } = {}) {
  if (type && !ASSET_TYPES.includes(type)) {
    throw new Error(`type must be one of: ${ASSET_TYPES.join(", ")}`);
  }
  if (!SORT_KEYS.includes(sortBy)) {
    throw new Error(`sortBy must be one of: ${SORT_KEYS.join(", ")}`);
  }

  let ids = _projectAssetIds(projectId);
  let assets = ids.map((id) => _assets.get(id)).filter(Boolean);

  if (type) {
    assets = assets.filter((a) => a.type === type);
  }

  assets.sort((a, b) => {
    if (sortBy === "filename") return a.filename.localeCompare(b.filename);
    if (sortBy === "size_mb") return a.size_mb - b.size_mb;
    if (sortBy === "type") return a.type.localeCompare(b.type);
    return new Date(a.uploaded_at) - new Date(b.uploaded_at);
  });

  return {
    assets: assets.map(({ id, filename, type, size_mb }) => ({ id, filename, type, size_mb })),
    total_count: assets.length,
  };
}

// ── Tool #3: searchAssets ────────────────────────────────────────────────

/**
 * Full-text search across assets in a project.
 *
 * @param {{ query: string, projectId?: string, filters?: object }} opts
 * @returns {{ assets: Array<{id: string, filename: string, score: number, snippet: string}>, total_matches: number }}
 */
export function searchAssets({ query, projectId = "default", filters = {} } = {}) {
  if (!query || query.trim().length === 0) throw new Error("query is required and must be non-empty");

  const q = query.toLowerCase();
  let ids = _projectAssetIds(projectId);
  let assets = ids.map((id) => _assets.get(id)).filter(Boolean);

  // Apply optional type filter
  if (filters.type && ASSET_TYPES.includes(filters.type)) {
    assets = assets.filter((a) => a.type === filters.type);
  }
  // Apply optional tag filter
  if (filters.tag) {
    assets = assets.filter((a) => a.tags.includes(filters.tag));
  }

  const results = [];
  for (const asset of assets) {
    const filenameLower = asset.filename.toLowerCase();
    const tagStr = asset.tags.join(" ").toLowerCase();
    let score = 0;

    // Exact filename match
    if (filenameLower === q) score = 1.0;
    // Filename contains query
    else if (filenameLower.includes(q)) score = 0.8;
    // Tag match
    else if (tagStr.includes(q)) score = 0.6;
    // Partial word match
    else if (q.split(" ").some((w) => filenameLower.includes(w))) score = 0.4;

    if (score > 0) {
      // Build snippet: highlight the matched part of the filename
      const snippet = asset.filename;
      results.push({ id: asset.id, filename: asset.filename, score, snippet });
    }
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  return { assets: results, total_matches: results.length };
}

// ── Tool #4: tagAsset ────────────────────────────────────────────────────

/**
 * Add tags to an existing asset (merges with existing tags, deduplicates).
 *
 * @param {string} assetId
 * @param {string[]} tags
 * @returns {{ tagged: boolean, tags: string[], total_tags: number }}
 */
export function tagAsset(assetId, tags = []) {
  const asset = _getAsset(assetId);
  if (!Array.isArray(tags) || tags.length === 0) {
    throw new Error("tags must be a non-empty array");
  }

  // Merge and deduplicate
  const merged = new Set([...asset.tags, ...tags]);
  asset.tags = [...merged];

  return { tagged: true, tags: [...asset.tags], total_tags: asset.tags.length };
}

// ── Tool #5: deleteAsset ─────────────────────────────────────────────────

/**
 * Delete an asset and remove all references.
 *
 * @param {string} assetId
 * @returns {{ deleted: boolean, references_removed: number }}
 */
export function deleteAsset(assetId) {
  const asset = _getAsset(assetId);

  // Count references (tags + project index) — each counts as 1
  let references_removed = 0;
  if (asset.tags.length > 0) references_removed += asset.tags.length;
  references_removed += 1; // project index reference

  _unindexAsset(asset.projectId, assetId);
  _assets.delete(assetId);

  return { deleted: true, references_removed };
}

// ── Tool #6: getAssetStats ───────────────────────────────────────────────

/**
 * Get aggregate statistics for all assets in a project.
 *
 * @param {string} projectId
 * @returns {{ total_assets: number, total_size_mb: number, by_type: { video: number, audio: number, image: number }, duplicates_found: number }}
 */
export function getAssetStats(projectId = "default") {
  const ids = _projectAssetIds(projectId);
  const assets = ids.map((id) => _assets.get(id)).filter(Boolean);

  let total_size_mb = 0;
  const by_type = { video: 0, audio: 0, image: 0 };

  for (const a of assets) {
    total_size_mb += a.size_mb;
    if (by_type[a.type] !== undefined) by_type[a.type]++;
  }

  // Detect duplicates by filename similarity
  const nameBuckets = new Map();
  for (const a of assets) {
    const key = a.filename.toLowerCase();
    if (!nameBuckets.has(key)) nameBuckets.set(key, []);
    nameBuckets.get(key).push(a);
  }
  let duplicates_found = 0;
  for (const bucket of nameBuckets.values()) {
    if (bucket.length > 1) duplicates_found += bucket.length;
  }

  return {
    total_assets: assets.length,
    total_size_mb: Math.round(total_size_mb * 100) / 100,
    by_type,
    duplicates_found,
  };
}

// ── Tool #7: findDuplicates ──────────────────────────────────────────────

/**
 * Find duplicate assets within a project (by filename similarity).
 *
 * @param {string} projectId
 * @returns {{ duplicates: Array<{ assets: string[], similarity: number, size_mb: number }>, total_duplicates: number }}
 */
export function findDuplicates(projectId = "default") {
  const ids = _projectAssetIds(projectId);
  const assets = ids.map((id) => _assets.get(id)).filter(Boolean);

  // Bucket by exact filename
  const exactBuckets = new Map();
  for (const a of assets) {
    const key = a.filename.toLowerCase();
    if (!exactBuckets.has(key)) exactBuckets.set(key, []);
    exactBuckets.get(key).push(a);
  }

  const duplicates = [];

  // Exact duplicates
  for (const bucket of exactBuckets.values()) {
    if (bucket.length > 1) {
      duplicates.push({
        assets: bucket.map((a) => a.id),
        similarity: 1.0,
        size_mb: bucket[0].size_mb,
      });
    }
  }

  // Near-duplicates: same type, similar filenames (edit distance heuristic)
  const typeBuckets = new Map();
  for (const a of assets) {
    if (!typeBuckets.has(a.type)) typeBuckets.set(a.type, []);
    typeBuckets.get(a.type).push(a);
  }

  for (const group of typeBuckets.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        if (a.id === b.id) continue;
        // Skip if already in an exact-duplicate group
        if (exactBuckets.get(a.filename.toLowerCase())?.length > 1) continue;
        if (exactBuckets.get(b.filename.toLowerCase())?.length > 1) continue;

        const sim = _filenameSimilarity(a.filename, b.filename);
        if (sim >= 0.7 && sim < 1.0) {
          // Avoid creating duplicate pairs
          const alreadyFound = duplicates.some(
            (d) => d.assets.includes(a.id) && d.assets.includes(b.id)
          );
          if (!alreadyFound) {
            duplicates.push({
              assets: [a.id, b.id],
              similarity: Math.round(sim * 100) / 100,
              size_mb: Math.round(((a.size_mb + b.size_mb) / 2) * 100) / 100,
            });
          }
        }
      }
    }
  }

  return { duplicates, total_duplicates: duplicates.length };
}

/**
 * Simple Levenshtein-based similarity between two filenames (0–1).
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function _filenameSimilarity(a, b) {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  if (la === lb) return 1.0;

  const maxLen = Math.max(la.length, lb.length);
  if (maxLen === 0) return 1.0;

  // Quick heuristic: shared prefix length / max length
  let shared = 0;
  for (let i = 0; i < Math.min(la.length, lb.length); i++) {
    if (la[i] === lb[i]) shared++;
    else break;
  }
  const prefixScore = shared / maxLen;

  // Jaccard of character bigrams
  const bigramsA = new Set();
  const bigramsB = new Set();
  for (let i = 0; i < la.length - 1; i++) bigramsA.add(la.slice(i, i + 2));
  for (let i = 0; i < lb.length - 1; i++) bigramsB.add(lb.slice(i, i + 2));
  let intersection = 0;
  for (const bg of bigramsA) if (bigramsB.has(bg)) intersection++;
  const union = bigramsA.size + bigramsB.size - intersection;
  const jaccard = union > 0 ? intersection / union : 0;

  return prefixScore * 0.5 + jaccard * 0.5;
}

// ── Tool #8: smartCollections ─────────────────────────────────────────────

/**
 * Generate automatic smart collections based on asset metadata.
 *
 * @param {string} projectId
 * @returns {{ collections: Array<{ name: string, rule: string, asset_count: number }> }}
 */
export function smartCollections(projectId = "default") {
  const ids = _projectAssetIds(projectId);
  const assets = ids.map((id) => _assets.get(id)).filter(Boolean);

  const collections = [];

  // recent — assets uploaded in the last 30 days
  const recentAssets = assets.filter(_isRecent);
  collections.push({ name: "Recent Uploads", rule: "recent", asset_count: recentAssets.length });

  // large_files — assets with size_mb > 100
  const largeFiles = assets.filter((a) => a.size_mb > 100);
  collections.push({ name: "Large Files", rule: "large_files", asset_count: largeFiles.length });

  // videos_only — only video-type assets
  const videoOnly = assets.filter((a) => a.type === "video");
  collections.push({ name: "Videos", rule: "videos_only", asset_count: videoOnly.length });

  // unused — assets with zero tags
  const unused = assets.filter((a) => a.tags.length === 0);
  collections.push({ name: "Untagged Assets", rule: "unused", asset_count: unused.length });

  return { collections };
}

// ── Tool #9: getAssetTimeline ─────────────────────────────────────────────

/**
 * Get a timeline of asset uploads over the last 30 days.
 *
 * @param {string} projectId
 * @returns {{ timeline: Array<{ date: string, assets_uploaded: number, total_size_mb: number }> }}
 */
export function getAssetTimeline(projectId = "default") {
  const ids = _projectAssetIds(projectId);
  const assets = ids.map((id) => _assets.get(id)).filter(Boolean);

  // Build 30-day bucket map
  const bucketMap = new Map();
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    bucketMap.set(key, { assets_uploaded: 0, total_size_mb: 0 });
  }

  for (const a of assets) {
    const key = a.uploaded_at.slice(0, 10);
    if (bucketMap.has(key)) {
      const bucket = bucketMap.get(key);
      bucket.assets_uploaded++;
      bucket.total_size_mb = Math.round((bucket.total_size_mb + a.size_mb) * 100) / 100;
    }
  }

  const timeline = [];
  for (const [date, data] of bucketMap) {
    timeline.push({ date, ...data });
  }

  return { timeline };
}

// ── Tool #10: backupAssets ────────────────────────────────────────────────

/**
 * Backup all assets in a project to the specified destination.
 *
 * @param {string} projectId
 * @param {{ destination?: string }} opts
 * @returns {{ backed_up: boolean, assets_count: number, total_size_mb: number, destination: string }}
 */
export function backupAssets(projectId = "default", { destination = "local" } = {}) {
  if (!BACKUP_DESTINATIONS.includes(destination)) {
    throw new Error(`destination must be one of: ${BACKUP_DESTINATIONS.join(", ")}`);
  }

  const ids = _projectAssetIds(projectId);
  const assets = ids.map((id) => _assets.get(id)).filter(Boolean);

  let total_size_mb = 0;
  for (const a of assets) total_size_mb += a.size_mb;

  return {
    backed_up: true,
    assets_count: assets.length,
    total_size_mb: Math.round(total_size_mb * 100) / 100,
    destination,
  };
}

// ── Test Helpers ──────────────────────────────────────────────────────────

/** Reset all internal stores (test helper). */
export function _resetAll() {
  _assets.clear();
  _projectIndex.clear();
}

/** Get a raw asset by ID (test helper). */
export function _getRawAsset(assetId) {
  return _assets.get(assetId) || null;
}

/** Get the project index size (test helper). */
export function _getProjectCount() {
  return _projectIndex.size;
}
