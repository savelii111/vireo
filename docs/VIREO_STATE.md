# VIREO_STATE.md

**Обновлено:** 2026-06-14  
**Последний коммит:** `61d7ac5` — `stop-task: restore test suite and anchor Vireo state`  
**Текущий Day 9 commit:** pending — `studio: Day 9 preview/playback/inspector`  
**Месяц/день по плану:** Месяц 2 / День 9 — preview/playback поверх timeline-doc + read-only inspector.  
**Текущая задача:** Day 9: реальный preview/playback + inspector, без новых write-путей; все будущие правки клипов только через существующий `useEditor` op-путь.  
**run-all итог:** `TOTAL: 1315 passed, 0 failed across 28 suites`.  
**frontend vitest итог:** `3 passed (3 files), 19 passed (19 tests)`.  
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

- Day 9 tests:
  - добавлен `agents/studio/frontend/tests/playback.test.tsx`;
  - покрыты active clip lookup, playhead advance/seek, real vs simulated media, Preview real media, Preview placeholder, text overlay, Inspector read-only properties/effects.

## Что следующее

- Не начинать переходы/эффекты/текст-controls, мультитрек-drag, кейфреймы, экспорт.
- После Day 9 commit перейти к следующему подтверждённому шагу из `docs/VIREO_STUDIO_12_MONTH_PLAN_2026-06-11.md`.
