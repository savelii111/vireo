"""Tests for cutter.py — trim, concat, silence detection/removal."""

import os
import json
import subprocess
import pytest
from pathlib import Path
from vireo_video.cutter import (
  CutRange, trim, concat, cut_segments, detect_silences, remove_silences,
)
from vireo_video.ffmpeg_utils import find_ffmpeg, find_ffprobe, probe

FIXTURES = Path(__file__).parent / "fixtures"
TMP = Path(__file__).parent / "tmp_cutter"


def _make_with_silences(out_path: Path) -> Path:
  """Generate a 10s test video: 2s tone, 1s silence, 2s tone, 1s silence, 4s tone.

  Strategy: build 5 small files then concat with the demuxer.
  1. 2s blue + 2s 440Hz sine  -> seg1.mp4
  2. 1s red + 1s anullsrc       -> seg2.mp4
  3. 2s green + 2s 440Hz sine   -> seg3.mp4
  4. 1s yellow + 1s anullsrc    -> seg4.mp4
  5. 4s cyan + 4s 440Hz sine    -> seg5.mp4
  Then concat with the demuxer.
  """
  ffmpeg = find_ffmpeg()
  tmp = out_path.parent
  segs = []
  for i, (color, dur, audio) in enumerate([
    ("blue",   2, "sine=frequency=440:duration=2"),
    ("red",    1, "anullsrc=duration=1"),
    ("green",  2, "sine=frequency=440:duration=2"),
    ("yellow", 1, "anullsrc=duration=1"),
    ("cyan",   4, "sine=frequency=440:duration=4"),
  ]):
    p = tmp / f"seg{i}.mp4"
    cmd = [
      ffmpeg, "-y",
      "-f", "lavfi", "-i", f"color=c={color}:s=320x240:d={dur}:r=24",
      "-f", "lavfi", "-i", audio,
      "-c:v", "libx264", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-shortest",
      str(p),
    ]
    subprocess.run(cmd, capture_output=True, check=True, timeout=60)
    segs.append(p)
  # Concat via demuxer (paths in list file are relative to the list file's dir)
  list_file = tmp / "_concat_list.txt"
  list_file.write_text(
    "\n".join(f"file '{p.name}'" for p in segs) + "\n",
    encoding="ascii",
  )
  cmd = [
    ffmpeg, "-y", "-f", "concat", "-safe", "0",
    "-i", str(list_file),
    "-c", "copy",
    str(out_path),
  ]
  subprocess.run(cmd, capture_output=True, check=True, timeout=60)
  list_file.unlink(missing_ok=True)
  return out_path


@pytest.fixture(scope="module", autouse=True)
def setup_tmp():
  TMP.mkdir(exist_ok=True)
  yield
  # leave tmp for inspection


@pytest.fixture
def silences_video():
  out = TMP / "silences.mp4"
  if not out.exists():
    _make_with_silences(out)
  return out


# ----- CutRange -----

def test_cutrange_validates():
  with pytest.raises(ValueError):
    CutRange(start=-1, end=5)
  with pytest.raises(ValueError):
    CutRange(start=5, end=5)
  with pytest.raises(ValueError):
    CutRange(start=10, end=5)
  r = CutRange(start=2.0, end=5.5)
  assert r.duration == 3.5


def test_cutrange_to_dict():
  r = CutRange(start=1.5, end=3.0)
  d = r.to_dict()
  assert d == {"start": 1.5, "end": 3.0}


# ----- trim -----

def test_trim_basic(silences_video):
  out = TMP / "trim_2_4.mp4"
  if out.exists(): out.unlink()
  trim(str(silences_video), str(out), start=2.0, end=4.0)
  assert out.exists()
  info = probe(str(out))
  assert 1.8 < info["duration_sec"] < 2.2


def test_trim_start_at_zero(silences_video):
  out = TMP / "trim_0_3.mp4"
  if out.exists(): out.unlink()
  trim(str(silences_video), str(out), start=0, end=3.0)
  info = probe(str(out))
  assert 2.8 < info["duration_sec"] < 3.2


def test_trim_invalid_range_raises():
  with pytest.raises(ValueError):
    trim("input.mp4", "out.mp4", start=5, end=3)


# ----- concat -----

def test_concat_two_clips(silences_video):
  out = TMP / "concat_2.mp4"
  if out.exists(): out.unlink()
  # Two short clips: 0-1 and 5-6
  a = TMP / "a.mp4"
  b = TMP / "b.mp4"
  trim(str(silences_video), str(a), start=0, end=1)
  trim(str(silences_video), str(b), start=5, end=6)
  concat([str(a), str(b)], str(out), method="filter")
  info = probe(str(out))
  assert 1.8 < info["duration_sec"] < 2.4


def test_concat_demuxer(silences_video):
  out = TMP / "concat_demuxer.mp4"
  if out.exists(): out.unlink()
  a = TMP / "da.mp4"
  b = TMP / "db.mp4"
  # Use stream copy for demuxer (same codec)
  trim(str(silences_video), str(a), start=0, end=1, reencode=False)
  trim(str(silences_video), str(b), start=5, end=6, reencode=False)
  # The concat() function writes its own list file with absolute paths
  concat([str(a), str(b)], str(out), method="demuxer")
  assert out.exists()
  info = probe(str(out))
  assert 1.5 < info["duration_sec"] < 2.5


def test_concat_empty_raises():
  with pytest.raises(ValueError):
    concat([], "out.mp4")


# ----- cut_segments -----

def test_cut_segments_multiple_ranges(silences_video):
  out = TMP / "segments.mp4"
  if out.exists(): out.unlink()
  # Take 0-2 and 5-7 (should skip the 2-3 silence and 7-8 silence)
  ranges = [CutRange(0, 2), CutRange(5, 7)]
  cut_segments(str(silences_video), str(out), ranges)
  info = probe(str(out))
  # Each range is 2s, total ~4s
  assert 3.5 < info["duration_sec"] < 4.5


def test_cut_segments_empty_raises():
  with pytest.raises(ValueError):
    cut_segments("input.mp4", "out.mp4", [])


# ----- silence detection -----

def test_detect_silences_finds_gaps(silences_video):
  silences = detect_silences(str(silences_video), noise_db=-25, min_silence_sec=0.5)
  # We have 2 silence runs of 1 second each (at ~2s and ~7s)
  assert len(silences) >= 1
  # Each detected silence should be roughly 1 second
  for s in silences:
    assert s.duration >= 0.4
    assert s.duration < 1.6


def test_remove_silences_shortens(silences_video):
  out = TMP / "no_silences.mp4"
  if out.exists(): out.unlink()
  out_path, kept, dropped = remove_silences(str(silences_video), str(out), noise_db=-25, min_silence_sec=0.5)
  assert out_path == str(out)
  assert len(kept) >= 1
  assert len(dropped) >= 1
  info = probe(out_path)
  # 10s original minus ~2s silence = ~8s kept
  assert 6.5 < info["duration_sec"] < 9.5
