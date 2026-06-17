import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TIMELINE_OPS,
  applyOp,
  createEmptyTimelineDocument,
  evalParamAtTime,
  normalizeTimelineDocument,
  validateTimelineDocument,
} from "../../../packages/shared/index.js";
import { buildServer } from "../src/server.js";
import { signToken } from "../../../packages/auth-middleware/index.js";
import { makeMockPool } from "../../storage/tests/test_chat_store_helpers.js";

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ baseUrl: `http://127.0.0.1:${port}`, close: () => new Promise((closeResolve) => server.close(closeResolve)) });
    });
  });
}

async function token(userId, secret = "s") {
  return signToken({ sub: userId, email: `${userId}@example.com`, name: userId }, secret, 600);
}

function op(opName, payload, extra = {}) {
  return {
    op: opName,
    actor: "human",
    timelineId: "tl_test",
    clipId: "",
    trackId: "",
    payload,
    createdAt: "2026-06-15T00:00:00.000Z",
    ...extra,
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseDoc() {
  const doc = createEmptyTimelineDocument({ projectId: "p_day3", userId: "u_day3", timelineId: "tl_test" });
  doc.tracks[0].clips.push({
    id: "clip_1",
    assetId: "ast_hero",
    start: 0,
    end: 10,
    in: 0,
    out: 10,
    transform: {},
    effects: [{ id: "fx_base", name: "Base" }],
    source: "upload",
    name: "Hero",
    selected: false,
    locked: false,
    muted: false,
    text: "",
  });
  doc.tracks[0].clips.push({
    id: "clip_2",
    assetId: "ast_hero2",
    start: 10,
    end: 16,
    in: 0,
    out: 6,
    transform: {},
    effects: [],
    source: "upload",
    name: "Hero 2",
    selected: false,
    locked: false,
    muted: false,
    text: "",
  });
  doc.tracks[1].clips.push({
    id: "clip_audio",
    assetId: "ast_audio",
    start: 0,
    end: 10,
    in: 0,
    out: 10,
    transform: {},
    effects: [],
    source: "upload",
    name: "Music",
    selected: false,
    locked: false,
    muted: false,
    text: "",
  });
  doc.tracks[2].clips.push({
    id: "clip_text",
    assetId: "",
    start: 1,
    end: 4,
    in: 0,
    out: 3,
    transform: {},
    effects: [],
    source: "text",
    name: "Title",
    text: "Title",
    selected: false,
    locked: false,
    muted: false,
  });
  validateTimelineDocument(doc);
  return normalizeTimelineDocument(doc);
}

async function json(res) {
  return res.json();
}

test("applyOp round-trips every forward op through its inverse without mutating the original doc", () => {
  const doc = baseDoc();
  const cases = [
    op(TIMELINE_OPS.INSERT_CLIP, { id: "clip_insert", assetId: "ast_insert", start: 10, end: 14 }, { trackId: "trk_v1" }),
    op(TIMELINE_OPS.TRIM_CLIP, { start: 2, end: 8 }, { trackId: "trk_v1", clipId: "clip_1" }),
    op(TIMELINE_OPS.SPLIT_CLIP, { at: 5 }, { trackId: "trk_v1", clipId: "clip_1" }),
    op(TIMELINE_OPS.MOVE_CLIP, { start: 3 }, { trackId: "trk_v1", clipId: "clip_1" }),
    op(TIMELINE_OPS.DELETE_CLIP, {}, { trackId: "trk_v1", clipId: "clip_1" }),
    op(TIMELINE_OPS.GROUP_CLIPS, { clipIds: ["clip_1", "clip_2"], groupId: "grp_hero" }),
    op(TIMELINE_OPS.ADD_TRANSITION, { id: "tr_1", fromClipId: "clip_1", toClipId: "clip_insert", duration: 0.5 }, { trackId: "trk_v1" }),
    op(TIMELINE_OPS.ADD_EFFECT, { effect: { id: "fx_zoom", name: "Zoom" } }, { trackId: "trk_v1", clipId: "clip_1" }),
    op(TIMELINE_OPS.ADD_TEXT, { id: "txt_2", text: "Subtitle", start: 4, end: 7 }, { trackId: "trk_t1" }),
    op(TIMELINE_OPS.SET_EFFECT, { effect: { id: "fx_base", name: "Zoom Strong", intensity: 0.9 }, index: 0 }, { trackId: "trk_v1", clipId: "clip_1" }),
    op(TIMELINE_OPS.REPLACE_ASSET, { assetId: "ast_new" }, { trackId: "trk_v1", clipId: "clip_1" }),
    op(TIMELINE_OPS.SET_TRACK_FLAG, { muted: true, soloed: true, locked: false, hidden: false }, { trackId: "trk_v1" }),
  ];

  for (const forward of cases) {
    const original = clone(doc);
    const before = clone(original);
    const result = applyOp(original, forward);
    assert.deepEqual(original, before, "applyOp must not mutate the input document");
    const restored = applyOp(result.doc, result.inverse).doc;
    assert.deepEqual(restored, before, `round-trip failed for ${forward.op}`);
  }
});

test("applyOp throws typed errors and leaves the document unchanged for invalid ops", () => {
  const doc = baseDoc();
  const before = clone(doc);
  assert.throws(() => applyOp(doc, op(TIMELINE_OPS.TRIM_CLIP, { start: 5, end: 1 }, { trackId: "trk_v1", clipId: "clip_1" })), { code: "timeline_op_invalid" });
  assert.throws(() => applyOp(doc, op(TIMELINE_OPS.MOVE_CLIP, { start: -1 }, { trackId: "trk_v1", clipId: "clip_1" })), { code: "timeline_op_invalid" });
  assert.throws(() => applyOp(doc, op(TIMELINE_OPS.SPLIT_CLIP, { at: 99 }, { trackId: "trk_v1", clipId: "clip_1" })), { code: "timeline_op_invalid" });
  assert.deepEqual(doc, before);
});

test("studio op-runner applies a batch atomically and records monotonic journal rows", async () => {
  const pool = makeMockPool();
  const { server } = buildServer({ secret: "s", pool, llm: { model: "mock", isMock: () => true, costUsd: () => 0, chat: async () => ({ content: "ok", tool_calls: null, usage: {} }), getUsage: () => ({}) } });
  const { baseUrl, close } = await listen(server);
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${await token("u_day3")}` };

  try {
    const project = await (await fetch(`${baseUrl}/api/projects`, { method: "POST", headers, body: JSON.stringify({ name: "Day3 Project" }) })).json();
    const projectId = project.project.id;
    const asset = await (await fetch(`${baseUrl}/api/assets`, { method: "POST", headers, body: JSON.stringify({ project_id: projectId, source_uri: "tus://asset", kind: "clip" }) })).json();

    const apply = await fetch(`${baseUrl}/api/timelines/${projectId}/ops`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        baseVersion: 1,
        actor: "human",
        ops: [
          op(TIMELINE_OPS.INSERT_CLIP, { id: "clip_batch", assetId: asset.asset.id, start: 0, end: 5 }, { trackId: "trk_v1" }),
          op(TIMELINE_OPS.TRIM_CLIP, { start: 1, end: 4 }, { trackId: "trk_v1", clipId: "clip_batch" }),
        ],
      }),
    });
    assert.equal(apply.status, 200);
    const applied = await json(apply);
    assert.equal(applied.applied, 2);
    assert.equal(applied.version, 3);
    assert.equal(applied.doc.tracks[0].clips.find((c) => c.id === "clip_batch").start, 1);

    const timeline = await (await fetch(`${baseUrl}/api/timelines/${projectId}`, { headers })).json();
    assert.equal(timeline.timeline.version, 3);

    const rows = [...(pool.tables.vireo_timeline_ops || new Map()).values()].sort((a, b) => a.seq - b.seq);
    assert.deepEqual(rows.map((r) => r.seq), [2, 3]);
    assert.deepEqual(rows.map((r) => r.actor), ["human", "human"]);
    assert.ok(rows.every((r) => r.op.op && r.inverse.op));
  } finally {
    await close();
  }
});

test("studio human/bot op path enforces Day 12 move, trim, and solo contract", async () => {
  const pool = makeMockPool();
  const { server } = buildServer({ secret: "s", pool, llm: { model: "mock", isMock: () => true, costUsd: () => 0, chat: async () => ({ content: "ok", tool_calls: null, usage: {} }), getUsage: () => ({}) } });
  const { baseUrl, close } = await listen(server);
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${await token("u_day12_contract")}` };

  try {
    const project = await (await fetch(`${baseUrl}/api/projects`, { method: "POST", headers, body: JSON.stringify({ name: "Day12 Contract" }) })).json();
    const projectId = project.project.id;
    const asset = await (await fetch(`${baseUrl}/api/assets`, { method: "POST", headers, body: JSON.stringify({ project_id: projectId, source_uri: "tus://asset", kind: "clip" }) })).json();

    const apply = await fetch(`${baseUrl}/api/timelines/${projectId}/ops`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        baseVersion: 1,
        actor: "bot",
        ops: [
          op(TIMELINE_OPS.INSERT_CLIP, { id: "a", assetId: asset.asset.id, start: 0, end: 2 }, { trackId: "trk_v1" }),
          op(TIMELINE_OPS.INSERT_CLIP, { id: "b", assetId: asset.asset.id, start: 7, end: 10 }, { trackId: "trk_v1" }),
          op(TIMELINE_OPS.MOVE_CLIP, { targetTrackId: "trk_v1", start: 6.5 }, { trackId: "trk_v1", clipId: "a" }),
          op(TIMELINE_OPS.TRIM_CLIP, { start: 3, end: 10, originalStart: 7, originalEnd: 10 }, { trackId: "trk_v1", clipId: "b" }),
          op(TIMELINE_OPS.SET_TRACK_FLAG, { soloed: true }, { trackId: "trk_v1" }),
        ],
      }),
    });
    assert.equal(apply.status, 200);
    const applied = await json(apply);
    const v1 = applied.doc.tracks.find((track) => track.id === "trk_v1");
    assert.equal(v1.soloed, true);
    assert.equal(v1.clips.find((clip) => clip.id === "a").start, 5);
    assert.equal(v1.clips.find((clip) => clip.id === "b").start, 7);

    const locked = await fetch(`${baseUrl}/api/timelines/${projectId}/ops`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        baseVersion: applied.version,
        actor: "human",
        ops: [
          op(TIMELINE_OPS.SET_TRACK_FLAG, { locked: true }, { trackId: "trk_v1" }),
          op(TIMELINE_OPS.TRIM_CLIP, { start: 1, end: 5, originalStart: 0, originalEnd: 5 }, { trackId: "trk_v1", clipId: "a" }),
        ],
      }),
    });
    assert.equal(locked.status, 400);
  } finally {
    await close();
  }
});

