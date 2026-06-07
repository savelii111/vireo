"""Tests for subtitles.py — SRT generation + drawtext burn-in."""

import os
import pytest
from pathlib import Path
from vireo_video.transcriber import Transcript, Segment, Word
from vireo_video.subtitles import (
  SubtitleCue, transcript_to_cues, write_srt, _format_srt_time,
  _build_drawtext_filter, burn_in, SUBTITLE_STYLES,
)
from vireo_video.ffmpeg_utils import probe

FIXTURES = Path(__file__).parent / "fixtures"
TMP = Path(__file__).parent / "tmp_subs"


@pytest.fixture(scope="module", autouse=True)
def setup_tmp():
  TMP.mkdir(exist_ok=True)
  yield


# ---------- SRT time formatting ----------

def test_format_srt_time_zero():
  assert _format_srt_time(0) == "00:00:00,000"


def test_format_srt_time_under_minute():
  assert _format_srt_time(12.345) == "00:00:12,345"


def test_format_srt_time_with_minutes():
  assert _format_srt_time(65.5) == "00:01:05,500"


def test_format_srt_time_with_hours():
  assert _format_srt_time(3725.123) == "01:02:05,123"


def test_format_srt_time_negative_clamped():
  assert _format_srt_time(-1) == "00:00:00,000"


# ---------- SubtitleCue ----------

def test_cue_to_srt():
  c = SubtitleCue(index=1, start=1.5, end=3.0, text="Hello world")
  srt = c.to_srt()
  assert "1" in srt
  assert "00:00:01,500 --> 00:00:03,000" in srt
  assert "Hello world" in srt


# ---------- transcript_to_cues ----------

def make_test_transcript():
  """Transcript with 14 words over 6 seconds."""
  words = [
    Word("Hello", 0.0, 0.5), Word("everyone", 0.5, 1.0),
    Word("and", 1.0, 1.2), Word("welcome", 1.2, 1.7),
    Word("to", 1.7, 1.9), Word("this", 1.9, 2.2),
    Word("amazing", 2.2, 2.8), Word("video", 2.8, 3.3),
    Word("where", 3.3, 3.6), Word("we", 3.6, 3.8),
    Word("explore", 3.8, 4.4), Word("the", 4.4, 4.6),
    Word("world", 4.6, 5.1), Word("of", 5.1, 5.3),
  ]
  return Transcript(
    text=" ".join(w.text for w in words),
    language="en",
    duration=6.0,
    segments=[Segment(id=0, start=0, end=6, text=" ".join(w.text for w in words), words=words)],
  )


def test_transcript_to_cues_basic():
  t = make_test_transcript()
  cues = transcript_to_cues(t, words_per_cue=5)
  assert len(cues) >= 2
  assert all(c.index > 0 for c in cues)
  # No cue should be too long
  assert all(c.duration <= 3.5 for c in cues)  # allow small overshoot for boundaries


def test_transcript_to_cues_preserves_order():
  t = make_test_transcript()
  cues = transcript_to_cues(t, words_per_cue=3)
  for i, c in enumerate(cues):
    assert c.index == i + 1
  # Cues are chronological
  for i in range(1, len(cues)):
    assert cues[i].start >= cues[i-1].start


def test_transcript_to_cues_min_duration():
  t = make_test_transcript()
  cues = transcript_to_cues(t, words_per_cue=20, min_cue_duration=0.8)
  for c in cues:
    assert c.end - c.start >= 0.79  # allow float imprecision


def test_transcript_to_cues_empty_words():
  t = Transcript(text="", language="en", duration=0, segments=[])
  cues = transcript_to_cues(t)
  assert cues == []


def test_transcript_to_cues_segment_without_words_synthesizes():
  t = Transcript(
    text="Single segment no words",
    language="en", duration=5.0,
    segments=[Segment(id=0, start=0, end=5, text="Single segment no words", words=[])],
  )
  cues = transcript_to_cues(t, words_per_cue=3)
  assert len(cues) >= 1
  # The synthesized words were distributed
  text = " ".join(c.text for c in cues)
  assert "Single segment no words" in text


# ---------- write_srt ----------

def test_write_srt(tmp_path):
  cues = [
    SubtitleCue(index=1, start=0, end=2, text="First"),
    SubtitleCue(index=2, start=2.5, end=5, text="Second line"),
  ]
  out = tmp_path / "test.srt"
  write_srt(cues, str(out))
  content = out.read_text(encoding="utf-8")
  assert content.count("-->") == 2
  assert "First" in content
  assert "Second line" in content
  assert content.endswith("\n")


# ---------- drawtext filter ----------

def test_build_drawtext_basic():
  f = _build_drawtext_filter("Hello", 1.0, 3.0, 1920, 1080, SUBTITLE_STYLES["default"])
  assert f.startswith("drawtext=")
  assert "text='Hello'" in f
  assert "enable='between(t,1.0,3.0)'" in f


def test_build_drawtext_escapes_special_chars():
  f = _build_drawtext_filter("it's: 50%", 0, 5, 1280, 720, SUBTITLE_STYLES["default"])
  # Single quote escaped, percent doubled
  assert "\\'" in f
  assert "%%" in f
  assert "\\:" in f


def test_build_drawtext_position_top():
  f = _build_drawtext_filter("X", 0, 1, 1920, 1080, SUBTITLE_STYLES["default"])
  # default style is bottom -> y=h-text_h-margin_v
  assert "y=h-text_h-60" in f


def test_build_drawtext_position_middle():
  f = _build_drawtext_filter("X", 0, 1, 1920, 1080, SUBTITLE_STYLES["tiktok"])
  # tiktok style is middle -> y=(h-text_h)/2
  assert "y=(h-text_h)/2" in f


def test_build_drawtext_with_box():
  f = _build_drawtext_filter("X", 0, 1, 1920, 1080, SUBTITLE_STYLES["default"])
  # default has box=1
  assert "box=1" in f
  assert "boxcolor=black@0.5" in f


def test_build_drawtext_no_box():
  f = _build_drawtext_filter("X", 0, 1, 1920, 1080, SUBTITLE_STYLES["tiktok"])
  # tiktok has box_color=black@0.0 -> no box
  assert "box=1" not in f


# ---------- burn_in (end-to-end with real ffmpeg) ----------

def test_burn_in_basic():
  src = str(FIXTURES / "sample_10s.mp4")
  out = str(TMP / "subs.mp4")
  if os.path.exists(out): os.unlink(out)
  cues = [
    SubtitleCue(index=1, start=1.0, end=4.0, text="First subtitle"),
    SubtitleCue(index=2, start=5.0, end=8.0, text="Second subtitle"),
  ]
  burn_in(src, out, cues, style="default")
  assert os.path.exists(out)
  info = probe(out)
  assert info["width"] == 1280
  assert info["height"] == 720
  # Duration should be roughly preserved
  assert 9.5 < info["duration_sec"] < 10.5


def test_burn_in_empty_cues_raises():
  with pytest.raises(ValueError):
    burn_in("dummy.mp4", "out.mp4", [])


def test_burn_in_style_tiktok():
  src = str(FIXTURES / "sample_10s.mp4")
  out = str(TMP / "subs_tiktok.mp4")
  if os.path.exists(out): os.unlink(out)
  cues = [SubtitleCue(index=1, start=1.0, end=4.0, text="Hello world")]
  burn_in(src, out, cues, style="tiktok")
  assert os.path.exists(out)
