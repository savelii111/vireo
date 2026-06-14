# Vireo Studio — 12-месячный план развития

**СТАТУС:** суперсед, актуальная очередь задач приходит от Савелия по дням; состояние — в `docs/VIREO_STATE.md`.

**Дата:** 2026-06-11  
**Продукт:** Vireo Studio  
**Позиционирование:** AI video editor уровня категории Premiere / InVideo / Higgsfield, но с собственной реализацией.

---

## 0. Важное юридическое правило

Мы строим продукт той же категории, что Adobe Premiere / InVideo / Higgsfield.

Можно:

- повторять проверенные UX-паттерны: timeline, preview, inspector, media library, export presets, chat assistant;
- изучать конкурентов как продуктовую категорию;
- делать свою архитектуру, свой код, свой дизайн, свои иконки, свои названия, свои API;
- брать лучшие практики: keyboard shortcuts, drag/drop, clip selection, track locking, timeline zoom, render queue, plan-preview.

Нельзя:

- копировать проприетарный код Adobe / InVideo / Higgsfield;
- копировать их верстку, ассеты, иконки, логотипы, тексты, дизайн-систему;
- выдавать продукт за их продукт;
- парсить закрытые приложения или обходить защиту.

**Наша цель:** сделать продукт той же категории, но со своей оригинальной реализацией: ручная студия слева + Claude AI-креативный директор справа + Higgsfield/FFmpeg генерация видео.

---

## 1. Продуктовая формула

```text
Vireo Studio =
  ручной видео-редактор уровня Adobe Premiere
  (timeline / preview / inspector / export) слева
  +
  AI-креативный директор на Claude справа
  +
  генерация видео Higgsfield
  (Kling / Sora / Veo / Seedance / Wan)
  +
  FFmpeg-пайплайн
  +
  агенты style / edit / publish / analytics
  +
  storage / auth / billing / audit / safety
```

---

## 2. Главный вывод на сегодня

Фундамент уже собран.

Есть:

- Studio entry point;
- светлый Studio-shell вместо старого dashboard;
- React-skeleton редактора;
- chat-backend с tool-calls;
- Claude/Anthropic provider;
- Higgsfield client layer;
- Video agent на FFmpeg / Whisper / TUS;
- Storage/Auth/Billing/Audit/Safety;
- Distributor/Analyst;
- первые тесты.

Работа на год — не писать с нуля, а **связать слои и довести до production**.

---

## 3. Четыре слоя продукта

### Layer 1 — Editor

Ручная студия:

- media library;
- preview;
- timeline;
- inspector;
- clip-операции;
- audio;
- subtitles;
- transitions;
- export presets;
- undo/redo;
- save/load;
- render queue.

### Layer 2 — AI Creative Director

Бот справа:

- понимает задачу;
- задаёт уточняющие вопросы;
- строит plan;
- вызывает tools;
- объясняет действия;
- помнит preferences;
- работает RU/EN;
- не делает destructive-действия без подтверждения;
- умеет apply actions to timeline.

### Layer 3 — Video Generation

- Higgsfield generate from director output;
- FFmpeg edit;
- Whisper transcription;
- chapters;
- hooks;
- viral moments;
- thumbnails;
- async jobs;
- progress;
- asset download.

### Layer 4 — Publishing Loop

- platform presets;
- OAuth;
- draft-first;
- publish confirmation;
- analytics;
- audit;
- AI-disclosure;
- watermarking.

---

## 4. Что уже сделано

