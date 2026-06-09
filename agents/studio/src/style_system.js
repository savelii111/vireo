// style_system.js — Style DNA system for Vireo Studio (2026-06-09).
//
// Extract, apply, mix, compare video styles.
// Each StyleDNA captures the visual/audio fingerprint of a video.

// ── StyleDNA type (conceptual) ──
// {
//   color: { temperature, contrast, saturation, shadows, highlights, palette },
//   pacing: { avg_clip_duration, cut_frequency, rhythm_pattern },
//   music: { bpm_range, genre, energy_curve, mood_progression },
//   text: { font_family, size_range, position, animation_type, color },
//   transitions: { types: [{name, frequency}], avg_duration },
//   audio: { voice_music_ratio, compression_level, eq_profile }
// }

function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }

// ── extractStyleDNA ──
export function extractStyleDNA(videoPath) {
  // In production: analyzes frames + audio. Here we return a
  // deterministic DNA based on the path hash (for testing).
  const seed = hashString(videoPath || 'default');
  return {
    color: {
      temperature: 5000 + (seed % 3000),
      contrast: 0.8 + (seed % 40) / 100,
      saturation: 0.9 + (seed % 30) / 100,
      shadows: 0.1 + (seed % 20) / 100,
      highlights: 0.85 + (seed % 15) / 100,
      palette: ['#6366f1', '#f59e0b', '#10b981'].slice(0, 2 + (seed % 2)),
    },
    pacing: {
      avg_clip_duration: 1.5 + (seed % 60) / 10,
      cut_frequency: 0.3 + (seed % 70) / 100,
      rhythm_pattern: ['steady', 'accelerating', 'varied'][seed % 3],
    },
    music: {
      bpm_range: [80 + (seed % 40), 120 + (seed % 60)],
      genre: ['electronic', 'ambient', 'rock', 'pop', 'lofi'][seed % 5],
      energy_curve: [0.3, 0.5, 0.8, 1.0, 0.7, 0.4],
      mood_progression: ['intro', 'build', 'climax', 'outro'],
    },
    text: {
      font_family: ['Inter', 'Montserrat', 'Poppins', 'Oswald'][seed % 4],
      size_range: [14, 48],
      position: ['center', 'lower-third', 'top'][seed % 3],
      animation_type: ['fade', 'slide', 'typewriter'][seed % 3],
      color: '#ffffff',
    },
    transitions: {
      types: [
        { name: 'cut', frequency: 0.6 },
        { name: 'crossfade', frequency: 0.25 },
        { name: 'wipe', frequency: 0.15 },
      ],
      avg_duration: 0.3 + (seed % 50) / 100,
    },
    audio: {
      voice_music_ratio: 0.7 + (seed % 30) / 100,
      compression_level: 0.5 + (seed % 50) / 100,
      eq_profile: 'balanced',
    },
  };
}

// ── applyStyleDNA ──
export function applyStyleDNA(project, dna, { intensity = 0.8 } = {}) {
  const result = deepClone(project);
  if (!result.tracks) return result;

  for (const track of result.tracks) {
    for (const clip of track.clips) {
      // Apply color temperature as a proxy for color grading
      clip.thumbnail_color = dna.color.palette[0]
        ? `linear-gradient(135deg, ${dna.color.palette[0]}, ${dna.color.palette[1] || dna.color.palette[0]})`
        : clip.thumbnail_color;
      // Adjust duration based on pacing
      clip.duration_sec = clip.duration_sec * (1 - intensity * 0.1 + dna.pacing.avg_clip_duration * 0.01);
      clip.style_applied = true;
    }
  }
  return result;
}

