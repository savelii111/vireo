"""Visual style analyzer: extract color/brightness/saturation stats from a video.

Uses ffmpeg's signalstats filter to compute per-frame statistics without
re-encoding. We sample N evenly-spaced frames and aggregate.

Key features detected:
  - average brightness (YAVG from signalstats)
  - average saturation (SATAVG)
  - hue distribution
  - contrast (variance of luma)
  - color temperature (R/B balance)
  - dominant colors (via palettegen)

Why this matters for "style copy":
  - Two creators with different looks (e.g. "cinematic teal/orange" vs
    "bright YouTube talking head") have very different average stats.
  - We can recommend a matching color preset from our 8 built-in looks.
"""

from __future__ import annotations
import json
import re
import statistics
import subprocess
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Optional

from .ffmpeg_utils import find_ffmpeg, find_ffprobe, run, probe, FFmpegError


@dataclass
class ColorStats:
  """Color statistics for a single frame or aggregate."""
  yavg: float = 0.0      # 0-255, luma average
  uavg: float = 0.0      # chroma U average (-128..128)
  vavg: float = 0.0      # chroma V average
  ymin: float = 0.0
  ymax: float = 0.0      # dynamic range hint
  satavg: float = 0.0    # 0-1, saturation
  hueavg: float = 0.0    # -180..180, hue

  def to_dict(self) -> dict:
    return asdict(self)


@dataclass
class VisualStyle:
  """Aggregated visual style from a video (or many)."""
  num_frames_sampled: int = 0
  # Aggregated color stats
  brightness: float = 0.0       # 0-1
  saturation: float = 0.0       # 0-1
  contrast: float = 0.0         # 0-1 (normalized dynamic range)
  hue: float = 0.0              # -180..180
  temperature: float = 0.0      # -1 (cool/blue) .. +1 (warm/orange)
  # Brightness histogram (10 bins, 0-255)
  brightness_histogram: list[float] = field(default_factory=list)
  # Dominant colors (hex strings, 5 most common)
  dominant_colors: list[str] = field(default_factory=list)
  # Recommended look (one of our 8 presets) based on these stats
  recommended_look: str = "natural"
  # Scene/cut statistics
  num_scene_changes: int = 0
  cuts_per_minute: float = 0.0
  avg_shot_length_sec: float = 0.0
  total_duration_sec: float = 0.0
  # Confidence in the recommendation (0..1)
  confidence: float = 0.0

  def to_dict(self) -> dict:
    return asdict(self)


def sample_frames(video_path: str, *, n: int = 20, ffmpeg: str | None = None) -> list[ColorStats]:
  """Sample N evenly-spaced frames from a video and return signalstats per frame.

  Uses ffmpeg with `-vf signalstats` and a select filter that picks 1 frame
  every (duration/n) seconds.
  """
  binary = find_ffmpeg(ffmpeg)
  info = probe(video_path)
  total = info.get("duration_sec", 0)
  if total <= 0 or n < 1:
    return []

  # Use fps filter to limit to a low rate, then take nth frame
  # Easier: use -vf signalstats and capture metadata per frame
  # Even easier: use select='not(mod(n,K))' to pick every Kth frame
  # But the cleanest: output N raw stats lines via ffmpeg's metadata output
  fps_val = max(0.1, n / total)
  args = [
    binary, "-i", video_path,
    "-vf", f"fps={fps_val},signalstats,metadata=print:file=-",
    "-an", "-f", "null", "-",
  ]
  proc = run(args, check=False, timeout=120, ffmpeg=binary)
  # ffmpeg may exit with error if filter chain has issues; if no frames processed, fail
  if proc.returncode != 0:
    raise FFmpegError(f"signalstats sampling failed: code {proc.returncode}",
                      proc.returncode, proc.stderr.decode("utf-8", errors="replace")[-500:])

  # ffmpeg writes the metadata to stdout (not stderr)
  stdout = proc.stdout.decode("utf-8", errors="replace") if isinstance(proc.stdout, bytes) else (proc.stdout or "")
  return _parse_signalstats(stdout)


