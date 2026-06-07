"""Tests for style_transfer.py — apply StyleProfile to a new video."""

import os
import pytest
from pathlib import Path
from vireo_video.style_profile import StyleProfile
from vireo_video.style_transfer import (
  TransferOptions, apply_color_from_profile, match_pacing, apply_style,
  _copy_video,
)
from vireo_video.ffmpeg_utils import probe

FIXTURES = Path(__file__).parent / "fixtures"
TMP = Path(__file__).parent / "tmp_transfer"


@pytest.fixture(scope="module", autouse=True)
def setup_tmp():
  TMP.mkdir(exist_ok=True)
  yield


# ---------- apply_color_from_profile ----------

def test_apply_color_from_profile_warm():
  src = str(FIXTURES / "sample_10s.mp4")
  out = str(TMP / "warm_transfer.mp4")
  if os.path.exists(out): os.unlink(out)
  profile = StyleProfile(recommended_look="warm", look_confidence=0.8)
  apply_color_from_profile(src, out, profile)
  assert os.path.exists(out)


def test_apply_color_from_profile_cinematic():
  src = str(FIXTURES / "sample_10s.mp4")
  out = str(TMP / "cinematic_transfer.mp4")
  if os.path.exists(out): os.unlink(out)
  profile = StyleProfile(recommended_look="cinematic", look_confidence=0.8)
  apply_color_from_profile(src, out, profile)
  assert os.path.exists(out)


def test_apply_color_from_profile_unknown_look_copies():
  """Unknown look should fall back to copy (no crash)."""
  src = str(FIXTURES / "sample_10s.mp4")
  out = str(TMP / "unknown_look.mp4")
  if os.path.exists(out): os.unlink(out)
  profile = StyleProfile(recommended_look="nonexistent_look")
  apply_color_from_profile(src, out, profile)
  assert os.path.exists(out)


def test_apply_color_from_profile_bw():
  src = str(FIXTURES / "sample_10s.mp4")
  out = str(TMP / "bw_transfer.mp4")
  if os.path.exists(out): os.unlink(out)
  profile = StyleProfile(recommended_look="bw", look_confidence=0.9)
  apply_color_from_profile(src, out, profile)
  assert os.path.exists(out)


# ---------- match_pacing ----------

def test_match_pacing_no_op_when_close():
  """Source already close to target cpm — should copy."""
  src = str(FIXTURES / "sample_10s.mp4")
  out = str(TMP / "pacing_noop.mp4")
  if os.path.exists(out): os.unlink(out)
  # Sample fixture has 0 cpm, target 0
  profile = StyleProfile(cuts_per_minute=0.5, avg_shot_length_sec=120.0)
  match_pacing(src, out, profile)
  assert os.path.exists(out)


def test_match_pacing_increases_cuts():
  """If target needs more cuts than source, add some."""
  src = str(FIXTURES / "sample_10s.mp4")
  out = str(TMP / "pacing_more.mp4")
  if os.path.exists(out): os.unlink(out)
  # 10s video with 0 cuts/min source, target 6 cuts/min = 1 cut total
  profile = StyleProfile(cuts_per_minute=6.0, avg_shot_length_sec=10.0)
  match_pacing(src, out, profile)
  assert os.path.exists(out)
  info = probe(out)
  # Duration preserved
  assert 9.5 < info["duration_sec"] < 10.5


# ---------- apply_style (full pipeline) ----------

def test_apply_style_color_only():
  src = str(FIXTURES / "sample_10s.mp4")
  out = str(TMP / "style_color_only.mp4")
  if os.path.exists(out): os.unlink(out)
  profile = StyleProfile(recommended_look="cinematic")
  opts = TransferOptions(
    apply_look=True,
    match_pacing=False,
    apply_zoom=False,
    add_music=False,
  )
  apply_style(src, out, profile, options=opts)
  assert os.path.exists(out)


