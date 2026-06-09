// test_graphics_overlay.js — Tests for the 10 graphics overlay tools.
//
//   1.  addLogo                — logo overlay
//   2.  addWatermark           — text/logo/diagonal/pattern watermark
//   3.  addSocialIcons         — social media icons overlay
//   4.  addSubscribeReminder   — subscribe CTA overlay
//   5.  addEndScreen           — end screen with elements
//   6.  addInfoCards           — timestamped info cards
//   7.  addProgressBar          — progress bar overlay
//   8.  addViewCounter         — animated view count overlay
//   9.  addLikeReminder        — like CTA overlay
//  10.  addCommentPrompt       — comment engagement prompt
//
// All return {ok, ...} and use heuristic v1.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GRAPHICS_OVERLAY_TOOLS,
  GRAPHICS_OVERLAY_TOOL_NAMES,
  addLogo,
  addWatermark,
  addSocialIcons,
  addSubscribeReminder,
  addEndScreen,
  addInfoCards,
  addProgressBar,
  addViewCounter,
  addLikeReminder,
  addCommentPrompt,
} from "../src/graphics_overlay.js";

// ---------- Tool shape ----------

test("GraphicsOverlay: 10 tools exported with valid OpenAI shape", () => {
  assert.equal(GRAPHICS_OVERLAY_TOOLS.length, 10);
  for (const t of GRAPHICS_OVERLAY_TOOLS) {
    assert.equal(t.type, "function");
    assert.ok(t.function.name);
    assert.ok(t.function.description.length > 50);
    assert.ok(t.function.parameters);
    assert.equal(t.function.parameters.type, "object");
  }
  const names = GRAPHICS_OVERLAY_TOOLS.map((t) => t.function.name).sort();
  assert.deepEqual(names, [
    "add_comment_prompt",
    "add_end_screen",
    "add_info_cards",
    "add_like_reminder",
    "add_logo",
    "add_progress_bar",
    "add_social_icons",
    "add_subscribe_reminder",
    "add_view_counter",
    "add_watermark",
  ]);
});

test("GraphicsOverlay: GRAPHICS_OVERLAY_TOOL_NAMES set has 10 names", () => {
  assert.equal(GRAPHICS_OVERLAY_TOOL_NAMES.size, 10);
});

// ---------- 1. addLogo ----------

test("addLogo: adds logo at default position", async () => {
  const r = await addLogo({ video: "/tmp/video.mp4", logo: "/tmp/logo.png" });
  assert.equal(r.ok, true);
  assert.equal(r.overlay_added, true);
  assert.equal(r.position.name, "bottom-right");
  assert.ok(r.size > 0 && r.size <= 0.4);
  assert.equal(r.opacity, 1.0);
  assert.ok(r.ffmpeg_filter);
});

