import { useRef, useState, useCallback, useEffect } from 'react';
import {
  MousePointer2, Scissors, MoveVertical, MoveHorizontal,
  Magnet, Grid3x3, Video, Music, Layers,
  EyeOff, Eye, Lock, Unlock, Volume2, VolumeX, Star, StarOff, RotateCcw, Redo2, Type,
  type LucideIcon,
} from 'lucide-react';
import clsx from 'clsx';
import { formatShortTime } from '../utils/time';
import { snapTime } from '../../../../../packages/shared/index.js';
import type { ProjectAsset, ProjectState, Tool, Clip, TrackKind } from '../types';

interface Props {
  project: ProjectState;
  tool: Tool;
  onToolChange: (t: Tool) => void;
  selectedClipId: string | null;
  onClipSelect: (id: string | null) => void;
  playhead: number;
  onSeek: (sec: number) => void;
  zoom: number;
  onZoomChange: (px: number) => void;
  onClipMove?: (id: string, newStart: number, targetTrackId: string) => void;
  onClipResize?: (id: string, side: 'left' | 'right', pos: number) => void;
  onAssetDrop?: (asset: ProjectAsset, trackId: string, startSec: number) => void;
  onDragEnd?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onToggleMute?: (trackId: string) => void;
  onToggleSolo?: (trackId: string) => void;
  onToggleLock?: (trackId: string) => void;
  onToggleHidden?: (trackId: string) => void;
  onAddTransition?: (clipId: string, kind: string, duration: number) => void;
  onAddText?: (text: string, start: number, duration: number, position: { x: number; y: number }) => void;
}

type DragMode = 'move' | 'resize-l' | 'resize-r';
type DragState = {
  mode: DragMode;
  clipId: string;
  startX: number;
  origStart: number;
  origDuration: number;
  origIn: number;
  targetTrackId: string;
};

type TrackIcons = Record<TrackKind, LucideIcon>;
const TRACK_KIND_ICON: Partial<TrackIcons> = { video: Video, audio: Music, overlay: Layers };

const SNAP_THRESHOLD_PX = 6; // pixels within which snap activates

