import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Timeline } from '../src/components/Timeline';
import type { ProjectState, ProjectAsset } from '../src/types';

function project(): ProjectState {
  return {
    id: 'p13',
    name: 'Day 13 Assets',
    duration_sec: 30,
    fps: 30,
    width: 1280,
    height: 720,
    tracks: [
      {
        id: 'v1',
        kind: 'video',
        muted: false,
        soloed: false,
        locked: false,
        hidden: false,
        clips: [],
      },
      {
        id: 'a1',
        kind: 'audio',
        muted: false,
        soloed: false,
        locked: false,
        hidden: false,
        clips: [],
      },
    ],
  };
}

async function waitFor(predicate: () => boolean, message = 'wait condition') {
  for (let i = 0; i < 30; i += 1) {
    await act(async () => { await Promise.resolve(); });
    if (predicate()) return;
  }
  throw new Error(message);
}

describe('Day 13 Timeline asset drop', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.removeChild(container);
  });

  function renderTimeline(onAssetDrop: ReturnType<typeof vi.fn>) {
    root.render(
      <Timeline
        project={project()}
        tool="select"
        onToolChange={() => {}}
        selectedClipId={null}
        onClipSelect={() => {}}
        playhead={0}
        onSeek={() => {}}
        zoom={100}
        onZoomChange={() => {}}
        onClipMove={() => {}}
        onClipResize={() => {}}
        onAssetDrop={onAssetDrop}
        onUndo={() => {}}
        onRedo={() => {}}
        canUndo={false}
        canRedo={false}
        onToggleMute={() => {}}
        onToggleSolo={() => {}}
        onToggleLock={() => {}}
        onToggleHidden={() => {}}
        onAddTransition={() => {}}
        onAddText={() => {}}
      />,
    );
  }

  it('accepts an asset dragged from the media panel and reports target track + start second', async () => {
    const onAssetDrop = vi.fn();
    const asset: ProjectAsset = {
      id: 'ast_hero',
      kind: 'video',
      filename: 'hero.mp4',
      duration_sec: 5,
      source: 'upload',
    };

    renderTimeline(onAssetDrop);

    await waitFor(() => Boolean(document.querySelector('[data-track-id="v1"]')), 'timeline track should render');
    const track = [...document.querySelectorAll('[data-track-id="v1"]')].at(-1) as HTMLDivElement;
    expect(track).toBeTruthy();
    const dataTransfer = {
      getData: () => JSON.stringify(asset),
      setData: () => undefined,
    };

    await act(async () => {
      const dragOver = new Event('dragover', { bubbles: true, cancelable: true });
      const drop = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(dragOver, 'dataTransfer', { value: dataTransfer });
      Object.defineProperty(dragOver, 'clientX', { value: 500 });
      Object.defineProperty(drop, 'dataTransfer', { value: dataTransfer });
      Object.defineProperty(drop, 'clientX', { value: 500 });
      track.dispatchEvent(dragOver);
      track.dispatchEvent(drop);
    });

    expect(onAssetDrop).toHaveBeenCalledWith(asset, 'v1', 5);
  });
});
