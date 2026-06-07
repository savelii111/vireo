"""Tests for broll.py — Pexels client (transport-injected) and inserter logic."""

import json
import os
import pytest
from pathlib import Path
from vireo_video.broll import (
  PexelsClient, BrollClip, BrollMatch, BrollInserter, BrollError,
  extract_query, _pick_best_file,
)
from vireo_video.transcriber import Transcript, Segment, Word


def make_response(videos, total_results=0):
  return {
    "page": 1, "per_page": len(videos), "total_results": total_results or len(videos),
    "videos": videos,
  }


def make_video(id, duration, width=1920, height=1080, user="Photographer"):
  return {
    "id": id, "duration": duration, "width": width, "height": height,
    "url": f"https://pexels.com/video/{id}",
    "image": f"https://images.pexels.com/videos/{id}/free-video-{id}.jpg",
    "user": {"id": id * 10, "name": user, "url": f"https://pexels.com/@{user}"},
    "video_files": [
      {"id": 1, "quality": "hd", "file_type": "video/mp4", "width": width, "height": height,
       "link": f"https://videos.pexels.com/video/{id}/hd.mp4"},
    ],
  }


def make_mock_pexels(responses):
  """Build a PexelsClient with injected transport."""
  calls = []
  def transport(method, url, *, params=None, headers=None, timeout=30):
    calls.append({"method": method, "url": url, "params": params, "headers": headers})
    r = responses.pop(0) if responses else {"status": 500, "body": "{}"}
    if isinstance(r, Exception):
      raise r
    class Resp:
      def __init__(self, status, body):
        self.status_code = status
        self._body = body
      def json(self):
        return json.loads(self._body)
    return Resp(r["status"], r["body"])
  return PexelsClient(api_key="test-key", transport=transport), calls


# ---------- extract_query ----------

def test_extract_query_basic():
  assert extract_query("Today we discussed the new office") == "discussed office new"

def test_extract_query_filters_stopwords():
  # Stopwords like "the", "a", "we" should be removed
  q = extract_query("The quick brown fox")
  assert "the" not in q.split()
  assert "quick" in q.split()

def test_extract_query_handles_empty():
  assert extract_query("") == ""

def test_extract_query_handles_only_stopwords():
  # "the and" -> fallback to first non-empty
  assert extract_query("the and") == "the"  # fallback

def test_extract_query_limits_to_max_words():
  text = "Python programming language code software developer algorithms"
  q = extract_query(text, max_words=2)
  assert len(q.split()) == 2


# ---------- _pick_best_file ----------

def test_pick_best_prefers_mp4():
  files = [
    {"width": 1920, "height": 1080, "file_type": "video/webm", "link": "x.webm"},
    {"width": 1920, "height": 1080, "file_type": "video/mp4", "link": "x.mp4"},
  ]
  chosen = _pick_best_file(files)
  assert chosen["link"].endswith(".mp4")

def test_pick_best_prefers_hd():
  files = [
    {"width": 640, "height": 360, "file_type": "video/mp4", "link": "sd.mp4"},
    {"width": 1920, "height": 1080, "file_type": "video/mp4", "link": "hd.mp4"},
  ]
  chosen = _pick_best_file(files)
  assert chosen["link"] == "hd.mp4"

def test_pick_best_fallback():
  files = [{"width": 1920, "height": 1080, "link": "x.mp4"}]
  chosen = _pick_best_file(files)
  assert chosen is not None

def test_pick_best_empty():
  assert _pick_best_file([]) is None


# ---------- PexelsClient ----------

def test_pexels_no_api_key_raises(monkeypatch):
  monkeypatch.delenv("PEXELS_API_KEY", raising=False)
  c = PexelsClient.__new__(PexelsClient)
  c.api_key = None
  c.transport = c._default_transport
  with pytest.raises(BrollError) as exc:
    c.search_videos("test")
  assert "PEXELS" in str(exc.value) or exc.value.code == "config_missing"

def test_pexels_search_basic():
  response = make_response([
    make_video(123, 15.0, user="Alice"),
    make_video(456, 8.0, user="Bob"),
  ])
  c, calls = make_mock_pexels([{"status": 200, "body": json.dumps(response)}])
  clips = c.search_videos("ocean")
  assert len(clips) == 2
  assert clips[0].id == 123
  assert clips[0].user == "Alice"
  assert clips[0].query == "ocean"
  assert "hd.mp4" in clips[0].download_url
  assert calls[0]["params"]["query"] == "ocean"

def test_pexels_search_empty_query():
  c, _ = make_mock_pexels([])
  assert c.search_videos("") == []

def test_pexels_search_401():
  c, _ = make_mock_pexels([{"status": 401, "body": "{}"}])
  with pytest.raises(BrollError) as exc:
    c.search_videos("test")
  assert exc.value.code == "auth_error"

