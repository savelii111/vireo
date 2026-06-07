"""Video editing pipeline — state machine orchestrator.

The pipeline composes all the other modules:
  1. transcribe  — Whisper API → transcript with word timestamps
  2. select      — LLM picks best moments for target platform
  3. cut         — cut those moments from the source
  4. effects     — zoom, color grading, silence removal (optional)
  5. reframe     — change aspect ratio to platform preset
  6. subtitle    — generate SRT, burn into video
  7. export      — apply platform preset (codec, bitrate, etc.)

Supports multi-clip: one source → N clips (one per moment).
"""

from __future__ import annotations
import json
import os
import time
import traceback
from dataclasses import dataclass, field, asdict
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Optional

from .cutter import cut_segments, CutRange, trim
from .reframe import reframe_for_platform
from .transcriber import Transcript
from .moments import Moment, MomentSelector
from .subtitles import SubtitleCue, transcript_to_cues, burn_in
from .presets import get_preset, Preset
from .chunked import needs_chunking, transcribe_long


class JobState(str, Enum):
  PENDING = "pending"
  TRANSCRIBING = "transcribing"
  SELECTING = "selecting"
  CUTTING = "cutting"
  EFFECTS = "effects"
  REFRAMING = "reframing"
  SUBTITLING = "subtitling"
  EXPORTING = "exporting"
  DONE = "done"
  FAILED = "failed"


@dataclass
class EditRequest:
  """Input to a pipeline run."""
  source_path: str                   # input video file
  target_platform: str = "youtube"   # youtube, tiktok, instagram_reels, etc.
  output_path: str = ""              # where to write final output
  subtitle_style: str | None = None  # None = use platform default
  max_moments: int = 1               # how many clips to produce
  word_burn: bool = True             # burn subtitles into the video
  custom_moments: list[dict] | None = None  # skip selection, use these
  job_id: str = ""
  # Style learning: if provided, the pipeline will re-style the output to match
  style_profile: object | None = None
  apply_style: bool = True
  # Effects toggles
  enable_zoom: bool = False          # auto-zoom on emphasis words
  enable_color: bool = False         # color grading
  color_look: str = "natural"        # natural, cinematic, warm, cool, vintage, bw, high_contrast, soft
  enable_silence_removal: bool = False  # remove silent pauses
  # Multi-clip: when True, produce one file per moment
  multi_clip: bool = False

  def to_dict(self) -> dict:
    d = asdict(self)
    if self.style_profile is not None and hasattr(self.style_profile, "to_dict"):
      d["style_profile"] = self.style_profile.to_dict()
    return d


@dataclass
class ClipResult:
  """Result for a single clip in a multi-clip run."""
  clip_index: int
  moment: dict
  output_path: str
  duration_sec: float = 0.0
  output_size_bytes: int = 0
  error: str | None = None

  def to_dict(self) -> dict:
    return asdict(self)


@dataclass
class EditResult:
  """Output of a pipeline run."""
  job_id: str
  state: JobState
  source_path: str
  output_path: str
  target_platform: str
  duration_sec: float = 0.0
  output_size_bytes: int = 0
  moments: list[dict] = field(default_factory=list)
  transcript: dict | None = None
  error: str | None = None
  steps: list[dict] = field(default_factory=list)
  started_at: float = 0.0
  finished_at: float = 0.0
  cost_usd: float = 0.0
  clips: list[ClipResult] = field(default_factory=list)
  progress: float = 0.0  # 0.0 to 1.0

  def to_dict(self) -> dict:
    d = asdict(self)
    d["state"] = self.state.value
    d["clips"] = [c.to_dict() for c in self.clips]
    return d


def _record_step(result: EditResult, name: str, started: float, **extra: Any) -> None:
  """Record a completed step in the result."""
  duration = time.time() - started
  step = {"name": name, "duration_sec": round(duration, 3), **extra}
  result.steps.append(step)


