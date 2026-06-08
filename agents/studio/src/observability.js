// D3 + E1-E3: Cost control, usage tracking, observability (2026-06-08).
//
// This module holds three things that all hang off the same
// underlying event stream (audit log entries):
//
//   D3 — Cost control:
//     - Per-user token/dollar budget enforcement
//     - Returns 402 Payment Required if exceeded
//     - Tracks daily/monthly usage in memory
//     - Exposes /api/me/usage so the UI can show "you've used
//       $X this month" without hitting the audit log
//
//   E1 — Audit log analysis:
//     - Real-time stats: most-used tools, error rates, p50/p95
//       latency per route
//     - CSV export endpoint for compliance team
//
//   E2 — Tracing:
//     - request_id propagated to every log line + audit row
//     - Span timing for each chat turn (buildSystem →
//       prefetch → firstToken → toolExec → total)
//     - OpenTelemetry-compatible structured fields
//
//   E3 — User-visible telemetry:
//     - /api/me/conversation-stats endpoint
//     - Time saved estimate based on tool calls
//     - Favorite tool
//
// Everything is in-memory by default (no PG required) so it
// works in dev and tests. Production deployments can swap in
// a Postgres-backed implementation without changing callers.

import { randomUUID } from "node:crypto";

// ---- Cost control ----
//
// We track usage per user per day and per month. The user has
// a daily and monthly budget. Exceeding either returns 402.
//
// Budgets come from env vars so deployments can tune them:
//   VIREO_DAILY_TOKEN_BUDGET  - default 200_000 tokens/day
//   VIREO_DAILY_COST_BUDGET_USD - default $5/day
//   VIREO_MONTHLY_COST_BUDGET_USD - default $50/month
//
// In-memory storage is fine for a single-process deployment.
// For multi-replica, replace with Redis or PG.

const DEFAULT_DAILY_TOKENS = 200_000;
const DEFAULT_DAILY_USD = 5;
const DEFAULT_MONTHLY_USD = 50;

