/**
 * test_personalization.js — Tests for Personalization Engine (Vireo Studio).
 *
 * 50+ tests covering: taste learning, prediction, evolution,
 * recommendations, adaptive AI, taste sharing, edge cases.
 */

import {
  TasteProfile,
  TasteAnalyzer,
  PersonalizedRecommendations,
  AdaptiveAI,
  TasteSharing,
} from '../src/personalization.js';

// ── Minimal test harness ──

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, msg) {
  if (condition) {
    passed++;
  } else {
    failed++;
    failures.push(msg);
    console.log(`  ✗ ${msg}`);
  }
}

function assertEq(a, b, msg) {
  const eq = JSON.stringify(a) === JSON.stringify(b);
  if (!eq) {
    failed++;
    failures.push(`${msg} — got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);
    console.log(`  ✗ ${msg} — got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);
  } else {
    passed++;
  }
}

function section(name) {
  console.log(`\n── ${name} ──`);
}

function summary() {
  console.log(`\n════════════════════════════════`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log(`Failures:`);
    failures.forEach(f => console.log(`  - ${f}`));
  }
  console.log(`════════════════════════════════`);
  process.exit(failed > 0 ? 1 : 0);
}

// ══════════════════════════════════════════════════════════════════════
// TasteProfile Tests
// ══════════════════════════════════════════════════════════════════════

section('TasteProfile — Construction');

{
  const p = new TasteProfile('user1');
  assert(p.userId === 'user1', 'constructor sets userId');
  assert(p.editCount === 0, 'constructor editCount = 0');
  assert(p.history.length === 0, 'constructor history empty');
  assert(p.preferences.overall.confidence_score === 0, 'confidence starts at 0');
}

section('TasteProfile — learnFromEdit (color)');

{
  const p = new TasteProfile('user1');
  p.learnFromEdit({ action: 'color_grade', before: 'none', after: 'cinematic', context: 'sunset' });
  assert(p.editCount === 1, 'editCount increments');
  assert(p.history.length === 1, 'history length 1');
  assert(p.preferences.color.favorite_presets.includes('cinematic'), 'preset recorded');
}

{
  const p = new TasteProfile('user1');
  p.learnFromEdit({ action: 'color_temperature', before: '5000', after: '6500', context: 'outdoor' });
  assert(p.preferences.color.temperature !== null, 'temperature learned');
  assert(p.preferences.color.temperature > 5000, 'temperature moved toward 6500');
}

{
  const p = new TasteProfile('user1');
  p.learnFromEdit({ action: 'color_contrast', before: '0.8', after: '1.2', context: 'drama' });
  assert(p.preferences.color.contrast !== null, 'contrast learned');
  assert(p.preferences.color.contrast > 0.8, 'contrast moved up');
}

{
  const p = new TasteProfile('user1');
  p.learnFromEdit({ action: 'color_saturation', before: '0.9', after: '1.3', context: 'vibrant' });
  assert(p.preferences.color.saturation !== null, 'saturation learned');
  assert(p.preferences.color.saturation > 0.9, 'saturation moved up');
}

section('TasteProfile — learnFromEdit (pacing)');

{
  const p = new TasteProfile('user1');
  p.learnFromEdit({ action: 'clip_select', before: 'long', after: 'short', context: 'vlog' });
  assert(p.preferences.pacing.preferred_clip_duration !== null, 'clip duration learned');
}

{
  const p = new TasteProfile('user1');
  p.learnFromEdit({ action: 'cut_frequency', before: '0.3', after: '0.8', context: 'action' });
  assert(p.preferences.pacing.cut_frequency !== null, 'cut frequency learned');
  assert(p.preferences.pacing.cut_frequency > 0.3, 'cut frequency moved up');
}

{
  const p = new TasteProfile('user1');
  p.learnFromEdit({ action: 'rhythm_change', before: 'steady', after: 'accelerating', context: '' });
  assertEq(p.preferences.pacing.rhythm_preference, 'accelerating', 'rhythm updated');
}

section('TasteProfile — learnFromEdit (music)');

{
  const p = new TasteProfile('user1');
  p.learnFromEdit({ action: 'music_choice', before: 'none', after: 'lofi', context: 'chill' });
  assert(p.preferences.music.preferred_genres.includes('lofi'), 'music genre learned');
  assert(p.preferences.music.energy_preference !== null, 'energy inferred from chill');
  assert(p.preferences.music.energy_preference < 0.5, 'chill → low energy');
}

