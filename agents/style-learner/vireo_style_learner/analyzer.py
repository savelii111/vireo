"""Core style analysis — pure Python, no external API calls.

Given a corpus of past content (transcripts, captions, titles), produces
a StyleDNA object describing tone, pacing, vocabulary, humor, hooks,
CTAs, topics, and confidence.

Design principles:
  - Works offline. No API keys, no LLM calls. Deterministic.
  - Pluggable. The LLMEnhancedAnalyzer wraps this and adds depth.
  - Honest. Confidence is computed from real signal, not magic.
"""
from __future__ import annotations
import re
import math
from collections import Counter
from statistics import mean, pstdev
from typing import Any

from vireo_shared import StyleDNA, now_iso


# ---------------------------------------------------------------------------
# Lexicons (English + Russian because user is in Europe / RU-speaking)
# ---------------------------------------------------------------------------

TONE_MARKERS = {
    "energetic": [
        r"\b(amazing|incredible|insane|crazy|wild|mind-?blow|holy|wtf|lol|lmao|bruh|огонь|жесть|пушка|топ|бомба|реально)\b",
        r"!{2,}",
    ],
    "professional": [
        r"\b(therefore|furthermore|however|moreover|implement|solution|framework|analysis|strategy|однако|соответственно|таким образом|в свою очередь)\b",
    ],
    "casual": [
        r"\b(bro|dude|honestly|like|just|gonna|wanna|yeah|nope|yep|короче|блин|типа|кстати|реально|норм)\b",
    ],
    "educational": [
        r"\b(because|therefore|means|example|let's say|suppose|imagine|think of it as|то есть|допустим|представь|иными словами|например)\b",
    ],
    "storytelling": [
        r"\b(so I was|i remember|once upon|one time|years ago|that day|однажды|помню|как-то раз|в тот день)\b",
    ],
    "provocative": [
        r"\b(nobody tells you|the truth is|unpopular opinion|hot take|controversial|ничего не понимают|все ошибаются|правда в том)\b",
    ],
}

HUMOR_MARKERS = {
    "subtle": [
        r"\b(irony|metaphor|subtle|gentle|quiet|тонко|иронично|мягко|ненавязчиво)\b",
    ],
    "sarcastic": [
        r"\b(yeah right|sure thing|obviously|of course|nope|sarcasm|сарказм|ну да|конечно|ага|ага-ага)\b",
    ],
    "absurd": [
        r"\b(somehow|weirdly|randomly|suddenly|plot twist|wtf|абсурд|вдруг|внезапно|какого чёрта)\b",
    ],
    "observational": [
        r"\b(everyone does|we all|always|never|that's why|everyone knows|все знают|всегда|никогда)\b",
    ],
    "wordplay": [
        r"\b(pun|wordplay|play on words|double meaning|каламбур|игра слов|омоним)\b",
    ],
}

VOCAB_LEVELS = {
    "simple": 4.0,      # avg word length < 4.5 chars
    "conversational": 5.5,
    "educated": 6.5,
    "academic": 7.5,
}

HOOK_PATTERNS = [
    (r"^(did you know|here's why|the truth is|nobody tells you|most people)",
     "curiosity"),
    (r"^(stop|wait|hold on|listen|look|attention)", "command"),
    (r"^(i (just|recently)|yesterday|today|this morning|last week)", "temporal"),
    (r"^(imagine|suppose|what if|picture this)", "imaginary"),
    (r"^(the (real|truth|secret|reason))", "reveal"),
    (r"^\?", "question"),
    (r"^[\"']", "quote"),
    (r"^\d+", "number"),
    (r"^(почему|зачем|как|что если|представьте|знаете ли вы)", "curiosity_ru"),
    (r"^(стоп|подожди|слушай|смотри|внимание)", "command_ru"),
    (r"^(вчера|сегодня|недавно|вот)", "temporal_ru"),
    (r"^\?", "question"),
]

