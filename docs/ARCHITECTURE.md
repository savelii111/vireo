# Vireo Studio — Architecture

Last updated: 2026-06-08

## High level

Vireo Studio is the chat-first interface for content creators. It sits between the user and a collection of AI agents (LLM, video editor, style analyzer) and orchestrates their collaboration. The bot is the user's creative director — it helps plan, save, edit, and publish.

```
┌────────────────┐    ┌────────────────┐    ┌────────────────┐
│  User (web UI) │───▶│  Studio server │───▶│  Ollama / LLM  │
└────────────────┘    │  (Node.js)     │    └────────────────┘
                      │                │    ┌────────────────┐
                      │                │───▶│  Video agent   │
                      │                │    └────────────────┘
                      │                │    ┌────────────────┐
                      │                │───▶│  Style learner │
                      └────────────────┘    └────────────────┘
                              │
                              ▼
                      ┌────────────────┐
                      │  Postgres /    │
                      │  In-memory     │
                      └────────────────┘
```

## Module map (agents/studio/src/)

| Module | Purpose | Lines |
|---|---|---|
| `server.js` | HTTP server, all routes, request lifecycle | 3000+ |
| `llm_client.js` | OpenAI-compatible HTTP client + mock fallback | 400 |
| `llm_providers.js` | Provider-specific subclasses (Anthropic, Ollama) | 300 |
| `tools.js` | Edit tools (cut_video, add_broll, etc.) — 33 tools | 1300 |
| `chat_tools.js` | Chat-level tools (create_project, save_content, list_projects, get_style_dna) | 200 |
| `injection-guard.js` | Prompt-injection detection + sanitizeForLLM | 200 |
| `tus_proxy.js` | TUS protocol passthrough for video uploads | 150 |
| `persona.js` | Bot identity (PERSONA, CAPABILITIES, detectLanguage) | 170 |
| `onboarding.js` | Onboarding state machine (new → complete → active) | 150 |
| `latency.js` | Latency instrumentation (createSpan, checkBudget, TTLCache) | 170 |
| `observability.js` | Cost control, audit stats, tracing | 280 |
| `security.js` | Ownership, timeouts, undo, confirmations | 280 |
| `quality.js` | Deprecation headers, runAll helpers | 100 |

## Module map (agents/storage/src/)

| Module | Purpose |
|---|---|
| `gdpr_store.js` | Audit store, consent, DSR, retention |
| `chat_store.js` | Project + content piece + conversation + message stores |
| `feedback_store.js` | Welcome answers + user preferences |
| `migrations.js` | SQL migrations |
| `mock_pool.js` | In-memory Pool for tests |
| `extended.js` | Postgres-specific extensions (Style DNA, full-text search) |
| `scheduler.js` | In-process retention cron (A1) |

## Request lifecycle

1. **Request arrives** at `buildServer()`'s request handler
2. **Auth gate**: `authMiddleware` validates JWT, sets `req.user.id`
3. **Public cron**: `/api/admin/retention` short-circuits here, checks `X-Cron-Secret`
4. **Admin stats**: `/api/admin/audit-stats` returns without rate-limiting
5. **Route dispatch**: `key = \`${method} ${url}\`` matches one of 28 `if (key === "...")` blocks
6. **Handler**: per-route logic — body parsing, validation, store calls
7. **Response**: `json(res, status, body)` or streaming `res.write()` + `res.end()`

## Chat pipeline (the main endpoint)

The `/api/chat` handler is the most complex. Here's the full flow:

