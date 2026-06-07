"""Tests for music.py — background music mixing with auto-ducking."""

import os
import subprocess
import pytest
from pathlib import Path
from vireo_video.music import (
  DuckConfig, add_background_music, loop_music_to_duration, mix_music_only, get_duration,
)
from vireo_video.ffmpeg_utils import find_ffmpeg, probe, FFmpegError

FIXTURES = Path(__file__).parent / "fixtures"
TMP = Path(__file__).parent / "tmp_music"


def _make_music(out_path: Path, duration_sec: float = 5.0, freq: int = 220) -> Path:
  """Generate a simple test music track (real MP3)."""
  ffmpeg = find_ffmpeg()
  cmd = [
    ffmpeg, "-y", "-f", "lavfi", "-i", f"sine=frequency={freq}:duration={duration_sec}",
    "-c:a", "libmp3lame", "-b:a", "128k", str(out_path),
  ]
  subprocess.run(cmd, capture_output=True, check=True, timeout=30)
  return out_path


@pytest.fixture(scope="module", autouse=True)
def setup_tmp():
  TMP.mkdir(exist_ok=True)
  yield


@pytest.fixture
def music_file():
  out = TMP / "music.mp3"
  if not out.exists():
    _make_music(out, 5.0)
  return out


@pytest.fixture
def short_music():
  out = TMP / "music_short.mp3"
  if not out.exists():
    _make_music(out, 2.0)
  return out


# ---------- DuckConfig dataclass ----------

def test_duck_config_defaults():
  cfg = DuckConfig()
  assert cfg.base_volume == 0.20
  assert cfg.duck_volume == 0.06
  assert cfg.threshold_db == -30.0
  assert cfg.attack_ms == 200
  assert cfg.release_ms == 800


# ---------- get_duration ----------

def test_get_duration_video():
  d = get_duration(str(FIXTURES / "sample_10s.mp4"))
  assert 9.5 < d < 10.5


def test_get_duration_music(music_file):
  d = get_duration(str(music_file))
  assert 4.5 < d < 5.5


# ---------- loop_music_to_duration ----------

def test_loop_music_short_to_long(music_file, short_music):
  """2s music looped to 10s."""
  out = str(TMP / "looped.mp3")
  if os.path.exists(out): os.unlink(out)
  loop_music_to_duration(str(short_music), 10.0, out)
  info = probe(out)
  assert 9.5 < info["duration_sec"] < 10.5


def test_loop_music_long_trimmed(music_file):
  """Long music trimmed to short target."""
  out = str(TMP / "trimmed.mp3")
  if os.path.exists(out): os.unlink(out)
  loop_music_to_duration(str(music_file), 2.0, out)
  info = probe(out)
  assert 1.8 < info["duration_sec"] < 2.2


# ---------- add_background_music ----------

def test_add_music_basic(music_file):
  src = str(FIXTURES / "sample_10s.mp4")
  out = str(TMP / "with_music.mp4")
  if os.path.exists(out): os.unlink(out)
  add_background_music(src, str(music_file), out, music_volume=0.20)
  assert os.path.exists(out)
  info = probe(out)
  assert info["has_audio"] is True
  assert 9.5 < info["duration_sec"] < 10.5


def test_add_music_with_ducking(music_file):
  src = str(FIXTURES / "sample_10s.mp4")
  out = str(TMP / "ducked.mp4")
  if os.path.exists(out): os.unlink(out)
  add_background_music(src, str(music_file), out, duck=DuckConfig(base_volume=0.20, duck_volume=0.05))
  assert os.path.exists(out)


def test_add_music_low_volume(music_file):
  src = str(FIXTURES / "sample_10s.mp4")
  out = str(TMP / "low_vol.mp4")
  if os.path.exists(out): os.unlink(out)
  add_background_music(src, str(music_file), out, music_volume=0.05)
  assert os.path.exists(out)


def test_add_music_high_volume(music_file):
  src = str(FIXTURES / "sample_10s.mp4")
  out = str(TMP / "high_vol.mp4")
  if os.path.exists(out): os.unlink(out)
  add_background_music(src, str(music_file), out, music_volume=0.8)
  assert os.path.exists(out)


def test_add_music_video_not_found(music_file):
  with pytest.raises(FFmpegError):
    add_background_music("C:/nonexistent.mp4", str(music_file), "out.mp4")


def test_add_music_music_not_found():
  src = str(FIXTURES / "sample_10s.mp4")
  with pytest.raises(FFmpegError):
    add_background_music(src, "C:/nonexistent.mp3", "out.mp4")


def test_add_music_loops_short_music(short_music):
  """2s music looped to 10s video."""
  src = str(FIXTURES / "sample_10s.mp4")
  out = str(TMP / "looped_to_video.mp4")
  if os.path.exists(out): os.unlink(out)
  add_background_music(src, str(short_music), out, music_volume=0.20)
  info = probe(out)
  assert 9.5 < info["duration_sec"] < 10.5


# ---------- mix_music_only ----------

def test_mix_music_only_replaces_audio(music_file):
  src = str(FIXTURES / "sample_10s.mp4")
  out = str(TMP / "music_only.mp4")
  if os.path.exists(out): os.unlink(out)
  mix_music_only(src, str(music_file), out, music_volume=0.5)
  assert os.path.exists(out)
  info = probe(out)
  assert info["has_audio"] is True
