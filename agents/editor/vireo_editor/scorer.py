"""Sentence scoring for Editor.

Each sentence gets a score from 0 to 1. Higher = more likely to keep.

Signals:
  - Length (very short or very long sentences are usually filler)
  - Has number (lists, facts, data — high value)
  - Has named entity (capitalized words — high value)
  - Has question (engagement — medium value)
  - Has exclamation (energy — high value for energetic style)
  - Has CTA markers (high value if at end)
  - Has filler (low value)
  - Position: first 3 + last 5 sentences get a bonus
  - Novelty: sentences very similar to recent ones get penalized
"""
from __future__ import annotations
import re
from typing import Any

FILLER_RE = re.compile(
    r"\b(um|uh|er|like|you know|i mean|basically|actually|literally|"
    r"honestly|anyway|so|well|right\?|ok(?:ay)?|"
    r"типа|короче|это самое|ну|вот|как бы|в общем|так сказать)\b",
    re.IGNORECASE,
)
NUMBER_RE = re.compile(r"\b\d+(?:[.,]\d+)?%?\b")
CAPITAL_RE = re.compile(r"\b[A-ZА-Я][a-zа-я]{2,}\b")
QUESTION_RE = re.compile(r"\?")
EXCL_RE = re.compile(r"!")
CTA_RE = re.compile(
    r"\b(subscribe|follow|like|comment|share|hit the bell|"
    r"check (?:out|it out)|link in bio|description|"
    r"let me know|thoughts|what do you think|"
    r"подпишись|лайк|коммент|репост|ссылка|описание|"
    r"что думаете|ваше мнение|пишите)\b",
    re.IGNORECASE,
)


def _word_count(s: str) -> int:
    return len(re.findall(r"\b\w+\b", s))


def score_sentence(
    sentence: str,
    *,
    position: int = -1,
    total: int = 0,
    style_dna: dict[str, Any] | None = None,
    recent_text: str = "",
) -> float:
    """Score a single sentence 0..1."""
    s = sentence.strip()
    if not s:
        return 0.0

    words = _word_count(s)
    score = 0.5  # base

    # Length sweet spot: 5-25 words
    if words < 3:
        score -= 0.4  # too short, probably noise
    elif words < 5:
        score -= 0.1
    elif words <= 25:
        score += 0.1
    elif words <= 40:
        score += 0.0
    else:  # > 40 — likely run-on
        score -= 0.2

    # Content signals
    if NUMBER_RE.search(s):
        score += 0.15
    if len(CAPITAL_RE.findall(s)) >= 1:
        score += 0.05
    if QUESTION_RE.search(s):
        score += 0.10
    if EXCL_RE.search(s):
        score += 0.10

    # CTA — only valuable at end
    is_cta = bool(CTA_RE.search(s))
    if is_cta and position >= 0 and total > 0 and position >= total - 5:
        score += 0.30
    elif is_cta:
        score -= 0.20  # CTA in the middle is awkward

    # Filler penalty
    filler_hits = len(FILLER_RE.findall(s))
    if filler_hits:
        score -= min(0.05 * filler_hits, 0.3)

    # Position bonus
    if total > 0:
        if position == 0:
            score += 0.20  # hook
        elif position < 3:
            score += 0.10
        elif position >= total - 3:
            score += 0.05  # closing

    # Style DNA alignment
    dna = style_dna or {}
    tone = dna.get("tone", "")
    humor = dna.get("humor_style", "")

    if tone == "energetic" and EXCL_RE.search(s):
        score += 0.05
    if tone == "professional" and words >= 12:
        score += 0.05
    if tone == "casual" and words < 12:
        score += 0.05
    if tone == "educational" and NUMBER_RE.search(s):
        score += 0.10
    if tone == "storytelling" and position < total * 0.3:
        score += 0.10  # setup matters in stories
    if tone == "provocative" and position < 5:
        score += 0.10  # opening is the punch

    # Novelty — penalize repetition of recent sentences
    if recent_text:
        s_lower = s.lower()
        recent_lower = recent_text.lower()
        # Cheap jaccard on words
        s_words = set(re.findall(r"\b\w+\b", s_lower))
        r_words = set(re.findall(r"\b\w+\b", recent_lower))
        if s_words and r_words:
            overlap = len(s_words & r_words) / len(s_words | r_words)
            if overlap > 0.6:
                score -= 0.20  # very repetitive

    return max(0.0, min(1.0, score))
