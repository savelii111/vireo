"""Style DNA — aggregate features from one or more reference videos.

This is the "creator's style" that Vireo can learn and re-apply.

Workflow:
  1. User uploads 1+ of their past videos
  2. Vireo analyzes each (visual + audio + transcript features)
  3. Aggregates into a single StyleProfile (median, mode, range)
  4. When editing a new video, StyleProfile is injected into the pipeline
  5. Pipeline applies: matching color look, similar pacing, similar zoom frequency

A StyleProfile can be:
  - BUILT from a single video
  - MERGED from multiple videos (averages their features)
  - SAVED as JSON (so the user can reuse it for future edits)
  - LOADED from JSON

Key features tracked:
  - Visual: brightness, saturation, contrast, temperature, look recommendation
  - Editing: cuts per minute, avg shot length
  - Audio: mean volume, music presence, silence ratio, WPM
  - Zoom: emphasis moments per minute (from transcript)
  - Subtitle: style preference (user-set; can be inferred)
  - Hooks: opening style (from first 5 sec analysis — see hooks_style.py)
"""

from __future__ import annotations
import json
import statistics
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Optional

from .style_analyzer import VisualStyle, analyze_visual
from .audio_analyzer import AudioStyle, analyze_audio
from .transcriber import Transcript


@dataclass
class StyleProfile:
  """The aggregated style of a creator, learned from past videos."""
  name: str = "default"
  description: str = ""
  num_reference_videos: int = 0
  # Visual
  brightness: float = 0.5           # 0-1
  saturation: float = 0.5           # 0-1
  contrast: float = 0.5             # 0-1
  temperature: float = 0.0          # -1..1
  recommended_look: str = "natural"
  look_confidence: float = 0.5
  dominant_colors: list[str] = field(default_factory=list)
  # Editing
  cuts_per_minute: float = 2.0
  avg_shot_length_sec: float = 30.0
  # Audio
  mean_volume_db: float = -20.0
  music_likely: bool = False
  silence_ratio: float = 0.0
  words_per_minute: float = 120.0
  # Zoom (from emphasis detection)
  emphasis_per_minute: float = 2.0
  zoom_max: float = 1.25
  # Subtitles
  subtitle_style: str = "default"
  # Sub-style preferences (will be filled in as more features land)
  preferences: dict = field(default_factory=dict)
  # Confidence in the profile (based on number of videos, consistency)
  confidence: float = 0.5

  def to_dict(self) -> dict:
    return asdict(self)


def profile_from_video(
  video_path: str,
  *,
  transcript: Transcript | None = None,
  name: str = "",
  ffmpeg: str | None = None,
) -> StyleProfile:
  """Build a StyleProfile from a single video.

  1. Run visual analysis
  2. Run audio analysis (uses transcript for WPM if available)
  3. Combine into a StyleProfile
  """
  visual = analyze_visual(video_path, ffmpeg=ffmpeg)
  word_count = sum(len(s.words) for s in transcript.segments) if transcript else 0
  audio = analyze_audio(video_path, transcript_words=word_count, ffmpeg=ffmpeg)
  return _profile_from_visual_audio(visual, audio, num_videos=1, name=name)


def profile_from_videos(
  video_paths: list[str],
  *,
  transcripts: dict[str, Transcript] | None = None,
  name: str = "",
  ffmpeg: str | None = None,
) -> StyleProfile:
  """Build a StyleProfile from multiple videos, averaging their features."""
  if not video_paths:
    return StyleProfile(name=name or "empty")
  profiles: list[StyleProfile] = []
  for p in video_paths:
    t = transcripts.get(p) if transcripts else None
    profiles.append(profile_from_video(p, transcript=t, ffmpeg=ffmpeg))
  return merge_profiles(profiles, name=name)


