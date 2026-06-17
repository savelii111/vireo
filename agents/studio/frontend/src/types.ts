// Domain types for Vireo Studio frontend.

export type TrackKind = 'video' | 'audio' | 'overlay';
export type TimelineTrackKind = 'video' | 'audio' | 'text' | 'overlay';
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
  meters?: AudioMeter[];
  waveform?: number[];
  metadata: AudioMetadata;
}
export type TimelineClipSource = 'upload' | 'higgsfield' | 'higgsfield_simulated' | 'stock' | 'generated' | 'text' | 'placeholder';
export type TimelineOpName =
  | 'insertClip'
  | 'trimClip'
  | 'splitClip'
  | 'moveClip'
  | 'deleteClip'
  | 'groupClips'
  | 'addTransition'
  | 'addEffect'
  | 'addText'
  | 'setEffect'
  | 'setTitleProps'
  | 'setTrackAudio'
  | 'setClipAudio'
  | 'setTransform'
  | 'setKeyframe'
  | 'removeKeyframe'
  | 'setVolume'
  | 'replaceAsset'
  | 'setTrackFlag'
  | 'duplicateClip';

export type ProjectAssetKind = 'video' | 'audio' | 'image';
export type KeyframeInterpolation = 'linear' | 'hold';
export interface Keyframe {
  time: number;
  value: number;
  interp?: KeyframeInterpolation;
}
export interface TitleProps {
  text: string;
  fontFamily: string;
  fontSize: number;
  color: string;
  align: 'left' | 'center' | 'right';
  backgroundColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
}
export interface ClipKeyframes {
  transform?: Record<string, Keyframe[]>;
  effects?: Record<string, Record<string, Keyframe[]>>;
}

export interface ProjectAsset {
  id: string;
  user_id?: string;
  project_id?: string;
  kind: ProjectAssetKind;
  source?: string;
  filename?: string;
  name?: string;
  mime?: string;
  storage_path?: string;
  duration_sec?: number | null;
  width?: number | null;
  height?: number | null;
  size_bytes?: number | null;
  status?: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
}

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  role?: TrackRole;
  audio?: AudioTrack;
  clips: Clip[];
  locked?: boolean;
  muted?: boolean;
  soloed?: boolean;
  hidden?: boolean;
}

export interface Clip {
  id: string;
  track_id: string;
  source_file: string;
  start_sec: number;     // position on timeline
  duration_sec: number;  // length on timeline
  in_sec: number;        // in-point in source
  source?: TimelineClipSource;
  thumbnail_color?: string;
  label?: string;
  selected?: boolean;
  kind: TrackKind;
  effects?: Array<Record<string, unknown>>;
  transform?: Record<string, unknown>;
  keyframes?: ClipKeyframes;
  volume?: number;
  audio?: AudioClip;
  text?: string;
  titleProps?: Partial<TitleProps>;
}

export type ProjectState = {
  name: string;
  duration_sec: number;
  fps: number;
  width: number;
  height: number;
  tracks: Track[];
  markers?: Marker[];
  transitions?: Array<Record<string, unknown>>;
};

export interface Marker {
  id: string;
  time_sec: number;
  label: string;
  color: string;
}

export interface TimelineClip {
  id: string;
  assetId: string;
  start: number;
  end: number;
  in: number;
  out: number;
  volume?: number;
  audio?: AudioClip;
  transform?: Record<string, unknown>;
  effects?: Array<Record<string, unknown>>;
  keyframes?: ClipKeyframes;
  source: TimelineClipSource;
  name?: string;
  text?: string;
  titleProps?: Partial<TitleProps>;
  selected?: boolean;
  locked?: boolean;
  muted?: boolean;
}

export interface TimelineTrack {
  id: string;
  kind: TimelineTrackKind;
  name: string;
  role?: TrackRole;
  audio?: AudioTrack;
  muted: boolean;
  soloed?: boolean;
  locked: boolean;
  hidden?: boolean;
  clips: TimelineClip[];
}

export interface TimelineDocument {
  timelineId: string;
  projectId: string;
  userId?: string;
  fps: number;
  resolution: { w: number; h: number };
  version: number;
  tracks: TimelineTrack[];
  transitions?: Array<Record<string, unknown>>;
  markers?: Marker[];
  createdAt?: string;
  updatedAt?: string;
}

export interface TimelineOp {
  op: TimelineOpName;
  actor: 'human' | 'bot' | 'system';
  timelineId: string;
  clipId?: string;
  trackId?: string;
  payload: Record<string, unknown>;
  createdAt?: string;
}

export type ToolCallStatus = 'pending' | 'running' | 'done' | 'error';

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: ToolCallStatus;
  started_at: number;
  completed_at?: number;
  result?: unknown;
  error?: string;
}

export type MessageRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  created_at: number;
  tool_calls?: ToolCall[];
  suggestions?: string[];
  streaming?: boolean;
}

export type WorkspaceMode = 'edit' | 'review' | 'compare';
export type PreviewTab = 'program' | 'source' | 'reference';
export type Tool = 'select' | 'razor' | 'slip' | 'slide' | 'text';
