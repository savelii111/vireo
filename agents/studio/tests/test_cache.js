// test_cache.js — Comprehensive tests for the LRU cache module.
//
// Validates all public API surface, TTL semantics, LRU eviction order,
// cleanup behavior, edge cases, and memory safety.

import { test } from "node:test";
import assert from "node:assert/strict";
import { LRUCache } from "../src/cache.js";

// Helper: create a cache and auto-stop its cleanup timer after the test.
function makeCache(opts) {
  const cache = new LRUCache({ cleanupIntervalMs: 0, ...opts });
  return cache;
}

// =====================================================================
// 1. get/set basic
// =====================================================================

test("set and get a basic value", () => {
  const cache = makeCache({ defaultTTL_ms: 0 });
  cache.set("foo", 42);
  assert.equal(cache.get("foo"), 42);
});

// =====================================================================
// 2. get returns undefined for missing key
// =====================================================================

test("get returns undefined for missing key", () => {
  const cache = makeCache();
  assert.equal(cache.get("nonexistent"), undefined);
});

// =====================================================================
// 3. set with custom TTL
// =====================================================================

test("set with custom TTL overrides default", async () => {
  const cache = makeCache({ defaultTTL_ms: 10_000 });
  cache.set("short", "lived", 80);
  cache.set("long", "lived", 10_000);

  assert.equal(cache.get("short"), "lived");

  await new Promise((r) => setTimeout(r, 120));

  assert.equal(cache.get("short"), undefined, "custom-TTL entry should expire");
  assert.equal(cache.get("long"), "lived", "long-TTL entry should still exist");

  cache.stopCleanup();
});

// =====================================================================
// 4. entry expires after TTL
// =====================================================================

test("entry expires after its TTL", async () => {
  const cache = makeCache({ defaultTTL_ms: 80 });
  cache.set("key", "value");

  await new Promise((r) => setTimeout(r, 120));

  assert.equal(cache.get("key"), undefined, "expired entry should return undefined");
  assert.equal(cache.has("key"), false, "has() should also return false for expired entry");
});

// =====================================================================
// 5. LRU eviction when maxEntries exceeded
// =====================================================================

test("evicts least-recently-used entry when maxEntries exceeded", () => {
  const cache = makeCache({ maxEntries: 3, defaultTTL_ms: 0 });

  cache.set("a", 1);
  cache.set("b", 2);
  cache.set("c", 3);
  assert.equal(cache.size, 3);

  // Adding a 4th entry should evict "a" (the oldest).
  cache.set("d", 4);
  assert.equal(cache.size, 3);
  assert.equal(cache.get("a"), undefined, "LRU entry 'a' should be evicted");
  assert.equal(cache.get("d"), 4, "newest entry should be present");
});

test("get refreshes LRU position preventing eviction", () => {
  const cache = makeCache({ maxEntries: 3, defaultTTL_ms: 0 });

  cache.set("a", 1);
  cache.set("b", 2);
  cache.set("c", 3);

  // Access "a" to make it MRU.
  cache.get("a");

  // Now "b" is the LRU; adding "d" should evict "b".
  cache.set("d", 4);
  assert.equal(cache.get("b"), undefined, "'b' should be evicted (it was LRU)");
  assert.equal(cache.get("a"), 1, "'a' should survive (recently accessed)");
});

// =====================================================================
// 6. delete removes entry
// =====================================================================

test("delete removes an existing entry", () => {
  const cache = makeCache({ defaultTTL_ms: 0 });
  cache.set("x", "hello");

  assert.equal(cache.has("x"), true);
  const removed = cache.delete("x");
  assert.equal(removed, true);
  assert.equal(cache.has("x"), false);
  assert.equal(cache.size, 0);
});

test("delete returns false for missing key", () => {
  const cache = makeCache();
  assert.equal(cache.delete("nope"), false);
});

// =====================================================================
// 7. has returns true/false
// =====================================================================

test("has returns true for existing entry and false for missing", () => {
  const cache = makeCache({ defaultTTL_ms: 0 });
  cache.set("exists", 1);
  assert.equal(cache.has("exists"), true);
  assert.equal(cache.has("missing"), false);
});

// =====================================================================
// 8. clear removes all entries
// =====================================================================

test("clear removes all entries", () => {
  const cache = makeCache({ defaultTTL_ms: 0 });
  cache.set("a", 1);
  cache.set("b", 2);
  cache.set("c", 3);
  assert.equal(cache.size, 3);

  cache.clear();
  assert.equal(cache.size, 0);
  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.get("b"), undefined);
  assert.equal(cache.get("c"), undefined);
});

// =====================================================================
// 9. size property
// =====================================================================

test("size reflects the number of entries", () => {
  const cache = makeCache({ defaultTTL_ms: 0 });
  assert.equal(cache.size, 0);
  cache.set("a", 1);
  assert.equal(cache.size, 1);
  cache.set("b", 2);
  assert.equal(cache.size, 2);
  cache.delete("a");
  assert.equal(cache.size, 1);
});