def _parse_signalstats(stderr: str) -> list[ColorStats]:
  """Parse ffmpeg signalstats metadata output.

  Lines look like:
    frame:0    pts:...  pts_time:0
    lavfi.signalstats.YAVG=120.5
    lavfi.signalstats.UAVG=...
    ...
  """
  frames: list[ColorStats] = []
  current: ColorStats | None = None
  current_idx = 0
  pattern_yavg = re.compile(r"signalstats\.YAVG=([\d.]+)")
  pattern_uavg = re.compile(r"signalstats\.UAVG=([\d.-]+)")
  pattern_vavg = re.compile(r"signalstats\.VAVG=([\d.-]+)")
  pattern_ymin = re.compile(r"signalstats\.YMIN=([\d.]+)")
  pattern_ymax = re.compile(r"signalstats\.YMAX=([\d.]+)")
  pattern_sat = re.compile(r"signalstats\.SATAVG=([\d.]+)")
  pattern_hue = re.compile(r"signalstats\.HUEAVG=([\d.-]+)")

  for line in stderr.splitlines():
    if line.startswith("frame:"):
      if current is not None:
        frames.append(current)
      current = ColorStats()
      current_idx += 1
    elif current is not None:
      for pat, attr in [
        (pattern_yavg, "yavg"),
        (pattern_uavg, "uavg"),
        (pattern_vavg, "vavg"),
        (pattern_ymin, "ymin"),
        (pattern_ymax, "ymax"),
        (pattern_sat, "satavg"),
        (pattern_hue, "hueavg"),
      ]:
        m = pat.search(line)
        if m:
          try:
            setattr(current, attr, float(m.group(1)))
          except ValueError:
            pass
  if current is not None:
    frames.append(current)
  return frames


def detect_scene_changes(video_path: str, *, threshold: float = 0.4, ffmpeg: str | None = None) -> list[float]:
  """Detect scene changes (cuts) using ffmpeg's scdet filter.

  Returns: list of timestamps (seconds) where a cut happens.
  """
  binary = find_ffmpeg(ffmpeg)
  info = probe(video_path)
  total = info.get("duration_sec", 0)
  if total <= 0:
    return []

  args = [
    binary, "-i", video_path,
    "-vf", f"scdet=threshold={threshold},metadata=print:file=-",
    "-an", "-f", "null", "-",
  ]
  proc = run(args, check=False, timeout=300, ffmpeg=binary)
  # scdet metadata is on stdout
  stdout = proc.stdout.decode("utf-8", errors="replace") if isinstance(proc.stdout, bytes) else (proc.stdout or "")

  # Lines: lavfi.scd.time=12.345
  pattern_time = re.compile(r"scd\.time=([\d.]+)")
  cuts: list[float] = []
  for line in stdout.splitlines():
    m = pattern_time.search(line)
    if m:
      try:
        cuts.append(float(m.group(1)))
      except ValueError:
        pass
  return cuts


