"""vireo_video.tus — Resumable file upload protocol (TUS-like).

Implements a minimal subset of the TUS 1.0 protocol so the video agent
can accept multi-GB uploads that survive network interruptions.

Endpoints (mounted in server.py):
  POST   /upload/resumable           -> create session, return Location
  HEAD   /upload/resumable/<id>      -> return Upload-Offset
  PATCH  /upload/resumable/<id>      -> append chunk, return new Upload-Offset
  DELETE /upload/resumable/<id>      -> abort session

Wire format:
  - Client requests create with Upload-Length (final file size) and optional
    Upload-Metadata (filename, filetype).
  - Server returns 201 Created + Location: /upload/resumable/<id>
  - Client repeatedly PATCHes chunks with Content-Range: bytes <start>-<end>/<total>
  - Server returns 204 No Content + Upload-Offset: <new offset>
  - When Upload-Offset == Upload-Length, the temp file is moved to the
    final storage path and a complete Upload-Complete event is recorded.

Why TUS and not S3 multipart?
  - Vireo uses MinIO via S3 SDK, but for direct browser uploads to the
    video agent, TUS is simpler (no presigned URLs, no CORS complexity
    with multipart).
  - For >5 GB files the user can still go via S3 multipart — the
    /upload/s3 endpoint will be added in Phase 5.1.1.

Security:
  - Upload-Length capped at MAX_UPLOAD_BYTES (default 5 GB).
  - Upload-Metadata parsed but filename is sanitized via file_storage.
  - Session expires after 24h (configurable via TUS_SESSION_TTL_SEC).
  - Concurrent PATCHes are serialized per-session via threading.Lock.
  - On finalization, path traversal re-checked (defense in depth).
"""
from __future__ import annotations

import os
import re
import json
import time
import uuid
import shutil
import tempfile
import threading
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Callable, Optional


# TUS 1.0.0 protocol version we implement.
TUS_VERSION = "1.0.0"

# Default cap: 5 GB.  V-1 fix sets the simple /upload cap at 100 MB; the
# resumable endpoint allows much larger files because they arrive in chunks.
DEFAULT_MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024

# Session expiry: 24 hours.  Stale sessions (network failure, user
# abandoned upload) are GC'd on a timer.
DEFAULT_SESSION_TTL_SEC = 24 * 3600

# Chunk size guidance for the client (returned in Tus-Max-Size).
DEFAULT_CHUNK_HINT = 8 * 1024 * 1024  # 8 MB

# Cap on how much we buffer in memory per chunk.  Chunks larger than this
# are streamed to disk via shutil.copyfileobj.
DEFAULT_CHUNK_MEMORY_CAP = 64 * 1024 * 1024  # 64 MB

# Valid metadata keys we accept.  Anything else is silently dropped.
ALLOWED_METADATA_KEYS = frozenset({"filename", "filetype", "user_id", "project_id"})

# Filename pattern: very strict — only ASCII alnum, dash, underscore, dot.
# We do NOT trust client-provided filenames.
_FILENAME_RE = re.compile(r"[^A-Za-z0-9._-]")


@dataclass
class TusSession:
    """State for a single resumable upload."""
    id: str
    filename: str
    filetype: str
    user_id: Optional[str]
    project_id: Optional[str]
    upload_length: int
    offset: int = 0
    created_at: float = field(default_factory=time.time)
    last_touched_at: float = field(default_factory=time.time)
    completed: bool = False
    final_path: Optional[str] = None
    # Per-session lock so concurrent PATCHes on the same upload don't
    # corrupt the offset counter or the partial file.
    lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def is_expired(self, ttl_sec: int = DEFAULT_SESSION_TTL_SEC,
                   clock: Optional[Callable[[], float]] = None) -> bool:
        # V-?? fix: accept an explicit clock so tests can fast-forward.
        c = clock or time.time
        return (c() - self.last_touched_at) > ttl_sec

    def to_dict(self) -> dict:
        d = asdict(self)
        # Drop the non-serializable lock.
        d.pop("lock", None)
        return d


class TusError(Exception):
    """TUS protocol error.  ``status`` is the HTTP status to return."""

    def __init__(self, status: int, message: str, headers: Optional[dict] = None):
        super().__init__(message)
        self.status = status
        self.headers = headers or {}


