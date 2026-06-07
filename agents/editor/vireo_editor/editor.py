"""Editor — produces an EditPlan from raw content.

Input shapes supported:
  - {"text": "...", "duration_sec": int}            — pure text
  - {"segments": [{"text": "...", "start": 0.0, "end": 1.5}, ...]} — transcript with timing

Output: EditPlan (vireo_shared.EditPlan) with:
  - cuts: list of {start, end, score, text, reason}
  - output_duration_sec: total kept time
  - style_applied: dict of what was honored
  - notes: human-readable explanation
"""
from __future__ import annotations
import re
from typing import Any

from vireo_shared import EditPlan, now_iso

from .scorer import score_sentence
from .hooks_gen import generate_hooks, generate_ctas


_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")


def _word_count(s: str) -> int:
    return len(re.findall(r"\b\w+\b", s))


def _split_text_to_sentences(text: str) -> list[str]:
    text = text.strip()
    if not text:
        return []
    return [s.strip() for s in _SENTENCE_SPLIT.split(text) if s.strip()]


def _segments_to_sentences(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Convert timed segments into per-sentence entries with start/end times."""
    out: list[dict[str, Any]] = []
    for seg in segments:
        t = seg.get("text", "").strip()
        if not t:
            continue
        sents = _split_text_to_sentences(t)
        if not sents:
            continue
        start = float(seg.get("start", 0))
        end = float(seg.get("end", start + 1))
        total_len = max(end - start, 0.001)
        per = total_len / len(sents)
        for i, s in enumerate(sents):
            out.append({
                "text": s,
                "start": round(start + i * per, 3),
                "end": round(start + (i + 1) * per, 3),
            })
    return out


class Editor:
    """Main editor — deterministic, offline, no LLM calls."""

    def __init__(self, config: dict[str, Any] | None = None) -> None:
        self.config = config or {}

    def _scored(
        self,
        sentences: list[dict[str, Any]],
        style_dna: dict[str, Any],
    ) -> list[dict[str, Any]]:
        scored: list[dict[str, Any]] = []
        recent_window = 3
        total = len(sentences)
        for i, sent in enumerate(sentences):
            recent = " ".join(
                sentences[j]["text"] for j in range(max(0, i - recent_window), i)
            )
            s = score_sentence(
                sent["text"],
                position=i,
                total=total,
                style_dna=style_dna,
                recent_text=recent,
            )
            scored.append({**sent, "score": round(s, 3)})
        return scored

    def _pack_to_target(
        self,
        scored: list[dict[str, Any]],
        target_sec: float,
    ) -> list[dict[str, Any]]:
        """Greedy pick — sort by score, then walk in original order until target hit.

        Why greedy + ordered: keeps the natural flow, doesn't make the output
        feel like a shuffled highlight reel.
        """
        if not scored:
            return []

        # Anchor: always keep the first sentence (hook) and last 1 (close)
        anchors = {0}
        if len(scored) > 1:
            anchors.add(len(scored) - 1)

        kept = set(anchors)
        kept_time = sum(
            (scored[i]["end"] - scored[i]["start"]) for i in kept
        )

        # If anchors alone already exceed target, drop the close (keep just hook)
        if kept_time > target_sec and len(kept) > 1:
            drop = max(kept - {0}, key=lambda i: scored[i]["end"] - scored[i]["start"])
            kept_time -= (scored[drop]["end"] - scored[drop]["start"])
            kept.discard(drop)

        # Sort remaining by score
        rest = [i for i in range(len(scored)) if i not in kept]
        rest_sorted = sorted(rest, key=lambda i: scored[i]["score"], reverse=True)

        # Add sentences greedily until we hit target
        for i in rest_sorted:
            dur = scored[i]["end"] - scored[i]["start"]
            if kept_time + dur <= target_sec:
                kept.add(i)
                kept_time += dur

        return [scored[i] for i in sorted(kept)]

    def _annotate(self, kept: list[dict[str, Any]], target_sec: float) -> list[dict[str, Any]]:
        """Add reason/role tags to each cut for the Distributor."""
        if not kept:
            return []
        annotated: list[dict[str, Any]] = []
        for i, cut in enumerate(kept):
            role = "body"
            if i == 0:
                role = "hook"
            elif i == len(kept) - 1:
                role = "close"
            elif i == len(kept) - 2:
                role = "cta"
            annotated.append({
                "start": cut["start"],
                "end": cut["end"],
                "score": cut["score"],
                "text": cut["text"],
                "role": role,
                "reason": _reason_for(cut, role),
            })
        return annotated

    def edit(
        self,
        content: dict[str, Any],
        style_dna: dict[str, Any],
        target_sec: float = 60.0,
    ) -> EditPlan:
        """Produce an EditPlan.

        content = {
          "id": "...",
          "text": "...",                      # OR
          "segments": [{"text", "start", "end"}],
          "duration_sec": int (optional),
        }
        """
        if "segments" in content and content["segments"]:
            sentences = _segments_to_sentences(content["segments"])
        else:
            text = content.get("text", "")
            duration = float(content.get("duration_sec") or max(60.0, _word_count(text) * 0.4))
            sentences = [{"text": s,
                          "start": round(i * (duration / max(1, _split_text_to_sentences(text).__len__())), 3),
                          "end": round((i + 1) * (duration / max(1, _split_text_to_sentences(text).__len__())), 3)}
                         for i, s in enumerate(_split_text_to_sentences(text))]

        scored = self._scored(sentences, style_dna)
        kept = self._pack_to_target(scored, target_sec)
        cuts = self._annotate(kept, target_sec)
        output_dur = round(sum(c["end"] - c["start"] for c in cuts), 2)

        # Style applied summary
        applied = {
            "tone": style_dna.get("tone"),
            "pacing": style_dna.get("pacing"),
            "target_sec": target_sec,
            "input_sentences": len(scored),
            "kept_sentences": len(kept),
            "compression_ratio": round(output_dur / max(0.001, sum(s["end"] - s["start"] for s in scored)), 3),
        }

        # Build human notes
        notes_parts = [
            f"Kept {len(kept)} of {len(scored)} sentences "
            f"({applied['compression_ratio']*100:.0f}% of original).",
            f"Style tone: {style_dna.get('tone')}, pacing: {style_dna.get('pacing')}.",
        ]
        if not cuts:
            notes_parts.append("WARNING: No content kept — input may be empty.")

        plan = EditPlan(
            source_id=content.get("id", ""),
            cuts=cuts,
            output_duration_sec=int(output_dur),
            style_applied=applied,
            notes=" ".join(notes_parts),
        )
        return plan

    def generate_hooks_for(self, style_dna: dict[str, Any], n: int = 3) -> list[str]:
        return generate_hooks(style_dna, n)

    def generate_ctas_for(self, style_dna: dict[str, Any], n: int = 3) -> list[str]:
        return generate_ctas(style_dna, n)


def _reason_for(cut: dict[str, Any], role: str) -> str:
    score = cut["score"]
    if role == "hook":
        return f"Opening hook (score {score})"
    if role == "close":
        return f"Strong close (score {score})"
    if role == "cta":
        return f"Call-to-action (score {score})"
    if score >= 0.7:
        return f"High value (score {score})"
    if score >= 0.5:
        return f"Context (score {score})"
    return f"Low value filler (score {score})"


def edit_piece(
    content: dict[str, Any],
    style_dna: dict[str, Any],
    target_sec: float = 60.0,
) -> EditPlan:
    """Convenience function."""
    return Editor().edit(content, style_dna, target_sec)
