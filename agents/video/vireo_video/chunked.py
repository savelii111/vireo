"""Long-form transcription via chunked Whisper API calls.

Whisper API has a 25MB file size limit. For long videos (20+ min), we:
  1. Extract audio with ffmpeg (mono 16kHz WAV — optimal for Whisper, ~96kbps)
  2. Split into chunks that fit under 25MB
  3. Transcribe each chunk
  4. Merge transcripts with time offsets

Chunk duration estimate:
  96kbps mono 16kHz WAV → 12KB/s → 25MB ≈ 2083s (~35 min)
  We use 20-minute chunks (1200s) for safety margin.
"""

from __future__ import annotations
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from .ffmpeg_utils import find_ffmpeg, run, probe, FFmpegError
from .transcriber import (
  WhisperClient, Transcript, Segment, Word,
  parse_transcript_response, TranscriptionError,
)


# Whisper API file size limit (bytes)
WHISPER_MAX_BYTES = 25 * 1024 * 1024  # 25MB

# Audio params for extraction (mono 16kHz WAV — Whisper optimal)
AUDIO_BITRATE_BPS = 96_000  # 96kbps for 16kHz mono PCM
BYTES_PER_SECOND = AUDIO_BITRATE_BPS / 8  # 12000 B/s

# Safety margin: use 80% of theoretical max
CHUNK_SECONDS = int((WHISPER_MAX_BYTES * 0.8) / BYTES_PER_SECOND)  # ~1666s
# Cap at 20 minutes for practical reasons (memory, API timeout)
MAX_CHUNK_SECONDS = 1200  # 20 minutes


@dataclass
class ChunkInfo:
  """A single audio chunk to transcribe."""
  index: int
  start_sec: float
  end_sec: float
  path: str

  @property
  def duration(self) -> float:
    return self.end_sec - self.start_sec


def estimate_chunk_duration(bitrate_bps: int = AUDIO_BITRATE_BPS) -> int:
  """Estimate max chunk duration in seconds for a given bitrate."""
  bps = bitrate_bps / 8  # bytes per second
  max_sec = int((WHISPER_MAX_BYTES * 0.8) / bps)
  return min(max_sec, MAX_CHUNK_SECONDS)


def extract_audio(
  input_path: str,
  output_path: str,
  *,
  ffmpeg: str | None = None,
) -> str:
  """Extract mono 16kHz WAV audio from any media file."""
  binary = find_ffmpeg(ffmpeg)
  args = [
    binary, "-y", "-i", input_path,
    "-vn",  # no video
    "-acodec", "pcm_s16le",
    "-ar", "16000",
    "-ac", "1",
    output_path,
  ]
  run(args, timeout=600)
  return output_path


def split_audio(
  audio_path: str,
  chunk_seconds: int,
  *,
  ffmpeg: str | None = None,
) -> list[str]:
  """Split an audio file into chunks of `chunk_seconds` length.

  Returns list of chunk file paths (in a temp directory).
  Last chunk may be shorter.
  """
  info = probe(audio_path)
  total_duration = info["duration_sec"]
  if total_duration <= 0:
    raise FFmpegError(f"split_audio: zero duration for {audio_path}", 0, "")

  binary = find_ffmpeg(ffmpeg)
  tmpdir = Path(audio_path).parent / "_vireo_chunks"
  tmpdir.mkdir(exist_ok=True)

  chunks: list[str] = []
  offset = 0.0
  idx = 0
  while offset < total_duration:
    chunk_path = str(tmpdir / f"chunk_{idx:04d}.wav")
    duration = min(chunk_seconds, total_duration - offset)
    args = [
      binary, "-y",
      "-ss", f"{offset}",
      "-i", audio_path,
      "-t", f"{duration}",
      "-c", "copy",
      chunk_path,
    ]
    run(args, timeout=120)
    chunks.append(chunk_path)
    offset += duration
    idx += 1

  return chunks


def merge_transcripts(chunks: list[Transcript], offsets: list[float]) -> Transcript:
  """Merge multiple chunk transcripts into one, adjusting timestamps.

  chunks: list of Transcript objects from each chunk.
  offsets: list of time offsets (in seconds) for each chunk.

  Returns a single merged Transcript with renumbered segments and words.
  """
  all_segments: list[Segment] = []
  all_text_parts: list[str] = []
  seg_id = 0

  for chunk, offset in zip(chunks, offsets):
    for seg in chunk.segments:
      new_words = [
        Word(
          text=w.text,
          start=w.start + offset,
          end=w.end + offset,
          confidence=w.confidence,
        )
        for w in seg.words
      ]
      all_segments.append(Segment(
        id=seg_id,
        start=seg.start + offset,
        end=seg.end + offset,
        text=seg.text,
        words=new_words,
      ))
      all_text_parts.append(seg.text)
      seg_id += 1

  total_duration = 0.0
  if chunks:
    last_chunk = chunks[-1]
    last_offset = offsets[-1] if offsets else 0.0
    total_duration = last_offset + last_chunk.duration

  return Transcript(
    text=" ".join(all_text_parts).strip(),
    language=chunks[0].language if chunks else None,
    duration=total_duration,
    segments=all_segments,
    model=chunks[0].model if chunks else None,
    raw={"chunk_count": len(chunks)},
  )


def transcribe_long(
  input_path: str,
  client: WhisperClient,
  *,
  language: str | None = None,
  chunk_seconds: int = MAX_CHUNK_SECONDS,
  ffmpeg: str | None = None,
  on_progress: Callable[[int, int], None] | None = None,
) -> Transcript:
  """Transcribe a long audio/video file by chunking.

  1. Extract audio (mono 16kHz WAV)
  2. Split into chunks
  3. Transcribe each chunk via WhisperClient
  4. Merge with time offsets

  on_progress(current_chunk, total_chunks) is called after each chunk.
  """
  tmpdir = Path(tempfile.mkdtemp(prefix="vireo_chunked_"))
  try:
    # Step 1: extract audio
    audio_path = str(tmpdir / "audio.wav")
    extract_audio(input_path, audio_path, ffmpeg=ffmpeg)

    # Step 2: split into chunks
    chunk_paths = split_audio(audio_path, chunk_seconds, ffmpeg=ffmpeg)

    # Step 3: transcribe each chunk
    transcripts: list[Transcript] = []
    offsets: list[float] = []
    for i, cpath in enumerate(chunk_paths):
      t = client.transcribe_file(cpath, language=language)
      transcripts.append(t)
      offsets.append(i * chunk_seconds)
      if on_progress:
        on_progress(i + 1, len(chunk_paths))

    # Step 4: merge
    return merge_transcripts(transcripts, offsets)

  finally:
    # Cleanup temp directory
    import shutil
    try:
      shutil.rmtree(tmpdir, ignore_errors=True)
    except Exception:
      pass


def needs_chunking(file_path: str) -> bool:
  """Check if a file likely exceeds the Whisper 25MB limit.

  Estimates audio size from duration and typical bitrate.
  Returns True if estimated audio > 22MB (with margin).
  """
  try:
    info = probe(file_path)
    duration = info["duration_sec"]
    # Estimate: 96kbps mono WAV = 12KB/s
    estimated_bytes = duration * BYTES_PER_SECOND
    return estimated_bytes > (WHISPER_MAX_BYTES * 0.85)
  except Exception:
    # If we can't probe, assume it needs chunking (safe fallback)
    return True
