"""Aspect ratio reframing: convert 16:9 to 9:16, 1:1, 4:5, etc.

Smart crop strategy (no ML by default):
  1. Center crop — simple and fast, good for static scenes
  2. Region-of-interest (ROI) crop — given a focal point, crop around it
  3. Face-tracking crop (future, optional) — uses MediaPipe/Replicate to follow faces

We always re-encode (reframing requires pixel-level work).
"""

from __future__ import annotations
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from .ffmpeg_utils import find_ffmpeg, run, probe, FFmpegError
from .presets import parse_aspect, get_preset


@dataclass
class CropBox:
  """Pixel-space crop box: x, y, width, height."""
  x: int
  y: int
  width: int
  height: int

  def __post_init__(self):
    if self.width <= 0 or self.height <= 0:
      raise ValueError(f"CropBox dimensions must be positive: {self.width}x{self.height}")

  def to_filter(self) -> str:
    return f"crop={self.width}:{self.height}:{self.x}:{self.y}"

  def to_dict(self) -> dict:
    return asdict(self) if False else {"x": self.x, "y": self.y, "width": self.width, "height": self.height}


def compute_center_crop(
  source_width: int,
  source_height: int,
  target_aspect: str,
) -> CropBox:
  """Compute a center crop box that produces the target aspect ratio.

  Source: 16:9 (1920x1080) -> target 9:16 -> output 608x1080 (a vertical slice).
  """
  sa = source_width / source_height
  ta_w, ta_h = parse_aspect(target_aspect)
  ta = ta_w / ta_h

  if abs(sa - ta) < 1e-3:
    # Already the right aspect
    return CropBox(x=0, y=0, width=source_width, height=source_height)

  if sa > ta:
    # Source is wider than target: crop horizontally
    new_w = int(round(source_height * ta))
    new_w -= new_w % 2  # even for yuv420p
    if new_w <= 0:
      raise ValueError(f"target aspect {target_aspect} too tall for source {source_width}x{source_height}")
    x = (source_width - new_w) // 2
    return CropBox(x=x, y=0, width=new_w, height=source_height)
  else:
    # Source is taller than target: crop vertically
    new_h = int(round(source_width / ta))
    new_h -= new_h % 2
    if new_h <= 0:
      raise ValueError(f"target aspect {target_aspect} too wide for source {source_width}x{source_height}")
    y = (source_height - new_h) // 2
    return CropBox(x=0, y=y, width=source_width, height=new_h)


def reframe(
  input_path: str,
  output_path: str,
  *,
  target_aspect: str,
  output_width: Optional[int] = None,
  output_height: Optional[int] = None,
  crop_box: Optional[CropBox] = None,
  ffmpeg: str | None = None,
  video_bitrate: str = "5000k",
  audio_bitrate: str = "128k",
  fps: int = 30,
) -> str:
  """Reframe a video to a target aspect ratio.

  If crop_box is provided, use it (advanced: for smart/face tracking).
  Otherwise, compute a center crop.

  If output_width/height are provided, scale to those after cropping.
  Otherwise, keep the cropped pixel size.
  """
  binary = find_ffmpeg(ffmpeg)
  info = probe(input_path)
  sw, sh = info.get("width", 0), info.get("height", 0)
  if not sw or not sh:
    raise FFmpegError(f"could not determine source dimensions for {input_path}", 0)

  if crop_box is None:
    crop_box = compute_center_crop(sw, sh, target_aspect)

  filter_parts = [crop_box.to_filter()]
  if output_width and output_height:
    # Scale after crop to target resolution
    # Force even dimensions for yuv420p
    ow = output_width - (output_width % 2)
    oh = output_height - (output_height % 2)
    filter_parts.append(f"scale={ow}:{oh}")
  # Always normalize the sample aspect ratio to 1:1 so concat can stitch
  # multiple segments that may otherwise have slightly different SARs.
  filter_parts.append("setsar=1")
  filter_str = ",".join(filter_parts)

  args = [
    binary, "-y", "-i", input_path,
    "-vf", filter_str,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-b:v", video_bitrate,
    "-pix_fmt", "yuv420p",
    "-r", str(fps),
    "-c:a", "aac", "-b:a", audio_bitrate,
    output_path,
  ]
  run(args, timeout=600)
  return output_path


def reframe_for_platform(
  input_path: str,
  output_path: str,
  platform: str,
  *,
  crop_box: Optional[CropBox] = None,
  ffmpeg: str | None = None,
) -> str:
  """Convenience: reframe using the preset for a platform."""
  preset = get_preset(platform)
  return reframe(
    input_path, output_path,
    target_aspect=preset.aspect,
    output_width=preset.width, output_height=preset.height,
    crop_box=crop_box, ffmpeg=ffmpeg,
    video_bitrate=preset.video_bitrate,
    audio_bitrate=preset.audio_bitrate,
    fps=preset.fps,
  )


