"""File storage for Vireo video agent.

Handles uploaded videos and generated outputs. Provides:
  - upload_dir / output_dir as local filesystem paths
  - save_upload(upload_bytes, filename) -> file_path
  - get_output_path(job_id, ext) -> file_path
  - list_uploads() -> list of {name, size, path}
  - cleanup_old(max_age_hours) -> count of deleted files

All paths are in a configurable base_dir (default: ./vireo_media).
"""

from __future__ import annotations
import os
import re
import time
import hashlib
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO


@dataclass
class StoredFile:
  name: str
  size: int
  path: str
  created_at: float

  def to_dict(self) -> dict:
    # V-26 fix: don't leak absolute server path. Return name + size only.
    return {"name": self.name, "size": self.size}


# V-25 fix: sanitize filename — strip path separators, control chars, traversal
_FILENAME_SAFE = re.compile(r"[^A-Za-z0-9._-]+")


def _sanitize_filename(name: str, max_len: int = 80) -> str:
  """Make filename safe for use as a path component.

  Strips path separators, traversal sequences, control characters, and NUL
  bytes. Falls back to a uuid-based name if the result is empty.
  """
  if not name:
    return f"{uuid.uuid4().hex[:12]}.bin"
  # Take only the basename
  name = os.path.basename(name.replace("\\", "/"))
  # Replace any non-safe character with underscore
  name = _FILENAME_SAFE.sub("_", name).strip("._-")
  if not name:
    return f"{uuid.uuid4().hex[:12]}.bin"
  if len(name) > max_len:
    # Keep the extension if there is one
    stem, _, ext = name.rpartition(".")
    if ext and len(ext) < 10:
      name = stem[: max_len - len(ext) - 1] + "." + ext
    else:
      name = name[:max_len]
  return name


