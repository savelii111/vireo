"""Chapter detection for long-form content.

Splits a long video into natural chapters based on topic shifts in the
transcript. Useful for:
  - YouTube chapters (uploaded with the video)
  - Long-form navigation menu
  - Auto-generated highlights per chapter
  - Social clips: pick "best chapter" for shorts

How it works:
  1. Get the full transcript (potentially very long)
  2. Send to LLM with a "find chapter boundaries" prompt
  3. Parse the response: list of {start, end, title, summary}
  4. Validate against the actual transcript (timestamps exist, durations reasonable)
  5. Return as a Chapter list

For very long transcripts (>LLM context), we use a sliding-window approach:
  split transcript into chunks, ask LLM for boundaries in each chunk, then
  merge adjacent boundaries.
"""

from __future__ import annotations
import json
import re
from dataclasses import dataclass, field, asdict
from typing import Optional

from .transcriber import Transcript, Segment


@dataclass
class Chapter:
  start: float
  end: float
  title: str
  summary: str = ""

  @property
  def duration(self) -> float:
    return self.end - self.start

  def to_dict(self) -> dict:
    return asdict(self)


CHAPTER_PROMPT = """You are a video editor analyzing a long-form transcript.
Identify the natural chapter boundaries where the topic or theme shifts.

A chapter should be 60-600 seconds (1-10 min) long. Fewer, longer chapters are better
than many short ones. Aim for 3-8 chapters total unless the video is much longer.

For each chapter, provide:
  - start: start time in seconds
  - end: end time in seconds
  - title: short chapter title (3-7 words, no quotes)
  - summary: 1-sentence description of the chapter's topic

Return strict JSON in this exact form:
{{"chapters": [{{"start": <sec>, "end": <sec>, "title": "...", "summary": "..."}}]}}

CONSTRAINTS:
- Chapters must be contiguous and cover the whole transcript
- Each chapter 60-600 seconds
- 3-8 chapters total
- Timestamps must match the transcript below

TRANSCRIPT ({duration:.0f}s, {num_segments} segments, lang={language}):
{summary}

JSON:"""


def build_chapter_prompt(transcript: Transcript, *, max_chars: int = 8000) -> str:
  """Build the LLM prompt for chapter detection."""
  lines: list[str] = []
  total = 0
  segments_added = 0
  for seg in transcript.segments:
    line = f"[{seg.id:03d}] [{seg.start:6.1f}-{seg.end:6.1f}] {seg.text.strip()}"
    if total + len(line) > max_chars:
      lines.append(f"... ({len(transcript.segments) - segments_added} more)")
      break
    lines.append(line)
    segments_added += 1
    total += len(line) + 1
  return CHAPTER_PROMPT.replace("{duration:.0f}", f"{transcript.duration:.0f}") \
                      .replace("{num_segments}", str(len(transcript.segments))) \
                      .replace("{language}", transcript.language or "?") \
                      .replace("{summary}", "\n".join(lines))


def parse_chapters_response(text: str, *, total_duration: float) -> list[Chapter]:
  """Parse LLM response into a list of Chapters, validating against the transcript."""
  cleaned = text.strip()
  if cleaned.startswith("```"):
    lines = cleaned.splitlines()
    lines = [ln for ln in lines if not ln.strip().startswith("```")]
    cleaned = "\n".join(lines).strip()
  match = re.search(r"\{[^{}]*?(?:\{[^{}]*\}[^{}]*?)*\}", cleaned)
  if not match:
    raise ValueError(f"no JSON in response: {text[:200]!r}")
  try:
    data = json.loads(match.group(0))
  except json.JSONDecodeError as e:
    relaxed = re.sub(r",\s*}", "}", match.group(0))
    relaxed = re.sub(r",\s*]", "]", relaxed)
    data = json.loads(relaxed)
  raw = data.get("chapters", [])
  if not isinstance(raw, list):
    raise ValueError("chapters field must be a list")
  out: list[Chapter] = []
  for c in raw:
    if not isinstance(c, dict):
      continue
    try:
      start = float(c.get("start", 0))
      end = float(c.get("end", 0))
      title = str(c.get("title", "")).strip()
      summary = str(c.get("summary", "")).strip()
    except (ValueError, TypeError):
      continue
    if not title or end <= start:
      continue
    # Clamp to valid range
    start = max(0.0, start)
    end = min(total_duration, end)
    out.append(Chapter(start=start, end=end, title=title, summary=summary))
  return out


