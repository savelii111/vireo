// useVersionControl.ts — Full version control with named versions, branching, and diff.
//
// Expands the undo/redo history in useEditor into a richer model:
//   - Named versions (snapshots of ProjectState)
//   - Branches (independent lines of history)
//   - Diff between any two versions
//   - Auto-save on a configurable interval

import { useCallback, useRef, useState } from 'react';
import type { ProjectState, Clip, Track, Marker } from '../types';

// ── Public types ──────────────────────────────────────────────

export interface Version {
  id: string;
  name: string;
  project: ProjectState;
  timestamp: number;
  author: string;
  branch: string;
}

export interface Branch {
  id: string;
  name: string;
  headVersionId: string;
  createdAt: number;
}

export interface ClipDiff {
  clipId: string;
  trackId: string;
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface DiffResult {
  added: { clipId: string; trackId: string }[];
  removed: { clipId: string; trackId: string }[];
  modified: ClipDiff[];
}

export interface MergeResult {
  conflicts: ClipDiff[];
  merged: boolean;
}

// ── Constants ─────────────────────────────────────────────────

const MAX_VERSIONS = 100;
const MAX_BRANCHES = 10;
const AUTO_SAVE_INTERVAL_MS = 30_000;

// ── Helpers ───────────────────────────────────────────────────

function uid(prefix = 'v'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

function collectClipIds(project: ProjectState): Map<string, string> {
  const map = new Map<string, string>();
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      map.set(clip.id, track.id);
    }
  }
  return map;
}

// ── Hook ──────────────────────────────────────────────────────

