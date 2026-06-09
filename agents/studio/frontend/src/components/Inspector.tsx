import { useState } from 'react';
import {
  Sparkles, Wand2, Move, Captions, Music2, Scissors, RotateCcw,
} from 'lucide-react';
import { formatSeconds } from '../utils/time';
import type { Clip } from '../types';
import clsx from 'clsx';
import { thumbnailUrl, fallbackGradient } from '../hooks/useThumbnails';

interface Props {
  clip: Clip | null;
  onQuickAction: (action: string) => void;
}

type Tab = 'clip' | 'effect' | 'audio';

interface ParamSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  display?: string;
  onChange?: (v: number) => void;
}

function ParamSlider({ label, value, min, max, step = 1, display, onChange }: ParamSliderProps) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="grid grid-cols-[90px_1fr_60px] items-center gap-3 py-1.5">
      <div className="text-[11px] text-ink-3 uppercase tracking-wider font-semibold">{label}</div>
      <div className="relative h-1 bg-bg-3 rounded-full cursor-pointer group">
        <div className="absolute left-0 top-0 h-full bg-accent rounded-full" style={{ width: `${pct}%` }} />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange?.(Number(e.target.value))}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
        <div
          className="absolute top-1/2 w-3 h-3 bg-white rounded-full -translate-y-1/2 -translate-x-1/2 shadow-[0_0_0_3px_rgba(99,102,241,0.1)] pointer-events-none"
          style={{ left: `${pct}%` }}
        />
      </div>
      <div className="font-mono text-[11px] text-ink-1 text-right tabular-nums">
        {display ?? String(value)}
      </div>
    </div>
  );
}

const QUICK_ACTIONS = [
  { id: 'cinematic',   label: 'Apply cinematic grade', Icon: Sparkles, kbd: null },
  { id: 'auto-color',  label: 'Auto-color match',      Icon: Wand2,    kbd: null },
  { id: 'stabilize',   label: 'Stabilize',             Icon: Move,     kbd: null },
  { id: 'captions',    label: 'Add captions',          Icon: Captions, kbd: null },
  { id: 'beat-sync',   label: 'Beat-sync cuts',        Icon: Music2,   kbd: null },
  { id: 'split',       label: 'Split at playhead',     Icon: Scissors, kbd: '⌘K' },
  { id: 'undo',        label: 'Undo',                  Icon: RotateCcw,kbd: '⌘Z' },
];

export function Inspector({ clip, onQuickAction }: Props) {
  const [tab, setTab] = useState<Tab>('clip');

  return (
    <section className="grid grid-cols-[260px_1fr_240px] bg-bg-1 border-b border-border-1 min-h-0 max-h-full overflow-hidden">
      {/* Clip info column */}
      <div className="p-3 px-4 border-r border-border-1">
        <div className="flex gap-0.5 mb-3">
          {(['clip', 'effect', 'audio'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={clsx(
                'px-2 py-1 text-[11px] rounded uppercase tracking-wider font-semibold transition-all',
                tab === t
                  ? 'text-ink-1 bg-bg-2'
                  : 'text-ink-3 hover:text-ink-2',
              )}
            >
              {t}
            </button>
          ))}
        </div>
        <div
          className="w-full aspect-video rounded-md mb-2 relative overflow-hidden bg-bg-2"
          style={{ background: clip ? fallbackGradient(clip.source_file) : 'var(--bg-2)' }}
        >
          {clip && (
            <img
              src={thumbnailUrl(clip.source_file, 320, 180)}
              alt={clip.label ?? clip.source_file}
              loading="lazy"
              className="absolute inset-0 w-full h-full object-cover"
              onError={(e) => {
                // Fallback to gradient if image fails
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          )}
          <div className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(transparent 60%, rgba(0,0,0,0.5))' }} />
        </div>
        <div className="text-[12px] font-medium mb-0.5">
          {clip?.label ?? 'No clip selected'}
        </div>
        <div className="text-[11px] text-ink-3 font-mono">
          {clip
            ? `${formatSeconds(clip.in_sec)} — ${formatSeconds(clip.in_sec + clip.duration_sec)} · ${formatSeconds(clip.duration_sec)} · 1920×1080`
            : 'Click a clip in the timeline'}
        </div>
      </div>

      {/* Params column */}
      <div className="p-3 px-4 overflow-y-auto">
        <div className="text-[10px] text-ink-3 uppercase tracking-widest font-bold mb-2">Transform</div>
        <ParamSlider label="Position" value={0} min={-100} max={100} display="0, 0" />
        <ParamSlider label="Scale"    value={100} min={0} max={200} display="100%" />
        <ParamSlider label="Rotation" value={0} min={-180} max={180} display="0°" />
        <ParamSlider label="Opacity"  value={100} min={0} max={100} display="100%" />

        <div className="border-t border-border-1 mt-3 pt-3">
          <div className="text-[10px] text-ink-3 uppercase tracking-widest font-bold mb-2">Speed</div>
          <ParamSlider label="Rate" value={100} min={10} max={400} step={5} display="1.00×" />
        </div>

        <div className="border-t border-border-1 mt-3 pt-3">
          <div className="text-[10px] text-ink-3 uppercase tracking-widest font-bold mb-2">Color</div>
          <ParamSlider label="Exposure"  value={50} min={0} max={100} display="0.0" />
          <ParamSlider label="Contrast"  value={60} min={0} max={100} display="+10" />
          <ParamSlider label="Saturation"value={55} min={0} max={100} display="+5" />
          <ParamSlider label="Temp"      value={65} min={0} max={100} display="+8" />
        </div>

        <div className="border-t border-border-1 mt-3 pt-3">
          <div className="text-[10px] text-ink-3 uppercase tracking-widest font-bold mb-2">Audio</div>
          <ParamSlider label="Volume"    value={100} min={0} max={200} display="100%" />
          <ParamSlider label="Voice EQ"  value={50} min={0} max={100} display="flat" />
        </div>
      </div>

      {/* Quick actions column */}
      <div className="p-3 px-4 border-l border-border-1 bg-bg-0 flex flex-col gap-1.5">
        <div className="text-[10px] text-ink-3 uppercase tracking-widest font-bold mb-1">Quick actions</div>
        {QUICK_ACTIONS.map((qa) => (
          <button
            key={qa.id}
            onClick={() => onQuickAction(qa.id)}
            className="flex items-center gap-2 px-2 py-1.5 rounded-md text-[12px] text-ink-2 hover:bg-bg-2 hover:text-ink-1 transition-all duration-[120ms] group"
          >
            <qa.Icon size={14} strokeWidth={1.6} className="text-ink-3 group-hover:text-ink-1" />
            <span className="flex-1 text-left">{qa.label}</span>
            {qa.kbd && (
              <span className="font-mono text-[10px] text-ink-4">{qa.kbd}</span>
            )}
          </button>
        ))}
      </div>
    </section>
  );
}
