// Day 24: project onboarding helpers. The only authoritative
// source of the active project id is localStorage key
// `vireo_active_project_id` (with a legacy alias
// `vireo.activeProjectId` for code that pre-dates this commit).
// useEditor's getActiveProjectId() reads either; setting
// either here is enough to make the editor load that
// project's timeline on next mount.

export const ACTIVE_PROJECT_KEY = "vireo_active_project_id";
export const LEGACY_ACTIVE_PROJECT_KEYS = ["vireo.activeProjectId"];

export function getActiveProjectId(): string | null {
  if (typeof localStorage === "undefined") return null;
  const v = localStorage.getItem(ACTIVE_PROJECT_KEY);
  if (v) return v;
  for (const k of LEGACY_ACTIVE_PROJECT_KEYS) {
    const legacy = localStorage.getItem(k);
    if (legacy) return legacy;
  }
  return null;
}

export function setActiveProjectId(id: string | null | undefined): void {
  if (typeof localStorage === "undefined") return;
  if (id) {
    localStorage.setItem(ACTIVE_PROJECT_KEY, id);
  } else {
    localStorage.removeItem(ACTIVE_PROJECT_KEY);
  }
  // Dispatch a window event so any module that listens for
  // project switches can re-render without a page reload.
  try {
    window.dispatchEvent(new CustomEvent("vireo:active-project-changed", { detail: { id } }));
  } catch { /* ignore */ }
}

function readToken(): string | null {
  if (typeof localStorage === "undefined") return null;
  return (
    localStorage.getItem("vireo_token") ||
    localStorage.getItem("vireo.auth.token") ||
    null
  );
}

function authHeaders(): Record<string, string> {
  const t = readToken();
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (t) h.Authorization = `Bearer ${t}`;
  return h;
}

export type ProjectSummary = {
  id: string;
  name: string;
  updatedAt?: string;
  createdAt?: string;
};

export async function listProjects(): Promise<ProjectSummary[]> {
  const res = await fetch("/api/projects", { headers: authHeaders() });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`listProjects failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const body = await res.json().catch(() => ({}));
  // The /api/projects endpoint shape is one of: { projects: [...] } or [...]
  const list = Array.isArray(body) ? body : Array.isArray(body?.projects) ? body.projects : [];
  return list
    .filter((p: any) => p && typeof p.id === "string" && typeof p.name === "string")
    .map((p: any) => ({
      id: p.id,
      name: p.name,
      updatedAt: p.updated_at || p.updatedAt,
      createdAt: p.created_at || p.createdAt,
    }));
}

export async function createProject(name: string): Promise<ProjectSummary> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Project name is required");
  if (trimmed.length > 200) throw new Error("Project name too long (max 200)");
  const res = await fetch("/api/projects", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ name: trimmed }),
  });
  if (res.status !== 201 && res.status !== 200) {
    const body = await res.text().catch(() => "");
    throw new Error(`createProject failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const body = await res.json().catch(() => ({}));
  // /api/projects returns { project: {...} } on POST
  const project = body?.project ?? body;
  if (!project?.id || !project?.name) {
    throw new Error("createProject response missing project.id or project.name");
  }
  return { id: project.id, name: project.name, updatedAt: project.updated_at, createdAt: project.created_at };
}
