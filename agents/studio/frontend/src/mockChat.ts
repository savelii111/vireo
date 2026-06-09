// mockChat — produces a realistic assistant response with tool calls.
// Used when backend is offline. Streams delta chunks character-by-character
// for that "AI is typing" feel.

import type { ToolCall } from './types';

type MockOpts = {
  onChunk?: (delta: string, full: string) => void;
  onToolCall?: (tc: ToolCall) => void;
  onComplete?: (msg: { id: string; role: 'assistant'; content: string; created_at: number; tool_calls?: ToolCall[]; suggestions?: string[] }) => void;
  signal: AbortSignal;
};

const RESPONSES: { match: RegExp; reply: string; tools?: { name: string; args: Record<string, unknown> }[]; suggestions?: string[] }[] = [
  {
    match: /split|cut/i,
    reply: 'Got it — splitting at the mark. I\'ll use the razor tool at the playhead and keep both halves as separate clips so you can re-time them independently.',
    tools: [
      { name: 'cut_clips', args: { cuts: [23.0] } },
    ],
    suggestions: ['also fade between them', 'make first half longer', 'remove the second half'],
  },
  {
    match: /slow.?mo|slow.?motion|speed|0\.5/i,
    reply: 'Adding a 0.5× speed ramp with optical flow to the second half. Cinematic grade (warm +0.08, contrast +15) for cohesion.',
    tools: [
      { name: 'apply_speed_ramp', args: { preset: [1.0, 0.5], optical_flow: true } },
      { name: 'apply_color_grade', args: { preset: 'cinematic', intensity: 0.7 } },
    ],
    suggestions: ['undo', 'make it slower', 'add a flash transition'],
  },
  {
    match: /caption|text|subtitle/i,
    reply: 'Adding word-level TikTok-style captions. Want me to also bump the voice volume by 20% so the captions stay readable over the music?',
    tools: [
      { name: 'add_captions', args: { style: 'tiktok-bold', word_level: true } },
    ],
    suggestions: ['yes, do it', 'skip for now', 'try a different style'],
  },
  {
    match: /color|grade|warm|cool|cinematic/i,
    reply: 'Applying the color grade. I\'ll use the LUT and blend it at intensity 0.7 so it doesn\'t feel overdone.',
    tools: [
      { name: 'apply_color_grade', args: { preset: 'cinematic', intensity: 0.7 } },
    ],
    suggestions: ['show before/after', 'try a different preset', 'make it stronger'],
  },
  {
    match: /music|song|audio|sound|track/i,
    reply: 'I\'ll mix the new track in. Bumping the existing music down to 0.4 so the new layer sits on top. Adding a sidechain duck to keep voice clear.',
    tools: [
      { name: 'mix_audio', args: { music_volume: 0.4, voice_volume: 1.0, duck_preset: 'soft' } },
    ],
    suggestions: ['try a different song', 'lower it more', 'add reverb'],
  },
  {
    match: /export|render|mp4|download/i,
    reply: 'Starting render. Defaulting to 1080p H.264 — about 90 seconds for a 2-minute clip. I\'ll ping you when it\'s ready.',
    tools: [
      { name: 'export_video', args: { format: 'mp4', resolution: '1080p' } },
    ],
    suggestions: ['4K please', 'also export captions as SRT', 'use H.265'],
  },
  {
    match: /undo/i,
    reply: 'Undoing the last action.',
    tools: [
      { name: 'undo', args: {} },
    ],
  },
  {
    match: /red{2,}|do( that)? again|redo/i,
    reply: 'Re-applying the last action.',
    tools: [
      { name: 'redo', args: {} },
    ],
  },
];

const FALLBACK: typeof RESPONSES[number] = {
  match: /.*/,
  reply: 'I can help with that. Could you tell me which clip you\'re working on? You can click it in the timeline, or just say "the drone shot" / "intro" / "the music".',
  suggestions: ['show me my clips', 'what can you do?', 'open the inspector'],
};

export async function mockAssistantResponse(
  userMessage: string,
  opts: MockOpts,
): Promise<void> {
  const lower = userMessage.toLowerCase();
  const match = RESPONSES.find((r) => r.match.test(lower)) ?? FALLBACK;

  // Stream reply text character by character
  let full = '';
  for (const ch of match.reply) {
    if (opts.signal.aborted) return;
    await sleep(12 + Math.random() * 18);
    full += ch;
    opts.onChunk?.(ch, full);
  }

  // Fire tool calls after a beat
  const toolCalls: ToolCall[] = [];
  for (const tool of match.tools ?? []) {
    if (opts.signal.aborted) return;
    await sleep(400);
    const tc: ToolCall = {
      id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: tool.name,
      args: tool.args,
      status: 'running',
      started_at: Date.now(),
    };
    toolCalls.push(tc);
    opts.onToolCall?.(tc);
    // Complete after some time
    await sleep(800 + Math.random() * 1400);
    if (opts.signal.aborted) return;
    tc.status = 'done';
    tc.completed_at = Date.now();
    opts.onToolCall?.(tc);
  }

  // Finalize
  await sleep(200);
  opts.onComplete?.({
    id: `m-${Date.now()}`,
    role: 'assistant',
    content: full,
    created_at: Date.now(),
    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    suggestions: match.suggestions,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
