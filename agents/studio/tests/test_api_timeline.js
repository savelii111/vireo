import { test } from "node:test";
import assert from "node:assert/strict";
import { buildServer } from "../src/server.js";
import { signToken } from "../../../packages/auth-middleware/index.js";

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { baseUrl: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

async function getToken(userId, secret = "s") {
  return signToken({ sub: userId, email: `${userId}@example.com`, name: userId }, secret, 600);
}

async function json(res) {
  return res.json();
}

test("studio assets and timeline APIs persist through in-memory stores with ownership checks", async () => {
  const { server } = buildServer({ secret: "s", llm: { model: "mock", isMock: () => true, costUsd: () => 0, chat: async () => ({ content: "ok", tool_calls: null, usage: {} }), getUsage: () => ({}) } });
  const { baseUrl, close } = await listen(server);

  try {
    const h1 = { "Content-Type": "application/json", Authorization: `Bearer ${await getToken("user-day2")}` };
    const h2 = { "Content-Type": "application/json", Authorization: `Bearer ${await getToken("other-user")}` };

    const project = await (await fetch(`${baseUrl}/api/projects`, { method: "POST", headers: h1, body: JSON.stringify({ name: "Day2 Project", niche: "product" }) })).json();
    const projectId = project.project.id;

    const assetPayload = {
      project_id: projectId,
      source_uri: "tus://video-agent/session-1",
      kind: "clip",
      metadata: { label: "hero-shot", duration_ms: 12000 },
    };

    const create = await fetch(`${baseUrl}/api/assets`, { method: "POST", headers: h1, body: JSON.stringify(assetPayload) });
    assert.equal(create.status, 201);
    const asset = (await json(create)).asset;
    assert.equal(asset.project_id, projectId);
    assert.equal(asset.user_id, "user-day2");
    assert.equal(asset.metadata.label, "hero-shot");

    const list = await fetch(`${baseUrl}/api/assets?project_id=${projectId}`, { headers: h1 });
    assert.equal(list.status, 200);
    assert.deepEqual((await json(list)).assets.map((row) => row.id), [asset.id]);

    const forbiddenList = await fetch(`${baseUrl}/api/assets?project_id=${projectId}`, { headers: h2 });
    assert.equal(forbiddenList.status, 404, "other users should not see the project");
    assert.equal((await json(forbiddenList)).error, "project_not_found");

    const timelineUrl = `${baseUrl}/api/timelines/${projectId}`;
    const initial = await fetch(timelineUrl, { headers: h1 });
    assert.equal(initial.status, 200);
    const initialTimeline = (await json(initial)).timeline;
    assert.equal(initialTimeline.project_id, projectId);
    assert.equal(initialTimeline.doc.userId, "user-day2");
    assert.equal(initialTimeline.version, 1);

    const editedDoc = structuredClone(initialTimeline.doc);
    editedDoc.tracks[0].clips.push({
      id: "clip-day2-1",
      asset_id: asset.id,
      start_ms: 0,
      end_ms: 5000,
      track_start_ms: 0,
      kind: "clip",
    });
    editedDoc.tracks[0].soloed = true;

    const save = await fetch(timelineUrl, {
      method: "PUT",
      headers: h1,
      body: JSON.stringify({ doc: editedDoc, version: initialTimeline.version }),
    });
    assert.equal(save.status, 200);
    const saved = (await json(save)).timeline;
    assert.equal(saved.version, 2);
    assert.equal(saved.doc.tracks[0].clips.length, 1);
    assert.equal(saved.doc.tracks[0].soloed, true);

    const reloaded = await fetch(timelineUrl, { headers: h1 });
    assert.equal(reloaded.status, 200);
    assert.deepEqual((await json(reloaded)).timeline.doc.tracks[0].clips, saved.doc.tracks[0].clips);

    const stale = structuredClone(saved.doc);
    stale.version = initialTimeline.version;
    stale.tracks[0].clips.push({
      id: "clip-day2-stale",
      asset_id: asset.id,
      start_ms: 5000,
      end_ms: 7000,
      track_start_ms: 5000,
      kind: "clip",
    });
    const conflict = await fetch(timelineUrl, {
      method: "PUT",
      headers: h1,
      body: JSON.stringify({ doc: stale, version: initialTimeline.version }),
    });
    assert.equal(conflict.status, 409);
    assert.equal((await json(conflict)).error, "timeline_version_conflict");

    const invalidDoc = structuredClone(saved.doc);
    invalidDoc.version = saved.version;
    invalidDoc.fps = 0;
    const bad = await fetch(timelineUrl, {
      method: "PUT",
      headers: h1,
      body: JSON.stringify({ doc: invalidDoc, version: saved.version }),
    });
    assert.equal(bad.status, 400);
    assert.equal((await json(bad)).error, "timeline_validation");

    const otherProject = await fetch(`${baseUrl}/api/timelines/project-day2-b`, { headers: h1 });
    assert.equal(otherProject.status, 404);

    const forbiddenTimeline = await fetch(timelineUrl, { headers: h2 });
    assert.equal(forbiddenTimeline.status, 404);

    const deleteReq = await fetch(`${baseUrl}/api/assets/${asset.id}`, {
      method: "DELETE",
      headers: h1,
      body: JSON.stringify({}),
    });
    assert.equal(deleteReq.status, 400);
    assert.equal((await json(deleteReq)).error, "confirmation_required");

    const deleted = await fetch(`${baseUrl}/api/assets/${asset.id}`, {
      method: "DELETE",
      headers: h1,
      body: JSON.stringify({ confirmation_token: "delete-asset" }),
    });
    assert.equal(deleted.status, 200);
    assert.equal((await json(deleted)).deleted, true);

    const gone = await fetch(`${baseUrl}/api/assets/${asset.id}`, { headers: h1 });
    assert.equal(gone.status, 404);
  } finally {
    await close();
  }
});
