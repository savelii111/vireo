# Vireo Studio Chat Agent — Complete Checklist (2026-06-07)

> **Mission:** Studio chat agent that does **EVERYTHING** a YouTuber could ask for, real
> integrations, no mocks, no stubs, no "coming soon". User says it once — agent does it.
>
> **Status:** P0 audit bugs fixed (commit `f300b97`). Wire operational. 18 tools.
> 25 video modules (7 unwired). 1 LLM provider. 5 mock distribution platforms.
> 1266+ tests. **Goal: ship a finished Studio chat agent.**

This is the **completion checklist** — basic + all functions + production. Not a roadmap.
Every item has a file path, a test, and a "ship gate".

---

## 0. Critical bugs (must fix FIRST)

These are broken or non-functional today. Until they're fixed, the agent can't be
called "real".

| # | Bug | File | Test/Evidence |
|---|---|---|---|
| 0.1 | **TUS resumable upload missing from Studio** — Video agent has `tus.py`, Studio doesn't expose it. Users can't upload >100MB videos. | `agents/studio/src/server.js` (add `/api/upload/resumable/*`) | E2E: upload 500MB video in 10MB chunks via Studio, verify file on disk |
| 0.2 | **`add_music` Studio tool is a no-op** — sends `{enable_zoom: false}` instead of music fields. `music.py` module exists but not exposed. | `agents/studio/src/tools.js` `_routeForTool` (case `add_music`) | E2E: "add lo-fi music" → real audio mixed in output |
| 0.3 | **`list_projects` returns ALL projects, not user-scoped** | `agents/studio/src/server.js` (handler) | Test: user A creates project, user B lists → B doesn't see A's |
| 0.4 | **Style DNA in-memory by default** (only Postgres if env set) | `agents/studio/src/server.js` | Test: restart server, DNA gone — fix: default to Postgres-backed store |
| 0.5 | **Migration duplicate name `002`** in `storage/migrations.js` (line 62 + 333) | `agents/storage/src/migrations.js` | Test: `npm run migrate` runs cleanly |
| 0.6 | **`analyze_style` returns "Mock mode" even with key** if env not propagated to subprocess | `agents/style-learner/` | Test: `OPENAI_API_KEY` set → real analysis runs |
| 0.7 | **`distribute` tool doesn't validate platform list** — sends garbage to adapter | `agents/studio/src/tools.js` | Test: `platforms: ["foo"]` → 400 `unknown_platform` |
| 0.8 | **LUT path traversal in color grading** — security: user-controlled LUT path | `agents/video/vireo_video/color.py` | Test: `color_look: "../../../etc/passwd"` → 400 |
| 0.9 | **No 401 for unauthenticated tool calls** | `agents/studio/src/server.js` | Test: no token → 401, not 200 with empty data |
| 0.10 | **No rate limit on LLM calls** — single user can rack up $1000 in minutes | `agents/studio/src/server.js` | Test: 21st call/min → 429 with `Retry-After` |

**Ship gate:** all 10 fixed, tests for each, no regression in 1278 baseline.

---

## 1. Wire the 7 unwired video modules

Video agent has these Python modules. Studio's `_routeForTool` doesn't expose them.

| # | Module | New Studio tool | What user can say | Test/Evidence |
|---|---|---|---|---|
| 1.1 | `music.py` | `add_music` (fix bug 0.2) | "add lo-fi hip-hop music" | Real audio mixed in output |
| 1.2 | `broll.py` | `add_broll` | "add b-roll of cityscape at cut points" | B-roll inserted at silence/cut boundaries |
| 1.3 | `chapters.py` | `add_chapters` | "add YouTube chapters" | YouTube-format chapters burned in |
| 1.4 | `hooks_style.py` | `apply_hook_style` | "make the hook more engaging" | First 3 sec restructured (visual + audio) |
| 1.5 | `moments.py` | `find_best_moments` | "find 5 best moments from this 1h video" | Returns 5 timestamp ranges + scores |
| 1.6 | `thumbnail.py` | `generate_thumbnail` | "make me a thumbnail for 'AI editing 101'" | PNG saved to disk, accessible via `/api/thumbnail/{id}` |
| 1.7 | `audio_analyzer.py` | `analyze_audio` | "what's the loudness/peak in this video?" | Returns LUFS, true peak, RMS |