export function Timeline({
  project, tool, onToolChange, selectedClipId, onClipSelect,
  playhead, onSeek, zoom, onZoomChange,
  onClipMove, onClipResize, onAssetDrop, onDragEnd,
  onUndo, onRedo, canUndo, canRedo,
  onToggleMute, onToggleSolo, onToggleLock, onToggleHidden,
  onAddTransition, onAddText,
}: Props) {
  const rulerRef = useRef<HTMLDivElement>(null);
  const tracksRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [magnetOn, setMagnetOn] = useState(true);
  const [gridSnap, setGridSnap] = useState(false);
  const [snapGuide, setSnapGuide] = useState<{ trackId: string; timeSec: number } | null>(null);
  const [dropTarget, setDropTarget] = useState<{ trackId: string; timeSec: number } | null>(null);
  const [transitionOpen, setTransitionOpen] = useState(false);
  const [transitionKind, setTransitionKind] = useState('crossfade');
  const [transitionDuration, setTransitionDuration] = useState(0.5);
  const [textOpen, setTextOpen] = useState(false);
  const [textBody, setTextBody] = useState('Text');
  const [textStart, setTextStart] = useState(playhead);
  const [textDuration, setTextDuration] = useState(3);
  const [textX, setTextX] = useState(0);
  const [textY, setTextY] = useState(0);

  // ── Ruler click → seek ──
  const handleRulerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!rulerRef.current) return;
    const rect = rulerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left + rulerRef.current.scrollLeft;
    onSeek(x / zoom);
  };

  const handleTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('[data-clip-id]')) return;
    if (!tracksRef.current) return;
    const rect = tracksRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left + tracksRef.current.scrollLeft;
    onSeek(x / zoom);
  };

  const totalWidth = project.duration_sec * zoom;
  const tickInterval = zoom >= 60 ? 5 : zoom >= 30 ? 10 : 30;
  const ticks: number[] = [];
  for (let s = 0; s <= project.duration_sec; s += tickInterval) ticks.push(s);
  const selectedTrack = project.tracks.find((track) => track.clips.some((clip) => clip.id === selectedClipId)) ?? null;
  const selectedClip = selectedTrack?.clips.find((clip) => clip.id === selectedClipId) ?? null;
  const nextTransitionClip = selectedTrack && selectedClip
    ? [...selectedTrack.clips].sort((a, b) => a.start_sec - b.start_sec).find((clip) => clip.start_sec >= (selectedClip.start_sec + selectedClip.duration_sec)) ?? null
    : null;

  // ── Snap targets: playhead, markers, other clip edges ──
  const snapTargets = useCallback(() => {
    const targets: number[] = [playhead]; // always snap to playhead
    if (project.markers) {
      for (const m of project.markers) targets.push(m.time_sec);
    }
    if (magnetOn) {
      for (const track of project.tracks) {
        for (const clip of track.clips) {
          targets.push(clip.start_sec);
          targets.push(clip.start_sec + clip.duration_sec);
        }
      }
    }
    return targets;
  }, [playhead, project, magnetOn]);

  const snapCandidate = useCallback((sec: number, targets: number[], enabled: boolean): number => {
    if (!enabled) return sec;
    const snapped = snapTime(sec, targets, SNAP_THRESHOLD_PX, zoom);
    if (Math.abs(snapped - sec) > 1e-6) return snapped;
    if (gridSnap) {
      const gridSec = zoom >= 60 ? 1 : 5;
      const rounded = Math.round(sec / gridSec) * gridSec;
      if (Math.abs(sec - rounded) * zoom < SNAP_THRESHOLD_PX) return rounded;
    }
    return sec;
  }, [gridSnap, zoom]);

  const resolveTargetTrackId = useCallback((e: PointerEvent, fallback: string) => {
    if (typeof document === 'undefined') return fallback;
    const element = document.elementsFromPoint(e.clientX, e.clientY).find((item) => item instanceof HTMLElement && item.getAttribute('data-track-id'));
    return element?.getAttribute('data-track-id') || fallback;
  }, []);

  const handleAssetDrop = useCallback((e: React.DragEvent<HTMLDivElement>, trackId: string) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData('application/x-vireo-asset');
    if (!raw) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left + e.currentTarget.scrollLeft;
    const startSec = Math.max(0, x / zoom);
    const asset = JSON.parse(raw) as ProjectAsset;
    onAssetDrop?.(asset, trackId, startSec);
  }, [onAssetDrop, zoom]);

  // ── Drag handlers ──
  const startDrag = useCallback((e: React.PointerEvent, clip: Clip, mode: DragMode) => {
    if (tool !== 'select') return;
    const track = project.tracks.find((t) => t.id === clip.track_id);
    if (track?.locked) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({
      mode,
      clipId: clip.id,
      startX: e.clientX,
      origStart: clip.start_sec,
      origDuration: clip.duration_sec,
      origIn: clip.in_sec,
      targetTrackId: clip.track_id,
    });
    onClipSelect(clip.id);
  }, [tool, onClipSelect, project.tracks]);

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - drag.startX;
      const dSec = dx / zoom;
      const targets = snapTargets();
      const snapEnabled = (magnetOn || gridSnap) && !e.altKey;
      if (drag.mode === 'move') {
        const targetTrackId = resolveTargetTrackId(e, drag.targetTrackId);
        if (targetTrackId !== drag.targetTrackId) {
          setDrag((current) => current ? { ...current, targetTrackId } : current);
        }
        const rawNew = drag.origStart + dSec;
        const nextStart = snapCandidate(rawNew, targets, snapEnabled);
        setSnapGuide(snapEnabled && Math.abs(nextStart - rawNew) > 1e-6 ? { trackId: targetTrackId, timeSec: nextStart } : null);
        onClipMove?.(drag.clipId, nextStart, targetTrackId);
      } else if (drag.mode === 'resize-r') {
        const rawEnd = drag.origStart + drag.origDuration + dSec;
        const nextEnd = snapCandidate(Math.max(drag.origStart + 0.1, rawEnd), targets, snapEnabled);
        setSnapGuide(snapEnabled && Math.abs(nextEnd - Math.max(drag.origStart + 0.1, rawEnd)) > 1e-6 ? { trackId: drag.targetTrackId, timeSec: nextEnd } : null);
        onClipResize?.(drag.clipId, 'right', nextEnd);
      } else if (drag.mode === 'resize-l') {
        const rawStart = drag.origStart + dSec;
        const nextStart = snapCandidate(Math.max(0, rawStart), targets, snapEnabled);
        setSnapGuide(snapEnabled && Math.abs(nextStart - Math.max(0, rawStart)) > 1e-6 ? { trackId: drag.targetTrackId, timeSec: nextStart } : null);
        onClipResize?.(drag.clipId, 'left', nextStart);
      }
    };
    const onUp = () => {
      onDragEnd?.();
      setSnapGuide(null);
      setDropTarget(null);
      setDrag(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [drag, zoom, magnetOn, snapTargets, snapCandidate, resolveTargetTrackId, onClipMove, onClipResize, onDragEnd]);

  return (
    <section
      data-timeline-project
      className="flex flex-col bg-bg-1 min-h-0 min-w-0 max-w-full w-full border-t border-border-1 overflow-hidden"
    >
      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between px-4 h-9 border-b border-border-1 bg-bg-1">
        <div className="flex items-center gap-0.5">
          {([
            { id: 'select', Icon: MousePointer2, label: 'Select (V)' },
            { id: 'razor',  Icon: Scissors,       label: 'Razor (C)' },
            { id: 'slip',   Icon: MoveVertical,   label: 'Slip (Y)' },
            { id: 'slide',  Icon: MoveHorizontal, label: 'Slide (U)' },
          ] as const).map((b) => (
            <button
              key={b.id}
              onClick={() => onToolChange(b.id)}
              data-tip={b.label}
              className={clsx(
                'tip w-7 h-[26px] flex items-center justify-center rounded transition-all duration-[120ms]',
                tool === b.id
                  ? 'text-accent bg-accent/10'
                  : 'text-ink-2 hover:text-ink-1 hover:bg-bg-2',
              )}
            >
              <b.Icon size={14} strokeWidth={1.6} />
            </button>
          ))}
          <div className="w-px h-4 bg-border-2 mx-1" />
          <button
            data-tip="Snap to grid"
            onClick={() => setGridSnap((v) => !v)}
            className={clsx(
              'tip w-7 h-[26px] flex items-center justify-center rounded transition-all duration-[120ms]',
              gridSnap ? 'text-accent bg-accent/10' : 'text-ink-2 hover:text-ink-1 hover:bg-bg-2',
            )}
          >
            <Grid3x3 size={14} strokeWidth={1.6} />
          </button>
          <button
            data-tip="Magnetic timeline"
            onClick={() => setMagnetOn((v) => !v)}
            className={clsx(
              'tip w-7 h-[26px] flex items-center justify-center rounded transition-all duration-[120ms]',
              magnetOn ? 'text-accent bg-accent/10' : 'text-ink-2 hover:text-ink-1 hover:bg-bg-2',
            )}
          >
            <Magnet size={14} strokeWidth={1.6} />
          </button>
          <div className="w-px h-4 bg-border-2 mx-1" />
          <button
            data-tip="Undo"
            onClick={onUndo}
            disabled={!canUndo}
            className={clsx(
              'tip w-7 h-[26px] flex items-center justify-center rounded transition-all duration-[120ms]',
              canUndo ? 'text-ink-2 hover:text-ink-1 hover:bg-bg-2' : 'text-ink-4 cursor-not-allowed',
            )}
          >
            <RotateCcw size={14} strokeWidth={1.6} />
          </button>
          <button
            data-tip="Redo"
            onClick={onRedo}
            disabled={!canRedo}
            className={clsx(
              'tip w-7 h-[26px] flex items-center justify-center rounded transition-all duration-[120ms]',
              canRedo ? 'text-ink-2 hover:text-ink-1 hover:bg-bg-2' : 'text-ink-4 cursor-not-allowed',
            )}
          >
            <Redo2 size={14} strokeWidth={1.6} />
          </button>
          <div className="w-px h-4 bg-border-2 mx-1" />
          <button
            data-testid="timeline-transition-control"
            data-tip="Add transition at selected clip boundary"
            onClick={() => setTransitionOpen((v) => !v)}
            className="h-[26px] rounded px-2 text-[11px] font-semibold text-ink-2 hover:text-ink-1 hover:bg-bg-2"
          >
            Переход
          </button>
          <button
            data-testid="timeline-text-control"
            data-tip="Add text on trk_t1"
            onClick={() => setTextOpen((v) => !v)}
            className="h-[26px] rounded px-2 text-[11px] font-semibold text-ink-2 hover:text-ink-1 hover:bg-bg-2"
          >
            Текст
          </button>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-ink-3">
          <span>Zoom</span>
          <div className="relative w-[100px] h-1 bg-bg-3 rounded-full">
            <div className="absolute left-0 top-0 h-full bg-accent rounded-full" style={{ width: `${((zoom - 10) / 190) * 100}%` }} />
            <input
              type="range"
              min={10}
              max={200}
              step={5}
              value={zoom}
              onChange={(e) => onZoomChange(Number(e.target.value))}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
            <div className="absolute top-1/2 w-2.5 h-2.5 bg-white rounded-full -translate-y-1/2 -translate-x-1/2" style={{ left: `${((zoom - 10) / 190) * 100}%` }} />
          </div>
          <span className="font-mono bg-bg-2 border border-border-1 rounded px-1.5 py-0.5 text-ink-2">⌘+</span>
          <span className="font-mono bg-bg-2 border border-border-1 rounded px-1.5 py-0.5 text-ink-2">⌘-</span>
        </div>
      </div>

      {/* Day 26: popovers anchored to the trigger button, not
          a full-width row. Both close on outside-click and Esc. */}
      {transitionOpen && (
        <TimelinePopover anchorTestId="timeline-transition-control" onClose={() => setTransitionOpen(false)}>
          <div className="grid grid-cols-2 gap-2 items-center min-w-[260px]">
            <label className="text-[11px] text-ink-3" htmlFor="popover-transition-kind">Тип</label>
            <select
              id="popover-transition-kind"
              data-testid="transition-kind"
              value={transitionKind}
              onChange={(e) => setTransitionKind(e.target.value)}
              className="rounded-md bg-bg-2 border border-border-1 px-2 py-1 text-[12px] text-ink-1"
            >
              <option value="crossfade">crossfade</option>
              <option value="fade">fade</option>
              <option value="wipe">wipe</option>
            </select>
            <label className="text-[11px] text-ink-3" htmlFor="popover-transition-duration">Длительность (сек)</label>
            <input
              id="popover-transition-duration"
              data-testid="transition-duration"
              type="number"
              min={0.1}
              step={0.1}
              value={transitionDuration}
              onChange={(e) => setTransitionDuration(Number(e.target.value))}
              className="w-20 rounded-md bg-bg-2 border border-border-1 px-2 py-1 text-[12px] text-ink-1"
            />
            <div className="col-span-2 flex items-center justify-between gap-2 pt-1">
              <span className="text-[11px] text-ink-4">
                {selectedClip && nextTransitionClip
                  ? `${selectedClip.label} → ${nextTransitionClip.label}`
                  : 'выберите clip с соседом справа'}
              </span>
              <button
                data-testid="add-transition"
                disabled={!selectedClip || !nextTransitionClip}
                onClick={() => {
                  if (selectedClip) onAddTransition?.(selectedClip.id, transitionKind, transitionDuration);
                  setTransitionOpen(false);
                }}
                className="rounded-md bg-accent px-2 py-1 text-[12px] font-semibold text-white disabled:opacity-40"
              >
                Добавить
              </button>
            </div>
          </div>
        </TimelinePopover>
      )}
      {textOpen && (
        <TimelinePopover anchorTestId="timeline-text-control" onClose={() => setTextOpen(false)}>
          <div className="grid grid-cols-2 gap-2 items-center min-w-[300px]">
            <label className="text-[11px] text-ink-3" htmlFor="popover-text-body">Текст</label>
            <input
              id="popover-text-body"
              data-testid="text-body"
              value={textBody}
              onChange={(e) => setTextBody(e.target.value)}
              placeholder="Введите текст"
              className="rounded-md bg-bg-2 border border-border-1 px-2 py-1 text-[12px] text-ink-1"
            />
            <label className="text-[11px] text-ink-3" htmlFor="popover-text-start">Начало (сек)</label>
            <input
              id="popover-text-start"
              data-testid="text-start"
              type="number"
              min={0}
              step={0.1}
              value={textStart}
              onChange={(e) => setTextStart(Number(e.target.value))}
              className="w-20 rounded-md bg-bg-2 border border-border-1 px-2 py-1 text-[12px] text-ink-1"
            />
            <label className="text-[11px] text-ink-3" htmlFor="popover-text-duration">Длительность (сек)</label>
            <input
              id="popover-text-duration"
              data-testid="text-duration"
              type="number"
              min={0.1}
              step={0.1}
              value={textDuration}
              onChange={(e) => setTextDuration(Number(e.target.value))}
              className="w-20 rounded-md bg-bg-2 border border-border-1 px-2 py-1 text-[12px] text-ink-1"
            />
            <label className="text-[11px] text-ink-3" htmlFor="popover-text-x">X (px)</label>
            <input
              id="popover-text-x"
              data-testid="text-x"
              type="number"
              value={textX}
              onChange={(e) => setTextX(Number(e.target.value))}
              className="w-20 rounded-md bg-bg-2 border border-border-1 px-2 py-1 text-[12px] text-ink-1"
            />
            <label className="text-[11px] text-ink-3" htmlFor="popover-text-y">Y (px)</label>
            <input
              id="popover-text-y"
              data-testid="text-y"
              type="number"
              value={textY}
              onChange={(e) => setTextY(Number(e.target.value))}
              className="w-20 rounded-md bg-bg-2 border border-border-1 px-2 py-1 text-[12px] text-ink-1"
            />
            <div className="col-span-2 flex justify-end pt-1">
              <button
                data-testid="add-text"
                onClick={() => {
                  onAddText?.(textBody, textStart, textDuration, { x: textX, y: textY });
                  setTextOpen(false);
                }}
                className="rounded-md bg-accent px-2 py-1 text-[12px] font-semibold text-white"
              >
                Добавить
              </button>
            </div>
          </div>
        </TimelinePopover>
      )}

      {/* ── Body ── */}
      <div className="flex flex-1 min-h-0">
        {/* Track headers */}
        <div className="w-[160px] border-r border-border-1 bg-bg-1 flex-shrink-0 overflow-y-auto">
          {project.tracks.map((t) => {
            const Icon = TRACK_KIND_ICON[t.kind] ?? Video;
            return (
              <div
                key={t.id}
                data-track-id={t.id}
                className={clsx(
                  'h-9 flex items-center px-2 border-b border-border-1 text-[11px] font-medium gap-1 group',
                  t.locked ? 'opacity-50' : 'text-ink-1 hover:bg-bg-2 cursor-pointer',
                  t.hidden && 'opacity-40',
                )}
              >
                <Icon size={12} strokeWidth={1.6} className="flex-shrink-0" />
                <span className="truncate flex-1">{t.name}</span>
                {t.kind === 'audio' && (
                  <span className="text-[9px] text-ink-3" data-testid={`timeline-track-gain-${t.id}`}>{Math.round(t.audio?.gainDb ?? 0)}dB</span>
                )}
                {t.kind === 'audio' && t.role && (
                  <span className="text-[9px] text-ink-4 uppercase" data-testid={`timeline-track-role-${t.id}`}>{t.role}</span>
                )}
                {/* Track controls */}
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  {t.kind === 'audio' && (
                    <button onClick={() => onToggleMute?.(t.id)} title={t.muted ? 'Unmute' : 'Mute'} className="w-5 h-5 flex items-center justify-center rounded hover:bg-bg-3">
                      {t.muted ? <VolumeX size={11} className="text-red-400" /> : <Volume2 size={11} className="text-ink-3" />}
                    </button>
                  )}
                  {t.kind === 'overlay' && (t.id === 't1' || /text/i.test(t.name)) && (
                    <button
                      title="Добавить текст"
                      onClick={(e) => { e.stopPropagation(); setTextOpen(true); }}
                      className="w-5 h-5 flex items-center justify-center rounded hover:bg-bg-3"
                    >
                      <Type size={11} className="text-ink-3" />
                    </button>
                  )}
                  <button onClick={() => onToggleSolo?.(t.id)} title={t.soloed ? 'Unsolo' : 'Solo'} className="w-5 h-5 flex items-center justify-center rounded hover:bg-bg-3">
                    {t.soloed ? <Star size={11} className="text-yellow-400" /> : <StarOff size={11} className="text-ink-3" />}
                  </button>
                  <button onClick={() => onToggleLock?.(t.id)} title={t.locked ? 'Unlock' : 'Lock'} className="w-5 h-5 flex items-center justify-center rounded hover:bg-bg-3">
                    {t.locked ? <Lock size={11} className="text-amber-400" /> : <Unlock size={11} className="text-ink-3" />}
                  </button>
                  <button onClick={() => onToggleHidden?.(t.id)} title={t.hidden ? 'Show' : 'Hide'} className="w-5 h-5 flex items-center justify-center rounded hover:bg-bg-3">
                    {t.hidden ? <EyeOff size={11} className="text-ink-3" /> : <Eye size={11} className="text-ink-3" />}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Timeline canvas */}
        <div ref={tracksRef} className="flex-1 overflow-x-auto">
          <div style={{ width: `${totalWidth}px` }}>
            {/* Ruler */}
            <div
              ref={rulerRef}
              onClick={handleRulerClick}
              className="h-[22px] bg-bg-1 border-b border-border-1 sticky top-0 z-[2] flex cursor-pointer text-[10px] text-ink-3 font-mono"
            >
              {ticks.map((s) => (
                <div
                  key={s}
                  className={clsx(
                    'flex-shrink-0 border-l pl-1 pt-1',
                    s % (tickInterval * 2) === 0
                      ? 'border-border-3 text-ink-2 font-medium'
                      : 'border-border-2',
                  )}
                  style={{ width: `${tickInterval * zoom}px` }}
                >
                  {s % (tickInterval * 2) === 0 ? formatShortTime(s) : ''}
                </div>
              ))}
            </div>

            {/* Tracks */}
            {project.tracks.map((track) => (
              <div
                key={track.id}
                data-track-id={track.id}
                className={clsx(
                  'relative h-9 border-b border-border-1 cursor-pointer',
                  track.hidden && 'opacity-20',
                )}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  const rect = e.currentTarget.getBoundingClientRect();
                  const timeSec = Math.max(0, (e.clientX - rect.left + e.currentTarget.scrollLeft) / zoom);
                  setDropTarget({ trackId: track.id, timeSec });
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropTarget(null);
                }}
                onDrop={(e) => {
                  setDropTarget(null);
                  handleAssetDrop(e, track.id);
                }}
                onClick={handleTrackClick}
              >
                {snapGuide?.trackId === track.id && (
                  <div
                    data-testid="snap-guide"
                    className="absolute top-0 bottom-0 w-px bg-yellow-300/80 z-[5] pointer-events-none"
                    style={{ left: `${snapGuide.timeSec * zoom}px` }}
                  />
                )}
                {dropTarget?.trackId === track.id && (
                  <div
                    data-testid="drop-target"
                    className="absolute top-0 bottom-0 w-px bg-accent z-[6] pointer-events-none shadow-[0_0_10px_rgba(14,165,233,.8)]"
                    style={{ left: `${dropTarget.timeSec * zoom}px` }}
                  />
                )}
                {track.clips.map((clip) => {
                  const leftPx = clip.start_sec * zoom;
                  const widthPx = clip.duration_sec * zoom;
                  const isSelected = clip.id === selectedClipId;

                  // Color: muted tracks get desaturated
                  const bgStyle = track.muted
                    ? 'linear-gradient(135deg, #6b7280, #4b5563)'
                    : clip.thumbnail_color || 'linear-gradient(135deg, #6366f1, #4f46e5)';

                  return (
                    <div
                      key={clip.id}
                      onPointerDown={(e) => {
                        if (tool === 'razor') {
                          onClipSelect(clip.id);
                          // Razor cut handled by App via ⌘K or click
                          return;
                        }
                        startDrag(e, clip, 'move');
                      }}
                      data-clip-id={clip.id}
                      data-track-id={clip.track_id}
                      className={clsx(
                        'absolute top-[3px] h-[30px] rounded-[4px] border cursor-pointer select-none flex items-center px-2 text-[10px] font-medium text-white/90 overflow-hidden transition-shadow',
                        isSelected && 'ring-2 ring-accent ring-offset-1 ring-offset-bg-1 z-[3]',
                        !isSelected && 'z-[1]',
                        track.locked && 'cursor-not-allowed opacity-60',
                      )}
                      style={{
                        left: `${leftPx}px`,
                        width: `${Math.max(2, widthPx)}px`,
                        background: bgStyle,
                      }}
                    >
                      {/* Resize handles */}
                      <div
                        onPointerDown={(e) => { e.stopPropagation(); startDrag(e, clip, 'resize-l'); }}
                        className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-white/20 rounded-l"
                      />
                      <span className="truncate text-[9px] drop-shadow-sm pointer-events-none">{clip.label}</span>
                      {(clip.audio?.fadeIn ?? 0) > 0 && <span className="ml-1 text-[8px] opacity-80">fade in</span>}
                      {(clip.audio?.fadeOut ?? 0) > 0 && <span className="ml-1 text-[8px] opacity-80">fade out</span>}
                      {track.kind === 'audio' && track.audio?.ducking?.enabled && <span className="ml-1 text-[8px] opacity-80">duck</span>}
                      <span className="ml-auto text-[8px] opacity-70">metadata only</span>
                      <div
                        onPointerDown={(e) => { e.stopPropagation(); startDrag(e, clip, 'resize-r'); }}
                        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-white/20 rounded-r"
                      />
                    </div>
                  );
                })}

                {/* Playhead line */}
                <div
                  className="absolute top-0 bottom-0 w-px bg-accent z-[5] pointer-events-none"
                  style={{ left: `${playhead * zoom}px` }}
                />

                {/* Snap indicators */}
                {drag && magnetOn && project.markers?.map((m) => (
                  <div
                    key={m.id}
                    className="absolute top-0 bottom-0 w-px opacity-30 pointer-events-none"
                    style={{ left: `${m.time_sec * zoom}px`, background: m.color }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// Day 26: small popover anchored to a trigger button. We use
// position: fixed because the timeline scroll container can
// hide an absolute popover. The anchor is found via
// document.querySelector on the data-testid, which works in
// jsdom and in the real browser.
function TimelinePopover({
  anchorTestId,
  onClose,
  children,
}: {
  anchorTestId: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const anchor = document.querySelector(`[data-testid="${anchorTestId}"]`);
    if (anchor instanceof HTMLElement) {
      const r = anchor.getBoundingClientRect();
      setPos({ left: r.left, top: r.bottom + 4 });
    }
  }, [anchorTestId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    function onPointerDown(e: PointerEvent) {
      const el = ref.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) {
        const anchor = document.querySelector(`[data-testid="${anchorTestId}"]`);
        if (!(anchor instanceof HTMLElement) || !anchor.contains(e.target)) onClose();
      }
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [anchorTestId, onClose]);

  if (!pos) return null;

  return (
    <div
      ref={ref}
      data-testid={`popover-${anchorTestId}`}
      role="dialog"
      className="fixed z-50 rounded-md border border-border-1 bg-bg-2 shadow-lg p-3 text-ink-1"
      style={{ left: pos.left, top: pos.top }}
    >
      {children}
    </div>
  );
}
