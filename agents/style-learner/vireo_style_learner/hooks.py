"""Hook & CTA extraction from text.

More detailed than the corpus-level aggregation in analyzer.py — operates
on a single piece of content to return ranked hook/CTA suggestions for
the Editor agent to use when drafting new content.
"""
from __future__ import annotations
import re
from collections import Counter
from typing import Any

from .analyzer import HOOK_PATTERNS, CTA_PATTERNS


def extract_hooks(text: str, title: str = "", top_k: int = 5) -> list[dict[str, Any]]:
    """Return ranked hook templates that match this piece's style.

    Output: [{"label": "curiosity", "example": "...", "score": 0.8}, ...]
    """
    first_sentence = (re.split(r"[.!?]+", text.strip()) or [""])[0]
    candidates = [t for t in (title, first_sentence) if t]

    matches: list[dict[str, Any]] = []
    for candidate in candidates:
        for pat, label in HOOK_PATTERNS:
            if re.match(pat, candidate, flags=re.IGNORECASE):
                matches.append({
                    "label": label,
                    "example": candidate[:80],
                    "score": 1.0,
                })
                break

    if not matches:
        return [{
            "label": "statement",
            "example": first_sentence[:80] or "Start with a strong claim",
            "score": 0.5,
        }]

    counts: Counter[str] = Counter(m["label"] for m in matches)
    out: list[dict[str, Any]] = []
    for label, count in counts.most_common(top_k):
        example = next(m["example"] for m in matches if m["label"] == label)
        out.append({"label": label, "example": example, "score": count / len(matches)})
    return out


def extract_ctas(text: str, top_k: int = 5) -> list[dict[str, Any]]:
    """Return CTA templates present in the text."""
    found: list[dict[str, Any]] = []
    for pat, label in CTA_PATTERNS:
        m = re.search(pat, text, flags=re.IGNORECASE)
        if m:
            found.append({
                "label": label,
                "example": m.group(0),
                "score": 1.0,
            })
    if not found:
        return [{
            "label": "open_question",
            "example": "What do you think?",
            "score": 0.5,
        }]
    return found[:top_k]


def suggest_hooks_for_dna(dna: dict[str, Any], n: int = 5) -> list[dict[str, Any]]:
    """Given a StyleDNA, suggest n hook templates that match its style."""
    templates: dict[str, list[str]] = {
        "curiosity": [
            "Did you know that {TOPIC}?",
            "Here's why {TOPIC} matters:",
            "Nobody tells you this about {TOPIC}:",
        ],
        "command": [
            "Stop doing {BAD_THING}.",
            "Listen — {TOPIC} is broken.",
            "Watch this before you {ACTION}.",
        ],
        "temporal": [
            "I just discovered {TOPIC}.",
            "Yesterday, {EVENT}.",
            "Today changed everything about {TOPIC}.",
        ],
        "question": [
            "What if {HYPOTHETICAL}?",
            "Why does {TOPIC} work?",
            "Is {TOPIC} really worth it?",
        ],
        "reveal": [
            "The real reason {TOPIC} works:",
            "The secret to {TOPIC}:",
            "The truth about {TOPIC}:",
        ],
        "curiosity_ru": [
            "Знаете ли вы, почему {TOPIC}?",
            "Вот почему {TOPIC} работает:",
            "Никто не говорит вам про {TOPIC}:",
        ],
        "command_ru": [
            "Стоп. {TOPIC} — это не то, чем кажется.",
            "Слушай, {TOPIC} сломан.",
            "Посмотри это, прежде чем {ACTION}.",
        ],
        "temporal_ru": [
            "Вчера {EVENT}.",
            "Сегодня всё изменилось в {TOPIC}.",
            "Недавно я узнал про {TOPIC}.",
        ],
    }

    out: list[dict[str, Any]] = []
    patterns = dna.get("hook_patterns", []) or ["statement"]
    pool: list[str] = []
    for p in patterns:
        pool.extend(templates.get(p, []))
    if not pool:
        pool = templates["curiosity"] + templates["reveal"]

    for i in range(n):
        tmpl = pool[i % len(pool)]
        out.append({
            "label": patterns[i % len(patterns)] if patterns else "statement",
            "template": tmpl,
        })
    return out
