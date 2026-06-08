# Vireo Studio Chat Bot — 6-Month Roadmap to 10/10

**Status as of 2026-06-08:** Studio at 98% per REVIEW_10_OF_10.md. 36 editing tools. 379+3 tests passing. Tier 1 (color/speed/audio/multi-clip/text) + Tier 2 (vision/generation) shipped but stubbed (return job_id, real workers pending).

**Goal:** Make the bot a global #1 chat-based video editor. Every capability needs to be (a) implemented, (b) production-quality, (c) measured by eval harness, (d) documented, (e) tested.

**Methodology:**
- Each week = 1 major capability
- Each capability = design → implement → eval → iterate
- Eval harness is the truth — if eval < 90%, it's not done
- "10/10" = production-ready + battle-tested with real videos

---

## 🗓️ 6-Month Overview

| Month | Theme | Tools Added | Eval Target |
|---|---|---|---|
| **Month 1** | Foundation (real workers + UI) | 0 new, 36 wired to real FFmpeg/neural | 90% eval |
| **Month 2** | Core editing polish (T1.5 + T3) | +6 | 92% eval |
| **Month 3** | Engagement & growth (T4 + T5) | +8 | 93% eval |
| **Month 4** | Multi-modal intelligence (T6 + T7) | +10 | 94% eval |
| **Month 5** | Production pipeline (T8 + T9) | +8 | 95% eval |
| **Month 6** | Polish + scale (T10 + launch) | +4 | 96% eval, 100+ real users |

**Cumulative at 6 months:** ~36 + 36 = **72 chat tools**, **500+ tests**, **96% eval**, **10/10 production grade**.

---

# 📅 MONTH 1: Foundation (Weeks 1-4)

**Theme:** Wire the 36 existing tools to REAL FFmpeg and neural backends. Without this, the bot is a UI demo, not a product.

## Week 1: Real FFmpeg Worker

**Goal:** Replace the stub `job_id` returns in Tier 1 tools with actual FFmpeg invocations.

**Why first:** Without real FFmpeg, the bot can't produce any video. Everything else builds on this.

### Tasks