Each needs:
- A new case in `tools.js` `_routeForTool` mapping to `/edit` or a new video endpoint
- A new tool definition in `EDIT_TOOLS` array (name, description, parameters)
- A regression test in `test_tools.js`
- An e2e test that goes: prompt → tool call → real output

**Ship gate:** all 7 tools exposed, all 7 e2e tests green, `_routeForTool` test count = 18+7 = 25.

---

## 2. Add missing tools (Studio-side, no video agent dependency)

Tools that don't need a video endpoint — pure logic, in-process:

| # | Tool | What user can say | File | Test/Evidence |
|---|---|---|---|---|
| 2.1 | `get_job_status` | "is my edit done yet?" | `agents/studio/src/server.js` (route + `tools.js` case) | E2E: start 60s edit, poll status, get progress + result URL |
| 2.2 | `cancel_job` | "stop the edit, I'll do it manually" | same | E2E: start edit, cancel mid-run, verify state = cancelled |
| 2.3 | `search_transcript` | "find all times I said 'pricing'" | `tools.js` (uses cached whisper) | E2E: ask → returns list of `{timestamp, text}` |
| 2.4 | `suggest_thumbnails` | "give me 3 thumbnail ideas" | `tools.js` (calls `generate_thumbnail` 3× with different prompts) | E2E: 3 PNGs returned |
| 2.5 | `analyze_viral_potential` | "is this video going to do well on TikTok?" | `tools.js` (heuristic: hook strength, pacing, length, etc.) | E2E: returns score 0-100 + 3 reasons |
| 2.6 | `generate_captions_only` | "just give me the .srt file" | `tools.js` (calls `/transcribe`, returns SRT) | E2E: ask → SRT string returned |
| 2.7 | `compare_versions` | "which version is better, A or B?" | `tools.js` (A/B view from style DNA) | E2E: 2 versions → side-by-side comparison |
| 2.8 | `duplicate_project` | "make a copy of this project to test ideas" | `tools.js` | E2E: project cloned with new ID |
| 2.9 | `share_project` | "share this project with @alice" | `tools.js` (write to Postgres) | E2E: shared → alice can read |
| 2.10 | `set_video_metadata` | "set title to 'AI editing 101', description to '...'" | `tools.js` | E2E: metadata persisted, returned in `/files/{id}` |

**Ship gate:** 10 new tools, 10 e2e tests, 10 regression tests. Total tools = 35.

---

## 3. Multi-modal input (accept images, audio, video in chat)

Today: chat accepts only text. User wants: "use this image as my thumbnail",
"transcribe this audio", "use this video as a reference".

| # | Tool | Input | What it does | Test/Evidence |
|---|---|---|---|---|
| 3.1 | `upload_file` (generic) | multipart/form-data | Saves to storage, returns `file_id` + URL | E2E: upload image → file on disk |
| 3.2 | `describe_image` | `file_id` of image | Calls OpenAI Vision, returns description | E2E: upload cat photo → "A tabby cat sitting on a..." |
| 3.3 | `describe_audio` | `file_id` of audio | Calls Whisper, returns transcript + description | E2E: upload podcast → transcript + "Two hosts discussing..." |
| 3.4 | `reference_video` | `file_id` of video | Analyzes another video's style, applies to user's current edit | E2E: "edit my video like this one" → style applied |
| 3.5 | `reference_image` | `file_id` of image | Uses image as color/style reference | E2E: "match this color palette" → color grading applied |
| 3.6 | `voice_input` | audio stream from mic | Whisper-streaming → text message | E2E: speak → text in chat input |

