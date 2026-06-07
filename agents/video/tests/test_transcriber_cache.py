"""Tests for Whisper transcription cache."""

import json
import os
import time
import pytest
from unittest.mock import MagicMock
from pathlib import Path

from vireo_video.transcriber_cache import (
  TranscriptionCache, is_cache_enabled, make_default_cache,
)
from vireo_video.transcriber import Transcript, Segment, Word
from vireo_video.cached_whisper import CachedWhisperClient
from vireo_video.transcriber import WhisperClient


# --- Test helpers ---

@pytest.fixture
def sample_transcript():
  return Transcript(
    text="Hello world",
    language="en",
    duration=2.5,
    segments=[
      Segment(id=0, start=0.0, end=1.0, text="Hello", words=[
        Word(text="Hello", start=0.0, end=1.0, confidence=0.99),
      ]),
      Segment(id=1, start=1.0, end=2.5, text="world", words=[
        Word(text="world", start=1.0, end=2.5, confidence=0.95),
      ]),
    ],
    model="whisper-1",
    raw={"text": "Hello world", "language": "en", "duration": 2.5,
         "segments": [{"id":0,"start":0.0,"end":1.0,"text":"Hello"},
                      {"id":1,"start":1.0,"end":2.5,"text":"world"}]},
  )


@pytest.fixture
def tmp_file(tmp_path):
  p = tmp_path / "audio.mp3"
  p.write_bytes(b"fake audio content " * 100)
  return str(p)


# --- compute_key ---

def test_compute_key_deterministic(tmp_file):
  c = TranscriptionCache(cache_dir="/tmp/_never_used", enabled=False)
  k1 = c.compute_key(tmp_file)
  k2 = c.compute_key(tmp_file)
  assert k1 == k2
  assert len(k1) == 64  # SHA256 hex

def test_compute_key_changes_with_mtime(tmp_file, tmp_path):
  c = TranscriptionCache(cache_dir="/tmp/_never_used", enabled=False)
  k1 = c.compute_key(tmp_file)
  time.sleep(0.1)
  os.utime(tmp_file, (time.time(), time.time() + 100))  # bump mtime
  k2 = c.compute_key(tmp_file)
  assert k1 != k2

def test_compute_key_changes_with_size(tmp_file):
  c = TranscriptionCache(cache_dir="/tmp/_never_used", enabled=False)
  k1 = c.compute_key(tmp_file)
  with open(tmp_file, "ab") as f:
    f.write(b"more")
  k2 = c.compute_key(tmp_file)
  assert k1 != k2

def test_compute_key_handles_missing_file():
  c = TranscriptionCache(cache_dir="/tmp/_never_used", enabled=False)
  k = c.compute_key("/nonexistent/path/audio.mp3")
  assert len(k) == 64  # Falls back to path-only hash


# --- get/put ---

def test_put_and_get(tmp_path, tmp_file, sample_transcript):
  c = TranscriptionCache(cache_dir=str(tmp_path), enabled=True)
  c.put(tmp_file, sample_transcript)
  got = c.get(tmp_file)
  assert got is not None
  assert got.text == "Hello world"
  assert got.language == "en"
  assert len(got.segments) == 2
  assert got.segments[0].text == "Hello"

def test_get_missing(tmp_path, tmp_file):
  c = TranscriptionCache(cache_dir=str(tmp_path), enabled=True)
  got = c.get(tmp_file)
  assert got is None

def test_get_disabled(tmp_path, tmp_file, sample_transcript):
  c = TranscriptionCache(cache_dir=str(tmp_path), enabled=False)
  c.put(tmp_file, sample_transcript)
  got = c.get(tmp_file)
  assert got is None  # disabled returns None

def test_put_disabled(tmp_path, tmp_file, sample_transcript):
  c = TranscriptionCache(cache_dir=str(tmp_path), enabled=False)
  key = c.put(tmp_file, sample_transcript)
  assert key == ""
  assert not list(tmp_path.rglob("*.json"))

def test_ttl_expiry(tmp_path, tmp_file, sample_transcript):
  fake_now = [1000.0]
  def clock():
    return fake_now[0]
  c = TranscriptionCache(cache_dir=str(tmp_path), ttl_seconds=60, clock=clock)
  c.put(tmp_file, sample_transcript)
  fake_now[0] = 1000.0  # Same time
  assert c.get(tmp_file) is not None
  fake_now[0] = 1061.0  # After TTL
  assert c.get(tmp_file) is None
  # File should be deleted on expiry
  files = list(tmp_path.rglob("*.json"))
  assert len(files) == 0

def test_ttl_zero_means_never_expire(tmp_path, tmp_file, sample_transcript):
  fake_now = [1000.0]
  c = TranscriptionCache(cache_dir=str(tmp_path), ttl_seconds=0, clock=lambda: fake_now[0])
  c.put(tmp_file, sample_transcript)
  fake_now[0] = 1000.0 + 365 * 24 * 3600  # 1 year later
  assert c.get(tmp_file) is not None

def test_corrupt_cache_file(tmp_path, tmp_file):
  c = TranscriptionCache(cache_dir=str(tmp_path), enabled=True)
  key = c.compute_key(tmp_file)
  cache_path = c._key_to_path(key)
  cache_path.parent.mkdir(parents=True, exist_ok=True)
  cache_path.write_text("not json{{{")
  assert c.get(tmp_file) is None

