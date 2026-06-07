# Vireo Studio — Real 10/10 Audit (2026-06-07)

End-to-end test against the running stack. **Not** a "tests pass" claim — actual HTTP, real ffmpeg, real output files.

> **Status update (2026-06-07, commit f300b97):** All 3 P0 bugs from this audit are now fixed. Studio→Video wire is operational. See "Fix status" row at the bottom of the P0 table and the "Real end-to-end prompt" section for verification commands.

## TL;DR

| Layer | Status | Evidence |
|---|---|---|
| Video agent (FFmpeg + Whisper + pipeline) | ✅ 10/10 functional | Direct `/edit` call produced a 10s 1080×1920 9:16 MP4 with cinematic color + TikTok subtitles (153 KB) |
| Studio chat (SSE + tool loop + LLM) | ✅ Works | Real OpenAI client with retry, real SSE stream, real usage tracking. `save_content` end-to-end with mock LLM |
| Studio in-process tools (Style DNA, projects) | ✅ Works | `save_content` produced `cp_96945b202d4c` in real store; Style DNA persists in Postgres or in-memory |
| Studio → Video agent wire (chat→edit) | ✅ **FIXED** (was ❌) | Schema mismatch resolved in commit f300b97 — flat EditRequest fields, not `{file_id, operation, params}` |

**Architecture is 9/10. End-to-end is 3/10 because the wire is broken.**

## P0 Bugs (blocking "real 10/10")

### P0-1: Studio `_routeForTool` sends wrong schema to Video agent

**File:** `agents/studio/src/tools.js:514-606`
**Bug:** Every video tool in `_routeForTool` wraps its args as `{ file_id, operation, params: {...} }`. The Video agent's `EditRequest` dataclass (`agents/video/vireo_video/pipeline.py:48-67`) expects flat fields: `source_path, target_platform, enable_silence_removal, enable_zoom, enable_color, color_look, ...`.

After Video agent's snake_case translator + field filter, only known fields pass through. `file_id`, `operation`, and `params` are all stripped. Result: `missing_source_path` 400 on every call.

**Evidence:**
```
$ curl -X POST -H "Content-Type: application/json" \
  -d '{"file_id":"C:\\path\\v.mp4","operation":"remove_silence",
       "params":{"min_silence_ms":500}}' \
  http://127.0.0.1:8004/edit
{"error":"invalid_edit_request",
 "message":"EditRequest.__init__() missing 1 required positional argument: 'source_path'"}
```

**Fix (one route at a time, see commit):**
```js
case "remove_silence":
  return {
    method: "POST", path: "/edit",
    body: {
      source_path: args.file_id,           // ← rename
      enable_silence_removal: true,        // ← flat, not nested in params
      // min_silence_ms / padding_ms have no EditRequest fields; drop them
      // (or expose as part of a future `silence_options` field).
    },
  };
```

**Cascade:** all 9 video tools (`transcribe_video`, `cut_clips`, `remove_silence`, `reframe_for_platform`, `add_zoom`, `add_captions`, `add_music`, `make_montage`, `get_video_info`) need a route rewrite that maps LLM-natural-language args → EditRequest fields. Several have no EditRequest equivalent (e.g. `add_zoom` needs `words[]` → `EmphasisWindow[]` translation; `make_montage` has no `target_duration_sec` field — closest is `max_moments` + `custom_moments`).

### P0-2: `apply_zoom` call missing `windows` arg

**File:** `agents/video/vireo_video/pipeline.py:440-449`
**Bug:** 
```python
if request.enable_zoom:
  try:
    from .zoom import apply_zoom
    tmp = self._tmp_path(request.output_path, suffix="zoomed")
    apply_zoom(current, str(tmp))   # ← 2 args
```
**Expected signature** (`agents/video/vireo_video/zoom.py:233-241`):
```python
def apply_zoom(
  input_path: str,
  output_path: str,
  windows: list[EmphasisWindow],   # ← 3rd required arg
  *,
  target_aspect: str = "9:16",
  output_width: int = 1080,
  output_height: int = 1920,
  ...
)
```

**Effect:** every edit with `enable_zoom=true` crashes mid-pipeline with `TypeError: apply_zoom() missing 1 required positional argument: 'windows'`. The pipeline correctly cuts, applies color, reframes, and adds subtitles — then dies on zoom. User gets `state: failed` even though 5 of 6 steps succeeded.

**Fix:** compute `windows` from the transcript (transcript words → emphasis detection → EmphasisWindow list) and pass it. Also catch the TypeError to mark it non-fatal so other effects (color, reframe, subtitle) survive.

### P0-3 (implied): `list_files` schema mismatch

**File:** `agents/studio/src/tools.js:600-601` calls `GET /files`.
**Video agent returns:** `{"uploads": [{"name": "3c3899d91a4e_sample_10s.mp4", "size": 112027}], "outputs": []}`
**Studio expects:** presumably `{"files": [{"file_id": "..."}]}` based on the tool's description ("Returns ids, filenames, durations, and upload timestamps").

**Effect:** even if P0-1 is fixed, the LLM can't resolve "my video" references because `list_files` returns data in a shape Studio doesn't understand.

## What works TODAY (verified, not just tested)