{
  const p = new TasteProfile('user1');
  p.learnFromEdit({ action: 'music_genre', before: 'none', after: 'electronic', context: 'energetic' });
  assert(p.preferences.music.preferred_genres.includes('electronic'), 'electronic genre added');
  assert(p.preferences.music.energy_preference > 0.5, 'energetic → high energy');
}

{
  const p = new TasteProfile('user1');
  p.learnFromEdit({ action: 'music_bpm', before: '100', after: '128', context: '' });
  assert(p.preferences.music.bpm_range[1] > 100, 'bpm range upper moved');
}

section('TasteProfile — learnFromEdit (text)');

{
  const p = new TasteProfile('user1');
  p.learnFromEdit({ action: 'text_font', before: 'Arial', after: 'Montserrat', context: '' });
  assertEq(p.preferences.text.preferred_font, 'Montserrat', 'font learned');
}

{
  const p = new TasteProfile('user1');
  p.learnFromEdit({ action: 'text_position', before: 'center', after: 'lower-third', context: '' });
  assertEq(p.preferences.text.preferred_position, 'lower-third', 'position learned');
}

{
  const p = new TasteProfile('user1');
  p.learnFromEdit({ action: 'text_add', before: 'none', after: 'typewriter', context: '' });
  assertEq(p.preferences.text.animation_style, 'typewriter', 'animation learned');
}

section('TasteProfile — learnFromEdit (transitions)');

{
  const p = new TasteProfile('user1');
  p.learnFromEdit({ action: 'transition_type', before: 'none', after: 'crossfade', context: '0.5s' });
  assert(p.preferences.transitions.preferred_types.includes('crossfade'), 'transition type added');
  assert(p.preferences.transitions.avg_duration !== null, 'transition duration learned');
}

section('TasteProfile — learnFromEdit (audio)');

{
  const p = new TasteProfile('user1');
  p.learnFromEdit({ action: 'audio_adjust', before: '50/50', after: '70/30', context: '' });
  assert(p.preferences.audio.voice_music_ratio_preference !== null, 'audio ratio learned');
}

{
  const p = new TasteProfile('user1');
  p.learnFromEdit({ action: 'audio_compression', before: 'none', after: 'heavy', context: '' });
  assertEq(p.preferences.audio.compression_preference, 'heavy', 'compression learned');
}

section('TasteProfile — Multiple edits & weighted learning');

{
  const p = new TasteProfile('user1');
  // 10 edits on color temperature
  for (let i = 0; i < 10; i++) {
    p.learnFromEdit({ action: 'color_temperature', before: '5000', after: '6000', context: '' });
  }
  assert(p.editCount === 10, '10 edits recorded');
  assert(p.preferences.color.temperature > 5000, 'temperature moved toward 6000');
  assert(p.preferences.overall.confidence_score > 0, 'confidence > 0 after 10 edits');
}

section('TasteProfile — getPreferences returns deep clone');

{
  const p = new TasteProfile('user1');
  p.learnFromEdit({ action: 'color_grade', before: 'none', after: 'warm', context: '' });
  const prefs1 = p.getPreferences();
  const prefs2 = p.getPreferences();
  prefs1.color.favorite_presets.push('HACK');
  assert(!prefs2.color.favorite_presets.includes('HACK'), 'getPreferences returns clone');
}

section('TasteProfile — predictPreference');

{
  const p = new TasteProfile('user1');
  // No data → confidence 0
  const pred = p.predictPreference('color');
  assert(pred.confidence === 0, 'no data → confidence 0');
  assert(pred.alternatives !== undefined, 'alternatives returned');
}

{
  const p = new TasteProfile('user1');
  for (let i = 0; i < 8; i++) {
    p.learnFromEdit({ action: 'music_genre', before: 'none', after: 'lofi', context: '' });
  }
  const pred = p.predictPreference('music');
  assert(pred.confidence > 0, 'confidence > 0 after edits');
  assert(pred.predicted_value.genres.includes('lofi'), 'predicted lofi');
  assert(pred.alternatives.length > 0, 'alternatives available');
}

{
  const p = new TasteProfile('user1');
  p.learnFromEdit({ action: 'clip_select', before: 'long', after: 'short', context: '' });
  const pred = p.predictPreference('pacing');
  assert(pred.predicted_value !== null, 'pacing prediction not null');
}

