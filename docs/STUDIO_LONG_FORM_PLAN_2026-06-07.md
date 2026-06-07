# Vireo Studio — Long-Form Video Editing (Huge Videos for YouTubers/Streamers/Insta)

> **Core mission:** User uploads 1h-4h+ raw video. Agent turns it into
> 12min YouTube + 60s TikTok + 90s IG Reel + chapters + captions + thumbnails —
> in one chat session, real edits, real files on disk.
>
> **Status today:** 4 long-form modules exist on disk (894 LOC, unwired):
> - `agents/video/vireo_video/chunked.py` (235 lines) — chunked Whisper for >30min audio
> - `agents/video/vireo_video/moments.py` (247 lines) — LLM-based best-moment extraction
> - `agents/video/vireo_video/chapters.py` (219 lines) — auto YouTube chapters
> - `agents/video/vireo_video/audio_analyzer.py` (193 lines) — volume/silence/music detection
>
> **All 4 need to be wired to Studio tools. Plus 20+ new tools to cover the use cases below.**

---

## A. Upload & ingest (huge files, 5-10GB+)

| # | Tool | Description | Test/Evidence |
|---|---|---|---|
| A.1 | TUS resumable upload in Studio | `/api/upload/resumable/*` — Video agent has `tus.py`, Studio doesn't expose it | E2E: upload 3.2GB MP4 in 5MB chunks, network drop mid-upload, resume |
| A.2 | URL ingest (YouTube, Twitch, Twitter, Vimeo, Dropbox) | `agents/ingest/src/server.js` — paste URL, agent downloads | E2E: paste YouTube URL → 2h video on disk |
| A.3 | Multi-file upload (multi-cam) | Upload N videos (face cam + screen + game capture) → merge into multi-track project | E2E: 3 files → 1 multi-track project |
| A.4 | Auto-detect video metadata (resolution, fps, codec, duration, bitrate) | `get_video_info` already exists, extend with codec/bitrate | E2E: 4K 60fps H.264 → all fields populated |
| A.5 | Storage quota tracking | "You've used 32GB of 100GB" | Test: 3 uploads, quota reflected in `/api/me` |

---

## B. Transcription (huge audio, 1h+ takes 30+ min)

`chunked.py` is on disk with `transcribe_long()` — needs to be exposed.

| # | Tool | Description | Test/Evidence |
|---|---|---|---|
| B.1 | `transcribe_video` (already exists, extend) | Use `chunked.transcribe_long()` if duration > 30 min | E2E: 2h video → full transcript in 25 min (vs 90+ min naive) |
| B.2 | `transcribe_with_speakers` | pyannote.audio diarization (who spoke when) | E2E: 3-person podcast → 3 labeled tracks |
| B.3 | `transcribe_multilingual` | Detect language, transcribe each segment in its language | E2E: ES/EN/JA mixed podcast → 3 transcript sections |
| B.4 | `transcribe_with_emotion` | "excited", "calm", "frustrated" labels per segment | E2E: returns emotion timeline |
| B.5 | `transcribe_fast` (cheaper model) | `whisper-large-v3-turbo` — 6× faster, slightly less accurate | E2E: 1h video → transcript in 8 min |
| B.6 | `re_transcribe_segment` | "redo this part, I think I misheard" | Test: re-run Whisper on 5-min segment, merge into main |
| B.7 | `search_transcript` | "find all times I said 'pricing'" | E2E: returns list of `{timestamp, text, score}` |
| B.8 | `get_transcript_section` | "give me the transcript from 0:23:00 to 0:25:30" | E2E: returns SRT string |
| B.9 | Cache management | `cached_whisper.py` already exists; expose `get_cache_stats`, `clear_cache` | Test: transcribe same video twice → 2nd is cached |

---

## C. Best-moments extraction (the KILLER feature for streamers/YouTubers)

`moments.py` is on disk with `build_prompt()` + `parse_moments_response()` — needs Studio tool.

