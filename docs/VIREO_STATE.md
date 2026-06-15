# VIREO State

## Repo (canonical)

- Working dir: `C:\Users\koval\vireo-active` (NOT OneDrive)
- Remote: `https://github.com/savelii111/vireo.git` — push after every green day
- Session-start: работаем ТОЛЬКО здесь. Если оказался в другой папке или в OneDrive — СТОП, перейди в `vireo-active` и `git pull`.
- Перед прогоном: перелинковать зависимости только на этот репо: `npm ci` если есть доверенный `package-lock.json`, иначе `npm install --package-lock=false`; затем `pip install -e agents/style-learner -e agents/editor -e agents/video -e packages/shared/python` и проверить `pip show` / `node_modules/@vireo/*` — пути должны быть внутри `C:\Users\koval\vireo-active`.
- Числа брать только из свежего `node tests/run-all.mjs`; НИКОГДА не откатываться на старые коммиты при потере памяти — читать `git log` + этот файл.
- НИКОГДА не использовать старые OneDrive/stale-копии как источник истины; после консолидации они переименованы и не открываются.

## Current Day

Day 12 complete.

## What Changed

- Added shared timeline contract coverage for snapTime, move/trim overlap clamping, locked track rejection, and soloed track flag propagation.
- Updated the Studio frontend timeline drag/trim/snap path to use the shared op contract and preserve targetTrackId.
- Wired frontend `toggleTrackSolo` through the shared op path instead of local-only state mutation.
- Kept `createdAt` on public ops so inverse/internal ops stay distinguishable.
- Added a shared TypeScript declaration for `packages/shared/index.js`.

## Test Anchor

`node tests/run-all.mjs` after Day 12 changes:

- `TOTAL: 1325 passed, 0 failed across 27 suites`

Frontend checks:

- `npm run typecheck` → `exit 0`
- `npm test` → `2 passed`, `18 passed`

## Next

Awaiting Day 12 confirmation before Day 13.
