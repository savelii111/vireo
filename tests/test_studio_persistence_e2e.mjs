import { randomUUID } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { signToken } from "../packages/auth-middleware/index.js";
import { TIMELINE_OPS, applyOp, createEmptyTimelineDocument } from "../packages/shared/index.js";
import { buildServer } from "../agents/studio/src/server.js";
import { applyMigrations } from "../agents/storage/src/migrations.js";

const SECRET = "studio_day21_persistence_test";
const PG_URL = process.env.VIREO_PG_URL || process.env.DATABASE_URL || "postgresql://vireo:vireo_dev_only@127.0.0.1:5432/vireo";

function mockLlm() {
  return {
    model: "mock-day21-persistence",
    isMock: () => true,
    costUsd: () => 0,
    getUsage: () => ({}),
    chat: async () => ({ content: "mock", tool_calls: null, usage: {} }),
  };
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((closeResolve) => server.close(closeResolve)),
      });
    });
    server.once("error", reject);
  });
}

async function token(userId) {
  return signToken({ sub: userId, email: `${userId}@example.com`, name: userId }, SECRET, 600);
}

async function cleanup(pool, projectId, userId) {
  await pool.query("DELETE FROM vireo_timeline_ops WHERE project_id = $1", [projectId]);
  await pool.query("DELETE FROM vireo_assets WHERE project_id = $1 OR user_id = $2", [projectId, userId]);
  await pool.query("DELETE FROM vireo_timelines WHERE project_id = $1 OR user_id = $2", [projectId, userId]);
  await pool.query("DELETE FROM vireo_projects WHERE id = $1 OR user_id = $2", [projectId, userId]);
}