test("studio op-runner rolls back the whole batch when one op fails", async () => {
  const pool = makeMockPool();
  const { server } = buildServer({ secret: "s", pool, llm: { model: "mock", isMock: () => true, costUsd: () => 0, chat: async () => ({ content: "ok", tool_calls: null, usage: {} }), getUsage: () => ({}) } });
  const { baseUrl, close } = await listen(server);
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${await token("u_day3_batch_rollback")}` };

  try {
    const project = await (await fetch(`${baseUrl}/api/projects`, { method: "POST", headers, body: JSON.stringify({ name: "Rollback Project" }) })).json();
    const projectId = project.project.id;
    const asset = await (await fetch(`${baseUrl}/api/assets`, { method: "POST", headers, body: JSON.stringify({ project_id: projectId, source_uri: "tus://asset", kind: "clip" }) })).json();

    const bad = await fetch(`${baseUrl}/api/timelines/${projectId}/ops`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        baseVersion: 1,
        ops: [
          op(TIMELINE_OPS.INSERT_CLIP, { id: "clip_ok", assetId: asset.asset.id, start: 0, end: 5 }, { trackId: "trk_v1" }),
          op(TIMELINE_OPS.TRIM_CLIP, { start: 5, end: 1 }, { trackId: "trk_v1", clipId: "clip_ok" }),
        ],
      }),
    });
    assert.equal(bad.status, 400);
    assert.equal((await json(bad)).error, "op_apply_failed");

    const timeline = await (await fetch(`${baseUrl}/api/timelines/${projectId}`, { headers })).json();
    assert.equal(timeline.timeline.version, 1);
    assert.equal(timeline.timeline.doc.tracks[0].clips.length, 0);
    assert.equal((pool.tables.vireo_timeline_ops || new Map()).size, 0);
  } finally {
    await close();
  }
});

test("studio op-runner rejects stale baseVersion with 409 and leaves state unchanged", async () => {
  const pool = makeMockPool();
  const { server } = buildServer({ secret: "s", pool, llm: { model: "mock", isMock: () => true, costUsd: () => 0, chat: async () => ({ content: "ok", tool_calls: null, usage: {} }), getUsage: () => ({}) } });
  const { baseUrl, close } = await listen(server);
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${await token("u_day3_stale")}` };

  try {
    const project = await (await fetch(`${baseUrl}/api/projects`, { method: "POST", headers, body: JSON.stringify({ name: "Stale Project" }) })).json();
    const projectId = project.project.id;
    const asset = await (await fetch(`${baseUrl}/api/assets`, { method: "POST", headers, body: JSON.stringify({ project_id: projectId, source_uri: "tus://asset", kind: "clip" }) })).json();

    const first = await fetch(`${baseUrl}/api/timelines/${projectId}/ops`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        baseVersion: 1,
        ops: [op(TIMELINE_OPS.INSERT_CLIP, { id: "clip_first", assetId: asset.asset.id, start: 0, end: 5 }, { trackId: "trk_v1" })],
      }),
    });
    assert.equal(first.status, 200);

    const stale = await fetch(`${baseUrl}/api/timelines/${projectId}/ops`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        baseVersion: 1,
        ops: [op(TIMELINE_OPS.INSERT_CLIP, { id: "clip_stale", assetId: asset.asset.id, start: 5, end: 7 }, { trackId: "trk_v1" })],
      }),
    });
    assert.equal(stale.status, 409);
    assert.equal((await json(stale)).error, "timeline_version_conflict");

    const timeline = await (await fetch(`${baseUrl}/api/timelines/${projectId}`, { headers })).json();
    assert.equal(timeline.timeline.version, 2);
    assert.deepEqual(timeline.timeline.doc.tracks[0].clips.map((c) => c.id), ["clip_first"]);
  } finally {
    await close();
  }
});