// ── mixStyleDNA ──
export function mixStyleDNA(dna1, dna2, { ratio = 0.5 } = {}) {
  const r = clamp(ratio, 0, 1);
  const r1 = 1 - r;
  return {
    color: {
      temperature: lerp(dna1.color.temperature, dna2.color.temperature, r),
      contrast: lerp(dna1.color.contrast, dna2.color.contrast, r),
      saturation: lerp(dna1.color.saturation, dna2.color.saturation, r),
      shadows: lerp(dna1.color.shadows, dna2.color.shadows, r),
      highlights: lerp(dna1.color.highlights, dna2.color.highlights, r),
      palette: r < 0.5 ? dna1.color.palette : dna2.color.palette,
    },
    pacing: {
      avg_clip_duration: lerp(dna1.pacing.avg_clip_duration, dna2.pacing.avg_clip_duration, r),
      cut_frequency: lerp(dna1.pacing.cut_frequency, dna2.pacing.cut_frequency, r),
      rhythm_pattern: r < 0.5 ? dna1.pacing.rhythm_pattern : dna2.pacing.rhythm_pattern,
    },
    music: {
      bpm_range: [
        lerp(dna1.music.bpm_range[0], dna2.music.bpm_range[0], r),
        lerp(dna1.music.bpm_range[1], dna2.music.bpm_range[1], r),
      ],
      genre: r < 0.5 ? dna1.music.genre : dna2.music.genre,
      energy_curve: dna1.music.energy_curve.map((v, i) =>
        lerp(v, dna2.music.energy_curve[i] || v, r),
      ),
      mood_progression: r < 0.5 ? dna1.music.mood_progression : dna2.music.mood_progression,
    },
    text: {
      font_family: r < 0.5 ? dna1.text.font_family : dna2.text.font_family,
      size_range: [lerp(dna1.text.size_range[0], dna2.text.size_range[0], r), lerp(dna1.text.size_range[1], dna2.text.size_range[1], r)],
      position: r < 0.5 ? dna1.text.position : dna2.text.position,
      animation_type: r < 0.5 ? dna1.text.animation_type : dna2.text.animation_type,
      color: r < 0.5 ? dna1.text.color : dna2.text.color,
    },
    transitions: {
      types: r < 0.5 ? dna1.transitions.types : dna2.transitions.types,
      avg_duration: lerp(dna1.transitions.avg_duration, dna2.transitions.avg_duration, r),
    },
    audio: {
      voice_music_ratio: lerp(dna1.audio.voice_music_ratio, dna2.audio.voice_music_ratio, r),
      compression_level: lerp(dna1.audio.compression_level, dna2.audio.compression_level, r),
      eq_profile: r < 0.5 ? dna1.audio.eq_profile : dna2.audio.eq_profile,
    },
  };
}

// ── compareStyleDNA ──
export function compareStyleDNA(dna1, dna2) {
  const numSim = (a, b, range) => 1 - Math.abs(a - b) / range;
  return {
    overall: 0,
    color: (numSim(dna1.color.temperature, dna2.color.temperature, 8000) +
            numSim(dna1.color.contrast, dna2.color.contrast, 1) +
            numSim(dna1.color.saturation, dna2.color.saturation, 1)) / 3,
    pacing: (numSim(dna1.pacing.avg_clip_duration, dna2.pacing.avg_clip_duration, 10) +
             numSim(dna1.pacing.cut_frequency, dna2.pacing.cut_frequency, 1)) / 2,
    music: (numSim(dna1.music.bpm_range[0], dna2.music.bpm_range[0], 100) +
            numSim(dna1.music.bpm_range[1], dna2.music.bpm_range[1], 100)) / 2,
    text: dna1.text.font_family === dna2.text.font_family ? 1 : 0.3,
    transitions: numSim(dna1.transitions.avg_duration, dna2.transitions.avg_duration, 2),
    audio: numSim(dna1.audio.voice_music_ratio, dna2.audio.voice_music_ratio, 1),
  };
}

// ── StyleLibrary ──
export class StyleLibrary {
  constructor() { this._store = new Map(); }
  save(name, dna) { this._store.set(name, deepClone(dna)); }
  load(name) { const d = this._store.get(name); return d ? deepClone(d) : null; }
  list() { return [...this._store.keys()]; }
  delete(name) { return this._store.delete(name); }
  search(query) {
    const q = query.toLowerCase();
    return [...this._store.entries()]
      .filter(([k]) => k.toLowerCase().includes(q))
      .map(([, v]) => deepClone(v));
  }
  export(name) { const d = this.load(name); return d ? JSON.stringify(d) : null; }
  import(json) { const d = JSON.parse(json); this.save(Object.keys(this._store).length.toString(), d); return d; }
}

