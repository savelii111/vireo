// cache.js — LRU cache with TTL support for Vireo Studio.
//
// Provides a fixed-capacity, least-recently-used cache where each entry can
// optionally expire after a configurable time-to-live. Expired entries are
// lazily evicted on read and swept periodically by an automatic cleanup timer.
//
// Usage:
//   import { LRUCache } from "./cache.js";
//   const cache = new LRUCache({ maxEntries: 500, defaultTTL_ms: 300_000 });
//   cache.set("key", { data: 1 });
//   cache.get("key"); // { data: 1 }
//
// Design:
//   - Backed by a Map which preserves insertion order.
//   - On get(), the entry is deleted and re-inserted to move it to the
//     "most recently used" end of the Map.
//   - The first entry in iteration order is the least recently used.
//   - On set(), if maxEntries is exceeded the LRU entry is evicted first.

/**
 * LRU cache with per-entry TTL.
 */
export class LRUCache {
  /**
   * @param {object} opts
   * @param {number} [opts.maxEntries=500]       — max entries before LRU eviction
   * @param {number} [opts.defaultTTL_ms=300_000] — default TTL in ms (0 = no expiry)
   * @param {number} [opts.cleanupIntervalMs=60_000] — sweep interval (0 = disabled)
   */
  constructor({ maxEntries = 500, defaultTTL_ms = 300_000, cleanupIntervalMs = 60_000 } = {}) {
    if (maxEntries <= 0) throw new Error("maxEntries must be positive");

    /** @type {Map<string, { value: any, expiresAt: number }>} */
    this._map = new Map();
    this._maxEntries = maxEntries;
    this._defaultTTL_ms = defaultTTL_ms;

    this._cleanupIntervalMs = cleanupIntervalMs;
    this._cleanupTimer = null;
    if (cleanupIntervalMs > 0) {
      this._cleanupTimer = setInterval(() => this._sweep(), cleanupIntervalMs);
      if (this._cleanupTimer.unref) this._cleanupTimer.unref();
    }
  }

  // ── Public API ────────────────────────────────────────────────────────

  /**
   * Retrieve a value by key. Returns undefined if missing or expired.
   * Accessing an entry refreshes its LRU position.
   *
   * @param {string} key
   * @returns {any|undefined}
   */
  get(key) {
    const entry = this._map.get(key);
    if (!entry) return undefined;

    // Lazy-expire check
    if (entry.expiresAt !== 0 && Date.now() >= entry.expiresAt) {
      this._map.delete(key);
      return undefined;
    }

    // Promote to most-recently-used: delete then re-insert.
    this._map.delete(key);
    this._map.set(key, entry);
    return entry.value;
  }

  /**
   * Store a value with an optional per-entry TTL.
   *
   * @param {string} key
   * @param {any}    value
   * @param {number} [ttl_ms] — override default TTL for this entry (0 = no expiry)
   */
  set(key, value, ttl_ms) {
    const ttl = ttl_ms !== undefined ? ttl_ms : this._defaultTTL_ms;

    // Compute expiry timestamp. 0 → no expiry. Negative → treat as 0.
    const expiresAt = ttl > 0 ? Date.now() + ttl : 0;

    // If key already exists, delete first so re-insertion places it at the end.
    if (this._map.has(key)) {
      this._map.delete(key);
    } else {
      // Evict LRU if at capacity.
      this._evictIfNeeded();
    }

    this._map.set(key, { value, expiresAt });
  }

  /**
   * Remove an entry by key.
   * @param {string} key
   * @returns {boolean} true if the entry existed
   */
  delete(key) {
    return this._map.delete(key);
  }

  /**
   * Check whether a non-expired entry exists for the given key.
   * @param {string} key
   * @returns {boolean}
   */
  has(key) {
    const entry = this._map.get(key);
    if (!entry) return false;
    if (entry.expiresAt !== 0 && Date.now() >= entry.expiresAt) {
      this._map.delete(key);
      return false;
    }
    return true;
  }

  /** Remove all entries. */
  clear() {
    this._map.clear();
  }

  /** Current number of (possibly stale) entries. */
  get size() {
    return this._map.size;
  }

  /**
   * Return a snapshot of all non-expired entries.
   * @returns {{ key: string, value: any, expiresAt: number }[]}
   */
  entries() {
    const now = Date.now();
    const result = [];
    for (const [key, entry] of this._map) {
      if (entry.expiresAt === 0 || now < entry.expiresAt) {
        result.push({ key, value: entry.value, expiresAt: entry.expiresAt });
      }
    }
    return result;
  }

  // ── Internal helpers ──────────────────────────────────────────────────

  /** Evict the least-recently-used entry if at capacity. */
  _evictIfNeeded() {
    if (this._map.size >= this._maxEntries) {
      // First key in Map iteration order is the LRU entry.
      const firstKey = this._map.keys().next().value;
      this._map.delete(firstKey);
    }
  }

  /**
   * Sweep expired entries. Called automatically on interval; can also be
   * called manually.
   * @returns {number} number of entries removed
   */
  _sweep() {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this._map) {
      if (entry.expiresAt !== 0 && now >= entry.expiresAt) {
        this._map.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /**
   * Stop the automatic cleanup timer. Call before discarding the cache
   * to avoid lingering timers.
   */
  stopCleanup() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
  }
}