{
  const p = new TasteProfile('user1');
  const pred = p.predictPreference('nonexistent');
  assert(pred.confidence === 0, 'nonexistent category → confidence 0');
}

section('TasteProfile — getEvolution');

{
  const p = new TasteProfile('user1');
  // No edits yet
  const evo = p.getEvolution();
  assert(evo.total_edits === 0, 'evolution edit count 0');
  assert(evo.consistency_score === 1, 'no data → consistency 1');
}

{
  const p = new TasteProfile('user1');
  for (let i = 0; i < 15; i++) {
    p.learnFromEdit({ action: 'clip_select', before: 'long', after: 'short', context: '' });
  }
  const evo = p.getEvolution();
  assert(evo.total_edits === 15, 'evolution edit count correct');
  assert(evo.snapshot_count >= 2, 'snapshots created');
  assert(typeof evo.dominant_style === 'string', 'dominant_style is string');
  assert(typeof evo.style_drift === 'number', 'style_drift is number');
}

section('TasteProfile — Conflicting edits');

{
  const p = new TasteProfile('user1');
  p.learnFromEdit({ action: 'color_temperature', before: '5000', after: '7000', context: '' });
  const t1 = p.preferences.color.temperature;
  p.learnFromEdit({ action: 'color_temperature', before: '7000', after: '4000', context: '' });
  const t2 = p.preferences.color.temperature;
  // Weighted average should move toward 4000 but not fully
  assert(t2 < t1, 'conflicting edit moves temperature');
  assert(t2 > 4000, 'conflicting edit doesn\'t fully override');
}

section('TasteProfile — Serialization');

{
  const p = new TasteProfile('user1');
  p.learnFromEdit({ action: 'music_choice', before: 'none', after: 'rock', context: '' });
  const json = p.toJSON();
  assert(json.userId === 'user1', 'toJSON userId');
  assert(json.editCount === 1, 'toJSON editCount');
  assert(json.preferences.music.preferred_genres.includes('rock'), 'toJSON preferences');

  const restored = TasteProfile.fromJSON(json);
  assert(restored.userId === 'user1', 'fromJSON userId');
  assert(restored.editCount === 1, 'fromJSON editCount');
  assert(restored.preferences.music.preferred_genres.includes('rock'), 'fromJSON preferences');
}

section('TasteProfile — Edge: null/undefined edit');

{
  const p = new TasteProfile('user1');
  p.learnFromEdit(null);
  assert(p.editCount === 0, 'null edit ignored');

  p.learnFromEdit(undefined);
  assert(p.editCount === 0, 'undefined edit ignored');

  p.learnFromEdit({ action: '' });
  assert(p.editCount === 1, 'empty action still counts');
}

// ══════════════════════════════════════════════════════════════════════
// TasteAnalyzer Tests
// ══════════════════════════════════════════════════════════════════════

section('TasteAnalyzer — analyzeProject');

{
  const analyzer = new TasteAnalyzer();
  const result = analyzer.analyzeProject({ title: 'My Gaming Montage', tags: ['gaming', 'montage'] });
  assertEq(result.genre, 'gaming', 'detects gaming genre');
  assert(result.detected_features.length >= 0, 'features array exists');
}

{
  const analyzer = new TasteAnalyzer();
  const result = analyzer.analyzeProject({ title: 'A Cinematic Story', tags: ['cinematic', 'film'] });
  assertEq(result.genre, 'cinematic', 'detects cinematic genre');
}

{
  const analyzer = new TasteAnalyzer();
  const result = analyzer.analyzeProject({ title: 'Chill Lo-fi Beats', mood: 'calm' });
  assertEq(result.mood, 'calm', 'detects calm mood');
}

{
  const analyzer = new TasteAnalyzer();
  const result = analyzer.analyzeProject(null);
  assertEq(result.genre, 'unknown', 'null project → unknown');
  assertEq(result.mood, 'neutral', 'null project → neutral mood');
}

{
  const analyzer = new TasteAnalyzer();
  const result = analyzer.analyzeProject({ title: 'Funny cat meme compilation', tags: ['funny', 'meme'] });
  assertEq(result.genre, 'comedy', 'detects comedy genre');
}