// =====================================================================
// 10. entries() returns current entries
// =====================================================================

test("entries() returns non-expired entries with correct data", async () => {
  const cache = makeCache({ defaultTTL_ms: 200 });
  cache.set("a", 10);
  cache.set("b", 20);
  cache.set("c", 30);

  const entries = cache.entries();
  assert.equal(entries.length, 3);

  const keys = entries.map((e) => e.key).sort();
  assert.deepEqual(keys, ["a", "b", "c"]);

  // Each entry should have value and expiresAt
  for (const e of entries) {
    assert.ok(typeof e.key === "string");
    assert.ok(typeof e.expiresAt === "number");
  }
});

test("entries() excludes expired entries", async () => {
  const cache = makeCache({ defaultTTL_ms: 0 });
  cache.set("a", 10);
  cache.set("short", "bye", 60);
  cache.set("b", 20);

  await new Promise((r) => setTimeout(r, 100));

  const entries = cache.entries();
  const keys = entries.map((e) => e.key).sort();
  assert.deepEqual(keys, ["a", "b"], "expired entry should not appear");
});

// =====================================================================
// 11. cleanup removes expired entries
// =====================================================================

test("sweep removes expired entries", async () => {
  const cache = makeCache({ defaultTTL_ms: 0 });
  cache.set("a", 1, 80);
  cache.set("b", 2, 80);
  cache.set("c", 3); // no expiry

  await new Promise((r) => setTimeout(r, 120));

  const removed = cache._sweep();
  assert.equal(removed, 2, "two expired entries should be swept");
  assert.equal(cache.size, 1, "only the non-expired entry should remain");
  assert.equal(cache.get("c"), 3);
});

test("auto-cleanup fires on interval", async () => {
  const cache = new LRUCache({ maxEntries: 100, defaultTTL_ms: 0, cleanupIntervalMs: 60 });
  try {
    cache.set("short", "val", 50);

    await new Promise((r) => setTimeout(r, 120));

    // The auto-sweep should have removed the expired entry.
    assert.equal(cache.has("short"), false);
  } finally {
    cache.stopCleanup();
  }
});

// =====================================================================
// 12. set overwrites existing key
// =====================================================================

test("set overwrites value for existing key", () => {
  const cache = makeCache({ defaultTTL_ms: 0 });
  cache.set("key", "old");
  assert.equal(cache.get("key"), "old");

  cache.set("key", "new");
  assert.equal(cache.get("key"), "new");
  assert.equal(cache.size, 1, "should still be 1 entry after overwrite");
});

// =====================================================================
// 13. get updates LRU order
// =====================================================================

test("get promotes entry to MRU preventing early eviction", () => {
  const cache = makeCache({ maxEntries: 3, defaultTTL_ms: 0 });

  cache.set("a", 1);
  cache.set("b", 2);
  cache.set("c", 3);

  // Touch "a" and "b" to refresh their LRU positions.
  cache.get("a");
  cache.get("b");

  // Now "c" is the oldest entry. Adding "d" evicts "c".
  cache.set("d", 4);
  assert.equal(cache.get("c"), undefined, "'c' should be evicted");
  assert.equal(cache.get("a"), 1);
  assert.equal(cache.get("b"), 2);
  assert.equal(cache.get("d"), 4);
});

// =====================================================================
// 14. concurrent access safe (rapid synchronous fire)
// =====================================================================

test("handles rapid-fire set/get without corruption", () => {
  const cache = makeCache({ maxEntries: 100, defaultTTL_ms: 0 });

  // Write 200 entries into a 100-entry cache — the first 100 should be evicted.
  for (let i = 0; i < 200; i++) {
    cache.set(`k-${i}`, i);
  }
  assert.equal(cache.size, 100);

  // Only the last 100 entries should be accessible.
  for (let i = 0; i < 100; i++) {
    assert.equal(cache.get(`k-${i}`), undefined, `k-${i} should be evicted`);
  }
  for (let i = 100; i < 200; i++) {
    assert.equal(cache.get(`k-${i}`), i, `k-${i} should be present`);
  }
});

// =====================================================================
// 15. large values handled
// =====================================================================

test("handles large object values", () => {
  const cache = makeCache({ maxEntries: 5, defaultTTL_ms: 0 });

  const big = { arr: new Array(10_000).fill("x"), nested: { deep: { data: true } } };
  cache.set("big", big);

  const retrieved = cache.get("big");
  assert.equal(retrieved.arr.length, 10_000);
  assert.equal(retrieved.nested.deep.data, true);
});

// =====================================================================
// 16. empty string key
// =====================================================================

