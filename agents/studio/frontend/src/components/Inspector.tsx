import { useMemo, useState } from 'react';
import {
  Sparkles, Wand2, Move, Captions, Music2, Scissors, RotateCcw,
} from 'lucide-react';
import { formatSeconds } from '../utils/time';
import type { Clip, Keyframe, TitleProps, Track, AudioTrack, AudioClip, ColorGrade } from '../types';
import clsx from 'clsx';
import { thumbnailUrl, fallbackGradient } from '../hooks/useThumbnails';
import { hasRealMediaPath } from '../timelinePlayback';

interface Props {
  clip: Clip | null;
  clipId?: string | null;
  track?: Track | null;
  playhead?: number;
  onQuickAction: (action: string) => void;
  onAddEffect?: (effect: Record<string, unknown>) => void;
  onSetEffect?: (effect: Record<string, unknown>) => void;
  onSetKeyframe?: (targetId: string, param: string, keyframe: Keyframe) => void;
  onRemoveKeyframe?: (targetId: string, param: string, time: number) => void;
  onTransformChange?: (transform: Record<string, number>) => void;
  onTitlePropsChange?: (titleProps: Partial<TitleProps>) => void;
  onVolumeChange?: (volume: number) => void;
  onTrackAudioChange?: (audio: Partial<AudioTrack>) => void;
  onClipAudioChange?: (audio: Partial<AudioClip>) => void;
  onClipColorChange?: (color: Partial<ColorGrade>) => void;
}

type Tab = 'clip' | 'controls' | 'audio' | 'color';

interface ParamSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  display?: string;
  disabled?: boolean;
  testId?: string;
  onChange?: (v: number) => void;
}

function ParamSlider({ label, value, min, max, step = 1, display, disabled = false, testId, onChange }: ParamSliderProps) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="grid grid-cols-[90px_1fr_60px] items-center gap-3 py-1.5">
      <div className="text-[11px] text-ink-3 uppercase tracking-wider font-semibold">{label}</div>
      <div className="relative h-1 bg-bg-3 rounded-full cursor-pointer group">
        <div className="absolute left-0 top-0 h-full bg-accent rounded-full" style={{ width: `${disabled ? 0 : pct}%` }} />
        <input
          data-testid={testId}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange?.(Number(e.target.value))}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
        />
        <div
          className="absolute top-1/2 w-3 h-3 bg-white rounded-full -translate-y-1/2 -translate-x-1/2 shadow-[0_0_0_3px_rgba(99,102,241,0.1)] pointer-events-none"
          style={{ left: `${disabled ? 0 : pct}%` }}
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

function Property({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-3 py-1.5 border-b border-border-1 text-[12px]">
      <div className="text-ink-3 uppercase tracking-wider">{label}</div>
      <div className="text-ink-1 font-mono break-all">{children}</div>
    </div>
  );
}

function keyframeValueLabel(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.00$/, '');
}

