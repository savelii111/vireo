"""Tests for vireo_video.tus — TUS resumable upload protocol.

Covers the wire protocol semantics without spinning up an HTTP server.
Uses a tempdir-backed TusStore and file-like BytesIO objects.
"""
import io
import os
import time
import pytest
from vireo_video.tus import (
    TusStore, TusError, TusSession, TUS_VERSION,
    _parse_upload_metadata, _sanitize_filename, _parse_content_range,
)


@pytest.fixture
def tmp_store(tmp_path):
    store = TusStore(
        partials_dir=str(tmp_path / "tus"),
        max_upload_bytes=10 * 1024 * 1024,  # 10 MB cap for fast tests
        session_ttl_sec=60,
    )
    return store


# ---------- create ----------

def test_create_returns_session_id_and_offset_zero(tmp_store):
    sess = tmp_store.create(upload_length=1024, metadata={"filename": "clip.mp4"})
    assert isinstance(sess.id, str) and len(sess.id) == 32  # uuid4 hex
    assert sess.offset == 0
    assert sess.upload_length == 1024
    assert sess.filename == "clip.mp4"
    assert not sess.completed


def test_create_rejects_zero_length(tmp_store):
    with pytest.raises(TusError) as exc:
        tmp_store.create(upload_length=0)
    assert exc.value.status == 400


def test_create_rejects_oversize(tmp_store):
    with pytest.raises(TusError) as exc:
        tmp_store.create(upload_length=tmp_store.max_upload_bytes + 1)
    assert exc.value.status == 413


def test_create_sanitizes_filename(tmp_store):
    sess = tmp_store.create(
        upload_length=100,
        metadata={"filename": "../../etc/passwd"},
    )
    # Path components stripped, only basename kept.
    assert "/" not in sess.filename
    assert sess.filename == "passwd"


def test_create_sanitizes_dangerous_chars(tmp_store):
    sess = tmp_store.create(
        upload_length=100,
        metadata={"filename": " ../../weird<>name.mp4\r\n.txt "},
    )
    assert "/" not in sess.filename
    assert "\r" not in sess.filename
    assert "\n" not in sess.filename
    assert "<" not in sess.filename
    assert ">" not in sess.filename


def test_create_preallocates_partial_file(tmp_store, tmp_path):
    sess = tmp_store.create(upload_length=2048)
    partial = os.path.join(tmp_path / "tus", f"{sess.id}.part")
    assert os.path.getsize(partial) == 2048


# ---------- patch ----------

def test_patch_appends_and_advances_offset(tmp_store):
    sess = tmp_store.create(upload_length=10)
    new_offset = tmp_store.patch(
        sess.id, "bytes 0-3/10", io.BytesIO(b"abcd"),
    )
    assert new_offset == 4
    assert tmp_store.get(sess.id).offset == 4


def test_patch_multiple_chunks(tmp_store):
    sess = tmp_store.create(upload_length=10)
    tmp_store.patch(sess.id, "bytes 0-3/10", io.BytesIO(b"abcd"))
    tmp_store.patch(sess.id, "bytes 4-7/10", io.BytesIO(b"efgh"))
    new_offset = tmp_store.patch(sess.id, "bytes 8-9/10", io.BytesIO(b"ij"))
    assert new_offset == 10
    assert tmp_store.get(sess.id).completed is True
    # File contents should be the assembled chunks.
    with open(tmp_store._partial_path(sess.id), "rb") as f:
        assert f.read() == b"abcdefghij"


def test_patch_offset_mismatch_409(tmp_store):
    sess = tmp_store.create(upload_length=100)
    tmp_store.patch(sess.id, "bytes 0-9/100", io.BytesIO(b"0123456789"))
    with pytest.raises(TusError) as exc:
        # Try to write at offset 20 when server has 10.
        tmp_store.patch(sess.id, "bytes 20-29/100", io.BytesIO(b"X" * 10))
    assert exc.value.status == 409


def test_patch_exceeds_upload_length_413(tmp_store):
    sess = tmp_store.create(upload_length=10)
    with pytest.raises(TusError) as exc:
        tmp_store.patch(sess.id, "bytes 0-19/10", io.BytesIO(b"X" * 20))
    assert exc.value.status == 413


def test_patch_invalid_content_range_416(tmp_store):
    sess = tmp_store.create(upload_length=10)
    with pytest.raises(TusError) as exc:
        tmp_store.patch(sess.id, "garbage", io.BytesIO(b"x"))
    assert exc.value.status == 416


def test_patch_content_range_total_mismatch_409(tmp_store):
    sess = tmp_store.create(upload_length=10)
    with pytest.raises(TusError) as exc:
        tmp_store.patch(sess.id, "bytes 0-3/20", io.BytesIO(b"abcd"))
    assert exc.value.status == 409


# ---------- head / get / delete ----------