| Слой | Где в коде | Что уже есть | Статус |
| --- | --- | --- | --- |
| Studio entry point | `apps/dashboard/public/` | Старый dashboard убран; светлый Studio-shell «Manual Edit + Bot»; `/dashboard → Studio` | ✅ Готово shell |
| React-редактор | `agents/studio/frontend/src/` | Layout Premiere-like; project/tracks/clips/selected/playhead/zoom; tools select/razor/slip/slide; hotkeys; command palette; undo/redo; split/move/resize; mute/solo/lock | 🟡 Skeleton |
| Studio chat-backend | `agents/studio/src/` | `/api/chat` + `/api/chat/stream`; LLM-loop с tool-calls; ownership-check; confirmation-token; budget/usage/audit; persona | 🟡 Backend есть, UI не привязан |
| LLM-провайдеры | `agents/studio/src/llm_providers.js` | anthropic/Claude, openai, gemini, openrouter, groq, mistral, deepseek, ollama, lmstudio | ✅ Есть |
| Higgsfield | `agents/studio/src/higgsfield_client.js` | HiggsfieldClient, models, camera moves, style presets, generateVideo/getJobStatus/cancelJob/generateFromDirector | 🟡 Mock/simulated |
| Video-agent `:8007` | `agents/video/vireo_video/` | FFmpeg edit sync/async, TUS resumable upload, Whisper, chapters/hooks/moments/thumbnail, presets/styles | ✅ Работает с реальным видео |
| Editor-agent `:8002` | `agents/editor/vireo_editor/` | edit-plan, hooks, scoring по Style DNA | ✅ Готово |
| Storage | `agents/storage/src/migrations.js` | projects, content_pieces, conversations, messages, message_seq, style_dna, jobs, audit, metrics, users, subscriptions, usage, invoices, oauth | ✅ Фундамент |
| Distributor/Analyst | `agents/distributor`, `agents/analyst` | platform adapters, scheduler, publisher, metrics/analytics, EU AI Act audit | ✅ Готово, не связано с редактором |
| Security/orchestration | `security.js`, `injection-guard.js`, `observability.js`, `latency.js`, `tus_proxy.js`, `apps/orchestrator` | prompt-injection guard, observability, latency-budgets, TUS-proxy, orchestrator знает entry = Studio | ✅ Есть |

---

## 5. Что пока не готово

| Область | Чего не хватает |
| --- | --- |
| React-редактор | Реальная загрузка видео, drag/drop, waveform, clip-thumbnails, real playback, proxy-media, persistence timeline, render progress в UI, apply bot → timeline, collaboration |
| Higgsfield | Реальные API-вызовы, polling, webhooks, asset download, real credits/budget, persistence jobs, ownership-checks, вставка в timeline |
| Claude-бот | UI ChatPanel не привязан к `/api/chat/stream`; нет показа tool-calls/results, plan-preview, progress, apply to timeline; default Claude надо зафиксировать |
| Publish loop | Нет удобного пути edit → export → draft → confirm → publish → analytics из редактора |
| CI/тесты | `agents/studio` npm test падает, хотя `node --test "tests/*.js"` проходит — надо починить pattern |

---

## 6. Контракт таймлайна

Timeline проекта должен стать единым JSON-документом. Ручные правки человека и tool-calls бота должны идти через одни и те же edit-команды.

```json
{
  "timelineId": "tl_...",
  "projectId": "p_...",
  "fps": 30,
  "resolution": { "w": 1080, "h": 1920 },
  "version": 17,
  "tracks": [
    {
      "id": "trk_v1",
      "kind": "video",
      "muted": false,
      "locked": false,
      "clips": [
        {
          "id": "clp_1",
          "assetId": "ast_abc",
          "start": 0.0,
          "end": 5.2,
          "in": 1.0,
          "out": 6.2,
          "transform": { "scale": 1.0, "x": 0, "y": 0 },
          "effects": [{ "type": "fadeIn", "dur": 0.3 }],
          "source": "upload | higgsfield | stock"
        }
      ]
    },
    { "id": "trk_a1", "kind": "audio", "clips": [] },
    { "id": "trk_t1", "kind": "text", "clips": [] }
  ],
  "transitions": [],
  "markers": []
}
```

Edit-команды:

```text
insertClip
trimClip
splitClip
moveClip
deleteClip
addTransition
addText
setEffect
replaceAsset
setTrackFlag
```

Каждая команда:

- атомарна;
- обратима;
- версионируется;
- проходит через ownership-check;
- может быть вызвана человеком или ботом.

---

## 7. 12-месячный roadmap

