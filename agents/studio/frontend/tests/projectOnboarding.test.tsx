// @vitest-environment jsdom
// Day 24: tests for the project onboarding helpers and the
// OnboardingGate component. fetch is mocked per-test so we
// never hit a real backend; localStorage is the in-memory
// jsdom store. We assert both the API shape (which calls
// hit which endpoints) and the localStorage side-effect
// (active project id persists).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import {
  ACTIVE_PROJECT_KEY,
  createProject,
  getActiveProjectId,
  listProjects,
  setActiveProjectId,
} from "../src/projectOnboarding";
import { OnboardingGate } from "../src/components/OnboardingGate";

function setToken(token: string | null) {
  if (token === null) {
    localStorage.removeItem("vireo_token");
    localStorage.removeItem("vireo.auth.token");
  } else {
    localStorage.setItem("vireo_token", token);
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  cleanup();
});

beforeEach(() => {
  setToken("t-ok");
});

describe("projectOnboarding helpers", () => {
  it("setActiveProjectId writes vireo_active_project_id and dispatches an event", () => {
    setActiveProjectId("p_123");
    expect(localStorage.getItem(ACTIVE_PROJECT_KEY)).toBe("p_123");
    const handler = vi.fn();
    window.addEventListener("vireo:active-project-changed", handler);
    setActiveProjectId("p_456");
    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener("vireo:active-project-changed", handler);
  });

  it("getActiveProjectId falls back to legacy keys when the canonical one is empty", () => {
    localStorage.setItem("vireo.activeProjectId", "p_legacy");
    expect(getActiveProjectId()).toBe("p_legacy");
    localStorage.setItem(ACTIVE_PROJECT_KEY, "p_canonical");
    expect(getActiveProjectId()).toBe("p_canonical");
  });

  it("setActiveProjectId(null) removes the key", () => {
    setActiveProjectId("p_123");
    setActiveProjectId(null);
    expect(localStorage.getItem(ACTIVE_PROJECT_KEY)).toBeNull();
  });
});

describe("listProjects", () => {
  it("returns a normalized list from /api/projects {projects:[...]}", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        projects: [
          { id: "p_a", name: "A", updated_at: "2026-06-22T00:00:00Z" },
          { id: "p_b", name: "B" },
        ],
      }),
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);
    const out = await listProjects();
    expect(out.map((p) => p.id).sort()).toEqual(["p_a", "p_b"]);
    expect(out[0].name).toBe("A");
    expect(out[0].updatedAt).toBe("2026-06-22T00:00:00Z");
    expect(fetchMock).toHaveBeenCalledWith("/api/projects", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer t-ok" }),
    }));
  });

  it("returns an empty list on 200 with empty payload", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ projects: [] }),
      text: async () => "",
    }));
    expect(await listProjects()).toEqual([]);
  });

  it("throws on non-2xx with status in the message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
      text: async () => "boom",
    }));
    await expect(listProjects()).rejects.toThrow(/500/);
  });
});

describe("createProject", () => {
  it("POSTs {name} and returns the created project", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ project: { id: "p_new", name: "My edit" } }),
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);
    const out = await createProject("My edit");
    expect(out.id).toBe("p_new");
    expect(out.name).toBe("My edit");
    expect(fetchMock).toHaveBeenCalledWith("/api/projects", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ name: "My edit" }),
    }));
  });

  it("rejects empty name without hitting the network", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(createProject("   ")).rejects.toThrow(/required/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects names over 200 chars without hitting the network", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(createProject("a".repeat(201))).rejects.toThrow(/max 200/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("OnboardingGate", () => {
  it("shows the create form when the projects list is empty", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ projects: [] }),
      text: async () => "",
    }));
    const onReady = vi.fn();
    render(<OnboardingGate onProjectReady={onReady} />);
    await waitFor(() => {
      expect(screen.getByTestId("onboarding-create-form")).toBeInTheDocument();
    });
    // The picker variant is NOT rendered.
    expect(screen.queryByTestId("onboarding-pick-project")).toBeNull();
  });

  it("shows the picker when projects exist", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        projects: [
          { id: "p_one", name: "One" },
          { id: "p_two", name: "Two" },
        ],
      }),
      text: async () => "",
    }));
    const onReady = vi.fn();
    render(<OnboardingGate onProjectReady={onReady} />);
    await waitFor(() => {
      expect(screen.getAllByTestId("onboarding-pick-project")).toHaveLength(2);
    });
    expect(screen.queryByTestId("onboarding-create-form")).toBeNull();
  });

  it("clicking a project writes its id to localStorage and notifies the parent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        projects: [{ id: "p_xyz", name: "XYZ" }],
      }),
      text: async () => "",
    }));
    const onReady = vi.fn();
    render(<OnboardingGate onProjectReady={onReady} />);
    const btn = await screen.findByTestId("onboarding-pick-project");
    fireEvent.click(btn);
    expect(localStorage.getItem(ACTIVE_PROJECT_KEY)).toBe("p_xyz");
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("creating a project POSTs to /api/projects and writes the returned id", async () => {
    const fetchMock = vi
      .fn()
      // 1) listProjects → empty
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ projects: [] }),
        text: async () => "",
      })
      // 2) createProject → 201
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ project: { id: "p_created", name: "Hello" } }),
        text: async () => "",
      });
    vi.stubGlobal("fetch", fetchMock);
    const onReady = vi.fn();
    render(<OnboardingGate onProjectReady={onReady} />);
    const nameInput = await screen.findByTestId("onboarding-create-name");
    fireEvent.change(nameInput, { target: { value: "Hello" } });
    fireEvent.click(screen.getByTestId("onboarding-create-submit"));
    await waitFor(() => {
      expect(localStorage.getItem(ACTIVE_PROJECT_KEY)).toBe("p_created");
    });
    expect(onReady).toHaveBeenCalledTimes(1);
    // The POST body is correct.
    const post = fetchMock.mock.calls.find((c) => c[1] && c[1].method === "POST");
    expect(post).toBeTruthy();
    expect(post![0]).toBe("/api/projects");
    expect(JSON.parse(post![1].body)).toEqual({ name: "Hello" });
  });

  it("shows an error if /api/projects fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
      text: async () => "no token",
    }));
    render(<OnboardingGate onProjectReady={() => {}} />);
    expect(await screen.findByText(/Could not load projects/)).toBeInTheDocument();
    expect(screen.getByText(/401/)).toBeInTheDocument();
  });
});
