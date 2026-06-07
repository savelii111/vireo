"""Vireo video editor.

Pipeline:
  transcribe (Whisper) -> pick moments (LLM) -> cut (FFmpeg)
  -> reframe (FFmpeg crop) -> subtitles (FFmpeg drawtext) -> export
"""

from .ffmpeg_utils import find_ffmpeg, find_ffprobe, run, FFmpegError, probe

__all__ = [
  "find_ffmpeg", "find_ffprobe", "run", "FFmpegError", "probe",
  "__version__",
]

__version__ = "0.1.0"
