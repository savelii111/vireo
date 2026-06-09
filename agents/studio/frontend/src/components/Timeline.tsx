import { useRef, useState, useCallback, useEffect } from 'react';
import {
  MousePointer2, Scissors, MoveVertical, MoveHorizontal,
  Magnet, Grid3x3, Video, Music, Layers,
  EyeOff, Eye, Lock, Unlock, Volume2, VolumeX, Star, StarOff,
  type LucideIcon,
} from 'lucide-react';
import clsx from 'clsx';
import { formatShortTime } from '../utils/time';
import type { ProjectState, Tool, Clip, TrackKind } from '../types';

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
  onClipMove?: (id: string, newStart: number) => void;
  onClipResize?: (id: string, side: 'left' | 'right', pos: number) => void;
  onToggleMute?: (trackId: string) => void;
  onToggleSolo?: (trackId: string) => void;
  onToggleLock?: (trackId: string) => void;
  onToggleHidden?: (trackId: string) => void;
}

type DragMode = 'move' | 'resize-l' | 'resize-r';
type DragState = {
  mode: DragMode;
  clipId: string;
  startX: number;
  origStart: number;
  origDuration: number;
  origIn: number;
};

type TrackIcons = Record<TrackKind, LucideIcon>;
const TRACK_KIND_ICON: Partial<TrackIcons> = { video: Video, audio: Music, overlay: Layers };

const SNAP_THRESHOLD_PX = 6; // pixels within which snap activates

export function Timeline({
  project, tool, onToolChange, selectedClipId, onClipSelect,
  playhead, onSeek, zoom, onZoomChange,
  onClipMove, onClipResize,
  onToggleMute, onToggleSolo, onToggleLock, onToggleHidden,
}: Props) {
  const rulerRef = useRef<HTMLDivElement>(null);
  const tracksRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [magnetOn, setMagnetOn] = useState(true);
  const [gridSnap, setGridSnap] = useState(false);

  // ── Ruler click → seek ──
  const handleRulerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!rulerRef.current) return;
    const rect = rulerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left + rulerRef.current.scrollLeft;
    onSeek(x / zoom);
  };

  const totalWidth = project.duration_sec * zoom;
  const tickInterval = zoom >= 60 ? 5 : zoom >= 30 ? 10 : 30;
  const ticks: number[] = [];
  for (let s = 0; s <= project.duration_sec; s += tickInterval) ticks.push(s);

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

  const snapToNearest = useCallback((sec: number): number => {
    if (!magnetOn && !gridSnap) return sec;
    const px = sec * zoom;
    const targets = snapTargets();
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
  }, [magnetOn, gridSnap, snapTargets, zoom]);

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
    });
    onClipSelect(clip.id);
  }, [tool, onClipSelect, project.tracks]);

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - drag.startX;
      const dSec = dx / zoom;
      if (drag.mode === 'move') {
        const rawNew = drag.origStart + dSec;
        onClipMove?.(drag.clipId, snapToNearest(Math.max(0, rawNew)));
      } else if (drag.mode === 'resize-r') {
        const rawEnd = drag.origStart + drag.origDuration + dSec;
        onClipResize?.(drag.clipId, 'right', Math.max(drag.origStart + 0.1, rawEnd));
      } else if (drag.mode === 'resize-l') {
        const rawStart = drag.origStart + dSec;
        onClipResize?.(drag.clipId, 'left', snapToNearest(Math.max(0, rawStart)));
      }
    };
    const onUp = () => setDrag(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [drag, zoom, snapToNearest, onClipMove, onClipResize]);

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

      {/* ── Body ── */}
      <div className="flex flex-1 min-h-0">
        {/* Track headers */}
        <div className="w-[160px] border-r border-border-1 bg-bg-1 flex-shrink-0 overflow-y-auto">
          {project.tracks.map((t) => {
            const Icon = TRACK_KIND_ICON[t.kind] ?? Video;
            return (
              <div
                key={t.id}
                className={clsx(
                  'h-9 flex items-center px-2 border-b border-border-1 text-[11px] font-medium gap-1 group',
                  t.locked ? 'opacity-50' : 'text-ink-1 hover:bg-bg-2 cursor-pointer',
                  t.hidden && 'opacity-40',
                )}
              >
                <Icon size={12} strokeWidth={1.6} className="flex-shrink-0" />
                <span className="truncate flex-1">{t.name}</span>
                {/* Track controls */}
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  {t.kind === 'audio' && (
                    <button onClick={() => onToggleMute?.(t.id)} title={t.muted ? 'Unmute' : 'Mute'} className="w-5 h-5 flex items-center justify-center rounded hover:bg-bg-3">
                      {t.muted ? <VolumeX size={11} className="text-red-400" /> : <Volume2 size={11} className="text-ink-3" />}
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
                className={clsx(
                  'relative h-9 border-b border-border-1',
                  track.hidden && 'opacity-20',
                )}
              >
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
