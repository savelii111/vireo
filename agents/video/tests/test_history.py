"""Tests for vireo_video.history — edit version history / versioning.

Phase 5.6: every cut, reframe, zoom operation is recorded so the user can
revert. These tests cover the public surface of ``EditHistory`` and
``EditVersion``.
"""

import threading

import pytest

from vireo_video.history import (
  EditHistory,
  EditVersion,
  STATUS_APPLIED,
  STATUS_FAILED,
  STATUS_PENDING,
  STATUS_REVERTED,
  deserialize,
  make_version,
  serialize,
)


# ---------------------------------------------------------------- record/get


def test_record_and_get():
  history = EditHistory()
  v = make_version(
    file_id="file-1",
    operation="cut",
    params={"start": 1.0, "end": 5.0},
    job_id="job-1",
  )
  history.record(v)

  fetched = history.get(v.id)
  assert fetched is not None
  assert fetched.id == v.id
  assert fetched.file_id == "file-1"
  assert fetched.operation == "cut"
  assert fetched.params == {"start": 1.0, "end": 5.0}
  assert fetched.job_id == "job-1"
  assert fetched.status == STATUS_APPLIED
  assert fetched.created_at.endswith("Z")


def test_get_unknown_returns_none():
  history = EditHistory()
  assert history.get("nope") is None


# ----------------------------------------------------------------- list / fil


def test_list_filters_by_file():
  history = EditHistory()
  history.record(make_version(file_id="file-A", operation="cut", params={}))
  history.record(make_version(file_id="file-B", operation="cut", params={}))
  history.record(make_version(file_id="file-A", operation="zoom", params={}))
  history.record(make_version(file_id="file-B", operation="reframe", params={}))

  a = history.list("file-A")
  b = history.list("file-B")

  assert len(a) == 2
  assert len(b) == 2
  assert all(v.file_id == "file-A" for v in a)
  assert all(v.file_id == "file-B" for v in b)


def test_list_orders_newest_first():
  history = EditHistory()
  v1 = make_version(
    file_id="file-1", operation="cut",
    params={"i": 1}, created_at="2025-01-01T00:00:00Z",
  )
  v2 = make_version(
    file_id="file-1", operation="cut",
    params={"i": 2}, created_at="2025-01-02T00:00:00Z",
  )
  v3 = make_version(
    file_id="file-1", operation="cut",
    params={"i": 3}, created_at="2025-01-03T00:00:00Z",
  )
  for v in (v1, v2, v3):
    history.record(v)

  ordered = history.list("file-1")
  assert [v.params["i"] for v in ordered] == [3, 2, 1]


def test_list_respects_limit():
  history = EditHistory()
  for i in range(5):
    history.record(make_version(
      file_id="file-1", operation="cut",
      params={"i": i},
      created_at=f"2025-01-0{i + 1}T00:00:00Z",
    ))
  out = history.list("file-1", limit=2)
  assert len(out) == 2
  # Newest first
  assert out[0].params["i"] == 4
  assert out[1].params["i"] == 3


# ----------------------------------------------------------------- latest


def test_latest_returns_most_recent():
  history = EditHistory()
  history.record(make_version(
    file_id="file-1", operation="cut", params={"i": 1},
    created_at="2025-01-01T00:00:00Z",
  ))
  history.record(make_version(
    file_id="file-1", operation="cut", params={"i": 2},
    created_at="2025-01-02T00:00:00Z",
  ))
  v3 = make_version(
    file_id="file-1", operation="cut", params={"i": 3},
    created_at="2025-01-03T00:00:00Z",
  )
  history.record(v3)

  latest = history.latest("file-1")
  assert latest is not None
  assert latest.id == v3.id
  assert latest.params["i"] == 3


def test_latest_unknown_file_returns_none():
  history = EditHistory()
  assert history.latest("nope") is None


# ---------------------------------------------------------------- revert


def test_revert_creates_new_version():
  history = EditHistory()
  v1 = make_version(file_id="file-1", operation="cut", params={"start": 1.0})
  v2 = make_version(file_id="file-1", operation="zoom", params={"factor": 1.2})
  v3 = make_version(file_id="file-1", operation="reframe", params={"x": 0.1})
  for v in (v1, v2, v3):
    history.record(v)

  revert = history.revert("file-1", v1.id)

  # It must be a new version — not the same id as v1.
  assert revert.id != v1.id
  # Revert semantics: operation="revert", parent=target version.
  assert revert.operation == "revert"
  assert revert.parent_version_id == v1.id
  # Revert must mirror the target's params (deep-copied).
  assert revert.params == v1.params
  # Revert must be recorded in the history.
  stored = history.get(revert.id)
  assert stored is not None
  assert stored.id == revert.id
  # Revert must appear in the file's history (newest first).
  file_versions = history.list("file-1")
  assert file_versions[0].id == revert.id
  # Total recorded: 3 original + 1 revert = 4.
  assert len(history) == 4


def test_revert_unknown_version_raises():
  history = EditHistory()
  history.record(make_version(file_id="file-1", operation="cut", params={}))
  with pytest.raises(ValueError):
    history.revert("file-1", "does-not-exist")


# --------------------------------------------------------------- empty store


def test_empty_history():
  history = EditHistory()
  assert history.list("anything") == []
  assert history.latest("anything") is None
  assert history.get("anything") is None
  assert len(history) == 0


# ------------------------------------------------------------- thread safety


def test_thread_safety():
  """10 threads each recording 100 versions should yield 1000 records."""
  history = EditHistory()
  per_thread = 100
  thread_count = 10

  errors: list[BaseException] = []

  def worker(tid: int) -> None:
    try:
      for i in range(per_thread):
        v = make_version(
          file_id=f"file-{tid}",
          operation="cut",
          params={"tid": tid, "i": i},
        )
        history.record(v)
    except BaseException as e:  # noqa: BLE001
      errors.append(e)

  threads = [threading.Thread(target=worker, args=(t,)) for t in range(thread_count)]
  for t in threads:
    t.start()
  for t in threads:
    t.join()

  assert not errors, f"threads raised: {errors!r}"
  assert len(history) == thread_count * per_thread

  # Sanity: each thread's versions are queryable and disjoint.
  # ``list`` defaults to limit=50, so we explicitly pass a higher limit here.
  for tid in range(thread_count):
    versions = history.list(f"file-{tid}", limit=per_thread)
    assert len(versions) == per_thread
    seen_indices = {v.params["i"] for v in versions}
    assert seen_indices == set(range(per_thread))


# ----------------------------------------------------------------- serialize


def test_serialize_roundtrip():
  v = make_version(
    file_id="file-1",
    operation="cut",
    params={"start": 1.0, "end": 5.0, "labels": ["a", "b"]},
    job_id="job-1",
  )
  data = serialize(v)
  assert data["id"] == v.id
  assert data["operation"] == "cut"
  assert data["params"]["labels"] == ["a", "b"]

  v2 = deserialize(data)
  assert v2 == v
