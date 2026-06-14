# VIREO State

## Repo (canonical)

- Working dir: `C:\Users\koval\vireo-active` (NOT OneDrive)
- Remote: `https://github.com/savelii111/vireo.git` — push after every green day
- Session-start: работаем ТОЛЬКО здесь. Если оказался в другой папке или в OneDrive — СТОП, перейди в `vireo-active` и `git pull`.
- Перед прогоном: перелинковать зависимости только на этот репо: `npm ci` если есть доверенный `package-lock.json`, иначе `npm install --package-lock=false`; затем `pip install -e agents/style-learner -e agents/editor -e agents/video -e packages/shared/python` и проверить `pip show` / `node_modules/@vireo/*` — пути должны быть внутри `C:\Users\koval\vireo-active`.
- Числа брать только из свежего `node tests/run-all.mjs`; НИКОГДА не откатываться на старые коммиты при потере памяти — читать `git log` + этот файл.
- НИКОГДА не использовать старые OneDrive/stale-копии как источник истины; после консолидации они переименованы и не открываются.

## Current Day

Day 11 complete.

## Last Commit

a902118 — studio: Day 11 — Premiere-style layout + Vireo DESIGN.md, remove desktop drift

## What Changed

- Removed desktop drift:
  - deleted `agents/studio/desktop`
  - deleted `tests/test_desktop_app.js`
  - removed desktop suite from `tests/run-all.mjs`
  - no remaining `desktop` references in `tests/`, `scripts/`, `package.json`, or `docker*`
- Added `docs/DESIGN.md` as the Vireo UI single source of truth.
  - Direction: dark pro-video AI editor, Premiere × Linear/Framer/Vercel.
  - 9-section contract: color, typography, spacing, layout, components, motion, voice, brand, anti-patterns.
- Aligned Tailwind/index.css tokens with `docs/DESIGN.md`.
- Re-laid out the Studio shell as a Premiere-style NLE grid:
  - top: `TopBar`
  - left: `SideRail`
  - center-top: `Preview`
  - right: `Inspector` + `ChatPanel` tabs
  - bottom: full-width `Timeline`
- Preserved existing behavior: playback, op-actions, undo/redo, and hotkeys remain wired through existing components.
- Fixed shared timeline contract drift for frontend `setTransform` / `setVolume` ops used by existing Inspector tests.
- Captured before/after screenshots:
  - `docs/vireo-day11-before.png`
  - `docs/vireo-day11-after.png`

## Test Anchor

`node tests/run-all.mjs` after Day 11 changes:

- `TOTAL: 1320 passed, 0 failed across 27 suites`

Consolidation v2 control run after stale-copy rename:

- `TOTAL: 1320 passed, 0 failed across 27 suites`

Frontend checks:

- `npm run typecheck` → `exit 0`
- `npm test` → `2 passed`, `18 passed`

## Next

Awaiting Day 11 confirmation before Day 12.
