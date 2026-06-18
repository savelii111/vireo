export function snapTime(candidateTime: number, anchors?: number[], thresholdPx?: number, pxPerSec?: number): number;
export function clipsOverlap(a: unknown, b: unknown): boolean;
export type TrackRole = 'voice' | 'music' | 'sfx' | 'ambience' | 'other';
export interface AudioDucking {
  enabled: boolean;
  amountDb: number;
  thresholdDb: number;
  attackSec: number;
  releaseSec: number;
}
export interface AudioMetadata {
  simulated_levels: true;
  real_decode: false;
}
export interface AudioTrack {
  role?: TrackRole;
  gainDb: number;
  pan: number;
  fadeIn: number;
  fadeOut: number;
  crossfade: number;
  ducking: AudioDucking;
  metadata: AudioMetadata;
}
export interface AudioMeter {
  time: number;
  level: number;
  peak: number;
}
export interface AudioClip {
  gainDb: number;
  pan: number;
  fadeIn: number;
  fadeOut: number;
  crossfade: number;
  meters: AudioMeter[];
  waveform: number[];
  metadata: AudioMetadata;
}
export function normalizeTrackRole(value: unknown): TrackRole;
export function normalizeAudioTrack(value: unknown): AudioTrack;
export function normalizeAudioClip(value: unknown): AudioClip;
export interface ColorLut {
  id: string;
  name: string;
  intensity: number;
}
export interface ColorCreative {
  lut: ColorLut;
  faded: number;
  sharpen: number;
  tintShadows: string | null;
  tintHighlights: string | null;
}
export interface ColorPoint {
  x: number;
  y: number;
}
export interface ColorCurves {
  master: ColorPoint[];
  r: ColorPoint[];
  g: ColorPoint[];
  b: ColorPoint[];
}
export interface ColorWheelChannel {
  r: number;
  g: number;
  b: number;
}
export interface ColorWheels {
  shadows: ColorWheelChannel;
  midtones: ColorWheelChannel;
  highlights: ColorWheelChannel;
}
export interface ColorMetadata {
  simulated_scopes: true;
  real_pixel_analysis: false;
  real_lut_apply: false;
}
export interface ExportPreset {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: 24 | 25 | 30 | 50 | 60;
  videoCodec: 'h264';
  audioCodec: 'aac';
  videoBitrateKbps: number;
  audioBitrateKbps: number;
  container: 'mp4';
}
export interface ExportRenderPlanItem {
  trackId: string;
  clipId: string;
  kind: string;
  start: number;
  end: number;
  sourceIn: number;
  sourceOut: number;
  color: ColorGrade | null;
  audioGainDb: number;
  audioDuckingDb: number;
  audioGainKeyframes: Array<{ time: number; value: number; duckingDb: number }>;
  transitions: Array<{ id?: string; kind?: string; fromClipId?: string; toClipId?: string; duration?: number }>;
}
export type ExportRenderPlan = ExportRenderPlanItem[] & { metadata: { simulated_media: true; real_encode: false } };
export interface ExportJob {
  id: string;
  projectId: string;
  presetId: string;
  baseVersion: number;
  actor: 'human' | 'bot';
  state: 'queued' | 'running' | 'done' | 'failed' | 'canceled';
  progress: number;
  result?: { path?: string; url?: string; metadata?: Record<string, unknown> };
  error?: string;
  createdAt: string;
  updatedAt: string;
}
export const EXPORT_PRESETS: ExportPreset[];
export function normalizeExportPreset(value: unknown): ExportPreset;
export function buildRenderPlan(timeline: unknown, presetId: string): ExportRenderPlan;
export function buildFfmpegArgs(renderPlan: ExportRenderPlan | { clips: ExportRenderPlanItem[]; metadata?: Record<string, unknown> }, preset: ExportPreset | unknown): {
  argv: string[];
  filter_complex: string;
  approximations: string[];
  metadata: { simulated_media: boolean; real_encode: boolean };
};
export function colorGradeToPreviewCss(color: Partial<ColorGrade>): { filter: string; colorBalance: { rs: number; gs: number; bs: number } };
export function colorGradeToFfmpegColorFilters(color: Partial<ColorGrade>): { eq: string; colorbalance: string; approximations: string[] };
export function colorGradeToPixelParityBridge(color: Partial<ColorGrade>): {
  css: { filter: string; colorBalance: { rs: number; gs: number; bs: number } };
  ffmpeg: { eq: string; colorbalance: string; approximations: string[] };
};
export interface ColorGrade {
  basic: {
    temperature: number;
    tint: number;
    exposure: number;
    contrast: number;
    highlights: number;
    shadows: number;
    whites: number;
    blacks: number;
    saturation: number;
    vibrance: number;
  };
  creative: ColorCreative;
  curves: ColorCurves;
  wheels: ColorWheels;
  metadata: ColorMetadata;
}
export function normalizeColorGrade(value: unknown): ColorGrade;
export function computeClipColorAt(timeline: unknown, clip: unknown, t: number): ColorGrade;
export function computeSimulatedColorScopes(timeline: unknown, clip: unknown, t: number): {
  histogram: number[];
  waveform: number[];
  vectorscope: Array<{ x: number; y: number }>;
  metadata: { simulated_scopes: true; real_pixel_analysis: false; approx_preview: true };
};
export function computeDuckingReductionDb(timeline: unknown, trackId: string, t: number): number;
export function computeClipGainDb(timeline: unknown, clip: unknown, t: number): number;
export type KeyframeInterpolation = 'linear' | 'hold';
export type TitleAlign = 'left' | 'center' | 'right';
export interface TitleProps {
  text: string;
  fontFamily: string;
  fontSize: number;
  color: string;
  align: TitleAlign;
  backgroundColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
}
export interface TimelineOps {
  readonly INSERT_CLIP: 'insertClip';
  readonly TRIM_CLIP: 'trimClip';
  readonly SPLIT_CLIP: 'splitClip';
  readonly MOVE_CLIP: 'moveClip';
  readonly DELETE_CLIP: 'deleteClip';
  readonly GROUP_CLIPS: 'groupClips';
  readonly ADD_TRANSITION: 'addTransition';
  readonly ADD_EFFECT: 'addEffect';
  readonly ADD_TEXT: 'addText';
  readonly SET_EFFECT: 'setEffect';
  readonly SET_TITLE_PROPS: 'setTitleProps';
  readonly SET_TRACK_AUDIO: 'setTrackAudio';
  readonly SET_CLIP_AUDIO: 'setClipAudio';
  readonly SET_CLIP_COLOR: 'setClipColor';
  readonly SET_TRANSFORM: 'setTransform';
  readonly SET_KEYFRAME: 'setKeyframe';
  readonly REMOVE_KEYFRAME: 'removeKeyframe';
  readonly SET_VOLUME: 'setVolume';
  readonly REPLACE_ASSET: 'replaceAsset';
  readonly SET_TRACK_FLAG: 'setTrackFlag';
}
export const TIMELINE_OPS: TimelineOps;
export interface Keyframe {
  time: number;
  value: number;
  interp?: KeyframeInterpolation;
}
export function normalizeKeyframe(value: Partial<Keyframe> & Record<string, unknown>): Keyframe;
export function normalizeKeyframes(value: unknown): Keyframe[];
export function normalizeTitleProps(value: unknown): TitleProps;
export function evalParamAtTime(keyframes: unknown, t: number, defaultValue?: number): number;
export function clampTrimRange(options: {
  track: { clips: Array<{ id: string; start?: number; end?: number; start_sec?: number; end_sec?: number }> };
  clip: { id: string; start?: number; end?: number; start_sec?: number; end_sec?: number };
  index?: number;
  start?: number;
  end?: number;
  originalStart?: number;
  originalEnd?: number;
  publicOp?: boolean;
}): { start: number; end: number };
export function clampMoveStart(options: {
  track: { clips: Array<{ id: string; start?: number; end?: number; start_sec?: number; end_sec?: number }> };
  clip: { id: string; start?: number; end?: number; start_sec?: number; end_sec?: number };
  start?: number;
  targetIndex?: number;
  publicOp?: boolean;
}): number;
