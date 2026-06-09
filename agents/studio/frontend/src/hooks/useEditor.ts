import { useState, useCallback, useRef } from 'react';
import type { ProjectState, Clip, Track, Tool } from '../types';
import { initialProject } from '../mockData';

export type { Tool };

type HistoryEntry = {
  project: ProjectState;
  selectedClipId: string | null;
};

const HISTORY_MAX = 50;

export function useEditor() {
  const [project, setProject] = useState<ProjectState>(initialProject);
  const [selectedClipId, setSelectedClipId] = useState<string | null>('c2');
  const [playhead, setPlayhead] = useState<number>(23.5);
  const [playing, setPlaying] = useState(false);
  const [tool, setTool] = useState<Tool>('razor');
  const [zoom, setZoom] = useState(80); // pixels per second

  // Undo/redo stacks
  const historyRef = useRef<HistoryEntry[]>([]);
  const futureRef = useRef<HistoryEntry[]>([]);
  const [historyVersion, setHistoryVersion] = useState(0);

  const selectedClip = selectedClipId
    ? project.tracks.flatMap((t) => t.clips).find((c) => c.id === selectedClipId) ?? null
    : null;

  // Auto-play timer
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useState(() => {
    // No-op placeholder for useEffect pattern
  });

  // Push history snapshot before mutating
  const pushHistory = useCallback(() => {
    historyRef.current.push({ project, selectedClipId });
    if (historyRef.current.length > HISTORY_MAX) {
      historyRef.current.shift();
    }
    futureRef.current = [];
    setHistoryVersion((v) => v + 1);
  }, [project, selectedClipId]);

  const undo = useCallback(() => {
    const last = historyRef.current.pop();
    if (!last) return;
    futureRef.current.push({ project, selectedClipId });
    setProject(last.project);
    setSelectedClipId(last.selectedClipId);
    setHistoryVersion((v) => v + 1);
  }, [project, selectedClipId]);

  const redo = useCallback(() => {
    const next = futureRef.current.pop();
    if (!next) return;
    historyRef.current.push({ project, selectedClipId });
    setProject(next.project);
    setSelectedClipId(next.selectedClipId);
    setHistoryVersion((v) => v + 1);
  }, [project, selectedClipId]);

  const togglePlay = useCallback(() => setPlaying((p) => !p), []);
  const seek = useCallback((sec: number) => {
    setPlayhead(Math.max(0, Math.min(project.duration_sec, sec)));
  }, [project.duration_sec]);
  const seekBy = useCallback((delta: number) => {
    setPlayhead((p) => Math.max(0, Math.min(project.duration_sec, p + delta)));
  }, [project.duration_sec]);

  const selectClip = useCallback((id: string | null) => setSelectedClipId(id), []);

  const updateClip = useCallback((id: string, patch: Partial<Clip>) => {
    setProject((prev: ProjectState) => ({
      ...prev,
      tracks: prev.tracks.map((t: Track) => ({
        ...t,
        clips: t.clips.map((c: Clip) => (c.id === id ? { ...c, ...patch } : c)),
      })),
    }));
  }, []);

  // ── Track state ──

  const toggleTrackMute = useCallback((trackId: string) => {
    setProject((prev: ProjectState) => ({
      ...prev,
      tracks: prev.tracks.map((t: Track) => (t.id === trackId ? { ...t, muted: !t.muted } : t)),
    }));
  }, []);

  const toggleTrackSolo = useCallback((trackId: string) => {
    setProject((prev: ProjectState) => ({
      ...prev,
      tracks: prev.tracks.map((t: Track) => (t.id === trackId ? { ...t, soloed: !t.soloed } : t)),
    }));
  }, []);

  const toggleTrackLock = useCallback((trackId: string) => {
    pushHistory();
    setProject((prev: ProjectState) => ({
      ...prev,
      tracks: prev.tracks.map((t: Track) => (t.id === trackId ? { ...t, locked: !t.locked } : t)),
    }));
  }, [pushHistory]);

  const toggleTrackHidden = useCallback((trackId: string) => {
    setProject((prev: ProjectState) => ({
      ...prev,
      tracks: prev.tracks.map((t: Track) => (t.id === trackId ? { ...t, hidden: !t.hidden } : t)),
    }));
  }, []);

  // ── Clip operations ──

  const splitAtPlayhead = useCallback(() => {
    if (!selectedClipId) return;
    pushHistory();
    setProject((prev: ProjectState) => {
      const tracks = prev.tracks.map((t: Track) => {
        if (t.locked) return t;
        const idx = t.clips.findIndex((c: Clip) => c.id === selectedClipId);
        if (idx < 0) return t;
        const clip = t.clips[idx];
        const localSec = playhead - clip.start_sec;
        if (localSec <= 0 || localSec >= clip.duration_sec) return t;
        const left: Clip = { ...clip, duration_sec: localSec };
        const right: Clip = {
          ...clip,
          id: `${clip.id}-r${Date.now().toString(36)}`,
          start_sec: clip.start_sec + localSec,
          duration_sec: clip.duration_sec - localSec,
          in_sec: clip.in_sec + localSec,
        };
        const newClips = [...t.clips];
        newClips.splice(idx, 1, left, right);
        return { ...t, clips: newClips };
      });
      return { ...prev, tracks };
    });
  }, [selectedClipId, playhead, pushHistory]);

  // Ripple delete — removes clip and shifts all clips on same track left
  const deleteSelected = useCallback(() => {
    if (!selectedClipId) return;
    pushHistory();
    setProject((prev) => {
      let deletedDuration = 0;
      const tracks = prev.tracks.map((t) => {
        if (t.locked) return t;
        const idx = t.clips.findIndex((c) => c.id === selectedClipId);
        if (idx < 0) return t;
        deletedDuration = t.clips[idx].duration_sec;
        return {
          ...t,
          clips: t.clips
            .filter((c) => c.id !== selectedClipId)
            .map((c) => {
              if (c.start_sec > t.clips[idx].start_sec) {
                return { ...c, start_sec: Math.max(0, c.start_sec - deletedDuration) };
              }
              return c;
            }),
        };
      });
      return { ...prev, tracks };
    });
    setSelectedClipId(null);
  }, [selectedClipId, pushHistory]);

  const duplicateSelected = useCallback(() => {
    if (!selectedClipId) return;
    pushHistory();
    setProject((prev) => {
      const tracks = prev.tracks.map((t) => {
        const clip = t.clips.find((c) => c.id === selectedClipId);
        if (!clip) return t;
        const dup: Clip = {
          ...clip,
          id: `${clip.id}-d${Date.now().toString(36)}`,
          start_sec: clip.start_sec + clip.duration_sec,
          selected: false,
        };
        return { ...t, clips: [...t.clips, dup] };
      });
      return { ...prev, tracks };
    });
  }, [selectedClipId, pushHistory]);

  const moveClip = useCallback((id: string, newStartSec: number) => {
    setProject((prev: ProjectState) => ({
      ...prev,
      tracks: prev.tracks.map((t: Track) => ({
        ...t,
        clips: t.clips.map((c: Clip) => (c.id === id ? { ...c, start_sec: Math.max(0, newStartSec) } : c)),
      })),
    }));
  }, []);

  const resizeClip = useCallback((id: string, side: 'left' | 'right', newStartOrEnd: number) => {
    pushHistory();
    setProject((prev: ProjectState) => ({
      ...prev,
      tracks: prev.tracks.map((t: Track) => ({
        ...t,
        clips: t.clips.map((c: Clip) => {
          if (c.id !== id) return c;
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
    }));
  }, [pushHistory]);

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
    updateClip,
    moveClip,
    resizeClip,
    splitAtPlayhead,
    deleteSelected,
    duplicateSelected,
    undo,
    redo,
    canUndo: historyRef.current.length > 0,
    canRedo: futureRef.current.length > 0,
    historyVersion,
    toggleTrackMute,
    toggleTrackSolo,
    toggleTrackLock,
    toggleTrackHidden,
  };
}
