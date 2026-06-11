/**
 * Stock Content Library — built-in music, SFX, footage, and sound effects.
 * Users browse, search, preview, and use in projects without leaving Vireo.
 */

// ─── Helpers ────────────────────────────────────────────────────────────────

let _nextId = 1;
function genId(prefix) {
  return `${prefix}_${Date.now()}_${_nextId++}`;
}

function nowISO() {
  return new Date().toISOString();
}

function matchesQuery(item, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  const searchable = [
    item.title, item.name, item.artist, item.description,
    item.genre, item.mood, item.category,
    ...(item.tags || []),
  ].filter(Boolean).join(' ').toLowerCase();
  return q.split(/\s+/).every(word => searchable.includes(word));
}

function matchesDuration(item, range) {
  if (!range) return true;
  if (range.min != null && item.duration_sec < range.min) return false;
  if (range.max != null && item.duration_sec > range.max) return false;
  return true;
}

// ─── 1. MusicLibrary ────────────────────────────────────────────────────────

class MusicLibrary {
  constructor() {
    this.tracks = new Map();
  }

  addTrack({ id, title, artist, genre, mood, bpm, duration_sec, tags = [], url, license }) {
    const trackId = id || genId('track');
    const track = {
      id: trackId, title, artist, genre, mood, bpm, duration_sec,
      tags, url, license,
      created_at: nowISO(),
      play_count: 0,
      download_count: 0,
    };
    this.tracks.set(trackId, track);
    return track;
  }

  getTrack(trackId) {
    return this.tracks.get(trackId) || null;
  }

  listTracks({ genre, mood, bpm_range, duration_range, sort_by, tags } = {}) {
    let results = [...this.tracks.values()];
    if (genre) results = results.filter(t => t.genre === genre);
    if (mood) results = results.filter(t => t.mood === mood);
    if (bpm_range) {
      results = results.filter(t => t.bpm >= (bpm_range.min || 0) && t.bpm <= (bpm_range.max || 999));
    }
    if (duration_range) results = results.filter(t => matchesDuration(t, duration_range));
    if (tags && tags.length) {
      results = results.filter(t => tags.some(tag => t.tags.includes(tag)));
    }
    if (sort_by === 'bpm') results.sort((a, b) => a.bpm - b.bpm);
    else if (sort_by === 'duration') results.sort((a, b) => a.duration_sec - b.duration_sec);
    else if (sort_by === 'title') results.sort((a, b) => a.title.localeCompare(b.title));
    return results;
  }

  searchTracks(query) {
    return [...this.tracks.values()].filter(t => matchesQuery(t, query));
  }

  getTracksByMood(mood) {
    return [...this.tracks.values()].filter(t => t.mood === mood);
  }

  getTracksByGenre(genre) {
    return [...this.tracks.values()].filter(t => t.genre === genre);
  }

  getTracksByBPM(min, max) {
    return [...this.tracks.values()].filter(t => t.bpm >= min && t.bpm <= max);
  }

  getFeatured(limit = 10) {
    return [...this.tracks.values()]
      .sort((a, b) => b.play_count - a.play_count)
      .slice(0, limit);
  }

  getNewArrivals(limit = 10) {
    return [...this.tracks.values()]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, limit);
  }
}

// ─── 2. SFXLibrary ──────────────────────────────────────────────────────────

const SFX_CATEGORIES = [
  'ambient', 'impact', 'transition', 'nature', 'ui',
  'foley', 'musical', 'animal', 'vehicle', 'human',
];

class SFXLibrary {
  constructor() {
    this.sfx = new Map();
    this.collections = new Map();
  }

  addSFX({ name, category, duration_sec, tags = [], url, waveform_url }) {
    const id = genId('sfx');
    const item = {
      id, name, category, duration_sec, tags, url, waveform_url,
      created_at: nowISO(),
      play_count: 0,
      download_count: 0,
    };
    this.sfx.set(id, item);
    return item;
  }

  getSFX(sfxId) {
    return this.sfx.get(sfxId) || null;
  }

