/**
 * manual_editor.js — Manual Editor (10 classes)
 * Timeline-based video editing: clips, tracks, effects, transitions, export
 */

const EXPORT_PRESETS = {
  youtube: { format: 'mp4', codec: 'h264', resolution: '1920x1080', fps: 30, bitrate: '12M' },
  tiktok: { format: 'mp4', codec: 'h264', resolution: '1080x1920', fps: 30, bitrate: '8M' },
  instagram: { format: 'mp4', codec: 'h264', resolution: '1080x1080', fps: 30, bitrate: '8M' },
  linkedin: { format: 'mp4', codec: 'h264', resolution: '1920x1080', fps: 30, bitrate: '10M' },
};

const TRANSITION_TYPES = ['fade', 'crossfade', 'slide', 'zoom', 'blur', 'dissolve'];
const EFFECT_TYPES = ['color', 'blur', 'sharpen', 'glow', 'vignette', 'stabilize', 'noise_reduction'];
const KEYBOARD_SHORTCUTS = {
  'Cmd+S': 'save',
  'Cmd+Z': 'undo',
  'Cmd+Shift+Z': 'redo',
  'Space': 'play_pause',
  'Cmd+C': 'copy',
  'Cmd+V': 'paste',
  'Delete': 'delete',
  'Cmd+S': 'split',
};