test("supports empty string as key", () => {
  const cache = makeCache({ defaultTTL_ms: 0 });
  cache.set("", "empty-key-value");
  assert.equal(cache.get(""), "empty-key-value");
  assert.equal(cache.has(""), true);
  assert.equal(cache.size, 1);
});

// =====================================================================
// 17. null and undefined values
// =====================================================================

test("stores null as a value", () => {
  const cache = makeCache({ defaultTTL_ms: 0 });
  cache.set("n", null);
  assert.equal(cache.get("n"), null);
  assert.equal(cache.has("n"), true);
  assert.equal(cache.size, 1);
});

test("stores undefined as a value", () => {
  const cache = makeCache({ defaultTTL_ms: 0 });
  cache.set("u", undefined);
  // get returns the stored value (undefined), which is indistinguishable from
  // a missing key—but has() confirms it exists.
  assert.equal(cache.has("u"), true);
  // get() on a stored-undefined still returns undefined (which is expected).
  // Use has() or entries() to distinguish.
  const entries = cache.entries();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].key, "u");
});

// =====================================================================
// 18. TTL of 0 means immediate expiry (no TTL set)
// =====================================================================

test("TTL of 0 means entry does not expire", async () => {
  const cache = makeCache();
  cache.set("permanent", "value", 0);

  await new Promise((r) => setTimeout(r, 200));

  assert.equal(cache.get("permanent"), "value", "TTL=0 entry should never expire");
});

test("defaultTTL_ms of 0 means entries don't expire by default", async () => {
  const cache = makeCache({ defaultTTL_ms: 0 });
  cache.set("forever", "here");

  await new Promise((r) => setTimeout(r, 200));

  assert.equal(cache.get("forever"), "here");
});

// =====================================================================
// 19. negative TTL handled (treated as no expiry)
// =====================================================================

test("negative TTL is treated as no expiry", async () => {
  const cache = makeCache();
  cache.set("neg", "val", -1000);

  await new Promise((r) => setTimeout(r, 100));

  assert.equal(cache.get("neg"), "val", "negative-TTL entry should not expire");
  assert.equal(cache.has("neg"), true);
});

// =====================================================================
// 20. memory doesn't grow unbounded
// =====================================================================

test("cache never exceeds maxEntries even with millions of distinct keys", () => {
  const cache = makeCache({ maxEntries: 10, defaultTTL_ms: 0 });

  for (let i = 0; i < 1_000_000; i++) {
    cache.set(`key-${i}`, i);
  }

  assert.equal(cache.size, 10, "size should be capped at maxEntries");
});

// =====================================================================
// 21. constructor rejects invalid options
// =====================================================================

test("constructor rejects non-positive maxEntries", () => {
  assert.throws(() => new LRUCache({ maxEntries: 0 }), /maxEntries must be positive/);
  assert.throws(() => new LRUCache({ maxEntries: -5 }), /maxEntries must be positive/);
});

// =====================================================================
// 22. stopCleanup prevents further auto-sweeps
// =====================================================================

test("stopCleanup stops the auto-sweep timer", async () => {
  const cache = new LRUCache({ maxEntries: 50, defaultTTL_ms: 0, cleanupIntervalMs: 50 });
  cache.set("temp", "val", 30);

  cache.stopCleanup();

  await new Promise((r) => setTimeout(r, 120));

  // Timer stopped — expired entry should still be in the map (lazily evicted on get).
  // The _sweep should NOT have run.
  // We verify by checking that calling _sweep manually still finds the expired entry.
  const removed = cache._sweep();
  assert.equal(removed, 1, "manual sweep should find the expired entry that auto-sweep missed");
});

// =====================================================================
// 23. entries() on empty cache returns empty array
// =====================================================================

test("entries() on empty cache returns empty array", () => {
  const cache = makeCache();
  const entries = cache.entries();
  assert.deepEqual(entries, []);
});

// =====================================================================
// 24. maxEntries = 1 works correctly
// =====================================================================

test("maxEntries = 1 evicts previous entry on every set", () => {
  const cache = makeCache({ maxEntries: 1, defaultTTL_ms: 0 });
  cache.set("first", 1);
  assert.equal(cache.size, 1);

  cache.set("second", 2);
  assert.equal(cache.size, 1);
  assert.equal(cache.get("first"), undefined);
  assert.equal(cache.get("second"), 2);
});

// =====================================================================
// 25. overwrite refreshes TTL
// =====================================================================

test("overwriting a key refreshes its TTL", async () => {
  const cache = makeCache({ defaultTTL_ms: 0 });

  // Set with a short TTL.
  cache.set("k", "old", 80);
  await new Promise((r) => setTimeout(r, 120));

  // Expired.
  assert.equal(cache.get("k"), undefined);

  // Re-set with a fresh TTL.
  cache.set("k", "new", 200);
  assert.equal(cache.get("k"), "new");

  // Wait for the original TTL window to pass; the re-set entry should still be alive.
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(cache.get("k"), "new", "re-set entry should survive");
});
