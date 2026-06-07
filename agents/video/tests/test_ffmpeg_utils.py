"""Tests for ffmpeg_utils: binary discovery, run, probe, escaping."""

import os
import json
import pytest
import subprocess
from pathlib import Path
from vireo_video.ffmpeg_utils import (
  find_ffmpeg, find_ffprobe, version, run, probe, escape_filter_path,
  escape_drawtext, FFmpegError,
)

FIXTURES = Path(__file__).parent / "fixtures"


def test_find_ffmpeg_returns_path():
  p = find_ffmpeg()
  assert p
  assert Path(p).exists()
  assert "ffmpeg" in p.lower()


def test_find_ffmpeg_explicit_missing_raises():
  with pytest.raises(FFmpegError):
    find_ffmpeg(explicit="C:/nonexistent/ffmpeg.exe")


def test_find_ffmpeg_env_var(monkeypatch):
  real = find_ffmpeg()
  # If env points to real binary, use it
  monkeypatch.setenv("VIREO_FFMPEG", real)
  assert find_ffmpeg() == real
  # Bad env path falls back to PATH (not error)
  monkeypatch.setenv("VIREO_FFMPEG", "C:/nonexistent/ffmpeg.exe")
  assert find_ffmpeg() == real


def test_find_ffprobe():
  p = find_ffprobe()
  assert p and "ffprobe" in p.lower()


def test_version_returns_string():
  v = version(find_ffmpeg())
  assert v.startswith("ffmpeg version")


def test_run_simple_ffmpeg_help():
  proc = run(["ffmpeg", "-version"], check=True)
  assert proc.returncode == 0
  assert b"ffmpeg version" in proc.stdout


def test_run_with_check_raises_on_failure():
  with pytest.raises(FFmpegError) as exc:
    run(["ffmpeg", "-nonexistent_flag_xyz"], check=True)
  assert exc.value.returncode != 0


def test_run_timeout(monkeypatch):
  with pytest.raises(FFmpegError) as exc:
    run(
      ["ffmpeg", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=60",
       "-t", "1", os.devnull],
      timeout=2,
    )
  # On Windows, subprocess.TimeoutExpired maps to non-zero (often -1 or large unsigned)
  assert exc.value.returncode != 0


def test_probe_returns_video_info():
  info = probe(str(FIXTURES / "sample_10s.mp4"))
  assert info["width"] == 1280
  assert info["height"] == 720
  assert abs(info["duration_sec"] - 10.0) < 0.5
  assert info["fps"] == 30.0
  assert info["has_video"] is True
  assert info["has_audio"] is True
  assert info["video_codec"] == "h264"


def test_probe_missing_file_raises():
  with pytest.raises(FFmpegError):
    probe("C:/no/such/file.mp4")


def test_escape_filter_path_windows():
  p = r"C:\Users\vireo\file.mp4"
  out = escape_filter_path(p)
  # Now wrapped in single quotes for the most permissive parsers
  assert out.startswith("'")
  assert out.endswith("'")
  # Inside: drive letter with colon escaped
  assert r"C\:" in out
  # All backslashes are now forward slashes
  assert "/Users/vireo/file.mp4" in out
  # No raw Windows backslashes after the C: escape
  assert r"C:\Users" not in out


def test_escape_filter_path_quote():
  p = "path/with'quote.mp4"
  out = escape_filter_path(p)
  # Single quote should be escaped
  assert "\\'" in out


def test_escape_drawtext_basic():
  assert escape_drawtext("hello") == "hello"
  assert escape_drawtext("a:b") == "a\\:b"
  assert escape_drawtext("it's") == "it\\'s"
  assert escape_drawtext("50%") == "50%%"
  assert escape_drawtext("back\\slash") == "back\\\\slash"
