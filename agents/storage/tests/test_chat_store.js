// Tests for the new chat_store (ProjectStore, ContentPieceStorePg, ConversationStore, MessageStore).
// Uses a mock pg pool — no real Postgres needed.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ProjectStore,
  ContentPieceStorePg,
  ConversationStore,
  MessageStore,
} from "../src/chat_store.js";

function makeMockPool() {
  const tables = {};
  // Monotonic sequence counter for vireo_messages — mirrors the
  // vireo_messages_seq_seq DB sequence. Reset per-pool, which matches
  // the per-test-pool lifecycle in the test suite.
  let messageSeq = 0;
  function table(name) {
    if (!tables[name]) tables[name] = new Map();
    return tables[name];
  }
  return {
    tables,
    async query(sql, params = []) {
      // Normalize whitespace so regexes below match across line breaks.
      const trimmed = sql.replace(/\s+/g, " ").trim();
      // INSERT INTO table (cols) VALUES (...)
      let m = trimmed.match(/^INSERT INTO (\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);
      if (m) {
        const tname = m[1];
        const cols = m[2].split(",").map((c) => c.trim().split(/\s+AS\s+/i)[0].trim());
        const placeholders = m[3].split(",").map((p) => p.trim());
        const row = {};
        cols.forEach((c, i) => {
          let v = params[i];
          // parse JSONB columns (try to detect by leading char of stringified value)
          if (typeof v === "string" && (v.startsWith("[") || v.startsWith("{"))) {
            try { v = JSON.parse(v); } catch {}
          }
          row[c] = v;
        });
        // Apply defaults that real Postgres would
        if (!row.created_at) row.created_at = new Date().toISOString();
        if (!row.updated_at) row.updated_at = row.created_at;
        // Auto-assign seq for vireo_messages — matches the
        // DEFAULT nextval('vireo_messages_seq_seq') in migration 008.
        if (tname === "vireo_messages" && row.seq == null) {
          row.seq = ++messageSeq;
        }
        table(tname).set(row.id, row);
        return { rows: [row], rowCount: 1 };
      }
      // SELECT * FROM table WHERE ...
      // Capture ORDER BY clause (any column) so we can honor the
      // `seq ASC` ordering that production uses, and so we stop sorting
      // by created_at (which is unreliable when rows tie on the same ms).
      m = trimmed.match(/^SELECT \* FROM (\w+)(?:\s+WHERE\s+(.+?))?(?:\s+ORDER BY (\w+)(?:\s+(ASC|DESC))?)?(?:\s+LIMIT \$(\d+))?$/i);
      if (m) {
        const tname = m[1];
        const where = m[2];
        const orderCol = m[3] || null;
        const orderDir = (m[4] || "ASC").toUpperCase();
        const limitIdx = m[5] ? Number(m[5]) - 1 : null;
        const limit = limitIdx != null ? Number(params[limitIdx]) : 1000;
        let rows = [...table(tname).values()];
        if (where) {
          // Parse simple "col = $1 AND col2 = $2" conditions
          const conds = where.split(/\s+AND\s+/i);
          for (const c of conds) {
            const cm = c.match(/(\w+)\s*=\s*\$(\d+)/);
            if (cm) {
              const col = cm[1];
              const idx = Number(cm[2]) - 1;
              const val = params[idx];
              rows = rows.filter((r) => r[col] === val);
            }
          }
        }
        // JSONB decode
        rows = rows.map((r) => {
          const o = { ...r };
          for (const k of Object.keys(o)) {
            if (typeof o[k] === "string" && (o[k].startsWith("[") || o[k].startsWith("{"))) {
              try { o[k] = JSON.parse(o[k]); } catch {}
            }
          }
          return o;
        });
        // Sort by the requested ORDER BY column. Default to seq ASC if a
        // row has it (vireo_messages), otherwise created_at/updated_at.
        if (orderCol) {
          rows.sort((a, b) => {
            const av = a[orderCol], bv = b[orderCol];
            if (av == null && bv == null) return 0;
            if (av == null) return 1;
            if (bv == null) return -1;
            const cmp = typeof av === "number" && typeof bv === "number"
              ? av - bv
              : String(av).localeCompare(String(bv));
            return orderDir === "DESC" ? -cmp : cmp;
          });
        } else if (rows.length > 0 && "seq" in rows[0]) {
          rows.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
        } else {
          const sortCol = rows.length > 0 && "created_at" in rows[0] ? "created_at" : "updated_at";
          rows.sort((a, b) => String(b[sortCol] || "").localeCompare(String(a[sortCol] || "")));
        }
        if (rows.length > limit) rows = rows.slice(0, limit);
        return { rows, rowCount: rows.length };
      }
      // UPDATE table SET ... WHERE id = $1 AND user_id = $N
      m = trimmed.match(/^UPDATE (\w+) SET (.+?) WHERE id = \$1(?: AND user_id = \$(\d+))?/i);
      if (m) {
        const tname = m[1];
        const sets = m[2];
        const userIdIdx = m[3] ? Number(m[3]) - 1 : null;
        const userId = userIdIdx != null ? params[userIdIdx] : null;
        const row = table(tname).get(params[0]);
        if (!row) return { rows: [], rowCount: 0 };
        if (userId && row.user_id !== userId) return { rows: [], rowCount: 0 };
        // Parse "col = $N" pairs
        const pairs = sets.split(/,(?![^()]*\))/).map((p) => p.trim());
        for (const p of pairs) {
          const sm = p.match(/(\w+)\s*=\s*(?:\$([0-9]+)|now\(\))/i);
          if (!sm) continue;
          if (sm[2]) {
            let v = params[Number(sm[2]) - 1];
            if (typeof v === "string" && (v.startsWith("[") || v.startsWith("{"))) {
              try { v = JSON.parse(v); } catch {}
            }
            row[sm[1]] = v;
          } else {
            row[sm[1]] = new Date().toISOString();
          }
        }
        return { rows: [row], rowCount: 1 };
      }
      // DELETE FROM table WHERE id = $1 AND user_id = $2
      m = trimmed.match(/^DELETE FROM (\w+) WHERE id = \$1 AND user_id = \$2/i);
      if (m) {
        const tname = m[1];
        const row = table(tname).get(params[0]);
        if (!row || row.user_id !== params[1]) return { rowCount: 0 };
        table(tname).delete(params[0]);
        return { rowCount: 1 };
      }
      // DELETE FROM vireo_messages WHERE id = ANY($1::uuid[]) AND conversation_id = $2 AND user_id = $3
      // Legacy form (pre-008): used by the old list-then-delete-after
      // implementation. Kept here so the test_chat_store tests that
      // exercise that code path still pass.
      m = trimmed.match(/^DELETE FROM vireo_messages WHERE id = ANY\(\$1::uuid\[\]\) AND conversation_id = \$2 AND user_id = \$3/i);
      if (m) {
        const ids = (params[0] || []).map(String);
        const cid = params[1];
        const uid = params[2];
        let n = 0;
        for (const [id, r] of table("vireo_messages").entries()) {
          if (ids.includes(String(r.id)) && r.conversation_id === cid && r.user_id === uid) {
            table("vireo_messages").delete(id);
            n++;
          }
        }
        return { rowCount: n };
      }
      // DELETE FROM vireo_messages WHERE conversation_id = $1 AND user_id = $2
      //   AND seq > (SELECT seq FROM vireo_messages WHERE id = $3 AND user_id = $2)
      // Production rewind/edit-resend (008_message_seq). Single round-trip,
      // deterministic even when user+assistant share a millisecond.
      m = trimmed.match(/^DELETE FROM vireo_messages WHERE conversation_id = \$1 AND user_id = \$2 AND seq > \(SELECT seq FROM vireo_messages WHERE id = \$3 AND user_id = \$2\)/i);
      if (m) {
        const cid = params[0];
        const uid = params[1];
        const anchorId = params[2];
        const anchor = table("vireo_messages").get(anchorId);
        if (!anchor || anchor.user_id !== uid) return { rowCount: 0 };
        const anchorSeq = anchor.seq;
        let n = 0;
        for (const [id, r] of table("vireo_messages").entries()) {
          if (r.conversation_id === cid && r.user_id === uid && r.seq > anchorSeq) {
            table("vireo_messages").delete(id);
            n++;
          }
        }
        return { rowCount: n };
      }
      // DELETE FROM table WHERE conversation_id = $1 AND user_id = $2
      m = trimmed.match(/^DELETE FROM (\w+) WHERE conversation_id = \$1 AND user_id = \$2/i);
      if (m) {
        const tname = m[1];
        let n = 0;
        for (const [id, r] of table(tname).entries()) {
          if (r.conversation_id === params[0] && r.user_id === params[1]) {
            table(tname).delete(id);
            n++;
          }
        }
        return { rowCount: n };
      }
      // UPDATE vireo_messages SET content = $3 WHERE id = $1 AND user_id = $2 AND role = 'user'
      m = trimmed.match(/^UPDATE vireo_messages SET content = \$3 WHERE id = \$1 AND user_id = \$2 AND role = 'user'/i);
      if (m) {
        const row = table("vireo_messages").get(params[0]);
        if (!row || row.user_id !== params[1] || row.role !== "user") return { rowCount: 0 };
        row.content = params[2];
        return { rowCount: 1 };
      }
      // INSERT INTO ... ON CONFLICT (...) DO UPDATE SET ... RETURNING *
      // Used by WelcomeAnswersStore.upsert and PostgresStyleDNAStore.upsert.
      m = trimmed.match(/^INSERT INTO (\w+)\s*\(([^)]+)\)\s*VALUES\s*(\([^)]*\)|[^)]+)\s*ON CONFLICT \(([^)]+)\) DO UPDATE SET (.+?)\s*RETURNING \*$/i);
      if (m) {
        const tname = m[1];
        const cols = m[2].split(",").map((c) => c.trim());
        const placeholders = m[3].split(",").map((p) => p.trim());
        const conflictCols = m[4].split(",").map((c) => c.trim());
        const sets = m[5].split(/,(?![^()]*\))/).map((s) => s.trim());
        const row = {};
        cols.forEach((c, i) => {
          let v = params[i];
          if (typeof v === "string" && (v.startsWith("[") || v.startsWith("{"))) {
            try { v = JSON.parse(v); } catch {}
          }
          row[c] = v;
        });
        if (!row.created_at) row.created_at = new Date().toISOString();
        if (!row.updated_at) row.updated_at = row.created_at;
        // Find existing row by conflict cols
        const t = table(tname);
        let existing = null;
        for (const r of t.values()) {
          if (conflictCols.every((cc) => r[cc] === row[cc])) { existing = r; break; }
        }
        if (existing) {
          // Apply SET assignments
          for (const s of sets) {
            const sm = s.match(/^(\w+)\s*=\s*(?:EXCLUDED\.(\w+)|\$(\d+)|now\(\))/i);
            if (!sm) continue;
            if (sm[1] === "updated_at") { existing.updated_at = new Date().toISOString(); }
            else if (sm[2]) { existing[sm[1]] = row[sm[2]]; }
            else if (sm[3]) {
              let v = params[Number(sm[3]) - 1];
              if (typeof v === "string" && (v.startsWith("[") || v.startsWith("{"))) {
                try { v = JSON.parse(v); } catch {}
              }
              existing[sm[1]] = v;
            }
          }
          // Decode JSONB
          const o = { ...existing };
          for (const k of Object.keys(o)) {
            if (typeof o[k] === "string" && (o[k].startsWith("[") || o[k].startsWith("{"))) {
              try { o[k] = JSON.parse(o[k]); } catch {}
            }
          }
          return { rows: [o], rowCount: 1 };
        }
        t.set(row.id, row);
        return { rows: [row], rowCount: 1 };
      }
      // SELECT COUNT(*)::int AS c, SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END)::int AS upvotes,
      //        SUM(CASE WHEN rating = -1 THEN 1 ELSE 0 END)::int AS downvotes
      //   FROM vireo_message_feedback WHERE user_id = $1
      m = trimmed.match(/^SELECT\s+COUNT\(\*\)\s*::int\s+AS\s+\w+\s*,\s*SUM\(CASE WHEN rating = 1 THEN 1 ELSE 0 END\)::int AS \w+\s*,\s*SUM\(CASE WHEN rating = -1 THEN 1 ELSE 0 END\)::int AS \w+\s+FROM (\w+) WHERE (\w+) = \$1$/i);
      if (m) {
        const tname = m[1];
        const col = m[2];
        const rows = [...table(tname).values()].filter((r) => r[col] === params[0]);
        const upvotes = rows.filter((r) => r.rating === 1).length;
        const downvotes = rows.filter((r) => r.rating === -1).length;
        return { rows: [{ total: rows.length, upvotes, downvotes }], rowCount: 1 };
      }
      throw new Error("mock pool: unsupported query: " + sql);
    },
  };
}

