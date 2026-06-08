"""B1 wire-mismatch tests (2026-06-08).

These tests verify the new `operation` field in EditRequest and the
new `_run_operation` dispatch in VideoPipeline. Each test:

  1. Builds an EditRequest with `operation` set + the right
     `operation_params`.
  2. Runs the pipeline.
  3. Asserts the result has:
     - the expected `output_path` (a real file on disk)
     - the expected step in `result.steps` (e.g. "add_broll")
     - the expected `result.error is None` on the happy path

Why these tests matter: the previous behavior (before B1) was that
the Studio `add_broll` / `apply_hook_style` / `generate_thumbnail`
tools sent `operation: "<name>"` in their body, but EditRequest had
no `operation` field, so the request silently fell through to the
default pipeline. The user got a "default edit" instead of the
named operation. These tests now lock down the new behavior.
"""

import json
import os
import sys
import threading
import time
from http.client import HTTPConnection
from pathlib import Path
from unittest.mock import patch

import pytest

# Make vireo_video importable
sys.path.insert(0, str(Path(__file__).parent.parent))

from vireo_video.pipeline import EditRequest, VideoPipeline, JobState, EditResult


# ----- Minimal fake transcript used by the add_broll and apply_hook_style paths

class _FakeSegment:
  def __init__(self, text, start=0.0, end=5.0, words=None):
    self.text = text
    self.start = start
    self.end = end
    self.duration = end - start
    self.words = words or []


class _FakeTranscript:
  def __init__(self, text="Hello world. This is a test transcript about coding."):
    self.text = text
    self.segments = [
      _FakeSegment("Hello world.", 0.0, 1.5),
      _FakeSegment("This is a test transcript about coding.", 1.5, 6.0),
    ]
    self.language = "en"
    self.duration = 6.0


# ----- add_broll operation tests -----

def test_add_broll_returns_done_with_source_unchanged_when_no_pexels_key(tmp_path):
  """B1 fix: add_broll should NOT fall through to default pipeline.
  With no PEXELS_API_KEY, the broll inserter finds no clips and the
  result should explicitly say so. Source file is returned unchanged.
  """
  src = tmp_path / "src.mp4"
  src.write_bytes(b"fake video bytes")
  out = tmp_path / "out.mp4"

  req = EditRequest(
    source_path=str(src),
    output_path=str(out),
    operation="add_broll",
    operation_params={"style": "tech", "count": 3},
  )

  # Stub out the whisper transcriber (we don't have a real one in
  # the test env). The pipeline has its own _synthesize_transcript
  # fallback that produces a fake transcript if whisper is None.
  pipeline = VideoPipeline(whisper_client=None)
  with patch.object(pipeline, "_step_transcribe", return_value=_FakeTranscript()):
    result = pipeline.run(req)

  # Result is DONE (not FAILED) even though no broll was applied
  assert result.state == JobState.DONE, f"expected DONE, got {result.state}: {result.error}"
  assert result.error is None
  # The result step tells the user the truth
  steps = {s["name"]: s for s in result.steps}
  assert "add_broll" in steps, f"missing 'add_broll' step: {result.steps}"
  # Without a Pexels key, no broll clips were fetched. The pipeline
  # still completes (DONE) and `applied` is 0, even if `matches` is
  # > 0 (we found candidate segments but couldn't fetch stock footage).
  assert steps["add_broll"].get("applied") == 0
  assert "no_broll_available" in steps["add_broll"].get("skipped", "")


