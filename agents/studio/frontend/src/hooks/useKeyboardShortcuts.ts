// useKeyboardShortcuts — global keyboard handler for editor shortcuts.
//
// Bound shortcuts:
//   Space         play / pause
//   J / K / L     step back / pause / step forward
//   ← / →         prev / next edit (or 1-frame nudge if no edit nearby)
//   I / O         set in / out point
//   ⌘K / Ctrl+K   split clip at playhead
//   ⌘Z / Ctrl+Z   undo
//   ⌘⇧Z / Ctrl+Y redo
//   ⌘D / Ctrl+D   duplicate clip
//   Delete        remove selected clip
//   V             select tool
//   C             razor tool
//   ⌘+ / ⌘-       zoom in / out timeline
//   Escape        deselect
//
// Hooks fire-and-forget; consumers (Inspector, Timeline) handle the
// actual mutations through their own state.

import { useEffect } from 'react';

export type ShortcutHandlers = {
  onTogglePlay: () => void;
  onSplitAtPlayhead: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onSetTool: (t: 'select' | 'razor') => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onEscape: () => void;
  onStep: (delta: number) => void;
};

const isTypingInField = (target: EventTarget | null): boolean => {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
  if (target.isContentEditable) return true;
  return false;
};

export function useKeyboardShortcuts(h: ShortcutHandlers) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't hijack typing in inputs/textarea/contenteditable
      // (except for the Space key, which is allowed everywhere)
      if (isTypingInField(e.target) && e.key !== ' ') {
        // Ctrl/Cmd shortcuts still work
        if (!(e.ctrlKey || e.metaKey)) return;
      }

      const cmd = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;

      // ----- Tool selection -----
      if (!cmd && !shift && e.key === 'v') {
        e.preventDefault();
        h.onSetTool('select');
        return;
      }
      if (!cmd && !shift && e.key === 'c') {
        e.preventDefault();
        h.onSetTool('razor');
        return;
      }

      // ----- Transport -----
      if (e.key === ' ' && !cmd) {
        e.preventDefault();
        h.onTogglePlay();
        return;
      }
      if (e.key === 'j' && !cmd) {
        e.preventDefault();
        h.onStep(-1);
        return;
      }
      if (e.key === 'k' && !cmd) {
        e.preventDefault();
        h.onTogglePlay();
        return;
      }
      if (e.key === 'l' && !cmd) {
        e.preventDefault();
        h.onStep(1);
        return;
      }
      if (e.key === 'ArrowLeft' && !cmd) {
        e.preventDefault();
        h.onStep(-1);
        return;
      }
      if (e.key === 'ArrowRight' && !cmd) {
        e.preventDefault();
        h.onStep(1);
        return;
      }
      if (e.key === 'Escape') {
        h.onEscape();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (isTypingInField(e.target)) return;
        e.preventDefault();
        h.onDelete();
        return;
      }

      // ----- Cmd / Ctrl shortcuts -----
      if (cmd && !shift && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        h.onSplitAtPlayhead();
        return;
      }
      if (cmd && !shift && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        h.onUndo();
        return;
      }
      if (cmd && shift && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        h.onRedo();
        return;
      }
      if (cmd && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        h.onRedo();
        return;
      }
      if (cmd && !shift && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        h.onDuplicate();
        return;
      }
      if (cmd && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        h.onZoomIn();
        return;
      }
      if (cmd && e.key === '-') {
        e.preventDefault();
        h.onZoomOut();
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [h]);
}
