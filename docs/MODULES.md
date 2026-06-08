# Vireo Studio — Module Reference

Last updated: 2026-06-08

This is a module-by-module reference. For architecture, see `ARCHITECTURE.md`.

## agents/studio/src/

### server.js (~3000 lines)

The main HTTP server. Builds the request handler in `buildServer(opts)`.

```js
import { buildServer } from "./server.js";
const { server } = buildServer({ secret, llm, pool });
server.listen(3000, "0.0.0.0", () => console.log("ready"));
```

Options:
- `secret` — JWT secret (env VIREO_JWT_SECRET)
- `llm` — LLM client instance (defaults to createLLMClient())
- `pool` — Postgres pool (optional; uses in-memory if absent)
- `fetchImpl` — override fetch (for tests)
- `upstreamTimeoutMs` — default 30s for upstream calls

### llm_client.js

OpenAI-compatible HTTP client. Also defines the `_mockChat` method that returns a deterministic response when no API key is configured.

Key classes:
- `LLMClient` — base class
- `_mockChat(opts)` — used when apiKey is empty

### llm_providers.js

Provider-specific subclasses. Currently:
- `AnthropicClient` — extends LLMClient, uses Anthropic Messages API
- `OllamaClient` — extends LLMClient, uses Ollama's OpenAI-compatible endpoint
- `SmartRouter` — picks cheap vs expensive model based on prompt length

### tools.js

33 edit tools for video processing:
- `cut_video`, `add_broll`, `generate_thumbnail`
- `transcribe_audio`, `translate_subtitles`
- etc.

Each tool has:
- OpenAI function-calling schema
- `executeToolCall(call, ctx)` dispatcher
- `buildEditToolContext(opts)` for runtime context

### chat_tools.js (2026-06-08)

4 chat-level tools:
- `create_project` — create new content project
- `save_content` — save text (script, idea, hook, etc.) to a project
- `list_projects` — list user's projects
- `get_style_dna` — get Style DNA analysis

`executeChatToolCall(call, ctx)` dispatches by name. Each call:
1. Validates required args
2. Calls the appropriate deps function (which handles in-memory or Postgres)
3. Returns a typed result the LLM can interpret

### injection-guard.js

Two exports:
- `checkForInjection(text)` — returns true if text matches known injection patterns
- `sanitizeForLLM(text)` — strips control chars + dangerous Unicode

Used at the chat entry point and on user-controlled strings before they reach the LLM.

### tus_proxy.js

TUS protocol passthrough for video uploads. The Studio doesn't store video — it forwards to the video agent with the user's JWT stamped into the upload metadata.

### persona.js (2026-06-08)

Bot identity. Exports:
- `PERSONA` — { name, tagline, voice, signature_phrases, anti_patterns, language_hints }
- `CAPABILITIES` — { superpowers, limits, hard_no }
- `describeToolsForPrompt()` — single source of truth for the tools list in the system prompt
- `detectLanguage(text)` — substring scoring
- `languageName(code)` — human-readable

### onboarding.js (2026-06-08)

Onboarding state machine. Pure functions:
- `computeOnboardingState({welcome, projects, conversations})` → `{state, nextStep, suggestions}`
- `buildOnboardingGreeting({state, detectedLanguage})` → `{reply, followUp}`

States: `new`, `in_progress`, `complete`, `skipped`, `active`.

### latency.js (2026-06-08)

Latency instrumentation. Exports:
- `createSpan(name, meta)` — returns a span tracker with `mark(label)` and `total()`
- `checkBudget(span)` — flags marks that exceed `LATENCY_BUDGET_MS`
- `timed(label, fn)` — async wrapper that records ms
- `prefetchAll(fetches)` — Promise.allSettled wrapper
- `TTLCache` class + 3 global instances (systemPromptCache, projectListCache, styleDNACache)

### observability.js (2026-06-08)

Three things:
- `usageTracker` — per-user daily/monthly usage + budget check
- `auditStats` — aggregate counters + latency percentiles + CSV export
- `spanAggregator` — last 1000 chat_turn spans
- `makeRequestId(req)` — respects X-Request-Id, otherwise UUID

### security.js (2026-06-08)

Security primitives:
- `filterByOwner / isOwnedBy / findForeignIds` — G1.1 ownership validation
- `withTimeout(promise, ms, label)` — G1.2 tool timeouts
- `getToolTimeoutMs(toolName)` — per-tool defaults
- `undoStore` — G2.1 last 20 destructive actions
- `confirmationStore` — G2.2 single-use tokens for destructive ops
- `isDestructiveTool / getDestructiveTools` — whitelist

### quality.js (2026-06-08)

Code quality helpers:
- `addDeprecationHeaders(res, opts)` — RFC-8594 Deprecation + Sunset + Link headers
- `runAll(tasks)` — Promise.allSettled wrapper
- `pSettledMap(items, mapper)` — array version

## agents/storage/src/

### gdpr_store.js

Audit + GDPR functionality:
- `AuditStore / InMemoryAuditStore` — audit log
- `GdprExportStore / GdprDeleteStore` — GDPR right-to-be-forgotten
- `recordDsrRequest / completeDsrRequest` — DSR workflow
- `scrubMetadata / scrubMetadataJson` — C4 PII redaction
- `purgeOldAudit / runRetentionCron` — C3 retention
- `startRetentionScheduler / stopRetentionScheduler` — A1 cron

### chat_store.js

Core data stores:
- `ProjectStore / InMemoryProjectStore`
- `ContentPieceStorePg`
- `ConversationStore / InMemoryConversationStore`
- `MessageStore / InMemoryMessageStore`

### feedback_store.js

User feedback:
- `MessageFeedbackStore`
- `WelcomeAnswersStore`
- `UserPreferencesStore`

### migrations.js

SQL migrations. `applyMigrations(pool)` runs all pending migrations.

### mock_pool.js

In-memory Pool for tests. Mocks the parts of the pg API the Studio uses.

### extended.js

Postgres-specific extensions:
- `PostgresStyleDNAStore` — full Style DNA persistence
- (other future additions)

## See also

- [`ENDPOINTS.md`](./ENDPOINTS.md)
- [`ARCHITECTURE.md`](./ARCHITECTURE.md)
- [`SECURITY.md`](./SECURITY.md)
