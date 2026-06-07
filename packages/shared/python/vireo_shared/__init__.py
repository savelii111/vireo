"""Vireo — shared types and protocols for all agents."""
from __future__ import annotations
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any
import json
import uuid


def new_id() -> str:
    return uuid.uuid4().hex[:12]


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


@dataclass
class StyleDNA:
    """The soul of a creator — distilled into structured DNA."""
    user_id: str
    tone: str = "neutral"
    pacing: str = "medium"
    vocabulary_level: str = "conversational"
    humor_style: str = "subtle"
    hook_patterns: list[str] = field(default_factory=list)
    cta_patterns: list[str] = field(default_factory=list)
    color_palette: list[str] = field(default_factory=list)
    music_genres: list[str] = field(default_factory=list)
    avg_content_length_sec: int = 60
    topics: list[str] = field(default_factory=list)
    confidence: float = 0.0
    sample_count: int = 0
    created_at: str = field(default_factory=now_iso)
    updated_at: str = field(default_factory=now_iso)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=2)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "StyleDNA":
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})


@dataclass
class ContentPiece:
    """A single piece of content — raw, edited, or published."""
    id: str = field(default_factory=new_id)
    user_id: str = ""
    raw_url: str = ""
    platform: str = ""
    transcript: str = ""
    duration_sec: int = 0
    metadata: dict[str, Any] = field(default_factory=dict)
    created_at: str = field(default_factory=now_iso)


@dataclass
class EditPlan:
    """The result of an edit pass — what to cut, what to keep."""
    source_id: str
    cuts: list[dict[str, Any]] = field(default_factory=list)
    output_duration_sec: int = 0
    style_applied: dict[str, Any] = field(default_factory=dict)
    notes: str = ""


@dataclass
class PublishJob:
    """A scheduled or completed publish to a platform."""
    id: str = field(default_factory=new_id)
    content_id: str = ""
    platform: str = ""
    scheduled_at: str = ""
    published_at: str = ""
    status: str = "pending"
    platform_post_id: str = ""
    error: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class MetricSnapshot:
    """Metrics pulled from a platform after publish."""
    content_id: str
    platform: str
    views: int = 0
    likes: int = 0
    comments: int = 0
    shares: int = 0
    saves: int = 0
    watch_time_sec: int = 0
    engagement_rate: float = 0.0
    captured_at: str = field(default_factory=now_iso)