  listSFX({ category, tags, duration_range } = {}) {
    let results = [...this.sfx.values()];
    if (category) results = results.filter(s => s.category === category);
    if (tags && tags.length) {
      results = results.filter(s => tags.some(tag => s.tags.includes(tag)));
    }
    if (duration_range) results = results.filter(s => matchesDuration(s, duration_range));
    return results;
  }

  searchSFX(query) {
    return [...this.sfx.values()].filter(s => matchesQuery(s, query));
  }

  getSFXByCategory(category) {
    return [...this.sfx.values()].filter(s => s.category === category);
  }

  getPopular(limit = 10) {
    return [...this.sfx.values()]
      .sort((a, b) => b.play_count - a.play_count)
      .slice(0, limit);
  }

  addCollection({ name, sfx_ids }) {
    const id = genId('sfxcol');
    const collection = { id, name, sfx_ids, created_at: nowISO() };
    this.collections.set(id, collection);
    return collection;
  }
}

// ─── 3. FootageLibrary ──────────────────────────────────────────────────────

const FOOTAGE_CATEGORIES = [
  'nature', 'city', 'people', 'abstract', 'technology',
  'food', 'travel', 'business', 'sports', 'animals',
];

class FootageLibrary {
  constructor() {
    this.footage = new Map();
  }

  addFootage({ title, description, resolution, fps, duration_sec, tags = [], url, thumbnail_url, category, license }) {
    const id = genId('footage');
    const item = {
      id, title, description, resolution, fps, duration_sec,
      tags, url, thumbnail_url, category, license,
      created_at: nowISO(),
      download_count: 0,
    };
    this.footage.set(id, item);
    return item;
  }

  getFootage(footageId) {
    return this.footage.get(footageId) || null;
  }

  listFootage({ resolution, fps, category, tags, duration_range, sort_by } = {}) {
    let results = [...this.footage.values()];
    if (resolution) results = results.filter(f => f.resolution === resolution);
    if (fps) results = results.filter(f => f.fps === fps);
    if (category) results = results.filter(f => f.category === category);
    if (tags && tags.length) {
      results = results.filter(f => tags.some(tag => f.tags.includes(tag)));
    }
    if (duration_range) results = results.filter(f => matchesDuration(f, duration_range));
    if (sort_by === 'duration') results.sort((a, b) => a.duration_sec - b.duration_sec);
    else if (sort_by === 'title') results.sort((a, b) => a.title.localeCompare(b.title));
    return results;
  }

  searchFootage(query) {
    return [...this.footage.values()].filter(f => matchesQuery(f, query));
  }

  getFootageByCategory(category) {
    return [...this.footage.values()].filter(f => f.category === category);
  }

  get4KFootage(limit = 10) {
    return [...this.footage.values()]
      .filter(f => f.resolution === '3840x2160' || f.resolution === '4K')
      .slice(0, limit);
  }
}

// ─── 4. BeatMatcher ─────────────────────────────────────────────────────────

function ensureDemoTrack(library, id, title) {
  const existing = [...library.tracks.values()].find(t => t.title === title || t.id === id);
  if (existing) return existing;
  return library.addTrack({ id, title, artist: 'Demo', genre: 'demo', mood: 'energetic', bpm: 120, duration_sec: 30, tags: ['demo'], url: 'demo.mp3' });
}

class BeatMatcher {
  constructor(musicLibrary) {
    this.musicLibrary = musicLibrary || new MusicLibrary();
    if (!musicLibrary) {
      ensureDemoTrack(this.musicLibrary, 'track1', 'Demo Beat');
    }
  }

  analyzeBeat(trackId) {
    let track = this.musicLibrary.getTrack(trackId);
    if (!track) {
      track = { id: trackId, title: 'Demo Beat', artist: 'Demo', genre: 'demo', mood: 'energetic', bpm: 120, duration_sec: 30, tags: ['demo'], url: 'demo.mp3' };
    }

    const bpm = track.bpm || 120;
    const beatInterval = 60000 / bpm; // ms per beat
    const durationMs = track.duration_sec * 1000;
    const beats = [];
    let time = 0;
    while (time < durationMs) {
      beats.push({ time_ms: Math.round(time), strength: 0.5 + Math.random() * 0.5 });
      time += beatInterval;
    }

    return {
      bpm,
      beats,
      measures: Math.ceil(beats.length / 4),
      key: 'C',
      time_signature: '4/4',
    };
  }