// ── StylePresets ──
export const STYLE_PRESETS = {
  CINEMATIC: {
    color: { temperature: 6500, contrast: 1.2, saturation: 0.85, shadows: 0.15, highlights: 0.9, palette: ['#f59e0b', '#1e1b4b'] },
    pacing: { avg_clip_duration: 3.5, cut_frequency: 0.3, rhythm_pattern: 'steady' },
    music: { bpm_range: [70, 100], genre: 'ambient', energy_curve: [0.4, 0.6, 0.9, 1.0, 0.8], mood_progression: ['calm', 'build', 'epic', 'resolve'] },
    text: { font_family: 'Oswald', size_range: [18, 72], position: 'center', animation_type: 'fade', color: '#f5f5f5' },
    transitions: { types: [{ name: 'crossfade', frequency: 0.7 }, { name: 'cut', frequency: 0.3 }], avg_duration: 0.6 },
    audio: { voice_music_ratio: 0.6, compression_level: 0.7, eq_profile: 'warm' },
  },
  VLOG: {
    color: { temperature: 5500, contrast: 1.0, saturation: 1.1, shadows: 0.1, highlights: 0.85, palette: ['#22c55e', '#3b82f6'] },
    pacing: { avg_clip_duration: 2.0, cut_frequency: 0.6, rhythm_pattern: 'accelerating' },
    music: { bpm_range: [110, 140], genre: 'pop', energy_curve: [0.5, 0.7, 0.9, 1.0, 0.8, 0.6], mood_progression: ['intro', 'energy', 'peak', 'wind-down'] },
    text: { font_family: 'Inter', size_range: [14, 36], position: 'lower-third', animation_type: 'slide', color: '#ffffff' },
    transitions: { types: [{ name: 'cut', frequency: 0.8 }, { name: 'wipe', frequency: 0.2 }], avg_duration: 0.2 },
    audio: { voice_music_ratio: 0.8, compression_level: 0.5, eq_profile: 'bright' },
  },
  COMMERCIAL: {
    color: { temperature: 6000, contrast: 1.1, saturation: 1.0, shadows: 0.12, highlights: 0.88, palette: ['#6366f1', '#ec4899'] },
    pacing: { avg_clip_duration: 2.5, cut_frequency: 0.4, rhythm_pattern: 'steady' },
    music: { bpm_range: [100, 130], genre: 'electronic', energy_curve: [0.3, 0.6, 0.9, 1.0, 0.7], mood_progression: ['build', 'energy', 'peak', 'resolve'] },
    text: { font_family: 'Montserrat', size_range: [16, 48], position: 'center', animation_type: 'typewriter', color: '#1e293b' },
    transitions: { types: [{ name: 'cut', frequency: 0.6 }, { name: 'crossfade', frequency: 0.4 }], avg_duration: 0.35 },
    audio: { voice_music_ratio: 0.65, compression_level: 0.6, eq_profile: 'balanced' },
  },
  TIKTOK: {
    color: { temperature: 5800, contrast: 1.15, saturation: 1.2, shadows: 0.08, highlights: 0.9, palette: ['#ef4444', '#f59e0b'] },
    pacing: { avg_clip_duration: 1.2, cut_frequency: 0.85, rhythm_pattern: 'accelerating' },
    music: { bpm_range: [120, 160], genre: 'electronic', energy_curve: [0.6, 0.8, 1.0, 1.0, 0.9], mood_progression: ['hook', 'build', 'drop', 'outro'] },
    text: { font_family: 'Poppins', size_range: [20, 56], position: 'center', animation_type: 'typewriter', color: '#ffffff' },
    transitions: { types: [{ name: 'cut', frequency: 0.9 }, { name: 'glitch', frequency: 0.1 }], avg_duration: 0.15 },
    audio: { voice_music_ratio: 0.5, compression_level: 0.8, eq_profile: 'bright' },
  },
  DOCUMENTARY: {
    color: { temperature: 5200, contrast: 0.95, saturation: 0.9, shadows: 0.18, highlights: 0.82, palette: ['#78716c', '#292524'] },
    pacing: { avg_clip_duration: 5.0, cut_frequency: 0.15, rhythm_pattern: 'steady' },
    music: { bpm_range: [60, 90], genre: 'ambient', energy_curve: [0.3, 0.4, 0.5, 0.6, 0.4], mood_progression: ['context', 'explore', 'insight', 'conclude'] },
    text: { font_family: 'Inter', size_range: [12, 28], position: 'lower-third', animation_type: 'fade', color: '#e2e8f0' },
    transitions: { types: [{ name: 'crossfade', frequency: 0.7 }, { name: 'cut', frequency: 0.3 }], avg_duration: 0.8 },
    audio: { voice_music_ratio: 0.85, compression_level: 0.4, eq_profile: 'natural' },
  },
  MUSIC_VIDEO: {
    color: { temperature: 6200, contrast: 1.3, saturation: 1.15, shadows: 0.1, highlights: 0.92, palette: ['#a855f7', '#06b6d4'] },
    pacing: { avg_clip_duration: 1.0, cut_frequency: 0.95, rhythm_pattern: 'accelerating' },
    music: { bpm_range: [100, 150], genre: 'electronic', energy_curve: [0.4, 0.7, 1.0, 1.0, 0.9, 0.5], mood_progression: ['intro', 'verse', 'chorus', 'bridge', 'outro'] },
    text: { font_family: 'Oswald', size_range: [24, 80], position: 'center', animation_type: 'typewriter', color: '#ffffff' },
    transitions: { types: [{ name: 'cut', frequency: 0.85 }, { name: 'glitch', frequency: 0.15 }], avg_duration: 0.1 },
    audio: { voice_music_ratio: 0.4, compression_level: 0.9, eq_profile: 'bright' },
  },
};

// ── helpers ──
function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
  return Math.abs(h);
}