test("studio persistence e2e: PG timeline+asset survive server reload", async () => {
  let pool1 = null;
  let pool2 = null;
  let endpoint1 = null;
  let endpoint2 = null;

  try {
    pool1 = new Pool({ connectionString: PG_URL, max: 5 });
    await applyMigrations(pool1);

    const { server } = buildServer({
      secret: SECRET,
      pool: pool1,
      llm: mockLlm(),
      port: 0,
      host: "127.0.0.1",
    });
    endpoint1 = await listen(server);

    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${await token("u_day21_persistence")}` };
    const healthRes = await fetch(`${endpoint1.baseUrl}/health`, { headers });
    assert.equal(healthRes.status, 200);
    const health = await healthRes.json();
    assert.equal(health.postgres, true);
    assert.equal(health.pg_ok, true);
    assert.ok(health.migrations?.includes("014_studio_persistence_fields"));

    const projectRes = await fetch(`${endpoint1.baseUrl}/api/projects`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Day 21 Persistence Reload", metadata: { day: 21 } }),
    });
    assert.equal(projectRes.status, 201);
    const projectBody = await projectRes.json();
    const projectId = projectBody.project.id;

    const assetRes = await fetch(`${endpoint1.baseUrl}/api/assets`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        project_id: projectId,
        kind: "video",
        source: "upload",
        source_uri: "tus://sample_10s",
        filename: "sample_10s.mp4",
        storage_path: "tus://uploads/sample_10s",
        upload_id: "upload_day21_persistence",
        duration: 10,
        width: 1280,
        height: 720,
        fps: 30,
        video_codec: "h264",
        has_audio: true,
        container: "mp4",
        real_decode: true,
        metadata: { probe: "ffprobe" },
      }),
    });
    assert.equal(assetRes.status, 201);
    const assetBody = await assetRes.json();
    assert.equal(assetBody.asset.real_decode, true);
    assert.equal(assetBody.asset.width, 1280);
    assert.equal(assetBody.asset.height, 720);
    assert.equal(assetBody.asset.duration, 10);
    assert.equal(assetBody.asset.fps, 30);
    assert.equal(assetBody.asset.video_codec, "h264");
    assert.equal(assetBody.asset.has_audio, true);
    assert.equal(assetBody.asset.container, "mp4");
    assert.equal(assetBody.asset.source_uri, "tus://sample_10s");
    assert.equal(assetBody.asset.upload_id, "upload_day21_persistence");

    const initialTimelineRes = await fetch(`${endpoint1.baseUrl}/api/timelines/${projectId}`, { headers });
    assert.equal(initialTimelineRes.status, 200);
    const initialTimelineBody = await initialTimelineRes.json();
    const initialTimeline = initialTimelineBody.timeline;
    assert.equal(initialTimeline.version, 1);

    const clipId = `clip_day21_${randomUUID().replace(/-/g, "")}`;
    const opPayload = { id: clipId, assetId: assetBody.asset.id, start: 0, end: 10, in: 0, out: 10 };
    const firstOp = { op: TIMELINE_OPS.INSERT_CLIP, actor: "human", timelineId: initialTimeline.id, trackId: "trk_v1", clipId, payload: opPayload, createdAt: "2026-06-19T00:00:00.000Z" };
    const applied = applyOp(initialTimeline.doc, firstOp);
    const secondOp = { op: TIMELINE_OPS.SET_CLIP_COLOR, actor: "human", timelineId: initialTimeline.id, trackId: "trk_v1", clipId, payload: { color: { basic: { exposure: 0 }, creative: { lut: { id: "none", intensity: 0 } }, curves: { master: [], r: [] } } }, createdAt: "2026-06-19T00:00:01.000Z" };
    const opsRes = await fetch(`${endpoint1.baseUrl}/api/timelines/${projectId}/ops`, {
      method: "POST",
      headers,
      body: JSON.stringify({ baseVersion: initialTimeline.version, actor: "human", ops: [firstOp, secondOp] }),
    });
    const opsText = await opsRes.text();
    assert.equal(opsRes.status, 200, opsText);
    const opsBody = JSON.parse(opsText);
    assert.equal(opsBody.version, 3);
    assert.deepEqual(opsBody.doc.tracks[0].clips.map((clip) => clip.id), [clipId]);

    const assetListRes = await fetch(`${endpoint1.baseUrl}/api/assets?project_id=${projectId}`, { headers });
    assert.equal(assetListRes.status, 200);
    const assetListBody = await assetListRes.json();
    assert.equal(assetListBody.assets.length, 1);

    await endpoint1.close();
    await pool1.end();
    pool1 = null;

    pool2 = new Pool({ connectionString: PG_URL, max: 5 });
    await applyMigrations(pool2);
    const { server: reloadedServer } = buildServer({
      secret: SECRET,
      pool: pool2,
      llm: mockLlm(),
      port: 0,
      host: "127.0.0.1",
    });
    endpoint2 = await listen(reloadedServer);

    const reloadedTimelineRes = await fetch(`${endpoint2.baseUrl}/api/timelines/${projectId}`, { headers });
    assert.equal(reloadedTimelineRes.status, 200);
    const reloadedTimelineBody = await reloadedTimelineRes.json();
    const reloadedTimeline = reloadedTimelineBody.timeline;
    assert.equal(reloadedTimeline.version, 3);
    assert.deepEqual(reloadedTimeline.doc.tracks[0].clips.map((clip) => clip.id), [clipId]);

    const reloadedAssetListRes = await fetch(`${endpoint2.baseUrl}/api/assets?project_id=${projectId}`, { headers });
    assert.equal(reloadedAssetListRes.status, 200);
    const reloadedAssetListBody = await reloadedAssetListRes.json();
    assert.equal(reloadedAssetListBody.assets.length, 1);
    const persistedAsset = reloadedAssetListBody.assets[0];
    assert.equal(persistedAsset.real_decode, true);
    assert.equal(persistedAsset.width, 1280);
    assert.equal(persistedAsset.height, 720);
    assert.equal(persistedAsset.duration, 10);
    assert.equal(persistedAsset.fps, 30);
    assert.equal(persistedAsset.video_codec, "h264");
    assert.equal(persistedAsset.has_audio, true);
    assert.equal(persistedAsset.container, "mp4");
    assert.equal(persistedAsset.source_uri, "tus://sample_10s");
    assert.equal(persistedAsset.upload_id, "upload_day21_persistence");
    await endpoint2.close();
    endpoint2 = null;
    await pool2.end();
    pool2 = null;
  } finally {
    if (endpoint2) await endpoint2.close();
    if (endpoint1) await endpoint1.close();
    if (pool2) await pool2.end();
    if (pool1) await pool1.end();
  }
});
