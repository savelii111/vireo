import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryQueue, NullQueue, InMemoryRedis, NullRedis, S3Client, S3Error, createQueue, createRedis, createS3 } from "../src/index.js";

// ---------- InMemoryQueue ----------
test("InMemoryQueue: enqueue + claim returns the job", async () => {
  const q = new InMemoryQueue();
  const id = await q.enqueue("orders", { user: 1 });
  const job = await q.claim("orders", "worker-1", { visibilityMs: 1000 });
  assert.equal(job.id, id);
  assert.equal(job.payload.user, 1);
  assert.equal(job.attempts, 1);
});

test("InMemoryQueue: claim returns null when empty", async () => {
  const q = new InMemoryQueue();
  const job = await q.claim("orders", "w");
  assert.equal(job, null);
});

test("InMemoryQueue: complete removes from pending", async () => {
  const q = new InMemoryQueue();
  await q.enqueue("q", {});
  const job = await q.claim("q", "w");
  await q.complete(job.id);
  const next = await q.claim("q", "w");
  assert.equal(next, null);
});

test("InMemoryQueue: fail re-queues with backoff when attempts < max", async () => {
  // 50ms backoff for fast tests
  const q = new InMemoryQueue({ backoffMs: () => 50 });
  const id = await q.enqueue("q", {}, { maxAttempts: 3 });
  const j1 = await q.claim("q", "w", { visibilityMs: 10 });
  await q.fail(j1.id, new Error("boom"));
  // Should not be claimable immediately
  const immediate = await q.claim("q", "w");
  assert.equal(immediate, null);
  // After backoff window it should be available
  await new Promise((r) => setTimeout(r, 80));
  const j2 = await q.claim("q", "w");
  assert.ok(j2);
  assert.equal(j2.id, id);
  assert.equal(j2.attempts, 2);
});

test("InMemoryQueue: fail marks failed when attempts >= max", async () => {
  const q = new InMemoryQueue();
  await q.enqueue("q", {}, { maxAttempts: 1 });
  const j = await q.claim("q", "w");
  await q.fail(j.id, new Error("boom"));
  const size = await q.size("q", "failed");
  assert.equal(size, 1);
});

test("InMemoryQueue: size() filters", async () => {
  const q = new InMemoryQueue();
  await q.enqueue("a", {});
  await q.enqueue("a", {});
  await q.enqueue("b", {});
  assert.equal(await q.size(), 3);
  assert.equal(await q.size("a"), 2);
  assert.equal(await q.size("b"), 1);
  assert.equal(await q.size("a", "pending"), 2);
});

test("InMemoryQueue: FIFO ordering", async () => {
  const q = new InMemoryQueue();
  const id1 = await q.enqueue("q", { n: 1 });
  const id2 = await q.enqueue("q", { n: 2 });
  const j1 = await q.claim("q", "w");
  const j2 = await q.claim("q", "w");
  assert.equal(j1.id, id1);
  assert.equal(j2.id, id2);
});

test("NullQueue: enqueue throws", async () => {
  const q = new NullQueue();
  await assert.rejects(() => q.enqueue("q", {}));
});

// ---------- InMemoryRedis ----------
test("InMemoryRedis: set/get", async () => {
  const r = new InMemoryRedis();
  await r.set("k", "v");
  assert.equal(await r.get("k"), "v");
});

test("InMemoryRedis: set with TTL expires", async () => {
  const r = new InMemoryRedis();
  await r.set("k", "v", { exSec: 1 });
  assert.equal(await r.get("k"), "v");
  await new Promise((res) => setTimeout(res, 1100));
  assert.equal(await r.get("k"), null);
});

test("InMemoryRedis: incr", async () => {
  const r = new InMemoryRedis();
  assert.equal(await r.incr("c"), 1);
  assert.equal(await r.incr("c"), 2);
});

test("InMemoryRedis: rpush/lpop is FIFO", async () => {
  const r = new InMemoryRedis();
  await r.rpush("list", "a", "b", "c");
  assert.equal(await r.lpop("list"), "a");
  assert.equal(await r.lpop("list"), "b");
  assert.equal(await r.lpop("list"), "c");
  assert.equal(await r.lpop("list"), null);
});

test("InMemoryRedis: brpop returns next value", async () => {
  const r = new InMemoryRedis();
  await r.rpush("list", "x");
  const r1 = await r.brpop("list", 1);
  assert.equal(r1.value, "x");
  const r2 = await r.brpop("list", 0);
  assert.equal(r2, null);
});

test("InMemoryRedis: publish notifies listeners", async () => {
  const r = new InMemoryRedis();
  let received = null;
  r.on("chan", (ch, msg) => { received = { ch, msg }; });
  await r.publish("chan", "hi");
  assert.deepEqual(received, { ch: "chan", msg: "hi" });
});

test("NullRedis: get returns null", async () => {
  const r = new NullRedis();
  assert.equal(await r.get("k"), null);
});

// ---------- S3 client (no network — error path) ----------
test("S3Client: requires endpoint + bucket", () => {
  assert.throws(() => new S3Client({}));
  assert.throws(() => new S3Client({ endpoint: "http://x", bucket: null }));
});

test("S3Client: presignedGet returns a URL with signature", () => {
  const s3 = new S3Client({
    endpoint: "http://localhost:9000",
    bucket: "vireo",
    accessKey: "ak",
    secretKey: "sk",
    region: "us-east-1",
  });
  const url = s3.presignedGet("videos/abc.mp4", { expiresSec: 600 });
  assert.match(url, /X-Amz-Signature=/);
  assert.match(url, /X-Amz-Expires=600/);
  assert.match(url, /X-Amz-Algorithm=AWS4-HMAC-SHA256/);
});

test("S3Client: presignedGet URL contains the key", () => {
  const s3 = new S3Client({
    endpoint: "http://localhost:9000",
    bucket: "vireo",
    accessKey: "ak",
    secretKey: "sk",
  });
  const url = s3.presignedGet("path/with spaces/file.mp4");
  assert.ok(url.includes("file.mp4"));
  assert.ok(url.includes("/vireo/"));
});

test("S3Error: has code + statusCode", () => {
  const e = new S3Error("bad", "http_404", 404);
  assert.equal(e.code, "http_404");
  assert.equal(e.statusCode, 404);
});

// ---------- Factory: createQueue / createRedis / createS3 ----------
test("createQueue: returns in-memory by default", () => {
  const q = createQueue({ kind: "memory" });
  assert.ok(q instanceof InMemoryQueue);
});

test("createQueue: null kind returns NullQueue", () => {
  const q = createQueue({ kind: "null" });
  assert.ok(q instanceof NullQueue);
});

test("createQueue: unknown kind throws", () => {
  assert.throws(() => createQueue({ kind: "wat" }));
});

test("createRedis: in-memory default", () => {
  const r = createRedis({ kind: "memory" });
  assert.ok(r instanceof InMemoryRedis);
});

test("createRedis: null kind returns NullRedis", () => {
  const r = createRedis({ kind: "null" });
  assert.ok(r instanceof NullRedis);
});

test("createS3: wires env", () => {
  process.env.S3_ENDPOINT = "http://minio:9000";
  process.env.S3_BUCKET = "vireo";
  process.env.S3_ACCESS_KEY = "ak";
  process.env.S3_SECRET_KEY = "sk";
  const s3 = createS3();
  assert.equal(s3.bucket, "vireo");
  delete process.env.S3_ENDPOINT;
  delete process.env.S3_BUCKET;
  delete process.env.S3_ACCESS_KEY;
  delete process.env.S3_SECRET_KEY;
});
