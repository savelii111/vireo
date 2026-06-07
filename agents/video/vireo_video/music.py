"""Background music: add a track under the source audio with auto-ducking.

Workflow:
  1. Load a music file (mp3, wav, ogg, etc.) and the source video
  2. Loop the music to match the source duration (or trim if longer)
  3. Mix at a low base volume (e.g. 15% of full)
  4. Auto-duck: when the speaker is talking, drop the music volume even more
     (e.g. 5%); when the speaker pauses, bring it back up
  5. Output a new video with both tracks mixed

Auto-ducking strategy (no ML):
  - Use the source audio's envelope to detect speech
  - When the envelope is above a threshold (someone is talking), lower music
  - When below threshold (silence), raise music
  - Smooth the ducking with attack/release time constants

Why this matters for the user:
  - Pure raw speaker audio is monotonous — music adds engagement
  - Music ducked under speech is the standard for podcasts and YouTube
  - Without ducking, music + speech = muddy, can't hear the words
"""

from __future__ import annotations
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path

from .ffmpeg_utils import find_ffmpeg, run, FFmpegError


@dataclass
class DuckConfig:
  base_volume: float = 0.20       # music volume when speaker is silent
  duck_volume: float = 0.06       # music volume when speaker is talking
  threshold_db: float = -30.0     # speech detection threshold
  attack_ms: int = 200            # how fast to duck when speech starts
  release_ms: int = 800           # how slow to un-duck when speech ends


def get_duration(path: str) -> float:
  from .ffmpeg_utils import probe
  return float(probe(path).get("duration_sec", 0) or 0)


def loop_music_to_duration(
  music_path: str,
  target_duration: float,
  output_path: str,
  *,
  ffmpeg: str | None = None,
) -> str:
  """Loop a music track to exactly match the target duration.

  Uses the `-stream_loop` flag (much simpler than aloop filter) to loop the
  input, then trims with `-t` to be exactly target_duration.
  Output codec is chosen by extension: .mp3 -> libmp3lame, otherwise aac.
  """
  binary = find_ffmpeg(ffmpeg)
  ext = Path(output_path).suffix.lower()
  codec = "libmp3lame" if ext == ".mp3" else "aac"
  music_dur = get_duration(music_path)
  if music_dur <= 0:
    music_dur = 1.0
  # Number of full loops needed (with +1 safety margin for short clips)
  num_loops = max(1, int(target_duration / music_dur) + 1)
  # -stream_loop N: loop the input N times before EOF
  # -t: stop after target_duration
  args = [
    binary, "-y", "-stream_loop", str(num_loops), "-i", music_path,
    "-t", f"{target_duration}",
    "-c:a", codec, "-b:a", "192k",
    output_path,
  ]
  run(args, timeout=600)
  return output_path


def add_background_music(
  video_path: str,
  music_path: str,
  output_path: str,
  *,
  duck: DuckConfig | None = None,
  music_volume: float = 0.20,     # base volume (overrides duck.base_volume if provided)
  ffmpeg: str | None = None,
  video_bitrate: str = "5000k",
) -> str:
  """Mix a music track under the source video's audio with auto-ducking.

  Args:
    video_path: source video (has speech audio)
    music_path: background music file
    output_path: result file
    duck: DuckConfig with auto-duck settings (or None for no ducking)
    music_volume: base music volume when no ducking (0..1)
  """
  if not Path(video_path).is_file():
    raise FFmpegError(f"video not found: {video_path}", 0)
  if not Path(music_path).is_file():
    raise FFmpegError(f"music not found: {music_path}", 0)

  cfg = duck or DuckConfig(base_volume=music_volume)
  base_v = cfg.base_volume
  duck_v = cfg.duck_volume

  video_dur = get_duration(video_path)
  if video_dur <= 0:
    raise FFmpegError("could not determine video duration", 0)

  # Strategy: load music, loop to video duration, then mix with sidechain compression
  # so the music volume drops when the speech (source) is loud.
  binary = find_ffmpeg(ffmpeg)

  if cfg is None or (base_v == 1.0 and duck_v == 1.0):
    # No ducking: simple amix
    filter_complex = (
      f"[0:a]aresample=async=1[va];"
      f"[1:a]volume={music_volume}[ma];"
      f"[va][ma]amix=inputs=2:duration=first:dropout_transition=0[aout]"
    )
  else:
    # With ducking: sidechain compression of the music by the voice
    threshold_db = cfg.threshold_db
    attack_ms = cfg.attack_ms
    release_ms = cfg.release_ms
    # Music volume scaled by base_v. The sidechain then reduces it further.
    filter_complex = (
      f"[0:a]aresample=async=1[va];"
      f"[1:a]volume={base_v}[ma];"
      # Sidechain compression: when [va] (speech) is loud, reduce [ma] (music)
      f"[ma][va]sidechaincompress=threshold={threshold_db}dB:ratio=8:attack={attack_ms}:release={release_ms}:makeup=1[mducked];"
      f"[va][mducked]amix=inputs=2:duration=first:dropout_transition=0[aout]"
    )

  # Use -stream_loop to loop the music to match the video duration
  music_dur = get_duration(music_path)
  if music_dur <= 0:
    music_dur = 1.0
  num_loops = max(1, int(video_dur / music_dur) + 1)

  args = [
    binary, "-y",
    "-i", video_path,
    "-stream_loop", str(num_loops), "-i", music_path,
    "-filter_complex", filter_complex,
    "-map", "0:v", "-map", "[aout]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-b:v", video_bitrate, "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k",
    "-shortest",
    output_path,
  ]
  run(args, timeout=900)
  return output_path


def mix_music_only(
  video_path: str,
  music_path: str,
  output_path: str,
  *,
  music_volume: float = 0.15,
  ffmpeg: str | None = None,
  video_bitrate: str = "5000k",
) -> str:
  """Replace the source audio with music only (no speech).

  Useful for "music only" reels, lyric videos, or when the user wants
  just a mood piece.
  """
  binary = find_ffmpeg(ffmpeg)
  video_dur = get_duration(video_path)
  music_dur = get_duration(music_path)
  if music_dur <= 0:
    music_dur = 1.0
  num_loops = max(1, int(video_dur / music_dur) + 1)
  args = [
    binary, "-y",
    "-i", video_path,
    "-stream_loop", str(num_loops), "-i", music_path,
    "-filter_complex",
    f"[1:a]volume={music_volume}[aout]",
    "-map", "0:v", "-map", "[aout]",
    "-c:v", "copy",
    "-c:a", "aac", "-b:a", "192k",
    "-shortest",
    output_path,
  ]
  run(args, timeout=600)
  return output_path