| # | Tool | Description | Test/Evidence |
|---|---|---|---|
| C.1 | `find_best_moments` (1.5) | "find 5 best moments from this 2h video for TikTok" | E2E: 2h podcast → 5 `{start, end, score, reason}` |
| C.2 | `find_funniest_moments` | "find 3 funniest moments" (uses laughter detection in audio) | E2E: 4h stream → 3 moments with high laugh density |
| C.3 | `find_most_watched_moments` | "find parts where viewers rewind" (engagement data) | E2E: imports YouTube Analytics, finds top 5 rewind points |
| C.4 | `find_quote_moments` | "find quotable lines worth making into a graphic" | E2E: 5 punchy quotes with timestamps |
| C.5 | `find_educational_moments` | "find parts where I'm teaching" (heuristic: long pauses + structured speech) | E2E: tutorial video → 5 "explainer" segments |
| C.6 | `find_controversial_moments` | "find spicy takes" (sentiment analysis) | E2E: opinion video → 3 controversial segments |
| C.7 | `find_action_moments` | For gamers: "find intense moments" (audio peak + visual activity) | E2E: 2h stream → 5 action segments |
| C.8 | `find_milestone_moments` | For streamers: subscriber milestones, donations, sub trains | E2E: 4h stream → 3 milestones (1k subs, dono, train) |
| C.9 | `find_pacing_problems` | "where do viewers drop off?" | E2E: 1h video → dropoff timestamps with suggestions |
| C.10 | `suggest_thumbnail_moments` | "where are the most expressive faces?" (face detection) | E2E: returns 5 timestamps with face confidence score |

Each tool: LLM call to moments.py + score > threshold filter + dedup overlapping ranges.

---

## D. Auto-chapters (YouTube, 10+ chapters from 2h video)

`chapters.py` is on disk — needs Studio tool.

| # | Tool | Description | Test/Evidence |
|---|---|---|---|
| D.1 | `generate_chapters` (1.3) | "add YouTube chapters to this 2h video" | E2E: 12 chapters, YouTube-format timestamps |
| D.2 | `generate_chapters_with_titles` | LLM-generated chapter titles (not just topic detection) | E2E: 12 chapters with descriptive titles |
| D.3 | `generate_chapters_custom` | "I want chapters every 5 min" | E2E: 24 chapters at 5-min intervals |
| D.4 | `export_chapters_srt` | "give me the chapters as .srt" | E2E: returns SRT string with chapter titles |
| D.5 | `burn_chapters_visual` | "make chapters visible as text overlay" | E2E: 2h video with chapter titles at start of each |

---

## E. Multi-output from same source (the BIG efficiency gain)

YouTuber records 1 video → 5 outputs. Today: 5 separate edits, 5× time.

| # | Tool | Description | Test/Evidence |
|---|---|---|---|
| E.1 | `create_versions` (NEW) | "make 60s TikTok, 90s IG Reel, 12min YouTube from this" | E2E: 1 source → 3 outputs, each with platform-specific style |
| E.2 | `create_short_from_long` | "make a 60s clip from this 2h video, pick the best moment" | E2E: uses find_best_moments + clips to 60s |
| E.3 | `create_compilation` | "make a 10min 'best of' compilation" | E2E: 5 best moments stitched → 10min output |
| E.4 | `create_summary` | "make a 3min summary of this 1h podcast" | E2E: LLM picks top 5%, stitches + adds captions |
| E.5 | `create_trailer` | "make a 30s trailer for this 2h video" | E2E: hook + 3 highlights + CTA, all under 30s |
| E.6 | `create_thread` | "make a Twitter thread (8 tweets) from this video" | E2E: 8 tweet texts with video clips attached |
| E.7 | `create_carousel` | "make an IG carousel (5 slides) from key moments" | E2E: 5 PNG slides + captions |
| E.8 | `create_quote_graphics` | "make 5 quote images from this video" | E2E: 5 PNGs with quote + background video frame |
| E.9 | `create_highlight_reel` (streamers) | "make a 'best of stream' from this 4h VOD" | E2E: 10 highlights + transitions, 8min output |
| E.10 | `create_subscriber_milestone` (streamers) | "make a video for my 1k subs" | E2E: 30s compilation of best moments + "thanks" overlay |