def test_apply_style_preserve_content():
  src = str(FIXTURES / "sample_10s.mp4")
  out = str(TMP / "style_preserve.mp4")
  if os.path.exists(out): os.unlink(out)
  profile = StyleProfile(recommended_look="warm", cuts_per_minute=10.0)
  opts = TransferOptions(preserve_content=True)
  apply_style(src, out, profile, options=opts)
  assert os.path.exists(out)


def test_apply_style_all_steps():
  src = str(FIXTURES / "sample_10s.mp4")
  out = str(TMP / "style_all.mp4")
  if os.path.exists(out): os.unlink(out)
  profile = StyleProfile(
    recommended_look="cinematic",
    cuts_per_minute=3.0,
    emphasis_per_minute=2.0,
    zoom_max=1.3,
  )
  # No transcript → zoom step skipped
  opts = TransferOptions(
    apply_look=True, match_pacing=True, apply_zoom=True,
  )
  apply_style(src, out, profile, options=opts)
  assert os.path.exists(out)


def test_apply_style_with_transcript_adds_zoom():
  src = str(FIXTURES / "sample_10s.mp4")
  out = str(TMP / "style_with_zoom.mp4")
  if os.path.exists(out): os.unlink(out)
  profile = StyleProfile(
    recommended_look="natural",
    cuts_per_minute=0.5,
    emphasis_per_minute=2.0,
    zoom_max=1.25,
  )
  from vireo_video.transcriber import Transcript, Segment, Word
  t = Transcript(
    text="Today this is a HUGE moment",
    language="en", duration=10.0,
    segments=[Segment(id=0, start=0, end=10, text="...", words=[
      Word("Today", 0, 0.5), Word("this", 0.5, 0.8),
      Word("is", 0.8, 1.0), Word("a", 1.0, 1.1),
      Word("HUGE", 1.1, 1.5),
      Word("moment", 1.5, 2.0),
    ])],
  )
  opts = TransferOptions(apply_look=False, match_pacing=False, apply_zoom=True)
  apply_style(src, out, profile, transcript=t, options=opts)
  assert os.path.exists(out)


def test_apply_style_with_music():
  """Add music to the styled video."""
  # First, create a simple music file
  import subprocess
  music = TMP / "test_music.mp3"
  if not music.exists():
    subprocess.run([
      "ffmpeg", "-y", "-f", "lavfi", "-i", "sine=frequency=220:duration=10",
      "-c:a", "libmp3lame", "-b:a", "128k", str(music),
    ], capture_output=True, check=True, timeout=30)

  src = str(FIXTURES / "sample_10s.mp4")
  out = str(TMP / "style_with_music.mp4")
  if os.path.exists(out): os.unlink(out)
  profile = StyleProfile(recommended_look="natural", music_likely=True)
  opts = TransferOptions(
    apply_look=True, match_pacing=False, apply_zoom=False,
    add_music=True, music_path=str(music), music_volume=0.10,
  )
  apply_style(src, out, profile, options=opts)
  assert os.path.exists(out)
  info = probe(out)
  assert info["has_audio"]


def test_apply_style_cleanup_intermediates():
  """After completion, no temp files should remain in output dir."""
  src = str(FIXTURES / "sample_10s.mp4")
  out = str(TMP / "style_cleanup.mp4")
  if os.path.exists(out): os.unlink(out)
  profile = StyleProfile(recommended_look="warm")
  opts = TransferOptions(apply_look=True, match_pacing=False)
  apply_style(src, out, profile, options=opts)
  # Look for _vireo_style_tmp
  leftover = list(Path(TMP).glob("_vireo_style_tmp"))
  assert leftover == []


# ---------- _copy_video ----------

def test_copy_video_works():
  src = str(FIXTURES / "sample_10s.mp4")
  out = str(TMP / "copy.mp4")
  if os.path.exists(out): os.unlink(out)
  _copy_video(src, out)
  assert os.path.exists(out)
  info = probe(out)
  assert info["duration_sec"] > 9