{
  const analyzer = new TasteAnalyzer();
  const result = analyzer.analyzeProject({ title: 'How to Learn JavaScript', tags: ['tutorial', 'learn'] });
  assertEq(result.genre, 'tutorial', 'detects tutorial genre');
  assertEq(result.target_audience, 'learners', 'tutorial → learners audience');
}

section('TasteAnalyzer — analyzeHistory');

{
  const analyzer = new TasteAnalyzer();
  const projects = [
    { title: 'Gaming Stream 1', tags: ['gaming'] },
    { title: 'Gaming Stream 2', tags: ['gaming'] },
    { title: 'Gaming Stream 3', tags: ['gaming'] },
  ];
  const result = analyzer.analyzeHistory(projects);
  assert(result.common_patterns.length > 0, 'patterns found');
  assert(result.total_projects === 3, 'total projects counted');
  assert(result.strengths.length > 0, 'strengths identified');
}

{
  const analyzer = new TasteAnalyzer();
  const result = analyzer.analyzeHistory([]);
  assertEq(result.style_evolution, 'no_data', 'empty → no_data');
}

{
  const analyzer = new TasteAnalyzer();
  const result = analyzer.analyzeHistory(null);
  assertEq(result.style_evolution, 'no_data', 'null → no_data');
}

section('TasteAnalyzer — suggestExperiments');

{
  const analyzer = new TasteAnalyzer();
  const p = new TasteProfile('user1');
  for (let i = 0; i < 10; i++) {
    p.learnFromEdit({ action: 'color_temperature', before: '5000', after: '6500', context: '' });
    p.learnFromEdit({ action: 'music_genre', before: 'none', after: 'lofi', context: '' });
  }
  const experiments = analyzer.suggestExperiments(p);
  assert(experiments.length > 0, 'experiments suggested');
  assert(experiments.length <= 5, 'max 5 experiments');
  for (const exp of experiments) {
    assert(exp.style, 'experiment has style');
    assert(exp.reason, 'experiment has reason');
    assert(exp.expected_result, 'experiment has expected_result');
    assert(exp.risk_level, 'experiment has risk_level');
  }
}

// ══════════════════════════════════════════════════════════════════════
// PersonalizedRecommendations Tests
// ══════════════════════════════════════════════════════════════════════

section('PersonalizedRecommendations — recommendStyle');

{
  const recs = new PersonalizedRecommendations();
  const p = new TasteProfile('user1');
  for (let i = 0; i < 10; i++) {
    p.learnFromEdit({ action: 'color_grade', before: 'none', after: 'cinematic', context: '' });
  }
  const result = recs.recommendStyle({ title: 'Cinematic Film', tags: ['cinematic'] }, p);
  assert(result.style, 'style recommended');
  assert(typeof result.confidence === 'number', 'confidence is number');
  assert(result.reasoning, 'reasoning provided');
  assert(result.alternatives.length > 0, 'alternatives provided');
}

{
  const recs = new PersonalizedRecommendations();
  const result = recs.recommendStyle({ title: 'Gaming Stream', tags: ['gaming'] }, {});
  assertEq(result.style, 'high_energy', 'gaming → high_energy');
}

{
  const recs = new PersonalizedRecommendations();
  const result = recs.recommendStyle({ title: 'Tutorial', tags: ['tutorial'] }, {});
  assertEq(result.style, 'clean_professional', 'tutorial → clean_professional');
}

section('PersonalizedRecommendations — recommendMusic');

{
  const recs = new PersonalizedRecommendations();
  const p = new TasteProfile('user1');
  p.learnFromEdit({ action: 'music_genre', before: 'none', after: 'rock', context: '' });
  const result = recs.recommendMusic({ title: 'Action Video', mood: 'energetic' }, p);
  assert(result.genre, 'genre recommended');
  assert(typeof result.bpm === 'number', 'bpm provided');
  assert(typeof result.energy === 'number', 'energy provided');
}

{
  const recs = new PersonalizedRecommendations();
  const result = recs.recommendMusic({ title: 'Calm Nature', mood: 'calm' }, {});
  assertEq(result.genre, 'ambient', 'calm mood → ambient');
}

section('PersonalizedRecommendations — recommendPacing');

