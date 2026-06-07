"""Audio/video file metadata extraction.

Reads file headers (no full decode) to extract:
- format (mp4, mov, webm, mp3, wav, m4a)
- size in bytes
- estimated duration (when possible without ffmpeg)
- MIME type

For real duration, the system would shell out to ffprobe; we keep a
fallback for files where we can detect from headers alone.
"""
from __future__ import annotations
import os
import struct
import mimetypes

# Map of file extension to MIME and category.
KNOWN_FORMATS = {
    ".mp4":  {"mime": "video/mp4", "category": "video"},
    ".mov":  {"mime": "video/quicktime", "category": "video"},
    ".webm": {"mime": "video/webm", "category": "video"},
    ".mkv":  {"mime": "video/x-matroska", "category": "video"},
    ".avi":  {"mime": "video/x-msvideo", "category": "video"},
    ".mp3":  {"mime": "audio/mpeg", "category": "audio"},
    ".wav":  {"mime": "audio/wav", "category": "audio"},
    ".m4a":  {"mime": "audio/mp4", "category": "audio"},
    ".ogg":  {"mime": "audio/ogg", "category": "audio"},
    ".flac": {"mime": "audio/flac", "category": "audio"},
    ".opus": {"mime": "audio/opus", "category": "audio"},
    ".txt":  {"mime": "text/plain", "category": "text"},
    ".md":   {"mime": "text/markdown", "category": "text"},
}

# Soft size limits.
MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024   # 2 GB
MAX_AUDIO_BYTES = 500 * 1024 * 1024         # 500 MB
MAX_TEXT_BYTES = 5 * 1024 * 1024            # 5 MB


def file_extension(path: str) -> str:
    return os.path.splitext(path)[1].lower()


def detect_format(path_or_name: str) -> dict | None:
    """Return format info dict or None if unknown."""
    ext = file_extension(path_or_name)
    if ext in KNOWN_FORMATS:
        return {"extension": ext, **KNOWN_FORMATS[ext]}
    # Fallback to mimetypes
    m, _ = mimetypes.guess_type(path_or_name)
    if m:
        if m.startswith("video/"):
            return {"extension": ext, "mime": m, "category": "video"}
        if m.startswith("audio/"):
            return {"extension": ext, "mime": m, "category": "audio"}
    return None


def size_within_limits(size_bytes: int, category: str) -> bool:
    if category == "video":
        return size_bytes <= MAX_VIDEO_BYTES
    if category == "audio":
        return size_bytes <= MAX_AUDIO_BYTES
    if category == "text":
        return size_bytes <= MAX_TEXT_BYTES
    return False


def estimate_duration_sec(path: str, size_bytes: int) -> float | None:
    """Best-effort duration estimate from file headers.

    Returns None when no reliable estimate is possible.
    For production this would shell out to ffprobe.
    """
    try:
        ext = file_extension(path)
        # WAV: header at byte 0, then fmt chunk with sample rate etc.
        if ext == ".wav":
            return _wav_duration(path)
        # MP3: very rough estimate at 128 kbps
        if ext == ".mp3":
            return size_bytes / (128 * 1024 / 8)
        # M4A/MP4: not parsed here
        return None
    except Exception:
        return None


def _wav_duration(path: str) -> float | None:
    with open(path, "rb") as f:
        riff = f.read(12)
        if len(riff) < 12 or riff[:4] != b"RIFF" or riff[8:12] != b"WAVE":
            return None
        # Walk chunks to find "fmt " then "data"
        sample_rate = None
        bytes_per_sample = None
        data_size = None
        while True:
            hdr = f.read(8)
            if len(hdr) < 8:
                break
            ck_id, ck_size = struct.unpack("<4sI", hdr)
            if ck_id == b"fmt ":
                fmt = f.read(min(ck_size, 16))
                if len(fmt) >= 16:
                    channels, sr, _, _, _, bps = struct.unpack("<HHIIHH", fmt[:16])
                    sample_rate = sr
                    bytes_per_sample = bps // 8
            elif ck_id == b"data":
                data_size = ck_size
                break
            else:
                f.seek(ck_size + (ck_size & 1), 1)  # word-aligned
        if not sample_rate or not bytes_per_sample or data_size is None:
            return None
        return data_size / (sample_rate * bytes_per_sample)


def text_from_file(path: str, max_bytes: int = MAX_TEXT_BYTES) -> str:
    """Read a text file (txt/md/csv) for direct ingestion."""
    with open(path, "rb") as f:
        raw = f.read(max_bytes)
    for enc in ("utf-8", "utf-8-sig", "cp1251", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")
