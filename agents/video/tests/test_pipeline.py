"""Tests for pipeline.py + server.py — the integration layer."""

import os
import json
import time
import threading
import pytest
from pathlib import Path
from vireo_video.pipeline import (
  VideoPipeline, EditRequest, EditResult, JobState,
)
from vireo_video.transcriber import Transcript, Segment, Word
from vireo_video.moments import Moment, MomentSelector
from vireo_video.server import build_server, JobStore

FIXTURES = Path(__file__).parent / "fixtures"
TMP = Path(__file__).parent / "tmp_pipeline"


@pytest.fixture(scope="module", autouse=True)
def setup_tmp():
  TMP.mkdir(exist_ok=True)
  yield


# ---------- helpers ----------

def make_transcript():
  return Transcript(
    text="Hello world this is a test",
    language="en", duration=10.0,
    segments=[
      Segment(id=0, start=0, end=3, text="Hello world",
              words=[Word("Hello", 0, 0.5), Word("world", 0.5, 1.0)]),
      Segment(id=1, start=3, end=6, text="this is a",
              words=[Word("this", 3, 3.5), Word("is", 3.5, 3.7),
                     Word("a", 3.7, 3.9)]),
      Segment(id=2, start=6, end=10, text="test segment",
              words=[Word("test", 6, 6.5), Word("segment", 6.5, 7.5)]),
    ],
  )


# ---------- pipeline basics ----------

def test_pipeline_runs_end_to_end_without_whisper():
  """No whisper client: uses synthesized transcript (no word timestamps)."""
  pipeline = VideoPipeline(whisper_client=None, llm_fn=None)
  req = EditRequest(
    source_path=str(FIXTURES / "sample_10s.mp4"),
    target_platform="youtube_shorts",
    output_path=str(TMP / "e2e_youtube_shorts.mp4"),
    max_moments=1,
    word_burn=False,  # no transcript -> no subs
  )
  result = pipeline.run(req)
  assert result.state == JobState.DONE, f"expected DONE, got {result.state}: {result.error}"
  assert Path(result.output_path).exists()
  assert result.duration_sec > 0
  assert len(result.steps) >= 4  # transcribe (skipped) + select + cut + reframe + export


def test_pipeline_uses_custom_moments():
  pipeline = VideoPipeline(whisper_client=None, llm_fn=None)
  req = EditRequest(
    source_path=str(FIXTURES / "sample_10s.mp4"),
    target_platform="youtube",
    output_path=str(TMP / "custom_moments.mp4"),
    custom_moments=[{"start": 1.0, "end": 5.0, "reason": "test"}],
  )
  result = pipeline.run(req)
  assert result.state == JobState.DONE
  assert len(result.moments) == 1
  assert result.moments[0]["reason"] == "test"
  # Output should be ~4s
  assert 3.5 < result.duration_sec < 4.5


def test_pipeline_with_whisper_mock():
  """Mock whisper returns a transcript; mock LLM returns moments; we verify the whole flow."""
  # Build mock whisper
  class MockWhisper:
    def __init__(self, transcript):
      self.transcript = transcript
      self.calls = []
    def transcribe_file(self, path, *, language=None):
      self.calls.append(path)
      return self.transcript
    def estimate_cost(self, duration_sec):
      return 0.001

  def mock_llm(prompt):
    return json.dumps({"moments": [
      {"start": 1.0, "end": 5.0, "reason": "Best insight", "score": 0.95},
    ]})

  whisper = MockWhisper(make_transcript())
  selector = MomentSelector(llm_fn=mock_llm, fallback=True)
  pipeline = VideoPipeline(whisper_client=whisper, moment_selector=selector, enable_subtitles=True)

  req = EditRequest(
    source_path=str(FIXTURES / "sample_10s.mp4"),
    target_platform="youtube_shorts",
    output_path=str(TMP / "with_subs.mp4"),
    max_moments=1,
    word_burn=True,
  )
  result = pipeline.run(req)
  assert result.state == JobState.DONE, f"got {result.state}: {result.error}"
  assert Path(result.output_path).exists()
  # Should have burned subtitles
  assert any(s["name"] == "subtitle" for s in result.steps)
  assert result.cost_usd > 0


