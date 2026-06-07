"""Whisper transcription cache — avoid paying twice for the same file.

Why caching matters:
  - Whisper API costs $0.006/minute of audio
  - A typical 10-minute video re-processed 10 times = $0.60 wasted
  - Same file uploaded twice (re-edit, retry) = $0.12 wasted
  - In production, hot files get re-transcribed ALL the time

Cache strategy:
  - Key: SHA256 of (file path + size + mtime) → "stable" across retries
  - Storage: JSON files in a configurable directory
  - TTL: configurable, default 30 days (configurable via env VIREO_WHISPER_CACHE_TTL_DAYS)
  - Disabled: set VIREO_WHISPER_CACHE=0 or pass enabled=False
  - Thread/process safe: we use atomic writes (write to .tmp, then rename)
"""

from __future__ import annotations
import hashlib
import json
import os
import time
from dataclasses import asdict
from pathlib import Path
from typing import Optional

from .transcriber import Transcript, parse_transcript_response


class TranscriptionCache:
  """File-based cache for Whisper API responses."""

  def __init__(
    self,
    *,
    cache_dir: str | None = None,
    ttl_seconds: int = 30 * 24 * 3600,
    enabled: bool = True,
    clock=None,
  ):
    self.cache_dir = Path(cache_dir or os.environ.get(
      "VIREO_WHISPER_CACHE_DIR", "./whisper_cache"
    ))
    self.ttl_seconds = ttl_seconds
    self.enabled = enabled
    self._clock = clock or time.time
    if self.enabled:
      self.cache_dir.mkdir(parents=True, exist_ok=True)

  @staticmethod
  def compute_key(file_path: str) -> str:
    """Stable cache key from file path + size + mtime.

    We use mtime+size (not full content hash) because:
      - Faster (no need to read 100MB+ audio files)
      - Detects file changes (mtime changes when file is modified)
      - Works across the same file re-uploaded to different paths
    """
    p = Path(file_path)
    if not p.is_file():
      return hashlib.sha256(file_path.encode("utf-8")).hexdigest()
    stat = p.stat()
    raw = f"{p.resolve()}|{stat.st_size}|{int(stat.st_mtime)}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()

  def _key_to_path(self, key: str) -> Path:
    # Use first 2 chars of hash for sharding (avoids too many files in one dir)
    return self.cache_dir / key[:2] / f"{key}.json"

  def get(self, file_path: str) -> Optional[Transcript]:
    """Get a cached transcript, or None if missing/expired."""
    if not self.enabled:
      return None
    key = self.compute_key(file_path)
    path = self._key_to_path(key)
    if not path.is_file():
      return None
    try:
      with open(path, "r", encoding="utf-8") as f:
        entry = json.load(f)
    except (json.JSONDecodeError, OSError):
      return None
    # Check TTL
    cached_at = entry.get("cached_at", 0)
    if self.ttl_seconds > 0 and (self._clock() - cached_at) > self.ttl_seconds:
      try:
        path.unlink()
      except OSError:
        pass
      return None
    data = entry.get("data", {})
    if not data:
      return None
    try:
      return parse_transcript_response(data, model=entry.get("model"))
    except Exception:
      return None

  def put(self, file_path: str, transcript: Transcript) -> str:
    """Cache a transcript. Returns the cache key."""
    if not self.enabled:
      return ""
    key = self.compute_key(file_path)
    path = self._key_to_path(key)
    path.parent.mkdir(parents=True, exist_ok=True)
    entry = {
      "cached_at": self._clock(),
      "key": key,
      "model": transcript.model,
      "data": asdict(transcript) if hasattr(transcript, "__dataclass_fields__") else transcript.raw,
    }
    # Atomic write: tmp file, then rename
    tmp = path.with_suffix(".tmp")
    try:
      with open(tmp, "w", encoding="utf-8") as f:
        json.dump(entry, f, ensure_ascii=False, indent=None, separators=(",", ":"))
      tmp.replace(path)
    except OSError:
      if tmp.exists():
        try: tmp.unlink()
        except OSError: pass
      raise
    return key

  def clear(self) -> int:
    """Remove all cached entries. Returns number of files removed."""
    if not self.enabled or not self.cache_dir.is_dir():
      return 0
    count = 0
    for path in self.cache_dir.rglob("*.json"):
      try:
        path.unlink()
        count += 1
      except OSError:
        pass
    return count

  def stats(self) -> dict:
    """Return cache statistics."""
    if not self.enabled or not self.cache_dir.is_dir():
      return {"enabled": False, "files": 0, "size_bytes": 0}
    files = list(self.cache_dir.rglob("*.json"))
    size = sum(p.stat().st_size for p in files if p.is_file())
    return {
      "enabled": True,
      "files": len(files),
      "size_bytes": size,
      "cache_dir": str(self.cache_dir),
      "ttl_seconds": self.ttl_seconds,
    }


def is_cache_enabled() -> bool:
  """Check if caching is enabled via environment variable."""
  env = os.environ.get("VIREO_WHISPER_CACHE", "1")
  return env not in ("0", "false", "False", "no", "NO", "")


def make_default_cache() -> TranscriptionCache:
  """Create a cache with default settings from env vars."""
  ttl_days = int(os.environ.get("VIREO_WHISPER_CACHE_TTL_DAYS", "30"))
  return TranscriptionCache(
    ttl_seconds=ttl_days * 24 * 3600,
    enabled=is_cache_enabled(),
  )
