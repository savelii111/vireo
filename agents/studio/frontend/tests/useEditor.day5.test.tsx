import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditor } from '../src/hooks/useEditor';
import type { TimelineDocument, TimelineOp } from '../src/types';

declare global {
  interface Window {
    __editor?: ReturnType<typeof useEditor>;
  }
}

function baseDoc(version = 1): TimelineDocument {
  return {
    timelineId: 'tl1',
    projectId: 'p1',
    fps: 30,
    resolution: { w: 1920, h: 1080 },
    version,
    tracks: [
      {
        id: 'v1',
        kind: 'video',
        name: 'Video 1',
        muted: false,
        locked: false,
        clips: [
          {
            id: 'clp1',
            assetId: 'intro.mp4',
            start: 0,
            end: 5,
            in: 0,
            out: 5,
            source: 'upload',
            name: 'Intro',
          },
        ],
      },
      {
        id: 'a1',
        kind: 'audio',
        name: 'Audio 1',
        muted: false,
        locked: false,
        clips: [],
      },
      {
        id: 't1',
        kind: 'text',
        name: 'Text 1',
        muted: false,
        locked: false,
        clips: [],
      },
    ],
    markers: [],
    transitions: [],
  };
}

function docWithClipAt(version: number, start: number, label = 'Intro'): TimelineDocument {
  const base = baseDoc(version);
  return {
    ...base,
    tracks: [
      {
        ...base.tracks[0],
        clips: [
          {
            id: 'clp1',
            assetId: 'intro.mp4',
            start,
            end: start + 5,
            in: 0,
            out: 5,
            source: 'upload',
            name: label,
          },
        ],
      },
      base.tracks[1],
      base.tracks[2],
    ],
  };
}

