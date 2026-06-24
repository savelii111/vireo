// Day 27 / Phase Adobe Frame: a real transport bar that
// wraps an existing preview surface. We DO NOT change
// playback logic — we just give it the Adobe-style
// row of buttons + a timecode that mirrors the same
// playhead the existing <Preview> receives.
//
// The actual <video> element and all useEffect/scrub logic
// stays in the original Preview component. This component
// only renders the button strip and the timecode. To
// keep the contract simple we re-render the same
// <Preview> above this bar, and the bar takes a
// playheadSec/durationSec/fps/playing/toggle pair so it
// can show the timecode and fire play/pause to the
// same handler the <Preview> uses internally.

import { ReactNode } from "react";
import {
  ChevronFirst,
  SkipBack,
  Play,
  Pause,
  SkipForward,
  ChevronLast,
  Bookmark,
} from "lucide-react";

export interface TransportBarProps {
  playheadSec: number;
  durationSec: number;
  fps: number;
  playing: boolean;
  onTogglePlay: () => void;
  onSkipStart: () => void;
  onSkipEnd: () => void;
  onStepBack: () => void;
  onStepForward: () => void;
  onMarkIn?: () => void;
  onMarkOut?: () => void;
}

function formatTimecode(sec: number, fps: number) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const f = Math.max(1, Math.floor(fps || 0) || 30);
  const total = Math.floor(sec * f);
  const frames = total % f;
  const totalSec = Math.floor(total / f);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  return (
    String(h).padStart(2, "0") + ":" +
    String(m).padStart(2, "0") + ":" +
    String(s).padStart(2, "0") + ":" +
    String(frames).padStart(2, "0")
  );
}

export function TransportBar(props: TransportBarProps) {
  return (
    <div className="h-9 flex items-center justify-between gap-2 px-3 border-t border-[#2a2a2e] bg-[#1a1a1c] text-[11px] flex-shrink-0">
      <div className="flex items-center gap-1">
        <TransportButton label="В начало" onClick={props.onSkipStart}>
          <ChevronFirst size={14} />
        </TransportButton>
        <TransportButton label="Назад" onClick={props.onStepBack}>
          <SkipBack size={14} />
        </TransportButton>
        <TransportButton
          label={props.playing ? "Пауза" : "Плей"}
          onClick={props.onTogglePlay}
          highlight
        >
          {props.playing ? <Pause size={14} /> : <Play size={14} />}
        </TransportButton>
        <TransportButton label="Вперёд" onClick={props.onStepForward}>
          <SkipForward size={14} />
        </TransportButton>
        <TransportButton label="В конец" onClick={props.onSkipEnd}>
          <ChevronLast size={14} />
        </TransportButton>
        <div className="w-px h-5 bg-[#2a2a2e] mx-1" />
        <TransportButton label="Mark In" onClick={props.onMarkIn ?? (() => {})}>
          <Bookmark size={14} />
        </TransportButton>
        <TransportButton label="Mark Out" onClick={props.onMarkOut ?? (() => {})}>
          <Bookmark size={14} />
        </TransportButton>
      </div>
      <div
        data-testid="transport-timecode"
        className="font-mono text-[12px] text-[#cfcfd2] tabular-nums"
      >
        <span data-testid="transport-tc-current">
          {formatTimecode(props.playheadSec, props.fps)}
        </span>
        <span className="mx-2 text-[#666]">/</span>
        <span data-testid="transport-tc-total" className="text-[#9aa0aa]">
          {formatTimecode(props.durationSec, props.fps)}
        </span>
      </div>
    </div>
  );
}

function TransportButton({
  children, onClick, label, highlight = false,
}: { children: ReactNode; onClick: () => void; label: string; highlight?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      data-testid={`transport-btn-${label.toLowerCase().replace(/\s+/g, "-")}`}
      className={
        "h-7 w-7 flex items-center justify-center rounded transition-colors " +
        (highlight
          ? "bg-[#5b8def] text-white hover:bg-[#4a7ad6]"
          : "text-[#cfcfd2] hover:bg-[#2f2f33] hover:text-white")
      }
    >
      {children}
    </button>
  );
}
