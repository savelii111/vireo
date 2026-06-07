"""Video cutting: trim, concatenate, silence removal.

Pure ffmpeg operations, no ML. Each function is a single, well-defined
transform that returns a new file path (never mutates input).
"""

from __future__ import annotations
import os
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from .ffmpeg_utils import find_ffmpeg, run, FFmpegError


@dataclass
class CutRange:
  """Half-open [start_sec, end_sec) range in source video."""
  start: float
  end: float

  def __post_init__(self):
    if self.start < 0:
      raise ValueError(f"start must be >= 0, got {self.start}")
    if self.end <= self.start:
      raise ValueError(f"end must be > start, got {self.start}..{self.end}")

  @property
  def duration(self) -> float:
    return self.end - self.start

  def to_dict(self) -> dict:
    return {"start": self.start, "end": self.end}


def trim(
  input_path: str,
  output_path: str,
  start: float,
  end: float,
  *,
  ffmpeg: str | None = None,
  reencode: bool = True,
  audio: bool = True,
) -> str:
  """Trim [start, end) from input and write to output.

  reencode=True re-encodes (accurate cuts, slower).
  reencode=False uses stream copy (fast, but only keyframe-accurate).
  """
  if end <= start:
    raise ValueError(f"end must be > start, got {start}..{end}")
  if start < 0:
    raise ValueError(f"start must be >= 0, got {start}")
  binary = find_ffmpeg(ffmpeg)
  args = [binary, "-y", "-ss", f"{start}", "-i", input_path, "-t", f"{end - start}"]
  if reencode:
    args.extend(["-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
                 "-c:a", "aac" if audio else "copy"])
  else:
    args.extend(["-c", "copy"])
  if not audio:
    args.extend(["-an"])
  args.append(output_path)
  run(args, timeout=600)
  return output_path


def concat(
  input_paths: list[str],
  output_path: str,
  *,
  ffmpeg: str | None = None,
  method: str = "filter",
) -> str:
  """Concatenate multiple video files into one.

  method="filter" uses filter_complex (re-encodes, handles different codecs).
  method="demuxer" uses the concat demuxer (stream copy, requires same codec).
  """
  if not input_paths:
    raise ValueError("concat: input_paths is empty")
  binary = find_ffmpeg(ffmpeg)

  if method == "demuxer":
    # Write a concat list file (UTF-8 so non-ASCII paths work on Windows).
    # V-33 fix: the demuxer format is just `file '<path>'` — no shell-style
    # escape is needed. The previous `'\''` substitution corrupted paths
    # containing apostrophes (e.g. C:\Users\O'Brien\foo.mp4) by writing
    # literal `'\''` chars into the file name.
    list_file = tempfile.mkstemp(suffix=".txt", text=True)[1]
    try:
      with open(list_file, "w", encoding="utf-8") as f:
        for p in input_paths:
          # Demuxer wants forward slashes; it doesn't understand backslashes
          normalized = os.path.abspath(p).replace("\\", "/")
          f.write(f"file '{normalized}'\n")
      args = [binary, "-y", "-f", "concat", "-safe", "0", "-i", list_file,
              "-c", "copy", output_path]
      run(args, timeout=600)
    finally:
      try:
        os.unlink(list_file)
      except OSError:
        pass
  elif method == "filter":
    inputs = []
    for p in input_paths:
      inputs.extend(["-i", p])
    n = len(input_paths)
    filter_parts = "".join(f"[{i}:v][{i}:a]" for i in range(n))
    filter_str = f"{filter_parts}concat=n={n}:v=1:a=1[v][a]"
    args = [binary, "-y", *inputs,
            "-filter_complex", filter_str,
            "-map", "[v]", "-map", "[a]",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
            "-c:a", "aac", "-b:a", "128k",
            output_path]
    run(args, timeout=600)
  else:
    raise ValueError(f"unknown concat method: {method!r}")
  return output_path


