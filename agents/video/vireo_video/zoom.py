"""Auto-zoom on emphasis words.

Detects "emphasis" moments in a transcript (key words, all-caps, exclamation,
questions, slow speech) and produces a keyframed crop that zooms in on the
speaker's face area during those moments.

Why it matters:
  - TikTok/Reels viewers expect movement — a static frame loses attention
  - A subtle 1.15-1.3x zoom on a punchline word makes the moment feel "punchy"
  - Cheap to compute (no ML — pure heuristic on transcript) and cheap to render

How it works:
  1. For each word, compute an "emphasis score" based on:
     - POSITION (sentence-initial or sentence-final)
     - PUNCTUATION (exclamation, question marks before/after)
     - DURATION (longer-than-average duration = emphasis)
     - WORD TYPE (adjective, verb — heuristic on common emphasis words)
     - PRIOR PAUSE (>0.5s pause before = the speaker is about to say something big)
  2. Build a list of emphasis windows: [start, end, zoom_factor] around top-N moments
  3. Render via the reframe_with_pan mechanism (cut at boundaries, zoom in/out)

This intentionally avoids the complexity of ffmpeg's sendcmd (which has
fragile cross-platform file parsing) by re-using the segment-based approach
from reframe.py.
"""

from __future__ import annotations
import re
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Optional

from .transcriber import Transcript, Word, Segment
from .reframe import reframe, CropBox
from .cutter import cut_segments, CutRange, trim, concat
from .ffmpeg_utils import find_ffmpeg, run, probe, FFmpegError


# Common words that often signal emphasis (English + Russian)
EMPHASIS_WORDS = {
  # English
  "never", "always", "must", "should", "can't", "cannot", "won't", "don't",
  "secret", "huge", "massive", "tiny", "best", "worst", "first", "last",
  "important", "critical", "key", "main", "biggest", "smallest", "fastest",
  "slowest", "ultimate", "amazing", "terrible", "perfect", "broken",
  "free", "easy", "hard", "simple", "impossible", "actually", "literally",
  "everybody", "nobody", "everything", "nothing", "everyone", "no one",
  "now", "today", "tomorrow", "yesterday", "always", "never",
  # Russian
  "никогда", "всегда", "сейчас", "главный", "важно", "важнейший",
  "самый", "огромный", "маленький", "лучший", "худший", "первый",
  "последний", "секрет", "только", "именно", "просто", "буквально",
  "невозможно", "обязательно", "реально", "вообще", "на самом деле",
  "бесплатно", "легко", "сложно", "просто", "все", "никто", "ничего",
  "всё", "сегодня", "завтра", "вчера", "прямо",
}

# Words that are unlikely to be emphasis by themselves (function words, articles)
STOPWORDS = {
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "and", "or", "but", "if", "then", "so", "as", "of", "in", "on", "at",
  "to", "for", "from", "by", "with", "this", "that", "these", "those",
  "it", "its", "i", "you", "he", "she", "we", "they", "me", "him", "her",
  "us", "them", "my", "your", "his", "our", "their",
}


@dataclass
class EmphasisWindow:
  """A time range with a zoom level."""
  start: float
  end: float
  zoom: float
  word: str = ""
  score: float = 0.0
  reason: str = ""

  @property
  def duration(self) -> float:
    return self.end - self.start

  def to_dict(self) -> dict:
    return asdict(self)


def _word_duration(w: Word) -> float:
  return max(0.0, w.end - w.start)


def _is_emphasis_word(w: Word) -> bool:
  return w.text.lower().strip(".,!?;:") in EMPHASIS_WORDS


def _is_stopword(w: Word) -> bool:
  return w.text.lower().strip(".,!?;:") in STOPWORDS


def score_word(w: Word, prev: Word | None, next_: Word | None, avg_dur: float) -> tuple[float, str]:
  """Return (score, reason) for a single word.

  Score components:
    - emphasis word: +3.0
    - long duration (>2x avg): +1.5
    - preceded by long pause (>0.5s): +1.0
    - followed by punctuation: +1.0
    - in CAPS (>3 letters): +1.5
  """
  score = 0.0
  reasons: list[str] = []

  if _is_emphasis_word(w):
    score += 3.0
    reasons.append("emphasis_word")

  dur = _word_duration(w)
  if avg_dur > 0 and dur > 2 * avg_dur:
    score += 1.5
    reasons.append("long_duration")

  if prev is not None:
    gap = w.start - prev.end
    if gap > 0.5:
      score += 1.0
      reasons.append("after_pause")

  if next_ is not None:
    if next_.text.rstrip().endswith(("!", "?", "...")) or "!" in next_.text or "?" in next_.text:
      score += 1.0
      reasons.append("before_punct")
  if w.text.rstrip().endswith(("!", "?", "...")):
    score += 0.5
    reasons.append("trailing_punct")

  if len(w.text) > 3 and w.text.upper() == w.text and any(c.isalpha() for c in w.text):
    score += 1.5
    reasons.append("all_caps")

  return (score, ",".join(reasons) if reasons else "base")


