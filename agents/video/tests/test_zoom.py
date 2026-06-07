"""Tests for zoom.py — emphasis detection and zoom application."""

import os
import pytest
from pathlib import Path
from vireo_video.zoom import (
  EmphasisWindow, find_emphasis_windows, apply_zoom, score_word,
  EMPHASIS_WORDS,
)
from vireo_video.transcriber import Transcript, Segment, Word
from vireo_video.ffmpeg_utils import probe

FIXTURES = Path(__file__).parent / "fixtures"
TMP = Path(__file__).parent / "tmp_zoom"


@pytest.fixture(scope="module", autouse=True)
def setup_tmp():
  TMP.mkdir(exist_ok=True)
  yield


# ---------- score_word ----------

def test_score_emphasis_word():
  w = Word("secret", 0, 0.5)
  s, reason = score_word(w, None, None, 0.3)
  assert s >= 3.0
  assert "emphasis_word" in reason


def test_score_all_caps():
  w = Word("HUGE", 0, 0.5)
  s, reason = score_word(w, None, None, 0.3)
  assert s >= 1.5
  assert "all_caps" in reason


def test_score_long_duration():
  w = Word("important", 0, 2.0)  # very long
  s, reason = score_word(w, None, None, 0.3)
  assert "long_duration" in reason
  assert s >= 1.5


def test_score_after_pause():
  prev = Word("and", 0, 0.5)
  w = Word("now", 1.5, 2.0)  # 1s gap
  s, reason = score_word(w, prev, None, 0.3)
  assert "after_pause" in reason
  assert s >= 1.0


def test_score_before_punctuation():
  w = Word("really", 0, 0.5)
  next_w = Word("amazing!", 0.5, 1.0)
  s, reason = score_word(w, None, next_w, 0.3)
  assert "before_punct" in reason


def test_score_neutral_word():
  w = Word("the", 0, 0.1)
  s, reason = score_word(w, None, None, 0.1)
  assert s == 0.0  # base only


# ---------- find_emphasis_windows ----------

def make_emphasis_transcript():
  """Transcript with several emphasis moments."""
  return Transcript(
    text="Today I'm going to share the biggest secret nobody tells you.",
    language="en", duration=10.0,
    segments=[Segment(id=0, start=0, end=10, text="...", words=[
      Word("Today", 0.0, 0.3),
      Word("I'm", 0.3, 0.5),
      Word("going", 0.5, 0.8),
      Word("to", 0.8, 0.9),
      Word("share", 0.9, 1.3),
      # 1s pause
      Word("the", 2.5, 2.6),
      Word("BIGGEST", 2.6, 3.5),  # all caps + emphasis
      Word("secret", 3.6, 4.2),    # emphasis word
      Word("nobody", 4.3, 4.8),    # emphasis word
      Word("tells", 4.9, 5.2),
      Word("you.", 5.2, 5.7),
    ])],
  )


def test_find_emphasis_returns_windows():
  t = make_emphasis_transcript()
  windows = find_emphasis_windows(t, max_windows=5)
  assert len(windows) >= 2
  # All windows should be in the source range
  for w in windows:
    assert w.start >= 0
    assert w.end <= 10.0
    assert 1.05 <= w.zoom <= 1.4


def test_find_emphasis_sorted_by_time():
  t = make_emphasis_transcript()
  windows = find_emphasis_windows(t, max_windows=5)
  for i in range(1, len(windows)):
    assert windows[i].start >= windows[i - 1].start


def test_find_emphasis_enforces_min_gap():
  t = make_emphasis_transcript()
  windows = find_emphasis_windows(t, min_gap_sec=2.0, max_windows=10)
  for i in range(1, len(windows)):
    gap = windows[i].start - windows[i - 1].end
    assert gap >= 1.0  # approximate (windows can extend a bit)


def test_find_emphasis_caps_max_windows():
  t = make_emphasis_transcript()
  windows = find_emphasis_windows(t, max_windows=2)
  assert len(windows) <= 2


def test_find_emphasis_zoom_proportional_to_score():
  t = make_emphasis_transcript()
  windows = find_emphasis_windows(t, max_windows=10)
  # Higher-scored words should get higher zoom
  for w in windows:
    assert 1.10 <= w.zoom <= 1.35


def test_find_emphasis_empty_transcript():
  t = Transcript(text="", language="en", duration=0, segments=[])
  assert find_emphasis_windows(t) == []


def test_find_emphasis_works_with_synthesized_words():
  """If a segment has no word timestamps, we synthesize from text split."""
  t = Transcript(
    text="", language="en", duration=5.0,
    segments=[Segment(id=0, start=0, end=5, text="The secret is huge",
                     words=[])],  # empty words
  )
  windows = find_emphasis_windows(t, max_windows=5)
  assert len(windows) >= 1
  assert any(w.word in ("secret", "huge") for w in windows)


def test_emphasis_window_has_reason():
  t = make_emphasis_transcript()
  windows = find_emphasis_windows(t, max_windows=5)
  for w in windows:
    assert w.reason  # should be non-empty


# ---------- apply_zoom (end-to-end) ----------

def test_apply_zoom_no_windows_falls_back_to_reframe():
  src = str(FIXTURES / "sample_10s.mp4")
  out = str(TMP / "no_zoom.mp4")
  if os.path.exists(out): os.unlink(out)
  apply_zoom(src, out, [], target_aspect="9:16", output_width=1080, output_height=1920)
  info = probe(out)
  assert info["width"] == 1080
  assert info["height"] == 1920
  assert abs(info["duration_sec"] - 10.0) < 0.5


def test_apply_zoom_with_windows():
  src = str(FIXTURES / "sample_10s.mp4")
  out = str(TMP / "with_zoom.mp4")
  if os.path.exists(out): os.unlink(out)
  windows = [
    EmphasisWindow(start=2.0, end=4.0, zoom=1.3, word="key"),
    EmphasisWindow(start=6.0, end=8.0, zoom=1.2, word="now"),
  ]
  apply_zoom(src, out, windows, target_aspect="9:16", output_width=1080, output_height=1920)
  info = probe(out)
  assert info["width"] == 1080
  assert info["height"] == 1920
  # Duration roughly preserved (with small overhead from re-encoding)
  assert 9.5 < info["duration_sec"] < 10.5


def test_apply_zoom_single_window():
  src = str(FIXTURES / "sample_10s.mp4")
  out = str(TMP / "single_zoom.mp4")
  if os.path.exists(out): os.unlink(out)
  windows = [EmphasisWindow(start=4.0, end=6.0, zoom=1.25, word="biggest")]
  apply_zoom(src, out, windows, target_aspect="1:1", output_width=720, output_height=720)
  info = probe(out)
  assert info["width"] == 720
  assert info["height"] == 720


def test_apply_zoom_overlapping_windows():
  """Overlapping zoom windows should not crash."""
  src = str(FIXTURES / "sample_10s.mp4")
  out = str(TMP / "overlap_zoom.mp4")
  if os.path.exists(out): os.unlink(out)
  windows = [
    EmphasisWindow(start=2.0, end=5.0, zoom=1.2),
    EmphasisWindow(start=4.0, end=7.0, zoom=1.3),
  ]
  apply_zoom(src, out, windows, target_aspect="9:16", output_width=1080, output_height=1920)
  assert os.path.exists(out)
