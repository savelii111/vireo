"""Tests for VideoPipeline with StyleProfile integration."""

import os
import pytest
from pathlib import Path
from vireo_video.pipeline import VideoPipeline, EditRequest, JobState
from vireo_video.style_profile import StyleProfile

FIXTURES = Path(__file__).parent / "fixtures"
TMP = Path(__file__).parent / "tmp_pipeline_style"


@pytest.fixture(scope="module", autouse=True)
def setup_tmp():
  TMP.mkdir(exist_ok=True)
  yield


# ---------- Pipeline with style profile ----------

def test_pipeline_runs_without_style_profile():
  """Default: no profile, no style transfer fn — should work as before."""
  pipeline = VideoPipeline()
  req = EditRequest(
    source_path=str(FIXTURES / "sample_10s.mp4"),
    target_platform="youtube_shorts",
    output_path=str(TMP / "no_style.mp4"),
    word_burn=False,
  )
  result = pipeline.run(req)
  assert result.state == JobState.DONE
  # No style_transfer step should appear
  assert not any(s.get("name") == "style_transfer" for s in result.steps)


def test_pipeline_with_style_profile_calls_transfer():
  """When profile + fn are provided, style_transfer step runs."""
  calls = []
  def style_fn(input_path, output_path, profile, transcript):
    calls.append({
      "input": input_path,
      "output": output_path,
      "profile_name": profile.name,
      "look": profile.recommended_look,
    })
    # Simulate: just copy
    import shutil
    shutil.copy2(input_path, output_path)
    return output_path

  pipeline = VideoPipeline(style_transfer_fn=style_fn)
  profile = StyleProfile(name="creator_x", recommended_look="cinematic", look_confidence=0.8)
  req = EditRequest(
    source_path=str(FIXTURES / "sample_10s.mp4"),
    target_platform="youtube_shorts",
    output_path=str(TMP / "with_style.mp4"),
    word_burn=False,
    style_profile=profile,
    apply_style=True,
  )
  result = pipeline.run(req)
  assert result.state == JobState.DONE
  # The style transfer fn was called
  assert len(calls) == 1
  assert calls[0]["look"] == "cinematic"
  # The style_transfer step appears in the trace
  style_steps = [s for s in result.steps if s.get("name") == "style_transfer"]
  assert len(style_steps) == 1
  assert "look" in style_steps[0]


def test_pipeline_style_transfer_error_does_not_fail():
  """If the style transfer fn raises, we keep the un-styled output (graceful)."""
  def bad_style_fn(input_path, output_path, profile, transcript):
    raise RuntimeError("style transfer broken")

  pipeline = VideoPipeline(style_transfer_fn=bad_style_fn)
  profile = StyleProfile(name="x", recommended_look="cinematic")
  req = EditRequest(
    source_path=str(FIXTURES / "sample_10s.mp4"),
    target_platform="youtube_shorts",
    output_path=str(TMP / "style_broken.mp4"),
    word_burn=False,
    style_profile=profile,
  )
  result = pipeline.run(req)
  # Should still complete (DONE), but with style_transfer error step
  assert result.state == JobState.DONE
  style_steps = [s for s in result.steps if s.get("name") == "style_transfer"]
  assert len(style_steps) == 1
  assert "error" in style_steps[0]


def test_pipeline_apply_style_false_skips_transfer():
  """If apply_style=False, profile is set but not used."""
  def style_fn(input_path, output_path, profile, transcript):
    raise AssertionError("should not be called")

  pipeline = VideoPipeline(style_transfer_fn=style_fn)
  profile = StyleProfile(name="x")
  req = EditRequest(
    source_path=str(FIXTURES / "sample_10s.mp4"),
    target_platform="youtube",
    output_path=str(TMP / "no_apply.mp4"),
    word_burn=False,
    style_profile=profile,
    apply_style=False,
  )
  result = pipeline.run(req)
  assert result.state == JobState.DONE
  # No style_transfer step
  assert not any(s.get("name") == "style_transfer" for s in result.steps)


def test_pipeline_profile_without_fn_logs_skip():
  """Profile set but no transfer fn — should skip cleanly with a reason."""
  pipeline = VideoPipeline()  # no style_transfer_fn
  profile = StyleProfile(name="x")
  req = EditRequest(
    source_path=str(FIXTURES / "sample_10s.mp4"),
    target_platform="youtube",
    output_path=str(TMP / "profile_no_fn.mp4"),
    word_burn=False,
    style_profile=profile,
  )
  result = pipeline.run(req)
  assert result.state == JobState.DONE
  style_steps = [s for s in result.steps if s.get("name") == "style_transfer"]
  assert len(style_steps) == 1
  assert "no style_transfer_fn" in style_steps[0].get("reason", "")


def test_pipeline_with_real_style_transfer_fn():
  """End-to-end: use the real apply_style from style_transfer module."""
  from vireo_video.style_transfer import apply_style, TransferOptions
  def real_fn(input_path, output_path, profile, transcript):
    apply_style(input_path, output_path, profile, transcript=transcript,
                options=TransferOptions(apply_look=True, match_pacing=False, apply_zoom=False))
    return output_path

  pipeline = VideoPipeline(style_transfer_fn=real_fn)
  profile = StyleProfile(name="cinematic_test", recommended_look="cinematic",
                          look_confidence=0.85)
  req = EditRequest(
    source_path=str(FIXTURES / "sample_10s.mp4"),
    target_platform="youtube",
    output_path=str(TMP / "real_style.mp4"),
    word_burn=False,
    style_profile=profile,
  )
  result = pipeline.run(req)
  assert result.state == JobState.DONE
  assert Path(result.output_path).exists()
