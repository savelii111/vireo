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


def test_apply_lut_empty_path_raises(monkeypatch, tmp_path):
  """Day 2 W1: empty path must reject before touching the filesystem."""
  monkeypatch.setenv("VIREO_LUT_DIR", str(tmp_path))
  with pytest.raises(FFmpegError, match="non-empty string"):
    apply_lut("x.mp4", "y.mp4", "")


def test_apply_lut_non_cube_extension_raises(monkeypatch, tmp_path):
  """Day 2 W1: only .cube files are accepted — anything else is rejected
  even if the path resolves. Stops attackers from pointing us at /etc/shadow
  by abusing ffmpeg's permissive filter graph parser."""
  monkeypatch.setenv("VIREO_LUT_DIR", str(tmp_path))
  (tmp_path / "evil.txt").write_text("not a lut")
  with pytest.raises(FFmpegError, match="must end with .cube"):
    apply_lut("x.mp4", "y.mp4", str(tmp_path / "evil.txt"))


def test_apply_lut_path_traversal_raises(monkeypatch, tmp_path):
  """Day 2 W1: a real .cube file OUTSIDE VIREO_LUT_DIR must be rejected.
  This is the CVE we'd otherwise ship — `../../etc/passwd.cube` (or worse,
  a planted malicious .cube elsewhere on the box) must not be loadable."""
  monkeypatch.setenv("VIREO_LUT_DIR", str(tmp_path / "luts"))
  (tmp_path / "luts").mkdir()
  # Create a sibling directory at tmp_path/../ which will exist after resolve.
  sibling = tmp_path.parent / (tmp_path.name + "_attacker")
  sibling.mkdir(exist_ok=True)
  outside = sibling / "attacker.cube"
  outside.write_text("LUT_3D_SIZE 2\n0 0 0\n1 1 1\n")
  # Build a path that resolves to `outside` but traverses the relative
  # path through tmp_path (NOT through tmp_path/luts, the allowed dir).
  traversal = str(tmp_path / ".." / (tmp_path.name + "_attacker") / "attacker.cube")
  try:
    with pytest.raises(FFmpegError, match="escapes allowed directory"):
      apply_lut("x.mp4", "y.mp4", traversal)
  finally:
    outside.unlink(missing_ok=True)
    sibling.rmdir()


def test_apply_lut_inside_allowed_dir_passes_resolution(monkeypatch, tmp_path):
  """Day 2 W1: a .cube file inside VIREO_LUT_DIR must resolve cleanly.
  We don't actually run ffmpeg — we just check the pre-flight validation
  doesn't reject it. (A real ffmpeg run would need a video fixture.)"""
  monkeypatch.setenv("VIREO_LUT_DIR", str(tmp_path))
  good = tmp_path / "ok.cube"
  good.write_text("LUT_3D_SIZE 2\n0 0 0\n1 1 1\n")
  # We mock apply_look so we don't need ffmpeg; the point is that the
  # path-resolution and allow-list checks don't reject this.
  from vireo_video import color as _color_mod
  monkeypatch.setattr(_color_mod, "apply_look", lambda *a, **kw: "ok")
  out = apply_lut("x.mp4", "y.mp4", str(good))
  assert out == "ok"


# ---------- list_looks ----------

def test_list_looks_returns_all():
  looks = list_looks()
  assert len(looks) == len(LOOKS)
  for entry in looks:
    assert "name" in entry
    assert "description" in entry
