// test_engagement_tools.js — Tests for the 8 Week 3 engagement & growth tools.
//
//   1. analyze_hook_strength        — score first 3 sec
//   2. generate_alternative_hooks    — 3 hook variants
//   3. predict_virality_score        — virality 0-100
//   4. generate_title_variants       — 5 title options
//   5. generate_description_with_timestamps — YouTube SEO desc
//   6. schedule_optimal_posting      — best time per platform
//   7. auto_respond_to_comment       — Style DNA reply
//   8. analyze_audience_sentiment    — sentiment aggregation
//
// All return {ok, ...} and use heuristic v1 (LLM-based v2).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ENGAGEMENT_TOOLS,
  ENGAGEMENT_TOOL_NAMES,
  analyzeHookStrength,
  generateAlternativeHooks,
  predictViralityScore,
  generateTitleVariants,
  generateDescriptionWithTimestamps,
  scheduleOptimalPosting,
  autoRespondToComment,
  analyzeAudienceSentiment,
} from "../src/engagement_tools.js";

// ---------- Tool shape ----------

test("Engagement: 8 tools exported with valid OpenAI shape", () => {
  assert.equal(ENGAGEMENT_TOOLS.length, 8);
  for (const t of ENGAGEMENT_TOOLS) {
    assert.equal(t.type, "function");
    assert.ok(t.function.name);
    assert.ok(t.function.description.length > 50);
    assert.ok(t.function.parameters);
    assert.equal(t.function.parameters.type, "object");
  }
  const names = ENGAGEMENT_TOOLS.map((t) => t.function.name).sort();
  assert.deepEqual(names, [
    "analyze_audience_sentiment",
    "analyze_hook_strength",
    "auto_respond_to_comment",
    "generate_alternative_hooks",
    "generate_description_with_timestamps",
    "generate_title_variants",
    "predict_virality_score",
    "schedule_optimal_posting",
  ]);
});

test("Engagement: ENGAGEMENT_TOOL_NAMES set has 8 names", () => {
  assert.equal(ENGAGEMENT_TOOL_NAMES.size, 8);
});

// ---------- 1. analyzeHookStrength ----------

test("analyzeHookStrength: returns 0-100 score for valid file", async () => {
  const r = await analyzeHookStrength({ file_path: "/tmp/hook_video.mp4" });
  assert.equal(r.ok, true);
  assert.ok(r.score >= 0 && r.score <= 100);
  assert.ok(r.factors);
  assert.ok(Array.isArray(r.recommendations));
});

