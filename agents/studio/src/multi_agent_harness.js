/**
 * multi_agent_harness.js — Test harness + profiler + scenario library for W13 Multi-Agent Pipeline
 *
 * Provides: demo runs, benchmarks, scenario library, agent profiling, quality reports.
 */

import { AgentOrchestrator } from './multi_agent.js';

// ── Scenario Library ─────────────────────────────────────────────────────────

const BUILT_IN_SCENARIOS = {
  travel_vlog: {
    brief: { description: 'Travel vlog about Tokyo streets', duration_sec: 300, platforms: ['youtube', 'tiktok'], style: 'cinematic', music_mood: 'chill' },
    footage: [
      { id: 'tv1', duration_sec: 30, scene_type: 'landscape', mood: 'calm', quality: 0.9, audio_quality: 0.8, faces: 0, motion: 'low' },
      { id: 'tv2', duration_sec: 20, scene_type: 'action', mood: 'energetic', quality: 0.85, audio_quality: 0.7, faces: 2, motion: 'high' },
      { id: 'tv3', duration_sec: 25, scene_type: 'talking', mood: 'calm', quality: 0.7, audio_quality: 0.9, faces: 1, motion: 'medium' },
      { id: 'tv4', duration_sec: 35, scene_type: 'closeup', mood: 'dramatic', quality: 0.95, audio_quality: 0.85, faces: 0, motion: 'low' }
    ]
  },
  product_review: {
    brief: { description: 'Review of new smartphone', duration_sec: 180, platforms: ['youtube'], style: 'energetic', music_mood: 'upbeat' },
    footage: [
      { id: 'pr1', duration_sec: 15, scene_type: 'closeup', mood: 'calm', quality: 0.95, audio_quality: 0.9, faces: 1, motion: 'low' },
      { id: 'pr2', duration_sec: 20, scene_type: 'action', mood: 'energetic', quality: 0.85, audio_quality: 0.8, faces: 0, motion: 'high' },
      { id: 'pr3', duration_sec: 10, scene_type: 'talking', mood: 'calm', quality: 0.9, audio_quality: 0.85, faces: 1, motion: 'medium' }
    ]
  },
  tutorial: {
    brief: { description: 'Python coding tutorial for beginners', duration_sec: 600, platforms: ['youtube'], style: 'calm', music_mood: 'ambient' },
    footage: [
      { id: 'tu1', duration_sec: 60, scene_type: 'talking', mood: 'calm', quality: 0.8, audio_quality: 0.95, faces: 1, motion: 'low' },
      { id: 'tu2', duration_sec: 45, scene_type: 'landscape', mood: 'calm', quality: 0.7, audio_quality: 0.8, faces: 0, motion: 'low' }
    ]
  },
  music_video: {
    brief: { description: 'Music video with rhythmic editing', duration_sec: 240, platforms: ['youtube', 'tiktok'], style: 'fast', music_mood: 'energetic' },
    footage: [
      { id: 'mv1', duration_sec: 10, scene_type: 'action', mood: 'energetic', quality: 0.9, audio_quality: 0.95, faces: 2, motion: 'high' },
      { id: 'mv2', duration_sec: 8, scene_type: 'closeup', mood: 'dramatic', quality: 0.95, audio_quality: 0.9, faces: 1, motion: 'medium' },
      { id: 'mv3', duration_sec: 12, scene_type: 'landscape', mood: 'calm', quality: 0.85, audio_quality: 0.8, faces: 0, motion: 'low' },
      { id: 'mv4', duration_sec: 6, scene_type: 'action', mood: 'energetic', quality: 0.9, audio_quality: 0.95, faces: 3, motion: 'high' }
    ]
  },
  documentary: {
    brief: { description: 'Nature documentary about ocean life', duration_sec: 900, platforms: ['youtube'], style: 'slow', music_mood: 'ambient' },
    footage: [
      { id: 'dc1', duration_sec: 45, scene_type: 'landscape', mood: 'calm', quality: 0.95, audio_quality: 0.7, faces: 0, motion: 'low' },
      { id: 'dc2', duration_sec: 30, scene_type: 'closeup', mood: 'dramatic', quality: 0.9, audio_quality: 0.6, faces: 0, motion: 'low' },
      { id: 'dc3', duration_sec: 40, scene_type: 'action', mood: 'calm', quality: 0.85, audio_quality: 0.75, faces: 0, motion: 'medium' }
    ]
  },
  comedy: {
    brief: { description: 'Comedy sketch with jump cuts', duration_sec: 120, platforms: ['tiktok', 'instagram'], style: 'fast', music_mood: 'upbeat' },
    footage: [
      { id: 'co1', duration_sec: 5, scene_type: 'talking', mood: 'funny', quality: 0.8, audio_quality: 0.85, faces: 2, motion: 'medium' },
      { id: 'co2', duration_sec: 8, scene_type: 'action', mood: 'funny', quality: 0.85, audio_quality: 0.8, faces: 1, motion: 'high' },
      { id: 'co3', duration_sec: 6, scene_type: 'closeup', mood: 'funny', quality: 0.9, audio_quality: 0.9, faces: 3, motion: 'medium' }
    ]
  },
  news: {
    brief: { description: 'Breaking news report', duration_sec: 60, platforms: ['youtube', 'twitter'], style: 'formal', music_mood: 'dramatic' },
    footage: [
      { id: 'nw1', duration_sec: 15, scene_type: 'talking', mood: 'dramatic', quality: 0.85, audio_quality: 0.9, faces: 1, motion: 'low' },
      { id: 'nw2', duration_sec: 10, scene_type: 'landscape', mood: 'dramatic', quality: 0.8, audio_quality: 0.7, faces: 0, motion: 'medium' }
    ]
  }
};

