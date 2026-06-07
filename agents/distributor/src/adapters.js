// Vireo Distributor — multi-platform publishing orchestrator.
//
// Takes an EditPlan + StyleDNA, adapts the content for each target platform
// (with platform-native formatting), schedules it, and (mock-)publishes it.
//
// All adapters are local — no real platform API calls. The interface is
// stable so swapping in real OAuth-based publishers later is a drop-in.

import { PLATFORMS, PLATFORM_SPECS, newPublishJob, nowIso, newId } from "@vireo/shared";

// ---------------------------------------------------------------------------
// Platform adapters
// ---------------------------------------------------------------------------
//
// Each adapter exposes:
//   adapt(content, styleDna, editPlan) -> AdaptedContent
//   publish(adapted, opts) -> Promise<{platform_post_id, status}>
//
// AdaptedContent = {
//   platform,
//   title,
//   caption,
//   hashtags,
//   mentions,
//   media: [{type, url, alt?}],
//   metadata,
// }

const BASE_HASHTAGS = ["vireo", "creator"];

const stopWords = new Set([
  "the", "a", "an", "and", "or", "but", "is", "are", "was", "were", "be",
  "been", "being", "have", "has", "had", "do", "does", "did", "will",
  "would", "could", "should", "may", "might", "must", "shall", "can",
  "this", "that", "these", "those", "i", "you", "he", "she", "it", "we",
  "they", "what", "which", "who", "whom", "whose", "if", "in", "on", "at",
  "by", "for", "with", "about", "against", "between", "into", "through",
  "during", "before", "after", "above", "below", "to", "from", "up", "down",
  "out", "off", "over", "under", "again", "further", "then", "once",
  "of", "as", "until", "while", "than", "so", "such", "no", "nor", "not",
  "only", "own", "same", "too", "very", "just", "s", "t", "m", "re", "ve",
  "ll", "d", "don", "now", "ain", "aren", "couldn", "didn", "doesn",
  "hadn", "hasn", "haven", "isn", "mightn", "mustn", "needn", "shan",
  "shouldn", "wasn", "weren", "won", "wouldn",
]);

