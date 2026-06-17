import { useState, Suspense, lazy, useEffect, useRef, useMemo } from 'react';
import clsx from 'clsx';
import type { PreviewTab } from './types';
import { useEditor } from './hooks/useEditor';
import { activeTextClipsAt, activeVideoClipAt } from './timelinePlayback';

// Lazy-load heavy components — splits initial bundle
const TopBar = lazy(() => import('./components/TopBar').then(m => ({ default: m.TopBar })));
const SideRail = lazy(() => import('./components/SideRail').then(m => ({ default: m.SideRail })));
const Preview = lazy(() => import('./components/Preview').then(m => ({ default: m.Preview })));
const Inspector = lazy(() => import('./components/Inspector').then(m => ({ default: m.Inspector })));
const Timeline = lazy(() => import('./components/Timeline').then(m => ({ default: m.Timeline })));
const MediaPanel = lazy(() => import('./components/MediaPanel').then(m => ({ default: m.MediaPanel })));
const ChatPanel = lazy(() => import('./components/ChatPanel').then(m => ({ default: m.ChatPanel })));

function Fallback({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center h-full w-full bg-bg-1 text-ink-3 text-xs">
      <div className="flex flex-col items-center gap-2">
        <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        <span>Loading {label}…</span>
      </div>
    </div>
  );
}

// ---------- Keyboard shortcuts ----------
const SHORTCUTS: Array<{ keys: string; action: string }> = [
  { keys: 'Space', action: 'Play / pause' },
  { keys: 'J / K / L', action: 'Shuttle back / pause / forward' },
  { keys: '← →', action: 'Step ±1 second' },
  { keys: 'I / O', action: 'Set in / out point' },
  { keys: 'V', action: 'Select tool' },
  { keys: 'C', action: 'Razor tool' },
  { keys: 'Y', action: 'Slip tool' },
  { keys: 'U', action: 'Slide tool' },
  { keys: '⌘ K', action: 'Split at playhead' },
  { keys: '⌘ Z', action: 'Undo' },
  { keys: '⌘ ⇧ Z', action: 'Redo' },
  { keys: '⌘ D', action: 'Duplicate clip' },
  { keys: 'Delete', action: 'Delete clip' },
  { keys: '⌘ + / −', action: 'Zoom timeline' },
  { keys: 'Esc', action: 'Close dialogs' },
];

function ShortcutHelp({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="bg-bg-2 border border-border-1 rounded-lg w-[480px] max-w-full max-h-[80vh] overflow-y-auto p-6"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-ink-1">Keyboard Shortcuts</h2>
          <button onClick={onClose} className="text-ink-3 hover:text-ink-1 text-sm px-2 py-1 rounded hover:bg-bg-3">✕</button>
        </div>
        <div className="space-y-1.5">
          {SHORTCUTS.map(s => (
            <div key={s.keys} className="flex items-center justify-between text-xs">
              <span className="text-ink-2">{s.action}</span>
              <kbd className="px-2 py-0.5 bg-bg-3 border border-border-1 rounded font-mono text-[10px] text-ink-1">{s.keys}</kbd>
            </div>
          ))}
        </div>
        <p className="mt-4 text-[10px] text-ink-3">Press ? to toggle · ⌘K opens command palette</p>
      </div>
    </div>
  );
}

// ---------- Command Palette ----------
interface CmdItem {
  label: string;
  shortcut?: string;
  action: () => void;
}