**Ship gate:** user can upload 4 file types, reference 4 input types. Tests ≥1500.

---

## 4. Multi-provider LLM (not just OpenAI)

Today: 1 provider. User wants any neural network — "use Claude", "use Gemini",
"use my local Ollama".

| # | Provider | Chat | StreamChat | Tool use | Test/Evidence |
|---|---|---|---|---|---|
| 4.1 | **OpenAI** (gpt-4o, gpt-4o-mini, gpt-4-turbo) | ✅ | ✅ | ✅ | Already works |
| 4.2 | **Anthropic** (claude-sonnet-4, claude-opus-4) | ✅ | ✅ | ✅ | Unit: mock Anthropic endpoint, verify request/response shape |
| 4.3 | **Google Gemini** (gemini-1.5-pro, gemini-1.5-flash) | ✅ | ✅ | ✅ | Same |
| 4.4 | **Ollama** (llama3.2, mistral, qwen — local, free) | ✅ | ✅ | ✅ | Unit: mock Ollama `/api/chat` |
| 4.5 | **Groq** (llama-3.1-70b, mixtral — fast inference) | ✅ | ✅ | ✅ | Same |
| 4.6 | **xAI Grok** (grok-2, grok-2-vision) | ✅ | ✅ | ✅ | Same |
| 4.7 | **Mistral** (mistral-large, mistral-small) | ✅ | ✅ | ✅ | Same |
| 4.8 | **DeepSeek** (deepseek-chat, deepseek-reasoner) | ✅ | ✅ | ✅ | Same |

Implementation: registry pattern in `llm_client.js`:
```js
const PROVIDERS = {
  openai:    { baseUrl: "https://api.openai.com/v1", auth: "Bearer", streamFormat: "openai-sse" },
  anthropic: { baseUrl: "https://api.anthropic.com/v1", auth: "x-api-key", streamFormat: "anthropic-sse" },
  gemini:    { baseUrl: "https://generativelanguage.googleapis.com/v1beta", auth: "query-key", streamFormat: "gemini-sse" },
  ollama:    { baseUrl: "http://localhost:11434", auth: "none", streamFormat: "ollama-ndjson" },
  // ... 4 more
};
```

Plus smart router (item 4.9).

| 4.9 | **Smart router** | | | |
|---|---|---|---|---|
| | Cheap model (`gpt-4o-mini` / `claude-haiku`) picks tool, expensive (`gpt-4o` / `claude-sonnet-4`) generates final text | `agents/studio/src/server.js` | Saves ~40% tokens; benchmark 100 prompts | Test: router decision logged, expensive model used for final |
| 4.10 | Per-user provider preference | | Stored in user settings | Test: user sets `provider: anthropic`, all calls go to Anthropic |
| 4.11 | Cost tracking per provider | | Append to `usage_log` table | Test: 1 call to each provider → 8 rows in `usage_log` |

**Ship gate:** 8 providers, smart router, user preference, cost tracking. Tests ≥1700.

---

## 5. Distribution (real publishing, not mock)

Today: `mock_publisher.js` — fake. User wants: real posts to real accounts.

| # | Platform | API | Auth | File size limit | Test/Evidence |
|---|---|---|---|---|---|
| 5.1 | **YouTube Shorts + long-form** | YouTube Data API v3, resumable upload | OAuth 2.0 | 256GB | E2E: post 30s video → real YouTube URL |
| 5.2 | **TikTok** | Content Posting API | OAuth 2.0 | 4GB (videos), 287MB (photos) | E2E: post → real TikTok video_id |
| 5.3 | **Instagram Reels** | Graph API (`/me/media`) | OAuth 2.0 | 1GB | E2E: post → real IG media_id |
| 5.4 | **LinkedIn Video** | LinkedIn Marketing API | OAuth 2.0 | 200MB | E2E: post → real UGC post_id |
| 5.5 | **X (Twitter)** | Media upload + tweet | OAuth 1.0a + 2.0 | 512MB | E2E: post → real tweet_id |
| 5.6 | **Facebook Reels** | Graph API | OAuth 2.0 | 1GB | E2E: post → real FB video_id |
| 5.7 | **Pinterest Idea Pins** | Pinterest API v5 | OAuth 2.0 | — | Defer (out of YouTuber scope) |
| 5.8 | **Threads** | Meta Threads API | OAuth 2.0 | — | Defer |
| 5.9 | **Snapchat Spotlight** | Snap Marketing API | OAuth 2.0 | 32MB | Defer |