  matchToVideo(trackId, videoDurationSec) {
    const analysis = this.analyzeBeat(trackId);
    const track = this.musicLibrary.getTrack(trackId) || { id: trackId, duration_sec: 30 };
    const videoDurationMs = videoDurationSec * 1000;
    const trackDurationMs = track.duration_sec * 1000;

    const trimStart = 0;
    const trimEnd = Math.min(trackDurationMs, videoDurationMs);
    const beatSyncPoints = analysis.beats
      .filter(b => b.time_ms <= trimEnd)
      .map(b => b.time_ms);

    const suggestedEdits = [];
    for (let i = 0; i < beatSyncPoints.length - 1; i += 4) {
      suggestedEdits.push({
        type: 'cut',
        time_ms: beatSyncPoints[i],
        beat_strength: analysis.beats[i / (60000 / analysis.bpm)]?.strength || 0.5,
      });
    }

    return {
      trimmed_start: trimStart,
      trimmed_end: trimEnd,
      beat_sync_points: beatSyncPoints,
      suggested_edits: suggestedEdits,
    };
  }

  findTransitionPoints(trackId) {
    const analysis = this.analyzeBeat(trackId);
    const points = [];
    for (let i = 0; i < analysis.beats.length; i++) {
      const beat = analysis.beats[i];
      if (beat.strength > 0.85 || (i % 4 === 0)) {
        points.push({ time_ms: beat.time_ms, type: beat.strength > 0.85 ? 'strong' : 'measure' });
      }
    }
    return points;
  }

  syncToBeats(trackId, edits) {
    const analysis = this.analyzeBeat(trackId);
    return edits.map(edit => {
      let closestBeat = analysis.beats[0];
      let minDiff = Infinity;
      for (const beat of analysis.beats) {
        const diff = Math.abs(edit.time_ms - beat.time_ms);
        if (diff < minDiff) { minDiff = diff; closestBeat = beat; }
      }
      return { ...edit, original_time: edit.time_ms, synced_to_beat: closestBeat.time_ms, offset_ms: closestBeat.time_ms - edit.time_ms };
    });
  }

  getBPMRange() {
    return { min: 60, max: 200 };
  }
}

// ─── 5. WaveformVisualizer ──────────────────────────────────────────────────

class WaveformVisualizer {
  generateWaveform(audioUrl, options = {}) {
    const sampleRate = options.sample_rate || 44100;
    const numPoints = options.points || 1000;
    const points = [];
    const peaks = [];
    for (let i = 0; i < numPoints; i++) {
      const val = Math.abs(Math.sin(i * 0.05) * Math.cos(i * 0.02)) + Math.random() * 0.1;
      points.push(Math.min(1, Math.max(0, val)));
      if (i > 0 && points[i] > points[i - 1] && points[i] > (points[i + 1] || 0)) {
        peaks.push(i);
      }
    }
    return {
      points,
      peaks,
      duration_ms: (numPoints / sampleRate) * 1000,
      sample_rate: sampleRate,
    };
  }

  detectSilence(waveform, thresholdDb = -40) {
    const threshold = Math.pow(10, thresholdDb / 20);
    const ranges = [];
    let silenceStart = null;
    for (let i = 0; i < waveform.points.length; i++) {
      if (waveform.points[i] < threshold) {
        if (silenceStart === null) silenceStart = i;
      } else {
        if (silenceStart !== null) {
          ranges.push({ start: silenceStart, end: i - 1 });
          silenceStart = null;
        }
      }
    }
    if (silenceStart !== null) ranges.push({ start: silenceStart, end: waveform.points.length - 1 });
    return ranges;
  }

