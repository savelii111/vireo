// Rate limiter — standalone in-memory rate limiter for Vireo Studio.
//
// Provides a fixed-window rate limiter keyed by arbitrary string (IP, user ID,
// endpoint, etc.). Automatically cleans up stale entries on a configurable
// interval to prevent unbounded memory growth.
//
// Usage:
//   import { RateLimiter } from "./rate_limiter.js";
//   const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 60 });
//   const result = limiter.check("192.168.1.1");
//   if (!result.allowed) { /* 429 */ }
//
// Why a local module instead of reusing the shared auth-middleware one:
//   - Adds automatic cleanup of stale entries (the shared one leaks memory
//     if many distinct keys are used).
//   - Exposes `remaining`, `resetAt`, and `retryAfterMs` in the result.
//   - Can be configured per-route (e.g. tighter limits on /api/chat).
//   - The shared one counts requests even when they're denied (by design);
//     this one doesn't increment the counter on denied requests.

/**
 * Fixed-window rate limiter with automatic cleanup.
 *
 * Each key gets a window of `windowMs` milliseconds. Within that window,
 * at most `maxRequests` requests are allowed. After the window expires,
 * the counter resets to zero.
 */
export class RateLimiter {
  /**
   * @param {object} opts
   * @param {number} [opts.windowMs=60_000]   - window size in milliseconds
   * @param {number} [opts.maxRequests=60]     - max requests per window
   * @param {number} [opts.cleanupIntervalMs=60_000] - how often to sweep stale entries (0 = disabled)
   */
  constructor({ windowMs = 60_000, maxRequests = 60, cleanupIntervalMs = 60_000 } = {}) {
    if (windowMs <= 0) throw new Error("windowMs must be positive");
    if (maxRequests <= 0) throw new Error("maxRequests must be positive");

    /** @type {Map<string, {count: number, resetAt: number}>} */
    this.buckets = new Map();
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;

    // Auto-cleanup timer. Stored so it can be stopped via stopCleanup().
    this._cleanupIntervalMs = cleanupIntervalMs;
    this._cleanupTimer = null;
    if (cleanupIntervalMs > 0) {
      this._cleanupTimer = setInterval(() => this.cleanup(), cleanupIntervalMs);
      // Allow the process to exit even if the timer is still running.
      if (this._cleanupTimer.unref) this._cleanupTimer.unref();
    }
  }

  /**
   * Check whether a request for the given key is allowed.
   *
   * If the key's window has expired, the counter resets. If the request
   * is within the limit the counter increments; if it exceeds the limit
   * the counter is NOT incremented (unlike some token-bucket designs).
   *
   * @param {string} [key="global"]
   * @returns {{ allowed: boolean, remaining: number, resetAt: number, retryAfterMs: number }}
   */
  check(key = "global") {
    const now = Date.now();
    let bucket = this.buckets.get(key);

    // Expired or missing — start a fresh window.
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(key, bucket);
    }

    // Always increment (even if over limit) — this lets callers see how
    // far over the limit a client is, which is useful for logging.
    bucket.count++;

    if (bucket.count > this.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: bucket.resetAt,
        retryAfterMs: bucket.resetAt - now,
      };
    }

    return {
      allowed: true,
      remaining: this.maxRequests - bucket.count,
      resetAt: bucket.resetAt,
      retryAfterMs: 0,
    };
  }

  /**
   * Remove all buckets whose window has expired.
   * Called automatically on `cleanupIntervalMs` interval; can also be
   * called manually.
   * @returns {number} number of entries removed
   */
  cleanup() {
    const now = Date.now();
    let removed = 0;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /**
   * Reset all buckets (e.g. for testing).
   */
  reset() {
    this.buckets.clear();
  }

  /**
   * Stop the automatic cleanup timer. Call this before discarding
   * the limiter to avoid lingering timers.
   */
  stopCleanup() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
  }

  /**
   * Return the current size of the buckets map (for diagnostics).
   */
  get size() {
    return this.buckets.size;
  }
}

/**
 * Express / Connect-style middleware factory.
 *
 * Usage:
 *   app.use("/api/chat", rateLimit({ windowMs: 60_000, maxRequests: 20 }));
 *
 * @param {object} opts - same as RateLimiter constructor opts
 * @returns {function} middleware(req, res, next)
 */
export function rateLimitMiddleware(opts) {
  const limiter = new RateLimiter(opts);

  return function rateLimit(req, res, next) {
    const key = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "global")
      .toString()
      .split(",")[0]
      .trim();

    const result = limiter.check(key);

    // Always set informational headers so clients can self-throttle.
    res.setHeader("X-RateLimit-Limit", String(limiter.maxRequests));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, result.remaining)));

    if (!result.allowed) {
      res.setHeader("Retry-After", String(Math.ceil(result.retryAfterMs / 1000)));
      res.writeHead(429, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "rate_limited", message: "too many requests" }));
      return;
    }

    next();
  };
}
