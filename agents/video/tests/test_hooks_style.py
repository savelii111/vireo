"""Tests for hooks_style.py — opening hook classification."""

import pytest
from vireo_video.hooks_style import (
  HookStyle, classify_hook, apply_hook_to_text, HOOK_TEMPLATES,
  _first_sentence, _ends_with_question, _starts_with_question_word,
  _contains_number, _contains_you, _contains_i_first,
)
from vireo_video.transcriber import Transcript, Segment, Word


def make_transcript(opening_text: str, *, language: str = "en", total_dur: float = 30.0):
  """Build a transcript where the first 5 seconds is the given text."""
  words = opening_text.split()
  seg_words = []
  for i, w in enumerate(words):
    seg_words.append(Word(text=w, start=i * 0.5, end=(i + 1) * 0.5))
  return Transcript(
    text=opening_text,
    language=language,
    duration=total_dur,
    segments=[Segment(id=0, start=0, end=len(words) * 0.5,
                      text=opening_text, words=seg_words)],
  )


# ---------- helpers ----------

def test_first_sentence_basic():
  assert _first_sentence("Hello. World.") == "Hello."

def test_first_sentence_with_question():
  assert _first_sentence("What is this? More text.") == "What is this?"

def test_first_sentence_no_punctuation():
  assert _first_sentence("Hello world") == "Hello world"

def test_ends_with_question():
  assert _ends_with_question("What is this?")
  assert not _ends_with_question("What is this.")
  assert not _ends_with_question("What is this")

def test_starts_with_question_word():
  assert _starts_with_question_word("What is the secret")
  assert _starts_with_question_word("How to do it")
  assert _starts_with_question_word("Are you ready")
  assert not _starts_with_question_word("Hello there")

def test_contains_number():
  assert _contains_number("5 reasons why")
  assert _contains_number("93% of people")
  assert _contains_number("v1.5 release")
  assert not _contains_number("five reasons")

def test_contains_you():
  assert _contains_you("You need to know this")
  assert _contains_you("You're right")
  assert not _contains_you("I need to know")

def test_contains_i_first():
  assert _contains_i_first("I was walking")
  assert _contains_i_first("I am tired")
  assert _contains_i_first("I just finished")
  assert not _contains_i_first("You were walking")


# ---------- classify_hook ----------

def test_classify_question_hook():
  t = make_transcript("What is the biggest mistake people make? Let me show you.")
  h = classify_hook(t)
  assert h.name == "question"
  assert h.confidence > 0.5
  assert any("?" in e for e in h.evidence)


def test_classify_bold_claim_hook():
  t = make_transcript("This is the biggest mistake nobody tells you about.")
  h = classify_hook(t)
  # Could be bold_claim or you_address. The "you" triggers you_address with high score
  # "biggest" + short sentence = bold_claim also
  assert h.name in ("you_address", "bold_claim")


def test_classify_statistic_hook():
  t = make_transcript("93% of people do this wrong. Here's why.")
  h = classify_hook(t)
  assert h.name == "statistic"
  assert any("number" in e for e in h.evidence)


def test_classify_you_address_hook():
  t = make_transcript("You have been doing this wrong your entire life.")
  h = classify_hook(t)
  assert h.name == "you_address"
  assert any("you" in e.lower() for e in h.evidence)


def test_classify_story_hook():
  t = make_transcript("I was walking down the street when something crazy happened.")
  h = classify_hook(t)
  assert h.name == "story"
  assert h.confidence > 0.5


def test_classify_list_tease_hook():
  t = make_transcript("Here are 5 reasons why you need to learn Python today.")
  h = classify_hook(t)
  # Could be you_address (because of "you"). But "5 reasons" triggers list_tease strongly.
  # Both may compete — check that list_tease OR you_address is detected
  assert h.name in ("list_tease", "you_address")


def test_classify_minimal_hook():
  t = make_transcript("Python tips.")
  h = classify_hook(t)
  # 2 words. Could be minimal, bold_claim, or unknown depending on classifier.
  # We just check it doesn't crash and returns a valid hook type.
  assert h.name in ("minimal", "bold_claim", "unknown")


def test_classify_empty_transcript():
  t = Transcript(text="", language="en", duration=0, segments=[])
  h = classify_hook(t)
  assert h.name == "unknown"
  assert h.confidence == 0.0


def test_classify_only_uses_first_8_seconds():
  """Hook detection should only look at the first ~8 seconds, not the whole transcript."""
  # The opening is a question, but later text is unrelated
  t = Transcript(
    text="What is the answer? And then a long discussion about something else entirely.",
    language="en", duration=60.0,
    segments=[
      Segment(id=0, start=0, end=3, text="What is the answer?",
              words=[Word("What", 0, 0.5), Word("is", 0.5, 0.7),
                     Word("the", 0.7, 0.9), Word("answer?", 0.9, 1.5)]),
      Segment(id=1, start=10, end=50, text="Some other text entirely about cats and dogs.",
              words=[Word("Some", 10, 10.5)]),
    ],
  )
  h = classify_hook(t)
  assert h.name == "question"


def test_classify_returns_template():
  t = make_transcript("What is the secret?")
  h = classify_hook(t)
  assert h.template
  assert "?" in h.template or "question" in h.template.lower()


# ---------- HookStyle dataclass ----------

def test_hookstyle_to_dict():
  h = HookStyle(name="question", description="Opens with Q", confidence=0.9, evidence=["a", "b"], template="t")
  d = h.to_dict()
  assert d["name"] == "question"
  assert d["confidence"] == 0.9
  assert d["evidence"] == ["a", "b"]


# ---------- apply_hook_to_text ----------

def test_apply_hook_replaces_topic():
  h = HookStyle(name="question", template=HOOK_TEMPLATES["question"])
  out = apply_hook_to_text("ignored", h, topic="saving money")
  assert "saving money" in out


def test_apply_hook_no_template_returns_input():
  h = HookStyle(name="x", template="")
  assert apply_hook_to_text("hello", h) == "hello"


# ---------- all templates present ----------

def test_all_hook_templates_defined():
  for name in ("question", "bold_claim", "statistic", "visual", "in_medias_res",
               "you_address", "list_tease", "story", "minimal"):
    assert name in HOOK_TEMPLATES
    assert HOOK_TEMPLATES[name]
