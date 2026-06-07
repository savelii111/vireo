"""Tests for per-platform presets."""

import pytest
from vireo_video.presets import (
  PRESETS, get_preset, list_platforms, parse_aspect, aspect_decimal,
  DEFAULT,
)


def test_all_platforms_have_preset():
  ps = list_platforms()
  # 10 platforms
  assert len(ps) >= 10
  for p in ("youtube", "youtube_shorts", "tiktok", "instagram_reels",
            "instagram", "x", "linkedin", "threads", "telegram", "substack"):
    assert p in ps, f"missing preset for {p}"


def test_preset_aspect_matches_dimensions():
  for name, p in PRESETS.items():
    aw, ah = p.width, p.height
    ta_w, ta_h = map(int, p.aspect.split(":"))
    # Tolerance: rounding can shift by 1-2 px
    ratio = aw / ah
    expected = ta_w / ta_h
    assert abs(ratio - expected) < 0.01, (
      f"{name}: aspect {p.aspect} but dims {aw}x{ah} (ratio {ratio:.3f} vs {expected:.3f})"
    )


def test_preset_short_caps_at_60s():
  for p in ("youtube_shorts",):
    assert PRESETS[p].max_duration_sec == 60


def test_preset_youtube_long_form_has_high_bitrate():
  assert PRESETS["youtube"].video_bitrate in ("8000k", "10000k")


def test_preset_to_ffmpeg_args_includes_faststart():
  args = PRESETS["youtube"].to_ffmpeg_args()
  assert "-movflags" in args
  idx = args.index("-movflags")
  assert "+faststart" in args[idx + 1]


def test_preset_to_ffmpeg_args_includes_video_audio_codecs():
  args = PRESETS["tiktok"].to_ffmpeg_args()
  assert "-c:v" in args and "libx264" in args
  assert "-c:a" in args and "aac" in args
  assert "-b:v" in args
  assert "-b:a" in args


def test_get_preset_unknown_returns_default():
  p = get_preset("nonexistent_platform_xyz")
  assert p.platform == DEFAULT.platform


def test_parse_aspect_valid():
  assert parse_aspect("16:9") == (16, 9)
  assert parse_aspect("9:16") == (9, 16)
  assert parse_aspect("1:1") == (1, 1)
  assert parse_aspect("4:5") == (4, 5)


def test_parse_aspect_invalid_raises():
  with pytest.raises(ValueError):
    parse_aspect("169")
  with pytest.raises(ValueError):
    parse_aspect("16/9")
  with pytest.raises(ValueError):
    parse_aspect("")


def test_aspect_decimal():
  assert abs(aspect_decimal("16:9") - 16 / 9) < 1e-9
  assert abs(aspect_decimal("9:16") - 9 / 16) < 1e-9
  assert aspect_decimal("1:1") == 1.0


def test_preset_to_dict_serializable():
  d = PRESETS["youtube_shorts"].to_dict()
  assert d["platform"] == "youtube_shorts"
  assert d["width"] == 1080
  assert d["height"] == 1920
  assert d["aspect"] == "9:16"
