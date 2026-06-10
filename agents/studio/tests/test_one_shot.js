/**
 * test_one_shot.js — Tests for One-Shot Creation Engine
 * 65+ tests covering all classes: OneShotEngine, IdeaParser, ThumbnailGenerator,
 * SEOGenerator, PublishingQueue, templates, and edge cases.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  OneShotEngine,
  IdeaParser,
  ThumbnailGenerator,
  SEOGenerator,
  PublishingQueue,
  TEMPLATES,
  VALID_PLATFORMS,
  DEFAULT_PLATFORMS,
  CREDIT_COSTS,
  THUMBNAIL_STYLES,
} from '../src/one_shot.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

function makeVideoResult(overrides = {}) {
  return {
    id: overrides.id || 'test-result-001',
    video: {
      timeline: {
        title: overrides.title || 'Test Video',
        duration_sec: overrides.duration || 30,
        style: overrides.style || 'cinematic',
        clips: [],
        transitions: [],
        music: { mood: 'calm', volume: 0.3 },
        text_overlays: [],
      },
      exports: [],
    },
    metadata: {
      title: overrides.title || 'Test Video',
      description: 'A test video',
      tags: overrides.tags || ['test', 'video'],
      thumbnail_url: 'thumb://test',
      thumbnail_best: { url: 'thumb://best', style: 'bold_text', ctr_score: 0.8 },
      all_thumbnails: [],
    },
    seo: {
      keywords: overrides.tags || ['test'],
      hashtags: ['#test'],
      optimal_post_time: { weekday: 'Tuesday', time_range: '10:00-14:00' },
    },
    platforms: (overrides.platforms || ['youtube', 'tiktok']).map((p) => ({
      platform: p,
      status: 'ready_to_publish',
      url: null,
    })),
    timing: { total_ms: 150, stages: [] },
    credits_used: 10,
    created_at: Date.now(),
  };
}

function makeIntent(overrides = {}) {
  return {
    subject: overrides.subject || 'test subject',
    mood: overrides.mood || ['neutral'],
    duration_preference: overrides.duration_preference || 'auto',
    platforms: overrides.platforms || [],
    style: overrides.style || 'cinematic',
    music_mood: overrides.music_mood || 'neutral',
    text_overlay: overrides.text_overlay ?? false,
    faces: overrides.faces ?? false,
    scene_types: overrides.scene_types || [],
    confidence: overrides.confidence ?? 0.5,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. IdeaParser Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('IdeaParser', () => {
  test('parse: basic idea extraction', () => {
    const parser = new IdeaParser();
    const intent = parser.parse('Make a travel vlog about Tokyo');
    assert.equal(intent.subject, 'travel vlog about Tokyo');
    assert.ok(Array.isArray(intent.mood));
    assert.ok(intent.confidence > 0);
  });

  test('parse: extracts subject from various prefixes', () => {
    const parser = new IdeaParser();
    const cases = [
      ['Create a product ad', 'product ad'],
      ['I want a tutorial video', 'tutorial video'],
      ['Please make me a funny meme', 'funny meme'],
      ['Build an epic cinematic trailer', 'epic cinematic trailer'],
    ];
    for (const [input, expected] of cases) {
      const result = parser.parse(input);
      assert.ok(result.subject.toLowerCase().includes(expected.split(' ')[0].toLowerCase()),
        `"${result.subject}" should contain "${expected.split(' ')[0]}" from "${input}"`);
    }
  });

  test('parse: detects mood keywords', () => {
    const parser = new IdeaParser();
    const result = parser.parse('Make an energetic and funny video');
    assert.ok(result.mood.includes('energetic'));
    assert.ok(result.mood.includes('funny'));
  });

  test('parse: detects calm/chill mood', () => {
    const parser = new IdeaParser();
    const result = parser.parse('A chill lo-fi travel video');
    assert.ok(result.mood.includes('calm'));
  });

  test('parse: detects cinematic style', () => {
    const parser = new IdeaParser();
    const result = parser.parse('A cinematic film-quality video');
    assert.equal(result.style, 'cinematic');
  });

  test('parse: detects fast style', () => {
    const parser = new IdeaParser();
    const result = parser.parse('A fast snappy video with quick cuts');
    assert.equal(result.style, 'fast');
  });

  test('parse: detects funny style', () => {
    const parser = new IdeaParser();
    const result = parser.parse('Make a funny hilarious comedy video');
    assert.equal(result.style, 'funny');
  });

  test('parse: detects educational style', () => {
    const parser = new IdeaParser();
    const result = parser.parse('A tutorial video explaining coding');
    assert.equal(result.style, 'educational');
  });

  test('parse: detects scene types', () => {
    const parser = new IdeaParser();
    const result = parser.parse('Landscape shots with drone aerial footage');
    assert.ok(result.scene_types.includes('landscape'));
    assert.ok(result.scene_types.includes('aerial'));
  });

  test('parse: detects platforms from text', () => {
    const parser = new IdeaParser();
    const result = parser.parse('Make a TikTok viral video for Instagram Reels');
    assert.ok(result.platforms.includes('tiktok'));
    assert.ok(result.platforms.includes('instagram_reels'));
  });

  test('parse: detects duration from text', () => {
    const parser = new IdeaParser();
    const result = parser.parse('Make a 30 second clip');
    assert.equal(result.duration_preference, '30s');
  });

  test('parse: detects duration in minutes', () => {
    const parser = new IdeaParser();
    const result = parser.parse('Make a 2 minute video');
    assert.equal(result.duration_preference, '120s');
  });

  test('parse: detects short preference', () => {
    const parser = new IdeaParser();
    const result = parser.parse('A short quick clip');
    assert.equal(result.duration_preference, '15s');
  });

  test('parse: detects long preference', () => {
    const parser = new IdeaParser();
    const result = parser.parse('A long extended documentary');
    assert.equal(result.duration_preference, '120s');
  });

  test('parse: detects text overlay request', () => {
    const parser = new IdeaParser();
    const result = parser.parse('Video with text overlay subtitles');
    assert.equal(result.text_overlay, true);
  });

  test('parse: detects faces/people', () => {
    const parser = new IdeaParser();
    const result = parser.parse('Interview with a person talking');
    assert.equal(result.faces, true);
  });

  test('parse: throws on empty input', () => {
    const parser = new IdeaParser();
    assert.throws(() => parser.parse(''), /non-empty string/);
    assert.throws(() => parser.parse(null), /non-empty string/);
    assert.throws(() => parser.parse(undefined), /non-empty string/);
  });

  test('parse: low confidence for vague input', () => {
    const parser = new IdeaParser();
    const result = parser.parse('video');
    assert.ok(result.confidence < 0.5, `Expected low confidence, got ${result.confidence}`);
  });

  test('parse: high confidence for detailed input', () => {
    const parser = new IdeaParser();
    const result = parser.parse(
      'Make a 30 second energetic cinematic TikTok video with dramatic closeup shots and text overlays'
    );
    assert.ok(result.confidence >= 0.6, `Expected high confidence, got ${result.confidence}`);
  });

  test('suggestDuration: returns parsed duration when available', () => {
    const parser = new IdeaParser();
    const intent = makeIntent({ duration_preference: '45s' });
    assert.equal(parser.suggestDuration(intent), 45);
  });

  test('suggestDuration: returns style-based default for auto', () => {
    const parser = new IdeaParser();
    assert.equal(parser.suggestDuration(makeIntent({ style: 'fast' })), 15);
    assert.equal(parser.suggestDuration(makeIntent({ style: 'vlog' })), 60);
    assert.equal(parser.suggestDuration(makeIntent({ style: 'educational' })), 90);
    assert.equal(parser.suggestDuration(makeIntent({ style: 'product' })), 30);
    assert.equal(parser.suggestDuration(makeIntent({ style: 'funny' })), 30);
  });

  test('suggestDuration: returns default for unknown style', () => {
    const parser = new IdeaParser();
    assert.equal(parser.suggestDuration(makeIntent({ style: 'unknown' })), 30);
  });

  test('suggestPlatform: returns detected platforms', () => {
    const parser = new IdeaParser();
    const intent = makeIntent({ platforms: ['youtube'] });
    assert.deepEqual(parser.suggestPlatform(intent), ['youtube']);
  });

  test('suggestPlatform: returns defaults when none detected', () => {
    const parser = new IdeaParser();
    const intent = makeIntent({ platforms: [] });
    assert.deepEqual(parser.suggestPlatform(intent), DEFAULT_PLATFORMS);
  });

  test('suggestStyle: returns detected style', () => {
    const parser = new IdeaParser();
    assert.equal(parser.suggestStyle(makeIntent({ style: 'fast' })), 'fast');
  });

  test('suggestStyle: returns cinematic for empty', () => {
    const parser = new IdeaParser();
    assert.equal(parser.suggestStyle(makeIntent({})), 'cinematic');
  });

  test('enrichIntent: fills defaults', () => {
    const parser = new IdeaParser();
    const intent = makeIntent({});
    const enriched = parser.enrichIntent(intent);
    assert.ok(enriched.platforms.length > 0);
    assert.ok(enriched.mood.length > 0);
    assert.ok(enriched.duration_preference !== 'auto');
  });

  test('enrichIntent: applies template overrides', () => {
    const parser = new IdeaParser();
    const intent = makeIntent({});
    const template = {
      default_style: 'funny',
      default_platforms: ['tiktok'],
      default_mood: 'energetic',
      default_duration: 15,
      default_music_mood: 'upbeat',
      scene_types: ['action'],
      text_overlay: true,
    };
    const enriched = parser.enrichIntent(intent, template);
    assert.equal(enriched.style, 'funny');
    assert.deepEqual(enriched.platforms, ['tiktok']);
    assert.deepEqual(enriched.mood, ['energetic']);
    assert.equal(enriched.duration_preference, '15s');
    assert.equal(enriched.music_mood, 'upbeat');
    assert.deepEqual(enriched.scene_types, ['action']);
    assert.equal(enriched.text_overlay, true);
  });

  test('enrichIntent: does not override existing values', () => {
    const parser = new IdeaParser();
    const intent = makeIntent({ style: 'fast', platforms: ['youtube'] });
    const template = { default_style: 'funny', default_platforms: ['tiktok'] };
    const enriched = parser.enrichIntent(intent, template);
    assert.equal(enriched.style, 'fast');
    assert.deepEqual(enriched.platforms, ['youtube']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. ThumbnailGenerator Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('ThumbnailGenerator', () => {
  test('generate: returns 3 thumbnails', () => {
    const gen = new ThumbnailGenerator();
    const thumbs = gen.generate(makeVideoResult());
    assert.equal(thumbs.length, 3);
  });

  test('generate: each thumbnail has required fields', () => {
    const gen = new ThumbnailGenerator();
    const thumbs = gen.generate(makeVideoResult());
    for (const t of thumbs) {
      assert.ok(t.url, 'should have url');
      assert.ok(THUMBNAIL_STYLES.includes(t.style), `style "${t.style}" should be valid`);
      assert.ok(t.text_overlay, 'should have text_overlay');
      assert.ok(typeof t.ctr_score === 'number', 'ctr_score should be number');
      assert.ok(t.ctr_score >= 0 && t.ctr_score <= 1, 'ctr_score should be 0-1');
      assert.equal(t.width, 1280);
      assert.equal(t.height, 720);
      assert.equal(t.format, 'jpg');
    }
  });

  test('generate: uses deterministic styles per video', () => {
    const gen = new ThumbnailGenerator();
    const thumbs = gen.generate(makeVideoResult());
    const styles = thumbs.map((t) => t.style);
    // Should cycle through THUMBNAIL_STYLES
    assert.ok(styles.includes('bold_text'));
    assert.ok(styles.includes('face_closeup'));
    assert.ok(styles.includes('split_screen'));
  });

  test('generate: throws on null input', () => {
    const gen = new ThumbnailGenerator();
    assert.throws(() => gen.generate(null), /required/);
  });

  test('selectBest: returns thumbnail with highest CTR', () => {
    const gen = new ThumbnailGenerator();
    const thumbs = [
      { ctr_score: 0.3, url: 'a' },
      { ctr_score: 0.9, url: 'b' },
      { ctr_score: 0.5, url: 'c' },
    ];
    const best = gen.selectBest(thumbs);
    assert.equal(best.url, 'b');
    assert.equal(best.ctr_score, 0.9);
  });

  test('selectBest: returns first if tied', () => {
    const gen = new ThumbnailGenerator();
    const thumbs = [
      { ctr_score: 0.7, url: 'a' },
      { ctr_score: 0.7, url: 'b' },
    ];
    const best = gen.selectBest(thumbs);
    assert.equal(best.url, 'a');
  });

  test('selectBest: throws on empty array', () => {
    const gen = new ThumbnailGenerator();
    assert.throws(() => gen.selectBest([]), /at least one/i);
  });

  test('generate: text overlay position varies by style', () => {
    const gen = new ThumbnailGenerator();
    const thumbs = gen.generate(makeVideoResult());
    const positions = thumbs.map((t) => t.text_overlay.position);
    // With deterministic seed for "Test Video", styles cycle: bold_text(center), face_closeup(none), split_screen(right)
    assert.ok(positions.includes('center'));
    assert.ok(positions.includes('right'));
    // Positions are unique per style (center, none, right for first 3)
    assert.ok(new Set(positions).size >= 2, 'Should have at least 2 distinct positions');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. SEOGenerator Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('SEOGenerator', () => {
  test('generateTitle: returns 3 title options', () => {
    const gen = new SEOGenerator();
    const titles = gen.generateTitle(makeVideoResult());
    assert.equal(titles.length, 3);
    for (const t of titles) {
      assert.ok(typeof t === 'string' && t.length > 0);
    }
  });

  test('generateTitle: titles contain subject', () => {
    const gen = new SEOGenerator();
    const result = makeVideoResult({ title: 'My Amazing Video' });
    const titles = gen.generateTitle(result);
    for (const t of titles) {
      assert.ok(t.includes('My Amazing Video'), `Title "${t}" should contain subject`);
    }
  });

  test('generateTitle: titles contain emoji option', () => {
    const gen = new SEOGenerator();
    const titles = gen.generateTitle(makeVideoResult());
    assert.ok(titles.some((t) => t.includes('🎬')), 'One title should have film emoji');
  });

  test('generateDescription: returns non-empty string', () => {
    const gen = new SEOGenerator();
    const desc = gen.generateDescription(makeVideoResult());
    assert.ok(typeof desc === 'string' && desc.length > 0);
  });

  test('generateDescription: includes subject', () => {
    const gen = new SEOGenerator();
    const result = makeVideoResult({ title: 'Tokyo Travel' });
    const desc = gen.generateDescription(result);
    assert.ok(desc.includes('Tokyo Travel'));
  });

  test('generateDescription: includes VireoStudio hashtag', () => {
    const gen = new SEOGenerator();
    const desc = gen.generateDescription(makeVideoResult());
    assert.ok(desc.includes('#VireoStudio'));
  });

  test('generateDescription: includes platform names', () => {
    const gen = new SEOGenerator();
    const desc = gen.generateDescription(makeVideoResult({ platforms: ['youtube', 'tiktok'] }));
    assert.ok(desc.includes('YouTube'));
    assert.ok(desc.includes('TikTok'));
  });

  test('generateTags: returns array of tags', () => {
    const gen = new SEOGenerator();
    const tags = gen.generateTags(makeVideoResult());
    assert.ok(Array.isArray(tags));
    assert.ok(tags.length > 0);
  });

  test('generateTags: limits to 20 tags', () => {
    const gen = new SEOGenerator();
    const tags = gen.generateTags(makeVideoResult({ tags: Array.from({ length: 30 }, (_, i) => `tag${i}`) }));
    assert.ok(tags.length <= 20);
  });

  test('generateTags: filters short words', () => {
    const gen = new SEOGenerator();
    const result = makeVideoResult({ title: 'a b c the and of', tags: [] });
    const tags = gen.generateTags(result);
    for (const tag of tags) {
      assert.ok(tag.length >= 3, `Tag "${tag}" should be at least 3 chars`);
    }
  });

  test('generateHashtags: returns hashtags starting with #', () => {
    const gen = new SEOGenerator();
    const hashtags = gen.generateHashtags(makeVideoResult());
    assert.ok(Array.isArray(hashtags));
    assert.ok(hashtags.length > 0);
    for (const h of hashtags) {
      assert.ok(h.startsWith('#'), `Hashtag "${h}" should start with #`);
    }
  });

  test('generateHashtags: includes VireoStudio hashtag', () => {
    const gen = new SEOGenerator();
    const hashtags = gen.generateHashtags(makeVideoResult());
    assert.ok(hashtags.includes('#VireoStudio'));
  });

  test('generateHashtags: limits to 11 total', () => {
    const gen = new SEOGenerator();
    const hashtags = gen.generateHashtags(makeVideoResult({
      tags: Array.from({ length: 30 }, (_, i) => `word${i}`)
    }));
    assert.ok(hashtags.length <= 11);
  });

  test('generateComplete: returns full bundle', () => {
    const gen = new SEOGenerator();
    const bundle = gen.generateComplete(makeVideoResult());
    assert.ok(bundle.title);
    assert.ok(Array.isArray(bundle.title_options));
    assert.equal(bundle.title_options.length, 3);
    assert.ok(bundle.description);
    assert.ok(Array.isArray(bundle.tags));
    assert.ok(Array.isArray(bundle.hashtags));
    assert.ok(bundle.optimal_post_time);
    assert.ok(bundle.optimal_post_time.weekday);
    assert.ok(bundle.optimal_post_time.time_range);
  });

  test('generateComplete: title matches first title_option', () => {
    const gen = new SEOGenerator();
    const bundle = gen.generateComplete(makeVideoResult());
    assert.equal(bundle.title, bundle.title_options[0]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. PublishingQueue Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('PublishingQueue', () => {
  test('enqueue: adds item to queue', () => {
    const q = new PublishingQueue();
    const item = q.enqueue(makeVideoResult(), ['youtube']);
    assert.ok(item.id);
    assert.equal(item.status, 'queued');
    assert.equal(item.platforms.length, 1);
    assert.equal(item.platforms[0].platform, 'youtube');
    assert.equal(item.platforms[0].status, 'pending');
  });

  test('enqueue: supports multiple platforms', () => {
    const q = new PublishingQueue();
    const item = q.enqueue(makeVideoResult(), ['youtube', 'tiktok', 'facebook']);
    assert.equal(item.platforms.length, 3);
  });

  test('enqueue: throws on null videoResult', () => {
    const q = new PublishingQueue();
    assert.throws(() => q.enqueue(null, ['youtube']), /required/);
  });

  test('enqueue: throws on empty platforms', () => {
    const q = new PublishingQueue();
    assert.throws(() => q.enqueue(makeVideoResult(), []), /at least one/i);
  });

  test('processNext: processes and completes item', () => {
    const q = new PublishingQueue();
    q.enqueue(makeVideoResult(), ['youtube']);
    const processed = q.processNext();
    assert.equal(processed.status, 'completed');
    assert.equal(processed.platforms[0].status, 'published');
    assert.ok(processed.platforms[0].url);
    assert.ok(processed.completed_at);
  });

  test('processNext: processes all platforms in item', () => {
    const q = new PublishingQueue();
    q.enqueue(makeVideoResult(), ['youtube', 'tiktok']);
    const processed = q.processNext();
    for (const p of processed.platforms) {
      assert.equal(p.status, 'published');
      assert.ok(p.url);
    }
  });

  test('processNext: returns null when queue is empty', () => {
    const q = new PublishingQueue();
    assert.equal(q.processNext(), null);
  });

  test('processNext: processes in FIFO order', () => {
    const q = new PublishingQueue();
    const r1 = makeVideoResult({ title: 'First' });
    const r2 = makeVideoResult({ title: 'Second' });
    q.enqueue(r1, ['youtube']);
    q.enqueue(r2, ['tiktok']);
    const p1 = q.processNext();
    assert.equal(p1.videoResult.metadata.title, 'First');
    const p2 = q.processNext();
    assert.equal(p2.videoResult.metadata.title, 'Second');
  });

  test('getStatus: returns status for queued item', () => {
    const q = new PublishingQueue();
    const item = q.enqueue(makeVideoResult(), ['youtube']);
    const status = q.getStatus(item.id);
    assert.ok(status);
    assert.equal(status.id, item.id);
    assert.equal(status.status, 'queued');
  });

  test('getStatus: returns status for completed item', () => {
    const q = new PublishingQueue();
    const item = q.enqueue(makeVideoResult(), ['youtube']);
    q.processNext();
    const status = q.getStatus(item.id);
    assert.equal(status.status, 'completed');
  });

  test('getStatus: returns null for unknown id', () => {
    const q = new PublishingQueue();
    assert.equal(q.getStatus('nonexistent'), null);
  });

  test('getQueue: returns current queue items', () => {
    const q = new PublishingQueue();
    q.enqueue(makeVideoResult(), ['youtube']);
    q.enqueue(makeVideoResult(), ['tiktok']);
    assert.equal(q.getQueue().length, 2);
  });

  test('getQueue: returns empty array when empty', () => {
    const q = new PublishingQueue();
    assert.deepEqual(q.getQueue(), []);
  });

  test('getQueue: does not include processed items', () => {
    const q = new PublishingQueue();
    q.enqueue(makeVideoResult(), ['youtube']);
    q.processNext();
    assert.equal(q.getQueue().length, 0);
  });

  test('cancel: removes item from queue', () => {
    const q = new PublishingQueue();
    const item = q.enqueue(makeVideoResult(), ['youtube']);
    const result = q.cancel(item.id);
    assert.equal(result, true);
    assert.equal(q.getQueue().length, 0);
    assert.equal(q.getStatus(item.id).status, 'cancelled');
  });

  test('cancel: returns false for unknown id', () => {
    const q = new PublishingQueue();
    assert.equal(q.cancel('nonexistent'), false);
  });

  test('retry: re-queues a processed item', () => {
    const q = new PublishingQueue();
    const item = q.enqueue(makeVideoResult(), ['youtube']);
    q.processNext();
    const retried = q.retry(item.id);
    assert.ok(retried);
    assert.equal(retried.status, 'queued');
    assert.equal(q.getQueue().length, 1);
  });

  test('retry: returns null for unknown id', () => {
    const q = new PublishingQueue();
    assert.equal(q.retry('nonexistent'), null);
  });

  test('retry: resets failed platform statuses', () => {
    const q = new PublishingQueue();
    const item = q.enqueue(makeVideoResult(), ['youtube']);
    item.platforms[0].status = 'failed';
    q._processed.set(item.id, item);
    q._queue.delete(item.id);
    q.retry(item.id);
    const status = q.getStatus(item.id);
    assert.equal(status.platforms[0].status, 'pending');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. OneShotEngine Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('OneShotEngine', () => {
  test('constructor: creates with defaults', () => {
    const engine = new OneShotEngine();
    assert.ok(engine);
  });

  test('constructor: accepts optional dependencies', () => {
    const engine = new OneShotEngine({
      higgsfield_client: { generateVideo: async () => ({}) },
      personalization: { preferences: { color: {} } },
      ai_director: { composeTimeline: async () => ({}) },
    });
    assert.ok(engine);
  });

  test('createFromIdea: returns complete result structure', async () => {
    const engine = new OneShotEngine();
    const result = await engine.createFromIdea('Make a travel vlog about Tokyo');
    assert.ok(result.id);
    assert.ok(result.video);
    assert.ok(result.video.timeline);
    assert.ok(Array.isArray(result.video.exports));
    assert.ok(result.metadata);
    assert.ok(result.metadata.title);
    assert.ok(result.metadata.description);
    assert.ok(Array.isArray(result.metadata.tags));
    assert.ok(result.metadata.thumbnail_url);
    assert.ok(result.seo);
    assert.ok(Array.isArray(result.seo.keywords));
    assert.ok(Array.isArray(result.seo.hashtags));
    assert.ok(result.seo.optimal_post_time);
    assert.ok(Array.isArray(result.platforms));
    assert.ok(result.timing);
    assert.ok(typeof result.timing.total_ms === 'number');
    assert.ok(Array.isArray(result.timing.stages));
    assert.ok(typeof result.credits_used === 'number');
  });

  test('createFromIdea: respects platform option', async () => {
    const engine = new OneShotEngine();
    const result = await engine.createFromIdea('Funny video', { platforms: ['youtube'] });
    assert.equal(result.platforms.length, 1);
    assert.equal(result.platforms[0].platform, 'youtube');
  });

  test('createFromIdea: respects duration option', async () => {
    const engine = new OneShotEngine();
    const result = await engine.createFromIdea('Quick clip', { duration_sec: 15 });
    assert.equal(result.video.timeline.duration_sec, 15);
  });

  test('createFromIdea: respects style option', async () => {
    const engine = new OneShotEngine();
    const result = await engine.createFromIdea('Video', { style: 'funny' });
    assert.equal(result.video.timeline.style, 'funny');
  });

  test('createFromIdea: generates thumbnails', async () => {
    const engine = new OneShotEngine();
    const result = await engine.createFromIdea('Travel vlog');
    assert.ok(Array.isArray(result.metadata.all_thumbnails));
    assert.equal(result.metadata.all_thumbnails.length, 3);
    assert.ok(result.metadata.thumbnail_best);
  });

  test('createFromIdea: generates SEO bundle', async () => {
    const engine = new OneShotEngine();
    const result = await engine.createFromIdea('Product ad for shoes');
    assert.ok(result.seo.keywords.length > 0);
    assert.ok(result.seo.hashtags.length > 0);
    assert.ok(result.metadata.title_options.length === 3);
  });

  test('createFromIdea: tracks timing stages', async () => {
    const engine = new OneShotEngine();
    const result = await engine.createFromIdea('Video');
    const stageNames = result.timing.stages.map((s) => s.name);
    assert.ok(stageNames.includes('idea_parsing'));
    assert.ok(stageNames.includes('footage_generation'));
    assert.ok(stageNames.includes('ai_directing'));
    assert.ok(stageNames.includes('personalization'));
    assert.ok(stageNames.includes('platform_export'));
    assert.ok(stageNames.includes('thumbnail_seo'));
    assert.ok(stageNames.includes('publish_prep'));
  });

  test('createFromIdea: generates exports for each platform', async () => {
    const engine = new OneShotEngine();
    const result = await engine.createFromIdea('Video', {
      platforms: ['youtube', 'tiktok', 'instagram_reels']
    });
    assert.equal(result.video.exports.length, 3);
    const platNames = result.video.exports.map((e) => e.platform);
    assert.ok(platNames.includes('youtube'));
    assert.ok(platNames.includes('tiktok'));
    assert.ok(platNames.includes('instagram_reels'));
  });

  test('createFromImage: includes image reference', async () => {
    const engine = new OneShotEngine();
    const result = await engine.createFromImage(
      'https://example.com/photo.jpg',
      'Make a video from this image'
    );
    assert.equal(result.image_reference, 'https://example.com/photo.jpg');
    assert.equal(result.video.timeline.reference_image, 'https://example.com/photo.jpg');
  });

  test('createFromImage: throws without imageUrl', async () => {
    const engine = new OneShotEngine();
    await assert.rejects(() => engine.createFromImage(null, 'idea'), /imageUrl/);
  });

  test('createFromImage: throws without idea', async () => {
    const engine = new OneShotEngine();
    await assert.rejects(() => engine.createFromImage('http://img.jpg', ''), /idea/);
  });

  test('createBatch: creates multiple videos', async () => {
    const engine = new OneShotEngine();
    const results = await engine.createBatch([
      'Travel vlog',
      'Product ad',
      'Tutorial video',
    ]);
    assert.equal(results.length, 3);
    for (const r of results) {
      assert.ok(r.id);
      assert.ok(r.video);
    }
  });

  test('createBatch: throws on empty array', async () => {
    const engine = new OneShotEngine();
    await assert.rejects(() => engine.createBatch([]), /at least one/i);
  });

  test('getTemplates: returns all templates', () => {
    const engine = new OneShotEngine();
    const templates = engine.getTemplates();
    assert.ok(Array.isArray(templates));
    assert.ok(templates.length >= 8);
    const ids = templates.map((t) => t.id);
    assert.ok(ids.includes('travel_vlog'));
    assert.ok(ids.includes('product_ad'));
    assert.ok(ids.includes('tutorial'));
    assert.ok(ids.includes('social_reel'));
    assert.ok(ids.includes('podcast_clip'));
    assert.ok(ids.includes('music_visualizer'));
    assert.ok(ids.includes('news_report'));
    assert.ok(ids.includes('meme_video'));
  });

  test('getTemplates: each template has required fields', () => {
    const engine = new OneShotEngine();
    const templates = engine.getTemplates();
    for (const t of templates) {
      assert.ok(t.id);
      assert.ok(t.name);
      assert.ok(t.description);
      assert.ok(t.default_style);
      assert.ok(Array.isArray(t.default_platforms));
      assert.ok(typeof t.default_duration === 'number');
    }
  });

  test('createFromTemplate: creates video from template', async () => {
    const engine = new OneShotEngine();
    const result = await engine.createFromTemplate('travel_vlog', {
      description: 'My trip to Paris',
    });
    assert.equal(result.template_used, 'travel_vlog');
    assert.ok(result.video);
  });

  test('createFromTemplate: throws on invalid template', async () => {
    const engine = new OneShotEngine();
    await assert.rejects(
      () => engine.createFromTemplate('nonexistent'),
      /not found/
    );
  });

  test('createFromTemplate: applies customizations', async () => {
    const engine = new OneShotEngine();
    const result = await engine.createFromTemplate('social_reel', {
      platforms: ['tiktok'],
      duration_sec: 10,
    });
    assert.equal(result.template_used, 'social_reel');
    assert.ok(result.platforms.some((p) => p.platform === 'tiktok'));
  });

  test('estimateTime: returns timing estimates', () => {
    const engine = new OneShotEngine();
    const est = engine.estimateTime('Make a cinematic travel video');
    assert.ok(typeof est.parsing_ms === 'number');
    assert.ok(typeof est.generation_ms === 'number');
    assert.ok(typeof est.editing_ms === 'number');
    assert.ok(typeof est.export_ms === 'number');
    assert.ok(typeof est.total_ms === 'number');
    assert.ok(est.total_ms > 0);
  });

  test('estimateTime: longer videos take more time', () => {
    const engine = new OneShotEngine();
    const short = engine.estimateTime('Quick 5 second clip');
    const long = engine.estimateTime('Long 10 minute documentary');
    assert.ok(long.total_ms > short.total_ms);
  });

  test('estimateCredits: returns credit estimates', () => {
    const engine = new OneShotEngine();
    const est = engine.estimateCredits('Make a video');
    assert.ok(typeof est.video_gen === 'number');
    assert.ok(typeof est.editing === 'number');
    assert.ok(typeof est.export === 'number');
    assert.ok(typeof est.total === 'number');
    assert.ok(est.total > 0);
    assert.ok(est.plan_recommended);
  });

  test('estimateCredits: more platforms = more export credits', () => {
    const engine = new OneShotEngine();
    const single = engine.estimateCredits('Video for YouTube only');
    const multi = engine.estimateCredits('Video for YouTube, TikTok, Instagram');
    assert.ok(multi.export > single.export);
  });

  test('createFromIdea: returns unique IDs', async () => {
    const engine = new OneShotEngine();
    const r1 = await engine.createFromIdea('Video 1');
    const r2 = await engine.createFromIdea('Video 2');
    assert.notEqual(r1.id, r2.id);
  });

  test('createFromIdea: includes created_at timestamp', async () => {
    const engine = new OneShotEngine();
    const before = Date.now();
    const result = await engine.createFromIdea('Video');
    const after = Date.now();
    assert.ok(result.created_at >= before);
    assert.ok(result.created_at <= after);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Constants and Export Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('Constants', () => {
  test('VALID_PLATFORMS: includes all expected platforms', () => {
    assert.ok(VALID_PLATFORMS.includes('youtube'));
    assert.ok(VALID_PLATFORMS.includes('tiktok'));
    assert.ok(VALID_PLATFORMS.includes('instagram_reels'));
    assert.ok(VALID_PLATFORMS.includes('instagram_feed'));
    assert.ok(VALID_PLATFORMS.includes('twitter'));
    assert.ok(VALID_PLATFORMS.includes('facebook'));
    assert.ok(VALID_PLATFORMS.includes('linkedin'));
  });

  test('DEFAULT_PLATFORMS: has sensible defaults', () => {
    assert.ok(DEFAULT_PLATFORMS.includes('youtube'));
    assert.ok(DEFAULT_PLATFORMS.includes('tiktok'));
    assert.ok(DEFAULT_PLATFORMS.includes('instagram_reels'));
  });

  test('CREDIT_COSTS: all costs are non-negative', () => {
    for (const [key, val] of Object.entries(CREDIT_COSTS)) {
      assert.ok(val >= 0, `Credit cost "${key}" should be >= 0`);
    }
  });

  test('THUMBNAIL_STYLES: has expected styles', () => {
    assert.ok(THUMBNAIL_STYLES.includes('bold_text'));
    assert.ok(THUMBNAIL_STYLES.includes('face_closeup'));
    assert.ok(THUMBNAIL_STYLES.includes('split_screen'));
  });

  test('TEMPLATES: all 8 templates exist', () => {
    const keys = Object.keys(TEMPLATES);
    assert.equal(keys.length, 8);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Integration & Edge Case Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('Integration & Edge Cases', () => {
  test('full pipeline: idea → result → thumbnail → SEO → publish', async () => {
    const engine = new OneShotEngine();
    const result = await engine.createFromIdea(
      'Make an energetic product ad for a new phone with text overlays',
      { platforms: ['youtube', 'tiktok', 'instagram_reels'] }
    );

    // Verify full pipeline completed
    assert.ok(result.video.timeline);
    assert.ok(result.video.exports.length === 3);
    assert.ok(result.metadata.all_thumbnails.length === 3);
    assert.ok(result.seo.keywords.length > 0);
    assert.ok(result.seo.hashtags.length > 0);
    assert.ok(result.platforms.length === 3);

    // Queue for publishing
    const queue = new PublishingQueue();
    const queued = queue.enqueue(result, result.platforms.map((p) => p.platform));
    assert.equal(queued.platforms.length, 3);

    // Process
    const processed = queue.processNext();
    assert.equal(processed.status, 'completed');
    for (const p of processed.platforms) {
      assert.equal(p.status, 'published');
      assert.ok(p.url);
    }
  });

  test('engine with higgsfield client', async () => {
    const mockClient = {
      generateVideo: async (opts) => ({
        id: 'gen-001',
        clips: [{ id: 'clip-001', path: 'gen_clip.mp4', duration_sec: opts.duration }],
      }),
    };
    const engine = new OneShotEngine({ higgsfield_client: mockClient });
    const result = await engine.createFromIdea('Travel video');
    assert.ok(result.video.timeline);
  });

  test('engine with personalization', async () => {
    const mockProfile = {
      preferences: {
        color: { temperature: 0.7 },
        pacing: { speed: 0.8 },
      },
    };
    const engine = new OneShotEngine({ personalization: mockProfile });
    const result = await engine.createFromIdea('Cinematic video');
    assert.ok(result.video.timeline.personalized);
  });

  test('engine with AI director', async () => {
    const mockDirector = {
      composeTimeline: async (brief) => ({
        title: brief.description,
        duration_sec: brief.duration_sec,
        style: brief.style,
        clips: brief.footage,
        transitions: [],
        music: { mood: brief.music_mood, volume: 0.3 },
        text_overlays: [],
        ai_directed: true,
      }),
    };
    const engine = new OneShotEngine({ ai_director: mockDirector });
    const result = await engine.createFromIdea('AI directed video');
    assert.ok(result.video.timeline);
  });

  test('createFromIdea with very long idea', async () => {
    const engine = new OneShotEngine();
    const longIdea = 'Make a '.repeat(50) + 'travel vlog about Tokyo with chill lo-fi music';
    const result = await engine.createFromIdea(longIdea);
    assert.ok(result.id);
    assert.ok(result.metadata.title);
  });

  test('createFromIdea with special characters', async () => {
    const engine = new OneShotEngine();
    const result = await engine.createFromIdea('Make a video about 你好世界 & <html> stuff!');
    assert.ok(result.id);
  });

  test('multiple engines are independent', async () => {
    const e1 = new OneShotEngine();
    const e2 = new OneShotEngine();
    const r1 = await e1.createFromIdea('Video 1');
    const r2 = await e2.createFromIdea('Video 2');
    assert.notEqual(r1.id, r2.id);
  });

  test('publishing queue: concurrent operations', () => {
    const q = new PublishingQueue();
    q.enqueue(makeVideoResult(), ['youtube']);
    q.enqueue(makeVideoResult(), ['tiktok']);
    q.enqueue(makeVideoResult(), ['facebook']);

    const p1 = q.processNext();
    assert.equal(p1.status, 'completed');
    assert.equal(q.getQueue().length, 2);

    q.cancel(q.getQueue()[0].id);
    assert.equal(q.getQueue().length, 1);

    const p2 = q.processNext();
    assert.equal(p2.status, 'completed');
    assert.equal(q.getQueue().length, 0);
  });

  test('template video: social_reel uses 9:16 exports', async () => {
    const engine = new OneShotEngine();
    const result = await engine.createFromTemplate('social_reel');
    // Social reel default platforms are instagram_reels + tiktok (both 9:16)
    const exportRatios = result.video.exports.map((e) => e.aspect_ratio);
    assert.ok(exportRatios.every((r) => r === '9:16'),
      `All exports should be 9:16 for social_reel, got: ${exportRatios}`);
  });

  test('credits scale with platforms', async () => {
    const engine = new OneShotEngine();
    const r1 = await engine.createFromIdea('Video', { platforms: ['youtube'] });
    const r3 = await engine.createFromIdea('Video', {
      platforms: ['youtube', 'tiktok', 'instagram_reels']
    });
    assert.ok(r3.credits_used >= r1.credits_used);
  });

  test('IdeaParser: music mood detection', () => {
    const parser = new IdeaParser();
    const r1 = parser.parse('Chill lo-fi beat video');
    assert.equal(r1.music_mood, 'chill');
    const r2 = parser.parse('Hip hop trap music visualizer');
    assert.equal(r2.music_mood, 'hip_hop');
    const r3 = parser.parse('Acoustic guitar tutorial');
    assert.equal(r3.music_mood, 'acoustic');
    const r4 = parser.parse('Electronic EDM synthwave');
    assert.equal(r4.music_mood, 'electronic');
  });

  test('IdeaParser: vlog style detection', () => {
    const parser = new IdeaParser();
    const r = parser.parse('A daily vlog about my morning routine');
    assert.equal(r.style, 'vlog');
  });

  test('IdeaParser: product style detection', () => {
    const parser = new IdeaParser();
    const r = parser.parse('Product ad commercial for shoes');
    assert.equal(r.style, 'product');
  });

  test('IdeaParser: news style detection', () => {
    const parser = new IdeaParser();
    const r = parser.parse('Breaking news report headline update');
    assert.equal(r.style, 'news');
  });

  test('IdeaParser: music style detection', () => {
    const parser = new IdeaParser();
    const r = parser.parse('Music visualizer beat synced audio');
    assert.equal(r.style, 'music');
  });
});
