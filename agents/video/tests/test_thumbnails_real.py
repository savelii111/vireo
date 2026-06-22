"""Day 23: real-decode smoke tests for vireo_video.thumbnails.

These tests run against the real ffmpeg binary and the real
`sample_10s.mp4` (and `moving_3s.mp4`) fixture. They prove that:

  * `extract_filmstrip` returns a real sprite PNG with the right
    dimensions (frame_w * count x frame_h), and the sprite has at
    least one pixel that distinguishes two adjacent frames when the
    source is non-static.

  * `extract_waveform` returns exactly `buckets` peaks, all in 0..1,
    with a non-zero max and a non-zero population standard deviation
    (real PCM, not a synthetic ramp).

  * A file with no audio track reports `has_audio: false` and an
    empty `peaks` array (no synthesized fallback).

Run with: pytest agents/video/tests/test_thumbnails_real.py -v
"""
from __future__ import annotations

import os
import struct
import sys
import zlib
import statistics
from pathlib import Path

import pytest

# Make `from vireo_video.thumbnails import ...` resolvable when this file
# is invoked from any working directory.
THIS_DIR = Path(__file__).resolve().parent
VIDEO_DIR = THIS_DIR.parent
REPO_ROOT = VIDEO_DIR.parent.parent
for p in (str(REPO_ROOT), str(VIDEO_DIR)):
    if p not in sys.path:
        sys.path.insert(0, p)

from vireo_video.thumbnails import (  # noqa: E402
    extract_filmstrip,
    extract_waveform,
    _png_dimensions,
    FILMSTRIP_DEFAULT_COUNT,
)


FIXTURE_STATIC = VIDEO_DIR / "tests" / "fixtures" / "sample_10s.mp4"
FIXTURE_MOVING = VIDEO_DIR / "tests" / "fixtures" / "moving_3s.mp4"


