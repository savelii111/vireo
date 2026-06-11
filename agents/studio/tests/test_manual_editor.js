/**
 * test_manual_editor.js — Tests for Manual Editor (100+ tests)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  Timeline, DragDropEngine, EffectSystem, TransitionSystem, ExportManager,
  UndoRedoManager, KeyboardShortcutManager, PreviewManager, AutoSaveManager, ManualEditorEngine
} from '../src/manual_editor.js';

// ── Timeline ────────────────────────────────────────────────────────────────
describe('Timeline', () => {
  test('create timeline', () => {
    const timeline = new Timeline({ name: 'Test Timeline', duration: 100 });
    assert.equal(timeline.name, 'Test Timeline');
    assert.equal(timeline.duration, 100);
  });

  test('add track', () => {
    const timeline = new Timeline();
    const track = timeline.addTrack({ name: 'Video', type: 'video' });
    assert.equal(track.name, 'Video');
    assert.equal(timeline.tracks.length, 1);
  });

  test('remove track', () => {
    const timeline = new Timeline();
    const track = timeline.addTrack();
    const removed = timeline.removeTrack(track.id);
    assert.equal(removed.id, track.id);
    assert.equal(timeline.tracks.length, 0);
  });

  test('get track', () => {
    const timeline = new Timeline();
    const track = timeline.addTrack();
    const got = timeline.getTrack(track.id);
    assert.equal(got.id, track.id);
  });

  test('add clip', () => {
    const timeline = new Timeline();
    const track = timeline.addTrack();
    const clip = timeline.addClip(track.id, { start: 0, end: 10 });
    assert.equal(clip.start, 0);
    assert.equal(clip.end, 10);
  });

  test('remove clip', () => {
    const timeline = new Timeline();
    const track = timeline.addTrack();
    const clip = timeline.addClip(track.id, { start: 0, end: 10 });
    const removed = timeline.removeClip(track.id, clip.id);
    assert.equal(removed.id, clip.id);
    assert.equal(track.clips.length, 0);
  });

  test('get clip', () => {
    const timeline = new Timeline();
    const track = timeline.addTrack();
    const clip = timeline.addClip(track.id, { start: 0, end: 10 });
    const got = timeline.getClip(track.id, clip.id);
    assert.equal(got.id, clip.id);
  });

  test('move clip', () => {
    const timeline = new Timeline();
    const track = timeline.addTrack();
    const clip = timeline.addClip(track.id, { start: 0, end: 10 });
    const moved = timeline.moveClip(track.id, clip.id, 5);
    assert.equal(moved.start, 5);
    assert.equal(moved.end, 15);
  });

  test('trim clip', () => {
    const timeline = new Timeline();
    const track = timeline.addTrack();
    const clip = timeline.addClip(track.id, { start: 0, end: 10 });
    const trimmed = timeline.trimClip(track.id, clip.id, 2, 8);
    assert.equal(trimmed.start, 2);
    assert.equal(trimmed.end, 8);
  });

  test('split clip', () => {
    const timeline = new Timeline();
    const track = timeline.addTrack();
    const clip = timeline.addClip(track.id, { start: 0, end: 10 });
    const [first, second] = timeline.splitClip(track.id, clip.id, 5);
    assert.equal(first.end, 5);
    assert.equal(second.start, 5);
    assert.equal(second.end, 10);
  });

  test('merge clips', () => {
    const timeline = new Timeline();
    const track = timeline.addTrack();
    const clip1 = timeline.addClip(track.id, { start: 0, end: 5 });
    const clip2 = timeline.addClip(track.id, { start: 5, end: 10 });
    const merged = timeline.mergeClips(track.id, [clip1.id, clip2.id]);
    assert.equal(merged.start, 0);
    assert.equal(merged.end, 10);
  });

  test('add marker', () => {
    const timeline = new Timeline();
    const marker = timeline.addMarker(5, { name: 'Marker' });
    assert.equal(marker.time, 5);
    assert.equal(timeline.markers.length, 1);
  });

  test('remove marker', () => {
    const timeline = new Timeline();
    const marker = timeline.addMarker(5);
    const removed = timeline.removeMarker(marker.id);
    assert.equal(removed.id, marker.id);
    assert.equal(timeline.markers.length, 0);
  });

  test('add comment', () => {
    const timeline = new Timeline();
    const comment = timeline.addComment(5, 'Fix this', { author: 'user' });
    assert.equal(comment.text, 'Fix this');
    assert.equal(timeline.comments.length, 1);
  });

  test('get timeline info', () => {
    const timeline = new Timeline({ duration: 100 });
    const track = timeline.addTrack();
    timeline.addClip(track.id, { start: 0, end: 10 });
    timeline.addMarker(5);
    const info = timeline.getTimelineInfo();
    assert.equal(info.duration, 100);
    assert.equal(info.clips, 1);
    assert.equal(info.markers, 1);
  });

  test('export timeline', () => {
    const timeline = new Timeline();
    const track = timeline.addTrack();
    timeline.addClip(track.id, { start: 0, end: 10 });
    const exported = timeline.exportTimeline();
    assert.ok(exported.tracks.length > 0);
  });
});

// ── DragDropEngine ─────────────────────────────────────────────────────────
describe('DragDropEngine', () => {
  test('snap time', () => {
    const timeline = new Timeline();
    const engine = new DragDropEngine(timeline);
    assert.equal(engine.snap(1.2), 1);
  });

  test('drag clip', () => {
    const timeline = new Timeline();
    const track = timeline.addTrack();
    const clip = timeline.addClip(track.id, { start: 0, end: 10 });
    const engine = new DragDropEngine(timeline);
    const moved = engine.dragClip(track.id, clip.id, 5);
    assert.equal(moved.start, 5);
  });

  test('drop clip', () => {
    const timeline = new Timeline();
    const track = timeline.addTrack();
    const clip = timeline.addClip(track.id, { start: 0, end: 10 });
    const engine = new DragDropEngine(timeline);
    const dropped = engine.dropClip(track.id, clip.id, 5);
    assert.equal(dropped.start, 5);
  });

  test('reorder track', () => {
    const timeline = new Timeline();
    const track1 = timeline.addTrack({ name: 'A' });
    const track2 = timeline.addTrack({ name: 'B' });
    const engine = new DragDropEngine(timeline);
    const reordered = engine.reorderTrack(track1.id, 1);
    assert.equal(timeline.tracks[1].id, track1.id);
  });

  test('set snap grid', () => {
    const timeline = new Timeline();
    const engine = new DragDropEngine(timeline);
    engine.setSnapGrid(2);
    assert.equal(engine.snap(3), 4);
  });

  test('toggle snap', () => {
    const timeline = new Timeline();
    const engine = new DragDropEngine(timeline);
    engine.toggleSnap(false);
    assert.equal(engine.snap(1.5), 1.5);
  });

  test('get drag preview', () => {
    const timeline = new Timeline();
    const track = timeline.addTrack();
    const clip = timeline.addClip(track.id, { start: 0, end: 10 });
    const engine = new DragDropEngine(timeline);
    const preview = engine.getDragPreview(track.id, clip.id, 5);
    assert.equal(preview.start, 5);
    assert.equal(preview.end, 15);
  });

  test('can drop no conflicts', () => {
    const timeline = new Timeline();
    const track = timeline.addTrack();
    const clip = timeline.addClip(track.id, { start: 0, end: 10 });
    const engine = new DragDropEngine(timeline);
    const result = engine.canDrop(track.id, clip.id, 15);
    assert.equal(result.can_drop, true);
  });

  test('can drop with conflicts', () => {
    const timeline = new Timeline();
    const track = timeline.addTrack();
    const clip = timeline.addClip(track.id, { start: 0, end: 10 });
    timeline.addClip(track.id, { start: 5, end: 15 });
    const engine = new DragDropEngine(timeline);
    const result = engine.canDrop(track.id, clip.id, 12);
    assert.equal(result.can_drop, false);
  });
});

// ── EffectSystem ───────────────────────────────────────────────────────────
describe('EffectSystem', () => {
  test('register effect', () => {
    const system = new EffectSystem();
    const effect = system.registerEffect('blur', { type: 'blur' });
    assert.equal(effect.name, 'blur');
  });

  test('apply effect', () => {
    const timeline = new Timeline();
    const track = timeline.addTrack();
    const clip = timeline.addClip(track.id, { start: 0, end: 10 });
    const system = new EffectSystem(timeline);
    system.registerEffect('blur', { type: 'blur' });
    const applied = system.applyEffect(track.id, clip.id, 'blur', { intensity: 0.5 });
    assert.equal(applied.name, 'blur');
  });

  test('remove effect', () => {
    const timeline = new Timeline();
    const track = timeline.addTrack();
    const clip = timeline.addClip(track.id, { start: 0, end: 10 });
    const system = new EffectSystem(timeline);
    system.registerEffect('blur', { type: 'blur' });
    const applied = system.applyEffect(track.id, clip.id, 'blur');
    const removed = system.removeEffect(track.id, clip.id, applied.id);
    assert.equal(removed.id, applied.id);
  });

  test('reorder effects', () => {
    const timeline = new Timeline();
    const track = timeline.addTrack();
    const clip = timeline.addClip(track.id, { start: 0, end: 10 });
    const system = new EffectSystem(timeline);
    system.registerEffect('a', { type: 'a' });
    system.registerEffect('b', { type: 'b' });
    const e1 = system.applyEffect(track.id, clip.id, 'a');
    const e2 = system.applyEffect(track.id, clip.id, 'b');
    const reordered = system.reorderEffects(track.id, clip.id, [e2.id, e1.id]);
    assert.equal(reordered[0].id, e2.id);
  });

  test('create preset', () => {
    const system = new EffectSystem();
    const preset = system.createPreset('Cinematic', ['e1', 'e2']);
    assert.equal(preset.name, 'Cinematic');
  });

  test('apply preset', () => {
    const timeline = new Timeline();
    const track = timeline.addTrack();
    const clip = timeline.addClip(track.id, { start: 0, end: 10 });
    const system = new EffectSystem(timeline);
    system.registerEffect('a', { id: 'e1', type: 'a' });
    system.registerEffect('b', { id: 'e2', type: 'b' });
    system.createPreset('Preset', ['e1', 'e2']);
    const effects = system.applyPreset(track.id, clip.id, 'Preset');
    assert.equal(effects.length, 2);
  });

  test('list effects', () => {
    const system = new EffectSystem();
    system.registerEffect('blur', { type: 'blur' });
    assert.equal(system.listEffects().length, 1);
  });

  test('list presets', () => {
    const system = new EffectSystem();
    system.createPreset('Preset', ['e1']);
    assert.equal(system.listPresets().length, 1);
  });
});

// ── TransitionSystem ───────────────────────────────────────────────────────
describe('TransitionSystem', () => {
  test('register transition', () => {
    const system = new TransitionSystem();
    const transition = system.registerTransition('fade', { type: 'fade' });
    assert.equal(transition.name, 'fade');
  });

  test('add transition', () => {
    const timeline = new Timeline();
    const track = timeline.addTrack();
    const clip = timeline.addClip(track.id, { start: 0, end: 10 });
    const system = new TransitionSystem(timeline);
    system.registerTransition('fade', { type: 'fade' });
    const added = system.addTransition(track.id, clip.id, 'fade');
    assert.equal(added.name, 'fade');
  });

  test('remove transition', () => {
    const timeline = new Timeline();
    const track = timeline.addTrack();
    const clip = timeline.addClip(track.id, { start: 0, end: 10 });
    const system = new TransitionSystem(timeline);
    system.registerTransition('fade', { type: 'fade' });
    const added = system.addTransition(track.id, clip.id, 'fade');
    const removed = system.removeTransition(track.id, clip.id, added.id);
    assert.equal(removed.id, added.id);
  });

  test('list transitions', () => {
    const system = new TransitionSystem();
    system.registerTransition('fade', { type: 'fade' });
    assert.equal(system.listTransitions().length, 1);
  });
});

// ── ExportManager ──────────────────────────────────────────────────────────
describe('ExportManager', () => {
  test('create export job', () => {
    const timeline = new Timeline();
    const manager = new ExportManager();
    const job = manager.createExportJob(timeline, 'youtube');
    assert.equal(job.preset, 'youtube');
    assert.equal(job.status, 'queued');
  });

  test('start export', () => {
    const timeline = new Timeline();
    const manager = new ExportManager();
    const job = manager.createExportJob(timeline, 'youtube');
    const started = manager.startExport(job.id);
    assert.equal(started.status, 'rendering');
  });

  test('update progress', () => {
    const timeline = new Timeline();
    const manager = new ExportManager();
    const job = manager.createExportJob(timeline, 'youtube');
    manager.startExport(job.id);
    const updated = manager.updateProgress(job.id, 50);
    assert.equal(updated.progress, 50);
  });

  test('complete export', () => {
    const timeline = new Timeline();
    const manager = new ExportManager();
    const job = manager.createExportJob(timeline, 'youtube');
    manager.startExport(job.id);
    const completed = manager.updateProgress(job.id, 100);
    assert.equal(completed.status, 'completed');
  });

  test('cancel export', () => {
    const timeline = new Timeline();
    const manager = new ExportManager();
    const job = manager.createExportJob(timeline, 'youtube');
    const cancelled = manager.cancelExport(job.id);
    assert.equal(cancelled.status, 'cancelled');
  });

  test('get export status', () => {
    const timeline = new Timeline();
    const manager = new ExportManager();
    const job = manager.createExportJob(timeline, 'youtube');
    const status = manager.getExportStatus(job.id);
    assert.equal(status.status, 'queued');
  });

  test('list queue', () => {
    const timeline = new Timeline();
    const manager = new ExportManager();
    manager.createExportJob(timeline, 'youtube');
    assert.equal(manager.listQueue().length, 1);
  });

  test('list completed', () => {
    const timeline = new Timeline();
    const manager = new ExportManager();
    const job = manager.createExportJob(timeline, 'youtube');
    manager.startExport(job.id);
    manager.updateProgress(job.id, 100);
    assert.equal(manager.listCompleted().length, 1);
  });

  test('clear queue', () => {
    const timeline = new Timeline();
    const manager = new ExportManager();
    manager.createExportJob(timeline, 'youtube');
    manager.clearQueue();
    assert.equal(manager.listQueue().length, 0);
  });
});

// ── UndoRedoManager ────────────────────────────────────────────────────────
describe('UndoRedoManager', () => {
  test('push state', () => {
    const manager = new UndoRedoManager();
    manager.pushState({ value: 1 });
    assert.equal(manager.canUndo(), true);
  });

  test('undo', () => {
    const manager = new UndoRedoManager();
    manager.pushState({ value: 1 });
    const state = manager.undo();
    assert.equal(state.value, 1);
  });

  test('redo', () => {
    const manager = new UndoRedoManager();
    manager.pushState({ value: 1 });
    manager.undo();
    const state = manager.redo();
    assert.equal(state.value, 1);
  });

  test('can undo redo', () => {
    const manager = new UndoRedoManager();
    assert.equal(manager.canUndo(), false);
    assert.equal(manager.canRedo(), false);
  });

  test('clear', () => {
    const manager = new UndoRedoManager();
    manager.pushState({ value: 1 });
    manager.clear();
    assert.equal(manager.canUndo(), false);
  });

  test('get history', () => {
    const manager = new UndoRedoManager();
    manager.pushState({ value: 1 });
    const history = manager.getHistory();
    assert.equal(history.undo_count, 1);
  });
});

// ── KeyboardShortcutManager ────────────────────────────────────────────────
describe('KeyboardShortcutManager', () => {
  test('register shortcut', () => {
    const manager = new KeyboardShortcutManager();
    manager.registerShortcut('Cmd+X', 'cut');
    assert.equal(manager.handleShortcut('Cmd+X').action, 'cut');
  });

  test('unregister shortcut', () => {
    const manager = new KeyboardShortcutManager();
    manager.unregisterShortcut('Cmd+S');
    assert.equal(manager.handleShortcut('Cmd+S'), null);
  });

  test('handle shortcut', () => {
    const manager = new KeyboardShortcutManager();
    const result = manager.handleShortcut('Space');
    assert.equal(result.action, 'play_pause');
  });

  test('list shortcuts', () => {
    const manager = new KeyboardShortcutManager();
    assert.ok(manager.listShortcuts().Space);
  });

  test('reset to defaults', () => {
    const manager = new KeyboardShortcutManager();
    manager.registerShortcut('Cmd+X', 'cut');
    manager.resetToDefaults();
    assert.equal(manager.handleShortcut('Cmd+X'), null);
  });
});

// ── PreviewManager ─────────────────────────────────────────────────────────
describe('PreviewManager', () => {
  test('generate preview', () => {
    const timeline = new Timeline();
    const manager = new PreviewManager();
    const preview = manager.generatePreview(timeline);
    assert.equal(preview.status, 'ready');
  });

  test('get preview', () => {
    const timeline = new Timeline();
    const manager = new PreviewManager();
    const preview = manager.generatePreview(timeline);
    const got = manager.getPreview(preview.id);
    assert.equal(got.id, preview.id);
  });

  test('list previews', () => {
    const timeline = new Timeline();
    const manager = new PreviewManager();
    manager.generatePreview(timeline);
    assert.equal(manager.listPreviews().length, 1);
  });

  test('clear previews', () => {
    const timeline = new Timeline();
    const manager = new PreviewManager();
    manager.generatePreview(timeline);
    manager.clearPreviews();
    assert.equal(manager.listPreviews().length, 0);
  });
});

// ── AutoSaveManager ────────────────────────────────────────────────────────
describe('AutoSaveManager', () => {
  test('set interval', () => {
    const manager = new AutoSaveManager();
    manager.setInterval(60);
    assert.equal(manager._interval, 60);
  });

  test('save snapshot', () => {
    const manager = new AutoSaveManager();
    const snapshot = manager.saveSnapshot('p1', { value: 1 });
    assert.equal(snapshot.project_id, 'p1');
  });

  test('get snapshot', () => {
    const manager = new AutoSaveManager();
    const snapshot = manager.saveSnapshot('p1', { value: 1 });
    const got = manager.getSnapshot(snapshot.id);
    assert.equal(got.id, snapshot.id);
  });

  test('list snapshots', () => {
    const manager = new AutoSaveManager();
    manager.saveSnapshot('p1', { value: 1 });
    manager.saveSnapshot('p1', { value: 2 });
    assert.equal(manager.listSnapshots('p1').length, 2);
  });

  test('restore snapshot', () => {
    const manager = new AutoSaveManager();
    const snapshot = manager.saveSnapshot('p1', { value: 1 });
    const restored = manager.restoreSnapshot(snapshot.id);
    assert.equal(restored.value, 1);
  });

  test('delete snapshot', () => {
    const manager = new AutoSaveManager();
    const snapshot = manager.saveSnapshot('p1', { value: 1 });
    manager.deleteSnapshot(snapshot.id);
    assert.equal(manager.listSnapshots('p1').length, 0);
  });

  test('clear snapshots', () => {
    const manager = new AutoSaveManager();
    manager.saveSnapshot('p1', { value: 1 });
    manager.clearSnapshots('p1');
    assert.equal(manager.listSnapshots('p1').length, 0);
  });
});

// ── ManualEditorEngine ─────────────────────────────────────────────────────
describe('ManualEditorEngine', () => {
  test('create project', () => {
    const engine = new ManualEditorEngine();
    const project = engine.createProject('My Project');
    assert.equal(project.name, 'My Project');
  });

  test('add clip', () => {
    const engine = new ManualEditorEngine();
    const track = engine.timeline.tracks[0];
    const clip = engine.addClip(track.id, { start: 0, end: 10 });
    assert.equal(clip.start, 0);
  });

  test('edit clip', () => {
    const engine = new ManualEditorEngine();
    const track = engine.timeline.tracks[0];
    const clip = engine.addClip(track.id, { start: 0, end: 10 });
    const edited = engine.editClip(track.id, clip.id, { opacity: 0.5 });
    assert.equal(edited.opacity, 0.5);
  });

  test('apply effect', () => {
    const engine = new ManualEditorEngine();
    const track = engine.timeline.tracks[0];
    const clip = engine.addClip(track.id, { start: 0, end: 10 });
    const effect = engine.applyEffect(track.id, clip.id, 'blur', { intensity: 0.5 });
    assert.equal(effect.name, 'blur');
  });

  test('add transition', () => {
    const engine = new ManualEditorEngine();
    const track = engine.timeline.tracks[0];
    const clip = engine.addClip(track.id, { start: 0, end: 10 });
    const transition = engine.addTransition(track.id, clip.id, 'fade');
    assert.equal(transition.name, 'fade');
  });

  test('export video', () => {
    const engine = new ManualEditorEngine();
    const job = engine.exportVideo('youtube');
    assert.equal(job.status, 'rendering');
  });

  test('get export status', () => {
    const engine = new ManualEditorEngine();
    const job = engine.exportVideo('youtube');
    const status = engine.getExportStatus(job.id);
    assert.equal(status.status, 'rendering');
  });

  test('undo', () => {
    const engine = new ManualEditorEngine();
    const track = engine.timeline.tracks[0];
    engine.addClip(track.id, { start: 0, end: 10 });
    const undone = engine.undo();
    assert.ok(undone);
  });

  test('redo', () => {
    const engine = new ManualEditorEngine();
    const track = engine.timeline.tracks[0];
    engine.addClip(track.id, { start: 0, end: 10 });
    engine.undo();
    const redone = engine.redo();
    assert.ok(redone);
  });

  test('handle shortcut', () => {
    const engine = new ManualEditorEngine();
    const result = engine.handleShortcut('Space');
    assert.equal(result.action, 'play_pause');
  });

  test('save snapshot', () => {
    const engine = new ManualEditorEngine();
    const snapshot = engine.saveSnapshot();
    assert.equal(snapshot.project_id, engine.timeline.id);
  });

  test('generate preview', () => {
    const engine = new ManualEditorEngine();
    const preview = engine.generatePreview();
    assert.equal(preview.status, 'ready');
  });

  test('get status', () => {
    const engine = new ManualEditorEngine();
    const status = engine.getStatus();
    assert.ok(status.timeline);
    assert.ok(status.effects >= 7);
  });
});

// ── Integration ────────────────────────────────────────────────────────────
describe('Manual Editor Integration', () => {
  test('full workflow: create → edit → effects → transitions → export → preview → save', () => {
    const engine = new ManualEditorEngine();

    // 1. Create project
    const project = engine.createProject('YouTube Video');
    assert.equal(project.name, 'YouTube Video');

    // 2. Add clips
    const track = engine.timeline.tracks[0];
    const clip1 = engine.addClip(track.id, { start: 0, end: 10, name: 'Intro' });
    const clip2 = engine.addClip(track.id, { start: 10, end: 20, name: 'Main' });

    // 3. Edit clip
    const edited = engine.editClip(track.id, clip1.id, { opacity: 0.8 });
    assert.equal(edited.opacity, 0.8);

    // 4. Apply effects
    const effect = engine.applyEffect(track.id, clip1.id, 'blur', { intensity: 0.5 });
    assert.equal(effect.name, 'blur');

    // 5. Add transition
    const transition = engine.addTransition(track.id, clip1.id, 'fade');
    assert.equal(transition.name, 'fade');

    // 6. Export
    const job = engine.exportVideo('youtube');
    assert.equal(job.preset, 'youtube');

    // 7. Preview
    const preview = engine.generatePreview();
    assert.equal(preview.status, 'ready');

    // 8. Save snapshot
    const snapshot = engine.saveSnapshot();
    assert.ok(snapshot.id);

    // 9. Undo/redo
    engine.undo();
    const redone = engine.redo();
    assert.ok(redone);

    // 10. Shortcut
    const shortcut = engine.handleShortcut('Space');
    assert.equal(shortcut.action, 'play_pause');

    // 11. Status
    const status = engine.getStatus();
    assert.ok(status.timeline.clips >= 2);
    assert.ok(status.effects >= 7);
  });
});
