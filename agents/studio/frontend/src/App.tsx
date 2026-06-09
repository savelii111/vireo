import { useState, useEffect, useCallback, useRef } from 'react';
import { TopBar } from './components/TopBar';
import { SideRail } from './components/SideRail';
import { Preview } from './components/Preview';
import { Inspector } from './components/Inspector';
import { Timeline } from './components/Timeline';
import { ChatPanel } from './components/ChatPanel';
import { useEditor } from './hooks/useEditor';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import type { PreviewTab } from './types';

export default function App() {
  const [rail, setRail] = useState('media');
  const [previewTab, setPreviewTab] = useState<PreviewTab>('program');
  const editor = useEditor();

  // ----- Clip drag from Timeline (custom event bridge) -----
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('[data-timeline-project]');
    if (!root) return;
    const onDrag = (e: Event) => {
      const ce = e as CustomEvent<{ clipId: string; mode: 'move' | 'resize-l' | 'resize-r'; deltaSec: number }>;
      const { clipId, mode, deltaSec } = ce.detail;
      const clip = editor.project.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
      if (!clip) return;
      if (mode === 'move') {
        editor.updateClip(clipId, { start_sec: Math.max(0, clip.start_sec + deltaSec) });
      } else if (mode === 'resize-r') {
        editor.updateClip(clipId, { duration_sec: Math.max(0.1, clip.duration_sec + deltaSec) });
      } else if (mode === 'resize-l') {
        // shift start + adjust in-point; keep end fixed
        const newStart = Math.max(0, clip.start_sec + deltaSec);
        const actualDelta = newStart - clip.start_sec;
        editor.updateClip(clipId, {
          start_sec: newStart,
          duration_sec: Math.max(0.1, clip.duration_sec - actualDelta),
          in_sec: Math.max(0, clip.in_sec + actualDelta),
        });
      }
    };
    root.addEventListener('vireo:clip-drag', onDrag as EventListener);
    return () => root.removeEventListener('vireo:clip-drag', onDrag as EventListener);
  }, [editor]);

  // ----- Undo / Redo (in-memory ring buffer) -----
  const historyRef = useRef<string[]>([]);   // JSON snapshots
  const futureRef = useRef<string[]>([]);
  const lastSnapshotRef = useRef<string>(JSON.stringify(editor.project));
  const undo = useCallback(() => {
    const cur = JSON.stringify(editor.project);
    if (historyRef.current.length === 0) return;
    futureRef.current.push(cur);
    const prev = historyRef.current.pop()!;
    editor.setProject(JSON.parse(prev));
    lastSnapshotRef.current = prev;
  }, [editor]);
  const redo = useCallback(() => {
    const cur = JSON.stringify(editor.project);
    if (futureRef.current.length === 0) return;
    historyRef.current.push(cur);
    const next = futureRef.current.pop()!;
    editor.setProject(JSON.parse(next));
    lastSnapshotRef.current = next;
  }, [editor]);
  // Snapshot every 600ms when project changes
  useEffect(() => {
    const id = setInterval(() => {
      const cur = JSON.stringify(editor.project);
      if (cur !== lastSnapshotRef.current) {
        historyRef.current.push(lastSnapshotRef.current);
        if (historyRef.current.length > 50) historyRef.current.shift();
        futureRef.current = [];
        lastSnapshotRef.current = cur;
      }
    }, 600);
    return () => clearInterval(id);
  }, [editor.project]);

  // ----- Edit actions: split / delete / duplicate / escape -----
  const splitAtPlayhead = useCallback(() => {
    if (!editor.selectedClipId) return;
    const clip = editor.project.tracks.flatMap((t) => t.clips).find((c) => c.id === editor.selectedClipId);
    if (!clip) return;
    const cutPoint = editor.playhead - clip.start_sec;
    if (cutPoint <= 0.1 || cutPoint >= clip.duration_sec - 0.1) return;
    const leftDur = cutPoint;
    const rightDur = clip.duration_sec - cutPoint;
    editor.updateClip(clip.id, { duration_sec: leftDur });
    // The "right half" is implicitly the next sibling we don't model;
    // in a richer editor we'd insert a new clip here. For v1 we just
    // trim the original clip and toast.
    console.log(`[split] cut at ${editor.playhead.toFixed(2)}s · left=${leftDur.toFixed(2)}s right=${rightDur.toFixed(2)}s`);
  }, [editor]);
  const deleteSelected = useCallback(() => {
    if (!editor.selectedClipId) return;
    const track = editor.project.tracks.find((t) => t.clips.some((c) => c.id === editor.selectedClipId));
    if (!track) return;
    editor.setProject({
      ...editor.project,
      tracks: editor.project.tracks.map((t) =>
        t.id === track.id ? { ...t, clips: t.clips.filter((c) => c.id !== editor.selectedClipId) } : t,
      ),
    });
    editor.selectClip(null);
  }, [editor]);
  const duplicateSelected = useCallback(() => {
    if (!editor.selectedClipId) return;
    const clip = editor.project.tracks.flatMap((t) => t.clips).find((c) => c.id === editor.selectedClipId);
    if (!clip) return;
    const track = editor.project.tracks.find((t) => t.clips.some((c) => c.id === clip.id));
    if (!track) return;
    const newClip = {
      ...clip,
      id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      start_sec: clip.start_sec + clip.duration_sec,
    };
    editor.setProject({
      ...editor.project,
      tracks: editor.project.tracks.map((t) =>
        t.id === track.id ? { ...t, clips: [...t.clips, newClip] } : t,
      ),
    });
    editor.selectClip(newClip.id);
  }, [editor]);
  const step = useCallback((delta: number) => {
    editor.seek(editor.playhead + delta);
  }, [editor]);

  // ----- Wire keyboard shortcuts -----
  useKeyboardShortcuts({
    onTogglePlay: editor.togglePlay,
    onSplitAtPlayhead: splitAtPlayhead,
    onUndo: undo,
    onRedo: redo,
    onDelete: deleteSelected,
    onDuplicate: duplicateSelected,
    onSetTool: editor.setTool,
    onZoomIn: () => editor.setZoom(Math.min(200, editor.zoom + 20)),
    onZoomOut: () => editor.setZoom(Math.max(10, editor.zoom - 20)),
    onEscape: () => editor.selectClip(null),
    onStep: step,
  });

  const handleQuickAction = (action: string) => {
    if (action === 'cinematic') console.log('[quick] cinematic grade on', editor.selectedClip?.label);
    else if (action === 'split') splitAtPlayhead();
    else if (action === 'undo') undo();
    else console.log('[quick action]', action);
  };

  const handleExport = () => console.log('[export]');
  const handleRender = () => console.log('[render]');

  return (
    <div
      className="grid bg-bg-0"
      style={{
        gridTemplateColumns: '56px 1fr 380px',
        gridTemplateRows: '44px 1fr',
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
      }}
    >
      <TopBar
        projectName={editor.project.name}
        onExport={handleExport}
        onRender={handleRender}
      />

      <SideRail active={rail} onChange={setRail} />

      <main
        className="grid bg-bg-0 min-w-0 min-h-0 overflow-hidden"
        style={{
          gridTemplateRows: 'minmax(0, 1fr) 240px minmax(0, 280px)',
        }}
      >
        <Preview
          tab={previewTab}
          onTabChange={setPreviewTab}
          playing={editor.playing}
          onTogglePlay={editor.togglePlay}
          playhead={editor.playhead}
          duration={editor.project.duration_sec}
          fps={editor.project.fps}
          width={editor.project.width}
          height={editor.project.height}
        />
        <Inspector clip={editor.selectedClip} onQuickAction={handleQuickAction} />
        <Timeline
          project={editor.project}
          tool={editor.tool}
          onToolChange={editor.setTool}
          selectedClipId={editor.selectedClipId}
          onClipSelect={editor.selectClip}
          playhead={editor.playhead}
          onSeek={editor.seek}
          zoom={editor.zoom}
          onZoomChange={editor.setZoom}
        />
      </main>

      <ChatPanel />
    </div>
  );
}
