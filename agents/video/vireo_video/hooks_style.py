"""Hook style analyzer: detect HOW a creator starts their videos.

Why this matters:
  - The first 3-5 seconds of a YouTube/TikTok video determine if viewers stay
  - Different creators have very different hook styles:
    * "Question hook" — "What if I told you..."
    * "Bold claim hook" — "This is the biggest mistake in X"
    * "Visual hook" — striking image first, words come later
    * "In-medias-res" — starts mid-action
    * "Pattern interrupt" — unexpected sound/image
  - If Vireo knows a creator's hook style, it can apply it to new content

How we detect it:
  1. Take the first 5-10 seconds of the video
  2. Transcribe (if not already done)
  3. Analyze the opening text:
     - Does it start with a question?
     - Does it start with a number/statistic?
     - Does it contain strong "you" address?
     - Is it a short punchy sentence?
  4. Combine with audio analysis (sudden loud sound? silence then speech?)
  5. Classify into a HookStyle

This is a heuristic — there's no single right answer. The output is a
recommended "hook template" the user can override.
"""

from __future__ import annotations
import re
from dataclasses import dataclass, field, asdict
from typing import Any, Optional

from .transcriber import Transcript, Word, Segment


@dataclass
class HookStyle:
  """How a creator opens their videos."""
  name: str = "unknown"             # "question" | "bold_claim" | "visual" | etc.
  description: str = ""
  confidence: float = 0.0
  evidence: list[str] = field(default_factory=list)
  # Optional: a template the user can use for new content
  template: str = ""

  def to_dict(self) -> dict:
    return asdict(self)


HOOK_TEMPLATES = {
  "question": "Start with a question your audience wants answered.\nExample: 'What if I told you {topic}?'",
  "bold_claim": "Make a controversial or surprising statement.\nExample: 'Nobody talks about {topic}, but they should.'",
  "statistic": "Open with a specific number or data point.\nExample: '93% of people get {topic} wrong. Here's why.'",
  "visual": "Show something striking for 1-2 seconds before any words.\nExample: dramatic footage, then 'Let me explain...'",
  "in_medias_res": "Start mid-action without preamble.\nExample: 'So I was {doing something} when...'",
  "you_address": "Directly address the viewer with a personal statement.\nExample: 'You've been doing {topic} wrong. Let me show you how.'",
  "list_tease": "Promise a list of items.\nExample: 'Here are 5 things about {topic} nobody tells you.'",
  "story": "Start with a short personal anecdote.\nExample: 'Last week, I {something happened}...'",
  "minimal": "Get straight to the point with no preamble.\nExample: 'Today: {topic}.'",
}


def _count_words(text: str) -> int:
  return len([w for w in re.findall(r"\b[\w']+\b", text) if len(w) > 1])


def _ends_with_question(text: str) -> bool:
  return text.rstrip().endswith("?")


def _starts_with_question_word(text: str) -> bool:
  """Does the first 3 words include a question word?"""
  question_words = {"what", "why", "how", "when", "where", "who", "which", "do", "does", "did", "are", "is", "can", "could", "would", "should", "will"}
  words = re.findall(r"\b\w+\b", text.lower())[:3]
  return any(w in question_words for w in words)


def _contains_number(text: str) -> bool:
  return bool(re.search(r"\b\d+(\.\d+)?%?\b", text))


def _contains_you(text: str) -> bool:
  return bool(re.search(r"\byou(?:'re|'ll|'ve|r)?\b", text.lower()))


def _contains_i_first(text: str) -> bool:
  return bool(re.match(r"^\s*i\s+(?:was|am|'m|just|never|always|did|have|wanted|thought)", text.lower()))


def _first_sentence(text: str) -> str:
  """Get the first sentence."""
  m = re.search(r"^[^.!?\n]+[.!?]", text.strip())
  return m.group(0).strip() if m else text.strip()


