// Domain types for Vireo Studio frontend.

export type TrackKind = 'video' | 'audio' | 'overlay';

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
  thumbnail_color?: string;
  label?: string;
  selected?: boolean;
  kind: TrackKind;
}

export type ProjectState = {
  name: string;
  duration_sec: number;
  fps: number;
  width: number;
  height: number;
  tracks: Track[];
  markers?: Marker[];
};

export interface Marker {
  id: string;
  time_sec: number;
  label: string;
  color: string;
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