def _decode_png_rgb(path: str) -> tuple[int, int, list[bytes]]:
    """Tiny stdlib PNG decoder. Returns (w, h, rows-of-bytes)."""
    with open(path, "rb") as f:
        sig = f.read(8)
        assert sig == b"\x89PNG\r\n\x1a\n", f"not a PNG: {path}"
        chunks = []
        while True:
            ln_b = f.read(4)
            if not ln_b:
                break
            ln = struct.unpack(">I", ln_b)[0]
            t = f.read(4)
            body = f.read(ln)
            f.read(4)
            chunks.append((t, body))
            if t == b"IEND":
                break
    ihdr = next(b for t, b in chunks if t == b"IHDR")
    iw, ih, bd, ct = struct.unpack(">IIBB", ihdr[:10])
    assert bd == 8 and ct == 2, f"unsupported PNG bit_depth={bd} color_type={ct}"
    idat = b"".join(b for t, b in chunks if t == b"IDAT")
    raw = zlib.decompress(idat)
    bpp = 3
    row_bytes = 1 + iw * bpp
    assert len(raw) == row_bytes * ih, (
        f"raw size mismatch: {len(raw)} vs {row_bytes * ih}"
    )
    rows: list[bytes] = []
    prev = bytes(iw * bpp)
    for y in range(ih):
        fb = raw[y * row_bytes]
        line = bytearray(raw[y * row_bytes + 1 : y * row_bytes + row_bytes])
        if fb == 1:  # Sub
            for i in range(bpp, len(line)):
                line[i] = (line[i] + line[i - bpp]) & 0xFF
        elif fb == 2:  # Up
            for i in range(len(line)):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif fb == 3:  # Average
            for i in range(len(line)):
                a = line[i - bpp] if i >= bpp else 0
                line[i] = (line[i] + (a + prev[i]) // 2) & 0xFF
        elif fb == 4:  # Paeth
            for i in range(len(line)):
                a = line[i - bpp] if i >= bpp else 0
                b = prev[i]
                c = prev[i - bpp] if i >= bpp else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 0xFF
        rows.append(bytes(line))
        prev = bytes(line)
    return iw, ih, rows


def _frame_byte(rows: list[bytes], i: int, frame_w: int, ih: int) -> bytes:
    out = bytearray()
    for y in range(ih):
        out += rows[y][i * frame_w * 3 : (i + 1) * frame_w * 3]
    return bytes(out)


# ─────────────────────────────────────────────────────────────────────
# Filmstrip
# ─────────────────────────────────────────────────────────────────────

@pytest.mark.skipif(
    not FIXTURE_STATIC.exists(),
    reason="sample_10s.mp4 fixture missing",
)
def test_filmstrip_dimensions_static_fixture(tmp_path):
    """A static-source filmstrip must still have the correct sprite
    dimensions: count * frame_w wide, frame_h tall. The PNG is a
    valid real-decode sprite (we can read its IHDR and decode it)."""
    out = tmp_path / "sprite_static.png"
    m = extract_filmstrip(
        str(FIXTURE_STATIC),
        count=FILMSTRIP_DEFAULT_COUNT,
        out_path=str(out),
    )
    assert m["real_decode"] is True
    assert m["count"] == FILMSTRIP_DEFAULT_COUNT
    expected_w = m["frame_w"] * m["count"]
    assert m["sprite_w"] == expected_w
    assert m["sprite_h"] == m["frame_h"]
    assert os.path.getsize(out) > 0
    w, h = _png_dimensions(str(out))
    assert (w, h) == (expected_w, m["frame_h"]), "PNG IHDR must match manifest"
    assert len(m["timestamps"]) == m["count"]


@pytest.mark.skipif(
    not FIXTURE_MOVING.exists(),
    reason="moving_3s.mp4 fixture missing (run scripts/regen_moving_fixture.sh)",
)
def test_filmstrip_frames_distinct_for_moving_source(tmp_path):
    """When the source has actual frame-to-frame variation, the cells
    of the sprite must reflect that — at least one pair of adjacent
    cells must differ on at least one byte. This proves the sprite
    is not a placeholder gradient or a duplicated frame."""
    out = tmp_path / "sprite_moving.png"
    m = extract_filmstrip(
        str(FIXTURE_MOVING),
        count=3,
        out_path=str(out),
    )
    assert m["sprite_w"] == m["frame_w"] * 3
    iw, ih, rows = _decode_png_rgb(str(out))
    assert (iw, ih) == (m["sprite_w"], m["sprite_h"])
    fw = m["frame_w"]
    cell0 = _frame_byte(rows, 0, fw, ih)
    cell1 = _frame_byte(rows, 1, fw, ih)
    cell2 = _frame_byte(rows, 2, fw, ih)
    assert cell0 != cell1, "adjacent cells must differ for a moving source"
    assert cell1 != cell2, "adjacent cells must differ for a moving source"
    assert cell0 != cell2, "outer cells must differ for a moving source"


# ─────────────────────────────────────────────────────────────────────
# Waveform
# ─────────────────────────────────────────────────────────────────────

@pytest.mark.skipif(
    not FIXTURE_STATIC.exists(),
    reason="sample_10s.mp4 fixture missing",
)
def test_waveform_real_pcm_shape_and_range():
    w = extract_waveform(str(FIXTURE_STATIC), buckets=200)
    assert w["real_decode"] is True
    assert w["has_audio"] is True
    assert w["buckets"] == 200
    assert len(w["peaks"]) == 200
    assert max(w["peaks"]) > 0, "max peak must be > 0 (real audio)"
    assert min(w["peaks"]) >= 0.0
    assert max(w["peaks"]) <= 1.0, "peaks must be normalized to 0..1"
    # Stdev > 0 means the peaks are not a constant — proves we
    # actually sampled varying PCM amplitudes.
    assert statistics.stdev(w["peaks"]) > 0, "peaks must not be constant"
    assert all(isinstance(v, float) for v in w["peaks"])


def test_waveform_no_audio_returns_empty():
    """A file with no audio track must report has_audio: False and an
    empty peaks array. We synthesize a silent-mp4 fixture on the fly
    so the test does not depend on any external media file."""
    import subprocess
    import tempfile

    tmp = tempfile.mkdtemp()
    fixture = os.path.join(tmp, "no_audio.mp4")
    # 2-second video-only clip, no audio stream.
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", "color=c=black:s=160x90:d=2:r=10",
            "-c:v", "libx264", "-pix_fmt", "yuv420p",
            fixture,
        ],
        check=True,
        capture_output=True,
    )
    try:
        w = extract_waveform(fixture, buckets=64)
        assert w["has_audio"] is False
        assert w["peaks"] == []
        assert w["buckets"] == 64
    finally:
        os.unlink(fixture)
        os.rmdir(tmp)
