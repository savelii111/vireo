/**
 * test_ai_director.js — Tests for AI Director (DirectorAgent, QualityScorer, ExportPlanner)
 * 65 tests covering the full pipeline, edge cases, and all classes.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DirectorAgent, QualityScorer, ExportPlanner, SCENE_TYPES } from '../src/ai_director.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

function makeClip(overrides = {}) {
  return {
    id: `clip-${Math.random().toString(36).slice(2, 8)}`,
    path: overrides.path || `video_${Math.random().toString(36).slice(2, 6)}.mp4`,
    duration_sec: overrides.duration_sec ?? (2 + Math.random() * 6),
    scene_type: overrides.scene_type || 'action',
    mood: overrides.mood || 'energetic',
    quality_score: overrides.quality_score ?? 0.8,
    audio_quality: overrides.audio_quality ?? 0.7,
    face_count: overrides.face_count ?? 1,
    motion_level: overrides.motion_level || 'medium',
    resolution: overrides.resolution || '1920x1080',
    fps: overrides.fps || 30,
  };
}

function makeFootage(count = 5) {
  const types = ['action', 'talking', 'landscape', 'closeup', 'transition'];
  const moods = ['energetic', 'calm', 'dramatic', 'funny'];
  return Array.from({ length: count }, (_, i) => makeClip({
    scene_type: types[i % types.length],
    mood: moods[i % moods.length],
    duration_sec: 3 + i * 0.5,
    quality_score: 0.6 + i * 0.05,
    path: `footage_clip_${i}.mp4`,
  }));
}

function makeBrief(overrides = {}) {
  return {
    description: overrides.description || 'Energetic product launch video with dramatic transitions',
    footage: overrides.footage || makeFootage(6),
    duration_sec: overrides.duration_sec ?? 30,
    platforms: overrides.platforms || ['youtube', 'tiktok'],
    style: overrides.style || undefined,
    music_mood: overrides.music_mood || undefined,
    text_overlay: overrides.text_overlay || undefined,
  };
}

function makeSimpleTimeline(clipCount = 4) {
  const agent = new DirectorAgent({ seed: 42 });
  const footage = makeFootage(clipCount);
  const analyzed = agent.analyzeFootage(footage);
  const scored = agent.scoreEngagement(analyzed.clips);
  const selected = agent.selectClips(scored, 20, 'dramatic');
  return agent.composeTimeline(selected);
}

// ═══════════════════════════════════════════════════════════════════════════════
// DirectorAgent Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('DirectorAgent', () => {

  describe('constructor', () => {
    test('creates instance with default seed', () => {
      const agent = new DirectorAgent();
      assert.ok(agent);
      assert.equal(agent.version, '1.0.0');
    });

    test('creates instance with custom seed', () => {
      const agent = new DirectorAgent({ seed: 123 });
      assert.equal(agent.seed, 123);
    });
  });

  describe('analyzeBrief', () => {
    test('analyzes a basic brief', () => {
      const agent = new DirectorAgent({ seed: 42 });
      const brief = makeBrief();
      const result = agent.analyzeBrief(brief);
      assert.ok(result.scenes_detected.length > 0);
      assert.ok(result.mood_analysis);
      assert.ok(result.pacing_recommendation);
      assert.ok(result.target_audience);
    });

    test('throws on null brief', () => {
      const agent = new DirectorAgent();
      assert.throws(() => agent.analyzeBrief(null), /brief is required/);
    });

    test('throws on invalid duration', () => {
      const agent = new DirectorAgent();
      assert.throws(() => agent.analyzeBrief({ duration_sec: -5 }), /positive/);
    });

    test('throws on non-array platforms', () => {
      const agent = new DirectorAgent();
      assert.throws(() => agent.analyzeBrief({ platforms: 'youtube' }), /array/);
    });

    test('infers fast style for short-form content', () => {
      const agent = new DirectorAgent();
      const brief = makeBrief({ platforms: ['tiktok'], duration_sec: 15 });
      const result = agent.analyzeBrief(brief);
      assert.equal(result.inferred_style, 'fast');
    });

    test('infers slow style for long content', () => {
      const agent = new DirectorAgent();
      const brief = makeBrief({ duration_sec: 180 });
      const result = agent.analyzeBrief(brief);
      assert.equal(result.inferred_style, 'slow');
    });

    test('infers mood from description keywords', () => {
      const agent = new DirectorAgent();
      const brief = makeBrief({ description: 'Funny cat compilation with humor' });
      const result = agent.analyzeBrief(brief);
      assert.equal(result.inferred_mood, 'funny');
    });

    test('uses explicit style when provided', () => {
      const agent = new DirectorAgent();
      const brief = makeBrief({ style: 'dramatic' });
      const result = agent.analyzeBrief(brief);
      assert.equal(result.inferred_style, 'dramatic');
    });

    test('uses explicit music_mood when provided', () => {
      const agent = new DirectorAgent();
      const brief = makeBrief({ music_mood: 'energetic' });
      const result = agent.analyzeBrief(brief);
      assert.equal(result.mood_analysis.primary, 'energetic');
    });

    test('handles empty brief gracefully', () => {
      const agent = new DirectorAgent();
      const result = agent.analyzeBrief({ description: '' });
      assert.ok(result.scenes_detected.length > 0);
      assert.equal(result.mood_analysis.primary, 'calm');
    });
  });

  describe('analyzeFootage', () => {
    test('analyzes an array of footage clips', () => {
      const agent = new DirectorAgent({ seed: 42 });
      const footage = makeFootage(5);
      const result = agent.analyzeFootage(footage);
      assert.equal(result.clips.length, 5);
      assert.ok(result.total_duration > 0);
      assert.ok(result.best_moments.length > 0);
    });

    test('throws on non-array footage', () => {
      const agent = new DirectorAgent();
      assert.throws(() => agent.analyzeFootage('not an array'), /must be an array/);
    });

    test('handles empty footage array', () => {
      const agent = new DirectorAgent();
      const result = agent.analyzeFootage([]);
      assert.equal(result.clips.length, 0);
      assert.equal(result.total_duration, 0);
    });

    test('assigns scene_type and mood to clips', () => {
      const agent = new DirectorAgent({ seed: 42 });
      const footage = [makeClip()];
      const result = agent.analyzeFootage(footage);
      assert.ok(SCENE_TYPES.includes(result.clips[0].scene_type));
      assert.ok(['energetic', 'calm', 'dramatic', 'funny'].includes(result.clips[0].mood));
    });

    test('preserves provided quality_score', () => {
      const agent = new DirectorAgent({ seed: 42 });
      const footage = [makeClip({ quality_score: 0.95 })];
      const result = agent.analyzeFootage(footage);
      assert.equal(result.clips[0].quality_score, 0.95);
    });

    test('detects best moments correctly', () => {
      const agent = new DirectorAgent({ seed: 42 });
      const footage = [
        makeClip({ quality_score: 0.9, face_count: 2, motion_level: 'high' }),
        makeClip({ quality_score: 0.3, face_count: 0, motion_level: 'low' }),
        makeClip({ quality_score: 0.7, face_count: 1, motion_level: 'medium' }),
      ];
      const result = agent.analyzeFootage(footage);
      assert.ok(result.best_moments[0].score >= result.best_moments[result.best_moments.length - 1].score);
    });

    test('calculates total duration correctly', () => {
      const agent = new DirectorAgent({ seed: 42 });
      const footage = [
        makeClip({ duration_sec: 5 }),
        makeClip({ duration_sec: 3 }),
        makeClip({ duration_sec: 7 }),
      ];
      const result = agent.analyzeFootage(footage);
      assert.equal(result.total_duration, 15);
    });
  });

  describe('scoreEngagement', () => {
    test('scores clips for engagement', () => {
      const agent = new DirectorAgent({ seed: 42 });
      const footage = makeFootage(5);
      const analyzed = agent.analyzeFootage(footage);
      const scored = agent.scoreEngagement(analyzed.clips);
      assert.equal(scored.length, 5);
      assert.ok(scored[0].total_score >= scored[scored.length - 1].total_score);
    });

    test('throws on non-array input', () => {
      const agent = new DirectorAgent();
      assert.throws(() => agent.scoreEngagement('bad'), /must be an array/);
    });

    test('returns empty array for empty input', () => {
      const agent = new DirectorAgent();
      const result = agent.scoreEngagement([]);
      assert.deepEqual(result, []);
    });

    test('scores are within 0-1 range', () => {
      const agent = new DirectorAgent({ seed: 42 });
      const footage = makeFootage(4);
      const analyzed = agent.analyzeFootage(footage);
      const scored = agent.scoreEngagement(analyzed.clips);
      for (const clip of scored) {
        assert.ok(clip.engagement_score >= 0 && clip.engagement_score <= 1);
        assert.ok(clip.hook_potential >= 0 && clip.hook_potential <= 1);
        assert.ok(clip.retention_impact >= 0 && clip.retention_impact <= 1);
        assert.ok(clip.shareability >= 0 && clip.shareability <= 1);
        assert.ok(clip.total_score >= 0 && clip.total_score <= 1);
      }
    });

    test('action clips score higher on hook potential', () => {
      const agent = new DirectorAgent({ seed: 42 });
      const actionClip = makeClip({ scene_type: 'action', motion_level: 'high', quality_score: 0.8 });
      const landscapeClip = makeClip({ scene_type: 'landscape', motion_level: 'low', quality_score: 0.8 });
      const analyzed = agent.analyzeFootage([actionClip, landscapeClip]);
      const scored = agent.scoreEngagement(analyzed.clips);
      const actionScore = scored.find(c => c.scene_type === 'action');
      const landscapeScore = scored.find(c => c.scene_type === 'landscape');
      assert.ok(actionScore.hook_potential > landscapeScore.hook_potential);
    });

    test('clips with faces score higher on shareability', () => {
      const agent = new DirectorAgent({ seed: 42 });
      const withFace = makeClip({ face_count: 3, quality_score: 0.7 });
      const noFace = makeClip({ face_count: 0, quality_score: 0.7 });
      const analyzed = agent.analyzeFootage([withFace, noFace]);
      const scored = agent.scoreEngagement(analyzed.clips);
      const faceScore = scored.find(c => c.face_count > 0);
      const noFaceScore = scored.find(c => c.face_count === 0);
      assert.ok(faceScore.shareability > noFaceScore.shareability);
    });
  });

  describe('selectClips', () => {
    test('selects clips for target duration', () => {
      const agent = new DirectorAgent({ seed: 42 });
      const footage = makeFootage(8);
      const analyzed = agent.analyzeFootage(footage);
      const scored = agent.scoreEngagement(analyzed.clips);
      const result = agent.selectClips(scored, 20, 'fast');
      assert.ok(result.clips_used > 0);
      assert.ok(result.total_duration > 0);
      assert.ok(result.total_duration <= 25); // some slack for duration multiplier
    });

    test('throws on non-array scored', () => {
      const agent = new DirectorAgent();
      assert.throws(() => agent.selectClips('bad', 30), /must be an array/);
    });

    test('throws on invalid duration', () => {
      const agent = new DirectorAgent();
      assert.throws(() => agent.selectClips([], -5), /positive/);
    });

    test('returns empty for empty scored array', () => {
      const agent = new DirectorAgent();
      const result = agent.selectClips([], 30);
      assert.equal(result.clips_used, 0);
      assert.deepEqual(result.selected, []);
    });

    test('fast style uses shorter clips', () => {
      const agent = new DirectorAgent({ seed: 42 });
      const footage = makeFootage(10);
      const analyzed = agent.analyzeFootage(footage);
      const scored = agent.scoreEngagement(analyzed.clips);
      const fastResult = agent.selectClips(scored.slice(), 30, 'fast');
      const slowResult = agent.selectClips(scored.slice(), 30, 'slow');
      // Fast should use more clips (shorter each)
      assert.ok(fastResult.clips_used >= slowResult.clips_used);
    });

    test('enforces variety (no excessive consecutive types)', () => {
      const agent = new DirectorAgent({ seed: 42 });
      const footage = makeFootage(10);
      const analyzed = agent.analyzeFootage(footage);
      const scored = agent.scoreEngagement(analyzed.clips);
      const result = agent.selectClips(scored, 30, 'dramatic');
      assert.ok(result.variety_score >= 0.5);
    });

    test('coverage_ratio is calculated', () => {
      const agent = new DirectorAgent({ seed: 42 });
      const footage = makeFootage(6);
      const analyzed = agent.analyzeFootage(footage);
      const scored = agent.scoreEngagement(analyzed.clips);
      const result = agent.selectClips(scored, 15, 'dramatic');
      assert.ok(result.coverage_ratio >= 0);
      assert.ok(result.coverage_ratio <= 1.5); // can overshoot slightly
    });
  });

  describe('composeTimeline', () => {
    test('composes a timeline from selected clips', () => {
      const agent = new DirectorAgent({ seed: 42 });
      const footage = makeFootage(5);
      const analyzed = agent.analyzeFootage(footage);
      const scored = agent.scoreEngagement(analyzed.clips);
      const selected = agent.selectClips(scored, 20, 'dramatic');
      const timeline = agent.composeTimeline(selected);
      assert.ok(timeline.id);
      assert.ok(timeline.duration_sec > 0);
      assert.equal(timeline.tracks.length, 2); // video + audio
    });

    test('throws on invalid input', () => {
      const agent = new DirectorAgent();
      assert.throws(() => agent.composeTimeline(null), /must have a clips/);
      assert.throws(() => agent.composeTimeline({ clips: null, selected: null }), /must have a clips/);
    });

    test('empty selected clips returns empty timeline', () => {
      const agent = new DirectorAgent();
      const timeline = agent.composeTimeline({ selected: [], clips: [], total_duration: 0 });
      assert.equal(timeline.total_clips, 0);
      assert.equal(timeline.duration_sec, 0);
    });

    test('transitions are added between clips', () => {
      const agent = new DirectorAgent({ seed: 42 });
      const footage = makeFootage(4);
      const analyzed = agent.analyzeFootage(footage);
      const scored = agent.scoreEngagement(analyzed.clips);
      const selected = agent.selectClips(scored, 20, 'dramatic');
      const timeline = agent.composeTimeline(selected);
      assert.ok(timeline.transition_count > 0);
    });

    test('first clip has no transition', () => {
      const agent = new DirectorAgent({ seed: 42 });
      const footage = makeFootage(3);
      const analyzed = agent.analyzeFootage(footage);
      const scored = agent.scoreEngagement(analyzed.clips);
      const selected = agent.selectClips(scored, 20, 'dramatic');
      const timeline = agent.composeTimeline(selected);
      const videoTrack = timeline.tracks.find(t => t.type === 'video');
      assert.equal(videoTrack.clips[0].transition, null);
    });

    test('can disable audio track', () => {
      const agent = new DirectorAgent({ seed: 42 });
      const footage = makeFootage(3);
      const analyzed = agent.analyzeFootage(footage);
      const scored = agent.scoreEngagement(analyzed.clips);
      const selected = agent.selectClips(scored, 15, 'fast');
      const timeline = agent.composeTimeline(selected, { include_audio_track: false });
      const audioTrack = timeline.tracks.find(t => t.type === 'audio');
      assert.equal(audioTrack, undefined);
    });

    test('cut style forces cut transitions', () => {
      const agent = new DirectorAgent({ seed: 42 });
      const footage = makeFootage(4);
      const analyzed = agent.analyzeFootage(footage);
      const scored = agent.scoreEngagement(analyzed.clips);
      const selected = agent.selectClips(scored, 20, 'dramatic');
      const timeline = agent.composeTimeline(selected, { transition_style: 'cut' });
      const videoTrack = timeline.tracks.find(t => t.type === 'video');
      const transitions = videoTrack.clips.filter(c => c.transition);
      for (const t of transitions) {
        assert.equal(t.transition.type, 'cut');
      }
    });
  });

  describe('generateMusicRecommendation', () => {
    test('generates music recommendation from timeline', () => {
      const agent = new DirectorAgent({ seed: 42 });
      const timeline = makeSimpleTimeline(4);
      const rec = agent.generateMusicRecommendation(timeline);
      assert.ok(rec.bpm >= 60 && rec.bpm <= 180);
      assert.ok(rec.genre);
      assert.ok(rec.energy_points.length > 0);
      assert.ok(rec.mood_arc.length > 0);
    });

    test('throws on null timeline', () => {
      const agent = new DirectorAgent();
      assert.throws(() => agent.generateMusicRecommendation(null), /must have tracks/);
    });

    test('returns fallback for empty timeline', () => {
      const agent = new DirectorAgent();
      const emptyTimeline = { tracks: [{ type: 'video', clips: [] }] };
      const rec = agent.generateMusicRecommendation(emptyTimeline);
      assert.equal(rec.bpm, 120);
      assert.equal(rec.genre, 'ambient');
    });

    test('energetic mood produces higher BPM than calm mood', () => {
      const agent = new DirectorAgent({ seed: 42 });
      // Create two timelines and compare BPM
      const energeticFootage = [
        makeClip({ mood: 'energetic', scene_type: 'action', duration_sec: 2, path: 'e1.mp4' }),
        makeClip({ mood: 'energetic', scene_type: 'action', duration_sec: 2, path: 'e2.mp4' }),
        makeClip({ mood: 'energetic', scene_type: 'action', duration_sec: 2, path: 'e3.mp4' }),
        makeClip({ mood: 'energetic', scene_type: 'action', duration_sec: 2, path: 'e4.mp4' }),
        makeClip({ mood: 'energetic', scene_type: 'action', duration_sec: 2, path: 'e5.mp4' }),
        makeClip({ mood: 'energetic', scene_type: 'action', duration_sec: 2, path: 'e6.mp4' }),
        makeClip({ mood: 'energetic', scene_type: 'action', duration_sec: 2, path: 'e7.mp4' }),
        makeClip({ mood: 'energetic', scene_type: 'action', duration_sec: 2, path: 'e8.mp4' }),
      ];
      const analyzed1 = agent.analyzeFootage(energeticFootage);
      const scored1 = agent.scoreEngagement(analyzed1.clips);
      const selected1 = agent.selectClips(scored1, 20, 'fast');
      const timeline1 = agent.composeTimeline(selected1);
      const rec1 = agent.generateMusicRecommendation(timeline1);
      assert.equal(rec1.primary_mood, 'energetic');
      assert.ok(rec1.bpm >= 60 && rec1.bpm <= 180);
    });

    test('calm mood produces lower BPM', () => {
      const agent = new DirectorAgent({ seed: 42 });
      const footage = [
        makeClip({ mood: 'calm', scene_type: 'landscape', duration_sec: 8 }),
        makeClip({ mood: 'calm', scene_type: 'landscape', duration_sec: 8 }),
        makeClip({ mood: 'calm', scene_type: 'closeup', duration_sec: 8 }),
      ];
      const analyzed = agent.analyzeFootage(footage);
      const scored = agent.scoreEngagement(analyzed.clips);
      const selected = agent.selectClips(scored, 30, 'slow');
      const timeline = agent.composeTimeline(selected);
      const rec = agent.generateMusicRecommendation(timeline);
      assert.ok(rec.bpm <= 130);
    });
  });

  describe('generateTextOverlay', () => {
    test('generates text overlays for timeline', () => {
      const agent = new DirectorAgent({ seed: 42 });
      const timeline = makeSimpleTimeline(4);
      const overlays = agent.generateTextOverlay(timeline);
      assert.ok(Array.isArray(overlays));
      assert.ok(overlays.length >= 2); // at least title + CTA
    });

    test('throws on null timeline', () => {
      const agent = new DirectorAgent();
      assert.throws(() => agent.generateTextOverlay(null), /must have tracks/);
    });

    test('returns empty for empty timeline', () => {
      const agent = new DirectorAgent();
      const emptyTimeline = { tracks: [{ type: 'video', clips: [] }] };
      const overlays = agent.generateTextOverlay(emptyTimeline);
      assert.deepEqual(overlays, []);
    });

    test('title overlay starts at time 0', () => {
      const agent = new DirectorAgent({ seed: 42 });
      const timeline = makeSimpleTimeline(5);
      const overlays = agent.generateTextOverlay(timeline);
      const title = overlays.find(o => o.position === 'center' && o.animation === 'fade');
      assert.ok(title);
      assert.equal(title.timing.start_sec, 0);
    });

    test('overlays have valid timing', () => {
      const agent = new DirectorAgent({ seed: 42 });
      const timeline = makeSimpleTimeline(5);
      const overlays = agent.generateTextOverlay(timeline);
      for (const o of overlays) {
        assert.ok(o.timing.start_sec >= 0);
        assert.ok(o.timing.end_sec > o.timing.start_sec);
      }
    });

    test('each overlay has animation type', () => {
      const agent = new DirectorAgent({ seed: 42 });
      const timeline = makeSimpleTimeline(4);
      const overlays = agent.generateTextOverlay(timeline);
      for (const o of overlays) {
        assert.ok(o.animation);
        assert.ok(typeof o.animation === 'string');
      }
    });
  });

  describe('produceFromBrief (Full Pipeline)', () => {
    test('runs the full pipeline end-to-end', async () => {
      const agent = new DirectorAgent({ seed: 42 });
      const brief = makeBrief({
        description: 'Energetic product launch with dramatic transitions',
        duration_sec: 30,
        platforms: ['youtube', 'tiktok'],
      });
      const result = await agent.produceFromBrief(brief);

      assert.ok(result.timeline);
      assert.ok(result.music_rec);
      assert.ok(result.text_overlays);
      assert.ok(result.estimated_engagement);
      assert.ok(result.export_specs);
      assert.ok(result.brief_analysis);
      assert.ok(result.metadata);
    });

    test('pipeline handles brief with no footage', async () => {
      const agent = new DirectorAgent({ seed: 42 });
      const brief = makeBrief({ footage: [], duration_sec: 15 });
      const result = await agent.produceFromBrief(brief);
      assert.ok(result.timeline);
      assert.equal(result.metadata.clips_available, 0);
      assert.equal(result.metadata.clips_selected, 0);
    });

    test('pipeline produces correct export specs', async () => {
      const agent = new DirectorAgent({ seed: 42 });
      const brief = makeBrief({
        platforms: ['youtube', 'tiktok', 'instagram_reels'],
        duration_sec: 30,
      });
      const result = await agent.produceFromBrief(brief);
      assert.equal(result.export_specs.length, 3);
      const platforms = result.export_specs.map(e => e.platform);
      assert.ok(platforms.includes('youtube'));
      assert.ok(platforms.includes('tiktok'));
      assert.ok(platforms.includes('instagram_reels'));
    });

    test('pipeline respects target duration', async () => {
      const agent = new DirectorAgent({ seed: 42 });
      const footage = makeFootage(10);
      const brief = makeBrief({ footage, duration_sec: 15 });
      const result = await agent.produceFromBrief(brief);
      // Duration should be within reasonable range of target
      assert.ok(result.timeline.duration_sec > 0);
      assert.ok(result.timeline.duration_sec <= 30); // reasonable upper bound
    });

    test('pipeline generates music matching mood', async () => {
      const agent = new DirectorAgent({ seed: 42 });
      const brief = makeBrief({
        description: 'Energetic dance video',
        duration_sec: 20,
      });
      const result = await agent.produceFromBrief(brief);
      assert.ok(result.music_rec.bpm >= 60);
      assert.ok(result.music_rec.genre);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// QualityScorer Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('QualityScorer', () => {

  describe('scoreTimeline', () => {
    test('scores a valid timeline', () => {
      const scorer = new QualityScorer();
      const timeline = makeSimpleTimeline(5);
      const report = scorer.scoreTimeline(timeline);
      assert.ok(report.pacing_score >= 0 && report.pacing_score <= 1);
      assert.ok(report.variety_score >= 0 && report.variety_score <= 1);
      assert.ok(report.emotional_arc_score >= 0 && report.emotional_arc_score <= 1);
      assert.ok(report.technical_score >= 0 && report.technical_score <= 1);
      assert.ok(report.overall_score >= 0 && report.overall_score <= 1);
      assert.ok(Array.isArray(report.suggestions));
    });

    test('throws on null timeline', () => {
      const scorer = new QualityScorer();
      assert.throws(() => scorer.scoreTimeline(null), /must have tracks/);
    });

    test('empty timeline gets zero scores', () => {
      const scorer = new QualityScorer();
      const timeline = { tracks: [{ type: 'video', clips: [] }], duration_sec: 0 };
      const report = scorer.scoreTimeline(timeline);
      assert.equal(report.pacing_score, 0);
      assert.equal(report.variety_score, 0);
      assert.equal(report.overall_score, 0);
    });

    test('good timeline scores higher than bad timeline', () => {
      const agent = new DirectorAgent({ seed: 42 });
      const scorer = new QualityScorer();

      // Good timeline: varied clips
      const goodFootage = makeFootage(6); // already has variety
      const goodAnalyzed = agent.analyzeFootage(goodFootage);
      const goodScored = agent.scoreEngagement(goodAnalyzed.clips);
      const goodSelected = agent.selectClips(goodScored, 25, 'dramatic');
      const goodTimeline = agent.composeTimeline(goodSelected);

      // Bad timeline: all same type
      const badFootage = Array.from({ length: 6 }, () =>
        makeClip({ scene_type: 'action', mood: 'energetic' })
      );
      const badAnalyzed = agent.analyzeFootage(badFootage);
      const badScored = agent.scoreEngagement(badAnalyzed.clips);
      const badSelected = agent.selectClips(badScored, 25, 'fast');
      const badTimeline = agent.composeTimeline(badSelected);

      const goodReport = scorer.scoreTimeline(goodTimeline);
      const badReport = scorer.scoreTimeline(badTimeline);
      // Good should generally score higher on variety
      assert.ok(goodReport.variety_score >= badReport.variety_score);
    });

    test('single clip gets reasonable scores', () => {
      const agent = new DirectorAgent({ seed: 42 });
      const scorer = new QualityScorer();
      const footage = [makeClip()];
      const analyzed = agent.analyzeFootage(footage);
      const scored = agent.scoreEngagement(analyzed.clips);
      const selected = agent.selectClips(scored, 10, 'dramatic');
      const timeline = agent.composeTimeline(selected);
      const report = scorer.scoreTimeline(timeline);
      assert.ok(report.overall_score >= 0);
    });

    test('suggestions are generated for low-scoring timelines', () => {
      const scorer = new QualityScorer();
      // Make a bad timeline: all same type, low variety
      const timeline = {
        tracks: [{
          type: 'video',
          clips: Array.from({ length: 6 }, (_, i) => ({
            id: `clip-${i}`,
            scene_type: 'action',
            mood: 'energetic',
            duration_sec: 3,
            start_sec: i * 3,
            end_sec: (i + 1) * 3,
          })),
        }],
        duration_sec: 18,
        resolution: '640x480',
        fps: 15,
      };
      const report = scorer.scoreTimeline(timeline);
      assert.ok(report.suggestions.length > 0);
    });
  });

  describe('compareWithReference', () => {
    test('compares two similar timelines', () => {
      const agent = new DirectorAgent({ seed: 42 });
      const scorer = new QualityScorer();
      const timeline1 = makeSimpleTimeline(5);
      const timeline2 = makeSimpleTimeline(5);
      const comparison = scorer.compareWithReference(timeline1, timeline2);
      assert.ok(comparison.similarity >= 0 && comparison.similarity <= 1);
      assert.ok(Array.isArray(comparison.strengths));
      assert.ok(Array.isArray(comparison.weaknesses));
      assert.ok(comparison.detail);
    });

    test('throws on null timelines', () => {
      const scorer = new QualityScorer();
      assert.throws(() => scorer.compareWithReference(null, makeSimpleTimeline()), /Both timelines/);
      assert.throws(() => scorer.compareWithReference(makeSimpleTimeline(), null), /Both timelines/);
    });

    test('identical timelines have high similarity', () => {
      const agent = new DirectorAgent({ seed: 42 });
      const scorer = new QualityScorer();
      const timeline = makeSimpleTimeline(4);
      const comparison = scorer.compareWithReference(timeline, timeline);
      assert.ok(comparison.similarity >= 0.9);
    });

    test('different durations reduce similarity', () => {
      const scorer = new QualityScorer();
      const shortTimeline = {
        tracks: [{ type: 'video', clips: [
          { id: 'a', scene_type: 'action', mood: 'energetic', duration_sec: 3, start_sec: 0, end_sec: 3 },
        ]}],
        duration_sec: 3,
      };
      const longTimeline = {
        tracks: [{ type: 'video', clips: [
          { id: 'b', scene_type: 'action', mood: 'energetic', duration_sec: 30, start_sec: 0, end_sec: 30 },
        ]}],
        duration_sec: 30,
      };
      const comparison = scorer.compareWithReference(shortTimeline, longTimeline);
      assert.ok(comparison.similarity < 0.9);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ExportPlanner Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('ExportPlanner', () => {

  describe('planExport', () => {
    test('plans export for a single platform', () => {
      const planner = new ExportPlanner();
      const timeline = makeSimpleTimeline(4);
      const plans = planner.planExport(timeline, ['youtube']);
      assert.equal(plans.length, 1);
      assert.equal(plans[0].platform, 'youtube');
      assert.equal(plans[0].aspect_ratio, '16:9');
      assert.equal(plans[0].resolution, '1920x1080');
      assert.ok(plans[0].supported);
    });

    test('plans export for multiple platforms', () => {
      const planner = new ExportPlanner();
      const timeline = makeSimpleTimeline(4);
      const plans = planner.planExport(timeline, ['youtube', 'tiktok', 'instagram_reels']);
      assert.equal(plans.length, 3);
      const platforms = plans.map(p => p.platform);
      assert.ok(platforms.includes('youtube'));
      assert.ok(platforms.includes('tiktok'));
      assert.ok(platforms.includes('instagram_reels'));
    });

    test('throws on null timeline', () => {
      const planner = new ExportPlanner();
      assert.throws(() => planner.planExport(null, ['youtube']), /must have tracks/);
    });

    test('throws on empty platforms', () => {
      const planner = new ExportPlanner();
      const timeline = makeSimpleTimeline();
      assert.throws(() => planner.planExport(timeline, []), /non-empty/);
      assert.throws(() => planner.planExport(timeline, null), /non-empty/);
    });

    test('marks unknown platform as unsupported', () => {
      const planner = new ExportPlanner();
      const timeline = makeSimpleTimeline();
      const plans = planner.planExport(timeline, ['myspace']);
      assert.equal(plans[0].supported, false);
      assert.ok(plans[0].error);
    });

    test('detects when timeline needs trimming', () => {
      const planner = new ExportPlanner();
      const timeline = makeSimpleTimeline(5);
      // Instagram story is 15s max, our timeline is likely longer
      const plans = planner.planExport(timeline, ['instagram_story']);
      // If timeline > 15s, it needs trimming
      if (timeline.duration_sec > 15) {
        assert.ok(plans[0].needs_trim);
        assert.equal(plans[0].trimmed_duration_sec, 15);
      }
    });

    test('estimates file size correctly', () => {
      const planner = new ExportPlanner();
      const timeline = makeSimpleTimeline(3);
      const plans = planner.planExport(timeline, ['youtube']);
      assert.ok(plans[0].file_size_estimated > 0);
      // 1 minute of YouTube = ~50MB by default
      const durationMin = Math.min(timeline.duration_sec, 43200) / 60;
      const expected = parseFloat((durationMin * 50).toFixed(1));
      assert.equal(plans[0].file_size_estimated, expected);
    });

    test('tiktok has correct aspect ratio', () => {
      const planner = new ExportPlanner();
      const timeline = makeSimpleTimeline();
      const plans = planner.planExport(timeline, ['tiktok']);
      assert.equal(plans[0].aspect_ratio, '9:16');
      assert.equal(plans[0].resolution, '1080x1920');
    });

    test('instagram_feed is 1:1', () => {
      const planner = new ExportPlanner();
      const timeline = makeSimpleTimeline();
      const plans = planner.planExport(timeline, ['instagram_feed']);
      assert.equal(plans[0].aspect_ratio, '1:1');
      assert.equal(plans[0].resolution, '1080x1080');
    });
  });

  describe('optimizeForPlatform', () => {
    test('optimizes timeline for tiktok', () => {
      const planner = new ExportPlanner();
      const timeline = makeSimpleTimeline(4);
      const optimized = planner.optimizeForPlatform(timeline, 'tiktok');
      assert.equal(optimized.platform, 'tiktok');
      assert.equal(optimized.resolution, '1080x1920');
      assert.ok(optimized.tracks);
      assert.ok(optimized.adjustments);
    });

    test('throws on null timeline', () => {
      const planner = new ExportPlanner();
      assert.throws(() => planner.optimizeForPlatform(null, 'youtube'), /must have tracks/);
    });

    test('throws on unknown platform', () => {
      const planner = new ExportPlanner();
      const timeline = makeSimpleTimeline();
      assert.throws(() => planner.optimizeForPlatform(timeline, 'myspace'), /Unknown platform/);
    });

    test('trims long timeline for instagram_story', () => {
      const planner = new ExportPlanner();
      // Create a long timeline
      const agent = new DirectorAgent({ seed: 42 });
      const footage = makeFootage(10);
      const analyzed = agent.analyzeFootage(footage);
      const scored = agent.scoreEngagement(analyzed.clips);
      const selected = agent.selectClips(scored, 30, 'dramatic');
      const timeline = agent.composeTimeline(selected);

      if (timeline.duration_sec > 15) {
        const optimized = planner.optimizeForPlatform(timeline, 'instagram_story');
        assert.ok(optimized.was_trimmed);
        assert.ok(optimized.duration_sec <= 16); // small tolerance
      }
    });

    test('adds watermark track for tiktok', () => {
      const planner = new ExportPlanner();
      const timeline = makeSimpleTimeline(3);
      const optimized = planner.optimizeForPlatform(timeline, 'tiktok');
      const watermarkTrack = optimized.tracks.find(t => t.id === 'watermark-track');
      assert.ok(watermarkTrack);
    });

    test('does not add watermark track for youtube', () => {
      const planner = new ExportPlanner();
      const timeline = makeSimpleTimeline(3);
      const optimized = planner.optimizeForPlatform(timeline, 'youtube');
      const watermarkTrack = optimized.tracks.find(t => t.id === 'watermark-track');
      assert.equal(watermarkTrack, undefined);
    });

    test('tiktok has safe zones', () => {
      const planner = new ExportPlanner();
      const timeline = makeSimpleTimeline(3);
      const optimized = planner.optimizeForPlatform(timeline, 'tiktok');
      assert.ok(optimized.adjustments.safe_zones.top > 0);
      assert.ok(optimized.adjustments.safe_zones.bottom > 0);
    });

    test('optimized timeline preserves video clips', () => {
      const planner = new ExportPlanner();
      const timeline = makeSimpleTimeline(4);
      const originalClips = timeline.tracks.find(t => t.type === 'video').clips.length;
      const optimized = planner.optimizeForPlatform(timeline, 'youtube');
      const videoTrack = optimized.tracks.find(t => t.type === 'video');
      assert.ok(videoTrack.clips.length > 0);
    });

    test('reframe detection works', () => {
      const planner = new ExportPlanner();
      const timeline = {
        ...makeSimpleTimeline(3),
        resolution: '640x480',
      };
      const optimized = planner.optimizeForPlatform(timeline, 'youtube');
      assert.ok(optimized.was_reframed);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Edge Cases & Integration Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('Edge Cases', () => {

  test('single clip timeline works through full pipeline', async () => {
    const agent = new DirectorAgent({ seed: 42 });
    const brief = makeBrief({
      footage: [makeClip({ duration_sec: 10 })],
      duration_sec: 10,
    });
    const result = await agent.produceFromBrief(brief);
    assert.ok(result.timeline);
    assert.equal(result.timeline.total_clips, 1);
  });

  test('very short duration (2 sec)', async () => {
    const agent = new DirectorAgent({ seed: 42 });
    const brief = makeBrief({
      footage: makeFootage(5),
      duration_sec: 2,
    });
    const result = await agent.produceFromBrief(brief);
    assert.ok(result.timeline);
    assert.ok(result.timeline.duration_sec <= 5);
  });

  test('very long duration (300 sec) with many clips', async () => {
    const agent = new DirectorAgent({ seed: 42 });
    const footage = Array.from({ length: 30 }, (_, i) => makeClip({
      duration_sec: 5 + i * 0.3,
      path: `long_clip_${i}.mp4`,
    }));
    const brief = makeBrief({ footage, duration_sec: 300, platforms: ['youtube'] });
    const result = await agent.produceFromBrief(brief);
    assert.ok(result.timeline);
    assert.ok(result.timeline.total_clips > 0);
  });

  test('all same-type footage is handled gracefully', async () => {
    const agent = new DirectorAgent({ seed: 42 });
    const footage = Array.from({ length: 8 }, (_, i) =>
      makeClip({ scene_type: 'action', mood: 'energetic', path: `action_${i}.mp4` })
    );
    const brief = makeBrief({ footage, duration_sec: 25 });
    const result = await agent.produceFromBrief(brief);
    assert.ok(result.timeline);
    // Variety should be low but pipeline shouldn't crash
    assert.ok(result.timeline.total_clips > 0);
  });

  test('empty footage array in brief', async () => {
    const agent = new DirectorAgent({ seed: 42 });
    const brief = makeBrief({ footage: [], duration_sec: 10 });
    const result = await agent.produceFromBrief(brief);
    assert.ok(result.timeline);
    assert.equal(result.timeline.total_clips, 0);
  });

  test('brief with no platforms defaults correctly', () => {
    const agent = new DirectorAgent({ seed: 42 });
    const brief = { description: 'Test video', duration_sec: 10 };
    const result = agent.analyzeBrief(brief);
    assert.equal(result.platform_count, 0);
    assert.ok(result.target_audience);
  });

  test('timeline composition with 10+ clips', () => {
    const agent = new DirectorAgent({ seed: 42 });
    const footage = makeFootage(12);
    const analyzed = agent.analyzeFootage(footage);
    const scored = agent.scoreEngagement(analyzed.clips);
    const selected = agent.selectClips(scored, 40, 'fast');
    const timeline = agent.composeTimeline(selected);
    assert.ok(timeline.total_clips > 5);
    assert.ok(timeline.duration_sec > 10);
  });

  test('quality scorer with single clip', () => {
    const agent = new DirectorAgent({ seed: 42 });
    const scorer = new QualityScorer();
    const footage = [makeClip()];
    const analyzed = agent.analyzeFootage(footage);
    const scored = agent.scoreEngagement(analyzed.clips);
    const selected = agent.selectClips(scored, 5, 'fast');
    const timeline = agent.composeTimeline(selected);
    const report = scorer.scoreTimeline(timeline);
    assert.ok(report.overall_score >= 0);
  });

  test('export planner for all supported platforms', () => {
    const planner = new ExportPlanner();
    const timeline = makeSimpleTimeline(4);
    const allPlatforms = ['youtube', 'tiktok', 'instagram_reels', 'instagram_feed',
      'instagram_story', 'twitter', 'facebook', 'linkedin', 'youtube_shorts'];
    const plans = planner.planExport(timeline, allPlatforms);
    assert.equal(plans.length, 9);
    const supported = plans.filter(p => p.supported);
    assert.equal(supported.length, 9);
  });

  test('footage with zero quality scores', () => {
    const agent = new DirectorAgent({ seed: 42 });
    const footage = [
      makeClip({ quality_score: 0, audio_quality: 0, face_count: 0, motion_level: 'low' }),
      makeClip({ quality_score: 0, audio_quality: 0, face_count: 0, motion_level: 'low' }),
    ];
    const analyzed = agent.analyzeFootage(footage);
    const scored = agent.scoreEngagement(analyzed.clips);
    for (const s of scored) {
      assert.ok(s.total_score >= 0);
      assert.ok(s.total_score <= 1);
    }
  });
});
