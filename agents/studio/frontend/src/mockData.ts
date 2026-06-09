// Mock data — initial project state. In production this comes from
// GET /api/project/:id or local store. We keep it small + realistic
// so the UI is testable without a backend round-trip.

import type { ProjectState, ChatMessage } from './types';

export const initialProject: ProjectState = {
  name: 'Q3 Travel Vlog',
  duration_sec: 134,
  fps: 30,
  width: 1920,
  height: 1080,
  tracks: [
    // ── Video tracks (V1-V4) ──
    {
      id: 'V1', kind: 'video', name: 'V1 · A-Roll',
      clips: [
        { id: 'c1', track_id: 'V1', source_file: 'intro_wide.mp4',       start_sec: 0,    duration_sec: 17.5, in_sec: 0,  kind: 'video', label: 'intro_wide.mp4',       thumbnail_color: 'linear-gradient(135deg, #6366f1, #4f46e5)' },
        { id: 'c2', track_id: 'V1', source_file: 'drone_shot_sunset.mp4', start_sec: 17.5, duration_sec: 6.3,  in_sec: 8.2, kind: 'video', label: 'drone_shot_sunset.mp4', selected: true, thumbnail_color: 'linear-gradient(135deg, #f59e0b, #ef4444)' },
        { id: 'c3', track_id: 'V1', source_file: 'b_roll_temple.mp4',    start_sec: 23.8, duration_sec: 15,   in_sec: 0,  kind: 'video', label: 'b_roll_temple.mp4',    thumbnail_color: 'linear-gradient(135deg, #10b981, #059669)' },
        { id: 'c4', track_id: 'V1', source_file: 'walking_shot.mp4',     start_sec: 38.8, duration_sec: 22,   in_sec: 0,  kind: 'video', label: 'walking_shot.mp4',     thumbnail_color: 'linear-gradient(135deg, #3b82f6, #2563eb)' },
        { id: 'c5', track_id: 'V1', source_file: 'sunset_hero.mp4',      start_sec: 60.8, duration_sec: 18,   in_sec: 0,  kind: 'video', label: 'sunset_hero.mp4',      thumbnail_color: 'linear-gradient(135deg, #a855f7, #7c3aed)' },
        { id: 'c6', track_id: 'V1', source_file: 'outro.mp4',            start_sec: 78.8, duration_sec: 12,   in_sec: 0,  kind: 'video', label: 'outro.mp4',            thumbnail_color: 'linear-gradient(135deg, #ef4444, #dc2626)' },
      ],
    },
    {
      id: 'V2', kind: 'video', name: 'V2 · B-Roll', muted: true,
      clips: [
        { id: 'c7',  track_id: 'V2', source_file: 'lower_third.mp4',     start_sec: 22.5, duration_sec: 13.7, in_sec: 0, kind: 'video',    label: 'lower_third.mp4',     thumbnail_color: 'linear-gradient(135deg, #f59e0b, #d97706)' },
        { id: 'c8',  track_id: 'V2', source_file: 'logo_watermark.mp4',  start_sec: 0,    duration_sec: 90,   in_sec: 0, kind: 'overlay', label: 'logo_watermark.mp4',  thumbnail_color: 'linear-gradient(135deg, #f59e0b, #d97706)' },
      ],
    },
    {
      id: 'V3', kind: 'video', name: 'V3 · Titles',
      clips: [
        { id: 'c12', track_id: 'V3', source_file: 'title_card.mp4',      start_sec: 0,    duration_sec: 5,    in_sec: 0, kind: 'overlay', label: 'title_card.mp4',      thumbnail_color: 'linear-gradient(135deg, #ec4899, #db2777)' },
        { id: 'c13', track_id: 'V3', source_file: 'subtitle_track.mp4',  start_sec: 18,   duration_sec: 50,   in_sec: 0, kind: 'overlay', label: 'subtitle_track.mp4',  thumbnail_color: 'linear-gradient(135deg, #8b5cf6, #7c3aed)' },
      ],
    },
    {
      id: 'V4', kind: 'video', name: 'V4 · FX',
      clips: [
        { id: 'c14', track_id: 'V4', source_file: 'transition_pack.mp4', start_sec: 17,   duration_sec: 1,    in_sec: 0, kind: 'overlay', label: 'transition_pack.mp4', thumbnail_color: 'linear-gradient(135deg, #06b6d4, #0891b2)' },
        { id: 'c15', track_id: 'V4', source_file: 'film_grain.mp4',      start_sec: 0,    duration_sec: 90,   in_sec: 0, kind: 'overlay', label: 'film_grain.mp4',      thumbnail_color: 'linear-gradient(135deg, #64748b, #475569)' },
      ],
    },
    // ── Audio tracks (A1-A4) ──
    {
      id: 'A1', kind: 'audio', name: 'A1 · Voice',
      clips: [
        { id: 'c9',  track_id: 'A1', source_file: 'voice_take_03.wav',   start_sec: 0,    duration_sec: 37.5, in_sec: 0, kind: 'audio', label: 'voice_take_03.wav',   thumbnail_color: 'linear-gradient(135deg, #10b981, #059669)' },
        { id: 'c10', track_id: 'A1', source_file: 'voice_take_04.wav',   start_sec: 37.5, duration_sec: 41,   in_sec: 0, kind: 'audio', label: 'voice_take_04.wav',   thumbnail_color: 'linear-gradient(135deg, #10b981, #059669)' },
        { id: 'c11', track_id: 'A1', source_file: 'voice_take_05.wav',   start_sec: 78.5, duration_sec: 12,   in_sec: 0, kind: 'audio', label: 'voice_take_05.wav',   thumbnail_color: 'linear-gradient(135deg, #10b981, #059669)' },
      ],
    },
    {
      id: 'A2', kind: 'audio', name: 'A2 · Music',
      clips: [
        { id: 'c16', track_id: 'A2', source_file: 'background_lofi.mp3', start_sec: 0,    duration_sec: 90,   in_sec: 0, kind: 'audio', label: 'background_lofi.mp3', thumbnail_color: 'linear-gradient(135deg, #f43f5e, #e11d48)' },
        { id: 'c17', track_id: 'A2', source_file: 'outro_music.mp3',     start_sec: 90,   duration_sec: 44,   in_sec: 0, kind: 'audio', label: 'outro_music.mp3',     thumbnail_color: 'linear-gradient(135deg, #f43f5e, #e11d48)' },
      ],
    },
    {
      id: 'A3', kind: 'audio', name: 'A3 · SFX',
      clips: [
        { id: 'c18', track_id: 'A3', source_file: 'whoosh_transition.wav', start_sec: 17,   duration_sec: 1.5, in_sec: 0, kind: 'audio', label: 'whoosh_transition.wav', thumbnail_color: 'linear-gradient(135deg, #eab308, #ca8a04)' },
        { id: 'c19', track_id: 'A3', source_file: 'ambient_nature.wav',    start_sec: 23,   duration_sec: 67,  in_sec: 0, kind: 'audio', label: 'ambient_nature.wav',    thumbnail_color: 'linear-gradient(135deg, #eab308, #ca8a04)' },
      ],
    },
    {
      id: 'A4', kind: 'audio', name: 'A4 · VO',
      clips: [
        { id: 'c20', track_id: 'A4', source_file: 'ai_voiceover.mp3',    start_sec: 5,    duration_sec: 12,   in_sec: 0, kind: 'audio', label: 'ai_voiceover.mp3',    thumbnail_color: 'linear-gradient(135deg, #a78bfa, #7c3aed)' },
      ],
    },
  ],
  markers: [
    { id: 'm1', time_sec: 0,    label: 'Start',      color: '#22c55e' },
    { id: 'm2', time_sec: 17.5, label: 'Transition',  color: '#f59e0b' },
    { id: 'm3', time_sec: 60,   label: 'Climax',      color: '#ef4444' },
    { id: 'm4', time_sec: 120,  label: 'Outro start', color: '#8b5cf6' },
  ],
};

export const initialMessages: ChatMessage[] = [
  {
    id: 'm0',
    role: 'assistant',
    content: "Hi! I'm Vireo AI, your editing assistant. I can see your travel vlog project. What would you like to do?",
    created_at: Date.now() - 60_000,
    suggestions: [
      'make it more cinematic',
      'add a quick fade-in at the start',
      'export to mp4',
      'cut the silences',
      'try a different color preset',
      'add captions',
    ],
  },
];
