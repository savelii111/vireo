"""Audio style analyzer: extract volume/silence/music features.

Detects:
  - Average volume (loudness proxy)
  - Dynamic range (max vs min volume)
  - Silence ratio (how much of the audio is silent)
  - Music presence (constant low-frequency energy)
  - Speech density (when combined with transcript: words per minute)

This is used to replicate a creator's "audio signature":
  - Loud + dynamic = podcast style
  - Loud + low silence = content with constant music
  - Quiet + high silence = contemplative vlog
"""

from __future__ import annotations
import re
import statistics
import subprocess
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Optional

from .ffmpeg_utils import find_ffmpeg, find_ffprobe, run, probe, FFmpegError


@dataclass
class AudioStyle:
  """Aggregated audio style from a video."""
  duration_sec: float = 0.0
  # Volume stats (dB, ffmpeg volumedetect)
  mean_volume_db: float = 0.0
  max_volume_db: float = 0.0
  min_volume_db: float = 0.0
  # Silence detection
  silence_ratio: float = 0.0     # 0..1, fraction of audio that is silent
  avg_silence_run_sec: float = 0.0
  num_silences: int = 0
  # Music presence (heuristic: constant low-frequency energy = music)
  music_likely: bool = False
  music_evidence: str = ""
  # Speech density (filled in by analyze_audio + transcript if available)
  words_per_minute: float = 0.0

  def to_dict(self) -> dict:
    return asdict(self)


def analyze_volume(video_path: str, *, ffmpeg: str | None = None) -> dict[str, float]:
  """Run ffmpeg's volumedetect filter to get mean/max/min volume in dB."""
  binary = find_ffmpeg(ffmpeg)
  args = [
    binary, "-i", video_path,
    "-af", "volumedetect",
    "-vn", "-f", "null", "-",
  ]
  proc = run(args, check=False, timeout=120, ffmpeg=binary)
  stderr = proc.stderr.decode("utf-8", errors="replace") if isinstance(proc.stderr, bytes) else (proc.stderr or "")
  result: dict[str, float] = {"mean": 0.0, "max": 0.0, "min": 0.0}
  for line in stderr.splitlines():
    if "mean_volume:" in line:
      m = re.search(r"mean_volume:\s*([-\d.]+)\s*dB", line)
      if m: result["mean"] = float(m.group(1))
    elif "max_volume:" in line:
      m = re.search(r"max_volume:\s*([-\d.]+)\s*dB", line)
      if m: result["max"] = float(m.group(1))
    elif "min_volume:" in line:
      m = re.search(r"min_volume:\s*([-\d.]+)\s*dB", line)
      if m: result["min"] = float(m.group(1))
  return result


def analyze_silence(
  video_path: str,
  *,
  noise_db: float = -30.0,
  min_silence_sec: float = 0.5,
  ffmpeg: str | None = None,
) -> tuple[float, int, float]:
  """Run ffmpeg's silencedetect and return (silence_ratio, num_silences, avg_run)."""
  binary = find_ffmpeg(ffmpeg)
  args = [
    binary, "-i", video_path,
    "-af", f"silencedetect=noise={noise_db}dB:d={min_silence_sec}",
    "-vn", "-f", "null", "-",
  ]
  proc = run(args, check=False, timeout=120, ffmpeg=binary)
  stderr = proc.stderr.decode("utf-8", errors="replace") if isinstance(proc.stderr, bytes) else (proc.stderr or "")
  starts: list[float] = []
  ends: list[float] = []
  re_start = re.compile(r"silence_start:\s*(-?\d+\.?\d*)")
  re_end = re.compile(r"silence_end:\s*(-?\d+\.?\d*)")
  for line in stderr.splitlines():
    ms = re_start.search(line)
    if ms: starts.append(float(ms.group(1)))
    me = re_end.search(line)
    if me: ends.append(float(me.group(1)))

  info = probe(video_path)
  total = info.get("duration_sec", 0)
  if total <= 0:
    return (0.0, 0, 0.0)

  total_silence = 0.0
  for i, s in enumerate(starts):
    e = ends[i] if i < len(ends) else s + min_silence_sec
    total_silence += max(0.0, e - s)
  silence_ratio = min(1.0, total_silence / total) if total > 0 else 0.0
  avg_run = (total_silence / max(1, len(starts)))
  return (silence_ratio, len(starts), avg_run)


