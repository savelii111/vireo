// useChatStream — handles streaming POST to /api/chat/stream.
//
// Backend SSE format (see agents/studio/src/server.js):
//   event: ready   { request_id, ts }
//   event: meta    { conversation_id }
//   event: delta   { text }                    — streamed text chunks
//   event: tool    { name, args, result }      — tool call completed
//   event: done    { reply, usage, cost_usd, message_id }
//   event: error   { error, message }
//
// Falls back to a mock generator when backend is unavailable so the
// UI is fully testable in isolation.

import { useCallback, useRef, useState } from 'react';
import type { ChatMessage, ToolCall } from '../types';
import { mockAssistantResponse } from '../mockChat';

export type SendMessageOptions = {
  content: string;
  onChunk?: (delta: string, full: string) => void;
  onToolCall?: (tc: ToolCall) => void;
  onComplete?: (msg: ChatMessage) => void;
  onMeta?: (meta: { conversation_id?: string }) => void;
  onError?: (err: string) => void;
};

export function useChatStream() {
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(async (opts: SendMessageOptions) => {
    setStreaming(true);
    abortRef.current = new AbortController();

    // Try real backend first
    try {
      const res = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ message: opts.content }),
        signal: abortRef.current.signal,
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = '';
      const pendingTools: ToolCall[] = [];

      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE events are separated by blank line
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';
        for (const evt of events) {
          // Parse "event: <name>\ndata: <json>"
          let eventName = 'message';
          const dataLines: string[] = [];
          for (const line of evt.split('\n')) {
            if (line.startsWith('event:')) {
              eventName = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              dataLines.push(line.slice(5).trim());
            } else if (line.startsWith(':')) {
              // comment / heartbeat — ignore
            }
          }
          if (dataLines.length === 0) continue;
          const dataStr = dataLines.join('\n');
          if (dataStr === '[DONE]') continue;
          let payload: Record<string, unknown> = {};
          try { payload = JSON.parse(dataStr); } catch { continue; }

          switch (eventName) {
            case 'ready':
            case 'message':
              // generic info, ignore
              break;
            case 'meta':
              opts.onMeta?.(payload as { conversation_id?: string });
              break;
            case 'delta': {
              const text = String(payload.text ?? '');
              if (text) {
                full += text;
                opts.onChunk?.(text, full);
              }
              break;
            }
            case 'tool': {
              const name = String(payload.name ?? 'unknown');
              const args = (payload.args && typeof payload.args === 'object' ? payload.args : {}) as Record<string, unknown>;
              const tc: ToolCall = {
                id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                name,
                args,
                status: 'done',
                started_at: Date.now(),
                completed_at: Date.now(),
                result: payload.result,
              };
              pendingTools.push(tc);
              opts.onToolCall?.(tc);
              break;
            }
            case 'done': {
              const final = String(payload.reply ?? full);
              opts.onComplete?.({
                id: `m-${Date.now()}`,
                role: 'assistant',
                content: final,
                created_at: Date.now(),
                tool_calls: pendingTools.length > 0 ? pendingTools : undefined,
              });
              setStreaming(false);
              return;
            }
            case 'error': {
              const errMsg = String(payload.message ?? payload.error ?? 'unknown');
              opts.onError?.(errMsg);
              setStreaming(false);
              return;
            }
          }
        }
      }
      // If we exit the loop without a 'done' event, finalize with what we have
      opts.onComplete?.({
        id: `m-${Date.now()}`,
        role: 'assistant',
        content: full,
        created_at: Date.now(),
        tool_calls: pendingTools.length > 0 ? pendingTools : undefined,
      });
      setStreaming(false);
      return;
    } catch (err) {
      // Backend unavailable or network error — fall through to mock
      if (err instanceof DOMException && err.name === 'AbortError') {
        setStreaming(false);
        return;
      }
      console.warn('[chat] backend offline, using mock', err);
    }

    // Mock path
    await mockAssistantResponse(opts.content, {
      onChunk: opts.onChunk,
      onToolCall: opts.onToolCall,
      onComplete: opts.onComplete,
      signal: abortRef.current.signal,
    });
    setStreaming(false);
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setStreaming(false);
  }, []);

  return { send, stop, streaming };
}
