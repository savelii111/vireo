"""Style transfer: apply a StyleProfile to a new video.

The pipeline:
  1. Take the new (target) video
  2. Apply the StyleProfile's recommended color look
  3. Match the pacing (cuts per minute) by either:
     - Splicing in additional cuts if the target is too slow
     - Extending segments if too fast
  4. Optionally add background music with the profile's volume setting
  5. Optionally add zoom moments with the profile's emphasis rate

This is the "creator style" feature: hand Vireo a StyleProfile and a
raw video, get back an edit that LOOKS and FEELS like the creator.

Why it matters:
  - The same creator uploads 50 videos; with this, every new video can be
    auto-styled to match their existing library
  - Solves "why does my latest video look different from my channel?"
  - Multi-language / multi-region creators keep consistent look

Limitations (honest):
  - We don't do per-frame style transfer (that's GANs / $$$)
  - We match COLORS and PACING. We don't replicate specific shots
  - Style transfer works best when reference and target are similar
    (e.g. both talking-head + b-roll). Mismatched genres will produce
    weaker matches.
"""

from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from .ffmpeg_utils import find_ffmpeg, run, probe, FFmpegError
from .color import apply_look, LOOKS
from .style_profile import StyleProfile
from .transcriber import Transcript
from .zoom import find_emphasis_windows, apply_zoom
from .cutter import trim, concat, CutRange
from .music import add_background_music, DuckConfig


@dataclass
class TransferOptions:
  """Options for how to apply a StyleProfile."""
  apply_look: bool = True            # apply color look
  match_pacing: bool = True          # cut/extend to match target cuts/min
  apply_zoom: bool = True            # add zoom on emphasis
  add_music: bool = False            # add background music (requires music_path)
  music_path: Optional[str] = None   # path to music file if add_music
  music_volume: float = 0.15
  target_duration: Optional[float] = None  # override target video duration
  # If true, only update the color (no cutting/zoom)
  preserve_content: bool = False     # if True, only color transfer, no structural changes


def apply_color_from_profile(
  input_path: str,
  output_path: str,
  profile: StyleProfile,
  *,
  ffmpeg: str | None = None,
) -> str:
  """Apply the profile's recommended color look to a video."""
  if profile.recommended_look not in LOOKS:
    return _copy_video(input_path, output_path, ffmpeg=ffmpeg)
  return apply_look(input_path, output_path, profile.recommended_look, ffmpeg=ffmpeg)


def _copy_video(input_path: str, output_path: str, *, ffmpeg: str | None = None) -> str:
  """Stream-copy a video (no re-encode) for use as an intermediate step."""
  binary = find_ffmpeg(ffmpeg)
  args = [binary, "-y", "-i", input_path, "-c", "copy", output_path]
  run(args, timeout=300)
  return output_path


def match_pacing(
  input_path: str,
  output_path: str,
  profile: StyleProfile,
  *,
  tolerance: float = 0.5,    # sec to vary from target
  ffmpeg: str | None = None,
) -> str:
  """Adjust cuts to roughly match the profile's target cuts_per_minute.

  Strategy:
    - Analyze current cuts in the target video
    - If too few: splice in slowdowns (extend some segments by adding freeze frames)
    - If too many: cut more aggressively
  For now: just trims/extends proportionally to match the target cut count.
  """
  from .style_analyzer import detect_scene_changes
  cuts = detect_scene_changes(input_path, ffmpeg=ffmpeg)
  info = probe(input_path)
  duration = info.get("duration_sec", 0)
  if duration <= 0:
    return _copy_video(input_path, output_path, ffmpeg=ffmpeg)

  current_cpm = len(cuts) / (duration / 60.0)
  target_cpm = profile.cuts_per_minute
  if abs(current_cpm - target_cpm) < 0.3:
    # Already close enough; no-op
    return _copy_video(input_path, output_path, ffmpeg=ffmpeg)

  # Compute target cut count
  target_cuts = int(target_cpm * duration / 60.0)
  if target_cuts <= 0 or not cuts:
    return _copy_video(input_path, output_path, ffmpeg=ffmpeg)

  # Build a list of cut timestamps (incl. 0 and duration)
  boundaries = [0.0] + sorted(cuts) + [duration]

  # If we need MORE cuts, split each segment in half (recursive).
  # If we need FEWER cuts, merge adjacent pairs.
  while len(boundaries) - 1 < target_cuts:
    # Find the longest segment and split it
    longest_i = 0
    longest_dur = 0.0
    for i in range(len(boundaries) - 1):
      d = boundaries[i + 1] - boundaries[i]
      if d > longest_dur:
        longest_dur = d
        longest_i = i
    if longest_dur < 1.0:
      break
    mid = (boundaries[longest_i] + boundaries[longest_i + 1]) / 2.0
    boundaries.insert(longest_i + 1, mid)
    if len(boundaries) > 200:  # safety cap
      break

  while len(boundaries) - 1 > target_cuts and len(boundaries) > 2:
    # Find the shortest segment and merge
    shortest_i = 0
    shortest_dur = float("inf")
    for i in range(len(boundaries) - 1):
      d = boundaries[i + 1] - boundaries[i]
      if d < shortest_dur:
        shortest_dur = d
        shortest_i = i
    if shortest_dur > 0.5:
      break
    # Remove the boundary after the shortest segment
    del boundaries[shortest_i + 1]

  # Re-cut: build CutRange list and use cut_segments
  if len(boundaries) <= 2:
    return _copy_video(input_path, output_path, ffmpeg=ffmpeg)

  ranges = [
    CutRange(start=boundaries[i], end=boundaries[i + 1])
    for i in range(len(boundaries) - 1)
  ]
  from .cutter import cut_segments
  cut_segments(input_path, output_path, ranges, ffmpeg=ffmpeg)
  return output_path


