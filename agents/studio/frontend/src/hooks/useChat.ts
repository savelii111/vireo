import { useState, useCallback, useRef } from 'react';
import type { ChatMessage, ToolCall } from '../types';
import { initialMessages } from '../mockData';

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const streamingIdRef = useRef<string | null>(null);

  const addUserMessage = useCallback((content: string) => {
    const msg: ChatMessage = {
      id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role: 'user',
      content,
      created_at: Date.now(),
    };
    setMessages((prev) => [...prev, msg]);
    return msg.id;
  }, []);

  const startStreamingAssistant = useCallback(() => {
    const id = `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    streamingIdRef.current = id;
    setMessages((prev) => [
      ...prev,
      { id, role: 'assistant', content: '', created_at: Date.now(), streaming: true, tool_calls: [] },
    ]);
    return id;
  }, []);

  const appendChunk = useCallback((msgId: string, delta: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === msgId ? { ...m, content: m.content + delta } : m)),
    );
  }, []);

  const addToolCall = useCallback((msgId: string, tc: ToolCall) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== msgId) return m;
        const existing = m.tool_calls ?? [];
        const idx = existing.findIndex((t) => t.id === tc.id);
        if (idx >= 0) {
          const updated = [...existing];
          updated[idx] = tc;
          return { ...m, tool_calls: updated };
        }
        return { ...m, tool_calls: [...existing, tc] };
      }),
    );
  }, []);

  const finalizeAssistant = useCallback((msgId: string, full: string, suggestions?: string[]) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId
          ? { ...m, content: full, streaming: false, suggestions }
          : m,
      ),
    );
    streamingIdRef.current = null;
  }, []);

  return {
    messages,
    addUserMessage,
    startStreamingAssistant,
    appendChunk,
    addToolCall,
    finalizeAssistant,
  };
}
