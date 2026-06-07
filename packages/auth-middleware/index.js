// Vireo shared auth middleware — protects agent HTTP APIs with JWT.
//
// Usage:
//   import { authMiddleware, readJsonBody, publicUser } from "@vireo/auth-middleware";
//   const auth = authMiddleware(process.env.VIREO_JWT_SECRET);
//
//   server.on("request", async (req, res) => {
//     await new Promise((r) => auth(req, res, r));
//     if (res.writableEnded) return;  // unauthorized
//     // req.user is now populated
//   });
//
// This is a thin wrapper around the auth agent's middleware. It depends only
// on `node:crypto` and ships as zero-dep so any agent can use it.

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// ---------- Password hashing (scrypt) ----------

export function hashPassword(password) {
  if (!password || password.length < 8) {
    throw new PasswordTooShortError("password must be at least 8 characters");
  }
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith("scrypt$")) return false;
  const [, saltHex, hashHex] = stored.split("$");
  if (!saltHex || !hashHex) return false;
  try {
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    const actual = scryptSync(password, salt, expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export class PasswordTooShortError extends Error {
  constructor(message) { super(message); this.name = "PasswordTooShortError"; }
}

// ---------- JWT (HS256) ----------

function b64url(buf) {
  return Buffer.from(buf).toString("base64")
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function b64urlDecode(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64");
}

export function signToken(claims, secret, ttlSec = 24 * 3600) {
  if (!secret) throw new Error("signToken: secret is required");
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = { iat: now, exp: now + ttlSec, jti: randomBytes(8).toString("hex"), ...claims };
  const headerB64 = b64url(JSON.stringify(header));
  const payloadB64 = b64url(JSON.stringify(payload));
  const data = `${headerB64}.${payloadB64}`;
  const sig = b64url(createHmac("sha256", secret).update(data).digest());
  return `${data}.${sig}`;
}

export function verifyToken(token, secret, { clockSkewSec = 30 } = {}) {
  if (!token || !secret) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sig] = parts;
  let expected;
  try {
    expected = b64url(createHmac("sha256", secret).update(`${headerB64}.${payloadB64}`).digest());
  } catch { return null; }
  if (expected.length !== sig.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  } catch { return null; }
  let payload;
  try { payload = JSON.parse(b64urlDecode(payloadB64).toString("utf-8")); }
  catch { return null; }
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp != null && now > payload.exp + clockSkewSec) return null;
  return payload;
}

// ---------- HTTP middleware ----------

export function readJsonBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const length = Number(req.headers["content-length"] || 0);
    if (length > maxBytes) {
      const err = new Error("payload too large");
      err.statusCode = 413;
      reject(err);
      return;
    }
    if (length === 0) {
      resolve({});
      return;
    }
    const chunks = [];
    let received = 0;
    req.on("data", (c) => {
      received += c.length;
      if (received > maxBytes) {
        const err = new Error("payload too large");
        err.statusCode = 413;
        req.destroy();
        reject(err);
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8");
      if (!raw) { resolve({}); return; }
      try { resolve(JSON.parse(raw)); }
      catch { reject(Object.assign(new Error("invalid json"), { statusCode: 400 })); }
    });
    req.on("error", reject);
  });
}

export function readRawBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const length = Number(req.headers["content-length"] || 0);
    if (length > maxBytes) {
      const err = new Error("payload too large");
      err.statusCode = 413;
      reject(err);
      return;
    }
    const chunks = [];
    let received = 0;
    req.on("data", (c) => {
      received += c.length;
      if (received > maxBytes) {
        const err = new Error("payload too large");
        err.statusCode = 413;
        req.destroy();
        reject(err);
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

export function authMiddleware(secret, { optional = false } = {}) {
  return function auth(req, res, next) {
    if (!secret) {
      sendJson(res, 500, { error: "server_misconfigured", message: "auth secret not set" });
      return;
    }
    const authHeader = req.headers["authorization"] || "";
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      if (optional) return next();
      sendJson(res, 401, { error: "unauthorized", message: "missing or invalid Authorization header" });
      return;
    }
    const claims = verifyToken(match[1], secret);
    if (!claims) {
      sendJson(res, 401, { error: "unauthorized", message: "invalid or expired token" });
      return;
    }
    req.user = {
      id: claims.sub,
      email: claims.email,
      name: claims.name,
      plan: claims.plan || "free",
    };
    req.token = claims;
    next();
  };
}

// ---------- CORS / preflight ----------

// CORS origin whitelist. Reads VIREO_CORS_ORIGINS at call time (not module
// load) so a change to the env var (e.g. docker restart) is picked up
// without a process restart.
//
// Format: comma-separated, e.g. "https://app.vireo.io,https://staging.vireo.io"
// Special values: "*" (any origin), "null" (file:// origin).
function parseCorsOrigins() {
  const raw = (process.env.VIREO_CORS_ORIGINS || "*").trim();
  if (raw === "*") return ["*"];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

// Returns the CORS headers object for a specific request. Picks the
// right Access-Control-Allow-Origin based on the request's Origin header
// and the configured allow-list.
export function corsHeadersFor(req) {
  const allowed = parseCorsOrigins();
  const origin = req?.headers?.origin;
  let allowOrigin = "*";
  if (allowed.length && !allowed.includes("*") && origin) {
    if (allowed.includes(origin)) allowOrigin = origin;
    else allowOrigin = allowed[0] || "*"; // fall back to first allow-listed
  }
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS, PUT",
    "Vary": "Origin", // ensure caches don't return wrong origin
  };
}

// Backward-compat: static wildcard headers for pre-middleware code that
// doesn't have a request object handy. Prefer corsHeadersFor(req) when
// possible.
export function corsHeaders() {
  return corsHeadersFor({ headers: {} });
}

// ---------- Rate limiter (in-memory, per-IP) ----------

export class RateLimiter {
  /**
   * @param {object} opts
   * @param {number} opts.max    - max requests per window
   * @param {number} opts.windowMs - window size in ms
   */
  constructor({ max = 60, windowMs = 60_000 } = {}) {
    this.max = max;
    this.windowMs = windowMs;
    this.buckets = new Map(); // key -> { count, resetAt }
  }

  check(key = "global") {
    const now = Date.now();
    let b = this.buckets.get(key);
    if (!b || b.resetAt < now) {
      b = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(key, b);
    }
    b.count++;
    if (b.count > this.max) {
      return { allowed: false, retryAfterMs: b.resetAt - now, count: b.count };
    }
    return { allowed: true, remaining: this.max - b.count, count: b.count };
  }

  middleware(req, res, next) {
    const key = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "global").toString().split(",")[0].trim();
    const r = this.check(key);
    res.setHeader("X-RateLimit-Limit", String(this.max));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, this.max - r.count)));
    if (!r.allowed) {
      res.setHeader("Retry-After", String(Math.ceil(r.retryAfterMs / 1000)));
      sendJson(res, 429, { error: "rate_limited", message: "too many requests" });
      return;
    }
    next();
  }

  reset() { this.buckets.clear(); }
}