test("studio undo and redo use the journal and return to the same doc/version path", async () => {
  const pool = makeMockPool();
  const { server } = buildServer({ secret: "s", pool, llm: { model: "mock", isMock: () => true, costUsd: () => 0, chat: async () => ({ content: "ok", tool_calls: null, usage: {} }), getUsage: () => ({}) } });
  const { baseUrl, close } = await listen(server);
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${await token("u_day3_undo")}` };

  try {
    const project = await (await fetch(`${baseUrl}/api/projects`, { method: "POST", headers, body: JSON.stringify({ name: "Undo Project" }) })).json();
    const projectId = project.project.id;
    const asset = await (await fetch(`${baseUrl}/api/assets`, { method: "POST", headers, body: JSON.stringify({ project_id: projectId, source_uri: "tus://asset", kind: "clip" }) })).json();

    const apply = await fetch(`${baseUrl}/api/timelines/${projectId}/ops`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        baseVersion: 1,
        ops: [op(TIMELINE_OPS.INSERT_CLIP, { id: "clip_undo", assetId: asset.asset.id, start: 0, end: 5 }, { trackId: "trk_v1" })],
      }),
    });
    assert.equal(apply.status, 200);
    assert.equal((await json(apply)).version, 2);

    const undo = await fetch(`${baseUrl}/api/timelines/${projectId}/undo`, { method: "POST", headers });
    assert.equal(undo.status, 200);
    const undone = await json(undo);
    assert.equal(undone.version, 3);
    assert.equal(undone.doc.tracks[0].clips.some((c) => c.id === "clip_undo"), false);

    const redo = await fetch(`${baseUrl}/api/timelines/${projectId}/redo`, { method: "POST", headers });
    assert.equal(redo.status, 200);
    const redone = await json(redo);
    assert.equal(redone.version, 4);
    assert.equal(redone.doc.tracks[0].clips.find((c) => c.id === "clip_undo").start, 0);

    const rows = [...(pool.tables.vireo_timeline_ops || new Map()).values()].sort((a, b) => a.seq - b.seq);
    assert.deepEqual(rows.map((r) => r.seq), [2]);
    assert.equal(rows.find((r) => r.seq === 2).undone_at, null);
    assert.ok(rows.find((r) => r.seq === 2).redone_at);
  } finally {
    await close();
  }
});

test("studio undo/redo stack handles two separate op packets without journal rows becoming undo targets", async () => {
  const pool = makeMockPool();
  const { server } = buildServer({ secret: "s", pool, llm: { model: "mock", isMock: () => true, costUsd: () => 0, chat: async () => ({ content: "ok", tool_calls: null, usage: {} }), getUsage: () => ({}) } });
  const { baseUrl, close } = await listen(server);
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${await token("u_day3_stack")}` };

  try {
    const project = await (await fetch(`${baseUrl}/api/projects`, { method: "POST", headers, body: JSON.stringify({ name: "Stack Project" }) })).json();
    const projectId = project.project.id;
    const asset = await (await fetch(`${baseUrl}/api/assets`, { method: "POST", headers, body: JSON.stringify({ project_id: projectId, source_uri: "tus://asset", kind: "clip" }) })).json();

    const applyA = await fetch(`${baseUrl}/api/timelines/${projectId}/ops`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        baseVersion: 1,
        ops: [op(TIMELINE_OPS.INSERT_CLIP, { id: "clip_stack_a", assetId: asset.asset.id, start: 0, end: 5 }, { trackId: "trk_v1" })],
      }),
    });
    assert.equal(applyA.status, 200);
    assert.equal((await json(applyA)).version, 2);

    const applyB = await fetch(`${baseUrl}/api/timelines/${projectId}/ops`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        baseVersion: 2,
        ops: [op(TIMELINE_OPS.INSERT_CLIP, { id: "clip_stack_b", assetId: asset.asset.id, start: 5, end: 10 }, { trackId: "trk_v1" })],
      }),
    });
    assert.equal(applyB.status, 200);
    assert.equal((await json(applyB)).version, 3);

    const undoB = await fetch(`${baseUrl}/api/timelines/${projectId}/undo`, { method: "POST", headers });
    assert.equal(undoB.status, 200);
    assert.equal((await json(undoB)).version, 4);
    assert.deepEqual((await (await fetch(`${baseUrl}/api/timelines/${projectId}`, { headers })).json()).timeline.doc.tracks[0].clips.map((c) => c.id), ["clip_stack_a"]);

    const undoA = await fetch(`${baseUrl}/api/timelines/${projectId}/undo`, { method: "POST", headers });
    assert.equal(undoA.status, 200);
    const empty = await json(undoA);
    assert.equal(empty.version, 5);
    assert.deepEqual(empty.doc.tracks[0].clips.map((c) => c.id), []);

    const redoA = await fetch(`${baseUrl}/api/timelines/${projectId}/redo`, { method: "POST", headers });
    assert.equal(redoA.status, 200);
    assert.equal((await json(redoA)).version, 6);
    assert.deepEqual((await (await fetch(`${baseUrl}/api/timelines/${projectId}`, { headers })).json()).timeline.doc.tracks[0].clips.map((c) => c.id), ["clip_stack_a"]);

    const redoB = await fetch(`${baseUrl}/api/timelines/${projectId}/redo`, { method: "POST", headers });
    assert.equal(redoB.status, 200);
    const restored = await json(redoB);
    assert.equal(restored.version, 7);
    assert.deepEqual(restored.doc.tracks[0].clips.map((c) => c.id), ["clip_stack_a", "clip_stack_b"]);
    assert.equal(restored.doc.tracks[0].clips[0].start, 0);
    assert.equal(restored.doc.tracks[0].clips[1].start, 5);

    const rows = [...(pool.tables.vireo_timeline_ops || new Map()).values()].sort((a, b) => a.seq - b.seq);
    assert.deepEqual(rows.map((r) => r.seq), [2, 3]);
    assert.deepEqual(rows.map((r) => [r.seq, !!r.undone_at, !!r.redone_at]), [
      [2, false, true],
      [3, false, true],
    ]);
  } finally {
    await close();
  }
});