Plus the orchestration layer:

| # | Tool | What it does | Test/Evidence |
|---|---|---|---|
| 5.10 | `distribute` (already exists, fix bugs) | Takes video + platforms + caption, calls adapters, returns per-platform URLs | E2E: 1 video → 5 real posts, 5 URLs |
| 5.11 | `distribute_later` | "post in 3 hours" — schedules for future | E2E: schedule, mock time advance, verify upload fires |
| 5.12 | `distribute_recur` | "post weekly at 5pm" — cron-style | Defer (Phase L) |
| 5.13 | `cross_post_caption` | Same video, 5 different platform-native captions | E2E: ask → 5 captions returned |
| 5.14 | `distribute_status` | "did my post go live?" | E2E: query post_id, get status (processing/live/failed) |
| 5.15 | OAuth token refresh on 401 | All adapters handle expiry automatically | Unit: token expires mid-upload → refresh → retry |
| 5.16 | Per-platform rate limit awareness | Don't post >N/min to same platform | Test: 11th post/min → 429 with `Retry-After` |

**Ship gate:** 6 real platform integrations (YouTube, TikTok, IG, LinkedIn, X, FB).
End-to-end: edit video → post to all 6 → get 6 real URLs. Tests ≥2000.

---

## 6. Content capabilities (what user can ask)

Pro YouTuber day in the life:
1. "I recorded a 2h podcast, give me 5 TikTok clips, post the best one tomorrow at 5pm"
2. "Add captions in 3 languages: English, Spanish, Japanese"
3. "Match the color of my last video, but make it more cinematic"
4. "Find me b-roll for the part where I talk about 'AI agents'"
5. "Add upbeat music, but duck it under my voice when I speak"
6. "Make a 60s version, 90s version, and 3min version for YouTube"
7. "What if we cut the first 10 seconds — does the video still work?"
8. "Add a YouTube chapter at 'pricing' and at 'demo'"
9. "My intro is weak, make the first 3 sec a question + visual hook"
10. "Compare engagement on this version vs the one I posted yesterday"

Items in this list that are NOT yet supported:

| # | Capability | Module/Tool needed | Test/Evidence |
|---|---|---|---|
| 6.1 | Multi-language captions (translation) | `tools.js` new: `translate_captions` (Whisper → GPT-4 translation) | E2E: ES + JA captions burned in |
| 6.2 | Music ducking under voice | `music.py` extension (audio envelope detection) | E2E: music quieter when voice present |
| 6.3 | Multi-format output (60s, 90s, 3min) | `pipeline.py` + `tools.js` `create_versions` | E2E: 1 source → 3 outputs |
| 6.4 | A/B testing of edits | `tools.js` `compare_versions` + `get_engagement` | E2E: 2 versions posted, engagement compared |
| 6.5 | Color matching from reference | `style_transfer.py` + `tools.js` `match_color` | E2E: 2 videos, colors match (ΔE < 5) |
| 6.6 | Engagement data import (YouTube Analytics API) | `agents/ingest/` new | Test: import yesterday's analytics |
| 6.7 | Hook testing (first-3-sec variants) | `hooks_style.py` + `tools.js` `test_hooks` | E2E: 3 hook variants generated |
| 6.8 | Thumbnail A/B testing (multiple options) | `tools.js` `suggest_thumbnails` (item 2.4) | Already covered |