function extractKeywords(text, n = 5) {
  const words = (text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w && w.length > 2 && !stopWords.has(w));
  const counts = new Map();
  for (const w of words) counts.set(w, (counts.get(w) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([w]) => w);
}

function buildTitleFromCuts(editPlan, styleDna) {
  if (!editPlan?.cuts?.length) return "Untitled";
  const hook = editPlan.cuts.find((c) => c.role === "hook") || editPlan.cuts[0];
  const close = editPlan.cuts.find((c) => c.role === "close") || editPlan.cuts[editPlan.cuts.length - 1];
  // Use the hook text, capitalized + trimmed
  const base = (hook.text || "").trim();
  const cap = base.length > 0 ? base[0].toUpperCase() + base.slice(1) : "Untitled";
  const tone = styleDna?.tone || "neutral";
  if (tone === "energetic" && !cap.includes("!")) return `${cap.replace(/[.!?]+$/, "")}!`;
  if (tone === "professional") return cap.replace(/[.!?]+$/, "");
  return cap;
}

function buildCaptionFromCuts(editPlan) {
  return (editPlan?.cuts || []).map((c) => c.text).join(" ").trim();
}

function platformHashtags(platform, styleDna) {
  const topicTags = (styleDna?.topics || []).slice(0, 3).map((t) =>
    t.toLowerCase().replace(/[^a-z0-9а-яё]/gi, "")
  ).filter(Boolean);
  const platformTag = {
    youtube: "youtube",
    youtube_shorts: "shorts",
    instagram_reels: "reels",
    tiktok: "fyp",
    x: "x",
    linkedin: "linkedin",
    threads: "threads",
    telegram: "telegram",
    substack: "newsletter",
    podcast: "podcast",
  }[platform] || "";
  return [...new Set([...topicTags, platformTag, ...BASE_HASHTAGS])].filter(Boolean);
}

function truncateToChars(s, n) {
  if (!s) return "";
  if (s.length <= n) return s;
  // Try to end on a word boundary
  const cut = s.slice(0, n - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > n * 0.6 ? cut.slice(0, lastSpace) : cut) + "…";
}

function fitToSpec(text, platform) {
  const spec = PLATFORM_SPECS[platform];
  if (!spec) return text;
  if (spec.max_chars && text.length > spec.max_chars) {
    return truncateToChars(text, spec.max_chars);
  }
  if (spec.min_chars && text.length < spec.min_chars) {
    return text; // can't easily pad — let downstream decide
  }
  return text;
}

// ---- per-platform adapters ----

const adapters = {
  youtube(editPlan, styleDna) {
    const title = buildTitleFromCuts(editPlan, styleDna);
    const description = buildCaptionFromCuts(editPlan);
    return {
      platform: "youtube",
      title: truncateToChars(title, 100),
      caption: truncateToChars(description, 5000),
      hashtags: platformHashtags("youtube", styleDna).map((t) => `#${t}`),
      media: [{ type: "video", url: "s3://vireo/output.mp4" }],
      metadata: {
        ratio: "16:9",
        duration_sec: editPlan?.output_duration_sec || 0,
        category: "22", // People & Blogs
      },
    };
  },

  youtube_shorts(editPlan, styleDna) {
    const title = buildTitleFromCuts(editPlan, styleDna);
    const caption = buildCaptionFromCuts(editPlan);
    return {
      platform: "youtube_shorts",
      title: truncateToChars(title, 100),
      caption: truncateToChars(caption, 100),
      hashtags: platformHashtags("youtube_shorts", styleDna).map((t) => `#${t}`),
      media: [{ type: "video", url: "s3://vireo/output_shorts.mp4" }],
      metadata: {
        ratio: "9:16",
        duration_sec: Math.min(60, editPlan?.output_duration_sec || 0),
      },
    };
  },

  instagram_reels(editPlan, styleDna) {
    const title = buildTitleFromCuts(editPlan, styleDna);
    const caption = buildCaptionFromCuts(editPlan);
    return {
      platform: "instagram_reels",
      title: truncateToChars(title, 100),
      caption: truncateToChars(caption, 2200),
      hashtags: platformHashtags("instagram_reels", styleDna).map((t) => `#${t}`),
      media: [{ type: "video", url: "s3://vireo/output_reel.mp4" }],
      metadata: {
        ratio: "9:16",
        duration_sec: Math.min(90, editPlan?.output_duration_sec || 0),
        cover_url: "s3://vireo/cover.jpg",
      },
    };
  },

  tiktok(editPlan, styleDna) {
    const caption = buildCaptionFromCuts(editPlan);
    return {
      platform: "tiktok",
      title: truncateToChars(buildTitleFromCuts(editPlan, styleDna), 100),
      caption: truncateToChars(caption, 2200),
      hashtags: platformHashtags("tiktok", styleDna).map((t) => `#${t}`),
      media: [{ type: "video", url: "s3://vireo/output_tiktok.mp4" }],
      metadata: {
        ratio: "9:16",
        duration_sec: Math.min(600, editPlan?.output_duration_sec || 0),
      },
    };
  },

  x(editPlan, styleDna) {
    const caption = buildCaptionFromCuts(editPlan);
    // X is the tightest text constraint — be aggressive
    const tweet = fitToSpec(caption, "x");
    return {
      platform: "x",
      title: "",
      caption: tweet,
      hashtags: platformHashtags("x", styleDna).map((t) => `#${t}`).slice(0, 3),
      media: [{ type: "video", url: "s3://vireo/output_x.mp4" }],
      metadata: { max_chars: 280, tone: styleDna?.tone },
    };
  },

  linkedin(editPlan, styleDna) {
    const caption = buildCaptionFromCuts(editPlan);
    // LinkedIn loves long-form, structure, and insight
    let body = caption;
    if (styleDna?.tone === "professional") {
      // Add a hook line + line breaks
      const topic = styleDna?.topics?.[0] || "this";
      body = `Quick thought on ${topic}:\n\n${caption}\n\nWhat has been your experience?`;
    }
    return {
      platform: "linkedin",
      title: "",
      caption: truncateToChars(body, 3000),
      hashtags: platformHashtags("linkedin", styleDna).map((t) => `#${t}`).slice(0, 5),
      media: [{ type: "video", url: "s3://vireo/output_li.mp4" }],
      metadata: { tone: styleDna?.tone },
    };
  },

  threads(editPlan, styleDna) {
    const caption = buildCaptionFromCuts(editPlan);
    return {
      platform: "threads",
      title: "",
      caption: truncateToChars(caption, 500),
      hashtags: platformHashtags("threads", styleDna).map((t) => `#${t}`).slice(0, 3),
      media: [],
      metadata: { tone: styleDna?.tone },
    };
  },

  telegram(editPlan, styleDna) {
    const caption = buildCaptionFromCuts(editPlan);
    return {
      platform: "telegram",
      title: buildTitleFromCuts(editPlan, styleDna),
      caption: truncateToChars(caption, 4096),
      hashtags: [],
      media: [{ type: "video", url: "s3://vireo/output.mp4" }],
      metadata: { preview: true, tone: styleDna?.tone },
    };
  },

  substack(editPlan, styleDna) {
    const caption = buildCaptionFromCuts(editPlan);
    return {
      platform: "substack",
      title: buildTitleFromCuts(editPlan, styleDna),
      caption: caption, // longform — no truncation
      hashtags: [],
      media: [],
      metadata: { format: "newsletter", tone: styleDna?.tone },
    };
  },

  podcast(editPlan, styleDna) {
    return {
      platform: "podcast",
      title: buildTitleFromCuts(editPlan, styleDna),
      caption: buildCaptionFromCuts(editPlan),
      hashtags: platformHashtags("podcast", styleDna).map((t) => `#${t}`),
      media: [{ type: "audio", url: "s3://vireo/output.mp3" }],
      metadata: { format: "audio" },
    };
  },
};

export function adaptToPlatform(platform, editPlan, styleDna) {
  const fn = adapters[platform];
  if (!fn) {
    throw new Error(`No adapter for platform: ${platform}`);
  }
  return fn(editPlan, styleDna);
}

export function adaptToAllPlatforms(editPlan, styleDna, platforms = PLATFORMS) {
  return platforms.map((p) => adaptToPlatform(p, editPlan, styleDna));
}

export const PLATFORM_ADAPTERS = adapters;