function makeId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36)}`;
}

function isoNow() {
  return new Date().toISOString();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function overlaps(a, b) {
  return a.start < b.end && b.start < a.end;
}

function duration(clip) {
  return clip.end - clip.start;
}

// ── 1. Timeline ────────────────────────────────────────────────────────────

export class Timeline {
  constructor(options = {}) {
    this.id = options.id || makeId('timeline');
    this.name = options.name || 'Untitled Timeline';
    this.duration = options.duration || 0;
    this.fps = options.fps || 30;
    this.resolution = options.resolution || '1920x1080';
    this.tracks = [];
    this.markers = [];
    this.comments = [];
    this.created_at = isoNow();
    this.updated_at = isoNow();
  }

  addTrack(track = {}) {
    const newTrack = {
      id: track.id || makeId('track'),
      name: track.name || `Track ${this.tracks.length + 1}`,
      type: track.type || 'video',
      clips: [],
      locked: track.locked || false,
      muted: track.muted || false,
      visible: track.visible !== false,
      volume: track.volume ?? 1,
      created_at: isoNow(),
    };
    this.tracks.push(newTrack);
    return clone(newTrack);
  }

  removeTrack(trackId) {
    const idx = this.tracks.findIndex((track) => track.id === trackId);
    if (idx === -1) throw new Error(`Track '${trackId}' not found`);
    const [removed] = this.tracks.splice(idx, 1);
    this.updated_at = isoNow();
    return clone(removed);
  }

  getTrack(trackId) {
    const track = this.tracks.find((track) => track.id === trackId);
    if (!track) throw new Error(`Track '${trackId}' not found`);
    return clone(track);
  }

  addClip(trackId, clip = {}) {
    const track = this.tracks.find((track) => track.id === trackId);
    if (!track) throw new Error(`Track '${trackId}' not found`);

    const newClip = {
      id: clip.id || makeId('clip'),
      name: clip.name || `Clip ${track.clips.length + 1}`,
      source_id: clip.source_id || makeId('source'),
      start: clip.start ?? 0,
      end: clip.end ?? (clip.start ?? 0) + (clip.duration || 10),
      trim_in: clip.trim_in || 0,
      trim_out: clip.trim_out || 0,
      speed: clip.speed || 1,
      effects: [],
      transitions: [],
      keyframes: [],
      locked: clip.locked || false,
      muted: clip.muted || false,
      visible: clip.visible !== false,
      opacity: clip.opacity ?? 1,
      volume: clip.volume ?? 1,
      created_at: isoNow(),
    };

    track.clips.push(newClip);
    track.clips.sort((a, b) => a.start - b.start);
    this.duration = Math.max(this.duration, newClip.end);
    this.updated_at = isoNow();
    return clone(newClip);
  }

  removeClip(trackId, clipId) {
    const track = this.tracks.find((track) => track.id === trackId);
    if (!track) throw new Error(`Track '${trackId}' not found`);
    const idx = track.clips.findIndex((clip) => clip.id === clipId);
    if (idx === -1) throw new Error(`Clip '${clipId}' not found`);
    const [removed] = track.clips.splice(idx, 1);
    this.updated_at = isoNow();
    return clone(removed);
  }

  getClip(trackId, clipId) {
    const track = this.tracks.find((track) => track.id === trackId);
    if (!track) throw new Error(`Track '${trackId}' not found`);
    const clip = track.clips.find((clip) => clip.id === clipId);
    if (!clip) throw new Error(`Clip '${clipId}' not found`);
    return clone(clip);
  }

  moveClip(trackId, clipId, newStart) {
    const clip = this.getClip(trackId, clipId);
    const clipDuration = duration(clip);
    clip.start = Math.max(0, newStart);
    clip.end = clip.start + clipDuration;
    this.updated_at = isoNow();
    return clone(clip);
  }

  trimClip(trackId, clipId, newStart, newEnd) {
    const clip = this.getClip(trackId, clipId);
    if (newEnd <= newStart) throw new Error('Invalid trim: end must be greater than start');
    clip.start = Math.max(0, newStart);
    clip.end = Math.max(clip.start + 0.1, newEnd);
    this.updated_at = isoNow();
    return clone(clip);
  }

  splitClip(trackId, clipId, atTime) {
    const track = this.tracks.find((track) => track.id === trackId);
    if (!track) throw new Error(`Track '${trackId}' not found`);
    const clip = track.clips.find((clip) => clip.id === clipId);
    if (!clip) throw new Error(`Clip '${clipId}' not found`);
    if (atTime <= clip.start || atTime >= clip.end) throw new Error('Split time must be within clip');

    const clipDuration = duration(clip);
    const firstDuration = atTime - clip.start;
    const secondDuration = clipDuration - firstDuration;

    clip.end = atTime;
    const secondClip = {
      ...clone(clip),
      id: makeId('clip'),
      name: `${clip.name} (split)`,
      start: atTime,
      end: atTime + secondDuration,
      trim_in: clip.trim_in + firstDuration,
      created_at: isoNow(),
    };

    track.clips.push(secondClip);
    track.clips.sort((a, b) => a.start - b.start);
    this.updated_at = isoNow();
    return [clone(clip), clone(secondClip)];
  }

  mergeClips(trackId, clipIds) {
    const track = this.tracks.find((track) => track.id === trackId);
    if (!track) throw new Error(`Track '${trackId}' not found`);

    const clips = clipIds.map((id) => track.clips.find((clip) => clip.id === id)).filter(Boolean);
    if (clips.length < 2) throw new Error('Need at least 2 clips to merge');

    const start = Math.min(...clips.map((clip) => clip.start));
    const end = Math.max(...clips.map((clip) => clip.end));
    const merged = {
      id: makeId('clip'),
      name: clips.map((clip) => clip.name).join(' + '),
      source_id: clips[0].source_id,
      start,
      end,
      trim_in: clips[0].trim_in,
      trim_out: clips[clips.length - 1].trim_out,
      speed: clips[0].speed,
      effects: clips.flatMap((clip) => clip.effects),
      transitions: clips.flatMap((clip) => clip.transitions),
      keyframes: clips.flatMap((clip) => clip.keyframes),
      locked: false,
      muted: clips.every((clip) => clip.muted),
      visible: clips.every((clip) => clip.visible),
      opacity: Math.min(...clips.map((clip) => clip.opacity)),
      volume: clips.reduce((sum, clip) => sum + clip.volume, 0) / clips.length,
      created_at: isoNow(),
    };

    track.clips = track.clips.filter((clip) => !clipIds.includes(clip.id));
    track.clips.push(merged);
    track.clips.sort((a, b) => a.start - b.start);
    this.updated_at = isoNow();
    return clone(merged);
  }

  addMarker(time, marker = {}) {
    const newMarker = {
      id: marker.id || makeId('marker'),
      time,
      name: marker.name || '',
      color: marker.color || '#ffcc00',
      notes: marker.notes || '',
      created_at: isoNow(),
    };
    this.markers.push(newMarker);
    this.markers.sort((a, b) => a.time - b.time);
    return clone(newMarker);
  }

  removeMarker(markerId) {
    const idx = this.markers.findIndex((marker) => marker.id === markerId);
    if (idx === -1) throw new Error(`Marker '${markerId}' not found`);
    const [removed] = this.markers.splice(idx, 1);
    return clone(removed);
  }

  addComment(time, text, comment = {}) {
    const newComment = {
      id: comment.id || makeId('comment'),
      time,
      text,
      author: comment.author || 'user',
      resolved: comment.resolved || false,
      created_at: isoNow(),
    };
    this.comments.push(newComment);
    this.comments.sort((a, b) => a.time - b.time);
    return clone(newComment);
  }

  getTimelineInfo() {
    const totalClips = this.tracks.reduce((sum, track) => sum + track.clips.length, 0);
    return {
      id: this.id,
      name: this.name,
      duration: this.duration,
      fps: this.fps,
      resolution: this.resolution,
      tracks: this.tracks.length,
      clips: totalClips,
      markers: this.markers.length,
      comments: this.comments.length,
      updated_at: this.updated_at,
    };
  }

  exportTimeline() {
    return clone({
      id: this.id,
      name: this.name,
      duration: this.duration,
      fps: this.fps,
      resolution: this.resolution,
      tracks: this.tracks,
      markers: this.markers,
      comments: this.comments,
      created_at: this.created_at,
      updated_at: this.updated_at,
    });
  }
}

// ── 2. DragDropEngine ──────────────────────────────────────────────────────

export class DragDropEngine {
  constructor(timeline) {
    this.timeline = timeline;
    this.snapGrid = 0.5;
    this.snapEnabled = true;
  }

  snap(time) {
    if (!this.snapEnabled) return time;
    return Math.round(time / this.snapGrid) * this.snapGrid;
  }

  dragClip(trackId, clipId, deltaX, deltaY = 0) {
    const clip = this.timeline.getClip(trackId, clipId);
    const newStart = this.snap(clip.start + deltaX);
    return this.timeline.moveClip(trackId, clipId, newStart);
  }

  dropClip(trackId, clipId, newStart) {
    const snapped = this.snap(newStart);
    return this.timeline.moveClip(trackId, clipId, snapped);
  }

  reorderTrack(trackId, newIndex) {
    const idx = this.timeline.tracks.findIndex((track) => track.id === trackId);
    if (idx === -1) throw new Error(`Track '${trackId}' not found`);
    const [track] = this.timeline.tracks.splice(idx, 1);
    this.timeline.tracks.splice(clamp(newIndex, 0, this.timeline.tracks.length), 0, track);
    this.timeline.updated_at = isoNow();
    return clone(track);
  }

  setSnapGrid(gridSize) {
    if (gridSize <= 0) throw new Error('Snap grid must be positive');
    this.snapGrid = gridSize;
  }

  toggleSnap(enabled) {
    this.snapEnabled = enabled;
  }

  getDragPreview(trackId, clipId, deltaX) {
    const clip = this.timeline.getClip(trackId, clipId);
    const clipDuration = duration(clip);
    return {
      clip_id: clipId,
      start: this.snap(clip.start + deltaX),
      end: this.snap(clip.start + deltaX) + clipDuration,
      track_id: trackId,
    };
  }

  canDrop(trackId, clipId, newStart) {
    const clip = this.timeline.getClip(trackId, clipId);
    const clipDuration = duration(clip);
    const preview = { start: this.snap(newStart), end: this.snap(newStart) + clipDuration };
    const track = this.timeline.getTrack(trackId);
    const conflicts = track.clips.filter((other) => other.id !== clipId && overlaps(preview, other));
    return {
      can_drop: conflicts.length === 0,
      conflicts: conflicts.map((c) => c.id),
      preview,
    };
  }
}

// ── 3. EffectSystem ────────────────────────────────────────────────────────

export class EffectSystem {
  constructor(timeline = null) {
    this.timeline = timeline;
    this._effects = new Map();
    this._presets = new Map();
  }

  registerEffect(name, config = {}) {
    const effect = {
      id: config.id || makeId('effect'),
      name,
      type: config.type || 'custom',
      parameters: config.parameters || {},
      version: config.version || '1.0.0',
      created_at: isoNow(),
    };
    this._effects.set(name, clone(effect));
    return clone(effect);
  }

  applyEffect(trackId, clipId, effectName, parameters = {}) {
    const effect = this._effects.get(effectName);
    if (!effect) throw new Error(`Effect '${effectName}' not registered`);

    const applied = {
      id: makeId('applied_effect'),
      effect_id: effect.id,
      name: effectName,
      parameters: clone(parameters),
      intensity: parameters.intensity ?? 1,
      enabled: true,
      applied_at: isoNow(),
    };

    const track = this.timeline.tracks.find((track) => track.id === trackId);
    const clip = track.clips.find((clip) => clip.id === clipId);
    clip.effects.push(applied);
    return clone(applied);
  }

  removeEffect(trackId, clipId, effectId) {
    const track = this.timeline.tracks.find((track) => track.id === trackId);
    const clip = track.clips.find((clip) => clip.id === clipId);
    const idx = clip.effects.findIndex((effect) => effect.id === effectId);
    if (idx === -1) throw new Error(`Effect '${effectId}' not found`);
    const [removed] = clip.effects.splice(idx, 1);
    return clone(removed);
  }

  reorderEffects(trackId, clipId, effectIds) {
    const track = this.timeline.tracks.find((track) => track.id === trackId);
    const clip = track.clips.find((clip) => clip.id === clipId);
    const effects = effectIds.map((id) => clip.effects.find((effect) => effect.id === id)).filter(Boolean);
    clip.effects = effects;
    return clone(effects);
  }

  createPreset(name, effectIds) {
    const preset = {
      id: makeId('preset'),
      name,
      effect_ids: effectIds,
      created_at: isoNow(),
    };
    this._presets.set(name, clone(preset));
    return clone(preset);
  }

  applyPreset(trackId, clipId, presetName) {
    const preset = this._presets.get(presetName);
    if (!preset) throw new Error(`Preset '${presetName}' not found`);
    const effects = preset.effect_ids.map((id) => {
      const effect = [...this._effects.values()].find((e) => e.id === id);
      return this.applyEffect(trackId, clipId, effect.name, {});
    });
    return clone(effects);
  }

  listEffects() {
    return [...this._effects.values()].map(clone);
  }

  listPresets() {
    return [...this._presets.values()].map(clone);
  }
}

// ── 4. TransitionSystem ────────────────────────────────────────────────────

export class TransitionSystem {
  constructor(timeline = null) {
    this.timeline = timeline;
    this._transitions = new Map();
  }

  registerTransition(name, config = {}) {
    const transition = {
      id: config.id || makeId('transition'),
      name,
      type: config.type || 'custom',
      duration: config.duration || 0.5,
      parameters: config.parameters || {},
      created_at: isoNow(),
    };
    this._transitions.set(name, clone(transition));
    return clone(transition);
  }

  addTransition(trackId, clipId, transitionName, options = {}) {
    const transition = this._transitions.get(transitionName);
    if (!transition) throw new Error(`Transition '${transitionName}' not registered`);

    const added = {
      id: makeId('transition'),
      transition_id: transition.id,
      name: transitionName,
      duration: options.duration || transition.duration,
      position: options.position || 'out',
      parameters: clone(options.parameters || {}),
      created_at: isoNow(),
    };

    const track = this.timeline.tracks.find((track) => track.id === trackId);
    const clip = track.clips.find((clip) => clip.id === clipId);
    clip.transitions.push(added);
    return clone(added);
  }

  removeTransition(trackId, clipId, transitionId) {
    const track = this.timeline.tracks.find((track) => track.id === trackId);
    const clip = track.clips.find((clip) => clip.id === clipId);
    const idx = clip.transitions.findIndex((transition) => transition.id === transitionId);
    if (idx === -1) throw new Error(`Transition '${transitionId}' not found`);
    const [removed] = clip.transitions.splice(idx, 1);
    return clone(removed);
  }

  listTransitions() {
    return [...this._transitions.values()].map(clone);
  }
}

// ── 5. ExportManager ───────────────────────────────────────────────────────

export class ExportManager {
  constructor() {
    this._queue = [];
    this._completed = [];
  }

  createExportJob(timeline, preset = 'youtube', options = {}) {
    const presetConfig = EXPORT_PRESETS[preset] || EXPORT_PRESETS.youtube;
    const job = {
      id: makeId('export'),
      timeline_id: timeline.id,
      preset,
      format: options.format || presetConfig.format,
      codec: options.codec || presetConfig.codec,
      resolution: options.resolution || presetConfig.resolution,
      fps: options.fps || presetConfig.fps,
      bitrate: options.bitrate || presetConfig.bitrate,
      status: 'queued',
      progress: 0,
      created_at: isoNow(),
      started_at: null,
      completed_at: null,
    };
    this._queue.push(job);
    return clone(job);
  }

  startExport(jobId) {
    const job = this._queue.find((job) => job.id === jobId);
    if (!job) throw new Error(`Export job '${jobId}' not found`);
    job.status = 'rendering';
    job.started_at = isoNow();
    job.progress = 1;
    return clone(job);
  }

  updateProgress(jobId, progress) {
    const job = this._queue.find((job) => job.id === jobId);
    if (!job) throw new Error(`Export job '${jobId}' not found`);
    job.progress = clamp(progress, 0, 100);
    if (job.progress >= 100) {
      job.status = 'completed';
      job.completed_at = isoNow();
      this._completed.push(clone(job));
    }
    return clone(job);
  }

  cancelExport(jobId) {
    const job = this._queue.find((job) => job.id === jobId);
    if (!job) throw new Error(`Export job '${jobId}' not found`);
    job.status = 'cancelled';
    return clone(job);
  }

  getExportStatus(jobId) {
    const job = this._queue.find((job) => job.id === jobId);
    if (!job) throw new Error(`Export job '${jobId}' not found`);
    return {
      id: job.id,
      status: job.status,
      progress: job.progress,
      preset: job.preset,
      format: job.format,
      resolution: job.resolution,
      started_at: job.started_at,
      completed_at: job.completed_at,
    };
  }

  listQueue() {
    return clone(this._queue);
  }

  listCompleted() {
    return clone(this._completed);
  }

  clearQueue() {
    this._queue = [];
  }
}

// ── 6. UndoRedoManager ─────────────────────────────────────────────────────

export class UndoRedoManager {
  constructor() {
    this._undoStack = [];
    this._redoStack = [];
    this._limit = 100;
  }

  pushState(state) {
    this._undoStack.push(clone(state));
    if (this._undoStack.length > this._limit) this._undoStack.shift();
    this._redoStack = [];
  }

  undo() {
    if (this._undoStack.length === 0) return null;
    const state = this._undoStack.pop();
    this._redoStack.push(state);
    return clone(state);
  }

  redo() {
    if (this._redoStack.length === 0) return null;
    const state = this._redoStack.pop();
    this._undoStack.push(state);
    return clone(state);
  }

  canUndo() {
    return this._undoStack.length > 0;
  }

  canRedo() {
    return this._redoStack.length > 0;
  }

  clear() {
    this._undoStack = [];
    this._redoStack = [];
  }

  getHistory() {
    return clone({
      undo: this._undoStack,
      redo: this._redoStack,
      undo_count: this._undoStack.length,
      redo_count: this._redoStack.length,
    });
  }
}

// ── 7. KeyboardShortcutManager ─────────────────────────────────────────────

export class KeyboardShortcutManager {
  constructor() {
    this._shortcuts = clone(KEYBOARD_SHORTCUTS);
  }

  registerShortcut(key, action) {
    this._shortcuts[key] = action;
  }

  unregisterShortcut(key) {
    delete this._shortcuts[key];
  }

  handleShortcut(key) {
    const action = this._shortcuts[key];
    if (!action) return null;
    return { key, action, handled: true, handled_at: isoNow() };
  }

  listShortcuts() {
    return clone(this._shortcuts);
  }

  resetToDefaults() {
    this._shortcuts = clone(KEYBOARD_SHORTCUTS);
  }
}

// ── 8. PreviewManager ──────────────────────────────────────────────────────

export class PreviewManager {
  constructor() {
    this._previews = new Map();
  }

  generatePreview(timeline, options = {}) {
    const preview = {
      id: makeId('preview'),
      timeline_id: timeline.id,
      thumbnail_url: options.thumbnail_url || `https://preview.vireo.studio/${timeline.id}/thumb.jpg`,
      duration: timeline.duration,
      resolution: timeline.resolution,
      fps: timeline.fps,
      status: 'ready',
      generated_at: isoNow(),
    };
    this._previews.set(preview.id, clone(preview));
    return clone(preview);
  }

  getPreview(previewId) {
    const preview = this._previews.get(previewId);
    if (!preview) throw new Error(`Preview '${previewId}' not found`);
    return clone(preview);
  }

  listPreviews() {
    return [...this._previews.values()].map(clone);
  }

  clearPreviews() {
    this._previews.clear();
  }
}

