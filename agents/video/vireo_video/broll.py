"""B-roll insertion: search + download stock videos from Pexels.

Pexels API (https://www.pexels.com/api/) provides:
  - Free, attribution-required stock videos
  - Search by keyword
  - Multiple resolutions per video
  - Direct download URLs

Why Pexels (not Getty/iStock):
  - Free API (no per-download cost)
  - Permissive license (no attribution required in the video itself)
  - Good for low-budget solo founders

How the insertion works:
  1. Given a transcript segment (text), search Pexels for matching videos
  2. Pick the best match (shortest, most relevant, landscape for 16:9 etc)
  3. Download the video
  4. Cut it to the segment duration
  5. Insert into the timeline (replacing or overlaying the original footage)
  6. Audio stays from the original speaker (B-roll is visual only)
"""

from __future__ import annotations
import json
import os
import re
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Optional
import requests


PEXELS_API_URL = "https://api.pexels.com/videos"


class BrollError(RuntimeError):
  def __init__(self, message: str, status: int = 0, code: str | None = None):
    super().__init__(message)
    self.status = status
    self.code = code


@dataclass
class BrollClip:
  """A stock video clip from Pexels."""
  id: int
  url: str           # Pexels page URL
  duration_sec: float
  width: int
  height: int
  download_url: str  # direct download URL (HD)
  thumbnail_url: str = ""
  user: str = ""     # photographer credit (attribution)
  query: str = ""    # the search term that found it
  local_path: str = ""  # populated after download

  def to_dict(self) -> dict:
    return asdict(self)


@dataclass
class BrollMatch:
  """A matched B-roll for a transcript segment."""
  segment_start: float
  segment_end: float
  segment_text: str
  query: str
  clip: BrollClip | None = None
  downloaded: bool = False

  def to_dict(self) -> dict:
    return {
      "segment_start": self.segment_start,
      "segment_end": self.segment_end,
      "segment_text": self.segment_text,
      "query": self.query,
      "clip": self.clip.to_dict() if self.clip else None,
      "downloaded": self.downloaded,
    }


# Common "boring" words to filter out of search queries
STOPWORDS_BROLL = {
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "and", "or", "but", "if", "then", "so", "as", "of", "in", "on", "at",
  "to", "for", "from", "by", "with", "this", "that", "these", "those",
  "it", "its", "i", "you", "he", "she", "we", "they", "me", "him", "her",
  "us", "them", "my", "your", "his", "our", "their", "have", "has", "had",
  "do", "does", "did", "will", "would", "should", "could", "can", "may",
  "might", "must", "shall", "very", "really", "actually", "just", "like",
  "um", "uh", "yeah", "ok", "okay", "so", "well", "now", "today",
}


def extract_query(text: str, max_words: int = 3) -> str:
  """Extract a 1-3 word search query from a transcript segment.

  Strategy: pick the most "noun-like" words (longer words, not stopwords).
  Falls back to first non-stopword.
  """
  words = re.findall(r"\b[a-zA-Z]{3,}\b", text)
  candidates = [w for w in words if w.lower() not in STOPWORDS_BROLL]
  if not candidates:
    return text.split()[0] if text.split() else ""
  # Prefer longer words (likely nouns/verbs with content)
  candidates.sort(key=lambda w: -len(w))
  return " ".join(candidates[:max_words])


class PexelsClient:
  """Pexels API client for video search + download."""

  def __init__(self, *, api_key: str | None = None, transport=None):
    self.api_key = api_key or os.environ.get("PEXELS_API_KEY")
    self.transport = transport or self._default_transport

  def _default_transport(self, method, url, *, params=None, headers=None, timeout=30):
    return requests.request(method, url, params=params, headers=headers, timeout=timeout)

  def _headers(self) -> dict:
    if not self.api_key:
      raise BrollError("PEXELS_API_KEY not set", 0, "config_missing")
    return {"Authorization": str(self.api_key)}

  def search_videos(
    self,
    query: str,
    *,
    per_page: int = 5,
    orientation: str | None = None,
    min_duration: float | None = None,
    max_duration: float | None = None,
  ) -> list[BrollClip]:
    """Search Pexels for videos matching the query.

    orientation: "landscape" | "portrait" | "square" | None (any)
    min/max_duration: filter by length in seconds
    """
    if not query or not query.strip():
      return []
    params: dict[str, Any] = {"query": query, "per_page": per_page}
    if orientation:
      params["orientation"] = orientation
    try:
      resp = self.transport("GET", f"{PEXELS_API_URL}/search",
                            params=params, headers=self._headers(), timeout=30)
    except Exception as e:
      raise BrollError(f"pexels search failed: {e}", 0, "network")
    if resp.status_code == 401:
      raise BrollError("pexels API key invalid", resp.status_code, "auth_error")
    if resp.status_code == 429:
      raise BrollError("pexels rate limit hit", resp.status_code, "rate_limit")
    if resp.status_code != 200:
      raise BrollError(f"pexels error: status {resp.status_code}",
                       resp.status_code, "api_error")
    try:
      data = resp.json()
    except json.JSONDecodeError as e:
      raise BrollError(f"pexels returned non-JSON: {e}", resp.status_code, "bad_response")
    clips: list[BrollClip] = []
    for v in data.get("videos", []) or []:
      dur = float(v.get("duration", 0) or 0)
      if min_duration and dur < min_duration:
        continue
      if max_duration and dur > max_duration:
        continue
      # Pick best video file (HD, mp4 preferred)
      best_file = _pick_best_file(v.get("video_files", []) or [])
      if not best_file:
        continue
      clips.append(BrollClip(
        id=int(v.get("id", 0)),
        url=v.get("url", ""),
        duration_sec=dur,
        width=int(best_file.get("width", 0) or 0),
        height=int(best_file.get("height", 0) or 0),
        download_url=best_file.get("link", ""),
        thumbnail_url=(v.get("image") or ""),
        user=(v.get("user") or {}).get("name", ""),
        query=query,
      ))
    return clips

  def download(self, clip: BrollClip, output_path: str, *, timeout: float = 120) -> str:
    """Download a clip's video file to disk."""
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    try:
      with requests.get(clip.download_url, stream=True, timeout=timeout) as r:
        r.raise_for_status()
        with open(output_path, "wb") as f:
          for chunk in r.iter_content(chunk_size=8192):
            f.write(chunk)
    except Exception as e:
      raise BrollError(f"download failed: {e}", 0, "download_failed")
    clip.local_path = output_path
    return output_path