def reframe_with_pan(
  input_path: str,
  output_path: str,
  *,
  target_aspect: str,
  focal_points: list[tuple[float, float, float, float]],
  output_width: int = 1080,
  output_height: int = 1920,
  fps: int = 30,
  ffmpeg: str | None = None,
  video_bitrate: str = "5000k",
  audio_bitrate: str = "128k",
) -> str:
  """Reframe with keyframed focal points (e.g. follow a moving subject).

  focal_points: list of (time_sec, x_pct, y_pct, weight) where x_pct,y_pct are
  0..1 normalized. The crop is held constant within each segment, switching
  abruptly at each keyframe (a "cut" pan, not a smooth pan — smoother pans
  require sendcmd which has fragile cross-platform format).

  Implementation: split the source at each keyframe time, reframe each
  segment with the corresponding focal point, then concat.

  If focal_points is empty or has one entry, behaves like reframe() with a
  center crop / first-point crop.
  """
  binary = find_ffmpeg(ffmpeg)
  info = probe(input_path)
  sw, sh = info.get("width", 0), info.get("height", 0)
  if not sw or not sh:
    raise FFmpegError("source has no dimensions", 0)
  total = info.get("duration_sec", 0)

  ta_w, ta_h = parse_aspect(target_aspect)
  ta = ta_w / ta_h
  if sw / sh > ta:
    base_w = int(round(sh * ta))
    base_w -= base_w % 2
    base_h = sh
  else:
    base_h = int(round(sw / ta))
    base_h -= base_h % 2
    base_w = sw

  # Build a "focal point at any time" function: between keyframes, hold the
  # previous value. At keyframe times, switch to the new value.
  fps_sorted = sorted(focal_points, key=lambda fp: fp[0])

  # Build segment ranges: [fps[0].t, fps[1].t), [fps[1].t, fps[2].t), ...
  segments: list[tuple[float, float, float, float]] = []
  for i, (t, x_pct, y_pct, _w) in enumerate(fps_sorted):
    if i + 1 < len(fps_sorted):
      end_t = fps_sorted[i + 1][0]
    else:
      end_t = total
    if end_t > t:
      segments.append((t, end_t, x_pct, y_pct))

  if not segments:
    # Fall back to single static crop
    if fps_sorted:
      _, x_pct, y_pct, _ = fps_sorted[0]
    else:
      x_pct, y_pct = 0.5, 0.5
    cx = int(round((sw - base_w) * x_pct))
    cy = int(round((sh - base_h) * y_pct))
    return reframe(
      input_path, output_path,
      target_aspect=target_aspect,
      output_width=output_width, output_height=output_height,
      crop_box=CropBox(x=cx, y=cy, width=base_w, height=base_h),
      ffmpeg=ffmpeg, video_bitrate=video_bitrate, audio_bitrate=audio_bitrate, fps=fps,
    )

  # Trim each segment, reframe it, then concat
  tmpdir = Path(output_path).parent / "_vireo_pan_tmp"
  tmpdir.mkdir(exist_ok=True)
  seg_paths: list[str] = []
  try:
    for i, (t0, t1, x_pct, y_pct) in enumerate(segments):
      # Trim segment
      trimmed = tmpdir / f"trim_{i:04d}.mp4"
      from .cutter import trim
      trim(input_path, str(trimmed), start=t0, end=t1, ffmpeg=ffmpeg, reencode=True)
      # Reframe segment
      cx = int(round((sw - base_w) * max(0.0, min(1.0, x_pct))))
      cy = int(round((sh - base_h) * max(0.0, min(1.0, y_pct))))
      reframed = tmpdir / f"ref_{i:04d}.mp4"
      reframe(
        str(trimmed), str(reframed),
        target_aspect=target_aspect,
        output_width=output_width, output_height=output_height,
        crop_box=CropBox(x=cx, y=cy, width=base_w, height=base_h),
        ffmpeg=ffmpeg, video_bitrate=video_bitrate, audio_bitrate=audio_bitrate, fps=fps,
      )
      seg_paths.append(str(reframed))
    # Concat
    from .cutter import concat
    concat(seg_paths, output_path, ffmpeg=ffmpeg, method="filter")
  finally:
    for p in tmpdir.glob("trim_*.mp4"):
      try: p.unlink()
      except OSError: pass
    for p in tmpdir.glob("ref_*.mp4"):
      try: p.unlink()
      except OSError: pass
    try: tmpdir.rmdir()
    except OSError: pass
  return output_path
