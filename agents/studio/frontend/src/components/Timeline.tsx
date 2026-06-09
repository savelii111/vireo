import { useRef, useState, useCallback, useEffect } from 'react';
import { MousePointer2, Scissors, MoveVertical, MoveHorizontal, Magnet, Grid3x3, Video, Music, Layers, type LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import { formatShortTime } from '../utils/time';
import type { ProjectState, Tool, TrackKind, Clip } from '../types';

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
}

type DragMode = 'move' | 'resize-l' | 'resize-r';

interface DragState {
  mode: DragMode;
  clipId: string;
  startX: number;
  origStart: number;
  origDuration: number;
  origIn: number;
}

type TrackIcons = Record<TrackKind, LucideIcon>;

const TRACK_KIND_ICON: Partial<TrackIcons> = {
  video: Video,
  audio: Music,
  overlay: Layers,
};

export function Timeline({
  project, tool, onToolChange, selectedClipId, onClipSelect,
  playhead, onSeek, zoom, onZoomChange,
}: Props) {
  const rulerRef = useRef<HTMLDivElement>(null);
  const tracksRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

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

  // ---- Drag handlers (useCapture to swallow events from clip blocks) ----

  const startDrag = useCallback((e: React.PointerEvent, clip: Clip, mode: DragMode) => {
    if (tool !== 'select') return;
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
  }, [tool, onClipSelect]);

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - drag.startX;
      const dSec = dx / zoom;
      const project = document.querySelector<HTMLElement>('[data-timeline-project]');
      if (!project) return;
      // Mutate via a custom event the App listens to
      const evt = new CustomEvent('vireo:clip-drag', {
        detail: {
          clipId: drag.clipId,
          mode: drag.mode,
          deltaSec: dSec,
        },
      });
      project.dispatchEvent(evt);
    };
    const onUp = () => setDrag(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [drag, zoom]);

  return (
    <section
      data-timeline-project
      className="flex flex-col bg-bg-1 min-h-0 min-w-0 max-w-full w-full border-t border-border-1 overflow-hidden"
    >
      {/* Header */}
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
          <button data-tip="Snap to grid" className="tip w-7 h-[26px] flex items-center justify-center rounded text-ink-2 hover:text-ink-1 hover:bg-bg-2 transition-all duration-[120ms]">
            <Grid3x3 size={14} strokeWidth={1.6} />
          </button>
          <button data-tip="Magnetic timeline" className="tip w-7 h-[26px] flex items-center justify-center rounded text-ink-2 hover:text-ink-1 hover:bg-bg-2 transition-all duration-[120ms]">
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
            <div
              className="absolute top-1/2 w-2.5 h-2.5 bg-white rounded-full -translate-y-1/2 -translate-x-1/2"
              style={{ left: `${((zoom - 10) / 190) * 100}%` }}
            />
          </div>
          <span className="font-mono bg-bg-2 border border-border-1 rounded px-1.5 py-0.5 text-ink-2">⌘+</span>
          <span className="font-mono bg-bg-2 border border-border-1 rounded px-1.5 py-0.5 text-ink-2">⌘-</span>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 min-h-0">
        <div className="w-[110px] border-r border-border-1 bg-bg-1 flex-shrink-0">
          {project.tracks.map((t) => {
            const Icon = TRACK_KIND_ICON[t.kind] ?? Video;
            return (
              <div
                key={t.id}
                className="h-9 flex items-center px-3 border-b border-border-1 text-[11px] text-ink-1 font-medium gap-2 hover:bg-bg-2 cursor-pointer"
              >
                <Icon size={12} strokeWidth={1.6} />
                <span>{t.name}</span>
              </div>
            );
          })}
        </div>

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
            <div className="relative">
              {project.tracks.map((track, i) => (
                <div
                  key={track.id}
                  className={clsx(
                    'h-9 border-b border-border-1 relative',
                    i % 2 === 0 ? 'bg-bg-0' : 'bg-bg-1',
                  )}
                >
                  {track.clips.map((clip) => (
                    <ClipBlock
                      key={clip.id}
                      clip={clip}
                      zoom={zoom}
                      selected={clip.id === selectedClipId}
                      onPointerDown={(e, mode) => startDrag(e, clip, mode)}
                      onClick={() => onClipSelect(clip.id)}
                    />
                  ))}
                </div>
              ))}

              {/* Playhead */}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-rec pointer-events-none z-[3]"
                style={{
                  left: `${playhead * zoom}px`,
                  boxShadow: '0 0 8px var(--rec)',
                }}
              >
                <div
                  className="absolute -top-1 -left-[5px] w-3 h-3 bg-rec"
                  style={{ clipPath: 'polygon(0 0, 100% 0, 50% 100%)' }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

interface ClipBlockProps {
  clip: Clip;
  zoom: number;
  selected: boolean;
  onClick: () => void;
  onPointerDown: (e: React.PointerEvent, mode: DragMode) => void;
}

function ClipBlock({ clip, zoom, selected, onClick, onPointerDown }: ClipBlockProps) {
  return (
    <div
      onPointerDown={(e) => onPointerDown(e, 'move')}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={clsx(
        'absolute top-1 bottom-1 rounded cursor-grab overflow-hidden flex items-center px-2 text-[11px] text-white font-medium border transition-all duration-[120ms] group select-none',
        selected
          ? 'border-accent shadow-[0_0_0_2px_rgba(99,102,241,0.1)] z-[1]'
          : 'border-transparent hover:border-accent hover:shadow-[0_0_0_1px_rgba(99,102,241,0.1)]',
      )}
      style={{
        left: `${clip.start_sec * zoom}px`,
        width: `${clip.duration_sec * zoom}px`,
        background: clip.thumbnail_color,
        touchAction: 'none',
      }}
    >
      <div className="absolute left-0 top-0 bottom-0 w-1 bg-black/30" />
      <div
        onPointerDown={(e) => {
          e.stopPropagation();
          onPointerDown(e, 'resize-l');
        }}
        className="absolute left-0 top-0 bottom-0 w-1 bg-white/0 hover:bg-white/30 cursor-ew-resize"
      />
      <div
        onPointerDown={(e) => {
          e.stopPropagation();
          onPointerDown(e, 'resize-r');
        }}
        className="absolute right-0 top-0 bottom-0 w-1 bg-white/0 hover:bg-white/30 cursor-ew-resize"
      />
      <span className="relative z-[1] whitespace-nowrap overflow-hidden text-ellipsis flex-1 pointer-events-none">
        {clip.label}
      </span>
    </div>
  );
}

export type { DragState };