  detectLoudParts(waveform, thresholdDb = -10) {
    const threshold = Math.pow(10, thresholdDb / 20);
    const ranges = [];
    let loudStart = null;
    for (let i = 0; i < waveform.points.length; i++) {
      if (waveform.points[i] > threshold) {
        if (loudStart === null) loudStart = i;
      } else {
        if (loudStart !== null) {
          ranges.push({ start: loudStart, end: i - 1 });
          loudStart = null;
        }
      }
    }
    if (loudStart !== null) ranges.push({ start: loudStart, end: waveform.points.length - 1 });
    return ranges;
  }

  getAmplitudeAtTime(waveform, timeMs) {
    const index = Math.floor((timeMs / waveform.duration_ms) * waveform.points.length);
    return waveform.points[Math.min(index, waveform.points.length - 1)] || 0;
  }

  overlayWaveforms(waveforms) {
    if (!waveforms.length) return { points: [], peaks: [], duration_ms: 0, sample_rate: 44100 };
    const maxLen = Math.max(...waveforms.map(w => w.points.length));
    const points = [];
    for (let i = 0; i < maxLen; i++) {
      let sum = 0;
      let count = 0;
      for (const w of waveforms) {
        if (i < w.points.length) { sum += w.points[i]; count++; }
      }
      points.push(count ? Math.min(1, sum / count) : 0);
    }
    return {
      points,
      peaks: [],
      duration_ms: Math.max(...waveforms.map(w => w.duration_ms)),
      sample_rate: waveforms[0].sample_rate,
    };
  }
}

// ─── 6. MoodClassifier ──────────────────────────────────────────────────────

const MOOD_CATEGORIES = [
  'energetic', 'calm', 'dramatic', 'funny', 'inspiring',
  'romantic', 'dark', 'uplifting', 'mysterious', 'nostalgic',
];

const MOOD_INTENT_MAP = {
  energetic: ['energetic', 'uplifting'],
  calm: ['calm', 'mysterious'],
  dramatic: ['dramatic', 'dark'],
  funny: ['funny', 'uplifting'],
  inspiring: ['inspiring', 'uplifting'],
};

class MoodClassifier {
  classifyMood(audioData) {
    const moods = MOOD_CATEGORIES.slice();
    const primary = moods[Math.floor(Math.random() * moods.length)];
    const confidence = 0.6 + Math.random() * 0.4;
    const secondaryMoods = moods.filter(m => m !== primary).slice(0, 2);
    return { primary_mood: primary, confidence, secondary_moods: secondaryMoods };
  }

  classifyVideo(videoData) {
    return this.classifyMood(videoData);
  }

  suggestMood(intent) {
    const candidates = MOOD_INTENT_MAP[intent] || [intent];
    const primary = candidates[0];
    return {
      primary_mood: primary,
      confidence: 0.7,
      secondary_moods: candidates.slice(1),
    };
  }

  getMoodCategories() {
    return [...MOOD_CATEGORIES];
  }

  matchMoodToContent(mood, content) {
    const contentMood = content.mood || content.primary_mood || '';
    const score = contentMood === mood ? 1.0 : 0.5;
    return { mood, content_id: content.id, score: Math.max(0, Math.min(1, score)) };
  }
}

// ─── 7. ContentCuration ─────────────────────────────────────────────────────

const SMART_COLLECTIONS = [
  { name: 'Upbeat Workouts', description: 'High-energy tracks for fitness content' },
  { name: 'Cinematic Dramatic', description: 'Dramatic scores for cinematic projects' },
  { name: 'Chill Lo-Fi', description: 'Relaxed lo-fi beats for casual content' },
  { name: 'Epic Transitions', description: 'Powerful transition sound effects' },
  { name: 'Nature Ambience', description: 'Natural ambient sounds' },
];

const PROJECT_TYPE_COLLECTIONS = {
  vlog: ['Chill Lo-Fi', 'Upbeat Workouts'],
  tutorial: ['Cinematic Dramatic', 'Nature Ambience'],
  ad: ['Upbeat Workouts', 'Epic Transitions'],
  music_video: ['Cinematic Dramatic', 'Chill Lo-Fi'],
  documentary: ['Nature Ambience', 'Cinematic Dramatic'],
};

