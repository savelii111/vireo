import { useState } from 'react';
import { Download, Play, ChevronRight, Folder, FolderPlus, Layout, Eye, EyeOff } from 'lucide-react';
import clsx from 'clsx';
import type { WorkspaceMode } from '../types';
import { listProjects, createProject, setActiveProjectId } from '../projectOnboarding';
import type { WorkspaceLayout, PanelVisibility, WorkspacePreset } from '../hooks/useWorkspaceLayout';

interface Props {
  projectName: string;
  onExport: () => void;
  onRender: () => void;
  // Day 24: project picker.
  onProjectChanged?: () => void;
  // Day 26: workspace layout controls.
  layout?: WorkspaceLayout;
  onTogglePanel?: (panel: keyof PanelVisibility) => void;
  onApplyPreset?: (preset: WorkspacePreset) => void;
  onResetLayout?: () => void;
}

export function TopBar({
  projectName,
  onExport,
  onRender,
  onProjectChanged,
  layout,
  onTogglePanel,
  onApplyPreset,
  onResetLayout,
}: Props) {
  const [mode, setMode] = useState<WorkspaceMode>('edit');
  const [showPicker, setShowPicker] = useState(false);
  const [showLayoutMenu, setShowLayoutMenu] = useState(false);
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

  // Day 26: avatar initials come from the current user id
  // stored in the token, not from a hard-coded name. The
  // round button stays a neutral grey gradient so we don't
  // pretend the user is someone we don't know.
  const avatarInitials = (() => {
    try {
      const t = localStorage.getItem('vireo_token');
      if (!t) return '?';
      const p = t.split('.')[1];
      const padded = p + '='.repeat((4 - (p.length % 4)) % 4);
      const payload = JSON.parse(atob(padded.replace(/-/g, '+').replace(/_/g, '/')));
      const sub = (payload?.sub || '').toString();
      if (!sub) return '?';
      // take leading letters/numbers (max 2)
      const m = sub.replace(/^u-?/i, '').match(/[a-z0-9]/gi) || [];
      return (m.slice(0, 2).join('') || '?').toUpperCase();
    } catch {
      return '?';
    }
  })();

  return (
    <header
      className="flex items-center justify-between h-11 px-3 bg-bg-1 border-b border-border-1 w-full"
      data-testid="topbar-root"
    >
      {/* Brand + breadcrumb */}
      <div className="flex items-center gap-3 relative min-w-0">
        <div className="flex items-center gap-2 font-semibold text-[13px] tracking-tight">
          <div
            className="w-[22px] h-[22px] rounded-md flex items-center justify-center text-white font-bold text-[12px] tracking-tighter"
            style={{ background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)' }}
          >
            V
          </div>
          <span>Vireo Studio</span>
        </div>
        <nav className="flex items-center gap-0.5 text-[12px] text-ink-3 ml-2">
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
          <button className="px-2 py-0.5 rounded hover:bg-bg-2 hover:text-ink-1 transition-colors truncate max-w-[20ch]" title={projectName}>
            {projectName}
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
        {/* Day 26: Layout menu — visibility toggles + presets. */}
        {layout && onTogglePanel && onApplyPreset && (
          <div className="relative">
            <button
              type="button"
              data-testid="topbar-layout-button"
              onClick={() => setShowLayoutMenu((v) => !v)}
              className="flex items-center gap-1.5 px-2 py-1.5 text-[12px] text-ink-2 hover:text-ink-1 hover:bg-bg-2 rounded-md transition-colors"
            >
              <Layout size={13} strokeWidth={1.6} />
              Layout
            </button>
            {showLayoutMenu && (
              <div
                className="absolute right-0 mt-1 z-20 w-56 bg-bg-2 border border-border-1 rounded shadow-lg p-2 text-[12px] text-ink-1"
                onMouseLeave={() => setShowLayoutMenu(false)}
                data-testid="topbar-layout-menu"
              >
                <div className="px-1 pt-0.5 pb-1 text-[10px] uppercase tracking-wider text-ink-3">Panels</div>
                <PanelToggle
                  label="Media"
                  on={layout.visibility.media}
                  onToggle={() => onTogglePanel('media')}
                  testId="topbar-toggle-media"
                />
                <PanelToggle
                  label="Inspector / Chat"
                  on={layout.visibility.inspector}
                  onToggle={() => onTogglePanel('inspector')}
                  testId="topbar-toggle-inspector"
                />
                <PanelToggle
                  label="Timeline"
                  on={layout.visibility.timeline}
                  onToggle={() => onTogglePanel('timeline')}
                  testId="topbar-toggle-timeline"
                />
                <div className="border-t border-border-1 my-1" />
                <div className="px-1 pt-0.5 pb-1 text-[10px] uppercase tracking-wider text-ink-3">Presets</div>
                <button
                  type="button"
                  data-testid="topbar-preset-edit"
                  onClick={() => onApplyPreset('edit')}
                  className={clsx(
                    'w-full text-left px-2 py-1 rounded text-[12px] hover:bg-bg-3',
                    layout.preset === 'edit' ? 'text-ink-1 font-semibold' : 'text-ink-2',
                  )}
                >
                  Edit (все панели)
                </button>
                <button
                  type="button"
                  data-testid="topbar-preset-monitor"
                  onClick={() => onApplyPreset('monitor')}
                  className={clsx(
                    'w-full text-left px-2 py-1 rounded text-[12px] hover:bg-bg-3',
                    layout.preset === 'monitor' ? 'text-ink-1 font-semibold' : 'text-ink-2',
                  )}
                >
                  Monitor (макс. места)
                </button>
                {onResetLayout && (
                  <>
                    <div className="border-t border-border-1 my-1" />
                    <button
                      type="button"
                      data-testid="topbar-layout-reset"
                      onClick={onResetLayout}
                      className="w-full text-left px-2 py-1 rounded text-[12px] text-ink-2 hover:bg-bg-3"
                    >
                      Reset sizes
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        <button
          onClick={onExport}
          data-testid="topbar-export"
          className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-ink-1 bg-bg-2 border border-border-2 hover:bg-bg-3 rounded-md transition-colors"
        >
          <Download size={13} strokeWidth={1.6} />
          Export
        </button>
        <button
          onClick={onRender}
          data-testid="topbar-render"
          className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-white bg-accent hover:bg-accent-h rounded-md transition-colors"
        >
          <Play size={13} strokeWidth={1.6} fill="currentColor" />
          Render
        </button>
        <button
          className="w-[26px] h-[26px] rounded-full flex items-center justify-center text-white text-[11px] font-semibold ml-1 bg-bg-3 hover:bg-bg-2 transition-colors"
          data-testid="topbar-avatar"
          title="Current user"
        >
          {avatarInitials}
        </button>
      </div>
    </header>
  );
}

function PanelToggle({
  label,
  on,
  onToggle,
  testId,
}: {
  label: string;
  on: boolean;
  onToggle: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onToggle}
      className="w-full flex items-center gap-2 px-2 py-1 rounded text-[12px] text-ink-1 hover:bg-bg-3"
    >
      {on ? <Eye size={12} className="text-accent" /> : <EyeOff size={12} className="text-ink-3" />}
      <span className="flex-1 text-left">{label}</span>
      <span className="text-[10px] uppercase tracking-wider text-ink-3">{on ? 'on' : 'off'}</span>
    </button>
  );
}
