# VIREO State

## Repo (canonical)

- Working dir: `C:\Users\koval\vireo-active` (NOT OneDrive)
- Remote: `https://github.com/savelii111/vireo.git` — push after every green day
- Session-start: работаем ТОЛЬКО здесь. Если оказался в другой папке или в OneDrive — СТОП, перейди в `vireo-active` и `git pull`.
- Перед прогоном: перелинковать зависимости только на этот репо: `npm ci` если есть доверенный `package-lock.json`, иначе `npm install --package-lock=false`; затем `pip install -e agents/style-learner -e agents/editor -e agents/video -e packages/shared/python` и проверить `pip show` / `node_modules/@vireo/*` — пути должны быть внутри `C:\Users\koval\vireo-active`.
- Числа брать только из свежего `node tests/run-all.mjs`; НИКОГДА не откатываться на старые коммиты при потере памяти — читать `git log` + этот файл.
- НИКОГДА не использовать старые OneDrive/stale-копии как источник истины; после консолидации они переименованы и не открываются.

## Current Day

Day 16 complete.

## What Changed

- Finished Day 16 audio mixer without real decode/DSP:
  - added shared `setTrackAudio` / `setClipAudio` op contract for gain, pan, fades, crossfade, ducking, metadata-only meters/waveform;
  - added track `role` through `setTrackAudio` so deterministic ducking can mark `role: "voice"` through the op contract;
  - reused existing `setKeyframe`/`evalParamAtTime` for volume keyframes via `targetId: "audio"`;
  - wired frontend mixer/audio inspector controls, simulated meters/waveform badges, and timeline fade/ducking markers;
  - added shared/backend/frontend tests for audio merge, inverse, deterministic ducking, human+bot path, and metadata-only visualization.
- Updated shared timeline/keyframe contracts and Studio backend tests so human/bot audio state shares one undoable timeline.
- Added frontend coverage for Inspector audio tab and simulated meters/waveform.

## Day 15 — Titles / Essential Graphics panel

- Extended Day 10 text clips with shared `setTitleProps` title styling (`text`, `fontFamily`, `fontSize`, `color`, `align`, background/stroke fields).
- Reused Day 14 transform keyframes for title position/opacity/scale animation; title styling stays field-based through the op contract.
- Carried `titleProps` through frontend `timelineContract.ts`, `useEditor.ts`, `Inspector.tsx`, and `Preview.tsx`.
- Added shared tests for reversible field-level `setTitleProps`, non-text clip rejection, and `normalizeTitleProps`.
- Added Studio backend coverage for human + bot title styling on one undoable timeline.
- Added frontend coverage for Essential Graphics rendering only on text/title clips and title edits through the op-contract patch path.

## Day 16 — Audio mixer + volume keyframes + ducking/fades

- Added shared `setTrackAudio` / `setClipAudio` ops with field-level merge and inverse payloads.
- Added `role` to audio sidechain metadata via `setTrackAudio` so ducking can be enabled with `role: "voice"` through the op contract.
- Added deterministic ducking helpers and reused `targetId: "audio"` keyframes for volume automation.
- Added frontend audio inspector controls, simulated meters/waveform badges, and timeline fade/ducking markers.
- Added shared/backend/frontend tests for audio merge, inverse, deterministic ducking, human+bot path, and metadata-only visualization.

## Test Anchor

`node tests/run-all.mjs` after Day 16 changes:

- `TOTAL: 1337 passed, 0 failed across 27 suites`

Frontend checks:

- `npm run typecheck` → `exit 0`
- `npm test` → `27 passed` (MediaPanel, useEditor insertAsset/keyframes, Timeline asset drop, playback)

## Next

Day 16 ready for commit/push/zip.