### Месяц 1 — Связать React-редактор с backend + реальная загрузка

Цель:

```text
загрузить реальный файл → он появляется как clip на timeline → состояние сохраняется после reload
```

Что делаем:

- подключить `agents/studio/frontend` к Studio-backend;
- добавить JWT auth;
- подключить projects API;
- реальная media upload через TUS;
- создать assets;
- зафиксировать JSON-схему timeline;
- миграции Postgres: `vireo_timelines`, `vireo_clips`, `vireo_assets`;
- сохранить timeline после ручных действий.

Acceptance:

- загружаем видео;
- оно появляется на timeline;
- reload страницы не ломает проект;
- clip можно выбрать в inspector.

---

### Месяц 2 — Preview playback + waveform + thumbnails + inspector

Цель:

```text
проиграть timeline в preview, отредактировать clip через inspector, изменения видны и сохраняются
```

Что делаем:

- real video playback в Preview;
- clip thumbnails;
- audio waveform;
- синхронный playhead;
- inspector редактирует selected clip;
- trim/transform/effects через edit-команды;
- mute/solo/lock/hide tracks реально меняют preview.

Acceptance:

- можно проиграть clip;
- можно обрезать clip;
- можно изменить transform;
- изменения сохраняются в timeline JSON.

---

### Месяц 3 — Drag/drop + project save/load + первый render

Цель:

```text
собрать ручной ролик 30–60 сек и экспортировать MP4
```

Что делаем:

- drag/drop media на timeline;
- snapping;
- multitrack;
- project save/load;
- render job через Video-agent `/edit/async`;
- progress в UI;
- export MP4;
- починить `agents/studio` npm test pattern `test_*.js`;
- зелёный CI.

Acceptance:

- собрать ролик;
- экспортировать;
- скачать MP4;
- MVP ручного редактора готов.

---

### Месяц 4 — ChatPanel ↔ `/api/chat/stream` + Claude default

Цель:

```text
бот справа отвечает стримом, показывает tool-calls и tool-results
```

Что делаем:

- подключить ChatPanel к SSE `/api/chat/stream`;
- события `meta`, `delta`, `tool`, `done`, `error`;
- показывать tool-calls/results в чате;
- project-context в system prompt;
- Style DNA в system prompt;
- зафиксировать Claude default или выбор провайдера в UI.

Acceptance:

- пользователь пишет в чат;
- бот стримит ответ;
- пользователь видит, какие инструменты бот вызвал.

---

### Месяц 5 — Timeline-tools + apply to timeline + plan-preview

Цель:

```text
«разрежь клип на 0:05 и убери вторую половину» → timeline меняется в UI, есть undo
```

Что делаем:

- обернуть edit-команды в bot tools;
- бот правит тот же timeline JSON;
- кнопка/экран plan-preview перед execution;
- confirmation для destructive actions;
- apply to timeline после tool-result;
- undo/redo для bot actions.

Acceptance:

- бот может обрезать, переместить, удалить, добавить clip;
- пользователь видит preview плана;
- изменения применяются в timeline;
- можно undo.

---

### Месяц 6 — Память, RU/EN evals, закрытая альфа

Цель:

```text
бот ведёт проект от брифа до чернового монтажа
```

Что делаем:

- brand rules;
- успешные выводы;
- отклонённые правки;
- preferences;
- RU/EN golden-cases;
- eval pass-rate;
- закрытая альфа на 5–10 пользователей;
- сбор обратной связи.

Acceptance:

- бот помнит стиль автора;
- бот понимает русский и английский;
- альфа-пользователи могут сделать первый проект с ботом.

---

### Месяц 7 — Real Higgsfield jobs

Цель:

```text
«сгенерируй cinematic intro 5 сек» → реальный клип скачан, вставлен в timeline, списаны кредиты
```

Что делаем:

- реальные API-вызовы Higgsfield;
- polling/webhooks;
- asset download;
- persistence jobs: `vireo_generations`;
- ownership-check;
- budget/credits;
- вставка generated clip в timeline.

Acceptance:

- бот создаёт Higgsfield job;
- пользователь видит progress;
- клип скачивается;
- клип появляется на timeline;
- кредиты списываются корректно.

---

### Месяц 8 — Голос, субтитры, stock + smart-монтаж

Цель:

```text
«озвучь и добавь субтитры + найди виральные моменты» → дорожки на timeline
```

Что делаем:

- TTS;
- voice clone;
- captions.generate через Whisper;
- stock.search;
- chapters;
- hooks;
- moments;
- thumbnail;
- бот использует Video-agent smart modules.

Acceptance:

- бот создаёт audio/text/caption tracks;
- бот предлагает viral moments;
- пользователь может принять или отклонить.

---

### Месяц 9 — Коллаборация + шаблоны

Цель:

```text
два пользователя редактируют один timeline без конфликтов
```

Что делаем:

- OT/CRDT поверх версий timeline;
- WebSocket updates;
- comments;
- review queue;
- templates;
- presets;
- Style DNA;
- роли: owner/editor/reviewer/viewer.

Acceptance:

- два пользователя работают в одном проекте;
- изменения синхронизируются;
- нет конфликтов;
- есть история изменений.

---

### Месяц 10 — Export/publish loop из редактора

Цель:

```text
edit → export → draft → confirm → publish → analytics
```

Что делаем:

- export presets: YouTube, TikTok, Reels, Shorts;
- FFmpeg render job;
- draft publish;
- OAuth confirm;
- publish с audit/watermark;
- analytics ingestion;
- подключить Distributor/Analyst к UI.

Acceptance:

- пользователь экспортирует;
- выбирает платформу;
- публикует как draft;
- подтверждает publish;
- видит метрики.

---

### Месяц 11 — Масштаб рендера + монетизация

Цель:

```text
P95 render в SLA, прозрачное списание кредитов
```

Что делаем:

- GPU-workers;
- horizontal render queues;
- тарифы за генерацию/рендер;
- Billing + usage;
- engagement-autopilot;
- reliability dashboard;
- cost per export.

Acceptance:

- рендер масштабируется;
- пользователь видит стоимость;
- команда видит P95 latency/cost.

---

### Месяц 12 — Безопасность, compliance, GA

Цель:

```text
публичная бета → GA, Series-A-ready
```

Что делаем:

- secrets в vault;
- мультитенант-изоляция;
- load tests;
- onboarding;
- SOC 2 track;
- EU AI Act audit;
- support/admin tools;
- launch checklist.

Acceptance:

- публичная beta;
- GA-ready;
- безопасность проверена;
- compliance готов;
- инвестор/босс видит продукт как Series-A candidate.

---

## 8. Ближайшие шаги на эту неделю

- [ ] Отозвать/перевыпустить OpenRouter-ключ, если он где-то утекал.
- [ ] Секреты хранить только в `.env`/vault, в документах — `[REDACTED]`.
- [ ] Зафиксировать JSON-схему timeline и edit-команды.
- [ ] Подключить `agents/studio/frontend` к backend.
- [ ] Реальная загрузка через TUS.
- [ ] Миграции Postgres: `vireo_timelines`, `vireo_clips`, `vireo_assets`, `vireo_generations`.
- [ ] Починить `agents/studio` npm test.
- [ ] Привязать ChatPanel к `/api/chat/stream`.
- [ ] Выбрать Claude default или UI-выбор LLM provider.

---

## 9. Приоритеты для босса

1. Vireo Studio — это AI video editor, а не dashboard.
2. Сначала editor + bot, потом Higgsfield, потом publish/analytics.
3. Не распыляться на marketplace, agency billing, social graph, идеальный auto-publish.
4. Первый спринт: «левая студия рабочая: upload → timeline → preview → inspector → save».
5. Дальше: бот на реальный stream + timeline-tools → Higgsfield prod → publish loop.
6. Копируем не код и не дизайн Adobe, а продуктовую категорию и UX-паттерны.
7. Наша уникальность: Claude-style creative director справа + Higgsfield/FFmpeg generation + собственный timeline-контракт.
