// Day 27 / Phase Adobe Frame: visual scaffold for the
// editor. The three real panels (Program preview, Media
// bin, Timeline) are mounted as-is from the rest of the
// app. Everything else in this scaffold is a static demo
// (left Effect Controls tree, right Properties, top menu,
// mode bar, panel tab strip, timeline tool column, track
// header column).
//
// Wiring rule: any new panel in here is a demo, not a real
// feature. Real panels come in as full components and are
// placed into the corresponding zone (Program, Bin, Timeline).
// This file is the shell.

import { ReactNode, useState } from "react";
import {
  Home,
  Scissors,
  Download,
  ChevronFirst,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  Magnet,
  Scissors as ScissorsIcon,
  Type,
  Hand,
  ZoomIn,
  MousePointer2,
  PenLine,
  ChevronsLeftRight,
  ChevronRight,
  ChevronDown,
  Volume2,
  Mic,
} from "lucide-react";

// ---- top menu items (drop-downs are stubs) ----
const TOP_MENU_LEFT = [
  "File", "Edit", "Clip", "Sequence", "Markers",
  "Graphics and Titles", "View", "Window", "Help",
];
const TOP_MENU_RIGHT = [
  "Editing", "Color", "Effects", "Audio",
  "Graphics", "Review", "AI", "All",
];

// ---- panel tab strip (between mode bar and 3-column body) ----
const PANEL_TABS = [
  "Source: Sample Media Clip 2.mp4",
  "Effect Controls",
  "Audio Clip Mixer",
  "Metadata",
  "Text",
  "Film Impact Dashboard",
];

// ---- timeline tool column ----
const TIMELINE_TOOLS = [
  { id: "select", icon: MousePointer2, label: "Выбор" },
  { id: "track-select", icon: ChevronFirst, label: "Выбор дорожки" },
  { id: "ripple", icon: ChevronsLeftRight, label: "Ripple" },
  { id: "rate", icon: Scissors, label: "Rate stretch" },
  { id: "razor", icon: ScissorsIcon, label: "Разрез" },
  { id: "slip", icon: ChevronRight, label: "Slip" },
  { id: "slide", icon: ChevronDown, label: "Slide" },
  { id: "pen", icon: PenLine, label: "Перо" },
  { id: "hand", icon: Hand, label: "Рука" },
  { id: "zoom", icon: ZoomIn, label: "Zoom" },
  { id: "text", icon: Type, label: "Текст" },
];

type AdobeMode = "home" | "import" | "edit" | "export";

interface AdobeScaffoldProps {
  mode: AdobeMode;
  onModeChange: (m: AdobeMode) => void;
  activeWorkspace: string;
  onWorkspaceChange: (w: string) => void;
  // Three real slots from the rest of the app.
  programSlot: ReactNode; // preview + transport
  binSlot: ReactNode; // media + import
  timelineSlot: ReactNode; // timeline
}