export class ScenarioLibrary {
  constructor() {
    this._scenarios = { ...BUILT_IN_SCENARIOS };
  }

  getScenario(name) {
    if (!this._scenarios[name]) throw new Error(`Scenario '${name}' not found`);
    return { ...this._scenarios[name] };
  }

  listScenarios() {
    return Object.keys(this._scenarios);
  }

  addCustomScenario(name, scenario) {
    if (!scenario.brief || !scenario.footage) throw new Error('Scenario must have brief and footage');
    this._scenarios[name] = scenario;
  }
}

// ── Pipeline Harness ─────────────────────────────────────────────────────────

export class PipelineHarness {
  constructor(orchestrator) {
    this._orchestrator = orchestrator || new AgentOrchestrator();
    this._scenarios = new ScenarioLibrary();
  }

  runDemo() {
    const scenario = this._scenarios.getScenario('travel_vlog');
    const start = Date.now();
    const result = this._orchestrator.runPipeline(scenario.brief, scenario.footage);
    const elapsed = Date.now() - start;

    return {
      brief: scenario.brief,
      footage_count: scenario.footage.length,
      result,
      timing: { total_ms: elapsed },
      quality_score: result.quality_score,
      agent_scores: result.agent_history.map(a => ({
        agent: a.agent || a.name,
        confidence: a.confidence
      }))
    };
  }

  runBenchmark(iterations = 10) {
    const scenario = this._scenarios.getScenario('travel_vlog');
    const times = [];
    const qualities = [];

    for (let i = 0; i < iterations; i++) {
      const start = Date.now();
      const result = this._orchestrator.runPipeline(scenario.brief, scenario.footage);
      times.push(Date.now() - start);
      qualities.push(result.quality_score);
    }

    const avg_time = times.reduce((a, b) => a + b, 0) / times.length;
    const avg_quality = qualities.reduce((a, b) => a + b, 0) / qualities.length;
    const variance = qualities.reduce((s, q) => s + (q - avg_quality) ** 2, 0) / qualities.length;

    return {
      avg_time: Math.round(avg_time),
      min_time: Math.min(...times),
      max_time: Math.max(...times),
      avg_quality: Math.round(avg_quality * 100) / 100,
      consistency_score: Math.round((1 - Math.sqrt(variance)) * 100) / 100,
      total_runs: iterations
    };
  }

  runScenario(scenarioName) {
    const scenario = this._scenarios.getScenario(scenarioName);
    const start = Date.now();
    const result = this._orchestrator.runPipeline(scenario.brief, scenario.footage);
    const elapsed = Date.now() - start;

    return {
      scenario: scenarioName,
      brief: scenario.brief,
      footage_count: scenario.footage.length,
      result,
      timing: { total_ms: elapsed },
      quality_score: result.quality_score
    };
  }

  runAllScenarios() {
    const results = {};
    for (const name of this._scenarios.listScenarios()) {
      results[name] = this.runScenario(name);
    }
    return results;
  }

  stressTest(concurrentCount = 3) {
    const scenario = this._scenarios.getScenario('travel_vlog');
    const start = Date.now();
    const results = [];

    // Run sequentially (Node.js is single-threaded, but tests memory/perf under load)
    for (let i = 0; i < concurrentCount; i++) {
      const s = Date.now();
      const r = this._orchestrator.runPipeline(scenario.brief, scenario.footage);
      results.push({ run: i, time_ms: Date.now() - s, quality: r.quality_score });
    }

    return {
      total_runs: concurrentCount,
      total_time_ms: Date.now() - start,
      avg_latency: Math.round(results.reduce((a, r) => a + r.time_ms, 0) / results.length),
      error_rate: 0,
      avg_quality: Math.round(results.reduce((a, r) => a + r.quality, 0) / results.length * 100) / 100
    };
  }
}

// ── Agent Profiler ───────────────────────────────────────────────────────────