1. **FFmpeg worker infrastructure** (2 days)
   - Create `agents/studio/workers/ffmpeg_worker.js` (Node.js child process pool)
   - Queue: in-process Queue with priority (Tier 1 jobs get fast lane)
   - Job lifecycle: queued → running → completed/failed
   - Persistence: store job state in Postgres (so server restart doesn't lose work)
   - File I/O: shared temp dir `/tmp/vireo-jobs/`, cleanup after 24h
   - 5 unit tests: queue enqueue, worker pickup, success path, error path, cleanup

2. **apply_color_grade → real FFmpeg** (1 day)
   - `ffmpeg -i input.mp4 -vf "eq=CONTRAST:BRIGHTNESS:SATURATION:GAMMA,curves=preset" -c:a copy output.mp4`
   - Test with 5 reference videos → output file size, duration preserved
   - Visual diff: each preset applied to test image, screenshot comparison
   - 3 integration tests: cinematic, warm, custom LUT

3. **apply_speed_ramp → real FFmpeg** (1 day)
   - `ffmpeg -i input.mp4 -filter:v "setpts=PTS/MULTIPLIER,minterpolate=mi_mode=blend" -an output.mp4`
   - Audio: atempo filter (chain for >2x or <0.5x)
   - Optical flow: minterpolate=mi_mode=mci
   - 4 integration tests: constant_half, ramp_in, custom, optical_flow

4. **mix_audio → real FFmpeg** (1.5 days)
   - 3 tracks: voice, music, SFX
   - Filter graph: `volume`, `sidechaincompress` (for ducking), `equalizer`, `loudnorm`
   - Denoise: `anlmdn` (non-local means denoiser)
   - 5 integration tests: voice_volume, music_duck, EQ podcast, normalize -14 LUFS, denoise

5. **compose_multi_clip → real FFmpeg** (1.5 days)
   - Sequential: concat demuxer
   - Grid: xstack filter (2x2 layout)
   - PiP: overlay filter
   - Transitions: xfade filter (cut, fade, crossfade, whip, zoom)
   - 6 integration tests: 2-clip concat, 4-clip grid, 2-clip pip, crossfade, whip transition, 9:16 output

6. **add_text_overlay → real FFmpeg** (1 day)
   - drawtext filter with font, color, stroke
   - Animations: alpha (fade), translate (slide_in), fontsize (pop), drawtext line by line (type_on)
   - 5 integration tests: tiktok-title, lower-third, slide_in, pop, custom font

### Acceptance criteria
- All 5 Tier 1 tools produce real output files
- Average processing time: 30s video < 5s, 5min video < 60s
- 100% of tests pass with real FFmpeg
- Eval harness runs against real outputs (not stubs)

### Risks
- FFmpeg filter syntax is tricky → use ffmpeg-static npm package for guaranteed version
- Long videos OOM → stream processing, set memory limits per worker
- Concurrent jobs on same file → file-level lock

---

## Week 2: Real Neural Network Backends

**Goal:** Replace stubs in vision + generation tools with actual model calls.

### Tasks

1. **Local model orchestration** (2 days)
   - Create `agents/studio/workers/neural_worker.js` (Python subprocess for ML)
   - Models: LLaVA (vision), YOLOv8 (detection), SDXL (image), SVD (video)
   - GPU detection: torch.cuda.is_available()
   - Model caching: download once, reuse (HuggingFace cache)
   - 4 unit tests: model load, GPU detect, error path, cleanup

2. **describe_frame → real LLaVA** (1 day)
   - Extract frame with ffmpeg: `ffmpeg -i input.mp4 -ss 5 -frames:v 1 frame.png`
   - Call LLaVA via Ollama: `ollama run llava "describe this image"`
   - Parse response into {description, tags}
   - 3 integration tests: real image, no GPU fallback, with focus

3. **detect_objects → real YOLOv8** (1 day)
   - Use ultralytics Python package
   - Return: [{class, confidence, bbox: {x, y, w, h}}]
   - 3 integration tests: real image, confidence threshold, custom classes

4. **detect_scenes → real PySceneDetect** (1 day)
   - scenedetect library, content-based detection
   - For each scene: extract middle frame, describe with LLaVA
   - 3 integration tests: real video, min scene length, custom model

5. **extract_dominant_colors → real k-means** (0.5 day)
   - PIL Image → numpy array
   - sklearn KMeans on RGB pixels
   - Return top N colors with hex codes + percentages
   - 2 integration tests: real image, n_colors variations

6. **generate_image → real SDXL** (1.5 days)
   - Use diffusers library, model: stabilityai/stable-diffusion-xl-base-1.0
   - Custom: negative_prompt, style, aspect_ratio, seed
   - 3 integration tests: text prompt, with seed (reproducibility), negative prompt

### Acceptance criteria
- All 4 vision tools produce real results
- 2 generation tools (image) work
- Video generation stubbed until Week 3 (Sora/Replicate not local)
- 100% of tests pass

### Risks
- GPU required for reasonable speed → support CPU fallback (10x slower)
- Model downloads are large (SDXL = 6GB) → cache strategy critical
- VRAM management → at most 1 model loaded at a time

---

## Week 3: Video Generation + UI Polish

**Goal:** Add real video generation, then build the chat UI that ties everything together.

### Tasks

1. **generate_video → Replicate or local SVD** (1.5 days)
   - Backend: Replicate API (cloud, pay-per-use) OR local SVD (free, slow)
   - Replicate: stability-ai/stable-video-diffusion
   - Local: stabilityai/stable-video-diffusion-img2vid (1B params)
   - 2 integration tests: text prompt, with reference image

2. **inpaint_frame → SDXL inpainting** (1 day)
   - Use diffusers StableDiffusionXLInpaintPipeline
   - Mask: convert bbox/polygon to binary mask image
   - 2 integration tests: remove object, replace with prompt

3. **Public chat UI — connect to vite/build** (2.5 days)
   - Currently: `agents/studio/public/index.html` (22KB vanilla JS, 590 lines)
   - Move to proper Vite project at `agents/studio/frontend/`
   - Add: React + Tailwind + shadcn/ui
   - Connect: SSE streaming to /api/chat/stream
   - File upload: tus-js-client for resumable uploads
   - Real-time job progress: poll /api/me/jobs
   - 5 integration tests: chat round-trip, upload, download, undo, error display

4. **Mobile-responsive chat** (1 day)
   - Same Vite app, add Tailwind responsive utilities
   - Test on iPhone/Android viewports
   - 2 visual regression tests

### Acceptance criteria
- Chat UI is production-quality, looks better than CapCut
- All 7 Tier 2 tools produce real outputs
- 100% tests pass

---

## Week 4: Eval Harness v2 + Real-World Testing

**Goal:** The eval harness is the truth-mechanism. Make it comprehensive + tie it to CI.

### Tasks

1. **Expand golden dataset from 18 to 50 cases** (2 days)
   - Cover all 36 tools with at least 1 case
   - Multi-turn cases (tool → follow-up → tool)
   - Adversarial cases (empty inputs, conflicting requests, "make it viral")
   - Russian + English mix (50/50)
   - Multi-step plans ("make me a 30s TikTok about X, with hook, music, and captions")
   - 1 test per case

2. **Eval scoring v2** (1 day)
   - Replace boolean pass/fail with 0-100 score per case
   - Categories: tool_routing (40%), output_quality (30%), latency (15%), persona (15%)
   - LLM-as-judge for open-ended quality
   - Hard 90% gate for "ship", 95% for "10/10"

3. **Real LLM with real outputs** (1.5 days)
   - Current eval uses mock outputs; new eval uses real FFmpeg output
   - Sample output frames → vision LLM judges visual quality
   - Audio: sample 10s clips → check loudness, no clipping
   - 3 integration tests

4. **CI integration** (1.5 days)
   - GitHub Action: run eval on every PR
   - Block merge if eval drops below 90%
   - Weekly: post eval report to Slack
   - 2 CI tests

### Acceptance criteria
- 50-case golden dataset covers all tools
- Eval reports: tool_routing + output_quality + latency + persona
- 90% gate enforced in CI
- Eval runs in <5 minutes

### Eval target end of Month 1: **90%**

---

# 📅 MONTH 2: Core Editing Polish (Weeks 5-8)

**Theme:** Add the "wow" features that turn a tool into a workflow. These are what users notice and share.

## Week 5: Smart Editing Modes (3 tools)

**Goal:** Add high-level commands that auto-chain existing tools.

1. **`auto_edit_for_platform`** (2 days)
   - Input: source video + platform (tiktok/youtube/instagram)
   - Auto-chains: transcribe → remove_silence → cut_to_target → add_captions → add_music → reframe
   - Uses Style DNA to choose: caption style, music mood, hook style
   - 5 integration tests: TikTok, YouTube Shorts, Reels, with/without DNA

2. **`fix_pacing`** (1.5 days)
   - Detects dead air, slow sections, fast sections
   - Auto-applies: remove_silence + speed_ramp
   - Configurable: "aggressive" (5s silence min) / "subtle" (1.5s min)
   - 4 integration tests: aggressive, subtle, with hooks, with quiet sections

3. **`make_shareable`** (1.5 days)
   - Detects: weak hook, low engagement patterns
   - Auto-applies: apply_hook_style + add_captions + add_zoom
   - Returns: before/after engagement prediction (mocked v1, real v2)
   - 4 integration tests: weak hook, no captions, with Style DNA, no DNA

---

## Week 6: Multi-track Audio (2 tools + enhance mix_audio)

4. **`separate_audio_stems`** (1.5 days)
   - Use demucs (Meta's source separation) or spleeter
   - Returns: 4 stems (drums, bass, vocals, other)
   - 3 integration tests: podcast, music video, with vocals

5. **`replace_audio_track`** (1 day)
   - Replace voiceover with cleaner recording
   - Replace music with different track
   - Auto-align to existing timing
   - 3 integration tests: replace voice, replace music, align to timing

6. **Enhance `mix_audio` with stems** (1.5 days)
   - Take stems from #4 → mix independently
   - Per-stem volume, EQ, duck
   - 3 integration tests: vocal boost, drum duck, custom stem mix

---

## Week 7: Multi-Output Workflows (2 tools)

7. **`create_content_series`** (2 days)
   - Input: 1 long video + N topics
   - Auto-creates: N shorts (1 per topic), 1 summary, 1 trailer, 1 thumbnail set
   - Uses Style DNA for consistent voice
   - 4 integration tests: 3 topics, 5 topics, with DNA, without DNA

8. **`repurpose_for_platforms`** (1.5 days)
   - Input: 1 short + target platforms
   - Creates: TikTok + Shorts + Reels + YouTube versions
   - Each gets: reframe + captions + platform-specific hook
   - 4 integration tests: 4 platforms, 2 platforms, 9:16→1:1, with brand pack

---

## Week 8: Polish + Integration Tests (3 days)

9. **End-to-end workflow tests** (3 days)
   - "I just uploaded a 30min podcast. Make me 3 shorts + 1 trailer + 1 thumbnail."
   - Full chain: upload → transcribe → find_best_moments → make_short (×3) → add_captions → generate_thumbnail
   - Verify: all outputs produced, all jobs complete, all metadata correct
   - 5 integration tests covering full workflows

### Eval target end of Month 2: **92%**

---

# 📅 MONTH 3: Engagement & Growth (Weeks 9-12)

**Theme:** Tools that drive views, subscribers, and revenue. The "growth hacker" suite.

## Week 9: Hook Engineering (3 tools)

1. **`analyze_hook_strength`** (1.5 days)
   - Analyzes first 3s of video
   - Scores 0-100 based on: visual interest, audio energy, motion, text overlay
   - Suggests: specific improvements
   - 3 integration tests: weak hook, strong hook, with caption

2. **`generate_alternative_hooks`** (2 days)
   - LLM generates 3 alternative hooks for the opening 3s
   - Each is a different angle: question / statement / visual_tease / controversy
   - User picks one → apply_hook_style uses it
   - 4 integration tests: weak video, strong video, RU/EN, niche-specific

3. **`predict_virality_score`** (1.5 days)
   - ML model trained on 10K viral videos (use public dataset)
   - Features: hook, length, pacing, topic, visual style
   - Output: 0-100 score + 3 reasons why
   - 3 integration tests: viral-style, low-quality, mid-range

---

## Week 10: SEO & Distribution (3 tools)

4. **`generate_title_variants`** (1 day)
   - LLM generates 5 title options
   - Each optimized for: search (keywords), click (curiosity), engagement (specificity)
   - 3 integration tests: tech niche, food niche, RU

5. **`generate_description_with_timestamps`** (1.5 days)
   - Auto: transcript + generate_chapters + SEO keywords
   - Output: YouTube-ready description with timestamps + tags
   - 3 integration tests: short video, long video, with chapters

6. **`schedule_optimal_posting`** (1.5 days)
   - Analyzes user's past videos' performance by hour/day
   - Recommends: best time to post each platform
   - Integrates with: Buffer, Hootsuite, native platform APIs
   - 3 integration tests: single platform, cross-platform, with history

---

## Week 11: Community & Audience (2 tools)

7. **`auto_respond_to_comments`** (2 days)
   - LLM generates reply in user's Style DNA
   - Filters: questions, compliments, criticism, spam
   - Auto-pins best comment
   - 2 integration tests: friendly comment, hate comment, with DNA

8. **`analyze_audience_sentiment`** (1.5 days)
   - Aggregates: comments, watch-time, retention
   - Outputs: sentiment by topic, what works, what doesn't
   - 2 integration tests: small channel, large channel

---

## Week 12: Polish + First Real User Test (3 days)

9. **Onboard 5 beta users** (3 days)
   - Recruit from creator community (Discord, Twitter)
   - Give them 30 days free + 1-on-1 setup
   - Collect feedback, bug reports, feature requests
   - Fix top 3 pain points

### Eval target end of Month 3: **93%**

---

# 📅 MONTH 4: Multi-Modal Intelligence (Weeks 13-16)

**Theme:** Bot understands video at a deeper level. Vision + reasoning + memory.

## Week 13: Deep Video Understanding (3 tools)

1. **`summarize_video_arc`** (2 days)
   - Not just transcript — analyzes emotional arc
   - Output: "this video starts with X, builds to Y, resolves with Z"
   - Uses: video frames + audio + transcript
   - 3 integration tests: tutorial, vlog, narrative

2. **`find_emotional_moments`** (1.5 days)
   - Detects: laughter, surprise, anger, sadness (audio + facial expression)
   - Returns timestamps + intensity scores
   - 3 integration tests: podcast, talk show, funny video

3. **`detect_branding_consistency`** (1.5 days)
   - User uploads brand kit (logo, colors, fonts)
   - Analyzes video: is logo visible? are colors on-brand? fonts match?
   - Output: score 0-100 + specific violations
   - 3 integration tests: with brand kit, no brand kit, partial match

---

## Week 14: Cross-Video Intelligence (2 tools)

4. **`learn_user_style`** (2 days)
   - Analyzes 5+ user's past videos
   - Extracts: hook patterns, transition styles, music preferences, color palette
   - Updates Style DNA automatically
   - 3 integration tests: 5 videos, 10 videos, single creator

5. **`compare_to_competitors`** (1.5 days)
   - User gives 3 competitor channels
   - Analyzes: their style vs user's
   - Output: differences + opportunities
   - 2 integration tests: 1 competitor, 3 competitors

---

## Week 15: Long-form Memory (1 tool + infrastructure)

6. **`vireo_recall`** (2 days)
   - Across all user's projects, recall:
     - "What hook patterns worked in your last 5 videos?"
     - "You always skip the intro — should I cut it?"
     - "Last week you asked for cinematic — same here?"
   - Persistent memory: store key facts per user
   - 3 integration tests: new user, 30-day user, 6-month user

7. **Vector search across content** (1 day)
   - Embed all user videos, scripts, captions into vector DB
   - Search: "find all my videos about cooking pasta"
   - Use: Pinecone or local Chroma
   - 2 integration tests

---

## Week 16: Multi-Modal Outputs (2 tools)

8. **`generate_video_reaction`** (1.5 days)
   - User records 30s reaction
   - Auto-creates: split-screen with original + reaction
   - Bot suggests best moments
   - 2 integration tests

9. **`create_compilation_from_voice`** (1.5 days)
   - User says "I want a compilation of the funniest moments from my last 5 videos"
   - Bot: finds moments, ranks by humor score, compiles
   - 2 integration tests

### Eval target end of Month 4: **94%**

---

# 📅 MONTH 5: Production Pipeline (Weeks 17-20)

**Theme:** Tools for creators who publish daily. Reliability + automation.

## Week 17: Batch Operations (3 tools)

1. **`batch_edit`** (2 days)
   - Apply same edit to 10+ videos
   - Use cases: 30-day content series, episode templates
   - Returns: 10 output files
   - 3 integration tests: 5 videos, 20 videos, with error in 1

2. **`watch_folders`** (1.5 days)
   - Set up folder on user's machine
   - Any new file → auto-process with template
   - Pipeline: transcribe → make_short → add_captions → notify
   - 2 integration tests

3. **`scheduled_edits`** (1.5 days)
   - Cron-like: "Every Sunday at 6pm, take my raw footage and make a weekly recap"
   - Stores template, runs on schedule
   - 2 integration tests

---

## Week 18: Team & Collaboration (3 tools)

4. **`team_workspace`** (2 days)
   - Multiple users, shared projects
   - Role-based: owner, editor, reviewer
   - 3 integration tests: invite, edit, permissions

5. **`comments_on_timeline`** (1.5 days)
   - Frame-level comments (like Google Docs)
   - Reply threads, resolve, mention
   - 2 integration tests

6. **`approval_workflow`** (1.5 days)
   - Junior edits → senior reviews → publish
   - Status: draft → in_review → approved → published
   - 2 integration tests

---

## Week 19: API & Integrations (3 tools)

7. **`public_api`** (2 days)
   - REST + GraphQL for all 36+ tools
   - API keys, rate limits, webhooks
   - 3 integration tests

8. **`zapier_integration`** (1.5 days)
   - Trigger: new video uploaded → start edit
   - Action: "Post to YouTube when bot finishes"
   - 2 integration tests

9. **`premiere_export`** (1.5 days)
   - Export timeline as XML/EDL
   - Import into Premiere/Final Cut
   - 2 integration tests

---

## Week 20: Reliability + Monitoring (3 days)

10. **SLO dashboards** (1.5 days)
    - Uptime target: 99.5%
    - p50/p95/p99 latency
    - Error rate by tool
    - 1 integration test

11. **Auto-retry + circuit breakers** (1.5 days)
    - Failed jobs retry with exponential backoff
    - Circuit breaker for downstream services (FFmpeg, models)
    - 2 integration tests

### Eval target end of Month 5: **95%**

---

# 📅 MONTH 6: Polish + Launch (Weeks 21-24)

**Theme:** Make it production-grade. Handle edge cases. Launch publicly.

## Week 21: Mobile (1 tool + native app)

1. **iOS/Android native app** (5 days)
   - React Native or Flutter
   - Core: chat, upload, preview, download
   - Voice input: "Hey Vireo, cut from 0:23 to 0:30"
   - 3 integration tests

---

## Week 22: Enterprise (3 tools)

2. **`audit_log_advanced`** (1.5 days)
   - Every action logged with user, timestamp, parameters
   - SOC 2 compliant format
   - Export as CSV/JSON
   - 2 integration tests

3. **`sso_integration`** (1.5 days)
   - Google Workspace, Microsoft 365, Okta
   - SAML 2.0, OIDC
   - 2 integration tests

4. **`custom_branding`** (1 day)
   - White-label: logo, color, email templates
   - For agencies, large teams
   - 1 integration test

---

## Week 23: Documentation + Onboarding (3 days)

5. **Public docs site** (2 days)
   - docs.vireo.studio
   - All 70+ tools documented
   - Tutorials: "Make a TikTok in 5 minutes"
   - API reference auto-generated
   - 1 integration test (build check)

6. **Video onboarding** (1 day)
   - 5-min welcome video
   - Interactive tutorial on first login
   - 1 integration test

---

## Week 24: Public Launch (3 days)

7. **Public launch** (3 days)
   - Product Hunt post
   - Twitter/X announcement
   - Press: TechCrunch, The Verge
   - Waitlist → public signup
   - Free tier: 10 videos/month
   - Pro tier: $29/month, unlimited
   - Target: 100 paying users in 30 days

### Eval target end of Month 6: **96%**, 100+ real users, $3K MRR

---

# 📊 Cumulative Stats at 6 Months

| Metric | Now (Month 0) | End Month 6 |
|---|---|---|
| Chat tools | 6 | **72** |
| Vision tools | 4 | 8 |
| Generation tools | 3 | 6 |
| Edit tools | 24 | 32 |
| Utility tools | 5 | 26 |
| **Total tools** | **36** | **72+** |
| Tests | 379 | **1000+** |
| Eval pass rate | 94% | **96%** |
| Documentation | 8 files | 30+ files |
| Real users | 0 | 100+ |
| Revenue | $0 | $3K+ MRR |
| Uptime | n/a | 99.5% |
| p95 latency | 4-5s | <2s |

---

# 🎯 Definition of "10/10" for Each Tool

Every tool must satisfy **all 8 criteria** to be considered "10/10":

1. ✅ **Implemented** — production code, not a stub
2. ✅ **Tested** — unit + integration tests, 100% pass
3. ✅ **Documented** — README entry, OpenAPI spec, usage examples
4. ✅ **Eval'd** — at least 1 case in the golden dataset, ≥95% pass rate
5. ✅ **Performant** — p95 latency < 2s for sync tools, <60s for async
6. ✅ **Error-handled** — all input validation, graceful errors, retries
7. ✅ **Observable** — audit logged, metrics, traces
8. ✅ **Real users tested** — at least 3 users have used it successfully

If a tool fails any of these, it's not 10/10.

---

# 🛠 Implementation Pattern (per tool)

Every tool follows the same 7-step pattern. This ensures consistency.

### Step 1: Design (2-4 hours)
- Spec doc: name, purpose, parameters, return shape, errors
- 3-5 example invocations
- Add to golden dataset as 1-2 test cases

### Step 2: Validator (1-2 hours)
- Parameter validation: required, types, ranges, enums
- Returns: `{ok: false, error: "X", message: "Y"}` for invalid
- 5+ unit tests for edge cases

### Step 3: Core implementation (4-8 hours)
- Main function: `async function toolName({...args}, ctx)`
- Real implementation (not stub) — uses FFmpeg, neural network, or DB
- Returns: `{ok, ...result}` for success

### Step 4: Integration test (2-4 hours)
- 3-5 tests with real input files
- Verify output: file size, duration, format, visual quality
- Failure mode tests (bad input, network down, OOM)

### Step 5: Eval case (1 hour)
- Add to `eval.mjs` golden dataset
- Run eval, verify 95%+ pass

### Step 6: Documentation (1-2 hours)
- README.md entry
- API spec
- Example usage

### Step 7: Real user test (4-8 hours)
- Have 1-2 users try it
- Collect feedback
- Iterate

**Total per tool: 3-5 days of work.**

---

# 📋 Weekly Checklist Template

Every Monday morning, answer:

- [ ] What shipped last week? (new tools, fixes, etc)
- [ ] What's eval pass rate? (target: 90%+)
- [ ] How many tests pass? (target: +5/week)
- [ ] Any regressions? (target: 0)
- [ ] User feedback received? (action items)
- [ ] This week's goals (3-5 specific tools/capabilities)
- [ ] Blockers?
- [ ] Next week's preview

---

# 🎓 Key Principles (the "10/10 mindset")

### 1. **Measure twice, cut once**
Eval harness is the truth. If eval < 90%, the feature isn't done.

### 2. **Real users > real code**
A tool that's "complete" but nobody uses is worth 0. Talk to users weekly.

### 3. **Production-grade = boring**
Boring code: well-tested, well-logged, error-handled, documented. No clever tricks.

### 4. **Ship the smallest thing that works**
MVP first, then iterate. Don't build a 10-tool chain before validating 1 tool.

### 5. **Documentation IS the product**
Undocumented tool = doesn't exist. Every tool has README + API spec + example.

### 6. **Latency is a feature**
4-5s p95 is too slow. Target: <2s. Optimize the LLM call first, then FFmpeg.

### 7. **Fail loudly, recover gracefully**
Errors must be specific, actionable, and not crash the whole chat session.

### 8. **Multi-modal is the future**
Text + image + video + audio all in one chat interface. The bot should handle all of them seamlessly.

### 9. **Personality matters**
A tool that works but is robotic is forgettable. A tool with personality is shared.

### 10. **10/10 is a process, not a destination**
"10/10" this week isn't "10/10" next year. The roadmap never ends.

---

# 🚨 Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| FFmpeg workers unstable | High | High | Use ffmpeg-static, containerize, monitor |
| GPU costs too high | Medium | High | Hybrid: local for dev, cloud for prod |
| LLM hallucination → bad tool calls | High | High | Strict validation, ownership checks, undo |
| Eval drift (LLM behavior changes) | Medium | Medium | Daily eval runs, alert on drops |
| User churn after free trial | Medium | High | Daily active usage metrics, re-engagement |
| OpenAI/Anthropic API price hike | Medium | Medium | Multi-provider, on-prem option |
| Competitor launches same features | High | Medium | Focus on chat UX moat, not features |
| Privacy concerns (user video data) | Medium | High | End-to-end encryption option, clear policy |
| Legal (copyright, deepfakes) | Medium | High | Inpainting filters, watermark detection |

---

# 💰 Revenue Projections

**Pricing tiers:**
- **Free:** 10 videos/month, 720p output, watermarked
- **Pro:** $29/month, unlimited, 1080p, no watermark, all tools
- **Business:** $99/month, team workspaces, API access, SSO
- **Enterprise:** custom pricing, on-prem, SLA

**At 100 paying users (avg $40/month):** $4K MRR
**At 1000 paying users:** $40K MRR
**At 10K paying users:** $400K MRR

**Break-even at:** ~30 paying users (covers infra)

---

# 🌍 Expansion Beyond Studio (Year 2)

After Studio is 10/10, the same chat-driven model can expand to:

1. **Vireo Audio** — podcast editing via chat
2. **Vireo Image** — photo editing via chat
3. **Vireo Writing** — long-form content via chat
4. **Vireo Design** — graphics & thumbnails via chat
5. **Vireo Code** — code generation via chat
6. **Vireo Data** — analytics & insights via chat

All powered by the same 6-month pattern: design → implement → eval → iterate.

---

# 📞 When to Ask for Help

If at any point in this roadmap you feel:

- Stuck on a tool for >2 days → break it into smaller pieces
- Eval dropping without explanation → check LLM provider status
- User feedback overwhelmingly negative → re-read the goal, not the solution
- Burned out → take a week off, talk to a user, remember the mission

The roadmap is a guide, not a contract. Adjust as you learn.

---

**Last updated:** 2026-06-08
**Current status:** Month 0, Week 0 — 36 tools, 94% eval, ready to start Month 1
**Next milestone:** Month 1 complete — real FFmpeg workers, 90% eval, foundation solid
