import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  SkipBack, Rewind, Play, FastForward, SkipForward, ChevronsLeft, ChevronsRight, Maximize2,
} from 'lucide-react';
import clsx from 'clsx';
import { formatTimecode, formatShortTime } from '../utils/time';
import type { PreviewTab, Clip, ProjectState } from '../types';
import { clipDuration, hasRealMediaPath, previewModeForClip, transformPosition, resolvePlaybackFrame, clipStart, clipTransformStyle } from '../timelinePlayback';

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
  timeline?: ProjectState | null;
  activeVideoClip?: Clip | null;
  activeTextClips?: Clip[];
  assetUrlResolver?: (clip: Clip) => string;
  onSeek?: (t: number) => void;
}

function SourceBadge({ children }: { children: ReactNode }) {
  return (
    <div className="bg-black/60 backdrop-blur-md border border-border-2 rounded px-2 py-1 text-[11px] text-ink-1 font-mono">
      {children}
    </div>
  );
}

export function Preview({
  tab, onTabChange, playing, onTogglePlay, playhead, duration, fps, width, height,
  timeline = null,
  activeVideoClip = null,
  activeTextClips = [],
  assetUrlResolver = (clip) => clip.source_file || '',
  onSeek,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const isSeekingProgrammatically = useRef(false);
  const playbackTimeline = useMemo<ProjectState>(() => {
    if (timeline) return timeline;
    if (!activeVideoClip) return {
      name: 'Preview source',
      duration_sec: 0,
      fps: 30,
      width: 1920,
      height: 1080,
      tracks: [],
    };
    return {
      tracks: [{
        id: activeVideoClip.track_id || 'v1',
        kind: 'video',
        name: 'Video 1',
        muted: false,
        locked: false,
        clips: [activeVideoClip],
      }],
    } as ProjectState;
  }, [timeline, activeVideoClip]);
  const playbackFrame = useMemo(() => activeVideoClip
    ? resolvePlaybackFrame(playbackTimeline, playhead, assetUrlResolver)
    : null, [activeVideoClip, playbackTimeline, playhead, assetUrlResolver]);
  const activeMode = activeVideoClip ? previewModeForClip(activeVideoClip) : 'empty';
  const activeText = activeTextClips;
  const sourceLabel = activeVideoClip?.source ?? 'upload';
  const videoTransform = playbackFrame
    ? { transform: playbackFrame.transform, opacity: playbackFrame.opacity, filter: playbackFrame.filterCss }
    : {};
  const handleVideoSeek = useCallback((t: number) => {
    const video = videoRef.current;
    if (!video || !activeVideoClip) return;
    isSeekingProgrammatically.current = true;
    try {
      video.currentTime = Math.max(0, t);
    } catch (_) {
      // Metadata may not be loaded yet; loadedmetadata effect will retry.
    }
    window.setTimeout(() => {
      isSeekingProgrammatically.current = false;
    }, 0);
  }, [activeVideoClip]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (playing) {
      void video.play().catch(() => { /* Browser may block autoplay until user gesture. */ });
    } else {
      video.pause();
    }
  }, [playing, playbackFrame?.assetUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playbackFrame) return;
    const seek = () => {
      if (Math.abs(video.currentTime - playbackFrame.seekTime) <= 0.08) return;
      handleVideoSeek(playbackFrame.seekTime);
    };
    if (video.readyState >= 1) seek();
    video.addEventListener('loadedmetadata', seek);
    return () => video.removeEventListener('loadedmetadata', seek);
  }, [handleVideoSeek, playbackFrame?.assetUrl, playbackFrame?.seekTime]);

  const handleVideoTimeUpdate = useCallback(() => {
    if (isSeekingProgrammatically.current) return;
    const video = videoRef.current;
    if (!video || !activeVideoClip || !playbackFrame) return;
    const delta = Math.abs(video.currentTime - playbackFrame.seekTime);
    if (delta <= 0.08) return;
    const inSec = Number(activeVideoClip.in_sec);
    const nextPlayhead = Math.max(0, clipStart(activeVideoClip) + video.currentTime - inSec);
    onSeek?.(nextPlayhead);
  }, [activeVideoClip, onSeek, playbackFrame]);

  const handleVideoSeeked = useCallback(() => {
    if (isSeekingProgrammatically.current) return;
    const video = videoRef.current;
    if (!video || !activeVideoClip || !playbackFrame) return;
    const inSec = Number(activeVideoClip.in_sec);
    onSeek?.(Math.max(0, clipStart(activeVideoClip) + video.currentTime - inSec));
  }, [activeVideoClip, onSeek, playbackFrame]);

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
          data-testid="preview-surface"
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

          {activeMode === 'real' && activeVideoClip ? (
            <video
              ref={videoRef}
              data-testid="preview-video"
              className="absolute inset-0 w-full h-full object-contain"
              src={playbackFrame?.assetUrl || activeVideoClip.source_file}
              muted
              playsInline
              preload="metadata"
              onTimeUpdate={handleVideoTimeUpdate}
              onSeeked={handleVideoSeeked}
              style={{
                transform: playbackFrame?.transform || videoTransform.transform,
                opacity: playbackFrame?.opacity ?? videoTransform.opacity,
                filter: playbackFrame?.filterCss,
              }}
            />
          ) : null}

          {activeMode === 'placeholder' && activeVideoClip ? (
            <div
              data-testid="preview-placeholder"
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-8 text-center"
              style={{
                transform: videoTransform.transform,
                opacity: videoTransform.opacity,
                filter: videoTransform.filter,
              }}
            >
              <div className="rounded-2xl border border-dashed border-border-2 bg-bg-1/80 p-8 shadow-inner">
                <div className="text-[11px] uppercase tracking-[0.3em] text-accent font-bold mb-2">Simulated media</div>
                <h2 data-testid="preview-clip-name" className="text-2xl font-semibold text-ink-1">{activeVideoClip.label}</h2>
                <p data-testid="preview-source" className="font-mono text-[12px] text-ink-3 mt-1">source: {sourceLabel}</p>
                <p data-testid="preview-duration" className="font-mono text-[12px] text-ink-3">duration: {formatShortTime(clipDuration(activeVideoClip))}</p>
                {!hasRealMediaPath(activeVideoClip) ? (
                  <p data-testid="preview-no-fake-frame" className="mt-4 max-w-md text-[12px] text-ink-3">
                    No real media path — Vireo shows a poster card instead of a fake frame.
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          {activeMode === 'empty' ? (
            <div data-testid="preview-empty" className="absolute inset-0 flex items-center justify-center text-ink-3 text-[14px] font-medium">
              No active video clip at {formatShortTime(playhead)}
            </div>
          ) : null}

          {activeText.map((clip) => {
            const textTransform = clipTransformStyle(clip, playhead);
            const position = transformPosition(clip);
            return (
              <div
                key={clip.id}
                data-testid="preview-text-overlay"
                data-clip-id={clip.id}
                className="absolute z-[3] whitespace-pre-wrap text-ink-1 drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]"
                style={{
                  ...textTransform,
                  left: `${position.x}px`,
                  top: `${position.y}px`,
                  fontFamily: clip.titleProps?.fontFamily || 'Inter',
                  fontSize: `${Math.max(8, Number(clip.titleProps?.fontSize ?? 44))}px`,
                  color: clip.titleProps?.color || '#ffffff',
                  textAlign: clip.titleProps?.align || 'center',
                  fontWeight: 700,
                  lineHeight: 1.05,
                  padding: clip.titleProps?.backgroundColor ? '0.18em 0.32em' : '0',
                  borderRadius: clip.titleProps?.backgroundColor ? '0.25em' : '0',
                  backgroundColor: clip.titleProps?.backgroundColor || 'transparent',
                  WebkitTextStroke: Number(clip.titleProps?.strokeWidth ?? 0) > 0
                    ? `${Math.max(0, Number(clip.titleProps?.strokeWidth || 0))}px ${clip.titleProps?.strokeColor || '#000000'}`
                    : undefined,
                }}
              >
                {clip.text || clip.label || clip.source_file}
              </div>
            );
          })}

          {/* Overlays */}
          <div className="absolute top-3 left-3 flex gap-2 z-[4]">
            <SourceBadge>
              <span className="w-1.5 h-1.5 rounded-full bg-rec animate-pulse-rec" />
              <span className="font-mono">REC {formatTimecode(playhead, fps)}</span>
            </SourceBadge>
            <SourceBadge>{width}×{height} · {fps}fps</SourceBadge>
            <SourceBadge>{activeVideoClip ? activeVideoClip.track_id : '—'} · A1</SourceBadge>
          </div>

          <div className="absolute top-3 right-3 z-[4]">
            <SourceBadge>{activeMode === 'real' ? 'real media' : activeMode === 'placeholder' ? 'poster card' : 'empty'}</SourceBadge>
            {activeVideoClip?.color ? <SourceBadge>approx preview</SourceBadge> : null}
          </div>

          {/* Video controls */}
          <div
            className="absolute bottom-0 left-0 right-0 z-[4] flex items-center gap-3 px-4 py-3"
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