function docWithTransformAndVolume(version: number, x = 30, y = -20, scale = 1.25, opacity = 0.8, volume = 0.5): TimelineDocument {
  const doc = docWithClipAt(version, 0);
  doc.tracks[0].clips[0] = {
    ...doc.tracks[0].clips[0],
    transform: { x, y, scale, opacity },
    volume,
  };
  return doc;
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

function clipTexts() {
  return Array.from(document.querySelectorAll('[data-testid="clip"]')).map((node) => node.textContent?.trim() ?? '');
}

function transitionTexts() {
  return Array.from(document.querySelectorAll('[data-testid="transition"]')).map((node) => node.textContent?.trim() ?? '');
}

function effectTexts() {
  return Array.from(document.querySelectorAll('[data-testid="clip-effect"]')).map((node) => node.textContent?.trim() ?? '');
}

function Harness() {
  const editor = useEditor();
  window.__editor = editor;

  return (
    <main data-testid="editor-harness">
      <span data-testid="loading">{String(editor.timelineLoading)}</span>
      <span data-testid="error">{editor.timelineError ?? ''}</span>
      <span data-testid="can-undo">{String(editor.canUndo)}</span>
      <span data-testid="can-redo">{String(editor.canRedo)}</span>
      <span data-testid="duration">{String(editor.project.duration_sec)}</span>
      {editor.project.transitions?.map((transition) => (
        <span
          key={transition.id}
          data-testid="transition"
          data-transition-id={String(transition.id)}
        >
          {String(transition.id)}:{String(transition.fromClipId)}→{String(transition.toClipId)}:{String(transition.kind)}:{String(transition.duration)}
        </span>
      ))}
      {editor.project.tracks.map((track) => (
        <section key={track.id} data-testid="track">
          {track.clips.map((clip) => (
            <span
              key={clip.id}
              data-testid="clip"
              data-clip-id={clip.id}
            >
              {clip.id}:{clip.start_sec}-{clip.duration_sec}:{clip.label}
              {clip.effects?.map((effect, index) => (
                <span
                  key={`${clip.id}-fx-${index}`}
                  data-testid="clip-effect"
                  data-effect-index={index}
                >
                  {String(effect.type ?? effect.name ?? effect.id ?? 'effect')}
                </span>
              ))}
            </span>
          ))}
        </section>
      ))}
    </main>
  );
}

describe('Day 5 useEditor real timeline contract', () => {
  let container: HTMLDivElement;
  let root: Root;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    window.localStorage.clear();
    window.localStorage.setItem('vireo_active_project_id', 'p1');
    window.localStorage.setItem('vireo_token', 'token-for-test');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    document.body.removeChild(container);
    vi.unstubAllGlobals();
    delete window.__editor;
  });

  async function renderHarness() {
    await act(async () => {
      root.render(<Harness />);
    });
    await waitFor(() => Boolean(window.__editor), 'useEditor should be mounted');
    await waitFor(() => clipTexts().length > 0, 'timeline should be loaded before the test drives the editor');
  }

  it('loads the real timeline from GET /api/timelines/:projectId before rendering clips', async () => {
    const loaded = baseDoc(7);
    loaded.version = 7;
    loaded.tracks[0].clips[0].start = 2;
    loaded.tracks[0].clips[0].end = 9;

    fetchMock.mockResolvedValueOnce(json({
      timeline: {
        doc: loaded,
        version: 7,
        timelineId: 'tl1',
        projectId: 'p1',
        undo_cursor_seq: 7,
        can_redo: true,
      },
    }));

    await renderHarness();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenLastCalledWith('/api/timelines/p1', {
      headers: { Authorization: 'Bearer token-for-test' },
    });
    expect(window.__editor?.timelineLoading).toBe(false);
    expect(window.__editor?.canUndo).toBe(true);
    expect(window.__editor?.canRedo).toBe(true);
    expect(clipTexts()).toEqual(['clp1:2-7:Intro']);
  });

  it('sends manual edits to POST /ops with baseVersion and replaces local state with the server doc', async () => {
    const committed = docWithClipAt(2, 4, 'Server moved');

    fetchMock
      .mockResolvedValueOnce(json({ timeline: { doc: baseDoc(1), version: 1, timelineId: 'tl1', projectId: 'p1' } }))
      .mockResolvedValueOnce(json({ doc: committed, version: 2, timelineId: 'tl1', projectId: 'p1', undo_cursor_seq: 2, can_redo: false }));

    await renderHarness();

    await act(async () => {
      window.__editor?.moveClip('clp1', 4);
    });
    expect(clipTexts()).toEqual(['clp1:4-5:Intro']);
    await window.__editor?.onDragEnd();
    await waitFor(() => clipTexts().includes('clp1:4-5:Server moved'));

    const postBody = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    expect(fetchMock.mock.calls[1][0]).toBe('/api/timelines/p1/ops');
    expect(postBody).toMatchObject({
      baseVersion: 1,
      actor: 'human',
      ops: [{
        op: 'moveClip',
        actor: 'human',
        timelineId: 'tl1',
        trackId: 'v1',
        clipId: 'clp1',
        payload: { targetTrackId: 'v1', start: 4, originalStart: 0 },
      }],
    });
    expect(clipTexts()).toEqual(['clp1:4-5:Server moved']);
  });

  it('handles 409 by refetching, rebasing the pending op, and retrying POST /ops', async () => {
    const fresh = docWithClipAt(2, 1, 'Fresh base');
    const retryCommitted = docWithClipAt(3, 4, 'Retry committed');

    fetchMock
      .mockResolvedValueOnce(json({ timeline: { doc: baseDoc(1), version: 1, timelineId: 'tl1', projectId: 'p1' } }))
      .mockResolvedValueOnce(json({ error: { code: 'timeline_version_conflict' }, message: 'timeline_version_conflict' }, 409))
      .mockResolvedValueOnce(json({ timeline: { doc: fresh, version: 2, timelineId: 'tl1', projectId: 'p1', undo_cursor_seq: 2, can_redo: false } }))
      .mockResolvedValueOnce(json({ doc: retryCommitted, version: 3, timelineId: 'tl1', projectId: 'p1', undo_cursor_seq: 3, can_redo: false }));

    await renderHarness();

    await act(async () => {
      window.__editor?.moveClip('clp1', 4);
    });
    await window.__editor?.onDragEnd();
    await waitFor(() => clipTexts().includes('clp1:4-5:Retry committed'));

    const firstPost = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    const secondPost = JSON.parse((fetchMock.mock.calls[3][1] as RequestInit).body as string);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/api/timelines/p1',
      '/api/timelines/p1/ops',
      '/api/timelines/p1',
      '/api/timelines/p1/ops',
    ]);
    expect(firstPost.baseVersion).toBe(1);
    expect(secondPost.baseVersion).toBe(2);
    expect((secondPost.ops as TimelineOp[])[0]).toMatchObject({ op: 'moveClip', clipId: 'clp1', trackId: 'v1' });
    expect(clipTexts()).toEqual(['clp1:4-5:Retry committed']);
  });

  it('uses server undo/redo endpoints and redraws from returned docs', async () => {
    const undone = docWithClipAt(2, 0, 'Undone');
    const redone = docWithClipAt(3, 4, 'Redone');

    fetchMock
      .mockResolvedValueOnce(json({ timeline: { doc: baseDoc(1), version: 1, timelineId: 'tl1', projectId: 'p1' } }))
      .mockResolvedValueOnce(json({ doc: undone, version: 2, timelineId: 'tl1', projectId: 'p1', undo_cursor_seq: 2, can_redo: true }))
      .mockResolvedValueOnce(json({ doc: redone, version: 3, timelineId: 'tl1', projectId: 'p1', undo_cursor_seq: 3, can_redo: false }));

    await renderHarness();

    await act(async () => {
      await window.__editor?.undo();
    });
    expect(fetchMock.mock.calls.map((call) => call[0]).slice(0, 2)).toEqual([
      '/api/timelines/p1',
      '/api/timelines/p1/undo',
    ]);
    expect(clipTexts()).toEqual(['clp1:0-5:Undone']);

    await act(async () => {
      await window.__editor?.redo();
    });
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/api/timelines/p1',
      '/api/timelines/p1/undo',
      '/api/timelines/p1/redo',
    ]);
    expect(clipTexts()).toEqual(['clp1:4-5:Redone']);
  });

  it('applies bot insertClip from an authoritative server timeline payload', async () => {
    const afterBot = docWithClipAt(2, 0);
    afterBot.tracks[0].clips.push({
      id: 'clp2',
      assetId: 'sunset.mp4',
      start: 5,
      end: 10,
      in: 0,
      out: 5,
      source: 'higgsfield',
      name: 'Generated B-roll',
    });

    fetchMock.mockResolvedValueOnce(json({ timeline: { doc: baseDoc(1), version: 1, timelineId: 'tl1', projectId: 'p1' } }));

    await renderHarness();

    window.__editor?.applyBotInsertClip({
      doc: afterBot,
      version: 2,
      timelineId: 'tl1',
      projectId: 'p1',
      clipId: 'clp2',
      trackId: 'v1',
    });
    await flush();

    expect(window.__editor?.canUndo).toBe(true);
    expect(clipTexts()).toEqual([
      'clp1:0-5:Intro',
      'clp2:5-5:Generated B-roll',
    ]);
  });

  it('adds a transition through the useEditor op path and redraws undo/redo from server docs', async () => {
    const withTransition = docWithClipAt(2, 0);
    withTransition.transitions = [{
      id: 'tr_cross',
      clipId: 'clp1',
      trackId: 'v1',
      fromClipId: 'clp1',
      toClipId: 'clp2',
      kind: 'crossfade',
      duration: 0.75,
      metadata: {},
    }];
    withTransition.tracks[0].clips.push({
      id: 'clp2',
      assetId: 'outro.mp4',
      start: 5,
      end: 10,
      in: 0,
      out: 5,
      source: 'upload',
      name: 'Outro',
    });
    const withoutTransition = docWithClipAt(2, 0);
    withoutTransition.tracks[0].clips.push({
      id: 'clp2',
      assetId: 'outro.mp4',
      start: 5,
      end: 10,
      in: 0,
      out: 5,
      source: 'upload',
      name: 'Outro',
    });

    fetchMock
      .mockResolvedValueOnce(json({ timeline: { doc: withoutTransition, version: 1, timelineId: 'tl1', projectId: 'p1' } }))
      .mockResolvedValueOnce(json({ doc: withTransition, version: 2, timelineId: 'tl1', projectId: 'p1', undo_cursor_seq: 2, can_redo: true }))
      .mockResolvedValueOnce(json({ doc: withoutTransition, version: 3, timelineId: 'tl1', projectId: 'p1', undo_cursor_seq: 3, can_redo: true }))
      .mockResolvedValueOnce(json({ doc: withTransition, version: 4, timelineId: 'tl1', projectId: 'p1', undo_cursor_seq: 4, can_redo: false }));

    await renderHarness();

    await act(async () => {
      window.__editor?.addTransition('clp1', 'crossfade', 0.75);
    });

    expect(transitionTexts()).toContain('tr_cross:clp1→clp2:crossfade:0.75');
    const postBody = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    expect(fetchMock.mock.calls[1][0]).toBe('/api/timelines/p1/ops');
    expect(postBody).toMatchObject({
      baseVersion: 1,
      actor: 'human',
      ops: [{
        op: 'addTransition',
        actor: 'human',
        timelineId: 'tl1',
        trackId: 'v1',
        clipId: 'clp1',
        payload: {
          clipId: 'clp1',
          trackId: 'v1',
          fromClipId: 'clp1',
          toClipId: 'clp2',
          kind: 'crossfade',
          duration: 0.75,
        },
      }],
    });

    await act(async () => {
      await window.__editor?.undo();
    });
    expect(transitionTexts()).toEqual([]);
    await act(async () => {
      await window.__editor?.redo();
    });
    expect(transitionTexts()).toEqual(['tr_cross:clp1→clp2:crossfade:0.75']);
  });

  it('adds text through the useEditor op path and redraws undo/redo from server docs', async () => {
    const withText = docWithClipAt(2, 0);
    withText.tracks[2].clips.push({
      id: 'txt_hello',
      assetId: '',
      start: 2,
      end: 5,
      in: 0,
      out: 3,
      source: 'text',
      name: 'Hello',
      text: 'Hello',
      transform: { x: 120, y: 80 },
      effects: [],
    });
    const withoutText = docWithClipAt(2, 0);

    fetchMock
      .mockResolvedValueOnce(json({ timeline: { doc: withoutText, version: 1, timelineId: 'tl1', projectId: 'p1' } }))
      .mockResolvedValueOnce(json({ doc: withText, version: 2, timelineId: 'tl1', projectId: 'p1', undo_cursor_seq: 2, can_redo: true }))
      .mockResolvedValueOnce(json({ doc: withoutText, version: 3, timelineId: 'tl1', projectId: 'p1', undo_cursor_seq: 3, can_redo: true }))
      .mockResolvedValueOnce(json({ doc: withText, version: 4, timelineId: 'tl1', projectId: 'p1', undo_cursor_seq: 4, can_redo: false }));

    await renderHarness();

    await act(async () => {
      window.__editor?.addText('Hello', 2, 3, { x: 120, y: 80 });
    });

    expect(clipTexts().some((text) => /^txt_[a-z0-9_]+:2-3:Hello$/.test(text))).toBe(true);
    const postBody = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    const textClip = postBody.ops[0].payload.clip;
    expect(textClip.id).toMatch(/^txt_[a-z0-9_]+$/);
    expect(fetchMock.mock.calls[1][0]).toBe('/api/timelines/p1/ops');
    expect(postBody).toMatchObject({
      baseVersion: 1,
      actor: 'human',
      ops: [{
        op: 'addText',
        actor: 'human',
        timelineId: 'tl1',
        trackId: 't1',
        payload: {
          text: 'Hello',
          start: 2,
          end: 5,
          in: 0,
          out: 3,
          clip: {
            assetId: '',
            start: 2,
            end: 5,
            in: 0,
            out: 3,
            transform: { x: 120, y: 80 },
            effects: [],
            source: 'text',
            name: 'Hello',
            text: 'Hello',
          },
        },
      }],
    });

    await act(async () => {
      await window.__editor?.undo();
    });
    expect(clipTexts().some((text) => /^txt_[a-z0-9_]+:2-3:Hello$/.test(text))).toBe(false);
    await act(async () => {
      await window.__editor?.redo();
    });
    expect(clipTexts().some((text) => /^txt_[a-z0-9_]+:2-3:Hello$/.test(text))).toBe(true);
  });

  it('sets transform and volume through the useEditor op path with optimistic apply and undo/redo', async () => {
    const withTransformAndVolume = docWithTransformAndVolume(2);
    const withoutTransformAndVolume = docWithClipAt(1, 0);

    fetchMock
      .mockResolvedValueOnce(json({ timeline: { doc: withoutTransformAndVolume, version: 1, timelineId: 'tl1', projectId: 'p1' } }))
      .mockResolvedValueOnce(json({ doc: withTransformAndVolume, version: 2, timelineId: 'tl1', projectId: 'p1', undo_cursor_seq: 2, can_redo: true }))
      .mockResolvedValueOnce(json({ doc: withTransformAndVolume, version: 3, timelineId: 'tl1', projectId: 'p1', undo_cursor_seq: 3, can_redo: true }))
      .mockResolvedValueOnce(json({ doc: withoutTransformAndVolume, version: 4, timelineId: 'tl1', projectId: 'p1', undo_cursor_seq: 4, can_redo: true }))
      .mockResolvedValueOnce(json({ doc: withTransformAndVolume, version: 5, timelineId: 'tl1', projectId: 'p1', undo_cursor_seq: 5, can_redo: false }));

    await renderHarness();

    await act(async () => {
      window.__editor?.setTransform('clp1', { x: 30, y: -20, scale: 1.25, opacity: 0.8 });
    });
    await act(async () => {
      window.__editor?.setVolume('clp1', 0.5);
    });

    expect(window.__editor?.project.tracks[0].clips[0].transform).toEqual({ x: 30, y: -20, scale: 1.25, opacity: 0.8 });
    expect(window.__editor?.project.tracks[0].clips[0].volume).toBe(0.5);

    const transformPost = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    const volumePost = JSON.parse((fetchMock.mock.calls[2][1] as RequestInit).body as string);
    expect(fetchMock.mock.calls.slice(1, 3).map((call) => call[0])).toEqual([
      '/api/timelines/p1/ops',
      '/api/timelines/p1/ops',
    ]);
    expect(transformPost).toMatchObject({
      baseVersion: 1,
      actor: 'human',
      ops: [{
        op: 'setTransform',
        actor: 'human',
        timelineId: 'tl1',
        trackId: 'v1',
        clipId: 'clp1',
        payload: { transform: { x: 30, y: -20, scale: 1.25, opacity: 0.8 } },
      }],
    });
    expect(volumePost).toMatchObject({
      baseVersion: 2,
      actor: 'human',
      ops: [{
        op: 'setVolume',
        actor: 'human',
        timelineId: 'tl1',
        trackId: 'v1',
        clipId: 'clp1',
        payload: { volume: 0.5 },
      }],
    });

    await act(async () => {
      await window.__editor?.undo();
    });
    expect(window.__editor?.project.tracks[0].clips[0].transform).toBeUndefined();
    expect(window.__editor?.project.tracks[0].clips[0].volume).toBeUndefined();

    await act(async () => {
      await window.__editor?.redo();
    });
    expect(window.__editor?.project.tracks[0].clips[0].transform).toEqual({ x: 30, y: -20, scale: 1.25, opacity: 0.8 });
    expect(window.__editor?.project.tracks[0].clips[0].volume).toBe(0.5);
  });

  it('rebases setTransform on 409 and retries POST /ops with the fresh baseVersion', async () => {
    const fresh = docWithTransformAndVolume(2, 10, 0, 1, 1, 1);
    const retryCommitted = docWithTransformAndVolume(3);

    fetchMock
      .mockResolvedValueOnce(json({ timeline: { doc: docWithClipAt(1, 0), version: 1, timelineId: 'tl1', projectId: 'p1' } }))
      .mockResolvedValueOnce(json({ error: { code: 'timeline_version_conflict' }, message: 'timeline_version_conflict' }, 409))
      .mockResolvedValueOnce(json({ timeline: { doc: fresh, version: 2, timelineId: 'tl1', projectId: 'p1', undo_cursor_seq: 2, can_redo: false } }))
      .mockResolvedValueOnce(json({ doc: retryCommitted, version: 3, timelineId: 'tl1', projectId: 'p1', undo_cursor_seq: 3, can_redo: false }));

    await renderHarness();

    await act(async () => {
      window.__editor?.setTransform('clp1', { x: 30, y: -20, scale: 1.25, opacity: 0.8 });
    });
    await waitFor(() => clipTexts().length > 0 && window.__editor?.project.tracks[0].clips[0].transform?.scale === 1.25);

    const firstPost = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    const secondPost = JSON.parse((fetchMock.mock.calls[3][1] as RequestInit).body as string);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/api/timelines/p1',
      '/api/timelines/p1/ops',
      '/api/timelines/p1',
      '/api/timelines/p1/ops',
    ]);
    expect(firstPost.baseVersion).toBe(1);
    expect(secondPost.baseVersion).toBe(2);
    expect((secondPost.ops as TimelineOp[])[0]).toMatchObject({
      op: 'setTransform',
      clipId: 'clp1',
      trackId: 'v1',
      payload: { transform: { x: 30, y: -20, scale: 1.25, opacity: 0.8 } },
    });
    expect(window.__editor?.project.tracks[0].clips[0].transform).toEqual({ x: 30, y: -20, scale: 1.25, opacity: 0.8 });
  });

  it('adds and sets clip effects through the useEditor op path', async () => {
    const withAddEffect = docWithClipAt(2, 0);
    withAddEffect.tracks[0].clips[0].effects = [{
      id: 'fx_color',
      type: 'colorGrade',
      name: 'Cinematic',
      params: { contrast: 1.2 },
    }];
    const withSetEffect = docWithClipAt(3, 0);
    withSetEffect.tracks[0].clips[0].effects = [{
      id: 'fx_color',
      type: 'blur',
      name: 'Soft blur',
      params: { radius: 8 },
    }];
    const withoutEffect = docWithClipAt(1, 0);

    fetchMock
      .mockResolvedValueOnce(json({ timeline: { doc: withoutEffect, version: 1, timelineId: 'tl1', projectId: 'p1' } }))
      .mockResolvedValueOnce(json({ doc: withAddEffect, version: 2, timelineId: 'tl1', projectId: 'p1', undo_cursor_seq: 2, can_redo: true }))
      .mockResolvedValueOnce(json({ doc: withoutEffect, version: 3, timelineId: 'tl1', projectId: 'p1', undo_cursor_seq: 3, can_redo: true }))
      .mockResolvedValueOnce(json({ doc: withAddEffect, version: 4, timelineId: 'tl1', projectId: 'p1', undo_cursor_seq: 4, can_redo: true }))
      .mockResolvedValueOnce(json({ doc: withSetEffect, version: 5, timelineId: 'tl1', projectId: 'p1', undo_cursor_seq: 5, can_redo: false }));

    await renderHarness();

    await act(async () => {
      window.__editor?.addEffect({ id: 'fx_color', type: 'colorGrade', name: 'Cinematic', params: { contrast: 1.2 } });
    });
    expect(effectTexts()).toContain('colorGrade');
    const addPost = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    expect(addPost).toMatchObject({
      baseVersion: 1,
      actor: 'human',
      ops: [{
        op: 'addEffect',
        actor: 'human',
        timelineId: 'tl1',
        trackId: 'v1',
        clipId: 'clp1',
        payload: {
          effect: {
            id: 'fx_color',
            type: 'colorGrade',
            name: 'Cinematic',
            params: { contrast: 1.2 },
          },
        },
      }],
    });

    await act(async () => {
      await window.__editor?.undo();
    });
    expect(effectTexts()).toEqual([]);
    await act(async () => {
      await window.__editor?.redo();
    });
    expect(effectTexts()).toContain('colorGrade');

    await act(async () => {
      window.__editor?.setEffect({ id: 'fx_color', type: 'blur', name: 'Soft blur', params: { radius: 8 } });
    });
    expect(effectTexts()).toContain('blur');
    const setPost = JSON.parse((fetchMock.mock.calls[4][1] as RequestInit).body as string);
    expect(setPost).toMatchObject({
      baseVersion: 4,
      actor: 'human',
      ops: [{
        op: 'setEffect',
        actor: 'human',
        timelineId: 'tl1',
        trackId: 'v1',
        clipId: 'clp1',
        payload: {
          effectId: 'fx_color',
          effect: {
            id: 'fx_color',
            type: 'blur',
            name: 'Soft blur',
            params: { radius: 8 },
          },
          index: 0,
        },
      }],
    });
  });

});