def test_pipeline_handles_invalid_moments():
  """Custom moments that violate constraints should be filtered out."""
  pipeline = VideoPipeline(whisper_client=None, llm_fn=None)
  req = EditRequest(
    source_path=str(FIXTURES / "sample_10s.mp4"),
    target_platform="youtube",
    output_path=str(TMP / "invalid_moments.mp4"),
    custom_moments=[
      {"start": "bad", "end": 5},   # invalid
      {"start": 0, "end": 0.5},      # too short
      {"start": 2, "end": 6},        # valid
    ],
  )
  result = pipeline.run(req)
  assert result.state == JobState.DONE
  # Only 1 valid moment made it through
  assert len(result.moments) == 1


def test_pipeline_failure_state():
  """If source doesn't exist, the pipeline should fail gracefully."""
  pipeline = VideoPipeline(whisper_client=None, llm_fn=None)
  req = EditRequest(
    source_path="C:/nonexistent/file.mp4",
    target_platform="youtube",
    output_path=str(TMP / "should_fail.mp4"),
  )
  result = pipeline.run(req)
  assert result.state == JobState.FAILED
  assert result.error is not None
  assert "exception" in [s.get("name") for s in result.steps]


def test_pipeline_max_moments_zero_uses_one():
  pipeline = VideoPipeline(whisper_client=None, llm_fn=None)
  req = EditRequest(
    source_path=str(FIXTURES / "sample_10s.mp4"),
    target_platform="youtube",
    output_path=str(TMP / "max_moments.mp4"),
    max_moments=0,
  )
  result = pipeline.run(req)
  assert result.state == JobState.DONE
  assert len(result.moments) >= 1


def test_pipeline_step_recording():
  pipeline = VideoPipeline(whisper_client=None, llm_fn=None)
  req = EditRequest(
    source_path=str(FIXTURES / "sample_10s.mp4"),
    target_platform="tiktok",
    output_path=str(TMP / "tiktok.mp4"),
  )
  result = pipeline.run(req)
  step_names = [s["name"] for s in result.steps]
  assert "transcribe" in step_names
  assert "select" in step_names
  assert "cut" in step_names
  assert "reframe" in step_names
  assert "export" not in step_names  # export is just a marker state, not a step
  for step in result.steps:
    assert "duration_sec" in step


# ---------- EditRequest/EditResult ----------

def test_edit_request_to_dict():
  r = EditRequest(source_path="x.mp4", target_platform="tiktok", output_path="o.mp4")
  d = r.to_dict()
  assert d["source_path"] == "x.mp4"
  assert d["target_platform"] == "tiktok"


def test_edit_result_to_dict_state_is_string():
  r = EditResult(job_id="j1", state=JobState.DONE, source_path="x", output_path="o", target_platform="tiktok")
  d = r.to_dict()
  assert d["state"] == "done"  # not JobState.DONE


# ---------- server (HTTP) ----------

def _start_server_in_thread(built):
  """Start the server in a daemon thread; return a shutdown function."""
  t = threading.Thread(target=built["server"].serve_forever, daemon=True)
  t.start()
  time.sleep(0.2)  # let it bind

  def stop():
    built["server"].shutdown()
    built["server"].server_close()
  return stop


def _port(built):
  return built["server"].server_address[1]


def test_server_health():
  built = build_server(port=0)
  stop = _start_server_in_thread(built)
  try:
    import urllib.request
    with urllib.request.urlopen(f"http://127.0.0.1:{_port(built)}/health") as r:
      data = json.loads(r.read())
    assert data["status"] == "ok"
    assert "platforms" in data
  finally:
    stop()


def test_server_list_platforms():
  built = build_server(port=0)
  stop = _start_server_in_thread(built)
  try:
    import urllib.request
    with urllib.request.urlopen(f"http://127.0.0.1:{_port(built)}/platforms") as r:
      data = json.loads(r.read())
    assert "tiktok" in data["platforms"]
    assert "youtube_shorts" in data["platforms"]
  finally:
    stop()


