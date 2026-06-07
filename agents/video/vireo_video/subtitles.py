"""Subtitle generation: SRT/ASS format + burn-in with FFmpeg drawtext.

Two outputs:
  - to_srt() — write SubRip subtitle file
  - burn_in() — embed subtitles into the video using drawtext

Subtitle styling is platform-aware:
  - YouTube: bottom-center, white with black outline, large
  - TikTok: middle, bold, colored (creator style)
  - LinkedIn: bottom, smaller, professional
  - Podcast: bottom, no background, simple

Word-level vs segment-level:
  - Word-level: each word is its own subtitle line (TikTok/Reels style)
  - Segment-level: each Whisper segment is one line (cleaner for long-form)
"""

from __future__ import annotations
import os
import re
import tempfile
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Optional

from .ffmpeg_utils import find_ffmpeg, run, escape_drawtext, FFmpegError
from .transcriber import Transcript, Word, Segment


# Style presets (font, size, color, position)
SUBTITLE_STYLES = {
  "default": {
    "font": "Arial",
    "font_size": 24,
    "primary_color": "white",     # ffmpeg color name or 0xRRGGBB
    "outline_color": "black",
    "outline_width": 2,
    "box_color": "black@0.5",     # semi-transparent background
    "box_border": 8,
    "position": "bottom",         # "bottom" | "middle" | "top"
    "margin_v": 60,               # vertical margin from edge
    "bold": False,
  },
  "youtube_shorts": {
    "font": "Impact",
    "font_size": 32,
    "primary_color": "white",
    "outline_color": "black",
    "outline_width": 4,
    "box_color": "black@0.4",
    "box_border": 12,
    "position": "middle",
    "margin_v": 200,
    "bold": True,
  },
  "tiktok": {
    "font": "Impact",
    "font_size": 30,
    "primary_color": "0xFFFF00",  # yellow
    "outline_color": "black",
    "outline_width": 4,
    "box_color": "black@0.0",     # no background
    "box_border": 0,
    "position": "middle",
    "margin_v": 250,
    "bold": True,
  },
  "youtube": {
    "font": "Arial",
    "font_size": 22,
    "primary_color": "white",
    "outline_color": "black",
    "outline_width": 2,
    "box_color": "black@0.5",
    "box_border": 6,
    "position": "bottom",
    "margin_v": 40,
    "bold": False,
  },
  "linkedin": {
    "font": "Arial",
    "font_size": 20,
    "primary_color": "white",
    "outline_color": "0x202020",
    "outline_width": 1,
    "box_color": "black@0.6",
    "box_border": 4,
    "position": "bottom",
    "margin_v": 30,
    "bold": False,
  },
  "podcast": {
    "font": "Arial",
    "font_size": 18,
    "primary_color": "white",
    "outline_color": "black",
    "outline_width": 1,
    "box_color": "black@0.0",
    "box_border": 0,
    "position": "bottom",
    "margin_v": 20,
    "bold": False,
  },
}


