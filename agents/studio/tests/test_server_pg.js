// Integration test: Studio server booted with a Postgres-compatible mock pool.
//
// Verifies that the studio can run end-to-end against a real pg.Pool-shaped
// object (not the in-memory stores), so when DATABASE_URL is wired up in
// docker-compose the same code path works. Run via:
//
//   cd agents/studio
//   node --test tests/test_server_pg.js
//
// We import the storage mock from test_chat_store.js (extended to also handle
// vireo_message_feedback, vireo_welcome_answers, vireo_style_dna, and the
// rewind subquery DELETE).

import { test } from "node:test";
import assert from "node:assert/strict";
import { signToken } from "../../../packages/auth-middleware/index.js";
import { buildServer } from "../src/server.js";
import { makeMockPool } from "../../storage/tests/test_chat_store_helpers.js";

function listen(server) {
  return new Promise((res) => {
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      res({ port, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

const mockLLM = {
  model: "m",
  isMock: () => true,
  costUsd: () => 0,
  chat: async () => ({ content: "Mock reply from PG-backed studio.", tool_calls: null, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }),
  getUsage: () => ({}),
};

function get(port, path, token) {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: "GET",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  }).then(async (r) => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
}

function post(port, path, body, token) {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
}

function patch(port, path, body, token) {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
}

async function getToken(secret) {
  return signToken({ sub: "u-pg-test", email: "pg@x", name: "PG" }, secret, 600);
}

test("PG: chat → message persists in vireo_messages", async () => {
  const pool = makeMockPool();
  const { server } = buildServer({ secret: "s", llm: mockLLM, pool });
  const { port, close } = await listen(server);
  const tok = await getToken("s");
  const r = await post(port, "/api/chat", { message: "hello pg" }, tok);
  assert.equal(r.ok, true);
  // Inspect pool: should have at least 1 user + 1 assistant row
  const msgs = pool.tables.vireo_messages || new Map();
  const userMsgs = [...msgs.values()].filter((m) => m.user_id === "u-pg-test" && m.role === "user");
  const asstMsgs = [...msgs.values()].filter((m) => m.user_id === "u-pg-test" && m.role === "assistant");
  assert.equal(userMsgs.length, 1);
  assert.equal(userMsgs[0].content, "hello pg");
  assert.equal(asstMsgs.length, 1);
  await close();
});

test("PG: project create persists in vireo_projects", async () => {
  const pool = makeMockPool();
  const { server } = buildServer({ secret: "s", llm: mockLLM, pool });
  const { port, close } = await listen(server);
  const tok = await getToken("s");
  const r = await post(port, "/api/projects", { name: "PG Test", niche: "tech" }, tok);
  assert.equal(r.ok, true);
  const rows = [...(pool.tables.vireo_projects || new Map()).values()];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "PG Test");
  assert.equal(rows[0].user_id, "u-pg-test");
  await close();
});

test("PG: feedback summary aggregated from vireo_message_feedback", async () => {
  const pool = makeMockPool();
  const { server } = buildServer({ secret: "s", llm: mockLLM, pool });
  const { port, close } = await listen(server);
  const tok = await getToken("s");
  const r1 = await post(port, "/api/chat", { message: "hi" }, tok);
  const list = await get(port, `/api/conversations/${r1.conversation_id}`, tok);
  const aMsg = list.messages.find((m) => m.role === "assistant");
  await post(port, `/api/messages/${aMsg.id}/feedback`, { rating: 1 }, tok);
  await post(port, `/api/messages/${aMsg.id}/feedback`, { rating: -1 }, tok);
  const sum = await get(port, "/api/feedback/summary", tok);
  assert.equal(sum.ok, true);
  assert.equal(sum.summary.total, 2);
  assert.equal(sum.summary.upvotes, 1);
  assert.equal(sum.summary.downvotes, 1);
  // Verify it actually lives in the pool
  const fbRows = [...(pool.tables.vireo_message_feedback || new Map()).values()];
  assert.equal(fbRows.length, 2);
  await close();
});

test("PG: welcome upsert persists in vireo_welcome_answers", async () => {
  const pool = makeMockPool();
  const { server } = buildServer({ secret: "s", llm: mockLLM, pool });
  const { port, close } = await listen(server);
  const tok = await getToken("s");
  const r = await post(port, "/api/welcome", { niche: "indie hackers", platforms: ["twitter", "linkedin"] }, tok);
  assert.equal(r.ok, true);
  const rows = [...(pool.tables.vireo_welcome_answers || new Map()).values()];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].niche, "indie hackers");
  assert.deepEqual(rows[0].platforms, ["twitter", "linkedin"]);
  // Upsert on second call — should still be 1 row
  const r2 = await post(port, "/api/welcome", { niche: "indie hackers v2", platforms: ["twitter"] }, tok);
  assert.equal(r2.ok, true);
  const rows2 = [...(pool.tables.vireo_welcome_answers || new Map()).values()];
  assert.equal(rows2.length, 1, "upsert should not create a second row");
  assert.equal(rows2[0].niche, "indie hackers v2");
  await close();
});

test("PG: rewind deletes messages after to_message_id and keeps earlier ones", async () => {
  const pool = makeMockPool();
  const { server } = buildServer({ secret: "s", llm: mockLLM, pool });
  const { port, close } = await listen(server);
  const tok = await getToken("s");
  const r1 = await post(port, "/api/chat", { message: "first" }, tok);
  // Sleep so the second turn's user/assistant messages get later timestamps
  // than the first turn's (ISO timestamps have 1ms granularity).
  await new Promise((r) => setTimeout(r, 5));
  const r2 = await post(port, "/api/chat", { message: "second", conversation_id: r1.conversation_id }, tok);
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  const before = await get(port, `/api/conversations/${r1.conversation_id}`, tok);
  assert.equal(before.messages.length, 4, `should have 4 msgs, got ${before.messages.length}`);
  const firstUserMsg = before.messages.find((m) => m.role === "user");
  const rewindR = await post(port, `/api/conversations/${r1.conversation_id}/rewind`, { to_message_id: firstUserMsg.id }, tok);
  assert.equal(rewindR.ok, true);
  assert.equal(rewindR.deleted, 3);
  const after = await get(port, `/api/conversations/${r1.conversation_id}`, tok);
  assert.equal(after.messages.length, 1);
  assert.equal(after.messages[0].id, firstUserMsg.id);
  await close();
});

test("PG: edit message updates content via UPDATE", async () => {
  const pool = makeMockPool();
  const { server } = buildServer({ secret: "s", llm: mockLLM, pool });
  const { port, close } = await listen(server);
  const tok = await getToken("s");
  const r1 = await post(port, "/api/chat", { message: "original" }, tok);
  const list = await get(port, `/api/conversations/${r1.conversation_id}`, tok);
  const userMsg = list.messages.find((m) => m.role === "user");
  const editR = await patch(port, `/api/messages/${userMsg.id}`, { content: "edited" }, tok);
  assert.equal(editR.ok, true);
  const after = await get(port, `/api/conversations/${r1.conversation_id}`, tok);
  const afterMsg = after.messages.find((m) => m.id === userMsg.id);
  assert.equal(afterMsg.content, "edited");
  await close();
});

test("PG: a second server instance sees the data from the first (real PG would too)", async () => {
  // The mock is in-memory, so this also tests that the wiring doesn't rely
  // on per-instance state — the same pool object is the source of truth.
  const pool = makeMockPool();
  const { server: s1 } = buildServer({ secret: "s", llm: mockLLM, pool });
  const { port: p1, close: c1 } = await listen(s1);
  const tok = await getToken("s");
  await post(p1, "/api/chat", { message: "persisted" }, tok);

  // Build a second server, same pool
  const { server: s2 } = buildServer({ secret: "s", llm: mockLLM, pool });
  const { port: p2, close: c2 } = await listen(s2);
  const list = await get(p2, "/api/conversations", tok);
  assert.equal(list.ok, true);
  assert.ok(list.conversations.length >= 1, `expected ≥1 conv, got ${list.conversations.length}`);

  await c1();
  await c2();
});