**Ship gate:** all 8 capabilities working. Tests ≥2100.

---

## 7. Smart LLM behaviors (chat-side intelligence)

The agent should be SMART, not just an API caller.

| # | Behavior | Description | Test/Evidence |
|---|---|---|---|
| 7.1 | **Intent classification** | "cut silence" vs "remove silence" vs "delete pauses" → same tool | Test: 5 phrasings → same tool called |
| 7.2 | **Multi-tool plans** | "transcribe, then cut silences, then add captions" → 3 sequential tool calls | E2E: 3 tools called in order |
| 7.3 | **Parallel tool calls** | "transcribe AND get video info" → both in parallel | Test: latency < max(2 calls), not sum |
| 7.4 | **Confirm before destructive** | "delete my project" → "Are you sure? This will remove 12 videos." | Test: 1st call = confirm, 2nd call = execute |
| 7.5 | **Undo support** | "undo the last edit" | E2E: state rollback works |
| 7.6 | **Memory across sessions** | "I like dark color grading" → persisted in user prefs | E2E: new session, agent remembers |
| 7.7 | **Smart defaults** | "edit for YouTube Shorts" → `target_platform=youtube`, `max_moments=1` | Test: LLM applies correct defaults |
| 7.8 | **Error recovery** | "video too long" → suggest "split it into 2 videos?" | Test: friendly error, not raw exception |
| 7.9 | **Context budget** | Don't blow up LLM context — summarize old messages | Test: 100-message convo, summary appears |
| 7.10 | **Tool result validation** | Tool returns `ok: false` → LLM rephrases and retries | Test: invalid args → re-call with corrected args |

**Ship gate:** 10 smart behaviors. Tests ≥2200.

---

## 8. Production-ready (security, observability, deploy)

| # | Item | File | Test/Evidence |
|---|---|---|---|
| 8.1 | **OAuth 2.0** (Google, GitHub, Discord) | `agents/oauth/` | E2E: sign in with Google, get token |
| 8.2 | **2FA** (TOTP) | `agents/auth/` | E2E: enable 2FA, login requires code |
| 8.3 | **Audit log** (every LLM call, tool, edit) | `agents/storage/migrations.js` | Test: 5 calls → 5 audit rows with full provenance |
| 8.4 | **GDPR data export** | `agents/studio/src/server.js` `GET /api/me/export` | Test: zip with all user data |
| 8.5 | **GDPR data delete** | `agents/studio/src/server.js` `DELETE /api/me` | Test: all rows gone, audit log retained (anonymized) |
| 8.6 | **Prompt injection guard** | `agents/studio/src/server.js` | Test: "ignore previous instructions" → caught |
| 8.7 | **Rate limit** (per-user, per-IP, per-route) | `agents/studio/src/server.js` | Test: 21st call → 429 |
| 8.8 | **Cost guardrails** (per-user monthly cap) | `agents/studio/src/server.js` | Test: $100 spend → user locked |
| 8.9 | **OpenTelemetry traces** | `agents/studio/src/server.js` | Test: spans in Jaeger |
| 8.10 | **Prometheus metrics** | `agents/studio/src/server.js` `/metrics` | Test: counters increment |
| 8.11 | **Structured logging** (JSON) | all agents | Test: log entries are JSON, queryable |
| 8.12 | **Health endpoints** (liveness, readiness) | all agents | Test: k8s probes work |
| 8.13 | **Graceful shutdown** (SIGTERM drain) | all agents | Test: mid-edit kill, finishes gracefully |
| 8.14 | **CI/CD** (GitHub Actions → Docker → prod) | `.github/workflows/` | Test: push to main → deployed in 5 min |
| 8.15 | **Load test** (k6, 100 concurrent users) | `scripts/loadtest.k6.js` | Test: p99 < 5s, no errors |
| 8.16 | **Disaster recovery** (DB backup, restore) | `agents/storage/` | Test: backup → delete DB → restore → data back |
| 8.17 | **Secrets management** (Vault / env-only) | config | Test: missing env → fail-fast at startup |
| 8.18 | **TLS termination** (Caddy/Nginx in front) | infra | Manual config review |
| 8.19 | **Documentation** (ARCHITECTURE, OPERATIONS, API) | `docs/` | Manual review |
| 8.20 | **Status page** (status.vireo.com) | infra | Manual |