def _format_srt_time(t: float) -> str:
  """Convert seconds to SRT timestamp HH:MM:SS,mmm."""
  if t < 0:
    t = 0.0
  hours = int(t // 3600)
  minutes = int((t % 3600) // 60)
  seconds = t - hours * 3600 - minutes * 60
  return f"{hours:02d}:{minutes:02d}:{seconds:06.3f}".replace(".", ",")


@dataclass
class SubtitleCue:
  index: int
  start: float
  end: float
  text: str

  @property
  def duration(self) -> float:
    return self.end - self.start

  def to_srt(self) -> str:
    return f"{self.index}\n{_format_srt_time(self.start)} --> {_format_srt_time(self.end)}\n{self.text}\n"

  def to_dict(self) -> dict:
    return asdict(self)


def transcript_to_cues(
  transcript: Transcript,
  *,
  words_per_cue: int = 7,
  max_cue_duration: float = 3.0,
  min_cue_duration: float = 0.8,
) -> list[SubtitleCue]:
  """Convert a transcript into subtitle cues.

  Groups words into cues of N words each. Tries to keep cue duration
  reasonable; splits aggressively if a word group would be too long.
  """
  all_words: list[Word] = []
  for seg in transcript.segments:
    if seg.words:
      all_words.extend(seg.words)
    elif seg.text:
      # No word-level timestamps — synthesize one word per segment
      # Distribute time evenly
      dur = seg.end - seg.start
      ws = seg.text.split()
      if not ws:
        continue
      for i, w in enumerate(ws):
        w_start = seg.start + (dur * i / len(ws))
        w_end = seg.start + (dur * (i + 1) / len(ws))
        all_words.append(Word(text=w, start=w_start, end=w_end))

  cues: list[SubtitleCue] = []
  if not all_words:
    return cues

  i = 0
  while i < len(all_words):
    # Take a chunk of N words, but break if duration exceeds max
    chunk = all_words[i:i + words_per_cue]
    if not chunk:
      break
    chunk_start = chunk[0].start
    chunk_end = chunk[-1].end
    chunk_duration = chunk_end - chunk_start

    if chunk_duration > max_cue_duration and len(chunk) > 2:
      # Split the chunk roughly in half
      mid = len(chunk) // 2
      left = chunk[:mid]
      right = chunk[mid:]
      # Emit left
      text = " ".join(w.text for w in left)
      cues.append(SubtitleCue(
        index=len(cues) + 1,
        start=left[0].start,
        end=left[-1].end,
        text=text,
      ))
      # Re-process right by pushing i back so we add it on next iteration
      # Easier: recurse for right
      right_text = " ".join(w.text for w in right)
      cues.append(SubtitleCue(
        index=len(cues) + 1,
        start=right[0].start,
        end=right[-1].end,
        text=right_text,
      ))
      i += len(chunk)
    else:
      text = " ".join(w.text for w in chunk)
      # Extend to min_cue_duration if too short
      end = max(chunk_end, chunk_start + min_cue_duration)
      cues.append(SubtitleCue(
        index=len(cues) + 1,
        start=chunk_start,
        end=end,
        text=text,
      ))
      i += len(chunk)

  return cues


def write_srt(cues: list[SubtitleCue], output_path: str) -> str:
  """Write cues to a SubRip .srt file."""
  Path(output_path).parent.mkdir(parents=True, exist_ok=True)
  content = "\n".join(c.to_srt() for c in cues)
  # SRT files should end with a newline
  if not content.endswith("\n"):
    content += "\n"
  with open(output_path, "w", encoding="utf-8") as f:
    f.write(content)
  return output_path


def _build_drawtext_filter(
  text: str,
  start: float,
  end: float,
  video_width: int,
  video_height: int,
  style: dict,
  *,
  font_dir: str = "C:/Windows/Fonts",
) -> str:
  """Build a single ffmpeg drawtext filter invocation with enable=between(t,..)."""
  # ffmpeg drawtext needs an actual font file on Windows
  font_path = os.path.join(font_dir, f"{style['font']}.ttf")
  if not os.path.isfile(font_path):
    # Try uppercase
    font_path = os.path.join(font_dir, f"{style['font'].upper()}.ttf")
  if not os.path.isfile(font_path):
    # Fallback to arial (always present on Windows)
    font_path = "C:/Windows/Fonts/arial.ttf"
  # Windows path with single-quote wrapping for the filter
  safe_path = font_path.replace("\\", "/").replace(":", "\\:").replace("'", "\\'")
  safe_text = escape_drawtext(text)

  # Position
  if style["position"] == "middle":
    y_expr = f"(h-text_h)/2"
  elif style["position"] == "top":
    y_expr = f"{style['margin_v']}"
  else:  # bottom
    y_expr = f"h-text_h-{style['margin_v']}"

  x_expr = "(w-text_w)/2"  # centered

  # Build filter
  parts = [
    f"text='{safe_text}'",
    f"fontfile='{safe_path}'",
    f"fontsize={style['font_size']}",
    f"fontcolor={style['primary_color']}",
    f"x={x_expr}",
    f"y={y_expr}",
  ]
  if style.get("bold"):
    # ffmpeg drawtext doesn't have a 'bold' option — bold must come from
    # the font file itself (e.g. arialbd.ttf). We use the bold variant if
    # available, otherwise fall back to the regular font.
    bold_path = font_path.replace(".ttf", "bd.ttf") if font_path.lower().endswith(".ttf") else font_path
    if os.path.isfile(bold_path):
      safe_path = bold_path.replace("\\", "/").replace(":", "\\:").replace("'", "\\'")
      parts[1] = f"fontfile='{safe_path}'"
  if style["box_color"] != "black@0.0":
    parts.append(f"box=1")
    parts.append(f"boxcolor={style['box_color']}")
    parts.append(f"boxborderw={style['box_border']}")
  if style["outline_width"] > 0:
    parts.append(f"borderw={style['outline_width']}")
    parts.append(f"bordercolor={style['outline_color']}")
  # enable=between(t,start,end)
  parts.append(f"enable='between(t,{start},{end})'")
  return "drawtext=" + ":".join(parts)


def burn_in(
  input_path: str,
  output_path: str,
  cues: list[SubtitleCue],
  *,
  style: str = "default",
  video_width: int | None = None,
  video_height: int | None = None,
  ffmpeg: str | None = None,
  font_dir: str = "C:/Windows/Fonts",
) -> str:
  """Burn subtitles into video using ffmpeg drawtext filters.

  This re-encodes the video (no stream copy possible with subtitle overlays).
  """
  if not cues:
    raise ValueError("no cues to burn in")

  binary = find_ffmpeg(ffmpeg)
  if video_width is None or video_height is None:
    from .ffmpeg_utils import probe
    info = probe(input_path)
    video_width = info.get("width", 1280)
    video_height = info.get("height", 720)

  style_cfg = SUBTITLE_STYLES.get(style, SUBTITLE_STYLES["default"])
  filters = []
  for c in cues:
    filters.append(_build_drawtext_filter(
      c.text, c.start, c.end, video_width, video_height, style_cfg, font_dir=font_dir,
    ))
  filter_str = ",".join(filters)

  args = [
    binary, "-y", "-i", input_path,
    "-vf", filter_str,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-c:a", "copy",
    output_path,
  ]
  run(args, timeout=900)
  return output_path
