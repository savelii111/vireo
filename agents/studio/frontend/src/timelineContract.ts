// @ts-nocheck shared JS module is covered by Vitest/esbuild path; frontend keeps runtime shape in types.ts.
/// <reference path="./shared-timeline.d.ts" />

import {
  applyOp,
  createEmptyTimelineDocument,
  createTimelineOp,
} from '../../../../packages/shared/index.js';
import type { ProjectState, TimelineDocument, TimelineOp, TimelineTrack } from './types';

type TimelineOpName = string;

export function createEmptyProjectState(): ProjectState {
  const doc = createEmptyTimelineDocument({ projectId: '', timelineId: '' });
  return timelineToProject(doc, 'Untitled project');
}

export function timelineToProject(doc: TimelineDocument, name = 'Untitled project'): ProjectState {
  const duration_sec = Math.max(
    1,
    ...doc.tracks.flatMap((track) => track.clips.map((clip) => Number(clip.end ?? (clip.start || 0) + 1))),
  );

  return {
    name,
    duration_sec,
    fps: Number(doc.fps || 30),
    width: doc.resolution?.w || 1920,
    height: doc.resolution?.h || 1080,
    tracks: doc.tracks
      .filter((track) => ['video', 'audio', 'overlay', 'text'].includes(track.kind))
      .map((track) => ({
        id: track.id,
        kind: track.kind === 'text' ? 'overlay' : track.kind,
        name: track.name,
        clips: track.clips.map((clip) => ({
          id: clip.id,
          track_id: track.id,
          source_file: clip.assetId || clip.name || '',
          source: clip.source,
          start_sec: Number(clip.start || 0),
          duration_sec: Math.max(0.1, Number((clip.end ?? (clip.start || 0) + 1) - (clip.start || 0))),
          in_sec: Math.max(0, Number(clip.in || 0)),
          label: clip.name || clip.assetId || '',
          kind: track.kind === 'text' ? 'overlay' : track.kind,
          selected: Boolean(clip.selected),
          effects: clip.effects,
          transform: clip.transform,
          keyframes: clip.keyframes,
          volume: clip.volume,
          text: clip.text,
          titleProps: clip.titleProps,
          thumbnail_color: clip.source === 'generated' || clip.source === 'higgsfield'
            ? 'linear-gradient(135deg, #8b5cf6, #ec4899)'
            : clip.source === 'stock'
              ? 'linear-gradient(135deg, #06b6d4, #0891b2)'
              : 'linear-gradient(135deg, #6366f1, #4f46e5)',
        })),
        muted: Boolean(track.muted),
        soloed: Boolean(track.soloed),
        locked: Boolean(track.locked),
        hidden: Boolean(track.hidden),
      })),
    markers: doc.markers,
    transitions: doc.transitions,
  };
}

export function projectToTimelineDocument(
  project: ProjectState,
  {
    timelineId,
    projectId,
    version,
  }: { timelineId: string; projectId: string; version: number },
): TimelineDocument {
  return {
    timelineId,
    projectId,
    fps: project.fps || 30,
    resolution: { w: project.width || 1920, h: project.height || 1080 },
    version,
    tracks: project.tracks.map((track): TimelineTrack => ({
      id: track.id,
      kind: track.kind === 'overlay' ? 'overlay' : track.kind,
      name: track.name,
      muted: Boolean(track.muted),
      soloed: Boolean(track.soloed),
      locked: Boolean(track.locked),
      hidden: Boolean(track.hidden),
      clips: track.clips.map((clip) => ({
        id: clip.id,
        assetId: clip.source_file,
        start: clip.start_sec,
        end: clip.start_sec + clip.duration_sec,
        in: clip.in_sec,
        out: clip.in_sec + clip.duration_sec,
        source: clip.source ?? 'upload',
        name: clip.label || clip.source_file,
        text: clip.text,
        transform: clip.transform,
        keyframes: clip.keyframes,
        volume: clip.volume,
        effects: clip.effects,
        selected: Boolean(clip.selected),
        titleProps: clip.titleProps,
      })),
    })),
    markers: project.markers,
    transitions: project.transitions,
  };
}

export function makeTimelineOp({
  op,
  actor = 'human',
  timelineId,
  trackId,
  clipId,
  payload = {},
}: {
  op: TimelineOpName;
  actor?: 'human' | 'bot' | 'system';
  timelineId: string;
  trackId?: string;
  clipId?: string;
  payload?: Record<string, unknown>;
}): TimelineOp {
  return createTimelineOp({ op, actor, timelineId, trackId, clipId, payload }) as TimelineOp;
}

export function applyTimelineOperation(doc: TimelineDocument, op: TimelineOp) {
  const result = applyOp(doc, op);
  return {
    doc: result.doc as TimelineDocument,
    version: Number(doc.version || 1) + 1,
    inverse: result.inverse,
  };
}

export function findClipInDoc(doc: TimelineDocument, clipId: string) {
  for (const track of doc.tracks) {
    const clip = track.clips.find((item) => item.id === clipId);
    if (clip) return { track, clip };
  }
  return null;
}

export function cloneTimelineDoc(doc: TimelineDocument): TimelineDocument {
  return JSON.parse(JSON.stringify(doc)) as TimelineDocument;
}