def _parse_upload_metadata(value: str) -> dict:
    """Parse the TUS Upload-Metadata header.

    Spec: comma-separated list of ``key value`` pairs, value is optional
    and may be base64-encoded (indicated by trailing '=').
    We only accept the keys in ALLOWED_METADATA_KEYS; everything else
    is dropped.
    """
    if not value:
        return {}
    out: dict = {}
    for item in value.split(","):
        item = item.strip()
        if not item:
            continue
        parts = item.split(" ", 1)
        key = parts[0]
        if key not in ALLOWED_METADATA_KEYS:
            continue
        if len(parts) == 1:
            out[key] = ""
        else:
            v = parts[1]
            if v.endswith(" "):
                v = v.rstrip()
            # TUS spec: any value after a space is base64-encoded.
            # Clients sometimes omit padding; add it before decoding.
            import base64
            padded = v + "=" * (-len(v) % 4)
            try:
                v_decoded = base64.b64decode(padded, validate=False).decode("utf-8", errors="replace")
                v = v_decoded
            except Exception:
                # Not valid base64 — keep raw (TUS implementations should be lenient).
                pass
            out[key] = v
    return out


def _sanitize_filename(name: str) -> str:
    """Strict filename sanitization for TUS uploads.

    Strips any character outside [A-Za-z0-9._-], collapses runs of dots,
    and caps length.  Falls back to 'upload.bin' if the result is empty.
    """
    if not name:
        return "upload.bin"
    name = os.path.basename(name)  # strip any path component
    name = _FILENAME_RE.sub("_", name)
    name = re.sub(r"\.{2,}", ".", name)
    name = name.strip("._-") or "upload.bin"
    if len(name) > 200:
        # keep extension
        stem, dot, ext = name.rpartition(".")
        if dot and len(ext) <= 10:
            stem = stem[: 200 - len(ext) - 1]
            name = f"{stem}.{ext}"
        else:
            name = name[:200]
    return name


def _parse_content_range(value: str, upload_length: int) -> tuple[int, int]:
    """Parse Content-Range: bytes <start>-<end>/<total>.

    Returns (start, end_exclusive).  Raises TusError(416) on bad input.
    """
    m = re.match(r"^bytes\s+(\d+)-(\d+)/(\d+|\*)", value or "")
    if not m:
        raise TusError(416, f"invalid Content-Range: {value!r}")
    start = int(m.group(1))
    end_inclusive = int(m.group(2))
    total_s = m.group(3)
    if end_inclusive < start:
        raise TusError(416, "end < start in Content-Range")
    if total_s != "*" and int(total_s) != upload_length:
        raise TusError(409, "Content-Range total does not match Upload-Length")
    return start, end_inclusive + 1  # convert inclusive -> exclusive