test("addLogo: missing video returns error", async () => {
  const r = await addLogo({ logo: "/tmp/logo.png" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "video_required");
});

test("addLogo: missing logo returns error", async () => {
  const r = await addLogo({ video: "/tmp/video.mp4" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "logo_required");
});

test("addLogo: invalid position returns error", async () => {
  const r = await addLogo({ video: "/tmp/video.mp4", logo: "/tmp/logo.png", position: "top-center" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_position");
  assert.ok(r.valid.includes("top-left"));
});

test("addLogo: invalid opacity returns error", async () => {
  const r = await addLogo({ video: "/tmp/video.mp4", logo: "/tmp/logo.png", opacity: 1.5 });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_opacity");
});

test("addLogo: custom position and size are reflected", async () => {
  const r = await addLogo({ video: "/tmp/video.mp4", logo: "/tmp/logo.png", position: "center", size: 0.3, opacity: 0.7 });
  assert.equal(r.ok, true);
  assert.equal(r.position.name, "center");
  assert.equal(r.position.x, 0.5);
  assert.equal(r.position.y, 0.5);
  assert.equal(r.size, 0.3);
  assert.equal(r.opacity, 0.7);
});

// ---------- 2. addWatermark ----------

test("addWatermark: adds text watermark", async () => {
  const r = await addWatermark({ video: "/tmp/video.mp4", text: "My Brand" });
  assert.equal(r.ok, true);
  assert.equal(r.overlay_added, true);
  assert.equal(r.style, "text");
  assert.equal(r.opacity, 0.3);
  assert.equal(r.text, "My Brand");
});

test("addWatermark: text style without text returns error", async () => {
  const r = await addWatermark({ video: "/tmp/video.mp4", style: "text" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "text_required_for_text_style");
});

test("addWatermark: invalid style returns error", async () => {
  const r = await addWatermark({ video: "/tmp/video.mp4", text: "x", style: "neon" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_style");
  assert.ok(r.valid.includes("diagonal"));
});

test("addWatermark: diagonal style works without text", async () => {
  const r = await addWatermark({ video: "/tmp/video.mp4", style: "diagonal" });
  assert.equal(r.ok, true);
  assert.equal(r.style, "diagonal");
  assert.equal(r.text, null);
});

// ---------- 3. addSocialIcons ----------

test("addSocialIcons: adds icons for multiple platforms", async () => {
  const r = await addSocialIcons({ video: "/tmp/video.mp4", platforms: ["youtube", "instagram"] });
  assert.equal(r.ok, true);
  assert.equal(r.icons_added.length, 2);
  assert.equal(r.icons_added[0].platform, "youtube");
  assert.ok(r.icons_added[0].icon_url.includes("youtube"));
  assert.equal(r.icons_added[1].platform, "instagram");
  assert.ok(r.position);
});

test("addSocialIcons: invalid platform returns error", async () => {
  const r = await addSocialIcons({ video: "/tmp/video.mp4", platforms: ["youtube", "myspace"] });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_platforms");
  assert.deepEqual(r.invalid, ["myspace"]);
});

test("addSocialIcons: empty platforms returns error", async () => {
  const r = await addSocialIcons({ video: "/tmp/video.mp4", platforms: [] });
  assert.equal(r.ok, false);
  assert.equal(r.error, "platforms_required_non_empty");
});

test("addSocialIcons: all 5 platforms supported", async () => {
  const r = await addSocialIcons({ video: "/tmp/video.mp4", platforms: ["youtube", "instagram", "tiktok", "twitter", "facebook"] });
  assert.equal(r.ok, true);
  assert.equal(r.icons_added.length, 5);
});

// ---------- 4. addSubscribeReminder ----------

test("addSubscribeReminder: adds bell-style reminder", async () => {
  const r = await addSubscribeReminder({ video: "/tmp/video.mp4", style: "bell" });
  assert.equal(r.ok, true);
  assert.equal(r.overlay_added, true);
  assert.equal(r.style, "bell");
  assert.equal(r.animation, "bell_ring");
  assert.ok(r.duration_sec > 0);
  assert.ok(r.start_sec >= 0);
});

test("addSubscribeReminder: invalid style returns error", async () => {
  const r = await addSubscribeReminder({ video: "/tmp/video.mp4", style: "popup" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_style");
});

// ---------- 5. addEndScreen ----------

test("addEndScreen: adds end screen with elements", async () => {
  const r = await addEndScreen({
    video: "/tmp/video.mp4",
    elements: [
      { type: "subscribe" },
      { type: "video", title: "Watch Next" },
    ],
  });
  assert.equal(r.ok, true);
  assert.equal(r.overlay_added, true);
  assert.equal(r.elements_count, 2);
  assert.equal(r.layout.rows, 1);
  assert.equal(r.layout.cols, 2);
  assert.equal(r.elements[0].type, "subscribe");
  assert.equal(r.elements[1].type, "video");
  assert.ok(r.elements[0].position);
});

test("addEndScreen: more than 4 elements returns error", async () => {
  const r = await addEndScreen({
    video: "/tmp/video.mp4",
    elements: [{ type: "subscribe" }, { type: "video" }, { type: "playlist" }, { type: "channel" }, { type: "link" }],
  });
  assert.equal(r.ok, false);
  assert.equal(r.error, "max_4_elements");
});

test("addEndScreen: invalid element type returns error", async () => {
  const r = await addEndScreen({
    video: "/tmp/video.mp4",
    elements: [{ type: "donate" }],
  });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_element_types");
  assert.deepEqual(r.invalid, ["donate"]);
});

// ---------- 6. addInfoCards ----------

test("addInfoCards: adds cards sorted by time", async () => {
  const r = await addInfoCards({
    video: "/tmp/video.mp4",
    cards: [
      { time_sec: 30, title: "Tip #1", url: "https://example.com/1", type: "link" },
      { time_sec: 10, title: "Tip #0", url: "https://example.com/0", type: "video" },
    ],
  });
  assert.equal(r.ok, true);
  assert.equal(r.total_count, 2);
  assert.equal(r.cards_added[0].time, 10);
  assert.equal(r.cards_added[1].time, 30);
  assert.equal(r.cards_added[0].title, "Tip #0");
});

test("addInfoCards: cards too close together get shifted", async () => {
  const r = await addInfoCards({
    video: "/tmp/video.mp4",
    cards: [
      { time_sec: 10, title: "A" },
      { time_sec: 12, title: "B" },
    ],
  });
  assert.equal(r.ok, true);
  assert.ok(r.cards_added[1].time >= r.cards_added[0].time + 10, "cards should be at least 10s apart");
});

test("addInfoCards: more than 5 cards returns error", async () => {
  const cards = Array.from({ length: 6 }, (_, i) => ({ time_sec: i * 10, title: `Card ${i}` }));
  const r = await addInfoCards({ video: "/tmp/video.mp4", cards });
  assert.equal(r.ok, false);
  assert.equal(r.error, "max_5_cards");
});

// ---------- 7. addProgressBar ----------

test("addProgressBar: adds minimal progress bar", async () => {
  const r = await addProgressBar({ video: "/tmp/video.mp4" });
  assert.equal(r.ok, true);
  assert.equal(r.overlay_added, true);
  assert.equal(r.style, "minimal");
  assert.equal(r.color, "#ff0000");
  assert.ok(r.height > 0);
  assert.ok(r.ffmpeg_filter);
});

test("addProgressBar: gradient style uses different color", async () => {
  const r = await addProgressBar({ video: "/tmp/video.mp4", style: "gradient" });
  assert.equal(r.ok, true);
  assert.ok(r.color.includes("gradient"));
  assert.equal(r.height, 6);
});

test("addProgressBar: custom color overrides default", async () => {
  const r = await addProgressBar({ video: "/tmp/video.mp4", color: "#00ff00" });
  assert.equal(r.ok, true);
  assert.equal(r.color, "#00ff00");
});

// ---------- 8. addViewCounter ----------

test("addViewCounter: adds counter at default position", async () => {
  const r = await addViewCounter({ video: "/tmp/video.mp4" });
  assert.equal(r.ok, true);
  assert.equal(r.overlay_added, true);
  assert.equal(r.start_count, 0);
  assert.equal(r.display_count, "0");
  assert.equal(r.position.name, "top-right");
  assert.ok(r.animation);
  assert.ok(r.next_milestone);
});

test("addViewCounter: formats large counts with K/M", async () => {
  const r = await addViewCounter({ video: "/tmp/video.mp4", start_count: 1500000 });
  assert.equal(r.ok, true);
  assert.equal(r.display_count, "1.5M");
  assert.equal(r.next_milestone, 15000000);
});

test("addViewCounter: invalid start_count returns error", async () => {
  const r = await addViewCounter({ video: "/tmp/video.mp4", start_count: -5 });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_start_count");
});

// ---------- 9. addLikeReminder ----------

test("addLikeReminder: adds heart-style like reminder", async () => {
  const r = await addLikeReminder({ video: "/tmp/video.mp4", style: "heart" });
  assert.equal(r.ok, true);
  assert.equal(r.overlay_added, true);
  assert.equal(r.style, "heart");
  assert.equal(r.animation, "heart_burst");
  assert.ok(r.duration_sec > 0);
  assert.ok(r.start_sec >= 0);
});

test("addLikeReminder: invalid style returns error", async () => {
  const r = await addLikeReminder({ video: "/tmp/video.mp4", style: "wave" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_style");
});

// ---------- 10. addCommentPrompt ----------

test("addCommentPrompt: adds prompt with default text", async () => {
  const r = await addCommentPrompt({ video: "/tmp/video.mp4" });
  assert.equal(r.ok, true);
  assert.equal(r.overlay_added, true);
  assert.equal(r.prompt_text, "Comment below!");
  assert.equal(r.position.name, "bottom-center");
  assert.ok(r.duration_sec > 0);
  assert.equal(r.animation, "fade_in_out");
});

test("addCommentPrompt: custom prompt text", async () => {
  const r = await addCommentPrompt({ video: "/tmp/video.mp4", prompt: "What do you think?" });
  assert.equal(r.ok, true);
  assert.equal(r.prompt_text, "What do you think?");
});

test("addCommentPrompt: empty prompt returns error", async () => {
  const r = await addCommentPrompt({ video: "/tmp/video.mp4", prompt: "" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "prompt_required");
});

// ---------- Cross-tool: ffmpeg filters present ----------

test("All overlay functions produce ffmpeg_filter or ffmpeg_filters", async () => {
  const logo = await addLogo({ video: "/tmp/v.mp4", logo: "/tmp/l.png" });
  assert.ok(logo.ffmpeg_filter);

  const wm = await addWatermark({ video: "/tmp/v.mp4", text: "test" });
  assert.ok(wm.ffmpeg_filter);

  const social = await addSocialIcons({ video: "/tmp/v.mp4", platforms: ["youtube"] });
  assert.ok(social.ffmpeg_filters);

  const sub = await addSubscribeReminder({ video: "/tmp/v.mp4" });
  assert.ok(sub.ffmpeg_filter);

  const end = await addEndScreen({ video: "/tmp/v.mp4", elements: [{ type: "subscribe" }] });
  assert.ok(end.ffmpeg_filters);

  const cards = await addInfoCards({ video: "/tmp/v.mp4", cards: [{ time_sec: 5, title: "T" }] });
  assert.ok(cards.cards_added);

  const bar = await addProgressBar({ video: "/tmp/v.mp4" });
  assert.ok(bar.ffmpeg_filter);

  const vc = await addViewCounter({ video: "/tmp/v.mp4" });
  assert.ok(vc.ffmpeg_filter);

  const like = await addLikeReminder({ video: "/tmp/v.mp4" });
  assert.ok(like.ffmpeg_filter);

  const cp = await addCommentPrompt({ video: "/tmp/v.mp4" });
  assert.ok(cp.ffmpeg_filter);
});
