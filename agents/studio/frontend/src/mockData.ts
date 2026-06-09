// Mock data — initial project state. In production this comes from
// GET /api/project/:id or local store. We keep it small + realistic
// so the UI is testable without a backend round-trip.

import type { ProjectState, ChatMessage, ToolCall } from './types';

export const initialProject: ProjectState = {
  name: 'Q3 Travel Vlog',
  duration_sec: 134,
  fps: 30,
  width: 1920,
  height: 1080,
  tracks: [
    {
      id: 'V1', kind: 'video', name: 'V1',
      clips: [
        { id: 'c1', track_id: 'V1', source_file: 'intro_wide.mp4', start_sec: 0,   duration_sec: 17.5, in_sec: 0,  kind: 'video',  label: 'intro_wide.mp4', thumbnail_color: 'linear-gradient(135deg, #6366f1, #4f46e5)' },
        { id: 'c2', track_id: 'V1', source_file: 'drone_shot_sunset.mp4', start_sec: 17.5, duration_sec: 6.3, in_sec: 8.2,  kind: 'video', label: 'drone_shot_sunset.mp4', selected: true, thumbnail_color: 'linear-gradient(135deg, #f59e0b, #ef4444)' },
        { id: 'c3', track_id: 'V1', source_file: 'b_roll_temple.mp4', start_sec: 23.8, duration_sec: 15,   in_sec: 0,  kind: 'video',  label: 'b_roll_temple.mp4', thumbnail_color: 'linear-gradient(135deg, #10b981, #059669)' },
        { id: 'c4', track_id: 'V1', source_file: 'walking_shot.mp4',  start_sec: 38.8, duration_sec: 22,  in_sec: 0,  kind: 'video',  label: 'walking_shot.mp4',  thumbnail_color: 'linear-gradient(135deg, #3b82f6, #2563eb)' },
        { id: 'c5', track_id: 'V1', source_file: 'sunset_hero.mp4',    start_sec: 60.8, duration_sec: 18,  in_sec: 0,  kind: 'video',  label: 'sunset_hero.mp4',    thumbnail_color: 'linear-gradient(135deg, #a855f7, #7c3aed)' },
        { id: 'c6', track_id: 'V1', source_file: 'outro.mp4',          start_sec: 78.8, duration_sec: 12,  in_sec: 0,  kind: 'video',  label: 'outro.mp4',          thumbnail_color: 'linear-gradient(135deg, #ef4444, #dc2626)' },
      ],
    },
    {
      id: 'V2', kind: 'video', name: 'V2',
      clips: [
        { id: 'c7', track_id: 'V2', source_file: 'lower_third.mp4', start_sec: 22.5, duration_sec: 13.7, in_sec: 0, kind: 'video', label: 'lower_third.mp4', thumbnail_color: 'linear-gradient(135deg, #f59e0b, #d97706)' },
        { id: 'c8', track_id: 'V2', source_file: 'logo_watermark.mp4', start_sec: 0, duration_sec: 90, in_sec: 0, kind: 'overlay', label: 'logo_watermark.mp4', thumbnail_color: 'linear-gradient(135deg, #f59e0b, #d97706)' },
      ],
    },
    {
      id: 'A1', kind: 'audio', name: 'A1 · Voice',
      clips: [
        { id: 'c9', track_id: 'A1', source_file: 'voice_take_03.wav', start_sec: 0, duration_sec: 37.5, in_sec: 0, kind: 'audio', label: 'voice_take_03.wav', thumbnail_color: 'linear-gradient(135deg, #10b981, #059669)' },
        { id: 'c10', track_id: 'A1', source_file: 'voice_take_04.wav', start_sec: 37.5, duration_sec: 41, in_sec: 0, kind: 'audio', label: 'voice_take_04.wav', thumbnail_color: 'linear-gradient(135deg, #10b981, #059669)' },
        { id: 'c11', track_id: 'A1', source_file: 'voice_take_05.wav', start_sec: 78.5, duration_sec: 12, in_sec: 0, kind: 'audio', label: 'voice_take_05.wav', thumbnail_color: 'linear-gradient(135deg, #10b981, #059669)' },
      ],
    },
    {
      id: 'A2', kind: 'audio', name: 'A2 · Music',
      clips: [
        { id: 'c12', track_id: 'A2', source_file: 'background_music.mp3', start_sec: 0, duration_sec: 55, in_sec: 0, kind: 'audio', label: 'background_music.mp3', thumbnail_color: 'linear-gradient(135deg, #10b981, #059669)' },
        { id: 'c13', track_id: 'A2', source_file: 'chorus_drop.mp3',      start_sec: 55, duration_sec: 35, in_sec: 0, kind: 'audio', label: 'chorus_drop.mp3',      thumbnail_color: 'linear-gradient(135deg, #10b981, #059669)' },
      ],
    },
  ],
};

const toolCall = (id: string, name: string, args: Record<string, unknown>, status: ToolCall['status'], ms?: number): ToolCall => ({
  id, name, args, status,
  started_at: Date.now() - (ms ?? 1000),
  completed_at: status === 'done' ? Date.now() : undefined,
});

export const initialMessages: ChatMessage[] = [
  {
    id: 'm1',
    role: 'user',
    content: 'split the drone shot at 0:23 and add a slow-mo to the second half. Make it cinematic.',
    created_at: Date.now() - 180_000,
  },
  {
    id: 'm2',
    role: 'assistant',
    content: 'On it. I\'ll cut `drone_shot_sunset.mp4` at 0:23, then apply a 0.5× speed ramp with optical flow to the second half. Adding cinematic grade (warm +0.08, contrast +15) so it feels cohesive.',
    created_at: Date.now() - 170_000,
    tool_calls: [
      toolCall('tc1', 'cut_clips', { file_path: 'drone_shot_sunset.mp4', cuts: [11.5, 23.0] }, 'done', 240),
      toolCall('tc2', 'apply_speed_ramp', { preset: [1.0, 0.5], start: 23.0, end: 29.5, optical_flow: true }, 'done', 1400),
      toolCall('tc3', 'apply_color_grade', { preset: 'cinematic', intensity: 0.7 }, 'running'),
    ],
    suggestions: ['undo last 2 steps', 'show me the result', 'make it warmer'],
  },
  {
    id: 'm3',
    role: 'user',
    content: 'now also add captions in tiktok-bold style',
    created_at: Date.now() - 60_000,
  },
  {
    id: 'm4',
    role: 'assistant',
    content: 'Got it. Adding word-level TikTok-style captions. Want me to also bump the voice volume by 20% since music might compete?',
    created_at: Date.now() - 30_000,
    tool_calls: [
      toolCall('tc4', 'add_captions', { style: 'tiktok-bold', word_level: true }, 'done', 480),
    ],
    suggestions: ['yes, do it', 'skip for now', 'try a different caption style'],
  },
  {
    id: 'm5',
    role: 'assistant',
    content: '',
    created_at: Date.now() - 5_000,
    streaming: true,
  },
];