def find_emphasis_windows(
  transcript: Transcript,
  *,
  max_windows: int = 6,
  min_gap_sec: float = 2.0,
  min_window_sec: float = 0.6,
  max_window_sec: float = 2.0,
  zoom_min: float = 1.10,
  zoom_max: float = 1.35,
) -> list[EmphasisWindow]:
  """Find moments in the transcript that should be zoomed in on.

  Args:
    max_windows: how many zoom-in moments to suggest total
    min_gap_sec: minimum gap between two zoom windows (avoid stacking zooms)
    min_window_sec: shortest allowed window (avoids flicker)
    max_window_sec: longest allowed window (keeps the zoom punchy)
    zoom_min/zoom_max: zoom level range; 1.0 = no zoom, 1.5 = 50% in

  Returns: list of EmphasisWindow sorted by time.
  """
  all_words: list[Word] = []
  for seg in transcript.segments:
    if seg.words:
      all_words.extend(seg.words)
    else:
      # No word timestamps: synthesize evenly-spaced words
      dur = seg.end - seg.start
      ws = seg.text.split()
      if not ws:
        continue
      for i, txt in enumerate(ws):
        all_words.append(Word(
          text=txt,
          start=seg.start + (dur * i / len(ws)),
          end=seg.start + (dur * (i + 1) / len(ws)),
        ))

  if len(all_words) < 2:
    return []

  # Average word duration (proxy for "normal" pace)
  durations = [_word_duration(w) for w in all_words if _word_duration(w) > 0]
  avg_dur = sum(durations) / len(durations) if durations else 0.3

  # Score every word
  scored: list[tuple[float, Word, str]] = []
  for i, w in enumerate(all_words):
    if _is_stopword(w):
      continue
    s, reason = score_word(w, all_words[i - 1] if i > 0 else None,
                           all_words[i + 1] if i < len(all_words) - 1 else None,
                           avg_dur)
    if s > 0:
      scored.append((s, w, reason))

  # Sort by score, take top N, then enforce min_gap
  scored.sort(key=lambda x: -x[0])
  chosen: list[tuple[float, Word, str]] = []
  for s, w, reason in scored:
    if len(chosen) >= max_windows:
      break
    # Enforce min_gap from already-chosen windows
    if any(abs(w.start - c[1].start) < min_gap_sec for c in chosen):
      continue
    chosen.append((s, w, reason))

  # Build windows
  windows: list[EmphasisWindow] = []
  for s, w, reason in chosen:
    # Window: from a bit before the word to a bit after
    pre = min(0.4, (w.end - w.start) * 0.5)
    post = min(0.6, (w.end - w.start) * 1.5)
    win_start = max(0.0, w.start - pre)
    win_end = w.end + post
    # Clamp duration
    if win_end - win_start > max_window_sec:
      win_end = win_start + max_window_sec
    if win_end - win_start < min_window_sec:
      win_end = win_start + min_window_sec
    # Map score (0..7) to zoom (zoom_min..zoom_max)
    score_norm = min(1.0, s / 7.0)
    zoom = zoom_min + (zoom_max - zoom_min) * score_norm
    windows.append(EmphasisWindow(
      start=win_start, end=win_end, zoom=zoom,
      word=w.text, score=s, reason=reason,
    ))

  windows.sort(key=lambda w: w.start)
  return windows


