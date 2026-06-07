// Vireo infra — exports three things:
//   - Queue (Postgres-backed: `SELECT ... FOR UPDATE SKIP LOCKED`)
//   - Redis (minimal RESP client over `net`)
//   - S3Client (HTTPS to MinIO or AWS S3, SigV4 signed)
//
// Zero heavy deps: uses only `net`, `node:crypto`, `node:https`/`http`, and `pg` (optional).
// Falls back to in-memory if Postgres is not available (dev mode).

import { Queue, InMemoryQueue, PostgresQueue, NullQueue } from "./queue.js";
import { Redis, InMemoryRedis, NullRedis } from "./redis.js";
import { S3Client, S3Error } from "./s3.js";

export { Queue, InMemoryQueue, PostgresQueue, NullQueue } from "./queue.js";
export { Redis, InMemoryRedis, NullRedis } from "./redis.js";
export { S3Client, S3Error } from "./s3.js";

/**
 * Create a Queue based on env.
 *   VIREO_QUEUE=memory   -> InMemoryQueue (default in dev)
 *   VIREO_QUEUE=postgres -> PostgresQueue using VIREO_PG_URL
 *   VIREO_QUEUE=null     -> NullQueue (throws on enqueue)
 */
export function createQueue({ kind, url, mockPool } = {}) {
  const envKind = (kind ?? process.env.VIREO_QUEUE ?? "memory").toLowerCase();
  if (envKind === "postgres") return new PostgresQueue({ url: url ?? process.env.VIREO_PG_URL, mockPool });
  if (envKind === "memory") return new InMemoryQueue();
  if (envKind === "null") return new NullQueue();
  throw new Error(`Unknown queue kind: ${envKind}`);
}

/**
 * Create a Redis client based on env.
 *   VIREO_REDIS=memory   -> InMemoryRedis (default in dev)
 *   VIREO_REDIS=tcp      -> Redis tcp using VIREO_REDIS_URL (redis://host:port)
 *   VIREO_REDIS=null     -> NullRedis
 */
export function createRedis({ kind, url } = {}) {
  const envKind = (kind ?? process.env.VIREO_REDIS ?? "memory").toLowerCase();
  if (envKind === "tcp") return new Redis({ url: url ?? process.env.VIREO_REDIS_URL ?? "redis://127.0.0.1:6379" });
  if (envKind === "memory") return new InMemoryRedis();
  if (envKind === "null") return new NullRedis();
  throw new Error(`Unknown redis kind: ${envKind}`);
}

/**
 * Create an S3 client based on env.
 *   S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY, S3_REGION
 */
export function createS3(opts = {}) {
  return new S3Client({
    endpoint: opts.endpoint ?? process.env.S3_ENDPOINT,
    bucket: opts.bucket ?? process.env.S3_BUCKET ?? "vireo",
    accessKey: opts.accessKey ?? process.env.S3_ACCESS_KEY,
    secretKey: opts.secretKey ?? process.env.S3_SECRET_KEY,
    region: opts.region ?? process.env.S3_REGION ?? "us-east-1",
    publicBaseUrl: opts.publicBaseUrl ?? process.env.S3_PUBLIC_BASE_URL,
  });
}
