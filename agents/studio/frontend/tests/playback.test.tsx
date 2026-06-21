import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Inspector } from '../src/components/Inspector';
import { Preview } from '../src/components/Preview';
import type { Clip, Keyframe, ProjectState, Track, AudioTrack, AudioClip } from '../src/types';
import { TIMELINE_OPS, createTimelineOp, computeClipColorAt, colorGradeToPreviewCss } from '../../../../packages/shared/index.js';
import {
  activeClipAtTrack,
  activeClipsAt,
  activeTextClipsAt,
  activeVideoClipAt,
  advancePlayhead,
  hasRealMediaPath,
  isPlaceholderClip,
  seekToFrame,
  resolvePlaybackFrame,
} from '../src/timelinePlayback';

function project(): ProjectState {
  return {
    name: 'Day 9 preview',
    duration_sec: 10,
    fps: 30,
    width: 1920,
    height: 1080,
    tracks: [
      {
        id: 'v1',
        kind: 'video',
        name: 'Video 1',
        muted: false,
        locked: false,
        clips: [
          {
            id: 'intro',
            track_id: 'v1',
            source_file: 'intro.mp4',
            start_sec: 0,
            duration_sec: 5,
            in_sec: 0,
            source: 'upload',
            label: 'Intro',
            kind: 'video',
          },
          {
            id: 'sim',
            track_id: 'v1',
            source_file: '',
            start_sec: 5,
            duration_sec: 5,
            in_sec: 0,
            source: 'higgsfield_simulated',
            label: 'Simulated B-roll',
            kind: 'video',
          },
        ],
      },
      {
        id: 't1',
        kind: 'overlay',
        name: 'Text 1',
        muted: false,
        locked: false,
        clips: [
          {
            id: 'txt',
            track_id: 't1',
            source_file: '',
            start_sec: 2,
            duration_sec: 4,
            in_sec: 0,
            source: 'text',
            label: 'Title',
            text: 'Hello Vireo',
            transform: { x: 120, y: 80 },
            titleProps: { text: 'Hello Vireo', fontFamily: 'Inter', fontSize: 44, color: '#ffffff', align: 'center' },
            kind: 'overlay',
          },
        ],
      },
    ],
  };
}

describe('Day 9 timeline playback logic', () => {
  it('activeClipAtTrack returns the correct clip on boundaries and null in holes', () => {
    const p = project();
    const video = p.tracks[0];

    expect(activeClipAtTrack(video, 0)?.id).toBe('intro');
    expect(activeClipAtTrack(video, 4.999)?.id).toBe('intro');
    expect(activeClipAtTrack(video, 5)?.id).toBe('sim');
    expect(activeClipAtTrack(video, 10)).toBeNull();
  });

  it('activeClipsAt, activeVideoClipAt, and activeTextClipsAt read the project document', () => {
    const p = project();

    expect(activeVideoClipAt(p, 1)?.id).toBe('intro');
    expect(activeVideoClipAt(p, 7)?.id).toBe('sim');
    expect(activeTextClipsAt(p, 3)[0]?.text).toBe('Hello Vireo');
    expect(activeTextClipsAt(p, 7)).toEqual([]);
    expect(activeClipsAt(p, 3).map(({ track, clip }) => `${track.id}:${clip.id}`)).toEqual(['v1:intro', 't1:txt']);
  });

  it('playhead advances and seeks on frame boundaries', () => {
    expect(advancePlayhead(0, 10, 30, 1000)).toBe(1);
    expect(advancePlayhead(1.2, 10, 30, 100)).toBeCloseTo(1.3, 4);
    expect(seekToFrame(1.51, 30)).toBe(1.5);
  });

  it('real media and simulated media are classified honestly', () => {
    const p = project();
    expect(hasRealMediaPath(p.tracks[0].clips[0])).toBe(true);
    expect(isPlaceholderClip(p.tracks[0].clips[0])).toBe(false);
    expect(hasRealMediaPath(p.tracks[0].clips[1])).toBe(false);
    expect(isPlaceholderClip(p.tracks[0].clips[1])).toBe(true);
  });

  it('resolvePlaybackFrame uses the active clip, in-point seek, and shared Day 19 color bridge', () => {
    const p = project();
    const clip = p.tracks[0].clips[0];
    const expectedFilter = colorGradeToPreviewCss(computeClipColorAt(p, clip, 2)).filter;

    expect(resolvePlaybackFrame(p, 2, (c) => c.source_file || '')).toMatchObject({
      activeClipId: 'intro',
      assetUrl: 'intro.mp4',
      seekTime: 2,
      filterCss: expectedFilter,
      opacity: 1,
    });
  });

  it('resolvePlaybackFrame switches at clip boundaries and computes seek from clip in-point', () => {
    const p = project();
    const first = p.tracks[0].clips[0];
    const second = p.tracks[0].clips[1];
    first.in_sec = 1.5;
    second.in_sec = 2.25;

    expect(resolvePlaybackFrame(p, 4.5, (c) => c.source_file || '')).toMatchObject({
      activeClipId: 'intro',
      seekTime: 6,
    });
    expect(resolvePlaybackFrame(p, 5, (c) => c.source_file || '')).toMatchObject({
      activeClipId: 'sim',
      seekTime: 2.25,
    });
  });
});