**The key insight:** E.1 is what users actually want. They don't want 5 separate chats.
They want ONE chat that says "edit this for all platforms" and the agent does it.

---

## F. Long-form specific effects

| # | Tool | Description | Test/Evidence |
|---|---|---|---|
| F.1 | `remove_silence` (already exists, scale up) | Works on 2h video, 30+ min dead air removed | E2E: 2h raw → 1h25m cleaned, no audio gaps |
| F.2 | `remove_filler_words` | "remove all 'um', 'uh', 'like'" (filler word detection) | E2E: 1h video → 200 fillers removed, 4min saved |
| F.3 | `remove_repeats` | "I said the same thing twice, keep the better take" (LLM compares) | E2E: 3 repeated segments → 1 kept |
| F.4 | `add_jump_cuts` | "make my talking head more dynamic — jump cut every 3-5 sec" | E2E: 1h talking head → 240 jump cuts, smooth |
| F.5 | `add_broll` (1.2) | "add b-roll of cityscape at cut points" | E2E: b-roll inserted at 12 silence points |
| F.6 | `add_zoom` (already exists) | Auto-zoom on emphasis, works on 2h video | E2E: 47 zoom moments detected |
| F.7 | `add_captions_multilang` (6.1) | EN + ES + JA captions burned in | E2E: 3 caption tracks, all synced |
| F.8 | `add_chapters` (D.1) | YouTube chapters burned in | E2E: 12 chapters visible |
| F.9 | `add_intro_outro` | "add my standard intro/outro" | E2E: 5s intro + 8s outro, user-uploaded templates |
| F.10 | `add_lower_third` | "add my name + topic at start" | E2E: 4s lower third with animated reveal |
| F.11 | `add_progress_bar` | "add a progress bar at the bottom" | E2E: 2h video with smooth progress bar |
| F.12 | `add_end_screen` | "add 2 video suggestions + subscribe button" (YouTube end screen) | E2E: 20s end screen with clickable areas |
| F.13 | `add_subtitle_translation` | "translate captions to Spanish" (Whisper + GPT-4 translation) | E2E: ES captions, 99% accuracy |
| F.14 | `add_dubbed_audio` (advanced) | "dub the video in Spanish using my cloned voice" (ElevenLabs integration) | E2E: ES audio + synced captions |
| F.15 | `add_music` (1.1) | Mood-based music from library, ducked under voice | E2E: lo-fi music, 6dB reduction when voice present |
| F.16 | `add_sound_effects` | "add whoosh on every transition, ding on every list item" | E2E: 12 whooshes + 5 dings, all synced |
| F.17 | `add_animated_emoji` | "add 🔥 emoji when I say 'insane'" (sentiment + emoji) | E2E: 8 emoji overlays, all on keyword |
| F.18 | `add_styled_captions` | "use MrBeast style captions" (yellow, bold, 2 lines max, animation) | E2E: captions in mrbeast style |
| F.19 | `add_karaoke_captions` | word-by-word highlight as spoken | E2E: smooth word highlighting |
| F.20 | `add_chapter_markers` | "put a chapter title overlay when each new chapter starts" | E2E: 12 chapter title overlays |

---

## G. Smart LLM behaviors for long-form

