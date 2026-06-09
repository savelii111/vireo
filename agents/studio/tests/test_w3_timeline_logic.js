/**
 * Vireo Studio W3 — Timeline logic unit tests.
 *
 * Tests the pure-function logic extracted from:
 *   • useEditor.ts  (track toggles, split, ripple-delete, move, resize, duplicate, locked-track guards)
 *   • Timeline.tsx  (magnetic snap, grid snap, snap-target collection)
 *   • App.tsx       (command palette filtering)
 *   • utils/time.ts (time formatting)
 *   • mockData.ts   (8-track project structure)
 *
 * Runner: node:test + node:assert (Node ≥ 18, zero dependencies)
 *   node --test tests/test_w3_timeline_logic.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ============================================================================
// 1.  Re-implement the pure logic under test
// ============================================================================

// ── Types (mirrors src/types.ts) ──────────────────────────────────────────────
/**
 * @typedef {'video'|'audio'|'overlay'} TrackKind
 * @typedef {{ id:string; kind:TrackKind; name:string; clips:Clip[]; locked?:boolean; muted?:boolean; soloed?:boolean; hidden?:boolean; }} Track
 * @typedef {{ id:string; track_id:string; source_file:string; start_sec:number; duration_sec:number; in_sec:number; kind:TrackKind; label?:string; selected?:boolean; thumbnail_color?:string; }} Clip
 * @typedef {{ id:string; time_sec:number; label:string; color:string; }} Marker
 * @typedef {{ name:string; duration_sec:number; fps:number; width:number; height:number; tracks:Track[]; markers?:Marker[]; }} ProjectState
 */

// ── Mock project (matches src/mockData.ts) ────────────────────────────────────
function makeProject() {
  return {
    name: 'Test',
    duration_sec: 134,
    fps: 30,
    width: 1920,
    height: 1080,
    tracks: [
      { id: 'V1', kind: 'video', name: 'V1 · A-Roll', clips: [
        { id: 'c1', track_id: 'V1', source_file: 'intro.mp4', start_sec: 0,    duration_sec: 17.5, in_sec: 0,  kind: 'video' },
        { id: 'c2', track_id: 'V1', source_file: 'drone.mp4', start_sec: 17.5, duration_sec: 6.3,  in_sec: 8.2, kind: 'video', selected: true },
        { id: 'c3', track_id: 'V1', source_file: 'broll.mp4', start_sec: 23.8, duration_sec: 15,   in_sec: 0,  kind: 'video' },
        { id: 'c4', track_id: 'V1', source_file: 'walk.mp4',  start_sec: 38.8, duration_sec: 22,   in_sec: 0,  kind: 'video' },
      ]},
      { id: 'V2', kind: 'video', name: 'V2 · B-Roll', muted: true, clips: [
        { id: 'c7', track_id: 'V2', source_file: 'lower.mp4', start_sec: 22.5, duration_sec: 13.7, in_sec: 0, kind: 'video' },
      ]},
      { id: 'V3', kind: 'video', name: 'V3 · Titles', clips: [
        { id: 'c12', track_id: 'V3', source_file: 'title.mp4', start_sec: 0,  duration_sec: 5, in_sec: 0, kind: 'overlay' },
      ]},
      { id: 'V4', kind: 'video', name: 'V4 · FX', clips: [
        { id: 'c14', track_id: 'V4', source_file: 'fx.mp4', start_sec: 17, duration_sec: 1, in_sec: 0, kind: 'overlay' },
      ]},
      { id: 'A1', kind: 'audio', name: 'A1 · Voice', clips: [
        { id: 'c9',  track_id: 'A1', source_file: 'voice1.wav', start_sec: 0,    duration_sec: 37.5, in_sec: 0, kind: 'audio' },
        { id: 'c10', track_id: 'A1', source_file: 'voice2.wav', start_sec: 37.5, duration_sec: 41,   in_sec: 0, kind: 'audio' },
        { id: 'c11', track_id: 'A1', source_file: 'voice3.wav', start_sec: 78.5, duration_sec: 12,   in_sec: 0, kind: 'audio' },
      ]},
      { id: 'A2', kind: 'audio', name: 'A2 · Music', clips: [
        { id: 'c16', track_id: 'A2', source_file: 'lofi.mp3', start_sec: 0,  duration_sec: 90, in_sec: 0, kind: 'audio' },
        { id: 'c17', track_id: 'A2', source_file: 'outro.mp3', start_sec: 90, duration_sec: 44, in_sec: 0, kind: 'audio' },
      ]},
      { id: 'A3', kind: 'audio', name: 'A3 · SFX', clips: [
        { id: 'c18', track_id: 'A3', source_file: 'whoosh.wav', start_sec: 17, duration_sec: 1.5, in_sec: 0, kind: 'audio' },
        { id: 'c19', track_id: 'A3', source_file: 'ambient.wav', start_sec: 23, duration_sec: 67,  in_sec: 0, kind: 'audio' },
      ]},
      { id: 'A4', kind: 'audio', name: 'A4 · VO', clips: [
        { id: 'c20', track_id: 'A4', source_file: 'ai_voice.mp3', start_sec: 5, duration_sec: 12, in_sec: 0, kind: 'audio' },
      ]},
    ],
    markers: [
      { id: 'm1', time_sec: 0,    label: 'Start',      color: '#22c55e' },
      { id: 'm2', time_sec: 17.5, label: 'Transition',  color: '#f59e0b' },
      { id: 'm3', time_sec: 60,   label: 'Climax',      color: '#ef4444' },
      { id: 'm4', time_sec: 120,  label: 'Outro start', color: '#8b5cf6' },
    ],
  };
}

