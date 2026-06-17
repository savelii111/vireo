export function snapTime(candidateTime: number, anchors?: number[], thresholdPx?: number, pxPerSec?: number): number;
export function clipsOverlap(a: unknown, b: unknown): boolean;
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