```
client → POST /api/chat { message, conversation_id?, project_id? }
  │
  ├─ D3: usageTracker.checkBudget() — return 402 if over
  ├─ E2: makeRequestId() — generate trace ID
  ├─ D1: createSpan("chat_turn") — start latency tracking
  │
  ├─ Body validation
  ├─ Conversation load (or auto-create)
  ├─ C4: detectLanguage() — pin language to conversation
  │
  ├─ Build system prompt
  │   ├─ SYSTEM_PROMPT (from persona)
  │   ├─ Project context block (if project_id)
  │   ├─ D4: cached user preferences (60s TTL)
  │   └─ Cache invalidation on POST /api/preferences
  │
  ├─ Save user message
  │
  ├─ runChatTurn({ llm, system, history, userMsg, tools, deps, userId, maxRounds })
  │   │
  │   ├─ D1: mark("firstToken")
  │   ├─ LLM call
  │   ├─ If tool_calls: G1 + G1.2 + G2.2 + execute
  │   │   ├─ G1.1: ownership check (resource ID belongs to user)
  │   │   ├─ G2.2: confirmation token check (destructive tools)
  │   │   ├─ G1.2: withTimeout (per-tool timeout)
  │   │   ├─ executeChatToolCall OR executeToolCall
  │   │   └─ Push tool result to messages, loop
  │   │
  │   ├─ D1: mark("toolExec") + second LLM call
  │   └─ Return { reply, messages, usage, costUsd, toolCalls, streamed }
  │
  ├─ Save assistant message(s)
  ├─ Audit log
  │
  ├─ D3: usageTracker.record() — record actual usage
  ├─ E1: auditStats.record() — for admin dashboard
  ├─ D1: chatSpan.mark("total"), checkBudget, log violations
  ├─ E2: spanAggregator.record()
  │
  └─ json(res, 200, { ok, conversation_id, reply, tool_calls, usage, cost_usd, error, message_id, onboarding, request_id, latency })
```

## Streaming pipeline

`/api/chat/stream` mirrors the chat pipeline but emits Server-Sent Events:

- `meta` — sent first with `conversation_id`
- `delta` — one per LLM token (may be 0 for short responses with 5B models)
- `tool` — sent after each tool call
- `done` — terminal event with final reply + usage
- `error` — sent on LLM failure

Keep-alive: `: ping\n\n` every 15s.

## Storage layer

Vireo Studio uses a pluggable storage layer:

- **In-memory** (default in tests): Maps for projects, pieces, conversations
- **Postgres** (production): real tables, migrations applied via `applyMigrations()`

The stores expose a uniform interface:
- `projects.create / list / get / update / delete`
- `pieces.add / list / get / update / delete`
- `conversations.create / list / get / update / touch`
- `messages.add / listForConversation / get`
- `styleDNA.get / set`
- `audit.log / list`
- `preferences.upsert / get`
- `welcome.get / upsert`

## Observability

Three layers:

1. **Audit log** (persistent) — every action recorded, queryable via `/api/me/audit`
2. **Audit stats** (in-memory) — counters, percentiles, CSV export
3. **Spans** (in-memory) — last 1000 chat_turn spans with marks

`/api/admin/audit-stats` aggregates all three for the admin dashboard.

## Eval harness

`agents/studio/tests/eval.mjs` is the quality gate. 23 cases across 7 intents (create, save, list, edit, greeting, unknown, security) are run against a real LLM. Pass-rate ≥ 80% is the hard gate.

Stable baseline: **22/23 (95.7%)** on `gemma4:31b-cloud`.

## Security model

See [`SECURITY.md`](./SECURITY.md).

- All tool calls pass through G1 (ownership check) and G1.2 (timeout)
- Destructive tools require G2.2 confirmation tokens
- All `/api/me/*` endpoints check user identity from JWT
- All responses are rate-limited per IP

## Performance

Current baseline (2026-06-08):
- TTFB (time to first SSE event): <1s on `gemma4:31b-cloud`
- Total chat turn: 4-7s avg
- Cache hit rate (prefs): >95% (60s TTL)

## See also

- [`ENDPOINTS.md`](./ENDPOINTS.md)
- [`MODULES.md`](./MODULES.md)
- [`SECURITY.md`](./SECURITY.md)
- [`EVAL.md`](./EVAL.md)
- [`DEVELOPMENT.md`](./DEVELOPMENT.md)
