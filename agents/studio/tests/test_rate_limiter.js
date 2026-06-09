// test_rate_limiter.js — Tests for the standalone rate limiter module.
//
// Validates:
//   1. Requests within limit are allowed
//   2. Requests exceeding limit are blocked
//   3. Window reset after expiry
//   4. Different keys are independent
//   5. Cleanup removes expired entries
//   6. Configurable window and max
//   7. Remaining count is accurate
//   8. Concurrent access safety (Node is single-threaded but we test rapid-fire)

import { test } from "node:test";
import assert from "node:assert/strict";
import { RateLimiter, rateLimitMiddleware } from "../src/rate_limiter.js";

// =====================================================================
// 1. rateLimiter: allows requests within limit
// =====================================================================

test("allows requests within the configured limit", () => {
  const rl = new RateLimiter({ windowMs: 10_000, maxRequests: 5, cleanupIntervalMs: 0 });
  try {
    for (let i = 0; i < 5; i++) {
      const r = rl.check("user-A");
      assert.equal(r.allowed, true, `request ${i + 1} should be allowed`);
    }
  } finally {
    rl.stopCleanup();
  }
});

// =====================================================================
// 2. rateLimiter: blocks when limit exceeded
// =====================================================================

test("blocks the (maxRequests + 1)th request", () => {
  const rl = new RateLimiter({ windowMs: 10_000, maxRequests: 3, cleanupIntervalMs: 0 });
  try {
    rl.check("user-B"); // 1
    rl.check("user-B"); // 2
    rl.check("user-B"); // 3 — last allowed
    const r = rl.check("user-B"); // 4 — over limit
    assert.equal(r.allowed, false);
    assert.equal(r.remaining, 0);
    assert.ok(r.retryAfterMs > 0, "retryAfterMs should be positive");
  } finally {
    rl.stopCleanup();
  }
});

// =====================================================================
// 3. rateLimiter: resets after window expires
// =====================================================================

test("resets counter after window expires", async () => {
  const rl = new RateLimiter({ windowMs: 100, maxRequests: 2, cleanupIntervalMs: 0 });
  try {
    rl.check("user-C");
    rl.check("user-C");
    // Third should be blocked
    let r = rl.check("user-C");
    assert.equal(r.allowed, false);

    // Wait for window to expire
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Now should be allowed again (new window)
    r = rl.check("user-C");
    assert.equal(r.allowed, true);
    assert.equal(r.remaining, 1); // 1 of 2 used
  } finally {
    rl.stopCleanup();
  }
});

// =====================================================================
// 4. rateLimiter: different keys are independent
// =====================================================================

test("different keys have independent counters", () => {
  const rl = new RateLimiter({ windowMs: 10_000, maxRequests: 2, cleanupIntervalMs: 0 });
  try {
    // Exhaust key-X
    rl.check("key-X");
    rl.check("key-X");
    const blocked = rl.check("key-X");
    assert.equal(blocked.allowed, false, "key-X should be blocked");

    // key-Y should still be fresh
    const allowed = rl.check("key-Y");
    assert.equal(allowed.allowed, true, "key-Y should be allowed");
    assert.equal(allowed.remaining, 1);
  } finally {
    rl.stopCleanup();
  }
});

// =====================================================================
// 5. rateLimiter: cleanup removes old entries
// =====================================================================

test("cleanup() removes expired entries and returns count", async () => {
  const rl = new RateLimiter({ windowMs: 80, maxRequests: 10, cleanupIntervalMs: 0 });
  try {
    rl.check("a");
    rl.check("b");
    rl.check("c");
    assert.equal(rl.size, 3, "should have 3 entries before cleanup");

    // Wait for all windows to expire
    await new Promise((resolve) => setTimeout(resolve, 120));

    const removed = rl.cleanup();
    assert.equal(removed, 3, "cleanup should remove all 3 expired entries");
    assert.equal(rl.size, 0, "buckets should be empty after cleanup");
  } finally {
    rl.stopCleanup();
  }
});

test("cleanup() does not remove entries that are still valid", async () => {
  const rl = new RateLimiter({ windowMs: 500, maxRequests: 10, cleanupIntervalMs: 0 });
  try {
    rl.check("fresh");
    await new Promise((resolve) => setTimeout(resolve, 50));
    const removed = rl.cleanup();
    assert.equal(removed, 0, "no entries should be removed yet");
    assert.equal(rl.size, 1);
  } finally {
    rl.stopCleanup();
  }
});

// =====================================================================
// 6. rateLimiter: configurable window and max
// =====================================================================

test("respects custom windowMs and maxRequests", async () => {
  const rl = new RateLimiter({ windowMs: 80, maxRequests: 1, cleanupIntervalMs: 0 });
  try {
    const r1 = rl.check("custom");
    assert.equal(r1.allowed, true);

    // Immediate second should be blocked (max=1)
    const r2 = rl.check("custom");
    assert.equal(r2.allowed, false);

    // Wait for window to reset
    await new Promise((resolve) => setTimeout(resolve, 120));

    const r3 = rl.check("custom");
    assert.equal(r3.allowed, true, "should be allowed after window reset");
  } finally {
    rl.stopCleanup();
  }
});

test("constructor rejects invalid options", () => {
  assert.throws(() => new RateLimiter({ windowMs: 0 }), /windowMs must be positive/);
  assert.throws(() => new RateLimiter({ maxRequests: -5 }), /maxRequests must be positive/);
});

// =====================================================================
// 7. rateLimiter: returns correct remaining count
// =====================================================================

