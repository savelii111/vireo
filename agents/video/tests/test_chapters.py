"""Tests for chapters.py — long-form chapter detection."""

import json
import pytest
from vireo_video.chapters import (
  Chapter, ChapterDetector, build_chapter_prompt, parse_chapters_response,
  validate_chapters,
)
from vireo_video.transcriber import Transcript, Segment


def make_long_transcript(duration_sec: float = 1800.0, n_segments: int = 60):
  """Generate a 30-min fake transcript for long-form testing."""
  seg_dur = duration_sec / n_segments
  segments = []
  for i in range(n_segments):
    text = f"This is segment {i} discussing topic {i % 5} of the video."
    segments.append(Segment(
      id=i,
      start=i * seg_dur,
      end=(i + 1) * seg_dur,
      text=text,
    ))
  return Transcript(
    text=" ".join(s.text for s in segments),
    language="en",
    duration=duration_sec,
    segments=segments,
  )


# ---------- Chapter dataclass ----------

def test_chapter_duration_property():
  c = Chapter(start=10, end=30, title="X")
  assert c.duration == 20


def test_chapter_to_dict():
  c = Chapter(start=0, end=60, title="Intro", summary="Welcome")
  d = c.to_dict()
  assert d["title"] == "Intro"
  assert d["summary"] == "Welcome"


# ---------- build_chapter_prompt ----------

def test_prompt_contains_transcript():
  t = make_long_transcript(120)
  p = build_chapter_prompt(t)
  assert "120" in p  # duration
  assert "transcript" in p.lower() or "TRANSCRIPT" in p


def test_prompt_truncates_long_transcripts():
  t = make_long_transcript(10000, n_segments=1000)
  p = build_chapter_prompt(t, max_chars=2000)
  assert "more" in p or "truncated" in p.lower()


# ---------- parse_chapters_response ----------

def test_parse_clean_json():
  resp = json.dumps({"chapters": [
    {"start": 0, "end": 300, "title": "Intro", "summary": "Welcome"},
    {"start": 300, "end": 900, "title": "Main topic", "summary": "Deep dive"},
  ]})
  chapters = parse_chapters_response(resp, total_duration=900)
  assert len(chapters) == 2
  assert chapters[0].title == "Intro"


def test_parse_with_markdown_fence():
  resp = "```json\n" + json.dumps({"chapters": [{"start": 0, "end": 60, "title": "X"}]}) + "\n```"
  chapters = parse_chapters_response(resp, total_duration=60)
  assert len(chapters) == 1


def test_parse_invalid_chapter_skipped():
  resp = json.dumps({"chapters": [
    {"start": 0, "end": 60, "title": "ok"},
    {"start": "bad", "end": 120, "title": "bad"},
    {"start": 60, "end": 30, "title": "end before start"},
    {"start": 0, "end": 30, "title": ""},  # empty title
  ]})
  chapters = parse_chapters_response(resp, total_duration=120)
  assert len(chapters) == 1


def test_parse_clamps_to_total_duration():
  resp = json.dumps({"chapters": [
    {"start": 0, "end": 99999, "title": "huge"},
  ]})
  chapters = parse_chapters_response(resp, total_duration=60)
  assert len(chapters) == 1
  assert chapters[0].end == 60


def test_parse_empty_raises():
  with pytest.raises(ValueError):
    parse_chapters_response("plain text", total_duration=60)


# ---------- validate_chapters ----------

def test_validate_fills_pre_gap():
  chapters = [Chapter(start=10, end=60, title="X")]
  result = validate_chapters(chapters, total_duration=100)
  assert result[0].start == 0
  assert result[0].end == 10
  assert result[0].title == "Introduction"


def test_validate_fills_post_gap():
  chapters = [Chapter(start=0, end=60, title="X")]
  result = validate_chapters(chapters, total_duration=100)
  assert result[-1].end == 100


def test_validate_merges_short_chapters():
  chapters = [
    Chapter(start=0, end=60, title="Main"),
    Chapter(start=60, end=62, title="tiny"),  # < 5s
  ]
  result = validate_chapters(chapters, total_duration=62)
  assert len(result) == 1
  assert result[0].end == 62


def test_validate_sorts_chapters():
  chapters = [
    Chapter(start=60, end=120, title="Second"),
    Chapter(start=0, end=60, title="First"),
  ]
  result = validate_chapters(chapters, total_duration=120)
  assert result[0].title == "First"


def test_validate_empty():
  assert validate_chapters([], 100) == []


# ---------- ChapterDetector with LLM ----------

def test_detector_with_llm():
  captured = {}
  def llm_fn(prompt):
    captured["prompt"] = prompt
    return json.dumps({"chapters": [
      {"start": 0, "end": 600, "title": "Intro & Setup", "summary": "Hook and intro"},
      {"start": 600, "end": 1500, "title": "Main Tutorial", "summary": "Step by step"},
      {"start": 1500, "end": 1800, "title": "Conclusion", "summary": "Wrap up"},
    ]})
  det = ChapterDetector(llm_fn=llm_fn, fallback=False)
  t = make_long_transcript(1800)
  chapters = det.detect(t)
  assert len(chapters) == 3
  assert "tutorial" in captured["prompt"].lower() or "TRANSCRIPT" in captured["prompt"]


def test_detector_fallback_when_llm_fails():
  def llm_fn(prompt):
    raise RuntimeError("LLM API down")
  det = ChapterDetector(llm_fn=llm_fn, fallback=True)
  t = make_long_transcript(1800)
  chapters = det.detect(t)
  assert len(chapters) >= 1
  assert "Chapter" in chapters[0].title  # fallback uses "Chapter N"


def test_detector_no_llm_uses_heuristic():
  det = ChapterDetector(llm_fn=None, fallback=True)
  t = make_long_transcript(1800)
  chapters = det.detect(t)
  assert len(chapters) >= 3  # 30 min / 5 min = 6 chapters
  # Chapters are contiguous and cover the whole transcript
  assert chapters[0].start == 0
  assert chapters[-1].end == 1800
  for i in range(1, len(chapters)):
    assert chapters[i].start >= chapters[i - 1].end


def test_detector_short_transcript_returns_empty():
  det = ChapterDetector(llm_fn=None, fallback=True)
  t = make_long_transcript(20)  # < 30s
  assert det.detect(t) == []


def test_detector_clamps_to_max_chapters():
  det = ChapterDetector(llm_fn=None, fallback=True)
  t = make_long_transcript(10000)  # 2.5 hours
  chapters = det.detect(t, max_chapters=5)
  assert len(chapters) <= 5


def test_detector_no_fallback_raises():
  def llm_fn(prompt):
    raise RuntimeError("API down")
  det = ChapterDetector(llm_fn=llm_fn, fallback=False)
  t = make_long_transcript(1800)
  with pytest.raises(RuntimeError):
    det.detect(t)


# ---------- YouTube chapter format ----------

def test_chapter_to_youtube_format():
  """YouTube chapters need HH:MM:SS timestamps + titles."""
  chapters = [
    Chapter(start=0, end=65, title="Intro"),
    Chapter(start=65, end=605, title="Main"),
  ]
  # YouTube format: just the start times + titles, one per line
  def fmt(chapters):
    def timecode(s):
      h = int(s // 3600)
      m = int((s % 3600) // 60)
      sec = int(s % 60)
      return f"{h:02d}:{m:02d}:{sec:02d}"
    return "\n".join(f"{timecode(c.start)} {c.title}" for c in chapters)
  out = fmt(chapters)
  assert "00:00:00 Intro" in out
  assert "00:01:05 Main" in out
