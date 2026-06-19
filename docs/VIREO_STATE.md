# VIREO State

## Repo (canonical)

- Working dir: `C:\Users\koval\vireo-active` (NOT OneDrive)
- Remote: `https://github.com/savelii111/vireo.git` — push after every green day
- Session-start: работаем ТОЛЬКО здесь. Если оказался в другой папке или в OneDrive — СТОП, перейди в `vireo-active` и `git pull`.
- Перед прогоном: перелинковать зависимости только на этот репо: `npm ci` если есть доверенный `package-lock.json`, иначе `npm install --package-lock=false`; затем `pip install -e agents/style-learner -e agents/editor -e agents/video -e packages/shared/python` и проверить `pip show` / `node_modules/@vireo/*` — пути должны быть внутри `C:\Users\koval\vireo-active`.
- Числа брать только из свежего `node tests/run-all.mjs`; НИКОГДА не откатываться на старые коммиты при потере памяти — читать `git log` + этот файл.
- НИКОГДА не использовать старые OneDrive/stale-копии как источник истины; после консолидации они переименованы и не открываются.

## Current Day

Day 20 complete.

## Day 20 — Real media ingest (TUS + ffprobe, real_decode)

- Finished Day 20 Real media ingest:
  - fixed Studio TUS proxy auth/header/body path to `video-agent`;
  - forwarded `Authorization` to the upstream video agent;
  - added `content-length` to required TUS passthrough headers;
  - kept real TUS semantics: `POST /upload/resumable` creates the upload without a body, then `PATCH` streams the real bytes;
  - forwarded `Authorization` on ingest GET so protected video-agent endpoints work with the same JWT;
  - added detailed upstream logging behind `VIREO_TUS_DEBUG`;
  - added `e?.stack` logging on proxy catch;
  - added real e2e coverage through `studio proxy -> video-agent` using `agents/video/tests/fixtures/sample_10s.mp4`;
  - verified real ffprobe metadata: `real_decode=true`, `duration=10`, `1280x720`, `30fps`, `h264`, `hasAudio=true`;
  - captured real UI screenshot `docs/vireo-day20-ingest.png`.

## What Changed

- Finished Day 18 Export:
  - added shared export presets: `youtube_1080p`, `youtube_4k`, `instagram_square_1080`, `tiktok_vertical_1080`, `web_720p`;
  - added `normalizeExportPreset`, `buildRenderPlan`, and `buildFfmpegArgs`;
  - render/export reuse existing shared functions for color/audio/titles: `computeClipColorAt`, `computeClipGainDb`, `evalParamAtTime`, and `duckingEnvelope`;
  - added pixel-parity bridge shared by Preview CSS and ffmpeg `eq` args;
  - added Studio export queue/result endpoints:
    - `POST /api/exports`;
    - `GET /api/exports/:jobId`;
    - `GET /api/exports/:jobId/result`;
  - added deterministic export `jobId`, queued/running/done/failed/canceled states, in-memory worker, and PG persistence migration;
  - added simulated-media placeholder render metadata: `simulated_media: true`, `real_encode: false`;
  - added real-encode path behind capability flag using system `ffmpeg` / `fluent-ffmpeg`;
  - wired frontend Export dialog, preset picker, polling, download result link, and simulated-media badge.
- Added shared tests A/B/C/D for export presets, render plan, ffmpeg args, and pixel parity.
- Updated `packages/shared/index.d.ts` exports for `EXPORT_PRESETS`, `ExportPreset`, `ExportJob`, `normalizeExportPreset`, `buildRenderPlan`, and `buildFfmpegArgs`.
- Added `agents/storage/src/migrations.js` migration `013_studio_exports` and updated storage migration coverage.

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

## Day 17 — Color / Lumetri (Basic + Creative + Curves + Wheels)

- Added shared `setClipColor` for visual clips only (`video` / `image`), with field-level merge, inverse payloads, and version bump.
- Added normalized Lumetri model:
  - Basic Correction: `temperature`, `tint`, `exposure`, `contrast`, `highlights`, `shadows`, `whites`, `blacks`, `saturation`, `vibrance`;
  - Creative: LUT slot `{id,name,intensity}`, `faded`, `sharpen`, `tintShadows`, `tintHighlights`;
  - Curves: `master/r/g/b` point arrays in `0..1`;
  - Wheels: `shadows/midtones/highlights` RGB shifts.
- Reused existing keyframe store with `targetId: "color"` and `clip.keyframes.effects.color.<param>`.
- Added deterministic `computeClipColorAt` and simulated scope metadata:
  - `simulated_scopes: true`;
  - `real_pixel_analysis: false`;
  - `real_lut_apply: false`.
- Wired frontend Lumetri panel and CSS-filter approximation preview; no real color pipeline / real LUT application was added.
- Added shared/backend/frontend tests for merge, undo, guards, keyframes, metadata, and preview approximation.

## Test Anchor

`node tests/run-all.mjs` after Day 20 changes:

- `TOTAL: 1346 passed, 0 failed across 27 suites`

Day 20 targeted checks:

- `npm run typecheck` → `exit 0`
- `node tests/test_shared_timeline.js` → `exit 0`
- `node --test agents/studio/tests/test_timeline_ops.js` → `exit 0`
- `pytest --maxfail=1` in `agents/video` → `exit 0`
- `npx --yes -p vitest -p jsdom vitest --environment jsdom --run` → `exit 0`
- `node tests/run-all.mjs > /tmp/runall.log 2>&1; echo EXIT=$?; tail -3 /tmp/runall.log` → `EXIT=0`
- `Studio E2E (Node)` → `2 passed, 0 failed`
- `studio TUS proxy -> video-agent ingest uses real auth and real ffprobe` → green
- `docs/vireo-day20-ingest.png` → real UI screenshot captured

Frontend checks:

- `npm run typecheck` → `exit 0`
- `npx --yes -p vitest -p jsdom vitest --environment jsdom --run` → `29 passed` tests

Shared/backend targeted checks:

- `node tests/test_shared_timeline.js` → `22 passed`
- `node --test agents/studio/tests/test_timeline_ops.js` → `22 passed`
- `pytest --maxfail=1` in `agents/video` → `exit 0`
- Day 20 e2e: Studio TUS proxy uploads `sample_10s.mp4` to video-agent and `real_decode=true`.

## Next

Day 21 — Postgres persistence.
