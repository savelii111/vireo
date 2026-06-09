# Vireo Studio — Frontend

Production React app for the Vireo Studio chat-driven video editor.

## Stack

- **Vite 5** — build tool, HMR
- **React 18** + **TypeScript** — UI
- **Tailwind CSS 3** — styling (Vireo design tokens in `tailwind.config.js`)
- **Lucide React** — icons (no emoji slop)
- **`clsx`** — class composition

## Run

```bash
cd agents/studio/frontend
npm install
npm run dev          # starts on :5173, proxies /api → :8787
```

Backend (Node, separate terminal):

```bash
cd agents/studio
node src/server.js    # studio API on :8787
```

## Build

```bash
npm run build        # outputs to dist/
```

The Node server in `agents/studio/src/server.js` is configured to serve
`dist/` as static files in production (see `STUDIO_STATIC_DIR`).

## Structure

```
src/
  App.tsx                  3-column shell: TopBar + SideRail + Workspace + ChatPanel
  main.tsx                 React root
  index.css                Tailwind base + design tokens
  types.ts                 Domain types
  mockData.ts              Initial project (4 tracks, 13 clips, 5 chat messages)
  mockChat.ts              Fallback assistant responder (used when backend offline)
  components/
    TopBar.tsx             Brand + breadcrumbs + mode switcher + actions
    SideRail.tsx           7 tool icons + settings
    Preview.tsx            Video stage with playhead, controls, overlays
    Inspector.tsx          3-column: clip info + param sliders + quick actions
    Timeline.tsx           4-track timeline with clips, ruler, playhead
    ChatPanel.tsx          Streaming chat with tool calls, suggestions
  hooks/
    useEditor.ts           Project state, selection, playhead, tool
    useChat.ts             Message list with optimistic updates
    useChatStream.ts       SSE client with mock fallback
  utils/
    time.ts                Timecode + short-time formatters
```

## Design system

All design tokens live in `tailwind.config.js`:

- **bg-0..4** — background depth
- **border-1..3** — dividers
- **ink-1..4** — text hierarchy
- **accent** — primary action (indigo `#6366f1`)
- **rec** — recording red
- **success / warn / danger / info** — semantic

Motion uses `cubic-bezier(0.2, 0, 0, 1)` (the Vireo easing) at 120-320ms.

## Wire to backend

The chat panel posts to `/api/chat/stream` (SSE). If backend is offline,
it transparently falls back to `mockChat.ts` so the UI is always
testable in isolation. Timeline mutations come back as tool_call
events with `args` matching the backend tool schema.

## Why this stack

- **No build framework beyond Vite** — fastest dev loop, smallest config
- **No state library** — useState + hooks is enough at this scale
- **No router** — single-page editor; views are tabs/panels
- **No CSS-in-JS** — Tailwind + design tokens
- **No data fetching lib** — `fetch` + custom hooks (5 lines each)