// ── 9. AutoSaveManager ─────────────────────────────────────────────────────

export class AutoSaveManager {
  constructor() {
    this._snapshots = new Map();
    this._interval = 30;
  }

  setInterval(seconds) {
    if (seconds <= 0) throw new Error('Interval must be positive');
    this._interval = seconds;
  }

  saveSnapshot(projectId, data) {
    const snapshot = {
      id: makeId('snapshot'),
      project_id: projectId,
      data: clone(data),
      saved_at: isoNow(),
    };
    this._snapshots.set(snapshot.id, clone(snapshot));
    return clone(snapshot);
  }

  getSnapshot(snapshotId) {
    const snapshot = this._snapshots.get(snapshotId);
    if (!snapshot) throw new Error(`Snapshot '${snapshotId}' not found`);
    return clone(snapshot);
  }

  listSnapshots(projectId) {
    return [...this._snapshots.values()]
      .filter((snapshot) => snapshot.project_id === projectId)
      .map(clone);
  }

  restoreSnapshot(snapshotId) {
    const snapshot = this.getSnapshot(snapshotId);
    return clone(snapshot.data);
  }

  deleteSnapshot(snapshotId) {
    this._snapshots.delete(snapshotId);
  }

  clearSnapshots(projectId) {
    for (const [id, snapshot] of this._snapshots.entries()) {
      if (!projectId || snapshot.project_id === projectId) this._snapshots.delete(id);
    }
  }
}

