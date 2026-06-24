// Day 24 (dovbavka): project onboarding gate. Shown when no
// active project id is present in localStorage, OR when the
// active project id is stale (the server returns 404 for it on
// /api/timelines/:id). Renders either a list of existing
// projects to pick from or a "Create project" form. Calls
// real /api/projects endpoints. No mocks, no placeholders.
import { useCallback, useEffect, useState } from "react";
import { FolderPlus, Folder, Loader2, AlertTriangle, Hammer } from "lucide-react";
import { setActiveProjectId, listProjects, createProject } from "../projectOnboarding";

// Day 26 / Phase 0: __VIREO_DEV_LOGIN__ is a build-time
// constant injected by vite.config.ts from
// VIREO_DEV_LOGIN. In production builds the constant is "0"
// and the "Continue as developer" button is dead code.
declare const __VIREO_DEV_LOGIN__: string;
const DEV_LOGIN_ENABLED =
  typeof __VIREO_DEV_LOGIN__ !== "undefined" && __VIREO_DEV_LOGIN__ === "1";

export type OnboardingState =
  | { kind: "loading" }
  | { kind: "empty"; error: string | null }
  | { kind: "list"; projects: Array<{ id: string; name: string; updatedAt?: string }> }
  | { kind: "creating"; name: string; error: string | null }
  | { kind: "error"; error: string };