def test_pexels_search_429():
  c, _ = make_mock_pexels([{"status": 429, "body": "{}"}])
  with pytest.raises(BrollError) as exc:
    c.search_videos("test")
  assert exc.value.code == "rate_limit"

def test_pexels_search_filters_by_duration():
  response = make_response([
    make_video(1, 5.0),   # too short
    make_video(2, 15.0),  # in range
    make_video(3, 100.0), # too long
  ])
  c, _ = make_mock_pexels([{"status": 200, "body": json.dumps(response)}])
  clips = c.search_videos("test", min_duration=10, max_duration=30)
  assert len(clips) == 1
  assert clips[0].id == 2

def test_pexels_search_sends_orientation():
  response = make_response([make_video(1, 10.0)])
  c, calls = make_mock_pexels([{"status": 200, "body": json.dumps(response)}])
  c.search_videos("test", orientation="portrait")
  assert calls[0]["params"]["orientation"] == "portrait"

def test_pexels_search_skips_clips_without_files():
  response = make_response([{
    "id": 1, "duration": 10, "width": 1920, "height": 1080,
    "url": "x", "image": "y", "user": {"name": "Z"},
    "video_files": [],
  }])
  c, _ = make_mock_pexels([{"status": 200, "body": json.dumps(response)}])
  assert c.search_videos("test") == []


# ---------- BrollInserter ----------

def make_transcript_with_visual_words():
  return Transcript(
    text="Various segments with visual cues.",
    language="en", duration=60.0,
    segments=[
      Segment(id=0, start=0, end=2, text="Hello welcome", words=[]),
      Segment(id=1, start=2, end=10, text="Today we are in Tokyo Japan looking at the office",
              words=[]),
      Segment(id=2, start=10, end=15, text="The city is amazing", words=[]),
      Segment(id=3, start=15, end=20, text="This short bit", words=[]),  # too short
      Segment(id=4, start=20, end=50, text="Imagine a beautiful forest with mountains in the distance",
              words=[]),
      Segment(id=5, start=50, end=55, text="and not really visual", words=[]),  # short
    ],
  )


def test_inserter_selects_visual_segments():
  t = make_transcript_with_visual_words()
  # mock pexels
  c, _ = make_mock_pexels([])
  ins = BrollInserter(c, download_dir="tests/tmp_broll")
  matches = ins.select_segments(t, max_segments=2)
  assert len(matches) == 2
  # The first selected should be the segment with "office" (high visual score)
  selected_ids = [int(m.segment_start) for m in matches]
  # We expect segments 1, 2, or 4 (all 3+ seconds, contain visual words)
  # Highest scored: "forest mountains" (4) or "office" (1) or "city" (2)
  for m in matches:
    assert m.query  # non-empty query

def test_inserter_select_skips_short_segments():
  t = make_transcript_with_visual_words()
  c, _ = make_mock_pexels([])
  ins = BrollInserter(c)
  matches = ins.select_segments(t, max_segments=10)
  for m in matches:
    assert m.segment_end - m.segment_start >= 3

def test_inserter_fetch_handles_no_results():
  c, _ = make_mock_pexels([{"status": 200, "body": json.dumps({"videos": []})}])
  ins = BrollInserter(c, download_dir="tests/tmp_broll")
  matches = [BrollMatch(0, 5, "office view", query="office")]
  result = ins.fetch_for_matches(matches, orientation="landscape")
  assert len(result) == 1
  assert result[0].clip is None  # nothing found
  assert result[0].downloaded is False

def test_inserter_fetch_downloads_clip(tmp_path):
  download_dir = tmp_path / "broll"
  response = make_response([make_video(42, 10.0)])
  c, _ = make_mock_pexels([{"status": 200, "body": json.dumps(response)}])
  # Mock download
  original_download = c.download
  def mock_download(clip, path, *, timeout=120):
    Path(path).write_bytes(b"fake video content")
    clip.local_path = path
    return path
  c.download = mock_download

  ins = BrollInserter(c, download_dir=str(download_dir))
  matches = [BrollMatch(0, 5, "office view", query="office")]
  result = ins.fetch_for_matches(matches)
  assert result[0].clip is not None
  assert result[0].clip.id == 42
  assert result[0].downloaded is True
  assert Path(result[0].clip.local_path).exists()


# ---------- BrollMatch/BrollClip dataclasses ----------

def test_brollmatch_to_dict():
  m = BrollMatch(0, 5, "text", query="q")
  d = m.to_dict()
  assert d["segment_start"] == 0
  assert d["clip"] is None
  assert d["downloaded"] is False

def test_brollclip_to_dict():
  c = BrollClip(id=1, url="u", duration_sec=10, width=1920, height=1080, download_url="d")
  d = c.to_dict()
  assert d["id"] == 1
  assert d["width"] == 1920
