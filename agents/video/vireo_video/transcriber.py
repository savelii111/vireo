"""Transcription via OpenAI Whisper API.

Returns word-level timestamps (key for subtitle alignment, smart cuts,
and moment selection). No local Whisper — we use the API for simplicity
and zero GPU requirements.

Two modes:
  - transcribe_file(path) — upload audio/video to /v1/audio/transcriptions
  - transcribe_url(url)  — not supported by OpenAI; download first via yt-dlp

The transcribeFile response shape (verbose_json):
{
  "task": "transcribe",
  "language": "en",
  "duration": 10.0,
  "text": "full text",
  "segments": [{"id":0,"start":0.0,"end":2.5,"text":"hello world",
                "words":[{"word":"hello","start":0.0,"end":0.5}, ...]}],
  "words": [...]   # some models return top-level
}
"""

from __future__ import annotations
import json
import os
import time
from dataclasses import dataclass, field, asdict
from typing import Any, Optional
import requests


class TranscriptionError(RuntimeError):
  def __init__(self, message: str, status: int = 0, code: str | None = None):
    super().__init__(message)
    self.status = status
    self.code = code


@dataclass
class Word:
  text: str
  start: float
  end: float
  confidence: float | None = None

  def to_dict(self) -> dict:
    d = {"text": self.text, "start": self.start, "end": self.end}
    if self.confidence is not None:
      d["confidence"] = self.confidence
    return d


@dataclass
class Segment:
  id: int
  start: float
  end: float
  text: str
  words: list[Word] = field(default_factory=list)

  @property
  def duration(self) -> float:
    return self.end - self.start

  def to_dict(self) -> dict:
    return {
      "id": self.id,
      "start": self.start,
      "end": self.end,
      "text": self.text,
      "words": [w.to_dict() for w in self.words],
    }


@dataclass
class Transcript:
  text: str
  language: str | None
  duration: float
  segments: list[Segment] = field(default_factory=list)
  model: str | None = None
  raw: dict | None = None

  def words(self) -> list[Word]:
    """All words across all segments, flat."""
    out: list[Word] = []
    for s in self.segments:
      out.extend(s.words)
    return out

  def to_dict(self) -> dict:
    return {
      "text": self.text,
      "language": self.language,
      "duration": self.duration,
      "model": self.model,
      "segments": [s.to_dict() for s in self.segments],
    }


def _parse_word(w: dict) -> Word:
  return Word(
    text=w.get("word", "").strip(),
    start=float(w.get("start", 0) or 0),
    end=float(w.get("end", 0) or 0),
    confidence=w.get("probability") or w.get("confidence"),
  )


def parse_transcript_response(data: dict, *, model: str | None = None) -> Transcript:
  """Parse OpenAI verbose_json response into our Transcript dataclass.

  Handles both shapes:
    - data.segments[].words[] (newer verbose_json with word-level timestamps)
    - data.words[] (top-level word list)
  """
  segments: list[Segment] = []
  raw_segments = data.get("segments", []) or []
  if raw_segments:
    for s in raw_segments:
      words = [_parse_word(w) for w in (s.get("words") or [])]
      if not words and s.get("text"):
        # No word-level timestamps — DON'T synthesize a single Word spanning
        # the entire segment. V-39 fix: a single "word" with full segment
        # duration falsely triggered long_duration emphasis scoring in
        # zoom.find_emphasis_windows. Instead, skip the segment (the consumer
        # of words() can fall back to text-based logic).
        continue
      segments.append(Segment(
        id=s.get("id", len(segments)),
        start=float(s.get("start", 0) or 0),
        end=float(s.get("end", 0) or 0),
        text=s.get("text", ""),
        words=words,
      ))
  else:
    # No segments — synthesize from top-level words
    top_words = data.get("words") or []
    if top_words:
      words = [_parse_word(w) for w in top_words]
      text = " ".join(w.text for w in words)
      if words:
        segments.append(Segment(
          id=0,
          start=words[0].start,
          end=words[-1].end,
          text=text,
          words=words,
        ))

  return Transcript(
    text=data.get("text", "").strip() if isinstance(data.get("text"), str) else "",
    language=data.get("language"),
    duration=float(data.get("duration", 0) or 0),
    segments=segments,
    model=model,
    raw=data,
  )