def apply_style(
  input_path: str,
  output_path: str,
  profile: StyleProfile,
  transcript: Transcript | None = None,
  options: TransferOptions | None = None,
  *,
  ffmpeg: str | None = None,
) -> str:
  """Apply a full StyleProfile to a target video.

  Pipeline:
    1. Color (always if apply_look)
    2. Pacing adjustment (if match_pacing)
    3. Zoom on emphasis (if apply_zoom + transcript available)
    4. Music (if add_music + music_path)

  Each step writes to an intermediate file, then the final step writes
  to output_path. Cleanup is best-effort.
  """
  opts = options or TransferOptions()
  Path(output_path).parent.mkdir(parents=True, exist_ok=True)

  tmpdir = Path(output_path).parent / "_vireo_style_tmp"
  tmpdir.mkdir(exist_ok=True)
  intermediates: list[Path] = []

  try:
    current = Path(input_path)
    step = 0

    # Step 1: color
    if opts.apply_look and not opts.preserve_content:
      step += 1
      out = tmpdir / f"step{step}_color.mp4"
      apply_color_from_profile(str(current), str(out), profile, ffmpeg=ffmpeg)
      intermediates.append(out)
      current = out

    # Step 2: pacing
    if opts.match_pacing and not opts.preserve_content:
      step += 1
      out = tmpdir / f"step{step}_pacing.mp4"
      match_pacing(str(current), str(out), profile, ffmpeg=ffmpeg)
      intermediates.append(out)
      current = out

    # Step 3: zoom (only if we have a transcript)
    if opts.apply_zoom and transcript and not opts.preserve_content:
      step += 1
      out = tmpdir / f"step{step}_zoom.mp4"
      # Use the profile's emphasis_per_minute to control how many zooms
      from .zoom import EmphasisWindow
      # Estimate target zoom count: emphasis_per_minute * duration_min
      from .ffmpeg_utils import probe as p
      info = p(str(current))
      duration = info.get("duration_sec", 0)
      target_count = max(1, int(profile.emphasis_per_minute * duration / 60.0))
      windows = find_emphasis_windows(
        transcript,
        max_windows=target_count,
        zoom_min=1.10,
        zoom_max=min(1.4, profile.zoom_max),
      )
      if windows:
        from .presets import get_preset
        # Use a sensible target aspect (1:1 for simplicity)
        apply_zoom(str(current), str(out), windows, target_aspect="1:1",
                   output_width=720, output_height=720, ffmpeg=ffmpeg)
        intermediates.append(out)
        current = out
      else:
        # No emphasis windows — skip step
        if intermediates:
          current = intermediates[-1]

    # Step 4: music
    if opts.add_music and opts.music_path and not opts.preserve_content:
      step += 1
      out = tmpdir / f"step{step}_music.mp4"
      duck = DuckConfig(base_volume=opts.music_volume, duck_volume=opts.music_volume * 0.3)
      add_background_music(str(current), opts.music_path, str(out),
                           duck=duck, ffmpeg=ffmpeg)
      intermediates.append(out)
      current = out

    # Final: copy/rename to output
    import shutil
    shutil.copy2(str(current), output_path)
    return output_path
  finally:
    # Cleanup intermediates
    for p in intermediates:
      try: p.unlink()
      except OSError: pass
    try: tmpdir.rmdir()
    except OSError: pass