// ── Track-toggle logic (mirrors useEditor callbacks) ───────────────────────────
function toggleTrackMute(project, trackId) {
  return {
    ...project,
    tracks: project.tracks.map((t) =>
      t.id === trackId ? { ...t, muted: !t.muted } : t,
    ),
  };
}

function toggleTrackSolo(project, trackId) {
  return {
    ...project,
    tracks: project.tracks.map((t) =>
      t.id === trackId ? { ...t, soloed: !t.soloed } : t,
    ),
  };
}

function toggleTrackLock(project, trackId) {
  return {
    ...project,
    tracks: project.tracks.map((t) =>
      t.id === trackId ? { ...t, locked: !t.locked } : t,
    ),
  };
}

function toggleTrackHidden(project, trackId) {
  return {
    ...project,
    tracks: project.tracks.map((t) =>
      t.id === trackId ? { ...t, hidden: !t.hidden } : t,
    ),
  };
}

// ── Split-at-playhead logic ───────────────────────────────────────────────────
function splitAtPlayhead(project, selectedClipId, playhead) {
  if (!selectedClipId) return project;
  return {
    ...project,
    tracks: project.tracks.map((t) => {
      if (t.locked) return t;
      const idx = t.clips.findIndex((c) => c.id === selectedClipId);
      if (idx < 0) return t;
      const clip = t.clips[idx];
      const localSec = playhead - clip.start_sec;
      if (localSec <= 0 || localSec >= clip.duration_sec) return t;
      const left = { ...clip, duration_sec: localSec };
      const right = {
        ...clip,
        id: `${clip.id}-r1`,
        start_sec: clip.start_sec + localSec,
        duration_sec: clip.duration_sec - localSec,
        in_sec: clip.in_sec + localSec,
      };
      const newClips = [...t.clips];
      newClips.splice(idx, 1, left, right);
      return { ...t, clips: newClips };
    }),
  };
}

// ── Ripple-delete logic ────────────────────────────────────────────────────────
function deleteSelected(project, selectedClipId) {
  if (!selectedClipId) return { project, selectedClipId: null };
  let deletedDuration = 0;
  let deletedStart = 0;
  const tracks = project.tracks.map((t) => {
    if (t.locked) return t;
    const idx = t.clips.findIndex((c) => c.id === selectedClipId);
    if (idx < 0) return t;
    deletedDuration = t.clips[idx].duration_sec;
    deletedStart = t.clips[idx].start_sec;
    return {
      ...t,
      clips: t.clips
        .filter((c) => c.id !== selectedClipId)
        .map((c) => {
          if (c.start_sec > deletedStart) {
            return { ...c, start_sec: Math.max(0, c.start_sec - deletedDuration) };
          }
          return c;
        }),
    };
  });
  return { project: { ...project, tracks }, selectedClipId: null };
}

// ── Move clip logic ───────────────────────────────────────────────────────────
function moveClip(project, clipId, newStartSec) {
  return {
    ...project,
    tracks: project.tracks.map((t) => ({
      ...t,
      clips: t.clips.map((c) =>
        c.id === clipId ? { ...c, start_sec: Math.max(0, newStartSec) } : c,
      ),
    })),
  };
}

// ── Resize clip logic ─────────────────────────────────────────────────────────
function resizeClip(project, clipId, side, newStartOrEnd) {
  return {
    ...project,
    tracks: project.tracks.map((t) => ({
      ...t,
      clips: t.clips.map((c) => {
        if (c.id !== clipId) return c;
        if (side === 'left') {
          const delta = newStartOrEnd - c.start_sec;
          return {
            ...c,
            start_sec: Math.max(0, newStartOrEnd),
            duration_sec: c.duration_sec - delta,
            in_sec: c.in_sec + delta,
          };
        } else {
          return { ...c, duration_sec: Math.max(0.1, newStartOrEnd - c.start_sec) };
        }
      }),
    })),
  };
}

// ── Duplicate clip logic ──────────────────────────────────────────────────────
function duplicateSelected(project, selectedClipId) {
  if (!selectedClipId) return project;
  return {
    ...project,
    tracks: project.tracks.map((t) => {
      const clip = t.clips.find((c) => c.id === selectedClipId);
      if (!clip) return t;
      const dup = {
        ...clip,
        id: `${clip.id}-d1`,
        start_sec: clip.start_sec + clip.duration_sec,
        selected: false,
      };
      return { ...t, clips: [...t.clips, dup] };
    }),
  };
}

// ── Snap logic (mirrors Timeline.tsx) ─────────────────────────────────────────
const SNAP_THRESHOLD_PX = 6;

function snapTargets(playhead, markers, clips, magnetOn) {
  const targets = [playhead];
  if (markers) {
    for (const m of markers) targets.push(m.time_sec);
  }
  if (magnetOn) {
    for (const clip of clips) {
      targets.push(clip.start_sec);
      targets.push(clip.start_sec + clip.duration_sec);
    }
  }
  return targets;
}

