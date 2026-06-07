"""LLM-based moment selection.

Given a transcript and a target platform, ask the LLM to pick the best
1-3 moments (start, end timestamps) to clip from the source.

Why LLM?
  - The LLM can read the transcript and judge which segments are
    "quotable", "actionable", or "funny" — qualities that simple
    heuristics (e.g. "most energetic") miss.
  - Platform-specific: a 60s TikTok wants a punchy hook; a 12-min
    YouTube long-form wants a strong thesis moment.

How it works:
  1. Build a compact transcript representation: numbered segments.
  2. Send to LLM with a platform-specific prompt.
  3. Parse the JSON response: [{start, end, reason}, ...]
  4. Return the moments.

The LLM is injectable (transport), so tests don't need a real API key.
"""

from __future__ import annotations
import json
import re
from dataclasses import dataclass, asdict
from typing import Any, Optional

from .transcriber import Transcript


@dataclass
class Moment:
  start: float
  end: float
  reason: str = ""
  score: float = 0.0

  def __post_init__(self):
    if self.end <= self.start:
      raise ValueError(f"Moment end must be > start, got {self.start}..{self.end}")
    if self.end - self.start < 1.0:
      raise ValueError(f"Moment must be at least 1 second, got {self.duration:.2f}s")
    if self.end - self.start > 600:
      raise ValueError(f"Moment must be at most 600 seconds, got {self.duration:.2f}s")

  @property
  def duration(self) -> float:
    return self.end - self.start

  def to_dict(self) -> dict:
    return asdict(self)


# Platform-specific prompt templates.
PROMPTS = {
  "youtube_shorts": """You are a YouTube Shorts editor. From the transcript below, pick the SINGLE best 30-60 second moment for a viral short. The moment should:
  - Start with a strong hook (bold claim, surprising fact, or question)
  - Be self-contained (no preamble, no "first I need to explain...")
  - End on a punchline or natural stopping point

Respond with strict JSON: {"moments": [{"start": <sec>, "end": <sec>, "reason": "<one line>"}]}""",

  "tiktok": """You are a TikTok editor. From the transcript below, pick the SINGLE best 15-60 second moment. The moment should:
  - Hook within the first 3 seconds
  - Be punchy, fast-paced
  - Have a clear payoff or punchline

Respond with strict JSON: {"moments": [{"start": <sec>, "end": <sec>, "reason": "<one line>"}]}""",

  "youtube": """You are a YouTube long-form editor. From the transcript below, pick 1-3 moments (each 30-180 seconds) that would make great chapter markers or clip highlights. The moments should:
  - Mark a key insight, story beat, or transition
  - Be self-contained (understandable without full context)
  - Have a clear topic and takeaway

Respond with strict JSON: {"moments": [{"start": <sec>, "end": <sec>, "reason": "<one line>"}]}""",

  "instagram_reels": """You are an Instagram Reels editor. From the transcript below, pick the SINGLE best 15-90 second moment. The moment should:
  - Be visually-imagineable (descriptive language, action, transformation)
  - Hook in the first 2 seconds
  - Have emotional resonance

Respond with strict JSON: {"moments": [{"start": <sec>, "end": <sec>, "reason": "<one line>"]}""",

  "linkedin": """You are a LinkedIn video editor. From the transcript below, pick the SINGLE best 60-180 second moment. The moment should:
  - Contain a professional insight, framework, or contrarian take
  - Be measured and credible (not hype-y)
  - Have a clear "what to do" or "what to think" takeaway

Respond with strict JSON: {"moments": [{"start": <sec>, "end": <sec>, "reason": "<one line>"]}""",

  "default": """You are a video editor. From the transcript below, pick 1-3 of the best moments (each 20-180 seconds) for short-form video. The moments should be self-contained and have a clear hook + payoff.

Respond with strict JSON: {"moments": [{"start": <sec>, "end": <sec>, "reason": "<one line>"]}""",
}


def build_transcript_summary(transcript: Transcript, max_chars: int = 6000) -> str:
  """Format a transcript for an LLM prompt.

  Includes segment IDs, timestamps, and text. Truncates if too long.
  """
  lines: list[str] = []
  total = 0
  for seg in transcript.segments:
    line = f"[{seg.id:03d}] [{seg.start:6.2f}-{seg.end:6.2f}] {seg.text.strip()}"
    if total + len(line) > max_chars:
      lines.append(f"... ({len(transcript.segments) - len(lines)} more segments truncated)")
      break
    lines.append(line)
    total += len(line) + 1
  return "\n".join(lines)


