"""Tests for chunked.py — long-form Whisper transcription."""

import json
import pytest
from unittest.mock import patch, MagicMock
from vireo_video.chunked import (
  extract_audio, split_audio, merge_transcripts, transcribe_long,
  needs_chunking, estimate_chunk_duration, ChunkInfo,
  WHISPER_MAX_BYTES, MAX_CHUNK_SECONDS, BYTES_PER_SECOND,
)
from vireo_video.transcriber import (
  WhisperClient, Transcript, Segment, Word, TranscriptionError,
)


# ---------- helpers ----------

def make_word(text, start, end, confidence=None):
  return Word(text=text, start=start, end=end, confidence=confidence)


def make_segment(sid, start, end, text, words=None):
  return Segment(
    id=sid, start=start, end=end, text=text,
    words=words or [make_word(text, start, end)],
  )


def make_transcript(text, segments, duration=10.0, language="en", model="whisper-1"):
  return Transcript(
    text=text, language=language, duration=duration,
    segments=segments, model=model, raw={},
  )


def make_raw_response(text="", segments=None, duration=10.0, language="en"):
  """Build a raw dict (as Whisper API would return)."""
  return {
    "task": "transcribe",
    "language": language,
    "duration": duration,
    "text": text,
    "segments": segments or [],
  }


def make_mock_client(raw_responses, *, api_key="sk-test"):
  """Build a WhisperClient that returns raw JSON responses in order."""
  call_idx = [0]

  def transport(method, url, *, files=None, data=None, headers=None):
    idx = call_idx[0]
    call_idx[0] += 1
    resp_data = raw_responses[min(idx, len(raw_responses) - 1)]

    class Resp:
      def __init__(self, d):
        self.status_code = 200
        self._d = d
      def json(self):
        return self._d
      @property
      def text(self):
        return json.dumps(self._d)

    if isinstance(resp_data, tuple):
      status, body = resp_data
      r = Resp(body)
      r.status_code = status
      return r
    return Resp(resp_data)

  return WhisperClient(api_key=api_key, transport=transport)


def make_ffmpeg_probe(duration_sec=60.0):
  """Return a mock probe function."""
  def mock_probe(path, **kwargs):
    return {"duration_sec": duration_sec, "width": 1920, "height": 1080}
  return mock_probe


def make_ffmpeg_run(success=True):
  """Return a mock run function."""
  def mock_run(args, check=True, timeout=None, **kwargs):
    proc = MagicMock()
    proc.returncode = 0 if success else 1
    proc.stdout = b""
    proc.stderr = b""
    return proc
  return mock_run


# ---------- extract_audio ----------

@patch("vireo_video.chunked.find_ffmpeg")
@patch("vireo_video.chunked.run")
def test_extract_audio_calls_ffmpeg(mock_run, mock_find_ffmpeg):
  mock_find_ffmpeg.returnvalue = "C:/ffmpeg/bin/ffmpeg.exe"
  mock_run.return_value = MagicMock(returncode=0, stdout=b"", stderr=b"")

  result = extract_audio("input.mp4", "output.wav", ffmpeg="C:/ffmpeg/bin/ffmpeg.exe")

  mock_run.assert_called_once()
  args = mock_run.call_args[0][0]
  assert "-vn" in args
  assert "-ar" in args
  assert "16000" in args
  assert "-ac" in args
  assert "1" in args
  assert "output.wav" == result


@patch("vireo_video.chunked.find_ffmpeg")
@patch("vireo_video.chunked.run")
def test_extract_audio_ffmpeg_error(mock_run, mock_find_ffmpeg):
  from vireo_video.ffmpeg_utils import FFmpegError
  mock_find_ffmpeg.returnvalue = "ffmpeg"
  mock_run.side_effect = FFmpegError("codec error", 1, "err")

  with pytest.raises(FFmpegError):
    extract_audio("bad.mp4", "out.wav")


# ---------- split_audio ----------

@patch("vireo_video.chunked.probe")
@patch("vireo_video.chunked.find_ffmpeg")
@patch("vireo_video.chunked.run")
def test_split_audio_creates_chunks(mock_run, mock_find, mock_probe):
  mock_probe.return_value = {"duration_sec": 300.0}
  mock_find.returnvalue = "ffmpeg"
  mock_run.return_value = MagicMock(returncode=0, stdout=b"", stderr=b"")

  chunks = split_audio("audio.wav", 120, ffmpeg="ffmpeg")

  assert len(chunks) == 3  # 300s / 120s = 2.5 → 3 chunks
  assert all(c.endswith(".wav") for c in chunks)
  assert mock_run.call_count == 3