export function Inspector({
  clip,
  clipId,
  track,
  playhead,
  onQuickAction,
  onAddEffect,
  onSetEffect,
  onSetKeyframe,
  onRemoveKeyframe,
  onTransformChange,
  onTitlePropsChange,
  onVolumeChange,
  onTrackAudioChange,
  onClipAudioChange,
  onClipColorChange,
}: Props) {
  const [tab, setTab] = useState<Tab>('clip');
  const [effectKind, setEffectKind] = useState('colorGrade');
  const [qaOpen, setQaOpen] = useState(true);
  const [effectIndex, setEffectIndex] = useState(0);

  const effects = clip?.effects ?? [];
  const effectPresets = [
    { id: 'colorGrade', label: 'Color grade' },
    { id: 'blur', label: 'Blur' },
    { id: 'sharpen', label: 'Sharpen' },
    { id: 'stabilize', label: 'Stabilize' },
  ];
  const currentTime = playhead ?? 0;
  const neutralColor = useMemo<ColorGrade>(() => ({
    basic: { temperature: 0, tint: 0, exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, saturation: 100, vibrance: 0 },
    creative: { lut: { id: '', name: '', intensity: 0 }, faded: 0, sharpen: 0, tintShadows: null, tintHighlights: null },
    curves: { master: [], r: [], g: [], b: [] },
    wheels: { shadows: { r: 0, g: 0, b: 0 }, midtones: { r: 0, g: 0, b: 0 }, highlights: { r: 0, g: 0, b: 0 } },
    metadata: { simulated_scopes: true, real_pixel_analysis: false, real_lut_apply: false },
  }), []);
  const transformRotation = Number(clip?.transform?.rotation ?? 0);
  const transformValue = (param: string, fallback: number) => {
    const keyframes = clip?.keyframes?.transform?.[param] ?? [];
    if (keyframes.length === 0) return fallback;
    const previous = [...keyframes].filter((keyframe) => keyframe.time <= currentTime).sort((a, b) => b.time - a.time)[0];
    return previous?.value ?? fallback;
  };

  const source = clip?.source ?? 'upload';
  const transformX = Number(clip?.transform?.x ?? 0);
  const transformY = Number(clip?.transform?.y ?? 0);
  const transformScale = Number(clip?.transform?.scale ?? 1);
  const transformOpacity = Number(clip?.transform?.opacity ?? 1);
  const trackAudio = track?.audio;
  const clipAudio = clip?.audio;
  const ducking = trackAudio?.ducking;
  const meters = clipAudio?.meters ?? [];
  const waveform = clipAudio?.waveform ?? [];
  const audioMetadata = clipAudio?.metadata ?? { simulated_levels: true, real_decode: false };
  const volume = Number(clip?.volume ?? 1);
  const isTitleClip = clip?.source === 'text';
  const color = clip?.color;
  const colorBasic = color?.basic ?? neutralColor.basic;
  const visualClip = Boolean(clipId && clip && !isTitleClip && ['video', 'image', 'overlay'].includes(clip.kind));
  const titleProps = isTitleClip ? (clip?.titleProps ?? {}) : {};
  const titleDisabled = !clipId || !isTitleClip;
  const transformDisabled = !clipId;
  const volumeDisabled = !clipId;

  return (
    <section className="grid grid-cols-[260px_1fr_240px] bg-bg-1 border-b border-border-1 min-h-0 max-h-full overflow-hidden">
      {/* Clip info column */}
      <div className="p-3 px-4 border-r border-border-1">
        <div className="flex gap-0.5 mb-3">
          {(['clip', 'controls', 'audio', 'color'] as const).map((t) => (
            <button
              key={t}
              data-testid={`inspector-tab-${t}`}
              onClick={() => setTab(t)}
              className={clsx(
                'px-2 py-1 text-[11px] rounded uppercase tracking-wider font-semibold transition-all',
                tab === t
                  ? 'text-ink-1 bg-bg-2'
                  : 'text-ink-3 hover:text-ink-2',
              )}
            >
              {t === 'controls' ? 'controls' : t}
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
        <div data-testid="inspector-name" className="text-[12px] font-medium mb-0.5">
          {clip?.label ?? 'No clip selected'}
        </div>
        <div data-testid="inspector-timing" className="text-[11px] text-ink-3 font-mono">
          {clip
            ? `${formatSeconds(clip.in_sec)} — ${formatSeconds(clip.in_sec + clip.duration_sec)} · ${formatSeconds(clip.duration_sec)}`
            : 'Click a clip in the timeline'}
        </div>
      </div>

      {/* Params column */}
      <div className="p-3 px-4 overflow-y-auto">
        {tab === 'controls' ? (
          <div className="space-y-3">
            {isTitleClip ? (
              <div className="rounded-md border border-border-1 bg-bg-2 p-3 space-y-3" data-testid="essential-graphics-panel">
                <div className="text-[10px] text-ink-3 uppercase tracking-widest font-bold">Essential Graphics</div>
                <label className="grid gap-1 text-[11px] text-ink-3">
                  Text
                  <input
                    data-testid="title-text"
                    value={titleProps.text ?? ''}
                    disabled={titleDisabled}
                    onChange={(e) => onTitlePropsChange?.({ text: e.target.value })}
                    className="rounded-md bg-bg-1 border border-border-1 px-2 py-1.5 text-[12px] text-ink-1 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="grid gap-1 text-[11px] text-ink-3">
                    Font
                    <select
                      data-testid="title-font-family"
                      value={titleProps.fontFamily ?? 'Inter'}
                      disabled={titleDisabled}
                      onChange={(e) => onTitlePropsChange?.({ fontFamily: e.target.value })}
                      className="rounded-md bg-bg-1 border border-border-1 px-2 py-1.5 text-[12px] text-ink-1 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {['Inter', 'Arial', 'Georgia', 'Times New Roman', 'Courier New'].map((font) => (
                        <option key={font} value={font}>{font}</option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1 text-[11px] text-ink-3">
                    Align
                    <select
                      data-testid="title-align"
                      value={titleProps.align ?? 'center'}
                      disabled={titleDisabled}
                      onChange={(e) => onTitlePropsChange?.({ align: e.target.value as TitleProps['align'] })}
                      className="rounded-md bg-bg-1 border border-border-1 px-2 py-1.5 text-[12px] text-ink-1 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <option value="left">Left</option>
                      <option value="center">Center</option>
                      <option value="right">Right</option>
                    </select>
                  </label>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <label className="grid gap-1 text-[11px] text-ink-3">
                    Size
                    <input
                      data-testid="title-font-size"
                      type="number"
                      min={8}
                      max={240}
                      value={Number(titleProps.fontSize ?? 44)}
                      disabled={titleDisabled}
                      onChange={(e) => onTitlePropsChange?.({ fontSize: Number(e.target.value) })}
                      className="rounded-md bg-bg-1 border border-border-1 px-2 py-1.5 text-[12px] text-ink-1 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </label>
                  <label className="grid gap-1 text-[11px] text-ink-3">
                    Text color
                    <input
                      data-testid="title-color"
                      type="color"
                      value={titleProps.color ?? '#ffffff'}
                      disabled={titleDisabled}
                      onChange={(e) => onTitlePropsChange?.({ color: e.target.value })}
                      className="h-9 rounded-md bg-bg-1 border border-border-1 px-1 py-1 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </label>
                  <label className="grid gap-1 text-[11px] text-ink-3">
                    Stroke
                    <input
                      data-testid="title-stroke-width"
                      type="number"
                      min={0}
                      max={12}
                      value={Number(titleProps.strokeWidth ?? 0)}
                      disabled={titleDisabled}
                      onChange={(e) => onTitlePropsChange?.({ strokeWidth: Number(e.target.value) })}
                      className="rounded-md bg-bg-1 border border-border-1 px-2 py-1.5 text-[12px] text-ink-1 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="grid gap-1 text-[11px] text-ink-3">
                    Background
                    <input
                      data-testid="title-background-color"
                      type="color"
                      value={titleProps.backgroundColor || '#000000'}
                      disabled={titleDisabled}
                      onChange={(e) => onTitlePropsChange?.({ backgroundColor: e.target.value })}
                      className="h-9 rounded-md bg-bg-1 border border-border-1 px-1 py-1 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </label>
                  <label className="grid gap-1 text-[11px] text-ink-3">
                    Stroke color
                    <input
                      data-testid="title-stroke-color"
                      type="color"
                      value={titleProps.strokeColor || '#000000'}
                      disabled={titleDisabled}
                      onChange={(e) => onTitlePropsChange?.({ strokeColor: e.target.value })}
                      className="h-9 rounded-md bg-bg-1 border border-border-1 px-1 py-1 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </label>
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-border-1 bg-bg-2 p-3 text-[12px] text-ink-3">
                Select a text title to edit Essential Graphics properties.
              </div>
            )}
            <div className="text-[10px] text-ink-3 uppercase tracking-widest font-bold">Effects</div>
            {!clip ? (
              <div className="text-[12px] text-ink-3">Select a clip to manage effects</div>
            ) : (
              <>
                <div data-testid="clip-effects" className="space-y-1">
                  {effects.length === 0 && <div className="text-[12px] text-ink-3">No effects on this clip</div>}
                  {effects.map((effect, index) => (
                    <div
                      key={`${String(effect.id ?? effect.type ?? index)}-${index}`}
                      data-testid="clip-effect"
                      className="rounded-md bg-bg-2 px-2 py-1.5 text-[12px] text-ink-2"
                    >
                      #{index + 1} {String(effect.type ?? effect.name ?? effect.id ?? 'effect')}
                    </div>
                  ))}
                </div>
                <div className="grid gap-2">
                  <label className="text-[11px] text-ink-3">Effect type</label>
                  <select
                    data-testid="effect-kind"
                    value={effectKind}
                    onChange={(e) => setEffectKind(e.target.value)}
                    className="rounded-md bg-bg-2 border border-border-1 px-2 py-1.5 text-[12px] text-ink-1"
                  >
                    {effectPresets.map((preset) => (
                      <option key={preset.id} value={preset.id}>{preset.label}</option>
                    ))}
                  </select>
                  <button
                    data-testid="add-effect"
                    onClick={() => {
                      const preset = effectPresets.find((item) => item.id === effectKind);
                      onAddEffect?.({
                        id: `fx_${effectKind}_${Date.now().toString(36)}`,
                        type: effectKind,
                        name: preset?.label ?? effectKind,
                        params: {},
                      });
                    }}
                    className="rounded-md bg-accent px-2 py-1.5 text-[12px] font-semibold text-white hover:bg-accent/90"
                  >
                    Add effect
                  </button>
                  {effects.length > 0 && (
                    <>
                      <label className="text-[11px] text-ink-3">Set existing effect</label>
                      <select
                        value={effectIndex}
                        onChange={(e) => setEffectIndex(Number(e.target.value))}
                        className="rounded-md bg-bg-2 border border-border-1 px-2 py-1.5 text-[12px] text-ink-1"
                      >
                        {effects.map((effect, index) => (
                          <option key={`${String(effect.id ?? effect.type ?? index)}-${index}`} value={index}>
                            #{index + 1} {String(effect.type ?? effect.name ?? effect.id ?? 'effect')}
                          </option>
                        ))}
                      </select>
                      <button
                        data-testid="set-effect"
                        onClick={() => {
                          const preset = effectPresets.find((item) => item.id === effectKind);
                          const existing = effects[effectIndex] ?? {};
                          onSetEffect?.({
                            id: existing.id ?? `fx_${effectKind}_${Date.now().toString(36)}`,
                            type: effectKind,
                            name: preset?.label ?? effectKind,
                            params: existing.params ?? {},
                          });
                        }}
                        className="rounded-md bg-bg-2 border border-border-1 px-2 py-1.5 text-[12px] font-semibold text-ink-1 hover:bg-bg-3"
                      >
                        Set effect
                      </button>
                    </>
                  )}
                </div>
                <div className="border-t border-border-1 mt-3 pt-3" data-testid="effect-keyframes">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="text-[10px] text-ink-3 uppercase tracking-widest font-bold">Keyframes at playhead</div>
                    <div className="text-[10px] text-ink-4">{formatSeconds(currentTime)}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    {(['x', 'y', 'scale', 'opacity', 'rotation'] as const).map((param) => {
                      const baseValue = Number(clip?.transform?.[param] ?? (param === 'scale' ? 1 : param === 'opacity' ? 1 : 0));
                      const value = transformValue(param, baseValue);
                      const keys = clip?.keyframes?.transform?.[param] ?? [];
                      return (
                        <div key={param} className="rounded-md bg-bg-2 p-2 text-[11px] text-ink-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="uppercase tracking-wider">{param}</span>
                            <span className="font-mono">{keyframeValueLabel(value)}</span>
                          </div>
                          <div className="flex gap-1 mt-2">
                            <button
                              data-testid={`add-${param}-keyframe`}
                              disabled={!clipId}
                              onClick={() => onSetKeyframe?.('transform', param, { time: currentTime, value, interp: 'linear' })}
                              className="flex-1 rounded bg-bg-3 px-2 py-1 text-[10px] text-ink-2 hover:bg-bg-2 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Add
                            </button>
                            <button
                              data-testid={`remove-${param}-keyframe`}
                              disabled={!clipId}
                              onClick={() => onRemoveKeyframe?.('transform', param, currentTime)}
                              className="flex-1 rounded bg-bg-3 px-2 py-1 text-[10px] text-ink-2 hover:bg-bg-2 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Remove
                            </button>
                          </div>
                          <div className="text-[10px] text-ink-4 mt-1">{keys.length ? `${keys.length} keyframe${keys.length === 1 ? '' : 's'}` : 'No keyframes'}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                {effects.length > 0 && (
                  <div className="border-t border-border-1 mt-3 pt-3" data-testid="effect-parameters">
                    <div className="text-[10px] text-ink-3 uppercase tracking-widest font-bold mb-2">Effect parameters</div>
                    <div className="grid grid-cols-2 gap-2">
                      {effects.map((effect) => {
                        const params = (effect.params ?? {}) as Record<string, unknown>;
                        const effectId = String(effect.id ?? effect.type ?? 'effect');
                        return Object.keys(params).map((param) => {
                          const value = Number(params[param] ?? 0);
                          const keys = clip?.keyframes?.effects?.[effectId]?.[param] ?? [];
                          return (
                            <div key={`${effectId}-${param}`} className="rounded-md bg-bg-2 p-2 text-[11px] text-ink-2">
                              <div className="flex items-center justify-between gap-2">
                                <span className="uppercase tracking-wider">{param}</span>
                                <span className="font-mono">{keyframeValueLabel(value)}</span>
                              </div>
                              <div className="flex gap-1 mt-2">
                                <button
                                  data-testid={`add-${param}-keyframe`}
                                  disabled={!clipId}
                                  onClick={() => onSetKeyframe?.(effectId, param, { time: currentTime, value, interp: 'linear' })}
                                  className="flex-1 rounded bg-bg-3 px-2 py-1 text-[10px] text-ink-2 hover:bg-bg-2 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  Add
                                </button>
                                <button
                                  data-testid={`remove-${param}-keyframe`}
                                  disabled={!clipId}
                                  onClick={() => onRemoveKeyframe?.(effectId, param, currentTime)}
                                  className="flex-1 rounded bg-bg-3 px-2 py-1 text-[10px] text-ink-2 hover:bg-bg-2 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  Remove
                                </button>
                              </div>
                              <div className="text-[10px] text-ink-4 mt-1">{keys.length ? `${keys.length} keyframe${keys.length === 1 ? '' : 's'}` : 'No keyframes'}</div>
                            </div>
                          );
                        });
                      })}
                    </div>
                  </div>
                )}
                <div className="border-t border-border-1 mt-3 pt-3">
                  <div className="text-[10px] text-ink-3 uppercase tracking-widest font-bold mb-2">Transform at playhead</div>
                  <ParamSlider
                    label="Rotation"
                    value={Math.round(transformRotation)}
                    min={-180}
                    max={180}
                    display={`${Math.round(transformRotation)}°`}
                    disabled={transformDisabled}
                    testId="inspector-transform-rotation"
                    onChange={(rotation) => onTransformChange?.({ rotation })}
                  />
                </div>
              </>
            )}
          </div>
        ) : tab === 'color' ? (
          <div className="space-y-3">
            {!visualClip ? (
              <div className="rounded-md border border-border-1 bg-bg-2 p-3 text-[12px] text-ink-3">
                Lumetri is available for video/image clips only.
              </div>
            ) : (
              <>
                <div className="rounded-md border border-border-1 bg-bg-2 p-3 space-y-3" data-testid="lumetri-panel">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[10px] text-ink-3 uppercase tracking-widest font-bold">Lumetri Color</div>
                      <div className="text-[11px] text-ink-4">op-contract Basic / Creative / Curves / Wheels</div>
                    </div>
                    <span className="rounded bg-bg-3 px-2 py-1 text-[10px] text-ink-3 font-mono">approx preview</span>
                  </div>
                  <div className="rounded border border-border-1 bg-bg-1 p-2">
                    <div className="text-[10px] text-ink-3 uppercase tracking-widest font-bold mb-2">Basic Correction</div>
                    <div className="grid grid-cols-2 gap-2">
                      {([
                        ['temperature', -100, 100],
                        ['tint', -100, 100],
                        ['exposure', -5, 5, 0.1],
                        ['contrast', -100, 100],
                        ['highlights', -100, 100],
                        ['shadows', -100, 100],
                        ['whites', -100, 100],
                        ['blacks', -100, 100],
                        ['saturation', 0, 200],
                        ['vibrance', -100, 100],
                      ] as const).map(([param, min, max, step = 1]) => {
                        const value = Number(colorBasic[param as keyof typeof colorBasic] ?? 0);
                        return (
                          <div key={param} className="rounded bg-bg-2 p-2 space-y-1">
                            <ParamSlider
                              label={param}
                              value={value}
                              min={min}
                              max={max}
                              step={step}
                              disabled={!clipId}
                              onChange={(next) => onClipColorChange?.({ basic: { ...colorBasic, [param]: next } } as Partial<ColorGrade>)}
                            />
                            <div className="flex gap-1">
                              <button
                                data-testid={`add-color-${param}-keyframe`}
                                disabled={!clipId || !onSetKeyframe}
                                onClick={() => onSetKeyframe?.('color', param, { time: currentTime, value, interp: 'linear' })}
                                className="flex-1 rounded bg-bg-3 px-2 py-1 text-[10px] text-ink-2 hover:bg-bg-2 disabled:cursor-not-allowed disabled:opacity-50"
                              >Add keyframe</button>
                              <button
                                data-testid={`remove-color-${param}-keyframe`}
                                disabled={!clipId || !onRemoveKeyframe}
                                onClick={() => onRemoveKeyframe?.('color', param, currentTime)}
                                className="flex-1 rounded bg-bg-3 px-2 py-1 text-[10px] text-ink-2 hover:bg-bg-2 disabled:cursor-not-allowed disabled:opacity-50"
                              >Remove</button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="rounded border border-border-1 bg-bg-1 p-2">
                    <div className="text-[10px] text-ink-3 uppercase tracking-widest font-bold mb-2">Creative / LUT slot</div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="grid gap-1 text-[11px] text-ink-3">
                        LUT id
                        <input
                          data-testid="color-lut-id"
                          value={color?.creative?.lut?.id ?? ''}
                          disabled={!clipId}
                          onChange={(e) => onClipColorChange?.({ creative: { ...color?.creative, lut: { ...(color?.creative?.lut ?? {}), id: e.target.value, name: color?.creative?.lut?.name ?? '', intensity: color?.creative?.lut?.intensity ?? 0 } } } as Partial<ColorGrade>)}
                          className="rounded-md bg-bg-2 border border-border-1 px-2 py-1.5 text-[12px] text-ink-1 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                      </label>
                      <label className="grid gap-1 text-[11px] text-ink-3">
                        LUT name
                        <input
                          data-testid="color-lut-name"
                          value={color?.creative?.lut?.name ?? ''}
                          disabled={!clipId}
                          onChange={(e) => onClipColorChange?.({ creative: { ...color?.creative, lut: { ...(color?.creative?.lut ?? {}), id: color?.creative?.lut?.id ?? '', name: e.target.value, intensity: color?.creative?.lut?.intensity ?? 0 } } } as Partial<ColorGrade>)}
                          className="rounded-md bg-bg-2 border border-border-1 px-2 py-1.5 text-[12px] text-ink-1 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                      </label>
                      <ParamSlider label="LUT intensity" value={Number(color?.creative?.lut?.intensity ?? 0)} min={0} max={100} onChange={(next) => onClipColorChange?.({ creative: { ...color?.creative, lut: { ...(color?.creative?.lut ?? {}), id: color?.creative?.lut?.id ?? '', name: color?.creative?.lut?.name ?? '', intensity: next } } } as Partial<ColorGrade>)} />
                      <ParamSlider label="Faded" value={Number(color?.creative?.faded ?? 0)} min={0} max={100} onChange={(next) => onClipColorChange?.({ creative: { ...color?.creative, faded: next } } as Partial<ColorGrade>)} />
                      <ParamSlider label="Sharpen" value={Number(color?.creative?.sharpen ?? 0)} min={-100} max={100} onChange={(next) => onClipColorChange?.({ creative: { ...color?.creative, sharpen: next } } as Partial<ColorGrade>)} />
                    </div>
                  </div>
                  <div className="rounded border border-border-1 bg-bg-1 p-2">
                    <div className="text-[10px] text-ink-3 uppercase tracking-widest font-bold mb-2">Curves</div>
                    <div className="text-[12px] text-ink-3">Curve points are stored as op data: master/r/g/b arrays of {`{x, y}`} in 0..1. Real pixel pipeline is not enabled.</div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {(['master', 'r', 'g', 'b'] as const).map((channel) => (
                        <div key={channel} className="rounded bg-bg-2 p-2 text-[11px] text-ink-3">
                          <div className="font-mono mb-1">{channel}</div>
                          {color?.curves?.[channel]?.map((point, index) => (
                            <div key={`${channel}-${index}`} className="font-mono text-[10px]">{point.x.toFixed(2)}, {point.y.toFixed(2)}</div>
                          )) ?? <div>No points</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded border border-border-1 bg-bg-1 p-2">
                    <div className="text-[10px] text-ink-3 uppercase tracking-widest font-bold mb-2">Color Wheels</div>
                    <div className="grid grid-cols-3 gap-2">
                      {(['shadows', 'midtones', 'highlights'] as const).map((wheel) => (
                        <div key={wheel} className="rounded bg-bg-2 p-2 text-[11px] text-ink-3">
                          <div className="uppercase tracking-wider mb-1">{wheel}</div>
                          {(['r', 'g', 'b'] as const).map((channel) => (
                            <ParamSlider
                              key={`${wheel}-${channel}`}
                              label={channel}
                              value={Number(color?.wheels?.[wheel]?.[channel] ?? 0)}
                              min={-1}
                              max={1}
                              step={0.01}
                              disabled={!clipId}
                              onChange={(next) => onClipColorChange?.({ wheels: { ...color?.wheels, [wheel]: { ...(color?.wheels?.[wheel] ?? {}), [channel]: next } } } as Partial<ColorGrade>)}
                            />
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded border border-border-1 bg-bg-1 p-2 text-[11px] text-ink-3">
                    <div className="font-bold mb-1">Scopes</div>
                    <div className="flex gap-2 mb-2">
                      <span className="rounded bg-bg-3 px-2 py-1">histogram simulated</span>
                      <span className="rounded bg-bg-3 px-2 py-1">waveform simulated</span>
                      <span className="rounded bg-bg-3 px-2 py-1">vectorscope simulated</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                        <div key={`hist-${i}`} className="h-10 rounded bg-bg-3 flex items-end justify-center">
                          <div className="w-5 bg-accent/70 rounded-t" style={{ height: `${20 + ((colorBasic.saturation + i * 13) % 70)}%` }} />
                        </div>
                      ))}
                    </div>
                    <div className="text-[10px] mt-2 font-mono">simulated_scopes:true · real_pixel_analysis:false · real_lut_apply:false</div>
                  </div>
                </div>
              </>
            )}
          </div>
        ) : tab === 'audio' ? (
          <div className="space-y-3">
            <div className="rounded-md border border-border-1 bg-bg-2 p-3 space-y-3">
              <div className="text-[10px] text-ink-3 uppercase tracking-widest font-bold">Audio mixer</div>
              <ParamSlider
                label="Track gain"
                value={Math.round(trackAudio?.gainDb ?? 0)}
                min={-60}
                max={12}
                display={`${Math.round(trackAudio?.gainDb ?? 0)} dB`}
                disabled={!clipId}
                testId="inspector-track-gain"
                onChange={(gainDb) => onTrackAudioChange?.({ gainDb })}
              />
              <ParamSlider
                label="Track pan"
                value={trackAudio?.pan ?? 0}
                min={-1}
                max={1}
                step={0.01}
                display={(trackAudio?.pan ?? 0).toFixed(2)}
                disabled={!clipId}
                testId="inspector-track-pan"
                onChange={(pan) => onTrackAudioChange?.({ pan })}
              />
              <ParamSlider
                label="Clip gain"
                value={Math.round(clipAudio?.gainDb ?? 0)}
                min={-60}
                max={12}
                display={`${Math.round(clipAudio?.gainDb ?? 0)} dB`}
                disabled={!clipId}
                testId="inspector-clip-gain"
                onChange={(gainDb) => onClipAudioChange?.({ gainDb })}
              />
              <ParamSlider
                label="Clip pan"
                value={clipAudio?.pan ?? 0}
                min={-1}
                max={1}
                step={0.01}
                display={(clipAudio?.pan ?? 0).toFixed(2)}
                disabled={!clipId}
                testId="inspector-clip-pan"
                onChange={(pan) => onClipAudioChange?.({ pan })}
              />
              <ParamSlider
                label="Fade in"
                value={clipAudio?.fadeIn ?? 0}
                min={0}
                max={10}
                step={0.1}
                display={`${(clipAudio?.fadeIn ?? 0).toFixed(1)}s`}
                disabled={!clipId}
                testId="inspector-fade-in"
                onChange={(fadeIn) => onClipAudioChange?.({ fadeIn })}
              />
              <ParamSlider
                label="Fade out"
                value={clipAudio?.fadeOut ?? 0}
                min={0}
                max={10}
                step={0.1}
                display={`${(clipAudio?.fadeOut ?? 0).toFixed(1)}s`}
                disabled={!clipId}
                testId="inspector-fade-out"
                onChange={(fadeOut) => onClipAudioChange?.({ fadeOut })}
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-ink-3">Ducking</span>
                <button
                  data-testid="inspector-ducking-toggle"
                  onClick={() => onTrackAudioChange?.({
                    ducking: {
                      enabled: !(ducking?.enabled ?? false),
                      amountDb: ducking?.amountDb ?? -12,
                      thresholdDb: ducking?.thresholdDb ?? -30,
                      attackSec: ducking?.attackSec ?? 0.02,
                      releaseSec: ducking?.releaseSec ?? 0.2,
                    },
                  })}
                  className={clsx('rounded px-2 py-1 text-[10px] font-semibold', ducking?.enabled ? 'bg-accent text-white' : 'bg-bg-3 text-ink-2')}
                >
                  {ducking?.enabled ? 'on' : 'off'}
                </button>
              </div>
              <div data-testid="inspector-audio-metadata" className="text-[10px] text-ink-4">
                metadata only · simulated_levels={String(audioMetadata.simulated_levels)} · real_decode={String(audioMetadata.real_decode)}
              </div>
            </div>

            <div className="rounded-md border border-border-1 bg-bg-2 p-3 space-y-2">
              <div className="text-[10px] text-ink-3 uppercase tracking-widest font-bold">Volume keyframes</div>
              <div className="rounded bg-bg-1 p-2 text-[11px] text-ink-2">
                {clip?.keyframes?.effects?.audio?.gain?.length ? (
                  <ul className="space-y-1" data-testid="inspector-volume-keyframes">
                    {clip.keyframes.effects.audio.gain.map((keyframe, index) => (
                      <li key={`${keyframe.time}-${index}`} className="flex items-center justify-between">
                        <span>{formatSeconds(keyframe.time)}</span><span>{keyframeValueLabel(keyframe.value)} dB</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div data-testid="inspector-no-volume-keyframes">No volume keyframes</div>
                )}
              </div>
              <button
                data-testid="inspector-add-volume-keyframe"
                disabled={!clipId}
                onClick={() => onSetKeyframe?.('audio', 'gain', { time: currentTime, value: clipAudio?.gainDb ?? 0, interp: 'linear' })}
                className="w-full rounded bg-bg-3 px-2 py-1.5 text-[10px] text-ink-2 hover:bg-bg-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Add gain keyframe at playhead
              </button>
            </div>

            <div className="rounded-md border border-border-1 bg-bg-2 p-3 space-y-2">
              <div className="text-[10px] text-ink-3 uppercase tracking-widest font-bold">Meters / waveform</div>
              <div className="h-12 rounded bg-bg-1 p-1" data-testid="inspector-meters">
                {meters.length ? meters.map((meter, index) => (
                  <div
                    key={`${meter.time}-${index}`}
                    className="inline-block w-2 bg-accent/70"
                    style={{ height: `${Math.max(4, Math.min(100, ((meter.level + 60) / 60) * 100))}%`, marginLeft: index ? '4px' : 0 }}
                  />
                )) : <span className="text-[10px] text-ink-4">metadata only</span>}
              </div>
              <div className="h-12 rounded bg-bg-1 p-1 flex items-end gap-px" data-testid="inspector-waveform">
                {waveform.length ? waveform.map((sample, index) => (
                  <div key={index} className="w-1 bg-ink-3/50" style={{ height: `${Math.max(4, Math.min(100, Math.abs(sample) * 100))}%` }} />
                )) : <span className="text-[10px] text-ink-4">metadata only</span>}
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="text-[10px] text-ink-3 uppercase tracking-widest font-bold mb-2">Clip properties</div>
            <Property label="Track">
              <span data-testid="inspector-track">{track?.name ?? clip?.track_id ?? '—'}</span>
            </Property>
            <Property label="Asset">
              <span data-testid="inspector-asset">{clip?.source_file || '—'}</span>
            </Property>
            <Property label="Source">
              <span data-testid="inspector-source">{source}</span>
            </Property>
            <Property label="Timeline">
              <span data-testid="inspector-start-end">{clip ? `${formatSeconds(clip.start_sec)} — ${formatSeconds(clip.start_sec + clip.duration_sec)}` : '—'}</span>
            </Property>
            <Property label="Transform">
              <span data-testid="inspector-transform">x={transformX}, y={transformY}, scale={transformScale}, rotation={Math.round(transformRotation)}</span>
            </Property>
            <Property label="Media mode">
              <span data-testid="inspector-media-mode">{clip && hasRealMediaPath(clip) ? 'real media' : 'placeholder card'}</span>
            </Property>

            <div className="text-[10px] text-ink-3 uppercase tracking-widest font-bold mt-3 mb-2">Transform</div>
            <ParamSlider
              label="X"
              value={transformX}
              min={-2000}
              max={2000}
              display={String(transformX)}
              disabled={transformDisabled}
              testId="inspector-transform-x"
              onChange={(x) => onTransformChange?.({ x })}
            />
            <ParamSlider
              label="Y"
              value={transformY}
              min={-1200}
              max={1200}
              display={String(transformY)}
              disabled={transformDisabled}
              testId="inspector-transform-y"
              onChange={(y) => onTransformChange?.({ y })}
            />
            <ParamSlider
              label="Scale"
              value={Math.round(transformScale * 100)}
              min={0}
              max={300}
              display={`${Math.round(transformScale * 100)}%`}
              disabled={transformDisabled}
              testId="inspector-transform-scale"
              onChange={(scalePct) => onTransformChange?.({ scale: scalePct / 100 })}
            />
            <ParamSlider
              label="Opacity"
              value={Math.round(transformOpacity * 100)}
              min={0}
              max={100}
              display={`${Math.round(transformOpacity * 100)}%`}
              disabled={transformDisabled}
              testId="inspector-transform-opacity"
              onChange={(opacityPct) => onTransformChange?.({ opacity: opacityPct / 100 })}
            />

            <div className="border-t border-border-1 mt-3 pt-3">
              <div className="text-[10px] text-ink-3 uppercase tracking-widest font-bold mb-2">Audio</div>
              <ParamSlider
                label="Volume"
                value={Math.round(volume * 100)}
                min={0}
                max={100}
                display={`${Math.round(volume * 100)}%`}
                disabled={volumeDisabled}
                testId="inspector-volume"
                onChange={(volumePct) => onVolumeChange?.(volumePct / 100)}
              />
              <ParamSlider label="Voice EQ" value={50} min={0} max={100} display="flat" disabled />
            </div>
          </>
        )}

        {/* Day 26 / Phase 0: Quick actions used to live in a
            separate flex sibling column with a border-l, which
            in a narrow resizable Inspector panel overflowed the
            panel and visually crashed into the monitor. The
            whole inspector is now a single vertical scroll
            region; Quick actions is a collapsible section at
            the very bottom, strictly inside the panel width. */}
        <div
          className="border-t border-border-1 px-3 py-2 bg-bg-0 flex-shrink-0"
          data-testid="inspector-quick-actions"
        >
          <button
            type="button"
            data-testid="inspector-quick-actions-toggle"
            onClick={() => setQaOpen((v) => !v)}
            className="w-full flex items-center justify-between text-[10px] text-ink-3 uppercase tracking-widest font-bold mb-1"
          >
            <span>Quick actions</span>
            <span className="text-ink-4 normal-case tracking-normal">
              {qaOpen ? '▾' : '▸'}
            </span>
          </button>
          {qaOpen && (
            <div className="flex flex-col gap-1">
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
          )}
        </div>
      </div>
    </section>
  );
}
