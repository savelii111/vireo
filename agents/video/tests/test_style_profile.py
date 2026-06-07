"""Tests for style_profile.py — StyleProfile aggregation and persistence."""

import json
import pytest
from pathlib import Path
from vireo_video.style_profile import (
  StyleProfile, profile_from_video, profile_from_videos, merge_profiles,
  save_profile, load_profile, profile_to_summary, _profile_from_visual_audio,
)
from vireo_video.style_analyzer import VisualStyle
from vireo_video.audio_analyzer import AudioStyle
from vireo_video.transcriber import Transcript, Segment, Word

FIXTURES = Path(__file__).parent / "fixtures"
TMP = Path(__file__).parent / "tmp_profile"


@pytest.fixture(scope="module", autouse=True)
def setup_tmp():
  TMP.mkdir(exist_ok=True)
  yield


# ---------- StyleProfile dataclass ----------

def test_profile_defaults():
  p = StyleProfile()
  assert p.name == "default"
  assert p.brightness == 0.5
  assert p.saturation == 0.5
  assert p.recommended_look == "natural"
  assert p.confidence == 0.5


def test_profile_to_dict_roundtrips():
  p = StyleProfile(name="test", brightness=0.7)
  d = p.to_dict()
  p2 = StyleProfile(**d)
  assert p2.name == "test"
  assert p2.brightness == 0.7


def test_profile_to_summary_returns_string():
  p = StyleProfile(name="x", recommended_look="warm", num_reference_videos=2)
  s = profile_to_summary(p)
  assert "Style 'x'" in s
  assert "warm" in s
  assert "2 video" in s


# ---------- _profile_from_visual_audio ----------

def test_profile_from_visual_audio_basic():
  v = VisualStyle(brightness=0.4, saturation=0.5, contrast=0.6, temperature=0.2,
                  recommended_look="warm", confidence=0.7)
  a = AudioStyle(mean_volume_db=-15, music_likely=True, words_per_minute=150)
  p = _profile_from_visual_audio(v, a, num_videos=1, name="test")
  assert p.name == "test"
  assert p.brightness == 0.4
  assert p.recommended_look == "warm"
  assert p.music_likely is True
  assert p.words_per_minute == 150


def test_profile_zoom_max_scales_with_contrast():
  v_low = VisualStyle(contrast=0.2)
  v_high = VisualStyle(contrast=0.8)
  a = AudioStyle()
  p_low = _profile_from_visual_audio(v_low, a)
  p_high = _profile_from_visual_audio(v_high, a)
  # Higher contrast should allow more zoom
  assert p_high.zoom_max > p_low.zoom_max


def test_profile_emphasis_estimated_from_cuts():
  v = VisualStyle(cuts_per_minute=3.0)
  a = AudioStyle()
  p = _profile_from_visual_audio(v, a)
  # 3 cpm * 1.2 = 3.6, capped at 8
  assert 1.0 <= p.emphasis_per_minute <= 8.0


# ---------- profile_from_video ----------

def test_profile_from_video_returns_profile():
  p = profile_from_video(str(FIXTURES / "sample_10s.mp4"))
  assert p.num_reference_videos == 1
  assert 0.0 <= p.brightness <= 1.0
  assert 0.0 <= p.saturation <= 1.0


def test_profile_from_video_with_name():
  p = profile_from_video(str(FIXTURES / "sample_10s.mp4"), name="my_style")
  assert p.name == "my_style"


def test_profile_from_video_with_transcript():
  t = Transcript(
    text="hello world this is a test transcript with multiple words",
    language="en", duration=10.0,
    segments=[Segment(id=0, start=0, end=10,
                      text="hello world this is a test transcript with multiple words",
                      words=[Word("hello", 0, 0.5), Word("world", 0.5, 1.0)])],
  )
  p = profile_from_video(str(FIXTURES / "sample_10s.mp4"), transcript=t)
  # Transcript has 2 words over 10s = 12 WPM
  assert p.words_per_minute > 0


# ---------- profile_from_videos ----------

def test_profile_from_videos_empty_returns_default():
  p = profile_from_videos([])
  assert p.num_reference_videos == 0


def test_profile_from_videos_single():
  p = profile_from_videos([str(FIXTURES / "sample_10s.mp4")])
  assert p.num_reference_videos == 1