{
  const recs = new PersonalizedRecommendations();
  const p = new TasteProfile('user1');
  p.learnFromEdit({ action: 'clip_select', before: 'long', after: 'short', context: '' });
  const result = recs.recommendPacing({ title: 'Gaming Montage', tags: ['gaming'] }, p);
  assert(typeof result.clip_duration === 'number', 'clip_duration provided');
  assert(typeof result.cut_frequency === 'number', 'cut_frequency provided');
  assert(result.rhythm, 'rhythm provided');
  assert(result.reasoning, 'reasoning provided');
}

{
  const recs = new PersonalizedRecommendations();
  const result = recs.recommendPacing({ title: 'Cinematic Story', tags: ['cinematic'] }, {});
  assertEq(result.rhythm, 'steady', 'cinematic → steady rhythm');
  assert(result.clip_duration >= 4, 'cinematic → longer clips');
}

section('PersonalizedRecommendations — recommendThumbnail');

{
  const recs = new PersonalizedRecommendations();
  const result = recs.recommendThumbnail({ title: 'Gaming Stream', tags: ['gaming'] }, {});
  assert(result.color_scheme, 'color_scheme provided');
  assert(result.text_placement, 'text_placement provided');
  assertEq(result.style, 'bold', 'gaming → bold thumbnail');
}

// ══════════════════════════════════════════════════════════════════════
// AdaptiveAI Tests
// ══════════════════════════════════════════════════════════════════════

section('AdaptiveAI — adjustForUser');

{
  const ai = new AdaptiveAI();
  const p = new TasteProfile('user1');
  for (let i = 0; i < 15; i++) {
    p.learnFromEdit({ action: 'color_temperature', before: '5000', after: '7000', context: '' });
    p.learnFromEdit({ action: 'music_genre', before: 'none', after: 'rock', context: '' });
  }
  const output = { color: { temperature: 5500, saturation: 0.8 }, music: { genre: 'pop' } };
  const adjusted = ai.adjustForUser(output, p);
  assert(adjusted.color.temperature !== 5500, 'temperature adjusted');
  assert(adjusted._adaptation.applied === true, 'adaptation applied');
  assert(typeof adjusted._adaptation.level === 'number', 'adaptation level provided');
}

{
  const ai = new AdaptiveAI();
  const adjusted = ai.adjustForUser(null, {});
  assertEq(adjusted, {}, 'null output → empty object');
}

{
  const ai = new AdaptiveAI();
  const output = { pacing: { clip_duration: 3, rhythm: 'steady' } };
  const adjusted = ai.adjustForUser(output, {});
  assertEq(adjusted.pacing.clip_duration, 3, 'no profile → no change');
}

section('AdaptiveAI — learnFromFeedback');

{
  const ai = new AdaptiveAI();
  ai.learnFromFeedback({ color: {} }, { accepted: true, rating: 5 });
  assert(ai.feedbackLog.length === 1, 'feedback logged');
  assert(ai.acceptedAdjustments === 1, 'accepted count incremented');
}

{
  const ai = new AdaptiveAI();
  ai.learnFromFeedback({ color: {} }, { accepted: false, rating: 1 });
  assert(ai.feedbackLog.length === 1, 'feedback logged (reject)');
  assert(ai.acceptedAdjustments === 0, 'accepted not incremented');
}

section('AdaptiveAI — getAdaptationLevel');

{
  const ai = new AdaptiveAI();
  assertEq(ai.getAdaptationLevel(), 0, 'no data → 0');

  // Accept many
  for (let i = 0; i < 20; i++) {
    ai.learnFromFeedback({}, { accepted: true, rating: 5 });
    ai.totalAdjustments += 1;
  }
  const level = ai.getAdaptationLevel();
  assert(level > 0.3, 'many accepted → higher level');
}

{
  const ai = new AdaptiveAI();
  for (let i = 0; i < 20; i++) {
    ai.learnFromFeedback({}, { accepted: false, rating: 1 });
    ai.totalAdjustments += 1;
  }
  const level = ai.getAdaptationLevel();
  assert(level < 0.5, 'many rejected → lower level');
}

section('AdaptiveAI — feedback history cap');

{
  const ai = new AdaptiveAI();
  for (let i = 0; i < 600; i++) {
    ai.learnFromFeedback({}, { accepted: true, rating: 4 });
  }
  assert(ai.feedbackLog.length <= 500, 'feedback history capped at 500');
  assert(ai.adaptationHistory.length <= 500, 'adaptation history capped at 500');
}