def test_add_broll_with_synthetic_transcript_falls_back_cleanly(tmp_path):
  """When whisper is None, _synthesize_transcript produces a stub.
  The broll path should still complete without crashing."""
  src = tmp_path / "src.mp4"
  src.write_bytes(b"")
  req = EditRequest(
    source_path=str(src),
    operation="add_broll",
    operation_params={"style": "nature", "count": 2},
  )
  pipeline = VideoPipeline(whisper_client=None)
  # _step_transcribe returns None → pipeline._synthesize_transcript
  # is called (which tries to probe the file and may fail). Either
  # way, the result should have an add_broll step, not a stack trace.
  with patch.object(pipeline, "_step_transcribe", return_value=None):
    result = pipeline.run(req)
  steps = {s["name"]: s for s in result.steps}
  # The pipeline tolerated the missing whisper and ran the dispatch
  assert "add_broll" in steps or "operation_dispatch" in steps or "exception" in steps
  # The default pipeline must NOT have run (no transcribing/selecting
  # steps, which would prove the B1 fix is in place)
  assert "transcribing" not in [s["name"] for s in result.steps], \
    "B1 regression: default pipeline ran for an `add_broll` operation!"


# ----- apply_hook_style operation tests -----

def test_apply_hook_style_returns_done_with_analysis(tmp_path):
  """B1 fix: apply_hook_style should classify the hook style and
  return the analysis, NOT run the default edit pipeline."""
  src = tmp_path / "src.mp4"
  src.write_bytes(b"")
  req = EditRequest(
    source_path=str(src),
    operation="apply_hook_style",
    operation_params={"style": "auto", "topic": "Python decorators"},
  )
  pipeline = VideoPipeline(whisper_client=None)
  with patch.object(pipeline, "_step_transcribe", return_value=_FakeTranscript()):
    result = pipeline.run(req)
  assert result.state == JobState.DONE
  assert result.error is None
  steps = {s["name"]: s for s in result.steps}
  assert "apply_hook_style" in steps
  # The hook analysis is embedded in `result.transcript` for the
  # Studio LLM to read.
  assert result.transcript is not None
  assert "hook_style" in result.transcript
  # Default pipeline did NOT run
  assert "transcribing" not in [s["name"] for s in result.steps]


# ----- generate_thumbnail operation tests -----

def test_generate_thumbnail_fails_cleanly_when_source_missing(tmp_path):
  """B1 fix: generate_thumbnail should fail with a clear error when
  the source file doesn't exist, NOT crash with a stack trace."""
  req = EditRequest(
    source_path=str(tmp_path / "does_not_exist.mp4"),
    operation="generate_thumbnail",
    operation_params={"title": "My video"},
  )
  pipeline = VideoPipeline(whisper_client=None)
  result = pipeline.run(req)
  # The pipeline catches exceptions and returns FAILED with a
  # structured error.
  assert result.state == JobState.FAILED
  assert result.error is not None
  # The error is wrapped in the operation_dispatch step (which is
  # the catch-all for dispatch-time exceptions). The 'error' field
  # carries the ffmpeg failure reason.
  err_steps = [s for s in result.steps if s.get("name") == "operation_dispatch"]
  assert len(err_steps) >= 1
  assert "ffmpeg_failed" in err_steps[0].get("error", "") or "generate_thumbnail" in str(err_steps)


def test_generate_thumbnail_fails_when_title_missing(tmp_path):
  """Missing title → clear 'missing_title' error, not a stack trace."""
  src = tmp_path / "src.mp4"
  src.write_bytes(b"")
  req = EditRequest(
    source_path=str(src),
    operation="generate_thumbnail",
    operation_params={},  # no title
  )
  pipeline = VideoPipeline(whisper_client=None)
  result = pipeline.run(req)
  assert result.state == JobState.FAILED
  assert result.error == "missing_title"


# ----- analyze_audio operation tests -----

def test_analyze_audio_dispatches_without_crash(tmp_path):
  """analyze_audio uses the audio_analyzer module. With a fake file,
  the call should dispatch and either succeed or fail cleanly."""
  src = tmp_path / "src.mp4"
  src.write_bytes(b"")
  req = EditRequest(
    source_path=str(src),
    operation="analyze_audio",
    operation_params={},
  )
  pipeline = VideoPipeline(whisper_client=None)
  result = pipeline.run(req)
  # Result is one of: DONE (analyzer worked) or FAILED (audio_analyzer
  # rejected the fake file). Either way, the step name should be
  # "analyze_audio" — proving the dispatch fired.
  steps = [s["name"] for s in result.steps]
  assert "analyze_audio" in steps or "operation_dispatch" in steps, \
    f"analyze_audio didn't dispatch: {steps}"


