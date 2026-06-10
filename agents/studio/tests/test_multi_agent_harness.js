/**
 * test_multi_agent_harness.js — Tests for W13 harness + profiler + scenarios + Higgsfield
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  PipelineHarness, ScenarioLibrary, AgentProfiler, QualityReportGenerator
} from '../src/multi_agent_harness.js';

// ── ScenarioLibrary ──────────────────────────────────────────────────────────
describe('ScenarioLibrary', () => {
  test('lists built-in scenarios', () => {
    const lib = new ScenarioLibrary();
    const names = lib.listScenarios();
    assert.ok(names.includes('travel_vlog'));
    assert.ok(names.includes('product_review'));
    assert.ok(names.includes('tutorial'));
    assert.ok(names.includes('music_video'));
    assert.ok(names.includes('documentary'));
    assert.ok(names.includes('comedy'));
    assert.ok(names.includes('news'));
    assert.ok(names.length >= 7);
  });

  test('getScenario returns brief + footage', () => {
    const lib = new ScenarioLibrary();
    const s = lib.getScenario('travel_vlog');
    assert.ok(s.brief);
    assert.ok(s.footage);
    assert.ok(s.footage.length > 0);
  });

  test('throws on unknown scenario', () => {
    const lib = new ScenarioLibrary();
    assert.throws(() => lib.getScenario('nonexistent'), /not found/);
  });

  test('addCustomScenario works', () => {
    const lib = new ScenarioLibrary();
    lib.addCustomScenario('my_vid', {
      brief: { description: 'Custom', duration_sec: 60, platforms: ['youtube'], style: 'fast' },
      footage: [{ id: 'c1', duration_sec: 10, scene_type: 'action', mood: 'energetic', quality: 0.8, audio_quality: 0.7, faces: 0, motion: 'high' }]
    });
    const s = lib.getScenario('my_vid');
    assert.equal(s.brief.description, 'Custom');
  });

  test('addCustomScenario validates input', () => {
    const lib = new ScenarioLibrary();
    assert.throws(() => lib.addCustomScenario('bad', {}), /brief and footage/);
  });

  test('each scenario has valid footage structure', () => {
    const lib = new ScenarioLibrary();
    for (const name of lib.listScenarios()) {
      const s = lib.getScenario(name);
      for (const f of s.footage) {
        assert.ok(f.id);
        assert.ok(typeof f.duration_sec === 'number');
        assert.ok(f.scene_type);
      }
    }
  });
});

// ── PipelineHarness ──────────────────────────────────────────────────────────
describe('PipelineHarness', () => {
  test('runDemo produces valid result', () => {
    const h = new PipelineHarness();
    const demo = h.runDemo();
    assert.ok(demo.result);
    assert.ok(demo.brief);
    assert.ok(demo.footage_count > 0);
    assert.ok(typeof demo.quality_score === 'number');
    assert.ok(Array.isArray(demo.agent_scores));
  });

  test('runBenchmark produces timing data', () => {
    const h = new PipelineHarness();
    const bench = h.runBenchmark(3);
    assert.ok(bench.avg_time >= 0);
    assert.ok(bench.min_time >= 0);
    assert.ok(bench.max_time >= bench.min_time);
    assert.ok(typeof bench.avg_quality === 'number');
    assert.equal(bench.total_runs, 3);
  });

  test('runScenario works for all built-in scenarios', () => {
    const h = new PipelineHarness();
    const lib = new ScenarioLibrary();
    for (const name of lib.listScenarios()) {
      const r = h.runScenario(name);
      assert.ok(r.result);
      assert.equal(r.scenario, name);
      assert.ok(r.timing.total_ms >= 0);
    }
  });

  test('runAllScenarios returns all results', () => {
    const h = new PipelineHarness();
    const all = h.runAllScenarios();
    assert.ok(all.travel_vlog);
    assert.ok(all.product_review);
    assert.ok(all.tutorial);
    assert.ok(all.music_video);
    assert.ok(all.documentary);
    assert.ok(all.comedy);
    assert.ok(all.news);
  });

  test('stressTest runs multiple iterations', () => {
    const h = new PipelineHarness();
    const stress = h.stressTest(5);
    assert.equal(stress.total_runs, 5);
    assert.ok(stress.total_time_ms >= 0);
    assert.ok(stress.avg_latency >= 0);
    assert.equal(stress.error_rate, 0);
  });
});

// ── AgentProfiler ────────────────────────────────────────────────────────────
describe('AgentProfiler', () => {
  test('profile returns agent stats', () => {
    const p = new AgentProfiler();
    const profile = p.profile('DirectorAgent', 2);
    assert.equal(profile.name, 'DirectorAgent');
    assert.ok(profile.avg_time_ms >= 0);
    assert.equal(typeof profile.avg_confidence, 'number');
    assert.equal(profile.iterations, 2);
  });

  test('compareAgents returns all agents sorted', () => {
    const p = new AgentProfiler();
    const agents = p.compareAgents();
    assert.ok(agents.length >= 7);
    // Should be sorted by reliability_score desc
    for (let i = 1; i < agents.length; i++) {
      assert.ok(agents[i - 1].reliability_score >= agents[i].reliability_score);
    }
  });

  test('getBottleneck identifies slowest agent', () => {
    const p = new AgentProfiler();
    const bn = p.getBottleneck();
    assert.ok(bn.agent);
    assert.ok(bn.time_ms >= 0);
    assert.ok(bn.suggestion);
  });
});

// ── QualityReportGenerator ───────────────────────────────────────────────────
describe('QualityReportGenerator', () => {
  test('generateReport creates full report', () => {
    const gen = new QualityReportGenerator();
    const report = gen.generateReport({
      quality_score: 0.85,
      iterations: 1,
      agent_history: [
        { agent: 'DirectorAgent', confidence: 0.9 },
        { agent: 'EditorAgent', confidence: 0.8 }
      ]
    });
    assert.ok(report.executive_summary);
    assert.ok(Array.isArray(report.agent_breakdown));
    assert.ok(Array.isArray(report.issues));
    assert.ok(Array.isArray(report.suggestions));
    assert.ok(Array.isArray(report.score_history));
  });

  test('exportReport json format', () => {
    const gen = new QualityReportGenerator();
    const report = gen.generateReport({ quality_score: 0.7, iterations: 1, agent_history: [] });
    const json = gen.exportReport(report, 'json');
    const parsed = JSON.parse(json);
    assert.ok(parsed.executive_summary);
  });

  test('exportReport markdown format', () => {
    const gen = new QualityReportGenerator();
    const report = gen.generateReport({ quality_score: 0.7, iterations: 1, agent_history: [] });
    const md = gen.exportReport(report, 'markdown');
    assert.ok(md.includes('# Quality Report'));
    assert.ok(md.includes('Agent Breakdown'));
  });

  test('exportReport html format', () => {
    const gen = new QualityReportGenerator();
    const report = gen.generateReport({ quality_score: 0.7, iterations: 1, agent_history: [] });
    const html = gen.exportReport(report, 'html');
    assert.ok(html.includes('<html>'));
    assert.ok(html.includes('Quality Report'));
  });

  test('low quality generates issues', () => {
    const gen = new QualityReportGenerator();
    const report = gen.generateReport({
      quality_score: 0.3,
      iterations: 3,
      agent_history: [{ agent: 'SoundDesignerAgent', confidence: 0.2 }]
    });
    assert.ok(report.issues.length > 0);
    assert.ok(report.suggestions.length > 0);
  });

  test('throws on unknown format', () => {
    const gen = new QualityReportGenerator();
    const report = gen.generateReport({ quality_score: 0.7, iterations: 1, agent_history: [] });
    assert.throws(() => gen.exportReport(report, 'xml'), /Unknown format/);
  });
});

// ── Integration ──────────────────────────────────────────────────────────────
describe('W13 Harness Integration', () => {
  test('full workflow: scenario → pipeline → report → export', () => {
    const h = new PipelineHarness();
    const gen = new QualityReportGenerator();

    // Run a scenario
    const result = h.runScenario('music_video');
    assert.ok(result.result);

    // Generate report
    const report = gen.generateReport(result.result);
    assert.ok(report.executive_summary);

    // Export in all formats
    const json = gen.exportReport(report, 'json');
    const md = gen.exportReport(report, 'markdown');
    const html = gen.exportReport(report, 'html');
    assert.ok(json.length > 0);
    assert.ok(md.length > 0);
    assert.ok(html.length > 0);
  });

  test('profiler + bottleneck → suggestion', () => {
    const p = new AgentProfiler();
    const bottleneck = p.getBottleneck();
    assert.ok(bottleneck.suggestion);
    // Suggestion should be actionable
    assert.ok(bottleneck.suggestion.includes('optimizing') || bottleneck.suggestion.includes('Consider'));
  });

  test('benchmark consistency check', () => {
    const h = new PipelineHarness();
    const bench = h.runBenchmark(5);
    // Consistency should be > 0 (not perfectly random)
    assert.ok(bench.consistency_score >= 0);
    assert.ok(bench.consistency_score <= 1);
  });
});