def test_sharded_cache_path(tmp_path, tmp_file, sample_transcript):
  c = TranscriptionCache(cache_dir=str(tmp_path), enabled=True)
  c.put(tmp_file, sample_transcript)
  # Files should be in subdirs by first 2 chars of key
  subdirs = [d for d in tmp_path.iterdir() if d.is_dir()]
  assert len(subdirs) == 1
  assert len(subdirs[0].name) == 2

def test_clear(tmp_path, tmp_file, sample_transcript):
  c = TranscriptionCache(cache_dir=str(tmp_path), enabled=True)
  c.put(tmp_file, sample_transcript)
  count = c.clear()
  assert count == 1
  assert c.get(tmp_file) is None

def test_stats(tmp_path, tmp_file, sample_transcript):
  c = TranscriptionCache(cache_dir=str(tmp_path), enabled=True)
  c.put(tmp_file, sample_transcript)
  s = c.stats()
  assert s["enabled"] is True
  assert s["files"] == 1
  assert s["size_bytes"] > 0
  assert "cache_dir" in s

def test_stats_disabled(tmp_path):
  c = TranscriptionCache(cache_dir=str(tmp_path), enabled=False)
  s = c.stats()
  assert s["enabled"] is False
  assert s["files"] == 0


# --- Atomic writes ---

def test_atomic_write_no_tmp_files_left(tmp_path, tmp_file, sample_transcript):
  c = TranscriptionCache(cache_dir=str(tmp_path), enabled=True)
  c.put(tmp_file, sample_transcript)
  tmps = list(tmp_path.rglob("*.tmp"))
  assert len(tmps) == 0


# --- CachedWhisperClient ---

class FakeWhisperClient:
  def __init__(self, transcript):
    self.transcript = transcript
    self.call_count = 0
  def transcribe_file(self, *args, **kwargs):
    self.call_count += 1
    return self.transcript
  def estimate_cost(self, duration_sec):
    return duration_sec * 0.0001


def test_cached_client_miss_then_hit(tmp_path, tmp_file, sample_transcript):
  base = FakeWhisperClient(sample_transcript)
  cache = TranscriptionCache(cache_dir=str(tmp_path), enabled=True)
  client = CachedWhisperClient(base, cache=cache)
  t1, was_cached = client.transcribe_file(tmp_file)
  assert was_cached is False
  assert base.call_count == 1
  t2, was_cached = client.transcribe_file(tmp_file)
  assert was_cached is True
  assert base.call_count == 1  # not called again
  assert t1.text == t2.text

def test_cached_client_disabled(tmp_path, tmp_file, sample_transcript):
  base = FakeWhisperClient(sample_transcript)
  cache = TranscriptionCache(cache_dir=str(tmp_path), enabled=False)
  client = CachedWhisperClient(base, cache=cache)
  client.transcribe_file(tmp_file)
  client.transcribe_file(tmp_file)
  assert base.call_count == 2  # cache disabled, both call API

def test_cached_client_use_cache_false(tmp_path, tmp_file, sample_transcript):
  base = FakeWhisperClient(sample_transcript)
  cache = TranscriptionCache(cache_dir=str(tmp_path), enabled=True)
  client = CachedWhisperClient(base, cache=cache)
  client.transcribe_file(tmp_file, use_cache=False)
  client.transcribe_file(tmp_file, use_cache=False)
  assert base.call_count == 2  # both bypass cache

def test_cached_client_stats(tmp_path, tmp_file, sample_transcript):
  base = FakeWhisperClient(sample_transcript)
  cache = TranscriptionCache(cache_dir=str(tmp_path), enabled=True)
  client = CachedWhisperClient(base, cache=cache)
  client.transcribe_file(tmp_file)  # miss
  client.transcribe_file(tmp_file)  # hit
  client.transcribe_file(tmp_file)  # hit
  s = client.stats()
  assert s["hits"] == 2
  assert s["misses"] == 1
  assert s["hit_rate"] == 2/3

def test_cached_client_error_increments_error_count(tmp_path, tmp_file):
  class FailingClient:
    def transcribe_file(self, *a, **kw):
      raise RuntimeError("API down")
  base = FailingClient()
  cache = TranscriptionCache(cache_dir=str(tmp_path), enabled=True)
  client = CachedWhisperClient(base, cache=cache)
  with pytest.raises(RuntimeError):
    client.transcribe_file(tmp_file)
  s = client.stats()
  assert s["errors"] == 1

def test_cached_client_estimate_cost(tmp_path, tmp_file):
  base = FakeWhisperClient(None)
  cache = TranscriptionCache(cache_dir=str(tmp_path), enabled=True)
  client = CachedWhisperClient(base, cache=cache)
  cost = client.estimate_cost(600.0)  # 10 minutes
  assert cost > 0


# --- env helpers ---

def test_is_cache_enabled_true(monkeypatch):
  monkeypatch.setenv("VIREO_WHISPER_CACHE", "1")
  assert is_cache_enabled() is True

def test_is_cache_enabled_false(monkeypatch):
  monkeypatch.setenv("VIREO_WHISPER_CACHE", "0")
  assert is_cache_enabled() is False

def test_make_default_cache_uses_env(monkeypatch, tmp_path):
  monkeypatch.setenv("VIREO_WHISPER_CACHE_DIR", str(tmp_path))
  monkeypatch.setenv("VIREO_WHISPER_CACHE_TTL_DAYS", "7")
  c = make_default_cache()
  assert c.cache_dir == Path(tmp_path)
  assert c.ttl_seconds == 7 * 24 * 3600