export function AdobeScaffold(props: AdobeScaffoldProps) {
  const {
    mode, onModeChange,
    activeWorkspace, onWorkspaceChange,
    programSlot, binSlot, timelineSlot,
  } = props;
  const [activePanelTab, setActivePanelTab] = useState(0);
  const [activeTool, setActiveTool] = useState("select");
  const [muted, setMuted] = useState(false);

  return (
    <div className="flex flex-col h-full min-h-0 w-full bg-[#1a1a1c] text-[#e6e6ea]">
      {/* --- top menu bar (fixed) --- */}
      <div className="h-9 flex items-center justify-between border-b border-[#2a2a2e] bg-[#232326] text-[12px] flex-shrink-0">
        <div className="flex items-center h-full">
          {TOP_MENU_LEFT.map((m) => (
            <button
              key={m}
              data-testid={`topbar-menu-${m.toLowerCase().replace(/\s+/g, "-")}`}
              className="px-3 h-full text-[#d8d8da] hover:bg-[#2f2f33] hover:text-white transition-colors"
            >
              {m}
            </button>
          ))}
        </div>
        <div className="flex items-center h-full" data-testid="topbar-workspaces">
          {TOP_MENU_RIGHT.map((w) => (
            <button
              key={w}
              onClick={() => onWorkspaceChange(w)}
              data-testid={`topbar-workspace-${w.toLowerCase()}`}
              className={
                "px-3 h-full transition-colors " +
                (activeWorkspace === w
                  ? "bg-[#1a1a1c] text-[#5b8def] font-semibold border-b-2 border-[#5b8def]"
                  : "text-[#d8d8da] hover:bg-[#2f2f33] hover:text-white")
              }
            >
              {w}
            </button>
          ))}
        </div>
      </div>

      {/* --- mode bar (fixed) --- */}
      <div className="h-10 flex items-center gap-1 border-b border-[#2a2a2e] bg-[#1f1f22] px-3 flex-shrink-0">
        {([
          { id: "home", label: "Домой", icon: Home },
          { id: "import", label: "Импорт", icon: Download },
          { id: "edit", label: "Монтаж", icon: Scissors },
          { id: "export", label: "Экспорт", icon: Download },
        ] as { id: AdobeMode; label: string; icon: React.ComponentType<{ size?: number }> }[]).map((it) => {
          const Icon = it.icon;
          const active = mode === it.id;
          return (
            <button
              key={it.id}
              onClick={() => onModeChange(it.id)}
              data-testid={`mode-${it.id}`}
              className={
                "flex items-center gap-1.5 px-3 h-7 rounded text-[12px] transition-colors " +
                (active
                  ? "bg-[#5b8def] text-white font-semibold"
                  : "text-[#cfcfd2] hover:bg-[#2f2f33]")
              }
            >
              <Icon size={13} />
              {it.label}
            </button>
          );
        })}
      </div>

      {/* --- Home: only the menu + mode bars --- */}
      {mode === "home" && <HomeStub />}

      {/* --- Import: only a centered header, real media panel below --- */}
      {mode === "import" && <ModeStub title="Импорт" subtitle="Перетащите файл сюда или используйте кнопку Import ниже." />}

      {/* --- Export: only a centered header --- */}
      {mode === "export" && <ModeStub title="Экспорт" subtitle="Нажмите Render ниже, чтобы собрать mp4." />}

      {/* --- Edit: full editor --- */}
      {mode === "edit" && (
        <>
          {/* --- panel tab strip (demo) --- */}
          <div className="h-8 flex items-center border-b border-[#2a2a2e] bg-[#1a1a1c] px-1 flex-shrink-0">
            {PANEL_TABS.map((label, i) => (
              <button
                key={label}
                onClick={() => setActivePanelTab(i)}
                data-testid={`panel-tab-${i}`}
                className={
                  "px-3 h-full text-[11px] transition-colors " +
                  (i === activePanelTab
                    ? "bg-[#232326] text-[#e6e6ea] font-semibold border-b-2 border-[#5b8def]"
                    : "text-[#9aa0aa] hover:text-white hover:bg-[#232326]")
                }
              >
                {label}
              </button>
            ))}
          </div>

          {/* --- central area: 3 columns --- */}
          <div className="flex-1 flex min-h-0">
            {/* LEFT: Effect Controls (demo) */}
            <div className="w-[260px] flex-shrink-0 border-r border-[#2a2a2e] bg-[#1f1f22] overflow-auto" data-testid="left-effect-controls">
              <EffectControlsDemo />
            </div>

            {/* CENTER: Program (real preview + transport) */}
            <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-[#0e0e10]">
              {programSlot}
            </div>

            {/* RIGHT: Properties (demo) */}
            <div className="w-[280px] flex-shrink-0 border-l border-[#2a2a2e] bg-[#1f1f22] overflow-auto" data-testid="right-properties">
              <PropertiesDemo />
            </div>
          </div>

          {/* --- bottom: bin + timeline --- */}
          <div className="h-[42vh] min-h-[280px] flex border-t border-[#2a2a2e]">
            {/* LEFT: Project / Bin (real media + import) */}
            <div className="w-[340px] flex-shrink-0 border-r border-[#2a2a2e] flex flex-col bg-[#1a1a1c]">
              {/* demo tab strip */}
              <div className="h-7 flex items-center gap-0.5 border-b border-[#2a2a2e] bg-[#1f1f22] px-1 flex-shrink-0 overflow-x-auto">
                {["Media Browser", "Effects", "Transitions", "Graphics Templates", "Libraries", "Info", "Markers", "History"].map((t, i) => (
                  <button
                    key={t}
                    data-testid={`bin-tab-${i}`}
                    className={
                      "px-2 h-full text-[10px] whitespace-nowrap transition-colors " +
                      (i === 0
                        ? "bg-[#1a1a1c] text-[#e6e6ea] font-semibold border-b-2 border-[#5b8def]"
                        : "text-[#9aa0aa] hover:text-white")
                    }
                  >
                    {t}
                  </button>
                ))}
              </div>
              {/* demo column header */}
              <div className="h-6 grid grid-cols-[1.4fr_0.6fr_0.8fr_0.8fr_0.8fr_0.8fr] gap-1 items-center border-b border-[#2a2a2e] bg-[#1f1f22] text-[10px] uppercase tracking-wider text-[#9aa0aa] px-2 flex-shrink-0">
                <span>Name</span>
                <span>Fr</span>
                <span>Start</span>
                <span>End</span>
                <span>Dur</span>
                <span>In</span>
              </div>
              {/* real media panel (the actual existing component) */}
              <div className="flex-1 min-h-0 overflow-hidden">
                {binSlot}
              </div>
            </div>

            {/* RIGHT: Timeline (real, with demo tool column + demo track header column) */}
            <div className="flex-1 flex min-w-0 min-h-0">
              {/* tool column */}
              <div className="w-10 flex-shrink-0 border-r border-[#2a2a2e] bg-[#1f1f22] flex flex-col items-center py-1 gap-0.5">
                {TIMELINE_TOOLS.map((t) => {
                  const Icon = t.icon;
                  const active = activeTool === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => setActiveTool(t.id)}
                      data-testid={`tl-tool-${t.id}`}
                      title={t.label}
                      className={
                        "w-7 h-7 flex items-center justify-center rounded transition-colors " +
                        (active
                          ? "bg-[#5b8def] text-white"
                          : "text-[#cfcfd2] hover:bg-[#2f2f33]")
                      }
                    >
                      <Icon size={14} />
                    </button>
                  );
                })}
                <div className="h-px w-6 bg-[#2a2a2e] my-1" />
                <button
                  data-testid="tl-tool-magnet"
                  title="Магнит"
                  className="w-7 h-7 flex items-center justify-center rounded text-[#cfcfd2] hover:bg-[#2f2f33]"
                >
                  <Magnet size={14} />
                </button>
                <button
                  onClick={() => setMuted((m) => !m)}
                  data-testid="tl-tool-mute"
                  title="Mute"
                  className={
                    "w-7 h-7 flex items-center justify-center rounded " +
                    (muted ? "bg-[#ff6b6b] text-white" : "text-[#cfcfd2] hover:bg-[#2f2f33]")
                  }
                >
                  {muted ? <Mic size={14} /> : <Volume2 size={14} />}
                </button>
              </div>

              {/* track header column (demo) */}
              <div className="w-[140px] flex-shrink-0 border-r border-[#2a2a2e] bg-[#1f1f22] flex flex-col text-[11px]">
                <div className="h-7 border-b border-[#2a2a2e] flex items-center px-2 font-semibold text-[#cfcfd2]">
                  V3
                </div>
                <TrackHeaderRow name="V3" kind="video" />
                <TrackHeaderRow name="V2" kind="video" />
                <TrackHeaderRow name="V1" kind="video" />
                <div className="h-7 border-b border-t border-[#2a2a2e] flex items-center px-2 font-semibold text-[#cfcfd2]">
                  A
                </div>
                <TrackHeaderRow name="A1" kind="audio" />
                <TrackHeaderRow name="A2" kind="audio" />
                <TrackHeaderRow name="A3" kind="audio" />
                <div className="mt-auto h-8 border-t border-[#2a2a2e] flex items-center px-2 text-[10px] uppercase tracking-wider text-[#9aa0aa]">
                  Mix
                </div>
              </div>

              {/* real timeline */}
              <div className="flex-1 min-w-0 min-h-0 overflow-hidden">
                {timelineSlot}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---- stubs ----

function HomeStub() {
  return (
    <div className="flex-1 flex items-center justify-center text-[#9aa0aa] text-[14px]">
      Vireo Studio — домашняя заглушка. Выберите режим «Монтаж» сверху.
    </div>
  );
}

function ModeStub({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center gap-2 text-[#cfcfd2]">
      <h2 className="text-[20px] font-semibold text-[#e6e6ea]">{title}</h2>
      <p className="text-[12px] text-[#9aa0aa] max-w-md">{subtitle}</p>
      <p className="text-[10px] text-[#666] mt-4 uppercase tracking-wider">демо-каркас, не рабочая зона</p>
    </div>
  );
}

// ---- left: Effect Controls (demo) ----
function EffectControlsDemo() {
  return (
    <div className="text-[11px]">
      <div className="h-7 flex items-center px-3 border-b border-[#2a2a2e] bg-[#1f1f22] text-[10px] uppercase tracking-wider text-[#9aa0aa]">
        Effect Controls
      </div>
      <div className="px-3 py-2 space-y-2">
        <Section title="Motion" fields={["Position", "Scale", "Rotation", "Anchor Point"]} />
        <Section title="Crop" fields={["Left", "Top", "Right", "Bottom"]} />
        <Section title="Opacity / Mask" fields={["Opacity", "Mask Path"]} />
        <Section title="Time Remapping" fields={["Time", "Speed"]} />
        <p className="pt-2 text-[9px] text-[#666] uppercase tracking-wider">демо — статичные подписи, не подключено</p>
      </div>
    </div>
  );
}

function Section({ title, fields }: { title: string; fields: string[] }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border border-[#2a2a2e] rounded">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-2 py-1 text-left text-[#e6e6ea] hover:bg-[#2f2f33]"
      >
        <span className="font-semibold">{title}</span>
        <span className="text-[#9aa0aa]">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="px-2 py-1 space-y-1 bg-[#16161a]">
          {fields.map((f) => (
            <div key={f} className="grid grid-cols-[1fr_2fr] gap-1 items-center">
              <span className="text-[#9aa0aa]">{f}</span>
              <div className="h-5 rounded bg-[#232326] border border-[#2a2a2e]" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- right: Properties (demo) ----
function PropertiesDemo() {
  return (
    <div className="text-[11px]">
      <div className="h-7 flex items-center px-3 border-b border-[#2a2a2e] bg-[#1f1f22] text-[10px] uppercase tracking-wider text-[#9aa0aa]">
        Properties
      </div>
      <div className="px-3 py-2 space-y-2">
        <Section title="Transform" fields={["Position", "Anchor point", "Scale", "Rotation", "Opacity"]} />
        <Section title="Crop" fields={["Left", "Top", "Right", "Bottom"]} />
        <Section title="Adjust speed" fields={["Speed", "Reverse speed"]} />
        <p className="pt-2 text-[9px] text-[#666] uppercase tracking-wider">демо — статичные подписи, не подключено</p>
      </div>
    </div>
  );
}

// ---- timeline track header row (demo) ----
function TrackHeaderRow({ name, kind }: { name: string; kind: "video" | "audio" }) {
  const [locked, setLocked] = useState(false);
  const [visible, setVisible] = useState(true);
  return (
    <div className="h-7 border-b border-[#2a2a2e] flex items-center px-1.5 gap-0.5 text-[10px] text-[#cfcfd2]">
      <span className="font-semibold w-6">{name}</span>
      <button
        onClick={() => setVisible((v) => !v)}
        title="Visible"
        className="w-5 h-5 flex items-center justify-center text-[#9aa0aa] hover:text-white"
      >
        {visible ? <Eye size={11} /> : <EyeOff size={11} />}
      </button>
      <button
        onClick={() => setLocked((l) => !l)}
        title="Lock"
        className="w-5 h-5 flex items-center justify-center text-[#9aa0aa] hover:text-white"
      >
        {locked ? <Lock size={11} /> : <Unlock size={11} />}
      </button>
      {kind === "audio" && (
        <>
          <span className="text-[#9aa0aa]">M</span>
          <span className="text-[#9aa0aa]">S</span>
        </>
      )}
    </div>
  );
}
