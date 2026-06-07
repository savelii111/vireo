// Unit tests for Distributor adapters.
import { test } from "node:test";
import assert from "node:assert/strict";
import { adaptToPlatform, adaptToAllPlatforms, PLATFORM_ADAPTERS } from "../src/adapters.js";
import { PLATFORMS } from "@vireo/shared";

const editPlan = {
  source_id: "src-1",
  cuts: [
    { start: 0, end: 5, score: 0.9, text: "Did you know that 73% of creators burn out?", role: "hook" },
    { start: 5, end: 15, score: 0.8, text: "The data is clear: AI assistants are now essential.", role: "body" },
    { start: 15, end: 25, score: 0.7, text: "Subscribe for more creator insights!", role: "cta" },
  ],
  output_duration_sec: 25,
  style_applied: { tone: "energetic" },
  notes: "Test plan",
};

const styleDna = {
  user_id: "u1",
  tone: "energetic",
  pacing: "fast",
  topics: ["creators", "burnout", "AI"],
  hook_patterns: ["curiosity"],
  cta_patterns: ["engagement"],
};

test("adaptToPlatform: youtube", () => {
  const out = adaptToPlatform("youtube", editPlan, styleDna);
  assert.equal(out.platform, "youtube");
  assert.ok(out.title.length > 0);
  assert.ok(out.title.length <= 100);
  assert.ok(out.caption.length > 0);
  assert.ok(out.hashtags.length > 0);
  assert.equal(out.media[0].type, "video");
  assert.equal(out.metadata.ratio, "16:9");
});

test("adaptToPlatform: youtube_shorts truncates to <=100 chars title", () => {
  const out = adaptToPlatform("youtube_shorts", editPlan, styleDna);
  assert.ok(out.title.length <= 100);
  assert.ok(out.caption.length <= 100);
  assert.equal(out.metadata.ratio, "9:16");
  assert.ok(out.metadata.duration_sec <= 60);
});

test("adaptToPlatform: instagram_reels respects 9:16 + 90s cap", () => {
  const out = adaptToPlatform("instagram_reels", editPlan, styleDna);
  assert.equal(out.metadata.ratio, "9:16");
  assert.ok(out.metadata.duration_sec <= 90);
  assert.ok(out.caption.length <= 2200);
});

test("adaptToPlatform: tiktok allows up to 600s", () => {
  const out = adaptToPlatform("tiktok", editPlan, styleDna);
  assert.ok(out.metadata.duration_sec <= 600);
  assert.ok(out.caption.length <= 2200);
});

test("adaptToPlatform: x truncates to 280 chars", () => {
  const out = adaptToPlatform("x", editPlan, styleDna);
  assert.ok(out.caption.length <= 280);
  assert.ok(out.hashtags.length <= 3);
});

test("adaptToPlatform: linkedin allows up to 3000 chars and adds hook line for professional tone", () => {
  const out = adaptToPlatform("linkedin", { ...editPlan, style_applied: { ...editPlan.style_applied, tone: "professional" } }, { ...styleDna, tone: "professional" });
  assert.ok(out.caption.length <= 3000);
  assert.match(out.caption, /Quick thought on/);
});

test("adaptToPlatform: threads <= 500 chars", () => {
  const out = adaptToPlatform("threads", editPlan, styleDna);
  assert.ok(out.caption.length <= 500);
});

test("adaptToPlatform: telegram keeps title + preview", () => {
  const out = adaptToPlatform("telegram", editPlan, styleDna);
  assert.ok(out.title.length > 0);
  assert.equal(out.metadata.preview, true);
});

test("adaptToPlatform: substack is longform, no truncation", () => {
  const out = adaptToPlatform("substack", editPlan, styleDna);
  assert.equal(out.metadata.format, "newsletter");
  // Should preserve full content
  assert.equal(out.caption, editPlan.cuts.map((c) => c.text).join(" "));
});

test("adaptToPlatform: podcast returns audio media type", () => {
  const out = adaptToPlatform("podcast", editPlan, styleDna);
  assert.equal(out.media[0].type, "audio");
});

test("adaptToPlatform: unknown platform throws", () => {
  assert.throws(() => adaptToPlatform("telegraph", editPlan, styleDna), /No adapter/);
});

test("adaptToAllPlatforms: produces one per requested platform", () => {
  const all = adaptToAllPlatforms(editPlan, styleDna);
  assert.equal(all.length, PLATFORMS.length);
  const seen = new Set(all.map((p) => p.platform));
  assert.equal(seen.size, PLATFORMS.length);
});

test("adaptToAllPlatforms: subset honored", () => {
  const subset = ["youtube", "x", "tiktok"];
  const all = adaptToAllPlatforms(editPlan, styleDna, subset);
  assert.equal(all.length, 3);
  const platforms = all.map((p) => p.platform);
  assert.deepEqual(platforms.sort(), subset.sort());
});

test("adaptToPlatform: title is trimmed + capitalized", () => {
  const plan = {
    ...editPlan,
    cuts: [{ ...editPlan.cuts[0], text: "wow this is incredible content" }],
  };
  const out = adaptToPlatform("youtube", plan, styleDna);
  // Should be capitalized
  assert.equal(out.title[0], out.title[0].toUpperCase());
});

test("adaptToPlatform: energetic tone adds exclamation to title", () => {
  const plan = {
    ...editPlan,
    cuts: [{ ...editPlan.cuts[0], text: "This is a normal statement." }],
  };
  const out = adaptToPlatform("youtube", plan, { ...styleDna, tone: "energetic" });
  assert.ok(out.title.endsWith("!"), `Expected !, got: ${out.title}`);
});

test("adaptToPlatform: empty cuts still produces valid output", () => {
  const plan = { ...editPlan, cuts: [] };
  const out = adaptToPlatform("youtube", plan, styleDna);
  assert.equal(out.platform, "youtube");
  assert.equal(out.title, "Untitled");
});

test("hashtags include platform tag", () => {
  const out = adaptToPlatform("youtube", editPlan, styleDna);
  assert.ok(out.hashtags.some((h) => h === "#youtube"));
});

test("hashtags include topics from DNA", () => {
  const out = adaptToPlatform("youtube", editPlan, styleDna);
  for (const t of styleDna.topics) {
    // Hashtags are lowercase by convention; check for #<topic lowercased>
    const expected = `#${t.toLowerCase()}`;
    assert.ok(out.hashtags.some((h) => h === expected), `Missing ${expected} in ${out.hashtags}`);
  }
});

test("PLATFORM_ADAPTERS covers all PLATFORMS", () => {
  for (const p of PLATFORMS) {
    assert.ok(PLATFORM_ADAPTERS[p], `Missing adapter for ${p}`);
  }
});