def detect_music(video_path: str, *, ffmpeg: str | None = None) -> tuple[bool, str]:
  """Heuristic: detect if music is likely present.

  Music characteristics (vs speech only):
  - More constant RMS energy over time (less variance)
  - More low-frequency content
  - Less silence ratio

  We compute a few simple stats and combine them. Returns (is_music, evidence).
  """
  binary = find_ffmpeg(ffmpeg)
  # Use the astats filter to get RMS variance
  args = [
    binary, "-i", video_path,
    "-af", "astats=metadata=1:reset=1,ametadata=print:file=-",
    "-vn", "-f", "null", "-",
  ]
  proc = run(args, check=False, timeout=120, ffmpeg=binary)
  # RMS levels in dB at intervals
  stdout = proc.stdout.decode("utf-8", errors="replace") if isinstance(proc.stdout, bytes) else (proc.stdout or "")
  rms_values: list[float] = []
  pattern = re.compile(r"RMS_level=([-\d.]+)")
  for line in stdout.splitlines():
    m = pattern.search(line)
    if m:
      try:
        rms_values.append(float(m.group(1)))
      except ValueError:
        pass
  if len(rms_values) < 3:
    return (False, "insufficient audio data")

  # Music tends to have lower variance in RMS (more constant loudness)
  mean_rms = statistics.mean(rms_values)
  std_rms = statistics.stdev(rms_values) if len(rms_values) > 1 else 0.0

  # Heuristics:
  # 1. Mean RMS > -40 dB (audible content, not just silence)
  # 2. Stddev of RMS < 8 dB (constant loudness = music or steady narration)
  # 3. Few very-quiet frames (< -50 dB)
  quiet_frames = sum(1 for r in rms_values if r < -50)
  quiet_ratio = quiet_frames / len(rms_values) if rms_values else 0

  evidence_parts: list[str] = []
  is_music = False
  if mean_rms > -40 and std_rms < 8:
    is_music = True
    evidence_parts.append(f"steady loudness (mean {mean_rms:.1f} dB, std {std_rms:.1f} dB)")
  if quiet_ratio < 0.1 and mean_rms > -35:
    is_music = True
    evidence_parts.append(f"few quiet frames ({quiet_ratio:.0%})")
  return (is_music, "; ".join(evidence_parts) or "no music signature detected")


def analyze_audio(
  video_path: str,
  *,
  transcript_words: int = 0,
  ffmpeg: str | None = None,
) -> AudioStyle:
  """Full audio style analysis."""
  vol = analyze_volume(video_path, ffmpeg=ffmpeg)
  silence_ratio, n_sil, avg_silence = analyze_silence(video_path, ffmpeg=ffmpeg)
  is_music, music_ev = detect_music(video_path, ffmpeg=ffmpeg)
  info = probe(video_path)
  duration = info.get("duration_sec", 0)

  wpm = (transcript_words / (duration / 60.0)) if duration > 0 and transcript_words > 0 else 0.0

  return AudioStyle(
    duration_sec=duration,
    mean_volume_db=vol.get("mean", 0.0),
    max_volume_db=vol.get("max", 0.0),
    min_volume_db=vol.get("min", 0.0),
    silence_ratio=round(silence_ratio, 3),
    avg_silence_run_sec=round(avg_silence, 2),
    num_silences=n_sil,
    music_likely=is_music,
    music_evidence=music_ev,
    words_per_minute=round(wpm, 1),
  )
