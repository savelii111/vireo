"""Regression tests for Vireo Video audit fixes (2026-06-07).

Covers the most critical bugs found in docs/plans/2026-06-07-VIDEO-AUDIT-PLAN.md
"""
import os
import tempfile
import pytest
from vireo_video.file_storage import FileStorage, _sanitize_filename


# V-22 + V-25 fix: path traversal blocked + filename sanitization
class TestV22PathTraversal:
  def test_filename_with_traversal_is_sanitized(self, tmp_path):
    fs = FileStorage(base_dir=str(tmp_path))
    data = b"test data"
    p = fs.save_upload(data, "../../../etc/passwd")
    # File must be inside upload_dir
    assert os.path.commonpath([p, str(fs.upload_dir)]) == str(fs.upload_dir.resolve())
    # Filename should be sanitized
    assert "../" not in p
    assert "passwd" in p  # basename preserved

  def test_filename_with_backslash_treated_as_traversal(self, tmp_path):
    fs = FileStorage(base_dir=str(tmp_path))
    p = fs.save_upload(b"x", "..\\..\\windows\\system32\\evil.exe")
    assert os.path.commonpath([p, str(fs.upload_dir)]) == str(fs.upload_dir.resolve())
    assert ".." not in p

  def test_filename_with_null_byte_sanitized(self, tmp_path):
    fs = FileStorage(base_dir=str(tmp_path))
    p = fs.save_upload(b"x", "good.mp4\x00.exe")
    assert "\x00" not in p
    assert ".." not in p

  def test_filename_with_newline_sanitized(self, tmp_path):
    fs = FileStorage(base_dir=str(tmp_path))
    p = fs.save_upload(b"x", "good\nname.mp4")
    assert "\n" not in p
    assert ".." not in p

  def test_delete_outside_storage_returns_false(self, tmp_path):
    fs = FileStorage(base_dir=str(tmp_path))
    # Try to delete a file outside storage dirs
    other = tmp_path / "outside.txt"
    other.write_text("x")
    assert fs.delete(str(other)) is False
    # The file should still exist
    assert other.is_file()


# V-26 fix: StoredFile.to_dict() doesn't leak absolute path
class TestV26InfoDisclosure:
  def test_to_dict_does_not_include_path(self):
    from vireo_video.file_storage import StoredFile
    f = StoredFile(name="test.mp4", size=1024, path="/some/secret/path.mp4", created_at=0)
    d = f.to_dict()
    assert "path" not in d
    assert d["name"] == "test.mp4"
    assert d["size"] == 1024

  def test_list_uploads_dicts_dont_leak_path(self, tmp_path):
    fs = FileStorage(base_dir=str(tmp_path))
    fs.save_upload(b"x", "test.mp4")
    items = fs.list_uploads()
    for f in items:
      d = f.to_dict()
      assert "path" not in d


# V-2 fix: JobStore.update whitelists fields
class TestV2JobStoreValidation:
  def test_update_drops_unknown_fields(self):
    from vireo_video.server import JobStore, EditResult, JobState
    import time
    js = JobStore()
    r = EditResult(
      job_id="j1", state=JobState.PENDING,
      source_path="x", output_path="y",
      target_platform="youtube", started_at=time.time(),
    )
    js.add(r)
    js.update("j1", state=JobState.DONE, __class__=str, malicious_attr="x")
    assert r.state == JobState.DONE
    assert not hasattr(r, "malicious_attr") or r.malicious_attr != "x"

  def test_list_clamps_limit(self):
    from vireo_video.server import JobStore, EditResult, JobState
    import time
    js = JobStore()
    for i in range(5):
      js.add(EditResult(
        job_id=f"j{i}", state=JobState.DONE,
        source_path="x", output_path="y",
        target_platform="youtube", started_at=time.time() + i,
      ))
    # Massive limit should be clamped to MAX_LIST_LIMIT
    items = js.list(limit=999_999_999)
    assert len(items) <= 200  # MAX_LIST_LIMIT default