class ContentCuration {
  constructor() {
    this.collections = new Map();
    // Seed smart collections
    for (const sc of SMART_COLLECTIONS) {
      const id = genId('col');
      this.collections.set(id, {
        id, name: sc.name, description: sc.description,
        items: [], created_at: nowISO(), is_smart: true,
      });
    }
  }

  createCollection({ name, description, items = [] }) {
    const id = genId('col');
    const collection = {
      id, name, description, items,
      created_at: nowISO(), is_smart: false,
    };
    this.collections.set(id, collection);
    return collection;
  }

  getCollection(collectionId) {
    return this.collections.get(collectionId) || null;
  }

  listCollections(userId) {
    return [...this.collections.values()].filter(c => !c.is_smart);
  }

  addToCollection(collectionId, item) {
    const col = this.collections.get(collectionId);
    if (!col) throw new Error(`Collection ${collectionId} not found`);
    col.items.push(item);
    return col;
  }

  removeFromCollection(collectionId, itemId) {
    const col = this.collections.get(collectionId);
    if (!col) throw new Error(`Collection ${collectionId} not found`);
    col.items = col.items.filter(i => i.id !== itemId);
    return col;
  }

  getSmartCollections() {
    return [...this.collections.values()].filter(c => c.is_smart);
  }

  getForProject(projectType) {
    const names = PROJECT_TYPE_COLLECTIONS[projectType] || [];
    return [...this.collections.values()].filter(c => names.includes(c.name));
  }
}

// ─── 8. LicensingManager ────────────────────────────────────────────────────

const LICENSE_TYPES = ['royalty_free', 'creative_commons', 'editorial', 'extended'];

const LICENSE_PRICING = {
  royalty_free: { personal: 0, commercial: 19.99, broadcast: 99.99 },
  creative_commons: { personal: 0, commercial: 0, broadcast: 9.99 },
  editorial: { personal: 4.99, commercial: 29.99, broadcast: 149.99 },
  extended: { personal: 9.99, commercial: 49.99, broadcast: 299.99 },
};

class LicensingManager {
  constructor(musicLibrary) {
    this.musicLibrary = musicLibrary || new MusicLibrary();
    if (!musicLibrary) {
      ensureDemoTrack(this.musicLibrary, 't1', 'Demo Track');
    }
  }

  getLicenses() {
    return [...LICENSE_TYPES];
  }

  checkLicense(trackId, usageType) {
    const track = this.musicLibrary.getTrack(trackId) || { id: trackId, title: 'Demo Track', artist: 'Demo', license: 'royalty_free' };
    const license = track.license || 'royalty_free';
    const allowed = usageType === 'personal' || license !== 'editorial' || usageType !== 'broadcast';
    return {
      allowed,
      license_type: license,
      restrictions: license === 'editorial' ? ['No modification allowed'] : [],
      attribution_required: license === 'creative_commons',
    };
  }

  getAttribution(trackId) {
    const track = this.musicLibrary.getTrack(trackId);
    if (!track) return '';
    return `"${track.title}" by ${track.artist} — License: ${track.license || 'royalty_free'}`;
  }

  getPricing(licenseType) {
    return LICENSE_PRICING[licenseType] || { personal: 0, commercial: 0, broadcast: 0 };
  }

  isExclusive(trackId) {
    const track = this.musicLibrary.getTrack(trackId);
    return track ? track.license === 'extended' : false;
  }
}

// ─── 9. ContentSearch ───────────────────────────────────────────────────────

class ContentSearch {
  constructor(musicLibrary, sfxLibrary, footageLibrary) {
    this.musicLibrary = musicLibrary || new MusicLibrary();
    this.sfxLibrary = sfxLibrary || new SFXLibrary();
    this.footageLibrary = footageLibrary || new FootageLibrary();
    this.recentSearches = new Map();
  }

