"""Tests for pipeline multi-clip and effects integration."""

import os
import pytest
from unittest.mock import patch, MagicMock
from vireo_video.pipeline import VideoPipeline, EditRequest, EditResult, JobState, ClipResult
from vireo_video.moments import Moment
from vireo_video.transcriber import Transcript, Segment, Word


def _write_file(path):
  """Helper to create a dummy file at path."""
  os.makedirs(os.path.dirname(path), exist_ok=True)
  with open(path, "wb") as f:
    f.write(b"\x00" * 100)
  return path


def _mock_probe(path, **kwargs):
  return {"duration_sec": 30.0, "width": 1920, "height": 1080}


MOCK_PROBE = "vireo_video.pipeline.probe"


def _make_source(tmp_path):
  src = tmp_path / "source.mp4"
  src.write_bytes(b"\x00" * 100)
  return str(src)


@patch("vireo_video.ffmpeg_utils.probe", side_effect=_mock_probe)
@patch("vireo_video.pipeline.trim")
@patch("vireo_video.pipeline.reframe_for_platform")
def test_multi_clip_produces_multiple_outputs(mock_reframe, mock_trim, mock_probe, tmp_path):
  mock_trim.side_effect = lambda src, dst, **kw: _write_file(dst)
  mock_reframe.side_effect = lambda src, dst, plat: _write_file(dst)

  pipeline = VideoPipeline()
  req = EditRequest(
    source_path=_make_source(tmp_path),
    target_platform="tiktok",
    output_path=str(tmp_path / "output.mp4"),
    custom_moments=[{"start": 0, "end": 10}, {"start": 10, "end": 20}],
    multi_clip=True,
    word_burn=False,
  )
  result = pipeline.run(req)

  assert result.state == JobState.DONE
  assert len(result.clips) == 2
  assert all(c.output_path for c in result.clips)
  assert result.clips[0].clip_index == 0
  assert result.clips[1].clip_index == 1


@patch("vireo_video.ffmpeg_utils.probe", side_effect=_mock_probe)
@patch("vireo_video.pipeline.trim")
@patch("vireo_video.pipeline.reframe_for_platform")
def test_multi_clip_with_error_in_one_clip(mock_reframe, mock_trim, mock_probe, tmp_path):
  call_count = [0]
  def trim_side(src, dst, **kw):
    call_count[0] += 1
    if call_count[0] == 2:
      raise RuntimeError("ffmpeg crash")
    _write_file(dst)
  mock_trim.side_effect = trim_side
  mock_reframe.side_effect = lambda src, dst, plat: _write_file(dst)

  pipeline = VideoPipeline()
  req = EditRequest(
    source_path=_make_source(tmp_path),
    target_platform="youtube_shorts",
    output_path=str(tmp_path / "output.mp4"),
    custom_moments=[{"start": 0, "end": 10}, {"start": 10, "end": 20}],
    multi_clip=True,
    word_burn=False,
  )
  result = pipeline.run(req)

  # V-13 fix: when any clip fails, the result is FAILED (not silently DONE)
  assert result.state == JobState.FAILED
  assert result.error and "1/2 clips failed" in result.error
  assert len(result.clips) == 2
  assert result.clips[0].error is None
  assert result.clips[1].error is not None


@patch("vireo_video.ffmpeg_utils.probe", side_effect=_mock_probe)
@patch("vireo_video.pipeline.trim")
@patch("vireo_video.pipeline.reframe_for_platform")
def test_single_clip_mode_default(mock_reframe, mock_trim, mock_probe, tmp_path):
  mock_trim.side_effect = lambda src, dst, **kw: _write_file(dst)
  mock_reframe.side_effect = lambda src, dst, plat: _write_file(dst)

  pipeline = VideoPipeline()
  req = EditRequest(
    source_path=_make_source(tmp_path),
    target_platform="youtube",
    output_path=str(tmp_path / "output.mp4"),
    custom_moments=[{"start": 0, "end": 10}],
    word_burn=False,
  )
  result = pipeline.run(req)

  assert result.state == JobState.DONE
  assert len(result.clips) == 0
  assert result.output_path


def test_edit_request_effects_fields():
  req = EditRequest(
    source_path="test.mp4",
    enable_zoom=True,
    enable_color=True,
    color_look="cinematic",
    enable_silence_removal=True,
    multi_clip=True,
  )
  assert req.enable_zoom is True
  assert req.color_look == "cinematic"
  assert req.enable_silence_removal is True
  assert req.multi_clip is True


def test_clip_result():
  c = ClipResult(
    clip_index=0,
    moment={"start": 0, "end": 10, "reason": "hook"},
    output_path="/tmp/clip0.mp4",
    duration_sec=10.0,
    output_size_bytes=1024,
  )
  d = c.to_dict()
  assert d["clip_index"] == 0
  assert d["duration_sec"] == 10.0
  assert d["error"] is None


def test_clip_result_with_error():
  c = ClipResult(
    clip_index=1,
    moment={"start": 10, "end": 20},
    output_path="",
    error="RuntimeError: ffmpeg crashed",
  )
  d = c.to_dict()
  assert d["error"] == "RuntimeError: ffmpeg crashed"


@patch("vireo_video.ffmpeg_utils.probe", side_effect=_mock_probe)
def test_progress_callback(mock_probe, tmp_path):
  progress_calls = []
  def on_progress(state, progress):
    progress_calls.append((state, progress))

  pipeline = VideoPipeline(on_progress=on_progress)
  req = EditRequest(
    source_path=_make_source(tmp_path),
    target_platform="youtube",
    output_path=str(tmp_path / "out.mp4"),
    custom_moments=[],
    word_burn=False,
  )
  # Falls back to full source clip, but will fail at cut (no ffmpeg)
  # Progress should still be emitted
  result = pipeline.run(req)
  assert len(progress_calls) >= 1
  assert progress_calls[0][1] > 0