def merge_profiles(profiles: list[StyleProfile], *, name: str = "") -> StyleProfile:
  """Merge multiple StyleProfiles into one by averaging.

  For continuous values: median (more robust to outliers than mean).
  For categorical (look): mode (most common).
  For booleans: majority vote.
  """
  if not profiles:
    return StyleProfile(name=name or "merged")
  if len(profiles) == 1:
    p = profiles[0]
    if name:
      p.name = name
    return p

  def med(attr: str) -> float:
    vals = [getattr(p, attr) for p in profiles]
    return float(statistics.median(vals))

  def mode_look() -> tuple[str, float]:
    from collections import Counter
    counts = Counter(p.recommended_look for p in profiles)
    name, count = counts.most_common(1)[0]
    return name, count / len(profiles)

  # Collect all dominant colors
  all_colors: list[str] = []
  for p in profiles:
    all_colors.extend(p.dominant_colors)
  # Top 5 by frequency
  from collections import Counter
  color_counter = Counter(all_colors)
  top_colors = [c for c, _ in color_counter.most_common(5)]

  look, look_conf = mode_look()
  music_votes = sum(1 for p in profiles if p.music_likely)
  music_likely = music_votes > len(profiles) / 2

  # Confidence scales with number of videos (caps at 5)
  confidence = min(0.95, 0.3 + 0.13 * len(profiles))

  return StyleProfile(
    name=name or "merged",
    num_reference_videos=len(profiles),
    brightness=med("brightness"),
    saturation=med("saturation"),
    contrast=med("contrast"),
    temperature=med("temperature"),
    recommended_look=look,
    look_confidence=look_conf,
    dominant_colors=top_colors,
    cuts_per_minute=med("cuts_per_minute"),
    avg_shot_length_sec=med("avg_shot_length_sec"),
    mean_volume_db=med("mean_volume_db"),
    music_likely=music_likely,
    silence_ratio=med("silence_ratio"),
    words_per_minute=med("words_per_minute"),
    emphasis_per_minute=med("emphasis_per_minute"),
    zoom_max=med("zoom_max"),
    subtitle_style=profiles[0].subtitle_style,
    confidence=confidence,
  )


def _profile_from_visual_audio(
  visual: VisualStyle, audio: AudioStyle, *, num_videos: int = 1, name: str = ""
) -> StyleProfile:
  """Build a profile from already-analyzed visual + audio style."""
  # Estimate emphasis_per_minute from cuts_per_minute and WPM
  # (more cuts + more words = more dynamic content = more zooms likely)
  emphasis_per_min = min(8.0, max(1.0, visual.cuts_per_minute * 1.2))

  return StyleProfile(
    name=name,
    num_reference_videos=num_videos,
    brightness=visual.brightness,
    saturation=visual.saturation,
    contrast=visual.contrast,
    temperature=visual.temperature,
    recommended_look=visual.recommended_look,
    look_confidence=visual.confidence,
    dominant_colors=visual.dominant_colors,
    cuts_per_minute=visual.cuts_per_minute,
    avg_shot_length_sec=visual.avg_shot_length_sec,
    mean_volume_db=audio.mean_volume_db,
    music_likely=audio.music_likely,
    silence_ratio=audio.silence_ratio,
    words_per_minute=audio.words_per_minute or 120.0,
    emphasis_per_minute=emphasis_per_min,
    zoom_max=1.20 + (visual.contrast * 0.2),  # higher contrast = more zoom ok
    confidence=0.3 if num_videos == 1 else 0.5 + 0.1 * num_videos,
  )


# ---------- save/load ----------

def save_profile(profile: StyleProfile, output_path: str) -> str:
  """Save a StyleProfile to a JSON file."""
  Path(output_path).parent.mkdir(parents=True, exist_ok=True)
  with open(output_path, "w", encoding="utf-8") as f:
    json.dump(profile.to_dict(), f, indent=2, ensure_ascii=False)
  return output_path


def load_profile(input_path: str) -> StyleProfile:
  """Load a StyleProfile from a JSON file."""
  with open(input_path, "r", encoding="utf-8") as f:
    data = json.load(f)
  return StyleProfile(**data)


def profile_to_summary(profile: StyleProfile) -> str:
  """Human-readable summary for dashboards / API responses."""
  return (
    f"Style '{profile.name}': "
    f"look={profile.recommended_look} (confidence {profile.look_confidence:.0%}), "
    f"brightness={profile.brightness:.2f}, "
    f"saturation={profile.saturation:.2f}, "
    f"contrast={profile.contrast:.2f}, "
    f"temperature={'warm' if profile.temperature > 0.1 else 'cool' if profile.temperature < -0.1 else 'neutral'}, "
    f"{profile.cuts_per_minute:.1f} cuts/min, "
    f"{profile.words_per_minute:.0f} WPM, "
    f"music={profile.music_likely}, "
    f"based on {profile.num_reference_videos} video(s)"
  )
