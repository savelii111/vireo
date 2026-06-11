/**
 * test_multi_modal_outputs.js — Tests for Week 16 Multi-Modal Outputs.
 *
 * 11 classes tested:
 *   1. MomentDetector      — transcript-based moment detection
 *   2. SplitScreenLayout   — layout calculation
 *   3. ReactionScript      — persona-based script generation
 *   4. ReactionComposer    — final composition planning
 *   5. ReactionEngine      — full reaction pipeline
 *   6. VoiceParser         — natural language → compilation spec
 *   7. MomentRanker        — multi-video moment ranking
 *   8. CompilationPlanner  — cuts + transitions planning
 *   9. PlatformAdapter     — cross-platform adaptation
 *  10. CompilationBuilder  — recipe generation
 *  11. VoiceCompiler       — full compilation pipeline
 *
 * Plus: constants (REACTION_PERSONAS, REACTION_LAYOUTS, PLATFORM_SPECS, MOMENT_SCORING_CRITERIA)
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  MomentDetector,
  SplitScreenLayout,
  ReactionScript,
  ReactionComposer,
  ReactionEngine,
  VoiceParser,
  MomentRanker,
  CompilationPlanner,
  PlatformAdapter,
  CompilationBuilder,
  VoiceCompiler,
  REACTION_PERSONAS,
  REACTION_LAYOUTS,
  PLATFORM_SPECS,
  MOMENT_SCORING_CRITERIA,
  MULTI_MODAL_OUTPUT_CLASSES,
} from "../src/multi_modal_outputs.js";

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

function makeTranscript(segments = null) {
  if (segments) return segments;
  return [
    { start_sec: 0, end_sec: 3, text: "Welcome to this amazing tutorial about video editing" },
    { start_sec: 3, end_sec: 6, text: "First we need to import the footage into our timeline" },
    { start_sec: 6, end_sec: 9, text: "This is incredible look at the colors here wow" },
    { start_sec: 9, end_sec: 12, text: "Now we apply the transition effect between clips" },
    { start_sec: 12, end_sec: 15, text: "Wait that was unexpected! The result is surprising" },
    { start_sec: 15, end_sec: 18, text: "Let me show you the final result of this edit" },
    { start_sec: 18, end_sec: 21, text: "The pacing here is perfect for a tutorial format" },
    { start_sec: 21, end_sec: 24, text: "Thanks for watching like and subscribe for more" },
  ];
}

function makeVideo(id, overrides = {}) {
  return {
    video_id: id,
    title: overrides.title || `Video ${id}`,
    file_path: overrides.file_path || `/videos/${id}.mp4`,
    duration_sec: overrides.duration_sec || 30,
    transcript: overrides.transcript || makeTranscript(),
    metadata: overrides.metadata || {},
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Constants tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("Constants", () => {
  test("MULTI_MODAL_OUTPUT_CLASSES lists all 11 classes", () => {
    assert.equal(MULTI_MODAL_OUTPUT_CLASSES.length, 11);
    assert.ok(MULTI_MODAL_OUTPUT_CLASSES.includes("ReactionEngine"));
    assert.ok(MULTI_MODAL_OUTPUT_CLASSES.includes("VoiceCompiler"));
    assert.ok(MULTI_MODAL_OUTPUT_CLASSES.includes("MomentDetector"));
    assert.ok(MULTI_MODAL_OUTPUT_CLASSES.includes("SplitScreenLayout"));
    assert.ok(MULTI_MODAL_OUTPUT_CLASSES.includes("ReactionScript"));
    assert.ok(MULTI_MODAL_OUTPUT_CLASSES.includes("ReactionComposer"));
    assert.ok(MULTI_MODAL_OUTPUT_CLASSES.includes("VoiceParser"));
    assert.ok(MULTI_MODAL_OUTPUT_CLASSES.includes("MomentRanker"));
    assert.ok(MULTI_MODAL_OUTPUT_CLASSES.includes("CompilationPlanner"));
    assert.ok(MULTI_MODAL_OUTPUT_CLASSES.includes("PlatformAdapter"));
    assert.ok(MULTI_MODAL_OUTPUT_CLASSES.includes("CompilationBuilder"));
  });

  test("REACTION_PERSONAS has 8 personas", () => {
    assert.equal(Object.keys(REACTION_PERSONAS).length, 8);
    assert.ok(REACTION_PERSONAS.curious_viewer);
    assert.ok(REACTION_PERSONAS.skeptical_expert);
    assert.ok(REACTION_PERSONAS.supportive_friend);
    assert.ok(REACTION_PERSONAS.industry_insider);
    assert.ok(REACTION_PERSONAS.first_time_viewer);
    assert.ok(REACTION_PERSONAS.comedy_roast);
    assert.ok(REACTION_PERSONAS.educational);
    assert.ok(REACTION_PERSONAS.dramatic_narrator);
  });

  test("each persona has required fields", () => {
    for (const [key, p] of Object.entries(REACTION_PERSONAS)) {
      assert.ok(p.label, `${key} missing label`);
      assert.ok(p.tone, `${key} missing tone`);
      assert.ok(p.script_style, `${key} missing script_style`);
      assert.ok(p.emoji, `${key} missing emoji`);
      assert.ok(Array.isArray(p.default_hooks), `${key} missing default_hooks`);
      assert.ok(Array.isArray(p.default_reactions), `${key} missing default_reactions`);
      assert.ok(p.default_hooks.length >= 2, `${key} needs >=2 hooks`);
      assert.ok(p.default_reactions.length >= 2, `${key} needs >=2 reactions`);
    }
  });

  test("REACTION_LAYOUTS has 5 layouts", () => {
    assert.equal(Object.keys(REACTION_LAYOUTS).length, 5);
    assert.ok(REACTION_LAYOUTS.side_by_side);
    assert.ok(REACTION_LAYOUTS.picture_in_picture);
    assert.ok(REACTION_LAYOUTS.top_bottom);
    assert.ok(REACTION_LAYOUTS.reaction_focus);
    assert.ok(REACTION_LAYOUTS.vertical_stack);
  });

  test("each layout has required fields", () => {
    for (const [key, l] of Object.entries(REACTION_LAYOUTS)) {
      assert.ok(l.label, `${key} missing label`);
      assert.ok(typeof l.split_ratio === "number", `${key} missing split_ratio`);
      assert.ok(typeof l.gap_px === "number", `${key} missing gap_px`);
      assert.ok(l.original_position, `${key} missing original_position`);
      assert.ok(l.reaction_position, `${key} missing reaction_position`);
    }
  });

  test("PLATFORM_SPECS has 6 platforms", () => {
    assert.equal(Object.keys(PLATFORM_SPECS).length, 6);
    assert.ok(PLATFORM_SPECS.tiktok);
    assert.ok(PLATFORM_SPECS.youtube);
    assert.ok(PLATFORM_SPECS.youtube_short);
    assert.ok(PLATFORM_SPECS.instagram);
    assert.ok(PLATFORM_SPECS.twitter);
    assert.ok(PLATFORM_SPECS.custom);
  });

  test("each platform has required fields", () => {
    for (const [key, p] of Object.entries(PLATFORM_SPECS)) {
      assert.ok(p.label, `${key} missing label`);
      assert.ok(typeof p.width === "number", `${key} missing width`);
      assert.ok(typeof p.height === "number", `${key} missing height`);
      assert.ok(p.aspect_ratio, `${key} missing aspect_ratio`);
      assert.ok(typeof p.max_duration_sec === "number", `${key} missing max_duration_sec`);
      assert.ok(typeof p.max_clips === "number", `${key} missing max_clips`);
      assert.ok(Array.isArray(p.transitions), `${key} missing transitions`);
    }
  });

  test("MOMENT_SCORING_CRITERIA has 5 criteria", () => {
    assert.equal(Object.keys(MOMENT_SCORING_CRITERIA).length, 5);
    for (const [key, c] of Object.entries(MOMENT_SCORING_CRITERIA)) {
      assert.ok(typeof c.weight === "number", `${key} missing weight`);
      assert.ok(Array.isArray(c.factors), `${key} missing factors`);
      assert.ok(c.factors.length >= 2, `${key} needs >=2 factors`);
    }
  });

  test("scoring criteria weights sum to 1.0", () => {
    const total = Object.values(MOMENT_SCORING_CRITERIA).reduce((sum, c) => sum + c.weight, 0);
    assert.ok(Math.abs(total - 1.0) < 0.01, `Weights sum to ${total}, expected ~1.0`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. MomentDetector
// ═══════════════════════════════════════════════════════════════════════════════

describe("MomentDetector", () => {
  test("detects moments from transcript", () => {
    const det = new MomentDetector();
    const result = det.detect({ transcript: makeTranscript(), duration_sec: 24 });
    assert.ok(result.ok);
    assert.ok(result.total >= 1, `Expected >=1 moments, got ${result.total}`);
    assert.ok(result.moments.length >= 1);
  });

  test("returns empty for empty transcript", () => {
    const det = new MomentDetector();
    const result = det.detect({ transcript: [], duration_sec: 60 });
    assert.ok(result.ok);
    assert.equal(result.total, 0);
  });

  test("returns ok for missing transcript", () => {
    const det = new MomentDetector();
    const result = det.detect({ transcript: null, duration_sec: 60 });
    assert.ok(result.ok);
    assert.equal(result.total, 0);
  });

  test("rejects invalid duration", () => {
    const det = new MomentDetector();
    const result = det.detect({ transcript: makeTranscript(), duration_sec: -5 });
    assert.equal(result.ok, false);
    assert.equal(result.error, "invalid_duration");
  });

  test("moments are sorted by score descending", () => {
    const det = new MomentDetector();
    const result = det.detect({ transcript: makeTranscript(), duration_sec: 24 });
    if (result.moments.length >= 2) {
      for (let i = 1; i < result.moments.length; i++) {
        assert.ok(result.moments[i].score <= result.moments[i - 1].score);
      }
    }
  });

  test("each moment has required fields", () => {
    const det = new MomentDetector();
    const result = det.detect({ transcript: makeTranscript(), duration_sec: 24 });
    for (const m of result.moments) {
      assert.ok(typeof m.start_sec === "number");
      assert.ok(typeof m.end_sec === "number");
      assert.ok(typeof m.score === "number");
      assert.ok(m.category);
      assert.ok(m.scores);
      assert.ok(m.reaction_potential);
    }
  });

  test("respects min_moment_gap_sec", () => {
    const det = new MomentDetector({ min_moment_gap_sec: 20 }); // very large gap
    const result = det.detect({ transcript: makeTranscript(), duration_sec: 24 });
    // With 20s gap, should get at most 1-2 moments
    assert.ok(result.moments.length <= 3);
  });

  test("custom scoring criteria works", () => {
    const det = new MomentDetector({
      scoring_criteria: {
        humor: { weight: 1.0, factors: ["punchline_delivery", "absurdity"] },
      },
    });
    const result = det.detect({ transcript: makeTranscript(), duration_sec: 24 });
    assert.ok(result.ok);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. SplitScreenLayout
// ═══════════════════════════════════════════════════════════════════════════════

describe("SplitScreenLayout", () => {
  test("side_by_side layout calculates correctly", () => {
    const layout = new SplitScreenLayout({ layout: "side_by_side", canvas_width: 1920, canvas_height: 1080 });
    const result = layout.calculate();
    assert.ok(result.ok);
    assert.equal(result.layout, "side_by_side");
    assert.equal(result.canvas.width, 1920);
    assert.equal(result.original.width + result.reaction.width + result.gap_px, 1920);
    assert.equal(result.original.height, 1080);
    assert.equal(result.reaction.height, 1080);
  });

  test("picture_in_picture layout calculates correctly", () => {
    const layout = new SplitScreenLayout({ layout: "picture_in_picture", canvas_width: 1920, canvas_height: 1080 });
    const result = layout.calculate();
    assert.ok(result.ok);
    assert.equal(result.original.width, 1920);
    assert.equal(result.original.height, 1080);
    assert.ok(result.reaction.width < 1920);
    assert.ok(result.reaction.height < 1080);
  });

  test("top_bottom layout calculates correctly", () => {
    const layout = new SplitScreenLayout({ layout: "top_bottom", canvas_width: 1080, canvas_height: 1920 });
    const result = layout.calculate();
    assert.ok(result.ok);
    assert.equal(result.original.width, 1080);
    assert.equal(result.reaction.width, 1080);
    assert.ok(result.original.height + result.reaction.height + result.gap_px === 1920);
  });

  test("reaction_focus layout calculates correctly", () => {
    const layout = new SplitScreenLayout({ layout: "reaction_focus", canvas_width: 1920, canvas_height: 1080 });
    const result = layout.calculate();
    assert.ok(result.ok);
    assert.equal(result.reaction.width, 1920);
    assert.equal(result.reaction.height, 1080);
    assert.ok(result.original.width < 1920);
  });

  test("vertical_stack layout calculates correctly", () => {
    const layout = new SplitScreenLayout({ layout: "vertical_stack", canvas_width: 1080, canvas_height: 1920 });
    const result = layout.calculate();
    assert.ok(result.ok);
    assert.equal(result.original.width, 1080);
    assert.equal(result.reaction.width, 1080);
  });

  test("unknown layout defaults to side_by_side", () => {
    const layout = new SplitScreenLayout({ layout: "unknown_layout" });
    const result = layout.calculate();
    assert.ok(result.ok);
    assert.equal(result.layout, "side_by_side");
  });

  test("validate returns ok for valid layout", () => {
    const layout = new SplitScreenLayout({ layout: "side_by_side" });
    const result = layout.validate();
    assert.ok(result.ok);
    assert.equal(result.issues.length, 0);
  });

  test("validate detects issues with extreme small canvas", () => {
    const layout = new SplitScreenLayout({ layout: "side_by_side", canvas_width: 50, canvas_height: 50 });
    const result = layout.validate();
    assert.ok(result.issues.length > 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. ReactionScript
// ═══════════════════════════════════════════════════════════════════════════════

describe("ReactionScript", () => {
  test("generates script for curious_viewer", () => {
    const script = new ReactionScript({ persona: "curious_viewer", length: "short" });
    const result = script.generate({
      moments: [{ start_sec: 5, end_sec: 10, score: 0.8, category: "engagement" }],
    });
    assert.ok(result.ok);
    assert.equal(result.persona, "curious_viewer");
    assert.ok(result.segments.length >= 2);
    assert.ok(result.full_text.length > 10);
  });

  test("generates script for each persona", () => {
    for (const persona of Object.keys(REACTION_PERSONAS)) {
      const script = new ReactionScript({ persona });
      const result = script.generate({
        moments: [{ start_sec: 3, end_sec: 7, score: 0.6, category: "humor" }],
      });
      assert.ok(result.ok, `Failed for persona: ${persona}`);
      assert.equal(result.persona, persona);
    }
  });

  test("long length generates more segments", () => {
    const moments = Array.from({ length: 8 }, (_, i) => ({
      start_sec: i * 5,
      end_sec: i * 5 + 4,
      score: 0.7,
      category: "general",
    }));

    const shortScript = new ReactionScript({ length: "short" });
    const longScript = new ReactionScript({ length: "long" });

    const shortResult = shortScript.generate({ moments });
    const longResult = longScript.generate({ moments });

    assert.ok(longResult.segments.length >= shortResult.segments.length);
  });

  test("fails with no moments", () => {
    const script = new ReactionScript();
    const result = script.generate({ moments: [] });
    assert.equal(result.ok, false);
    assert.equal(result.error, "moments_required");
  });

  test("each segment has required fields", () => {
    const script = new ReactionScript({ persona: "comedy_roast" });
    const result = script.generate({
      moments: [
        { start_sec: 2, end_sec: 5, score: 0.9, category: "humor" },
        { start_sec: 10, end_sec: 14, score: 0.7, category: "engagement" },
      ],
    });
    assert.ok(result.ok);
    for (const seg of result.segments) {
      assert.ok(seg.type);
      assert.ok(typeof seg.timestamp_sec === "number");
      assert.ok(seg.text);
      assert.ok(seg.emotion);
    }
  });

  test("listPersonas returns all 8", () => {
    const personas = ReactionScript.listPersonas();
    assert.equal(personas.length, 8);
    for (const p of personas) {
      assert.ok(p.key);
      assert.ok(p.label);
      assert.ok(p.tone);
      assert.ok(p.emoji);
    }
  });

  test("first segment is always a hook", () => {
    const script = new ReactionScript();
    const result = script.generate({
      moments: [{ start_sec: 5, end_sec: 8, score: 0.6, category: "general" }],
    });
    assert.equal(result.segments[0].type, "hook");
  });

  test("last segment is always a closing", () => {
    const script = new ReactionScript();
    const result = script.generate({
      moments: [{ start_sec: 5, end_sec: 8, score: 0.6, category: "general" }],
    });
    assert.equal(result.segments[result.segments.length - 1].type, "closing");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. ReactionComposer
// ═══════════════════════════════════════════════════════════════════════════════

describe("ReactionComposer", () => {
  test("composes recipe with required inputs", () => {
    const composer = new ReactionComposer({ layout: "side_by_side", platform: "youtube" });
    const result = composer.compose({
      original_video_path: "/videos/original.mp4",
      reaction_video_path: "/videos/reaction.mp4",
      moments: [{ start_sec: 5, end_sec: 10, score: 0.8, category: "engagement" }],
      script: { segments: [{ type: "reaction", timestamp_sec: 5, text: "Wow!" }] },
    });
    assert.ok(result.ok);
    assert.ok(result.recipe.length >= 3);
    assert.equal(result.platform, "youtube");
  });

  test("fails without original_video_path", () => {
    const composer = new ReactionComposer();
    const result = composer.compose({ reaction_video_path: "/r.mp4" });
    assert.equal(result.ok, false);
    assert.equal(result.error, "original_video_path_required");
  });

  test("fails without reaction_video_path", () => {
    const composer = new ReactionComposer();
    const result = composer.compose({ original_video_path: "/o.mp4" });
    assert.equal(result.ok, false);
    assert.equal(result.error, "reaction_video_path_required");
  });

  test("recipe includes layout step", () => {
    const composer = new ReactionComposer({ layout: "picture_in_picture" });
    const result = composer.compose({
      original_video_path: "/o.mp4",
      reaction_video_path: "/r.mp4",
    });
    assert.ok(result.ok);
    const layoutStep = result.recipe.find((r) => r.tool === "compose_multi_clip");
    assert.ok(layoutStep);
  });

  test("recipe includes platform reframe for non-custom", () => {
    const composer = new ReactionComposer({ platform: "tiktok" });
    const result = composer.compose({
      original_video_path: "/o.mp4",
      reaction_video_path: "/r.mp4",
    });
    assert.ok(result.ok);
    const reframeStep = result.recipe.find((r) => r.tool === "reframe_for_platform");
    assert.ok(reframeStep);
    assert.equal(reframeStep.args.platform, "tiktok");
  });

  test("recipe includes captions step", () => {
    const composer = new ReactionComposer();
    const result = composer.compose({
      original_video_path: "/o.mp4",
      reaction_video_path: "/r.mp4",
    });
    assert.ok(result.ok);
    const captionStep = result.recipe.find((r) => r.tool === "add_captions");
    assert.ok(captionStep);
  });

  test("layout labels added for side_by_side", () => {
    const composer = new ReactionComposer({ layout: "side_by_side" });
    const result = composer.compose({
      original_video_path: "/o.mp4",
      reaction_video_path: "/r.mp4",
    });
    assert.ok(result.ok);
    const labelSteps = result.recipe.filter((r) => r.tool === "add_text_overlay" && r.args.style === "label");
    assert.ok(labelSteps.length >= 2);
  });

  test("estimated_output matches platform spec", () => {
    const composer = new ReactionComposer({ platform: "youtube" });
    const result = composer.compose({
      original_video_path: "/o.mp4",
      reaction_video_path: "/r.mp4",
    });
    assert.ok(result.ok);
    assert.equal(result.estimated_output.width, 1920);
    assert.equal(result.estimated_output.height, 1080);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. ReactionEngine
// ═══════════════════════════════════════════════════════════════════════════════

describe("ReactionEngine", () => {
  test("full pipeline produces ok result", async () => {
    const engine = new ReactionEngine({ persona: "curious_viewer", platform: "youtube" });
    const result = await engine.process({
      original_video_path: "/videos/original.mp4",
      reaction_video_path: "/videos/reaction.mp4",
      transcript: makeTranscript(),
      duration_sec: 24,
    });
    assert.ok(result.ok);
    assert.ok(result.session_id);
    assert.equal(result.persona, "curious_viewer");
    assert.ok(result.moments);
    assert.ok(result.script);
    assert.ok(result.composition);
    assert.ok(result.timing.total_ms >= 0);
  });

  test("engine with comedy_roast persona", async () => {
    const engine = new ReactionEngine({ persona: "comedy_roast", layout: "reaction_focus" });
    const result = await engine.process({
      original_video_path: "/o.mp4",
      reaction_video_path: "/r.mp4",
      transcript: makeTranscript(),
      duration_sec: 24,
    });
    assert.ok(result.ok);
    assert.equal(result.persona, "comedy_roast");
    assert.equal(result.layout, "reaction_focus");
  });

  test("engine works with empty transcript", async () => {
    const engine = new ReactionEngine();
    const result = await engine.process({
      original_video_path: "/o.mp4",
      reaction_video_path: "/r.mp4",
      transcript: [],
      duration_sec: 60,
    });
    assert.ok(result.ok);
    assert.equal(result.total_moments, 0);
  });

  test("engine generates timing info", async () => {
    const engine = new ReactionEngine();
    const result = await engine.process({
      original_video_path: "/o.mp4",
      reaction_video_path: "/r.mp4",
      transcript: makeTranscript(),
      duration_sec: 24,
    });
    assert.ok(result.ok);
    assert.ok(typeof result.timing.total_ms === "number");
    assert.ok(Array.isArray(result.timing.stages));
    assert.deepEqual(result.timing.stages, ["detect", "script", "compose"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. VoiceParser
// ═══════════════════════════════════════════════════════════════════════════════

describe("VoiceParser", () => {
  test("parses simple prompt", () => {
    const parser = new VoiceParser();
    const result = parser.parse("make me a 30 second compilation");
    assert.ok(result.ok);
    assert.equal(result.max_duration_sec, 30);
  });

  test("parses duration in minutes", () => {
    const parser = new VoiceParser();
    const result = parser.parse("make a 2 minute highlight reel");
    assert.ok(result.ok);
    assert.equal(result.max_duration_sec, 120);
  });

  test("detects mood: funny", () => {
    const parser = new VoiceParser();
    const result = parser.parse("make a funny compilation of the best moments");
    assert.ok(result.ok);
    assert.equal(result.mood, "funny");
  });

  test("detects mood: epic", () => {
    const parser = new VoiceParser();
    const result = parser.parse("the most epic moments from this video");
    assert.ok(result.ok);
    assert.equal(result.mood, "epic");
  });

  test("detects mood: educational", () => {
    const parser = new VoiceParser();
    const result = parser.parse("an educational tutorial compilation");
    assert.ok(result.ok);
    assert.equal(result.mood, "educational");
  });

  test("detects platform: tiktok", () => {
    const parser = new VoiceParser();
    const result = parser.parse("make a tiktok compilation");
    assert.ok(result.ok);
    assert.equal(result.platform, "tiktok");
  });

  test("detects platform: youtube", () => {
    const parser = new VoiceParser();
    const result = parser.parse("youtube video from my best moments");
    assert.ok(result.ok);
    assert.equal(result.platform, "youtube");
  });

  test("detects platform: instagram", () => {
    const parser = new VoiceParser();
    const result = parser.parse("instagram reel compilation");
    assert.ok(result.ok);
    assert.equal(result.platform, "instagram");
  });

  test("extracts clip count", () => {
    const parser = new VoiceParser();
    const result = parser.parse("top 5 funniest moments");
    assert.ok(result.ok);
    assert.equal(result.max_clips, 5);
  });

  test("extracts source count", () => {
    const parser = new VoiceParser();
    const result = parser.parse("from my last 10 videos");
    assert.ok(result.ok);
    assert.equal(result.source_count, 10);
  });

  test("detects compilation type: teaser", () => {
    const parser = new VoiceParser();
    const result = parser.parse("make me a teaser from this footage");
    assert.ok(result.ok);
    assert.equal(result.compilation_type, "teaser");
  });

  test("detects compilation type: bloopers", () => {
    const parser = new VoiceParser();
    const result = parser.parse("blooper reel compilation");
    assert.ok(result.ok);
    assert.equal(result.compilation_type, "bloopers");
  });

  test("detects compilation type: montage", () => {
    const parser = new VoiceParser();
    const result = parser.parse("make a montage of the best clips");
    assert.ok(result.ok);
    assert.equal(result.compilation_type, "montage");
  });

  test("fails with empty prompt", () => {
    const parser = new VoiceParser();
    assert.equal(parser.parse("").ok, false);
    assert.equal(parser.parse(null).ok, false);
    assert.equal(parser.parse(undefined).ok, false);
  });

  test("clamps duration to valid range", () => {
    const parser = new VoiceParser();
    const tooShort = parser.parse("1 second compilation");
    assert.ok(tooShort.ok);
    assert.ok(tooShort.max_duration_sec >= 5);

    const tooLong = parser.parse("100 minute compilation");
    assert.ok(tooLong.ok);
    assert.ok(tooLong.max_duration_sec <= 600);
  });

  test("clamps clip count to valid range", () => {
    const parser = new VoiceParser();
    const result = parser.parse("top 100 moments");
    assert.ok(result.ok);
    assert.ok(result.max_clips <= 20);
  });

  test("complex prompt with multiple hints", () => {
    const parser = new VoiceParser();
    const result = parser.parse(
      "make a 45 second funny tiktok compilation from my last 8 videos, top 6 moments"
    );
    assert.ok(result.ok);
    assert.equal(result.max_duration_sec, 45);
    assert.equal(result.mood, "funny");
    assert.equal(result.platform, "tiktok");
    assert.equal(result.source_count, 8);
    assert.equal(result.max_clips, 6);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. MomentRanker
// ═══════════════════════════════════════════════════════════════════════════════

describe("MomentRanker", () => {
  test("ranks moments from multiple videos", () => {
    const ranker = new MomentRanker();
    const result = ranker.rank({
      videos: [makeVideo("v1"), makeVideo("v2"), makeVideo("v3")],
      max_moments: 10,
    });
    assert.ok(result.ok);
    assert.ok(result.total_candidates >= 1);
    assert.ok(result.selected >= 1);
    assert.equal(result.videos_analyzed, 3);
  });

  test("respects max_moments", () => {
    const ranker = new MomentRanker();
    const result = ranker.rank({
      videos: [makeVideo("v1"), makeVideo("v2")],
      max_moments: 2,
    });
    assert.ok(result.ok);
    assert.ok(result.selected <= 2);
  });

  test("fails with no videos", () => {
    const ranker = new MomentRanker();
    const result = ranker.rank({ videos: [] });
    assert.equal(result.ok, false);
    assert.equal(result.error, "videos_required");
  });

  test("handles videos with empty transcripts", () => {
    const ranker = new MomentRanker();
    const result = ranker.rank({
      videos: [{ video_id: "v1", transcript: [], duration_sec: 30 }],
      max_moments: 5,
    });
    assert.ok(result.ok);
    assert.equal(result.total_candidates, 0);
  });

  test("mood boost works for funny mood", () => {
    const ranker = new MomentRanker();
    const result = ranker.rank({
      videos: [makeVideo("v1")],
      mood: "funny",
      max_moments: 5,
    });
    assert.ok(result.ok);
    assert.equal(result.mood, "funny");
  });

  test("compilation_type affects ranking", () => {
    const ranker = new MomentRanker();
    const result = ranker.rank({
      videos: [makeVideo("v1")],
      compilation_type: "bloopers",
      max_moments: 5,
    });
    assert.ok(result.ok);
    assert.equal(result.compilation_type, "bloopers");
  });

  test("each ranked moment has video provenance", () => {
    const ranker = new MomentRanker();
    const result = ranker.rank({
      videos: [makeVideo("v1"), makeVideo("v2")],
      max_moments: 5,
    });
    assert.ok(result.ok);
    for (const m of result.moments) {
      assert.ok(m.video_id);
      assert.ok(m.video_title);
      assert.ok(typeof m.video_duration_sec === "number");
    }
  });

  test("no duplicate moments from same video within 5s window", () => {
    const ranker = new MomentRanker();
    const result = ranker.rank({
      videos: [makeVideo("v1")],
      max_moments: 20,
    });
    assert.ok(result.ok);
    // Check that for each video_id, no two moments are within 5s
    const byVideo = {};
    for (const m of result.moments) {
      if (!byVideo[m.video_id]) byVideo[m.video_id] = [];
      byVideo[m.video_id].push(m);
    }
    for (const moments of Object.values(byVideo)) {
      for (let i = 1; i < moments.length; i++) {
        assert.ok(
          Math.abs(moments[i].start_sec - moments[i - 1].start_sec) >= 4.5,
          `Moments too close: ${moments[i].start_sec} vs ${moments[i - 1].start_sec}`
        );
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. CompilationPlanner
// ═══════════════════════════════════════════════════════════════════════════════

describe("CompilationPlanner", () => {
  const sampleMoments = [
    { start_sec: 5, end_sec: 10, score: 0.9, category: "humor", video_id: "v1", text_excerpt: "funny part" },
    { start_sec: 20, end_sec: 25, score: 0.8, category: "engagement", video_id: "v1", text_excerpt: "exciting" },
    { start_sec: 35, end_sec: 40, score: 0.7, category: "emotional", video_id: "v2", text_excerpt: "touching" },
  ];

  test("plans compilation from moments", () => {
    const planner = new CompilationPlanner({ platform: "tiktok" });
    const result = planner.plan({ moments: sampleMoments, max_duration_sec: 30 });
    assert.ok(result.ok);
    assert.equal(result.total_clips, 3);
    assert.ok(result.total_duration_sec > 0);
    assert.equal(result.platform, "tiktok");
  });

  test("fails with no moments", () => {
    const planner = new CompilationPlanner();
    const result = planner.plan({ moments: [] });
    assert.equal(result.ok, false);
    assert.equal(result.error, "moments_required");
  });

  test("respects max_clips from platform spec", () => {
    const planner = new CompilationPlanner({ platform: "tiktok" }); // max 8 clips
    const manyMoments = Array.from({ length: 15 }, (_, i) => ({
      start_sec: i * 5,
      end_sec: i * 5 + 4,
      score: 0.7,
      category: "general",
      video_id: "v1",
      text_excerpt: `moment ${i}`,
    }));
    const result = planner.plan({ moments: manyMoments, max_duration_sec: 60 });
    assert.ok(result.ok);
    assert.ok(result.total_clips <= 8);
  });

  test("clamps duration to platform max", () => {
    const planner = new CompilationPlanner({ platform: "youtube_short" }); // max 60s
    const result = planner.plan({ moments: sampleMoments, max_duration_sec: 300 });
    assert.ok(result.ok);
    assert.ok(result.total_duration_sec <= 60);
  });

  test("each timeline entry has required fields", () => {
    const planner = new CompilationPlanner({ platform: "youtube" });
    const result = planner.plan({ moments: sampleMoments, max_duration_sec: 30 });
    assert.ok(result.ok);
    for (const clip of result.timeline) {
      assert.ok(typeof clip.index === "number");
      assert.ok(clip.video_id);
      assert.ok(typeof clip.moment_start_sec === "number");
      assert.ok(typeof clip.clip_start_sec === "number");
      assert.ok(typeof clip.clip_duration_sec === "number");
      assert.ok(typeof clip.score === "number");
    }
  });

  test("mood affects primary transition", () => {
    const planner = new CompilationPlanner({ platform: "youtube" });
    const epicResult = planner.plan({ moments: sampleMoments, max_duration_sec: 30, mood: "epic" });
    const chillResult = planner.plan({ moments: sampleMoments, max_duration_sec: 30, mood: "chill" });
    assert.ok(epicResult.ok);
    assert.ok(chillResult.ok);
    // Epic should use whip, chill should use fade
    assert.equal(epicResult.primary_transition, "whip");
    assert.equal(chillResult.primary_transition, "fade");
  });

  test("last clip has no transition", () => {
    const planner = new CompilationPlanner();
    const result = planner.plan({ moments: sampleMoments, max_duration_sec: 30 });
    assert.ok(result.ok);
    const lastClip = result.timeline[result.timeline.length - 1];
    assert.equal(lastClip.transition, null);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. PlatformAdapter
// ═══════════════════════════════════════════════════════════════════════════════

describe("PlatformAdapter", () => {
  const samplePlan = {
    ok: true,
    platform: "youtube",
    total_clips: 3,
    total_duration_sec: 90,
    primary_transition: "cut",
    timeline: [
      { index: 0, clip_start_sec: 0, clip_duration_sec: 30, clip_end_sec: 30, transition: "cut" },
      { index: 1, clip_start_sec: 30, clip_duration_sec: 30, clip_end_sec: 60, transition: "cut" },
      { index: 2, clip_start_sec: 60, clip_duration_sec: 30, clip_end_sec: 90, transition: null },
    ],
  };

  test("adapts plan to tiktok", () => {
    const adapter = new PlatformAdapter();
    const result = adapter.adapt({ plan: samplePlan, target_platform: "tiktok" });
    assert.ok(result.ok);
    assert.equal(result.target_platform, "tiktok");
    assert.ok(result.adapted.total_duration_sec <= 180);
  });

  test("adapts plan to youtube_short (60s max)", () => {
    const adapter = new PlatformAdapter();
    const result = adapter.adapt({ plan: samplePlan, target_platform: "youtube_short" });
    assert.ok(result.ok);
    assert.ok(result.adapted.total_duration_sec <= 60);
  });

  test("fails with invalid plan", () => {
    const adapter = new PlatformAdapter();
    const result = adapter.adapt({ plan: null, target_platform: "tiktok" });
    assert.equal(result.ok, false);
  });

  test("fails with unknown platform", () => {
    const adapter = new PlatformAdapter();
    const result = adapter.adapt({ plan: samplePlan, target_platform: "unknown" });
    assert.equal(result.ok, false);
    assert.equal(result.error, "unknown_platform");
  });

  test("fails without target_platform", () => {
    const adapter = new PlatformAdapter();
    const result = adapter.adapt({ plan: samplePlan });
    assert.equal(result.ok, false);
    assert.equal(result.error, "target_platform_required");
  });

  test("adds platform_recipe steps", () => {
    const adapter = new PlatformAdapter();
    const result = adapter.adapt({ plan: samplePlan, target_platform: "instagram" });
    assert.ok(result.ok);
    assert.ok(result.adapted.platform_recipe.length >= 2);
    const reframe = result.adapted.platform_recipe.find((r) => r.tool === "reframe_for_platform");
    assert.ok(reframe);
    assert.equal(reframe.args.platform, "instagram");
  });

  test("clips trimmed when over platform max_clips", () => {
    const longPlan = {
      ok: true,
      platform: "youtube",
      total_clips: 10,
      total_duration_sec: 300,
      timeline: Array.from({ length: 10 }, (_, i) => ({
        index: i,
        clip_start_sec: i * 30,
        clip_duration_sec: 30,
        clip_end_sec: (i + 1) * 30,
        transition: i < 9 ? "cut" : null,
      })),
    };
    const adapter = new PlatformAdapter();
    const result = adapter.adapt({ plan: longPlan, target_platform: "twitter" }); // max 5 clips
    assert.ok(result.ok);
    assert.ok(result.adapted.timeline.length <= 5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. CompilationBuilder
// ═══════════════════════════════════════════════════════════════════════════════

describe("CompilationBuilder", () => {
  const samplePlan = {
    ok: true,
    platform: "tiktok",
    total_clips: 3,
    total_duration_sec: 30,
    primary_transition: "cut",
    timeline: [
      { index: 0, video_id: "v1", moment_start_sec: 5, moment_end_sec: 12, clip_start_sec: 0, clip_duration_sec: 10, score: 0.9, category: "humor", transition: "cut", transition_duration_sec: 0.3 },
      { index: 1, video_id: "v1", moment_start_sec: 20, moment_end_sec: 27, clip_start_sec: 10.3, clip_duration_sec: 10, score: 0.8, category: "engagement", transition: "cut", transition_duration_sec: 0.3 },
      { index: 2, video_id: "v2", moment_start_sec: 8, moment_end_sec: 15, clip_start_sec: 20.6, clip_duration_sec: 9.4, score: 0.7, category: "emotional", transition: null, transition_duration_sec: 0 },
    ],
  };

  const sourceVideos = [
    { video_id: "v1", file_path: "/videos/v1.mp4" },
    { video_id: "v2", file_path: "/videos/v2.mp4" },
  ];

  test("builds recipe from plan", () => {
    const builder = new CompilationBuilder({ platform: "tiktok" });
    const result = builder.build({ plan: samplePlan, source_videos: sourceVideos });
    assert.ok(result.ok);
    assert.ok(result.recipe.length >= 5);
    assert.equal(result.platform, "tiktok");
  });

  test("fails with invalid plan", () => {
    const builder = new CompilationBuilder();
    const result = builder.build({ plan: null });
    assert.equal(result.ok, false);
  });

  test("recipe includes cut_clips for each moment", () => {
    const builder = new CompilationBuilder();
    const result = builder.build({ plan: samplePlan, source_videos: sourceVideos });
    assert.ok(result.ok);
    const cuts = result.recipe.filter((r) => r.tool === "cut_clips");
    assert.equal(cuts.length, 3);
  });

  test("recipe includes compose_multi_clip", () => {
    const builder = new CompilationBuilder();
    const result = builder.build({ plan: samplePlan, source_videos: sourceVideos });
    assert.ok(result.ok);
    const compose = result.recipe.find((r) => r.tool === "compose_multi_clip");
    assert.ok(compose);
  });

  test("recipe includes reframe_for_platform", () => {
    const builder = new CompilationBuilder({ platform: "youtube" });
    const result = builder.build({ plan: { ...samplePlan, platform: "youtube" }, source_videos: sourceVideos });
    assert.ok(result.ok);
    const reframe = result.recipe.find((r) => r.tool === "reframe_for_platform");
    assert.ok(reframe);
    assert.equal(reframe.args.platform, "youtube");
  });

  test("recipe includes add_captions", () => {
    const builder = new CompilationBuilder();
    const result = builder.build({ plan: samplePlan, source_videos: sourceVideos });
    assert.ok(result.ok);
    const captions = result.recipe.find((r) => r.tool === "add_captions");
    assert.ok(captions);
  });

  test("recipe includes apply_color_grade", () => {
    const builder = new CompilationBuilder();
    const result = builder.build({ plan: samplePlan, source_videos: sourceVideos });
    assert.ok(result.ok);
    const grade = result.recipe.find((r) => r.tool === "apply_color_grade");
    assert.ok(grade);
  });

  test("cut metadata includes score and category", () => {
    const builder = new CompilationBuilder();
    const result = builder.build({ plan: samplePlan, source_videos: sourceVideos });
    assert.ok(result.ok);
    const cuts = result.recipe.filter((r) => r.tool === "cut_clips");
    for (const cut of cuts) {
      assert.ok(typeof cut.metadata.score === "number");
      assert.ok(cut.metadata.category);
    }
  });

  test("uses file_path from source_videos", () => {
    const builder = new CompilationBuilder();
    const result = builder.build({ plan: samplePlan, source_videos: sourceVideos });
    assert.ok(result.ok);
    const cut = result.recipe.find((r) => r.tool === "cut_clips");
    assert.equal(cut.args.file_path, "/videos/v1.mp4");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. VoiceCompiler
// ═══════════════════════════════════════════════════════════════════════════════

describe("VoiceCompiler", () => {
  const sampleVideos = [
    makeVideo("v1", { duration_sec: 60 }),
    makeVideo("v2", { duration_sec: 45 }),
    makeVideo("v3", { duration_sec: 30 }),
  ];

  test("full pipeline compiles from voice prompt", async () => {
    const compiler = new VoiceCompiler({ platform: "tiktok" });
    const result = await compiler.compile({
      voice_prompt: "make a 30 second funny compilation",
      videos: sampleVideos,
    });
    assert.ok(result.ok);
    assert.ok(result.session_id);
    assert.ok(result.parsed);
    assert.ok(result.recipe);
    assert.ok(result.recipe.ok);
    assert.ok(result.recipe.recipe.length >= 4);
    assert.ok(result.timing.total_ms >= 0);
  });

  test("pipeline with youtube_short", async () => {
    const compiler = new VoiceCompiler({ platform: "youtube" });
    const result = await compiler.compile({
      voice_prompt: "youtube shorts from my best moments, 45 seconds",
      videos: sampleVideos,
      platform: "youtube_short",
    });
    assert.ok(result.ok);
    assert.equal(result.plan.platform, "youtube_short");
  });

  test("pipeline with no videos still works", async () => {
    const compiler = new VoiceCompiler();
    const result = await compiler.compile({
      voice_prompt: "make a highlight reel",
      videos: [],
    });
    // Should fail at moment ranking since no videos
    assert.equal(result.ok, false);
    assert.equal(result.error, "moment_ranking_failed");
  });

  test("pipeline with bloopers type", async () => {
    const compiler = new VoiceCompiler({ platform: "youtube" });
    const result = await compiler.compile({
      voice_prompt: "blooper reel from my last 3 videos, 60 seconds",
      videos: sampleVideos,
    });
    assert.ok(result.ok);
    assert.equal(result.parsed.compilation_type, "bloopers");
  });

  test("pipeline tracks timing stages", async () => {
    const compiler = new VoiceCompiler();
    const result = await compiler.compile({
      voice_prompt: "best moments, 20 seconds",
      videos: sampleVideos,
    });
    assert.ok(result.ok);
    assert.deepEqual(result.timing.stages, ["parse", "rank", "plan", "adapt", "build"]);
  });

  test("fails with empty prompt", async () => {
    const compiler = new VoiceCompiler();
    const result = await compiler.compile({ voice_prompt: "", videos: sampleVideos });
    assert.equal(result.ok, false);
    assert.equal(result.error, "voice_parse_failed");
  });

  test("moments_found and moments_selected reported", async () => {
    const compiler = new VoiceCompiler();
    const result = await compiler.compile({
      voice_prompt: "top 5 moments",
      videos: sampleVideos,
    });
    assert.ok(result.ok);
    assert.ok(typeof result.moments_found === "number");
    assert.ok(typeof result.moments_selected === "number");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Integration: full reaction + compilation workflow
// ═══════════════════════════════════════════════════════════════════════════════

describe("Integration", () => {
  test("ReactionEngine + VoiceCompiler can run sequentially", async () => {
    // Step 1: Reaction
    const reaction = new ReactionEngine({ persona: "dramatic_narrator", platform: "youtube" });
    const reactionResult = await reaction.process({
      original_video_path: "/videos/orig.mp4",
      reaction_video_path: "/videos/react.mp4",
      transcript: makeTranscript(),
      duration_sec: 24,
    });
    assert.ok(reactionResult.ok);

    // Step 2: Compilation from same transcript
    const compiler = new VoiceCompiler({ platform: "tiktok" });
    const compileResult = await compiler.compile({
      voice_prompt: "30 second teaser from the best moments",
      videos: [
        {
          video_id: "orig",
          title: "Original Video",
          file_path: "/videos/orig.mp4",
          duration_sec: 24,
          transcript: makeTranscript(),
        },
      ],
    });
    assert.ok(compileResult.ok);
  });

  test("all classes can be instantiated", () => {
    assert.ok(new MomentDetector());
    assert.ok(new SplitScreenLayout());
    assert.ok(new ReactionScript());
    assert.ok(new ReactionComposer());
    assert.ok(new ReactionEngine());
    assert.ok(new VoiceParser());
    assert.ok(new MomentRanker());
    assert.ok(new CompilationPlanner());
    assert.ok(new PlatformAdapter());
    assert.ok(new CompilationBuilder());
    assert.ok(new VoiceCompiler());
  });

  test("constants are non-empty objects/arrays", () => {
    assert.ok(Object.keys(REACTION_PERSONAS).length > 0);
    assert.ok(Object.keys(REACTION_LAYOUTS).length > 0);
    assert.ok(Object.keys(PLATFORM_SPECS).length > 0);
    assert.ok(Object.keys(MOMENT_SCORING_CRITERIA).length > 0);
    assert.ok(MULTI_MODAL_OUTPUT_CLASSES.length > 0);
  });
});