class WhisperClient:
  """OpenAI Whisper API client with injectable transport."""

  def __init__(
    self,
    *,
    api_key: str | None = None,
    base_url: str = "https://api.openai.com/v1",
    model: str = "whisper-1",
    timeout: float = 600,
    transport: callable = None,
  ):
    self.api_key = api_key or os.environ.get("OPENAI_API_KEY")
    self.base_url = base_url.rstrip("/")
    self.model = model
    self.timeout = timeout
    # Default transport uses requests; can be injected for tests
    self.transport = transport or self._default_transport

  def _default_transport(self, method: str, url: str, *, files=None, data=None, headers=None):
    return requests.request(method, url, files=files, data=data, headers=headers, timeout=self.timeout)

  def transcribe_file(
    self,
    file_path: str,
    *,
    language: str | None = None,
    response_format: str = "verbose_json",
    timestamp_granularities: list[str] | None = None,
    max_retries: int = 2,
    retry_delay: float = 1.0,
  ) -> Transcript:
    """Transcribe a local file. Uses multipart upload.

    V-40 fix: retry up to max_retries times on transient errors (timeouts,
    5xx responses, connection errors). 4xx client errors are NOT retried
    (they are permanent). Exponential backoff: 1s, 2s, 4s, ...
    """
    if not self.api_key:
      raise TranscriptionError("OPENAI_API_KEY not set", 0, "config_missing")
    if not os.path.isfile(file_path):
      raise TranscriptionError(f"file not found: {file_path}", 0, "file_not_found")

    url = f"{self.base_url}/audio/transcriptions"
    headers = {"Authorization": f"Bearer {self.api_key}"}
    last_error: Exception | None = None
    for attempt in range(max_retries + 1):
      try:
        with open(file_path, "rb") as f:
          form_data: dict[str, Any] = {"model": self.model, "response_format": response_format}
          if language:
            form_data["language"] = language
          if timestamp_granularities:
            form_data["timestamp_granularities[]"] = timestamp_granularities
          resp = self.transport(
            "POST", url,
            files={"file": (os.path.basename(file_path), f)},
            data=form_data,
            headers=headers,
          )
        if resp.status_code != 200:
          msg = ""
          try:
            msg = resp.json().get("error", {}).get("message", "")
          except Exception:
            msg = resp.text[:200]
          err = TranscriptionError(f"whisper api error: {msg}", resp.status_code)
          # Retry on 5xx (server) and 429 (rate limit); not on 4xx client errors
          if (resp.status_code >= 500 or resp.status_code == 429) and attempt < max_retries:
            last_error = err
            time.sleep(retry_delay * (2 ** attempt))
            continue
          raise err
        return parse_transcript_response(resp.json() if hasattr(resp, "json") else resp)
      except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as e:
        last_error = e
        if attempt < max_retries:
          time.sleep(retry_delay * (2 ** attempt))
          continue
        raise TranscriptionError(f"transcribe failed after {max_retries + 1} attempts: {e}", 0, "network_error") from e
    # Should be unreachable
    raise TranscriptionError(f"transcribe failed: {last_error}", 0, "exhausted_retries")
    try:
      data = resp.json()
    except json.JSONDecodeError as e:
      raise TranscriptionError(f"non-JSON response: {e}", resp.status_code)
    return parse_transcript_response(data, model=self.model)

  def estimate_cost(self, duration_sec: float) -> float:
    """Whisper is $0.006 per minute of audio."""
    minutes = duration_sec / 60.0
    return round(minutes * 0.006, 6)