CTA_PATTERNS = [
    (r"\b(subscribe|follow|like|comment|share|hit the bell|подпишись|лайк|коммент|репост)\b", "engagement"),
    (r"\b(check (out|it out)|link in bio|see more|description|смотри|ссылка|описание)\b", "traffic"),
    (r"\b(let me know|thoughts\?|what do you think|agree\?|disagree\?|как считаете|что думаете|ваше мнение)\b", "discussion"),
    (r"\b(next video|see you|tomorrow|soon|в следующем|до завтра|скоро)\b", "retention"),
    (r"\b(dm me|message me|direct message|пишите|пиши в лс|в директ)\b", "dm"),
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _word_count(text: str) -> int:
    return len([w for w in re.findall(r"\b\w+\b", text)])


def _avg_word_len(text: str) -> float:
    words = re.findall(r"\b\w+\b", text)
    if not words:
        return 0.0
    return mean(len(w) for w in words)


def _sentence_lengths(text: str) -> list[int]:
    sentences = re.split(r"[.!?]+", text)
    return [len(re.findall(r"\b\w+\b", s)) for s in sentences if s.strip()]


def _lexicon_score(text: str, markers: dict[str, list[str]]) -> dict[str, float]:
    text_lower = text.lower()
    total = max(_word_count(text), 1)
    out: dict[str, float] = {}
    for label, patterns in markers.items():
        hits = 0
        for pat in patterns:
            hits += len(re.findall(pat, text_lower, flags=re.IGNORECASE))
        out[label] = hits / total * 100  # hits per 100 words
    return out


def _filler_ratio(text: str) -> float:
    fillers = r"\b(um|uh|er|like|you know|i mean|basically|actually|literally|типа|короче|это самое|ну|вот|как бы)\b"
    words = max(_word_count(text), 1)
    return len(re.findall(fillers, text.lower(), flags=re.IGNORECASE)) / words


def _exclamation_ratio(text: str) -> float:
    sentences = [s for s in re.split(r"[.!?]+", text) if s.strip()]
    if not sentences:
        return 0.0
    excl = text.count("!")
    return excl / len(sentences)


def _question_ratio(text: str) -> float:
    sentences = [s for s in re.split(r"[.!?]+", text) if s.strip()]
    if not sentences:
        return 0.0
    qs = text.count("?")
    return qs / len(sentences)


# ---------------------------------------------------------------------------
# Main analyzer
# ---------------------------------------------------------------------------

class StyleAnalyzer:
    """Rule-based style analyzer. No external deps. Deterministic."""

    def __init__(self, config: dict[str, Any] | None = None) -> None:
        self.config = config or {}

    def analyze_piece(self, text: str, title: str = "") -> dict[str, Any]:
        """Analyze a single piece of content. Returns raw features."""
        if not text or not text.strip():
            return {"empty": True, "word_count": 0}
        words = _word_count(text)
        sentences = _sentence_lengths(text)
        features = {
            "word_count": words,
            "avg_word_len": round(_avg_word_len(text), 2),
            "avg_sentence_len": round(mean(sentences), 2) if sentences else 0,
            "sentence_len_std": round(pstdev(sentences), 2) if len(sentences) > 1 else 0,
            "filler_ratio": round(_filler_ratio(text), 4),
            "exclamation_ratio": round(_exclamation_ratio(text), 4),
            "question_ratio": round(_question_ratio(text), 4),
            "tone": _lexicon_score(text, TONE_MARKERS),
            "humor": _lexicon_score(text, HUMOR_MARKERS),
        }
        if title:
            features["title"] = {
                "len": _word_count(title),
                "starts_with_question": title.strip().endswith("?"),
                "has_number": bool(re.search(r"\d", title)),
            }
        return features

    def analyze_corpus(
        self,
        pieces: list[dict[str, Any]],
        user_id: str = "anonymous",
    ) -> StyleDNA:
        """Analyze a corpus and return a StyleDNA.

        Each piece is {"text": str, "title": str?, "duration_sec": int?, "platform": str?}.
        """
        if not pieces:
            return StyleDNA(user_id=user_id, confidence=0.0)

        all_features = [self.analyze_piece(p.get("text", ""), p.get("title", ""))
                        for p in pieces if p.get("text", "").strip()]

        n = len(all_features)
        if n == 0:
            return StyleDNA(user_id=user_id, confidence=0.0)

        # Aggregate tone — pick dominant (per 100 words, argmax)
        tone_keys = list(TONE_MARKERS.keys())
        humor_keys = list(HUMOR_MARKERS.keys())

        avg_tone = {
            k: mean(f["tone"].get(k, 0) for f in all_features) for k in tone_keys
        }
        avg_humor = {
            k: mean(f["humor"].get(k, 0) for f in all_features) for k in humor_keys
        }

        dominant_tone = max(avg_tone, key=lambda k: avg_tone[k]) if max(avg_tone.values()) > 0 else "neutral"
        dominant_humor = max(avg_humor, key=lambda k: avg_humor[k]) if max(avg_humor.values()) > 0 else "subtle"

        # Vocabulary
        avg_word_len = mean(f["avg_word_len"] for f in all_features)
        if avg_word_len < VOCAB_LEVELS["simple"]:
            vocab = "simple"
        elif avg_word_len < VOCAB_LEVELS["conversational"]:
            vocab = "conversational"
        elif avg_word_len < VOCAB_LEVELS["educated"]:
            vocab = "educated"
        else:
            vocab = "academic"

        # Pacing: sentence length + variance + filler density
        avg_sent_len = mean(f["avg_sentence_len"] for f in all_features)
        sent_std = mean(f["sentence_len_std"] for f in all_features)
        avg_filler = mean(f["filler_ratio"] for f in all_features)
        if avg_sent_len < 10 or (avg_sent_len < 12 and avg_filler > 0.03):
            pacing = "fast"
        elif avg_sent_len > 13 and avg_filler < 0.02:
            pacing = "slow"
        else:
            pacing = "medium"

        # Engagement markers
        avg_excl = mean(f["exclamation_ratio"] for f in all_features)
        avg_q = mean(f["question_ratio"] for f in all_features)
        avg_filler = mean(f["filler_ratio"] for f in all_features)

        # Hooks & CTAs — extract from titles + first sentences
        hooks: Counter[str] = Counter()
        ctas: Counter[str] = []
        for piece in pieces:
            title = piece.get("title", "")
            text = piece.get("text", "")
            first_sentence = (re.split(r"[.!?]+", text.strip()) or [""])[0]
            for pat, label in HOOK_PATTERNS:
                if re.match(pat, title, flags=re.IGNORECASE) or re.match(pat, first_sentence, flags=re.IGNORECASE):
                    hooks[label] += 1
                    break
            for pat, label in CTA_PATTERNS:
                if re.search(pat, text, flags=re.IGNORECASE):
                    if label not in ctas:
                        ctas.append(label)

        # Avg duration
        durations = [p.get("duration_sec", 0) for p in pieces if p.get("duration_sec")]
        avg_dur = int(mean(durations)) if durations else 60

        # Topics — naive: top capitalized phrases (works for EN + RU)
        topics: Counter[str] = Counter()
        for p in pieces:
            for m in re.findall(r"\b[A-ZА-Я][a-zа-я]{2,}\b", p.get("text", "")):
                topics[m] += 1
        top_topics = [w for w, _ in topics.most_common(8)]

        # Confidence: more samples = higher. Also: low variance in features = higher.
        n_factor = min(math.log2(n + 1) / 5, 1.0)  # saturates at 32 samples
        consistency = 1.0 - min(mean(f["sentence_len_std"] for f in all_features) / 20, 1.0)
        confidence = round((n_factor * 0.6 + consistency * 0.4), 3)

        return StyleDNA(
            user_id=user_id,
            tone=dominant_tone,
            pacing=pacing,
            vocabulary_level=vocab,
            humor_style=dominant_humor,
            hook_patterns=[k for k, _ in hooks.most_common(5)],
            cta_patterns=ctas[:5],
            avg_content_length_sec=avg_dur,
            topics=top_topics,
            confidence=confidence,
            sample_count=n,
            updated_at=now_iso(),
        )


def analyze_corpus(
    pieces: list[dict[str, Any]],
    user_id: str = "anonymous",
    config: dict[str, Any] | None = None,
) -> StyleDNA:
    """Convenience function."""
    return StyleAnalyzer(config).analyze_corpus(pieces, user_id)