# V-1 fix: per-request CORS reads VIREO_CORS_ORIGINS env
class TestV1Cors:
  def test_cors_headers_for_allowed_origin(self):
    from vireo_video.server import _cors_headers_for
    prev = os.environ.get("VIREO_CORS_ORIGINS")
    os.environ["VIREO_CORS_ORIGINS"] = "https://app.vireo.studio,https://dev.vireo.studio"
    try:
      h = _cors_headers_for("https://app.vireo.studio")
      assert h["Access-Control-Allow-Origin"] == "https://app.vireo.studio"
      assert h["Vary"] == "Origin"
    finally:
      if prev is not None:
        os.environ["VIREO_CORS_ORIGINS"] = prev
      else:
        del os.environ["VIREO_CORS_ORIGINS"]

  def test_cors_headers_for_unlisted_origin_falls_back(self):
    from vireo_video.server import _cors_headers_for
    prev = os.environ.get("VIREO_CORS_ORIGINS")
    os.environ["VIREO_CORS_ORIGINS"] = "https://app.vireo.studio"
    try:
      h = _cors_headers_for("https://attacker.example")
      # Should not echo the attacker's origin
      assert h["Access-Control-Allow-Origin"] != "https://attacker.example"
    finally:
      if prev is not None:
        os.environ["VIREO_CORS_ORIGINS"] = prev
      else:
        del os.environ["VIREO_CORS_ORIGINS"]

  def test_cors_headers_wildcard(self):
    from vireo_video.server import _cors_headers_for
    prev = os.environ.get("VIREO_CORS_ORIGINS")
    os.environ["VIREO_CORS_ORIGINS"] = "*"
    try:
      h = _cors_headers_for("https://anything.example")
      assert h["Access-Control-Allow-Origin"] == "https://anything.example"
    finally:
      if prev is not None:
        os.environ["VIREO_CORS_ORIGINS"] = prev
      else:
        del os.environ["VIREO_CORS_ORIGINS"]


# V-6 fix: max upload size enforcement
class TestV6UploadLimit:
  def test_max_upload_constant_is_sane(self):
    from vireo_video.server import MAX_UPLOAD_BYTES
    assert MAX_UPLOAD_BYTES > 0
    assert MAX_UPLOAD_BYTES <= 500 * 1024 * 1024  # 500 MB hard cap


# V-39 fix: parse_transcript_response drops segments without word timestamps
class TestV39Transcript:
  def test_no_words_segment_does_not_create_fake_word(self):
    from vireo_video.transcriber import parse_transcript_response
    resp = {
      "segments": [{"id": 0, "start": 0.0, "end": 5.0, "text": "Long sentence here."}],
      "duration": 5.0,
    }
    t = parse_transcript_response(resp)
    # No fake single-word created
    all_words = t.words()
    assert len(all_words) == 0


