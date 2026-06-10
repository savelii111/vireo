/**
 * higgsfield_client.js — Higgsfield AI Video Generation integration
 *
 * Higgsfield is an aggregator: Kling 3.0, Veo 3.1, Sora 2, Seedance 2.0, Wan 2.7
 * API: https://higgsfield.ai — credits-based, $9-65/mo plans
 *
 * Models available:
 *   - kling_30: Photorealism, advanced motion
 *   - seedance_20: Native audio-video (lip-sync, SFX, music)
 *   - wan_27: Balanced speed + quality
 *   - kling_o1: Multi-layered scenes
 *   - sora_2: Physics simulation
 *   - veo_31: 4K cinematic
 *   - kling_26: Character animations
 */

const HIGGSFIELD_MODELS = {
  kling_30: { name: 'Kling 3.0', strength: 'photorealism', max_duration: 10, resolutions: ['720p', '1080p'] },
  seedance_20: { name: 'Seedance 2.0', strength: 'audio_video_sync', max_duration: 15, resolutions: ['720p', '1080p'] },
  wan_27: { name: 'Wan 2.7', strength: 'balanced', max_duration: 10, resolutions: ['720p', '1080p'] },
  kling_o1: { name: 'Kling o1', strength: 'reasoning', max_duration: 10, resolutions: ['720p', '1080p'] },
  sora_2: { name: 'Sora 2', strength: 'physics', max_duration: 20, resolutions: ['720p', '1080p'] },
  veo_31: { name: 'Veo 3.1', strength: 'cinematic_4k', max_duration: 15, resolutions: ['1080p', '4k'] },
  kling_26: { name: 'Kling 2.6', strength: 'character_animation', max_duration: 10, resolutions: ['720p', '1080p'] }
};

const CAMERA_MOVES = ['pan_left', 'pan_right', 'tilt_up', 'tilt_down', 'zoom_in', 'zoom_out', 'dolly_in', 'dolly_out', 'orbit', 'static'];

const STYLE_PRESETS = {
  cinematic: { model: 'veo_31', camera: 'dolly_in', aspect_ratio: '21:9' },
  photorealistic: { model: 'kling_30', camera: 'static', aspect_ratio: '16:9' },
  animated: { model: 'kling_26', camera: 'orbit', aspect_ratio: '16:9' },
  musical: { model: 'seedance_20', camera: 'pan_left', aspect_ratio: '16:9' },
  viral: { model: 'wan_27', camera: 'zoom_in', aspect_ratio: '9:16' },
  documentary: { model: 'sora_2', camera: 'dolly_in', aspect_ratio: '16:9' }
};

export class HiggsfieldClient {
  constructor({ api_key, base_url = 'https://api.higgsfield.ai/v1' } = {}) {
    if (!api_key) throw new Error('Higgsfield API key required');
    this._apiKey = api_key;
    this._baseUrl = base_url;
    this._connected = false;
    this._credits = 0;
    this._usageHistory = [];
  }

  connect() {
    this._connected = true;
    this._credits = 600; // Pro plan default
    return { connected: true, plan: 'pro', credits: this._credits };
  }

  _check() {
    if (!this._connected) throw new Error('Not connected. Call connect() first.');
  }

  getModels() {
    this._check();
    return Object.entries(HIGGSFIELD_MODELS).map(([id, m]) => ({
      id, name: m.name, strength: m.strength,
      max_duration: m.max_duration, resolutions: m.resolutions
    }));
  }

  getModel(modelId) {
    this._check();
    const m = HIGGSFIELD_MODELS[modelId];
    if (!m) throw new Error(`Model '${modelId}' not found`);
    return { id: modelId, ...m };
  }

  getStylePresets() {
    this._check();
    return Object.entries(STYLE_PRESETS).map(([name, preset]) => ({
      name, ...preset
    }));
  }

  getCameraMoves() {
    this._check();
    return [...CAMERA_MOVES];
  }