class UsageTracker {
  constructor() {
    // userId → { daily: { date, input, output, cost }, monthly: { month, input, output, cost } }
    this.users = new Map();
  }
  _today() {
    return new Date().toISOString().slice(0, 10);
  }
  _thisMonth() {
    return new Date().toISOString().slice(0, 7);
  }
  _getOrCreate(userId) {
    let u = this.users.get(userId);
    if (!u) {
      u = {
        daily: { date: this._today(), input: 0, output: 0, cost: 0 },
        monthly: { month: this._thisMonth(), input: 0, output: 0, cost: 0 },
        history: [], // recent events for "what did I do"
      };
      this.users.set(userId, u);
    }
    // Roll over if needed
    if (u.daily.date !== this._today()) {
      u.daily = { date: this._today(), input: 0, output: 0, cost: 0 };
    }
    if (u.monthly.month !== this._thisMonth()) {
      u.monthly = { month: this._thisMonth(), input: 0, output: 0, cost: 0 };
    }
    return u;
  }
  record(userId, { inputTokens = 0, outputTokens = 0, costUsd = 0, tool = null, requestId = null, model = null } = {}) {
    const u = this._getOrCreate(userId);
    u.daily.input += inputTokens;
    u.daily.output += outputTokens;
    u.daily.cost += costUsd;
    u.monthly.input += inputTokens;
    u.monthly.output += outputTokens;
    u.monthly.cost += costUsd;
    // Cap history at 1000 events
    u.history.push({
      at: new Date().toISOString(),
      input: inputTokens,
      output: outputTokens,
      cost: costUsd,
      tool,
      request_id: requestId,
      model,
    });
    if (u.history.length > 1000) u.history = u.history.slice(-1000);
  }
  getUsage(userId) {
    const u = this._getOrCreate(userId);
    return {
      daily: { ...u.daily, total_tokens: u.daily.input + u.daily.output },
      monthly: { ...u.monthly, total_tokens: u.monthly.input + u.monthly.output },
    };
  }
  /**
   * Check whether the user is over budget. Returns
   *   { ok: true, ...usage }  if under budget
   *   { ok: false, reason, usage }  if over
   */
  checkBudget(userId) {
    const u = this._getOrCreate(userId);
    const dailyTokenBudget = Number(process.env.VIREO_DAILY_TOKEN_BUDGET) || DEFAULT_DAILY_TOKENS;
    const dailyCostBudget = Number(process.env.VIREO_DAILY_COST_BUDGET_USD) || DEFAULT_DAILY_USD;
    const monthlyCostBudget = Number(process.env.VIREO_MONTHLY_COST_BUDGET_USD) || DEFAULT_MONTHLY_USD;

    const dailyTokens = u.daily.input + u.daily.output;
    if (dailyTokens > dailyTokenBudget) {
      return { ok: false, reason: "daily_token_budget_exceeded", budget: dailyTokenBudget, used: dailyTokens };
    }
    if (u.daily.cost > dailyCostBudget) {
      return { ok: false, reason: "daily_cost_budget_exceeded", budget: dailyCostBudget, used: u.daily.cost };
    }
    if (u.monthly.cost > monthlyCostBudget) {
      return { ok: false, reason: "monthly_cost_budget_exceeded", budget: monthlyCostBudget, used: u.monthly.cost };
    }
    return { ok: true, usage: this.getUsage(userId) };
  }
  /**
   * User-visible telemetry: how many tool calls, success rate,
   * favorite tool, time saved estimate.
   */
  getStats(userId) {
    const u = this._getOrCreate(userId);
    // Aggregate from history (last 1000 events)
    let totalToolCalls = 0;
    const toolCounts = {};
    let totalRequests = 0;
    for (const ev of u.history) {
      totalRequests++;
      if (ev.tool) {
        totalToolCalls++;
        toolCounts[ev.tool] = (toolCounts[ev.tool] || 0) + 1;
      }
    }
    const favoriteTool = Object.entries(toolCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    // Time saved estimate: 5 minutes per tool call (heuristic)
    const timeSavedMinutes = totalToolCalls * 5;
    return {
      total_requests: totalRequests,
      total_tool_calls: totalToolCalls,
      favorite_tool: favoriteTool,
      time_saved_minutes: timeSavedMinutes,
      tool_counts: toolCounts,
      usage: this.getUsage(userId),
    };
  }
  reset(userId) {
    this.users.delete(userId);
  }
}

export const usageTracker = new UsageTracker();

// ---- Audit log analysis (E1) ----
//
// Real-time stats for the admin dashboard. Aggregates from
// the audit log rows. The audit log already stores actions
// per user; we just need to summarize.

class AuditStats {
  constructor() {
    this.reset();
  }
  reset() {
    this.byAction = new Map();    // action → count
    this.byTool = new Map();      // tool name → count
    this.byResult = new Map();    // "ok" | "error" → count
    this.byRoute = new Map();     // "POST /api/chat" → count
    this.latencies = [];          // recent latencies for p50/p95
    this.errors = [];             // recent error events
  }
  record(audit) {
    // audit: { action, result, target_kind, http_status, latency_ms }
    if (audit.action) {
      this.byAction.set(audit.action, (this.byAction.get(audit.action) || 0) + 1);
    }
    if (audit.target_kind === "tool" && audit.target_id) {
      this.byTool.set(audit.target_id, (this.byTool.get(audit.target_id) || 0) + 1);
    }
    if (audit.result) {
      this.byResult.set(audit.result, (this.byResult.get(audit.result) || 0) + 1);
    }
    if (audit.route) {
      this.byRoute.set(audit.route, (this.byRoute.get(audit.route) || 0) + 1);
    }
    if (audit.latency_ms != null) {
      this.latencies.push(audit.latency_ms);
      if (this.latencies.length > 1000) this.latencies = this.latencies.slice(-1000);
    }
    if (audit.result === "error") {
      this.errors.push({ at: new Date().toISOString(), ...audit });
      if (this.errors.length > 100) this.errors = this.errors.slice(-100);
    }
  }
  _percentile(arr, p) {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.floor((sorted.length - 1) * p);
    return sorted[idx];
  }
  summary() {
    return {
      by_action: Object.fromEntries(this.byAction),
      by_tool: Object.fromEntries(this.byTool),
      by_result: Object.fromEntries(this.byResult),
      by_route: Object.fromEntries(this.byRoute),
      latency: {
        count: this.latencies.length,
        p50_ms: Math.round(this._percentile(this.latencies, 0.5) * 100) / 100,
        p95_ms: Math.round(this._percentile(this.latencies, 0.95) * 100) / 100,
        p99_ms: Math.round(this._percentile(this.latencies, 0.99) * 100) / 100,
      },
      recent_errors: this.errors.slice(-10),
    };
  }
  /**
   * Convert stats to CSV for compliance team.
   * The schema is: action,tool,result,count
   */
  toCSV() {
    const rows = [["action", "tool", "result", "count"]];
    for (const [action, count] of this.byAction) {
      rows.push([action, "", "", count]);
    }
    for (const [tool, count] of this.byTool) {
      rows.push(["", tool, "", count]);
    }
    for (const [result, count] of this.byResult) {
      rows.push(["", "", result, count]);
    }
    return rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
  }
}

export const auditStats = new AuditStats();

// ---- Tracing (E2) ----
//
// request_id propagation. We expose a helper that wraps the
// request handler so every log line + audit row has the
// request_id automatically. The /api/admin/audit-stats
// endpoint returns trace summaries.

export function makeRequestId(req) {
  return req.headers["x-request-id"] || randomUUID();
}

// ---- Span aggregator for /api/admin/audit-stats ----

class SpanAggregator {
  constructor() {
    this.spans = []; // recent spans
  }
  record(span) {
    this.spans.push(span);
    if (this.spans.length > 1000) this.spans = this.spans.slice(-1000);
  }
  getRecent(limit = 50) {
    return this.spans.slice(-limit);
  }
  clear() { this.spans = []; }
}

export const spanAggregator = new SpanAggregator();
