"""Tests for reframe.py — aspect ratio conversion with crop."""

import os
import pytest
from pathlib import Path
from vireo_video.reframe import (
  compute_center_crop, reframe, reframe_for_platform, reframe_with_pan, CropBox,
)
from vireo_video.ffmpeg_utils import probe
from vireo_video.presets import parse_aspect

FIXTURES = Path(__file__).parent / "fixtures"
TMP = Path(__file__).parent / "tmp_reframe"


@pytest.fixture(scope="module", autouse=True)
def setup_tmp():
  TMP.mkdir(exist_ok=True)
  yield


# ----- compute_center_crop -----

def test_center_crop_16_9_to_9_16():
  box = compute_center_crop(1920, 1080, "9:16")
  # 1080 * 9/16 = 607.5 -> 606 (even)
  assert box.width == 606 or box.width == 608
  assert box.height == 1080
  # Centered horizontally
  assert box.x == (1920 - box.width) // 2
  assert box.y == 0


def test_center_crop_16_9_to_1_1():
  box = compute_center_crop(1920, 1080, "1:1")
  assert box.width == 1080
  assert box.height == 1080
  assert box.x == (1920 - 1080) // 2
  assert box.y == 0


def test_center_crop_9_16_to_16_9():
  # Source 1080x1920 (9:16, tall) -> target 16:9 (wide) -> crop vertically
  box = compute_center_crop(1080, 1920, "16:9")
  # new_h = 1080 / (16/9) = 607.5 -> 606 (even)
  assert box.width == 1080
  assert box.height in (606, 608)
  assert box.x == 0
  # Centered vertically
  assert box.y == (1920 - box.height) // 2


def test_center_crop_same_aspect_is_identity():
  box = compute_center_crop(1920, 1080, "16:9")
  assert box.width == 1920
  assert box.height == 1080
  assert box.x == 0
  assert box.y == 0


def test_center_crop_too_tall_raises():
  # A 4:3 source being cropped to 9:16 (very tall) means we cut almost the entire width
  # and end up with a tiny slice. Should not raise — but should be a small but valid box.
  box = compute_center_crop(640, 480, "9:16")
  assert box.width > 0 and box.height > 0
  # And it should still match the target aspect
  assert abs(box.width / box.height - 9 / 16) < 0.05


def test_center_crop_even_dimensions():
  # yuv420p requires even width and height
  for w, h, target in [(1920, 1080, "9:16"), (1920, 1080, "4:5"), (1280, 720, "1:1")]:
    box = compute_center_crop(w, h, target)
    assert box.width % 2 == 0
    assert box.height % 2 == 0


def test_cropbox_to_filter():
  b = CropBox(x=10, y=20, width=100, height=200)
  assert b.to_filter() == "crop=100:200:10:20"


def test_cropbox_validates():
  with pytest.raises(ValueError):
    CropBox(x=0, y=0, width=0, height=100)
  with pytest.raises(ValueError):
    CropBox(x=0, y=0, width=100, height=-1)


# ----- reframe -----

def test_reframe_16_9_to_9_16():
  src = str(FIXTURES / "sample_10s.mp4")
  out = str(TMP / "9x16.mp4")
  if os.path.exists(out): os.unlink(out)
  reframe(src, out, target_aspect="9:16", output_width=1080, output_height=1920)
  info = probe(out)
  assert info["width"] == 1080
  assert info["height"] == 1920
  assert abs(info["duration_sec"] - 10.0) < 0.5


def test_reframe_16_9_to_1_1():
  src = str(FIXTURES / "sample_10s.mp4")
  out = str(TMP / "1x1.mp4")
  if os.path.exists(out): os.unlink(out)
  reframe(src, out, target_aspect="1:1", output_width=1080, output_height=1080)
  info = probe(out)
  assert info["width"] == 1080
  assert info["height"] == 1080


def test_reframe_with_explicit_crop_box():
  src = str(FIXTURES / "sample_10s.mp4")
  out = str(TMP / "explicit_crop.mp4")
  if os.path.exists(out): os.unlink(out)
  # Crop a 600x600 square from the center
  box = CropBox(x=340, y=60, width=600, height=600)
  reframe(src, out, target_aspect="1:1", output_width=600, output_height=600, crop_box=box)
  info = probe(out)
  assert info["width"] == 600
  assert info["height"] == 600


def test_reframe_no_resize_keeps_cropped_size():
  src = str(FIXTURES / "sample_10s.mp4")
  out = str(TMP / "no_resize.mp4")
  if os.path.exists(out): os.unlink(out)
  reframe(src, out, target_aspect="1:1")  # no width/height -> cropped pixel size
  info = probe(out)
  # Source is 1280x720 -> square crop is 720x720 (no resize)
  assert info["width"] == 720
  assert info["height"] == 720


# ----- reframe_for_platform -----

def test_reframe_for_platform_tiktok():
  src = str(FIXTURES / "sample_10s.mp4")
  out = str(TMP / "tiktok.mp4")
  if os.path.exists(out): os.unlink(out)
  reframe_for_platform(src, out, "tiktok")
  info = probe(out)
  assert info["width"] == 1080
  assert info["height"] == 1920
  assert abs(info["duration_sec"] - 10.0) < 0.5


def test_reframe_for_platform_youtube_long():
  src = str(FIXTURES / "sample_10s.mp4")
  out = str(TMP / "yt_long.mp4")
  if os.path.exists(out): os.unlink(out)
  reframe_for_platform(src, out, "youtube")
  info = probe(out)
  # YouTube long is 1920x1080; source is also 1920x1080, so should be unchanged
  assert info["width"] == 1920
  assert info["height"] == 1080


# ----- reframe_with_pan -----

def test_reframe_with_pan_no_keyframes_falls_back_to_center():
  src = str(FIXTURES / "sample_10s.mp4")
  out = str(TMP / "pan_default.mp4")
  if os.path.exists(out): os.unlink(out)
  reframe_with_pan(src, out, target_aspect="9:16", focal_points=[], output_width=1080, output_height=1920)
  info = probe(out)
  assert info["width"] == 1080
  assert info["height"] == 1920


def test_reframe_with_pan_single_keyframe_falls_back_to_static():
  src = str(FIXTURES / "sample_10s.mp4")
  out = str(TMP / "pan_one.mp4")
  if os.path.exists(out): os.unlink(out)
  reframe_with_pan(src, out, target_aspect="9:16",
                   focal_points=[(0.0, 0.5, 0.5, 1.0)], output_width=1080, output_height=1920)
  info = probe(out)
  assert info["width"] == 1080
  assert info["height"] == 1920


def test_reframe_with_pan_multiple_keyframes():
  src = str(FIXTURES / "sample_10s.mp4")
  out = str(TMP / "pan_multi.mp4")
  if os.path.exists(out): os.unlink(out)
  reframe_with_pan(src, out, target_aspect="9:16",
                   focal_points=[(0.0, 0.3, 0.5, 1.0), (5.0, 0.7, 0.5, 1.0)],
                   output_width=1080, output_height=1920)
  info = probe(out)
  assert info["width"] == 1080
  assert info["height"] == 1920
  assert abs(info["duration_sec"] - 10.0) < 0.5
