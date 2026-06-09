// test_multimodal_tools.js — Tests for the 10 Week 4 multi-modal tools.
//
//   1. summarize_video_arc       — 3-act / hero's journey structure
//   2. find_emotional_moments    — peaks (joy, surprise, sadness, tension)
//   3. detect_branding_consistency — color/logo/aspect across clips
//   4. learn_user_style          — Style DNA from past edits
//   5. compare_to_competitors    — your video vs reference channels
//   6. vireo_recall              — semantic search "the part where…"
//   7. vector_search             — embeddings-based
//   8. generate_video_reaction   — Vireo comments on video
//   9. create_compilation_from_voice — "30s teaser from 5min"
//  10. auto_chapterize           — chapter markers from audio beats
//
// All return {ok, ...} and use heuristic v1 (LLM-based v2).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MULTIMODAL_TOOLS,
  MULTIMODAL_TOOL_NAMES,
  summarizeVideoArc,
  findEmotionalMoments,
  detectBrandingConsistency,
  learnUserStyle,
  compareToCompetitors,
  vireoRecall,
  vectorSearch,
  generateVideoReaction,
  createCompilationFromVoice,
  autoChapterize,
} from "../src/multimodal_tools.js";

// ---------- Tool shape ----------

test("Multimodal: 10 tools exported with valid OpenAI shape", () => {
  assert.equal(MULTIMODAL_TOOLS.length, 10);
  for (const t of MULTIMODAL_TOOLS) {
    assert.equal(t.type, "function");
    assert.ok(t.function.name);
    assert.ok(t.function.description.length > 50);
    assert.equal(t.function.parameters.type, "object");
  }
  const names = MULTIMODAL_TOOLS.map((t) => t.function.name).sort();
  assert.deepEqual(names, [
    "auto_chapterize",
    "compare_to_competitors",
    "create_compilation_from_voice",
    "detect_branding_consistency",
    "find_emotional_moments",
    "generate_video_reaction",
    "learn_user_style",
    "summarize_video_arc",
    "vector_search",
    "vireo_recall",
  ]);
});

test("Multimodal: MULTIMODAL_TOOL_NAMES set has 10 names", () => {
  assert.equal(MULTIMODAL_TOOL_NAMES.size, 10);
});

// ---------- 1. summarizeVideoArc ----------

test("summarizeVideoArc: returns segments for valid input", async () => {
  const r = await summarizeVideoArc({ file_path: "/tmp/v.mp4", duration_sec: 60 });
  assert.equal(r.ok, true);
  assert.ok(r.arc_name);
  assert.ok(Array.isArray(r.segments));
  assert.ok(r.segments.length > 0);
});

