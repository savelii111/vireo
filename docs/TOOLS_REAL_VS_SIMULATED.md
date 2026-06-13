# Vireo Studio — Tools real vs simulated audit (draft)

**Дата:** 2026-06-11  
**Source of truth:** `docs/VIREO_STUDIO_12_MONTH_PLAN_v2.md`  
**Цель:** не дать симуляциям выдать себя за production. Помечаем каждый важный инструмент как `real`, `simulated`, `mixed`, или `unknown`.

---

## Rules

- `real` — есть реальный API/endpoint/implementation, нет fake result.
- `mixed` — есть реальный слой, но часть результатов/дефолтов симулирована.
- `simulated` — возвращает mock/fake CDN/fake assets или не ходит во внешний сервис.
- `unknown` — требует ручного чтения/проверки.
- `experimental` — можно держать в каталоге, но директор не должен использовать без явного фича-флага.

---

## Priority audit

| Module / tool area | Status | Risk | Next action |
|---|---|---:|---|
| `agents/studio/src/higgsfield_client.js` | **mixed / simulated result** | High | заменить фейковые CDN-URL на реальные Higgsfield API-вызовы, polling/webhooks, asset download |
| `agents/studio/src/manual_editor.js` | **real logic, in-memory** | Medium | перенести persistence в `vireo_timelines`/`vireo_timeline_ops` |
| `agents/studio/frontend/src/hooks/useThumbnails.ts` | **simulated / placeholder** | Medium | подключить `/api/clip/:id/thumbnail` → Video-agent `/thumbnail` |
| `agents/studio/frontend/src/hooks/useChatStream.ts` | **mixed** | Medium | SSE real, mock fallback ok только для dev/offline |
| `agents/studio/src/run_chat_turn.js` | **real** | Low | сохранить half-tool strategy, per-tool timeout, confirmation-token |
| `agents/studio/src/llm_providers.js` | **real provider layer** | Medium | зафиксировать Claude default и secrets/vault |
| `agents/video/vireo_video/server.py` | **real** | Low | использовать как production endpoint для FFmpeg/Whisper/TUS |
| `agents/studio/src/tus_proxy.js` | **real proxy layer** | Medium | проверить end-to-end upload/resumable |
| `agents/studio/src/audio_generation.js` | **unknown / likely mixed** | High | аудит провайдеров TTS/voice, убрать fake audio URLs |
| `agents/studio/src/voice_enhance.js` | **unknown** | Medium | проверить реальный pipeline |
| `agents/studio/src/stock_library.js` | **unknown / likely simulated** | High | проверить stock provider, лицензии, real search |
| `agents/studio/src/analytics_dashboard.js` | **mixed** | Medium | связать с Analyst/Distributor real metrics |
| `apps/orchestrator/index.js` | **real child-process bridge** | Low | PYTHONPATH now includes repo root + `packages/shared/python` + Python agent packages; verified by E2E pipeline |
| `agents/studio/src/template_marketplace.js` | **simulated / marketplace placeholder** | Medium | убрать из core-loop до Q4 |
| `agents/studio/src/plugin_ecosystem.js` | **simulated / future scope** | Low | пометить experimental |
| `agents/studio/src/white_label.js` | **simulated / future scope** | Low | убрать из директор-ядра |
| `agents/studio/src/sdk.js` | **future scope** | Low | не включать в core tools |
| `agents/studio/src/embed.js` | **future scope** | Low | не включать в core tools |

---

## Director core tools for M4-M5

Цель: сократить каталог директора с ~231 до ядра ~30–40.

### Editor tools

- `insertClip`
- `trimClip`
- `splitClip`
- `moveClip`
- `deleteClip`
- `groupClips`
- `addTransition`
- `addEffect`
- `addText`
- `setEffect`
- `replaceAsset`
- `setTrackFlag`

### Asset/media tools

- `uploadAsset`
- `getAssetMetadata`
- `generateThumbnail`
- `generateWaveform`
- `transcribeAudio`

### Generation tools

- `generateVideoHiggsfield`
- `cancelGeneration`
- `getGenerationStatus`
- `insertGeneratedAsset`
- `generateTTS`
- `generateCaptions`
- `searchStockAsset`

### Project/export tools

- `createProject`
- `saveTimeline`
- `loadTimeline`
- `exportRenderJob`
- `getRenderProgress`
- `downloadRender`

### Publish/draft tools

- `createDraft`
- `confirmPublish`
- `getPlatformPreset`
- `sendAnalyticsRequest`

### Safety/governance tools

- `checkOwnership`
- `requestConfirmation`
- `checkBudget`
- `writeAuditEvent`
- `writeConsentEvent`

---

## Experimental tools to hide from default director

- marketplace
- white-label
- plugin ecosystem
- SDK/embed
- advanced business integrations
- unverified generation providers
- any tool returning fake CDN/fake asset URLs

---

## Next audit steps

1. Пройти `agents/studio/src/**/*_tools.js`.
2. Для каждого tool найти:
   - external API call?
   - fake URL?
   - DB write?
   - ownership/budget/audit?
3. Записать в таблицу:
   - module
   - tool name
   - status
   - destructive?
   - paid?
   - external API?
   - required confirmation?
   - owner
4. Пометить ядро для директора.
5. Остальные пометить `experimental`.

---

## Definition of Done

- [ ] Таблица покрывает все `*_tools.js` в `agents/studio/src`.
- [ ] Нет fake CDN/fake asset URL в default tool set.
- [ ] Все destructive/paid/publish tools требуют confirmation/budget-check.
- [ ] Директор получает только curated core tools.
