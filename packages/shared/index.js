// Vireo — shared types and protocols for Node.js agents.
export const newId = () => Math.random().toString(36).slice(2, 14);
export const nowIso = () => new Date().toISOString();

export const newStyleDNA = (userId) => ({
  user_id: userId,
  tone: "neutral",
  pacing: "medium",
  vocabulary_level: "conversational",
  humor_style: "subtle",
  hook_patterns: [],
  cta_patterns: [],
  color_palette: [],
  music_genres: [],
  avg_content_length_sec: 60,
  topics: [],
  confidence: 0,
  sample_count: 0,
  created_at: nowIso(),
  updated_at: nowIso(),
});

export const newPublishJob = ({ contentId = "", platform = "", scheduledAt = "" } = {}) => ({
  id: newId(),
  content_id: contentId,
  platform,
  scheduled_at: scheduledAt,
  published_at: "",
  status: "pending",
  platform_post_id: "",
  error: "",
  metadata: {},
});

export const newMetricSnapshot = ({ contentId = "", platform = "" } = {}) => ({
  content_id: contentId,
  platform,
  views: 0,
  likes: 0,
  comments: 0,
  shares: 0,
  saves: 0,
  watch_time_sec: 0,
  engagement_rate: 0,
  captured_at: nowIso(),
});

export const PLATFORMS = [
  "youtube",
  "youtube_shorts",
  "instagram_reels",
  "tiktok",
  "x",
  "linkedin",
  "threads",
  "telegram",
  "substack",
  "podcast",
];

export const PLATFORM_SPECS = {
  youtube: { ratio: "16:9", max_sec: 900, min_sec: 60, hook_window_sec: 15 },
  youtube_shorts: { ratio: "9:16", max_sec: 60, min_sec: 15, hook_window_sec: 3 },
  instagram_reels: { ratio: "9:16", max_sec: 90, min_sec: 3, hook_window_sec: 3 },
  tiktok: { ratio: "9:16", max_sec: 600, min_sec: 5, hook_window_sec: 3 },
  x: { ratio: "text", max_chars: 280, min_chars: 10, hook_window_chars: 80 },
  linkedin: { ratio: "text", max_chars: 3000, min_chars: 100, hook_window_chars: 210 },
  threads: { ratio: "text", max_chars: 500, min_chars: 10, hook_window_chars: 80 },
  telegram: { ratio: "text", max_chars: 4096, min_chars: 10, hook_window_chars: 100 },
  substack: { ratio: "longform", max_chars: 100000, min_chars: 500, hook_window_chars: 200 },
  podcast: { ratio: "audio", max_sec: 7200, min_sec: 600, hook_window_sec: 30 },
};
