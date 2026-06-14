import type { Clip, ProjectState, TimelineClip } from './types';

type ClipTiming = {
  start_sec?: number;
  start?: number;
  end?: number;
  duration_sec?: number;
};

export const REAL_MEDIA_SOURCES = new Set<TimelineClip['source']>(['upload', 'stock', 'generated', 'higgsfield']);
export const PLACEHOLDER_SOURCES = new Set<TimelineClip['source']>(['higgsfield_simulated', 'placeholder', 'text']);

export function clipStart(clip: ClipTiming): number {
  return Number(clip.start_sec ?? clip.start ?? 0);
}

export function clipEnd(clip: ClipTiming): number {
  const start = clipStart(clip);
  const explicitEnd = Number(clip.end ?? 0);
  if (Number.isFinite(explicitEnd) && explicitEnd > start) return explicitEnd;
  return start + Math.max(0.1, Number(clip.duration_sec ?? 1));
}

export function clipDuration(clip: ClipTiming): number {
  return Math.max(0, clipEnd(clip) - clipStart(clip));
}

export function clipSource(clip: Clip): Clip['source'] {
  return clip.source ?? 'upload';
}

export function hasRealMediaPath(clip: Clip): boolean {
  const source = clip.source ?? 'upload';
  return Boolean(clip.source_file) && REAL_MEDIA_SOURCES.has(source);
}

export function isPlaceholderClip(clip: Clip): boolean {
  const source = clip.source ?? 'upload';
  return PLACEHOLDER_SOURCES.has(source) || !clip.source_file;
}

export function activeClipAtTrack(track: { clips: Clip[] }, t: number): Clip | null {
  const sorted = [...track.clips].sort((a, b) => clipStart(a) - clipStart(b) || clipEnd(a) - clipEnd(b));
  return sorted.find((clip) => t >= clipStart(clip) && t < clipEnd(clip)) ?? null;
}

export function activeClipsAt(project: ProjectState, t: number): Array<{ track: ProjectState['tracks'][number]; clip: Clip }> {
  return project.tracks
    .map((track) => ({ track, clip: activeClipAtTrack(track, t) }))
    .filter((item): item is { track: ProjectState['tracks'][number]; clip: Clip } => Boolean(item.clip));
}

export function activeVideoClipAt(project: ProjectState, t: number): Clip | null {
  const video = project.tracks.find((track) => track.kind === 'video');
  return video ? activeClipAtTrack(video, t) : null;
}

export function activeTextClipsAt(project: ProjectState, t: number): Clip[] {
  return project.tracks
    .filter((track) => track.kind === 'overlay')
    .flatMap((track) => track.clips)
    .filter((clip) => t >= clipStart(clip) && t < clipEnd(clip));
}

export function activeOverlayClipsAt(project: ProjectState, t: number): Clip[] {
  return project.tracks
    .filter((track) => track.kind === 'overlay')
    .flatMap((track) => track.clips)
    .filter((clip) => t >= clipStart(clip) && t < clipEnd(clip));
}

export function advancePlayhead(playhead: number, duration: number, fps: number, elapsedMs: number): number {
  const safeFps = Math.max(1, Number(fps) || 30);
  const frameCount = Math.round(playhead * safeFps) + Math.floor((elapsedMs * safeFps) / 1000);
  return Math.max(0, Math.min(duration, frameCount / safeFps));
}

export function seekToFrame(sec: number, fps: number): number {
  const safeFps = Math.max(1, Number(fps) || 30);
  return Math.max(0, Math.round((Number(sec) || 0) * safeFps) / safeFps);
}

export function previewModeForClip(clip: Clip): 'real' | 'placeholder' {
  return hasRealMediaPath(clip) ? 'real' : 'placeholder';
}

export function transformPosition(clip: Clip): { x: number; y: number } {
  const x = Number(clip.transform?.x ?? 0);
  const y = Number(clip.transform?.y ?? 0);
  return { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 };
}