// ── 10. ManualEditorEngine ─────────────────────────────────────────────────

export class ManualEditorEngine {
  constructor(options = {}) {
    this.timeline = options.timeline || new Timeline(options.timelineOptions || {});
    this.dragDrop = new DragDropEngine(this.timeline);
    this.effects = new EffectSystem(this.timeline);
    this.transitions = new TransitionSystem(this.timeline);
    this.exports = new ExportManager();
    this.undoRedo = new UndoRedoManager();
    this.shortcuts = new KeyboardShortcutManager();
    this.previews = new PreviewManager();
    this.autoSave = new AutoSaveManager();

    this._initializeDefaults();
  }

  _initializeDefaults() {
    EFFECT_TYPES.forEach((type) => this.effects.registerEffect(type, { type }));
    TRANSITION_TYPES.forEach((type) => this.transitions.registerTransition(type, { type }));
    this.timeline.addTrack({ name: 'Video', type: 'video' });
    this.timeline.addTrack({ name: 'Audio', type: 'audio' });
  }

  createProject(name = 'Untitled Project') {
    this.timeline.name = name;
    this.undoRedo.pushState(this.timeline.exportTimeline());
    return this.timeline.exportTimeline();
  }

  addClip(trackId, clip = {}) {
    const result = this.timeline.addClip(trackId, clip);
    this.undoRedo.pushState(this.timeline.exportTimeline());
    return result;
  }

