"""Tests for color.py — color grading presets and LUT application."""

import os
import pytest
from pathlib import Path
from vireo_video.color import Look, LOOKS, apply_look, apply_lut, list_looks, _build_filter
from vireo_video.ffmpeg_utils import FFmpegError

FIXTURES = Path(__file__).parent / "fixtures"
TMP = Path(__file__).parent / "tmp_color"


@pytest.fixture(scope="module", autouse=True)
def setup_tmp():
  TMP.mkdir(exist_ok=True)
  yield


# ---------- Look dataclass / LOOKS dict ----------

def test_all_looks_defined():
  expected = {"natural", "cinematic", "warm", "cool", "vintage", "bw",
              "high_contrast", "soft"}
  assert set(LOOKS.keys()) == expected


def test_look_has_name_and_description():
  for name, look in LOOKS.items():
    assert look.name == name
    assert look.description


def test_bw_is_zero_saturation():
  assert LOOKS["bw"].saturation == 0.0


def test_natural_is_passthrough():
  assert _build_filter(LOOKS["natural"]) == ""


def test_cinematic_modifies_something():
  f = _build_filter(LOOKS["cinematic"])
  assert "eq=" in f
  assert "colorbalance=" in f


def test_high_contrast_pumps_contrast():
  assert LOOKS["high_contrast"].contrast > 1.2


def test_warm_skews_color_balance():
  # Warm: red up, blue down
  assert LOOKS["warm"].red_balance > 1.0
  assert LOOKS["warm"].blue_balance < 1.0


def test_cool_skews_color_balance_opposite():
  assert LOOKS["cool"].red_balance < 1.0
  assert LOOKS["cool"].blue_balance > 1.0


# ---------- _build_filter ----------

def test_build_filter_with_lut_uses_lut3d():
  look = Look(name="x", description="y", lut_path="C:/path/to/lut.cube")
  f = _build_filter(look)
  assert "lut3d=" in f
  assert "C:/path/to/lut.cube" in f or "C\\:/path/to/lut.cube" in f


def test_build_filter_with_eq_only():
  look = Look(name="x", description="y", contrast=1.2, brightness=-0.05)
  f = _build_filter(look)
  assert "eq=" in f
  assert "contrast=1.2" in f
  assert "brightness=-0.05" in f


def test_build_filter_with_colorbalance_only():
  look = Look(name="x", description="y", red_balance=1.1, blue_balance=0.9)
  f = _build_filter(look)
  assert "colorbalance=" in f
  assert "rs=0.1" in f or "rs=0.100" in f
  assert "bs=-0.1" in f or "bs=-0.100" in f


def test_build_filter_combines_eq_and_colorbalance():
  look = Look(name="x", description="y", contrast=1.2, red_balance=1.1)
  f = _build_filter(look)
  assert "eq=" in f
  assert "colorbalance=" in f


def test_build_filter_includes_extra():
  look = Look(name="x", description="y", extra_filters="curves=preset=increase_contrast")
  f = _build_filter(look)
  assert "curves=" in f


# ---------- apply_look (end-to-end) ----------

def test_apply_natural_keeps_video():
  src = str(FIXTURES / "sample_10s.mp4")
  out = str(TMP / "natural.mp4")
  if os.path.exists(out): os.unlink(out)
  apply_look(src, out, "natural")
  assert os.path.exists(out)


def test_apply_cinematic():
  src = str(FIXTURES / "sample_10s.mp4")
  out = str(TMP / "cinematic.mp4")
  if os.path.exists(out): os.unlink(out)
  apply_look(src, out, "cinematic")
  assert os.path.exists(out)


def test_apply_bw():
  src = str(FIXTURES / "sample_10s.mp4")
  out = str(TMP / "bw.mp4")
  if os.path.exists(out): os.unlink(out)
  apply_look(src, out, "bw")
  assert os.path.exists(out)


def test_apply_warm():
  src = str(FIXTURES / "sample_10s.mp4")
  out = str(TMP / "warm.mp4")
  if os.path.exists(out): os.unlink(out)
  apply_look(src, out, "warm")
  assert os.path.exists(out)


def test_apply_all_looks_succeed():
  src = str(FIXTURES / "sample_10s.mp4")
  for name in LOOKS.keys():
    out = str(TMP / f"all_{name}.mp4")
    if os.path.exists(out): os.unlink(out)
    apply_look(src, out, name)
    assert os.path.exists(out), f"failed: {name}"


def test_apply_unknown_look_raises():
  with pytest.raises(FFmpegError):
    apply_look("x.mp4", "y.mp4", "nonexistent_look")


def test_apply_with_look_object():
  src = str(FIXTURES / "sample_10s.mp4")
  out = str(TMP / "custom_look.mp4")
  if os.path.exists(out): os.unlink(out)
  custom = Look(name="custom", description="test", contrast=1.1, saturation=0.9)
  apply_look(src, out, custom)
  assert os.path.exists(out)


# ---------- apply_lut ----------

def test_apply_lut_missing_file_raises():
  with pytest.raises(FFmpegError):
    apply_lut("x.mp4", "y.mp4", "C:/nonexistent/lut.cube")


# ---------- list_looks ----------

def test_list_looks_returns_all():
  looks = list_looks()
  assert len(looks) == len(LOOKS)
  for entry in looks:
    assert "name" in entry
    assert "description" in entry