// ---- ProjectStore ----

test("ProjectStore: create, list, get, update, delete", async () => {
  const pool = makeMockPool();
  const store = new ProjectStore(pool);
  const p = await store.create({ userId: "u1", name: "Test", niche: "tech" });
  assert.equal(p.user_id, "u1");
  assert.equal(p.name, "Test");
  assert.deepEqual(p.target_platforms, ["youtube"]);

  const fetched = await store.get(p.id);
  assert.equal(fetched.id, p.id);

  const list = await store.listForUser("u1");
  assert.equal(list.length, 1);

  const updated = await store.update(p.id, { userId: "u1", name: "Renamed" });
  assert.equal(updated.name, "Renamed");

  const del = await store.delete(p.id, "u1");
  assert.equal(del, true);
  const after = await store.get(p.id);
  assert.equal(after, null);
});

test("ProjectStore: listForUser filters by user", async () => {
  const pool = makeMockPool();
  const store = new ProjectStore(pool);
  await store.create({ userId: "u1", name: "A" });
  await store.create({ userId: "u2", name: "B" });
  const l1 = await store.listForUser("u1");
  const l2 = await store.listForUser("u2");
  assert.equal(l1.length, 1);
  assert.equal(l1[0].name, "A");
  assert.equal(l2[0].name, "B");
});

