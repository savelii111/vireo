import { useEffect, useRef, useState, KeyboardEvent } from 'react';
import { Sparkles, Trash2, Settings as SettingsIcon, Paperclip, Mic, Send } from 'lucide-react';
import clsx from 'clsx';
import { useChat } from '../hooks/useChat';
import { useChatStream } from '../hooks/useChatStream';
import type { ChatMessage, ToolCall } from '../types';

const SUGGESTION_CHIPS = [
  'add a quick fade-in at the start of the intro',
  'make it more cinematic',
  'cut the silences',
  'try a different color preset',
  'add captions',
  'export to mp4',
];

export function ChatPanel() {
  const {
    messages, addUserMessage, startStreamingAssistant,
    appendChunk, addToolCall, finalizeAssistant,
  } = useChat();
  const { send, streaming } = useChatStream();
  const [input, setInput] = useState('');
  const streamRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (streamRef.current) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput('');

    addUserMessage(text);
    const assistantId = startStreamingAssistant();

    await send({
      content: text,
      onChunk: (delta) => appendChunk(assistantId, delta),
      onToolCall: (tc) => addToolCall(assistantId, tc),
      onComplete: (msg) => finalizeAssistant(assistantId, msg.content, msg.suggestions),
    });
  };

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <aside className="grid grid-rows-[44px_minmax(0,1fr)_auto] bg-bg-1 border-l border-border-1 min-w-0 min-h-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 border-b border-border-1">
        <div className="flex items-center gap-2 text-[12px] font-semibold">
          <Sparkles size={14} strokeWidth={1.6} className="text-accent" />
          <span>Vireo AI</span>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-ink-3">
          <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse-rec" />
          <span>Online · gemma4:31b</span>
        </div>
        <div className="flex gap-0.5">
          <button data-tip="Clear conversation" className="tip w-7 h-7 flex items-center justify-center rounded text-ink-3 hover:text-ink-1 hover:bg-bg-2 transition-all">
            <Trash2 size={14} strokeWidth={1.6} />
          </button>
          <button data-tip="Settings" className="tip w-7 h-7 flex items-center justify-center rounded text-ink-3 hover:text-ink-1 hover:bg-bg-2 transition-all">
            <SettingsIcon size={14} strokeWidth={1.6} />
          </button>
        </div>
      </div>

      {/* Stream */}
      <div ref={streamRef} className="overflow-y-auto p-4 flex flex-col gap-4">
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} onChipClick={(chip) => setInput(chip)} />
        ))}
      </div>

      {/* Composer */}
      <div className="border-t border-border-1 p-3 bg-bg-1">
        <div className="flex items-end gap-2 bg-bg-2 border border-border-2 rounded-lg p-2 pl-3 transition-all focus-within:border-accent focus-within:shadow-[0_0_0_3px_rgba(99,102,241,0.1)]">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Tell Vireo what to do — or click in the timeline…"
            rows={1}
            className="flex-1 bg-transparent border-none outline-none text-[13px] leading-snug resize-none min-h-[20px] max-h-[200px] py-1"
          />
          <div className="flex items-center gap-0.5">
            <button data-tip="Attach file" className="w-7 h-7 flex items-center justify-center rounded text-ink-3 hover:text-ink-1 hover:bg-bg-3 transition-all">
              <Paperclip size={14} strokeWidth={1.8} />
            </button>
            <button data-tip="Voice input" className="w-7 h-7 flex items-center justify-center rounded text-ink-3 hover:text-ink-1 hover:bg-bg-3 transition-all">
              <Mic size={14} strokeWidth={1.8} />
            </button>
            <button
              onClick={handleSend}
              disabled={!input.trim() || streaming}
              data-tip="Send (Enter)"
              className={clsx(
                'w-7 h-7 flex items-center justify-center rounded transition-all',
                input.trim() && !streaming
                  ? 'text-white bg-accent hover:bg-accent-h'
                  : 'text-ink-3 bg-bg-3 cursor-not-allowed',
              )}
            >
              <Send size={14} strokeWidth={1.8} />
            </button>
          </div>
        </div>
        <div className="flex justify-between mt-2 px-1 text-[10px] text-ink-3">
          <span>Click on a clip to focus it · Press <span className="font-mono bg-bg-2 border border-border-1 rounded px-1.5 py-0.5">⌘K</span> to split at playhead</span>
          <span><span className="font-mono bg-bg-2 border border-border-1 rounded px-1.5 py-0.5">⏎</span> send · <span className="font-mono bg-bg-2 border border-border-1 rounded px-1.5 py-0.5">⇧⏎</span> newline</span>
        </div>

        {/* Quick chips when input is empty */}
        {!input && messages.length > 0 && !streaming && (
          <div className="flex flex-wrap gap-1 mt-2">
            {SUGGESTION_CHIPS.slice(0, 3).map((s) => (
              <button
                key={s}
                onClick={() => setInput(s)}
                className="bg-bg-2 border border-border-1 rounded-full px-3 py-1 text-[11px] text-ink-2 hover:text-ink-1 hover:bg-bg-3 hover:border-border-2 transition-all"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

interface MessageBubbleProps {
  message: ChatMessage;
  onChipClick: (chip: string) => void;
}

const TOOL_ICONS: Record<string, string> = {
  cut_clips: '✂️',
  apply_speed_ramp: '⏱',
  apply_color_grade: '🎨',
  add_captions: '💬',
  mix_audio: '🎵',
  export_video: '📤',
  undo: '↩',
  redo: '↪',
};

function MessageBubble({ message, onChipClick }: MessageBubbleProps) {
  const isUser = message.role === 'user';

  return (
    <div className="flex flex-col gap-2 animate-msg-in">
      <div className="flex items-center gap-2 text-[11px] text-ink-3">
        <div
          className={clsx(
            'w-5 h-5 rounded flex items-center justify-center text-[9px] font-bold text-white',
            isUser
              ? 'bg-gradient-to-br from-[#f59e0b] to-[#ef4444]'
              : 'bg-gradient-to-br from-accent to-[#a855f7]',
          )}
        >
          {isUser ? 'A' : 'V'}
        </div>
        <div className="font-semibold text-ink-1">
          {isUser ? 'Anna K.' : 'Vireo'}
        </div>
        <div>{formatTime(message.created_at)}</div>
      </div>

      {message.content && !message.streaming && (
        <div
          className={clsx(
            'rounded-lg p-3 text-[13px] leading-relaxed break-words border',
            isUser
              ? 'bg-bg-3 border-border-1'
              : 'bg-bg-2 border-border-1',
          )}
        >
          <FormattedText text={message.content} />
        </div>
      )}

      {message.streaming && (
        <div className="bg-bg-2 border border-border-1 rounded-lg p-3 text-[13px] leading-relaxed break-words">
          {message.content ? (
            <FormattedText text={message.content} />
          ) : (
            <div className="flex gap-1.5 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-ink-3 animate-typing-dot" />
              <span className="w-1.5 h-1.5 rounded-full bg-ink-3 animate-typing-dot" style={{ animationDelay: '0.2s' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-ink-3 animate-typing-dot" style={{ animationDelay: '0.4s' }} />
            </div>
          )}
        </div>
      )}

      {message.tool_calls?.map((tc) => (
        <ToolCallBlock key={tc.id} tc={tc} />
      ))}

      {message.suggestions && message.suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1">
          {message.suggestions.map((s) => (
            <button
              key={s}
              onClick={() => onChipClick(s)}
              className="bg-bg-2 border border-border-1 rounded-full px-3 py-1 text-[11px] text-ink-2 hover:text-ink-1 hover:bg-bg-3 hover:border-border-2 transition-all"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ToolCallBlock({ tc }: { tc: ToolCall }) {
  const argsPreview = Object.entries(tc.args)
    .map(([k, v]) => `${k}=${JSON.stringify(v).slice(0, 30)}`)
    .join(' · ');

  return (
    <div className="bg-bg-1 border border-border-1 border-l-2 border-l-accent rounded-md p-2 px-3 font-mono text-[11px] text-ink-2 flex flex-col gap-0.5">
      <div className="flex items-center gap-2 text-ink-1 font-semibold">
        <span>{TOOL_ICONS[tc.name] ?? '⚙'}</span>
        <span className="text-accent">{tc.name}</span>
        <ToolCallStatusBadge status={tc.status} />
      </div>
      {argsPreview && (
        <div className="text-ink-3 text-[10px] mt-0.5 truncate">{argsPreview}</div>
      )}
    </div>
  );
}

function ToolCallStatusBadge({ status }: { status: ToolCall['status'] }) {
  const map = {
    pending: { label: 'pending', cls: 'bg-bg-3 text-ink-2' },
    running: { label: 'running…', cls: 'bg-accent/10 text-accent' },
    done:    { label: 'done',     cls: 'bg-success/15 text-success' },
    error:   { label: 'error',    cls: 'bg-danger/15 text-danger' },
  } as const;
  const { label, cls } = map[status];
  return (
    <span className={clsx('ml-auto text-[10px] px-2 py-0.5 rounded font-sans font-medium', cls)}>
      {label}
    </span>
  );
}

function FormattedText({ text }: { text: string }) {
  // Render `code` and **bold** inline
  const parts: React.ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(text))) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[1]) {
      parts.push(
        <code key={key++} className="bg-bg-1 border border-border-1 rounded px-1 py-0.5 text-[12px] text-ink-1 font-mono">
          {match[1].slice(1, -1)}
        </code>
      );
    } else if (match[2]) {
      parts.push(<strong key={key++} className="font-semibold">{match[2].slice(2, -2)}</strong>);
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

function formatTime(t: number): string {
  const d = new Date(t);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}