def test_head_returns_current_offset(tmp_store):
    sess = tmp_store.create(upload_length=100)
    tmp_store.patch(sess.id, "bytes 0-9/100", io.BytesIO(b"0123456789"))
    s = tmp_store.head(sess.id)
    assert s.offset == 10
    assert s.upload_length == 100


def test_head_unknown_404(tmp_store):
    with pytest.raises(TusError) as exc:
        tmp_store.head("nonexistent")
    assert exc.value.status == 404


def test_delete_aborts_and_frees(tmp_store, tmp_path):
    sess = tmp_store.create(upload_length=100)
    partial = tmp_store._partial_path(sess.id)
    assert os.path.exists(partial)
    tmp_store.delete(sess.id)
    assert not os.path.exists(partial)
    assert tmp_store.get(sess.id) is None


def test_delete_unknown_404(tmp_store):
    with pytest.raises(TusError):
        tmp_store.delete("nope")


# ---------- expiry ----------

def test_expired_session_raises_410(tmp_store):
    # Force expiry by faking the clock.
    base = time.time()
    tmp_store._clock = lambda: base
    sess = tmp_store.create(upload_length=100)
    # Advance virtual clock past TTL.
    tmp_store._clock = lambda: base + tmp_store.session_ttl_sec + 1
    with pytest.raises(TusError) as exc:
        tmp_store.head(sess.id)
    assert exc.value.status == 410


def test_gc_expired_removes_stale(tmp_store):
    base = time.time()
    tmp_store._clock = lambda: base
    a = tmp_store.create(upload_length=10)
    b = tmp_store.create(upload_length=20)
    tmp_store._clock = lambda: base + 999
    removed = tmp_store.gc_expired()
    assert removed == 2
    assert tmp_store.get(a.id) is None
    assert tmp_store.get(b.id) is None


# ---------- on_complete callback ----------

def test_on_complete_called_on_final_chunk(tmp_store):
    seen = []
    store2 = TusStore(
        partials_dir=tmp_store.partials_dir,
        max_upload_bytes=tmp_store.max_upload_bytes,
        on_complete=lambda s, p: seen.append((s.id, p)),
    )
    sess = store2.create(upload_length=5)
    store2.patch(sess.id, "bytes 0-4/5", io.BytesIO(b"hello"))
    assert len(seen) == 1
    assert seen[0][0] == sess.id


# ---------- metadata parsing ----------

def test_parse_upload_metadata_basic():
    md = _parse_upload_metadata("filename dGVzdC5tcDQ,filetype video/mp4")
    # filename was base64 ('test.mp4' -> 'dGVzdC5tcDQ')
    assert md.get("filename") == "test.mp4"
    assert md.get("filetype") == "video/mp4"


def test_parse_upload_metadata_drops_unknown_keys():
    md = _parse_upload_metadata("filename abc,secret value,filetype video/mp4")
    assert "secret" not in md
    assert "filename" in md


def test_parse_upload_metadata_empty():
    assert _parse_upload_metadata("") == {}


# ---------- filename sanitization ----------

def test_sanitize_filename_strips_paths():
    assert _sanitize_filename("../etc/passwd") == "passwd"


def test_sanitize_filename_keeps_dots_and_dashes():
    assert _sanitize_filename("my-clip.v2.mp4") == "my-clip.v2.mp4"


def test_sanitize_filename_collapses_dots():
    assert _sanitize_filename("a..b...c") == "a.b.c"


def test_sanitize_filename_empty_fallback():
    assert _sanitize_filename("") == "upload.bin"
    assert _sanitize_filename("..") == "upload.bin"


def test_sanitize_filename_caps_length():
    long = "a" * 300 + ".mp4"
    out = _sanitize_filename(long)
    assert len(out) <= 200
    assert out.endswith(".mp4")


# ---------- content range parsing ----------

def test_parse_content_range_basic():
    assert _parse_content_range("bytes 0-9/100", 100) == (0, 10)
    assert _parse_content_range("bytes 10-19/100", 100) == (10, 20)


def test_parse_content_range_star_total():
    # '*' is allowed for the total per TUS spec.
    assert _parse_content_range("bytes 0-9/*", 100) == (0, 10)


def test_parse_content_range_invalid():
    with pytest.raises(TusError):
        _parse_content_range("garbage", 100)
    with pytest.raises(TusError):
        _parse_content_range("bytes 10-5/100", 100)  # end < start


# ---------- stats ----------

def test_stats_track_lifecycle(tmp_store):
    a = tmp_store.create(upload_length=10)
    b = tmp_store.create(upload_length=20)
    assert tmp_store.stats["created"] == 2
    tmp_store.patch(a.id, "bytes 0-4/10", io.BytesIO(b"12345"))
    tmp_store.patch(a.id, "bytes 5-9/10", io.BytesIO(b"67890"))
    assert tmp_store.stats["completed"] == 1
    assert tmp_store.stats["bytes_received"] == 10
    tmp_store.delete(b.id)
    assert tmp_store.stats["aborted"] == 1
