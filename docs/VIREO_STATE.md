# VIREO State

## Repo (canonical)

- Working dir: `C:\Users\koval\vireo-active` (NOT OneDrive)
- Remote: `https://github.com/savelii111/vireo.git` — push after every green day
- Session-start: работаем ТОЛЬКО здесь. Если оказался в другой папке или в OneDrive — СТОП, перейди в `vireo-active` и `git pull`.
- Перед прогоном: перелинковать зависимости только на этот репо: `npm ci` если есть доверенный `package-lock.json`, иначе `npm install --package-lock=false`; затем `pip install -e agents/style-learner -e agents/editor -e agents/video -e packages/shared/python` и проверить `pip show` / `node_modules/@vireo/*` — пути должны быть внутри `C:\Users\koval\vireo-active`.
- Числа брать только из свежего `node tests/run-all.mjs`; НИКОГДА не откатываться на старые коммиты при потере памяти — читать `git log` + этот файл.
- НИКОГДА не использовать старые OneDrive/stale-копии как источник истины; после консолидации они переименованы и не открываются.

## Current Day

Day 14 complete.

## What Changed

- Finished Studio Effect Controls UI in the Inspector:
  - added a `controls` tab with transform-at-playhead controls (`x`, `y`, `scale`, `opacity`, `rotation`);
  - added transform keyframe add/remove controls for the current playhead;
  - added effect-parameter keyframe add/remove controls for existing clip effects;
  - wired Inspector props through `App.tsx` for `playhead`, `onSetKeyframe`, and `onRemoveKeyframe`.
- Updated shared timeline/keyframe contracts and Studio backend tests so human/bot keyframes share one undoable timeline.
- Fixed shared timeline round-trip coverage for forward ops through inverse ops, including `insertClip`.
- Added frontend coverage for Inspector controls and keyframe behavior.

## Test Anchor

`node tests/run-all.mjs` after Day 14 changes:

- `TOTAL: 1330 passed, 0 failed across 27 suites`

Frontend checks:

- `npm run typecheck` → `exit 0`
- `npm test` → `25 passed` (MediaPanel, useEditor insertAsset/keyframes, Timeline asset drop, playback)

## Next

Day 14 ready for commit/push/zip.