// ══════════════════════════════════════════════════════════════════════
// TasteSharing Tests
// ══════════════════════════════════════════════════════════════════════

section('TasteSharing — exportTaste');

{
  const sharing = new TasteSharing();
  const p = new TasteProfile('user1');
  p.learnFromEdit({ action: 'music_genre', before: 'none', after: 'jazz', context: '' });
  sharing.registerProfile(p);
  const exported = sharing.exportTaste('user1');
  assert(exported !== null, 'export returns data');
  assert(exported.userId === 'user1', 'export userId');
  assert(exported.preferences.music.preferred_genres.includes('jazz'), 'export contains jazz');
}

{
  const sharing = new TasteSharing();
  assertEq(sharing.exportTaste('nonexistent'), null, 'nonexistent user → null');
}

section('TasteSharing — importTaste');

{
  const sharing = new TasteSharing();
  const data = {
    preferences: {
      color: { temperature: 7000, contrast: 1.2, saturation: 1.1, favorite_presets: ['warm'] },
      pacing: { preferred_clip_duration: 4, cut_frequency: 0.5, rhythm_preference: 'steady' },
      music: { preferred_genres: ['classical'], bpm_range: [90, 130], energy_preference: 0.4 },
      text: { preferred_font: 'Oswald', preferred_position: 'top', animation_style: 'fade' },
      transitions: { preferred_types: ['dissolve'], avg_duration: 0.5 },
      audio: { voice_music_ratio_preference: 0.6, compression_preference: 'medium' },
      overall: { styleDNA: null, confidence_score: 0.5, edit_count: 5 },
    },
  };

  const imported = sharing.importTaste('user2', data);
  assert(imported !== null, 'import returns profile');
  assertEq(imported.preferences.color.temperature, 7000, 'imported temperature');
  assert(imported.preferences.music.preferred_genres.includes('classical'), 'imported genre');
  assertEq(imported.preferences.text.preferred_font, 'Oswald', 'imported font');
}

{
  const sharing = new TasteSharing();
  assertEq(sharing.importTaste('user2', null), null, 'null data → null');
  assertEq(sharing.importTaste('user2', {}), null, 'empty data → null');
}

section('TasteSharing — import merges without overwrite');

{
  const sharing = new TasteSharing();
  const p = new TasteProfile('user1');
  p.learnFromEdit({ action: 'music_genre', before: 'none', after: 'rock', context: '' });
  sharing.registerProfile(p);

  const data = {
    preferences: {
      color: { temperature: 7000, contrast: null, saturation: null, favorite_presets: ['warm'] },
      pacing: { preferred_clip_duration: null, cut_frequency: null, rhythm_preference: null },
      music: { preferred_genres: ['jazz'], bpm_range: [80, 140], energy_preference: null },
      text: { preferred_font: null, preferred_position: null, animation_style: null },
      transitions: { preferred_types: [], avg_duration: null },
      audio: { voice_music_ratio_preference: null, compression_preference: null },
      overall: { styleDNA: null, confidence_score: 0, edit_count: 0 },
    },
  };

  sharing.importTaste('user1', data);
  const prefs = p.getPreferences();
  assert(prefs.music.preferred_genres.includes('rock'), 'existing genre preserved');
  assert(prefs.music.preferred_genres.includes('jazz'), 'imported genre added');
}

section('TasteSharing — findSimilarUsers');

{
  const sharing = new TasteSharing();
  const p1 = new TasteProfile('user1');
  p1.learnFromEdit({ action: 'color_temperature', before: '5000', after: '6500', context: '' });
  p1.learnFromEdit({ action: 'music_genre', before: 'none', after: 'lofi', context: '' });
  p1.learnFromEdit({ action: 'clip_select', before: 'long', after: 'short', context: '' });

  const p2 = new TasteProfile('user2');
  p2.learnFromEdit({ action: 'color_temperature', before: '5000', after: '6300', context: '' });
  p2.learnFromEdit({ action: 'music_genre', before: 'none', after: 'lofi', context: '' });
  p2.learnFromEdit({ action: 'clip_select', before: 'long', after: 'short', context: '' });

  const p3 = new TasteProfile('user3');
  p3.learnFromEdit({ action: 'color_temperature', before: '5000', after: '3000', context: '' });
  p3.learnFromEdit({ action: 'music_genre', before: 'none', after: 'rock', context: '' });

  sharing.registerProfile(p1);
  sharing.registerProfile(p2);
  sharing.registerProfile(p3);

  const similar = sharing.findSimilarUsers('user1');
  assert(similar.length >= 1, 'similar users found');
  assert(similar[0].userId === 'user2', 'user2 is most similar');
  assert(similar[0].similarity_score > 0.5, 'high similarity score');
}

