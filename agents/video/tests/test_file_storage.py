"""Tests for file_storage.py — upload/output file management."""

import os
import time
import pytest
from vireo_video.file_storage import FileStorage, StoredFile


def test_save_upload(tmp_path):
  storage = FileStorage(str(tmp_path))
  data = b"fake video content"
  path = storage.save_upload(data, "test_video.mp4")
  assert os.path.isfile(path)
  assert os.path.getsize(path) == len(data)
  assert "test_video.mp4" in path


def test_save_upload_unique_names(tmp_path):
  storage = FileStorage(str(tmp_path))
  p1 = storage.save_upload(b"data1", "video.mp4")
  p2 = storage.save_upload(b"data2", "video.mp4")
  assert p1 != p2


def test_save_upload_stream(tmp_path):
  storage = FileStorage(str(tmp_path))
  import io
  stream = io.BytesIO(b"streamed content")
  path = storage.save_upload_stream(stream, "streamed.mp4")
  assert os.path.isfile(path)
  assert os.path.getsize(path) == 16


def test_get_output_path(tmp_path):
  storage = FileStorage(str(tmp_path))
  path = storage.get_output_path("job_123", "tiktok")
  assert "job_123_tiktok" in path
  assert path.endswith(".mp4")


def test_list_uploads(tmp_path):
  storage = FileStorage(str(tmp_path))
  storage.save_upload(b"a", "a.mp4")
  storage.save_upload(b"b", "b.mp4")
  files = storage.list_uploads()
  assert len(files) == 2
  assert all(isinstance(f, StoredFile) for f in files)


def test_list_outputs(tmp_path):
  storage = FileStorage(str(tmp_path))
  # Create output files manually
  out_dir = storage.output_dir
  (out_dir / "job1_youtube.mp4").write_bytes(b"video")
  (out_dir / "job2_tiktok.mp4").write_bytes(b"video2")
  files = storage.list_outputs()
  assert len(files) == 2


def test_delete(tmp_path):
  storage = FileStorage(str(tmp_path))
  path = storage.save_upload(b"data", "del.mp4")
  assert storage.delete(path) is True
  assert not os.path.isfile(path)


def test_delete_nonexistent(tmp_path):
  storage = FileStorage(str(tmp_path))
  assert storage.delete("/nonexistent/file.mp4") is False


def test_cleanup_old(tmp_path):
  storage = FileStorage(str(tmp_path))
  path = storage.save_upload(b"data", "old.mp4")
  # Make file appear old
  old_time = time.time() - 3600 * 25  # 25 hours ago
  os.utime(path, (old_time, old_time))
  count = storage.cleanup_old(max_age_hours=24)
  assert count == 1
  assert not os.path.isfile(path)


def test_stored_file_to_dict(tmp_path):
  f = StoredFile(name="test.mp4", size=1024, path="/tmp/test.mp4", created_at=123.0)
  d = f.to_dict()
  assert d["name"] == "test.mp4"
  assert d["size"] == 1024
  # V-26 fix: to_dict() does NOT leak absolute path (info disclosure)
  assert "path" not in d