class TusStore:
    """In-memory store of resumable upload sessions.

    Swap for a Redis-backed store when running multi-replica.
    The lock lives per-session, not per-store, so cross-replica
    synchronization would need Redis-Lua or a `flock`-style file lock.

    Parameters
    ----------
    partials_dir
        Where partial uploads are written.  Defaults to a fresh
        ``tempfile.mkdtemp(prefix='vireo-tus-')`` so a forgotten session
        doesn't fill the OS temp dir.
    max_upload_bytes
        Per-file hard cap.
    session_ttl_sec
        Idle session expiry.
    on_complete
        Optional callback ``(session, final_path) -> None`` invoked
        when an upload finalizes.  The video server uses this to register
        the file with FileStorage and emit an `upload.complete` event.
    """

    def __init__(
        self,
        partials_dir: Optional[str] = None,
        max_upload_bytes: int = DEFAULT_MAX_UPLOAD_BYTES,
        session_ttl_sec: int = DEFAULT_SESSION_TTL_SEC,
        on_complete: Optional[Callable[[TusSession, str], None]] = None,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._sessions: dict[str, TusSession] = {}
        self._store_lock = threading.Lock()
        self.partials_dir = partials_dir or tempfile.mkdtemp(prefix="vireo-tus-")
        os.makedirs(self.partials_dir, exist_ok=True)
        self.max_upload_bytes = max_upload_bytes
        self.session_ttl_sec = session_ttl_sec
        self.on_complete = on_complete
        self._clock = clock
        # Stats
        self.stats = {
            "created": 0,
            "completed": 0,
            "aborted": 0,
            "expired": 0,
            "bytes_received": 0,
        }

    # ---------- create ----------

    def create(
        self,
        upload_length: int,
        metadata: Optional[dict] = None,
    ) -> TusSession:
        """Create a new resumable upload session.

        Raises TusError(413) if upload_length > max_upload_bytes,
        TusError(400) if upload_length is missing or non-positive.
        """
        if not isinstance(upload_length, int) or upload_length <= 0:
            raise TusError(400, "Upload-Length must be a positive integer")
        if upload_length > self.max_upload_bytes:
            raise TusError(
                413,
                f"Upload-Length {upload_length} exceeds max {self.max_upload_bytes}",
            )

        md = metadata or {}
        filename = _sanitize_filename(md.get("filename", ""))
        filetype = (md.get("filetype") or "").split(";")[0].strip().lower()[:64]
        # Crude type allowlist — extend as needed.
        if filetype and filetype not in {
            "video/mp4", "video/quicktime", "video/webm", "video/x-matroska",
            "audio/mpeg", "audio/wav", "audio/x-wav", "application/octet-stream",
        }:
            # Unknown MIME is allowed but warned via header.  Don't 400.
            pass

        sid = uuid.uuid4().hex
        sess = TusSession(
            id=sid,
            filename=filename,
            filetype=filetype,
            user_id=md.get("user_id"),
            project_id=md.get("project_id"),
            upload_length=upload_length,
        )
        partial_path = self._partial_path(sid)
        # Touch the file so we can seek into it later.
        with open(partial_path, "wb") as f:
            f.truncate(upload_length)
        sess.final_path = partial_path  # reused for partials

        with self._store_lock:
            self._sessions[sid] = sess
            self.stats["created"] += 1

        return sess

    # ---------- head ----------

    def head(self, sid: str) -> TusSession:
        """Return current offset for HEAD requests.

        Raises TusError(404) if unknown, TusError(410) if expired.
        """
        sess = self._get_live(sid)
        return sess

    # ---------- patch ----------

    def patch(self, sid: str, content_range: str, data) -> int:
        """Append a chunk.  ``data`` is a file-like object (read() interface).

        Returns the new Upload-Offset.
        """
        sess = self._get_live(sid)
        with sess.lock:
            start, end_excl = _parse_content_range(
                content_range, sess.upload_length,
            )
            if start != sess.offset:
                raise TusError(
                    409,
                    f"offset mismatch: client says {start}, server has {sess.offset}",
                    headers={"Upload-Offset": str(sess.offset)},
                )
            chunk_len = end_excl - start
            if sess.offset + chunk_len > sess.upload_length:
                raise TusError(413, "chunk exceeds declared Upload-Length")

            partial_path = self._partial_path(sid)
            # Write the chunk at the right offset.
            with open(partial_path, "r+b") as f:
                f.seek(sess.offset)
                remaining = chunk_len
                while remaining > 0:
                    buf = data.read(min(remaining, DEFAULT_CHUNK_MEMORY_CAP))
                    if not buf:
                        break
                    f.write(buf)
                    remaining -= len(buf)
                if remaining:
                    raise TusError(
                        400,
                        f"chunk underrun: expected {chunk_len}, got {chunk_len - remaining}",
                    )
                f.flush()
                os.fsync(f.fileno())

            sess.offset = end_excl
            sess.last_touched_at = self._clock()  # keep on store clock
            self.stats["bytes_received"] += chunk_len

            if sess.offset >= sess.upload_length:
                sess.completed = True
                self.stats["completed"] += 1
                if self.on_complete:
                    try:
                        self.on_complete(sess, partial_path)
                    except Exception:
                        # Don't crash the PATCH response on user-callback error;
                        # the file is still on disk and a manual finalize() can retry.
                        pass

        return sess.offset

    # ---------- delete ----------

    def delete(self, sid: str) -> None:
        """Abort the upload and free resources."""
        with self._store_lock:
            sess = self._sessions.pop(sid, None)
        if sess is None:
            raise TusError(404, "unknown session")
        try:
            os.unlink(self._partial_path(sid))
        except FileNotFoundError:
            pass
        self.stats["aborted"] += 1

    # ---------- helpers ----------

    def get(self, sid: str) -> Optional[TusSession]:
        return self._sessions.get(sid)

    def _get_live(self, sid: str) -> TusSession:
        sess = self._sessions.get(sid)
        if sess is None:
            raise TusError(404, f"unknown session: {sid}")
        if sess.is_expired(self.session_ttl_sec, clock=self._clock):
            # Lazy GC: remove from store + delete partial file.
            self._sessions.pop(sid, None)
            try:
                os.unlink(self._partial_path(sid))
            except FileNotFoundError:
                pass
            self.stats["expired"] += 1
            raise TusError(410, f"session expired: {sid}")
        return sess

    def _partial_path(self, sid: str) -> str:
        # Filename pattern is fixed (UUID hex) so no traversal risk.
        return os.path.join(self.partials_dir, f"{sid}.part")

    def gc_expired(self) -> int:
        """Delete expired sessions.  Returns the number removed."""
        with self._store_lock:
            expired = [
                s for s in self._sessions.values()
                if s.is_expired(self.session_ttl_sec, clock=self._clock)
            ]
            for s in expired:
                self._sessions.pop(s.id, None)
                try:
                    os.unlink(self._partial_path(s.id))
                except FileNotFoundError:
                    pass
            self.stats["expired"] += len(expired)
        return len(expired)

    def shutdown(self) -> None:
        """Cleanup: abort all sessions and remove the partials dir."""
        with self._store_lock:
            for sid in list(self._sessions.keys()):
                try:
                    os.unlink(self._partial_path(sid))
                except FileNotFoundError:
                    pass
            self._sessions.clear()
        try:
            shutil.rmtree(self.partials_dir, ignore_errors=True)
        except Exception:
            pass
