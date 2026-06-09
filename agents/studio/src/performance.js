// performance.js — Performance monitoring and statistics (2026-06-09).
//
// Tracks operation durations with histogram-based percentile statistics.
// Designed for profiling tool calls, ffmpeg operations, and LLM requests.
//
// API:
//   const perf = new PerformanceTracker();
//   const t = perf.track("ffmpeg_color_grade");
//   await doWork();
//   t.end();                              // records duration
//   perf.getStats("ffmpeg_color_grade");  // → {count, totalMs, avgMs, p50, p95, p99, min, max}
//   perf.getAllStats();                    // → {opName: Stats, ...}
//   perf.reset("ffmpeg_color_grade");     // clear that op
//   perf.reset();                         // clear all

const HISTOGRAM_MAX = 1000; // keep last N measurements per operation

/**
 * @typedef {Object} Stats
 * @property {number} count
 * @property {number} totalMs
 * @property {number} avgMs
 * @property {number} p50   - median
 * @property {number} p95
 * @property {number} p99
 * @property {number} min
 * @property {number} max
 */

/**
 * Calculate a percentile from a sorted array (assumed pre-sorted ascending).
 * Uses linear interpolation between ranks.
 * @param {number[]} sorted - sorted ascending
 * @param {number} p - percentile (0-100)
 * @returns {number}
 */
function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  const frac = rank - lo;
  return sorted[lo] + frac * (sorted[hi] - sorted[lo]);
}

/**
 * Compute stats from a histogram (raw ms values).
 * @param {number[]} values
 * @returns {Stats}
 */
function computeStats(values) {
  if (values.length === 0) {
    return { count: 0, totalMs: 0, avgMs: 0, p50: 0, p95: 0, p99: 0, min: 0, max: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const totalMs = sorted.reduce((a, b) => a + b, 0);
  return {
    count: values.length,
    totalMs,
    avgMs: totalMs / values.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

export class PerformanceTracker {
  constructor() {
    /** @type {Map<string, number[]>} operation → histogram of durations in ms */
    this._histograms = new Map();
  }

  /**
   * Start tracking a named operation. Returns a handle with an end() method.
   * @param {string} operationName
   * @returns {{ end: () => number }} - end() returns the duration in ms
   */
  track(operationName) {
    const start = performance.now();
    let ended = false;
    return {
      /** @returns {number} duration in ms */
      end: () => {
        if (ended) return 0;
        ended = true;
        const duration = performance.now() - start;
        this._record(operationName, duration);
        return duration;
      },
    };
  }

  /**
   * Get statistics for a specific operation.
   * @param {string} operationName
   * @returns {Stats}
   */
  getStats(operationName) {
    const values = this._histograms.get(operationName) || [];
    return computeStats(values);
  }

  /**
   * Get statistics for all tracked operations.
   * @returns {Record<string, Stats>}
   */
  getAllStats() {
    const result = {};
    for (const [name, values] of this._histograms) {
      result[name] = computeStats(values);
    }
    return result;
  }

  /**
   * Clear statistics. If operationName is provided, clears only that op.
   * @param {string} [operationName]
   */
  reset(operationName) {
    if (operationName !== undefined) {
      this._histograms.delete(operationName);
    } else {
      this._histograms.clear();
    }
  }

  /**
   * Record a duration into the histogram. Trims to HISTOGRAM_MAX.
   * @private
   */
  _record(operationName, durationMs) {
    let arr = this._histograms.get(operationName);
    if (!arr) {
      arr = [];
      this._histograms.set(operationName, arr);
    }
    arr.push(durationMs);
    // Trim oldest if over capacity
    if (arr.length > HISTOGRAM_MAX) {
      arr.splice(0, arr.length - HISTOGRAM_MAX);
    }
  }
}