export function OnboardingGate({ onProjectReady }: { onProjectReady: () => void }) {
  const [state, setState] = useState<OnboardingState>({ kind: "loading" });

  const refresh = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const projects = await listProjects();
      if (projects.length === 0) {
        setState({ kind: "empty", error: null });
      } else {
        setState({ kind: "list", projects });
      }
    } catch (e) {
      setState({ kind: "error", error: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleCreate = useCallback(async (name: string) => {
    setState({ kind: "creating", name, error: null });
    try {
      const project = await createProject(name);
      setActiveProjectId(project.id);
      onProjectReady();
    } catch (e) {
      setState({ kind: "creating", name, error: e instanceof Error ? e.message : String(e) });
    }
  }, [onProjectReady]);

  const handlePick = useCallback((id: string) => {
    setActiveProjectId(id);
    onProjectReady();
  }, [onProjectReady]);

  // Day 26 / Phase 0: dev-only auto-login. Hits the gated
  // /api/dev/issue-token endpoint and, on success, re-runs
  // the normal project listing. The button only appears in
  // builds that were started with VIREO_DEV_LOGIN=1, so it
  // is dead UI in production.
  const handleDevLogin = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const res = await fetch("/api/dev/issue-token?user=u-dev&email=u@vireo.dev", {
        credentials: "include",
      });
      if (!res.ok) {
        setState({ kind: "error", error: `dev-login failed: HTTP ${res.status}` });
        return;
      }
      const body = await res.json();
      if (body?.token) {
        localStorage.setItem("vireo_token", body.token);
      }
      // After token is set, retry project listing.
      await refresh();
    } catch (e) {
      setState({ kind: "error", error: e instanceof Error ? e.message : String(e) });
    }
  }, [refresh]);

  if (state.kind === "loading") {
    return (
      <div className="min-h-screen bg-bg-1 text-ink-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-sm text-ink-2">
          <Loader2 className="w-6 h-6 animate-spin text-accent" />
          Loading projects…
        </div>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="min-h-screen bg-bg-1 text-ink-1 flex items-center justify-center p-6">
        <div className="bg-bg-2 border border-border-1 rounded-lg p-6 max-w-md w-full">
          <div className="flex items-center gap-2 text-red-300 mb-2">
            <AlertTriangle className="w-5 h-5" />
            <h2 className="font-semibold">Could not load projects</h2>
          </div>
          <p className="text-sm text-ink-2 mb-4">{state.error}</p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void refresh()}
              className="px-3 py-1.5 rounded bg-accent text-white text-sm hover:opacity-90"
            >
              Retry
            </button>
            {DEV_LOGIN_ENABLED && (
              <button
                type="button"
                data-testid="onboarding-dev-login"
                onClick={() => void handleDevLogin()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-border-1 text-ink-1 text-sm hover:bg-bg-3"
              >
                <Hammer className="w-4 h-4" /> Continue as developer
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-1 text-ink-1 flex items-center justify-center p-6">
      <div className="bg-bg-2 border border-border-1 rounded-lg p-6 max-w-2xl w-full">
        <div className="mb-4">
          <h1 className="text-lg font-semibold mb-1">Welcome to Vireo Studio</h1>
          <p className="text-sm text-ink-2">
            {state.kind === "empty"
              ? "Create a project to start editing."
              : "Pick an existing project or create a new one."}
          </p>
        </div>

        {DEV_LOGIN_ENABLED && (
          <div className="mb-3 flex items-center gap-2">
            <button
              type="button"
              data-testid="onboarding-dev-login"
              onClick={() => void handleDevLogin()}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-border-1 bg-bg-1 text-ink-1 text-[12px] hover:bg-bg-3"
            >
              <Hammer className="w-3.5 h-3.5" /> Continue as developer
            </button>
            <span className="text-[10px] uppercase tracking-wider text-ink-4">
              dev-login enabled
            </span>
          </div>
        )}

        {state.kind === "list" && (
          <ProjectList
            projects={state.projects}
            onPick={handlePick}
            onCreateNew={() => setState({ kind: "empty", error: null })}
          />
        )}

        {state.kind === "empty" && (
          <CreateForm
            busy={false}
            error={null}
            onCancel={state.kind === "empty" && undefined ? () => refresh() : undefined}
            onSubmit={(name) => void handleCreate(name)}
          />
        )}

        {state.kind === "creating" && (
          <CreateForm
            busy
            error={state.error}
            initialName={state.name}
            onCancel={() => void refresh()}
            onSubmit={(name) => void handleCreate(name)}
          />
        )}
      </div>
    </div>
  );
}

function ProjectList({ projects, onPick, onCreateNew }: {
  projects: Array<{ id: string; name: string; updatedAt?: string }>;
  onPick: (id: string) => void;
  onCreateNew: () => void;
}) {
  return (
    <div>
      <ul className="divide-y divide-border-1 max-h-80 overflow-y-auto rounded border border-border-1 mb-4">
        {projects.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onPick(p.id)}
              className="w-full flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-bg-3 text-left text-sm"
              data-testid="onboarding-pick-project"
              data-project-id={p.id}
            >
              <span className="flex items-center gap-2 text-ink-1">
                <Folder className="w-4 h-4 text-ink-3" />
                {p.name}
              </span>
              {p.updatedAt && (
                <span className="text-[11px] text-ink-3">{p.updatedAt}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onCreateNew}
        className="px-3 py-1.5 rounded bg-accent text-white text-sm flex items-center gap-2 hover:opacity-90"
        data-testid="onboarding-create-new"
      >
        <FolderPlus className="w-4 h-4" /> New project
      </button>
    </div>
  );
}

function CreateForm({ busy, error, initialName, onCancel, onSubmit }: {
  busy: boolean;
  error: string | null;
  initialName?: string;
  onCancel?: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState<string>(initialName ?? "");
  const trimmed = name.trim();
  const tooLong = trimmed.length > 200;
  const empty = trimmed.length === 0;
  const disabled = busy || empty || tooLong;
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (!disabled) onSubmit(trimmed); }}
      data-testid="onboarding-create-form"
    >
      <label className="block text-sm text-ink-2 mb-1">Project name</label>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="My new edit"
        autoFocus
        maxLength={200}
        disabled={busy}
        data-testid="onboarding-create-name"
        className="w-full bg-bg-1 border border-border-1 rounded px-3 py-2 text-sm text-ink-1 placeholder:text-ink-4 focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
      />
      <div className="flex items-center justify-between mt-2 text-[11px] text-ink-3">
        <span>{trimmed.length} / 200</span>
        {tooLong && <span className="text-red-300">Name is too long</span>}
      </div>
      {error && (
        <div className="mt-2 text-sm text-red-300 flex items-center gap-1">
          <AlertTriangle className="w-4 h-4" /> {error}
        </div>
      )}
      <div className="flex items-center gap-2 mt-4">
        <button
          type="submit"
          disabled={disabled}
          data-testid="onboarding-create-submit"
          className="px-3 py-1.5 rounded bg-accent text-white text-sm flex items-center gap-2 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          Create project
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded border border-border-1 text-sm hover:bg-bg-3"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