| # | Behavior | Description | Test/Evidence |
|---|---|---|---|
| G.1 | **Ask clarifying questions for long-form** | "What platform? What length? What vibe?" | Test: missing info → agent asks 3 questions, doesn't start editing |
| G.2 | **Multi-step plan display** | For huge jobs, show "I will: 1) transcribe 2) find moments 3) clip 4) add captions 5) post" | Test: plan visible to user before execution |
| G.3 | **Resumable / checkpoint** | If job fails at step 3, retry from step 3 not from start | Test: kill at step 3, retry, picks up at step 3 |
| G.4 | **Background job with progress SSE** | Long edits return job_id, stream progress 0% → 100% | E2E: 2h edit, watch progress in real time |
| G.5 | **Edit history & undo** | "undo the last 3 edits" | Test: state machine, rollback works |
| G.6 | **Style learning from your old videos** | "I always do X" — agent learns from your style DNA | Test: 5 videos analyzed, new edit follows style |
| G.7 | **Cost preview** | "This edit will cost $2.50 (LLM + video processing). Proceed?" | Test: cost shown, user can cancel |
| G.8 | **Time preview** | "This will take ~25 min. Want to wait, or run in background?" | Test: ETA accurate within 20% |
| G.9 | **Compare to your other videos** | "this is similar to your last video, want to use the same style?" | Test: LLM retrieves similar projects |
| G.10 | **Failure recovery** | "Whisper failed on chunk 5/12, retrying with smaller chunks" | Test: visible progress on retries |

---

## H. Streamer-specific (Twitch/YouTube Live)

| # | Tool | Description | Test/Evidence |
|---|---|---|---|
| H.1 | `ingest_twitch_vod` | Paste Twitch URL → download VOD + chat log | E2E: 4h VOD + 50k chat messages |
| H.2 | `parse_chat_reactions` | "find parts where chat was hyped (emote spam)" | E2E: 10 hype moments with chat density |
| H.3 | `find_donation_moments` | "find all donations, make compilation" | E2E: 25 donations, stitched into 3min video |
| H.4 | `find_raid_moments` | "find parts where viewers raided in" | E2E: 5 raid moments with chat screenshots |
| H.5 | `find_clip_suggestions` | "based on chat hype, suggest 10 clip timestamps" | E2E: 10 timestamps with chat reason |
| H.6 | `find_emote_spam` | "find parts where viewers spam PogChamp/Kekw" | E2E: returns hyped segments |
| H.7 | `generate_clip_with_chat_reaction` | "make a clip with the chat reactions overlaid" | E2E: 30s clip with chat replay next to video |
| H.8 | `extract_stream_highlights` | "make a 10min 'best of stream' from 4h VOD" | E2E: 12 highlights, smooth transitions, music |
| H.9 | `subscriber_milestone_video` | "make a 30s thank-you for 1k subs" | E2E: compilation + thank you + subscriber count |
| H.10 | `moderator_action_log` | "show me all bans/timeouts this stream" | Test: 5 actions, full log |

---

## I. Instagram-specific (Reels, Stories, Posts, Carousel)

| # | Tool | Description | Test/Evidence |
|---|---|---|---|
| I.1 | `make_reel` (60-90s) | "make a 60s Reel from this 2h podcast" | E2E: 60s, 9:16, captions, music, hook |
| I.2 | `make_story_sequence` | "make 5 IG Stories from this video" | E2E: 5×15s stories with "swipe up" CTA |
| I.3 | `make_carousel_post` | "make a 7-slide carousel from key moments" | E2E: 7 PNGs, IG carousel format (1080×1350) |
| I.4 | `make_reel_with_text` | "make a Reel with big text overlay" (talking head + text) | E2E: 60s with 8 text callouts |
| I.5 | `make_voiceover_reel` | "make a Reel with my voiceover on top of b-roll" | E2E: 60s, b-roll + VO + captions |
| I.6 | `generate_ig_caption` | "write an IG caption with hashtags for this Reel" | E2E: caption + 15 trending hashtags |
| I.7 | `generate_ig_cover` | "make a custom Reel cover" (9:16, branded) | E2E: 1080×1920 PNG with title |
| I.8 | `format_for_igtv` | "make this 10min as IGTV (vertical, with chapter markers)" | E2E: 10min vertical with 5 IGTV chapter markers |
| I.9 | `extract_reel_from_long` | "find the best 60s for Reel + auto-crop to 9:16" | E2E: 60s 9:16, face-tracking crop |

