"""vireo_video.thumbnails — extract REAL clip previews and waveform data.

Day 23 (Filmstrip + Waveform) — these helpers talk to the real ffmpeg
binary. There are no placeholders, no synthetic sine waves, no gradient
stubs. Every peak in the returned JSON and every pixel in the returned
PNG comes from bytes the user actually uploaded.

Public surface:

  extract_filmstrip(source_path, *, count=10, frame_w=160, frame_h=90,
                    out_path=None) -> dict
    Build a sprite sheet + manifest of N real decoded frames uniformly
    sampled across the asset's duration. Single-pass ffmpeg invocation:
    fps=count/duration -> scale -> pad -> tile=countx1. The result PNG
    is validated to be exactly (frame_w*count) x frame_h pixels; if
    ffmpeg's rounding produced fewer frames we retry once with a tiny
    fps bump. If the retry also fails the function raises FFmpegError
    (never a gradient stub).

  extract_waveform(source_path, *, buckets=400) -> dict
    Decode the asset's audio track to mono s16le PCM at 8 kHz, fold it
    into `buckets` max-absolute-amplitude buckets, and normalize to 0..1.
    If there is no audio stream, returns `has_audio: False` and
    `peaks: []` — never a synthesized fallback.

Caching is the caller's responsibility (the HTTP server stores the
sprite PNG + a sibling `*.json` under VIREO_THUMB_CACHE_DIR, keyed by
asset_id + count / asset_id + buckets). The functions here are pure
I/O so they can be unit-tested deterministically.
"""

from __future__ import annotations

import json
import os
import re
import struct
import subprocess
import time
from pathlib import Path
from typing import Any, Optional

from .ffmpeg_utils import FFmpegError, find_ffmpeg, find_ffprobe, probe, run

# Hard caps so a malformed request can't lock the worker forever.
MAX_FILMSTRIP_COUNT = 64
MAX_WAVEFORM_BUCKETS = 4000
FILMSTRIP_DEFAULT_COUNT = 10
WAVEFORM_DEFAULT_BUCKETS = 400
FILMSTRIP_DEFAULT_W = 160
FILMSTRIP_DEFAULT_H = 90
WAVEFORM_SAMPLE_RATE = 8000  # Hz, mono
WAVEFORM_FFMPEG_TIMEOUT_SEC = 60
FILMSTRIP_FFMPEG_TIMEOUT_SEC = 60


def _safe_count(raw: Any, default: int, lo: int = 1, hi: int = MAX_FILMSTRIP_COUNT) -> int:
    try:
        n = int(raw) if raw is not None else default
    except (TypeError, ValueError):
        n = default
    if n < lo:
        return lo
    if n > hi:
        return hi
    return n


def _safe_buckets(raw: Any, default: int = WAVEFORM_DEFAULT_BUCKETS) -> int:
    return _safe_count(raw, default, lo=2, hi=MAX_WAVEFORM_BUCKETS)


def _ensure_parent(path: str | os.PathLike) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)


def _safe_filename_component(s: str) -> str:
    """Reduce an arbitrary string to a filesystem-safe token.

    We only allow ASCII alnum, dash, underscore, dot. Anything else is
    collapsed to '_'. This guards against path-traversal — callers that
    derive a cache key from a user-controlled `asset_id` MUST run it
    through here first.
    """
    if not s:
        return "unknown"
    return re.sub(r"[^A-Za-z0-9._-]", "_", str(s))[:96] or "unknown"


# ─────────────────────────────────────────────────────────────────────
# PNG header validation (Pillow-free, stdlib only)
# ─────────────────────────────────────────────────────────────────────

def _png_dimensions(path: str) -> tuple[int, int]:
    """Read width/height from PNG IHDR. Raises OSError on bad/short file."""
    with open(path, "rb") as f:
        sig = f.read(8)
        if sig != b"\x89PNG\r\n\x1a\n":
            raise ValueError(f"not a PNG: {path}")
        # IHDR length(4) + 'IHDR'(4) + width(4) + height(4)
        f.read(4)  # length
        tag = f.read(4)
        if tag != b"IHDR":
            raise ValueError(f"PNG missing IHDR: {path}")
        w, h = struct.unpack(">II", f.read(8))
    return int(w), int(h)


# ─────────────────────────────────────────────────────────────────────
# Filmstrip — single-pass ffmpeg with mandatory dimension validation
# ─────────────────────────────────────────────────────────────────────

