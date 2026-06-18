import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AudioClip, AudioTrack, Clip, ColorGrade, ExportJob, Keyframe, ProjectAsset, ProjectState, TitleProps, Tool, Track } from '../types';
import { createExportClient } from "../exportClient";
import {
  applyTimelineOperation,
  createEmptyProjectState,
  findClipInDoc,
  makeTimelineOp,
  timelineToProject,
} from '../timelineContract';
import { advancePlayhead, seekToFrame } from '../timelinePlayback';

export type { Tool };

type TimelineServerState = {
  doc: import('../types').TimelineDocument;
  version: number;
  timelineId: string;
  projectId?: string;
  undo_cursor_seq?: number | null;
  can_redo?: boolean;
};

type PendingCommit = {
  baseVersion: number;
  baseDoc: import('../types').TimelineDocument;
  ops: import('../types').TimelineOp[];
};

const MIN_CLIP_DURATION = 0.1;

function getActiveProjectId() {
  return localStorage.getItem('vireo_active_project_id') || localStorage.getItem('vireo.activeProjectId') || undefined;
}

function authHeaders() {
  const token = localStorage.getItem('vireo_token') || localStorage.getItem('vireo.auth.token');
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function newClipId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeProjectNameFromDoc(doc: import('../types').TimelineDocument) {
  const raw = doc.projectId || 'Untitled project';
  return String(raw || 'Untitled project');
}

function toProject(doc: import('../types').TimelineDocument, fallbackName = 'Untitled project') {
  return timelineToProject(doc, normalizeProjectNameFromDoc(doc) || fallbackName);
}

function clampResizeStart(start: number, end: number) {
  return Math.max(0, Math.min(start, end - MIN_CLIP_DURATION));
}

function clampResizeEnd(start: number, end: number) {
  return Math.max(start + MIN_CLIP_DURATION, end);
}

function createMoveOpFromDoc(doc: import('../types').TimelineDocument, clipId: string, newStart: number, targetTrackId?: string) {
  const located = findClipInDoc(doc, clipId);
  if (!located) return null;
  const { track, clip } = located;
  const targetTrack = doc.tracks.find((item) => item.id === targetTrackId) ?? track;
  const start = Math.max(0, Number.isFinite(newStart) ? newStart : clip.start);
  return makeTimelineOp({
    op: 'moveClip',
    actor: 'human',
    timelineId: doc.timelineId,
    trackId: track.id,
    clipId,
    payload: { targetTrackId: targetTrack.id, start, originalStart: clip.start },
  });
}

function createTrimOpFromDoc(doc: import('../types').TimelineDocument, clipId: string, side: 'left' | 'right', value: number) {
  const located = findClipInDoc(doc, clipId);
  if (!located) return null;
  const { track, clip } = located;
  const originalStart = clip.start;
  const originalEnd = clip.end ?? clip.start + 1;
  let start = originalStart;
  let end = originalEnd;
  if (side === 'left') {
    start = clampResizeStart(value, originalEnd);
    end = originalEnd;
  } else {
    start = originalStart;
    end = clampResizeEnd(originalStart, value);
  }
  return makeTimelineOp({
    op: 'trimClip',
    actor: 'human',
    timelineId: doc.timelineId,
    trackId: track.id,
    clipId,
    payload: { start, end, originalStart, originalEnd },
  });
}

function createSplitOpFromDoc(doc: import('../types').TimelineDocument, clipId: string, atSec: number) {
  const located = findClipInDoc(doc, clipId);
  if (!located) return null;
  const { track, clip } = located;
  const at = Math.max(0, Math.min(Number(atSec) || 0, clip.end ?? clip.start + 1));
  if (at <= clip.start + MIN_CLIP_DURATION || at >= (clip.end ?? clip.start + 1) - MIN_CLIP_DURATION) return null;
  const rightId = newClipId('clp');
  return makeTimelineOp({
    op: 'splitClip',
    actor: 'human',
    timelineId: doc.timelineId,
    trackId: track.id,
    clipId,
    payload: { at, rightId },
  });
}

function createDuplicateOpFromDoc(doc: import('../types').TimelineDocument, clipId: string) {
  const located = findClipInDoc(doc, clipId);
  if (!located) return null;
  const { track, clip } = located;
  const dup: Record<string, unknown> = {
    ...clip,
    id: newClipId('clp'),
    start: clip.end ?? clip.start + 1,
    end: (clip.end ?? clip.start + 1) + ((clip.end ?? clip.start + 1) - clip.start),
    selected: false,
  };
  return makeTimelineOp({
    op: 'insertClip',
    actor: 'human',
    timelineId: doc.timelineId,
    trackId: track.id,
    clipId: String(dup.id),
    payload: { clip: dup, index: track.clips.length },
  });
}

function createInsertAssetOpFromDoc(doc: import('../types').TimelineDocument, asset: ProjectAsset, trackId: string, startSec: number) {
  const track = doc.tracks.find((item) => item.id === trackId) ?? doc.tracks.find((item) => item.kind === 'video') ?? doc.tracks[0];
  if (!track) return null;
  const duration = Math.max(0.1, Number(asset.duration_sec) || 5);
  const start = Math.max(0, Number.isFinite(Number(startSec)) ? Number(startSec) : 0);
  const clip = {
    id: newClipId('clp'),
    assetId: asset.id,
    start,
    end: start + duration,
    in: 0,
    out: duration,
    source: asset.source || 'upload',
    name: asset.filename || asset.name || asset.id,
    selected: false,
    locked: false,
    muted: false,
    text: '',
    transform: {},
    effects: [],
  };
  return makeTimelineOp({
    op: 'insertClip',
    actor: 'human',
    timelineId: doc.timelineId,
    trackId: track.id,
    clipId: clip.id,
    payload: { clip, index: track.clips.length },
  });
}

function createDeleteOpFromDoc(doc: import('../types').TimelineDocument, clipId: string) {
  const located = findClipInDoc(doc, clipId);
  if (!located) return null;
  return makeTimelineOp({
    op: 'deleteClip',
    actor: 'human',
    timelineId: doc.timelineId,
    trackId: located.track.id,
    clipId,
    payload: { ripple: true },
  });
}

function createSetTrackFlagOp(doc: import('../types').TimelineDocument, trackId: string, flag: 'muted' | 'soloed' | 'locked' | 'hidden', value: boolean) {
  const track = doc.tracks.find((item) => item.id === trackId);
  if (!track) return null;
  return makeTimelineOp({
    op: 'setTrackFlag',
    actor: 'human',
    timelineId: doc.timelineId,
    trackId,
    payload: { [flag]: value },
  });
}

function createSetTrackAudioOpFromDoc(doc: import('../types').TimelineDocument, trackId: string, audio: Partial<AudioTrack>) {
  const track = doc.tracks.find((item) => item.id === trackId);
  if (!track || track.kind !== 'audio') return null;
  const patch: Record<string, unknown> = {};
  for (const key of ['gainDb', 'pan', 'fadeIn', 'fadeOut', 'crossfade', 'ducking'] as const) {
    if (Object.prototype.hasOwnProperty.call(audio, key) && audio[key] !== undefined) patch[key] = audio[key];
  }
  if (Object.keys(patch).length === 0) return null;
  return makeTimelineOp({
    op: 'setTrackAudio',
    actor: 'human',
    timelineId: doc.timelineId,
    trackId,
    payload: { audio: patch },
  });
}

function createSetClipAudioOpFromDoc(doc: import('../types').TimelineDocument, clipId: string, audio: Partial<AudioClip>) {
  const located = findClipInDoc(doc, clipId);
  if (!located || located.track.kind !== 'audio') return null;
  const patch: Record<string, unknown> = {};
  for (const key of ['gainDb', 'pan', 'fadeIn', 'fadeOut', 'crossfade', 'meters', 'waveform'] as const) {
    if (Object.prototype.hasOwnProperty.call(audio, key) && audio[key] !== undefined) patch[key] = audio[key];
  }
  if (Object.keys(patch).length === 0) return null;
  return makeTimelineOp({
    op: 'setClipAudio',
    actor: 'human',
    timelineId: doc.timelineId,
    trackId: located.track.id,
    clipId,
    payload: { audio: patch },
  });
}

function createSetClipColorOpFromDoc(doc: import('../types').TimelineDocument, clipId: string, color: Partial<ColorGrade>) {
  const located = findClipInDoc(doc, clipId);
  if (!located || !['video', 'image'].includes(located.track.kind)) return null;
  return makeTimelineOp({
    op: 'setClipColor',
    actor: 'human',
    timelineId: doc.timelineId,
    trackId: located.track.id,
    clipId,
    payload: { color: color as Record<string, unknown> },
  });
}

function findTextTrack(doc: import('../types').TimelineDocument) {
  return doc.tracks.find((track) => track.id === 'trk_t1' || track.id === 't1' || track.kind === 'text') ?? null;
}

function findNextClip(track: { clips: Array<{ id: string; start?: number; start_sec?: number }> }, clipId: string) {
  const sorted = [...track.clips].sort((a, b) => (a.start_sec ?? a.start ?? 0) - (b.start_sec ?? b.start ?? 0));
  const index = sorted.findIndex((clip) => clip.id === clipId);
  return index >= 0 ? sorted[index + 1] ?? null : null;
}

function normalizeEffect(effect: Record<string, unknown>) {
  const params = effect.params && typeof effect.params === 'object' ? effect.params as Record<string, unknown> : {};
  return {
    id: String(effect.id || newClipId('fx')),
    type: String(effect.type || effect.name || 'effect'),
    name: String(effect.name || effect.type || 'Effect'),
    params,
  };
}

function createTransitionOpFromDoc(doc: import('../types').TimelineDocument, fromClipId: string, kind: string, durationSec: number) {
  const track = doc.tracks.find((item) => item.clips.some((clip) => clip.id === fromClipId));
  if (!track) return null;
  const next = findNextClip(track, fromClipId);
  if (!next) return null;
  const duration = Math.max(0.001, Number(durationSec) || 0.25);
  return makeTimelineOp({
    op: 'addTransition',
    actor: 'human',
    timelineId: doc.timelineId,
    trackId: track.id,
    clipId: fromClipId,
    payload: {
      clipId: fromClipId,
      trackId: track.id,
      fromClipId,
      toClipId: next.id,
      kind,
      duration,
    },
  });
}

function createTextOpFromDoc(doc: import('../types').TimelineDocument, text: string, startSec: number, durationSec: number, position: { x: number; y: number }, titleProps?: Partial<TitleProps>) {
  const track = findTextTrack(doc);
  if (!track) return null;
  const start = Math.max(0, Number(startSec) || 0);
  const duration = Math.max(0.1, Number(durationSec) || 3);
  const end = start + duration;
  const clip = {
    id: newClipId('txt'),
    assetId: '',
    start,
    end,
    in: 0,
    out: duration,
    transform: { x: Number(position.x) || 0, y: Number(position.y) || 0 },
    effects: [],
    source: 'text',
    name: text || 'Text',
    text: text || '',
    titleProps: titleProps ? { ...titleProps, text: text || titleProps.text || '' } : { text: text || '', fontFamily: 'Inter', fontSize: 44, color: '#ffffff', align: 'center' },
  };
  return makeTimelineOp({
    op: 'addText',
    actor: 'human',
    timelineId: doc.timelineId,
    trackId: track.id,
    payload: {
      text: text || '',
      start,
      end,
      in: 0,
      out: duration,
      clip,
      titleProps: clip.titleProps,
    },
  });
}

function findEffectClip(doc: import('../types').TimelineDocument, clipId?: string | null) {
  if (clipId) {
    const located = findClipInDoc(doc, clipId);
    if (located) return located;
  }
  const firstVideo = doc.tracks.find((track) => track.kind === 'video')?.clips[0];
  if (!firstVideo) return null;
  const track = doc.tracks.find((item) => item.clips.some((clip) => clip.id === firstVideo.id));
  return track ? { track, clip: firstVideo } : null;
}

function createAddEffectOpFromDoc(doc: import('../types').TimelineDocument, effect: Record<string, unknown>, clipId?: string | null) {
  const located = findEffectClip(doc, clipId);
  if (!located) return null;
  return makeTimelineOp({
    op: 'addEffect',
    actor: 'human',
    timelineId: doc.timelineId,
    trackId: located.track.id,
    clipId: located.clip.id,
    payload: { effect: normalizeEffect(effect) },
  });
}

function createSetEffectOpFromDoc(doc: import('../types').TimelineDocument, effect: Record<string, unknown>, clipId?: string | null) {
  const located = findEffectClip(doc, clipId);
  if (!located) return null;
  const effects = Array.isArray(located.clip.effects) ? located.clip.effects as Record<string, unknown>[] : [];
  const index = Math.max(0, Math.min(effects.length - 1, 0));
  const existing = effects[index] ?? null;
  return makeTimelineOp({
    op: 'setEffect',
    actor: 'human',
    timelineId: doc.timelineId,
    trackId: located.track.id,
    clipId: located.clip.id,
    payload: {
      effectId: String(existing?.id || effect.id || newClipId('fx')),
      effect: { ...normalizeEffect(effect), id: String(existing?.id || effect.id || newClipId('fx')) },
      index,
    },
  });
}

function createSetTransformOpFromDoc(doc: import('../types').TimelineDocument, clipId: string, transform: Record<string, number>) {
  const located = findClipInDoc(doc, clipId);
  if (!located) return null;
  const patch: Record<string, number> = {};
  if (Object.prototype.hasOwnProperty.call(transform, 'x')) patch.x = Number(transform.x);
  if (Object.prototype.hasOwnProperty.call(transform, 'y')) patch.y = Number(transform.y);
  if (Object.prototype.hasOwnProperty.call(transform, 'scale')) patch.scale = Math.max(0, Number(transform.scale));
  if (Object.prototype.hasOwnProperty.call(transform, 'opacity')) patch.opacity = Math.max(0, Math.min(1, Number(transform.opacity)));
  if (Object.keys(patch).length === 0) return null;
  return makeTimelineOp({
    op: 'setTransform',
    actor: 'human',
    timelineId: doc.timelineId,
    trackId: located.track.id,
    clipId,
    payload: { transform: patch },
  });
}

function createSetTitlePropsOpFromDoc(doc: import('../types').TimelineDocument, clipId: string, titleProps: Partial<TitleProps>) {
  const located = findClipInDoc(doc, clipId);
  if (!located) return null;
  const patch: Partial<TitleProps> = {};
  if (Object.prototype.hasOwnProperty.call(titleProps, 'text') && titleProps.text !== undefined) patch.text = titleProps.text;
  if (Object.prototype.hasOwnProperty.call(titleProps, 'fontFamily') && titleProps.fontFamily !== undefined) patch.fontFamily = titleProps.fontFamily;
  if (Object.prototype.hasOwnProperty.call(titleProps, 'fontSize') && titleProps.fontSize !== undefined) patch.fontSize = titleProps.fontSize;
  if (Object.prototype.hasOwnProperty.call(titleProps, 'color') && titleProps.color !== undefined) patch.color = titleProps.color;
  if (Object.prototype.hasOwnProperty.call(titleProps, 'align') && titleProps.align !== undefined) patch.align = titleProps.align;
  if (Object.prototype.hasOwnProperty.call(titleProps, 'backgroundColor') && titleProps.backgroundColor !== undefined) patch.backgroundColor = titleProps.backgroundColor;
  if (Object.prototype.hasOwnProperty.call(titleProps, 'strokeColor') && titleProps.strokeColor !== undefined) patch.strokeColor = titleProps.strokeColor;
  if (Object.prototype.hasOwnProperty.call(titleProps, 'strokeWidth') && titleProps.strokeWidth !== undefined) patch.strokeWidth = titleProps.strokeWidth;
  if (Object.keys(patch).length === 0) return null;
  return makeTimelineOp({
    op: 'setTitleProps',
    actor: 'human',
    timelineId: doc.timelineId,
    trackId: located.track.id,
    clipId,
    payload: { titleProps: patch },
  });
}

function createSetKeyframeOpFromDoc(doc: import('../types').TimelineDocument, clipId: string, targetId: string, param: string, keyframe: Keyframe) {
  const located = findClipInDoc(doc, clipId);
  if (!located) return null;
  return makeTimelineOp({
    op: 'setKeyframe',
    actor: 'human',
    timelineId: doc.timelineId,
    trackId: located.track.id,
    clipId,
    payload: { targetId, param, keyframe: normalizeKeyframe(keyframe) },
  });
}

function createRemoveKeyframeOpFromDoc(doc: import('../types').TimelineDocument, clipId: string, targetId: string, param: string, time: number) {
  const located = findClipInDoc(doc, clipId);
  if (!located) return null;
  return makeTimelineOp({
    op: 'removeKeyframe',
    actor: 'human',
    timelineId: doc.timelineId,
    trackId: located.track.id,
    clipId,
    payload: { targetId, param, time: Number(time) },
  });
}

function normalizeKeyframe(keyframe: Keyframe) {
  return {
    time: Math.max(0, Number(keyframe.time)),
    value: Number(keyframe.value),
    interp: keyframe.interp || 'linear',
  };
}

function createSetVolumeOpFromDoc(doc: import('../types').TimelineDocument, clipId: string, volume: number) {
  const located = findClipInDoc(doc, clipId);
  if (!located) return null;
  return makeTimelineOp({
    op: 'setVolume',
    actor: 'human',
    timelineId: doc.timelineId,
    trackId: located.track.id,
    clipId,
    payload: { volume: Math.max(0, Math.min(1, Number(volume) || 0)) },
  });
}

function rebaseOp(doc: import('../types').TimelineDocument, op: import('../types').TimelineOp) {
  const track = doc.tracks.find((item) => item.id === op.trackId);
  const clip = track ? track.clips.find((item) => item.id === op.clipId) : null;

  if (op.op === 'addText') {
    const textTrack = findTextTrack(doc);
    if (!textTrack) return null;
    return {
      ...op,
      timelineId: doc.timelineId,
      trackId: textTrack.id,
    };
  }

  if (op.op === 'addTransition') {
    const transitionTrack = doc.tracks.find((item) => item.id === op.trackId);
    const fromClip = transitionTrack ? transitionTrack.clips.find((item) => item.id === op.clipId || item.id === op.payload?.fromClipId) : null;
    const toClip = transitionTrack && fromClip ? findNextClip(transitionTrack, fromClip.id) : null;
    if (!transitionTrack || !fromClip || !toClip) return null;
    return {
      ...op,
      timelineId: doc.timelineId,
      trackId: transitionTrack.id,
      clipId: fromClip.id,
      payload: {
        ...(op.payload || {}),
        clipId: fromClip.id,
        trackId: transitionTrack.id,
        fromClipId: fromClip.id,
        toClipId: toClip.id,
      },
    };
  }

  if (op.op === 'addEffect') {
    if (!track || !clip) return null;
    return {
      ...op,
      timelineId: doc.timelineId,
      trackId: track.id,
      clipId: clip.id,
    };
  }

  if (op.op === 'setEffect') {
    if (!track || !clip) return null;
    const effects = Array.isArray(clip.effects) ? clip.effects as Record<string, unknown>[] : [];
    const index = Number((op.payload as Record<string, unknown> | undefined)?.index ?? 0);
    const existing = effects[index] ?? effects[0] ?? null;
    return {
      ...op,
      timelineId: doc.timelineId,
      trackId: track.id,
      clipId: clip.id,
      payload: {
        ...(op.payload || {}),
        effectId: existing?.id || (op.payload as Record<string, unknown> | undefined)?.effectId,
        effect: {
          ...((op.payload as Record<string, unknown> | undefined)?.effect || {}),
          id: existing?.id || (op.payload as Record<string, unknown> | undefined)?.effectId || newClipId('fx'),
        },
      },
    };
  }

  if (op.op === 'setTransform' || op.op === 'setTitleProps' || op.op === 'setTrackAudio' || op.op === 'setClipAudio' || op.op === 'setVolume' || op.op === 'setKeyframe' || op.op === 'removeKeyframe') {
    if (!track || !clip) return null;
    return {
      ...op,
      timelineId: doc.timelineId,
      trackId: track.id,
      clipId: clip.id,
    };
  }

  if (op.op === 'setTrackFlag') {
    if (!track) return null;
    return {
      ...op,
      timelineId: doc.timelineId,
      trackId: track.id,
    };
  }

  if (!track || !clip) return null;
  return {
    ...op,
    timelineId: doc.timelineId,
    trackId: track.id,
    clipId: clip.id,
  };
}

function rebaseOps(doc: import('../types').TimelineDocument, ops: import('../types').TimelineOp[]) {
  return ops
    .map((op) => rebaseOp(doc, op))
    .filter(Boolean) as import('../types').TimelineOp[];
}

export function useEditor() {
  const [project, setProject] = useState<ProjectState>(() => createEmptyProjectState());
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [playhead, setPlayhead] = useState<number>(0);
  const [playing, setPlaying] = useState(false);
  const [tool, setTool] = useState<Tool>('razor');
  const [zoom, setZoom] = useState(80);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [exportPresetId, setExportPresetId] = useState('youtube_1080p');
  const [exportJob, setExportJob] = useState<ExportJob | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const serverRef = useRef<TimelineServerState | null>(null);
  const pendingRef = useRef<PendingCommit | null>(null);
  const commitInFlightRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number | null>(null);

  const selectedClip = selectedClipId
    ? project.tracks.flatMap((t) => t.clips).find((c) => c.id === selectedClipId) ?? null
    : null;

  const applyServerTimeline = useCallback((timeline: Partial<TimelineServerState> & { doc: import('../types').TimelineDocument; version: number }) => {
    const next = {
      doc: timeline.doc,
      version: Number(timeline.version || 1),
      timelineId: timeline.timelineId || timeline.doc.timelineId,
      projectId: timeline.projectId || timeline.doc.projectId,
    };
    serverRef.current = next;
    setProject(toProject(next.doc));
    setCanUndo(next.version > 1 || Number(timeline.undo_cursor_seq || 0) > 0);
    setCanRedo(Boolean(timeline.can_redo));
    setPlayhead((current) => Math.max(0, Math.min(current, toProject(next.doc).duration_sec)));
  }, []);

  const fetchTimeline = useCallback(async (projectId?: string) => {
    if (!projectId) {
      serverRef.current = null;
      setCanUndo(false);
      setCanRedo(false);
      return null;
    }
    setTimelineLoading(true);
    setTimelineError(null);
    try {
      const res = await fetch(`/api/timelines/${encodeURIComponent(projectId)}`, { headers: authHeaders() });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || `GET /api/timelines/${projectId} failed`);
      const timeline = body.timeline;
      if (!timeline?.doc) throw new Error('Timeline response missing doc');
      applyServerTimeline({ ...timeline, projectId });
      return serverRef.current;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setTimelineError(message);
      return null;
    } finally {
      setTimelineLoading(false);
    }
  }, [applyServerTimeline]);

  useEffect(() => {
    const projectId = getActiveProjectId();
    fetchTimeline(projectId);
  }, [fetchTimeline]);

  useEffect(() => {
    if (!playing) {
      if (rafRef.current !== null && typeof window !== 'undefined') {
        window.cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = null;
      lastTickRef.current = null;
      return;
    }

    const tick = (now: number) => {
      if (lastTickRef.current === null) {
        lastTickRef.current = now;
      }
      const elapsedMs = now - lastTickRef.current;
      lastTickRef.current = now;
      setPlayhead((current) => {
        const next = advancePlayhead(current, project.duration_sec, project.fps, elapsedMs);
        if (next >= project.duration_sec) {
          setPlaying(false);
          return project.duration_sec;
        }
        return next;
      });
      rafRef.current = window.requestAnimationFrame(tick);
    };

    rafRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastTickRef.current = null;
    };
  }, [playing, project.duration_sec, project.fps]);

  const postOps = useCallback(async (pending: PendingCommit) => {
    const projectId = pending.baseDoc.projectId || getActiveProjectId();
    if (!projectId) throw new Error('No active project id for timeline ops');
    const res = await fetch(`/api/timelines/${encodeURIComponent(projectId)}/ops`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ baseVersion: pending.baseVersion, actor: 'human', ops: pending.ops }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(body.message || body.error || `POST /api/timelines/${projectId}/ops failed`) as Error & { status?: number; body?: unknown };
      err.status = res.status;
      err.body = body;
      throw err;
    }
    return body;
  }, []);

  const rollbackTo = useCallback((doc: import('../types').TimelineDocument, version: number) => {
    serverRef.current = {
      doc,
      version,
      timelineId: doc.timelineId,
      projectId: doc.projectId,
    };
    setProject(toProject(doc));
  }, []);

  const commitPending = useCallback(async () => {
    const pending = pendingRef.current;
    if (!pending || commitInFlightRef.current) return;
    commitInFlightRef.current = true;
    pendingRef.current = null;
    try {
      const body = await postOps(pending);
      applyServerTimeline({ ...body, projectId: pending.baseDoc.projectId });
    } catch (err: any) {
      if (err?.status === 409) {
        try {
          const fresh = await fetchTimeline(pending.baseDoc.projectId);
          if (fresh) {
            const rebased = rebaseOps(fresh.doc, pending.ops);
            if (rebased.length) {
              const retryBody = await postOps({ ...pending, baseVersion: fresh.version, baseDoc: fresh.doc, ops: rebased });
              applyServerTimeline({ ...retryBody, projectId: fresh.doc.projectId });
              return;
            }
          }
        } catch (retryErr: any) {
          rollbackTo(pending.baseDoc, pending.baseVersion);
          setTimelineError(retryErr?.message || 'Conflict rebase failed');
        }
      }
      rollbackTo(pending.baseDoc, pending.baseVersion);
      setTimelineError(err?.message || 'Timeline op failed');
    } finally {
      commitInFlightRef.current = false;
    }
  }, [applyServerTimeline, fetchTimeline, postOps, rollbackTo]);

  const applyLocalOp = useCallback((op: import('../types').TimelineOp, baseDoc: import('../types').TimelineDocument) => {
    try {
      const current = serverRef.current;
      const sourceDoc = current?.doc || baseDoc;
      const result = applyTimelineOperation(sourceDoc, op);
      serverRef.current = {
        doc: result.doc,
        version: result.version,
        timelineId: result.doc.timelineId,
        projectId: result.doc.projectId,
      };
      setProject(toProject(result.doc));
      return true;
    } catch (e) {
      setTimelineError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }, []);

  const commitOp = useCallback((op: import('../types').TimelineOp | null) => {
    if (!op) return;
    const current = serverRef.current;
    if (!current) return;
    const baseDoc = current.doc;
    const baseVersion = current.version;
    pendingRef.current = { baseDoc, baseVersion, ops: [op] };
    applyLocalOp(op, baseDoc);
    commitPending();
  }, [applyLocalOp, commitPending]);

  const selectClip = useCallback((id: string | null) => setSelectedClipId(id), []);

  const togglePlay = useCallback(() => {
    setPlaying((p) => {
      if (p) return false;
      setPlayhead((current) => (current >= project.duration_sec ? 0 : current));
      return true;
    });
  }, [project.duration_sec]);
  const seek = useCallback((sec: number) => {
    setPlayhead(seekToFrame(Math.max(0, Math.min(project.duration_sec, sec)), project.fps));
  }, [project.duration_sec, project.fps]);
  const seekBy = useCallback((delta: number) => {
    setPlayhead((p) => seekToFrame(Math.max(0, Math.min(project.duration_sec, p + delta)), project.fps));
  }, [project.duration_sec, project.fps]);

  const updateClip = useCallback((id: string, patch: Partial<Clip>) => {
    setProject((prev: ProjectState) => ({
      ...prev,
      tracks: prev.tracks.map((t: Track) => ({
        ...t,
        clips: t.clips.map((c: Clip) => (c.id === id ? { ...c, ...patch } : c)),
      })),
    }));
  }, []);

  const moveClip = useCallback((id: string, newStartSec: number, targetTrackId?: string) => {
    const current = serverRef.current;
    if (!current) return;
    const base = pendingRef.current?.baseDoc || current.doc;
    const baseVersion = pendingRef.current?.baseVersion || current.version;
    const op = createMoveOpFromDoc(base, id, newStartSec, targetTrackId);
    pendingRef.current = { baseDoc: base, baseVersion, ops: [op].filter(Boolean) as import('../types').TimelineOp[] };
    if (op) applyLocalOp(op, base);
  }, [applyLocalOp]);

  const insertAsset = useCallback((asset: ProjectAsset, targetTrackId: string, startSec: number) => {
    const current = serverRef.current;
    if (!current) return null;
    const base = pendingRef.current?.baseDoc || current.doc;
    const baseVersion = pendingRef.current?.baseVersion || current.version;
    const op = createInsertAssetOpFromDoc(base, asset, targetTrackId, startSec);
    if (!op) return null;
    pendingRef.current = { baseDoc: base, baseVersion, ops: [op] };
    applyLocalOp(op, base);
    commitPending();
    return op;
  }, [applyLocalOp, commitPending]);

  const resizeClip = useCallback((id: string, side: 'left' | 'right', newStartOrEnd: number) => {
    const current = serverRef.current;
    if (!current) return;
    const base = pendingRef.current?.baseDoc || current.doc;
    const baseVersion = pendingRef.current?.baseVersion || current.version;
    const op = createTrimOpFromDoc(base, id, side, newStartOrEnd);
    pendingRef.current = { baseDoc: base, baseVersion, ops: [op].filter(Boolean) as import('../types').TimelineOp[] };
    if (op) applyLocalOp(op, base);
  }, [applyLocalOp]);

  const onDragEnd = useCallback(() => commitPending(), [commitPending]);

  const splitAtPlayhead = useCallback(() => {
    if (!selectedClipId) return;
    const current = serverRef.current;
    if (!current) return;
    commitOp(createSplitOpFromDoc(current.doc, selectedClipId, playhead));
  }, [commitOp, playhead, selectedClipId]);

  const deleteSelected = useCallback(() => {
    if (!selectedClipId) return;
    const current = serverRef.current;
    if (!current) return;
    commitOp(createDeleteOpFromDoc(current.doc, selectedClipId));
    setSelectedClipId(null);
  }, [commitOp, selectedClipId]);

  const duplicateSelected = useCallback(() => {
    if (!selectedClipId) return;
    const current = serverRef.current;
    if (!current) return;
    commitOp(createDuplicateOpFromDoc(current.doc, selectedClipId));
  }, [commitOp, selectedClipId]);

  const toggleTrackMute = useCallback((trackId: string) => {
    const current = serverRef.current;
    if (!current) return;
    const track = current.doc.tracks.find((item) => item.id === trackId);
    if (!track) return;
    commitOp(createSetTrackFlagOp(current.doc, trackId, 'muted', !track.muted));
  }, [commitOp]);

  const toggleTrackLock = useCallback((trackId: string) => {
    const current = serverRef.current;
    if (!current) return;
    const track = current.doc.tracks.find((item) => item.id === trackId);
    if (!track) return;
    commitOp(createSetTrackFlagOp(current.doc, trackId, 'locked', !track.locked));
  }, [commitOp]);

  const toggleTrackHidden = useCallback((trackId: string) => {
    const current = serverRef.current;
    if (!current) return;
    const track = current.doc.tracks.find((item) => item.id === trackId);
    if (!track) return;
    commitOp(createSetTrackFlagOp(current.doc, trackId, 'hidden', !track.hidden));
  }, [commitOp]);

  const toggleTrackSolo = useCallback((trackId: string) => {
    const current = serverRef.current;
    if (!current) return;
    const track = current.doc.tracks.find((item) => item.id === trackId);
    if (!track) return;
    commitOp(createSetTrackFlagOp(current.doc, trackId, 'soloed', !track.soloed));
  }, [commitOp]);

  const applyBotInsertClip = useCallback((payload: Record<string, unknown>) => {
    const current = serverRef.current;
    if (!current) return;
    const doc = payload.doc && typeof payload.doc === 'object' ? payload.doc as import('../types').TimelineDocument : current.doc;
    const version = typeof payload.version === 'number' ? payload.version : current.version + 1;
    const clipObj = payload.clip && typeof payload.clip === 'object' ? payload.clip as Record<string, unknown> : {};
    const clipId = typeof payload.clipId === 'string' ? payload.clipId : typeof clipObj.id === 'string' ? clipObj.id : null;
    const trackId = typeof payload.trackId === 'string' ? payload.trackId : typeof payload.track_id === 'string' ? payload.track_id : null;
    applyServerTimeline({
      doc,
      version,
      timelineId: doc.timelineId || current.timelineId,
      projectId: doc.projectId || current.projectId,
      undo_cursor_seq: typeof payload.undo_cursor_seq === 'number' ? payload.undo_cursor_seq : current.version,
      can_redo: typeof payload.can_redo === 'boolean' ? payload.can_redo : false,
    });
    if (clipId && trackId) setSelectedClipId(clipId);
  }, [applyServerTimeline]);

  const addTransition = useCallback((fromClipId: string, kind: string, durationSec: number) => {
    const current = serverRef.current;
    if (!current) return;
    commitOp(createTransitionOpFromDoc(current.doc, fromClipId, kind, durationSec));
  }, [commitOp]);

  const addText = useCallback((text: string, startSec: number, durationSec: number, position: { x: number; y: number }) => {
    const current = serverRef.current;
    if (!current) return;
    commitOp(createTextOpFromDoc(current.doc, text, startSec, durationSec, position));
  }, [commitOp]);

  const addEffect = useCallback((effect: Record<string, unknown>, clipId?: string | null) => {
    const current = serverRef.current;
    if (!current) return;
    commitOp(createAddEffectOpFromDoc(current.doc, effect, clipId ?? selectedClipId));
  }, [commitOp, selectedClipId]);

  const setEffect = useCallback((effect: Record<string, unknown>, clipId?: string | null) => {
    const current = serverRef.current;
    if (!current) return;
    commitOp(createSetEffectOpFromDoc(current.doc, effect, clipId ?? selectedClipId));
  }, [commitOp, selectedClipId]);

  const setTransform = useCallback((clipId: string, transform: Record<string, number>) => {
    const current = serverRef.current;
    if (!current) return;
    commitOp(createSetTransformOpFromDoc(current.doc, clipId, transform));
  }, [commitOp]);

  const setTitleProps = useCallback((clipId: string, titleProps: Partial<TitleProps>) => {
    const current = serverRef.current;
    if (!current) return;
    commitOp(createSetTitlePropsOpFromDoc(current.doc, clipId, titleProps));
  }, [commitOp]);

  const setKeyframe = useCallback((clipId: string, targetId: string, param: string, keyframe: Keyframe) => {
    const current = serverRef.current;
    if (!current) return;
    commitOp(createSetKeyframeOpFromDoc(current.doc, clipId, targetId, param, keyframe));
  }, [commitOp]);

  const removeKeyframe = useCallback((clipId: string, targetId: string, param: string, time: number) => {
    const current = serverRef.current;
    if (!current) return;
    commitOp(createRemoveKeyframeOpFromDoc(current.doc, clipId, targetId, param, time));
  }, [commitOp]);

  const setVolume = useCallback((clipId: string, volume: number) => {
    const current = serverRef.current;
    if (!current) return;
    commitOp(createSetVolumeOpFromDoc(current.doc, clipId, volume));
  }, [commitOp]);

  const setTrackAudio = useCallback((trackId: string, audio: Partial<AudioTrack>) => {
    const current = serverRef.current;
    if (!current) return;
    commitOp(createSetTrackAudioOpFromDoc(current.doc, trackId, audio));
  }, [commitOp]);

  const setClipAudio = useCallback((clipId: string, audio: Partial<AudioClip>) => {
    const current = serverRef.current;
    if (!current) return;
    commitOp(createSetClipAudioOpFromDoc(current.doc, clipId, audio));
  }, [commitOp]);

  const setClipColor = useCallback((clipId: string, color: Partial<ColorGrade>) => {
    const current = serverRef.current;
    if (!current) return;
    commitOp(createSetClipColorOpFromDoc(current.doc, clipId, color));
  }, [commitOp]);

  const undo = useCallback(async () => {
    const projectId = serverRef.current?.doc.projectId || getActiveProjectId();
    if (!projectId) return;
    const res = await fetch(`/api/timelines/${encodeURIComponent(projectId)}/undo`, { method: 'POST', headers: authHeaders() });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setTimelineError(body.message || 'Undo failed');
      return;
    }
    applyServerTimeline({ ...body, projectId });
  }, [applyServerTimeline]);

  const redo = useCallback(async () => {
    const projectId = serverRef.current?.doc.projectId || getActiveProjectId();
    if (!projectId) return;
    const res = await fetch(`/api/timelines/${encodeURIComponent(projectId)}/redo`, { method: 'POST', headers: authHeaders() });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setTimelineError(body.message || 'Redo failed');
      return;
    }
    applyServerTimeline({ ...body, projectId });
  }, [applyServerTimeline]);

  const exportClient = useMemo(() => createExportClient({ fetchImpl: fetch }), []);

  const enqueueExport = useCallback(async (presetId = exportPresetId) => {
    const projectId = serverRef.current?.doc.projectId || getActiveProjectId();
    if (!projectId) throw new Error('No active project id for export');
    const version = serverRef.current?.version || 1;
    setExportError(null);
    const result = await exportClient.enqueueExport({ projectId, presetId, baseVersion: version, actor: 'human' });
    setExportJob(result.job);
    return result.job;
  }, [exportClient, exportPresetId]);

  const pollExport = useCallback(async (jobId = exportJob?.id) => {
    if (!jobId) return null;
    const result = await exportClient.pollExport(jobId);
    setExportJob(result.job);
    if (result.job.error) setExportError(result.job.error);
    return result.job;
  }, [exportClient, exportJob?.id]);

  return {
    project,
    setProject,
    selectedClip,
    selectedClipId,
    selectClip,
    playhead,
    playing,
    togglePlay,
    seek,
    seekBy,
    tool,
    setTool,
    zoom,
    setZoom,
    projectId: serverRef.current?.doc.projectId || getActiveProjectId(),
    updateClip,
    moveClip,
    insertAsset,
    resizeClip,
    onDragEnd,
    applyBotInsertClip,
    addTransition,
    addText,
    addEffect,
    setEffect,
    setTransform,
    setTitleProps,
    setKeyframe,
    removeKeyframe,
    setVolume,
    setTrackAudio,
    setClipAudio,
    setClipColor,
    splitAtPlayhead,
    deleteSelected,
    duplicateSelected,
    undo,
    redo,
    canUndo,
    canRedo,
    timelineLoading,
    timelineError,
    toggleTrackMute,
    toggleTrackSolo,
    toggleTrackLock,
    toggleTrackHidden,
    exportPresetId,
    setExportPresetId,
    exportJob,
    exportError,
    enqueueExport,
    pollExport,
  };
}