test("remaining count decrements correctly", () => {
  const rl = new RateLimiter({ windowMs: 10_000, maxRequests: 5, cleanupIntervalMs: 0 });
  try {
    const r1 = rl.check("rem");
    assert.equal(r1.remaining, 4, "after 1 request, 4 remaining");

    const r2 = rl.check("rem");
    assert.equal(r2.remaining, 3, "after 2 requests, 3 remaining");

    rl.check("rem");
    rl.check("rem");
    const r5 = rl.check("rem");
    assert.equal(r5.remaining, 0, "after 5 requests, 0 remaining");

    const r6 = rl.check("rem");
    assert.equal(r6.remaining, 0, "over-limit request still shows 0 remaining");
  } finally {
    rl.stopCleanup();
  }
});

test("resetAt is a future timestamp", () => {
  const rl = new RateLimiter({ windowMs: 5_000, maxRequests: 10, cleanupIntervalMs: 0 });
  try {
    const r = rl.check("ts");
    assert.ok(r.resetAt > Date.now(), "resetAt should be in the future");
    assert.ok(r.resetAt <= Date.now() + 5_000, "resetAt should be within the window");
  } finally {
    rl.stopCleanup();
  }
});

// =====================================================================
// 8. rateLimiter: handles rapid-fire access safely
// =====================================================================

test("handles rapid-fire requests without corruption", () => {
  const rl = new RateLimiter({ windowMs: 10_000, maxRequests: 100, cleanupIntervalMs: 0 });
  try {
    let allowedCount = 0;
    let blockedCount = 0;

    // Fire 200 requests at a single key — should get exactly 100 allowed
    for (let i = 0; i < 200; i++) {
      const r = rl.check("rapid");
      if (r.allowed) allowedCount++;
      else blockedCount++;
    }

    assert.equal(allowedCount, 100, "exactly 100 requests should be allowed");
    assert.equal(blockedCount, 100, "exactly 100 requests should be blocked");
    // The counter should reflect the total count
    const bucket = rl.buckets.get("rapid");
    assert.equal(bucket.count, 200, "internal counter should be 200");
  } finally {
    rl.stopCleanup();
  }
});

test("multiple keys under rapid fire are independent", () => {
  const rl = new RateLimiter({ windowMs: 10_000, maxRequests: 3, cleanupIntervalMs: 0 });
  try {
    // Exhaust key-1
    rl.check("key-1");
    rl.check("key-1");
    rl.check("key-1");
    const blocked1 = rl.check("key-1");
    assert.equal(blocked1.allowed, false);

    // key-2 should have full quota
    const r2 = rl.check("key-2");
    assert.equal(r2.allowed, true);
    assert.equal(r2.remaining, 2);

    // key-3 should also have full quota
    const r3 = rl.check("key-3");
    assert.equal(r3.allowed, true);
    assert.equal(r3.remaining, 2);
  } finally {
    rl.stopCleanup();
  }
});

// =====================================================================
// Bonus: rateLimitMiddleware factory
// =====================================================================

test("rateLimitMiddleware returns a function", () => {
  const mw = rateLimitMiddleware({ windowMs: 1_000, maxRequests: 10 });
  assert.equal(typeof mw, "function");
});

test("rateLimitMiddleware sets rate-limit headers and calls next", () => {
  const mw = rateLimitMiddleware({ windowMs: 10_000, maxRequests: 5 });

  const headers = {};
  const fakeReq = {
    headers: { "x-forwarded-for": "10.0.0.1" },
    socket: { remoteAddress: "127.0.0.1" },
  };
  const fakeRes = {
    setHeader: (k, v) => { headers[k] = v; },
  };

  let nextCalled = false;
  mw(fakeReq, fakeRes, () => { nextCalled = true; });

  assert.equal(nextCalled, true, "next() should be called for allowed request");
  assert.equal(headers["X-RateLimit-Limit"], "5");
  assert.equal(headers["X-RateLimit-Remaining"], "4");
});

test("rateLimitMiddleware blocks with 429 and Retry-After when over limit", () => {
  const mw = rateLimitMiddleware({ windowMs: 10_000, maxRequests: 1 });

  const headers = {};
  let ended = false;
  let statusCode = 0;
  let body = "";

  const fakeReq = {
    headers: { "x-forwarded-for": "10.0.0.2" },
    socket: { remoteAddress: "127.0.0.1" },
  };
  const fakeRes = {
    setHeader: (k, v) => { headers[k] = v; },
    writeHead: (status) => { statusCode = status; },
    end: (data) => { ended = true; body = data; },
  };

  // First request — allowed
  let nextCalled = false;
  mw(fakeReq, fakeRes, () => { nextCalled = true; });
  assert.equal(nextCalled, true);

  // Second request — should be blocked
  nextCalled = false;
  mw(fakeReq, fakeRes, () => { nextCalled = true; });
  assert.equal(nextCalled, false, "next() should NOT be called when rate-limited");
  assert.equal(statusCode, 429);
  assert.ok(headers["Retry-After"], "Retry-After header should be set");
  const parsed = JSON.parse(body);
  assert.equal(parsed.error, "rate_limited");
});

test("rateLimitMiddleware falls back to socket.remoteAddress when no x-forwarded-for", () => {
  const mw = rateLimitMiddleware({ windowMs: 10_000, maxRequests: 1 });

  const headers = {};
  const fakeReq = {
    headers: {}, // no x-forwarded-for
    socket: { remoteAddress: "192.168.0.50" },
  };
  const fakeRes = {
    setHeader: (k, v) => { headers[k] = v; },
    writeHead: () => {},
    end: () => {},
  };

  mw(fakeReq, fakeRes, () => {});
  // Should have created a bucket for "192.168.0.50"
  // Second call with same socket should be blocked
  mw(fakeReq, fakeRes, () => {});
  assert.equal(headers["X-RateLimit-Remaining"], "0");
});