def extract_filmstrip(
    source_path: str,
    *,
    count: int = FILMSTRIP_DEFAULT_COUNT,
    frame_w: int = FILMSTRIP_DEFAULT_W,
    frame_h: int = FILMSTRIP_DEFAULT_H,
    out_path: Optional[str] = None,
    ffmpeg_bin: Optional[str] = None,
) -> dict:
    """Extract `count` real frames uniformly from `source_path` and tile
    them into a single sprite PNG.

    Single ffmpeg pass:
        ffmpeg -y -i <src>
          -vf "fps={count/duration},scale={W}:{H}:force_original_aspect_ratio=decrease,
               pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=black,tile={count}x1"
          -frames:v 1 <sprite.png>

    Validates that the resulting PNG is exactly (frame_w*count) x frame_h.
    If ffmpeg's fps rounding produced fewer frames (and the result is
    too narrow), retries once with fps bumped by 5% to compensate. If
    the retry also fails, raises FFmpegError. We never return a
    placeholder sprite.

    Returns the JSON manifest (the caller persists it next to the PNG):
      {
        "real_decode": True,
        "asset_id": <str|None>,         # filled in by the caller
        "count": N,
        "frame_w": int,
        "frame_h": int,
        "sprite_w": int,                # = frame_w * count
        "sprite_h": int,                # = frame_h
        "duration_sec": float,
        "timestamps": [t0, t1, ...],    # seconds
        "sprite_path": <str|None>,      # absolute path on disk
        "fps": float,
        "ffmpeg": "<version first line>"
      }
    """
    if not source_path or not Path(source_path).is_file():
        raise FFmpegError(f"source file not found: {source_path!r}", 0)

    n = _safe_count(count, FILMSTRIP_DEFAULT_COUNT)

    # Duration must come from the real ffprobe. Zero/None => honest error.
    info = probe(source_path)
    duration = float(info.get("duration_sec") or 0.0)
    if duration <= 0:
        raise FFmpegError(
            f"cannot determine duration for {source_path!r} (got {duration!r})",
            0,
        )

    # timestamp_i = i * duration / n  for i in 0..n-1
    timestamps = [i * duration / n for i in range(n)]

    ffmpeg = find_ffmpeg(ffmpeg_bin)

    if out_path is None:
        out_path = str(
            Path(os.environ.get("VIREO_THUMB_TMP") or os.getcwd())
            / f".tmp_filmstrip_{os.getpid()}_{int(time.time() * 1000)}.png"
        )
    out_path = str(out_path)
    _ensure_parent(out_path)

    expected_w = int(frame_w) * int(n)
    expected_h = int(frame_h)

    def _run(fps_value: float) -> subprocess.CompletedProcess:
        # tile=AxB requires all input frames be the same size. The
        # scale+pad filter chain ensures every frame is exactly
        # frame_w x frame_h, then tile lays them out as a single row.
        vf = (
            f"fps={fps_value:.6f},"
            f"scale={frame_w}:{frame_h}:force_original_aspect_ratio=decrease,"
            f"pad={frame_w}:{frame_h}:(ow-iw)/2:(oh-ih)/2:color=black,"
            f"tile={n}x1"
        )
        cmd = [
            ffmpeg, "-hide_banner", "-loglevel", "error",
            "-i", source_path,
            "-vf", vf,
            "-frames:v", "1",
            "-y", out_path,
        ]
        return subprocess.run(
            cmd,
            capture_output=True,
            timeout=FILMSTRIP_FFMPEG_TIMEOUT_SEC,
        )

    last_err = ""
    for attempt, fps_value in enumerate((n / duration, n / duration * 1.05)):
        # Clean any prior output so a stale sprite doesn't trick us
        # into accepting the wrong size.
        try:
            Path(out_path).unlink(missing_ok=True)
        except OSError:
            pass
        proc = _run(fps_value)
        if proc.returncode != 0:
            last_err = (proc.stderr or b"").decode("utf-8", errors="replace")[-1000:]
            continue
        # Validate the output dimensions. This is the contract: a
        # filmstrip with the wrong number of frames is silently broken
        # downstream (the timeline would render duplicated/skipped
        # cells), so we refuse to return it.
        try:
            got_w, got_h = _png_dimensions(out_path)
        except (OSError, ValueError) as e:
            last_err = f"png_read_failed: {e}"
            continue
        if got_w != expected_w or got_h != expected_h:
            last_err = (
                f"filmstrip dimensions mismatch: got {got_w}x{got_h}, "
                f"expected {expected_w}x{expected_h} (attempt {attempt})"
            )
            continue
        manifest = {
            "real_decode": True,
            "asset_id": None,
            "count": int(n),
            "frame_w": int(frame_w),
            "frame_h": int(frame_h),
            "sprite_w": int(got_w),
            "sprite_h": int(got_h),
            "duration_sec": float(duration),
            "timestamps": [float(t) for t in timestamps],
            "sprite_path": str(Path(out_path).resolve()),
            "fps": float(fps_value),
            "ffmpeg": "",
        }
        try:
            from .ffmpeg_utils import version as ffmpeg_version
            manifest["ffmpeg"] = ffmpeg_version(ffmpeg)[:80]
        except Exception:
            pass
        return manifest

    # Both attempts failed — refuse to return a placeholder.
    raise FFmpegError(
        f"filmstrip decode failed for {source_path!r}: {last_err or 'unknown'}",
        0,
        last_err,
    )


