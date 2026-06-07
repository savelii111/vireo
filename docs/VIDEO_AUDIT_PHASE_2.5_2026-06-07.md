# Vireo Video Phase 2.5 — P2/P3 Fixes (2026-06-07)

**Scope:** Additional 9 P2/P3 bugs from `docs/plans/2026-06-07-VIDEO-AUDIT-PLAN.md` deferred list.

## Test Summary

| Stage | Tests | Notes |
|---|---|---|
| **Video baseline** | 392 | All green, 98.98s |
| Phase 2 (P0/P1) | 410 | +18 regression tests |
| **Phase 2.5 (P2)** | **420** | **+10 regression tests, 117.39s** |
| **Whole project** | **1178** | All green, 24 suites |

## Bugs Fixed in Phase 2.5

| Bug | Sev | File | Issue | Fix |
|---|---|---|---|---|
| **V-8** | P2 | `server.py` | camelCase vs snake_case key mismatch | `_to_snake()` translation in `_build_edit_request()` |
| **V-9** | P2 | `server.py` | Auth silently degrades to no-auth | Explicit 500 error in production (VIREO_ENV=production) |
| **V-11** | P2 | `server.py` | Duplicated EditRequest construction in /edit and /edit/async | Single `_build_edit_request()` helper with field filtering |
| **V-19** | P1 | `server.py` | No max video duration (10h video would silently process) | `MAX_VIDEO_DURATION_SEC` check (default 10h, env-overridable) |
| **V-40** | P2 | `transcriber.py` | No retry on transient Whisper API errors | Exponential-backoff retry (5xx + 429, NOT 4xx) |
| **V-45** | P3 | `chapters.py` | "(N more)" count off-by-one in chapter prompt | Separate `segments_added` counter |
| **V-48** | P2 | `chapters.py` | Greedy regex `\{[\s\S]*\}` spans garbage text | Non-greedy `\{[^{}]*?(?:\{[^{}]*\}[^{}]*?)*\}` |
| **V-50** | P2 | `moments.py` | Same greedy regex as V-48 | Same fix |
| **V-42** | P3 | various | Dead `ext` variable, unused imports | Cleanup |

## P2 Regression Tests Added (10)

```
test_v8_snake_case_keys
test_v11_camelcase_translation
test_v11_unknown_fields_filtered
test_v19_max_duration_constant
test_v19_max_duration_env_override
test_v40_retry_succeeds_on_5xx_then_200
test_v40_no_retry_on_4xx
test_v45_chapter_truncation_count
test_v48_chapters_non_greedy_regex
test_v48_moments_non_greedy_regex
```

## Files Modified

```
agents/video/vireo_video/server.py       (V-8, V-9, V-11, V-19)
agents/video/vireo_video/transcriber.py  (V-40)
agents/video/vireo_video/chapters.py     (V-45, V-48)
agents/video/vireo_video/moments.py      (V-50)
agents/video/tests/test_fixes.py         (+10 tests)
```

## Cumulative (Phase 2 + 2.5)

| | Tests | Bugs Fixed |
|---|---|---|
| Phase 2 (P0/P1) | +18 | 11 |
| Phase 2.5 (P2) | +10 | 9 |
| **TOTAL Video** | **+28** | **20** |

## What's Still Deferred (for Phase 2.5+ if needed)

- **V-7** CORS preflight wildcard — low value
- **V-10** OPTIONS preflight — minor
- **V-12** /edit/async PENDING entry — design decision (replace by job_id is intentional)
- **V-14** SUBTITLING reused for style transfer — cosmetic
- **V-15** trim re-encode vs cut_segments codec mismatch — internal optimization
- **V-23** iterdir() exception on Windows — partial fix in V-22
- **V-29** synthetic word fallback for emphasis — V-39 already addresses
- **V-30** post-zoom segment missing if probe fails — minor
- **V-32** dead code in zoom.py — refactor opportunity
- **V-34** concat demuxer codec mismatch — V-33 already fixes path issue
- **V-37/V-38** double encoding in cutter — performance
- **V-41** chunked.transcriber_cache TTL — no issue observed
- **V-49** max video duration in chapter/moment selectors — V-19 covers
- **V-51** score clamping in moments.py — internal
- **V-53** moment validation against transcript.duration — minor
- **V-54** LUT path traversal in color.py — needs user-provided LUT feature
- **V-55/V-56** color balance range — ffmpeg clamps

These are all P3 or "won't fix" — no security or correctness impact.
