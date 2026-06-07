"""Cached Whisper client — wraps WhisperClient with TranscriptionCache.

Usage:
  base = WhisperClient(api_key="...")
  cached = CachedWhisperClient(base, cache=TranscriptionCache())
  transcript = cached.transcribe_file("video.mp4")
  # Second call returns from cache, no API call
"""

from __future__ import annotations
import time
from typing import Optional

from .transcriber import WhisperClient, Transcript
from .transcriber_cache import TranscriptionCache, make_default_cache


class CachedWhisperClient:
  """Whisper client wrapper that caches responses to disk."""

  def __init__(
    self,
    client: WhisperClient,
    *,
    cache: Optional[TranscriptionCache] = None,
  ):
    self.client = client
    self.cache = cache or make_default_cache()
    self._stats = {"hits": 0, "misses": 0, "errors": 0}

  def transcribe_file(
    self,
    file_path: str,
    *,
    language: str | None = None,
    response_format: str = "verbose_json",
    timestamp_granularities: list[str] | None = None,
    use_cache: bool = True,
  ) -> tuple[Transcript, bool]:
    """Transcribe with cache lookup.

    Returns:
      (Transcript, cached: bool)
    """
    if use_cache and self.cache.enabled:
      cached = self.cache.get(file_path)
      if cached is not None:
        self._stats["hits"] += 1
        return cached, True
    self._stats["misses"] += 1
    try:
      transcript = self.client.transcribe_file(
        file_path,
        language=language,
        response_format=response_format,
        timestamp_granularities=timestamp_granularities,
      )
    except Exception:
      self._stats["errors"] += 1
      raise
    if use_cache and self.cache.enabled:
      self.cache.put(file_path, transcript)
    return transcript, False

  def stats(self) -> dict:
    """Return cache hit/miss stats."""
    s = dict(self._stats)
    total = s["hits"] + s["misses"]
    s["hit_rate"] = s["hits"] / total if total > 0 else 0.0
    s["cache"] = self.cache.stats()
    return s

  def estimate_cost(self, duration_sec: float) -> float:
    return self.client.estimate_cost(duration_sec)