test("studio undo branch is discarded when a new op is applied off the cursor", async () => {
  const pool = makeMockPool();
  const { server } = buildServer({ secret: "s", pool, llm: { model: "mock", isMock: () => true, costUsd: () => 0, chat: async () => ({ content: "ok", tool_calls: null, usage: {} }), getUsage: () => ({}) } });
  const { baseUrl, close } = await listen(server);
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${await token("u_day3_branch")}` };

  try {
    const project = await (await fetch(`${baseUrl}/api/projects`, { method: "POST", headers, body: JSON.stringify({ name: "Branch Project" }) })).json();
    const projectId = project.project.id;
    const asset = await (await fetch(`${baseUrl}/api/assets`, { method: "POST", headers, body: JSON.stringify({ project_id: projectId, source_uri: "tus://asset", kind: "clip" }) })).json();

    const applyA = await fetch(`${baseUrl}/api/timelines/${projectId}/ops`, {
      method: "POST",
      headers,
      body: JSON.stringify({ baseVersion: 1, ops: [op(TIMELINE_OPS.INSERT_CLIP, { id: "clip_branch_a", assetId: asset.asset.id, start: 0, end: 5 }, { trackId: "trk_v1" })] }),
    });
    assert.equal(applyA.status, 200);
    assert.equal((await json(applyA)).version, 2);

    const applyB = await fetch(`${baseUrl}/api/timelines/${projectId}/ops`, {
      method: "POST",
      headers,
      body: JSON.stringify({ baseVersion: 2, ops: [op(TIMELINE_OPS.INSERT_CLIP, { id: "clip_branch_b", assetId: asset.asset.id, start: 5, end: 10 }, { trackId: "trk_v1" })] }),
    });
    assert.equal(applyB.status, 200);
    assert.equal((await json(applyB)).version, 3);

    const undoB = await fetch(`${baseUrl}/api/timelines/${projectId}/undo`, { method: "POST", headers });
    assert.equal(undoB.status, 200);
    const undoneB = await json(undoB);
    assert.equal(undoneB.version, 4);
    assert.deepEqual(undoneB.doc.tracks[0].clips.map((c) => c.id), ["clip_branch_a"]);
    const afterUndo = await (await fetch(`${baseUrl}/api/timelines/${projectId}`, { headers })).json();
    assert.equal(afterUndo.timeline.version, 4);
    const timelineRowAfterUndo = [...pool.tables.vireo_timelines.values()].find((r) => r.project_id === projectId);
    assert.ok(timelineRowAfterUndo);
    assert.equal(timelineRowAfterUndo.version, 4);
    assert.equal(timelineRowAfterUndo.undo_cursor_seq, 2);

    const applyC = await fetch(`${baseUrl}/api/timelines/${projectId}/ops`, {
      method: "POST",
      headers,
      body: JSON.stringify({ baseVersion: 4, ops: [op(TIMELINE_OPS.INSERT_CLIP, { id: "clip_branch_c", assetId: asset.asset.id, start: 10, end: 15 }, { trackId: "trk_v1" })] }),
    });
    assert.equal(applyC.status, 200);
    const afterC = await json(applyC);
    assert.equal(afterC.version, 5);
    assert.deepEqual(afterC.doc.tracks[0].clips.map((c) => c.id), ["clip_branch_a", "clip_branch_c"]);

    const redoAfterBranch = await fetch(`${baseUrl}/api/timelines/${projectId}/redo`, { method: "POST", headers });
    assert.equal(redoAfterBranch.status, 404);
    assert.equal((await json(redoAfterBranch)).error, "no_timeline_ops");

    const rows = [...(pool.tables.vireo_timeline_ops || new Map()).values()].sort((a, b) => a.seq - b.seq);
    assert.deepEqual(rows.map((r) => r.seq), [2, 5]);
    assert.deepEqual(rows.map((r) => r.op.payload.id), ["clip_branch_a", "clip_branch_c"]);
    assert.equal(rows.some((r) => r.seq === 3), false, "op B ahead of the cursor must be discarded");
    assert.equal(rows.some((r) => r.seq > afterC.version), false, "no journal rows ahead of the new cursor should remain reachable");
    const timelineAfterC = await (await fetch(`${baseUrl}/api/timelines/${projectId}`, { headers })).json();
    assert.equal(timelineAfterC.timeline.version, 5);
    assert.equal(timelineAfterC.timeline.doc.version, 5);
    const timelineRow = [...pool.tables.vireo_timelines.values()].find((r) => r.project_id === projectId);
    assert.ok(timelineRow);
    assert.equal(timelineRow.version, 5);
    assert.equal(timelineRow.undo_cursor_seq, afterC.version);
  } finally {
    await close();
  }
});

test("studio human and bot asset inserts share one undoable timeline", async () => {
  const pool = makeMockPool();
  const { server } = buildServer({ secret: "s", pool, llm: { model: "mock", isMock: () => true, costUsd: () => 0, chat: async () => ({ content: "ok", tool_calls: null, usage: {} }), getUsage: () => ({}) } });
  const { baseUrl, close } = await listen(server);
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${await token("u_day13_asset")}` };

  try {
    const project = await (await fetch(`${baseUrl}/api/projects`, { method: "POST", headers, body: JSON.stringify({ name: "Day13 Assets" }) })).json();
    const projectId = project.project.id;
    const asset = await (await fetch(`${baseUrl}/api/assets`, { method: "POST", headers, body: JSON.stringify({ project_id: projectId, source_uri: "tus://hero", kind: "clip", metadata: { simulated_ingest: true } }) })).json();

    const list = await fetch(`${baseUrl}/api/assets?project_id=${encodeURIComponent(projectId)}&limit=200`, {
      headers,
    });
    assert.equal(list.status, 200);
    const listed = await json(list);
    assert.equal(listed.assets.length, 1);
    assert.equal(listed.assets[0].id, asset.asset.id);

    const human = await fetch(`${baseUrl}/api/timelines/${projectId}/ops`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        baseVersion: 1,
        actor: "human",
        ops: [op(TIMELINE_OPS.INSERT_CLIP, { id: "human_clip", assetId: asset.asset.id, start: 0, end: 4 }, { trackId: "trk_v1" })],
      }),
    });
    assert.equal(human.status, 200);
    const humanApplied = await json(human);
    assert.equal(humanApplied.version, 2);
    assert.equal(humanApplied.doc.tracks[0].clips.length, 1);

    const bot = await fetch(`${baseUrl}/api/timelines/${projectId}/ops`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        baseVersion: humanApplied.version,
        actor: "bot",
        ops: [op(TIMELINE_OPS.INSERT_CLIP, { id: "bot_clip", assetId: asset.asset.id, start: 4, end: 9 }, { trackId: "trk_v1" })],
      }),
    });
    assert.equal(bot.status, 200);
    const botApplied = await json(bot);
    assert.equal(botApplied.version, 3);
    assert.deepEqual(botApplied.doc.tracks[0].clips.map((clip) => clip.id), ["human_clip", "bot_clip"]);

    const undo = await fetch(`${baseUrl}/api/timelines/${projectId}/undo`, { method: "POST", headers });
    assert.equal(undo.status, 200);
    const undone = await json(undo);
    assert.equal(undone.version, 4);
    assert.deepEqual(undone.doc.tracks[0].clips.map((clip) => clip.id), ["human_clip"]);
  } finally {
    await close();
  }
});


