import { useState } from 'react';
import { Plus, Download, Play, ChevronRight, User } from 'lucide-react';
import clsx from 'clsx';
import type { WorkspaceMode } from '../types';

interface Props {
  projectName: string;
  onExport: () => void;
  onRender: () => void;
}

export function TopBar({ projectName, onExport, onRender }: Props) {
  const [mode, setMode] = useState<WorkspaceMode>('edit');

  return (
    <header
      className="col-span-full flex items-center justify-between h-11 px-4 bg-bg-1 border-b border-border-1 z-10"
      style={{ gridColumn: '1 / -1' }}
    >
      {/* Brand + breadcrumb */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 font-semibold text-[13px] tracking-tight">
          <div
            className="w-[22px] h-[22px] rounded-md flex items-center justify-center text-white font-bold text-[12px] tracking-tighter"
            style={{ background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)' }}
          >
            V
          </div>
          <span>Vireo Studio</span>
        </div>
        <nav className="flex items-center gap-0.5 text-[12px] text-ink-3 ml-4">
          <button className="px-2 py-0.5 rounded hover:bg-bg-2 hover:text-ink-1 transition-colors">
            Projects
          </button>
          <ChevronRight size={12} className="text-ink-4" />
          <button className="px-2 py-0.5 rounded hover:bg-bg-2 hover:text-ink-1 transition-colors">
            {projectName}
          </button>
          <ChevronRight size={12} className="text-ink-4" />
          <button className="px-2 py-0.5 rounded text-ink-1">
            v3 — color graded
          </button>
        </nav>
      </div>

      {/* Center mode switcher */}
      <div className="flex items-center gap-0.5 bg-bg-2 border border-border-1 rounded-md p-0.5 text-[11px] text-ink-2">
        {(['edit', 'review', 'compare'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={clsx(
              'px-3 py-1 rounded transition-all duration-[120ms]',
              mode === m
                ? 'bg-bg-3 text-ink-1'
                : 'hover:text-ink-1',
            )}
          >
            {m === 'edit' ? 'Edit' : m === 'review' ? 'Review' : 'Compare'}
          </button>
        ))}
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-2">
        <button className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-ink-2 hover:text-ink-1 hover:bg-bg-2 rounded-md transition-colors">
          <Plus size={13} strokeWidth={1.6} />
          Invite
        </button>
        <button
          onClick={onExport}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-ink-1 bg-bg-2 border border-border-2 hover:bg-bg-3 rounded-md transition-colors"
        >
          <Download size={13} strokeWidth={1.6} />
          Export
        </button>
        <button
          onClick={onRender}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-white bg-accent hover:bg-accent-h rounded-md transition-colors"
        >
          <Play size={13} strokeWidth={1.6} fill="currentColor" />
          Render
        </button>
        <button
          className="w-[26px] h-[26px] rounded-full flex items-center justify-center text-white text-[11px] font-semibold ml-1"
          style={{ background: 'linear-gradient(135deg, #f59e0b, #ef4444)' }}
          title="Anna K."
        >
          <User size={14} />
        </button>
      </div>
    </header>
  );
}