def build_prompt(platform: str, transcript: Transcript, *, max_moments: int = 3) -> str:
  """Build the full prompt for moment selection."""
  template = PROMPTS.get(platform, PROMPTS["default"])
  summary = build_transcript_summary(transcript)
  return f"""{template}

TRANSCRIPT ({transcript.duration:.1f}s, {len(transcript.segments)} segments, lang={transcript.language or "?"}):
{summary}

CONSTRAINTS:
- Return at most {max_moments} moments
- Each moment must be between 1 and 600 seconds
- Timestamps in seconds, must match the transcript above
- Valid JSON only, no prose

JSON:"""


def parse_moments_response(text: str, *, max_moments: int = 3) -> list[Moment]:
  """Parse LLM JSON response into Moment list.

  Tolerant to common LLM mistakes (markdown fences, trailing commas, prose around).
  """
  cleaned = text.strip()
  # Strip markdown code fences
  if cleaned.startswith("```"):
    # Remove first line (```json or ```) and last ``` if present
    lines = cleaned.splitlines()
    lines = [ln for ln in lines if not ln.strip().startswith("```")]
    cleaned = "\n".join(lines).strip()
  # Try to find a JSON object in the response
  match = re.search(r"\{[^{}]*?(?:\{[^{}]*\}[^{}]*?)*\}", cleaned)
  if not match:
    raise ValueError(f"no JSON object found in response: {text[:200]!r}")
  try:
    data = json.loads(match.group(0))
  except json.JSONDecodeError as e:
    # Try a relaxed parse (replace single quotes, remove trailing commas)
    relaxed = match.group(0)
    relaxed = re.sub(r",\s*}", "}", relaxed)
    relaxed = re.sub(r",\s*]", "]", relaxed)
    try:
      data = json.loads(relaxed)
    except json.JSONDecodeError:
      raise ValueError(f"failed to parse JSON: {e}; raw: {text[:200]!r}")
  moments_raw = data.get("moments", [])
  if not isinstance(moments_raw, list):
    raise ValueError(f"moments field must be a list, got {type(moments_raw).__name__}")
  out: list[Moment] = []
  for m in moments_raw[:max_moments]:
    if not isinstance(m, dict):
      continue
    try:
      start = float(m.get("start", 0))
      end = float(m.get("end", 0))
      reason = str(m.get("reason", ""))
      score = float(m.get("score", 0.5))
      out.append(Moment(start=start, end=end, reason=reason, score=score))
    except (ValueError, TypeError):
      continue
  return out


class MomentSelector:
  """Selects best moments from a transcript for a target platform.

  Uses an LLM transport (injectable). Falls back to a heuristic if LLM fails.
  """

  def __init__(self, llm_fn=None, *, fallback: bool = True):
    """
    llm_fn: callable(prompt: str) -> str. If None, only heuristic fallback.
    fallback: when LLM fails or is unavailable, use heuristic selection.
    """
    self.llm_fn = llm_fn
    self.fallback = fallback

  def select(self, transcript: Transcript, platform: str, *, max_moments: int = 3) -> list[Moment]:
    if self.llm_fn is not None:
      try:
        prompt = build_prompt(platform, transcript, max_moments=max_moments)
        response = self.llm_fn(prompt)
        moments = parse_moments_response(response, max_moments=max_moments)
        if moments:
          return moments
      except Exception:
        if not self.fallback:
          raise
    if self.fallback:
      return self._heuristic_moments(transcript, platform, max_moments=max_moments)
    return []

  def _heuristic_moments(self, transcript: Transcript, platform: str, *, max_moments: int) -> list[Moment]:
    """Pick the most 'dense' segments when no LLM is available.

    Heuristic: longest segments with most words (proxy for content density).
    For shorts, pick a single segment of appropriate length.
    """
    if not transcript.segments:
      return []

    target_duration = {
      "tiktok": (20, 60),
      "youtube_shorts": (30, 60),
      "instagram_reels": (15, 90),
      "linkedin": (60, 180),
      "x": (20, 140),
      "threads": (15, 60),
      "youtube": (60, 180),
    }.get(platform, (30, 120))

    # Score each segment: word_count * 1.0 + duration_bonus
    scored: list[tuple[float, Segment]] = []
    for s in transcript.segments:
      words = len(s.words) if s.words else len(s.text.split())
      score = words
      # Prefer segments within target duration
      if target_duration[0] <= s.duration <= target_duration[1]:
        score += 10
      scored.append((score, s))
    scored.sort(key=lambda x: -x[0])

    moments: list[Moment] = []
    for score, s in scored[:max_moments]:
      try:
        moments.append(Moment(
          start=s.start, end=s.end,
          reason=f"heuristic: {len(s.words or [])} words, {s.duration:.1f}s",
          score=score,
        ))
      except ValueError:
        # Skip segments that don't meet the constraints
        continue
    return moments