// ---- ContentPieceStorePg ----

test("ContentPieceStorePg: add and list", async () => {
  const pool = makeMockPool();
  const store = new ContentPieceStorePg(pool);
  await store.add({ userId: "u1", projectId: "p1", text: "Hello" });
  await store.add({ userId: "u1", projectId: "p1", text: "World" });
  await store.add({ userId: "u1", projectId: "p2", text: "Other" });
  const list1 = await store.listForUser("u1", { projectId: "p1" });
  assert.equal(list1.length, 2);
  const list2 = await store.listForUser("u1");
  assert.equal(list2.length, 3);
});

test("ContentPieceStorePg: bySource", async () => {
  const pool = makeMockPool();
  const store = new ContentPieceStorePg(pool);
  await store.add({ userId: "u1", source: "manual", sourceId: "x1", text: "a" });
  await store.add({ userId: "u1", source: "chat", sourceId: "x1", text: "b" });
  const r = await store.bySource("u1", "chat", "x1");
  assert.equal(r.length, 1);
  assert.equal(r[0].text, "b");
});

// ---- ConversationStore + MessageStore ----

test("ConversationStore: create and touch", async () => {
  const pool = makeMockPool();
  const store = new ConversationStore(pool);
  const c = await store.create({ userId: "u1", title: "Chat 1" });
  assert.equal(c.user_id, "u1");
  assert.equal(c.title, "Chat 1");
  await store.touch(c.id);
  const got = await store.get(c.id);
  assert.ok(got.updated_at);
});

