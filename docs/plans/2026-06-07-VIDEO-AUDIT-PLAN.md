# Vireo Video Deep Audit — Plan
**Дата:** 2026-06-07
**Scope:** `agents/video/vireo_video/*.py` (24 source files, ~195 KB)
**Tests:** 23 files, 392 tests, all green baseline (98.98s)

## Bug Inventory (preliminary, 44 bugs)

### P0 — Critical (8 bugs)
- **V-1** server.py:74,156,226 — CORS `*` hardcoded
- **V-2** server.py:57 — `JobStore.update(**kwargs)` no validation
- **V-13** pipeline.py:309 — multi_clip sets `output_path` even on partial failure
- **V-22** file_storage.py:47 — path traversal: `..` in filename normalized by Path, escape from upload_dir
- **V-28** zoom.py:308 — pre-zoom segment logic dead code / overlap handling buggy
- **V-33** cutter.py:91 — concat demuxer uses `'\''` escape (shell-style) for ffmpeg demuxer format
- **V-34** cutter.py:96 — concat demuxer used even when codecs mismatch
- **V-39** transcriber.py:124 — synthesized single Word with full segment duration breaks emphasis scoring

### P1 — High (16 bugs)
- **V-4** server.py:188 — `/jobs?limit=…` no validation (DoS via huge limit)
- **V-6** server.py:95 — `/upload` reads entire body into memory, no size cap
- **V-9** server.py:36 — `require_auth` silent fallback to no-auth
- **V-10** server.py:166 — `/health` leaks ffmpeg version + job count
- **V-11** server.py:254/282 — `/edit` + `/edit/async` duplicate `EditRequest` construction (DRY)
- **V-12** server.py:307 — async PENDING result is replaced by `jobs.add(final)`, in-flight status lost
- **V-14** pipeline.py:222 — Step 6b reuses `JobState.SUBTITLING` (should be `STYLE_TRANSFERRING`)
- **V-16** pipeline.py:414,425,435 — effects step catches all exceptions, current stays as input, no error surfaced
- **V-17** pipeline.py:336 — `_synthesize_transcript` returns 0-duration when probe fails → fallback uses `Moment(start=0, end=1)` for any-length video
- **V-23** file_storage.py:77 — `iterdir()` on Windows can raise on concurrent add (no try/except)
- **V-24** file_storage.py:49 — `write_bytes` loads entire upload into memory
- **V-25** file_storage.py:47 — `safe_name` doesn't sanitize weird chars (newlines, NUL)
- **V-26** file_storage.py:30 — `StoredFile.to_dict()` exposes absolute path (info disclosure)
- **V-29** zoom.py:167 — synthesizes evenly-spaced fake words from segment text for emphasis detection
- **V-30** zoom.py:270 — uses `info.get("duration_sec", 0)` for post-zoom segment, fails silently if probe has no duration
- **V-40** transcriber.py:179 — no retry on network blip (1 try → fail)

### P2 — Medium (12 bugs)
- **V-3** server.py:209,385 — broad `except Exception` swallows 500 details
- **V-15** pipeline.py:381 — single moment uses trim+reencode, multi uses cut_segments (codec consistency)
- **V-18** pipeline.py:258 — progress_base for last clip can exceed 0.90
- **V-19** pipeline.py — no max duration check (10h video processed)
- **V-20** pipeline.py:59 — `style_profile: object | None` weak typing
- **V-21** pipeline.py:69 — `asdict()` leaks ALL fields (including secrets if added later)
- **V-27** file_storage.py:108 — `cleanup_old` is public, never called (file pile-up)
- **V-31** pipeline.py:421 — zoom errors recorded in steps but `current` unchanged
- **V-32** zoom.py:308 — segment extension logic (dead code)
- **V-36** cutter.py:89 — `NamedTemporaryFile` held open + unlink can fail on Windows
- **V-37** cutter.py:244 — `remove_silences` re-encodes 2x (trim + concat)
- **V-38** cutter.py:142 — `cut_segments` re-encodes each segment, then concat re-encodes again

### P3 — Low (8 bugs)
- **V-5** server.py:191 — `/jobs/:id` no rate limiting
- **V-7** server.py:197 — `/download/:name` filename not validated (depends on file_storage safety)
- **V-8** server.py:356 — `/thumbnail` accepts `api_key` in body (overridable)
- **V-35** cutter.py:200 — silence start/end pairing assumes 1:1 (rare edge)
- **V-41** transcriber.py — reads file into memory (actually stream-based, OK)
- **V-42** transcriber.py:222 — `estimate_cost` doesn't clamp to ≥0
- **V-43** transcriber.py:117 — OK actually
- **V-44** transcriber.py:106 — `_parse_word` uses `or` (treats 0.0 as falsy)

## Fix order (10-12ч)
1. P0 security (V-22, V-1) — 1ч
2. P0 logic (V-2, V-13, V-33, V-34, V-39) — 2ч
3. P1 (V-4, V-6, V-9, V-16, V-11, V-17, V-26) — 3ч
4. P2 cleanup (V-21, V-36) — 1ч
5. Regression tests (15-20 tests) — 2ч
6. Final full run + report — 1ч

## Test strategy
- Reuse existing ffmpeg fixtures (tests/tmp_*, sample_10s.mp4)
- Add `tests/test_fixes.py` with targeted regression tests
- Mock external calls (whisper, LLM, ffprobe) where needed