def cut_segments(
  input_path: str,
  output_path: str,
  ranges: list[CutRange],
  *,
  ffmpeg: str | None = None,
) -> str:
  """Cut multiple [start, end) segments and concat into a single output.

  Strategy: trim each range to a temp file (re-encoded for clean PTS), then
  concat via the demuxer. More reliable than filter_complex concat, which can
  drop frames when input streams have mismatched PTS start times.
  """
  if not ranges:
    raise ValueError("cut_segments: ranges is empty")

  tmpdir = Path(output_path).parent / "_vireo_cut_tmp"
  tmpdir.mkdir(exist_ok=True)
  try:
    segment_paths: list[str] = []
    for i, r in enumerate(ranges):
      seg = tmpdir / f"seg_{i:04d}.mp4"
      trim(input_path, str(seg), start=r.start, end=r.end, ffmpeg=ffmpeg, reencode=True)
      segment_paths.append(str(seg))
    concat(segment_paths, output_path, ffmpeg=ffmpeg, method="filter")
  finally:
    # Cleanup temp files
    for p in tmpdir.glob("seg_*.mp4"):
      try:
        p.unlink()
      except OSError:
        pass
    try:
      tmpdir.rmdir()
    except OSError:
      pass
  return output_path


def detect_silences(
  input_path: str,
  *,
  noise_db: float = -30.0,
  min_silence_sec: float = 0.5,
  ffmpeg: str | None = None,
) -> list[CutRange]:
  """Find silent runs in the audio track.

  Returns the SILENT ranges (use these to drop).
  noise_db: threshold in dB; lower = keep more (default -30dB is a good cut point).
  min_silence_sec: minimum duration to count as silence.

  Uses ffmpeg's silencedetect filter.
  """
  binary = find_ffmpeg(ffmpeg)
  args = [
    binary, "-hide_banner", "-nostats", "-i", input_path,
    "-af", f"silencedetect=noise={noise_db}dB:d={min_silence_sec}",
    "-f", "null", "-",
  ]
  proc = run(args, check=False, timeout=300)
  if proc.returncode != 0:
    raise FFmpegError("silencedetect failed", proc.returncode, proc.stderr or "")

  stderr = proc.stderr.decode("utf-8", errors="replace") if isinstance(proc.stderr, bytes) else (proc.stderr or "")
  # Lines look like: "[silencedetect @ 0x...] silence_start: 1.234"
  #                   "[silencedetect @ 0x...] silence_end: 2.567 | silence_duration: 1.333"
  starts: list[float] = []
  ends: list[float] = []
  re_start = re.compile(r"silence_start:\s*(-?\d+\.?\d*)")
  re_end = re.compile(r"silence_end:\s*(-?\d+\.?\d*)")
  for line in stderr.splitlines():
    m = re_start.search(line)
    if m:
      starts.append(float(m.group(1)))
      continue
    m = re_end.search(line)
    if m:
      ends.append(float(m.group(1)))
  # Pair them; if a silence runs to EOF, end = last known
  silences: list[CutRange] = []
  for i, s in enumerate(starts):
    e = ends[i] if i < len(ends) else s + min_silence_sec
    silences.append(CutRange(start=s, end=e))
  return silences


def remove_silences(
  input_path: str,
  output_path: str,
  *,
  noise_db: float = -30.0,
  min_silence_sec: float = 0.5,
  pad_sec: float = 0.0,
  ffmpeg: str | None = None,
) -> tuple[str, list[CutRange], list[CutRange]]:
  """Remove silent runs and concat the remaining speech.

  pad_sec: keep this much silence around speech (smooths the cut).
  Returns (output_path, kept_ranges, dropped_ranges).
  """
  info = _probe_duration(input_path)
  total = info["duration_sec"]
  silences = detect_silences(input_path, noise_db=noise_db,
                             min_silence_sec=min_silence_sec, ffmpeg=ffmpeg)
  # Pad silences (so we keep a bit of natural pause)
  padded: list[CutRange] = []
  for s in silences:
    ns = max(0.0, s.start - pad_sec)
    ne = min(total, s.end + pad_sec)
    padded.append(CutRange(start=ns, end=ne))

  # Invert silences -> kept ranges
  kept: list[CutRange] = []
  cursor = 0.0
  for s in padded:
    if s.start > cursor:
      kept.append(CutRange(start=cursor, end=s.start))
    cursor = max(cursor, s.end)
  if cursor < total:
    kept.append(CutRange(start=cursor, end=total))

  if not kept:
    raise FFmpegError("remove_silences: nothing left to keep", 0, "")

  cut_segments(input_path, output_path, kept, ffmpeg=ffmpeg)
  return output_path, kept, padded


def _probe_duration(input_path: str) -> dict:
  """Thin wrapper that returns just what we need from probe()."""
  from .ffmpeg_utils import probe
  return probe(input_path)
