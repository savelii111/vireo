// routes/chat.js — Chat pipeline handlers (2026-06-08).
//
// The chat handler is the most complex part of the Studio. By
// moving it out of server.js we reduce server.js from ~3000
// lines to ~2500 and make the chat pipeline independently
// maintainable.
//
// This file exports `createChatHandlers(ctx)` which returns
// { handleChat, handleChatStream } — the two functions that
// server.js calls from the if-chain dispatch.
//
// The shape matches what was in server.js: each handler takes
// (req, res, body) and either returns the JSON response or
// writes the SSE stream.

import { runChatTurn } from "./run_chat_turn.js";

export function createChatHandlers(ctx) {
  return {
    handleChat: handleChat.bind(null, ctx),
    handleChatStream: handleChatStream.bind(null, ctx),
  };
}

async function handleChat(ctx, req, res, body, shared) {
  // ... (placeholder — full impl still in server.js)
}

async function handleChatStream(ctx, req, res, body, shared) {
  // ... (placeholder)
}