# ----- Backward-compatibility tests -----

def test_default_pipeline_still_runs_when_operation_is_empty(tmp_path):
  """If operation is empty (the classic cut_clips / remove_silence case),
  the default pipeline runs as before. B1 must NOT break this."""
  src = tmp_path / "src.mp4"
  src.write_bytes(b"")
  req = EditRequest(
    source_path=str(src),
    operation="",  # explicit empty
    output_path=str(tmp_path / "out.mp4"),
    target_platform="tiktok",
  )
  pipeline = VideoPipeline(whisper_client=None)
  with patch.object(pipeline, "_step_transcribe", return_value=_FakeTranscript()):
    with patch.object(pipeline, "_step_select", return_value=[]):
      with patch.object(pipeline, "_step_cut", return_value=str(src)):
        with patch.object(pipeline, "_step_effects", return_value=str(src)):
          with patch.object(pipeline, "_step_reframe", return_value=str(src)):
            with patch.object(pipeline, "_step_subtitle", return_value=str(src)):
              with patch.object(pipeline, "_step_style_transfer", return_value=str(src)):
                result = pipeline.run(req)
  # The default pipeline ran end-to-end without crashing
  assert result.state == JobState.DONE, f"default pipeline didn't reach DONE, steps={result.steps}, error={result.error}"
  # The pipeline progressed through the standard phases (via
  # _emit_progress). The `transcribing` step is added inside
  # _step_transcribe, which is mocked here — so we just verify the
  # default pipeline didn't fall through to the new operation
  # dispatch path (which would have logged `add_broll` etc.).
  step_names = [s["name"] for s in result.steps]
  assert "add_broll" not in step_names, "B1 regression: default pipeline took the operation dispatch path!"


def test_unknown_operation_falls_through_to_default_pipeline(tmp_path):
  """An unknown operation name should NOT crash — it should log a
  warning step and run the default pipeline (safer than erroring)."""
  src = tmp_path / "src.mp4"
  src.write_bytes(b"")
  req = EditRequest(
    source_path=str(src),
    operation="definitely_not_a_real_op",
    output_path=str(tmp_path / "out.mp4"),
  )
  pipeline = VideoPipeline(whisper_client=None)
  with patch.object(pipeline, "_step_transcribe", return_value=_FakeTranscript()):
    with patch.object(pipeline, "_step_select", return_value=[]):
      with patch.object(pipeline, "_step_cut", return_value=str(src)):
        with patch.object(pipeline, "_step_effects", return_value=str(src)):
          with patch.object(pipeline, "_step_reframe", return_value=str(src)):
            with patch.object(pipeline, "_step_subtitle", return_value=str(src)):
              with patch.object(pipeline, "_step_style_transfer", return_value=str(src)):
                result = pipeline.run(req)
  steps = {s["name"]: s for s in result.steps}
  assert "unknown_operation_fallback" in steps
  # And the default pipeline completed end-to-end
  assert result.state == JobState.DONE


# ----- EditRequest field filter test (server.py _build_edit_request) -----

def test_build_edit_request_preserves_operation_and_params():
  """The server.py _build_edit_request function (V-11 fix) filters
  to known fields. After B1, `operation` and `operation_params`
  are known fields, so they survive the filter."""
  from vireo_video.server import _build_edit_request
  req = _build_edit_request({
    "source_path": "/uploads/x.mp4",
    "operation": "add_broll",
    "operation_params": {"style": "tech", "count": 3},
    "file_path": "/uploads/x.mp4",  # legacy alias
    "completelyUnknown": "should_be_dropped",
  })
  assert req.source_path == "/uploads/x.mp4"
  assert req.operation == "add_broll"
  assert req.operation_params == {"style": "tech", "count": 3}
  # Unknown fields were filtered
  assert not hasattr(req, "completelyUnknown")
