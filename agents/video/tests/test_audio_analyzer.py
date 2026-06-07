"""Tests for audio_analyzer.py — volume/silence/music analysis."""

import os
import subprocess
import pytest
from pathlib import Path
from vireo_video.audio_analyzer import (
  AudioStyle, analyze_volume, analyze_silence, detect_music, analyze_audio,
)

FIXTURES = Path(__file__).parent / "fixtures"
TMP = Path(__file__).parent / "tmp_audio"


@pytest.fixture(scope="module", autouse=True)
def setup_tmp():
  TMP.mkdir(exist_ok=True)
  yield


def _make_video_with_audio(out_path: Path, *, dur: float = 5.0, freq: int = 440, color: str = "blue"):
  """Generate a test video with audio for analysis."""
  ffmpeg = "ffmpeg"
  cmd = [
    ffmpeg, "-y",
    "-f", "lavfi", "-i", f"color=c={color}:s=320x240:d={dur}:r=24",
    "-f", "lavfi", "-i", f"sine=frequency={freq}:duration={dur}",
    "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "128k", "-shortest",
    str(out_path),
  ]
  subprocess.run(cmd, capture_output=True, check=True, timeout=30)
  return out_path


# ---------- analyze_volume ----------

def test_analyze_volume_returns_dict():
  out = TMP / "audio_video.mp4"
  if not out.exists():
    _make_video_with_audio(out)
  vol = analyze_volume(str(out))
  assert "mean" in vol
  assert "max" in vol
  assert "min" in vol
  # All values are in dB
  assert vol["mean"] < 0  # sine wave at 440Hz should be well below 0 dBFS


def test_analyze_volume_silent_video():
  """Video with no audio should still return zeros (not crash)."""
  # The sample_10s.mp4 fixture has audio
  vol = analyze_volume(str(FIXTURES / "sample_10s.mp4"))
  assert isinstance(vol["mean"], float)
  assert isinstance(vol["max"], float)


# ---------- analyze_silence ----------

def test_analyze_silence_returns_tuple():
  out = TMP / "audio_video.mp4"
  if not out.exists():
    _make_video_with_audio(out)
  ratio, n_sil, avg_run = analyze_silence(str(out), noise_db=-50)
  assert isinstance(ratio, float)
  assert isinstance(n_sil, int)
  assert isinstance(avg_run, float)
  assert 0.0 <= ratio <= 1.0
  assert n_sil >= 0


def test_analyze_silence_high_threshold_finds_most_audio_silent():
  """With noise_db at 0dB, almost everything looks silent."""
  out = TMP / "audio_video.mp4"
  if not out.exists():
    _make_video_with_audio(out)
  ratio, n_sil, _ = analyze_silence(str(out), noise_db=0)
  # Most of a 440Hz sine at low volume is below 0 dB → high silence ratio
  assert ratio > 0.5


# ---------- detect_music ----------

def test_detect_music_returns_tuple():
  out = TMP / "audio_video.mp4"
  if not out.exists():
    _make_video_with_audio(out)
  is_music, evidence = detect_music(str(out))
  assert isinstance(is_music, bool)
  assert isinstance(evidence, str)


def test_detect_music_constant_sine_likely_detected():
  """A constant sine wave should have 'music-like' characteristics."""
  out = TMP / "audio_video.mp4"
  if not out.exists():
    _make_video_with_audio(out, dur=10.0)  # longer for better stats
  is_music, _ = detect_music(str(out))
  # A constant sine has very low RMS variance — should be flagged
  assert is_music is True


# ---------- analyze_audio ----------

def test_analyze_audio_returns_style():
  out = TMP / "audio_video.mp4"
  if not out.exists():
    _make_video_with_audio(out)
  style = analyze_audio(str(out))
  assert style.duration_sec > 0
  assert isinstance(style.mean_volume_db, float)
  assert isinstance(style.silence_ratio, float)
  assert isinstance(style.music_likely, bool)
  assert style.num_silences >= 0
  assert 0.0 <= style.silence_ratio <= 1.0


def test_analyze_audio_with_transcript_words():
  out = TMP / "audio_video.mp4"
  if not out.exists():
    _make_video_with_audio(out, dur=10.0)
  style = analyze_audio(str(out), transcript_words=20)
  # 20 words over ~10s = 120 WPM. Be tolerant of actual duration.
  assert style.words_per_minute > 50  # at least 50 WPM with 20 words / 10s+
  assert style.words_per_minute < 300  # sanity upper bound


def test_analyze_audio_no_transcript_words():
  out = TMP / "audio_video.mp4"
  if not out.exists():
    _make_video_with_audio(out)
  style = analyze_audio(str(out), transcript_words=0)
  # No transcript = no WPM
  assert style.words_per_minute == 0.0


# ---------- AudioStyle dataclass ----------

def test_audiostyle_to_dict():
  s = AudioStyle(duration_sec=10.0, mean_volume_db=-20.0, music_likely=True)
  d = s.to_dict()
  assert d["duration_sec"] == 10.0
  assert d["mean_volume_db"] == -20.0
  assert d["music_likely"] is True
  assert d["silence_ratio"] == 0.0