describe('Day 9 preview and inspector components', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    document.body.removeChild(container);
    document.body.innerHTML = '';
  });

  it('renders real media as a video element', () => {
    const p = project();
    act(() => {
      root.render(
        <Preview
          tab="program"
          onTabChange={() => {}}
          playing={false}
          onTogglePlay={() => {}}
          playhead={1}
          duration={10}
          fps={30}
          width={1920}
          height={1080}
          activeVideoClip={p.tracks[0].clips[0]}
          activeTextClips={[]}
        />,
      );
    });

    const video = container.querySelector('[data-testid="preview-video"]') as HTMLVideoElement | null;
    expect(video?.getAttribute('src')).toBe('intro.mp4');
    expect(container.querySelector('[data-testid="preview-placeholder"]')).toBeNull();
  });

  it('routes Preview color filter through the shared pixel-parity bridge', () => {
    const p = project();
    const gradedClip: Clip = {
      ...p.tracks[0].clips[0],
      color: {
        basic: { exposure: 0.5, contrast: 18, saturation: 125, temperature: 12, tint: -6 },
      },
    };
    const expectedColor = computeClipColorAt({ tracks: [] } as any, gradedClip, 0);
    const expectedFilter = colorGradeToPreviewCss(expectedColor).filter;

    act(() => {
      root.render(
        <Preview
          tab="program"
          onTabChange={() => {}}
          playing={false}
          onTogglePlay={() => {}}
          playhead={0}
          duration={10}
          fps={30}
          width={1920}
          height={1080}
          activeVideoClip={gradedClip}
          activeTextClips={[]}
        />,
      );
    });

    const video = container.querySelector('[data-testid="preview-video"]') as HTMLVideoElement | null;
    expect(video?.style.filter).toBe(expectedFilter);
  });

  it('renders simulated media as a poster card instead of a fake frame', () => {
    const p = project();
    act(() => {
      root.render(
        <Preview
          tab="program"
          onTabChange={() => {}}
          playing={false}
          onTogglePlay={() => {}}
          playhead={7}
          duration={10}
          fps={30}
          width={1920}
          height={1080}
          activeVideoClip={p.tracks[0].clips[1]}
          activeTextClips={[]}
        />,
      );
    });

    expect(container.querySelector('[data-testid="preview-placeholder"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="preview-source"]')?.textContent).toContain('higgsfield_simulated');
    expect(container.querySelector('[data-testid="preview-no-fake-frame"]')?.textContent).toContain('poster card');
    expect(container.querySelector('[data-testid="preview-video"]')).toBeNull();
  });

  it('draws active text overlays on top of the preview surface', () => {
    const p = project();
    act(() => {
      root.render(
        <Preview
          tab="program"
          onTabChange={() => {}}
          playing={false}
          onTogglePlay={() => {}}
          playhead={3}
          duration={10}
          fps={30}
          width={1920}
          height={1080}
          activeVideoClip={p.tracks[0].clips[0]}
          activeTextClips={p.tracks[1].clips}
        />,
      );
    });

    const overlay = container.querySelector('[data-testid="preview-text-overlay"]') as HTMLElement | null;
    expect(overlay?.textContent).toBe('Hello Vireo');
    expect(overlay?.style.left).toBe('120px');
    expect(overlay?.style.top).toBe('80px');
    expect(overlay?.style.fontFamily).toBe('Inter');
    expect(overlay?.style.fontSize).toBe('44px');
    expect(overlay?.style.color).toBe('rgb(255, 255, 255)');
  });

  it('Inspector shows track/start/end/asset/source/transform/effects from the selected clip', () => {
    const clip: Clip = {
      id: 'sim',
      track_id: 'v1',
      source_file: '',
      start_sec: 2,
      duration_sec: 4,
      in_sec: 1,
      source: 'higgsfield_simulated',
      label: 'Simulated B-roll',
      kind: 'video',
      transform: { x: 12, y: 34 },
      effects: [{ id: 'fx_blur', type: 'blur', name: 'Soft blur', params: {} }],
    };
    const track: Track = { id: 'v1', kind: 'video', name: 'Video 1', muted: false, locked: false, clips: [clip] };

    act(() => {
      root.render(
        <Inspector
          clip={clip}
          track={track}
          onQuickAction={() => {}}
        />,
      );
    });

    expect(container.querySelector('[data-testid="inspector-track"]')?.textContent).toBe('Video 1');
    expect(container.querySelector('[data-testid="inspector-start-end"]')?.textContent).toBe('2.0s — 6.0s');
    expect(container.querySelector('[data-testid="inspector-asset"]')?.textContent).toBe('—');
    expect(container.querySelector('[data-testid="inspector-source"]')?.textContent).toBe('higgsfield_simulated');
    expect(container.querySelector('[data-testid="inspector-transform"]')?.textContent).toBe('x=12, y=34, scale=1, rotation=0');
    expect(container.querySelector('[data-testid="inspector-media-mode"]')?.textContent).toBe('placeholder card');
    const effectTab = container.querySelector('[data-testid="inspector-tab-controls"]');
    act(() => {
      effectTab?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.querySelector('[data-testid="clip-effect"]')?.textContent).toContain('blur');
  });


  it('Inspector renders Essential Graphics only for selected text titles', () => {
    const videoClip: Clip = {
      id: 'sim',
      track_id: 'v1',
      source_file: '',
      start_sec: 2,
      duration_sec: 4,
      in_sec: 1,
      source: 'higgsfield_simulated',
      label: 'Simulated B-roll',
      kind: 'video',
      transform: { x: 12, y: 34 },
      effects: [],
    };
    const videoTrack: Track = { id: 'v1', kind: 'video', name: 'Video 1', muted: false, locked: false, clips: [videoClip] };

    act(() => {
      root.render(<Inspector clip={videoClip} clipId="sim" track={videoTrack} onQuickAction={() => {}} />);
    });
    const videoControls = container.querySelector('[data-testid="inspector-tab-controls"]');
    act(() => videoControls?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container.querySelector('[data-testid="essential-graphics-panel"]')).toBeNull();

    const textClip: Clip = {
      id: 'txt',
      track_id: 't1',
      source_file: '',
      start_sec: 2,
      duration_sec: 4,
      in_sec: 0,
      source: 'text',
      label: 'Title',
      text: 'Hello Vireo',
      kind: 'overlay',
      transform: { x: 120, y: 80 },
      titleProps: { text: 'Hello Vireo', fontFamily: 'Inter', fontSize: 44, color: '#ffffff', align: 'center' },
    };
    const textTrack: Track = { id: 't1', kind: 'overlay', name: 'Text 1', muted: false, locked: false, clips: [textClip] };
    act(() => {
      root.render(<Inspector clip={textClip} clipId="txt" track={textTrack} onQuickAction={() => {}} />);
    });
    const textControls = container.querySelector('[data-testid="inspector-tab-controls"]');
    act(() => textControls?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container.querySelector('[data-testid="essential-graphics-panel"]')).toBeTruthy();
  });

  it('Inspector title edits call editor with title-props patch compatible with op contract', async () => {
    const textClip: Clip = {
      id: 'txt',
      track_id: 't1',
      source_file: '',
      start_sec: 2,
      duration_sec: 4,
      in_sec: 0,
      source: 'text',
      label: 'Title',
      text: 'Hello Vireo',
      kind: 'overlay',
      transform: { x: 120, y: 80 },
      titleProps: { text: 'Hello Vireo', fontFamily: 'Inter', fontSize: 44, color: '#ffffff', align: 'center' },
    };
    const textTrack: Track = { id: 't1', kind: 'overlay', name: 'Text 1', muted: false, locked: false, clips: [textClip] };
    const onTitlePropsChange = vi.fn();

    act(() => {
      root.render(
        <Inspector
          clip={textClip}
          clipId="txt"
          track={textTrack}
          onQuickAction={() => {}}
          onTitlePropsChange={onTitlePropsChange}
        />,
      );
    });
    const controls = container.querySelector('[data-testid="inspector-tab-controls"]');
    act(() => controls?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    const textInput = container.querySelector('[data-testid="title-text"]') as HTMLInputElement;
    const fontSize = container.querySelector('[data-testid="title-font-size"]') as HTMLInputElement;
    const color = container.querySelector('[data-testid="title-color"]') as HTMLInputElement;
    expect(textInput).toBeTruthy();
    expect(fontSize).toBeTruthy();
    expect(color).toBeTruthy();
    await act(async () => {
      Object.defineProperty(textInput, 'value', { value: 'Hello Vireo Updated', configurable: true, writable: true });
      textInput.dispatchEvent(new Event('change', { bubbles: true }));
      textInput.dispatchEvent(new Event('input', { bubbles: true }));
      Object.defineProperty(fontSize, 'value', { value: '56', configurable: true, writable: true });
      fontSize.dispatchEvent(new Event('change', { bubbles: true }));
      fontSize.dispatchEvent(new Event('input', { bubbles: true }));
      Object.defineProperty(color, 'value', { value: '#123456', configurable: true, writable: true });
      color.dispatchEvent(new Event('change', { bubbles: true }));
      color.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(onTitlePropsChange).toHaveBeenCalledWith({ text: 'Hello Vireo Updated' });
    expect(onTitlePropsChange).toHaveBeenCalledWith({ fontSize: 56 });
    expect(onTitlePropsChange).toHaveBeenCalledWith({ color: '#123456' });
    const contractOp = createTimelineOp({
      op: TIMELINE_OPS.SET_TITLE_PROPS,
      actor: 'human',
      timelineId: 'tl_test',
      trackId: 't1',
      clipId: 'txt',
      payload: { titleProps: { text: 'Hello Vireo Updated', fontSize: 56, color: '#123456' } },
    });
    expect(contractOp.op).toBe(TIMELINE_OPS.SET_TITLE_PROPS);
    expect(contractOp.payload).toEqual({ titleProps: { text: 'Hello Vireo Updated', fontSize: 56, color: '#123456' } });
  });

  it('renders Preview transform from keyframes at the playhead', () => {
    const p = project();
    const clip = p.tracks[0].clips[0];
    clip.source_file = '';
    clip.source = 'higgsfield_simulated';
    clip.transform = { x: 0, y: 0, scale: 1, opacity: 1 };
    clip.keyframes = {
      transform: {
        x: [{ time: 0, value: 0, interp: 'linear' }, { time: 2, value: 80, interp: 'linear' }],
        y: [{ time: 0, value: 0, interp: 'linear' }, { time: 2, value: -20, interp: 'linear' }],
        scale: [{ time: 0, value: 1, interp: 'linear' }, { time: 2, value: 1.5, interp: 'linear' }],
        opacity: [{ time: 0, value: 1, interp: 'linear' }, { time: 2, value: 0.4, interp: 'linear' }],
      },
    };

    act(() => {
      root.render(
        <Preview
          tab="program"
          onTabChange={() => {}}
          playing={false}
          onTogglePlay={() => {}}
          playhead={2}
          duration={10}
          fps={30}
          width={1920}
          height={1080}
          activeVideoClip={clip}
          activeTextClips={[]}
        />,
      );
    });

    const placeholder = container.querySelector('[data-testid="preview-placeholder"]') as HTMLElement | null;
    expect(placeholder?.style.transform).toBe('translate(80px, -20px) scale(1.5)');
    expect(placeholder?.style.opacity).toBe('0.4');
  });

  it('Inspector keyframe controls add/remove transform and effect keys at the current playhead', () => {
    const clip: Clip = {
      id: 'sim',
      track_id: 'v1',
      source_file: '',
      start_sec: 2,
      duration_sec: 4,
      in_sec: 1,
      source: 'higgsfield_simulated',
      label: 'Simulated B-roll',
      kind: 'video',
      transform: { x: 10, y: 20, scale: 1.25, opacity: 0.8, rotation: 15 },
      effects: [{ id: 'fx_blur', type: 'blur', name: 'Soft blur', params: { radius: 8 } }],
    };
    const track: Track = { id: 'v1', kind: 'video', name: 'Video 1', muted: false, locked: false, clips: [clip] };
    const onTransformChange = vi.fn();
    const onSetKeyframe = vi.fn();
    const onRemoveKeyframe = vi.fn();

    act(() => {
      root.render(
        <Inspector
          clip={clip}
          clipId="sim"
          track={track}
          playhead={2.5}
          onQuickAction={() => {}}
          onTransformChange={onTransformChange}
          onSetKeyframe={onSetKeyframe}
          onRemoveKeyframe={onRemoveKeyframe}
        />,
      );
    });

    const controlsTab = container.querySelector('[data-testid="inspector-tab-controls"]');
    expect(controlsTab).toBeTruthy();
    act(() => controlsTab?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container.innerHTML).toContain('Keyframes at playhead');

    expect(container.querySelector('[data-testid="effect-keyframes"]')?.textContent).toContain('2.5s');
    expect(container.querySelector('[data-testid="inspector-transform-rotation"]')).toBeTruthy();

    act(() => container.querySelector('[data-testid="add-scale-keyframe"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onSetKeyframe).toHaveBeenCalledWith('transform', 'scale', { time: 2.5, value: 1.25, interp: 'linear' });

    act(() => container.querySelector('[data-testid="remove-y-keyframe"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onRemoveKeyframe).toHaveBeenCalledWith('transform', 'y', 2.5);

    act(() => container.querySelector('[data-testid="add-radius-keyframe"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onSetKeyframe).toHaveBeenCalledWith('fx_blur', 'radius', { time: 2.5, value: 8, interp: 'linear' });
  });
});