**Ship gate:** all 20 production items. Tests ≥2400. Beta launch with 100 users.

---

## 9. UI / Frontend (if any)

| # | Item | Description | Test/Evidence |
|---|---|---|---|
| 9.1 | Chat UI (React/Next.js) | Render SSE stream, show tool calls, show output files | Manual + Playwright test |
| 9.2 | File browser (drag-drop upload) | TUS upload with progress bar | Manual |
| 9.3 | Timeline editor (visual) | Render edits on a timeline, drag to adjust | Manual |
| 9.4 | Comparison view (A/B) | Side-by-side video player | Manual |
| 9.5 | Style DNA visualization | Charts/graphs of style attributes | Manual |
| 9.6 | Analytics dashboard | Views, engagement, cost per video | Manual |
| 9.7 | Settings (provider, theme, defaults) | User preferences | Manual |
| 9.8 | Notifications (push, email) | "Your edit is done", "Your post went live" | E2E: receive notification |

**Ship gate:** all 8 UI items, no console errors, Lighthouse score ≥90.

---

## 10. Definition of Done — "Studio chat agent is FINISHED"

A new user with no prior context should be able to:
1. Sign up via Google OAuth
2. Upload a 2h podcast video (TUS resumable)
3. Type ONE message: "find 5 best TikTok moments, add captions, add trending music, post the best one to my TikTok tomorrow at 5pm"
4. Agent: finds 5 moments (moments.py), selects best, adds captions, adds music, schedules post
5. User wakes up next day — video posted, real engagement
6. User sees full audit trail in their dashboard
7. User can do this 100× per month, costs < $50

**If all 10 sections (0-9) ship, the Studio chat agent is FINISHED.**

---

## Priority order (what to do first)

**Week 1: Section 0 + 1** (10 bugs + 7 unwired modules = 17 items)
**Week 2: Section 2** (10 new in-process tools)
**Week 3: Section 3** (multi-modal input)
**Week 4: Section 4** (multi-provider LLM)
**Week 5-6: Section 5** (distribution, depends on OAuth)
**Week 7: Section 6** (content capabilities)
**Week 8: Section 7** (smart LLM behaviors)
**Week 9-10: Section 8** (production hardening)
**Week 11+: Section 9** (UI polish)

**Total: 11 weeks** to fully finished Studio chat agent.

---

## Test count projection

| Section | Tests | Cumulative |
|---|---|---|
| Now (after P0-1/2/3) | 1278 | 1278 |
| 0 (bugs) | +20 | 1298 |
| 1 (wire modules) | +30 | 1328 |
| 2 (new tools) | +40 | 1368 |
| 3 (multi-modal) | +60 | 1428 |
| 4 (multi-LLM) | +80 | 1508 |
| 5 (distribution) | +200 | 1708 |
| 6 (content) | +100 | 1808 |
| 7 (smart LLM) | +80 | 1888 |
| 8 (production) | +200 | 2088 |
| 9 (UI) | +100 | 2188 |
| **At DONE** | **~2200** | |

---

## What I need from user

1. **`OPENAI_API_KEY`** — without it, e2e gates cannot fire
2. **OAuth client credentials** for at least YouTube + Google — unblocks Section 5
3. **Decide scope per session** — 1 section per session, or all of Sections 0+1+2 in one go
4. **Time budget per week** — 11 weeks is a lot; do you want it faster, or paced?

I'm in `/c/Users/koval/OneDrive/случайный проект/vireo` (`main`, clean). Ready to start Section 0 (critical bugs) on your command.
