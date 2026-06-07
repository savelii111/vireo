// Unit tests for MemoryStore + PostgresStore (with MockPool).
import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryStore, PostgresStore, NullStore, createStore } from "../src/index.js";
import { MockPool } from "../src/mock_pool.js";

const sampleJob = (overrides = {}) => ({
  content_id: "c1",
  platform: "youtube",
  scheduled_at: "2026-06-15T15:00:00Z",
  status: "pending",
  metadata: { foo: "bar" },
  ...overrides,
});

const sampleAudit = (overrides = {}) => ({
  job_id: "j1",
  content_id: "c1",
  platform: "youtube",
  platform_post_id: "yt_abc",
  published_at: new Date().toISOString(),
  ai_generated: true,
  eu_ai_act_logged: true,
  ...overrides,
});

const sampleMetric = (overrides = {}) => ({
  content_id: "c1",
  platform: "tiktok",
  views: 1000,
  likes: 50,
  comments: 5,
  shares: 2,
  saves: 1,
  engagement_rate: 0.058,
  captured_at: new Date().toISOString(),
  ...overrides,
});

async function makeStore(kind) {
  if (kind === "memory") return new MemoryStore();
  if (kind === "postgres") {
    const pool = new MockPool();
    const s = new PostgresStore({ mockPool: pool });
    await s.init();
    return s;
  }
  if (kind === "null") return new NullStore();
  throw new Error("unknown");
}

for (const kind of ["memory", "postgres"]) {
  test(`${kind}: addJob + listJobs roundtrip`, async () => {
    const s = await makeStore(kind);
    const j = await s.addJob(sampleJob());
    assert.ok(j.id);
    const list = await s.listJobs();
    assert.equal(list.length, 1);
    assert.equal(list[0].platform, "youtube");
    assert.equal(list[0].status, "pending");
  });

  test(`${kind}: listJobs filters by platform`, async () => {
    const s = await makeStore(kind);
    await s.addJob(sampleJob({ platform: "youtube" }));
    await s.addJob(sampleJob({ platform: "x" }));
    const yt = await s.listJobs({ platform: "youtube" });
    assert.equal(yt.length, 1);
    assert.equal(yt[0].platform, "youtube");
  });

  test(`${kind}: listJobs filters by status`, async () => {
    const s = await makeStore(kind);
    const j = await s.addJob(sampleJob());
    await s.updateJob(j.id, { status: "published" });
    const published = await s.listJobs({ status: "published" });
    assert.equal(published.length, 1);
  });

  test(`${kind}: getJob returns null for missing`, async () => {
    const s = await makeStore(kind);
    const r = await s.getJob("nope");
    assert.equal(r, null);
  });

  test(`${kind}: updateJob patches`, async () => {
    const s = await makeStore(kind);
    const j = await s.addJob(sampleJob());
    const updated = await s.updateJob(j.id, { status: "published", platform_post_id: "yt_1" });
    assert.equal(updated.status, "published");
    assert.equal(updated.platform_post_id, "yt_1");
  });

  test(`${kind}: addAudit + listAudit`, async () => {
    const s = await makeStore(kind);
    await s.addAudit(sampleAudit());
    await s.addAudit(sampleAudit({ platform: "x" }));
    const log = await s.listAudit();
    assert.equal(log.length, 2);
  });

  test(`${kind}: listAudit filters`, async () => {
    const s = await makeStore(kind);
    await s.addAudit(sampleAudit({ content_id: "c1" }));
    await s.addAudit(sampleAudit({ content_id: "c2" }));
    const r = await s.listAudit({ content_id: "c1" });
    assert.equal(r.length, 1);
    assert.equal(r[0].content_id, "c1");
  });

  test(`${kind}: addMetric + listMetrics`, async () => {
    const s = await makeStore(kind);
    await s.addMetric(sampleMetric());
    await s.addMetric(sampleMetric({ platform: "x" }));
    const m = await s.listMetrics();
    assert.equal(m.length, 2);
  });

  test(`${kind}: listMetrics filters by platform`, async () => {
    const s = await makeStore(kind);
    await s.addMetric(sampleMetric({ platform: "tiktok" }));
    await s.addMetric(sampleMetric({ platform: "x" }));
    const t = await s.listMetrics({ platform: "tiktok" });
    assert.equal(t.length, 1);
  });

  test(`${kind}: preserves JSON metadata`, async () => {
    const s = await makeStore(kind);
    await s.addJob(sampleJob({ metadata: { nested: { a: 1 }, arr: [1, 2, 3] } }));
    const list = await s.listJobs();
    assert.deepEqual(list[0].metadata, { nested: { a: 1 }, arr: [1, 2, 3] });
  });
}

// NullStore should throw on every op
test("null: addJob throws", async () => {
  const s = new NullStore();
  await assert.rejects(() => s.addJob(sampleJob()), /not configured/);
});

test("null: listJobs throws", async () => {
  const s = new NullStore();
  await assert.rejects(() => s.listJobs(), /not configured/);
});

test("null: addMetric throws", async () => {
  const s = new NullStore();
  await assert.rejects(() => s.addMetric(sampleMetric()), /not configured/);
});

test("null: addAudit throws", async () => {
  const s = new NullStore();
  await assert.rejects(() => s.addAudit(sampleAudit()), /not configured/);
});

// createStore factory
test("createStore: defaults to memory", () => {
  const prev = process.env.VIREO_STORE;
  delete process.env.VIREO_STORE;
  const s = createStore();
  assert.equal(s.name, "memory");
  process.env.VIREO_STORE = prev;
});

test("createStore: respects VIREO_STORE=memory", () => {
  const prev = process.env.VIREO_STORE;
  process.env.VIREO_STORE = "memory";
  const s = createStore();
  assert.equal(s.name, "memory");
  process.env.VIREO_STORE = prev;
});

test("createStore: postgres without URL throws on init", async () => {
  const prev = process.env.VIREO_STORE;
  process.env.VIREO_STORE = "postgres";
  delete process.env.VIREO_PG_URL;
  const s = createStore();
  await assert.rejects(() => s.init(), /VIREO_PG_URL/);
  process.env.VIREO_STORE = prev;
});

test("createStore: postgres with mockPool works", async () => {
  const pool = new MockPool();
  const s = createStore({ kind: "postgres", mockPool: pool });
  await s.init();
  assert.equal(s.name, "postgres");
  await s.close();
});

// PostgresStore specific: connection failure surfaces clearly
test("postgres: query errors propagate", async () => {
  const pool = new MockPool();
  const s = new PostgresStore({ mockPool: pool });
  await s.init();
  // Inject failure on next query
  pool.shouldFailNext = new Error("ECONNREFUSED");
  await assert.rejects(() => s.addJob(sampleJob()), /ECONNREFUSED/);
  await s.close();
});

test("postgres: requires init() before use", async () => {
  const pool = new MockPool();
  const s = new PostgresStore({ mockPool: pool });
  await assert.rejects(() => s.addJob(sampleJob()), /init\(\)/);
});