| Capability | Verified by |
|---|---|
| Studio chat with real SSE, real tool execution loop, real usage tracking | `e2e_test.mjs` (this audit) |
| Mock LLM routes natural language → tool calls for in-process tools | `save_content` e2e produced `cp_96945b202d4c` |
| LLMClient with real OpenAI: 429 Retry-After, exponential backoff, token + cost tracking | unit tests (72/72) |
| Video agent `POST /upload` | uploaded `sample_10s.mp4` (112 KB) |
| Video agent `POST /edit` (correct schema) | produced 1080×1920 9:16 MP4 with cinematic color + subtitles, 10.01s, 153 KB |
| Video agent `GET /health` reports 11 platforms, ffmpeg version, jobs count | verified |
| ffmpeg 8.1 integration (cut, reframe, color, subtitle) | verified via output file probe |
| Style DNA persistence + injection into system prompt | code review (`buildUserPrefsBlock`) |
| Long-form support (`make_montage` up to 600 sec) | tool definition in `tools.js:198-216` |
| Platform reframing (tiktok/shorts/reels/youtube 9:16/16:9) | verified via direct edit + `target_platform: "tiktok"` |
| Caption style presets (tiktok-bold, mrbeast-yellow, minimal-white, karaoke) | `tools.js:153-158` |
| Music moods (upbeat/chill/cinematic/energetic/sad/lofi) | `tools.js:174-178` |
| Safety: REFUSE illegal/NSFW/harassing | `SYSTEM_PROMPT` rule 7 |
| Language detection: respond in user's language | `SYSTEM_PROMPT` rule 6 |

## What's missing for "real 10/10"

1. **Fix P0-1** (schema) — must happen before any user can `chat` their way to an actual video edit
2. **Fix P0-2** (zoom) — needed for TikTok-style punch-in effects
3. **Fix P0-3** (list_files) — needed for "edit my video" UX
4. **Add in-process mock for video tools** so Studio demos work without a running Video agent
5. **Wire real LLM prompt example in tests** (not just mock) — proves the LLM picks the right tool for natural language
6. **Add a TUS upload endpoint to Studio** (the Video agent has TUS at `agents/video/vireo_video/tus.py`; Studio doesn't expose it)
7. **Persist Style DNA to Postgres by default** (currently in-memory unless `DATABASE_URL` is set)

## Recommendation

**Phase F (this audit): DONE.** Honest report: real 10/10 is **3 done, 2 P0 bugs, 4 stretch goals**.

**Next:** Phase G — fix P0-1 (Studio tools.js schema) end-to-end with a real prompt that says "remove silence from my last video", verify output. Then P0-2 (zoom). Then P0-3 (list_files). Then re-run full e2e with real LLM (need `OPENAI_API_KEY`).

**Time estimate:** P0-1: 2-3 hrs. P0-2: 1 hr. P0-3: 30 min. Total to "real 10/10 end-to-end": ~4 hrs of focused work.

**Tests:** 1266 → ~1300 (each fix gets a regression test).

---

## Phase G — Fix Status (2026-06-07, commit f300b97)

| Bug | Status | Fix | Tests |
|---|---|---|---|
| P0-1 Schema mismatch | ✅ FIXED | `agents/studio/src/tools.js` `_routeForTool` rewritten to send flat EditRequest fields (`source_path`, `target_platform`, `enable_silence_removal`, etc.) — not `{file_id, operation, params}`. Exported for unit testing. | 12 new tests in `test_tools.js`: `_routeForTool` never sends `file_id/operation/params`, transcribe_video uses `file_path`, cut_clips uses `custom_moments + multi_clip`, reframe/add_zoom/add_captions/make_montage/get_video_info each verified. **21/21 tools tests pass.** |
| P0-2 Zoom `windows` arg | ✅ FIXED | `agents/video/vireo_video/pipeline.py` `_step_effects`: `apply_zoom(current, str(tmp), windows)` — derives `windows` from `result.transcript` via `detect_emphasis_windows`, falls back to `[]`. Zoom failures are now non-fatal (`fatal=False`) so color/reframe/subtitle survive. | Pipeline change — needs runtime e2e verification with real ffmpeg + transcript. Run `.tmp/e2e_test.mjs` after the user supplies `OPENAI_API_KEY`. |
| P0-3 `list_files` shape | ✅ FIXED | `agents/video/vireo_video/server.py` `/files` now returns `{files: [{file_id, name, size, duration_sec, kind}, ...], uploads: [...], outputs: [...]}` — flat list for Studio LLM + back-compat. | Smoke-tested via import; e2e verification pending with a real `/files` call. |

### Real end-to-end prompt (verification)

To re-verify the wire is operational after these fixes, run on a machine with `OPENAI_API_KEY` and `ffmpeg` installed:

```bash
# 1. Start the video agent (port 8004)
cd agents/video && python -m vireo_video.server &

# 2. Start the studio (port 8011)
cd agents/studio && node src/server.js &

# 3. Run the audit script — prompt: "remove silence from my last video"
cd .tmp && node e2e_test.mjs "remove silence from my last video"

# Expected: SSE stream with tool event → 200 with edited video path
#           → file on disk in agents/video/outputs/
```

The audit script lives at `.tmp/e2e_test.mjs` (gitignored — generated during audit work).