---

## J. YouTuber-specific (Long-form YouTube)

| # | Tool | Description | Test/Evidence |
|---|---|---|---|
| J.1 | `youtube_seo_pack` | "generate title + description + tags + chapters for this 2h video" | E2E: SEO-optimized metadata, 5 tag suggestions |
| J.2 | `youtube_thumbnail_test` | "make 5 thumbnail options, pick best by AI scoring" | E2E: 5 PNGs, scored by CTR prediction |
| J.3 | `youtube_end_screen` | "add end screen with 2 video suggestions + subscribe" | E2E: 20s end screen, clickable areas |
| J.4 | `youtube_intro_optimizer` | "first 30s — should I keep it, cut it, or rewrite it?" | E2E: 3 variants of intro, agent recommends best |
| J.5 | `youtube_pacing_audit` | "analyze pacing — where do viewers drop off?" (visualization) | E2E: pacing curve + recommendations |
| J.6 | `youtube_comment_reply` | "draft 10 thoughtful replies to my top comments" | E2E: 10 reply texts, on-brand |
| J.7 | `youtube_community_post` | "draft a community post about this video" | E2E: post text + poll suggestion |
| J.8 | `youtube_analytics_import` | "import my last 30 days of analytics" | E2E: 30 days data, queried via tool |
| J.9 | `youtube_repurposer` | "turn this 2h video into: 1 Short + 1 community post + 1 tweet" | E2E: 3 outputs from 1 source |
| J.10 | `youtube_chapter_pins` | "pin 3 chapters in the description" | E2E: 3 chapters with timestamps |

---

## K. Multi-platform distribution (cross-posting)

| # | Tool | Description | Test/Evidence |
|---|---|---|---|
| K.1 | `cross_post` (NEW) | "post this to YouTube, TikTok, IG Reels, X, FB" — single tool, multi-platform | E2E: 1 video → 5 real posts, 5 URLs |
| K.2 | `platform_caption_rewrite` | Same video, 5 platform-native captions (TikTok: short + hashtags, LinkedIn: long-form, etc.) | E2E: 5 captions returned |
| K.3 | `scheduled_cross_post` | "post to all 5 platforms tomorrow at 5pm UTC" | E2E: scheduled, fires at time |
| K.4 | `optimal_post_time` | "when should I post this for max engagement?" (per platform) | E2E: 5 timestamps returned |
| K.5 | `hashtag_pack` | "give me 30 hashtags for this video, optimized per platform" | E2E: 30 hashtags, 6 per platform |
| K.6 | `post_engagement_check` | "did my cross-post do well? Compare across platforms" | E2E: 5 platforms, 5 metrics |
| K.7 | `auto_repost` | "if TikTok does well, auto-repost to IG Reels after 24h" | E2E: condition fires, repost happens |

---

## L. The "anything else" use cases (pro features)

The user said "любое" (anything). So exhaustive list:

### Visual effects
| # | Tool |
|---|---|
| L.1 | `apply_look` (color grading) — cinematic, vintage, B&W, vibrant, moody, warm, cold, film-grain |
| L.2 | `apply_filter` (Instagram-style) — Clarendon, Juno, Lark, etc. |
| L.3 | `add_transition` — fade, dissolve, wipe, slide, zoom-blur, glitch, whip-pan |
| L.4 | `add_overlay` — picture-in-picture, split-screen, green screen removal |
| L.5 | `add_text_animation` — kinetic typography, animated lower thirds, pop-up captions |
| L.6 | `add_particles` — confetti, sparkles, snow, rain, embers |
| L.7 | `add_motion_graphics` — animated charts, callouts, arrows, highlights |
| L.8 | `add_3d_effects` — parallax, depth-of-field, camera shake, dolly zoom |
| L.9 | `add_speed_ramp` — smooth slow-mo + speed-up (time-remapping) |
| L.10 | `add_reverse_clip` — rewind effect, then play forward |
| L.11 | `add_freeze_frame` — pause on important moment |
| L.12 | `add_picture_in_picture` — face cam + screen share simultaneously |
| L.13 | `add_split_screen` — 2 videos side by side, talking to each other |
| L.14 | `add_green_screen` — remove background, replace with image/video |
| L.15 | `add_blur_face` — anonymize faces for privacy |

