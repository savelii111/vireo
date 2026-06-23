// Day 26: tests for the workspace layout hook. The hook owns
// three things: panel sizes, panel visibility, and the active
// preset. All three must round-trip through localStorage and
// the visibility toggles must not affect the size numbers.
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWorkspaceLayout, DEFAULT_LAYOUT, MONITOR_PRESET } from "../src/hooks/useWorkspaceLayout";

beforeEach(() => {
  try { localStorage.clear(); } catch {}
});

describe("useWorkspaceLayout", () => {
  it("returns the default layout when localStorage is empty", () => {
    const { result } = renderHook(() => useWorkspaceLayout());
    expect(result.current.layout.mediaSize).toBe(DEFAULT_LAYOUT.mediaSize);
    expect(result.current.layout.inspectorSize).toBe(DEFAULT_LAYOUT.inspectorSize);
    expect(result.current.layout.timelineSize).toBe(DEFAULT_LAYOUT.timelineSize);
    expect(result.current.layout.visibility).toEqual(DEFAULT_LAYOUT.visibility);
    expect(result.current.layout.preset).toBe(DEFAULT_LAYOUT.preset);
  });

  it("persists the layout to localStorage on every change", () => {
    const { result } = renderHook(() => useWorkspaceLayout());
    act(() => result.current.setMediaSize(40));
    const stored = JSON.parse(localStorage.getItem("vireo_workspace_layout_v1")!);
    expect(stored.mediaSize).toBe(40);
  });

  it("clamp mediaSize to [8, 60] and marks preset custom", () => {
    const { result } = renderHook(() => useWorkspaceLayout());
    act(() => result.current.setMediaSize(1));
    expect(result.current.layout.mediaSize).toBe(8);
    act(() => result.current.setMediaSize(999));
    expect(result.current.layout.mediaSize).toBe(60);
    expect(result.current.layout.preset).toBe("custom");
  });

  it("toggling a panel flips its visibility only", () => {
    const { result } = renderHook(() => useWorkspaceLayout());
    const mediaBefore = result.current.layout.mediaSize;
    act(() => result.current.togglePanel("media"));
    expect(result.current.layout.visibility.media).toBe(false);
    expect(result.current.layout.mediaSize).toBe(mediaBefore);
  });

  it("applying the monitor preset hides Media and Inspector and shrinks them", () => {
    const { result } = renderHook(() => useWorkspaceLayout());
    act(() => result.current.applyPreset("monitor"));
    expect(result.current.layout.visibility.media).toBe(false);
    expect(result.current.layout.visibility.inspector).toBe(false);
    expect(result.current.layout.mediaSize).toBe(MONITOR_PRESET.mediaSize);
    expect(result.current.layout.preset).toBe("monitor");
  });

  it("applying the edit preset restores the defaults", () => {
    const { result } = renderHook(() => useWorkspaceLayout());
    act(() => result.current.applyPreset("monitor"));
    act(() => result.current.applyPreset("edit"));
    expect(result.current.layout.mediaSize).toBe(DEFAULT_LAYOUT.mediaSize);
    expect(result.current.layout.visibility.media).toBe(true);
    expect(result.current.layout.preset).toBe("edit");
  });

  it("restores the layout from localStorage on a fresh mount", () => {
    localStorage.setItem("vireo_workspace_layout_v1", JSON.stringify({
      mediaSize: 35,
      inspectorSize: 18,
      timelineSize: 50,
      visibility: { media: false, inspector: true, timeline: true },
      preset: "custom",
    }));
    const { result } = renderHook(() => useWorkspaceLayout());
    expect(result.current.layout.mediaSize).toBe(35);
    expect(result.current.layout.inspectorSize).toBe(18);
    expect(result.current.layout.timelineSize).toBe(50);
    expect(result.current.layout.visibility.media).toBe(false);
  });

  it("rejects invalid localStorage values and falls back to defaults", () => {
    localStorage.setItem("vireo_workspace_layout_v1", "not-json{");
    const { result } = renderHook(() => useWorkspaceLayout());
    expect(result.current.layout.mediaSize).toBe(DEFAULT_LAYOUT.mediaSize);
  });

  it("reset() restores the default edit layout", () => {
    const { result } = renderHook(() => useWorkspaceLayout());
    act(() => result.current.applyPreset("monitor"));
    act(() => result.current.reset());
    expect(result.current.layout.mediaSize).toBe(DEFAULT_LAYOUT.mediaSize);
    expect(result.current.layout.visibility.media).toBe(true);
  });
});
