# VIREO_STATE.md

**Обновлено:** 2026-06-14  
**Последний коммит:** `19acfcd` — `studio: Day 9 preview playback inspector`  
**Текущий Day 10 commit:** pending — `studio: Day 10 inspector controls transitions effects text`  
**Месяц/день по плану:** Месяц 2 / День 10 — live Inspector controls + timeline controls for transitions/effects/text через `useEditor` op-путь.  
**Текущая задача:** Day 10: добавить transform/volume controls в Inspector, controls для transitions/effects/text в Timeline, vitest на op-контракт и зафиксировать результат.  
**run-all итог:** `TOTAL: 1248 passed, 0 failed across 26 suites`.  
**frontend vitest итог:** `2 passed (2 files), 18 passed (18 tests)`.  
**frontend typecheck:** `tsc --noEmit` — exit 0.

## Что готово

- STOP-задача выполнена: общий прогон тестов вернулся в `0 failed`.
- Day 9 ground truth:
  - `docs/VIREO_STUDIO_12_MONTH_PLAN_2026-06-11.md` подтверждает актуальность Day 9.
  - `packages/shared/timeline.js` / shared contract остаётся источником формы timeline op.
  - `agents/studio/frontend/src/hooks/useEditor.ts` остаётся единственным frontend write-путём: GET timeline, POST `/api/timelines/:projectId/ops`, `baseVersion`, 409→rebase, undo/redo.
  - `higgsfield_simulated` / placeholder не должны рендериться как фейковые кадры.

- Day 9 playback:
  - добавлен `agents/studio/frontend/src/timelinePlayback.ts`;
  - реализованы `activeClipAtTrack`, `activeClipsAt`, `activeVideoClipAt`, `activeTextClipsAt`, `advancePlayhead`, `seekToFrame`, `previewModeForClip`, `hasRealMediaPath`, `isPlaceholderClip`, `transformPosition`;
  - `useEditor` теперь ведёт playback loop через `requestAnimationFrame`, snapping по fps, clamp на `project.duration_sec`.

- Day 9 preview/inspector:
  - `Preview.tsx` рендерит real media через `<video>` и simulated/placeholder через poster-card;
  - active text overlays рисуются поверх preview surface;
  - `Inspector.tsx` показывает track/start/end/asset/source/transform/effects/media-mode;
  - Inspector на Day 9 остаётся read-only; будущих edits делать только через `useEditor` op-путь.

- Day 9 Timeline:
  - click по ruler и track area вызывает `seek`;
  - drag/move/resize остаются на существующем `useEditor` op-пути.

- Day 10 Inspector live controls:
  - добавлены shared ops `setTransform` / `setVolume` в `packages/shared/timeline.js`;
  - `useEditor` экспортирует `setTransform(clipId, transform)` и `setVolume(clipId, volume)` через тот же op-путь: optimistic local op → `POST /api/timelines/:projectId/ops` с `baseVersion` и `actor:"human"` → `409` rebase → undo/redo;
  - `Inspector.tsx` показывает live sliders для X/Y/Scale/Opacity/Volume и не пишет напрямую в state;
  - `Preview.tsx` применяет transform к video/placeholder/text overlay.

- Day 10 Timeline controls:
  - Timeline controls для transitions/effects/text подключены к `useEditor` op-методам;
  - добавлены `data-testid` для transition/effect/text controls и Inspector props/callbacks.

- Day 10 tests:
  - в `agents/studio/frontend/tests/useEditor.day5.test.tsx` добавлены tests на `setTransform`/`setVolume`;
  - покрыты optimistic apply, `baseVersion`, `actor:"human"`, undo/redo и `409` rebase retry;
  - frontend `package.json` добавляет `npm test` / `npm run test:watch` с jsdom environment.

- Verification fixes:
  - `packages/shared/index.js` экспортирует `timeline.js`, чтобы frontend shared-timeline import работал через общий shared index;
  - `agents/video/vireo_video/history.py` получил deterministic record order для `EditHistory.list/latest`, чтобы revert всегда был newest;
  - typecheck fixes for ChatPanel props and unused `Track`/`Marker` imports.

- Day 9 tests:
  - добавлен `agents/studio/frontend/tests/playback.test.tsx`;
  - покрыты active clip lookup, playhead advance/seek, real vs simulated media, Preview real media, Preview placeholder, text overlay, Inspector read-only properties/effects.

## Что следующее

- После Day 10 commit перейти к следующему подтверждённому шагу из `docs/VIREO_STUDIO_12_MONTH_PLAN_2026-06-11.md`.
- Не начинать мультитрек-drag, keyframes, export или Desktop App без отдельного подтверждения.