@patch("vireo_video.chunked.probe")
@patch("vireo_video.chunked.find_ffmpeg")
@patch("vireo_video.chunked.run")
def test_split_audio_single_chunk(mock_run, mock_find, mock_probe):
  mock_probe.return_value = {"duration_sec": 60.0}
  mock_find.returnvalue = "ffmpeg"
  mock_run.return_value = MagicMock(returncode=0, stdout=b"", stderr=b"")

  chunks = split_audio("audio.wav", 120, ffmpeg="ffmpeg")

  assert len(chunks) == 1
  assert mock_run.call_count == 1


@patch("vireo_video.chunked.probe")
def test_split_audio_zero_duration(mock_probe):
  mock_probe.return_value = {"duration_sec": 0.0}

  from vireo_video.ffmpeg_utils import FFmpegError
  with pytest.raises(FFmpegError):
    split_audio("audio.wav", 120)


# ---------- merge_transcripts ----------

def test_merge_transcripts_single_chunk():
  t = make_transcript(
    "hello world",
    [make_segment(0, 0.0, 1.5, "hello world")],
    duration=1.5,
  )
  result = merge_transcripts([t], [0.0])
  assert result.text == "hello world"
  assert len(result.segments) == 1
  assert result.segments[0].start == 0.0
  assert result.segments[0].end == 1.5
  assert result.duration == 1.5


def test_merge_transcripts_two_chunks():
  t1 = make_transcript(
    "first part",
    [make_segment(0, 0.0, 2.0, "first part", [
      make_word("first", 0.0, 0.8),
      make_word("part", 0.9, 2.0),
    ])],
    duration=2.0,
  )
  t2 = make_transcript(
    "second part",
    [make_segment(0, 0.0, 3.0, "second part", [
      make_word("second", 0.0, 1.5),
      make_word("part", 1.6, 3.0),
    ])],
    duration=3.0,
  )
  result = merge_transcripts([t1, t2], [0.0, 2.0])

  assert result.text == "first part second part"
  assert len(result.segments) == 2
  # Chunk 2 timestamps shifted by 2.0s
  assert result.segments[1].start == 2.0
  assert result.segments[1].end == 5.0
  # Words in chunk 2 also shifted
  assert result.segments[1].words[0].start == 2.0
  assert result.segments[1].words[0].end == 3.5
  assert result.segments[1].words[1].start == 3.6
  assert result.segments[1].words[1].end == 5.0
  # Total duration
  assert result.duration == 5.0
  # Segment IDs renumbered
  assert result.segments[0].id == 0
  assert result.segments[1].id == 1


def test_merge_transcripts_three_chunks():
  t1 = make_transcript("a", [make_segment(0, 0, 1, "a")], duration=1.0)
  t2 = make_transcript("b", [make_segment(0, 0, 1, "b")], duration=1.0)
  t3 = make_transcript("c", [make_segment(0, 0, 1, "c")], duration=1.0)
  result = merge_transcripts([t1, t2, t3], [0.0, 1.0, 2.0])
  assert result.text == "a b c"
  assert len(result.segments) == 3
  assert result.segments[0].start == 0.0
  assert result.segments[1].start == 1.0
  assert result.segments[2].start == 2.0
  assert result.duration == 3.0


def test_merge_transcripts_empty():
  result = merge_transcripts([], [])
  assert result.text == ""
  assert result.segments == []
  assert result.duration == 0.0


def test_merge_transcripts_preserves_language():
  t1 = make_transcript("hola", [make_segment(0, 0, 1, "hola")], language="es")
  t2 = make_transcript("mundo", [make_segment(0, 0, 1, "mundo")], language="es")
  result = merge_transcripts([t1, t2], [0.0, 1.0])
  assert result.language == "es"


def test_merge_transcripts_preserves_model():
  t1 = make_transcript("x", [make_segment(0, 0, 1, "x")], model="whisper-large")
  result = merge_transcripts([t1], [0.0])
  assert result.model == "whisper-large"


def test_merge_transcripts_word_confidence():
  t1 = make_transcript(
    "hi",
    [make_segment(0, 0, 1, "hi", [
      make_word("hi", 0, 1, confidence=0.98),
    ])],
    duration=1.0,
  )
  result = merge_transcripts([t1], [0.0])
  assert result.segments[0].words[0].confidence == 0.98


# ---------- needs_chunking ----------

@patch("vireo_video.chunked.probe")
def test_needs_chunking_short_video(mock_probe):
  mock_probe.return_value = {"duration_sec": 300.0}  # 5 min
  assert needs_chunking("short.mp4") is False


@patch("vireo_video.chunked.probe")
def test_needs_chunking_long_video(mock_probe):
  # 2500s * 12000 B/s = 30MB > 25MB*0.85 = 21.2MB
  mock_probe.return_value = {"duration_sec": 2500.0}
  assert needs_chunking("long.mp4") is True


@patch("vireo_video.chunked.probe")
def test_needs_chunking边界值(mock_probe):
  # 2100s * 12000 = 25.2MB > 21.2MB threshold
  mock_probe.return_value = {"duration_sec": 2100.0}
  assert needs_chunking("edge.mp4") is True