  generateVideo({ prompt, model = 'kling_30', duration_sec = 5, aspect_ratio = '16:9', resolution = '1080p', camera = 'static', reference_image = null, reference_video = null, first_frame = null, last_frame = null, style_preset = null }) {
    this._check();
    if (!prompt) throw new Error('Prompt is required');
    if (duration_sec < 1 || duration_sec > 20) throw new Error('Duration must be 1-20 seconds');
    if (!HIGGSFIELD_MODELS[model]) throw new Error(`Invalid model: ${model}`);

    // Apply style preset if given
    if (style_preset && STYLE_PRESETS[style_preset]) {
      const preset = STYLE_PRESETS[style_preset];
      model = preset.model;
      camera = preset.camera;
      aspect_ratio = preset.aspect_ratio;
    }

    const creditsNeeded = this._estimateCredits(duration_sec, resolution);
    if (creditsNeeded > this._credits) throw new Error(`Not enough credits. Need ${creditsNeeded}, have ${this._credits}`);

    this._credits -= creditsNeeded;
    const jobId = `hf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const job = {
      job_id: jobId,
      status: 'queued',
      model,
      prompt,
      duration_sec,
      aspect_ratio,
      resolution,
      camera,
      reference_image,
      reference_video,
      first_frame,
      last_frame,
      credits_used: creditsNeeded,
      credits_remaining: this._credits,
      created_at: Date.now(),
      estimated_completion_ms: duration_sec * 2000 + 3000
    };

    this._usageHistory.push(job);
    return job;
  }

  getJobStatus(jobId) {
    this._check();
    const job = this._usageHistory.find(j => j.job_id === jobId);
    if (!job) throw new Error(`Job '${jobId}' not found`);

    // Simulate completion after some time
    const elapsed = Date.now() - job.created_at;
    if (elapsed > job.estimated_completion_ms) {
      job.status = 'completed';
      job.output = {
        video_url: `https://cdn.higgsfield.ai/${jobId}.mp4`,
        thumbnail_url: `https://cdn.higgsfield.ai/${jobId}_thumb.jpg`,
        duration_sec: job.duration_sec,
        resolution: job.resolution,
        aspect_ratio: job.aspect_ratio,
        file_size_mb: Math.round(job.duration_sec * 2.5 * 10) / 10
      };
    } else {
      job.status = 'processing';
      job.progress = Math.min(0.95, elapsed / job.estimated_completion_ms);
    }

    return { job_id: job.job_id, status: job.status, progress: job.progress || 1, output: job.output };
  }

  cancelJob(jobId) {
    this._check();
    const idx = this._usageHistory.findIndex(j => j.job_id === jobId);
    if (idx === -1) throw new Error(`Job '${jobId}' not found`);
    const job = this._usageHistory[idx];
    if (job.status === 'completed') throw new Error('Cannot cancel completed job');
    job.status = 'cancelled';
    this._credits += job.credits_used;
    return { cancelled: true, credits_refunded: job.credits_used, credits_remaining: this._credits };
  }

  getUsageHistory() {
    this._check();
    return this._usageHistory.map(j => ({
      job_id: j.job_id, model: j.model, status: j.status,
      credits_used: j.credits_used, created_at: j.created_at
    }));
  }

  getCredits() {
    this._check();
    return { credits: this._credits, plan: 'pro' };
  }

  generateFromDirector(directorOutput, options = {}) {
    // Bridge between AI Director and Higgsfield
    this._check();
    const style = directorOutput.creative_direction || {};
    const model = options.model || STYLE_PRESETS[style.style || 'cinematic']?.model || 'kling_30';
    const camera = options.camera || STYLE_PRESETS[style.style || 'cinematic']?.camera || 'static';

    const clips = directorOutput.selected_clips || [];
    const jobs = clips.map(clip => this.generateVideo({
      prompt: clip.description || clip.scene_type || 'cinematic scene',
      model,
      duration_sec: Math.min(clip.duration_sec || 5, 10),
      camera,
      aspect_ratio: options.aspect_ratio || '16:9',
      resolution: options.resolution || '1080p'
    }));

    return { jobs, total_credits: jobs.reduce((s, j) => s + j.credits_used, 0), model_used: model };
  }

  _estimateCredits(duration_sec, resolution) {
    let base = duration_sec * 5; // 5 credits per second base
    if (resolution === '4k') base *= 3;
    else if (resolution === '1080p') base *= 1.5;
    return Math.ceil(base);
  }
}

export { HIGGSFIELD_MODELS, CAMERA_MOVES, STYLE_PRESETS };
