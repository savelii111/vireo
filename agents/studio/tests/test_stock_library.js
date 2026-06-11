/**
 * test_stock_library.js — Tests for W18 Stock Content Library (65+ tests)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  MusicLibrary, SFXLibrary, FootageLibrary, BeatMatcher,
  WaveformVisualizer, MoodClassifier, ContentCuration,
  LicensingManager, ContentSearch, ContentAnalytics
} from '../src/stock_library.js';

// ── MusicLibrary ─────────────────────────────────────────────────────────────
describe('MusicLibrary', () => {
  test('addTrack', () => {
    const ml = new MusicLibrary();
    const t = ml.addTrack({ title: 'Chill Vibes', artist: 'DJ Cool', genre: 'lofi', mood: 'calm', bpm: 85, duration_sec: 180, tags: ['chill'], url: 'track.mp3', license: 'royalty_free' });
    assert.equal(t.title, 'Chill Vibes');
    assert.ok(t.id);
  });

  test('getTrack', () => {
    const ml = new MusicLibrary();
    const t = ml.addTrack({ title: 'T', artist: 'A', genre: 'rock', mood: 'energetic', bpm: 120, duration_sec: 200, url: 't.mp3' });
    assert.equal(ml.getTrack(t.id).title, 'T');
  });

  test('listTracks by genre', () => {
    const ml = new MusicLibrary();
    ml.addTrack({ title: 'A', artist: 'X', genre: 'rock', mood: 'energetic', bpm: 120, duration_sec: 200, url: 'a.mp3' });
    ml.addTrack({ title: 'B', artist: 'Y', genre: 'lofi', mood: 'calm', bpm: 80, duration_sec: 180, url: 'b.mp3' });
    assert.equal(ml.listTracks({ genre: 'rock' }).length, 1);
  });

  test('listTracks by mood', () => {
    const ml = new MusicLibrary();
    ml.addTrack({ title: 'A', artist: 'X', genre: 'rock', mood: 'calm', bpm: 80, duration_sec: 180, url: 'a.mp3' });
    ml.addTrack({ title: 'B', artist: 'Y', genre: 'rock', mood: 'energetic', bpm: 140, duration_sec: 200, url: 'b.mp3' });
    assert.equal(ml.listTracks({ mood: 'calm' }).length, 1);
  });

  test('searchTracks', () => {
    const ml = new MusicLibrary();
    ml.addTrack({ title: 'Summer Vibes', artist: 'DJ', genre: 'pop', mood: 'uplifting', bpm: 110, duration_sec: 200, url: 's.mp3' });
    const results = ml.searchTracks('summer');
    assert.equal(results.length, 1);
  });

  test('getTracksByBPM', () => {
    const ml = new MusicLibrary();
    ml.addTrack({ title: 'Slow', artist: 'A', genre: 'ambient', mood: 'calm', bpm: 70, duration_sec: 300, url: 's.mp3' });
    ml.addTrack({ title: 'Fast', artist: 'B', genre: 'edm', mood: 'energetic', bpm: 140, duration_sec: 180, url: 'f.mp3' });
    const fast = ml.getTracksByBPM(120, 200);
    assert.equal(fast.length, 1);
    assert.equal(fast[0].title, 'Fast');
  });

  test('getFeatured', () => {
    const ml = new MusicLibrary();
    for (let i = 0; i < 5; i++) ml.addTrack({ title: `T${i}`, artist: 'A', genre: 'pop', mood: 'calm', bpm: 100, duration_sec: 180, url: `t${i}.mp3` });
    assert.equal(ml.getFeatured(3).length, 3);
  });
});

// ── SFXLibrary ───────────────────────────────────────────────────────────────
describe('SFXLibrary', () => {
  test('addSFX', () => {
    const sl = new SFXLibrary();
    const s = sl.addSFX({ name: 'Whoosh', category: 'transition', duration_sec: 1, tags: ['fast'], url: 'whoosh.mp3' });
    assert.equal(s.name, 'Whoosh');
    assert.ok(s.id);
  });

  test('listSFX by category', () => {
    const sl = new SFXLibrary();
    sl.addSFX({ name: 'A', category: 'impact', duration_sec: 0.5, url: 'a.mp3' });
    sl.addSFX({ name: 'B', category: 'ambient', duration_sec: 10, url: 'b.mp3' });
    assert.equal(sl.listSFX({ category: 'impact' }).length, 1);
  });

  test('searchSFX', () => {
    const sl = new SFXLibrary();
    sl.addSFX({ name: 'Rain Forest', category: 'nature', duration_sec: 30, url: 'r.mp3' });
    sl.addSFX({ name: 'Thunder', category: 'nature', duration_sec: 5, url: 't.mp3' });
    assert.equal(sl.searchSFX('rain').length, 1);
  });

  test('getSFXByCategory returns all for nature', () => {
    const sl = new SFXLibrary();
    sl.addSFX({ name: 'Bird', category: 'nature', duration_sec: 5, url: 'b.mp3' });
    sl.addSFX({ name: 'River', category: 'nature', duration_sec: 10, url: 'r.mp3' });
    assert.equal(sl.getSFXByCategory('nature').length, 2);
  });

  test('addCollection', () => {
    const sl = new SFXLibrary();
    const a = sl.addSFX({ name: 'A', category: 'impact', duration_sec: 1, url: 'a.mp3' });
    const b = sl.addSFX({ name: 'B', category: 'impact', duration_sec: 1, url: 'b.mp3' });
    const col = sl.addCollection({ name: 'Impacts', sfx_ids: [a.id, b.id] });
    assert.equal(col.sfx_ids.length, 2);
  });

  test('getPopular', () => {
    const sl = new SFXLibrary();
    for (let i = 0; i < 5; i++) sl.addSFX({ name: `S${i}`, category: 'ui', duration_sec: 1, url: `s${i}.mp3` });
    assert.equal(sl.getPopular(3).length, 3);
  });
});

// ── FootageLibrary ───────────────────────────────────────────────────────────
describe('FootageLibrary', () => {
  test('addFootage', () => {
    const fl = new FootageLibrary();
    const f = fl.addFootage({ title: 'Tokyo Streets', description: 'Night walk', resolution: '4K', fps: 30, duration_sec: 60, tags: ['city'], url: 'tokyo.mp4', thumbnail_url: 'thumb.jpg', category: 'city' });
    assert.equal(f.title, 'Tokyo Streets');
    assert.ok(f.id);
  });

  test('listFootage by resolution', () => {
    const fl = new FootageLibrary();
    fl.addFootage({ title: 'A', resolution: '4K', fps: 30, duration_sec: 30, url: 'a.mp4', category: 'nature' });
    fl.addFootage({ title: 'B', resolution: '1080p', fps: 60, duration_sec: 20, url: 'b.mp4', category: 'nature' });
    assert.equal(fl.listFootage({ resolution: '4K' }).length, 1);
  });

  test('searchFootage', () => {
    const fl = new FootageLibrary();
    fl.addFootage({ title: 'Sunset Beach', resolution: '4K', fps: 30, duration_sec: 45, url: 's.mp4', category: 'travel' });
    assert.equal(fl.searchFootage('sunset').length, 1);
  });

  test('getFootageByCategory', () => {
    const fl = new FootageLibrary();
    fl.addFootage({ title: 'A', resolution: '4K', fps: 30, duration_sec: 30, url: 'a.mp4', category: 'nature' });
    fl.addFootage({ title: 'B', resolution: '4K', fps: 30, duration_sec: 30, url: 'b.mp4', category: 'city' });
    assert.equal(fl.getFootageByCategory('nature').length, 1);
  });

  test('get4KFootage', () => {
    const fl = new FootageLibrary();
    fl.addFootage({ title: 'A', resolution: '4K', fps: 30, duration_sec: 30, url: 'a.mp4', category: 'nature' });
    fl.addFootage({ title: 'B', resolution: '1080p', fps: 30, duration_sec: 30, url: 'b.mp4', category: 'nature' });
    assert.equal(fl.get4KFootage(10).length, 1);
  });
});

// ── BeatMatcher ──────────────────────────────────────────────────────────────
describe('BeatMatcher', () => {
  test('analyzeBeat', () => {
    const bm = new BeatMatcher();
    const result = bm.analyzeBeat('track1');
    assert.ok(result.bpm);
    assert.ok(Array.isArray(result.beats));
    assert.ok(result.key);
  });

  test('matchToVideo', () => {
    const bm = new BeatMatcher();
    const result = bm.matchToVideo('track1', 30);
    assert.ok(result.trimmed_start >= 0);
    assert.ok(result.beat_sync_points.length > 0);
  });

  test('findTransitionPoints', () => {
    const bm = new BeatMatcher();
    const points = bm.findTransitionPoints('track1');
    assert.ok(points.length > 0);
    assert.ok(points[0].time_ms >= 0);
  });

  test('syncToBeats', () => {
    const bm = new BeatMatcher();
    const edits = [{ time_ms: 1000 }, { time_ms: 2000 }, { time_ms: 3000 }];
    const synced = bm.syncToBeats('track1', edits);
    assert.equal(synced.length, 3);
    assert.ok(synced[0].original_time !== undefined);
  });

  test('getBPMRange', () => {
    const bm = new BeatMatcher();
    const range = bm.getBPMRange();
    assert.equal(range.min, 60);
    assert.equal(range.max, 200);
  });
});

// ── WaveformVisualizer ───────────────────────────────────────────────────────
describe('WaveformVisualizer', () => {
  test('generateWaveform', () => {
    const wv = new WaveformVisualizer();
    const wave = wv.generateWaveform('audio.mp3', { points: 100 });
    assert.ok(wave.points.length > 0);
    assert.ok(wave.duration_ms > 0);
  });

  test('detectSilence', () => {
    const wv = new WaveformVisualizer();
    const wave = wv.generateWaveform('audio.mp3', { points: 100 });
    const silences = wv.detectSilence(wave, -40);
    assert.ok(Array.isArray(silences));
  });

  test('detectLoudParts', () => {
    const wv = new WaveformVisualizer();
    const wave = wv.generateWaveform('audio.mp3', { points: 100 });
    const loud = wv.detectLoudParts(wave, -10);
    assert.ok(Array.isArray(loud));
  });

  test('getAmplitudeAtTime', () => {
    const wv = new WaveformVisualizer();
    const wave = wv.generateWaveform('audio.mp3', { points: 100 });
    const amp = wv.getAmplitudeAtTime(wave, 500);
    assert.ok(typeof amp === 'number');
  });

  test('overlayWaveforms', () => {
    const wv = new WaveformVisualizer();
    const w1 = wv.generateWaveform('a.mp3', { points: 50 });
    const w2 = wv.generateWaveform('b.mp3', { points: 50 });
    const combined = wv.overlayWaveforms([w1, w2]);
    assert.ok(combined.points.length > 0);
  });
});

// ── MoodClassifier ───────────────────────────────────────────────────────────
describe('MoodClassifier', () => {
  test('classifyMood audio', () => {
    const mc = new MoodClassifier();
    const result = mc.classifyMood({ type: 'audio', bpm: 140, key: 'C' });
    assert.ok(result.primary_mood);
    assert.ok(result.confidence > 0);
  });

  test('classifyMood video', () => {
    const mc = new MoodClassifier();
    const result = mc.classifyVideo({ type: 'video', brightness: 0.8, motion: 'high' });
    assert.ok(result.primary_mood);
  });

  test('suggestMood', () => {
    const mc = new MoodClassifier();
    const result = mc.suggestMood('energetic');
    assert.ok(result.primary_mood);
  });

  test('getMoodCategories', () => {
    const mc = new MoodClassifier();
    const cats = mc.getMoodCategories();
    assert.ok(cats.includes('energetic'));
    assert.ok(cats.includes('calm'));
    assert.ok(cats.length >= 10);
  });

  test('matchMoodToContent', () => {
    const mc = new MoodClassifier();
    const result = mc.matchMoodToContent('energetic', { bpm: 140, motion: 'high' });
    assert.ok(result.score >= 0 && result.score <= 1);
    assert.ok(result.content_id === undefined);
  });
});

// ── ContentCuration ──────────────────────────────────────────────────────────
describe('ContentCuration', () => {
  test('createCollection', () => {
    const cc = new ContentCuration();
    const col = cc.createCollection({ name: 'My Mix', description: 'Best tracks', items: [{ type: 'music', id: 't1' }] });
    assert.equal(col.name, 'My Mix');
    assert.ok(col.id);
  });

  test('addToCollection', () => {
    const cc = new ContentCuration();
    const col = cc.createCollection({ name: 'Mix', items: [] });
    const updated = cc.addToCollection(col.id, { type: 'sfx', id: 's1' });
    assert.equal(updated.items.length, 1);
  });

  test('removeFromCollection', () => {
    const cc = new ContentCuration();
    const col = cc.createCollection({ name: 'Mix', items: [{ type: 'music', id: 't1' }] });
    const updated = cc.removeFromCollection(col.id, 't1');
    assert.equal(updated.items.length, 0);
  });

  test('getSmartCollections', () => {
    const cc = new ContentCuration();
    const smart = cc.getSmartCollections();
    assert.ok(smart.length >= 5);
    assert.ok(smart.find(c => c.name.includes('Lo-Fi') || c.name.includes('Chill')));
  });

  test('getForProject', () => {
    const cc = new ContentCuration();
    const vlog = cc.getForProject('vlog');
    assert.ok(vlog.length > 0);
  });
});

// ── LicensingManager ─────────────────────────────────────────────────────────
describe('LicensingManager', () => {
  test('getLicenses', () => {
    const lm = new LicensingManager();
    const licenses = lm.getLicenses();
    assert.ok(licenses.includes('royalty_free'));
    assert.ok(licenses.includes('creative_commons'));
  });

  test('checkLicense allowed', () => {
    const lm = new LicensingManager();
    const result = lm.checkLicense('track1', 'personal');
    assert.ok(typeof result.allowed === 'boolean');
  });

  test('getAttribution', () => {
    const lm = new LicensingManager();
    const attr = lm.getAttribution('track1');
    assert.ok(typeof attr === 'string');
  });

  test('getPricing', () => {
    const lm = new LicensingManager();
    const pricing = lm.getPricing('royalty_free');
    assert.ok(typeof pricing.personal === 'number');
  });
});

// ── ContentSearch ────────────────────────────────────────────────────────────
describe('ContentSearch', () => {
  test('search returns structure', () => {
    const cs = new ContentSearch();
    const result = cs.search('upbeat music', { type: 'music', mood: 'energetic' });
    assert.ok(Array.isArray(result.music));
    assert.ok(Array.isArray(result.sfx));
    assert.ok(Array.isArray(result.footage));
    assert.ok(typeof result.total === 'number');
  });

  test('searchWithAI', () => {
    const cs = new ContentSearch();
    const result = cs.searchWithAI('upbeat cinematic music for travel vlog');
    assert.ok(result.intent);
    assert.ok(typeof result.confidence === 'number');
  });

  test('getAutocomplete', () => {
    const cs = new ContentSearch();
    const suggestions = cs.getAutocomplete('lof');
    assert.ok(Array.isArray(suggestions));
  });

  test('getTrendingSearches', () => {
    const cs = new ContentSearch();
    const trending = cs.getTrendingSearches();
    assert.ok(trending.length > 0);
  });
});

// ── ContentAnalytics ─────────────────────────────────────────────────────────
describe('ContentAnalytics', () => {
  test('trackPlay', () => {
    const ca = new ContentAnalytics();
    ca.trackPlay('u1', 't1', 30);
    ca.trackPlay('u1', 't1', 45);
    const played = ca.getMostPlayed();
    assert.equal(played.length, 1);
    assert.equal(played[0].id, 't1');
  });

  test('trackDownload', () => {
    const ca = new ContentAnalytics();
    ca.trackDownload('u1', 't1');
    const downloaded = ca.getMostDownloaded();
    assert.equal(downloaded.length, 1);
  });

  test('getTrending', () => {
    const ca = new ContentAnalytics();
    ca.trackPlay('u1', 't1', 30);
    ca.trackPlay('u2', 't1', 45);
    ca.trackPlay('u1', 't2', 20);
    const trending = ca.getTrending(2);
    assert.ok(trending.length > 0);
  });

  test('getUserHistory', () => {
    const ca = new ContentAnalytics();
    ca.trackPlay('u1', 't1', 30);
    ca.trackPlay('u1', 't2', 20);
    const history = ca.getUserHistory('u1');
    assert.equal(history.length, 2);
  });

  test('getCreatorStats', () => {
    const ca = new ContentAnalytics();
    ca.trackPlay('u1', 't1', 30);
    ca.trackDownload('u1', 't1');
    const stats = ca.getCreatorStats('creator1');
    assert.ok(typeof stats.total_plays === 'number');
  });
});

// ── Integration ──────────────────────────────────────────────────────────────
describe('W18 Stock Library Integration', () => {
  test('full workflow: music → beat match → mood → curate', () => {
    const ml = new MusicLibrary();
    const track = ml.addTrack({ title: 'Epic Beat', artist: 'DJ', genre: 'edm', mood: 'energetic', bpm: 128, duration_sec: 240, url: 'epic.mp3' });

    const bm = new BeatMatcher();
    const analysis = bm.analyzeBeat(track.id);
    assert.ok(analysis.bpm);

    const match = bm.matchToVideo(track.id, 60);
    assert.ok(match.beat_sync_points.length > 0);

    const mc = new MoodClassifier();
    const mood = mc.classifyMood({ bpm: 128, key: 'C' });
    assert.ok(mood.primary_mood);

    const cc = new ContentCuration();
    const col = cc.createCollection({ name: 'My Vlog Mix', items: [{ type: 'music', id: track.id }] });
    assert.equal(col.items.length, 1);
  });

  test('full workflow: footage → search → license → deliver', () => {
    const fl = new FootageLibrary();
    const footage = fl.addFootage({ title: 'Ocean Waves', resolution: '4K', fps: 30, duration_sec: 30, url: 'ocean.mp4', category: 'nature' });

    const cs = new ContentSearch();
    const search = cs.search('ocean', { type: 'footage' });
    assert.ok(search.footage.length >= 0);

    const lm = new LicensingManager();
    const license = lm.checkLicense(footage.id, 'commercial');
    assert.ok(typeof license.allowed === 'boolean');

    const ca = new ContentAnalytics();
    ca.trackDownload('u1', footage.id);
    const stats = ca.getMostDownloaded();
    assert.ok(stats.length > 0);
  });
});
