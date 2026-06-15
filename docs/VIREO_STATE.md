# VIREO State

## Repo (canonical)

- Working dir: `C:\Users\koval\vireo-active` (NOT OneDrive)
- Remote: `https://github.com/savelii111/vireo.git` — push after every green day
- Session-start: работаем ТОЛЬКО здесь. Если оказался в другой папке или в OneDrive — СТОП, перейди в `vireo-active` и `git pull`.
- Перед прогоном: перелинковать зависимости только на этот репо: `npm ci` если есть доверенный `package-lock.json`, иначе `npm install --package-lock=false`; затем `pip install -e agents/style-learner -e agents/editor -e agents/video -e packages/shared/python` и проверить `pip show` / `node_modules/@vireo/*` — пути должны быть внутри `C:\Users\koval\vireo-active`.
- Числа брать только из свежего `node tests/run-all.mjs`; НИКОГДА не откатываться на старые коммиты при потере памяти — читать `git log` + этот файл.
- НИКОГДА не использовать старые OneDrive/stale-копии как источник истины; после консолидации они переименованы и не открываются.

## Current Day

Day 13 complete.

## What Changed

- Added Studio `Project / Media` panel with project asset listing, simulated ingest form, bin filters, search, and draggable asset cards.
- Wired MediaPanel into the app layout above the preview workspace and passed `editor.insertAsset` into Timeline.
- Added Timeline asset drop targets on tracks, converting drag/drop into shared `insertClip` timeline ops with human actor.
- Added `ProjectAsset` frontend types and metadata-only import payload contract.
- Added backend coverage for human+bot asset inserts sharing one undoable timeline.

## Test Anchor

`node tests/run-all.mjs` after Day 13 changes:

- `TOTAL: 1326 passed, 0 failed across 27 suites`

Frontend checks:

- `npm run typecheck` → `exit 0`
- `npm test` → `22 passed` (MediaPanel, useEditor insertAsset, Timeline asset drop, playback)

## Next

Awaiting Day 13 confirmation before Day 14.
