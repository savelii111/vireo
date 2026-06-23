import { useState } from 'react';
import { Plus, Download, Play, ChevronRight, User, Folder, FolderPlus } from 'lucide-react';
import clsx from 'clsx';
import type { WorkspaceMode } from '../types';
import { listProjects, createProject, setActiveProjectId } from '../projectOnboarding';

interface Props {
  projectName: string;
  onExport: () => void;
  onRender: () => void;
  // Day 24: project picker. When set, the breadcrumb "Projects"
  // button opens a dropdown to pick / create a project; pick
  // dispatches vireo:active-project-changed and the editor
  // re-fetches the timeline.
  onProjectChanged?: () => void;
}

export function TopBar({ projectName, onExport, onRender, onProjectChanged }: Props) {
  const [mode, setMode] = useState<WorkspaceMode>('edit');
  const [showPicker, setShowPicker] = useState(false);
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function openPicker() {
    setShowPicker((v) => !v);
    if (!showPicker) {
      try {
        const list = await listProjects();
        setProjects(list.map((p) => ({ id: p.id, name: p.name })));
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    }
  }

  function pickProject(id: string) {
    setActiveProjectId(id);
    setShowPicker(false);
    onProjectChanged?.();
  }

  async function createAndPick() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setErr(null);
    try {
      const project = await createProject(name);
      setActiveProjectId(project.id);
      setShowCreate(false);
      setShowPicker(false);
      setNewName('');
      onProjectChanged?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <header
      className="col-span-full flex items-center justify-between h-11 px-4 bg-bg-1 border-b border-border-1 z-10"
      style={{ gridColumn: '1 / -1' }}
    >
      {/* Brand + breadcrumb */}
      <div className="flex items-center gap-3 relative">
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
          <div className="relative">
            <button
              type="button"
              onClick={openPicker}
              data-testid="topbar-projects-button"
              className="px-2 py-0.5 rounded hover:bg-bg-2 hover:text-ink-1 transition-colors flex items-center gap-1"
            >
              <Folder className="w-3 h-3" /> Projects
            </button>
            {showPicker && (
              <div className="absolute z-20 mt-1 left-0 w-72 max-h-80 overflow-y-auto bg-bg-2 border border-border-1 rounded shadow-lg">
                {err && (
                  <div className="p-2 text-[11px] text-red-300 border-b border-border-1">{err}</div>
                )}
                {projects.length === 0 ? (
                  <div className="p-3 text-[12px] text-ink-3">No projects yet.</div>
                ) : (
                  <ul className="divide-y divide-border-1">
                    {projects.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => pickProject(p.id)}
                          data-testid="topbar-pick-project"
                          data-project-id={p.id}
                          className="w-full text-left px-3 py-1.5 hover:bg-bg-3 text-[12px] flex items-center gap-2"
                        >
                          <Folder className="w-3 h-3 text-ink-3" />
                          <span className="truncate">{p.name}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="border-t border-border-1 p-2">
                  <button
                    type="button"
                    onClick={() => { setShowCreate((v) => !v); setErr(null); }}
                    data-testid="topbar-new-project"
                    className="w-full flex items-center gap-2 px-2 py-1.5 text-[12px] text-ink-1 hover:bg-bg-3 rounded"
                  >
                    <FolderPlus className="w-3 h-3" /> New project
                  </button>
                  {showCreate && (
                    <form
                      onSubmit={(e) => { e.preventDefault(); void createAndPick(); }}
                      className="mt-2 space-y-1"
                      data-testid="topbar-create-form"
                    >
                      <input
                        type="text"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder="Project name"
                        autoFocus
                        maxLength={200}
                        disabled={busy}
                        className="w-full bg-bg-1 border border-border-1 rounded px-2 py-1 text-[12px] text-ink-1 placeholder:text-ink-4 focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                      <div className="flex items-center gap-1">
                        <button
                          type="submit"
                          disabled={busy || !newName.trim()}
                          data-testid="topbar-create-submit"
                          className="px-2 py-1 rounded bg-accent text-white text-[12px] disabled:opacity-50"
                        >
                          Create
                        </button>
                        <button
                          type="button"
                          onClick={() => { setShowCreate(false); setNewName(''); }}
                          className="px-2 py-1 rounded border border-border-1 text-[12px] text-ink-2"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              </div>
            )}
          </div>
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
