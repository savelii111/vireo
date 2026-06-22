// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { TimelineClipThumb } from "../src/components/TimelineClipThumb";
import type {
  FilmstripManifest,
  WaveformManifest,
  ThumbState,
} from "../src/hooks/useClipThumbnails";

afterEach(() => {
  cleanup();
});

describe("TimelineClipThumb (Day 23)", () => {
  it("renders a filmstrip cell with the correct background-position and data attrs", () => {
    const filmstripState: ThumbState<FilmstripManifest> = {
      status: "ready",
      data: {
        real_decode: true,
        asset_id: "a1",
        count: 10,
        frame_w: 160,
        frame_h: 90,
        sprite_w: 1600,
        sprite_h: 90,
        duration_sec: 10,
        timestamps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
        fps: 1,
        cache_hit: false,
      },
    };
    const { getByTestId } = render(
      <TimelineClipThumb
        kind="filmstrip"
        state={filmstripState}
        spriteUrl="/sprite.png"
        width={300}
        height={30}
        clipIn={2}
        clipOut={6}
      />,
    );
    const node = getByTestId("clip-thumb-filmstrip");
    expect(node.getAttribute("data-real-decode")).toBe("true");
    expect(node.getAttribute("data-count")).toBe("10");
    // Midpoint of (2..6) = 4. frame_idx = floor((4 / 10) * 10) = 4
    expect(node.getAttribute("data-frame-index")).toBe("4");
    // jsdom normalizes background-image to url("/sprite.png") with quotes
    // around the path; we only check the path token is present.
    const styleAttr = (node as HTMLElement).getAttribute("style") ?? "";
    expect(styleAttr).toMatch(/background-image:\s*url\((['"]?)\/sprite\.png\1\)/);
    expect(styleAttr).toContain("background-size: 1600px 90px");
    expect(styleAttr).toContain("background-position: -640px 0px");
  });

  it("renders an SVG waveform with the right number of bars when audio is present", () => {
    const waveformState: ThumbState<WaveformManifest> = {
      status: "ready",
      data: {
        real_decode: true,
        asset_id: "a1",
        buckets: 200,
        sample_rate: 8000,
        has_audio: true,
        peaks: Array.from({ length: 200 }, (_, i) => 0.5 + 0.4 * Math.sin(i / 5)),
        duration_sec: 10,
        pcm_bytes: 160000,
        cache_hit: false,
      },
    };
    const { getByTestId } = render(
      <TimelineClipThumb
        kind="waveform"
        state={waveformState}
        width={300}
        height={30}
        clipIn={2}
        clipOut={6}
      />,
    );
    const node = getByTestId("clip-thumb-waveform");
    expect(node.tagName.toLowerCase()).toBe("svg");
    expect(node.getAttribute("data-has-audio")).toBe("true");
    expect(node.getAttribute("data-real-decode")).toBe("true");
    // 200 peaks over 10s, (2..6) -> a=floor(2/10*200)=40, b=ceil(6/10*200)=120
    expect(node.getAttribute("data-buckets")).toBe("80");
    const path = node.querySelector("path");
    expect(path).toBeTruthy();
    const d = path!.getAttribute("d") || "";
    const mCount = (d.match(/M/g) || []).length;
    expect(mCount).toBe(80);
  });

  it("renders a neutral placeholder for has_audio=false (no fake bars)", () => {
    const waveformState: ThumbState<WaveformManifest> = {
      status: "ready",
      data: {
        real_decode: true,
        asset_id: "a1",
        buckets: 200,
        sample_rate: 8000,
        has_audio: false,
        peaks: [],
        duration_sec: 10,
        pcm_bytes: 0,
        cache_hit: false,
      },
    };
    const { getByTestId, queryByTestId } = render(
      <TimelineClipThumb kind="waveform" state={waveformState} width={300} height={30} />,
    );
    expect(queryByTestId("clip-thumb-waveform")).toBeNull();
    const ph = getByTestId("clip-thumb-placeholder");
    expect(ph.getAttribute("data-thumb-reason")).toBe("no audio");
  });

  it("renders a neutral placeholder on error (no fake gradient)", () => {
    const errState: ThumbState<FilmstripManifest> = {
      status: "error",
      message: "filmstrip_http_503",
    };
    const { getAllByTestId } = render(
      <TimelineClipThumb
        kind="filmstrip"
        state={errState}
        spriteUrl="/sprite.png"
        width={300}
        height={30}
      />,
    );
    // The component renders exactly one placeholder for an error state.
    const placeholders = getAllByTestId("clip-thumb-placeholder");
    expect(placeholders.length).toBe(1);
    expect(placeholders[0].getAttribute("data-thumb-reason")).toContain("filmstrip_http_503");
  });
});
