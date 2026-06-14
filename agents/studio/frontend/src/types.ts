// Domain types for Vireo Studio frontend.

export type TrackKind = 'video' | 'audio' | 'overlay';
export type TimelineTrackKind = 'video' | 'audio' | 'text' | 'overlay';
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
  | 'replaceAsset'
  | 'setTrackFlag'
  | 'duplicateClip';

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
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
  text?: string;
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
  transform?: Record<string, unknown>;
  effects?: Array<Record<string, unknown>>;
  source: TimelineClipSource;
  name?: string;
  text?: string;
  selected?: boolean;
  locked?: boolean;
  muted?: boolean;
}

export interface TimelineTrack {
  id: string;
  kind: TimelineTrackKind;
  name: string;
  muted: boolean;
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