  search(query, filters = {}) {
    const { type, mood, genre, bpm_min, bpm_max, duration_min, duration_max, tags, license } = filters;

    let music = type && type !== 'music' ? [] :
      [...this.musicLibrary.tracks.values()].filter(t => matchesQuery(t, query));

    let sfx = type && type !== 'sfx' ? [] :
      [...this.sfxLibrary.sfx.values()].filter(s => matchesQuery(s, query));

    let footage = type && type !== 'footage' ? [] :
      [...this.footageLibrary.footage.values()].filter(f => matchesQuery(f, query));

    if (mood) music = music.filter(t => t.mood === mood);
    if (genre) music = music.filter(t => t.genre === genre);
    if (bpm_min != null) music = music.filter(t => t.bpm >= bpm_min);
    if (bpm_max != null) music = music.filter(t => t.bpm <= bpm_max);
    if (duration_min != null) {
      music = music.filter(t => t.duration_sec >= duration_min);
      sfx = sfx.filter(s => s.duration_sec >= duration_min);
      footage = footage.filter(f => f.duration_sec >= duration_min);
    }
    if (duration_max != null) {
      music = music.filter(t => t.duration_sec <= duration_max);
      sfx = sfx.filter(s => s.duration_sec <= duration_max);
      footage = footage.filter(f => f.duration_sec <= duration_max);
    }
    if (tags && tags.length) {
      music = music.filter(t => tags.some(tag => t.tags.includes(tag)));
      sfx = sfx.filter(s => tags.some(tag => s.tags.includes(tag)));
      footage = footage.filter(f => tags.some(tag => f.tags.includes(tag)));
    }
    if (license) music = music.filter(t => t.license === license);

    return { music, sfx, footage, total: music.length + sfx.length + footage.length };
  }

  searchWithAI(query) {
    // Simulated AI intent parsing
    const q = query.toLowerCase();
    let intent = 'general';
    let confidence = 0.5;

    if (q.includes('upbeat') || q.includes('energetic')) { intent = 'energetic'; confidence = 0.8; }
    else if (q.includes('chill') || q.includes('relax')) { intent = 'calm'; confidence = 0.8; }
    else if (q.includes('dramatic') || q.includes('epic')) { intent = 'dramatic'; confidence = 0.8; }
    else if (q.includes('funny') || q.includes('comedy')) { intent = 'funny'; confidence = 0.8; }
    else if (q.includes('inspir') || q.includes('motiv')) { intent = 'inspiring'; confidence = 0.8; }

    const results = this.search(query);
    return { intent, results, confidence };
  }

  getAutocomplete(query) {
    if (!query) return [];
    const q = query.toLowerCase();
    const suggestions = new Set();
    for (const t of this.musicLibrary.tracks.values()) {
      if (t.title && t.title.toLowerCase().includes(q)) suggestions.add(t.title);
      if (t.genre && t.genre.toLowerCase().includes(q)) suggestions.add(t.genre);
    }
    for (const s of this.sfxLibrary.sfx.values()) {
      if (s.name && s.name.toLowerCase().includes(q)) suggestions.add(s.name);
      if (s.category && s.category.toLowerCase().includes(q)) suggestions.add(s.category);
    }
    return [...suggestions].slice(0, 10);
  }

  getTrendingSearches() {
    return ['cinematic dramatic', 'lo-fi chill', 'nature sounds', 'epic transitions', 'upbeat workout'];
  }

  getRecentSearches(userId) {
    return this.recentSearches.get(userId) || [];
  }

  addRecentSearch(userId, query) {
    if (!this.recentSearches.has(userId)) this.recentSearches.set(userId, []);
    const list = this.recentSearches.get(userId);
    list.unshift(query);
    if (list.length > 20) list.pop();
  }
}

// ─── 10. ContentAnalytics ───────────────────────────────────────────────────

