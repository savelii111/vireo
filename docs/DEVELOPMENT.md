# Vireo Studio — Development Guide

Last updated: 2026-06-08

How to set up, run, and test Vireo Studio locally.

## Prerequisites

- Node.js 18+ (tested on 24.13)
- npm or pnpm
- (Optional) Ollama — for the eval harness and real-LLM tests
- (Optional) PostgreSQL — for storage in non-test mode

## Setup

```bash
cd C:\Users\koval\OneDrive\случайный проект\vireo
# No npm install needed — the project uses no third-party
# dependencies for the Studio server itself. Auth middleware
# is a local package.
```

## Running the server

### In-memory mode (no Postgres)

```bash
cd agents/studio
node src/server.js
# Or with hot-reload via node --watch
node --watch src/server.js
```

The server listens on port 3000 by default. Override with `PORT=4000`.

### With Postgres

```bash
export VIREO_PG_URL=postgres://user:pass@localhost:5432/vireo
export VIREO_JWT_SECRET=your-secret-here
export VIREO_LLM_CHEAP_MODEL=gemma4:31b-cloud
export VIREO_LLM_EXPENSIVE_MODEL=gemma4:31b-cloud
export OLLAMA_BASE_URL=http://localhost:11434/v1
cd agents/studio
node src/server.js
```

On startup, the server applies pending migrations automatically.

### Environment variables

| Var | Default | Notes |
|---|---|---|
| `PORT` | 3000 | HTTP port |
| `VIREO_JWT_SECRET` | (required) | JWT signing key |
| `VIREO_PG_URL` | (none) | Postgres connection string; in-memory if absent |
| `VIREO_LLM_PROVIDER` | `ollama` | `ollama` \| `openai` \| `anthropic` |
| `VIREO_LLM_CHEAP_MODEL` | `gemma4:31b-cloud` | Used for short/simple queries |
| `VIREO_LLM_EXPENSIVE_MODEL` | (same as cheap) | Used for complex queries |
| `OLLAMA_BASE_URL` | `http://localhost:11434/v1` | Ollama endpoint |
| `OPENAI_API_KEY` | (none) | Required for OpenAI provider |
| `ANTHROPIC_API_KEY` | (none) | Required for Anthropic provider |
| `VIREO_DAILY_TOKEN_BUDGET` | 200000 | Per-user daily token cap |
| `VIREO_DAILY_COST_BUDGET_USD` | 5 | Per-user daily $ cap |
| `VIREO_MONTHLY_COST_BUDGET_USD` | 50 | Per-user monthly $ cap |
| `VIREO_AUDIT_RETENTION_DAYS` | 365 | Default retention |
| `VIREO_CRON_ENABLED` | `false` | Set to `true` to start the in-process retention scheduler |
| `VIREO_CRON_SECRET` | (none) | Required for `/api/admin/retention` |
| `VIREO_DEFAULT_LANGUAGE` | `en` | Default when language detection fails |

## Running tests

```bash
# All Studio unit + e2e tests
cd agents/studio
node --test tests/test_*.js tests/test_*.mjs

# Specific suite
node --test tests/test_security.js
node --test tests/test_chat_tools.js
node --test tests/test_eval.mjs

# Real LLM (requires Ollama running)
node --test tests/test_real_llm.mjs
node --test tests/test_real_llm_cloud.mjs
node --test tests/test_real_llm_streaming.mjs
node --test tests/test_real_llm_streaming_cloud.mjs

# Eval harness (quality gate)
node tests/eval.mjs
node tests/eval.mjs --filter=create
node tests/eval.mjs --model=qwen2.5:7b
```

## Project structure

```
vireo/
├── agents/
│   ├── studio/        # The chat-first interface
│   │   ├── src/       # Server + modules
│   │   └── tests/     # Unit + e2e + real-LLM tests
│   ├── storage/       # Database + GDPR + retention
│   ├── video/         # Video processing pipeline
│   └── audit/         # Compliance / audit tools
├── packages/
│   └── auth-middleware/  # JWT signing + rate limiting
├── docs/              # This documentation
└── tests/             # Project-root e2e tests
```

## Common tasks

### Add a new chat tool

1. Add the tool definition to `agents/studio/src/chat_tools.js` (CHAT_TOOLS array)
2. Add the `case` to `executeChatToolCall` in the same file
3. Add the underlying store function in `agents/studio/src/server.js` (`buildToolDeps`)
4. Add tests to `agents/studio/tests/test_chat_tools.js`
5. Add an eval case to `agents/studio/tests/eval.mjs` if it's user-facing

### Add a new endpoint

1. Find the `if (key === "...")` chain in `server.js` (use grep)
2. Add your `if (key === "GET /api/your-endpoint")` block
3. Update `docs/ENDPOINTS.md`
4. Add a test

### Add a new eval case

See [`EVAL.md`](./EVAL.md#writing-a-new-case).

### Add a new language

1. Add language hints to `PERSONA.uses_ru_for` (or create `uses_xx_for`)
2. Update `languageName()` to include the new code
3. Add tests to `tests/test_persona.js`
4. Optionally add eval cases

## Debugging

### "Why is the eval flaking?"

Check `gemma4:31b-cloud` availability:

```bash
curl http://localhost:11434/api/tags
```

If the model is missing, run with a different one:

```bash
node tests/eval.mjs --model=gemma4:e2b
```

### "Why is latency high?"

Check `/api/admin/audit-stats` (admin only):

```bash
curl -H "Authorization: Bearer <admin-jwt>" \
  http://localhost:3000/api/admin/audit-stats
```

Look at `latency.p95_ms` and `recent_spans` to find the slow stages.

### "Why is the bot not calling a tool?"

1. Check the tool description in `chat_tools.js` or `tools.js` — is it clear?
2. Check the routing rules in `SYSTEM_PROMPT` in `server.js`
3. Run the bot manually: `node tests/bot_check.mjs` (if it exists)
4. Look at the LLM's response in `/api/me/audit`

### "Why is the test failing?"

```bash
# Run the specific test with verbose output
node --test --test-name-pattern="<test name>" tests/test_<file>.js
```

For real-LLM tests:

```bash
node --test tests/test_real_llm.mjs
# Look for the [studio] log lines — they show the request flow
```

## See also

- [`ENDPOINTS.md`](./ENDPOINTS.md)
- [`ARCHITECTURE.md`](./ARCHITECTURE.md)
- [`MODULES.md`](./MODULES.md)
- [`SECURITY.md`](./SECURITY.md)
- [`EVAL.md`](./EVAL.md)
