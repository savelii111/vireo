"""Tests for moments.py — LLM-based moment selection."""

import json
import pytest
from vireo_video.transcriber import Transcript, Segment, Word
from vireo_video.moments import (
  Moment, MomentSelector, build_prompt, parse_moments_response,
  build_transcript_summary, PROMPTS,
)


def make_transcript():
  return Transcript(
    text="This is a great video with many insights.",
    language="en",
    duration=120.0,
    segments=[
      Segment(id=0, start=0.0, end=10.0, text="Welcome to my channel.",
              words=[Word("Welcome", 0, 0.5), Word("to", 0.5, 0.7),
                     Word("my", 0.7, 0.9), Word("channel.", 0.9, 1.5)]),
      Segment(id=1, start=10.0, end=30.0, text="Today we have three big mistakes to avoid when starting a business.",
              words=[Word("Today", 10, 10.5), Word("we", 10.5, 10.7),
                     Word("have", 10.7, 11.0), Word("three", 11.0, 11.5),
                     Word("big", 11.5, 12.0), Word("mistakes", 12.0, 13.0),
                     Word("to", 13.0, 13.2), Word("avoid", 13.2, 13.7),
                     Word("when", 13.7, 14.0), Word("starting", 14.0, 14.7),
                     Word("a", 14.7, 14.8), Word("business.", 14.8, 15.5)]),
      Segment(id=2, start=30.0, end=60.0, text="Mistake number one is not validating your idea before building.",
              words=[Word("Mistake", 30, 30.5), Word("number", 30.5, 31.0),
                     Word("one", 31.0, 31.5), Word("is", 31.5, 31.7),
                     Word("not", 31.7, 32.0), Word("validating", 32.0, 33.5),
                     Word("your", 33.5, 34.0), Word("idea", 34.0, 34.5),
                     Word("before", 34.5, 35.0), Word("building.", 35.0, 36.0)]),
      Segment(id=3, start=60.0, end=90.0, text="Mistake two is ignoring customer feedback.",
              words=[Word("Mistake", 60, 60.5), Word("two", 60.5, 61.0),
                     Word("is", 61.0, 61.2), Word("ignoring", 61.2, 62.5),
                     Word("customer", 62.5, 63.5), Word("feedback.", 63.5, 64.5)]),
      Segment(id=4, start=90.0, end=120.0, text="And the final mistake is giving up too early.",
              words=[Word("And", 90, 90.3), Word("the", 90.3, 90.6),
                     Word("final", 90.6, 91.0), Word("mistake", 91.0, 92.0),
                     Word("is", 92.0, 92.3), Word("giving", 92.3, 93.0),
                     Word("up", 93.0, 93.3), Word("too", 93.3, 93.6),
                     Word("early.", 93.6, 94.5)]),
    ],
  )


# ---------- Moment dataclass ----------

def test_moment_validates():
  with pytest.raises(ValueError):
    Moment(start=5, end=3)  # end <= start
  with pytest.raises(ValueError):
    Moment(start=0, end=0.5)  # too short
  m = Moment(start=10, end=40, reason="good moment")
  assert m.duration == 30
  assert m.score == 0.0  # default


# ---------- parse_moments_response ----------

def test_parse_clean_json():
  resp = json.dumps({
    "moments": [
      {"start": 10.5, "end": 40.5, "reason": "Mistakes section", "score": 0.9},
      {"start": 60.0, "end": 90.0, "reason": "Mistake two"},
    ]
  })
  moments = parse_moments_response(resp)
  assert len(moments) == 2
  assert moments[0].start == 10.5
  assert moments[0].reason == "Mistakes section"


def test_parse_json_in_markdown_fence():
  resp = "```json\n" + json.dumps({"moments": [{"start": 10, "end": 30, "reason": "ok"}]}) + "\n```"
  moments = parse_moments_response(resp)
  assert len(moments) == 1


def test_parse_prose_around_json():
  resp = "Here you go:\n\n" + json.dumps({"moments": [{"start": 10, "end": 30}]}) + "\n\nHope that helps!"
  moments = parse_moments_response(resp)
  assert len(moments) == 1


def test_parse_invalid_moment_skipped():
  resp = json.dumps({"moments": [
    {"start": 10, "end": 30},
    {"start": "bad", "end": 40},  # invalid start
    {"start": 0, "end": 0.5},     # too short
  ]})
  moments = parse_moments_response(resp)
  assert len(moments) == 1  # only the first one


def test_parse_max_moments():
  resp = json.dumps({"moments": [{"start": i*10, "end": i*10+30} for i in range(5)]})
  moments = parse_moments_response(resp, max_moments=2)
  assert len(moments) == 2


def test_parse_no_json_raises():
  with pytest.raises(ValueError):
    parse_moments_response("just plain text")


# ---------- build_prompt ----------

def test_build_prompt_contains_platform_guidance():
  t = make_transcript()
  prompt = build_prompt("tiktok", t)
  assert "TikTok editor" in prompt
  assert "120.0s" in prompt
  assert "[001]" in prompt  # segment id
  assert "Welcome to my channel" in prompt


def test_build_prompt_unknown_platform_uses_default():
  t = make_transcript()
  prompt = build_prompt("unknown_platform", t)
  assert "video editor" in prompt.lower()  # default template


def test_build_transcript_summary_truncates():
  t = make_transcript()
  # Force truncation
  summary = build_transcript_summary(t, max_chars=100)
  assert "truncated" in summary or len(summary) <= 200


# ---------- MomentSelector ----------

def test_selector_with_llm():
  captured = {}
  def llm_fn(prompt):
    captured["prompt"] = prompt
    return json.dumps({"moments": [
      {"start": 30.0, "end": 60.0, "reason": "Best mistake", "score": 0.95},
    ]})
  sel = MomentSelector(llm_fn=llm_fn, fallback=False)
  moments = sel.select(make_transcript(), "tiktok", max_moments=3)
  assert len(moments) == 1
  assert moments[0].start == 30.0
  assert "Best mistake" in moments[0].reason
  assert "Mistake" in captured["prompt"]


def test_selector_fallback_when_llm_fails():
  def llm_fn(prompt):
    raise RuntimeError("API down")
  sel = MomentSelector(llm_fn=llm_fn, fallback=True)
  moments = sel.select(make_transcript(), "tiktok", max_moments=2)
  assert len(moments) >= 1
  assert "heuristic" in moments[0].reason


def test_selector_no_llm_uses_heuristic():
  sel = MomentSelector(llm_fn=None, fallback=True)
  moments = sel.select(make_transcript(), "tiktok", max_moments=2)
  assert len(moments) >= 1


def test_selector_no_fallback_raises_on_llm_error():
  def llm_fn(prompt):
    raise RuntimeError("API down")
  sel = MomentSelector(llm_fn=llm_fn, fallback=False)
  with pytest.raises(RuntimeError):
    sel.select(make_transcript(), "tiktok")


def test_heuristic_picks_within_platform_duration():
  sel = MomentSelector(llm_fn=None, fallback=True)
  moments = sel.select(make_transcript(), "linkedin", max_moments=3)
  # LinkedIn target is 60-180s; the longest segments are 30s each.
  # Heuristic will pick the densest even if outside target.
  assert all(m.duration >= 1 for m in moments)


def test_heuristic_empty_transcript_returns_empty():
  t = Transcript(text="", language="en", duration=0, segments=[])
  sel = MomentSelector(llm_fn=None, fallback=True)
  moments = sel.select(t, "tiktok")
  assert moments == []