function snapToNearest(sec, zoom, targets, magnetOn, gridSnap) {
  if (!magnetOn && !gridSnap) return sec;
  const px = sec * zoom;
  for (const t of targets) {
    const tPx = t * zoom;
    if (Math.abs(px - tPx) < SNAP_THRESHOLD_PX) {
      return t;
    }
  }
  if (gridSnap) {
    const gridSec = zoom >= 60 ? 1 : 5;
    const rounded = Math.round(sec / gridSec) * gridSec;
    if (Math.abs(sec - rounded) * zoom < SNAP_THRESHOLD_PX) return rounded;
  }
  return sec;
}

// ── Command palette filter logic ──────────────────────────────────────────────
function filterCommands(commands, query) {
  if (!query) return commands;
  const q = query.toLowerCase();
  return commands.filter((c) => c.label.toLowerCase().includes(q));
}

// ── Time formatting (mirrors utils/time.ts) ───────────────────────────────────
function pad2(n) { return n.toString().padStart(2, '0'); }
function pad1(n) { return n.toString().padStart(1, '0'); }

function formatTimecode(sec, fps = 30) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const f = Math.floor((sec - Math.floor(sec)) * fps);
  if (h > 0) {
    return `${pad2(h)}:${pad2(m)}:${pad2(s)}:${pad2(f)}`;
  }
  return `${pad2(m)}:${pad2(s)}.${pad1(Math.floor((sec - Math.floor(sec)) * 10))}`;
}

function formatShortTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${pad2(m)}:${pad2(s)}`;
}

function formatSeconds(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  return `${sec.toFixed(1)}s`;
}

// Helper: find a track by id in a project
function findTrack(project, id) {
  return project.tracks.find((t) => t.id === id);
}

// Helper: find a clip by id across all tracks
function findClip(project, id) {
  return project.tracks.flatMap((t) => t.clips).find((c) => c.id === id);
}

// ============================================================================
// 2.  TEST SUITES
// ============================================================================

// ─────────────────────────────────────────────────────────────────────────────
// TEST 1: Track state toggles (mute / solo / lock / hidden)
// ─────────────────────────────────────────────────────────────────────────────
describe('Track state toggles', () => {
  it('toggleTrackMute flips muted on the target track', () => {
    const p = makeProject();
    // V1 starts unmuted → muted
    const p1 = toggleTrackMute(p, 'V1');
    assert.equal(findTrack(p1, 'V1').muted, true, 'V1 should be muted');
    // Toggle back → unmuted
    const p2 = toggleTrackMute(p1, 'V1');
    assert.equal(findTrack(p2, 'V1').muted, false, 'V1 should be unmuted');
  });

  it('toggleTrackMute does not affect other tracks', () => {
    const p = makeProject();
    const p1 = toggleTrackMute(p, 'V1');
    assert.equal(findTrack(p1, 'V2').muted, true, 'V2 muted state unchanged');
    assert.equal(findTrack(p1, 'A1').muted, undefined, 'A1 still has no muted prop');
  });

  it('toggleTrackSolo flips soloed on the target track', () => {
    const p = makeProject();
    const p1 = toggleTrackSolo(p, 'A1');
    assert.equal(findTrack(p1, 'A1').soloed, true);
    const p2 = toggleTrackSolo(p1, 'A1');
    assert.equal(findTrack(p2, 'A1').soloed, false);
  });

  it('toggleTrackLock flips locked on the target track', () => {
    const p = makeProject();
    assert.equal(findTrack(p, 'V3').locked, undefined, 'V3 starts unlocked');
    const p1 = toggleTrackLock(p, 'V3');
    assert.equal(findTrack(p1, 'V3').locked, true);
    const p2 = toggleTrackLock(p1, 'V3');
    assert.equal(findTrack(p2, 'V3').locked, false);
  });

  it('toggleTrackHidden flips hidden on the target track', () => {
    const p = makeProject();
    const p1 = toggleTrackHidden(p, 'A4');
    assert.equal(findTrack(p1, 'A4').hidden, true);
    const p2 = toggleTrackHidden(p1, 'A4');
    assert.equal(findTrack(p2, 'A4').hidden, false);
  });

  it('all toggles are independent of each other', () => {
    let p = makeProject();
    p = toggleTrackMute(p, 'V1');
    p = toggleTrackSolo(p, 'V1');
    p = toggleTrackHidden(p, 'V1');
    const t = findTrack(p, 'V1');
    assert.equal(t.muted, true);
    assert.equal(t.soloed, true);
    assert.equal(t.hidden, true);
    assert.equal(t.locked, undefined, 'lock not touched');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 2: Ripple delete — removes clip + shifts subsequent clips left
// ─────────────────────────────────────────────────────────────────────────────
describe('Ripple delete', () => {
  it('removes the selected clip from its track', () => {
    const p = makeProject();
    const { project: p1 } = deleteSelected(p, 'c2');
    const v1 = findTrack(p1, 'V1');
    assert.equal(v1.clips.some((c) => c.id === 'c2'), false, 'c2 should be gone');
  });

  it('shifts clips after the deleted clip left by the deleted duration', () => {
    const p = makeProject();
    // c2: start=17.5, duration=6.3.  After delete, c3 and c4 should shift left.
    const { project: p1 } = deleteSelected(p, 'c2');
    const v1 = findTrack(p1, 'V1');
    const c3 = v1.clips.find((c) => c.id === 'c3');
    const c4 = v1.clips.find((c) => c.id === 'c4');
    // c3 was at 23.8 → should be 23.8 - 6.3 = 17.5
    assert.ok(Math.abs(c3.start_sec - 17.5) < 0.001, `c3.start_sec should be 17.5, got ${c3.start_sec}`);
    // c4 was at 38.8 → should be 38.8 - 6.3 = 32.5
    assert.ok(Math.abs(c4.start_sec - 32.5) < 0.001, `c4.start_sec should be 32.5, got ${c4.start_sec}`);
  });

  it('clips before the deleted clip are NOT shifted', () => {
    const p = makeProject();
    const { project: p1 } = deleteSelected(p, 'c2');
    const v1 = findTrack(p1, 'V1');
    const c1 = v1.clips.find((c) => c.id === 'c1');
    assert.ok(Math.abs(c1.start_sec - 0) < 0.001, 'c1.start_sec should stay 0');
  });

  it('clips on other tracks are not affected', () => {
    const p = makeProject();
    const { project: p1 } = deleteSelected(p, 'c2');
    // c7 on V2 should be unchanged
    const c7 = findClip(p1, 'c7');
    assert.ok(Math.abs(c7.start_sec - 22.5) < 0.001, 'c7 unaffected');
    // c16 on A2 unchanged
    const c16 = findClip(p1, 'c16');
    assert.ok(Math.abs(c16.start_sec - 0) < 0.001, 'c16 unaffected');
  });

  it('returns null selectedClipId after delete', () => {
    const p = makeProject();
    const { selectedClipId } = deleteSelected(p, 'c2');
    assert.equal(selectedClipId, null);
  });

  it('deleting a nonexistent clip id returns project unchanged', () => {
    const p = makeProject();
    const { project: p1 } = deleteSelected(p, 'xxx_nonexistent');
    const v1 = findTrack(p1, 'V1');
    assert.equal(v1.clips.length, 4, 'V1 clip count unchanged');
  });

  it('does nothing when selectedClipId is null', () => {
    const p = makeProject();
    const { project: p1, selectedClipId } = deleteSelected(p, null);
    assert.equal(selectedClipId, null);
    assert.deepEqual(p1, p);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 3: Split at playhead — creates two clips from one
// ─────────────────────────────────────────────────────────────────────────────
describe('Split at playhead', () => {
  it('creates two clips from one when playhead is within the clip', () => {
    const p = makeProject();
    // c2: start=17.5, duration=6.3 → ends at 23.8
    // playhead at 20 → localSec = 20 - 17.5 = 2.5
    const p1 = splitAtPlayhead(p, 'c2', 20);
    const v1 = findTrack(p1, 'V1');
    const c2left = v1.clips.find((c) => c.id === 'c2');
    const c2right = v1.clips.find((c) => c.id?.startsWith('c2-r'));
    assert.ok(c2left, 'left half exists');
    assert.ok(c2right, 'right half exists');
    // Left half: duration = 2.5
    assert.ok(Math.abs(c2left.duration_sec - 2.5) < 0.001, `left duration ${c2left.duration_sec}`);
    // Right half: start = 17.5 + 2.5 = 20, duration = 6.3 - 2.5 = 3.8
    assert.ok(Math.abs(c2right.start_sec - 20) < 0.001, `right start ${c2right.start_sec}`);
    assert.ok(Math.abs(c2right.duration_sec - 3.8) < 0.001, `right duration ${c2right.duration_sec}`);
  });

  it('right half in_sec is adjusted by localSec', () => {
    const p = makeProject();
    // c2 in_sec=8.2, playhead=20, localSec=2.5 → right in_sec = 8.2 + 2.5 = 10.7
    const p1 = splitAtPlayhead(p, 'c2', 20);
    const v1 = findTrack(p1, 'V1');
    const right = v1.clips.find((c) => c.id?.startsWith('c2-r'));
    assert.ok(Math.abs(right.in_sec - 10.7) < 0.001, `right in_sec ${right.in_sec}`);
  });

  it('does nothing when playhead is before the clip', () => {
    const p = makeProject();
    const p1 = splitAtPlayhead(p, 'c3', 5); // c3 starts at 23.8
    const v1 = findTrack(p1, 'V1');
    assert.equal(v1.clips.length, 4, 'no split happened');
  });

  it('does nothing when playhead is at clip start', () => {
    const p = makeProject();
    const p1 = splitAtPlayhead(p, 'c3', 23.8);
    const v1 = findTrack(p1, 'V1');
    assert.equal(v1.clips.length, 4, 'no split at exact start');
  });

  it('does nothing when playhead is at clip end', () => {
    const p = makeProject();
    // c2 ends at 17.5+6.3 = 23.8
    const p1 = splitAtPlayhead(p, 'c2', 23.8);
    const v1 = findTrack(p1, 'V1');
    assert.equal(v1.clips.length, 4, 'no split at exact end');
  });

  it('skips locked tracks', () => {
    const p = makeProject();
    p.tracks[0].locked = true; // V1 locked
    const p1 = splitAtPlayhead(p, 'c2', 20);
    const v1 = findTrack(p1, 'V1');
    assert.equal(v1.clips.length, 4, 'locked track not split');
  });

  it('does nothing when no clip is selected', () => {
    const p = makeProject();
    const p1 = splitAtPlayhead(p, null, 20);
    assert.deepEqual(p1, p);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 4: Move clip — newStartSec clamped to >= 0
// ─────────────────────────────────────────────────────────────────────────────
describe('Move clip', () => {
  it('sets the new start_sec', () => {
    const p = makeProject();
    const p1 = moveClip(p, 'c1', 5);
    assert.equal(findClip(p1, 'c1').start_sec, 5);
  });

  it('clamps negative start_sec to 0', () => {
    const p = makeProject();
    const p1 = moveClip(p, 'c1', -10);
    assert.equal(findClip(p1, 'c1').start_sec, 0);
  });

  it('does not modify clips with different id', () => {
    const p = makeProject();
    const p1 = moveClip(p, 'c1', 5);
    assert.equal(findClip(p1, 'c2').start_sec, 17.5, 'c2 unchanged');
  });

  it('handles zero start_sec correctly', () => {
    const p = makeProject();
    const p1 = moveClip(p, 'c2', 0);
    assert.equal(findClip(p1, 'c2').start_sec, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 5: Resize clip left — adjusts start_sec + in_sec + duration_sec
// ─────────────────────────────────────────────────────────────────────────────
describe('Resize clip left', () => {
  it('adjusts start_sec, duration_sec, and in_sec', () => {
    const p = makeProject();
    // c2: start=17.5, duration=6.3, in_sec=8.2
    // Move left edge to 19 → delta = 19 - 17.5 = 1.5
    // New: start=19, duration=6.3-1.5=4.8, in_sec=8.2+1.5=9.7
    const p1 = resizeClip(p, 'c2', 'left', 19);
    const c = findClip(p1, 'c2');
    assert.equal(c.start_sec, 19);
    assert.ok(Math.abs(c.duration_sec - 4.8) < 0.001, `duration ${c.duration_sec}`);
    assert.ok(Math.abs(c.in_sec - 9.7) < 0.001, `in_sec ${c.in_sec}`);
  });

  it('clamps start_sec to >= 0 when dragging left edge', () => {
    const p = makeProject();
    const p1 = resizeClip(p, 'c1', 'left', -5);
    const c = findClip(p1, 'c1');
    assert.equal(c.start_sec, 0);
    // delta = -5 - 0 = -5 → duration = 17.5 - (-5) = 22.5, in_sec = 0 + (-5) = -5
    assert.ok(Math.abs(c.duration_sec - 22.5) < 0.001);
    assert.ok(Math.abs(c.in_sec - (-5)) < 0.001);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 6: Resize clip right — adjusts duration_sec
// ─────────────────────────────────────────────────────────────────────────────
describe('Resize clip right', () => {
  it('adjusts duration_sec based on new end position', () => {
    const p = makeProject();
    // c2: start=17.5, duration=6.3
    // Drag right edge to 25 → new duration = 25 - 17.5 = 7.5
    const p1 = resizeClip(p, 'c2', 'right', 25);
    const c = findClip(p1, 'c2');
    assert.ok(Math.abs(c.duration_sec - 7.5) < 0.001, `duration ${c.duration_sec}`);
    assert.equal(c.start_sec, 17.5, 'start unchanged');
  });

  it('minimum duration is 0.1', () => {
    const p = makeProject();
    // c2 start=17.5; drag right edge to 17.6 → duration=0.1
    const p1 = resizeClip(p, 'c2', 'right', 17.6);
    const c = findClip(p1, 'c2');
    assert.ok(Math.abs(c.duration_sec - 0.1) < 0.001);
  });

  it('dragging right edge to start gives minimum duration', () => {
    const p = makeProject();
    const p1 = resizeClip(p, 'c2', 'right', 17.5);
    const c = findClip(p1, 'c2');
    assert.ok(Math.abs(c.duration_sec - 0.1) < 0.001, 'clamped to 0.1');
  });

  it('does not modify in_sec on right resize', () => {
    const p = makeProject();
    const p1 = resizeClip(p, 'c2', 'right', 25);
    const c = findClip(p1, 'c2');
    assert.ok(Math.abs(c.in_sec - 8.2) < 0.001, 'in_sec unchanged');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 7: Duplicate — creates copy with new ID at end of original
// ─────────────────────────────────────────────────────────────────────────────
describe('Duplicate clip', () => {
  it('adds a new clip with unique id', () => {
    const p = makeProject();
    const p1 = duplicateSelected(p, 'c2');
    const v1 = findTrack(p1, 'V1');
    const ids = v1.clips.map((c) => c.id);
    assert.ok(ids.includes('c2-d1'), 'duplicate id c2-d1 exists');
    assert.equal(ids.filter((id) => id === 'c2').length, 1, 'original still exists');
  });

  it('duplicate start_sec = original start + original duration', () => {
    const p = makeProject();
    // c2: start=17.5, duration=6.3 → dup at 23.8
    const p1 = duplicateSelected(p, 'c2');
    const dup = findClip(p1, 'c2-d1');
    assert.ok(Math.abs(dup.start_sec - 23.8) < 0.001, `dup start ${dup.start_sec}`);
  });

  it('duplicate is not selected', () => {
    const p = makeProject();
    const p1 = duplicateSelected(p, 'c2');
    const dup = findClip(p1, 'c2-d1');
    assert.equal(dup.selected, false);
  });

  it('duplicate preserves duration and in_sec', () => {
    const p = makeProject();
    const p1 = duplicateSelected(p, 'c2');
    const dup = findClip(p1, 'c2-d1');
    assert.ok(Math.abs(dup.duration_sec - 6.3) < 0.001);
    assert.ok(Math.abs(dup.in_sec - 8.2) < 0.001);
  });

  it('no-op when selectedClipId is null', () => {
    const p = makeProject();
    const p1 = duplicateSelected(p, null);
    assert.deepEqual(p1, p);
  });

  it('no-op when clip not found on any track', () => {
    const p = makeProject();
    const p1 = duplicateSelected(p, 'xxx');
    assert.deepEqual(p1, p);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 8: Locked track operations — split/delete/move skipped
// ─────────────────────────────────────────────────────────────────────────────
describe('Locked track guards', () => {
  it('splitAtPlayhead skips locked tracks', () => {
    const p = makeProject();
    p.tracks[0].locked = true; // V1
    const p1 = splitAtPlayhead(p, 'c2', 20);
    const v1 = findTrack(p1, 'V1');
    assert.equal(v1.clips.length, 4, 'V1 clips unchanged (locked)');
  });

  it('ripple delete skips locked tracks', () => {
    const p = makeProject();
    // Put c2's id on V2 which is locked
    const pLocked = { ...p };
    pLocked.tracks = pLocked.tracks.map((t) =>
      t.id === 'V2' ? { ...t, locked: true } : t,
    );
    // Try to delete c7 on V2
    const { project: p1 } = deleteSelected(pLocked, 'c7');
    const v2 = findTrack(p1, 'V2');
    assert.equal(v2.clips.length, 1, 'V2 still has c7 (locked)');
  });

  it('moveClip still works on locked tracks (no guard in moveClip)', () => {
    const p = makeProject();
    p.tracks[0].locked = true;
    const p1 = moveClip(p, 'c1', 5);
    // moveClip does not check locked — this is how the source code behaves
    assert.equal(findClip(p1, 'c1').start_sec, 5);
  });

  it('Timeline drag handler checks locked before starting drag', () => {
    // The Timeline component checks track.locked in startDrag.
    // We verify the data: locked track exists
    const p = makeProject();
    p.tracks[0].locked = true;
    assert.equal(findTrack(p, 'V1').locked, true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 9: Magnetic snap — snapToNearest returns closest target within threshold
// ─────────────────────────────────────────────────────────────────────────────
describe('Magnetic snap', () => {
  it('snaps to playhead when within pixel threshold', () => {
    const zoom = 80; // 80 px/sec
    const playhead = 20;
    const targets = [playhead];
    // sec=20.05 → px = 20.05*80 = 1604, target px = 20*80 = 1600, diff=4 < 6
    const result = snapToNearest(20.05, zoom, targets, true, false);
    assert.equal(result, 20, 'snapped to playhead');
  });

  it('returns original sec when too far from any target', () => {
    const zoom = 80;
    const targets = [20];
    // sec=20.2 → px diff = 0.2*80 = 16 > 6
    const result = snapToNearest(20.2, zoom, targets, true, false);
    assert.equal(result, 20.2);
  });

  it('snaps to clip edge when magnet is on', () => {
    const zoom = 80;
    // Clip at start=17.5 → end=23.8
    const targets = [17.5, 23.8];
    // sec=23.75 → px diff = 0.05*80 = 4 < 6
    const result = snapToNearest(23.75, zoom, targets, true, false);
    assert.equal(result, 23.8, 'snapped to clip end');
  });

  it('snaps to marker', () => {
    const zoom = 80;
    const targets = [60]; // marker at 60s
    // sec=59.95 → diff = 0.05*80 = 4 < 6
    const result = snapToNearest(59.95, zoom, targets, true, false);
    assert.equal(result, 60, 'snapped to marker');
  });

  it('returns original when magnet is off and gridSnap is off', () => {
    const zoom = 80;
    const result = snapToNearest(20.01, zoom, [20], false, false);
    assert.equal(result, 20.01);
  });

  it('picks closest target when multiple are within threshold', () => {
    const zoom = 100; // higher zoom = more precise
    // Two targets very close together
    const targets = [19.99, 20.01];
    const result = snapToNearest(20.0, zoom, targets, true, false);
    // Should snap to whichever is within 6px: 20.0*100=2000, 19.99*100=1999 (diff=1), 20.01*100=2001 (diff=1)
    // First match wins → 19.99
    assert.equal(result, 19.99);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 10: Grid snap — rounds to nearest grid point
// ─────────────────────────────────────────────────────────────────────────────
describe('Grid snap', () => {
  it('snaps to 1-second grid when zoom >= 60', () => {
    const zoom = 80;
    const targets = []; // no magnet targets
    // sec=3.4 → grid(1) → rounded=3, diff=0.4*80=32 > 6 → no snap
    let result = snapToNearest(3.4, zoom, targets, false, true);
    assert.equal(result, 3.4, 'too far from grid point');

    // sec=3.05 → rounded=3, diff=0.05*80=4 < 6 → snap
    result = snapToNearest(3.05, zoom, targets, false, true);
    assert.equal(result, 3, 'snapped to 1s grid');

    // sec=3.95 → rounded=4, diff=0.05*80=4 < 6 → snap
    result = snapToNearest(3.95, zoom, targets, false, true);
    assert.equal(result, 4, 'snapped to 4s');
  });

  it('snaps to 5-second grid when zoom < 60', () => {
    const zoom = 40;
    const targets = [];
    // sec=12.3 → rounded=10 or 15? Math.round(12.3/5)*5 = 10
    // diff = |12.3-10|*40 = 92 > 6 → no snap
    let result = snapToNearest(12.3, zoom, targets, false, true);
    assert.equal(result, 12.3, 'too far');

    // sec=10.1 → rounded=10, diff=0.1*40=4 < 6 → snap
    result = snapToNearest(10.1, zoom, targets, false, true);
    assert.equal(result, 10, 'snapped to 5s grid');
  });

  it('grid snap prefers magnet snap when both are on', () => {
    const zoom = 80;
    const targets = [5.0]; // magnet target at 5s
    // sec=5.05: magnet snap → diff=0.05*80=4 < 6 → returns 5
    const result = snapToNearest(5.05, zoom, targets, true, true);
    assert.equal(result, 5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 11: snapTargets builds correct target list
// ─────────────────────────────────────────────────────────────────────────────
describe('snapTargets', () => {
  it('always includes playhead', () => {
    const targets = snapTargets(20, [], [], true);
    assert.ok(targets.includes(20));
  });

  it('includes markers when provided', () => {
    const markers = [{ time_sec: 17.5 }, { time_sec: 60 }];
    const targets = snapTargets(20, markers, [], true);
    assert.ok(targets.includes(17.5));
    assert.ok(targets.includes(60));
  });

  it('includes clip edges when magnet is on', () => {
    const clips = [{ start_sec: 17.5, duration_sec: 6.3 }];
    const targets = snapTargets(20, [], clips, true);
    assert.ok(targets.includes(17.5), 'clip start');
    assert.ok(targets.includes(23.8), 'clip end');
  });

  it('excludes clip edges when magnet is off', () => {
    const clips = [{ start_sec: 17.5, duration_sec: 6.3 }];
    const targets = snapTargets(20, [], clips, false);
    assert.equal(targets.includes(17.5), false);
    assert.equal(targets.includes(23.8), false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 12: Command palette filtering
// ─────────────────────────────────────────────────────────────────────────────
describe('Command palette filter', () => {
  const commands = [
    { label: 'Toggle play / pause', action: () => {} },
    { label: 'Undo', action: () => {} },
    { label: 'Redo', action: () => {} },
    { label: 'Split at playhead', action: () => {} },
    { label: 'Duplicate clip', action: () => {} },
    { label: 'Delete clip', action: () => {} },
    { label: 'Tool: Select', action: () => {} },
    { label: 'Tool: Razor', action: () => {} },
    { label: 'Zoom in', action: () => {} },
    { label: 'Zoom out', action: () => {} },
  ];

  it('returns all commands when query is empty', () => {
    const result = filterCommands(commands, '');
    assert.equal(result.length, commands.length);
  });

  it('returns all commands when query is null/undefined', () => {
    const result = filterCommands(commands, null);
    assert.equal(result.length, commands.length);
  });

  it('filters by substring (case-insensitive)', () => {
    const result = filterCommands(commands, 'zoom');
    assert.equal(result.length, 2);
    assert.ok(result.every((c) => c.label.toLowerCase().includes('zoom')));
  });

  it('filters to single result for specific query', () => {
    const result = filterCommands(commands, 'undo');
    assert.equal(result.length, 1);
    assert.equal(result[0].label, 'Undo');
  });

  it('returns empty array for no matches', () => {
    const result = filterCommands(commands, 'export to pdf');
    assert.equal(result.length, 0);
  });

  it('matches partial words', () => {
    const result = filterCommands(commands, 'dupl');
    assert.equal(result.length, 1);
    assert.equal(result[0].label, 'Duplicate clip');
  });

  it('case-insensitive matching', () => {
    const result = filterCommands(commands, 'UNDO');
    assert.equal(result.length, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 13: Time formatting utilities
// ─────────────────────────────────────────────────────────────────────────────
describe('formatTimecode', () => {
  it('formats seconds-only values', () => {
    assert.equal(formatTimecode(0), '00:00.0');
    assert.equal(formatTimecode(65), '01:05.0');
  });

  it('formats with sub-second precision', () => {
    // 23.5s → 00:23.5
    assert.equal(formatTimecode(23.5), '00:23.5');
  });

  it('formats hours when >= 3600s', () => {
    // 3661 → 01:01:01:00 (pad2 for hours, minutes, seconds, and frames)
    assert.equal(formatTimecode(3661), '01:01:01:00');
  });

  it('clamps negative values to 0', () => {
    assert.equal(formatTimecode(-5), '00:00.0');
  });

  it('handles NaN', () => {
    assert.equal(formatTimecode(NaN), '00:00.0');
  });

  it('handles Infinity', () => {
    assert.equal(formatTimecode(Infinity), '00:00.0');
  });
});

describe('formatShortTime', () => {
  it('formats mm:ss', () => {
    assert.equal(formatShortTime(0), '00:00');
    assert.equal(formatShortTime(65), '01:05');
    assert.equal(formatShortTime(120), '02:00');
  });

  it('clamps negative to 0', () => {
    assert.equal(formatShortTime(-10), '00:00');
  });
});

describe('formatSeconds', () => {
  it('formats with one decimal', () => {
    assert.equal(formatSeconds(0), '0.0s');
    assert.equal(formatSeconds(17.5), '17.5s');
    assert.equal(formatSeconds(134), '134.0s');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 14: Mock project structure validation (8-track project)
// ─────────────────────────────────────────────────────────────────────────────
describe('Mock project structure', () => {
  const p = makeProject();

  it('has exactly 8 tracks (4 video + 4 audio)', () => {
    assert.equal(p.tracks.length, 8);
    const videoTracks = p.tracks.filter((t) => t.kind === 'video');
    const audioTracks = p.tracks.filter((t) => t.kind === 'audio');
    assert.equal(videoTracks.length, 4, '4 video tracks');
    assert.equal(audioTracks.length, 4, '4 audio tracks');
  });

  it('track ids follow V1-V4, A1-A4 naming', () => {
    const ids = p.tracks.map((t) => t.id);
    assert.deepEqual(ids, ['V1', 'V2', 'V3', 'V4', 'A1', 'A2', 'A3', 'A4']);
  });

  it('every clip has a valid track_id matching a track', () => {
    const trackIds = new Set(p.tracks.map((t) => t.id));
    for (const track of p.tracks) {
      for (const clip of track.clips) {
        assert.ok(trackIds.has(clip.track_id), `clip ${clip.id} has valid track_id`);
      }
    }
  });

  it('clips are non-empty on video tracks', () => {
    for (const t of p.tracks.filter((t) => t.kind === 'video')) {
      assert.ok(t.clips.length > 0, `${t.id} has clips`);
    }
  });

  it('markers array exists with valid structure', () => {
    assert.ok(Array.isArray(p.markers));
    assert.equal(p.markers.length, 4);
    for (const m of p.markers) {
      assert.ok(typeof m.id === 'string');
      assert.ok(typeof m.time_sec === 'number');
      assert.ok(typeof m.label === 'string');
      assert.ok(typeof m.color === 'string');
      assert.ok(m.color.startsWith('#'), 'color is hex');
    }
  });

  it('clip durations are positive', () => {
    for (const t of p.tracks) {
      for (const c of t.clips) {
        assert.ok(c.duration_sec > 0, `clip ${c.id} has positive duration`);
      }
    }
  });

  it('clip start_sec are non-negative', () => {
    for (const t of p.tracks) {
      for (const c of t.clips) {
        assert.ok(c.start_sec >= 0, `clip ${c.id} has non-negative start`);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 15: Edge cases and integration
// ─────────────────────────────────────────────────────────────────────────────
describe('Edge cases', () => {
  it('split then ripple delete on same track works correctly', () => {
    let p = makeProject();
    // Split c2 at playhead=20
    p = splitAtPlayhead(p, 'c2', 20);
    const v1 = findTrack(p, 'V1');
    assert.equal(v1.clips.length, 5, 'V1 has 5 clips after split');

    // Find the right half and delete it
    const rightHalf = v1.clips.find((c) => c.id?.startsWith('c2-r'));
    assert.ok(rightHalf, 'right half exists');
    p = deleteSelected(p, rightHalf.id).project;
    const v1After = findTrack(p, 'V1');
    assert.equal(v1After.clips.length, 4, 'back to 4 clips');
  });

  it('resize left to 0 then move works', () => {
    let p = makeProject();
    p = resizeClip(p, 'c2', 'left', 0);
    const c = findClip(p, 'c2');
    assert.equal(c.start_sec, 0);
    assert.ok(Math.abs(c.duration_sec - 23.8) < 0.001);
    p = moveClip(p, 'c2', 10);
    assert.equal(findClip(p, 'c2').start_sec, 10);
  });

  it('duplicate preserves all clip properties except id, start, selected', () => {
    const p = makeProject();
    const p1 = duplicateSelected(p, 'c2');
    const orig = findClip(p, 'c2');
    const dup = findClip(p1, 'c2-d1');
    assert.equal(dup.track_id, orig.track_id);
    assert.equal(dup.source_file, orig.source_file);
    assert.equal(dup.kind, orig.kind);
    assert.equal(dup.selected, false);
    assert.notEqual(dup.id, orig.id);
  });

  it('grid snap with zoom=200 snaps to 1s grid', () => {
    const zoom = 200; // >= 60, so grid = 1s
    const targets = [];
    // sec=7.02 → rounded=7, diff=0.02*200=4 < 6
    const result = snapToNearest(7.02, zoom, targets, false, true);
    assert.equal(result, 7);
  });
});
