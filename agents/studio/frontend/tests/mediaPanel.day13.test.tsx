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

  it('imports real media through TUS + ffprobe and posts real_decode asset metadata', async () => {
    const ingest = {
      id: 'upload1',
      upload_id: 'upload1',
      filename: 'sample_10s.mp4',
      file_path: '/vireo_media/uploads/sample_10s.mp4',
      duration: 10,
      duration_sec: 10,
      width: 1280,
      height: 720,
      fps: 30,
      video_codec: 'h264',
      hasAudio: true,
      container: 'mov,mp4,m4a,3gp,3g2,mj2',
      real_decode: true,
    };
    const asset = {
      id: 'ast_real_import',
      kind: 'video',
      filename: 'sample_10s.mp4',
      duration_sec: 10,
      width: 1280,
      height: 720,
      fps: 30,
      codec: 'h264',
      container: 'mov,mp4,m4a,3gp,3g2,mj2',
      has_audio: true,
      real_decode: true,
      status: 'ready',
    };
    fetchMock.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      if (path === '/api/assets?project_id=p1&limit=200') {
        return json({ assets: [] });
      }
      if (path === '/api/upload/resumable') {
        const body = { id: 'upload1', upload_length: 100, offset: 0, filename: 'sample_10s.mp4' };
        return {
          ok: true,
          status: 201,
          headers: new Headers({ Location: '/api/upload/resumable/upload1' }),
          async text() { return JSON.stringify(body); },
          async json() { return body; },
        } as Response;
      }
      if (path === '/api/upload/resumable/upload1' && init?.method === 'PATCH') {
        const nextOffset = Number(init?.headers?.['Upload-Offset'] || 0) + 5;
        return {
          ok: true,
          status: 204,
          headers: new Headers({ 'Upload-Offset': String(nextOffset) }),
          async text() { return ''; },
        } as Response;
      }
      if (path === '/api/upload/resumable/upload1/ingest') {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          async text() { return JSON.stringify(ingest); },
          async json() { return ingest; },
        };
      }
      if (path === '/api/assets' && init?.method === 'POST') {
        const body = { asset };
        return {
          ok: true,
          status: 201,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          async text() { return JSON.stringify(body); },
          async json() { return body; },
        };
      }
      return json({ error: 'unexpected_fetch' }, 500);
    });

    renderPanel();
    await waitFor(() => document.querySelector('[data-testid="media-panel"]')?.textContent?.includes('No assets yet'));

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      Object.defineProperty(input, 'files', { value: [new File(['video'], 'sample_10s.mp4', { type: 'video/mp4' })] });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const button = document.querySelector('[data-testid="import-real"]') as HTMLButtonElement;
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await waitFor(() => assetLabels().length === 1, 'real imported asset should render');
    expect(assetLabels()[0]).toContain('sample_10s.mp4');
    expect(assetLabels()[0]).toContain('10s duration');
    expect(assetLabels()[0]).toContain('1280×720');
    expect(assetLabels()[0]).toContain('h264');
    expect(assetLabels()[0]).toContain('real_decode');
    expect(fetchMock).toHaveBeenCalledWith('/api/assets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-day13' },
      body: expect.stringContaining('"real_decode":true'),
    });
  });
});