### Audio effects
| # | Tool |
|---|---|
| L.16 | `normalize_audio` — loudness to -14 LUFS (YouTube standard) |
| L.17 | `remove_background_noise` — Krisp/noise-suppression |
| L.18 | `enhance_voice` — clarity, de-essing, EQ |
| L.19 | `add_reverb` — small room, hall, cathedral |
| L.20 | `add_compressor` — even out volume |
| L.21 | `add_eq` — bass boost, treble boost, vocal boost |
| L.22 | `voice_clone` — ElevenLabs integration for consistent voiceover |
| L.23 | `auto_duet` — separate voice from music, replace voice |
| L.24 | `add_dramatic_score` — Hans Zimmer-style music for key moments |
| L.25 | `add_chapter_jingle` — 2-sec audio sting at each chapter |

### Format conversions
| # | Tool |
|---|---|
| L.26 | `convert_vertical` — 16:9 → 9:16 (face-tracking crop) |
| L.27 | `convert_horizontal` — 9:16 → 16:9 (zoom-out, blur-fill) |
| L.28 | `convert_square` — → 1:1 |
| L.29 | `convert_gif` — make a GIF from any 5-sec clip |
| L.30 | `convert_thumbnail` — extract best frame as PNG thumbnail |
| L.31 | `convert_wallpaper` — extract vertical wallpaper version |
| L.32 | `convert_meme` — add Impact font + top/bottom text |
| L.33 | `convert_story` — 9:16, 15s, with stickers |
| L.34 | `convert_landscape_to_portrait_loop` — seamless loop for IG |

### Smart features
| # | Tool |
|---|---|
| L.35 | `auto_color_match` — match color of reference video |
| L.36 | `auto_pacing` — adjust cut frequency to target tempo |
| L.37 | `auto_zoom` — emphasis-based zoom (already exists) |
| L.38 | `auto_jump_cuts` — remove filler words automatically |
| L.39 | `auto_ducking` — duck music when voice present (item F.15) |
| L.40 | `auto_highlight` — find best moments (item C.1) |
| L.41 | `auto_chapters` — generate chapters (item D.1) |
| L.42 | `auto_captions` — generate captions (already exists) |
| L.43 | `auto_thumbnail` — pick best frame (item C.10) |
| L.44 | `auto_emoji` — add emoji on keywords (item F.17) |
| L.45 | `auto_b_roll` — insert b-roll at cut points (item F.5) |
| L.46 | `auto_music` — pick music by mood |
| L.47 | `auto_seo` — title/description/tags |
| L.48 | `auto_cross_post` — distribute everywhere |

### Editing operations
| # | Tool |
|---|---|
| L.49 | `trim` — cut from start/end |
| L.50 | `split` — split into multiple clips |
| L.51 | `merge` — concatenate multiple clips |
| L.52 | `crop` — change aspect ratio with face-tracking |
| L.53 | `resize` — change resolution (downscale 4K → 1080p) |
| L.54 | `rotate` — rotate 90/180/270, fix phone-orientation |
| L.55 | `mirror` — flip horizontally (for green screen) |
| L.56 | `stabilize` — video stabilization (gimbal-style) |
| L.57 | `denoise_video` — reduce video grain |
| L.58 | `interpolate_frames` — 30fps → 60fps (smooth slow-mo) |
| L.59 | `reverse` — play video backwards |
| L.60 | `loop` — make seamless loop (for IG) |
| L.61 | `overlay_logo` — add watermark/logo, configurable position |
| L.62 | `blur_regions` — blur specific areas (faces, plates, screens) |
| L.63 | `replace_audio` — replace audio track entirely |
| L.64 | `extract_audio` — save audio as MP3 |
| L.65 | `extract_subtitles` — save captions as SRT/VTT |
| L.66 | `mute_segment` — silence 0:30-0:45 |
| L.67 | `volume_segment` — adjust volume for 0:30-0:45 |
| L.68 | `change_speed` — 0.5x, 2x, with pitch correction |
| L.69 | `add_watermark` — animated watermark (moves around to avoid crop) |
| L.70 | `subtitle_export` — export captions in 5 formats (SRT, VTT, ASS, TTML, STL) |

