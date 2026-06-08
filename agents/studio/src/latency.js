// D1: Latency instrumentation + D1 prefetch helpers (2026-06-08).
//
// Latency is the #1 user-experience factor. A 5-second wait feels
// broken; an 800ms wait feels instant. We measure every step of
// the chat pipeline so we can prove we're hitting the target and
// pinpoint where to optimize next.
//
// What we track:
//   - buildSystem: building the system prompt block
//   - prefetch:   loading projects / style DNA in parallel
//   - firstToken: time until the LLM starts responding
//   - toolExec:   time spent in tool calls (parallel, summed)
//   - total:      end-to-end
//
// We expose:
//   - createSpan() - returns a new span tracker
//   - span.mark(name, [meta]) - record a named event
//   - span.total() - total ms since span started
//   - span.toLog() - structured log object
//   - LATENCY_BUDGET_MS - the per-stage budget
//   - assertWithinBudget(span) - throws if we exceeded budget
//
// We use process.hrtime.bigint() for nanosecond precision (no
// Date.now() jitter).

export const LATENCY_BUDGET_MS = {
  buildSystem: 50,    // building the system prompt
  prefetch: 100,      // loading projects/style DNA in parallel
  firstToken: 800,    // user-perceived time-to-first-byte
  toolExec: 2000,     // any single tool call
  total: 5000,        // end-to-end (soft — we try harder)
};

/**
 * Create a new latency span. Use mark() to record events,
 * total() to get the elapsed ms, and toLog() to get a
 * structured log object.
 */
export function createSpan(name, meta = {}) {
  const startNs = process.hrtime.bigint();
  const marks = [];
  return {
    name,
    meta,
    startNs,
    marks,
    mark(label, moreMeta = {}) {
      marks.push({
        label,
        at_ms: Number(process.hrtime.bigint() - startNs) / 1e6,
        ...moreMeta,
      });
      return this;
    },
    total() {
      return Number(process.hrtime.bigint() - startNs) / 1e6;
    },
    getMark(label) {
      return marks.find((m) => m.label === label);
    },
    toLog() {
      return {
        span: name,
        total_ms: this.total(),
        marks: marks.map((m) => ({ label: m.label, at_ms: Math.round(m.at_ms * 100) / 100 })),
        ...meta,
      };
    },
  };
}

/**
 * Assert that a span's marks are within the latency budget.
 * Returns a list of stage labels that exceeded budget. Empty
 * list = all good.
 */
export function checkBudget(span) {
  const violations = [];
  for (const mark of span.marks) {
    const budget = LATENCY_BUDGET_MS[mark.label];
    if (budget != null && mark.at_ms > budget) {
      violations.push({
        stage: mark.label,
        actual_ms: Math.round(mark.at_ms * 100) / 100,
        budget_ms: budget,
        overage_ms: Math.round((mark.at_ms - budget) * 100) / 100,
      });
    }
  }
  return violations;
}

/**
 * Wrap an async function to track its latency. The function
 * is called with a span so it can mark its own sub-stages.
 * Returns { result, ms }.
 */
export async function timed(label, fn) {
  const start = process.hrtime.bigint();
  try {
    const result = await fn();
    return { result, ms: Number(process.hrtime.bigint() - start) / 1e6, label };
  } catch (e) {
    e.latencyMs = Number(process.hrtime.bigint() - start) / 1e6;
    throw e;
  }
}

/**
 * Prefetch helper: run N independent async functions in
 * parallel and return a typed object with the results (or
 * errors). Designed for the chat pipeline where we want
 * projects + style DNA + history loaded simultaneously.
 *
 * Unlike Promise.all, prefetch doesn't short-circuit on
 * the first error — every fetch runs to completion, and
 * errors are returned as { ok: false, error }.
 */
export async function prefetchAll(fetches) {
  // fetches is { key: async () => value }
  const entries = Object.entries(fetches);
  const settled = await Promise.allSettled(entries.map(([, fn]) => fn()));
  const result = {};
  entries.forEach(([key], i) => {
    const s = settled[i];
    if (s.status === "fulfilled") {
      result[key] = { ok: true, value: s.value };
    } else {
      result[key] = { ok: false, error: s.reason?.message || String(s.reason) };
    }
  });
  return result;
}

// ---- Caches ----
//
// L1 cache for system prompt, L2 for project list. These are
// intentionally simple (Map-based) — no external dependency.
// Each entry has a TTL so the data isn't stale forever.

class TTLCache {
  constructor(defaultTtlMs = 30_000) {
    this.map = new Map();
    this.defaultTtlMs = defaultTtlMs;
  }
  get(key) {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    return entry.value;
  }
  set(key, value, ttlMs) {
    const ttl = ttlMs ?? this.defaultTtlMs;
    this.map.set(key, { value, expiresAt: Date.now() + ttl });
  }
  invalidate(key) {
    this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
  get size() { return this.map.size; }
}

// Global cache instance (one process, shared across requests)
export const systemPromptCache = new TTLCache(5 * 60_000);  // 5 min
export const projectListCache = new TTLCache(30_000);        // 30s
export const styleDNACache = new TTLCache(60_000);           // 60s

export { TTLCache };