class FileStorage:
  """Local filesystem storage for uploads and outputs."""

  def __init__(self, base_dir: str = "./vireo_media"):
    self.base_dir = Path(base_dir).resolve()
    self.upload_dir = self.base_dir / "uploads"
    self.output_dir = self.base_dir / "outputs"
    self.upload_dir.mkdir(parents=True, exist_ok=True)
    self.output_dir.mkdir(parents=True, exist_ok=True)

  def _safe_join(self, parent: Path, child: str) -> Path:
    """V-22 fix: ensure joined path stays inside parent. Raises on escape."""
    safe_child = _sanitize_filename(child)
    dest = (parent / safe_child).resolve()
    # Defense in depth: ensure resolved path is still under parent
    parent_resolved = parent.resolve()
    try:
      dest.relative_to(parent_resolved)
    except ValueError:
      raise ValueError(f"path traversal blocked: {child!r}")
    return dest

  def save_upload(self, data: bytes, filename: str) -> str:
    """Save uploaded file with unique prefix. Returns the saved path."""
    ext = Path(filename).suffix or ".mp4"
    safe_name = f"{uuid.uuid4().hex[:12]}_{_sanitize_filename(filename)}"
    dest = self.upload_dir / safe_name
    # V-22 fix: verify path is still under upload_dir (sanitize may have edge cases)
    try:
      dest.resolve().relative_to(self.upload_dir.resolve())
    except ValueError:
      raise ValueError(f"path traversal blocked: {filename!r}")
    dest.write_bytes(data)
    return str(dest)

  def save_upload_stream(self, stream: BinaryIO, filename: str, chunk_size: int = 65536) -> str:
    """Save from a file-like stream (for large uploads)."""
    safe_name = f"{uuid.uuid4().hex[:12]}_{_sanitize_filename(filename)}"
    dest = self.upload_dir / safe_name
    try:
      dest.resolve().relative_to(self.upload_dir.resolve())
    except ValueError:
      raise ValueError(f"path traversal blocked: {filename!r}")
    with open(dest, "wb") as f:
      while True:
        chunk = stream.read(chunk_size)
        if not chunk:
          break
        f.write(chunk)
    return str(dest)

  def register_existing(self, src_path: str, filename: str) -> str:
    """Move an already-on-disk file into the upload dir under a unique name.

    Used by the TUS resumable upload endpoint: the file is already fully
    written to a partial location; we rename it into the canonical upload
    dir and return the new path.

    V-?? guard: src_path must be on the same filesystem and the destination
    name must pass our sanitize step.  A re-validated path check ensures
    no traversal even if src_path was tampered with mid-upload.
    """
    src = Path(src_path).resolve()
    # Refuse to operate on a path that's already in upload_dir (idempotency).
    dest_name = f"{uuid.uuid4().hex[:12]}_{_sanitize_filename(filename)}"
    dest = self.upload_dir / dest_name
    try:
      dest.resolve().relative_to(self.upload_dir.resolve())
    except ValueError:
      raise ValueError(f"path traversal blocked: {filename!r}")
    if not src.exists():
      raise FileNotFoundError(f"source not found: {src_path}")
    # Use os.replace for atomicity on the same filesystem.
    os.replace(src, dest)
    return str(dest)

  def get_output_path(self, job_id: str, platform: str = "youtube", ext: str = ".mp4") -> str:
    """Return a path for a pipeline output file."""
    # V-25 fix: sanitize job_id + platform for use in filename
    safe_job = _sanitize_filename(job_id)
    safe_platform = _sanitize_filename(platform)
    name = f"{safe_job}_{safe_platform}{ext if ext.startswith('.') else '.' + ext}"
    dest = self.output_dir / name
    return str(dest)

  def get_upload_path(self, filename: str) -> str:
    """Return full path for an uploaded file by name (validated)."""
    return str(self._safe_join(self.upload_dir, filename))

  def list_uploads(self, limit: int = 50) -> list[StoredFile]:
    """List uploaded files, newest first."""
    files = []
    # V-23 fix: tolerate transient I/O errors (concurrent add on Windows)
    try:
      entries = list(self.upload_dir.iterdir())
    except OSError:
      return []
    for f in entries:
      if not f.is_file():
        continue
      try:
        stat = f.stat()
      except OSError:
        continue
      files.append(StoredFile(
        name=f.name, size=stat.st_size,
        path=str(f), created_at=stat.st_ctime,
      ))
    files.sort(key=lambda x: -x.created_at)
    return files[:max(0, limit)]

  def list_outputs(self, limit: int = 50) -> list[StoredFile]:
    """List output files, newest first."""
    files = []
    try:
      entries = list(self.output_dir.iterdir())
    except OSError:
      return []
    for f in entries:
      if not f.is_file():
        continue
      try:
        stat = f.stat()
      except OSError:
        continue
      files.append(StoredFile(
        name=f.name, size=stat.st_size,
        path=str(f), created_at=stat.st_ctime,
      ))
    files.sort(key=lambda x: -x.created_at)
    return files[:max(0, limit)]

  def delete(self, path: str) -> bool:
    """Delete a file. Returns True if deleted."""
    p = Path(path)
    # V-22 fix: only allow deletion inside output_dir or upload_dir
    try:
      p_resolved = p.resolve()
      p_resolved.relative_to(self.output_dir.resolve())
    except ValueError:
      try:
        p_resolved = p.resolve()
        p_resolved.relative_to(self.upload_dir.resolve())
      except ValueError:
        return False
    if p.is_file():
      p.unlink()
      return True
    return False

  def cleanup_old(self, max_age_hours: float = 24.0) -> int:
    """Delete files older than max_age_hours. Returns count deleted."""
    cutoff = time.time() - (max_age_hours * 3600)
    count = 0
    for d in [self.upload_dir, self.output_dir]:
      try:
        entries = list(d.iterdir())
      except OSError:
        continue
      for f in entries:
        try:
          if f.is_file() and f.stat().st_mtime < cutoff:
            f.unlink()
            count += 1
        except OSError:
          continue
    return count
