"""Tests for transcriber.py — Whisper API client (transport-injected)."""

import json
import pytest
from vireo_video.transcriber import (
  WhisperClient, parse_transcript_response, Transcript, Word, Segment,
  TranscriptionError,
)


def make_response(segments=None, words=None, text="", duration=10.0, language="en"):
  """Build a fake verbose_json response."""
  return {
    "task": "transcribe",
    "language": language,
    "duration": duration,
    "text": text,
    "segments": segments or [],
    "words": words or [],
  }


def make_mock_client(response_data, *, status=200, api_key="sk-test"):
  """Build a WhisperClient with an injected transport."""
  def transport(method, url, *, files=None, data=None, headers=None):
    class Resp:
      def __init__(self, status, data):
        self.status_code = status
        self._data = data
      def json(self):
        return self._data
      @property
      def text(self):
        return json.dumps(self._data)
    return Resp(status, response_data)
  return WhisperClient(api_key=api_key, transport=transport)


# ---------- parse_transcript_response ----------

def test_parse_segments_with_words():
  resp = make_response(segments=[{
    "id": 0, "start": 0.0, "end": 2.5, "text": "Hello world.",
    "words": [
      {"word": "Hello", "start": 0.0, "end": 0.5, "probability": 0.99},
      {"word": "world.", "start": 0.6, "end": 1.2, "probability": 0.95},
    ],
  }])
  t = parse_transcript_response(resp, model="whisper-1")
  assert t.duration == 10.0
  assert t.language == "en"
  assert len(t.segments) == 1
  seg = t.segments[0]
  assert seg.start == 0.0
  assert seg.end == 2.5
  assert seg.text == "Hello world."
  assert len(seg.words) == 2
  assert seg.words[0].text == "Hello"
  assert seg.words[0].confidence == 0.99


def test_parse_segments_no_words_drops_segment():
  # V-39 fix: when a segment has no word-level timestamps, we no longer
  # synthesize a single Word spanning the whole segment (it would falsely
  # trigger long_duration emphasis scoring). The segment is skipped, so
  # words() returns an empty list and subtitles/zoom can fall back gracefully.
  resp = make_response(segments=[{
    "id": 0, "start": 0.0, "end": 2.5, "text": "Hello world.",
  }])
  t = parse_transcript_response(resp)
  # No words produced
  assert t.words() == []


def test_parse_top_level_words_only():
  resp = make_response(words=[
    {"word": "foo", "start": 0.0, "end": 0.5},
    {"word": "bar", "start": 0.6, "end": 1.0},
  ], text="foo bar")
  t = parse_transcript_response(resp)
  assert len(t.segments) == 1
  assert t.segments[0].text == "foo bar"
  assert len(t.segments[0].words) == 2


def test_parse_empty_response():
  t = parse_transcript_response({"text": ""})
  assert t.segments == []
  assert t.text == ""


def test_words_method_flattens():
  resp = make_response(segments=[
    {"id": 0, "start": 0, "end": 1, "text": "a b", "words": [
      {"word": "a", "start": 0, "end": 0.5},
      {"word": "b", "start": 0.5, "end": 1.0},
    ]},
    {"id": 1, "start": 1, "end": 2, "text": "c d", "words": [
      {"word": "c", "start": 1, "end": 1.5},
      {"word": "d", "start": 1.5, "end": 2.0},
    ]},
  ])
  t = parse_transcript_response(resp)
  assert len(t.words()) == 4
  assert [w.text for w in t.words()] == ["a", "b", "c", "d"]


# ---------- WhisperClient ----------

def test_client_no_api_key_raises():
  c = WhisperClient(api_key=None)
  with pytest.raises(TranscriptionError) as exc:
    c.transcribe_file("dummy.mp4")
  assert exc.value.code == "config_missing"


def test_client_file_not_found():
  c = WhisperClient(api_key="sk-test")
  with pytest.raises(TranscriptionError) as exc:
    c.transcribe_file("C:/nonexistent/file.mp4")
  assert exc.value.code == "file_not_found"


def test_client_transcribe_success(tmp_path):
  # Create a dummy file
  audio = tmp_path / "test.mp3"
  audio.write_bytes(b"fake audio content")

  resp = make_response(
    segments=[{"id": 0, "start": 0, "end": 1.5, "text": "Hello.", "words": [
      {"word": "Hello.", "start": 0, "end": 1.5, "probability": 0.99},
    ]}],
    text="Hello.",
  )
  c = make_mock_client(resp)
  t = c.transcribe_file(str(audio))
  assert t.text == "Hello."
  assert len(t.segments) == 1
  assert t.segments[0].words[0].text == "Hello."


def test_client_transcribe_api_error(tmp_path):
  audio = tmp_path / "test.mp3"
  audio.write_bytes(b"x")
  error_resp = {"error": {"message": "Invalid audio", "code": "invalid_audio"}}
  c = make_mock_client(error_resp, status=400)
  with pytest.raises(TranscriptionError) as exc:
    c.transcribe_file(str(audio))
  assert exc.value.status == 400


def test_client_transcribe_with_language_hint(tmp_path):
  audio = tmp_path / "test.mp3"
  audio.write_bytes(b"x")

  captured = {}
  def transport(method, url, *, files=None, data=None, headers=None):
    captured["data"] = data
    captured["headers"] = headers
    captured["url"] = url
    class Resp:
      status_code = 200
      def json(self): return make_response(text="Hola.", language="es")
      @property
      def text(self): return "{}"
    return Resp()
  c = WhisperClient(api_key="sk-test", transport=transport)
  c.transcribe_file(str(audio), language="es")
  assert captured["data"]["language"] == "es"
  assert "Bearer sk-test" in captured["headers"]["Authorization"]
  assert "audio/transcriptions" in captured["url"]


def test_estimate_cost():
  c = WhisperClient(api_key="sk-test")
  # 60s = 1 min = $0.006
  assert abs(c.estimate_cost(60.0) - 0.006) < 1e-6
  # 30s = 0.5 min = $0.003
  assert abs(c.estimate_cost(30.0) - 0.003) < 1e-6
  # 0s = $0
  assert c.estimate_cost(0.0) == 0.0