def classify_hook(transcript: Transcript, *, window_sec: float = 8.0) -> HookStyle:
  """Analyze the opening of a transcript to classify the hook style.

  Looks at the first `window_sec` of speech (default 8 sec).
  """
  if not transcript.segments:
    return HookStyle(name="unknown", description="no transcript segments")

  # Collect words from the opening window
  opening_words: list[Word] = []
  for seg in transcript.segments:
    if seg.start > window_sec:
      break
    if seg.words:
      for w in seg.words:
        if w.start <= window_sec:
          opening_words.append(w)
  if not opening_words:
    # Fall back to text
    opening_text = " ".join(s.text for s in transcript.segments if s.start < window_sec)
  else:
    opening_text = " ".join(w.text for w in opening_words)

  opening_text = opening_text.strip()
  if not opening_text:
    return HookStyle(name="unknown", description="no opening speech detected")

  first_sent = _first_sentence(opening_text)
  num_words = _count_words(opening_text)
  evidence: list[str] = []

  # Score each hook type
  scores: dict[str, tuple[float, str]] = {}

  # Question hook
  q_score = 0.0
  if _ends_with_question(first_sent):
    q_score += 3.0
    evidence.append("opening ends with ?")
  if _starts_with_question_word(opening_text):
    q_score += 2.0
    evidence.append("opens with question word")
  if q_score > 0:
    scores["question"] = (q_score, "Opening is a question")

  # Bold claim hook — short, declarative, no question
  claim_score = 0.0
  if num_words <= 12 and not _ends_with_question(first_sent):
    claim_score += 1.0
    evidence.append(f"short opening ({num_words} words)")
  if first_sent and first_sent[0].isupper() and not _starts_with_question_word(opening_text):
    claim_score += 0.5
  # Strong opening words
  strong_openers = {"this", "these", "every", "no", "all", "never", "always", "the"}
  if re.match(rf"^({'|'.join(strong_openers)})\\b", opening_text.lower()):
    claim_score += 1.0
    evidence.append("strong opener word")
  if claim_score > 0:
    scores["bold_claim"] = (claim_score, "Short declarative statement")

  # Statistic hook
  stat_score = 0.0
  if _contains_number(opening_text):
    stat_score += 3.0
    evidence.append("contains a number")
  if stat_score > 0:
    scores["statistic"] = (stat_score, "Opens with a number/statistic")

  # You-address hook
  you_score = 0.0
  if _contains_you(opening_text):
    you_score += 2.5
    evidence.append("uses 'you'")
  # Starts with "you"
  if re.match(r"^\s*you\b", opening_text.lower()):
    you_score += 1.5
    evidence.append("opens with 'you'")
  if you_score > 0:
    scores["you_address"] = (you_score, "Directly addresses the viewer")

  # In-medias-res / story hook
  story_score = 0.0
  if _contains_i_first(opening_text):
    story_score += 3.0
    evidence.append("opens with 'I was/I am/I just'")
  if re.match(r"^\s*(so|i|and|but|well|ok|okay)\s", opening_text.lower()):
    story_score += 0.5
    evidence.append("conversational opener")
  if story_score > 0:
    scores["story"] = (story_score, "Personal/conversational opening")

  # List tease
  list_score = 0.0
  if re.search(r"\b(\d+)\s+(things|ways|reasons|tips|tricks|secrets|steps|rules|lessons|mistakes)\b", opening_text.lower()):
    list_score += 4.0  # stronger than just statistic
    evidence.append("references a list of N items")
  if list_score > 0:
    scores["list_tease"] = (list_score, "Teases a list of items")

  # Minimal — very short, no hook words, just dive in
  if num_words <= 6 and not scores:
    return HookStyle(
      name="minimal",
      description=f"Minimal opening ({num_words} words): {first_sent!r}",
      confidence=0.7,
      evidence=[f"only {num_words} words"],
      template=HOOK_TEMPLATES["minimal"],
    )

  if not scores:
    return HookStyle(
      name="unknown",
      description=f"Couldn't classify: opening = {first_sent!r}",
      confidence=0.0,
      evidence=[],
    )

  # Pick the highest-scoring hook
  best_name, (best_score, description) = max(scores.items(), key=lambda x: x[1][0])
  # Confidence: 0..1 based on score (3+ = high, 1-2 = medium)
  confidence = min(1.0, best_score / 3.5)

  return HookStyle(
    name=best_name,
    description=description,
    confidence=round(confidence, 2),
    evidence=evidence,
    template=HOOK_TEMPLATES.get(best_name, ""),
  )


def apply_hook_to_text(opening_text: str, hook_style: HookStyle, topic: str = "[your topic]") -> str:
  """Generate a suggested opening line based on the detected hook style.

  This is a template-filler, not real generation. Returns a starter that
  the user can customize.
  """
  template = hook_style.template
  if not template:
    return opening_text
  return template.replace("{topic}", topic).split("\n", 1)[-1].strip()