test("analyzeHookStrength: missing file_path returns error", async () => {
  const r = await analyzeHookStrength({ file_path: "" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "file_path_required");
});

test("analyzeHookStrength: hook keyword in filename boosts score", async () => {
  const r1 = await analyzeHookStrength({ file_path: "/tmp/random.mp4" });
  const r2 = await analyzeHookStrength({ file_path: "/tmp/hook_intro.mp4" });
  assert.equal(r2.ok, true);
  assert.ok(r2.score >= r1.score, `hook keyword should boost: ${r1.score} vs ${r2.score}`);
});

// ---------- 2. generateAlternativeHooks ----------

test("generateAlternativeHooks: returns 3 variants", async () => {
  const r = await generateAlternativeHooks({ topic: "AI video editing" });
  assert.equal(r.ok, true);
  assert.equal(r.variants.length, 3);
  for (const v of r.variants) {
    assert.ok(v.angle);
    assert.ok(v.text);
    assert.ok(v.rationale);
  }
});

test("generateAlternativeHooks: missing topic returns error", async () => {
  const r = await generateAlternativeHooks({ topic: "" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "topic_required");
});

test("generateAlternativeHooks: invalid angle returns error", async () => {
  const r = await generateAlternativeHooks({ topic: "x", angle: "bogus" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_angle");
});

test("generateAlternativeHooks: starting angle determines sequence", async () => {
  const r1 = await generateAlternativeHooks({ topic: "x", angle: "question" });
  const r2 = await generateAlternativeHooks({ topic: "x", angle: "bold_claim" });
  assert.equal(r1.variants[0].angle, "question");
  assert.equal(r2.variants[0].angle, "bold_claim");
});

// ---------- 3. predictViralityScore ----------

test("predictViralityScore: returns 0-100 score", async () => {
  const r = await predictViralityScore({ file_path: "/tmp/v.mp4", platform: "tiktok" });
  assert.equal(r.ok, true);
  assert.ok(r.score >= 0 && r.score <= 100);
  assert.ok(r.factors);
});

test("predictViralityScore: missing file_path returns error", async () => {
  const r = await predictViralityScore({ file_path: "" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "file_path_required");
});

test("predictViralityScore: high hook_score boosts overall", async () => {
  const low = await predictViralityScore({ file_path: "/tmp/v.mp4", hook_score: 30, platform: "tiktok" });
  const high = await predictViralityScore({ file_path: "/tmp/v.mp4", hook_score: 90, platform: "tiktok" });
  assert.ok(high.score > low.score, `high hook should boost: ${low.score} vs ${high.score}`);
});

test("predictViralityScore: trending niche boosts score", async () => {
  const r1 = await predictViralityScore({ file_path: "/tmp/v.mp4", niche: "tech" });
  const r2 = await predictViralityScore({ file_path: "/tmp/v.mp4", niche: "underwater basket weaving" });
  assert.ok(r1.score > r2.score);
});

// ---------- 4. generateTitleVariants ----------

test("generateTitleVariants: returns 7 titles", async () => {
  const r = await generateTitleVariants({ topic: "productivity" });
  assert.equal(r.ok, true);
  assert.equal(r.titles.length, 7);
  for (const t of r.titles) {
    assert.ok(t.pattern);
    assert.ok(t.text);
    assert.ok(t.text.includes("productivity"));
  }
});

test("generateTitleVariants: missing topic returns error", async () => {
  const r = await generateTitleVariants({ topic: "" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "topic_required");
});

test("generateTitleVariants: 7 patterns are different", async () => {
  const r = await generateTitleVariants({ topic: "fitness" });
  const texts = new Set(r.titles.map((t) => t.text));
  assert.equal(texts.size, 7, "all 7 titles should be unique");
});

// ---------- 5. generateDescriptionWithTimestamps ----------

test("generateDescriptionWithTimestamps: returns formatted description", async () => {
  const r = await generateDescriptionWithTimestamps({ topic: "cooking pasta" });
  assert.equal(r.ok, true);
  assert.ok(r.description.includes("cooking pasta"));
});

test("generateDescriptionWithTimestamps: missing topic returns error", async () => {
  const r = await generateDescriptionWithTimestamps({ topic: "" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "topic_required");
});

test("generateDescriptionWithTimestamps: includes provided chapters", async () => {
  const r = await generateDescriptionWithTimestamps({ topic: "x", chapters: [{ start_sec: 0, title: "Intro" }, { start_sec: 60, title: "Main" }] });
  assert.ok(r.description.includes("Intro"));
  assert.ok(r.description.includes("Main"));
  assert.ok(r.description.includes("0:00"));
  assert.ok(r.description.includes("1:00"));
});

test("generateDescriptionWithTimestamps: includes CTA when provided", async () => {
  const r = await generateDescriptionWithTimestamps({ topic: "x", cta: "Subscribe!" });
  assert.ok(r.description.includes("Subscribe!"));
});

test("generateDescriptionWithTimestamps: auto-generates chapters from transcript", async () => {
  const transcript = [];
  for (let i = 0; i < 120; i++) {
    transcript.push({ start_sec: i, end_sec: i + 1, text: `word ${i}` });
  }
  const r = await generateDescriptionWithTimestamps({ topic: "x", transcript });
  assert.ok(r.description.includes("Chapters"));
});

// ---------- 6. scheduleOptimalPosting ----------

test("scheduleOptimalPosting: returns best days and hours", async () => {
  const r = await scheduleOptimalPosting({ platform: "tiktok" });
  assert.equal(r.ok, true);
  assert.ok(Array.isArray(r.best_days));
  assert.ok(Array.isArray(r.best_hours_utc));
  assert.ok(r.rationale);
});

test("scheduleOptimalPosting: invalid platform returns error", async () => {
  const r = await scheduleOptimalPosting({ platform: "myspace" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_platform");
});

test("scheduleOptimalPosting: personalizes with history", async () => {
  const history = [];
  // Fake history: best at 8am UTC
  for (let i = 0; i < 10; i++) {
    history.push({ platform: "tiktok", day: "Monday", hour_utc: 8, engagement: 100 });
  }
  const r = await scheduleOptimalPosting({ platform: "tiktok", history });
  assert.equal(r.ok, true);
  assert.equal(r.personalized, true);
  assert.ok(r.best_hours_utc.includes(8));
});

// ---------- 7. autoRespondToComment ----------

test("autoRespondToComment: positive comment gets grateful tone", async () => {
  const r = await autoRespondToComment({ comment: "Love this video!" });
  assert.equal(r.ok, true);
  assert.equal(r.tone, "grateful");
  assert.equal(r.sentiment, "positive");
  assert.ok(r.response);
});

test("autoRespondToComment: negative comment gets helpful tone", async () => {
  const r = await autoRespondToComment({ comment: "This is the worst video ever" });
  assert.equal(r.ok, true);
  assert.equal(r.sentiment, "negative");
});

test("autoRespondToComment: question gets helpful tone", async () => {
  const r = await autoRespondToComment({ comment: "How do you do this?" });
  assert.equal(r.ok, true);
  assert.equal(r.filter, "question");
  assert.equal(r.tone, "helpful");
});

test("autoRespondToComment: spam is skipped", async () => {
  const r = await autoRespondToComment({ comment: "Click here for free money!" });
  assert.equal(r.ok, true);
  assert.equal(r.filter, "spam");
  assert.equal(r.response, null);
  assert.equal(r.recommendation, "skip_reply");
});

test("autoRespondToComment: missing comment returns error", async () => {
  const r = await autoRespondToComment({ comment: "" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "comment_required");
});

test("autoRespondToComment: forced tone is respected", async () => {
  const r = await autoRespondToComment({ comment: "Love it!", tone: "witty" });
  assert.equal(r.ok, true);
  assert.equal(r.tone, "witty");
});

// ---------- 8. analyzeAudienceSentiment ----------

test("analyzeAudienceSentiment: aggregates sentiment from comments", async () => {
  const r = await analyzeAudienceSentiment({ comments: [
    { text: "Love this video!" },
    { text: "Amazing content" },
    { text: "This is terrible" },
    { text: "How do I subscribe?" },
  ] });
  assert.equal(r.ok, true);
  assert.equal(r.summary.total_comments, 4);
  assert.equal(r.summary.positive, 2);
  assert.equal(r.summary.negative, 1);
  assert.equal(r.summary.questions, 1);
});

test("analyzeAudienceSentiment: empty array returns error", async () => {
  const r = await analyzeAudienceSentiment({ comments: [] });
  assert.equal(r.ok, false);
  assert.equal(r.error, "empty_comments");
});

test("analyzeAudienceSentiment: missing comments returns error", async () => {
  const r = await analyzeAudienceSentiment({});
  assert.equal(r.ok, false);
  assert.equal(r.error, "comments_required");
});

test("analyzeAudienceSentiment: returns top topics", async () => {
  const r = await analyzeAudienceSentiment({ comments: [
    { text: "Great cooking tutorial" },
    { text: "Cooking with friends" },
    { text: "Loved the cooking" },
    { text: "Random unrelated comment" },
  ] });
  assert.equal(r.ok, true);
  assert.ok(r.top_topics.length > 0);
});

test("analyzeAudienceSentiment: positive ratio > 0.5 → very_positive", async () => {
  const r = await analyzeAudienceSentiment({ comments: [
    { text: "Love" },
    { text: "Great" },
    { text: "Amazing" },
    { text: "Best ever" },
  ] });
  assert.equal(r.summary.overall_sentiment, "very_positive");
});
