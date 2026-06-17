# VIREO State

## Repo (canonical)

- Working dir: `C:\Users\koval\vireo-active` (NOT OneDrive)
- Remote: `https://github.com/savelii111/vireo.git` — push after every green day
- Session-start: работаем ТОЛЬКО здесь. Если оказался в другой папке или в OneDrive — СТОП, перейди в `vireo-active` и `git pull`.
- Перед прогоном: перелинковать зависимости только на этот репо: `npm ci` если есть доверенный `package-lock.json`, иначе `npm install --package-lock=false`; затем `pip install -e agents/style-learner -e agents/editor -e agents/video -e packages/shared/python` и проверить `pip show` / `node_modules/@vireo/*` — пути должны быть внутри `C:\Users\koval\vireo-active`.
- Числа брать только из свежего `node tests/run-all.mjs`; НИКОГДА не откатываться на старые коммиты при потере памяти — читать `git log` + этот файл.
- НИКОГДА не использовать старые OneDrive/stale-копии как источник истины; после консолидации они переименованы и не открываются.

## Current Day

Day 15 complete.

## What Changed

- Finished Studio Effect Controls UI in the Inspector:
  - added a `controls` tab with transform-at-playhead controls (`x`, `y`, `scale`, `opacity`, `rotation`);
  - added transform keyframe add/remove controls for the current playhead;
  - added effect-parameter keyframe add/remove controls for existing clip effects;
  - wired Inspector props through `App.tsx` for `playhead`, `onSetKeyframe`, and `onRemoveKeyframe`.
- Updated shared timeline/keyframe contracts and Studio backend tests so human/bot keyframes share one undoable timeline.
- Fixed shared timeline round-trip coverage for forward ops through inverse ops, including `insertClip`.
- Added frontend coverage for Inspector controls and keyframe behavior.

## Day 15 — Titles / Essential Graphics panel

- Extended Day 10 text clips with shared `setTitleProps` title styling (`text`, `fontFamily`, `fontSize`, `color`, `align`, background/stroke fields).
- Reused Day 14 transform keyframes for title position/opacity/scale animation; title styling stays field-based through the op contract.
- Carried `titleProps` through frontend `timelineContract.ts`, `useEditor.ts`, `Inspector.tsx`, and `Preview.tsx`.
- Added shared tests for reversible field-level `setTitleProps`, non-text clip rejection, and `normalizeTitleProps`.
- Added Studio backend coverage for human + bot title styling on one undoable timeline.
- Added frontend coverage for Essential Graphics rendering only on text/title clips and title edits through the op-contract patch path.

## Test Anchor

`node tests/run-all.mjs` after Day 15 changes:

- `TOTAL: 1334 passed, 0 failed across 27 suites`

Frontend checks:

- `npm run typecheck` → `exit 0`
- `npm test` → `27 passed` (MediaPanel, useEditor insertAsset/keyframes, Timeline asset drop, playback)

## Next

Day 15 ready for commit/push/zip.
