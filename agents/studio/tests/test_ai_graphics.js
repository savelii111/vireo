// test_ai_graphics.js — Tests for the 10 AI graphics & overlay tools.
//
//   1. auto_captions            — caption generation
//   2. auto_animated_captions   — animated caption keyframes
//   3. auto_word_level_timing   — word-level timestamps
//   4. auto_speaker_labels      — speaker diarization
//   5. auto_highlight_words     — highlight key words
//   6. auto_text_animation      — animated text overlay
//   7. auto_lower_third         — lower-third graphic
//   8. auto_callouts            — annotation callouts
//   9. auto_chapter_markers     — chapter markers
//  10. auto_subscribe_reminder  — subscribe/like overlay

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AI_GRAPHICS_TOOLS,
  AI_GRAPHICS_TOOL_NAMES,
  autoCaptions,
  autoAnimatedCaptions,
  autoWordLevelTiming,
  autoSpeakerLabels,
  autoHighlightWords,
  autoTextAnimation,
  autoLowerThird,
  autoCallouts,
  autoChapterMarkers,
  autoSubscribeReminder,
} from "../src/ai_graphics.js";

// ====================================================================
// Tool shape tests
// ====================================================================

test("AI Graphics: 10 tools exported with valid OpenAI shape", () => {
  assert.equal(AI_GRAPHICS_TOOLS.length, 10);
  for (const t of AI_GRAPHICS_TOOLS) {
    assert.equal(t.type, "function");
    assert.ok(t.function.name);
    assert.ok(t.function.description.length > 50);
    assert.equal(t.function.parameters.type, "object");
  }
  const names = AI_GRAPHICS_TOOLS.map((t) => t.function.name).sort();
  assert.deepEqual(names, [
    "auto_animated_captions",
    "auto_callouts",
    "auto_captions",
    "auto_chapter_markers",
    "auto_highlight_words",
    "auto_lower_third",
    "auto_speaker_labels",
    "auto_subscribe_reminder",
    "auto_text_animation",
    "auto_word_level_timing",
  ]);
});

test("AI Graphics: AI_GRAPHICS_TOOL_NAMES set has 10 names", () => {
  assert.equal(AI_GRAPHICS_TOOL_NAMES.size, 10);
  assert.ok(AI_GRAPHICS_TOOL_NAMES.has("auto_captions"));
  assert.ok(AI_GRAPHICS_TOOL_NAMES.has("auto_subscribe_reminder"));
});

// ====================================================================
// 1. auto_captions
// ====================================================================

test("autoCaptions: returns track with word count for valid video", async () => {
  const r = await autoCaptions({ video: "/tmp/test_video.mp4" });
  assert.equal(r.ok, true);
  assert.ok(r.track);
  assert.ok(r.track.id.startsWith("caption-"));
  assert.equal(r.track.language, "en");
  assert.equal(r.track.style, "default");
  assert.ok(r.word_count > 0);
  assert.ok(r.duration_sec > 0);
});