function CommandPalette({ onClose, commands }: { onClose: () => void; commands: CmdItem[] }) {
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const filtered = useMemo(() => {
    if (!query) return commands;
    const q = query.toLowerCase();
    return commands.filter(c => c.label.toLowerCase().includes(q));
  }, [query, commands]);

  useEffect(() => { setSel(0); }, [query]);

  const run = (c: CmdItem) => { c.action(); onClose(); };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(i => Math.min(i + 1, filtered.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSel(i => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && filtered[sel]) run(filtered[sel]);
    if (e.key === 'Escape') onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-start justify-center pt-[18vh] p-6" onClick={onClose}>
      <div className="bg-bg-2 border border-border-1 rounded-lg w-[520px] max-w-full shadow-2xl" onClick={e => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={onKey}
          placeholder="Type a command…"
          className="w-full px-4 py-3 bg-transparent border-b border-border-1 text-sm text-ink-1 outline-none placeholder:text-ink-3"
        />
        <div className="max-h-[320px] overflow-y-auto p-1">
          {filtered.length === 0 && (
            <p className="text-xs text-ink-3 px-4 py-3">No matching commands</p>
          )}
          {filtered.map((c, i) => (
            <button
              key={c.label}
              onClick={() => run(c)}
              className={`w-full flex items-center justify-between px-4 py-2.5 text-xs rounded transition-colors ${
                i === sel ? 'bg-accent/10 text-accent' : 'text-ink-2 hover:bg-bg-3'
              }`}
            >
              <span>{c.label}</span>
              {c.shortcut && (
                <kbd className="ml-4 px-2 py-0.5 bg-bg-3 border border-border-1 rounded font-mono text-[10px] text-ink-3">
                  {c.shortcut}
                </kbd>
              )}
            </button>
          ))}
        </div>
        <div className="px-4 py-2 border-t border-border-1 text-[10px] text-ink-3 flex gap-4">
          <span>↑↓ navigate</span><span>↵ select</span><span>esc close</span>
        </div>
      </div>
    </div>
  );
}

// ---------- Main App ----------
export default function App() {
  const editor = useEditor();
  const [helpOpen, setHelpOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [previewTab, setPreviewTab] = useState<PreviewTab>('program');
  const [rightPanel, setRightPanel] = useState<'inspector' | 'chat'>('inspector');
  const chatProjectId = useMemo(() => localStorage.getItem('vireo.activeProjectId') || undefined, []);
  const chatConversationId = useMemo(() => localStorage.getItem('vireo.conversation_id') || undefined, []);
  const activeVideoClip = useMemo(() => activeVideoClipAt(editor.project, editor.playhead), [editor.project, editor.playhead]);
  const activeTextClips = useMemo(() => activeTextClipsAt(editor.project, editor.playhead), [editor.project, editor.playhead]);
  const selectedTrack = useMemo(() => {
    const selectedClip = editor.selectedClip;
    if (!selectedClip) return null;
    return editor.project.tracks.find((track) => track.id === selectedClip.track_id) ?? null;
  }, [editor.project, editor.selectedClip]);

  // Build command palette items
  const commands: CmdItem[] = useMemo(() => [
    { label: 'Toggle play / pause', shortcut: 'Space', action: editor.togglePlay },
    { label: 'Undo', shortcut: '⌘Z', action: editor.undo },
    { label: 'Redo', shortcut: '⌘⇧Z', action: editor.redo },
    { label: 'Split at playhead', shortcut: '⌘K', action: editor.splitAtPlayhead },
    { label: 'Duplicate clip', shortcut: '⌘D', action: editor.duplicateSelected },
    { label: 'Delete clip', shortcut: 'Del', action: editor.deleteSelected },
    { label: 'Tool: Select', shortcut: 'V', action: () => editor.setTool('select') },
    { label: 'Tool: Razor', shortcut: 'C', action: () => editor.setTool('razor') },
    { label: 'Tool: Slip', shortcut: 'Y', action: () => editor.setTool('slip') },
    { label: 'Tool: Slide', shortcut: 'U', action: () => editor.setTool('slide') },
    { label: 'Zoom in', shortcut: '⌘+', action: () => editor.setZoom(Math.min(400, editor.zoom * 1.25)) },
    { label: 'Zoom out', shortcut: '⌘-', action: () => editor.setZoom(Math.max(20, editor.zoom * 0.8)) },
    { label: 'Toggle help', shortcut: '?', action: () => setHelpOpen(v => !v) },
  ], [editor]);

  // Global keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const tag = target?.tagName;
      const inInput = tag === 'TEXTAREA' || tag === 'INPUT' || target?.isContentEditable;

      // Cmd/Ctrl+K → command palette (works everywhere)
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setCmdOpen(v => !v);
        return;
      }
      // Escape → close open dialogs
      if (e.key === 'Escape') {
        if (cmdOpen) { setCmdOpen(false); return; }
        if (helpOpen) { setHelpOpen(false); return; }
        return;
      }

      // Don't intercept when typing in text fields
      if (inInput) return;

      // ? → toggle help
      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        setHelpOpen(v => !v);
        return;
      }
      // Space → play/pause
      if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        editor.togglePlay();
        return;
      }
      // J/K/L shuttle
      if (e.key === 'j' || e.key === 'J') { e.preventDefault(); editor.seekBy(-5); return; }
      if (e.key === 'k' || e.key === 'K') { e.preventDefault(); editor.togglePlay(); return; }
      if (e.key === 'l' || e.key === 'L') { e.preventDefault(); editor.seekBy(5); return; }
      // Arrow keys step
      if (e.key === 'ArrowLeft') { e.preventDefault(); editor.seekBy(-1); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); editor.seekBy(1); return; }
      // Tool shortcuts
      if (e.key === 'v' || e.key === 'V') { e.preventDefault(); editor.setTool('select'); return; }
      if (e.key === 'c' || e.key === 'C') { e.preventDefault(); editor.setTool('razor'); return; }
      if (e.key === 'y' || e.key === 'Y') { e.preventDefault(); editor.setTool('slip'); return; }
      if (e.key === 'u' || e.key === 'U') { e.preventDefault(); editor.setTool('slide'); return; }
      // Mod+Z undo
      if (mod && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
        e.preventDefault(); editor.undo(); return;
      }
      // Mod+Shift+Z or Mod+Y redo
      if (mod && ((e.key === 'z' || e.key === 'Z') && e.shiftKey || e.key === 'y' || e.key === 'Y')) {
        e.preventDefault(); editor.redo(); return;
      }
      // Mod+D duplicate
      if (mod && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault(); editor.duplicateSelected(); return;
      }
      // Mod+K split
      if (mod && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault(); editor.splitAtPlayhead(); return;
      }
      // Delete
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault(); editor.deleteSelected(); return;
      }
      // Mod+/- zoom
      if (mod && (e.key === '+' || e.key === '=')) {
        e.preventDefault(); editor.setZoom(Math.min(400, editor.zoom * 1.25)); return;
      }
      if (mod && (e.key === '-' || e.key === '_')) {
        e.preventDefault(); editor.setZoom(Math.max(20, editor.zoom * 0.8)); return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editor, helpOpen, cmdOpen]);

  return (
    <div className="h-screen w-screen overflow-hidden bg-bg-0 text-ink-1">
      <div className="grid h-full w-full grid-cols-[56px_minmax(0,1fr)_360px] grid-rows-[44px_minmax(0,1fr)_minmax(260px,38vh)]">
        <Suspense fallback={<Fallback label="top bar" />}>
          <TopBar
            projectName={editor.project.name}
            onExport={() => {}}
            onRender={() => {}}
          />
        </Suspense>

        <Suspense fallback={<Fallback label="rail" />}>
          <SideRail active="media" onChange={() => {}} />
        </Suspense>

        <div className="grid min-h-0 min-w-0 grid-rows-[minmax(220px,34vh)_minmax(0,1fr)] overflow-hidden border border-border-1 bg-bg-1">
          <Suspense fallback={<Fallback label="media panel" />}>
            <MediaPanel projectId={editor.projectId} />
          </Suspense>
          <Suspense fallback={<Fallback label="workspace" />}>
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
              activeVideoClip={activeVideoClip}
              activeTextClips={activeTextClips}
            />
          </Suspense>
        </div>

        <div className="min-h-0 min-w-0 overflow-hidden border-l border-border-1 bg-bg-1">
          <div className="grid h-full grid-rows-[38px_minmax(0,1fr)]">
            <div className="flex items-center gap-1 border-b border-border-1 px-2">
              <button
                onClick={() => setRightPanel('inspector')}
                className={clsx(
                  'flex-1 rounded px-2 py-1 text-[11px] font-semibold tracking-wide transition-all duration-[120ms]',
                  rightPanel === 'inspector' ? 'bg-bg-2 text-ink-1' : 'text-ink-3 hover:bg-bg-2 hover:text-ink-1',
                )}
              >
                Inspector
              </button>
              <button
                onClick={() => setRightPanel('chat')}
                className={clsx(
                  'flex-1 rounded px-2 py-1 text-[11px] font-semibold tracking-wide transition-all duration-[120ms]',
                  rightPanel === 'chat' ? 'bg-bg-2 text-ink-1' : 'text-ink-3 hover:bg-bg-2 hover:text-ink-1',
                )}
              >
                Chat
              </button>
            </div>
            <div className="min-h-0 overflow-hidden">
              {rightPanel === 'inspector' ? (
                <Suspense fallback={<Fallback label="inspector" />}>
                  <Inspector
                    clip={editor.selectedClip}
                    clipId={editor.selectedClipId}
                    track={selectedTrack}
                    playhead={editor.playhead}
                    onQuickAction={(action) => {
                      if (action === 'split') editor.splitAtPlayhead();
                      if (action === 'undo') editor.undo();
                    }}
                    onAddEffect={(effect) => editor.addEffect(effect)}
                    onSetEffect={(effect) => editor.setEffect(effect)}
                    onTransformChange={(transform) => {
                      if (editor.selectedClipId) editor.setTransform(editor.selectedClipId, transform);
                    }}
                    onTitlePropsChange={(titleProps) => {
                      if (editor.selectedClipId) editor.setTitleProps(editor.selectedClipId, titleProps);
                    }}
                    onSetKeyframe={(targetId, param, keyframe) => {
                      if (editor.selectedClipId) editor.setKeyframe(editor.selectedClipId, targetId, param, keyframe);
                    }}
                    onRemoveKeyframe={(targetId, param, time) => {
                      if (editor.selectedClipId) editor.removeKeyframe(editor.selectedClipId, targetId, param, time);
                    }}
                    onVolumeChange={(volume) => {
                      if (editor.selectedClipId) editor.setVolume(editor.selectedClipId, volume);
                    }}
                    onTrackAudioChange={(audio) => {
                      if (selectedTrack) editor.setTrackAudio(selectedTrack.id, audio);
                    }}
                    onClipAudioChange={(audio) => {
                      if (editor.selectedClipId) editor.setClipAudio(editor.selectedClipId, audio);
                    }}
                  />
                </Suspense>
              ) : (
                <Suspense fallback={<Fallback label="chat" />}>
                  <ChatPanel
                    projectId={chatProjectId}
                    conversationId={chatConversationId}
                    onBotInsertClip={(payload) => {
                      editor.applyBotInsertClip(payload);
                      localStorage.setItem('vireo.last_bot_clip', JSON.stringify(payload));
                    }}
                  />
                </Suspense>
              )}
            </div>
          </div>
        </div>

        <div className="col-span-full min-h-0 min-w-0 overflow-hidden">
          <Suspense fallback={<Fallback label="timeline" />}>
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
              onClipMove={editor.moveClip}
              onClipResize={editor.resizeClip}
              onAssetDrop={editor.insertAsset}
              onDragEnd={editor.onDragEnd}
              onUndo={editor.undo}
              onRedo={editor.redo}
              canUndo={editor.canUndo}
              canRedo={editor.canRedo}
              onToggleMute={editor.toggleTrackMute}
              onToggleSolo={editor.toggleTrackSolo}
              onToggleLock={editor.toggleTrackLock}
              onToggleHidden={editor.toggleTrackHidden}
              onAddTransition={(clipId, kind, duration) => editor.addTransition(clipId, kind, duration)}
              onAddText={(text, start, duration, position) => editor.addText(text, start, duration, position)}
            />
          </Suspense>
        </div>
      </div>
      {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} />}
      {cmdOpen && <CommandPalette onClose={() => setCmdOpen(false)} commands={commands} />}
    </div>
  );
}
