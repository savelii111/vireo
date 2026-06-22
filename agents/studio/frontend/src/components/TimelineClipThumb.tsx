// TimelineClipThumb — Day 23.
//
// Renders the real backend-decoded preview for a single clip on the
// timeline. The component is intentionally dumb: it just receives a
// manifest and renders. All ffmpeg / PCM work is on the server.
//
//   <TimelineClipThumb
//     kind="filmstrip"
//     state={filmstripState}    // useFilmstrip(...)
//     spriteUrl="...sprite.png"
//     clipIn={0}
//     clipOut={5}
//     width={300}                // px width on the timeline
//   />
//
//   <TimelineClipThumb
//     kind="waveform"
//     state={waveformState}     // useWaveform(...)
//     width={300}
//   />
//
// The component never synthesizes a fallback waveform or a fake
// gradient — when data is missing it shows a neutral placeholder so
// the timeline still renders, but the placeholder is visibly
// different from a real filmstrip / waveform.

import { type CSSProperties, type ReactNode } from "react";
import {
  type FilmstripManifest,
  type ThumbState,
  type WaveformManifest,
} from "../hooks/useClipThumbnails";

type Common = {
  width: number;
  height?: number;
  clipIn?: number;
  clipOut?: number;
  /** pixel-px per source-second on the timeline; needed to pick a frame index from `clipIn/clipOut`. */
  pxPerSec?: number;
  /** Optional inline style for the outer wrapper. */
  style?: CSSProperties;
};

type FilmstripProps = Common & {
  kind: "filmstrip";
  state: ThumbState<FilmstripManifest>;
  spriteUrl: string;
};

type WaveformProps = Common & {
  kind: "waveform";
  state: ThumbState<WaveformManifest>;
};

export type TimelineClipThumbProps = FilmstripProps | WaveformProps;

const NEUTRAL_BG = "#0f172a";
const NEUTRAL_BORDER = "#1f2937";

function neutralPlaceholder(reason: string, height: number, _width: number): ReactNode {
  // Honest empty state. No fake bars / no fake gradient — just a
  // muted rect with a tiny status label so a developer can see
  // *why* a clip is blank without us inventing data.
  return (
    <div
      data-testid="clip-thumb-placeholder"
      data-thumb-reason={reason}
      style={{
        width: "100%",
        height: height,
        background: NEUTRAL_BG,
        border: "1px dashed " + NEUTRAL_BORDER,
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#475569",
        fontSize: 10,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      }}
    >
      <span>{reason}</span>
    </div>
  );
}

function FilmstripView({
  state,
  spriteUrl,
  width,
  height,
  clipIn,
  clipOut,
  pxPerSec,
}: FilmstripProps): ReactNode {
  if (state.status === "loading" || state.status === "idle") {
    return neutralPlaceholder("loading filmstrip…", height ?? 30, width);
  }
  if (state.status === "error") {
    return neutralPlaceholder("filmstrip: " + state.message, height ?? 30, width);
  }
  const m = state.data;
  const cellW = m.frame_w;
  const cellH = m.frame_h;
  const totalW = m.sprite_w;

  // Pick a frame index to display as the static thumbnail. We use the
  // midpoint of (clipIn..clipOut) so the timeline cell shows the
  // visual center of the clip's in-window.
  const lo = clipIn ?? 0;
  const hi = clipOut ?? m.duration_sec;
  const mid = Math.max(0, Math.min(m.duration_sec - 0.001, (lo + hi) / 2));
  const frameIdx = Math.max(
    0,
    Math.min(m.count - 1, Math.floor((mid / Math.max(0.001, m.duration_sec)) * m.count)),
  );
  const bgX = -(frameIdx * cellW);
  const bgY = 0;

  // We render the sprite at cellW*count wide and cellH tall, then crop
  // via background-position. This works for any clip width on the
  // timeline because the cell is just `width: 100%`.
  const innerStyle: CSSProperties = {
    width: "100%",
    height: cellH,
    backgroundImage: "url(" + spriteUrl + ")",
    backgroundRepeat: "no-repeat",
    backgroundSize: totalW + "px " + cellH + "px",
    backgroundPosition: bgX + "px " + String(bgY) + "px",
    display: "block",
  };

  // pxPerSec is a hint for future zoom-aware frame selection; we
  // intentionally don't depend on it because the cell is sized by
  // CSS, not by JS.
  void pxPerSec;

  return (
    <div
      data-testid="clip-thumb-filmstrip"
      data-frame-index={String(frameIdx)}
      data-count={String(m.count)}
      data-real-decode="true"
      style={innerStyle}
    />
  );
}

function WaveformView({
  state,
  width,
  height,
  clipIn,
  clipOut,
}: WaveformProps): ReactNode {
  const h = height ?? 30;
  if (state.status === "loading" || state.status === "idle") {
    return neutralPlaceholder("loading waveform…", h, width);
  }
  if (state.status === "error") {
    return neutralPlaceholder("waveform: " + state.message, h, width);
  }
  const m = state.data;
  if (!m.has_audio || m.peaks.length === 0) {
    // Honest no-audio state. No fake bars.
    return neutralPlaceholder("no audio", h, width);
  }

  // Map the (clipIn..clipOut) source-time window into the peaks array.
  // peaks[i] corresponds to time i * duration / buckets.
  const lo = clipIn ?? 0;
  const hi = clipOut ?? m.duration_sec;
  const dur = Math.max(0.001, m.duration_sec);
  const a = Math.max(0, Math.floor((lo / dur) * m.peaks.length));
  const b = Math.min(m.peaks.length, Math.max(a + 1, Math.ceil((hi / dur) * m.peaks.length)));
  const windowed = m.peaks.slice(a, b);
  if (windowed.length === 0) {
    return neutralPlaceholder("no audio", h, width);
  }

  // Build an SVG path. M x0 y0 L x1 y0 L x1 y1 L x0 y1 Z to make a
  // vertical bar centered on the midline. We use the SVG element so
  // the path can be cheaply sliced with clipPath if needed later.
  const pad = 1;
  const innerH = Math.max(2, h - 2 * pad);
  const strideX = Math.max(1, width / windowed.length);
  const parts: string[] = [];
  for (let i = 0; i < windowed.length; i++) {
    const v = Math.max(0, Math.min(1, windowed[i]));
    const x = Math.round(i * strideX);
    const half = Math.max(1, Math.round((v * innerH) / 2));
    const yTop = pad + (innerH / 2) - half;
    const yBot = pad + (innerH / 2) + half;
    parts.push(
      "M" + String(x) + " " + String(Math.round(yTop)) +
      " L" + String(x) + " " + String(Math.round(yBot))
    );
  }
  return (
    <svg
      data-testid="clip-thumb-waveform"
      data-buckets={String(windowed.length)}
      data-has-audio="true"
      data-real-decode="true"
      width={width}
      height={h}
      viewBox={"0 0 " + String(width) + " " + String(h)}
      preserveAspectRatio="none"
      style={{ display: "block" }}
    >
      <path d={parts.join(" ")} stroke="#22d3ee" strokeWidth={1} fill="none" />
    </svg>
  );
}

export function TimelineClipThumb(props: TimelineClipThumbProps): ReactNode {
  if (props.kind === "filmstrip") return <FilmstripView {...props} />;
  return <WaveformView {...props} />;
}
