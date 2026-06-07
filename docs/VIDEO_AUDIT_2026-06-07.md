# Vireo Video Deep Audit — 2026-06-07

**Scope:** `agents/video/vireo_video/*.py` (24 source files, ~195 KB)
**Tests:** 392 baseline → 410 after (+18 regression tests)
**Total project:** 1148 → 1168 passed (24 suites, 0 failures)

## 🐛 Bugs Found & Fixed (11)

| # | Severity | File | Bug | Fix |
|---|----------|------|-----|-----|
| **V-1** | P0 | `server.py` | CORS hardcoded `*` (allows any origin) | `_cors_headers_for()` reads `VIREO_CORS_ORIGINS` per request |
| **V-2** | P0 | `server.py` | `JobStore.update(**kwargs)` sets ANY attribute (could set `__class__`) | Whitelist `_UPDATABLE_FIELDS` (8 allowed) |
| **V-6** | P0 | `server.py` | `_multipart_upload` reads entire body to memory (OOM on 10GB) | `MAX_UPLOAD_BYTES` (100 MB default) checked BEFORE read |
| **V-22** | P0 | `file_storage.py` | Path traversal in `save_upload` — `../../etc/passwd` writes outside dir | `_sanitize_filename` + `dest.resolve().relative_to(parent)` check |
| **V-26** | P0 | `file_storage.py` | `StoredFile.to_dict()` leaks absolute server path (info disclosure) | Drop `path` field from to_dict output |
| **V-13** | P0 | `pipeline.py` | `multi_clip` reports DONE even if some clips failed (silent data loss) | Set state=FAILED, populate `result.error` with "N/M clips failed" |
| **V-16** | P0 | `pipeline.py` | Effects step silently swallows exceptions (silence/zoom/color) | `_record_step(..., fatal=True)` + `raise` to caller |
| **V-25** | P1 | `file_storage.py` | Filename used directly — allows NUL bytes, newlines, traversal | `_sanitize_filename()` strips path sep + control chars |
| **V-4** | P1 | `server.py` | `list(limit=999_999_999)` returns all jobs (DoS via memory) | Clamp to `MAX_LIST_LIMIT` (200) |
| **V-33** | P1 | `cutter.py` | Concat demuxer path escaping corrupts paths with apostrophes (`O'Brien.mp4` → `O\'Brien.mp4`) | `mkstemp` + plain `file '<normalized>'` line (no shell escape) |
| **V-17** | P1 | `pipeline.py` | 0-duration probe → `_synthesize_transcript` returns duration=0 → output truncated to 1 second | Fall back to `Path.stat().st_size` proxy, min 60s default |
| **V-39** | P1 | `transcriber.py` | No-word segment synthesizes a single Word spanning full duration → falsely triggers `long_duration` emphasis | Skip the segment (drop the fake word) |

## 🟡 Deferred (P2/P3, 30+ known)

- **V-9** Auth silently degrades to no-auth if `vireo_shared` missing — needs explicit failure
- **V-23** `iterdir()` can fail mid-iteration on Windows — fixed (try/except around list)
- **V-8** `parse_transcript_response` camelCase/snake_case mixing — cosmetic
- **V-11** `do_POST` duplicates EditRequest construction (DRY)
- **V-12** `/edit/async` PENDING entry lost on second `add()` — design decision
- **V-19** No max video duration check (10h video would silently process)
- **V-32** Dead code in zoom.py (extend 1.0 segment branch unreachable)
- **V-36** `concat` demuxer uses `NamedTemporaryFile` (Windows file lock) — fixed (mkstemp)
- **V-40** No retry logic in `transcribe_file`
- **V-42** Dead variable `ext` in `save_upload_stream` — cosmetic

## 🔧 Modified Files

```
agents/video/vireo_video/server.py        (V-1, V-2, V-4, V-6) — 6 patches
agents/video/vireo_video/pipeline.py      (V-13, V-16, V-17)   — 3 patches
agents/video/vireo_video/file_storage.py  (V-22, V-25, V-26)   — rewritten sanitization layer
agents/video/vireo_video/cutter.py        (V-33)               — demuxer fix
agents/video/vireo_video/transcriber.py   (V-39)               — drop fake word
agents/video/tests/test_fixes.py          NEW                  — 18 regression tests
agents/video/tests/test_file_storage.py   (updated)            — V-26 expectation
agents/video/tests/test_transcriber.py    (updated)            — V-39 expectation
agents/video/tests/test_pipeline_features.py (updated)         — V-13 expectation
docs/plans/2026-06-07-VIDEO-AUDIT-PLAN.md NEW                  — full bug inventory (44 items)
```

## 🎯 Key Wins

- **Path traversal** (V-22) — **CRITICAL**: any user could write files outside storage with crafted filename
- **Silent data loss** (V-13) — multi_clip batches silently lost failures
- **OOM DoS** (V-6) — 10GB upload would OOM the server
- **CORS** (V-1) — final holdout fixed, ALL agents now use per-request CORS

## 📊 Final Test Counts

| Suite | Before | After | Delta |
|-------|--------|-------|-------|
| Video (Python) | 392 | **410** | +18 |
| All other suites | 756 | 758 | +2 (test_fixes style_analyzer bug found) |
| **TOTAL** | **1148** | **1168** | **+20** |

## ⏭ Next: Phase 3

Phase 3 = E2E smoke test. Docker-compose up всех агентов, прогон полного pipeline (upload → style learn → editor → transcriber → distributor), real ffmpeg + OpenAI mocks. Цель: 100% green smoke test за один запуск.

Дай команду — поехали на E2E, или сначала Phase 2.5 (фикс remaining P2/P3 bugs)?