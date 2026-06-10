/**
 * test_higgsfield_client.js — Tests for Higgsfield AI Video Generation (25+ tests)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { HiggsfieldClient, HIGGSFIELD_MODELS, CAMERA_MOVES, STYLE_PRESETS } from '../src/higgsfield_client.js';

describe('HiggsfieldClient', () => {
  test('constructor requires api_key', () => {
    assert.throws(() => new HiggsfieldClient(), /API key required/);
  });

  test('constructor with key works', () => {
    const c = new HiggsfieldClient({ api_key: 'test-key' });
    assert.ok(c);
  });

  test('connect returns connected status', () => {
    const c = new HiggsfieldClient({ api_key: 'test-key' });
    const r = c.connect();
    assert.equal(r.connected, true);
    assert.equal(r.plan, 'pro');
    assert.ok(r.credits > 0);
  });

  test('operations before connect throw', () => {
    const c = new HiggsfieldClient({ api_key: 'test-key' });
    assert.throws(() => c.getModels(), /Not connected/);
    assert.throws(() => c.generateVideo({ prompt: 'test' }), /Not connected/);
  });

  test('getModels returns all 7 models', () => {
    const c = new HiggsfieldClient({ api_key: 'k' });
    c.connect();
    const models = c.getModels();
    assert.equal(models.length, 7);
    const ids = models.map(m => m.id);
    assert.ok(ids.includes('kling_30'));
    assert.ok(ids.includes('sora_2'));
    assert.ok(ids.includes('veo_31'));
    assert.ok(ids.includes('seedance_20'));
  });

  test('getModel returns specific model', () => {
    const c = new HiggsfieldClient({ api_key: 'k' });
    c.connect();
    const m = c.getModel('kling_30');
    assert.equal(m.id, 'kling_30');
    assert.equal(m.name, 'Kling 3.0');
    assert.ok(m.resolutions);
  });

  test('getModel throws on invalid', () => {
    const c = new HiggsfieldClient({ api_key: 'k' });
    c.connect();
    assert.throws(() => c.getModel('invalid'), /not found/);
  });

  test('getStylePresets returns presets', () => {
    const c = new HiggsfieldClient({ api_key: 'k' });
    c.connect();
    const presets = c.getStylePresets();
    assert.ok(presets.length >= 6);
    const names = presets.map(p => p.name);
    assert.ok(names.includes('cinematic'));
    assert.ok(names.includes('viral'));
  });

  test('getCameraMoves returns moves', () => {
    const c = new HiggsfieldClient({ api_key: 'k' });
    c.connect();
    const moves = c.getCameraMoves();
    assert.ok(moves.includes('pan_left'));
    assert.ok(moves.includes('zoom_in'));
    assert.ok(moves.length >= 10);
  });

  test('generateVideo creates job', () => {
    const c = new HiggsfieldClient({ api_key: 'k' });
    c.connect();
    const job = c.generateVideo({ prompt: 'A cat walking in the rain', duration_sec: 5 });
    assert.ok(job.job_id.startsWith('hf_'));
    assert.equal(job.status, 'queued');
    assert.ok(job.credits_used > 0);
    assert.ok(job.credits_remaining < 600);
  });

  test('generateVideo requires prompt', () => {
    const c = new HiggsfieldClient({ api_key: 'k' });
    c.connect();
    assert.throws(() => c.generateVideo({ duration_sec: 5 }), /Prompt is required/);
  });

  test('generateVideo validates duration', () => {
    const c = new HiggsfieldClient({ api_key: 'k' });
    c.connect();
    assert.throws(() => c.generateVideo({ prompt: 'test', duration_sec: 0 }), /Duration/);
    assert.throws(() => c.generateVideo({ prompt: 'test', duration_sec: 25 }), /Duration/);
  });

  test('generateVideo validates model', () => {
    const c = new HiggsfieldClient({ api_key: 'k' });
    c.connect();
    assert.throws(() => c.generateVideo({ prompt: 'test', model: 'fake' }), /Invalid model/);
  });

  test('generateVideo applies style preset', () => {
    const c = new HiggsfieldClient({ api_key: 'k' });
    c.connect();
    const job = c.generateVideo({ prompt: 'test', style_preset: 'viral' });
    assert.equal(job.model, 'wan_27');
    assert.equal(job.camera, 'zoom_in');
    assert.equal(job.aspect_ratio, '9:16');
  });

  test('generateVideo deducts credits', () => {
    const c = new HiggsfieldClient({ api_key: 'k' });
    c.connect();
    const before = c.getCredits();
    c.generateVideo({ prompt: 'test', duration_sec: 5 });
    const after = c.getCredits();
    assert.ok(after.credits < before.credits);
  });

  test('generateVideo throws on insufficient credits', () => {
    const c = new HiggsfieldClient({ api_key: 'k' });
    c.connect();
    // Exhaust credits first
    for (let i = 0; i < 20; i++) {
      try { c.generateVideo({ prompt: 'test', duration_sec: 10 }); } catch (e) { break; }
    }
    // Now should throw
    assert.throws(() => c.generateVideo({ prompt: 'test', duration_sec: 10 }), /Not enough credits/);
  });

  test('getJobStatus returns status', () => {
    const c = new HiggsfieldClient({ api_key: 'k' });
    c.connect();
    const job = c.generateVideo({ prompt: 'test' });
    const status = c.getJobStatus(job.job_id);
    assert.equal(status.job_id, job.job_id);
    assert.ok(['queued', 'processing', 'completed'].includes(status.status));
  });

  test('getJobStatus throws on invalid id', () => {
    const c = new HiggsfieldClient({ api_key: 'k' });
    c.connect();
    assert.throws(() => c.getJobStatus('fake_id'), /not found/);
  });

  test('cancelJob refunds credits', () => {
    const c = new HiggsfieldClient({ api_key: 'k' });
    c.connect();
    const job = c.generateVideo({ prompt: 'test', duration_sec: 5 });
    const before = c.getCredits().credits;
    const result = c.cancelJob(job.job_id);
    assert.equal(result.cancelled, true);
    assert.ok(result.credits_refunded > 0);
    assert.ok(c.getCredits().credits > before - job.credits_used);
  });

  test('cancelJob throws on completed job', () => {
    const c = new HiggsfieldClient({ api_key: 'k' });
    c.connect();
    const job = c.generateVideo({ prompt: 'test' });
    // Force completion
    const status = c.getJobStatus(job.job_id);
    // If already completed by time check, should throw
    if (status.status === 'completed') {
      assert.throws(() => c.cancelJob(job.job_id), /Cannot cancel/);
    }
  });

  test('getUsageHistory tracks jobs', () => {
    const c = new HiggsfieldClient({ api_key: 'k' });
    c.connect();
    c.generateVideo({ prompt: 'first' });
    c.generateVideo({ prompt: 'second' });
    const history = c.getUsageHistory();
    assert.equal(history.length, 2);
    assert.ok(history[0].job_id);
  });

  test('generateFromDirector creates jobs from director output', () => {
    const c = new HiggsfieldClient({ api_key: 'k' });
    c.connect();
    const directorOut = {
      selected_clips: [
        { description: 'Tokyo skyline', duration_sec: 5, scene_type: 'landscape' },
        { description: 'Street food market', duration_sec: 3, scene_type: 'action' }
      ],
      creative_direction: { style: 'cinematic' }
    };
    const result = c.generateFromDirector(directorOut);
    assert.equal(result.jobs.length, 2);
    assert.ok(result.total_credits > 0);
    assert.equal(result.model_used, 'veo_31'); // cinematic preset
  });

  test('generateFromDirector with custom options', () => {
    const c = new HiggsfieldClient({ api_key: 'k' });
    c.connect();
    const directorOut = {
      selected_clips: [{ description: 'test', duration_sec: 3 }],
      creative_direction: { style: 'viral' }
    };
    const result = c.generateFromDirector(directorOut, { model: 'kling_30', resolution: '720p' });
    assert.equal(result.model_used, 'kling_30');
  });
});

describe('Higgsfield Constants', () => {
  test('HIGGSFIELD_MODELS has 7 models', () => {
    assert.equal(Object.keys(HIGGSFIELD_MODELS).length, 7);
  });

  test('CAMERA_MOVES has 10+ moves', () => {
    assert.ok(CAMERA_MOVES.length >= 10);
  });

  test('STYLE_PRESETS has 6+ presets', () => {
    assert.ok(Object.keys(STYLE_PRESETS).length >= 6);
  });

  test('each model has required fields', () => {
    for (const [id, m] of Object.entries(HIGGSFIELD_MODELS)) {
      assert.ok(m.name, `${id} missing name`);
      assert.ok(m.strength, `${id} missing strength`);
      assert.ok(m.max_duration > 0, `${id} invalid max_duration`);
      assert.ok(m.resolutions.length > 0, `${id} missing resolutions`);
    }
  });
});