def _pick_best_file(files: list[dict]) -> dict | None:
  """Pick the best video file from Pexels' video_files list.

  Prefer:
    1. mp4 codec
    2. HD resolution (1280x720 or 1920x1080)
    3. Reasonable file size (<50MB)
  """
  if not files:
    return None
  candidates = [f for f in files if f.get("link") and f.get("width", 0) > 0]
  if not candidates:
    return None
  # Prefer HD
  hd = [f for f in candidates if 1280 <= f.get("width", 0) <= 1920]
  pool = hd or candidates
  # Prefer mp4
  mp4s = [f for f in pool if "mp4" in (f.get("file_type") or f.get("link", "")).lower()]
  return mp4s[0] if mp4s else pool[0]


class BrollInserter:
  """Searches for and inserts B-roll into a video.

  The insertion strategy:
    1. Pick N segments from the transcript (longest, most "visual" words)
    2. For each, search Pexels and pick the top match
    3. Cut the B-roll clip to the segment's duration
    4. Overlay: composite the B-roll on top of the original (PiP style)
       OR Replace: substitute the source's visual with the B-roll (audio stays)
    5. Concat all segments
  """

  def __init__(self, pexels: PexelsClient, *, strategy: str = "replace",
               download_dir: str = "./tmp_broll"):
    self.pexels = pexels
    self.strategy = strategy  # "replace" | "overlay"
    self.download_dir = Path(download_dir)
    self.download_dir.mkdir(parents=True, exist_ok=True)

  def select_segments(self, transcript, *, max_segments: int = 3) -> list[BrollMatch]:
    """Pick the best N transcript segments for B-roll replacement.

    Heuristic: prefer segments with "visual" keywords (places, actions, objects).
    """
    visual_hints = {
      "place", "location", "city", "country", "world", "house", "home", "office",
      "room", "street", "mountain", "ocean", "forest", "park", "school", "store",
      "look", "see", "show", "watch", "imagine", "picture", "scene", "view",
      "money", "computer", "phone", "car", "food", "work", "build", "run",
    }
    candidates: list[tuple[float, int, Any]] = []
    for i, seg in enumerate(transcript.segments):
      if seg.duration < 3 or seg.duration > 30:
        continue
      text_lower = seg.text.lower()
      score = sum(1 for w in visual_hints if w in text_lower)
      score += seg.duration / 30.0  # slight preference for longer
      candidates.append((score, i, seg))
    candidates.sort(key=lambda x: -x[0])
    selected: list[BrollMatch] = []
    for _, i, seg in candidates[:max_segments]:
      query = extract_query(seg.text)
      if not query:
        continue
      selected.append(BrollMatch(
        segment_start=seg.start,
        segment_end=seg.end,
        segment_text=seg.text,
        query=query,
      ))
    return selected

  def fetch_for_matches(self, matches: list[BrollMatch], *,
                        orientation: str = "landscape",
                        min_duration: float = 3,
                        max_duration: float = 30) -> list[BrollMatch]:
    """Search Pexels for each match and download the top result."""
    out: list[BrollMatch] = []
    for m in matches:
      try:
        clips = self.pexels.search_videos(
          m.query,
          per_page=3,
          orientation=orientation,
          min_duration=min_duration,
          max_duration=max_duration,
        )
        if not clips:
          out.append(m)
          continue
        # Prefer clip closest to the segment duration
        target_dur = m.segment_end - m.segment_start
        clips.sort(key=lambda c: abs(c.duration_sec - target_dur))
        chosen = clips[0]
        # Download
        local = self.download_dir / f"broll_{chosen.id}.mp4"
        if not local.exists():
          self.pexels.download(chosen, str(local))
        m.clip = chosen
        m.downloaded = True
      except BrollError as e:
        # Don't fail the whole pipeline; just skip this segment
        pass
      out.append(m)
    return out