@patch("vireo_video.chunked.probe")
def test_needs_chunking_probe_error(mock_probe):
  mock_probe.side_effect = Exception("probe failed")
  # Should return True (safe fallback)
  assert needs_chunking("bad.mp4") is True


# ---------- estimate_chunk_duration ----------

def test_estimate_chunk_duration():
  d = estimate_chunk_duration()
  assert d > 0
  assert d <= MAX_CHUNK_SECONDS


def test_estimate_chunk_duration_high_bitrate():
  d = estimate_chunk_duration(320_000)  # 320kbps
  assert d < estimate_chunk_duration(128_000)


# ---------- ChunkInfo ----------

def test_chunk_info():
  c = ChunkInfo(index=0, start_sec=0.0, end_sec=10.0, path="/tmp/chunk.wav")
  assert c.duration == 10.0


# ---------- transcribe_long (integration) ----------

@patch("vireo_video.chunked.extract_audio")
@patch("vireo_video.chunked.split_audio")
@patch("vireo_video.chunked.probe")
def test_transcribe_long_calls_all_steps(mock_probe, mock_split, mock_extract, tmp_path):
  # Create real temp files so WhisperClient.file check passes
  c0 = tmp_path / "chunk_0.wav"
  c1 = tmp_path / "chunk_1.wav"
  c0.write_bytes(b"RIFF" + b"\x00" * 100)
  c1.write_bytes(b"RIFF" + b"\x00" * 100)

  mock_probe.return_value = {"duration_sec": 300.0}
  mock_extract.return_value = str(tmp_path / "audio.wav")
  mock_split.return_value = [str(c0), str(c1)]

  responses = [
    make_raw_response("hello", [{"id": 0, "start": 0, "end": 1, "text": "hello", "words": [{"word": "hello", "start": 0, "end": 1}]}]),
    make_raw_response("world", [{"id": 0, "start": 0, "end": 1, "text": "world", "words": [{"word": "world", "start": 0, "end": 1}]}]),
  ]
  client = make_mock_client(responses)

  result = transcribe_long("input.mp4", client, chunk_seconds=150)

  mock_extract.assert_called_once()
  mock_split.assert_called_once()
  assert result.text == "hello world"
  assert len(result.segments) == 2
  assert result.segments[1].start == 150.0


@patch("vireo_video.chunked.extract_audio")
@patch("vireo_video.chunked.split_audio")
@patch("vireo_video.chunked.probe")
def test_transcribe_long_progress_callback(mock_probe, mock_split, mock_extract, tmp_path):
  for name in ["c0.wav", "c1.wav", "c2.wav"]:
    (tmp_path / name).write_bytes(b"RIFF" + b"\x00" * 100)

  mock_probe.return_value = {"duration_sec": 300.0}
  mock_extract.return_value = str(tmp_path / "audio.wav")
  mock_split.return_value = [
    str(tmp_path / "c0.wav"),
    str(tmp_path / "c1.wav"),
    str(tmp_path / "c2.wav"),
  ]

  responses = [
    make_raw_response("a", [{"id": 0, "start": 0, "end": 1, "text": "a", "words": [{"word": "a", "start": 0, "end": 1}]}]),
    make_raw_response("b", [{"id": 0, "start": 0, "end": 1, "text": "b", "words": [{"word": "b", "start": 0, "end": 1}]}]),
    make_raw_response("c", [{"id": 0, "start": 0, "end": 1, "text": "c", "words": [{"word": "c", "start": 0, "end": 1}]}]),
  ]
  client = make_mock_client(responses)

  progress_calls = []
  def on_progress(current, total):
    progress_calls.append((current, total))

  result = transcribe_long("input.mp4", client, chunk_seconds=100, on_progress=on_progress)

  assert progress_calls == [(1, 3), (2, 3), (3, 3)]


@patch("vireo_video.chunked.extract_audio")
@patch("vireo_video.chunked.split_audio")
@patch("vireo_video.chunked.probe")
def test_transcribe_long_language_passed(mock_probe, mock_split, mock_extract, tmp_path):
  (tmp_path / "c0.wav").write_bytes(b"RIFF" + b"\x00" * 100)

  mock_probe.return_value = {"duration_sec": 60.0}
  mock_extract.return_value = str(tmp_path / "audio.wav")
  mock_split.return_value = [str(tmp_path / "c0.wav")]

  captured = {}
  def mock_transport(method, url, *, files=None, data=None, headers=None):
    captured["data"] = data
    class Resp:
      status_code = 200
      def json(self):
        return make_raw_response("hallo", [], language="de")
      @property
      def text(self): return "{}"
    return Resp()

  client = WhisperClient(api_key="sk-test", transport=mock_transport)
  transcribe_long("input.mp4", client, language="de", chunk_seconds=60)

  assert captured["data"]["language"] == "de"
