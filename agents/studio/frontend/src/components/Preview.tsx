import { useRef } from 'react';
import {
  SkipBack, Rewind, Play, FastForward, SkipForward, ChevronsLeft, ChevronsRight, Maximize2,
} from 'lucide-react';
import { formatTimecode, formatShortTime } from '../utils/time';
import type { PreviewTab } from '../types';
import clsx from 'clsx';

interface Props {
  tab: PreviewTab;
  onTabChange: (t: PreviewTab) => void;
  playing: boolean;
  onTogglePlay: () => void;
  playhead: number;
  duration: number;
  fps: number;
  width: number;
  height: number;
}

export function Preview({
  tab, onTabChange, playing, onTogglePlay, playhead, duration, fps, width, height,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);

  return (
    <section className="flex flex-col bg-bg-0 border-b border-border-1 min-h-0">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 h-9 border-b border-border-1 bg-bg-1">
        <div className="flex items-center gap-0.5">
          {(['program', 'source', 'reference'] as const).map((t) => (
            <button
              key={t}
              onClick={() => onTabChange(t)}
              className={clsx(
                'px-3 py-1 text-[12px] rounded transition-all duration-[120ms] capitalize',
                tab === t
                  ? 'text-ink-1 bg-bg-2'
                  : 'text-ink-3 hover:text-ink-2',
              )}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-ink-3 font-mono">
          <span>FIT</span>
          <span>·</span>
          <span>100%</span>
        </div>
      </div>

      {/* Canvas */}
      <div
        className="flex-1 flex items-center justify-center relative min-h-0"
        style={{
          backgroundColor: '#000',
          backgroundImage: `
            linear-gradient(45deg, #0c0c0e 25%, transparent 25%),
            linear-gradient(-45deg, #0c0c0e 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, #0c0c0e 75%),
            linear-gradient(-45deg, transparent 75%, #0c0c0e 75%)
          `,
          backgroundSize: '20px 20px',
          backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0',
        }}
      >
        <div
          className="relative bg-gradient-to-b from-[#1a1a1e] to-[#0a0a0c] border border-border-2 rounded-lg overflow-hidden"
          style={{
            width: 'min(80%, 920px)',
            aspectRatio: '16/9',
            boxShadow: '0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px var(--border-1)',
          }}
        >
          <div className="absolute inset-0 pointer-events-none" style={{
            background: 'radial-gradient(circle at 30% 30%, rgba(99, 102, 241, 0.15), transparent 50%), radial-gradient(circle at 70% 70%, rgba(168, 85, 247, 0.10), transparent 50%)',
          }} />

          {/* Hidden video element — for real preview we would set src=clip.source_file */}
          <video
            ref={videoRef}
            className="absolute inset-0 w-full h-full object-contain"
            muted
            playsInline
            style={{ display: 'none' }}
          />

          {/* Overlays */}
          <div className="absolute top-3 left-3 flex gap-2 z-[2]">
            <div className="flex items-center gap-1 bg-black/60 backdrop-blur-md border border-border-2 rounded px-2 py-1 text-[11px] text-rec">
              <span className="w-1.5 h-1.5 rounded-full bg-rec animate-pulse-rec" />
              <span className="font-mono">REC {formatTimecode(playhead, fps)}</span>
            </div>
            <div className="bg-black/60 backdrop-blur-md border border-border-2 rounded px-2 py-1 text-[11px] text-ink-1 font-mono">
              {width}×{height} · {fps}fps
            </div>
            <div className="bg-black/60 backdrop-blur-md border border-border-2 rounded px-2 py-1 text-[11px] text-ink-1">
              V1 · A1
            </div>
          </div>

          <div className="absolute inset-0 flex items-center justify-center text-ink-3 text-[14px] font-medium">
            Preview · {formatShortTime(playhead)} / {formatShortTime(duration)}
          </div>

          {/* Video controls */}
          <div
            className="absolute bottom-0 left-0 right-0 z-[2] flex items-center gap-3 px-4 py-3"
            style={{ background: 'linear-gradient(transparent, rgba(0,0,0,0.8))' }}
          >
            <button data-tip="Previous edit (←)" className="vc-btn">
              <SkipBack size={16} strokeWidth={1.8} />
            </button>
            <button data-tip="Step back (J)" className="vc-btn">
              <ChevronsLeft size={16} strokeWidth={1.8} />
            </button>
            <button
              onClick={onTogglePlay}
              data-tip="Play / Pause (Space)"
              className="w-[38px] h-[38px] rounded-full bg-ink-1 text-bg-0 flex items-center justify-center hover:scale-105 transition-transform"
            >
              {playing ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="4" width="4" height="16" />
                  <rect x="14" y="4" width="4" height="16" />
                </svg>
              ) : (
                <Play size={16} strokeWidth={1.8} fill="currentColor" />
              )}
            </button>
            <button data-tip="Step forward (K)" className="vc-btn">
              <ChevronsRight size={16} strokeWidth={1.8} />
            </button>
            <button data-tip="Next edit (→)" className="vc-btn">
              <SkipForward size={16} strokeWidth={1.8} />
            </button>
            <div className="flex-1" />
            <span className="font-mono text-[12px] text-ink-1 tabular-nums tracking-wider">
              <span className="text-ink-3">00:00:</span>{formatTimecode(playhead, fps).split(':').pop()}
            </span>
            <span className="font-mono text-[12px] text-ink-3 tabular-nums">/ {formatShortTime(duration)}</span>
            <div className="flex-1" />
            <button data-tip="Set In (I)" className="vc-btn">
              <Rewind size={16} strokeWidth={1.8} />
            </button>
            <button data-tip="Set Out (O)" className="vc-btn">
              <FastForward size={16} strokeWidth={1.8} />
            </button>
            <button data-tip="Fullscreen (F)" className="vc-btn">
              <Maximize2 size={16} strokeWidth={1.8} />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
