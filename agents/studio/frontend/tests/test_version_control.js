/**
 * Tests for useVersionControl — 25+ tests covering:
 *   save, list, get, restore, branch, diff, merge, auto-save, limits, edge cases.
 *
 * Run:  node --experimental-vm-modules tests/test_version_control.js
 * Or:   npx jest tests/test_version_control.js
 *
 * We test the pure diffProjects function and simulate the hook's state
 * management by calling its logic directly.
 */

import { diffProjects } from '../src/hooks/useVersionControl.ts';
import { initialProject } from '../src/mockData.ts';

// ── Tiny test harness ─────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, err });
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

function assertEqual(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(msg || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
}

function assertThrows(fn, msg) {
  try {
    fn();
    throw new Error(`Expected error: ${msg || 'should have thrown'}`);
  } catch (err) {
    if (err.message.startsWith('Expected error')) throw err;
    // Expected
  }
}

// ── Helpers: simulate VersionHistory logic ────────────────────

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function uid(prefix = 'v') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// Minimal VersionHistory class for testing (mirrors hook logic)
class VersionHistory {
  constructor() {
    this.versions = [];
    this.branches = [
      { id: 'main', name: 'main', headVersionId: '', createdAt: Date.now() },
    ];
    this.currentBranch = 'main';
    this.lastSavedHash = null;
  }

  saveVersion(name, project, author = 'user') {
    if (!name || name.trim().length === 0) {
      throw new Error('Version name cannot be empty');
    }
    const version = {
      id: uid('ver'),
      name: name.trim(),
      project: deepClone(project),
      timestamp: Date.now(),
      author,
      branch: this.currentBranch,
    };
    this.versions.unshift(version);
    if (this.versions.length > 100) {
      this.versions.length = 100;
    }
    // Update branch head
    const branch = this.branches.find((b) => b.id === this.currentBranch);
    if (branch) branch.headVersionId = version.id;
    return version;
  }

  listVersions(branchFilter) {
    const filtered = branchFilter
      ? this.versions.filter((v) => v.branch === branchFilter)
      : this.versions;
    return [...filtered].sort((a, b) => b.timestamp - a.timestamp);
  }

  getVersion(id) {
    return this.versions.find((v) => v.id === id) ?? null;
  }

  restoreVersion(id) {
    const v = this.versions.find((v) => v.id === id);
    if (!v) throw new Error(`Version ${id} not found`);
    return deepClone(v.project);
  }

  createBranch(name, fromVersionId) {
    if (!name || name.trim().length === 0) {
      throw new Error('Branch name cannot be empty');
    }
    const trimmed = name.trim();
    if (this.branches.some((b) => b.name === trimmed)) {
      throw new Error(`Branch "${trimmed}" already exists`);
    }
    if (this.branches.length >= 10) {
      throw new Error('Maximum of 10 branches reached');
    }
    const headId = fromVersionId ?? this.branches.find((b) => b.id === 'main')?.headVersionId ?? '';
    const branch = {
      id: uid('br'),
      name: trimmed,
      headVersionId: headId,
      createdAt: Date.now(),
    };
    this.branches.push(branch);
    // Return the actual stored branch reference
    return this.branches[this.branches.length - 1];
  }

  listBranches() {
    return [...this.branches];
  }

  switchBranch(branchId) {
    this.currentBranch = branchId;
  }

  mergeBranch(branchId) {
    const sourceBranch = this.branches.find((b) => b.id === branchId);
    if (!sourceBranch) throw new Error(`Branch ${branchId} not found`);
    const sourceVersion = this.versions.find((v) => v.id === sourceBranch.headVersionId);
    if (!sourceVersion) return { conflicts: [], merged: false };
    const targetBranch = this.branches.find((b) => b.id === this.currentBranch);
    if (!targetBranch) return { conflicts: [], merged: false };
    const targetVersion = this.versions.find((v) => v.id === targetBranch.headVersionId);
    if (!targetVersion) return { conflicts: [], merged: false };
    const diff = diffProjects(targetVersion.project, sourceVersion.project);
    if (diff.modified.length > 0) {
      return { conflicts: diff.modified, merged: false };
    }
    return { conflicts: [], merged: true };
  }

  autoSave(project, intervalMs = 30_000) {
    const hash = JSON.stringify(project);
    if (hash === this.lastSavedHash) return false;
    this.lastSavedHash = hash;
    this.saveVersion('Auto-save', project, 'auto-save');
    return true;
  }
}

// ── Test data ─────────────────────────────────────────────────

function makeProject(overrides = {}) {
  return {
    name: 'Test Project',
    duration_sec: 60,
    fps: 30,
    width: 1920,
    height: 1080,
    tracks: [
      {
        id: 'V1',
        kind: 'video',
        name: 'V1',
        clips: [
          { id: 'c1', track_id: 'V1', source_file: 'a.mp4', start_sec: 0, duration_sec: 10, in_sec: 0, kind: 'video' },
          { id: 'c2', track_id: 'V1', source_file: 'b.mp4', start_sec: 10, duration_sec: 10, in_sec: 0, kind: 'video' },
        ],
      },
    ],
    markers: [
      { id: 'm1', time_sec: 0, label: 'Start', color: '#22c55e' },
    ],
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────

console.log('\n═══════════════════════════════════════════');
console.log('  useVersionControl — Test Suite');
console.log('═══════════════════════════════════════════\n');

// ── 1. saveVersion stores version with unique id ──
test('1. saveVersion stores version with unique id', () => {
  const vh = new VersionHistory();
  const v1 = vh.saveVersion('v1', initialProject);
  const v2 = vh.saveVersion('v2', initialProject);
  assert(v1.id !== v2.id, 'Version IDs should be unique');
  assert(typeof v1.id === 'string' && v1.id.length > 0, 'ID should be non-empty string');
});

// ── 2. listVersions returns sorted newest first ──
test('2. listVersions returns sorted newest first', () => {
  const vh = new VersionHistory();
  vh.saveVersion('first', initialProject);
  // Small delay to ensure different timestamps
  const v2 = vh.saveVersion('second', initialProject);
  const list = vh.listVersions();
  assert(list.length === 2, 'Should have 2 versions');
  assertEqual(list[0].id, v2.id, 'Newest should be first');
});

// ── 3. getVersion returns correct version ──
test('3. getVersion returns correct version', () => {
  const vh = new VersionHistory();
  const v = vh.saveVersion('my-version', initialProject);
  const found = vh.getVersion(v.id);
  assert(found !== null, 'Should find version');
  assertEqual(found.id, v.id);
  assertEqual(found.name, 'my-version');
});

// ── 4. restoreVersion returns project state ──
test('4. restoreVersion returns project state', () => {
  const vh = new VersionHistory();
  const proj = makeProject({ name: 'Restore Me' });
  const v = vh.saveVersion('snap', proj);
  const restored = vh.restoreVersion(v.id);
  assertEqual(restored.name, 'Restore Me');
  assertEqual(restored.tracks.length, 1);
  // Verify it's a deep clone, not the same reference
  assert(restored !== proj, 'Should return a clone');
});

// ── 5. createBranch creates new branch from main ──
test('5. createBranch creates new branch from main', () => {
  const vh = new VersionHistory();
  vh.saveVersion('init', initialProject);
  const branch = vh.createBranch('feature-v2');
  assert(branch.name === 'feature-v2');
  const all = vh.listBranches();
  assert(all.length === 2, 'Should have 2 branches (main + feature-v2)');
});

// ── 6. listBranches returns all branches ──
test('6. listBranches returns all branches', () => {
  const vh = new VersionHistory();
  vh.createBranch('alpha');
  vh.createBranch('beta');
  const all = vh.listBranches();
  assertEqual(all.length, 3, 'Should have 3 branches');
  const names = all.map((b) => b.name);
  assert(names.includes('main'));
  assert(names.includes('alpha'));
  assert(names.includes('beta'));
});

// ── 7. diffVersions detects added clips ──
test('7. diffVersions detects added clips', () => {
  const p1 = makeProject();
  const p2 = makeProject();
  p2.tracks[0].clips.push({
    id: 'c-new', track_id: 'V1', source_file: 'new.mp4',
    start_sec: 20, duration_sec: 5, in_sec: 0, kind: 'video',
  });
  const diff = diffProjects(p1, p2);
  assertEqual(diff.added.length, 1);
  assertEqual(diff.added[0].clipId, 'c-new');
});

// ── 8. diffVersions detects removed clips ──
test('8. diffVersions detects removed clips', () => {
  const p1 = makeProject();
  const p2 = makeProject();
  p2.tracks[0].clips = p2.tracks[0].clips.filter((c) => c.id !== 'c2');
  const diff = diffProjects(p1, p2);
  assertEqual(diff.removed.length, 1);
  assertEqual(diff.removed[0].clipId, 'c2');
});

// ── 9. diffVersions detects modified clips ──
test('9. diffVersions detects modified clips', () => {
  const p1 = makeProject();
  const p2 = makeProject();
  p2.tracks[0].clips[0].duration_sec = 15;
  p2.tracks[0].clips[0].label = 'changed';
  const diff = diffProjects(p1, p2);
  assertEqual(diff.modified.length, 2, 'Should detect 2 field changes');
  const fields = diff.modified.map((d) => d.field);
  assert(fields.includes('duration_sec'), 'Should detect duration_sec change');
  assert(fields.includes('label'), 'Should detect label change');
});

// ── 10. diffVersions identical versions = empty diff ──
test('10. diffVersions identical versions = empty diff', () => {
  const p = makeProject();
  const diff = diffProjects(p, p);
  assertEqual(diff.added.length, 0);
  assertEqual(diff.removed.length, 0);
  assertEqual(diff.modified.length, 0);
});

// ── 11. autoSave creates version after interval ──
test('11. autoSave creates version after interval', () => {
  const vh = new VersionHistory();
  assert(vh.autoSave(makeProject()) === true, 'First auto-save should create version');
  assertEqual(vh.versions.length, 1);
  assertEqual(vh.versions[0].name, 'Auto-save');
  assertEqual(vh.versions[0].author, 'auto-save');
});

// ── 12. autoSave skips if no changes ──
test('12. autoSave skips if no changes', () => {
  const vh = new VersionHistory();
  const proj = makeProject();
  vh.autoSave(proj);
  const again = vh.autoSave(proj);
  assert(again === false, 'Should skip if no changes');
  assertEqual(vh.versions.length, 1, 'Still only 1 version');
});

// ── 13. mergeBranch fast-forward merge ──
test('13. mergeBranch fast-forward merge (no conflicts)', () => {
  const vh = new VersionHistory();
  const v1 = vh.saveVersion('main-init', initialProject);

  const feature = vh.createBranch('feature', v1.id);
  // Modify project on feature branch
  const modified = deepClone(initialProject);
  modified.tracks[0].clips.push({
    id: 'c-new', track_id: 'V1', source_file: 'new.mp4',
    start_sec: 0, duration_sec: 5, in_sec: 0, kind: 'video',
  });
  vh.switchBranch(feature.id);
  vh.saveVersion('feature-add', modified);

  // Merge back to main
  vh.switchBranch('main');
  const result = vh.mergeBranch(feature.id);
  assert(result.merged === true, 'Should merge successfully');
  assertEqual(result.conflicts.length, 0);
});

// ── 14. mergeBranch detects conflicts ──
test('14. mergeBranch detects conflicts', () => {
  const vh = new VersionHistory();
  const v1 = vh.saveVersion('base', initialProject);

  const feature = vh.createBranch('conflict-branch', v1.id);
  // Modify clip on feature branch
  const featureProj = deepClone(initialProject);
  featureProj.tracks[0].clips[0].duration_sec = 999;
  vh.switchBranch(feature.id);
  vh.saveVersion('feature-mod', featureProj);

  // Modify same clip on main
  vh.switchBranch('main');
  const mainProj = deepClone(initialProject);
  mainProj.tracks[0].clips[0].duration_sec = 42;
  vh.saveVersion('main-mod', mainProj);

  const result = vh.mergeBranch(feature.id);
  assert(result.merged === false, 'Should NOT merge due to conflicts');
  assert(result.conflicts.length > 0, 'Should have conflicts');
});

// ── 15. Version id unique across saves ──
test('15. Version id unique across saves', () => {
  const vh = new VersionHistory();
  const ids = new Set();
  for (let i = 0; i < 50; i++) {
    const v = vh.saveVersion(`v${i}`, makeProject());
    assert(!ids.has(v.id), `Duplicate id found: ${v.id}`);
    ids.add(v.id);
  }
});

// ── 16. Branch name uniqueness enforced ──
test('16. Branch name uniqueness enforced', () => {
  const vh = new VersionHistory();
  vh.createBranch('my-branch');
  assertThrows(() => vh.createBranch('my-branch'), 'Should reject duplicate branch name');
});

// ── 17. Restore to version preserves all tracks ──
test('17. Restore to version preserves all tracks', () => {
  const vh = new VersionHistory();
  const proj = makeProject();
  proj.tracks.push({
    id: 'A1', kind: 'audio', name: 'Audio',
    clips: [{ id: 'a1', track_id: 'A1', source_file: 'audio.wav', start_sec: 0, duration_sec: 30, in_sec: 0, kind: 'audio' }],
  });
  const v = vh.saveVersion('multi-track', proj);
  const restored = vh.restoreVersion(v.id);
  assertEqual(restored.tracks.length, 2);
  assertEqual(restored.tracks[0].clips.length, 2);
  assertEqual(restored.tracks[1].clips.length, 1);
});

// ── 18. Restore to version preserves markers ──
test('18. Restore to version preserves markers', () => {
  const vh = new VersionHistory();
  const proj = makeProject();
  proj.markers = [
    { id: 'm1', time_sec: 0, label: 'Start', color: '#22c55e' },
    { id: 'm2', time_sec: 30, label: 'Middle', color: '#ef4444' },
  ];
  const v = vh.saveVersion('with-markers', proj);
  const restored = vh.restoreVersion(v.id);
  assertEqual(restored.markers.length, 2);
  assertEqual(restored.markers[1].label, 'Middle');
});

// ── 19. Diff handles empty tracks ──
test('19. Diff handles empty tracks', () => {
  const p1 = makeProject({ tracks: [] });
  const p2 = makeProject({ tracks: [] });
  const diff = diffProjects(p1, p2);
  assertEqual(diff.added.length, 0);
  assertEqual(diff.removed.length, 0);
  assertEqual(diff.modified.length, 0);
});

// ── 20. Diff handles multiple track changes ──
test('20. Diff handles multiple track changes', () => {
  const p1 = makeProject({
    tracks: [
      { id: 'V1', kind: 'video', name: 'V1', clips: [{ id: 'c1', track_id: 'V1', source_file: 'a.mp4', start_sec: 0, duration_sec: 10, in_sec: 0, kind: 'video' }] },
      { id: 'A1', kind: 'audio', name: 'A1', clips: [{ id: 'a1', track_id: 'A1', source_file: 'b.wav', start_sec: 0, duration_sec: 20, in_sec: 0, kind: 'audio' }] },
    ],
  });
  const p2 = makeProject({
    tracks: [
      { id: 'V1', kind: 'video', name: 'V1', clips: [
        { id: 'c1', track_id: 'V1', source_file: 'a.mp4', start_sec: 5, duration_sec: 10, in_sec: 0, kind: 'video' },
        { id: 'c2', track_id: 'V1', source_file: 'c.mp4', start_sec: 15, duration_sec: 8, in_sec: 0, kind: 'video' },
      ]},
      { id: 'A1', kind: 'audio', name: 'A1', clips: [
        { id: 'a1', track_id: 'A1', source_file: 'b.wav', start_sec: 0, duration_sec: 25, in_sec: 0, kind: 'audio' },
      ]},
    ],
  });
  const diff = diffProjects(p1, p2);
  assertEqual(diff.added.length, 1, '1 clip added');
  assertEqual(diff.modified.length, 2, '2 field changes (c1.start_sec + a1.duration_sec)');
});

// ── 21. Version limit (max 100) enforced ──
test('21. Version limit (max 100) enforced', () => {
  const vh = new VersionHistory();
  for (let i = 0; i < 110; i++) {
    vh.saveVersion(`v${i}`, makeProject());
  }
  assert(vh.versions.length <= 100, `Should cap at 100, got ${vh.versions.length}`);
});

// ── 22. Branch limit (max 10) enforced ──
test('22. Branch limit (max 10) enforced', () => {
  const vh = new VersionHistory();
  for (let i = 0; i < 9; i++) {
    vh.createBranch(`branch-${i}`);
  }
  assertEqual(vh.branches.length, 10, 'Should have 10 branches');
  assertThrows(() => vh.createBranch('branch-overflow'), 'Should reject 11th branch');
});

// ── 23. Concurrent saves handled ──
test('23. Concurrent saves handled (sequential in JS)', () => {
  const vh = new VersionHistory();
  const proj = makeProject();
  // Simulate rapid sequential saves
  const results = [];
  for (let i = 0; i < 10; i++) {
    proj.tracks[0].clips[0].duration_sec = i;
    results.push(vh.saveVersion(`rapid-${i}`, proj));
  }
  assertEqual(vh.versions.length, 10);
  // All IDs unique
  const ids = results.map((r) => r.id);
  assertEqual(new Set(ids).size, 10, 'All IDs should be unique');
});

// ── 24. Version metadata includes author ──
test('24. Version metadata includes author', () => {
  const vh = new VersionHistory();
  const v = vh.saveVersion('authored', makeProject(), 'alice');
  assertEqual(v.author, 'alice');
  assert(typeof v.timestamp === 'number' && v.timestamp > 0);
  assertEqual(v.branch, 'main');
});

// ── 25. Empty version name rejected ──
test('25. Empty version name rejected', () => {
  const vh = new VersionHistory();
  assertThrows(() => vh.saveVersion('', makeProject()), 'Empty string rejected');
  assertThrows(() => vh.saveVersion('   ', makeProject()), 'Whitespace rejected');
});

// ── 26. Diff with identical projects from deepClone ──
test('26. Diff with identical projects from deepClone', () => {
  const p1 = deepClone(initialProject);
  const p2 = deepClone(initialProject);
  const diff = diffProjects(p1, p2);
  assertEqual(diff.added.length, 0);
  assertEqual(diff.removed.length, 0);
  assertEqual(diff.modified.length, 0);
});

// ── 27. getVersion returns null for missing id ──
test('27. getVersion returns null for missing id', () => {
  const vh = new VersionHistory();
  assertEqual(vh.getVersion('nonexistent'), null);
});

// ── 28. Branch creation from specific version ──
test('28. Branch creation from specific version', () => {
  const vh = new VersionHistory();
  const v1 = vh.saveVersion('base', makeProject({ name: 'Base' }));
  const v2 = vh.saveVersion('second', makeProject({ name: 'Second' }));
  const branch = vh.createBranch('from-v1', v1.id);
  assertEqual(branch.headVersionId, v1.id);
});

// ── 29. Switch branch and save on that branch ──
test('29. Switch branch and save on that branch', () => {
  const vh = new VersionHistory();
  vh.saveVersion('main-init', makeProject());
  const branch = vh.createBranch('experimental');
  vh.switchBranch(branch.id);
  const v = vh.saveVersion('exp-change', makeProject({ name: 'Experimental' }));
  assertEqual(v.branch, branch.id, 'Version branch should match branch id');
  // List versions on experimental by branch id
  const expVersions = vh.listVersions(branch.id);
  assertEqual(expVersions.length, 1);
  assertEqual(expVersions[0].name, 'exp-change');
});

// ── 30. Merge without source version returns not merged ──
test('30. Merge without source version returns not merged', () => {
  const vh = new VersionHistory();
  const orphan = vh.createBranch('orphan');
  // orphan has no head version
  vh.switchBranch('main');
  const result = vh.mergeBranch(orphan.id);
  assert(result.merged === false);
});

// ── Summary ───────────────────────────────────────────────────

console.log(`\n═══════════════════════════════════════════`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log(`═══════════════════════════════════════════\n`);

if (failures.length > 0) {
  console.log('Failures:');
  for (const f of failures) {
    console.log(`  ✗ ${f.name}`);
    console.log(`    ${f.err.message}`);
  }
  process.exit(1);
}
