# Vireo Studio — Endpoints

Last updated: 2026-06-08

This document lists every public HTTP endpoint in Vireo Studio. The server is built with Node's `http` module and the `auth-middleware` package (no Express). Endpoints are dispatched by `key = \`${method} ${url}\`` in `src/server.js`.

## Auth

All endpoints require a JWT Bearer token (env `VIREO_JWT_SECRET`) unless noted.

| Header | Value |
|---|---|
| `Authorization` | `Bearer <jwt>` |
| `X-Vireo-Language` | (optional) override detected language: `en` \| `ru` |
| `X-Request-Id` | (optional) client-supplied trace ID; otherwise auto-generated UUID |
| `X-Cron-Secret` | (cron-only) for `/api/admin/retention` |

## Health

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/health` | none | Returns `{ ok, postgres, pg_ok, llm }` |

## Chat

| Method | Path | Auth | Notes |
|---|---|---|---|
| `POST` | `/api/chat` | JWT | Single-turn chat. Returns `{ ok, conversation_id, reply, tool_calls, usage, cost_usd, error, message_id, onboarding, request_id, latency }` |
| `POST` | `/api/chat/stream` | JWT | Same as `/api/chat` but SSE. Events: `meta`, `delta`, `tool`, `done`, `error`. Headers: `Content-Type: text/event-stream`, `X-Request-Id`, `X-Accel-Buffering: no`. Keep-alive `: ping` every 15s. |

### Budget check (D3)

`/api/chat` and `/api/chat/stream` both check the per-user budget BEFORE calling the LLM. If the user is over budget, returns:

```
HTTP 402 Payment Required
{
  "ok": false,
  "error": "daily_token_budget_exceeded" | "daily_cost_budget_exceeded" | "monthly_cost_budget_exceeded",
  "message": "...",
  "extra": { "used": <number>, "budget": <number> }
}
```

## Projects

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/api/projects` | JWT | List user's projects (paginated via `?limit=N`) |
| `POST` | `/api/projects` | JWT | Create project `{ name, niche?, description?, target_platforms? }` |
| `GET` | `/api/projects/:id` | JWT | Read one project |
| `PATCH` | `/api/projects/:id` | JWT | Update `{ name?, niche?, target_platforms?, metadata? }` |
| `DELETE` | `/api/projects/:id` | JWT | Delete (G2.2 destructive — needs confirmation_token) |

## Content Pieces

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/api/content-pieces` | JWT | List, `?project_id=&limit=` |
| `POST` | `/api/content-pieces` | JWT | Add piece `{ project_id, text, kind?, title? }` |

## Style DNA

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/api/style-dna` | JWT | Get user's Style DNA (`?project_id=` optional) |
| `POST` | `/api/style-dna` | JWT | Update Style DNA |
| `POST` | `/api/style-dna/analyze` | JWT | Trigger analysis on saved corpus |

## Conversations

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/api/conversations` | JWT | List conversations |
| `POST` | `/api/conversations` | JWT | Create conversation `{ project_id?, title?, metadata? }` |
| `GET` | `/api/conversations/:id/messages` | JWT | Get messages in a conversation |

## Welcome / Onboarding (C3)

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/api/welcome` | JWT | Get welcome interview answers |
| `POST` | `/api/welcome` | JWT | Upsert welcome answers; mirrors into preferences |

## Preferences

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/api/preferences` | JWT | Get user preferences |
| `POST` | `/api/preferences` | JWT | Upsert preferences. **Invalidates the prefs cache** (D4) |

## Feedback

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/api/feedback/summary` | JWT | Roll-up of feedback signals |
| `POST` | `/api/feedback` | JWT | Add feedback row |

## /api/me (user-scoped resources)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/me/capabilities` | (C2) Public manifest — persona + capabilities + tools catalog. **No user state required.** |
| `GET` | `/api/me/onboarding-state` | (C3) Current onboarding state + suggested next step |
| `GET` | `/api/me/usage` | (D3) Daily/monthly token + cost usage |
| `GET` | `/api/me/conversation-stats` | (E3) Total tool calls, favorite tool, time saved estimate |
| `GET` | `/api/me/audit` | Recent audit log rows (`?limit=N`) |
| `GET` | `/api/me/undo` | (G2.1) Undo history + `can_undo` flag + next-to-undo |
| `POST` | `/api/me/undo` | (G2.1) Pop the most recent entry and invoke its rollback |
| `GET` | `/api/me/consent` | GDPR consent state |
| `POST` | `/api/me/consent` | Update consent |
| `GET` | `/api/me/export` | (GDPR) Export all user data (requires Postgres) |
| `DELETE` | `/api/me` | Delete account (G2.2 destructive) |

## /api/admin

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/api/admin/audit-stats` | JWT | (E1) Full audit stats. JSON by default; `?format=csv` for download |
| `POST` | `/api/admin/retention` | `X-Cron-Secret` | (C3) Trigger retention cron. Body: `{ dry_run?: bool }` |

## TUS (video upload)

| Method | Path | Auth | Notes |
|---|---|---|---|
| `*` | `/api/files/...` | JWT | TUS protocol passthrough to video agent. See `tus_proxy.js` |

## Response shapes (common)

### Success
```json
{
  "ok": true,
  // ... endpoint-specific fields
}
```

### Error
```json
{
  "ok": false,
  "error": "code",       // machine-readable, e.g. "not_found"
  "message": "human-readable",
  "extra": { ... }       // optional
}
```

## HTTP status codes used

| Code | When |
|---|---|
| 200 | Success |
| 400 | Validation error |
| 401 | Missing or invalid JWT |
| 402 | Budget exceeded (D3) |
| 404 | Resource not found |
| 409 | Conflict (e.g. version mismatch) |
| 413 | Body too large (>64KB) |
| 422 | Unprocessable (e.g. semantic error in body) |
| 500 | Server error / misconfiguration |
| 502 | LLM upstream error |
| 503 | Feature requires Postgres that's not configured |

## Streaming events

The `/api/chat/stream` endpoint emits Server-Sent Events:

| Event | Data | When |
|---|---|---|
| `meta` | `{ conversation_id }` | After conversation is created/loaded |
| `delta` | `{ text }` or `{ delta }` | Each LLM token (may be 0 for short responses) |
| `tool` | `{ name, args, result }` | After a tool call completes |
| `done` | `{ reply, usage, cost_usd, message_id, error, user_message_id, onboarding }` | Terminal event |
| `error` | `{ error, message }` | LLM or tool failure |

Comment frames (`: ping\n\n`) are sent every 15s for keep-alive. Clients should ignore them.

## Rate limits

`/api/chat` and `/api/chat/stream` are subject to per-IP rate limiting. Limits are returned via the `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` headers.

## See also

- [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) — system architecture
- [`docs/MODULES.md`](./MODULES.md) — module-by-module deep dive
- [`docs/SECURITY.md`](./SECURITY.md) — security model
- [`docs/EVAL.md`](./EVAL.md) — how to run the eval harness
- [`docs/DEVELOPMENT.md`](./DEVELOPMENT.md) — dev setup + run instructions