export class AgentProfiler {
  constructor() {
    this._orchestrator = new AgentOrchestrator();
    this._scenarios = new ScenarioLibrary();
  }

  profile(agentName, iterations = 5) {
    const scenario = this._scenarios.getScenario('travel_vlog');
    const times = [];
    const confidences = [];

    for (let i = 0; i < iterations; i++) {
      const start = Date.now();
      const result = this._orchestrator.runPipeline(scenario.brief, scenario.footage);
      const elapsed = Date.now() - start;
      times.push(elapsed);

      const agentResult = result.agent_history.find(a => (a.agent || a.name) === agentName);
      if (agentResult && typeof agentResult.confidence === 'number') {
        confidences.push(agentResult.confidence);
      }
    }

    const avg_time = times.reduce((a, b) => a + b, 0) / times.length;
    const avg_confidence = confidences.length > 0
      ? confidences.reduce((a, b) => a + b, 0) / confidences.length
      : 0;

    return {
      name: agentName,
      avg_time_ms: Math.round(avg_time),
      avg_confidence: Math.round(avg_confidence * 100) / 100,
      reliability_score: Math.round(avg_confidence * (1 - avg_time / 10000) * 100) / 100,
      iterations
    };
  }

  compareAgents() {
    const agents = ['DirectorAgent', 'EditorAgent', 'ColoristAgent', 'SoundDesignerAgent', 'MotionDesignerAgent', 'QualityAgent', 'OptimizerAgent'];
    return agents.map(a => this.profile(a)).sort((a, b) => b.reliability_score - a.reliability_score);
  }

  getBottleneck() {
    const profiles = this.compareAgents();
    const slowest = profiles[profiles.length - 1];
    return {
      agent: slowest.name,
      time_ms: slowest.avg_time_ms,
      suggestion: `Consider optimizing ${slowest.name} — currently the slowest agent at ${slowest.avg_time_ms}ms avg`
    };
  }
}

// ── Quality Report Generator ─────────────────────────────────────────────────

export class QualityReportGenerator {
  generateReport(pipelineResult) {
    const agentBreakdown = (pipelineResult.agent_history || []).map(a => ({
      agent: a.agent || a.name,
      confidence: a.confidence,
      status: a.confidence > 0.7 ? 'good' : a.confidence > 0.4 ? 'acceptable' : 'poor'
    }));

    const issues = [];
    const suggestions = [];

    if (pipelineResult.quality_score < 0.5) {
      issues.push('Overall quality score is below threshold');
      suggestions.push('Review footage quality and brief clarity');
    }
    if (pipelineResult.iterations > 1) {
      issues.push(`Required ${pipelineResult.iterations} iterations (quality loop triggered)`);
    }

    const lowConfidence = agentBreakdown.filter(a => a.confidence < 0.5);
    if (lowConfidence.length > 0) {
      for (const a of lowConfidence) {
        issues.push(`${a.agent} has low confidence (${a.confidence})`);
        suggestions.push(`Improve input quality for ${a.agent}`);
      }
    }

    return {
      executive_summary: `Pipeline completed with quality score ${pipelineResult.quality_score} in ${pipelineResult.iterations} iteration(s)`,
      agent_breakdown: agentBreakdown,
      issues,
      suggestions,
      score_history: [{ quality_score: pipelineResult.quality_score, timestamp: Date.now() }]
    };
  }

  exportReport(report, format = 'json') {
    if (format === 'json') return JSON.stringify(report, null, 2);
    if (format === 'markdown') {
      let md = `# Quality Report\n\n`;
      md += `**Summary:** ${report.executive_summary}\n\n`;
      md += `## Agent Breakdown\n\n`;
      for (const a of report.agent_breakdown) {
        md += `- **${a.agent}**: ${a.confidence} (${a.status})\n`;
      }
      if (report.issues.length > 0) {
        md += `\n## Issues\n\n`;
        for (const i of report.issues) md += `- ⚠️ ${i}\n`;
      }
      if (report.suggestions.length > 0) {
        md += `\n## Suggestions\n\n`;
        for (const s of report.suggestions) md += `- 💡 ${s}\n`;
      }
      return md;
    }
    if (format === 'html') {
      let html = `<html><head><title>Quality Report</title></head><body>`;
      html += `<h1>Quality Report</h1>`;
      html += `<p>${report.executive_summary}</p>`;
      html += `<h2>Agent Breakdown</h2><ul>`;
      for (const a of report.agent_breakdown) {
        html += `<li><strong>${a.agent}</strong>: ${a.confidence} (${a.status})</li>`;
      }
      html += `</ul>`;
      if (report.issues.length > 0) {
        html += `<h2>Issues</h2><ul>`;
        for (const i of report.issues) html += `<li>⚠️ ${i}</li>`;
        html += `</ul>`;
      }
      html += `</body></html>`;
      return html;
    }
    throw new Error(`Unknown format: ${format}`);
  }
}