test("studio human and bot title props share one undoable timeline", async () => {
  const pool = makeMockPool();
  const { server } = buildServer({ secret: "s", pool, llm: { model: "mock", isMock: () => true, costUsd: () => 0, chat: async () => ({ content: "ok", tool_calls: null, usage: {} }), getUsage: () => ({}) } });
  const { baseUrl, close } = await listen(server);
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${await token("u_day15_title_props")}` };

  try {
    const project = await (await fetch(`${baseUrl}/api/projects`, { method: "POST", headers, body: JSON.stringify({ name: "Day15 Title Props" }) })).json();
    const projectId = project.project.id;

    const add = await fetch(`${baseUrl}/api/timelines/${projectId}/ops`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        baseVersion: 1,
        actor: "human",
        ops: [op(TIMELINE_OPS.ADD_TEXT, { id: "title_day15", text: "Launch", start: 1, end: 4, titleProps: { fontFamily: "Inter", fontSize: 44, color: "#ffffff", align: "center" } }, { trackId: "trk_t1" })],
      }),
    });
    assert.equal(add.status, 200);
    const added = await json(add);
    assert.equal(added.version, 2);
    let clip = added.doc.tracks.find((track) => track.id === "trk_t1").clips.find((item) => item.id === "title_day15");
    assert.equal(clip.source, "text");
    assert.equal(clip.titleProps.color, "#ffffff");

    const humanStyle = await fetch(`${baseUrl}/api/timelines/${projectId}/ops`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        baseVersion: added.version,
        actor: "human",
        ops: [op(TIMELINE_OPS.SET_TITLE_PROPS, { titleProps: { text: "Launch now", fontFamily: "Arial", color: "#123456" } }, { trackId: "trk_t1", clipId: "title_day15" })],
      }),
    });
    assert.equal(humanStyle.status, 200);
    const humanApplied = await json(humanStyle);
    assert.equal(humanApplied.version, 3);
    clip = humanApplied.doc.tracks.find((track) => track.id === "trk_t1").clips.find((item) => item.id === "title_day15");
    assert.deepEqual(clip.titleProps, { text: "Launch now", fontFamily: "Arial", fontSize: 44, color: "#123456", align: "center", backgroundColor: "", strokeColor: "", strokeWidth: 0 });

    const botStyle = await fetch(`${baseUrl}/api/timelines/${projectId}/ops`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        baseVersion: humanApplied.version,
        actor: "bot",
        ops: [op(TIMELINE_OPS.SET_TITLE_PROPS, { titleProps: { align: "right", fontSize: 64 } }, { trackId: "trk_t1", clipId: "title_day15" })],
      }),
    });
    assert.equal(botStyle.status, 200);
    const botApplied = await json(botStyle);
    assert.equal(botApplied.version, 4);
    clip = botApplied.doc.tracks.find((track) => track.id === "trk_t1").clips.find((item) => item.id === "title_day15");
    assert.deepEqual(clip.titleProps, { text: "Launch now", fontFamily: "Arial", fontSize: 64, color: "#123456", align: "right", backgroundColor: "", strokeColor: "", strokeWidth: 0 });

    const undoBot = await fetch(`${baseUrl}/api/timelines/${projectId}/undo`, { method: "POST", headers });
    assert.equal(undoBot.status, 200);
    const undoneBot = await json(undoBot);
    assert.equal(undoneBot.version, 5);
    clip = undoneBot.doc.tracks.find((track) => track.id === "trk_t1").clips.find((item) => item.id === "title_day15");
    assert.deepEqual(clip.titleProps, { text: "Launch now", fontFamily: "Arial", fontSize: 44, color: "#123456", align: "center", backgroundColor: "", strokeColor: "", strokeWidth: 0 });

    const undoHuman = await fetch(`${baseUrl}/api/timelines/${projectId}/undo`, { method: "POST", headers });
    assert.equal(undoHuman.status, 200);
    const undoneHuman = await json(undoHuman);
    assert.equal(undoneHuman.version, 6);
    clip = undoneHuman.doc.tracks.find((track) => track.id === "trk_t1").clips.find((item) => item.id === "title_day15");
    assert.deepEqual(clip.titleProps, { fontFamily: "Inter", fontSize: 44, color: "#ffffff", align: "center", text: "Launch", backgroundColor: "", strokeColor: "", strokeWidth: 0 });
  } finally {
    await close();
  }
});

test("studio human and bot keyframes share one undoable timeline", async () => {
  const pool = makeMockPool();
  const { server } = buildServer({ secret: "s", pool, llm: { model: "mock", isMock: () => true, costUsd: () => 0, chat: async () => ({ content: "ok", tool_calls: null, usage: {} }), getUsage: () => ({}) } });
  const { baseUrl, close } = await listen(server);
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${await token("u_day14_keyframes")}` };

  try {
    const project = await (await fetch(`${baseUrl}/api/projects`, { method: "POST", headers, body: JSON.stringify({ name: "Day14 Keyframes" }) })).json();
    const projectId = project.project.id;
    const asset = await (await fetch(`${baseUrl}/api/assets`, { method: "POST", headers, body: JSON.stringify({ project_id: projectId, source_uri: "tus://hero", kind: "clip", metadata: { simulated_ingest: true } }) })).json();

    const insert = await fetch(`${baseUrl}/api/timelines/${projectId}/ops`, {
      method: "POST",
      headers,
      body: JSON.stringify({ baseVersion: 1, actor: "human", ops: [op(TIMELINE_OPS.INSERT_CLIP, { id: "key_clip", assetId: asset.asset.id, start: 0, end: 6 }, { trackId: "trk_v1" })] }),
    });
    assert.equal(insert.status, 200);
    const inserted = await json(insert);
    assert.equal(inserted.version, 2);

    const humanKey = await fetch(`${baseUrl}/api/timelines/${projectId}/ops`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        baseVersion: inserted.version,
        actor: "human",
        ops: [op(TIMELINE_OPS.SET_KEYFRAME, { targetId: "transform", param: "opacity", keyframe: { time: 0, value: 0.2 } }, { trackId: "trk_v1", clipId: "key_clip" })],
      }),
    });
    assert.equal(humanKey.status, 200);
    const humanApplied = await json(humanKey);
    assert.equal(humanApplied.version, 3);

    const botEffect = await fetch(`${baseUrl}/api/timelines/${projectId}/ops`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        baseVersion: humanApplied.version,
        actor: "bot",
        ops: [op(TIMELINE_OPS.ADD_EFFECT, { effect: { id: "fx_blur", type: "gaussian-blur", name: "Gaussian blur", params: { radius: 0 } } }, { trackId: "trk_v1", clipId: "key_clip" })],
      }),
    });
    assert.equal(botEffect.status, 200);
    const botEffectApplied = await json(botEffect);
    assert.equal(botEffectApplied.version, 4);

    const botKey = await fetch(`${baseUrl}/api/timelines/${projectId}/ops`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        baseVersion: botEffectApplied.version,
        actor: "bot",
        ops: [op(TIMELINE_OPS.SET_KEYFRAME, { targetId: "transform", param: "opacity", keyframe: { time: 4, value: 1 } }, { trackId: "trk_v1", clipId: "key_clip" })],
      }),
    });
    assert.equal(botKey.status, 200);
    const botApplied = await json(botKey);
    assert.equal(botApplied.version, 5);
    const clip = botApplied.doc.tracks[0].clips.find((item) => item.id === "key_clip");
    assert.ok(Math.abs(evalParamAtTime(clip.keyframes.transform.opacity, 2) - 0.6) < 1e-9);
    assert.equal(evalParamAtTime(clip.keyframes.effects.fx_blur?.radius, 2, 0), 0);

    const undoBotKey = await fetch(`${baseUrl}/api/timelines/${projectId}/undo`, { method: "POST", headers });
    assert.equal(undoBotKey.status, 200);
    const undoneBotKey = await json(undoBotKey);
    assert.equal(undoneBotKey.version, 6);
    assert.equal(evalParamAtTime(undoneBotKey.doc.tracks[0].clips[0].keyframes.transform.opacity, 2), 0.2);
    assert.equal(undoneBotKey.doc.tracks[0].clips[0].effects.length, 1);

    const undoBotEffect = await fetch(`${baseUrl}/api/timelines/${projectId}/undo`, { method: "POST", headers });
    assert.equal(undoBotEffect.status, 200);
    const undoneBotEffect = await json(undoBotEffect);
    assert.equal(undoneBotEffect.version, 7);
    assert.equal(undoneBotEffect.doc.tracks[0].clips[0].effects.length, 0);

    const undoHumanKey = await fetch(`${baseUrl}/api/timelines/${projectId}/undo`, { method: "POST", headers });
    assert.equal(undoHumanKey.status, 200);
    const undoneHumanKey = await json(undoHumanKey);
    assert.equal(undoneHumanKey.version, 8);
    assert.equal(undoneHumanKey.doc.tracks[0].clips[0].keyframes.transform.opacity, undefined);
  } finally {
    await close();
  }
});

test("studio op-runner enforces project ownership", async () => {
  const pool = makeMockPool();
  const { server } = buildServer({ secret: "s", pool, llm: { model: "mock", isMock: () => true, costUsd: () => 0, chat: async () => ({ content: "ok", tool_calls: null, usage: {} }), getUsage: () => ({}) } });
  const { baseUrl, close } = await listen(server);
  const owner = { "Content-Type": "application/json", Authorization: `Bearer ${await token("u_day3_owner")}` };
  const other = { "Content-Type": "application/json", Authorization: `Bearer ${await token("u_day3_other")}` };

  try {
    const project = await (await fetch(`${baseUrl}/api/projects`, { method: "POST", headers: owner, body: JSON.stringify({ name: "Owner Project" }) })).json();
    const foreign = await fetch(`${baseUrl}/api/timelines/${project.project.id}/ops`, {
      method: "POST",
      headers: other,
      body: JSON.stringify({ baseVersion: 1, ops: [] }),
    });
    assert.equal(foreign.status, 404);
  } finally {
    await close();
  }
});
