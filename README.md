# Vireo — Personal AI Creative Director

> *Your AI co-pilot that learns your style, edits your content, and publishes everywhere — 24/7.*

[![CI](https://github.com/.../actions/workflows/ci.yml/badge.svg)](.github/workflows/ci.yml) ![Tests: 1936 passing](https://img.shields.io/badge/tests-1936%20passing-brightgreen) ![Node + Python](https://img.shields.io/badge/stack-Node%2020%20%2B%20Python%203.13-blue)

## Vision

Vireo turns a solo creator into a media company of one. Not a tool, not a scheduler — a **creative director in your pocket** that knows you better than you know yourself.

## Architecture

```
vireo/
├── apps/                    # Web apps (dashboard, marketing)
├── agents/                  # Multi-agent system
│   ├── style-learner/       # Python — analyzes your style
│   ├── editor/              # Python — edits content
│   ├── distributor/         # Node.js — publishes everywhere
│   └── analyst/             # Node.js — tracks metrics, learns
├── packages/                # Shared code
├── tests/                   # E2E + integration tests
└── docs/                    # Documentation
```

## The 4 Agents

| Agent | Job | Tech |
|---|---|---|
| **Style Learner** | Analyzes your past work, builds Style DNA | Python + Claude/GPT |
| **Editor** | Edits raw content in your style | Python + FFmpeg + Remotion |
| **Distributor** | Adapts + publishes to 10 platforms | Node.js + platform APIs |
| **Analyst** | Tracks metrics, retrains Style DNA | Node.js + ML |

## Quick start

```bash
# Install everything
npm install
pip install -e agents/style-learner agents/editor

# Run all agents
npm run agents

# Run all tests — 1936 passing (1264 Node + 672 Python)
npm test                  # Node master: 1264 / 26 suites
pytest                    # Python master: 672 / 5 packages
```

## Studio Agent — local dev

The **Studio agent** (`agents/studio/`) is the chat surface that ties Style
Learner, Editor, Video, and Distributor together. It runs in mock-LLM mode out
of the box (no `OPENAI_API_KEY` required).

```bash
# 1. Start the studio API (port 8011)
cd agents/studio
node src/server.js

# 2. Start the dashboard (port 3000) in a second terminal
cd apps/dashboard
node server.js

# 3. Open http://127.0.0.1:3000/chat
# Mock-LLM replies are returned immediately, no API key needed.

# 4. Run the studio test suite (70 tests, ~1.0s)
cd agents/studio
node --test tests/test_server.js
```

Set `OPENAI_API_KEY` and `VIREO_LIVE=1` to use a real model.

## Studio API — endpoint reference

All endpoints under `/api/chat`, `/api/conversations/...`, `/api/messages/...`,
`/api/feedback/...`, `/api/welcome`, `/api/projects` require a JWT bearer
token in `Authorization: Bearer <token>`. Without a token they respond
`401 unauthorized`.

Mint a dev token:

```js
import { signToken } from "./packages/auth-middleware/index.js";
const tok = signToken({ sub: "u-dev", email: "dev@x", name: "Dev" }, "dev-secret", 3600);
```

### Chat (streaming SSE)

```bash
curl -N -X POST http://127.0.0.1:8011/api/chat \
  -H "Authorization: Bearer $TOK" \
  -H "Content-Type: application/json" \
  -d '{"message": "Give me 5 hooks for a Notion productivity thread", "project_id": "p_1"}'
# Events: meta → tool → delta* → done
```

### Welcome interview (per-user onboarding)

```bash
# GET current answers
curl http://127.0.0.1:8011/api/welcome -H "Authorization: Bearer $TOK"
# → { ok, answers, completed }

# POST niche + platforms
curl -X POST http://127.0.0.1:8011/api/welcome \
  -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
  -d '{"niche": "SaaS founders", "platforms": ["twitter", "linkedin"]}'
```

### Rewind a conversation (for Regenerate / Edit & resend)

```bash
curl -X POST http://127.0.0.1:8011/api/conversations/$CID/rewind \
  -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
  -d '{"to_message_id": "m_abc123"}'
# → { ok, deleted: N }
# Deletes every message after `to_message_id` so the LLM can re-run the turn.
```

### Edit a user message

```bash
curl -X PATCH http://127.0.0.1:8011/api/messages/$MID \
  -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
  -d '{"content": "rewritten user prompt"}'
```

### Feedback (thumbs up/down per assistant message)

```bash
# +1 / -1 / 0 = clear
curl -X POST http://127.0.0.1:8011/api/messages/$MID/feedback \
  -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
  -d '{"rating": 1, "comment": "great tone"}'

# Per-user summary
curl http://127.0.0.1:8011/api/feedback/summary -H "Authorization: Bearer $TOK"
# → { ok, summary: { total, upvotes, downvotes } }
```

### Auto-title a conversation

```bash
curl -X POST http://127.0.0.1:8011/api/conversations/$CID/auto-title \
  -H "Authorization: Bearer $TOK"
# → { ok, title: "Notion productivity thread" }
# Title is LLM-generated from the first user message (3-5 words), with a
# deterministic fallback if the LLM is unavailable. Persisted to conversations.title.
```

### Environment variables

| Var | Default | Effect |
|---|---|---|
| `JWT_SECRET` | (required) | Secret for `Authorization: Bearer` JWTs |
| `VIREO_RATE_LIMIT_MAX` | `60` | Per-user requests/minute cap on `/api/chat` |
| `VIREO_LIVE=1` | off | Use a real LLM (needs `OPENAI_API_KEY`) |
| `DATABASE_URL` | off | When set, the studio uses Postgres stores (else in-memory) |
| `PORT` | `8011` | Studio HTTP port |

## Markdown rendering (offline)

The dashboard ships **vendored** copies of `marked@^12`, `dompurify@^3`, and
`highlight.js@^11` in `apps/dashboard/public/vendor/`. The chat UI renders
markdown → sanitizes HTML → highlights code blocks, all client-side, no
CDN, no external network.

If you reinstall with `npm ci` (which drops `--no-save` packages), re-vendor:

```bash
npm install --no-save marked@^12 dompurify@^3 highlight.js@^11
cp node_modules/marked/lib/marked.umd.js apps/dashboard/public/vendor/
cp node_modules/dompurify/dist/purify.min.js apps/dashboard/public/vendor/
curl -sSL -o apps/dashboard/public/vendor/highlight.min.js \
  https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/lib/index.min.js
```

## Roadmap

- **Phase 0** ✅ Foundation, monorepo, all 4 agents bootable
- **Phase 1** Style Learner MVP, OAuth connectors
- **Phase 2** Editor + multi-platform publisher
- **Phase 3** Voice clone, engagement autopilot
- **Phase 4** Monetization layer, collaboration network
- **Phase 5** Series A ready

## EU AI Act

Built in. Every AI-generated piece is auto-logged, marked, and documented. EU AI Act enforcement starts August 2026 — we ship before.

— Vireo Team, 2026