class VideoPipeline:
  """Orchestrates the full edit pipeline.

  All collaborators are injectable (Whisper client, LLM function) so tests
  don't need real API keys.

  Usage:
    pipeline = VideoPipeline(whisper_client=..., llm_fn=...)
    result = pipeline.run(EditRequest(source_path="in.mp4", target_platform="tiktok", ...))
    if result.state == JobState.DONE:
        print("Output:", result.output_path)
  """

  def __init__(
    self,
    *,
    whisper_client=None,
    llm_fn: Callable | None = None,
    moment_selector: MomentSelector | None = None,
    enable_subtitles: bool = True,
    style_transfer_fn: Callable | None = None,
    on_progress: Callable[[str, float], None] | None = None,
  ):
    self.whisper = whisper_client
    self.llm_fn = llm_fn
    self.selector = moment_selector or MomentSelector(llm_fn=llm_fn, fallback=True)
    self.enable_subtitles = enable_subtitles
    self.style_transfer_fn = style_transfer_fn
    self.on_progress = on_progress  # callback(state_name, progress_0_to_1)

  def _emit_progress(self, result: EditResult, state: str, progress: float):
    result.progress = progress
    if self.on_progress:
      try:
        self.on_progress(state, progress)
      except Exception:
        pass

  def run(self, request: EditRequest) -> EditResult:
    result = EditResult(
      job_id=request.job_id or f"job_{int(time.time()*1000)}",
      state=JobState.PENDING,
      source_path=request.source_path,
      output_path=request.output_path,
      target_platform=request.target_platform,
      started_at=time.time(),
    )

    try:
      # 1. Transcribe
      result.state = JobState.TRANSCRIBING
      self._emit_progress(result, "transcribing", 0.05)
      transcript = self._step_transcribe(request, result)
      if transcript is None:
        transcript = self._synthesize_transcript(request.source_path)
      self._emit_progress(result, "transcribing", 0.20)

      # 2. Select moments
      result.state = JobState.SELECTING
      self._emit_progress(result, "selecting", 0.25)
      moments = self._step_select(request, transcript, result)
      result.moments = [m.to_dict() for m in moments]
      self._emit_progress(result, "selecting", 0.30)

      # Multi-clip mode: produce one file per moment
      if request.multi_clip and len(moments) > 1:
        return self._run_multi_clip(request, result, transcript, moments)

      # Single-clip mode
      # 3. Cut
      result.state = JobState.CUTTING
      self._emit_progress(result, "cutting", 0.35)
      cut_path = self._step_cut(request, moments, result)
      if cut_path is None:
        raise RuntimeError("cutting produced no output")
      self._emit_progress(result, "cutting", 0.45)

      # 4. Effects (zoom, color, silence removal)
      result.state = JobState.EFFECTS
      self._emit_progress(result, "effects", 0.50)
      effects_path = self._step_effects(request, cut_path, transcript, moments, result)
      self._emit_progress(result, "effects", 0.60)

      # 5. Reframe
      result.state = JobState.REFRAMING
      self._emit_progress(result, "reframing", 0.65)
      reframed_path = self._step_reframe(request, effects_path, result)
      self._emit_progress(result, "reframing", 0.75)

      # 6. Subtitle (optional)
      output_path = reframed_path
      if self.enable_subtitles and request.word_burn:
        result.state = JobState.SUBTITLING
        self._emit_progress(result, "subtitling", 0.80)
        output_path = self._step_subtitle(request, transcript, moments, reframed_path, result)

      # 6b. Style transfer (optional)
      if request.style_profile is not None and request.apply_style:
        result.state = JobState.SUBTITLING
        output_path = self._step_style_transfer(request, transcript, output_path, result)

      # 7. Export
      result.state = JobState.EXPORTING
      self._emit_progress(result, "exporting", 0.90)
      result.output_path = output_path
      result.duration_sec = self._probe_duration(output_path)
      result.output_size_bytes = Path(output_path).stat().st_size if Path(output_path).exists() else 0

      result.state = JobState.DONE
      self._emit_progress(result, "done", 1.0)
    except Exception as e:
      result.state = JobState.FAILED
      result.error = f"{type(e).__name__}: {e}"
      result.steps.append({
        "name": "exception",
        "error": result.error,
        "traceback": traceback.format_exc(limit=5),
      })

    result.finished_at = time.time()
    return result

  def _run_multi_clip(
    self,
    request: EditRequest,
    result: EditResult,
    transcript: Transcript,
    moments: list[Moment],
  ) -> EditResult:
    """Produce one output file per moment (multi-clip mode)."""
    clips: list[ClipResult] = []
    total = len(moments)

    for i, moment in enumerate(moments):
      progress_base = 0.30 + (0.60 * i / total)
      clip_result = ClipResult(
        clip_index=i,
        moment=moment.to_dict(),
        output_path="",
      )
      try:
        # Cut this moment
        tmp_cut = self._tmp_path(request.output_path, suffix=f"clip{i}_cut")
        trim(request.source_path, str(tmp_cut), start=moment.start, end=moment.end, reencode=True)

        # Effects
        tmp_effects = self._step_effects(request, str(tmp_cut), transcript, [moment], result)

        # Reframe
        tmp_reframed = self._tmp_path(request.output_path, suffix=f"clip{i}_reframed")
        reframe_for_platform(str(tmp_effects), str(tmp_reframed), request.target_platform)

        # Subtitle
        output_path = str(tmp_reframed)
        if self.enable_subtitles and request.word_burn:
          cues = transcript_to_cues(transcript)
          PAD = 0.5
          in_range = []
          for c in cues:
            if c.end >= moment.start - PAD and c.start <= moment.end + PAD:
              in_range.append(SubtitleCue(
                index=len(in_range) + 1,
                start=max(0, c.start - moment.start),
                end=min(moment.end - moment.start, c.end - moment.start),
                text=c.text,
              ))
          if in_range:
            style = request.subtitle_style or request.target_platform
            if style not in ("default", "youtube_shorts", "tiktok", "youtube", "linkedin", "podcast"):
              style = "default"
            tmp_sub = self._tmp_path(request.output_path, suffix=f"clip{i}_sub")
            burn_in(str(tmp_reframed), str(tmp_sub), in_range, style=style)
            output_path = str(tmp_sub)

        clip_result.output_path = output_path
        clip_result.duration_sec = self._probe_duration(output_path)
        clip_result.output_size_bytes = Path(output_path).stat().st_size if Path(output_path).exists() else 0
      except Exception as e:
        clip_result.error = f"{type(e).__name__}: {e}"

      clips.append(clip_result)
      self._emit_progress(result, f"clip_{i}", progress_base + 0.60 / total)

    result.clips = clips
    # V-13 fix: if any clip failed, surface that in the result. Only set
    # output_path to the first successful clip if all clips succeeded, or to
    # the first clip regardless if any succeeded (and mark result.error).
    errors = [c for c in clips if c.error]
    if errors:
      result.state = JobState.FAILED
      result.error = f"{len(errors)}/{len(clips)} clips failed: " + "; ".join(
        e.error for e in errors[:3]
      )
    if clips:
      # Always expose the first clip's output_path for backward compat
      result.output_path = clips[0].output_path
      result.duration_sec = clips[0].duration_sec
      result.output_size_bytes = clips[0].output_size_bytes

    result.finished_at = time.time()
    if result.state != JobState.FAILED:
      result.state = JobState.DONE
      self._emit_progress(result, "done", 1.0)
    return result

  def _step_transcribe(self, request: EditRequest, result: EditResult) -> Transcript | None:
    t0 = time.time()
    if self.whisper is None:
      _record_step(result, "transcribe", t0, skipped=True, reason="no whisper client")
      return None
    if needs_chunking(request.source_path):
      transcript = transcribe_long(request.source_path, self.whisper)
    else:
      transcript = self.whisper.transcribe_file(request.source_path)
    cost = self.whisper.estimate_cost(transcript.duration)
    result.cost_usd += cost
    _record_step(result, "transcribe", t0,
                 duration_sec=transcript.duration,
                 num_segments=len(transcript.segments),
                 cost_usd=cost)
    return transcript

  def _synthesize_transcript(self, source_path: str) -> Transcript:
    from .ffmpeg_utils import probe
    info = probe(source_path)
    # V-17 fix: if probe fails or returns 0 duration, fall back to probing
    # the file with stat() (gives a rough lower bound). Don't return a
    # 0-duration transcript — that triggers a Moment(start=0, end=1) in
    # _step_select which silently truncates the output to 1 second.
    duration = info.get("duration_sec", 0)
    if not duration or duration <= 0:
      # Use file size as a last-resort proxy (assume 1 MB per minute, very rough)
      try:
        size_mb = Path(source_path).stat().st_size / (1024 * 1024)
        duration = max(60.0, size_mb * 60.0)
      except OSError:
        duration = 60.0  # safe default
    return Transcript(text="", language=None, duration=duration, segments=[])

  def _step_select(
    self,
    request: EditRequest,
    transcript: Transcript,
    result: EditResult,
  ) -> list[Moment]:
    t0 = time.time()
    if request.custom_moments:
      moments: list[Moment] = []
      for m in request.custom_moments:
        try:
          moments.append(Moment(
            start=float(m.get("start", 0)),
            end=float(m.get("end", 0)),
            reason=str(m.get("reason", "custom")),
          ))
        except (ValueError, TypeError):
          continue
      _record_step(result, "select", t0, source="custom", num_moments=len(moments))
      return moments

    moments = self.selector.select(
      transcript, request.target_platform, max_moments=request.max_moments,
    )
    if not moments:
      moments = [Moment(
        start=0.0, end=max(1.0, transcript.duration),
        reason="fallback: full source",
      )]
    _record_step(result, "select", t0, source="auto", num_moments=len(moments))
    return moments

  def _step_cut(
    self,
    request: EditRequest,
    moments: list[Moment],
    result: EditResult,
  ) -> str:
    t0 = time.time()
    ranges = [CutRange(start=m.start, end=m.end) for m in moments]
    if len(ranges) == 1:
      tmp = self._tmp_path(request.output_path, suffix="cut")
      trim(request.source_path, str(tmp), start=ranges[0].start, end=ranges[0].end, reencode=True)
      _record_step(result, "cut", t0, ranges=len(ranges), output=str(tmp))
      return str(tmp)
    tmp = self._tmp_path(request.output_path, suffix="cut")
    cut_segments(request.source_path, str(tmp), ranges)
    _record_step(result, "cut", t0, ranges=len(ranges), output=str(tmp))
    return str(tmp)

  def _step_effects(
    self,
    request: EditRequest,
    input_path: str,
    transcript: Transcript,
    moments: list[Moment],
    result: EditResult,
  ) -> str:
    """Apply effects: silence removal, zoom, color grading."""
    t0 = time.time()
    current = input_path
    applied = []

    # Silence removal
    if request.enable_silence_removal:
      try:
        from .cutter import remove_silences
        tmp = self._tmp_path(request.output_path, suffix="desilenced")
        remove_silences(current, str(tmp))
        current = str(tmp)
        applied.append("silence_removal")
      except Exception as e:
        # V-16 fix: surface the failure to the caller (was silently swallowed)
        _record_step(result, "effects.silence", t0, error=str(e), fatal=True)
        raise

    # Auto-zoom on emphasis words
    if request.enable_zoom:
      try:
        from .zoom import apply_zoom
        tmp = self._tmp_path(request.output_path, suffix="zoomed")
        apply_zoom(current, str(tmp))
        current = str(tmp)
        applied.append("zoom")
      except Exception as e:
        # V-16 fix: surface zoom failure (was silently swallowed)
        _record_step(result, "effects.zoom", t0, error=str(e), fatal=True)
        raise

    # Color grading
    if request.enable_color:
      try:
        from .color import apply_look
        tmp = self._tmp_path(request.output_path, suffix="colored")
        apply_look(current, str(tmp), look=request.color_look)
        current = str(tmp)
        applied.append(f"color:{request.color_look}")
      except Exception as e:
        # V-16 fix: surface color failure (was silently swallowed)
        _record_step(result, "effects.color", t0, error=str(e), fatal=True)
        raise

    if applied:
      _record_step(result, "effects", t0, applied=applied, output=current)
    else:
      _record_step(result, "effects", t0, skipped=True, reason="no effects enabled")

    return current

  def _step_reframe(
    self,
    request: EditRequest,
    cut_path: str,
    result: EditResult,
  ) -> str:
    t0 = time.time()
    tmp = self._tmp_path(request.output_path, suffix="reframed")
    reframe_for_platform(cut_path, str(tmp), request.target_platform)
    _record_step(result, "reframe", t0, platform=request.target_platform, output=str(tmp))
    return str(tmp)

  def _step_subtitle(
    self,
    request: EditRequest,
    transcript: Transcript,
    moments: list[Moment],
    reframed_path: str,
    result: EditResult,
  ) -> str:
    t0 = time.time()
    if not transcript.words():
      _record_step(result, "subtitle", t0, skipped=True, reason="no word timestamps")
      return reframed_path

    cues = transcript_to_cues(transcript)
    PAD = 0.5
    in_range: list[SubtitleCue] = []
    if len(moments) == 1:
      m = moments[0]
      for c in cues:
        if c.end >= m.start - PAD and c.start <= m.end + PAD:
          in_range.append(SubtitleCue(
            index=len(in_range) + 1,
            start=max(0, c.start - m.start),
            end=min(m.end - m.start, c.end - m.start),
            text=c.text,
          ))
    else:
      in_range = cues

    if not in_range:
      _record_step(result, "subtitle", t0, skipped=True, reason="no cues in range")
      return reframed_path

    style = request.subtitle_style or request.target_platform
    if style not in ("default", "youtube_shorts", "tiktok", "youtube", "linkedin", "podcast"):
      style = "default"

    tmp = self._tmp_path(request.output_path, suffix="subtitled")
    burn_in(reframed_path, str(tmp), in_range, style=style)
    _record_step(result, "subtitle", t0, num_cues=len(in_range), style=style, output=str(tmp))
    return str(tmp)

  def _tmp_path(self, final: str, *, suffix: str) -> Path:
    if not final:
      final = "vireo_output.mp4"
    p = Path(final)
    return p.parent / f"_vireo_{suffix}_{p.stem}.mp4"

  def _step_style_transfer(
    self,
    request: EditRequest,
    transcript: Transcript | None,
    input_path: str,
    result: EditResult,
  ) -> str:
    t0 = time.time()
    profile = request.style_profile
    if profile is None:
      _record_step(result, "style_transfer", t0, skipped=True, reason="no profile")
      return input_path
    if self.style_transfer_fn is not None:
      tmp = self._tmp_path(request.output_path, suffix="styled")
      try:
        self.style_transfer_fn(input_path, str(tmp), profile, transcript)
        _record_step(result, "style_transfer", t0,
                     look=profile.recommended_look,
                     confidence=profile.look_confidence,
                     output=str(tmp))
        return str(tmp)
      except Exception as e:
        _record_step(result, "style_transfer", t0, error=str(e))
        return input_path
    else:
      _record_step(result, "style_transfer", t0,
                   skipped=True, reason="no style_transfer_fn injected")
      return input_path

  def _probe_duration(self, path: str) -> float:
    from .ffmpeg_utils import probe
    try:
      return probe(path).get("duration_sec", 0.0)
    except Exception:
      return 0.0
