import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaPanel } from '../src/components/MediaPanel';

function setInputValue(input: HTMLInputElement, value: string) {
  Object.defineProperty(input, 'value', { value, writable: true, configurable: true });
  input.dispatchEvent(new InputEvent('input', { bubbles: true }));
}

function json(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
  } as Response;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function waitFor(predicate: () => boolean, message = 'wait condition') {
  for (let i = 0; i < 30; i += 1) {
    await flush();
    if (predicate()) return;
  }
  throw new Error(message);
}

function assetLabels() {
  return Array.from(document.querySelectorAll('[data-testid="asset-card"]')).map((node) => node.textContent?.trim() ?? '');
}

describe('Day 13 Project/Media panel', () => {
  let container: HTMLDivElement;
  let root: Root;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    window.localStorage.clear();
    window.localStorage.setItem('vireo_token', 'token-day13');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.removeChild(container);
    vi.unstubAllGlobals();
  });

  function renderPanel() {
    root.render(<MediaPanel projectId="p1" />);
  }

  it('renders project assets with preview, type, duration, name, bins, and search filter', async () => {
    fetchMock.mockResolvedValueOnce(json({
      assets: [
        { id: 'ast_video', kind: 'video', filename: 'hero.mp4', duration_sec: 12, status: 'ready' },
        { id: 'ast_audio', kind: 'audio', filename: 'voice.wav', duration_sec: 8, status: 'ready' },
        { id: 'ast_image', kind: 'image', filename: 'cover.png', duration_sec: null, status: 'ready' },
      ],
    }));

    renderPanel();
    await waitFor(() => assetLabels().length === 3, 'media panel should render assets');

    expect(fetchMock).toHaveBeenCalledWith('/api/assets?project_id=p1&limit=200', {
      headers: { Authorization: 'Bearer token-day13' },
    });
    expect(document.querySelector('[data-testid="media-panel"]')?.textContent).toContain('Project / Media');
    expect(assetLabels().join('\n')).toContain('hero.mp4');
    expect(assetLabels().join('\n')).toContain('12s duration');
    expect(assetLabels().join('\n')).toContain('voice.wav');
    expect(assetLabels().join('\n')).toContain('cover.png');

    const search = document.querySelector('input[placeholder="Search assets…"]') as HTMLInputElement;
    await act(async () => {
      setInputValue(search, 'hero');
    });
    await waitFor(() => assetLabels().length === 1, 'search should filter to hero');
    expect(assetLabels()[0]).toContain('hero.mp4');

    await act(async () => {
      setInputValue(search, '');
      document.querySelector('[data-testid="bin-audio"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await waitFor(() => assetLabels().length === 1, 'audio bin should filter to voice');
    expect(assetLabels()[0]).toContain('voice.wav');
  });

  it('imports simulated metadata only through POST /api/assets', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ assets: [] }))
      .mockResolvedValueOnce(json({
        asset: {
          id: 'ast_imported',
          kind: 'video',
          filename: 'manual-import.mp4',
          duration_sec: 4,
          status: 'ready',
          metadata: { simulated_ingest: true, real_decode: false, registered_by: 'manual' },
        },
      }, 201));

    renderPanel();
    await waitFor(() => document.querySelector('[data-testid="media-panel"]')?.textContent?.includes('No assets yet'));

    const name = document.querySelector('input[placeholder="asset.mp4 / audio.wav / image.png"]') as HTMLInputElement;
    const duration = document.querySelector('input[placeholder="sec"]') as HTMLInputElement;
    const form = document.querySelector('form') as HTMLFormElement;
    await act(async () => {
      setInputValue(name, 'manual-import.mp4');
      setInputValue(duration, '4');
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    await waitFor(() => assetLabels().length === 1, 'imported asset should render');
    expect(fetchMock).toHaveBeenLastCalledWith('/api/assets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-day13' },
      body: JSON.stringify({
        project_id: 'p1',
        kind: 'video',
        source: 'upload',
        filename: 'manual-import.mp4',
        duration_sec: 4,
        metadata: { simulated_ingest: true, real_decode: false, registered_by: 'manual' },
      }),
    });
    expect(assetLabels()[0]).toContain('manual-import.mp4');
    expect(assetLabels()[0]).toContain('metadata only');
  });
});