def test_server_get_preset():
  built = build_server(port=0)
  stop = _start_server_in_thread(built)
  try:
    import urllib.request
    with urllib.request.urlopen(f"http://127.0.0.1:{_port(built)}/presets/tiktok") as r:
      data = json.loads(r.read())
    assert data["platform"] == "tiktok"
    assert data["aspect"] == "9:16"
  finally:
    stop()


def test_server_list_styles():
  built = build_server(port=0)
  stop = _start_server_in_thread(built)
  try:
    import urllib.request
    with urllib.request.urlopen(f"http://127.0.0.1:{_port(built)}/styles") as r:
      data = json.loads(r.read())
    assert "tiktok" in data["styles"]
    assert "default" in data["styles"]
  finally:
    stop()


def test_server_edit_job_end_to_end():
  built = build_server(port=0)
  stop = _start_server_in_thread(built)
  try:
    import urllib.request, urllib.error
    body = json.dumps({
      "source_path": str(FIXTURES / "sample_10s.mp4"),
      "target_platform": "youtube_shorts",
      "output_path": str(TMP / "server_e2e.mp4"),
      "word_burn": False,
    }).encode("utf-8")
    req = urllib.request.Request(
      f"http://127.0.0.1:{_port(built)}/edit",
      data=body,
      headers={"Content-Type": "application/json"},
      method="POST",
    )
    with urllib.request.urlopen(req) as r:
      data = json.loads(r.read())
    assert data["state"] == "done", f"got {data['state']}: {data.get('error')}"
    # Job should be retrievable
    job_id = data["job_id"]
    with urllib.request.urlopen(f"http://127.0.0.1:{_port(built)}/jobs/{job_id}") as r:
      job = json.loads(r.read())
    assert job["state"] == "done"
    # /jobs should list it
    with urllib.request.urlopen(f"http://127.0.0.1:{_port(built)}/jobs") as r:
      listing = json.loads(r.read())
    assert listing["count"] >= 1
  finally:
    stop()


def test_server_edit_missing_source_returns_400():
  built = build_server(port=0)
  stop = _start_server_in_thread(built)
  try:
    import urllib.request, urllib.error
    body = json.dumps({"source_path": "", "output_path": "x.mp4"}).encode("utf-8")
    req = urllib.request.Request(
      f"http://127.0.0.1:{_port(built)}/edit",
      data=body,
      headers={"Content-Type": "application/json"},
      method="POST",
    )
    try:
      urllib.request.urlopen(req)
      assert False, "expected 400"
    except urllib.error.HTTPError as e:
      assert e.code == 400
  finally:
    stop()


def test_server_get_unknown_job_404():
  built = build_server(port=0)
  stop = _start_server_in_thread(built)
  try:
    import urllib.request, urllib.error
    try:
      urllib.request.urlopen(f"http://127.0.0.1:{_port(built)}/jobs/nonexistent")
      assert False
    except urllib.error.HTTPError as e:
      assert e.code == 404
  finally:
    stop()


def test_server_unknown_route_404():
  built = build_server(port=0)
  stop = _start_server_in_thread(built)
  try:
    import urllib.request, urllib.error
    try:
      urllib.request.urlopen(f"http://127.0.0.1:{_port(built)}/nope")
      assert False
    except urllib.error.HTTPError as e:
      assert e.code == 404
  finally:
    stop()


# ---------- JobStore ----------

def test_jobstore_add_get_list():
  store = JobStore()
  r1 = EditResult(job_id="a", state=JobState.DONE, source_path="x", output_path="o", target_platform="tiktok", started_at=1)
  r2 = EditResult(job_id="b", state=JobState.DONE, source_path="y", output_path="o", target_platform="yt", started_at=2)
  store.add(r1)
  store.add(r2)
  assert store.get("a").job_id == "a"
  assert store.get("c") is None
  items = store.list()
  assert len(items) == 2
  # Newest first
  assert items[0].job_id == "b"
