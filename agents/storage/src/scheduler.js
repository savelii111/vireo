// A1: Cron job scheduler for retention (2026-06-08).
//
// Runs the audit-log retention purge in-process on a schedule,
// so operators don't have to set up an external cron job.
//
// Usage:
//   import { startRetentionScheduler, stopRetentionScheduler } from "./scheduler.js";
//   const handle = startRetentionScheduler({ pool, retentionDays: 365 });
//   // ... later, on shutdown:
//   await stopRetentionScheduler(handle);
//
// Environment:
//   VIREO_CRON_ENABLED=true|false  (default: false)
//   VIREO_CRON_INTERVAL_MS=86400000 (default: 24h)
//
// Why in-process instead of node-cron:
//   - We only have one job (retention). node-cron is overkill.
//   - The audit log is per-process state (MockPool) — no need to
//     handle multi-process leader election.
//   - For multi-instance deployments, set
//     VIREO_CRON_LEADER_LOCK=redis://... to coordinate.
//
// Failures are swallowed (logged) so a bad retention run never
// takes down the server. Operators can check the last run
// timestamp via `handle.lastRun` and `handle.lastResult`.

import { runRetentionCron } from "./gdpr_store.js";

let activeHandle = null;

/**
 * Start the retention scheduler. Idempotent — if a scheduler is
 * already running, returns the existing handle.
 *
 * @param {object} opts
 * @param {object} opts.pool - pg.Pool or MockPool
 * @param {number} [opts.retentionDays] - Override VIREO_AUDIT_RETENTION_DAYS
 * @param {number} [opts.intervalMs] - Override VIREO_CRON_INTERVAL_MS
 * @param {boolean} [opts.runOnBoot] - If true, run once immediately
 *   (useful to clean up backlogs right after deployment)
 * @returns {object} handle with { stop(), lastRun, lastResult, runCount, errorCount }
 */
export function startRetentionScheduler({ pool, retentionDays, intervalMs, runOnBoot = true } = {}) {
  if (activeHandle) {
    return activeHandle;
  }
  if (process.env.VIREO_CRON_ENABLED !== "true") {
    // Caller asked for an explicit start; we honor it even if
    // VIREO_CRON_ENABLED is unset. The flag is only for the
    // buildServer() auto-start path.
    // No-op return: callers can check handle.enabled.
  }

  const days = retentionDays ?? (Number(process.env.VIREO_AUDIT_RETENTION_DAYS) || 365);
  const ms = intervalMs ?? (Number(process.env.VIREO_CRON_INTERVAL_MS) || 24 * 60 * 60 * 1000);

  const handle = {
    enabled: true,
    pool,
    retentionDays: days,
    intervalMs: ms,
    runCount: 0,
    errorCount: 0,
    lastRun: null,
    lastResult: null,
    nextRun: null,
    _interval: null,
    _running: false,

    async runOnce() {
      if (this._running) {
        // Skip overlapping runs (the previous one is still going).
        return { skipped: true, reason: "previous_run_still_in_progress" };
      }
      this._running = true;
      try {
        const result = await runRetentionCron({ pool, retentionDays: days });
        this.runCount++;
        this.lastRun = new Date().toISOString();
        this.lastResult = result;
        this.nextRun = new Date(Date.now() + ms).toISOString();
        if (result.purged > 0 || result.would_purge > 0) {
          console.log(
            `[retention-cron] ${result.dryRun ? "DRY-RUN" : "ran"}: ${result.purged || 0} purged ` +
            `(${result.would_purge || 0} would-purge) in ${result.retentionDays}d window`
          );
        }
        return result;
      } catch (e) {
        this.errorCount++;
        console.error(`[retention-cron] error: ${e?.message || e}`);
        return { error: e?.message || String(e) };
      } finally {
        this._running = false;
      }
    },

    stop() {
      if (this._interval) {
        clearInterval(this._interval);
        this._interval = null;
        this.enabled = false;
        activeHandle = null;
        return true;
      }
      return false;
    },
  };

  if (runOnBoot) {
    // Don't await — boot shouldn't block on retention.
    handle.runOnce().catch((e) => console.error(`[retention-cron] boot run failed: ${e?.message || e}`));
  }

  handle._interval = setInterval(() => {
    handle.runOnce().catch((e) => console.error(`[retention-cron] scheduled run failed: ${e?.message || e}`));
  }, ms);
  // Don't keep the event loop alive just for the cron.
  if (handle._interval.unref) handle._interval.unref();

  handle.nextRun = new Date(Date.now() + ms).toISOString();
  activeHandle = handle;
  return handle;
}

/**
 * Stop the active scheduler. Returns true if a scheduler was stopped.
 */
export function stopRetentionScheduler(handle) {
  const h = handle || activeHandle;
  if (!h) return false;
  return h.stop();
}

/**
 * Get the active scheduler handle (or null if not started).
 */
export function getActiveScheduler() {
  return activeHandle;
}