export function useVersionControl(initialBranch = 'main') {
  const [versions, setVersions] = useState<Version[]>([]);
  const [branches, setBranches] = useState<Branch[]>([
    { id: 'main', name: 'main', headVersionId: '', createdAt: Date.now() },
  ]);
  const [currentBranch, setCurrentBranch] = useState<string>(initialBranch);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(true);

  // Refs for stable references inside timers / callbacks
  const versionsRef = useRef<Version[]>(versions);
  const branchesRef = useRef<Branch[]>(branches);
  const currentBranchRef = useRef<string>(currentBranch);
  const lastSavedHashRef = useRef<string>('');
  const autoSaveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentProjectRef = useRef<ProjectState | null>(null);

  // Keep refs in sync
  versionsRef.current = versions;
  branchesRef.current = branches;
  currentBranchRef.current = currentBranch;

  // ── Version CRUD ──────────────────────────────────────────

  const saveVersion = useCallback(
    (name: string, project: ProjectState, author = 'user'): Version => {
      if (!name || name.trim().length === 0) {
        throw new Error('Version name cannot be empty');
      }

      const version: Version = {
        id: uid('ver'),
        name: name.trim(),
        project: deepClone(project),
        timestamp: Date.now(),
        author,
        branch: currentBranchRef.current,
      };

      setVersions((prev) => {
        let next = [version, ...prev];
        // Enforce version cap
        if (next.length > MAX_VERSIONS) {
          next = next.slice(0, MAX_VERSIONS);
        }
        return next;
      });

      // Update branch head
      setBranches((prev) =>
        prev.map((b) =>
          b.id === currentBranchRef.current
            ? { ...b, headVersionId: version.id }
            : b,
        ),
      );

      return version;
    },
    [],
  );

  const listVersions = useCallback(
    (branchFilter?: string): Version[] => {
      const filtered = branchFilter
        ? versions.filter((v) => v.branch === branchFilter)
        : versions;
      // Newest first (already sorted by insertion, but sort for safety)
      return [...filtered].sort((a, b) => b.timestamp - a.timestamp);
    },
    [versions],
  );

  const getVersion = useCallback(
    (id: string): Version | null => {
      return versions.find((v) => v.id === id) ?? null;
    },
    [versions],
  );

  const restoreVersion = useCallback(
    (id: string): ProjectState => {
      const version = versions.find((v) => v.id === id);
      if (!version) {
        throw new Error(`Version ${id} not found`);
      }
      return deepClone(version.project);
    },
    [versions],
  );

  // ── Branch CRUD ───────────────────────────────────────────

  const createBranch = useCallback(
    (name: string, fromVersionId?: string): Branch => {
      if (!name || name.trim().length === 0) {
        throw new Error('Branch name cannot be empty');
      }

      const trimmedName = name.trim();
      const newId = uid('br');

      setBranches((prev) => {
        // Enforce uniqueness
        if (prev.some((b) => b.name === trimmedName)) {
          throw new Error(`Branch "${trimmedName}" already exists`);
        }
        // Enforce limit
        if (prev.length >= MAX_BRANCHES) {
          throw new Error(`Maximum of ${MAX_BRANCHES} branches reached`);
        }

        const headId = fromVersionId ?? prev.find((b) => b.id === 'main')?.headVersionId ?? '';

        const newBranch: Branch = {
          id: newId,
          name: trimmedName,
          headVersionId: headId,
          createdAt: Date.now(),
        };

        return [...prev, newBranch];
      });

      const headId = fromVersionId ?? branchesRef.current.find((b) => b.id === 'main')?.headVersionId ?? '';
      return {
        id: newId,
        name: trimmedName,
        headVersionId: headId,
        createdAt: Date.now(),
      };
    },
    [],
  );

  const listBranches = useCallback((): Branch[] => {
    return [...branches];
  }, [branches]);

  const switchBranch = useCallback((branchId: string) => {
    setCurrentBranch(branchId);
  }, []);

  // ── Merge ─────────────────────────────────────────────────

  const mergeBranch = useCallback(
    (branchId: string): MergeResult => {
      const sourceBranch = branches.find((b) => b.id === branchId);
      if (!sourceBranch) {
        throw new Error(`Branch ${branchId} not found`);
      }

      // Get source project from head version
      const sourceVersion = versions.find((v) => v.id === sourceBranch.headVersionId);
      if (!sourceVersion) {
        return { conflicts: [], merged: false };
      }

      // Get target (current branch) head version
      const targetBranch = branches.find((b) => b.id === currentBranchRef.current);
      if (!targetBranch) {
        return { conflicts: [], merged: false };
      }
      const targetVersion = versions.find((v) => v.id === targetBranch.headVersionId);
      if (!targetVersion) {
        return { conflicts: [], merged: false };
      }

      // Diff to detect conflicts
      const diff = diffProjects(targetVersion.project, sourceVersion.project);
      const conflicts: ClipDiff[] = diff.modified; // Simplified: modified = potential conflicts

      if (conflicts.length > 0) {
        return { conflicts, merged: false };
      }

      // Fast-forward: source is ahead, no conflicts → adopt source state
      return { conflicts: [], merged: true };
    },
    [branches, versions],
  );

  // ── Diff ──────────────────────────────────────────────────

  const diffVersions = useCallback(
    (id1: string, id2: string): DiffResult => {
      const v1 = versions.find((v) => v.id === id1);
      const v2 = versions.find((v) => v.id === id2);
      if (!v1 || !v2) {
        throw new Error('One or both versions not found');
      }
      return diffProjects(v1.project, v2.project);
    },
    [versions],
  );

  // ── Auto-save ─────────────────────────────────────────────

  const startAutoSave = useCallback(
    (getProject: () => ProjectState, intervalMs = AUTO_SAVE_INTERVAL_MS) => {
      if (autoSaveTimerRef.current) {
        clearInterval(autoSaveTimerRef.current);
      }

      autoSaveTimerRef.current = setInterval(() => {
        if (!autoSaveEnabled) return;

        const project = getProject();
        currentProjectRef.current = project;
        const hash = JSON.stringify(project);
        if (hash === lastSavedHashRef.current) {
          return; // No changes — skip
        }
        lastSavedHashRef.current = hash;
        saveVersion(`Auto-save`, project, 'auto-save');
      }, intervalMs);
    },
    [autoSaveEnabled, saveVersion],
  );

  const stopAutoSave = useCallback(() => {
    if (autoSaveTimerRef.current) {
      clearInterval(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
  }, []);

  // ── Return ────────────────────────────────────────────────

  return {
    saveVersion,
    listVersions,
    getVersion,
    restoreVersion,
    createBranch,
    listBranches,
    switchBranch,
    currentBranch,
    mergeBranch,
    diffVersions,
    startAutoSave,
    stopAutoSave,
    autoSaveEnabled,
    setAutoSaveEnabled,
    versions,
    branches,
  };
}

// ── Pure diff helper (exported for testing) ───────────────────

export function diffProjects(p1: ProjectState, p2: ProjectState): DiffResult {
  const added: DiffResult['added'] = [];
  const removed: DiffResult['removed'] = [];
  const modified: ClipDiff[] = [];

  const clips1 = collectClipIds(p1);
  const clips2 = collectClipIds(p2);

  // Clips in p2 but not p1 → added
  for (const [clipId, trackId] of clips2) {
    if (!clips1.has(clipId)) {
      added.push({ clipId, trackId });
    }
  }

  // Clips in p1 but not p2 → removed
  for (const [clipId, trackId] of clips1) {
    if (!clips2.has(clipId)) {
      removed.push({ clipId, trackId });
    }
  }

  // Clips in both → check for modifications
  const allClipMap1 = new Map<string, Clip>();
  const allClipMap2 = new Map<string, Clip>();
  for (const track of p1.tracks) {
    for (const clip of track.clips) {
      allClipMap1.set(clip.id, clip);
    }
  }
  for (const track of p2.tracks) {
    for (const clip of track.clips) {
      allClipMap2.set(clip.id, clip);
    }
  }

  const fieldsToCompare: (keyof Clip)[] = [
    'start_sec',
    'duration_sec',
    'in_sec',
    'source_file',
    'label',
    'selected',
    'kind',
    'track_id',
    'thumbnail_color',
  ];

  for (const [clipId] of clips1) {
    if (!clips2.has(clipId)) continue;
    const c1 = allClipMap1.get(clipId)!;
    const c2 = allClipMap2.get(clipId)!;
    for (const field of fieldsToCompare) {
      if (c1[field] !== c2[field]) {
        modified.push({
          clipId,
          trackId: c1.track_id,
          field,
          oldValue: c1[field],
          newValue: c2[field],
        });
      }
    }
  }

  return { added, removed, modified };
}