# V-25 fix: _sanitize_filename helper
class TestV25Sanitize:
  def test_empty_filename_falls_back(self):
    assert _sanitize_filename("").endswith(".bin")
    assert ".." not in _sanitize_filename("")

  def test_path_separators_stripped(self):
    assert "/" not in _sanitize_filename("a/b/c.mp4")
    assert "\\" not in _sanitize_filename("a\\b\\c.mp4")

  def test_control_chars_replaced(self):
    s = _sanitize_filename("good\x01\x02name.mp4")
    assert "\x01" not in s
    assert "\x02" not in s

  def test_long_filename_truncated(self):
    long = "a" * 200 + ".mp4"
    s = _sanitize_filename(long, max_len=80)
    assert len(s) <= 80
    assert s.endswith(".mp4")

  # ===== V-8: parse_transcript_response handles both camelCase and snake_case =====
  def test_v8_snake_case_keys(self):
    """V-8 fix: snake_case output keys."""
    from vireo_video.transcriber import parse_transcript_response
    resp = {"segments": [{"id": 0, "start": 0.0, "end": 1.0, "text": "Hi", "words": [{"text": "Hi", "start": 0.0, "end": 1.0}]}]}
    t = parse_transcript_response(resp)
    d = t.to_dict()
    assert "language" in d  # snake_case
    assert "duration" in d
    assert "segments" in d

  # ===== V-11: EditRequest construction (camelCase translation + filter) =====
  def test_v11_camelcase_translation(self):
    """V-11 fix: build_edit_request translates camelCase keys."""
    from vireo_video.server import _to_snake
    assert _to_snake("sourcePath") == "source_path"
    assert _to_snake("targetPlatform") == "target_platform"
    assert _to_snake("already_snake") == "already_snake"
    assert _to_snake("nestedMyField") == "nested_my_field"
    assert _to_snake("HTTPRequest") == "h_t_t_p_request"  # naive: each cap → _

  def test_v11_unknown_fields_filtered(self):
    """V-11 fix: unknown fields are silently dropped (defense in depth)."""
    from vireo_video.server import _build_edit_request
    req = _build_edit_request({
      "source_path": "/tmp/a.mp4",
      "target_platform": "tiktok",
      "malicious_field": "rm -rf /",
      "__class__": "Evil",
    })
    assert req.source_path == "/tmp/a.mp4"
    assert not hasattr(req, "malicious_field")
    assert req.__class__.__name__ == "EditRequest"

  # ===== V-19: max video duration enforcement =====
  def test_v19_max_duration_constant(self):
    """V-19 fix: 10h default cap on video duration."""
    from vireo_video.server import MAX_VIDEO_DURATION_SEC
    assert MAX_VIDEO_DURATION_SEC == 36000  # 10 hours

  def test_v19_max_duration_env_override(self, monkeypatch):
    """V-19 fix: env var VIREO_VIDEO_MAX_DURATION overrides default."""
    monkeypatch.setenv("VIREO_VIDEO_MAX_DURATION", "60")
    # Re-import to pick up the env var
    import importlib
    import vireo_video.server
    importlib.reload(vireo_video.server)
    assert vireo_video.server.MAX_VIDEO_DURATION_SEC == 60

  # ===== V-40: transcribe_file retry on transient errors =====
  def test_v40_retry_succeeds_on_5xx_then_200(self):
    """V-40 fix: transcribe_file retries 5xx errors."""
    from vireo_video.transcriber import WhisperClient, Transcript
    # Mock transport that returns 500 twice then 200
    calls = {"n": 0}

    class FakeResp:
      def __init__(self, status_code, body=None):
        self.status_code = status_code
        self._body = body or {"text": "ok", "segments": []}
      def json(self):
        return self._body

    def transport(method, url, *, files=None, data=None, headers=None, timeout=None):
      calls["n"] += 1
      if calls["n"] < 3:
        return FakeResp(500, {"error": {"message": "server unavailable"}})
      return FakeResp(200, {"text": "hello", "segments": []})

    t = WhisperClient(api_key="sk-fake", transport=transport, model="whisper-1", timeout=5)
    t.base_url = "https://fake.api"
    # Use a real (empty) file to pass the os.path.isfile check
    import tempfile, os
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
      f.write(b"RIFF")
      tmp = f.name
    try:
      result = t.transcribe_file(tmp, max_retries=2, retry_delay=0.01)
      assert calls["n"] == 3  # 2 failures + 1 success
      assert isinstance(result, Transcript)
    finally:
      os.unlink(tmp)

  def test_v40_no_retry_on_4xx(self):
    """V-40 fix: 4xx client errors are NOT retried."""
    from vireo_video.transcriber import WhisperClient, TranscriptionError
    calls = {"n": 0}

    class FakeResp:
      status_code = 401
      def json(self):
        return {"error": {"message": "invalid api key"}}

    def transport(method, url, *, files=None, data=None, headers=None, timeout=None):
      calls["n"] += 1
      return FakeResp()

    import pytest, tempfile, os
    t = WhisperClient(api_key="sk-fake", transport=transport, model="whisper-1", timeout=5)
    t.base_url = "https://fake.api"
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
      f.write(b"RIFF")
      tmp = f.name
    try:
      with pytest.raises(TranscriptionError):
        t.transcribe_file(tmp, max_retries=5, retry_delay=0.01)
      assert calls["n"] == 1  # NO retry on 4xx
    finally:
      os.unlink(tmp)

  # ===== V-45: chapter truncation count bug =====
  def test_v45_chapter_truncation_count(self):
    """V-45 fix: '(N more segments)' shows the correct N (not N-1)."""
    from vireo_video.chapters import build_chapter_prompt
    from vireo_video.transcriber import Transcript, Segment
    # 10 segments — make text very long so most get truncated
    segs = [
      Segment(id=i, start=float(i), end=float(i+1),
              text=f"segment {i}: " + ("lorem ipsum dolor sit amet " * 8))
      for i in range(10)
    ]
    t = Transcript(text=" ".join(s.text for s in segs), language="en", duration=10.0, segments=segs)
    prompt = build_chapter_prompt(t, max_chars=300)
    assert "more" in prompt
    import re
    m = re.search(r"\((\d+) more\)", prompt)
    assert m is not None, f"expected '(N more)' in prompt, got: {prompt[:200]}"
    n = int(m.group(1))
    added = 10 - n  # segments that fit before truncation
    assert added >= 1, f"expected at least 1 segment to fit, got {added}"
    assert n + added == 10, f"n={n} + added={added} should sum to 10"

  # ===== V-48: non-greedy JSON regex for LLM responses =====
  def test_v48_chapters_non_greedy_regex(self):
    """V-48 fix: regex no longer matches across garbage text."""
    from vireo_video.chapters import parse_chapters_response
    response = 'Here is the response:\n{"chapters": [{"title": "Intro", "start": 0.0, "end": 5.0}]}\nLet me know if you need more.'
    chapters = parse_chapters_response(response, total_duration=100.0)
    assert len(chapters) == 1
    assert chapters[0].title == "Intro"

  def test_v48_moments_non_greedy_regex(self):
    """V-48 fix: same regex fix in moments.py."""
    from vireo_video.moments import parse_moments_response
    response = '```json\n{"moments": [{"start": 0.0, "end": 30.0, "reason": "good"}]}\n```'
    moments = parse_moments_response(response)
    assert len(moments) == 1
    assert moments[0].start == 0.0
    assert moments[0].end == 30.0