test("autoCaptions: missing video returns error", async () => {
  const r = await autoCaptions({ video: "" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "video_required");
});

test("autoCaptions: invalid style returns error", async () => {
  const r = await autoCaptions({ video: "/tmp/v.mp4", style: "disco" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_style");
});

test("autoCaptions: custom language and style applied", async () => {
  const r = await autoCaptions({ video: "/tmp/v.mp4", language: "es", style: "karaoke" });
  assert.equal(r.ok, true);
  assert.equal(r.track.language, "es");
  assert.equal(r.track.style, "karaoke");
});

test("autoCaptions: all valid styles accepted", async () => {
  const styles = ["default", "karaoke", "word-by-word", "minimal", "bold"];
  for (const s of styles) {
    const r = await autoCaptions({ video: "/tmp/v.mp4", style: s });
    assert.equal(r.ok, true, `style ${s} should be valid`);
    assert.equal(r.track.style, s);
  }
});

// ====================================================================
// 2. auto_animated_captions
// ====================================================================

test("autoAnimatedCaptions: returns keyframes for valid input", async () => {
  const r = await autoAnimatedCaptions({ video: "/tmp/test_video.mp4" });
  assert.equal(r.ok, true);
  assert.ok(r.track);
  assert.ok(r.track.id.startsWith("anncap-"));
  assert.equal(r.animation_type, "pop");
  assert.ok(Array.isArray(r.keyframes));
  assert.ok(r.keyframes.length > 0);
});

test("autoAnimatedCaptions: missing video returns error", async () => {
  const r = await autoAnimatedCaptions({ video: "" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "video_required");
});

test("autoAnimatedCaptions: invalid animation returns error", async () => {
  const r = await autoAnimatedCaptions({ video: "/tmp/v.mp4", animation: "spin" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_animation");
});

test("autoAnimatedCaptions: each keyframe has animation properties", async () => {
  const r = await autoAnimatedCaptions({ video: "/tmp/v.mp4", animation: "bounce" });
  assert.equal(r.ok, true);
  for (const kf of r.keyframes) {
    assert.ok(kf.word);
    assert.equal(typeof kf.start_sec, "number");
    assert.equal(typeof kf.end_sec, "number");
    assert.equal(kf.animation, "bounce");
    assert.ok(kf.properties);
  }
});

// ====================================================================
// 3. auto_word_level_timing
// ====================================================================

test("autoWordLevelTiming: returns words with timestamps", async () => {
  const r = await autoWordLevelTiming({
    transcript: { text: "Hello world this is a test" },
  });
  assert.equal(r.ok, true);
  assert.ok(Array.isArray(r.words));
  assert.equal(r.words.length, 6);
  for (const w of r.words) {
    assert.ok(w.word);
    assert.equal(typeof w.start_sec, "number");
    assert.equal(typeof w.end_sec, "number");
    assert.ok(w.start_sec < w.end_sec);
    assert.ok(w.confidence >= 0 && w.confidence <= 1);
  }
});

test("autoWordLevelTiming: missing transcript returns error", async () => {
  const r = await autoWordLevelTiming({ transcript: null });
  assert.equal(r.ok, false);
  assert.equal(r.error, "transcript_required");
});

test("autoWordLevelTiming: empty text returns error", async () => {
  const r = await autoWordLevelTiming({ transcript: { text: "" } });
  assert.equal(r.ok, false);
  // Empty string is falsy, so hits transcript_required check first
  assert.equal(r.error, "transcript_required");
});

test("autoWordLevelTiming: distributes words across segments", async () => {
  const r = await autoWordLevelTiming({
    transcript: {
      text: "First segment words here and second segment words there",
      segments: [
        { start_sec: 0, end_sec: 5, text: "First segment words here" },
        { start_sec: 5, end_sec: 10, text: "and second segment words there" },
      ],
    },
  });
  assert.equal(r.ok, true);
  assert.equal(r.words.length, 9);
  // First segment words should be within 0-5s range
  assert.ok(r.words[0].start_sec >= 0);
  assert.ok(r.words[3].end_sec <= 5.5);
  // Second segment words should be within 5-10s range
  assert.ok(r.words[4].start_sec >= 4.5);
});

// ====================================================================
// 4. auto_speaker_labels
// ====================================================================

test("autoSpeakerLabels: returns speakers with segments", async () => {
  const r = await autoSpeakerLabels({ audio: "/tmp/test_audio.mp3" });
  assert.equal(r.ok, true);
  assert.ok(Array.isArray(r.speakers));
  assert.ok(r.speaker_count >= 2);
  for (const sp of r.speakers) {
    assert.ok(sp.id);
    assert.ok(sp.label);
    assert.ok(sp.color);
    assert.ok(Array.isArray(sp.segments));
    assert.ok(sp.segments.length > 0);
  }
});

test("autoSpeakerLabels: missing audio returns error", async () => {
  const r = await autoSpeakerLabels({ audio: "" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "audio_required");
});

// ====================================================================
// 5. auto_highlight_words
// ====================================================================

test("autoHighlightWords: highlights long words", async () => {
  const r = await autoHighlightWords({
    captions: { text: "The amazing video editing tutorial was incredibly helpful" },
  });
  assert.equal(r.ok, true);
  assert.ok(r.highlighted_words.length > 0);
  assert.ok(r.total_highlights > 0);
  assert.ok(Array.isArray(r.captions.highlighted));
});

test("autoHighlightWords: missing captions returns error", async () => {
  const r = await autoHighlightWords({ captions: null });
  assert.equal(r.ok, false);
  assert.equal(r.error, "captions_required");
});

test("autoHighlightWords: empty text returns error", async () => {
  const r = await autoHighlightWords({ captions: { text: "" } });
  assert.equal(r.ok, false);
  assert.equal(r.error, "captions_text_empty");
});

test("autoHighlightWords: custom highlight color applied", async () => {
  const r = await autoHighlightWords({
    captions: { text: "This is a wonderful experience" },
    highlight_color: "#ff0000",
  });
  assert.equal(r.ok, true);
  const highlighted = r.captions.highlighted.filter((w) => w.highlight);
  for (const h of highlighted) {
    assert.equal(h.color, "#ff0000");
  }
});

// ====================================================================
// 6. auto_text_animation
// ====================================================================

test("autoTextAnimation: returns keyframes for fade", async () => {
  const r = await autoTextAnimation({ text: "Hello World" });
  assert.equal(r.ok, true);
  assert.ok(Array.isArray(r.keyframes));
  assert.ok(r.keyframes.length > 0);
  assert.equal(r.duration_sec, 1);
  assert.equal(r.easing, "ease-in-out");
});

test("autoTextAnimation: missing text returns error", async () => {
  const r = await autoTextAnimation({ text: "" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "text_required");
});

test("autoTextAnimation: invalid type returns error", async () => {
  const r = await autoTextAnimation({ text: "Hi", type: "explode" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_type");
});

test("autoTextAnimation: invalid duration returns error", async () => {
  const r = await autoTextAnimation({ text: "Hi", duration_sec: -1 });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_duration");
});

test("autoTextAnimation: typewriter creates clip_path keyframes", async () => {
  const r = await autoTextAnimation({ text: "Typewriter effect", type: "typewriter", duration_sec: 2 });
  assert.equal(r.ok, true);
  assert.equal(r.duration_sec, 2);
  // First frame should have clip_path fully hidden
  const first = r.keyframes[0];
  assert.ok(first.clip_path.includes("100%"), "first frame should be fully clipped");
  // Last frame should be fully visible
  const last = r.keyframes[r.keyframes.length - 1];
  assert.ok(last.clip_path.includes("0%") || last.clip_path.includes("inset(0 0"), "last frame should be visible");
});

test("autoTextAnimation: all valid types produce keyframes", async () => {
  const types = ["fade", "slide", "typewriter", "bounce", "glitch"];
  for (const t of types) {
    const r = await autoTextAnimation({ text: "Test", type: t });
    assert.equal(r.ok, true, `type ${t} should be valid`);
    assert.ok(r.keyframes.length > 0, `type ${t} should have keyframes`);
  }
});

// ====================================================================
// 7. auto_lower_third
// ====================================================================

test("autoLowerThird: returns graphic with name and title", async () => {
  const r = await autoLowerThird("Jane Doe", "Creative Director");
  assert.equal(r.ok, true);
  assert.ok(r.graphic);
  assert.ok(r.graphic.id.startsWith("lt-"));
  assert.equal(r.graphic.name, "Jane Doe");
  assert.equal(r.graphic.title, "Creative Director");
  assert.equal(r.graphic.style, "modern");
  assert.equal(r.duration_sec, 5);
  assert.ok(r.animation_in);
  assert.ok(r.animation_out);
});

test("autoLowerThird: missing name returns error", async () => {
  const r = await autoLowerThird("", "Title");
  assert.equal(r.ok, false);
  assert.equal(r.error, "name_required");
});

test("autoLowerThird: missing title returns error", async () => {
  const r = await autoLowerThird("Name", "");
  assert.equal(r.ok, false);
  assert.equal(r.error, "title_required");
});

test("autoLowerThird: invalid style returns error", async () => {
  const r = await autoLowerThird("Name", "Title", { style: "neon" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_style");
});

test("autoLowerThird: broadcast style has different colors", async () => {
  const modern = await autoLowerThird("A", "B", { style: "modern" });
  const broadcast = await autoLowerThird("A", "B", { style: "broadcast" });
  assert.equal(modern.ok, true);
  assert.equal(broadcast.ok, true);
  assert.notEqual(modern.graphic.colors.bg, broadcast.graphic.colors.bg);
});

// ====================================================================
// 8. auto_callouts
// ====================================================================

test("autoCallouts: returns graphics for valid points", async () => {
  const r = await autoCallouts({
    points: [
      { x: 100, y: 200, text: "Look here", time_sec: 5 },
      { x: 300, y: 400, text: "Important", time_sec: 10 },
    ],
  });
  assert.equal(r.ok, true);
  assert.equal(r.total_count, 2);
  assert.equal(r.graphics.length, 2);
  for (const g of r.graphics) {
    assert.ok(g.id.startsWith("callout-"));
    assert.equal(g.style, "arrow");
    assert.equal(g.duration, 3);
  }
});

test("autoCallouts: empty points returns error", async () => {
  const r = await autoCallouts({ points: [] });
  assert.equal(r.ok, false);
  assert.equal(r.error, "points_required");
});

test("autoCallouts: null points returns error", async () => {
  const r = await autoCallouts({ points: null });
  assert.equal(r.ok, false);
  assert.equal(r.error, "points_required");
});

test("autoCallouts: invalid style returns error", async () => {
  const r = await autoCallouts({ points: [{ x: 0, y: 0 }], style: "wave" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_style");
});

test("autoCallouts: circle style has circle shape", async () => {
  const r = await autoCallouts({
    points: [{ x: 50, y: 50, text: "Circle callout" }],
    style: "circle",
  });
  assert.equal(r.ok, true);
  assert.equal(r.graphics[0].visual.shape, "circle");
});

// ====================================================================
// 9. auto_chapter_markers
// ====================================================================

test("autoChapterMarkers: returns markers with colors and icons", async () => {
  const r = await autoChapterMarkers({
    chapters: [
      { time_sec: 0, title: "Introduction" },
      { time_sec: 30, title: "Main Content" },
      { time_sec: 120, title: "Conclusion" },
    ],
  });
  assert.equal(r.ok, true);
  assert.equal(r.total_chapters, 3);
  assert.equal(r.markers.length, 3);
  for (const m of r.markers) {
    assert.ok(m.id.startsWith("chapter-"));
    assert.ok(m.title);
    assert.ok(m.color.startsWith("#"));
    assert.ok(m.icon);
  }
});

test("autoChapterMarkers: empty chapters returns error", async () => {
  const r = await autoChapterMarkers({ chapters: [] });
  assert.equal(r.ok, false);
  assert.equal(r.error, "chapters_required");
});

test("autoChapterMarkers: null chapters returns error", async () => {
  const r = await autoChapterMarkers({ chapters: null });
  assert.equal(r.ok, false);
  assert.equal(r.error, "chapters_required");
});

test("autoChapterMarkers: chapters have sequential index", async () => {
  const r = await autoChapterMarkers({
    chapters: [
      { time_sec: 0, title: "A" },
      { time_sec: 10, title: "B" },
    ],
  });
  assert.equal(r.ok, true);
  assert.equal(r.markers[0].index, 0);
  assert.equal(r.markers[1].index, 1);
});

// ====================================================================
// 10. auto_subscribe_reminder
// ====================================================================

test("autoSubscribeReminder: returns graphic for valid video", async () => {
  const r = await autoSubscribeReminder({ video: "/tmp/video.mp4" });
  assert.equal(r.ok, true);
  assert.ok(r.graphic);
  assert.ok(r.graphic.id.startsWith("sub-"));
  assert.equal(r.position, "end");
  assert.equal(r.duration_sec, 5);
  assert.ok(r.animation);
  assert.ok(r.animation.in);
  assert.ok(r.animation.out);
});

test("autoSubscribeReminder: missing video returns error", async () => {
  const r = await autoSubscribeReminder({ video: "" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "video_required");
});

test("autoSubscribeReminder: invalid position returns error", async () => {
  const r = await autoSubscribeReminder({ video: "/tmp/v.mp4", position: "side" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_position");
});

test("autoSubscribeReminder: start position has shorter duration", async () => {
  const start = await autoSubscribeReminder({ video: "/tmp/v.mp4", position: "start" });
  const end = await autoSubscribeReminder({ video: "/tmp/v.mp4", position: "end" });
  assert.equal(start.ok, true);
  assert.equal(end.ok, true);
  assert.equal(start.duration_sec, 3);
  assert.equal(end.duration_sec, 5);
});

test("autoSubscribeReminder: graphic has subscribe and like buttons", async () => {
  const r = await autoSubscribeReminder({ video: "/tmp/v.mp4" });
  assert.equal(r.ok, true);
  const types = r.graphic.elements.map((e) => e.type);
  assert.ok(types.includes("subscribe_button"));
  assert.ok(types.includes("like_button"));
});
