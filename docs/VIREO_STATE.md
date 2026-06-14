# VIREO_STATE.md

**Обновлено:** 2026-06-14  
**Последний коммит:** `afb9fd4` — `docs: record orchestrator python bridge status`  
**Месяц/день по плану:** Месяц 2 / День 9 — переходы, эффекты и текст в UI-редакторе как ops.  
**Текущая задача:** STOP-задача 0 вернуть `node tests/run-all.mjs` в `0 failed`; STOP-задача 1 закрепить якорь состояния в репо.  
**run-all итог:** `TOTAL: 1315 passed, 0 failed across 28 suites`.

## Что готово

- Задача 0 выполнена: общий прогон тестов вернулся в `0 failed`.
- Падал тест `Shared Timeline Contract (Node)` / `shared timeline transition/effect/text ops apply and inverse back out`.
- Причина: `addText` терял `payload.transform`, а `applyTimelineOp` не сохранял `inverse`, поэтому undo для `setEffect` получал `Timeline op must be an object`.
- Починено в `packages/shared/timeline.js`: `addText` сохраняет `transform`, а `applyTimelineOp` возвращает документ с неперечисляемым `inverse`.

## Что следующее

- НЕ начинать Playback/preview, пока STATE не закоммичен.
- После коммита можно переходить к Дню 9: UI-контролы transitions/effects/text только через существующий `useEditor` op-путь.
- В конце каждого дня обновлять этот файл и делать отдельный коммит.
