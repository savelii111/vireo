export function snapTime(candidateTime: number, anchors?: number[], thresholdPx?: number, pxPerSec?: number): number;
export function clipsOverlap(a: unknown, b: unknown): boolean;
export type KeyframeInterpolation = 'linear' | 'hold';
export interface Keyframe {
  time: number;
  value: number;
  interp?: KeyframeInterpolation;
}
export function normalizeKeyframe(value: Partial<Keyframe> & Record<string, unknown>): Keyframe;
export function normalizeKeyframes(value: unknown): Keyframe[];
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
