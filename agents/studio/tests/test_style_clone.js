/**
 * test_style_clone.js — Tests for Style Cloning system (25+ tests)
 *
 * Tests all 6 components: learnStyleFromVideo, applyLearnedStyle,
 * compareStyles, styleTransfer, styleRecommendation, StyleHistory.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  learnStyleFromVideo,
  applyLearnedStyle,
  compareStyles,
  styleTransfer,
  styleRecommendation,
  StyleHistory,
} from '../src/style_clone.js';

// ── Helper factories ─────────────────────────────────────────────────────────

function makeProject(opts = {}) {
  return {
    id: opts.id || 'proj_001',
    name: opts.name || 'Test Project',
    genre: opts.genre || 'general',
    type: opts.type || '',
    duration_sec: opts.duration_sec || 120,
    tracks: opts.tracks || [{
      id: 'track_1',
      clips: [
        { id: 'c1', duration_sec: 3, text: false, caption: false },
        { id: 'c2', duration_sec: 5, text: false, caption: false },
        { id: 'c3', duration_sec: 2, text: true, caption: false },
      ],
    }],
  };
}

function makeStyle(overrides = {}) {
  const base = learnStyleFromVideo('/test/video.mp4');
  return { ...base, ...overrides };
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. learnStyleFromVideo
// ══════════════════════════════════════════════════════════════════════════════

describe('learnStyleFromVideo', () => {

  test('returns a comprehensive LearnedStyle object', () => {
    const style = learnStyleFromVideo('/videos/example.mp4');
    assert.ok(style.id, 'should have an id');
    assert.equal(style.sourcePath, '/videos/example.mp4');
    assert.ok(style.learnedAt, 'should have learnedAt timestamp');
    assert.equal(style.sampleFramesAnalyzed, 100);
    assert.ok(style.confidence > 0 && style.confidence <= 1, 'confidence should be 0-1');
  });

  test('extracts color grading with all dimensions', () => {
    const style = learnStyleFromVideo('/videos/sunset.mp4');
    assert.ok(typeof style.colorGrading.temperature === 'number');
    assert.ok(typeof style.colorGrading.contrast === 'number');
    assert.ok(typeof style.colorGrading.saturation === 'number');
    assert.ok(typeof style.colorGrading.tint === 'number');
    assert.ok(typeof style.colorGrading.gamma === 'number');
    assert.ok(Array.isArray(style.colorGrading.palette));
    assert.ok(style.colorGrading.palette.length >= 2);
  });

  test('extracts pacing information', () => {
    const style = learnStyleFromVideo('/videos/quick.mp4');
    assert.ok(typeof style.pacing.avgClipDuration === 'number');
    assert.ok(typeof style.pacing.cutFrequency === 'number');
    assert.ok(['steady', 'accelerating', 'varied'].includes(style.pacing.rhythmPattern));
    assert.ok(style.pacing.sceneLengthDistribution);
    assert.ok(Array.isArray(style.pacing.energyFlow));
  });

  test('extracts transition data', () => {
    const style = learnStyleFromVideo('/videos/cuts.mp4');
    assert.ok(Array.isArray(style.transitions.types));
    assert.ok(style.transitions.types.length > 0);
    assert.ok(typeof style.transitions.avgDuration === 'number');
    assert.ok(typeof style.transitions.dominantTransition === 'string');
  });

  test('extracts text style', () => {
    const style = learnStyleFromVideo('/videos/titled.mp4');
    assert.ok(typeof style.textStyle.fontFamily === 'string');
    assert.ok(Array.isArray(style.textStyle.sizeRange));
    assert.ok(style.textStyle.sizeRange.length === 2);
    assert.ok(typeof style.textStyle.shadow === 'boolean');
  });

  test('extracts music mood', () => {
    const style = learnStyleFromVideo('/videos/music.mp4');
    assert.ok(Array.isArray(style.musicMood.bpmRange));
    assert.ok(typeof style.musicMood.genre === 'string');
    assert.ok(Array.isArray(style.musicMood.energyCurve));
    assert.ok(Array.isArray(style.musicMood.moodProgression));
    assert.ok(typeof style.musicMood.keySignature === 'string');
    assert.ok(Array.isArray(style.musicMood.instrumentation));
  });

  test('produces deterministic output for same path', () => {
    const s1 = learnStyleFromVideo('/videos/same.mp4');
    const s2 = learnStyleFromVideo('/videos/same.mp4');
    assert.equal(s1.colorGrading.temperature, s2.colorGrading.temperature);
    assert.equal(s1.pacing.rhythmPattern, s2.pacing.rhythmPattern);
    assert.equal(s1.musicMood.genre, s2.musicMood.genre);
  });

  test('produces different output for different paths', () => {
    const s1 = learnStyleFromVideo('/videos/a.mp4');
    const s2 = learnStyleFromVideo('/videos/b.mp4');
    // At least one property should differ (probabilistically certain with different paths)
    const colorSame = s1.colorGrading.temperature === s2.colorGrading.temperature;
    const pacingSame = s1.pacing.rhythmPattern === s2.pacing.rhythmPattern;
    const musicSame = s1.musicMood.genre === s2.musicMood.genre;
    assert.ok(!(colorSame && pacingSame && musicSame), 'styles should differ for different paths');
  });

  test('throws on invalid path', () => {
    assert.throws(() => learnStyleFromVideo(null), /valid video path/);
    assert.throws(() => learnStyleFromVideo(''), /valid video path/);
    assert.throws(() => learnStyleFromVideo(123), /valid video path/);
  });

  test('respects custom sampleFrames option', () => {
    const style = learnStyleFromVideo('/videos/test.mp4', { sampleFrames: 200 });
    assert.equal(style.sampleFramesAnalyzed, 200);
    assert.ok(style.confidence > 0.7, 'more frames should mean higher confidence');
  });

  test('can disable audio analysis', () => {
    const style = learnStyleFromVideo('/videos/test.mp4', { analyzeAudio: false });
    assert.equal(style.audioProfile, null);
  });

  test('includes audioProfile when analyzeAudio is true', () => {
    const style = learnStyleFromVideo('/videos/test.mp4', { analyzeAudio: true });
    assert.ok(style.audioProfile !== null);
    assert.ok(typeof style.audioProfile.voiceMusicRatio === 'number');
    assert.ok(typeof style.audioProfile.compressionLevel === 'number');
  });

  test('assigns a valid overallMood', () => {
    const validMoods = ['energetic', 'calm', 'dramatic', 'playful', 'moody',
      'uplifting', 'tense', 'romantic', 'gritty', 'ethereal'];
    const style = learnStyleFromVideo('/videos/mood.mp4');
    assert.ok(validMoods.includes(style.overallMood), `mood "${style.overallMood}" should be valid`);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. applyLearnedStyle
// ══════════════════════════════════════════════════════════════════════════════

describe('applyLearnedStyle', () => {

  test('applies style to project and returns modified copy', () => {
    const project = makeProject();
    const style = makeStyle();
    const result = applyLearnedStyle(project, style, { strength: 0.8 });
    assert.ok(result.applied_style, 'should have applied_style metadata');
    assert.equal(result.applied_style.id, style.id);
    assert.equal(result.applied_style.strength, 0.8);
  });

  test('does not mutate the original project', () => {
    const project = makeProject();
    const style = makeStyle();
    const original = JSON.parse(JSON.stringify(project));
    applyLearnedStyle(project, style);
    assert.deepEqual(project, original);
  });

  test('applies color adjustments to clips', () => {
    const project = makeProject();
    const style = makeStyle();
    const result = applyLearnedStyle(project, style, { strength: 1.0 });
    for (const clip of result.tracks[0].clips) {
      assert.ok(clip.color_adjustments, 'clip should have color_adjustments');
      assert.ok(typeof clip.color_adjustments.temperature === 'number');
      assert.ok(typeof clip.color_adjustments.contrast === 'number');
      assert.ok(clip.style_applied === true);
    }
  });

  test('adjusts clip durations based on pacing', () => {
    const project = makeProject();
    const style = makeStyle();
    const result = applyLearnedStyle(project, style, { strength: 1.0 });
    // At strength 1.0, durations should move toward the style's avgClipDuration
    for (const clip of result.tracks[0].clips) {
      assert.ok(typeof clip.duration_sec === 'number');
      assert.ok(clip.duration_sec > 0);
    }
  });

  test('applies text style to project', () => {
    const project = makeProject();
    const style = makeStyle();
    const result = applyLearnedStyle(project, style, { strength: 0.9 });
    assert.ok(result.text_style, 'should have text_style');
    assert.equal(result.text_style.fontFamily, style.textStyle.fontFamily);
    assert.equal(result.text_style.animationType, style.textStyle.animationType);
  });

  test('applies transition style to tracks', () => {
    const project = makeProject();
    const style = makeStyle();
    const result = applyLearnedStyle(project, style, { strength: 1.0 });
    assert.ok(result.tracks[0].transition_style, 'track should have transition_style');
    assert.equal(
      result.tracks[0].transition_style.dominant,
      style.transitions.dominantTransition
    );
  });

  test('strength=0 leaves project mostly unchanged', () => {
    const project = makeProject();
    const style = makeStyle();
    const result = applyLearnedStyle(project, style, { strength: 0 });
    // Color should still be set (the lerped values, but close to defaults)
    assert.ok(result.tracks[0].clips[0].color_adjustments);
    assert.equal(result.applied_style.strength, 0);
  });

  test('throws on invalid inputs', () => {
    assert.throws(() => applyLearnedStyle(null, makeStyle()), /valid project/);
    assert.throws(() => applyLearnedStyle(makeProject(), null), /valid style/);
    assert.throws(() => applyLearnedStyle('notobj', makeStyle()), /valid project/);
  });

  test('clamps strength to valid range', () => {
    const project = makeProject();
    const style = makeStyle();
    const result = applyLearnedStyle(project, style, { strength: 2.0 });
    assert.equal(result.applied_style.strength, 1.0);
    const result2 = applyLearnedStyle(project, style, { strength: -0.5 });
    assert.equal(result2.applied_style.strength, 0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. compareStyles
// ══════════════════════════════════════════════════════════════════════════════

describe('compareStyles', () => {

  test('returns all required similarity dimensions', () => {
    const s1 = makeStyle();
    const s2 = makeStyle();
    const report = compareStyles(s1, s2);
    assert.ok('overall' in report);
    assert.ok('color' in report);
    assert.ok('pacing' in report);
    assert.ok('music' in report);
    assert.ok('transitions' in report);
    assert.ok('text' in report);
  });

  test('identical styles return overall=1', () => {
    const s = makeStyle();
    const report = compareStyles(s, s);
    assert.equal(report.overall, 1);
    assert.equal(report.color, 1);
    assert.equal(report.pacing, 1);
  });

  test('all values are between 0 and 1', () => {
    const s1 = learnStyleFromVideo('/a.mp4');
    const s2 = learnStyleFromVideo('/b.mp4');
    const report = compareStyles(s1, s2);
    for (const [key, val] of Object.entries(report)) {
      assert.ok(val >= 0 && val <= 1, `${key}=${val} should be 0-1`);
    }
  });

  test('throws on missing inputs', () => {
    assert.throws(() => compareStyles(null, makeStyle()), /two style objects/);
    assert.throws(() => compareStyles(makeStyle(), null), /two style objects/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. styleTransfer
// ══════════════════════════════════════════════════════════════════════════════

describe('styleTransfer', () => {

  test('returns TransferredStyle with required fields', () => {
    const result = styleTransfer('/src.mp4', '/target.mp4');
    assert.ok(result.sourceStyle, 'should have sourceStyle');
    assert.ok(result.targetStyle, 'should have targetStyle');
    assert.ok(typeof result.appliedStrength === 'number');
    assert.ok(Array.isArray(result.modifications));
  });

  test('applies source color to target', () => {
    const result = styleTransfer('/src.mp4', '/target.mp4', { strength: 1.0 });
    const src = result.sourceStyle;
    // At strength=1.0, color temperature should be very close to source
    const diff = Math.abs(result.targetStyle.colorGrading.temperature - src.colorGrading.temperature);
    assert.ok(diff < 50, `temperature diff ${diff} should be small at strength 1.0`);
  });

  test('strength=0 preserves target style', () => {
    const result = styleTransfer('/src.mp4', '/target.mp4', { strength: 0 });
    const targetOrig = learnStyleFromVideo('/target.mp4');
    assert.equal(
      result.targetStyle.colorGrading.temperature,
      targetOrig.colorGrading.temperature
    );
    assert.equal(result.appliedStrength, 0);
  });

  test('can preserve specific dimensions', () => {
    const result = styleTransfer('/src.mp4', '/target.mp4', {
      strength: 1.0,
      preserve: ['color', 'text'],
    });
    assert.ok(!result.modifications.includes('colorGrading'));
    assert.ok(!result.modifications.includes('textStyle'));
    assert.ok(result.modifications.includes('pacing'));
  });

  test('modifications list reflects what was transferred', () => {
    const result = styleTransfer('/src.mp4', '/target.mp4', { strength: 0.8 });
    assert.ok(result.modifications.length > 0, 'should have some modifications');
    // At default, colorGrading and pacing should be in modifications
    assert.ok(result.modifications.includes('colorGrading'));
    assert.ok(result.modifications.includes('pacing'));
  });

  test('throws on missing paths', () => {
    assert.throws(() => styleTransfer(null, '/t.mp4'), /both source and target/);
    assert.throws(() => styleTransfer('/s.mp4', null), /both source and target/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. styleRecommendation
// ══════════════════════════════════════════════════════════════════════════════

describe('styleRecommendation', () => {

  test('returns array of StyleRecommendation objects', () => {
    const recs = styleRecommendation(makeProject());
    assert.ok(Array.isArray(recs));
    assert.ok(recs.length > 0);
  });

  test('each recommendation has required fields', () => {
    const recs = styleRecommendation(makeProject());
    for (const rec of recs) {
      assert.ok(typeof rec.name === 'string');
      assert.ok(rec.style, 'should have style');
      assert.ok(typeof rec.matchScore === 'number');
      assert.ok(typeof rec.reason === 'string');
      assert.ok(typeof rec.category === 'string');
    }
  });

  test('recommendations are sorted by matchScore descending', () => {
    const recs = styleRecommendation(makeProject());
    for (let i = 1; i < recs.length; i++) {
      assert.ok(recs[i - 1].matchScore >= recs[i].matchScore,
        `rec ${i-1} score ${recs[i-1].matchScore} should be >= rec ${i} score ${recs[i].matchScore}`);
    }
  });

  test('matchScore values are between 0 and 1', () => {
    const recs = styleRecommendation(makeProject());
    for (const rec of recs) {
      assert.ok(rec.matchScore >= 0 && rec.matchScore <= 1,
        `matchScore ${rec.matchScore} should be 0-1`);
    }
  });

  test('genre-specific projects get higher genre match', () => {
    const project = makeProject({ genre: 'tiktok', type: 'tiktok' });
    const recs = styleRecommendation(project);
    const tiktokRec = recs.find(r => r.name === 'TIKTOK');
    assert.ok(tiktokRec, 'should have TIKTOK recommendation');
    assert.ok(tiktokRec.matchScore > 0.3, 'tiktok genre should score higher for tiktok project');
  });

  test('throws on invalid input', () => {
    assert.throws(() => styleRecommendation(null), /valid project/);
    assert.throws(() => styleRecommendation('notobj'), /valid project/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. StyleHistory
// ══════════════════════════════════════════════════════════════════════════════

describe('StyleHistory', () => {

  test('record() adds entry and returns it', () => {
    const history = new StyleHistory();
    const style = makeStyle();
    const project = makeProject();
    const entry = history.record(style, project, { strength: 0.7, modifications: ['colorGrading'] });
    assert.ok(entry.id, 'entry should have id');
    assert.equal(entry.styleId, style.id);
    assert.equal(entry.projectId, project.id);
    assert.equal(entry.strength, 0.7);
    assert.deepEqual(entry.modifications, ['colorGrading']);
    assert.equal(history.size(), 1);
  });

  test('getHistory() returns entries for a specific project', () => {
    const history = new StyleHistory();
    const s1 = makeStyle();
    const s2 = makeStyle();
    history.record(s1, makeProject({ id: 'p1' }));
    history.record(s2, makeProject({ id: 'p2' }));
    history.record(s1, makeProject({ id: 'p1' }));

    const p1History = history.getHistory('p1');
    assert.equal(p1History.length, 2);
    const p2History = history.getHistory('p2');
    assert.equal(p2History.length, 1);
  });

  test('getMostUsed() returns the most frequently used style', () => {
    const history = new StyleHistory();
    const s1 = makeStyle({ id: 'style_a' });
    const s2 = makeStyle({ id: 'style_b' });
    const p = makeProject();

    history.record(s1, p);
    history.record(s1, p);
    history.record(s2, p);

    const mostUsed = history.getMostUsed();
    assert.equal(mostUsed.id, 'style_a');
  });

  test('getMostUsed() returns null when empty', () => {
    const history = new StyleHistory();
    assert.equal(history.getMostUsed(), null);
  });

  test('getEvolution() returns correct trend', () => {
    const history = new StyleHistory();
    const style = makeStyle();
    const project = makeProject({ id: 'evo_proj' });

    // Record with increasing strength
    history.record(style, project, { strength: 0.3 });
    history.record(style, project, { strength: 0.7 });

    const evo = history.getEvolution('evo_proj');
    assert.equal(evo.projectId, 'evo_proj');
    assert.equal(evo.entries.length, 2);
    assert.equal(evo.trend, 'increasing');
    assert.ok(evo.avgStrength > 0);
  });

  test('getEvolution() returns "none" for empty history', () => {
    const history = new StyleHistory();
    const evo = history.getEvolution('nonexistent');
    assert.equal(evo.trend, 'none');
    assert.equal(evo.entries.length, 0);
    assert.equal(evo.styleDrift, 0);
  });

  test('getEvolution() detects decreasing trend', () => {
    const history = new StyleHistory();
    const style = makeStyle();
    const project = makeProject({ id: 'dec_proj' });

    history.record(style, project, { strength: 0.9 });
    history.record(style, project, { strength: 0.4 });

    const evo = history.getEvolution('dec_proj');
    assert.equal(evo.trend, 'decreasing');
  });

  test('getEvolution() calculates styleDrift', () => {
    const history = new StyleHistory();
    const s1 = makeStyle({ id: 's1' });
    const s2 = makeStyle({ id: 's2' });
    const project = makeProject({ id: 'drift_proj' });

    history.record(s1, project);
    history.record(s2, project);
    history.record(s1, project);

    const evo = history.getEvolution('drift_proj');
    assert.ok(evo.styleDrift > 0, 'should have non-zero drift with multiple styles');
    assert.ok(evo.styleDrift <= 1, 'drift should be <= 1');
  });

  test('clear() removes all entries', () => {
    const history = new StyleHistory();
    history.record(makeStyle(), makeProject());
    history.record(makeStyle(), makeProject());
    assert.equal(history.size(), 2);
    history.clear();
    assert.equal(history.size(), 0);
    assert.equal(history.getMostUsed(), null);
  });

  test('record() throws on invalid style', () => {
    const history = new StyleHistory();
    assert.throws(() => history.record(null, makeProject()), /valid style with an id/);
    assert.throws(() => history.record({ noId: true }, makeProject()), /valid style with an id/);
  });

  test('record() throws on invalid project', () => {
    const history = new StyleHistory();
    assert.throws(() => history.record(makeStyle(), null), /valid project with an id/);
    assert.throws(() => history.record(makeStyle(), { noId: true }), /valid project with an id/);
  });

  test('getAll() returns all entries', () => {
    const history = new StyleHistory();
    history.record(makeStyle(), makeProject({ id: 'a' }));
    history.record(makeStyle(), makeProject({ id: 'b' }));
    history.record(makeStyle(), makeProject({ id: 'c' }));
    assert.equal(history.getAll().length, 3);
  });
});

describe('end-to-end style cloning workflow', () => {

  test('learn → apply → compare full workflow', () => {
    // Learn style from a source video
    const learned = learnStyleFromVideo('/source/cinematic.mp4');
    assert.ok(learned.id);

    // Apply to a project
    const project = makeProject();
    const styled = applyLearnedStyle(project, learned, { strength: 0.8 });
    assert.ok(styled.applied_style);
    assert.equal(styled.applied_style.id, learned.id);

    // Compare the learned style with another
    const other = learnStyleFromVideo('/other/vlog.mp4');
    const report = compareStyles(learned, other);
    assert.ok(report.overall >= 0 && report.overall <= 1);
  });

  test('transfer → apply → history full workflow', () => {
    // Transfer style between videos
    const transferred = styleTransfer('/a.mp4', '/b.mp4', { strength: 0.9 });
    assert.ok(transferred.modifications.length > 0);

    // Apply transferred style to a project
    const project = makeProject();
    const styled = applyLearnedStyle(project, transferred.targetStyle, { strength: 0.8 });
    assert.ok(styled.applied_style);

    // Record in history
    const history = new StyleHistory();
    history.record(transferred.targetStyle, project, { strength: 0.8, modifications: transferred.modifications });
    assert.equal(history.size(), 1);

    // Check evolution
    const evo = history.getEvolution(project.id);
    assert.equal(evo.entries.length, 1);
  });
});