test("MessageStore: add, list, deleteForConversation", async () => {
  const pool = makeMockPool();
  const convStore = new ConversationStore(pool);
  const msgStore = new MessageStore(pool);
  const c = await convStore.create({ userId: "u1" });
  await msgStore.add({ conversationId: c.id, userId: "u1", role: "user", content: "hi" });
  await new Promise((r) => setTimeout(r, 5));
  await msgStore.add({ conversationId: c.id, userId: "u1", role: "assistant", content: "hello" });
  const list = await msgStore.listForConversation(c.id);
  assert.equal(list.length, 2);
  assert.equal(list[0].role, "user");
  assert.equal(list[1].role, "assistant");
  const deleted = await msgStore.deleteForConversation(c.id, "u1");
  assert.equal(deleted, 2);
  const after = await msgStore.listForConversation(c.id);
  assert.equal(after.length, 0);
});

test("MessageStore: tool_calls round-trip", async () => {
  const pool = makeMockPool();
  const convStore = new ConversationStore(pool);
  const msgStore = new MessageStore(pool);
  const c = await convStore.create({ userId: "u1" });
  const tcs = [{ id: "c1", type: "function", function: { name: "test", arguments: "{}" } }];
  await msgStore.add({ conversationId: c.id, userId: "u1", role: "assistant", content: "", toolCalls: tcs });
  const list = await msgStore.listForConversation(c.id);
  assert.ok(Array.isArray(list[0].tool_calls));
  assert.equal(list[0].tool_calls[0].id, "c1");
});

// Re-export the mock pool helper so the studio's PG integration tests
// can use the exact same in-memory pool as the storage tests.
export { makeMockPool };
