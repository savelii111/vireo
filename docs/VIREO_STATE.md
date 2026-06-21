# VIREO State

## Repo (canonical)

- Working dir: `C:\Users\koval\vireo-active` (NOT OneDrive)
- Remote: `https://github.com/savelii111/vireo.git` — push after every green day
- Session-start: работаем ТОЛЬКО здесь. Если оказался в другой папке или в OneDrive — СТОП, перейди в `vireo-active` и `git pull`.
- Перед прогоном: перелинковать зависимости только на этот репо: `npm ci` если есть доверенный `package-lock.json`, иначе `npm install --package-lock=false`; затем `pip install -e agents/style-learner -e agents/editor -e agents/video -e packages/shared/python` и проверить `pip show` / `node_modules/@vireo/*` — пути должны быть внутри `C:\Users\koval\vireo-active`.
- Числа брать только из свежего `node tests/run-all.mjs`; НИКОГДА не откатываться на старые коммиты при потере памяти — читать `git log` + этот файл.
- НИКОГДА не использовать старые OneDrive/stale-копии как источник истины; после консолидации они переименованы и не открываются.

## Current Day

Day 22 complete.

## Day 22 — Real video playback in Preview (HTML5 video + shared color bridge)

- Finished Day 22 real media playback:
  - `GET /api/assets/:id/media` resolves only `asset id -> DB row -> real TUS/media file path`;
  - query-token auth for browser `<video>`: `?access_token=<session JWT>`;
  - missing/invalid token returns `401`;
  - no `Range` returns `200` with `Accept-Ranges: bytes` and real media bytes;
  - `Range: bytes=0-1023` returns `206` with exact requested bytes and correct `Content-Range`;
  - path traversal is blocked because callers cannot supply the file path;
  - `Preview.tsx` now renders real media through native `<video src=...>` instead of fake canvas frames;
  - `assetUrlResolver` prefers `clip.assetId || clip.source_file` and builds the media endpoint URL;
  - `assetId` is carried through `Clip`, `timelineContract.ts`, and API conversions;
  - `source_time = in + (playhead - start)` is now canonical; stale `seekTime: 4` assertion was updated to `6`;
  - `timeupdate -> playhead` sync is guarded against feedback loops;
  - Preview color/transform/opacity goes through the shared bridge (`computeClipColorAt`, `colorGradeToPreviewCss`, `evalParamAtTime`) rather than a second local formula.
- Added Day 22 tests:
  - A: `tests/test_studio_media_e2e.mjs` verifies `200`, `206`, `401`, exact Range bytes, and real file streaming;
  - B: `agents/studio/frontend/tests/playback.test.tsx` verifies `resolvePlaybackFrame`, `seekTime`, shared color CSS, and real `<video>` rendering;
  - C: gated `tests/test_studio_media_playwright_gated.mjs` runs `tests/playwright/studio_media_playwright.mjs`; Chromium decodes a real Studio media endpoint response with `drawImage` + `getImageData` and proves a non-black/non-homogeneous frame.
- Security note for future pass: query `access_token` works for the local MVP but leaks through URLs/logs/referrers; future hardening should use a short-lived media-scoped token instead of the main session JWT.
- Captured real screenshot `docs/vireo-day22-playback.png` showing Chromium playback from the Studio media endpoint.
- Cleaned temporary screenshot/helper scripts; kept only committed Day 22 test/source files.

## Day 21 — Postgres persistence (timelines + assets survive reload)

- Finished Day 21 Postgres persistence:
  - added real PG persistence for Studio timelines and assets;
  - timeline persistence mirrors the op-runner version: `saveTimeline(projectId, doc, version)` stores the passed target version, never increments it, and refuses to overwrite a newer persisted version;
  - `vireo_timelines.document jsonb` is the single canonical writer for current timeline state; `doc` remains only as a read fallback for older rows;
  - `GET /api/timelines/:projectId` hydrates from PG after reload;
  - `PUT /api/timelines/:projectId`, `/ops`, `/undo`, and `/redo` write `document + version` through PG;
  - `StudioAssetStore.listAssets(projectId)` remains the single asset-list source; no duplicate timeline asset list;
  - added `014_studio_persistence_fields` migration columns:
    - `vireo_timelines.document`
    - `vireo_timelines.undone_at`
    - `vireo_timelines.redone_at`
    - `vireo_assets.upload_id`
    - `vireo_assets.duration`
    - `vireo_assets.fps`
    - `vireo_assets.video_codec`
    - `vireo_assets.has_audio`
    - `vireo_assets.container`
    - `vireo_assets.real_decode`
    - `vireo_assets.source_uri`;
  - migration is additive/idempotent and applies twice without failure;
  - added real Postgres e2e: create project/asset/timeline ops, close server/pool, rebuild server on the same DB, then verify timeline version/document and asset metadata survive reload;
  - verified real `/health`: `postgres:true`, `pg_ok:true`, `migrations:true` / `migrations_applied=14`;
  - captured real UI screenshot `docs/vireo-day21-persist.png` showing the persisted asset after reload.

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

`node tests/run-all.mjs` after Day 22 changes:

- `TOTAL: 1349 passed, 0 failed across 28 suites`

Day 22 targeted checks:

- `npm run typecheck` → `exit 0`
- `node tests/test_shared_timeline.js` → `exit 0`
- `node --test agents/studio/tests/test_timeline_ops.js` → `exit 0`
- `pytest --maxfail=1` in `agents/video` with `VIREO_PG_URL=postgresql://vireo@127.0.0.1:55432/vireo` → `exit 0`
- `npx --yes -p vitest -p jsdom vitest --environment jsdom --run` → `31 passed`
- `node --test tests/test_studio_media_e2e.mjs` → `exit 0`
- `node --test tests/test_studio_media_playwright_gated.mjs` → `1 passed`
- `node tests/run-all.mjs > /tmp/runall.log 2>&1; echo EXIT=$?; tail -3 /tmp/runall.log` → `EXIT=0`
- `Studio E2E (Node)` → `4 passed, 0 failed`
- `Studio Day 22 Playwright C (gated)` → `1 passed, 0 failed`
- real screenshot → `docs/vireo-day22-playback.png`


Frontend checks:

- `npm run typecheck` → `exit 0`
- `npx --yes -p vitest -p jsdom vitest --environment jsdom --run` → `29 passed` tests

Shared/backend targeted checks:

- `node tests/test_shared_timeline.js` → `22 passed`
- `node --test agents/studio/tests/test_timeline_ops.js` → `22 passed`
- `pytest --maxfail=1` in `agents/video` → `exit 0`
- Day 20 e2e: Studio TUS proxy uploads `sample_10s.mp4` to video-agent and `real_decode=true`.

## Next

Day 22 — playback.