**That's 70 tools in Section L alone.** Plus 90+ from sections A-K = 160+ tools total.

---

## Definition of Done — "Studio agent can do ANY video edit"

A streamer with a 4h Twitch VOD should be able to type ONE message:
> *"Make me: (1) a 10min 'best of' YouTube video with chapters and captions, (2) a 60s TikTok of the funniest moment, (3) a 90s IG Reel of the most hyped moment, (4) post all 3 to my YouTube + TikTok + IG tomorrow at 5pm. Use my style (dark color grading, MrBeast captions, lo-fi music)."*

Agent:
1. Transcribes 4h VOD (chunked) → 4h transcript
2. Detects hype moments (chat density) → 15 candidates
3. LLM picks 10 best → 10 highlight moments
4. LLM picks funniest → 1 funny moment
5. LLM picks most hyped → 1 hype moment
6. Multi-output: 10min YouTube + 60s TikTok + 90s IG Reel
7. Adds chapters to YouTube, captions all 3, lo-fi music ducked
8. Schedules 3 posts for tomorrow 5pm
9. User wakes up — 3 real posts live

**That's "ANY video edit".**

---

## Time estimate

This is BIG. Realistic: **16-20 weeks** for everything in this doc.
- Section A (upload) — 1 week
- Section B (transcription) — 1 week
- Section C (moments) — 2 weeks
- Section D (chapters) — 1 week
- Section E (multi-output) — 2 weeks
- Section F (effects) — 2 weeks
- Section G (smart LLM) — 1 week
- Section H (streamer) — 2 weeks
- Section I (Instagram) — 1 week
- Section J (YouTube) — 1 week
- Section K (cross-post) — 1 week
- Section L (70 "anything else" tools) — 4-6 weeks

But: a **minimum viable long-form** is just sections A + B + C + E + K = **~7 weeks**.
That gives: upload huge video → transcribe → find moments → create versions → post everywhere.
That's 90% of the value.

---

## Test count projection

| Section | Tests | Cumulative |
|---|---|---|
| Now | 1278 | 1278 |
| A (upload) | +30 | 1308 |
| B (transcription) | +40 | 1348 |
| C (moments) | +50 | 1398 |
| D (chapters) | +20 | 1418 |
| E (multi-output) | +80 | 1498 |
| F (effects) | +80 | 1578 |
| G (smart LLM) | +40 | 1618 |
| H (streamer) | +50 | 1668 |
| I (Instagram) | +40 | 1708 |
| J (YouTube) | +40 | 1748 |
| K (cross-post) | +40 | 1788 |
| L (70 tools) | +350 | 2138 |
| **At "any edit"** | **~2200** | |

---

## What I need from user

1. **`OPENAI_API_KEY`** — gates 90% of these features (transcription, moments, captions, SEO)
2. **Real video files** — I can write the code, but e2e needs a 2h video and a 4h VOD to verify
3. **Scope decision**:
   - **MVP (sections A+B+C+E+K, 7 weeks)** — minimum viable long-form
   - **All sections (16-20 weeks)** — "any edit" really
   - **Pick a section** — let's nail streamer (H) or YouTuber (J) first

I'm in `/c/Users/koval/OneDrive/случайный проект/vireo` (`main`, clean). The 4 long-form modules are on disk, unwired. We could start wiring them TODAY.

Скажи: MVP / Full / Section? И какой OPENAI_API_KEY (или "пропустим пока, напишу код на моках")?
