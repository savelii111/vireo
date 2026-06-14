"""Edit history / versioning for Vireo video agent.

Phase 5.6 of the long-form NL video editor. Every cut, reframe, zoom, and
other edit operation is recorded as an ``EditVersion`` so the user can
inspect, roll back, or audit the edit pipeline.

Public surface:
  - ``EditVersion``         — dataclass representing a single edit version
  - ``EditHistory``         — thread-safe, in-memory store of versions
  - ``make_version(...)``   — convenience factory that fills in id/timestamp
  - ``serialize(...)``      — dataclass -> dict helper (uses ``asdict``)
  - ``deserialize(...)``    — dict -> ``EditVersion`` helper

No external dependencies — pure stdlib (``dataclasses``, ``uuid``,
``threading``, ``copy``).
"""

from __future__ import annotations

import copy
import threading
import uuid
from dataclasses import asdict, dataclass, field, fields
from datetime import datetime, timezone
from typing import Any


# Status enum-like strings. Kept as plain strings for easy JSON round-trip.
STATUS_PENDING = "pending"
STATUS_APPLIED = "applied"
STATUS_FAILED = "failed"
STATUS_REVERTED = "reverted"


def _utc_now_iso() -> str:
  """Return current UTC time as an ISO 8601 string with 'Z' suffix."""
  return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


@dataclass
class EditVersion:
  """A single version of a file's edit state.

  Fields:
    id               — uuid4 hex string
    job_id           — id of the pipeline job that produced this version
    file_id          — id of the source/output file being edited
    operation        — e.g. "cut", "reframe", "zoom", "subtitle", "revert"
    params           — operation-specific parameter dict
    created_at       — ISO 8601 UTC timestamp ("...Z")
    parent_version_id — id of the version this one was derived from, or None
    status           — one of STATUS_* constants
  """
  id: str
  job_id: str
  file_id: str
  operation: str
  params: dict[str, Any]
  created_at: str
  parent_version_id: str | None
  status: str = STATUS_APPLIED

  def __post_init__(self) -> None:
    # Be lenient on params: callers may pass anything JSON-serializable.
    # Ensure it's a dict so asdict() round-trips cleanly.
    if self.params is None:
      self.params = {}
    if not isinstance(self.params, dict):
      # Wrap non-dict params in a single-key dict so the schema is preserved
      # and tests can still inspect them.
      self.params = {"value": self.params}


def make_version(
  *,
  file_id: str,
  operation: str,
  params: dict[str, Any] | None = None,
  job_id: str | None = None,
  parent_version_id: str | None = None,
  status: str = STATUS_APPLIED,
  version_id: str | None = None,
  created_at: str | None = None,
) -> EditVersion:
  """Construct an ``EditVersion`` with auto-filled id and timestamp.

  Useful for callers (HTTP handlers, pipeline code) that don't want to
  generate ids and timestamps themselves.
  """
  return EditVersion(
    id=version_id or uuid.uuid4().hex,
    job_id=job_id or "",
    file_id=file_id,
    operation=operation,
    params=dict(params) if params is not None else {},
    created_at=created_at or _utc_now_iso(),
    parent_version_id=parent_version_id,
    status=status,
  )


def serialize(version: EditVersion) -> dict[str, Any]:
  """Convert an ``EditVersion`` to a plain dict (uses ``asdict``)."""
  return asdict(version)


def deserialize(data: dict[str, Any]) -> EditVersion:
  """Build an ``EditVersion`` from a dict.

  Unknown fields are ignored; missing required fields raise ``TypeError``.
  """
  known = {f.name for f in fields(EditVersion)}
  filtered = {k: v for k, v in data.items() if k in known}
  return EditVersion(**filtered)


