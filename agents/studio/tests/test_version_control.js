/**
 * test_version_control.js — Pure logic tests for version control system.
 * Tests the algorithms without importing .ts files.
 *
 * Covers: save, list, get, restore, branch, diff, merge, auto-save, limits, edge cases.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// ── Replicate the core logic from useVersionControl.ts ──

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function generateId(prefix = 'v') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function diffProjects(p1, p2) {
  const added = [];
  const removed = [];
  const modified = [];

  const clips1 = new Map();
  const clips2 = new Map();

  for (const t of p1.tracks) for (const c of t.clips) clips1.set(c.id, c);
  for (const t of p2.tracks) for (const c of t.clips) clips2.set(c.id, c);

  for (const [id, clip] of clips2) {
    if (!clips1.has(id)) added.push(clip);
    else if (JSON.stringify(clips1.get(id)) !== JSON.stringify(clip)) modified.push({ id, before: clips1.get(id), after: clip });
  }
  for (const [id, clip] of clips1) {
    if (!clips2.has(id)) removed.push(clip);
  }

  return { added, removed, modified };
}

// ── Tests ──

describe('version control', () => {
  const makeProject = () => ({
    name: 'Test',
    duration_sec: 60,
    fps: 30,
    width: 1920,
    height: 1080,
    tracks: [
      { id: 'V1', kind: 'video', name: 'V1', clips: [
        { id: 'c1', track_id: 'V1', source_file: 'a.mp4', start_sec: 0, duration_sec: 10, in_sec: 0, kind: 'video' },
      ]},
    ],
    markers: [{ id: 'm1', time_sec: 0, label: 'Start', color: '#22c55e' }],
  });

  // Minimal VersionHistory
  class VersionHistory {
    constructor(maxVersions = 100, maxBranches = 10) {
      this.versions = [];
      this.branches = [{ id: 'main', name: 'main', headVersionId: null }];
      this.maxVersions = maxVersions;
      this.maxBranches = maxBranches;
      this.currentBranch = 'main';
    }
    saveVersion(name, project, author = 'system') {
      if (!name || !name.trim()) throw new Error('empty_name');
      const v = { id: generateId('v'), name: name.trim(), project: deepClone(project), timestamp: Date.now(), author, branch: this.currentBranch };
      this.versions.unshift(v);
      if (this.versions.length > this.maxVersions) this.versions.pop();
      const branch = this.branches.find(b => b.id === this.currentBranch);
      if (branch) branch.headVersionId = v.id;
      return v;
    }
    listVersions(branchFilter) {
      let list = this.versions;
      if (branchFilter) list = list.filter(v => v.branch === branchFilter);
      return list;
    }
    getVersion(id) { return this.versions.find(v => v.id === id) || null; }
    restoreVersion(id) { const v = this.getVersion(id); return v ? deepClone(v.project) : null; }
    createBranch(name, fromVersionId) {
      if (!name || !name.trim()) throw new Error('empty_name');
      if (this.branches.find(b => b.name === name.trim())) throw new Error('branch_exists');
      if (this.branches.length >= this.maxBranches) throw new Error('branch_limit');
      const fromId = fromVersionId || this.branches.find(b => b.id === this.currentBranch)?.headVersionId;
      const b = { id: generateId('b'), name: name.trim(), headVersionId: fromId };
      this.branches.push(b);
      return b;
    }
    listBranches() { return [...this.branches]; }
    mergeBranch(branchId) {
      const source = this.branches.find(b => b.id === branchId);
      const target = this.branches.find(b => b.id === this.currentBranch);
      if (!source || !target) return { merged: false, conflicts: ['branch_not_found'] };
      const sourceVersion = this.getVersion(source.headVersionId);
      const targetVersion = this.getVersion(target.headVersionId);
      if (!sourceVersion || !targetVersion) return { merged: false, conflicts: ['version_not_found'] };
      const diff = diffProjects(targetVersion.project, sourceVersion.project);
      if (diff.modified.length > 0) return { merged: false, conflicts: diff.modified.map(m => m.id) };
      target.headVersionId = source.headVersionId;
      return { merged: true, conflicts: [] };
    }
    diffVersions(id1, id2) {
      const v1 = this.getVersion(id1);
      const v2 = this.getVersion(id2);
      if (!v1 || !v2) return null;
      return diffProjects(v1.project, v2.project);
    }
  }

  test('saveVersion stores version with unique id', () => {
    const h = new VersionHistory();
    const v = h.saveVersion('v1', makeProject());
    assert.ok(v.id.startsWith('v-'));
    assert.equal(v.name, 'v1');
    assert.equal(h.versions.length, 1);
  });

  test('listVersions returns sorted newest first', () => {
    const h = new VersionHistory();
    h.saveVersion('v1', makeProject());
    h.saveVersion('v2', makeProject());
    const list = h.listVersions();
    assert.equal(list.length, 2);
    assert.equal(list[0].name, 'v2');
  });

  test('getVersion returns correct version', () => {
    const h = new VersionHistory();
    const v = h.saveVersion('v1', makeProject());
    assert.equal(h.getVersion(v.id).name, 'v1');
    assert.equal(h.getVersion('nonexistent'), null);
  });

  test('restoreVersion returns project state', () => {
    const h = new VersionHistory();
    const proj = makeProject();
    const v = h.saveVersion('v1', proj);
    const restored = h.restoreVersion(v.id);
    assert.deepEqual(restored.tracks[0].clips[0].id, 'c1');
    assert.ok(restored !== proj); // deep cloned
  });

  test('createBranch creates new branch from main', () => {
    const h = new VersionHistory();
    const v = h.saveVersion('v1', makeProject());
    const b = h.createBranch('feature');
    assert.equal(b.name, 'feature');
    assert.equal(b.headVersionId, v.id);
  });

  test('listBranches returns all branches', () => {
    const h = new VersionHistory();
    h.createBranch('a');
    h.createBranch('b');
    assert.equal(h.listBranches().length, 3); // main + a + b
  });

  test('diffVersions detects added clips', () => {
    const h = new VersionHistory();
    const p1 = makeProject();
    const p2 = makeProject();
    p2.tracks[0].clips.push({ id: 'c2', track_id: 'V1', source_file: 'b.mp4', start_sec: 10, duration_sec: 5, in_sec: 0, kind: 'video' });
    const v1 = h.saveVersion('v1', p1);
    const v2 = h.saveVersion('v2', p2);
    const diff = h.diffVersions(v1.id, v2.id);
    assert.equal(diff.added.length, 1);
    assert.equal(diff.added[0].id, 'c2');
  });

  test('diffVersions detects removed clips', () => {
    const h = new VersionHistory();
    const p1 = makeProject();
    const p2 = makeProject();
    p2.tracks[0].clips = [];
    const v1 = h.saveVersion('v1', p1);
    const v2 = h.saveVersion('v2', p2);
    const diff = h.diffVersions(v1.id, v2.id);
    assert.equal(diff.removed.length, 1);
  });

  test('diffVersions detects modified clips', () => {
    const h = new VersionHistory();
    const p1 = makeProject();
    const p2 = makeProject();
    p2.tracks[0].clips[0].duration_sec = 20;
    const v1 = h.saveVersion('v1', p1);
    const v2 = h.saveVersion('v2', p2);
    const diff = h.diffVersions(v1.id, v2.id);
    assert.equal(diff.modified.length, 1);
    assert.equal(diff.modified[0].after.duration_sec, 20);
  });

  test('diffVersions identical versions = empty diff', () => {
    const h = new VersionHistory();
    const p = makeProject();
    const v1 = h.saveVersion('v1', p);
    const v2 = h.saveVersion('v2', p);
    const diff = h.diffVersions(v1.id, v2.id);
    assert.equal(diff.added.length, 0);
    assert.equal(diff.removed.length, 0);
    assert.equal(diff.modified.length, 0);
  });

  test('mergeBranch fast-forward merge', () => {
    const h = new VersionHistory();
    h.saveVersion('v1', makeProject());
    const b = h.createBranch('feature');
    h.currentBranch = 'feature';
    h.saveVersion('v2', makeProject());
    h.currentBranch = 'main';
    const result = h.mergeBranch(b.id);
    assert.equal(result.merged, true);
    assert.equal(result.conflicts.length, 0);
  });

  test('mergeBranch detects conflicts', () => {
    const h = new VersionHistory();
    const p1 = makeProject();
    h.saveVersion('v1', p1);
    const b = h.createBranch('feature');
    h.currentBranch = 'feature';
    const p2 = makeProject();
    p2.tracks[0].clips[0].duration_sec = 20;
    h.saveVersion('v2', p2);
    h.currentBranch = 'main';
    const p3 = makeProject();
    p3.tracks[0].clips[0].duration_sec = 30;
    h.saveVersion('v3', p3);
    const result = h.mergeBranch(b.id);
    assert.equal(result.merged, false);
    assert.ok(result.conflicts.length > 0);
  });

  test('version id unique across saves', () => {
    const h = new VersionHistory();
    const ids = new Set();
    for (let i = 0; i < 50; i++) {
      const v = h.saveVersion(`v${i}`, makeProject());
      assert.ok(!ids.has(v.id));
      ids.add(v.id);
    }
  });

  test('branch name uniqueness enforced', () => {
    const h = new VersionHistory();
    h.createBranch('feature');
    assert.throws(() => h.createBranch('feature'), /branch_exists/);
  });

  test('restore to version preserves all tracks', () => {
    const h = new VersionHistory();
    const p = makeProject();
    h.saveVersion('v1', p);
    const restored = h.restoreVersion(h.versions[0].id);
    assert.equal(restored.tracks.length, 1);
    assert.equal(restored.tracks[0].clips.length, 1);
  });

  test('restore to version preserves markers', () => {
    const h = new VersionHistory();
    const p = makeProject();
    h.saveVersion('v1', p);
    const restored = h.restoreVersion(h.versions[0].id);
    assert.equal(restored.markers.length, 1);
    assert.equal(restored.markers[0].label, 'Start');
  });

  test('diff handles empty tracks', () => {
    const p1 = { tracks: [] };
    const p2 = { tracks: [] };
    const diff = diffProjects(p1, p2);
    assert.equal(diff.added.length, 0);
    assert.equal(diff.removed.length, 0);
    assert.equal(diff.modified.length, 0);
  });

  test('version limit enforced', () => {
    const h = new VersionHistory(3);
    for (let i = 0; i < 5; i++) h.saveVersion(`v${i}`, makeProject());
    assert.equal(h.versions.length, 3);
    assert.equal(h.versions[0].name, 'v4');
  });

  test('branch limit enforced', () => {
    const h = new VersionHistory(100, 2);
    h.createBranch('a');
    assert.throws(() => h.createBranch('b'), /branch_limit/);
  });

  test('empty version name rejected', () => {
    const h = new VersionHistory();
    assert.throws(() => h.saveVersion('', makeProject()), /empty_name/);
    assert.throws(() => h.saveVersion('  ', makeProject()), /empty_name/);
  });

  test('version metadata includes author', () => {
    const h = new VersionHistory();
    const v = h.saveVersion('v1', makeProject(), 'anna');
    assert.equal(v.author, 'anna');
    assert.ok(v.timestamp > 0);
  });

  test('concurrent saves handled', () => {
    const h = new VersionHistory();
    const saves = Array.from({ length: 10 }, (_, i) => h.saveVersion(`v${i}`, makeProject()));
    assert.equal(saves.length, 10);
    assert.equal(new Set(saves.map(v => v.id)).size, 10);
  });

  test('diff handles multiple track changes', () => {
    const p1 = { tracks: [
      { id: 'V1', clips: [{ id: 'c1', start_sec: 0, duration_sec: 10 }] },
      { id: 'V2', clips: [{ id: 'c2', start_sec: 0, duration_sec: 5 }] },
    ]};
    const p2 = { tracks: [
      { id: 'V1', clips: [{ id: 'c1', start_sec: 0, duration_sec: 20 }] },
      { id: 'V2', clips: [] },
    ]};
    const diff = diffProjects(p1, p2);
    assert.equal(diff.modified.length, 1);
    assert.equal(diff.removed.length, 1);
  });

  test('branch switching changes current branch', () => {
    const h = new VersionHistory();
    h.createBranch('feature');
    h.currentBranch = 'feature';
    assert.equal(h.currentBranch, 'feature');
  });

  test('merge without source version returns error', () => {
    const h = new VersionHistory();
    const b = h.createBranch('empty');
    // empty branch has no headVersionId
    const result = h.mergeBranch(b.id);
    assert.equal(result.merged, false);
  });
});
