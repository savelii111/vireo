"""Color grading via ffmpeg's built-in filters + bundled LUTs.

What this does:
  1. Apply a preset "look" (cinematic, warm, cool, vintage, b&w) via eq + curves
  2. OR apply a 3D LUT (.cube file) for true film-grade looks
  3. Adjust saturation, contrast, brightness with one call

Why not external LUTs by default?
  - Bundling free LUTs (Teal & Orange, Cinematic Dark) as code is portable
  - ffmpeg's built-in color filters cover 90% of what creators need
  - Real LUT files (.cube) can be loaded if user provides them

Built-in looks:
  - "natural": pass-through (no changes)
  - "cinematic": slightly desaturated, lifted blacks, teal/orange tint
  - "warm": warmer temperature, slight orange lift
  - "cool": cooler temperature, slight blue lift
  - "vintage": faded, slight yellow shift
  - "bw": black & white
  - "high_contrast": punchy contrast
  - "soft": dreamy, slight haze

For external .cube LUTs: pass lut_path to apply_lut()
"""

from __future__ import annotations
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from .ffmpeg_utils import find_ffmpeg, run, escape_filter_path, FFmpegError


@dataclass
class Look:
  """A color grading preset."""
  name: str
  description: str
  # ffmpeg filter chain (without eq/curves/colour balance — those are built from fields below)
  saturation: float = 1.0       # 1.0 = normal, 0 = b&w
  contrast: float = 1.0         # 1.0 = normal
  brightness: float = 0.0       # -1..1
  gamma: float = 1.0            # 1.0 = normal
  gamma_r: float = 1.0
  gamma_g: float = 1.0
  gamma_b: float = 1.0
  red_balance: float = 1.0       # 1.0 = normal
  blue_balance: float = 1.0
  green_balance: float = 1.0
  # Custom filter chain appended at the end
  extra_filters: str = ""
  lut_path: str | None = None  # path to a .cube file


LOOKS: dict[str, Look] = {
  "natural": Look(
    name="natural", description="No changes (pass-through).",
  ),
  "cinematic": Look(
    name="cinematic", description="Teal/orange, slight desat, lifted blacks.",
    saturation=0.9, contrast=1.1, brightness=-0.02, gamma=1.05,
    gamma_r=1.0, gamma_g=0.98, gamma_b=1.05,  # slight blue lift
    red_balance=1.05, blue_balance=1.02,
  ),
  "warm": Look(
    name="warm", description="Sunset-like, orange/yellow lift.",
    saturation=1.1, contrast=1.05,
    red_balance=1.08, blue_balance=0.92,
  ),
  "cool": Look(
    name="cool", description="Morning blue, cooler temperature.",
    saturation=1.05, contrast=1.05,
    red_balance=0.92, blue_balance=1.08,
  ),
  "vintage": Look(
    name="vintage", description="Faded, yellow-shifted, soft contrast.",
    saturation=0.75, contrast=0.9, brightness=0.04, gamma=0.95,
    red_balance=1.05, blue_balance=0.9,
  ),
  "bw": Look(
    name="bw", description="Black & white.",
    saturation=0.0, contrast=1.1,
  ),
  "high_contrast": Look(
    name="high_contrast", description="Punchy contrast for thumbnails.",
    saturation=1.15, contrast=1.25, brightness=-0.02, gamma=1.0,
  ),
  "soft": Look(
    name="soft", description="Dreamy haze, low contrast, slight pink lift.",
    saturation=0.85, contrast=0.9, brightness=0.03, gamma=1.1,
    red_balance=1.03, green_balance=1.02, blue_balance=1.0,
  ),
}


def _build_filter(look: Look) -> str:
  """Build an ffmpeg -vf filter chain for a Look."""
  parts: list[str] = []
  if look.lut_path:
    # Use ffmpeg's lut3d filter
    safe_path = escape_filter_path(look.lut_path)
    parts.append(f"lut3d='{safe_path}'")
  # eq filter: contrast, brightness, saturation, gamma
  eq_parts: list[str] = []
  if look.contrast != 1.0:
    eq_parts.append(f"contrast={look.contrast}")
  if look.brightness != 0.0:
    eq_parts.append(f"brightness={look.brightness}")
  if look.saturation != 1.0:
    eq_parts.append(f"saturation={look.saturation}")
  if look.gamma != 1.0 or look.gamma_r != 1.0 or look.gamma_g != 1.0 or look.gamma_b != 1.0:
    g = f"gamma={look.gamma}:gamma_r={look.gamma_r}:gamma_g={look.gamma_g}:gamma_b={look.gamma_b}"
    eq_parts.append(g)
  if eq_parts:
    parts.append("eq=" + ":".join(eq_parts))
  # colour balance (red/green/blue)
  if (look.red_balance, look.green_balance, look.blue_balance) != (1.0, 1.0, 1.0):
    parts.append(
      f"colorbalance=rs={look.red_balance - 1.0:.3f}:gs={look.green_balance - 1.0:.3f}:bs={look.blue_balance - 1.0:.3f}"
    )
  if look.extra_filters:
    parts.append(look.extra_filters)
  if not parts:
    return ""  # pass-through
  return ",".join(parts)


def apply_look(
  input_path: str,
  output_path: str,
  look: str | Look = "natural",
  *,
  ffmpeg: str | None = None,
  video_bitrate: str = "5000k",
  audio_bitrate: str = "128k",
) -> str:
  """Apply a color look to a video.

  Re-encodes. Pass look="natural" or a Look object for custom values.
  """
  if isinstance(look, str):
    if look not in LOOKS:
      raise FFmpegError(f"unknown look: {look!r}; options: {list(LOOKS.keys())}", 0)
    look = LOOKS[look]

  filter_str = _build_filter(look)
  binary = find_ffmpeg(ffmpeg)
  args = [binary, "-y", "-i", input_path]
  if filter_str:
    args.extend(["-vf", filter_str])
  args.extend([
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-b:v", video_bitrate, "-pix_fmt", "yuv420p",
    "-c:a", "copy",
    output_path,
  ])
  run(args, timeout=600)
  return output_path


def apply_lut(
  input_path: str,
  output_path: str,
  lut_path: str,
  *,
  ffmpeg: str | None = None,
  video_bitrate: str = "5000k",
  audio_bitrate: str = "128k",
) -> str:
  """Apply a user-provided .cube LUT file.

  The LUT is a 3D color transform — .cube files are free, widely available,
  and produced by tools like DaVinci Resolve, Adobe Premiere, etc.
  """
  if not Path(lut_path).is_file():
    raise FFmpegError(f"LUT file not found: {lut_path}", 0)
  look = Look(name="custom_lut", description=f"Custom LUT {lut_path}", lut_path=lut_path)
  return apply_look(input_path, output_path, look, ffmpeg=ffmpeg,
                    video_bitrate=video_bitrate, audio_bitrate=audio_bitrate)


def list_looks() -> list[dict]:
  """Return metadata for all built-in looks."""
  return [{"name": l.name, "description": l.description} for l in LOOKS.values()]