  editClip(trackId, clipId, changes) {
    const clip = this.timeline.getClip(trackId, clipId);
    Object.assign(clip, changes);
    this.undoRedo.pushState(this.timeline.exportTimeline());
    return clone(clip);
  }

  applyEffect(trackId, clipId, effectName, parameters = {}) {
    const result = this.effects.applyEffect(trackId, clipId, effectName, parameters);
    this.undoRedo.pushState(this.timeline.exportTimeline());
    return result;
  }

  addTransition(trackId, clipId, transitionName, options = {}) {
    const result = this.transitions.addTransition(trackId, clipId, transitionName, options);
    this.undoRedo.pushState(this.timeline.exportTimeline());
    return result;
  }

  exportVideo(preset = 'youtube') {
    const job = this.exports.createExportJob(this.timeline, preset);
    return this.exports.startExport(job.id);
  }

  getExportStatus(jobId) {
    return this.exports.getExportStatus(jobId);
  }

  undo() {
    return this.undoRedo.undo();
  }

  redo() {
    return this.undoRedo.redo();
  }

  handleShortcut(key) {
    return this.shortcuts.handleShortcut(key);
  }

  saveSnapshot() {
    return this.autoSave.saveSnapshot(this.timeline.id, this.timeline.exportTimeline());
  }

  generatePreview() {
    return this.previews.generatePreview(this.timeline);
  }

  getStatus() {
    return {
      timeline: this.timeline.getTimelineInfo(),
      effects: this.effects.listEffects().length,
      transitions: this.transitions.listTransitions().length,
      exports: this.exports.listQueue().length,
      undo_available: this.undoRedo.canUndo(),
      redo_available: this.undoRedo.canRedo(),
      shortcuts: Object.keys(this.shortcuts.listShortcuts()).length,
      previews: this.previews.listPreviews().length,
      snapshots: this.autoSave.listSnapshots(this.timeline.id).length,
      checked_at: isoNow(),
    };
  }
}

export const manualEditor = {
  Timeline,
  DragDropEngine,
  EffectSystem,
  TransitionSystem,
  ExportManager,
  UndoRedoManager,
  KeyboardShortcutManager,
  PreviewManager,
  AutoSaveManager,
  ManualEditorEngine,
};

export default manualEditor;
