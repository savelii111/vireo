"""Content piece normalization.

After transcription (or direct text input), we produce a list of
ContentPiece objects that can be fed to the Style Learner.

A ContentPiece represents one unit of content (a video, a podcast
episode, a tweet thread) with optional metadata.
"""
from __future__ import annotations
import re
from typing import Any
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id(prefix: str) -> str:
    import random, string
    return f"{prefix}_{''.join(random.choices(string.ascii_lowercase + string.digits, k=8))}"


@dataclass
class ContentPiece:
    id: str
    source_id: str
    text: str
    title: str = ""
    language: str = "en"
    duration_sec: float = 0.0
    created_at: str = field(default_factory=_now_iso)
    metadata: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)


def new_piece(text: str, *, source_id: str = "manual", title: str = "", language: str = "en",
              duration_sec: float = 0.0, metadata: dict | None = None) -> ContentPiece:
    return ContentPiece(
        id=_new_id("piece"),
        source_id=source_id,
        text=text.strip(),
        title=title,
        language=language,
        duration_sec=duration_sec,
        metadata=metadata or {},
    )


def from_transcript(source_id: str, text: str, language: str, duration_sec: float,
                    *, title: str = "", metadata: dict | None = None) -> ContentPiece:
    return new_piece(
        text=text,
        source_id=source_id,
        title=title or f"Transcript {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')}",
        language=language,
        duration_sec=duration_sec,
        metadata=metadata or {},
    )


# --- segmentation: split a long transcript into "chunks" useful for style learning.

# A piece of 30-60 seconds is roughly 80-180 words. We split on
# sentence boundaries and group into chunks.

SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")
WORD_COUNT = re.compile(r"\b\w+\b")


def split_into_chunks(text: str, *, target_words: int = 120, min_words: int = 40) -> list[str]:
    """Split text into chunks of ~target_words on sentence boundaries."""
    if not text or not text.strip():
        return []
    sentences = [s.strip() for s in SENTENCE_SPLIT.split(text) if s.strip()]
    chunks: list[str] = []
    current: list[str] = []
    current_words = 0
    for sent in sentences:
        w = len(WORD_COUNT.findall(sent))
        if current and current_words + w > target_words * 1.5:
            chunks.append(" ".join(current))
            current = [sent]
            current_words = w
        else:
            current.append(sent)
            current_words += w
            if current_words >= target_words and current_words >= min_words:
                chunks.append(" ".join(current))
                current = []
                current_words = 0
    if current:
        chunks.append(" ".join(current))
    return [c for c in chunks if WORD_COUNT.findall(c)]


def transcript_to_pieces(source_id: str, text: str, language: str, duration_sec: float,
                          *, title: str = "", chunk_words: int = 120) -> list[ContentPiece]:
    """Turn a single long transcript into multiple ContentPieces.

    Each chunk becomes its own piece so the style learner sees a diverse
    sample of how the creator talks throughout the video.
    """
    chunks = split_into_chunks(text, target_words=chunk_words)
    if not chunks:
        return [from_transcript(source_id, text, language, duration_sec, title=title)]
    # Distribute duration proportionally to word count.
    total_words = sum(len(WORD_COUNT.findall(c)) for c in chunks) or 1
    pieces: list[ContentPiece] = []
    base_t = datetime.now(timezone.utc)
    for i, chunk in enumerate(chunks):
        w = len(WORD_COUNT.findall(chunk))
        chunk_dur = duration_sec * (w / total_words)
        ts = base_t.replace(microsecond=0).isoformat()
        p = ContentPiece(
            id=_new_id("piece"),
            source_id=source_id,
            text=chunk,
            title=f"{title or 'Transcript'} (part {i+1}/{len(chunks)})",
            language=language,
            duration_sec=round(chunk_dur, 2),
            created_at=ts,
            metadata={"chunk_index": i, "total_chunks": len(chunks)},
        )
        pieces.append(p)
    return pieces
