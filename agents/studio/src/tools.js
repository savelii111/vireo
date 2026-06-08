// Vireo Studio — NL video editing tool-use for the Studio chat LLM.
//
// Phase 5.4: the chat endpoint (src/server.js) already has an LLM call path.
// This module gives the LLM *tools* it can call to perform real video operations
// (transcribe, cut, reframe, captions, music, montage, etc.) against the
// separate video agent service.
//
// Exports:
//   EDIT_TOOLS            — array of OpenAI tool-use definitions
//   SYSTEM_PROMPT         — system prompt injecting the tool list
//   parseToolCalls(msg)   — parse LLM response into [{ name, args }]
//   executeToolCall(c, c) — execute a single tool call against the video agent
//   buildEditToolContext  — build the context object passed to tool calls
//
// Wire shape: OpenAI tool-use / function-calling. The video agent exposes
// REST endpoints (POST /transcribe, POST /edit, POST /edit/async, GET /files, …)
// that we call with fetch() + AbortController-based timeout.

const DEFAULT_VIDEO_URL = process.env.VIREO_VIDEO_URL || "http://video:8004";
const DEFAULT_TIMEOUT_MS = 30_000;

// ---------- Tool definitions (OpenAI tool-use / function-calling format) ----------

export const EDIT_TOOLS = [
  {
    type: "function",
    function: {
      name: "transcribe_video",
      description:
        "Transcribe the speech in a video file using Whisper. Returns the transcript text and timed segments (start, end, text, words). Use this first when the user asks for captions, editing by words, or any text-based video operation.",
      parameters: {
        type: "object",
        required: ["file_id"],
        properties: {
          file_id: { type: "string", description: "The video file id (from list_files or upload)." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cut_clips",
      description:
        "Cut out one or more time ranges from a video and concatenate the rest (or just the kept ranges, depending on mode). Use after transcribe_video when the user wants to keep only specific segments.",
      parameters: {
        type: "object",
        required: ["file_id", "ranges"],
        properties: {
          file_id: { type: "string", description: "The video file id to cut." },
          ranges: {
            type: "array",
            description: "Array of [start_sec, end_sec] pairs to keep (or remove, see mode).",
            items: {
              type: "array",
              items: { type: "number" },
              minItems: 2,
              maxItems: 2,
            },
          },
          mode: {
            type: "string",
            enum: ["keep", "remove"],
            description: "'keep' keeps only the listed ranges (default), 'remove' deletes them.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remove_silence",
      description:
        "Auto-detect and remove silent gaps in a video. Useful for tightening talking-head footage or podcasts.",
      parameters: {
        type: "object",
        required: ["file_id"],
        properties: {
          file_id: { type: "string", description: "The video file id." },
          min_silence_ms: {
            type: "number",
            description: "Minimum silence length in milliseconds to cut (default 700).",
            default: 700,
          },
          padding_ms: {
            type: "number",
            description: "Padding to keep around speech (default 80ms).",
            default: 80,
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reframe_for_platform",
      description:
        "Crop / reframe a video to a target platform's aspect ratio. 'tiktok', 'shorts', 'reels' = 9:16 vertical; 'youtube' = 16:9 horizontal. Uses subject-tracking to keep the speaker in frame for vertical crops.",
      parameters: {
        type: "object",
        required: ["file_id", "platform"],
        properties: {
          file_id: { type: "string", description: "The video file id." },
          platform: {
            type: "string",
            enum: ["tiktok", "shorts", "reels", "youtube"],
            description: "Target platform — drives aspect ratio (9:16 or 16:9).",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_zoom",
      description:
        "Add a punch-in / zoom effect on specific words (typically emphasis words) in the transcript. Requires the file to have been transcribed (words[] come from transcribe_video).",
      parameters: {
        type: "object",
        required: ["file_id", "words"],
        properties: {
          file_id: { type: "string", description: "The video file id." },
          words: {
            type: "array",
            description: "List of words to zoom on (case-insensitive, e.g. ['amazing', 'free']).",
            items: { type: "string" },
          },
          intensity: {
            type: "number",
            description: "Zoom strength 1.0–2.5 (1.0 = no zoom, default 1.4).",
            default: 1.4,
            minimum: 1.0,
            maximum: 2.5,
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_captions",
      description:
        "Auto-generate and burn word-level captions onto the video. Uses the existing transcript if present; otherwise transcribes first. Choose a visual style.",
      parameters: {
        type: "object",
        required: ["file_id"],
        properties: {
          file_id: { type: "string", description: "The video file id." },
          style: {
            type: "string",
            description:
              "Caption style preset — e.g. 'tiktok-bold', 'mrbeast-yellow', 'minimal-white', 'karaoke'. Default 'tiktok-bold'.",
            default: "tiktok-bold",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_music",
      description:
        "Add royalty-free background music from the library, ducking under speech. 'mood' picks a track: 'upbeat', 'chill', 'cinematic', 'energetic', 'sad', 'lofi'.",
      parameters: {
        type: "object",
        required: ["file_id"],
        properties: {
          file_id: { type: "string", description: "The video file id." },
          mood: {
            type: "string",
            description: "Music mood / genre preset.",
            default: "upbeat",
          },
          volume: {
            type: "number",
            description: "Music volume relative to speech 0.0–1.0 (default 0.2).",
            default: 0.2,
            minimum: 0,
            maximum: 1,
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "make_montage",
      description:
        "AI-driven auto-montage: pick the best moments from a long video and condense it to roughly target_duration_sec. Returns a job_id; use get_job to poll.",
      parameters: {
        type: "object",
        required: ["file_id", "target_duration_sec"],
        properties: {
          file_id: { type: "string", description: "The long-form video file id." },
          target_duration_sec: {
            type: "number",
            description: "Desired output duration in seconds (e.g. 30, 60, 90).",
            minimum: 5,
            maximum: 600,
          },
          style: {
            type: "string",
            enum: ["hype", "podcast", "vlog", "podcast-cuts"],
            description: "Montage style preset (default 'hype').",
            default: "hype",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_video_info",
      description:
        "Get basic metadata about a video file: duration (sec), resolution (W×H), fps, codec, has_audio.",
      parameters: {
        type: "object",
        required: ["file_id"],
        properties: {
          file_id: { type: "string", description: "The video file id." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_files",
      description:
        "List uploaded and processed video files. Use when the user asks 'what files do I have' or 'show me my videos'.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max files to return (default 20)." },
        },
      },
    },
  },
  // ---------- W2: Long-form tools ----------
  {
    type: "function",
    function: {
      name: "find_best_moments",
      description:
        "Extract the best moments from a video. Use when the user wants to create a highlight reel, find viral clips, extract key moments from a long video (e.g. 'find 5 best moments from this 2h video'). Requires a file_path of a previously transcribed video.",
      parameters: {
        type: "object",
        required: ["file_path"],
        properties: {
          file_path: { type: "string", description: "Path to the video file (from get_video_info or list_files)." },
          platform: { type: "string", description: "Target platform: 'tiktok', 'youtube', 'instagram_reels', 'default' (default: 'tiktok')." },
          max_moments: { type: "integer", description: "Max moments to return (default 3, max 10)." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_chapters",
      description:
        "Auto-generate YouTube chapters from a video's transcript. Use when the user wants chapters, a table of contents, or 'add chapters to this video'.",
      parameters: {
        type: "object",
        required: ["file_path"],
        properties: {
          file_path: { type: "string", description: "Path to the video file." },
          max_chapters: { type: "integer", description: "Max chapters to generate (default 15)." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_broll",
      description:
        "Automatically insert B-roll footage at natural cut points (silence boundaries, topic transitions). Use when the user wants visual variety, B-roll, or 'make it more visually interesting'.",
      parameters: {
        type: "object",
        required: ["file_path"],
        properties: {
          file_path: { type: "string", description: "Path to the video file." },
          style: { type: "string", description: "B-roll style: 'cityscape', 'nature', 'tech', 'abstract', 'food', 'fitness', 'auto' (default: 'auto')." },
          count: { type: "integer", description: "Number of B-roll clips to insert (default 5)." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "apply_hook_style",
      description:
        "Restructure the first 3 seconds of a video for maximum engagement (hook). Use when the user wants a stronger hook, 'make the intro more engaging', or 'fix my opening'.",
      parameters: {
        type: "object",
        required: ["file_path"],
        properties: {
          file_path: { type: "string", description: "Path to the video file." },
          style: { type: "string", description: "Hook style: 'question', 'bold_statement', 'visual_tease', 'auto' (default: 'auto')." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_thumbnail",
      description:
        "Generate a thumbnail from the best expressive frame of a video. Use when the user wants a thumbnail, cover image, or 'what's a good thumbnail for this'.",
      parameters: {
        type: "object",
        required: ["file_path"],
        properties: {
          file_path: { type: "string", description: "Path to the video file." },
          style: { type: "string", description: "Thumbnail style: 'mrbeast', 'minimal', 'bold_text', 'auto' (default: 'auto')." },
          title: { type: "string", description: "Optional text overlay for the thumbnail." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "analyze_audio",
      description:
        "Analyze audio properties: loudness (LUFS), peak, silence ratio, music detection. Use when the user wants to know 'how's the audio', 'is it too loud/quiet', or 'can you detect the music'.",
      parameters: {
        type: "object",
        required: ["file_path"],
        properties: {
          file_path: { type: "string", description: "Path to the video file." },
        },
      },
    },
  },

  // ---------- W3: Multi-output & transcript tools ----------
  {
    type: "function",
    function: {
      name: "create_versions",
      description:
        "Create multiple platform-optimized versions from one source video. Use when the user wants 'a TikTok + IG Reel + YouTube from this' or 'make versions for all platforms'. Transcribes, finds best moments per platform, clips, adds captions.",
      parameters: {
        type: "object",
        required: ["file_path", "platforms"],
        properties: {
          file_path: { type: "string", description: "Path to the source video." },
          platforms: {
            type: "array",
            items: { type: "string", enum: ["tiktok", "youtube_shorts", "youtube", "instagram_reels", "instagram_feed"] },
            description: "Target platforms. Each gets a version with platform-native style (aspect ratio, duration, captions).",
          },
          styles: { type: "object", description: "Optional per-platform style overrides, e.g. {\"tiktok\": {\"caption_style\": \"bold\", \"music_mood\": \"upbeat\"}}." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_short_from_long",
      description:
        "Create a short clip (15-60s) from a long video by auto-picking the best moment. Use when the user wants 'make a short from this', 'find a clip', or 'make a TikTok from this long video'.",
      parameters: {
        type: "object",
        required: ["file_path"],
        properties: {
          file_path: { type: "string", description: "Path to the source video." },
          target_duration: { type: "integer", description: "Target duration in seconds (default 60, max 180)." },
          platform: { type: "string", description: "Target platform for style (default: 'tiktok')." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_compilation",
      description:
        "Create a 'best of' compilation from multiple moments in a long video. Use when the user wants 'best of' or 'highlight reel' or 'compilation of the funniest parts'.",
      parameters: {
        type: "object",
        required: ["file_path"],
        properties: {
          file_path: { type: "string", description: "Path to the source video." },
          target_duration: { type: "integer", description: "Target total duration in seconds (default 600 = 10 min)." },
          max_moments: { type: "integer", description: "Max moments to include (default 10)." },
          platform: { type: "string", description: "Target platform (default: 'youtube')." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_summary",
      description:
        "Create a short summary video from a long source. Use when the user wants 'summarize this video', 'give me the TL;DR', or 'make a 3-minute summary of this 1-hour video'.",
      parameters: {
        type: "object",
        required: ["file_path"],
        properties: {
          file_path: { type: "string", description: "Path to the source video." },
          target_duration: { type: "integer", description: "Target duration in seconds (default 180 = 3 min)." },
          platform: { type: "string", description: "Target platform (default: 'youtube')." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_trailer",
      description:
        "Create a 15-30s trailer/teaser from a long video. Use when the user wants 'make a trailer', 'teaser', or '30-second preview of this'.",
      parameters: {
        type: "object",
        required: ["file_path"],
        properties: {
          file_path: { type: "string", description: "Path to the source video." },
          target_duration: { type: "integer", description: "Target duration in seconds (default 30)." },
          platform: { type: "string", description: "Target platform (default: 'tiktok')." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_transcript",
      description:
        "Search a video's transcript for specific text, topics, or quotes. Use when the user asks 'find all times I said X', 'where did I mention Y', or 'show me the transcript around Z'.",
      parameters: {
        type: "object",
        required: ["file_path", "query"],
        properties: {
          file_path: { type: "string", description: "Path to the video file." },
          query: { type: "string", description: "Search query (text to find in transcript)." },
          context_seconds: { type: "integer", description: "Seconds of context around each match (default 30)." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_transcript_section",
      description:
        "Get a transcript section with timestamps. Use when the user wants 'show me the transcript from 0:23:00 to 0:25:30' or 'what did I say at 15:00'.",
      parameters: {
        type: "object",
        required: ["file_path", "start_sec", "end_sec"],
        properties: {
          file_path: { type: "string", description: "Path to the video file." },
          start_sec: { type: "number", description: "Start time in seconds." },
          end_sec: { type: "number", description: "End time in seconds." },
          format: { type: "string", description: "Output format: 'text', 'srt', 'vtt' (default: 'text')." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_job_status",
      description:
        "Check the status of a video processing job. Use when the user asks 'how's my edit going', 'is my video done', or 'what's the status of job X'.",
      parameters: {
        type: "object",
        required: ["job_id"],
        properties: {
          job_id: { type: "string", description: "The job ID returned from a previous edit operation." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_job",
      description:
        "Cancel a running video processing job. Use when the user wants to stop a processing job ('cancel my edit', 'stop the video processing').",
      parameters: {
        type: "object",
        required: ["job_id"],
        properties: {
          job_id: { type: "string", description: "The job ID to cancel." },
        },
      },
    },
  },

  // ---------- Studio in-process tools (P0 #9) ----------
  // These talk to the studio's own Postgres/in-memory stores via buildToolDeps()
  // in server.js, not to the separate video agent. Listed here so the LLM sees
  // them in EDIT_TOOLS, dispatched in executeToolCall() via ctx.deps[name].
  {
    type: "function",
    function: {
      name: "list_projects",
      description:
        "List the user's content projects. Use when the user asks 'what projects do I have' or 'show me my projects'. Returns up to `limit` projects (default 20).",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "integer", description: "Max projects to return (default 20)." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_project",
      description:
        "Create a new content project (think of it as a playlist or content pillar). Use when the user says 'create a project' or wants to start a new content series.",
      parameters: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", description: "Project name." },
          niche: { type: "string", description: "Content niche/topic (e.g. 'tech', 'fitness')." },
          description: { type: "string", description: "Project description." },
          target_platforms: {
            type: "array",
            items: { type: "string" },
            description: "Platforms to publish to (e.g. ['youtube', 'tiktok']). Defaults to ['youtube'].",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_content",
      description:
        "Save a content piece (script, idea, transcript) to a project. Use when the user shares text and wants it saved.",
      parameters: {
        type: "object",
        required: ["text"],
        properties: {
          project_id: { type: "string", description: "Project to save into (optional)." },
          text: { type: "string", description: "The text to save." },
          kind: { type: "string", description: "Piece type: 'script' (default), 'idea', 'transcript', 'note'." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_content",
      description:
        "List the user's saved content pieces, optionally filtered by project. Use when the user asks 'show me my drafts' or 'what have I saved'.",
      parameters: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "Filter by project (optional)." },
          limit: { type: "integer", description: "Max pieces to return (default 20)." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_style_dna",
      description:
        "Get the user's current Style DNA (tone, pacing, vocabulary, hooks, CTAs). Use before any edit_content or cut_clips call so the output matches the user's voice.",
      parameters: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "Prefer DNA linked to this project (optional)." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "analyze_style",
      description:
        "Analyze the user's saved content and persist a new (or merged) Style DNA. Requires at least 2 saved pieces. Use when the user says 'analyze my style' or 'build my DNA'.",
      parameters: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "Scope the analysis to a project (optional)." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_content",
      description:
        "Cut / re-shape a piece of text into a platform-ready short (script edit plan). Returns an edit plan with hook / body / cta segments. Use after get_style_dna so the cut matches the user's voice.",
      parameters: {
        type: "object",
        required: ["text"],
        properties: {
          text: { type: "string", description: "Source text to cut." },
          target_sec: { type: "integer", description: "Target output duration in seconds (default 30)." },
          project_id: { type: "string", description: "Project context (prefers its Style DNA)." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "distribute",
      description:
        "Distribute a piece of content (or an edit plan) to one or more platforms. Use after edit_content when the user wants to publish.",
      parameters: {
        type: "object",
        required: ["edit_plan"],
        properties: {
          edit_plan: { type: "object", description: "The edit plan from edit_content." },
          style_dna: { type: "object", description: "Style DNA to attach (optional — auto-fetched if omitted)." },
          project_id: { type: "string", description: "Project context (optional)." },
          platforms: {
            type: "array",
            items: { type: "string" },
            description: "Target platforms (e.g. ['youtube', 'tiktok']).",
          },
        },
      },
    },
  },
];

// Tools that are implemented in buildToolDeps() inside server.js — they
// operate on the studio's own stores, NOT the video agent. The dispatcher
// in executeToolCall() checks this set FIRST and routes them in-process.
export const STUDIO_INPROCESS_TOOL_NAMES = new Set([
  "list_projects",
  "create_project",
  "save_content",
  "list_content",
  "get_style_dna",
  "analyze_style",
  "edit_content",
  "distribute",
  // W2: long-form orchestrators
  "find_best_moments",
  "generate_chapters",
  "add_broll",
  "apply_hook_style",
  "generate_thumbnail",
  "analyze_audio",
  // W3: multi-output + transcript + job
  "create_versions",
  "create_short_from_long",
  "create_compilation",
  "create_summary",
  "create_trailer",
  "search_transcript",
  "get_transcript_section",
  "get_job_status",
  "cancel_job",
]);

// Vision + generation tools (2026-06-08). Dispatched in-process.
// Handlers are imported lazily to keep module load fast.
import { VISION_GENERATION_TOOL_NAMES } from "./vision_generation_tools.js";
export const TIER1_TOOL_NAMES = new Set([
  "apply_color_grade",
  "apply_speed_ramp",
  "mix_audio",
  "compose_multi_clip",
  "add_text_overlay",
]);

// Lazy import of the actual handler functions. We hold them in a
// TIER1_HANDLERS map keyed by tool name. Populated on first dispatch
// (see _ensureTier1Handlers).
let _tier1Handlers = null;
async function _ensureTier1Handlers() {
  if (_tier1Handlers) return _tier1Handlers;
  const tier1 = await import("./edit_tools_tier1.js");
  _tier1Handlers = {
    apply_color_grade: tier1.applyColorGrade,
    apply_speed_ramp: tier1.applySpeedRamp,
    mix_audio: tier1.mixAudio,
    compose_multi_clip: tier1.composeMultiClip,
    add_text_overlay: tier1.addTextOverlay,
  };
  return _tier1Handlers;
}

// Vision + generation handlers (lazy)
let _visionHandlers = null;
async function _ensureVisionHandlers() {
  if (_visionHandlers) return _visionHandlers;
  const vg = await import("./vision_generation_tools.js");
  _visionHandlers = {
    describe_frame: vg.describeFrame,
    detect_objects: vg.detectObjects,
    detect_scenes: vg.detectScenes,
    extract_dominant_colors: vg.extractDominantColors,
    generate_image: vg.generateImage,
    generate_video: vg.generateVideo,
    inpaint_frame: vg.inpaintFrame,
  };
  return _visionHandlers;
}

// ---------- System prompt ----------

// Build a compact summary of the available tools for the system prompt.
function _toolSummary() {
  return EDIT_TOOLS.map((t) => {
    const f = t.function;
    const props = Object.keys(f.parameters?.properties || {});
    return `- ${f.name}(${props.join(", ") || ""}) — ${f.description.split(".")[0]}.`;
  }).join("\n");
}

export const SYSTEM_PROMPT = `You are Vireo Studio, an AI video editor. You help users edit videos through natural language by calling video editing tools.

# Your tools
${_toolSummary()}

# Rules
1. ALWAYS use a tool when the user asks for a video operation. Never describe what you would do — actually call the tool.
2. Before editing a file, you usually need a file_id. If the user says "my video" or "this clip" without an id, call \`list_files\` first and pick the most recent matching one. If nothing matches, ask the user which file they mean.
3. For text-based operations (captions, zoom on words, transcript editing), call \`transcribe_video\` first to get the transcript.
4. Long jobs (\`make_montage\`) return a job_id. Tell the user the job is processing and that they can check progress.
5. After a successful edit, tell the user what was done and the new output_file_id (or job_id for async).
6. Respond in the same language the user wrote in. Detect from the message.
7. REFUSE any request that is illegal, non-consensual, NSFW, harassing, defamatory, or that targets a real person for harm. Politely decline and offer a safe alternative.
8. If a tool returns \`{ ok: false, error: "..." }\`, surface the error plainly to the user and suggest a fix (e.g. "the file_id looks wrong — did you mean abc123?"). Do not retry blindly more than once.
9. Keep replies short and actionable. You are a tool, not a chatbot.

# Style
- Plain text, no markdown headers, no code blocks unless showing a tool result.
- One or two sentences of acknowledgement, then the action, then the result.`;

// ---------- parseToolCalls ----------

/**
 * Parse an LLM response message into an array of tool calls.
 *
 * Accepts the OpenAI Chat Completions shape:
 *   message.tool_calls = [
 *     { id, type: "function", function: { name, arguments } },
 *     ...
 *   ]
 *
 * `arguments` may be a JSON string (per OpenAI spec) or already an object.
 * Returns: [{ name, args, id? }, ...] — empty array if no tool calls.
 */
export function parseToolCalls(message) {
  if (!message || typeof message !== "object") return [];
  const calls = message.tool_calls;
  if (!Array.isArray(calls) || calls.length === 0) return [];

  const out = [];
  for (const c of calls) {
    if (!c || typeof c !== "object") continue;
    // OpenAI shape: c.function = { name, arguments }
    // Be lenient about casing: some clients send "function", others nest differently.
    const fn = c.function || c;
    const name = fn?.name;
    if (typeof name !== "string" || name.length === 0) continue;

    let args = fn?.arguments;
    if (typeof args === "string") {
      try {
        args = JSON.parse(args);
      } catch {
        // Leave as the raw string; executeToolCall will see a string and fail clearly.
        args = { __raw_string_args: args };
      }
    } else if (args == null) {
      args = {};
    } else if (typeof args !== "object") {
      args = { value: args };
    }

    const entry = { name, args };
    if (typeof c.id === "string") entry.id = c.id;
    out.push(entry);
  }
  return out;
}

// ---------- buildEditToolContext ----------

/**
 * Build the context object passed to executeToolCall. Centralises
 * URL, timeout, fetch, and ids so tests can inject everything.
 */
export function buildEditToolContext({
  userId,
  projectId,
  conversationId,
  baseUrl,
  timeoutMs,
  fetchImpl,
  fetchOptions,
} = {}) {
  return {
    userId: userId || null,
    projectId: projectId || null,
    conversationId: conversationId || null,
    baseUrl: baseUrl || process.env.VIREO_VIDEO_URL || DEFAULT_VIDEO_URL,
    timeoutMs: typeof timeoutMs === "number" && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS,
    fetchImpl: typeof fetchImpl === "function" ? fetchImpl : globalThis.fetch,
    fetchOptions: fetchOptions || {},
  };
}

// ---------- executeToolCall ----------

/**
 * Map each tool name to an HTTP request against the video agent.
 *
 * **P0-1 fix (2026-06-07)**: Studio now sends flat EditRequest fields, not a
 * nested {file_id, operation, params} wrapper. The video agent's
 * `_build_edit_request` (agents/video/vireo_video/server.py:157) does:
 *   1. camelCase → snake_case translation
 *   2. Filter to known EditRequest fields only
 *   3. Strips `file_id`, `operation`, `params` (not in EditRequest dataclass)
 * Old wrapper schema → `missing_source_path` 400 on every call.
 *
 * Each case here maps an LLM-natural-language tool call to the correct flat
 * EditRequest fields. P0-2 (zoom windows) and P0-3 (list_files shape) are
 * tracked separately in the audit doc.
 *
 * Returns: { method, path, body? } or null if the tool is unknown.
 *
 * **Exported for unit testing** — test_schema_send_flat_edit_request_fields
 * in tests/test_tools.js verifies each case sends the right shape.
 */
export function _routeForTool(name, args) {
  const sourcePath = (args && (args.file_id || args.file_path)) || "";
  switch (name) {
    case "transcribe_video":
      // /transcribe expects { file_path: "..." }, not file_id
      return { method: "POST", path: "/transcribe", body: { file_path: sourcePath } };

    case "cut_clips":
      // ranges: [[start_sec, end_sec], ...] → custom_moments [{start, end}, ...]
      // P1: when ranges provided, skip auto-selection (max_moments = len(ranges))
      return {
        method: "POST",
        path: "/edit",
        body: {
          source_path: sourcePath,
          max_moments: Array.isArray(args.ranges) ? args.ranges.length : 1,
          custom_moments: Array.isArray(args.ranges)
            ? args.ranges.map(([s, e]) => ({ start: s, end: e }))
            : undefined,
          multi_clip: Array.isArray(args.ranges) && args.ranges.length > 1,
        },
      };

    case "remove_silence":
      // min_silence_ms / padding_ms are not EditRequest fields — enable_silence_removal
      // is the only knob. The pipeline uses its own defaults (configurable in code).
      return {
        method: "POST",
        path: "/edit",
        body: { source_path: sourcePath, enable_silence_removal: true },
      };

    case "reframe_for_platform":
      return {
        method: "POST",
        path: "/edit",
        body: {
          source_path: sourcePath,
          target_platform: args.platform || "tiktok",
        },
      };

    case "add_zoom":
      // P0-2: apply_zoom() in the pipeline needs a `windows` arg (EmphasisWindow[]).
      // Until the pipeline derives that from the transcript, this tool will crash
      // mid-run with TypeError. We set enable_zoom=true and let the pipeline fail
      // non-fatally (the other effects survive).
      return {
        method: "POST",
        path: "/edit",
        body: { source_path: sourcePath, enable_zoom: true },
      };

    case "add_captions":
      return {
        method: "POST",
        path: "/edit",
        body: {
          source_path: sourcePath,
          target_platform: args.platform || "tiktok",
          subtitle_style: args.style || "tiktok-bold",
          word_burn: true,
        },
      };

    case "add_music":
      // Week 1 Day 1 fix (2026-06-07): add_music is now a real edit step,
      // not a no-op. The pipeline reads enable_music + music_mood +
      // music_track_path and calls music.add_background_music() with
      // auto-ducking. If no track is available, the step is a non-fatal
      // skip — the edit still completes, just without music.
      return {
        method: "POST",
        path: "/edit",
        body: {
          source_path: sourcePath,
          enable_music: true,
          music_mood: args.mood || "neutral",
          music_track_path: args.track_path || "",
          music_volume: typeof args.volume === "number" ? args.volume : 0.15,
        },
      };

    case "make_montage":
      // target_duration_sec isn't a direct EditRequest field. Closest equivalent:
      // max_moments + custom_moments (selection algorithm picks moments summing
      // to ~target_duration_sec / max_moments). For now, we let the selection
      // algorithm do its thing.
      return {
        method: "POST",
        path: "/edit/async",
        body: {
          source_path: sourcePath,
          max_moments: args.max_moments ?? 3,
          target_platform: args.platform || "tiktok",
        },
      };

    case "get_video_info":
      return {
        method: "GET",
        path: `/files/${encodeURIComponent(sourcePath)}`,
        body: null,
      };

    case "list_files":
      // P0-3: video agent returns {uploads: [...], outputs: [...]} but Studio's
      // LLM expects {files: [{file_id, name, size, ...}]}. Until the response
      // shape is normalized, the LLM can't resolve "my last video" references.
      return { method: "GET", path: "/files", body: null };

    default:
      return null;
  }
}

/**
 * Execute a single tool call against the video agent.
 *
 * call = { name, args, id? }
 * ctx  = buildEditToolContext(...)
 *
 * Returns: { ok: true, result } | { ok: false, error }
 *
 * Never throws — all errors are caught and returned as { ok: false, error }.
 */
/**
 * Execute a single tool call against the video agent, or — if the tool is
 * a studio-internal one (create_project, save_content, etc.) — against the
 * studio's own stores via ctx.deps.
 *
 * Returns: { ok: true, result } | { ok: false, error }
 *
 * Never throws — all errors are caught and returned as { ok: false, error }.
 */
export async function executeToolCall(call, ctx) {
  if (!call || typeof call !== "object") {
    return { ok: false, error: "invalid_call: expected { name, args } object" };
  }
  const { name } = call;
  if (typeof name !== "string" || name.length === 0) {
    return { ok: false, error: "invalid_call: missing tool name" };
  }

  // P0 #9: studio in-process tools (projects, content, style, distribute)
  // are implemented in buildToolDeps() inside server.js. They operate on
  // the studio's own Postgres / in-memory stores — not the video agent.
  // Routing them through HTTP would force a self-call loop and require
  // auth-header plumbing we already have here. The dispatcher therefore
  // checks STUDIO_INPROCESS_TOOL_NAMES first and, if a matching function
  // is exposed on ctx.deps, invokes it directly.
  //
  // The handler signature in buildToolDeps is ({ userId, ...args }) — it
  // doesn't know the LLM's arg shape, so we inject userId from the request
  // context and pass the LLM's args as-is.
  if (STUDIO_INPROCESS_TOOL_NAMES.has(name)) {
    if (!ctx?.deps || typeof ctx.deps[name] !== "function") {
      return {
        ok: false,
        error: `inprocess_tool_unavailable: ${name} (buildToolDeps did not expose this handler)`,
      };
    }
    try {
      const args = (call.args && typeof call.args === "object") ? call.args : {};
      const result = await ctx.deps[name]({ ...args, userId: ctx.userId });
      // buildToolDeps handlers already return { ok, ... }; pass through as-is
      // so the assistant sees the same shape the HTTP routes do.
      if (result && typeof result === "object" && "ok" in result) return result;
      return { ok: true, result };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }

  // Tier 1 edit tools (2026-06-08) — color grading, speed ramping,
  // audio mixing, multi-clip compose, text overlays. These are
  // in-process: they return a job_id synchronously and the actual
  // FFmpeg work is enqueued to a worker (or, in dev, runs inline).
  // We dispatch via ctx.deps first (so tests can inject fakes),
  // then fall back to the module-level handlers imported from
  // edit_tools_tier1.js.
  if (TIER1_TOOL_NAMES.has(name)) {
    const args = (call.args && typeof call.args === "object") ? call.args : {};
    try {
      if (ctx?.deps && typeof ctx.deps[name] === "function") {
        return await ctx.deps[name]({ ...args, userId: ctx.userId });
      }
      // Fall back to the module-level handler.
      const handlers = await _ensureTier1Handlers();
      const handler = handlers[name];
      if (typeof handler !== "function") {
        return { ok: false, error: `tier1_handler_missing: ${name}` };
      }
      return await handler(args);
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }

  // Vision + generation tools (2026-06-08) — describe_frame,
  // detect_objects, detect_scenes, extract_dominant_colors,
  // generate_image, generate_video, inpaint_frame. Same in-process
  // dispatch pattern as Tier 1.
  if (VISION_GENERATION_TOOL_NAMES.has(name)) {
    const args = (call.args && typeof call.args === "object") ? call.args : {};
    try {
      if (ctx?.deps && typeof ctx.deps[name] === "function") {
        return await ctx.deps[name]({ ...args, userId: ctx.userId });
      }
      const handlers = await _ensureVisionHandlers();
      const handler = handlers[name];
      if (typeof handler !== "function") {
        return { ok: false, error: `vision_handler_missing: ${name}` };
      }
      return await handler(args);
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }

  const route = _routeForTool(name, call.args || {});
  if (!route) {
    return { ok: false, error: `unknown_tool: ${name}` };
  }

  const context = buildEditToolContext(ctx || {});
  const url = `${context.baseUrl.replace(/\/+$/, "")}${route.path}`;
  const f = context.fetchImpl;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), context.timeoutMs);
  // Don't let the timer keep the process alive on its own.
  if (typeof timer.unref === "function") timer.unref();

  const init = {
    method: route.method,
    headers: { Accept: "application/json", ...(context.fetchOptions.headers || {}) },
    signal: ctrl.signal,
    ...context.fetchOptions,
  };
  if (route.body !== null && route.body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(route.body);
  }

  try {
    const res = await f(url, init);
    if (!res || typeof res.status !== "number") {
      return { ok: false, error: "invalid_response: fetch returned no response" };
    }
    let payload = null;
    const ctype = res.headers?.get?.("content-type") || "";
    if (ctype.includes("application/json")) {
      try {
        payload = await res.json();
      } catch {
        payload = null;
      }
    } else if (typeof res.text === "function") {
      try {
        payload = await res.text();
      } catch {
        payload = null;
      }
    }
    if (!res.ok) {
      const errMsg =
        (payload && typeof payload === "object" && (payload.error || payload.message)) ||
        (typeof payload === "string" && payload) ||
        `http_${res.status}`;
      return { ok: false, error: String(errMsg).slice(0, 1000), status: res.status, payload };
    }
    return { ok: true, result: payload, status: res.status };
  } catch (e) {
    const msg = e?.message || String(e);
    if (e?.name === "AbortError" || /aborted/i.test(msg)) {
      return { ok: false, error: `timeout: ${name} did not respond within ${context.timeoutMs}ms` };
    }
    return { ok: false, error: msg.slice(0, 1000) };
  } finally {
    clearTimeout(timer);
  }
}