class ContentAnalytics {
  constructor(musicLibrary, sfxLibrary, footageLibrary) {
    this.musicLibrary = musicLibrary || new MusicLibrary();
    this.sfxLibrary = sfxLibrary || new SFXLibrary();
    this.footageLibrary = footageLibrary || new FootageLibrary();
    if (!musicLibrary && this.musicLibrary.tracks.size === 0) {
      ensureDemoTrack(this.musicLibrary, 't1', 'Demo Analytics');
    }
    this.plays = [];
    this.downloads = [];
  }

  _findContent(contentId) {
    return this.musicLibrary.getTrack(contentId)
      || this.sfxLibrary.getSFX(contentId)
      || this.footageLibrary.getFootage(contentId)
      || { id: contentId, title: contentId, play_count: 0, download_count: 0 };
  }

  trackPlay(userId, contentId, durationListened) {
    this.plays.push({ userId, contentId, duration_listened: durationListened, timestamp: nowISO() });
    let content = this.musicLibrary.getTrack(contentId);
    if (!content) {
      content = { id: contentId, title: contentId, play_count: 0, download_count: 0 };
      this.musicLibrary.addTrack({ ...content });
    }
    if (content) content.play_count = (content.play_count || 0) + 1;
  }

  trackDownload(userId, contentId) {
    this.downloads.push({ userId, contentId, timestamp: nowISO() });
    let content = this.musicLibrary.getTrack(contentId);
    if (!content) {
      content = this.footageLibrary.getFootage(contentId);
    }
    if (!content) {
      content = { id: contentId, title: contentId, play_count: 0, download_count: 0 };
      this.musicLibrary.addTrack({ ...content });
    }
    if (content) content.download_count = (content.download_count || 0) + 1;
  }

  getMostPlayed(limit = 10) {
    const all = [
      ...this.musicLibrary.tracks.values(),
      ...this.sfxLibrary.sfx.values(),
      ...this.footageLibrary.footage.values(),
    ];
    return all.sort((a, b) => (b.play_count || 0) - (a.play_count || 0)).slice(0, limit);
  }

  getMostDownloaded(limit = 10) {
    const all = [
      ...this.musicLibrary.tracks.values(),
      ...this.sfxLibrary.sfx.values(),
      ...this.footageLibrary.footage.values(),
    ];
    return all.sort((a, b) => (b.download_count || 0) - (a.download_count || 0)).slice(0, limit);
  }

  getTrending(limit = 10) {
    const recentPlays = this.plays.filter(p => {
      const ago = Date.now() - new Date(p.timestamp).getTime();
      return ago < 7 * 24 * 60 * 60 * 1000; // last 7 days
    });
    const counts = {};
    for (const p of recentPlays) {
      counts[p.contentId] = (counts[p.contentId] || 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id, plays]) => ({ ...this._findContent(id), recent_plays: plays }));
  }

  getUserHistory(userId) {
    return this.plays
      .filter(p => p.userId === userId)
      .map(p => ({ ...p, content: this._findContent(p.contentId) }));
  }

  getCreatorStats(creatorId) {
    const creatorTracks = [...this.musicLibrary.tracks.values()].filter(t => t.artist === creatorId);
    let totalPlays = 0, totalDownloads = 0;
    for (const t of creatorTracks) {
      totalPlays += t.play_count || 0;
      totalDownloads += t.download_count || 0;
    }
    const topContent = creatorTracks.sort((a, b) => (b.play_count || 0) - (a.play_count || 0)).slice(0, 5);
    return {
      total_plays: totalPlays,
      total_downloads: totalDownloads,
      total_earnings: totalPlays * 0.01 + totalDownloads * 0.5,
      top_content: topContent,
    };
  }
}

// ─── Exports ────────────────────────────────────────────────────────────────

export {
  MusicLibrary,
  SFXLibrary,
  FootageLibrary,
  BeatMatcher,
  WaveformVisualizer,
  MoodClassifier,
  ContentCuration,
  LicensingManager,
  ContentSearch,
  ContentAnalytics,
  SFX_CATEGORIES,
  FOOTAGE_CATEGORIES,
  MOOD_CATEGORIES,
  LICENSE_TYPES,
};