def apply_zoom(
  input_path: str,
  output_path: str,
  windows: list[EmphasisWindow],
  *,
  target_aspect: str = "9:16",
  output_width: int = 1080,
  output_height: int = 1920,
  ffmpeg: str | None = None,
  video_bitrate: str = "5000k",
  audio_bitrate: str = "128k",
  fps: int = 30,
) -> str:
  """Apply emphasis zooms to a video.

  Splits the video into segments at zoom boundaries, applies a different
  crop/zoom to each, then concats. The "before first zoom" and "after last
  zoom" segments use 1.0x zoom (no crop).

  Zoom math:
    zoom = 1.0 means full-frame (no crop)
    zoom = 1.3 means we crop to 1/1.3 = ~77% of width/height, then scale to output
  """
  if not windows:
    # No zooms — just reframe (center crop)
    from .reframe import reframe as reframe_fn
    return reframe_fn(
      input_path, output_path,
      target_aspect=target_aspect,
      output_width=output_width, output_height=output_height,
      ffmpeg=ffmpeg, video_bitrate=video_bitrate, audio_bitrate=audio_bitrate, fps=fps,
    )

  info = probe(input_path)
  sw, sh = info.get("width", 0), info.get("height", 0)
  if not sw or not sh:
    raise FFmpegError("source has no dimensions", 0)
  total = info.get("duration_sec", 0)

  # Compute the "base" crop (the largest crop needed for any zoom)
  max_zoom = max(w.zoom for w in windows)
  from .reframe import compute_center_crop
  base_box = compute_center_crop(sw, sh, target_aspect)

  # The crop dimensions: smaller box for bigger zoom
  # crop_w = base_w / zoom
  # We always keep the output dimensions, but crop tighter for higher zoom.
  def crop_for_zoom(zoom: float) -> CropBox:
    if zoom <= 1.001:
      return base_box
    w = int(round(base_box.width / zoom))
    h = int(round(base_box.height / zoom))
    # Force even for yuv420p
    w -= w % 2
    h -= h % 2
    # Clamp to source
    w = min(w, sw)
    h = min(h, sh)
    # Center
    x = (sw - w) // 2
    y = (sh - h) // 2
    return CropBox(x=max(0, x), y=max(0, y), width=w, height=h)

  # Build segments: [start_of_first_zoom, end_of_last_zoom] for zoom segments;
  # also include pre/post at zoom 1.0.
  sorted_w = sorted(windows, key=lambda w: w.start)

  # Build segment list: (start, end, zoom)
  segments: list[tuple[float, float, float]] = []
  cursor = 0.0
  for w in sorted_w:
    if w.start > cursor:
      # Pre-zoom segment at 1.0x
      segments.append((cursor, w.start, 1.0))
    # The zoom window itself — but if it overlaps with the next zoom, merge
    if segments and abs(segments[-1][2] - 1.0) < 0.01 and segments[-1][1] > w.start:
      # We had a 1.0 segment that overlaps; extend it
      prev_start, prev_end, _ = segments.pop()
      segments.append((prev_start, w.start, 1.0))
    # Add the zoom segment (use the window's specific zoom)
    segments.append((w.start, w.end, w.zoom))
    cursor = w.end
  if cursor < total:
    segments.append((cursor, total, 1.0))

  if not segments:
    raise FFmpegError("apply_zoom: no segments built", 0)

  # Render each segment with its own crop
  tmpdir = Path(output_path).parent / "_vireo_zoom_tmp"
  tmpdir.mkdir(exist_ok=True)
  try:
    seg_paths: list[str] = []
    for i, (seg_start, seg_end, zoom) in enumerate(segments):
      if seg_end <= seg_start:
        continue
      # Trim
      trimmed = tmpdir / f"trim_{i:04d}.mp4"
      trim(input_path, str(trimmed), start=seg_start, end=seg_end, ffmpeg=ffmpeg, reencode=True)
      # Reframe with the right crop
      box = crop_for_zoom(zoom)
      reframed = tmpdir / f"ref_{i:04d}.mp4"
      reframe(
        str(trimmed), str(reframed),
        target_aspect=target_aspect,
        output_width=output_width, output_height=output_height,
        crop_box=box, ffmpeg=ffmpeg,
        video_bitrate=video_bitrate, audio_bitrate=audio_bitrate, fps=fps,
      )
      seg_paths.append(str(reframed))
    # Concat
    concat(seg_paths, output_path, ffmpeg=ffmpeg, method="filter")
  finally:
    for p in tmpdir.glob("trim_*.mp4"):
      try: p.unlink()
      except OSError: pass
    for p in tmpdir.glob("ref_*.mp4"):
      try: p.unlink()
      except OSError: pass
    try: tmpdir.rmdir()
    except OSError: pass
  return output_path
