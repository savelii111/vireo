"""Per-platform export presets for the Vireo video editor.

Each preset tells the cutter/reframer/exporter exactly:
  - target aspect ratio (and width x height for output)
  - max duration in seconds (None = no cap)
  - video codec, bitrate, pixel format
  - audio codec, bitrate
  - fps (24 default; some platforms prefer 30)
  - extra ffmpeg args (e.g. movflags for faststart on MP4)

When a platform doesn't appear here, we use the "default" preset.
"""

from __future__ import annotations
from dataclasses import dataclass, field, asdict
from typing import Optional


@dataclass
class Preset:
  platform: str
  aspect: str  # "16:9", "9:16", "1:1", "4:5"
  width: int
  height: int
  fps: int = 30
  max_duration_sec: Optional[float] = None
  video_codec: str = "libx264"
  video_bitrate: str = "5000k"
  audio_codec: str = "aac"
  audio_bitrate: str = "128k"
  pix_fmt: str = "yuv420p"
  extra_args: list[str] = field(default_factory=list)
  notes: str = ""

  def to_ffmpeg_args(self) -> list[str]:
    """Return ffmpeg -args for encoding to this preset."""
    args = [
      "-c:v", self.video_codec,
      "-b:v", self.video_bitrate,
      "-pix_fmt", self.pix_fmt,
      "-r", str(self.fps),
      "-c:a", self.audio_codec,
      "-b:a", self.audio_bitrate,
      "-movflags", "+faststart",  # web-streamable MP4
    ]
    args.extend(self.extra_args)
    return args

  def to_dict(self) -> dict:
    return asdict(self)


# YouTube long-form: 16:9, up to 12 hours, high bitrate.
YOUTUBE = Preset(
  platform="youtube",
  aspect="16:9", width=1920, height=1080, fps=30,
  max_duration_sec=12 * 3600,
  video_bitrate="8000k", audio_bitrate="192k",
  notes="Long-form. Use 8Mbps for 1080p30.",
)

# YouTube Shorts: 9:16, capped at 60s, vertical.
YOUTUBE_SHORTS = Preset(
  platform="youtube_shorts",
  aspect="9:16", width=1080, height=1920, fps=30,
  max_duration_sec=60,
  video_bitrate="6000k", audio_bitrate="192k",
  notes="Vertical short. Cap at 60s.",
)

# TikTok: 9:16, capped at 10 minutes (10 min for ads; shorter organic).
TIKTOK = Preset(
  platform="tiktok",
  aspect="9:16", width=1080, height=1920, fps=30,
  max_duration_sec=10 * 60,
  video_bitrate="6000k", audio_bitrate="192k",
  notes="Vertical. 10 min cap (shorter for organic reach).",
)

# Instagram Reels: 9:16, 90s cap, vertical.
INSTAGRAM_REELS = Preset(
  platform="instagram_reels",
  aspect="9:16", width=1080, height=1920, fps=30,
  max_duration_sec=90,
  video_bitrate="5500k", audio_bitrate="160k",
  notes="90s cap for organic reels.",
)

# Instagram Feed (square): 1:1, 60s.
INSTAGRAM_FEED = Preset(
  platform="instagram",
  aspect="1:1", width=1080, height=1080, fps=30,
  max_duration_sec=60,
  video_bitrate="5000k", audio_bitrate="160k",
  notes="Square feed video. 60s cap.",
)

# X (Twitter): 16:9 or 1:1, 140s cap. We use 16:9.
X = Preset(
  platform="x",
  aspect="16:9", width=1280, height=720, fps=30,
  max_duration_sec=140,
  video_bitrate="5000k", audio_bitrate="128k",
  notes="X video. 140s cap.",
)

# LinkedIn: 16:9, 10 min.
LINKEDIN = Preset(
  platform="linkedin",
  aspect="16:9", width=1920, height=1080, fps=30,
  max_duration_sec=10 * 60,
  video_bitrate="5000k", audio_bitrate="192k",
  notes="Professional tone. 10 min cap.",
)

# Threads: 9:16 or 1:1, 5 min. We use 9:16 to match the rest of vertical.
THREADS = Preset(
  platform="threads",
  aspect="9:16", width=1080, height=1920, fps=30,
  max_duration_sec=5 * 60,
  video_bitrate="5000k", audio_bitrate="128k",
  notes="Threads video. 5 min cap.",
)

# Telegram: 16:9, no cap.
TELEGRAM = Preset(
  platform="telegram",
  aspect="16:9", width=1280, height=720, fps=30,
  max_duration_sec=None,
  video_bitrate="5000k", audio_bitrate="128k",
  notes="Telegram. No cap (but use sensible size).",
)

# Substack: 16:9, 15 min.
SUBSTACK = Preset(
  platform="substack",
  aspect="16:9", width=1920, height=1080, fps=30,
  max_duration_sec=15 * 60,
  video_bitrate="6000k", audio_bitrate="192k",
  notes="Long-form Substack post. 15 min cap.",
)

# Podcast: audio-only export with static cover image.
PODCAST = Preset(
  platform="podcast",
  aspect="1:1", width=1080, height=1080, fps=1,
  max_duration_sec=None,
  video_codec="mjpeg", video_bitrate="2000k",
  audio_codec="aac", audio_bitrate="192k",
  pix_fmt="yuv420p",
  notes="Static-image video wrapper for audio podcast. 1 fps is fine.",
)

PRESETS: dict[str, Preset] = {
  "youtube": YOUTUBE,
  "youtube_shorts": YOUTUBE_SHORTS,
  "tiktok": TIKTOK,
  "instagram_reels": INSTAGRAM_REELS,
  "instagram": INSTAGRAM_FEED,
  "x": X,
  "linkedin": LINKEDIN,
  "threads": THREADS,
  "telegram": TELEGRAM,
  "substack": SUBSTACK,
  "podcast": PODCAST,
}

DEFAULT = YOUTUBE  # safe fallback for unknown platforms


def get_preset(platform: str) -> Preset:
  """Return the preset for a platform, or DEFAULT if unknown."""
  return PRESETS.get(platform, DEFAULT)


def list_platforms() -> list[str]:
  return list(PRESETS.keys())


def parse_aspect(aspect: str) -> tuple[int, int]:
  """Parse '16:9' to (16, 9). Raises ValueError on bad input."""
  try:
    a, b = aspect.split(":")
    return int(a), int(b)
  except (ValueError, AttributeError) as e:
    raise ValueError(f"invalid aspect ratio: {aspect!r}") from e


def aspect_decimal(aspect: str) -> float:
  a, b = parse_aspect(aspect)
  return a / b