test("summarizeVideoArc: missing file_path returns error", async () => {
  const r = await summarizeVideoArc({ file_path: "" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "file_path_required");
});

test("summarizeVideoArc: invalid duration returns error", async () => {
  const r = await summarizeVideoArc({ file_path: "/tmp/v.mp4", duration_sec: 0 });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_duration");
});

test("summarizeVideoArc: invalid target_arc returns error", async () => {
  const r = await summarizeVideoArc({ file_path: "/tmp/v.mp4", target_arc: "bogus" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_arc");
});

test("summarizeVideoArc: respects target_arc", async () => {
  const r = await summarizeVideoArc({ file_path: "/tmp/v.mp4", duration_sec: 60, target_arc: "listicle" });
  assert.equal(r.arc, "listicle");
});

// ---------- 2. findEmotionalMoments ----------

test("findEmotionalMoments: returns peaks for transcript", async () => {
  const transcript = [
    { start_sec: 0, end_sec: 2, text: "I love this so much, amazing!" },
    { start_sec: 5, end_sec: 7, text: "What, are you serious? No way!" },
    { start_sec: 10, end_sec: 12, text: "Just a normal statement." },
  ];
  const r = await findEmotionalMoments({ file_path: "/tmp/v.mp4", transcript });
  assert.equal(r.ok, true);
  assert.ok(Array.isArray(r.peaks));
  assert.ok(r.peaks.length >= 1);
});

test("findEmotionalMoments: missing file_path returns error", async () => {
  const r = await findEmotionalMoments({ file_path: "" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "file_path_required");
});

test("findEmotionalMoments: invalid threshold returns error", async () => {
  const r = await findEmotionalMoments({ file_path: "/tmp/v.mp4", threshold: 2.0 });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_threshold");
});

test("findEmotionalMoments: empty transcript returns no peaks", async () => {
  const r = await findEmotionalMoments({ file_path: "/tmp/v.mp4", transcript: [] });
  assert.equal(r.ok, true);
  assert.equal(r.peaks.length, 0);
});

// ---------- 3. detectBrandingConsistency ----------

test("detectBrandingConsistency: high score for consistent clips", async () => {
  const r = await detectBrandingConsistency({
    clips: [
      { thumbnail_color: "#6366f1", aspect_ratio: "16:9" },
      { thumbnail_color: "#6366f1", aspect_ratio: "16:9" },
      { thumbnail_color: "#6366f1", aspect_ratio: "16:9" },
    ],
  });
  assert.equal(r.ok, true);
  assert.equal(r.score, 100);
  assert.equal(r.issues.length, 0);
});

test("detectBrandingConsistency: low score for mixed colors", async () => {
  const r = await detectBrandingConsistency({
    clips: [
      { thumbnail_color: "#6366f1", aspect_ratio: "16:9" },
      { thumbnail_color: "#ef4444", aspect_ratio: "16:9" },
      { thumbnail_color: "#10b981", aspect_ratio: "16:9" },
      { thumbnail_color: "#f59e0b", aspect_ratio: "9:16" },
    ],
  });
  assert.equal(r.ok, true);
  assert.ok(r.score < 100);
  assert.ok(r.issues.length > 0);
});

test("detectBrandingConsistency: missing input returns error", async () => {
  const r = await detectBrandingConsistency({});
  assert.equal(r.ok, false);
  assert.equal(r.error, "clips_or_project_required");
});

// ---------- 4. learnUserStyle ----------

test("learnUserStyle: cold start returns low confidence", async () => {
  const r = await learnUserStyle({ user_id: "u1" });
  assert.equal(r.ok, true);
  assert.ok(r.confidence < 0.5);
});

test("learnUserStyle: with enough projects returns profile", async () => {
  const r = await learnUserStyle({
    user_id: "u1",
    recent_projects: [
      { duration_sec: 30, aspect_ratio: "9:16" },
      { duration_sec: 45, aspect_ratio: "9:16" },
      { duration_sec: 60, aspect_ratio: "9:16" },
    ],
  });
  assert.equal(r.ok, true);
  assert.equal(r.style.preferred_aspect_ratio, "9:16");
  assert.equal(r.style.average_duration_sec, 45);
  assert.ok(r.confidence > 0.5);
});

test("learnUserStyle: missing user_id returns error", async () => {
  const r = await learnUserStyle({});
  assert.equal(r.ok, false);
  assert.equal(r.error, "user_id_required");
});

// ---------- 5. compareToCompetitors ----------

test("compareToCompetitors: returns comparison data", async () => {
  const r = await compareToCompetitors({ file_path: "/tmp/v.mp4" });
  assert.equal(r.ok, true);
  assert.ok(r.your_stats);
  assert.ok(r.peer_average);
  assert.ok(Array.isArray(r.insights));
});

test("compareToCompetitors: missing file_path returns error", async () => {
  const r = await compareToCompetitors({});
  assert.equal(r.ok, false);
  assert.equal(r.error, "file_path_required");
});

// ---------- 6. vireoRecall ----------

test("vireoRecall: returns matches for matching query", async () => {
  const r = await vireoRecall({
    query: "drone shot sunset",
    projects: [
      { id: "p1", title: "Drone shot at sunset", transcript: [{ start_sec: 5, text: "this is the sunset" }] },
      { id: "p2", title: "Cooking video", transcript: [] },
    ],
  });
  assert.equal(r.ok, true);
  assert.ok(r.matches.length >= 1);
  assert.equal(r.matches[0].project_id, "p1");
});

test("vireoRecall: missing query returns error", async () => {
  const r = await vireoRecall({});
  assert.equal(r.ok, false);
  assert.equal(r.error, "query_required");
});

test("vireoRecall: invalid top_k returns error", async () => {
  const r = await vireoRecall({ query: "x", top_k: 100 });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_top_k");
});

// ---------- 7. vectorSearch ----------

test("vectorSearch: empty embeddings returns empty", async () => {
  const r = await vectorSearch({ query: "x" });
  assert.equal(r.ok, true);
  assert.equal(r.results.length, 0);
});

test("vectorSearch: returns matches when embeddings provided", async () => {
  const r = await vectorSearch({
    query: "test",
    embeddings: [
      { id: "e1", text: "hello world" },
      { id: "e2", text: "test query" },
      { id: "e3", text: "another" },
    ],
    top_k: 2,
  });
  assert.equal(r.ok, true);
  assert.equal(r.results.length, 2);
});

test("vectorSearch: missing query returns error", async () => {
  const r = await vectorSearch({});
  assert.equal(r.ok, false);
  assert.equal(r.error, "query_required");
});

// ---------- 8. generateVideoReaction ----------

test("generateVideoReaction: returns text in chosen persona", async () => {
  const r = await generateVideoReaction({ file_path: "/tmp/v.mp4", persona: "curious_viewer" });
  assert.equal(r.ok, true);
  assert.equal(r.persona, "curious_viewer");
  assert.ok(r.text.length > 10);
});

test("generateVideoReaction: invalid persona returns error", async () => {
  const r = await generateVideoReaction({ file_path: "/tmp/v.mp4", persona: "alien" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_persona");
});

test("generateVideoReaction: missing file_path returns error", async () => {
  const r = await generateVideoReaction({});
  assert.equal(r.ok, false);
  assert.equal(r.error, "file_path_required");
});

// ---------- 9. createCompilationFromVoice ----------

test("createCompilationFromVoice: returns recipe", async () => {
  const r = await createCompilationFromVoice({
    file_path: "/tmp/v.mp4",
    voice_prompt: "make a 30s teaser of the best moments",
    max_duration_sec: 30,
  });
  assert.equal(r.ok, true);
  assert.equal(r.compilation_duration_sec, 30);
  assert.ok(r.recipe.length > 0);
  assert.ok(r.recipe.some((step) => step.tool === "cut_clips"));
});

test("createCompilationFromVoice: missing file_path returns error", async () => {
  const r = await createCompilationFromVoice({ voice_prompt: "x" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "file_path_required");
});

test("createCompilationFromVoice: missing voice_prompt returns error", async () => {
  const r = await createCompilationFromVoice({ file_path: "/tmp/v.mp4" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "voice_prompt_required");
});

test("createCompilationFromVoice: invalid duration returns error", async () => {
  const r = await createCompilationFromVoice({
    file_path: "/tmp/v.mp4",
    voice_prompt: "x",
    max_duration_sec: 300,
  });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_duration");
});

// ---------- 10. autoChapterize ----------

test("autoChapterize: returns chapters for long transcript", async () => {
  const transcript = [];
  for (let i = 0; i < 300; i++) {
    // Topic shift every 30 segments
    const topic = Math.floor(i / 30) % 2 === 0 ? "pasta recipe" : "wine pairing";
    transcript.push({ start_sec: i, end_sec: i + 1, text: `${topic} word${i}` });
  }
  const r = await autoChapterize({ file_path: "/tmp/v.mp4", transcript, min_chapter_length_sec: 15 });
  assert.equal(r.ok, true);
  assert.ok(r.chapters.length > 0);
  assert.ok(r.total > 0);
});

test("autoChapterize: empty transcript returns no chapters with message", async () => {
  const r = await autoChapterize({ file_path: "/tmp/v.mp4" });
  assert.equal(r.ok, true);
  assert.equal(r.chapters.length, 0);
  assert.ok(r.message);
});

test("autoChapterize: missing file_path returns error", async () => {
  const r = await autoChapterize({});
  assert.equal(r.ok, false);
  assert.equal(r.error, "file_path_required");
});
