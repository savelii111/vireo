"""LLM-enhanced Style Learner.

Combines the rule-based analyzer with an LLM client for deeper understanding.
The LLM pass is optional and falls back gracefully when unavailable.
"""
from __future__ import annotations
import json
from typing import Any

from vireo_shared import StyleDNA, now_iso

from .analyzer import StyleAnalyzer
from .llm_client import LLMClient, MockLLMClient


_SYSTEM_PROMPT = """You are Vireo's Style Analyzer — an expert at reverse-engineering
a content creator's style from their past work. Analyze the corpus provided
by the user and return a JSON object describing:

  - tone: dominant tone (professional, casual, energetic, educational, storytelling, provocative, neutral)
  - pacing: fast / medium / slow
  - vocabulary_level: simple / conversational / educated / academic
  - humor_style: subtle / sarcastic / absurd / observational / wordplay / none
  - hook_patterns: top 3-5 patterns the creator uses in openings (curiosity, command, temporal, question, reveal, statement, quote, number — or _ru variants)
  - cta_patterns: CTA patterns (engagement, traffic, discussion, retention, dm)
  - topics: top 5-8 topics the creator covers
  - avg_content_length_sec: typical content length
  - confidence: 0..1, how confident you are in this analysis

Respond with ONLY the JSON object, no prose."""


class LLMEnhancedStyleLearner:
    """Uses an LLM client to get richer style analysis than pure rules."""

    def __init__(self, llm: LLMClient | None = None) -> None:
        self.llm = llm or MockLLMClient()
        self.fallback = StyleAnalyzer()
        self.last_call_count = 0

    def _format_prompt(self, pieces: list[dict[str, Any]]) -> str:
        """Format the corpus for the LLM."""
        lines = [f"Analyze the following {len(pieces)} content pieces from the same creator:\n"]
        for i, p in enumerate(pieces[:30]):  # cap at 30 to stay under token limit
            title = p.get("title", "").strip()
            text = (p.get("text") or "").strip()
            platform = p.get("platform", "")
            if title:
                lines.append(f"\n--- Piece {i+1} [{platform}] ---")
                lines.append(f"Title: {title}")
                lines.append(f"Text: {text[:1000]}")
            else:
                lines.append(f"\n--- Piece {i+1} [{platform}] ---")
                lines.append(text[:1000])
        return "\n".join(lines)

    def analyze_corpus(
        self,
        pieces: list[dict[str, Any]],
        user_id: str = "anonymous",
    ) -> StyleDNA:
        if not pieces:
            return StyleDNA(user_id=user_id, confidence=0.0)

        # Always run rule-based as a baseline + sanity check
        rule_based = self.fallback.analyze_corpus(pieces, user_id)

        # Try the LLM pass
        prompt = self._format_prompt(pieces)
        try:
            analysis = self.llm.json_complete(prompt, system=_SYSTEM_PROMPT)
            self.last_call_count = getattr(self.llm, "call_count", self.last_call_count)
        except Exception:
            # LLM failure → fall back to rules
            return rule_based

        # Merge: prefer LLM for soft signals, rules for hard signals (length, count)
        merged = StyleDNA(
            user_id=user_id,
            tone=analysis.get("tone") or rule_based.tone,
            pacing=analysis.get("pacing") or rule_based.pacing,
            vocabulary_level=analysis.get("vocabulary_level") or rule_based.vocabulary_level,
            humor_style=analysis.get("humor_style") or rule_based.humor_style,
            hook_patterns=_merge_lists(analysis.get("hook_patterns"), rule_based.hook_patterns, cap=5),
            cta_patterns=_merge_lists(analysis.get("cta_patterns"), rule_based.cta_patterns, cap=5),
            color_palette=rule_based.color_palette,
            music_genres=rule_based.music_genres,
            avg_content_length_sec=rule_based.avg_content_length_sec or int(analysis.get("avg_content_length_sec", 60)),
            topics=_merge_lists(analysis.get("topics"), rule_based.topics, cap=8),
            # Boost confidence when LLM agrees with rules
            confidence=min(1.0, max(rule_based.confidence, analysis.get("confidence", 0)) * 1.2),
            sample_count=rule_based.sample_count,
            updated_at=now_iso(),
        )
        return merged


def _merge_lists(primary: list[str] | None, secondary: list[str] | None, cap: int = 5) -> list[str]:
    """Dedupe, prefer primary order, fill with secondary, cap."""
    out: list[str] = []
    seen: set[str] = set()
    for src in (primary or [], secondary or []):
        for item in src:
            key = item.lower().strip()
            if not key or key in seen:
                continue
            seen.add(key)
            out.append(item)
            if len(out) >= cap:
                return out
    return out
