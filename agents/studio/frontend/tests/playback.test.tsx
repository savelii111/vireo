import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Inspector } from '../src/components/Inspector';
import { Preview } from '../src/components/Preview';
import type { Clip, ProjectState, Track } from '../src/types';
import {
  activeClipAtTrack,
  activeClipsAt,
  activeTextClipsAt,
  activeVideoClipAt,
  advancePlayhead,
  hasRealMediaPath,
  isPlaceholderClip,
  seekToFrame,
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