section('TasteSharing — shareTaste');

{
  const sharing = new TasteSharing();
  const p1 = new TasteProfile('user1');
  p1.learnFromEdit({ action: 'music_genre', before: 'none', after: 'hip-hop', context: '' });
  sharing.registerProfile(p1);

  const p2 = new TasteProfile('user2');
  sharing.registerProfile(p2);

  const result = sharing.shareTaste('user1', 'user2');
  assert(result === true, 'share returns true');
  assert(p2.preferences.music.preferred_genres.includes('hip-hop'), 'genre shared');
}

{
  const sharing = new TasteSharing();
  const result = sharing.shareTaste('nonexistent1', 'nonexistent2');
  assertEq(result, false, 'nonexistent users → false');
}

// ══════════════════════════════════════════════════════════════════════
// Integration & Edge Case Tests
// ══════════════════════════════════════════════════════════════════════

section('Integration — Full workflow: learn → predict → recommend → adapt');

{
  const p = new TasteProfile('workflow_user');
  const analyzer = new TasteAnalyzer();
  const recs = new PersonalizedRecommendations();
  const ai = new AdaptiveAI();

  // Simulate 10 diverse edits
  const edits = [
    { action: 'color_grade', before: 'none', after: 'cinematic', context: 'sunset' },
    { action: 'color_temperature', before: '5000', after: '6500', context: '' },
    { action: 'clip_select', before: 'long', after: 'short', context: 'vlog' },
    { action: 'music_choice', before: 'none', after: 'lofi', context: 'chill' },
    { action: 'text_font', before: 'Arial', after: 'Inter', context: '' },
    { action: 'transition_type', before: 'none', after: 'crossfade', context: '' },
    { action: 'audio_adjust', before: '50/50', after: '70/30', context: '' },
    { action: 'music_genre', before: 'none', after: 'ambient', context: 'relaxed' },
    { action: 'clip_select', before: 'medium', after: 'short', context: '' },
    { action: 'color_saturation', before: '0.9', after: '1.1', context: '' },
  ];

  for (const e of edits) p.learnFromEdit(e);
  assert(p.editCount === 10, 'workflow: 10 edits');

  // Analyze
  const analysis = analyzer.analyzeProject({ title: 'Chill Travel Vlog', tags: ['travel'] });
  assert(analysis.genre, 'workflow: analysis has genre');

  // Predict
  const colorPred = p.predictPreference('color');
  assert(colorPred.confidence > 0, 'workflow: color confidence > 0');

  // Recommend
  const style = recs.recommendStyle({ title: 'Chill Vlog', tags: ['vlog'] }, p);
  assert(style.style, 'workflow: style recommended');

  const music = recs.recommendMusic({ title: 'Chill Vlog', mood: 'calm' }, p);
  assert(music.genre, 'workflow: music recommended');

  // Adapt
  const output = { color: { temperature: 5500 }, music: { genre: 'pop' } };
  const adjusted = ai.adjustForUser(output, p);
  assert(adjusted._adaptation.applied, 'workflow: adaptation applied');
}

section('Edge case — Single edit user');

{
  const p = new TasteProfile('single_edit_user');
  p.learnFromEdit({ action: 'music_genre', before: 'none', after: 'jazz', context: '' });
  assert(p.editCount === 1, 'single edit count');
  assert(p.preferences.music.preferred_genres.includes('jazz'), 'single edit learned');
  const pred = p.predictPreference('music');
  assert(pred.confidence < 1, 'low confidence with 1 edit');
}

section('Edge case — Unknown action');

{
  const p = new TasteProfile('unknown_actions');
  p.learnFromEdit({ action: 'unknown_action_xyz', before: 'a', after: 'b', context: '' });
  assert(p.editCount === 1, 'unknown action still counts');
  assert(p.preferences.overall.confidence_score === 0, 'no confidence from unknown action');
}

section('Edge case — TasteAnalyzer with long-form content');