def test_profile_from_videos_multiple_uses_median():
  """Multiple videos should produce a profile with median feature values."""
  p = profile_from_videos([
    str(FIXTURES / "sample_10s.mp4"),
    str(FIXTURES / "sample_10s.mp4"),
    str(FIXTURES / "sample_10s.mp4"),
  ])
  assert p.num_reference_videos == 3
  # Confidence scales with number of videos
  assert p.confidence > 0.3


# ---------- merge_profiles ----------

def test_merge_profiles_empty():
  p = merge_profiles([])
  assert p.num_reference_videos == 0


def test_merge_profiles_single():
  p1 = StyleProfile(name="x", brightness=0.7)
  out = merge_profiles([p1])
  assert out.name == "x"
  assert out.brightness == 0.7


def test_merge_profiles_two_uses_median():
  p1 = StyleProfile(name="a", brightness=0.3, saturation=0.5)
  p2 = StyleProfile(name="b", brightness=0.7, saturation=0.5)
  out = merge_profiles([p1, p2], name="merged")
  assert out.brightness == 0.5  # median
  assert out.saturation == 0.5
  assert out.num_reference_videos == 2
  assert out.name == "merged"


def test_merge_profiles_music_majority_vote():
  p1 = StyleProfile(music_likely=True)
  p2 = StyleProfile(music_likely=True)
  p3 = StyleProfile(music_likely=False)
  out = merge_profiles([p1, p2, p3])
  assert out.music_likely is True  # 2 of 3 vote yes


def test_merge_profiles_music_split():
  p1 = StyleProfile(music_likely=True)
  p2 = StyleProfile(music_likely=False)
  out = merge_profiles([p1, p2])
  assert out.music_likely is False  # tied → default false (majority not met)


def test_merge_profiles_uses_mode_for_look():
  p1 = StyleProfile(recommended_look="cinematic")
  p2 = StyleProfile(recommended_look="cinematic")
  p3 = StyleProfile(recommended_look="warm")
  out = merge_profiles([p1, p2, p3])
  assert out.recommended_look == "cinematic"
  assert 0.6 < out.look_confidence < 0.7  # 2/3


def test_merge_profiles_collects_dominant_colors():
  p1 = StyleProfile(dominant_colors=["#ff0000", "#00ff00"])
  p2 = StyleProfile(dominant_colors=["#ff0000", "#0000ff"])
  out = merge_profiles([p1, p2])
  # Top 5 most common
  assert "#ff0000" in out.dominant_colors
  assert len(out.dominant_colors) <= 5


def test_merge_profiles_confidence_scales():
  p1 = StyleProfile()
  out1 = merge_profiles([p1])
  out3 = merge_profiles([p1, p1, p1])
  out5 = merge_profiles([p1, p1, p1, p1, p1])
  assert out1.confidence < out3.confidence < out5.confidence
  assert out5.confidence <= 0.95  # capped


# ---------- save/load ----------

def test_save_load_roundtrip(tmp_path):
  p = StyleProfile(
    name="creator_x",
    brightness=0.6,
    saturation=0.4,
    recommended_look="cinematic",
    dominant_colors=["#ff8800", "#221100"],
    cuts_per_minute=3.5,
    music_likely=True,
  )
  out = tmp_path / "profile.json"
  save_profile(p, str(out))
  assert out.exists()

  p2 = load_profile(str(out))
  assert p2.name == "creator_x"
  assert p2.brightness == 0.6
  assert p2.saturation == 0.4
  assert p2.recommended_look == "cinematic"
  assert p2.dominant_colors == ["#ff8800", "#221100"]
  assert p2.cuts_per_minute == 3.5
  assert p2.music_likely is True


def test_save_creates_parent_dirs(tmp_path):
  p = StyleProfile()
  out = tmp_path / "nested" / "dir" / "profile.json"
  save_profile(p, str(out))
  assert out.exists()


def test_save_load_preserves_all_fields(tmp_path):
  p = StyleProfile(
    name="full",
    num_reference_videos=5,
    brightness=0.3, saturation=0.4, contrast=0.5, temperature=0.1,
    recommended_look="cinematic", look_confidence=0.8,
    dominant_colors=["#aaa", "#bbb", "#ccc"],
    cuts_per_minute=4.0, avg_shot_length_sec=15.0,
    mean_volume_db=-18.0, music_likely=True, silence_ratio=0.2,
    words_per_minute=140.0, emphasis_per_minute=3.5, zoom_max=1.3,
    subtitle_style="tiktok", confidence=0.85,
    preferences={"test": True},
  )
  out = tmp_path / "full.json"
  save_profile(p, str(out))
  p2 = load_profile(str(out))
  assert p2.to_dict() == p.to_dict()