class EditHistory:
  """Thread-safe, in-memory store of ``EditVersion`` records.

  Storage layout:
    self.store : dict[str, EditVersion]   — keyed by ``version.id``

  Concurrency:
    All reads and writes go through ``self._lock`` (an ``RLock``). Reads
    return deep copies of the params dict so callers can't mutate stored
    state by holding on to a reference.

  The constructor accepts an optional ``store`` dict so tests can pre-seed
    history without having to record versions one by one.
  """

  def __init__(self, store: dict[str, EditVersion] | None = None) -> None:
    self.store: dict[str, EditVersion] = store if store is not None else {}
    self._order: dict[str, int] = {version_id: index for index, version_id in enumerate(self.store)}
    self._counter = len(self.store)
    self._lock = threading.RLock()

  # ------------------------------------------------------------------ record

  def record(self, version: EditVersion) -> None:
    """Append ``version`` to the history store.

    If ``version.id`` is empty, a uuid4 is generated. A second record with
    the same id overwrites the first (id collisions are vanishingly
    unlikely with uuid4, but the store is keyed by id).
    """
    with self._lock:
      if not version.id:
        version.id = uuid.uuid4().hex
      if not version.created_at:
        version.created_at = _utc_now_iso()
      # Copy the params dict so external mutations don't leak into storage.
      version.params = copy.deepcopy(version.params)
      self._counter += 1
      self._order[version.id] = self._counter
      self.store[version.id] = version

  # --------------------------------------------------------------------- get

  def get(self, version_id: str) -> EditVersion | None:
    """Return a copy of the version with the given id, or ``None``."""
    with self._lock:
      v = self.store.get(version_id)
      if v is None:
        return None
      return self._copy_version(v)

  # -------------------------------------------------------------------- list

  def list(self, file_id: str, limit: int = 50) -> list[EditVersion]:
    """Return versions for ``file_id``, newest first, capped at ``limit``.

    The returned list contains deep copies so callers can sort, filter, or
    mutate freely without affecting the store.
    """
    safe_limit = max(1, int(limit))
    with self._lock:
      # copy-on-read: snapshot the values list under the lock.
      matching = [v for v in self.store.values() if v.file_id == file_id]
    # Sort outside the lock; we already have a snapshot.
    matching.sort(key=lambda v: (v.created_at, self._order.get(v.id, 0)), reverse=True)
    return [self._copy_version(v) for v in matching[:safe_limit]]

  # ------------------------------------------------------------------ latest

  def latest(self, file_id: str) -> EditVersion | None:
    """Return the newest version for ``file_id``, or ``None``.

    Equivalent to ``self.list(file_id, limit=1)[0]`` but skips the list
    allocation for the common case.
    """
    with self._lock:
      best: EditVersion | None = None
      for v in self.store.values():
        if v.file_id != file_id:
          continue
        if best is None or (v.created_at, self._order.get(v.id, 0)) > (best.created_at, self._order.get(best.id, 0)):
          best = v
      if best is None:
        return None
      return self._copy_version(best)

  # ----------------------------------------------------------------- revert

  def revert(self, file_id: str, version_id: str) -> EditVersion:
    """Create a new version that mirrors the params of ``version_id``.

    The new version has:
      - a fresh uuid4 id
      - ``operation == "revert"``
      - ``parent_version_id == version_id``
      - the same params as the target version (deep-copied)
      - status ``STATUS_APPLIED`` (the revert is itself a new applied edit)

    Raises ``ValueError`` if ``version_id`` is unknown. The target version
    is not required to belong to ``file_id`` — callers can pass either.
    """
    with self._lock:
      target = self.store.get(version_id)
      if target is None:
        raise ValueError(f"unknown version_id: {version_id!r}")

      revert_version = EditVersion(
        id=uuid.uuid4().hex,
        job_id=target.job_id,
        file_id=file_id,
        operation="revert",
        params=copy.deepcopy(target.params),
        created_at=_utc_now_iso(),
        parent_version_id=version_id,
        status=STATUS_APPLIED,
      )
      self._counter += 1
      self._order[revert_version.id] = self._counter
      self.store[revert_version.id] = revert_version

    return self._copy_version(revert_version)

  # -------------------------------------------------------------- utilities

  def __len__(self) -> int:
    with self._lock:
      return len(self.store)

  def clear(self) -> None:
    """Drop all stored versions. Mostly useful in tests."""
    with self._lock:
      self.store.clear()
      self._order.clear()
      self._counter = 0

  # ----------------------------------------------------------- private bits

  @staticmethod
  def _copy_version(v: EditVersion) -> EditVersion:
    """Return a deep copy of ``v`` with params also deep-copied.

    The dataclass ``replace`` + ``deepcopy`` combo is the safest way to
    guarantee no shared mutable state between the store and the caller.
    """
    new_v = copy.deepcopy(v)
    new_v.params = copy.deepcopy(v.params)
    return new_v
