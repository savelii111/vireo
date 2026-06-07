"""FFmpeg / FFprobe utilities — locate binaries, run commands, parse metadata.

This module is intentionally minimal:
- find_ffmpeg(): locate the ffmpeg binary (PATH or explicit)
- find_ffprobe(): locate ffprobe
- run(): execute a command list, raise FFmpegError on failure, capture stderr
- probe(): get media info as a dict (codec, duration, width, height, fps, audio)
- escape_filter_path(): make a path safe for ffmpeg's filter_complex

Why no fluent-ffmpeg? We want zero non-stdlib deps and a single
predictable code path for tests.
"""

from __future__ import annotations
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any


class FFmpegError(RuntimeError):
    """Raised when ffmpeg/ffprobe returns non-zero or is missing."""
    def __init__(self, message: str, returncode: int = 1, stderr: str = ""):
        super().__init__(message)
        self.returncode = returncode
        self.stderr = stderr


def find_ffmpeg(explicit: str | None = None) -> str:
    """Locate ffmpeg. Explicit > env VIREO_FFMPEG > PATH."""
    if explicit:
        if not Path(explicit).exists():
            raise FFmpegError(f"ffmpeg not found at {explicit}", 0)
        return explicit
    env = os.environ.get("VIREO_FFMPEG")
    if env and Path(env).exists():
        return env
    found = shutil.which("ffmpeg")
    if found:
        return found
    raise FFmpegError("ffmpeg not found on PATH (set VIREO_FFMPEG or add to PATH)", 0)


def find_ffprobe(explicit: str | None = None) -> str:
    if explicit:
        if not Path(explicit).exists():
            raise FFmpegError(f"ffprobe not found at {explicit}", 0)
        return explicit
    env = os.environ.get("VIREO_FFPROBE")
    if env and Path(env).exists():
        return env
    found = shutil.which("ffprobe")
    if found:
        return found
    raise FFmpegError("ffprobe not found on PATH", 0)


def version(binary: str) -> str:
    """Return ffmpeg/ffprobe version string."""
    try:
        out = subprocess.run(
            [binary, "-version"],
            capture_output=True, text=True, check=True, timeout=10,
        )
        # First line is like: "ffmpeg version 8.1-full_build-www.gyan.dev ..."
        return out.stdout.splitlines()[0] if out.stdout else ""
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
        raise FFmpegError(f"failed to query {binary} version: {e}", getattr(e, "returncode", 1))


def run(
    args: list[str],
    *,
    ffmpeg: str | None = None,
    timeout: float | None = 600,
    input_data: bytes | None = None,
    check: bool = True,
) -> subprocess.CompletedProcess:
    """Run a command list. ffmpeg is the first arg if not provided.

    Raises FFmpegError on non-zero exit (when check=True).
    """
    if not args:
        raise FFmpegError("run() called with empty args", 0)
    # If the first arg isn't an absolute path, treat as ffmpeg by default
    bin_name = args[0]
    if bin_name in ("ffmpeg", "ffprobe") or "/" in bin_name or "\\" in bin_name:
        cmd = args
    else:
        binary = find_ffmpeg(ffmpeg) if bin_name == "ffmpeg" else find_ffprobe(ffmpeg)
        cmd = [binary, *args]

    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            input=input_data,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired as e:
        raise FFmpegError(f"timeout after {timeout}s running {cmd[0]}", 124, stderr=str(e))
    except FileNotFoundError as e:
        raise FFmpegError(f"binary not found: {cmd[0]}", 0, str(e))

    if check and proc.returncode != 0:
        stderr = proc.stderr.decode("utf-8", errors="replace") if isinstance(proc.stderr, bytes) else (proc.stderr or "")
        # Truncate stderr to avoid huge log lines
        snippet = stderr[-2000:] if len(stderr) > 2000 else stderr
        raise FFmpegError(
            f"{Path(cmd[0]).name} exited with code {proc.returncode}",
            proc.returncode,
            snippet,
        )
    return proc


def probe(path: str, *, ffprobe_bin: str | None = None) -> dict[str, Any]:
    """Return parsed ffprobe JSON for a media file.

    Schema is the default ffprobe -show_streams -show_format -of json output.
    Convenience fields: duration_sec, width, height, fps, has_audio, video_codec, audio_codec.
    """
    binary = find_ffprobe(ffprobe_bin)
    proc = run(
        [binary, "-v", "error", "-print_format", "json",
         "-show_format", "-show_streams", path],
        timeout=60,
    )
    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError as e:
        raise FFmpegError(f"ffprobe returned non-JSON: {e}", proc.returncode, proc.stderr or "")

    streams = data.get("streams", []) or []
    fmt = data.get("format", {}) or {}
    info: dict[str, Any] = {
        "format_name": fmt.get("format_name"),
        "duration_sec": float(fmt.get("duration", 0) or 0),
        "bit_rate": int(fmt.get("bit_rate", 0) or 0),
        "size_bytes": int(fmt.get("size", 0) or 0),
        "streams": streams,
    }
    v = next((s for s in streams if s.get("codec_type") == "video"), None)
    a = next((s for s in streams if s.get("codec_type") == "audio"), None)
    if v:
        info["width"] = int(v.get("width", 0) or 0)
        info["height"] = int(v.get("height", 0) or 0)
        info["video_codec"] = v.get("codec_name")
        # r_frame_rate is "num/den"
        rfr = v.get("r_frame_rate") or "0/1"
        try:
            num, den = rfr.split("/")
            fps = float(num) / float(den) if float(den) else 0.0
        except (ValueError, ZeroDivisionError):
            fps = 0.0
        info["fps"] = round(fps, 3)
        info["has_video"] = True
    else:
        info["has_video"] = False
    if a:
        info["has_audio"] = True
        info["audio_codec"] = a.get("codec_name")
        info["sample_rate"] = int(a.get("sample_rate", 0) or 0)
        info["channels"] = int(a.get("channels", 0) or 0)
    else:
        info["has_audio"] = False
    return info


def escape_filter_path(path: str) -> str:
  """Escape a path for use in an ffmpeg drawtext/movie/sendcmd filter.

  ffmpeg filters treat `:` as the option separator. On Windows the drive letter
  colon (e.g. `C:`) must be escaped so the filter parser does not split it.

  Escaping rules (ffmpeg libavfilter):
    - replace `\` with `/`
    - escape `:` as `\:`
    - escape `'` as `\'`
    - escape `\` that follow (in the actual escape sequence) by doubling

  For maximum compatibility we also wrap in single quotes — most filter
  parsers (drawtext, sendcmd) accept the quote form.
  """
  s = str(path)
  s = s.replace("\\", "/")
  s = s.replace(":", "\\:")
  s = s.replace("'", "\\'")
  # Wrap in single quotes for the most permissive parsers (drawtext, sendcmd)
  return f"'{s}'"


def escape_drawtext(text: str) -> str:
    """Escape a string for ffmpeg drawtext=text=... filter.

    ffmpeg drawtext requires:
    - backslashes escaped
    - colons escaped (option separator)
    - single quotes escaped
    - newlines as literal text (we use Text with spaces, line breaks via \\\\N)
    """
    out = text.replace("\\", "\\\\")
    out = out.replace(":", "\\:")
    out = out.replace("'", "\\'")
    out = out.replace("%", "%%")
    return out