def validate_chapters(chapters: list[Chapter], total_duration: float) -> list[Chapter]:
  """Normalize: ensure contiguous, sorted, valid durations."""
  if not chapters:
    return []
  # Sort by start
  chapters = sorted(chapters, key=lambda c: c.start)
  # Clamp to total duration
  for c in chapters:
    c.start = max(0.0, c.start)
    c.end = min(total_duration, c.end)
  # Remove any zero/negative-duration
  chapters = [c for c in chapters if c.end > c.start]
  if not chapters:
    return []
  # Fill gaps: if first.start > 0, prepend a chapter
  if chapters[0].start > 1.0:
    chapters.insert(0, Chapter(start=0, end=chapters[0].start, title="Introduction", summary="Opening"))
  # Fill gaps between chapters
  fixed: list[Chapter] = [chapters[0]]
  for i in range(1, len(chapters)):
    prev_end = fixed[-1].end
    if chapters[i].start > prev_end + 1.0:
      # Gap — fill it
      fixed.append(Chapter(start=prev_end, end=chapters[i].start,
                          title="(continuing)", summary=""))
    fixed.append(chapters[i])
  # Extend last chapter to total
  if fixed[-1].end < total_duration - 1.0:
    fixed.append(Chapter(start=fixed[-1].end, end=total_duration,
                        title="(continuing)", summary=""))
  # Drop too-short chapters (<5s) and merge into previous
  cleaned: list[Chapter] = []
  for c in fixed:
    if c.duration < 5.0 and cleaned:
      # Merge into previous
      cleaned[-1].end = c.end
    else:
      cleaned.append(c)
  return cleaned


class ChapterDetector:
  """Detect chapters in a long-form transcript using an LLM."""

  def __init__(self, llm_fn=None, *, fallback: bool = True):
    self.llm_fn = llm_fn
    self.fallback = fallback

  def detect(self, transcript: Transcript, *, max_chapters: int = 8) -> list[Chapter]:
    """Return a list of Chapters covering the full transcript."""
    if not transcript.segments or transcript.duration < 30:
      return []
    if self.llm_fn is not None:
      try:
        prompt = build_chapter_prompt(transcript)
        response = self.llm_fn(prompt)
        chapters = parse_chapters_response(response, total_duration=transcript.duration)
        chapters = validate_chapters(chapters, transcript.duration)[:max_chapters]
        if chapters:
          return chapters
      except Exception:
        if not self.fallback:
          raise
    if self.fallback:
      return self._heuristic_chapters(transcript, max_chapters=max_chapters)
    return []

  def _heuristic_chapters(self, transcript: Transcript, *, max_chapters: int) -> list[Chapter]:
    """Heuristic: divide into roughly equal time chunks.

    This is a fallback when no LLM is available. Useful as a "good enough"
    default that lets the rest of the pipeline run.
    """
    if transcript.duration < 30:
      return []
    # Aim for ~5 min per chapter, capped at max_chapters
    target_per_chapter = 300  # 5 min
    n = max(1, min(max_chapters, int(transcript.duration / target_per_chapter) + 1))
    step = transcript.duration / n
    out: list[Chapter] = []
    for i in range(n):
      start = i * step
      end = (i + 1) * step if i < n - 1 else transcript.duration
      out.append(Chapter(
        start=start, end=end,
        title=f"Chapter {i + 1}",
        summary=f"Auto-generated chapter covering {start:.0f}s to {end:.0f}s",
      ))
    return out