{
  const analyzer = new TasteAnalyzer();
  const result = analyzer.analyzeProject({ title: 'Epic Documentary', tags: ['documentary'], duration: 900 });
  assertEq(result.complexity, 'complex', '900s → complex');
  assertEq(result.target_audience, 'adults', 'documentary → adults');
}

section('Edge case — PersonalizedRecommendations with empty profile');

{
  const recs = new PersonalizedRecommendations();
  const style = recs.recommendStyle({}, {});
  assert(style.style, 'empty project & profile still returns style');
  assert(style.reasoning, 'reasoning provided even for empty input');
}

section('Edge case — AdaptiveAI with minimal feedback');

{
  const ai = new AdaptiveAI();
  ai.learnFromFeedback({}, { accepted: true, rating: 3 });
  const level = ai.getAdaptationLevel();
  assert(typeof level === 'number', 'level is number');
  assert(level >= 0 && level <= 1, 'level in [0,1]');
}

section('Edge case — TasteSharing with overlapping preferences');

{
  const sharing = new TasteSharing();
  const p1 = new TasteProfile('overlap_user1');
  for (const g of ['rock', 'jazz', 'classical']) {
    p1.learnFromEdit({ action: 'music_genre', before: 'none', after: g, context: '' });
  }
  sharing.registerProfile(p1);

  const p2 = new TasteProfile('overlap_user2');
  for (const g of ['rock', 'jazz', 'electronic']) {
    p2.learnFromEdit({ action: 'music_genre', before: 'none', after: g, context: '' });
  }
  sharing.registerProfile(p2);

  const similar = sharing.findSimilarUsers('overlap_user1');
  assert(similar.length > 0, 'similar users found with overlap');
  assert(similar.some(u => u.userId === 'overlap_user2'), 'overlap_user2 found similar');
}

section('Edge case — TasteAnalyzer history with diverse projects');

{
  const analyzer = new TasteAnalyzer();
  const projects = [
    { title: 'Gaming Stream', tags: ['gaming'] },
    { title: 'Tutorial JS', tags: ['tutorial'] },
    { title: 'Cinematic Film', tags: ['cinematic'] },
    { title: 'Funny Cats', tags: ['funny'] },
  ];
  const result = analyzer.analyzeHistory(projects);
  assert(result.common_patterns.length > 0, 'patterns in diverse history');
  // With 4 different genres, should have versatility
  assert(result.strengths.includes('genre_versatility'), 'genre versatility detected');
}

section('Edge case — All CATEGORIES covered in predictPreference');

{
  const p = new TasteProfile('all_cats');
  const cats = ['color', 'pacing', 'music', 'text', 'transitions', 'audio'];
  for (const cat of cats) {
    const pred = p.predictPreference(cat);
    assert(pred !== undefined, `predictPreference('${cat}') returns`);
    assert(typeof pred.confidence === 'number', `${cat} has confidence`);
  }
}

section('Edge case — TasteSharing similarity with no overlap');

{
  const sharing = new TasteSharing();
  const p1 = new TasteProfile('no_overlap1');
  p1.learnFromEdit({ action: 'color_temperature', before: '5000', after: '3000', context: '' });
  p1.learnFromEdit({ action: 'music_genre', before: 'none', after: 'rock', context: '' });

  const p2 = new TasteProfile('no_overlap2');
  p2.learnFromEdit({ action: 'color_temperature', before: '5000', after: '8000', context: '' });
  p2.learnFromEdit({ action: 'music_genre', before: 'none', after: 'classical', context: '' });

  sharing.registerProfile(p1);
  sharing.registerProfile(p2);

  const similar = sharing.findSimilarUsers('no_overlap1');
  // Might still find user2 if similarity > 0.3 threshold
  assert(Array.isArray(similar), 'findSimilarUsers returns array');
}

section('Edge case — Evolution with rapid style changes');

{
  const p = new TasteProfile('drift_user');
  // Alternate between two very different values
  for (let i = 0; i < 20; i++) {
    const val = i % 2 === 0 ? 7000 : 3000;
    p.learnFromEdit({ action: 'color_temperature', before: '5000', after: String(val), context: '' });
  }
  const evo = p.getEvolution();
  assert(evo.style_drift > 0, 'drift detected with alternating values');
  assert(typeof evo.consistency_score === 'number', 'consistency is number');
}

// ── Run summary ──

summary();
