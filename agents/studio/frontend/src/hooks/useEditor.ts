import { useState, useCallback, useRef, useEffect } from 'react';
import type { ProjectState, Clip, Tool } from '../types';
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
  const playIntervalRef = useRef<number | null>(null);

  // Undo/redo stacks
  const historyRef = useRef<HistoryEntry[]>([]);
  const futureRef = useRef<HistoryEntry[]>([]);
  const [historyVersion, setHistoryVersion] = useState(0); // trigger re-render

  const selectedClip = selectedClipId
    ? project.tracks.flatMap((t) => t.clips).find((c) => c.id === selectedClipId) ?? null
    : null;

  // Auto-play timer
  useEffect(() => {
    if (playing) {
      playIntervalRef.current = window.setInterval(() => {
        setPlayhead((p) => {
          const next = p + 0.1;
          if (next >= project.duration_sec) {
            setPlaying(false);
            return project.duration_sec;
          }
          return next;
        });
      }, 100);
      return () => {
        if (playIntervalRef.current) {
          clearInterval(playIntervalRef.current);
          playIntervalRef.current = null;
        }
      };
    }
  }, [playing, project.duration_sec]);

  // Push history snapshot before mutating
  const pushHistory = useCallback(() => {
    historyRef.current.push({ project, selectedClipId });
    if (historyRef.current.length > HISTORY_MAX) {
      historyRef.current.shift();
    }
    futureRef.current = []; // clear redo
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
    setProject((prev) => ({
      ...prev,
      tracks: prev.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      })),
    }));
  }, []);

  // Split selected clip at playhead (history-aware)
  const splitAtPlayhead = useCallback(() => {
    if (!selectedClipId) return;
    pushHistory();
    setProject((prev) => {
      const tracks = prev.tracks.map((t) => {
        const idx = t.clips.findIndex((c) => c.id === selectedClipId);
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

  // Delete selected clip (history-aware)
  const deleteSelected = useCallback(() => {
    if (!selectedClipId) return;
    pushHistory();
    setProject((prev) => ({
      ...prev,
      tracks: prev.tracks.map((t) => ({
        ...t,
        clips: t.clips.filter((c) => c.id !== selectedClipId),
      })),
    }));
    setSelectedClipId(null);
  }, [selectedClipId, pushHistory]);

  // Duplicate selected clip (history-aware)
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
        };
        return { ...t, clips: [...t.clips, dup] };
      });
      return { ...prev, tracks };
    });
  }, [selectedClipId, pushHistory]);

  // Move clip on the timeline (used by drag handler)
  const moveClip = useCallback((id: string, newStartSec: number) => {
    setProject((prev) => ({
      ...prev,
      tracks: prev.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) => (c.id === id ? { ...c, start_sec: Math.max(0, newStartSec) } : c)),
      })),
    }));
  }, []);

  // Resize clip via left or right handle
  const resizeClip = useCallback((id: string, side: 'left' | 'right', newStartOrEnd: number) => {
    pushHistory();
    setProject((prev) => ({
      ...prev,
      tracks: prev.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) => {
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
  };
}
