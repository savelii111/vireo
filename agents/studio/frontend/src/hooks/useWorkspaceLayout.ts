// Day 26: persistent workspace layout. Sizes, visibility and
// the active preset all survive page reloads. The actual
// rendering still happens in App.tsx; this module only owns
// the state.
import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "vireo_workspace_layout_v1";

export type WorkspacePreset = "edit" | "monitor";

export type PanelVisibility = {
  media: boolean;
  inspector: boolean;
  timeline: boolean;
};

export type WorkspaceLayout = {
  // Sizes in percent of the parent group, matching the order
  // of `react-resizable-panels` panels.
  mediaSize: number;     // left column
  inspectorSize: number; // right column
  timelineSize: number;  // bottom timeline
  // Visibility per panel. Hidden panels are removed from the
  // group entirely so the rest of the layout takes the freed
  // space.
  visibility: PanelVisibility;
  // Which preset was last selected ("custom" if the user moved
  // any handle since).
  preset: WorkspacePreset | "custom";
};

export const DEFAULT_LAYOUT: WorkspaceLayout = {
  mediaSize: 24,
  inspectorSize: 24,
  timelineSize: 30,
  visibility: { media: true, inspector: true, timeline: true },
  preset: "edit",
};

export const MONITOR_PRESET: WorkspaceLayout = {
  mediaSize: 6,
  inspectorSize: 6,
  timelineSize: 14,
  visibility: { media: false, inspector: false, timeline: true },
  preset: "monitor",
};

function loadLayout(): WorkspaceLayout {
  if (typeof localStorage === "undefined") return { ...DEFAULT_LAYOUT };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_LAYOUT };
    const parsed = JSON.parse(raw) as Partial<WorkspaceLayout>;
    return {
      mediaSize: clampNumber(parsed.mediaSize, DEFAULT_LAYOUT.mediaSize, 8, 60),
      inspectorSize: clampNumber(parsed.inspectorSize, DEFAULT_LAYOUT.inspectorSize, 8, 60),
      timelineSize: clampNumber(parsed.timelineSize, DEFAULT_LAYOUT.timelineSize, 10, 60),
      visibility: {
        media: parsed.visibility?.media ?? true,
        inspector: parsed.visibility?.inspector ?? true,
        timeline: parsed.visibility?.timeline ?? true,
      },
      preset: parsed.preset ?? "custom",
    };
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}

function clampNumber(v: unknown, fallback: number, lo: number, hi: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

function saveLayout(layout: WorkspaceLayout) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch { /* ignore quota / private mode */ }
}

export function useWorkspaceLayout() {
  const [layout, setLayout] = useState<WorkspaceLayout>(() => loadLayout());

  // Persist on every change.
  useEffect(() => { saveLayout(layout); }, [layout]);

  const setMediaSize = useCallback((size: number) => {
    setLayout((l) => ({ ...l, mediaSize: clampNumber(size, l.mediaSize, 8, 60), preset: "custom" }));
  }, []);
  const setInspectorSize = useCallback((size: number) => {
    setLayout((l) => ({ ...l, inspectorSize: clampNumber(size, l.inspectorSize, 8, 60), preset: "custom" }));
  }, []);
  const setTimelineSize = useCallback((size: number) => {
    setLayout((l) => ({ ...l, timelineSize: clampNumber(size, l.timelineSize, 10, 60), preset: "custom" }));
  }, []);

  const togglePanel = useCallback((panel: keyof PanelVisibility) => {
    setLayout((l) => {
      const visibility = { ...l.visibility, [panel]: !l.visibility[panel] };
      return { ...l, visibility, preset: "custom" };
    });
  }, []);

  const applyPreset = useCallback((preset: WorkspacePreset) => {
    setLayout(preset === "edit" ? { ...DEFAULT_LAYOUT } : { ...MONITOR_PRESET });
  }, []);

  const reset = useCallback(() => {
    setLayout({ ...DEFAULT_LAYOUT });
  }, []);

  return {
    layout,
    setMediaSize,
    setInspectorSize,
    setTimelineSize,
    togglePanel,
    applyPreset,
    reset,
  };
}