def extract_dominant_colors(video_path: str, *, n_colors: int = 5, ffmpeg: str | None = None) -> list[str]:
  """Extract dominant colors using ffmpeg's palettegen filter.

  Returns: list of n_colors hex color strings (e.g. ["#ff8800", ...])
  """
  binary = find_ffmpeg(ffmpeg)
  palette_file = Path(video_path).with_suffix(".palette.png")

  # Step 1: generate palette
  proc = run([
    binary, "-y", "-i", video_path,
    "-vf", f"palettegen=max_colors={n_colors * 4}:stats_mode=diff",
    str(palette_file),
  ], check=False, timeout=120, ffmpeg=binary)
  if proc.returncode != 0 or not palette_file.exists():
    return []

  # Step 2: read the palette and find the N most common colors
  # ffmpeg's palettegen output is a PNG with a row of color swatches,
  # each block of size proportional to its frequency. Parse the swatches
  # by reading pixel colors.
  try:
    from PIL import Image
    img = Image.open(palette_file).convert("RGB")
    w, h = img.size
    # The palette is in the bottom rows; typical ffmpeg output has the
    # palette spread across the bottom half of the image, sorted by count.
    # We just sample the last row to get the top swatches.
    pixels = [img.getpixel((x, h - 1)) for x in range(0, w, max(1, w // (n_colors * 2)))]
    # Dedupe while preserving order
    seen = set()
    out = []
    for r, g, b in pixels:
      key = (r // 16, g // 16, b // 16)  # bucket to dedupe similar
      if key not in seen:
        seen.add(key)
        out.append("#{:02x}{:02x}{:02x}".format(r, g, b))
        if len(out) >= n_colors:
          break
    return out
  except Exception:
    return []
  finally:
    try:
      palette_file.unlink()
    except OSError:
      pass


def aggregate_stats(frames: list[ColorStats]) -> VisualStyle:
  """Aggregate per-frame stats into a single VisualStyle."""
  if not frames:
    return VisualStyle()

  yavgs = [f.yavg for f in frames if f.yavg > 0]
  satavgs = [f.satavg for f in frames if f.satavg > 0]
  hueavgs = [f.hueavg for f in frames if f.hueavg != 0]
  ymins = [f.ymin for f in frames if f.ymin > 0]
  ymaxs = [f.ymax for f in frames if f.ymax > 0]

  brightness = statistics.mean(yavgs) / 255.0 if yavgs else 0.0
  # ffmpeg's SATAVG is in 0-255 range; normalize to 0-1
  saturation = (statistics.mean(satavgs) / 255.0) if satavgs else 0.0
  contrast = (statistics.mean(ymaxs) - statistics.mean(ymins)) / 255.0 if (ymaxs and ymins) else 0.0
  hue = statistics.mean(hueavgs) if hueavgs else 0.0
  # U/V are -128..128, signed. V positive = more red, U positive = less blue
  # Use absolute mean to gauge overall chroma strength, then signed for direction.
  uavgs = [f.uavg for f in frames]
  vavgs = [f.vavg for f in frames]
  if uavgs and vavgs:
    u_mean = statistics.mean(uavgs)
    v_mean = statistics.mean(vavgs)
    # V more positive than U = warm
    temperature = (v_mean - u_mean) / 256.0
    temperature = max(-1.0, min(1.0, temperature))
  else:
    temperature = 0.0

  # Brightness histogram (10 bins)
  hist = [0.0] * 10
  for y in yavgs:
    bin_idx = min(9, int(y / 256 * 10))
    hist[bin_idx] += 1
  total = sum(hist) or 1
  hist = [h / total for h in hist]

  return VisualStyle(
    num_frames_sampled=len(frames),
    brightness=round(brightness, 3),
    saturation=round(saturation, 3),
    contrast=round(contrast, 3),
    hue=round(hue, 1),
    temperature=round(temperature, 3),
    brightness_histogram=hist,
  )


def analyze_visual(video_path: str, *, n_frames: int = 20, ffmpeg: str | None = None) -> VisualStyle:
  """Full visual style analysis of a video.

  1. Sample N frames, get color stats
  2. Detect scene changes for cut frequency
  3. Extract dominant colors
  4. Recommend a built-in look based on the stats
  """
  frames = sample_frames(video_path, n=n_frames, ffmpeg=ffmpeg)
  style = aggregate_stats(frames)

  # Scene changes
  cuts = detect_scene_changes(video_path, ffmpeg=ffmpeg)
  info = probe(video_path)
  duration = info.get("duration_sec", 0)
  style.num_scene_changes = len(cuts)
  style.total_duration_sec = duration
  if duration > 0:
    style.cuts_per_minute = round(len(cuts) / (duration / 60), 2)
    style.avg_shot_length_sec = round(duration / max(1, len(cuts) + 1), 2)

  # Dominant colors
  style.dominant_colors = extract_dominant_colors(video_path, n_colors=5, ffmpeg=ffmpeg)

  # Recommend a look
  style.recommended_look, style.confidence = _recommend_look(style)
  return style


def _recommend_look(style: VisualStyle) -> tuple[str, float]:
  """Match a VisualStyle to our built-in color presets.

  Heuristic: combine brightness, saturation, contrast, temperature.
  """
  candidates: list[tuple[str, float]] = []

  # Black & white: very low saturation
  if style.saturation < 0.1:
    return ("bw", 0.9)

  # High contrast: contrast > 0.55
  if style.contrast > 0.55:
    candidates.append(("high_contrast", 0.7))

  # Warm: temperature > 0.15
  if style.temperature > 0.15:
    candidates.append(("warm", 0.7))

  # Cool: temperature < -0.15
  if style.temperature < -0.15:
    candidates.append(("cool", 0.7))

  # Cinematic: moderate contrast, slight blue tilt, slightly desaturated
  if 0.20 < style.contrast < 0.55 and style.temperature < -0.05 and style.saturation < 0.7:
    candidates.append(("cinematic", 0.6))

  # Vintage: low saturation, soft contrast, warm
  if style.saturation < 0.5 and style.contrast < 0.4 and style.temperature > 0:
    candidates.append(("vintage", 0.6))

  # Soft: low contrast, high brightness
  if style.contrast < 0.35 and style.brightness > 0.5:
    candidates.append(("soft", 0.6))

  if not candidates:
    return ("natural", 0.5)
  return max(candidates, key=lambda x: x[1])