# ─────────────────────────────────────────────────────────────────────
# Waveform — real mono PCM, max-amplitude buckets, normalized 0..1
# ─────────────────────────────────────────────────────────────────────

def extract_waveform(
    source_path: str,
    *,
    buckets: int = WAVEFORM_DEFAULT_BUCKETS,
    ffmpeg_bin: Optional[str] = None,
) -> dict:
    """Decode the asset's audio to mono s16le PCM and fold it into N
    peak-amplitude buckets.

    Returns:

      {
        "real_decode": True,
        "asset_id": <str|None>,
        "buckets": N,
        "sample_rate": 8000,
        "has_audio": True|False,
        "peaks": [0.0..1.0, ...],   # length == buckets when has_audio
        "duration_sec": float,
        "pcm_bytes": int
      }

    If the asset has no audio stream, returns `has_audio: False` and
    an empty `peaks` list. We do NOT synthesize a waveform — the timeline
    UI is supposed to handle the `has_audio: False` state with a neutral
    placeholder.
    """
    if not source_path or not Path(source_path).is_file():
        raise FFmpegError(f"source file not found: {source_path!r}", 0)

    n = _safe_buckets(buckets)
    info = probe(source_path)
    duration = float(info.get("duration_sec") or 0.0)
    has_audio = bool(info.get("has_audio"))

    if not has_audio:
        return {
            "real_decode": True,
            "asset_id": None,
            "buckets": int(n),
            "sample_rate": WAVEFORM_SAMPLE_RATE,
            "has_audio": False,
            "peaks": [],
            "duration_sec": float(duration),
            "pcm_bytes": 0,
        }

    ffmpeg = find_ffmpeg(ffmpeg_bin)
    cmd = [
        ffmpeg, "-hide_banner", "-loglevel", "error",
        "-i", source_path,
        "-ac", "1",
        "-ar", str(WAVEFORM_SAMPLE_RATE),
        "-f", "s16le",
        "-acodec", "pcm_s16le",
        "-",
    ]
    proc = subprocess.run(cmd, capture_output=True, timeout=WAVEFORM_FFMPEG_TIMEOUT_SEC)
    if proc.returncode != 0:
        raise FFmpegError(
            f"ffmpeg failed to decode audio (returncode={proc.returncode})",
            proc.returncode,
            (proc.stderr or b"").decode("utf-8", errors="replace")[-1000:],
        )
    pcm = proc.stdout or b""
    if len(pcm) < 2:
        return {
            "real_decode": True,
            "asset_id": None,
            "buckets": int(n),
            "sample_rate": WAVEFORM_SAMPLE_RATE,
            "has_audio": False,
            "peaks": [],
            "duration_sec": float(duration),
            "pcm_bytes": 0,
        }

    total_samples = len(pcm) // 2
    samples = struct.unpack(f"<{total_samples}h", pcm[: total_samples * 2])
    peaks: list[float] = [0.0] * n
    if total_samples > 0:
        samples_per_bucket = max(1, total_samples // n)
        for b in range(n):
            start = b * samples_per_bucket
            end = total_samples if b == n - 1 else min((b + 1) * samples_per_bucket, total_samples)
            if start >= end:
                continue
            chunk = samples[start:end]
            peak = max(chunk, key=lambda s: s if s >= 0 else -s)
            peaks[b] = abs(int(peak)) / 32768.0

    return {
        "real_decode": True,
        "asset_id": None,
        "buckets": int(n),
        "sample_rate": WAVEFORM_SAMPLE_RATE,
        "has_audio": True,
        "peaks": [float(min(1.0, max(0.0, v))) for v in peaks],
        "duration_sec": float(duration),
        "pcm_bytes": int(len(pcm)),
    }


# ─────────────────────────────────────────────────────────────────────
# Cache helpers (used by the HTTP server)
# ─────────────────────────────────────────────────────────────────────

def default_cache_dir() -> str:
    override = os.environ.get("VIREO_THUMB_CACHE_DIR")
    if override:
        return override
    root = os.environ.get("VIREO_MEDIA_ROOT") or os.path.join(
        os.getcwd(), "vireo_media", "thumbs"
    )
    Path(root).mkdir(parents=True, exist_ok=True)
    return root


def filmstrip_cache_paths(asset_id: str, count: int) -> tuple[str, str]:
    safe = _safe_filename_component(asset_id)
    base = Path(default_cache_dir()) / f"filmstrip_{safe}_{int(count)}"
    return str(base.with_suffix(".png")), str(base.with_suffix(".json"))


def waveform_cache_path(asset_id: str, buckets: int) -> str:
    safe = _safe_filename_component(asset_id)
    return str(Path(default_cache_dir()) / f"waveform_{safe}_{int(buckets)}.json")


def write_json(path: str, data: dict) -> None:
    _ensure_parent(path)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"))


def read_json(path: str) -> Optional[dict]:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None
