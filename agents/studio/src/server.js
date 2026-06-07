// Vireo Studio — HTTP server.
//
// Endpoints (all require Bearer auth except /health):
//   GET    /health
//   GET    /api/projects                 — list user's projects
//   POST   /api/projects                 — create
//   GET    /api/projects/:id             — read
//   PATCH  /api/projects/:id             — update
//   DELETE /api/projects/:id             — delete
//   GET    /api/content-pieces            — list (query: project_id, source, limit)
//   POST   /api/content-pieces            — save
//   GET    /api/content-pieces/:id        — read
//   DELETE /api/content-pieces/:id        — delete
//   GET    /api/style-dna                 — list user's style DNAs (query: project_id)
//   GET    /api/style-dna/:id             — read one
//   POST   /api/style-dna                 — create/upsert
//   POST   /api/style-dna/analyze         — analyze corpus → StyleDNA (uses LLM)
//   GET    /api/conversations             — list user's conversations
//   POST   /api/conversations             — create
//   GET    /api/conversations/:id         — read (with messages)
//   DELETE /api/conversations/:id         — delete
//   POST   /api/chat                      — send a chat message (multi-turn w/ tool calls)

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { authMiddleware, corsHeaders, readJsonBody, RateLimiter } from "../../../packages/auth-middleware/index.js";
import { MessageFeedbackStore, WelcomeAnswersStore, UserPreferencesStore } from "../../storage/src/feedback_store.js";
import { ProjectStore, ContentPieceStorePg, ConversationStore, MessageStore } from "../../storage/src/chat_store.js";
import { PostgresStyleDNAStore } from "../../storage/src/extended.js";
import { applyMigrations, listAppliedMigrations } from "../../storage/src/migrations.js";
import { LLMClient, LLMError } from "./llm_client.js";
import { EDIT_TOOLS, executeToolCall, parseToolCalls, buildEditToolContext } from "./tools.js";

// Wrap PostgresStyleDNAStore to use the API we expect: { pool } constructor + id-based methods.
class StyleDNAStorePg {
  constructor(pool) {
    this._pgPool = pool;
  }
  _ensure() {}
  async _native() { return new PostgresStyleDNAStore({ pool: this._pgPool }); }
  async upsert({ userId, name, tone, pacing, vocabulary, humor, hooks, ctas, topics, confidence, sourceCorpusSize, merge = false }) {
    const pg = new PostgresStyleDNAStore({ pool: this._pgPool });
    if (merge) {
      // Fetch existing DNA and merge arrays/fields so we don't lose previously learned patterns
      const existing = await pg.get(userId, name || "default");
      if (existing) {
        const mergeUnique = (a = [], b = []) => [...new Set([...(a || []), ...(b || [])])].slice(0, 50);
        return pg.upsert({
          user_id: userId, name: name || "default",
          tone: tone ?? existing.tone,
          pacing: pacing ?? existing.pacing,
          vocabulary: mergeUnique(existing.vocabulary, vocabulary),
          humor: humor ?? existing.humor,
          hooks: mergeUnique(existing.hooks, hooks),
          ctas: mergeUnique(existing.ctas, ctas),
          topics: mergeUnique(existing.topics, topics),
          confidence: Math.max(existing.confidence || 0, confidence ?? 0),
          source_corpus_size: Math.max(existing.source_corpus_size || 0, sourceCorpusSize || 0),
        });
      }
    }
    return pg.upsert({
      user_id: userId, name: name || "default",
      tone, pacing,
      vocabulary: Array.isArray(vocabulary) ? vocabulary : [],
      humor, hooks: hooks || [], ctas: ctas || [], topics: topics || [],
      confidence: confidence ?? 0, source_corpus_size: sourceCorpusSize || 0,
    });
  }
  async getByName(userId, name) {
    const pg = new PostgresStyleDNAStore({ pool: this._pgPool });
    return pg.get(userId, name);
  }
  async getById(userId, id) {
    const pg = new PostgresStyleDNAStore({ pool: this._pgPool });
    const list = await this.listForUser(userId);
    return list.find((d) => d.id === id) || null;
  }
  async listForUser(userId) {
    const pg = new PostgresStyleDNAStore({ pool: this._pgPool });
    const rows = await pg.listForUser(userId);
    return rows.map((r) => ({ ...r, id: r.id || `${userId}:${r.name}` }));
  }
}

const DEFAULT_PORT = Number(process.env.PORT || 8011);
const DEFAULT_HOST = process.env.HOST || "127.0.0.1";
const JWT_SECRET = process.env.VIREO_JWT_SECRET || "";
const STYLE_LEARNER_URL = process.env.VIREO_STYLE_URL || "http://127.0.0.1:8001";
const EDITOR_URL = process.env.VIREO_EDITOR_URL || "http://127.0.0.1:8002";
const DISTRIBUTOR_URL = process.env.VIREO_DISTRIBUTOR_URL || "http://127.0.0.1:8003";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
// CORS allow-list. Read fresh on every request (via parseCorsOrigins below)
// so a runtime env change is picked up without a server restart.
// Comma-separated origins; "*" echoes the request origin (so credentialled
// requests still work in dev). Default "*" for backwards compat; production
// should set VIREO_CORS_ORIGINS=https://app.example.com.
// Hard size cap for any user-supplied JSON body. 256KB is generous for chat
// but blocks trivial DoS via 10MB metadata objects.
const MAX_BODY_BYTES = Number(process.env.VIREO_MAX_BODY_BYTES || 256 * 1024);
// Upstream (style-learner / editor / distributor) request timeout.
const UPSTREAM_TIMEOUT_MS = Number(process.env.VIREO_UPSTREAM_TIMEOUT_MS || 15_000);

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function err(res, status, code, message, extra = {}) {
  return json(res, status, { error: code, message, ...extra });
}

function newId(prefix) {
  // crypto.randomUUID is collision-free even under high concurrency
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

/**
 * Parse the VIREO_CORS_ORIGINS env var into an array of allowed origins.
 * Read fresh on every request (not cached at module load) so a runtime
 * env change takes effect immediately without a server restart.
 */
function parseCorsOrigins() {
  const raw = (process.env.VIREO_CORS_ORIGINS ?? "*").trim();
  if (raw === "") return ["*"];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Return the Access-Control-Allow-Origin value for an incoming request.
 * If allowed is ["*"] we echo the request origin so the browser still
 * accepts credentialed requests; in production the operator pins a real
 * allow-list via VIREO_CORS_ORIGINS.
 */
function corsAllowOrigin(req) {
  const origin = req.headers?.origin || "";
  const allowed = parseCorsOrigins();
  if (allowed.length === 0 || (allowed.length === 1 && allowed[0] === "*")) {
    return origin || "*";
  }
  return allowed.includes(origin) ? origin : allowed[0];
}

/**
 * Wrap fetch with a per-call AbortController timeout. Without this, a
 * hung style-learner / editor / distributor can stall /api/chat for 60+
 * seconds, exhausting our socket pool.
 */
function fetchWithTimeout(fetchImpl, timeoutMs) {
  return (url, init = {}) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const signal = init.signal
      ? anySignal([init.signal, ctrl.signal])
      : ctrl.signal;
    return fetchImpl(url, { ...init, signal }).finally(() => clearTimeout(t));
  };
}

// Combine multiple AbortSignals into one. Aborts as soon as any fires.
function anySignal(signals) {
  const ctrl = new AbortController();
  for (const s of signals) {
    if (s?.aborted) { ctrl.abort(); break; }
    s.addEventListener("abort", () => ctrl.abort(), { once: true });
  }
  return ctrl.signal;
}

/**
 * Cap user-supplied JSON body size. Checks Content-Length up front (fast
 * path, no buffer alloc) and lets the route's readJsonBody(maxBytes) handle
 * the no-Content-Length chunk-bomb case. We deliberately do NOT consume the
 * request body here — Node request streams are one-shot, and the route needs
 * to read it after this guard returns.
 *
 * Usage:
 *   if (await guardBody(req, res, 64*1024)) return;
 *   const body = await readJsonBody(req, 64*1024);
 */
async function guardBody(req, res, maxBytes = MAX_BODY_BYTES) {
  const cl = Number(req.headers["content-length"] || 0);
  if (cl > maxBytes) {
    err(res, 413, "payload_too_large", `body exceeds ${maxBytes} bytes`);
    return true;
  }
  return false;
}

/**
 * Cap the size of a free-form metadata object. Reject anything over
 * MAX_METADATA_BYTES (serialized). Prevents the trivial DoS where a
 * POST with `metadata: "x".repeat(10_000_000)` would happily land in PG.
 */
const MAX_METADATA_BYTES = 16 * 1024;
function capMetadata(meta) {
  if (meta == null) return {};
  if (typeof meta !== "object" || Array.isArray(meta)) {
    throw Object.assign(new Error("metadata must be an object"), { httpStatus: 400, code: "validation" });
  }
  // Shallow cap: we don't recurse (caller-controlled depth is small).
  const serialized = JSON.stringify(meta);
  if (serialized.length > MAX_METADATA_BYTES) {
    throw Object.assign(new Error(`metadata exceeds ${MAX_METADATA_BYTES} bytes`), { httpStatus: 413, code: "payload_too_large" });
  }
  return meta;
}

/**
 * Build the tool executor map. Each function gets { userId, ...args } and
 * talks to the underlying stores / services.
 */
function buildToolDeps({ projects, pieces, conversations, messages, styleDNA, llm, fetchImpl, authHeadersFn, upstreamTimeoutMs }) {
  const _fetch = fetchWithTimeout(fetchImpl || globalThis.fetch, upstreamTimeoutMs || UPSTREAM_TIMEOUT_MS);
  const authHeaders = authHeadersFn || (() => ({ "Content-Type": "application/json" }));

  return {
    list_projects: async ({ userId, limit = 20 }) => {
      const ps = await projects.listForUser(userId, { limit });
      return { ok: true, projects: ps };
    },
    create_project: async ({ userId, name, niche = null, description = null, target_platforms = null }) => {
      const p = await projects.create({ userId, name, niche, description, targetPlatforms: target_platforms || ["youtube"] });
      return { ok: true, project: p };
    },
    save_content: async ({ userId, project_id, text, kind = "script", source = "chat" }) => {
      if (!text || !text.trim()) return { ok: false, error: "text required" };
      // Verify project belongs to user (if project_id given)
      if (project_id) {
        const p = await projects.get(project_id);
        if (!p || p.user_id !== userId) return { ok: false, error: "project_not_found" };
      }
      const piece = await pieces.add({ userId, projectId: project_id, source, kind, text });
      return { ok: true, piece };
    },
    list_content: async ({ userId, project_id, limit = 20 }) => {
      if (project_id) {
        const p = await projects.get(project_id);
        if (!p || p.user_id !== userId) return { ok: false, error: "project_not_found" };
      }
      const list = await pieces.listForUser(userId, { projectId: project_id, limit });
      return { ok: true, pieces: list };
    },
    get_style_dna: async ({ userId, project_id }) => {
      // Try to find a StyleDNA linked to this project first; fall back to user's first DNA
      const all = await styleDNA.listForUser(userId);
      let dna = null;
      if (project_id) {
        const proj = await projects.get(project_id);
        if (proj && proj.user_id === userId && proj.style_dna_id) {
          dna = all.find((d) => d.id === proj.style_dna_id) || null;
        }
        if (!dna) {
          // Per-project DNA is often named "project-<id>" — try that
          dna = all.find((d) => d.name === `project-${project_id}`) || null;
        }
      }
      if (!dna) dna = all[0] || null;
      return { ok: true, style_dna: dna };
    },
    analyze_style: async ({ userId, project_id }) => {
      // Pull corpus from saved pieces — require at least 2 for meaningful DNA
      const corpus = await pieces.listForUser(userId, { projectId: project_id, limit: 50 });
      if (corpus.length < 2) {
        return { ok: false, error: "no_corpus", message: "Save at least 2 content pieces first, then run analyze. More samples = better DNA." };
      }
      const payload = { pieces: corpus.map((c) => ({ text: c.text, title: c.id, platform: c.metadata?.platform || "manual" })) };
      let dna = null;
      try {
        const r = await _fetch(`${STYLE_LEARNER_URL}/analyze-llm`, {
          method: "POST",
          headers: authHeaders({ "X-Vireo-User-Id": userId }),
          body: JSON.stringify(payload),
        });
        if (r.ok) {
          const data = await r.json();
          dna = data.style_dna;
        } else {
          // Log upstream HTTP failure so operators can see why DNA fell back.
          // Previously swallowed silently.
          console.warn(`[studio] style-learner returned ${r.status} for user=${userId}, using derived DNA`);
        }
      } catch (e) {
        // style-learner offline — fall back to a simple derived DNA, but
        // surface the error so it doesn't look like the analysis succeeded.
        console.warn(`[studio] style-learner unreachable for user=${userId}: ${e.message || e}`);
      }
      if (!dna) {
        dna = deriveSimpleDNA(corpus.map((c) => c.text));
      }
      // Persist with merge so re-running analyze adds to existing DNA instead of wiping it
      const name = project_id ? `project-${project_id}` : "default";
      const existing = await styleDNA.getByName(userId, name);
      const saved = await styleDNA.upsert({
        userId,
        name,
        tone: dna.tone,
        pacing: dna.pacing,
        vocabulary: dna.vocabulary || dna.vocabulary_level || [],
        humor: dna.humor || dna.humor_style,
        hooks: dna.hook_patterns || dna.hooks || [],
        ctas: dna.cta_patterns || dna.ctas || [],
        topics: dna.topics || [],
        confidence: dna.confidence ?? 0.5,
        sourceCorpusSize: corpus.length,
        merge: !!existing,
      });
      // Link StyleDNA to project
      if (project_id) {
        await projects.update(project_id, { userId, styleDnaId: saved.id });
      }
      return { ok: true, style_dna: saved, corpus_size: corpus.length, merged: !!existing };
    },
    edit_content: async ({ userId, text, target_sec, project_id }) => {
      // Pull StyleDNA — prefer project-specific, fall back to first user's DNA
      const all = await styleDNA.listForUser(userId);
      let dna = { tone: "casual" };
      if (project_id) {
        const proj = await projects.get(project_id);
        if (proj && proj.user_id === userId && proj.style_dna_id) {
          dna = all.find((x) => x.id === proj.style_dna_id) || null;
        }
        if (dna === null || !dna.id) {
          dna = all.find((x) => x.name === `project-${project_id}`) || null;
        }
      }
      if (!dna || !dna.id) dna = all[0] || { tone: "casual" };
      const payload = { content: { id: newId("c"), text, duration_sec: 0 }, style_dna: dna, target_sec };
      let editPlan = null;
      try {
        const r = await _fetch(`${EDITOR_URL}/plan`, {
          method: "POST",
          headers: authHeaders({ "X-Vireo-User-Id": userId }),
          body: JSON.stringify(payload),
        });
        if (r.ok) {
          const data = await r.json();
          editPlan = data.edit_plan || data;
        } else {
          console.warn(`[studio] editor returned ${r.status} for user=${userId}, using fallback plan`);
        }
      } catch (e) {
        console.warn(`[studio] editor unreachable for user=${userId}: ${e.message || e}`);
      }
      if (!editPlan) editPlan = makeFallbackPlan(text, target_sec);
      return { ok: true, edit_plan: editPlan, style_dna: dna };
    },
    distribute: async ({ userId, edit_plan, style_dna, project_id, platforms }) => {
      let dna = style_dna;
      if (!dna || !dna.id) {
        const all = await styleDNA.listForUser(userId);
        if (project_id) {
          const proj = await projects.get(project_id);
          if (proj && proj.user_id === userId && proj.style_dna_id) {
            dna = all.find((x) => x.id === proj.style_dna_id) || null;
          }
          if (!dna || !dna.id) {
            dna = all.find((x) => x.name === `project-${project_id}`) || null;
          }
        }
        if (!dna || !dna.id) dna = all[0] || { tone: "casual" };
      }
      const payload = { editPlan: edit_plan, styleDna: dna, platforms: platforms || ["youtube", "youtube_shorts", "tiktok"] };
      try {
        const r = await _fetch(`${DISTRIBUTOR_URL}/distribute`, {
          method: "POST",
          headers: authHeaders({ "X-Vireo-User-Id": userId }),
          body: JSON.stringify(payload),
        });
        if (r.ok) {
          const data = await r.json();
          return { ok: true, distribution: data, jobs: data.jobs || [], style_dna: dna };
        }
        const text = await r.text();
        return { ok: false, error: `distributor_${r.status}`, message: text.slice(0, 200) };
      } catch (e) {
        return { ok: false, error: "distributor_unreachable", message: e.message };
      }
    },
  };
}

function deriveSimpleDNA(texts) {
  const all = texts.join(" ").toLowerCase();
  const exclam = (all.match(/!/g) || []).length;
  const questions = (all.match(/\?/g) || []).length;
  // Strict > (not >=): need strictly more exclamations than texts to count
  // as "energetic". Two pieces with one "!" each (2/2) is conversational, not
  // energetic — energetic is 3+ "!" in 2 pieces.
  const tone = exclam > texts.length + 1 ? "energetic" : (all.split(" ").length / texts.length > 200 ? "verbose" : "casual");
  const words = all.split(/\s+/).filter((w) => w.length > 5);
  const freq = new Map();
  for (const w of words) freq.set(w, (freq.get(w) || 0) + 1);
  const vocab = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([w]) => w);
  return {
    tone,
    // Scale "fast" threshold by piece count so 2 short pieces don't read as "fast".
    pacing: exclam > 5 * texts.length ? "fast" : "medium",
    vocabulary: vocab,
    vocabulary_level: "conversational",
    humor: "subtle",
    hook_patterns: ["command", "curiosity"],
    cta_patterns: ["engagement"],
    topics: [],
    confidence: 0.3,
  };
}

function makeFallbackPlan(text, targetSec) {
  const words = text.split(/\s+/);
  const hookWords = words.slice(0, Math.min(20, words.length)).join(" ");
  const ctaWords = words.slice(-Math.min(15, words.length)).join(" ");
  const bodyWords = words.slice(20, Math.max(21, words.length - 15)).join(" ");
  return {
    source_id: newId("c"),
    cuts: [
      { start: 0, end: 5, text: hookWords, score: 0.9, role: "hook" },
      { start: 5, end: Math.max(6, targetSec - 5), text: bodyWords, score: 0.8, role: "body" },
      { start: Math.max(6, targetSec - 5), end: targetSec, text: ctaWords, score: 0.6, role: "cta" },
    ],
    output_duration_sec: targetSec,
    style_applied: {},
    notes: "Fallback plan (editor offline)",
  };
}

const SYSTEM_PROMPT = `You are Vireo — a personal AI creative director for content creators. You help the user:

- Create and manage content projects (think of them as playlists or content pillars)
- Save and organize their writing (scripts, ideas, transcripts)
- Analyze their writing style (Style DNA — tone, pacing, hooks, CTAs, topics)
- Cut long content into short platform-ready clips (YouTube Shorts, TikTok, Reels)
- Distribute to multiple platforms with optimal scheduling

When the user asks for something, prefer calling the right tool over making things up. If you're unsure, ask a short clarifying question.

Guidelines:
- Be concise, energetic, and direct. Match the user's tone.
- When the user shares text, ask if they want to save it (or save to a project they mention).
- When the user asks to "cut this for TikTok" or similar, first check for a Style DNA, then call edit_content, then optionally distribute.
- For new users with no projects, suggest creating one before saving content.
- Always show what you did (which tool, what result) so the user can verify.
- Never make up data. If a tool fails, say so honestly.
- Currency/timestamps: ISO 8601. Default to UTC when ambiguous.

Tool-use rules:
- Call tools in parallel when independent.
- Wait for tool results before responding with a conclusion.
- After tools run, give a short summary in plain text (no JSON).`;

/**
 * Build the per-user context block that's injected into the chat LLM's
 * system prompt on every /api/chat call. Returns an empty string when
 * the user has no preferences row yet (we don't want to leak a "user has
 * prefs" signal before they've actually filled anything in).
 *
 * The block is intentionally rendered as a JSON code fence — it gives
 * the LLM a structured signal it can parse, while keeping the rest of
 * the system prompt in natural language. We never include the user_id
 * or any auth material here.
 */
function buildUserPrefsBlock(prefs) {
  if (!prefs) return "";
  // Compact view: drop nulls, drop empty arrays. The LLM only needs
  // what the user has actually set, not the full row shape.
  const cleaned = {
    niche: prefs.niche || undefined,
    platforms: Array.isArray(prefs.platforms) && prefs.platforms.length > 0 ? prefs.platforms : undefined,
    tone: prefs.tone || undefined,
    goals: prefs.goals || undefined,
    audience: prefs.audience || undefined,
    voice_keywords: Array.isArray(prefs.voice_keywords) && prefs.voice_keywords.length > 0 ? prefs.voice_keywords : undefined,
    default_target_sec: Number.isFinite(prefs.default_target_sec) ? prefs.default_target_sec : undefined,
    default_aspect_ratio: prefs.default_aspect_ratio || undefined,
  };
  // If every field is undefined, no point in injecting an empty record.
  if (Object.values(cleaned).every((v) => v === undefined)) return "";
  return `\n\nUser preferences (long-term memory — follow these unless the user explicitly overrides in the current message):\n\`\`\`json\n${JSON.stringify(cleaned, null, 2)}\n\`\`\``;
}

/**
 * Build a compact project context block (legacy; complements prefs).
 */
function buildProjectContextBlock(proj) {
  if (!proj) return "";
  const platformList = (proj.target_platforms || []).join(", ") || "any platform";
  return `\n\nCurrent project: "${proj.name}" (id: ${proj.id})${proj.niche ? `, niche: ${proj.niche}` : ""}, target platforms: ${platformList}. Prefer tool calls and examples that fit this project's niche.`;
}

/**
 * Run a chat turn with up to N tool-calling rounds.
 * Returns { reply, messages, usage, costUsd, toolCalls }.
 */
async function runChatTurn({ llm, system, history, userMsg, tools, deps, userId, maxRounds = 6 }) {
  const messages = [...history, { role: "user", content: userMsg }];
  const allToolCalls = [];
  const allToolResults = [];
  let lastUsage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  let cost = 0;
  let rounds = 0;

  while (rounds < maxRounds) {
    rounds++;
    let resp;
    try {
      resp = await llm.chat({ system, messages, tools, toolChoice: "auto", temperature: 0.7, maxTokens: 1024 });
    } catch (e) {
      if (e instanceof LLMError) {
        return { reply: `LLM error: ${e.message}`, messages, usage: lastUsage, costUsd: cost, toolCalls: allToolCalls, error: e.code || "llm_error" };
      }
      return { reply: `LLM error: ${e.message}`, messages, usage: lastUsage, costUsd: cost, toolCalls: allToolCalls, error: "llm_error" };
    }
    lastUsage = resp.usage || lastUsage;
    cost += llm.costUsd(llm.model, resp.usage?.input_tokens || 0, resp.usage?.output_tokens || 0);

    // Append assistant turn
    const assistantTurn = { role: "assistant", content: resp.content || "" };
    if (resp.tool_calls && resp.tool_calls.length > 0) {
      assistantTurn.tool_calls = resp.tool_calls;
    }
    messages.push(assistantTurn);

    // If no tool calls, we're done
    if (!resp.tool_calls || resp.tool_calls.length === 0) {
      return { reply: resp.content || "", messages, usage: lastUsage, costUsd: cost, toolCalls: allToolCalls };
    }

    // Execute each tool call in parallel
    const ctx = { userId, deps };
    const toolResults = await Promise.all(resp.tool_calls.map(async (tc) => {
      let args = {};
      try { args = JSON.parse(tc.function.arguments || "{}"); } catch { args = {}; }
      allToolCalls.push({ name: tc.function.name, args });
      const result = await executeToolCall({ name: tc.function.name, args }, ctx);
      allToolResults.push({ name: tc.function.name, result });
      return { tool_call_id: tc.id, role: "tool", name: tc.function.name, content: JSON.stringify(result) };
    }));
    for (const tr of toolResults) messages.push(tr);
  }

  // Hit max rounds — return whatever we have
  return { reply: messages[messages.length - 1]?.content || "(no reply — max tool rounds reached)", messages, usage: lastUsage, costUsd: cost, toolCalls: allToolCalls, error: "max_rounds" };
}

export function buildServer({ port = DEFAULT_PORT, host = DEFAULT_HOST, secret = JWT_SECRET, pool, llm, fetchImpl, upstreamTimeoutMs } = {}) {
  const auth = secret ? authMiddleware(secret) : null;
  const cors = corsHeaders();
  // Per-build timeout: lets tests inject a short deadline without polluting
  // the module-level env. Operators can still set VIREO_UPSTREAM_TIMEOUT_MS
  // to change the production default.
  const effectiveTimeout = Number.isFinite(upstreamTimeoutMs) ? upstreamTimeoutMs : UPSTREAM_TIMEOUT_MS;
  // Per-user rate limit. Defaults are generous for a single human user;
  // tighten via VIREO_RATE_LIMIT_MAX / VIREO_RATE_LIMIT_WINDOW_MS in prod.
  const rlMax = Number(process.env.VIREO_RATE_LIMIT_MAX || 60);
  const rlWindow = Number(process.env.VIREO_RATE_LIMIT_WINDOW_MS || 60_000);
  const rateLimiter = new RateLimiter({ windowMs: rlWindow, max: rlMax });
  const llmClient = llm || new LLMClient({ apiKey: OPENAI_API_KEY, model: OPENAI_MODEL, fetchImpl });

  // Stores (require pool if Postgres, otherwise in-memory)
  const projects = pool ? new ProjectStore(pool) : new InMemoryProjectStore();
  const pieces = pool ? new ContentPieceStorePg(pool) : new InMemoryPieceStore();
  const conversations = pool ? new ConversationStore(pool) : new InMemoryConvStore();
  const messages = pool ? new MessageStore(pool) : new InMemoryMsgStore();
  const styleDNA = pool ? new StyleDNAStorePg(pool) : new InMemoryStyleDNAStore();
  const feedback = pool ? new MessageFeedbackStore(pool) : new InMemoryFeedbackStore();
  const welcome = pool ? new WelcomeAnswersStore(pool) : new InMemoryWelcomeStore();
  const preferences = pool ? new UserPreferencesStore(pool) : new InMemoryUserPreferencesStore();

  // Per-request header provider. Replaces the previous `let currentAuthHeader`
  // module-mutable global, which was a race condition: under concurrent
  // requests, request B could overwrite request A's Authorization header
  // before A's upstream call (style-learner / editor / distributor) ran,
  // leaking user B's token to user A's downstream agents.
  //
  // New approach: deps captures a setter closure that the per-request
  // handler invokes synchronously with its own auth header before any
  // tool code runs. The dep map itself is rebuilt per request so there's
  // no shared mutable state.
  const depsFactory = (authHeader) => {
    const authHeadersFn = (extra = {}) => {
      const h = { "Content-Type": "application/json", ...extra };
      if (authHeader) h["Authorization"] = authHeader;
      return h;
    };
    return buildToolDeps({
      projects, pieces, conversations, messages, styleDNA,
      llm: llmClient, fetchImpl, authHeadersFn,
      upstreamTimeoutMs: effectiveTimeout,
    });
  };

  const server = createServer(async (req, res) => {
    // CORS — honour the configured allow-list (or echo origin in dev "*" mode).
    res.setHeader("Access-Control-Allow-Origin", corsAllowOrigin(req));
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.setHeader("Vary", "Origin");
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

    const url = req.url.split("?")[0];
    const u = new URL(req.url, "http://x");
    const key = `${req.method} ${url}`;

    // ---- public ----
    if (key === "GET /health") {
      const health = {
        status: "ok",
        agent: "studio",
        postgres: !!pool,
        llm_model: llmClient.model,
        llm_mock: llmClient.isMock(),
      };
      if (pool) {
        // Probe PG with a short timeout. If the connection is dead, /health
        // should return 503 so load balancers take us out of rotation.
        try {
          const probe = await Promise.race([
            pool.query("SELECT 1 AS ok"),
            new Promise((_, rej) => setTimeout(() => rej(new Error("pg probe timeout")), 2000)),
          ]);
          health.pg_ok = probe.rows?.[0]?.ok === 1;
          // Surface migration status — useful for "is the schema up to date?" checks
          const applied = await listAppliedMigrations(pool).catch(() => []);
          health.migrations_applied = applied.length;
          health.migrations = applied.map((r) => r.name);
        } catch (e) {
          health.pg_ok = false;
          health.pg_error = e.message;
        }
      }
      // If PG is configured but the probe never ran (pg_ok === undefined), still
      // 200 — the operator may be mid-startup. Only fail 503 when we explicitly
      // know PG is broken.
      const status = (health.postgres && health.pg_ok === false) ? 503 : 200;
      return json(res, status, health);
    }

    // ---- auth gate ----
    if (!auth) {
      return err(res, 500, "server_misconfigured", "VIREO_JWT_SECRET not set");
    }
    await new Promise((r) => auth(req, res, r));
    if (res.writableEnded) return;
    const userId = req.user?.id;
    if (!userId) return err(res, 401, "unauthenticated", "missing user id");

    // Build per-request deps so the upstream Authorization header is captured
    // by closure (no module-mutable state, no race between concurrent requests).
    const deps = depsFactory(req.headers?.authorization || "");

    // ---- rate limit (per-user) ----
    // Key by userId, not IP — a single user behind a corporate NAT shouldn't
    // lock out their whole office, and one attacker on a botnet shouldn't
    // bypass per-user throttling by spoofing X-Forwarded-For.
    const rlKey = `user:${userId}`;
    const rl = rateLimiter.check(rlKey);
    // Use the actual configured limit, not a hardcoded 120. Clients use these
    // headers to back off and surface quota to the user; wrong values = wrong UX.
    res.setHeader("X-RateLimit-Limit", String(rlMax));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, rlMax - rl.count)));
    if (!rl.allowed) {
      res.setHeader("Retry-After", String(Math.ceil(rl.retryAfterMs / 1000)));
      return err(res, 429, "rate_limited", "too many requests");
    }

    try {
      // ---- projects ----
      if (key === "GET /api/projects") {
        const ps = await projects.listForUser(userId, { limit: Number(u.searchParams.get("limit") || 50) });
        return json(res, 200, { ok: true, projects: ps });
      }
      if (key === "POST /api/projects") {
        if (await guardBody(req, res)) return;
        let body; try { body = await readJsonBody(req, MAX_BODY_BYTES); } catch (e) { return err(res, 400, "bad_json", e.message); }
        if (!body.name) return err(res, 400, "validation", "name required");
        if (typeof body.name !== "string" || body.name.length > 200) {
          return err(res, 400, "validation", "name must be a string up to 200 chars");
        }
        let meta = {}; try { meta = capMetadata(body.metadata); } catch (e) { return err(res, e.httpStatus || 400, e.code || "validation", e.message); }
        const p = await projects.create({ userId, name: body.name, niche: body.niche, description: body.description, targetPlatforms: body.target_platforms, styleDnaId: body.style_dna_id, metadata: meta });
        return json(res, 201, { ok: true, project: p });
      }
      const projMatch = url.match(/^\/api\/projects\/([^/]+)$/);
      if (projMatch) {
        const id = decodeURIComponent(projMatch[1]);
        if (req.method === "GET") {
          const p = await projects.get(id);
          if (!p || p.user_id !== userId) return err(res, 404, "not_found");
          return json(res, 200, { ok: true, project: p });
        }
        if (req.method === "PATCH") {
          if (await guardBody(req, res)) return;
          let body; try { body = await readJsonBody(req, MAX_BODY_BYTES); } catch (e) { return err(res, 400, "bad_json", e.message); }
          // name cap on PATCH too (the underlying update was happy with anything)
          if (body.name !== undefined && (typeof body.name !== "string" || body.name.length > 200)) {
            return err(res, 400, "validation", "name must be a string up to 200 chars");
          }
          let meta;
          if (body.metadata !== undefined) {
            try { meta = capMetadata(body.metadata); } catch (e) { return err(res, e.httpStatus || 400, e.code || "validation", e.message); }
          }
          const p = await projects.update(id, { userId, name: body.name, niche: body.niche, description: body.description, targetPlatforms: body.target_platforms, styleDnaId: body.style_dna_id, status: body.status, metadata: meta });
          if (!p || p.user_id !== userId) return err(res, 404, "not_found");
          return json(res, 200, { ok: true, project: p });
        }
        if (req.method === "DELETE") {
          const ok = await projects.delete(id, userId);
          return json(res, ok ? 200 : 404, { ok, deleted: ok });
        }
      }

      // ---- content pieces ----
      if (key === "GET /api/content-pieces") {
        const projectId = u.searchParams.get("project_id") || null;
        const source = u.searchParams.get("source") || null;
        const limit = Number(u.searchParams.get("limit") || 100);
        if (projectId) {
          const p = await projects.get(projectId);
          if (!p || p.user_id !== userId) return err(res, 404, "project_not_found");
        }
        const list = await pieces.listForUser(userId, { projectId, source, limit });
        return json(res, 200, { ok: true, pieces: list });
      }
      if (key === "POST /api/content-pieces") {
        if (await guardBody(req, res)) return;
        let body; try { body = await readJsonBody(req, MAX_BODY_BYTES); } catch (e) { return err(res, 400, "bad_json", e.message); }
        if (!body.text) return err(res, 400, "validation", "text required");
        if (typeof body.text !== "string" || body.text.length > 200_000) {
          return err(res, 400, "validation", "text must be a string up to 200KB");
        }
        if (body.project_id) {
          if (typeof body.project_id !== "string") return err(res, 400, "validation", "project_id must be a string");
          const p = await projects.get(body.project_id);
          if (!p || p.user_id !== userId) return err(res, 404, "project_not_found");
        }
        let meta = {}; try { meta = capMetadata(body.metadata); } catch (e) { return err(res, e.httpStatus || 400, e.code || "validation", e.message); }
        const piece = await pieces.add({ userId, projectId: body.project_id, source: body.source || "manual", sourceId: body.source_id, kind: body.kind || "script", language: body.language, text: body.text, metadata: meta });
        return json(res, 201, { ok: true, piece });
      }
      const pieceMatch = url.match(/^\/api\/content-pieces\/([^/]+)$/);
      if (pieceMatch) {
        const id = decodeURIComponent(pieceMatch[1]);
        if (req.method === "GET") {
          const p = await pieces.get(id);
          if (!p || p.user_id !== userId) return err(res, 404, "not_found");
          return json(res, 200, { ok: true, piece: p });
        }
        if (req.method === "DELETE") {
          const ok = await pieces.delete(id, userId);
          return json(res, ok ? 200 : 404, { ok, deleted: ok });
        }
      }

      // ---- style DNA ----
      if (key === "GET /api/style-dna") {
        const list = await styleDNA.listForUser(userId);
        return json(res, 200, { ok: true, style_dnas: list });
      }
      if (key === "POST /api/style-dna") {
        let body; try { body = await readJsonBody(req); } catch (e) { return err(res, 400, "bad_json", e.message); }
        if (!body.name) return err(res, 400, "validation", "name required");
        const saved = await styleDNA.upsert({
          userId, name: body.name, tone: body.tone, pacing: body.pacing,
          vocabulary: body.vocabulary || body.vocabulary_level || [],
          humor: body.humor || body.humor_style,
          hooks: body.hook_patterns || body.hooks || [],
          ctas: body.cta_patterns || body.ctas || [],
          topics: body.topics || [],
          confidence: body.confidence ?? 0.5,
          sourceCorpusSize: body.source_corpus_size || 0,
        });
        return json(res, 201, { ok: true, style_dna: saved });
      }
      if (key === "POST /api/style-dna/analyze") {
        let body; try { body = await readJsonBody(req); } catch (e) { return err(res, 400, "bad_json", e.message); }
        const result = await deps.analyze_style({ userId, project_id: body.project_id });
        return json(res, result.ok ? 200 : 400, result);
      }
      const dnaMatch = url.match(/^\/api\/style-dna\/([^/]+)$/);
      if (dnaMatch && req.method === "GET") {
        const name = decodeURIComponent(dnaMatch[1]);
        const d = await styleDNA.getByName(userId, name);
        if (!d) return err(res, 404, "not_found");
        return json(res, 200, { ok: true, style_dna: d });
      }

      // ---- conversations ----
      if (key === "GET /api/conversations") {
        const projectId = u.searchParams.get("project_id") || null;
        const list = await conversations.listForUser(userId, { projectId, limit: Number(u.searchParams.get("limit") || 50) });
        return json(res, 200, { ok: true, conversations: list });
      }
      if (key === "POST /api/conversations") {
        if (await guardBody(req, res)) return;
        let body; try { body = await readJsonBody(req, MAX_BODY_BYTES); } catch (e) { return err(res, 400, "bad_json", e.message); }
        if (body.project_id !== undefined && body.project_id !== null && typeof body.project_id !== "string") {
          return err(res, 400, "validation", "project_id must be a string or null");
        }
        let meta = {}; try { meta = capMetadata(body.metadata); } catch (e) { return err(res, e.httpStatus || 400, e.code || "validation", e.message); }
        const c = await conversations.create({ userId, projectId: body.project_id, title: body.title || null, systemPrompt: body.system_prompt || null, metadata: meta });
        return json(res, 201, { ok: true, conversation: c });
      }
      const convMatch = url.match(/^\/api\/conversations\/([^/]+)$/);
      if (convMatch) {
        const id = decodeURIComponent(convMatch[1]);
        if (req.method === "GET") {
          const c = await conversations.get(id);
          if (!c || c.user_id !== userId) return err(res, 404, "not_found");
          const msgs = await messages.listForConversation(id);
          return json(res, 200, { ok: true, conversation: c, messages: msgs });
        }
        if (req.method === "PATCH") {
          if (await guardBody(req, res)) return;
          let body; try { body = await readJsonBody(req, MAX_BODY_BYTES); } catch (e) { return err(res, 400, "bad_json", e.message); }
          const updates = {};
          // PATCH title=null should CLEAR the title, not set it to the string "null".
          // String(null) === "null" was the bug — accept explicit null as "unset".
          if (body.title !== undefined) updates.title = body.title === null ? null : String(body.title).slice(0, 200);
          if (body.metadata !== undefined) {
            try { updates.metadata = capMetadata(body.metadata); } catch (e) { return err(res, e.httpStatus || 400, e.code || "validation", e.message); }
          }
          const c = await conversations.update(id, userId, updates);
          if (!c) return err(res, 404, "not_found");
          return json(res, 200, { ok: true, conversation: c });
        }
        if (req.method === "DELETE") {
          await messages.deleteForConversation(id, userId);
          const ok = await conversations.delete(id, userId);
          return json(res, ok ? 200 : 404, { ok, deleted: ok });
        }
      }
      // Note: GET /api/conversations/:id/messages duplicates GET /:id (which
      // already returns messages). Kept for API compatibility — the dashboard
      // can use either. Consider deprecating in a future major version.
      const convMsgsMatch = url.match(/^\/api\/conversations\/([^/]+)\/messages$/);
      if (convMsgsMatch && req.method === "GET") {
        const cid = decodeURIComponent(convMsgsMatch[1]);
        const c = await conversations.get(cid);
        if (!c || c.user_id !== userId) return err(res, 404, "not_found");
        const msgs = await messages.listForConversation(cid, { limit: Number(u.searchParams.get("limit") || 200) });
        return json(res, 200, { ok: true, messages: msgs });
      }

      // ---- chat (the main endpoint) ----
      if (key === "POST /api/chat") {
        // Body size cap: a chat message over 64KB is almost always abuse.
        // Fail fast on Content-Length so we don't allocate buffers for nothing.
        const cl = Number(req.headers["content-length"] || 0);
        if (cl > 64 * 1024) return err(res, 413, "payload_too_large", "message body exceeds 64KB");
        let body; try { body = await readJsonBody(req, 64 * 1024); } catch (e) { return err(res, 400, "bad_json", e.message); }
        if (!body.message) return err(res, 400, "validation", "message required");
        if (typeof body.message !== "string" || body.message.length > 32_000) {
          return err(res, 400, "validation", "message must be a string up to 32KB");
        }

        let conversationId = body.conversation_id || null;
        if (conversationId !== null && typeof conversationId !== "string") {
          return err(res, 400, "validation", "conversation_id must be a string");
        }
        let conv = null;
        if (conversationId) {
          conv = await conversations.get(conversationId);
          if (!conv || conv.user_id !== userId) return err(res, 404, "conversation_not_found");
        } else {
          // Auto-create a conversation on first message
          conv = await conversations.create({ userId, projectId: body.project_id || null, title: body.title || null, metadata: {} });
          conversationId = conv.id;
        }

        // Save user message
        const userMsg = await messages.add({ conversationId, userId, role: "user", content: body.message });
        const userMessageId = userMsg.id;

        // Build history (last N messages)
        const history = await messages.listForConversation(conversationId, { limit: 30 });
        // Drop the user message we just added (it's the last in the list)
        const hist = history.slice(0, -1).map((m) => ({ role: m.role, content: m.content, tool_calls: m.tool_calls || undefined, tool_call_id: m.tool_call_id, name: m.name }));

        // Pick system prompt: per-conversation override, or default
        let system = conv.system_prompt || SYSTEM_PROMPT;

        // Project context: if the chat is bound to a project, append its context
        // to the system prompt so the LLM knows what niche/topic it's working in.
        const projectId = body.project_id || conv.project_id || null;
        let proj = null;
        if (projectId) {
          proj = await projects.get(projectId);
          if (proj && proj.user_id === userId) {
            system += buildProjectContextBlock(proj);
          }
        }

        // User preferences (Wave 1): the user's long-term memory. We fetch
        // this on every chat turn so the LLM always sees current prefs.
        // A failed read should not break the chat — fall back to a prompt
        // without prefs (the LLM is robust to missing context).
        try {
          const prefs = await preferences.get(userId);
          system += buildUserPrefsBlock(prefs);
        } catch (e) {
          console.warn(`[studio] preferences read failed for user=${userId}:`, e?.message || e);
        }

        // Run the turn (may invoke tools). On LLM error we still want a row
        // in the conversation — the user needs to see *something* went wrong,
        // not just a hung "assistant typing…" bubble.
        let result;
        try {
          result = await runChatTurn({
            llm: llmClient,
            system,
            history: hist,
            userMsg: body.message,
            tools: EDIT_TOOLS,
            deps,
            userId,
            maxRounds: 6,
          });
        } catch (e) {
          console.error(`[studio] runChatTurn crashed for user=${userId}:`, e);
          // Persist a synthetic assistant message so the UI doesn't sit on a
          // half-turn forever. The user re-sends / rewind to recover.
          const errMsg = await messages.add({
            conversationId, userId, role: "assistant",
            content: `LLM error: ${e.message || "unknown"}`,
            toolCalls: null, toolResults: null,
            tokensUsed: 0, costUsd: 0,
          });
          await conversations.touch(conversationId);
          return json(res, 502, {
            ok: false, error: "llm_error", message: e.message || "LLM call failed",
            conversation_id: conversationId,
            user_message_id: userMessageId,
            message_id: errMsg.id,
          });
        }

        // If runChatTurn swallowed an LLM error, surface it as 502 with the
        // synthetic assistant message already in the conversation. Without
        // this, the UI gets a 200 with error=llm_error in the body and the
        // user has no way to know the assistant "replied" with an error.
        if (result.error) {
          const errMsg = await messages.add({
            conversationId, userId, role: "assistant",
            content: result.reply || `LLM error: ${result.error}`,
            toolCalls: null, toolResults: null,
            tokensUsed: 0, costUsd: 0,
          });
          await conversations.touch(conversationId);
          return json(res, 502, {
            ok: false,
            error: result.error,
            message: result.reply,
            conversation_id: conversationId,
            user_message_id: userMessageId,
            message_id: errMsg.id,
          });
        }

        // Persist the FULL tool exchange so future turns have the tool
        // call/result context (not just a final summary).
        // result.messages = [...history, userMsg, assistant_with_tool_calls,
        //                   tool_result, assistant_with_tool_calls, tool_result, ..., final_assistant]
        // We persist everything after the user message we just added.
        const tokensUsed = result.usage.total_tokens || 0;
        const costUsd = result.costUsd;
        const newTurn = result.messages.slice(hist.length + 1); // skip history + just-added user msg
        let lastSavedId = null;
        for (const m of newTurn) {
          if (m.role === "assistant") {
            const isFinal = m === newTurn[newTurn.length - 1];
            const saved = await messages.add({
              conversationId,
              userId,
              role: "assistant",
              content: m.content || "",
              toolCalls: m.tool_calls || null,
              toolResults: null,
              tokensUsed: isFinal ? tokensUsed : 0,
              costUsd: isFinal ? costUsd : 0,
            });
            lastSavedId = saved.id;
          } else if (m.role === "tool") {
            await messages.add({
              conversationId,
              userId,
              role: "tool",
              content: m.content,
              toolCalls: null,
              toolResults: { tool_call_id: m.tool_call_id, name: m.name, content: m.content },
              tokensUsed: 0,
              costUsd: 0,
            });
          }
        }
        await conversations.touch(conversationId);

        return json(res, 200, {
          ok: true,
          conversation_id: conversationId,
          reply: result.reply,
          tool_calls: result.toolCalls,
          usage: result.usage,
          cost_usd: costUsd,
          error: result.error || null,
          message_id: lastSavedId,
        });
      }

      // ---- chat streaming (SSE) ----
      // Same body as /api/chat but returns text/event-stream. The client
      // uses fetch + ReadableStream + a tiny SSE parser, so we keep the
      // transport dependency-free. Events:
      //   event: meta    { conversation_id }
      //   event: tool    { name, args, result }
      //   event: delta   { text }       — streamed text chunks
      //   event: done    { reply, usage, cost_usd, message_id }
      //   event: error   { error, message }
      if (key === "POST /api/chat/stream") {
        const cl2 = Number(req.headers["content-length"] || 0);
        if (cl2 > 64 * 1024) return err(res, 413, "payload_too_large", "message body exceeds 64KB");
        let body; try { body = await readJsonBody(req, 64 * 1024); } catch (e) { return err(res, 400, "bad_json", e.message); }
        if (!body.message) return err(res, 400, "validation", "message required");
        if (typeof body.message !== "string" || body.message.length > 32_000) {
          return err(res, 400, "validation", "message must be a string up to 32KB");
        }

        let conversationId = body.conversation_id || null;
        let conv = null;
        if (conversationId) {
          conv = await conversations.get(conversationId);
          if (!conv || conv.user_id !== userId) return err(res, 404, "conversation_not_found");
        } else {
          conv = await conversations.create({ userId, projectId: body.project_id || null, title: body.title || null, metadata: {} });
          conversationId = conv.id;
        }
        await messages.add({ conversationId, userId, role: "user", content: body.message });
        const userMessageId = (await messages.listForConversation(conversationId, { limit: 1 }))[0]?.id;

        const history = await messages.listForConversation(conversationId, { limit: 30 });
        const hist = history.slice(0, -1).map((m) => ({ role: m.role, content: m.content, tool_calls: m.tool_calls || undefined, tool_call_id: m.tool_call_id, name: m.name }));
        let system = conv.system_prompt || SYSTEM_PROMPT;
        const projectId2 = body.project_id || conv.project_id || null;
        if (projectId2) {
          const proj = await projects.get(projectId2);
          if (proj && proj.user_id === userId) {
            system += buildProjectContextBlock(proj);
          }
        }
        // User preferences (Wave 1): same injection as the non-streaming path.
        try {
          const prefs = await preferences.get(userId);
          system += buildUserPrefsBlock(prefs);
        } catch (e) {
          console.warn(`[studio] preferences read failed for user=${userId}:`, e?.message || e);
        }

        // SSE headers
        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          "Connection": "keep-alive",
          "X-Accel-Buffering": "no",
        });
        const send = (event, data) => { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
        send("meta", { conversation_id: conversationId });

        let aborted = false;
        req.on("close", () => { aborted = true; });

        // Tool-calling phase: use non-streaming chat so we can execute tools.
        const pre = await runChatTurn({
          llm: llmClient,
          system,
          history: hist,
          userMsg: body.message,
          tools: EDIT_TOOLS,
          deps,
          userId,
          maxRounds: 6,
        });
        if (aborted) { try { res.end(); } catch {} return; }

        // Persist the tool-call exchange
        const newTurn = pre.messages.slice(hist.length + 1);
        let lastSavedId = null;
        for (const m of newTurn) {
          if (m.role === "assistant" && m.tool_calls) {
            for (const tc of m.tool_calls) {
              const args = (() => { try { return JSON.parse(tc.function.arguments || "{}"); } catch { return {}; } })();
              const toolResult = pre.messages.find((mm) => mm.role === "tool" && mm.tool_call_id === tc.id);
              let parsedResult = null;
              try { parsedResult = toolResult ? JSON.parse(toolResult.content) : null; } catch {}
              send("tool", { name: tc.function.name, args, result: parsedResult });
            }
          }
          if (m.role === "assistant") {
            const isFinal = m === newTurn[newTurn.length - 1];
            const saved = await messages.add({
              conversationId, userId, role: "assistant",
              content: m.content || "",
              toolCalls: m.tool_calls || null,
              toolResults: null,
              tokensUsed: isFinal ? pre.usage.total_tokens : 0,
              costUsd: isFinal ? pre.costUsd : 0,
            });
            lastSavedId = saved.id;
          } else if (m.role === "tool") {
            await messages.add({
              conversationId, userId, role: "tool",
              content: m.content,
              toolCalls: null,
              toolResults: { tool_call_id: m.tool_call_id, name: m.name, content: m.content },
              tokensUsed: 0, costUsd: 0,
            });
          }
        }

        // If the LLM already produced a final reply (no tools left, or after tools),
        // stream it as deltas. We stream the final text from the last assistant
        // message in pre.messages so the user sees character-by-character output.
        const finalReply = pre.reply || "";
        if (finalReply && !aborted) {
          // If we already have it, just stream it word-by-word to give the
          // streaming feel (mock mode). For real LLM, use streamChat on a
          // follow-up turn — but that needs another LLM call. For now we
          // stream the existing reply in chunks for consistent UX.
          const tokens = finalReply.match(/\S+\s*|\s+/g) || [finalReply];
          for (const tok of tokens) {
            if (aborted) break;
            send("delta", { text: tok });
            await new Promise((r) => setTimeout(r, 12));
          }
        }

        await conversations.touch(conversationId);
        if (!aborted) {
          send("done", {
            reply: finalReply,
            usage: pre.usage,
            cost_usd: pre.costUsd,
            message_id: lastSavedId,
            user_message_id: userMessageId,
            error: pre.error || null,
          });
        }
        try { res.end(); } catch {}
        return;
      }

      // ---- rewind conversation (used by Regenerate / Edit & resend) ----
      // Body: { to_message_id: "m_..." }
      // Deletes every message created strictly after `to_message_id`. The
      // client then resends the user message and the LLM re-runs the turn
      // from a clean state.
      const rewindMatch = url.match(/^\/api\/conversations\/([^/]+)\/rewind$/);
      if (rewindMatch) {
        if (req.method !== "POST") return err(res, 405, "method_not_allowed");
        const id = decodeURIComponent(rewindMatch[1]);
        const c = await conversations.get(id);
        if (!c || c.user_id !== userId) return err(res, 404, "not_found");
        let body; try { body = await readJsonBody(req); } catch (e) { return err(res, 400, "bad_json", e.message); }
        if (!body.to_message_id) return err(res, 400, "validation", "to_message_id required");
        const deleted = await messages.deleteAfter(id, body.to_message_id, userId);
        return json(res, 200, { ok: true, deleted });
      }

      // ---- edit a single message (used by Edit & resend) ----
      // Only user messages are editable; assistant / tool messages are
      // immutable so the audit trail stays intact.
      const editMsgMatch = url.match(/^\/api\/messages\/([^/]+)$/);
      if (editMsgMatch) {
        if (req.method !== "PATCH") return err(res, 405, "method_not_allowed");
        const id = decodeURIComponent(editMsgMatch[1]);
        const m = await messages.get(id);
        if (!m || m.user_id !== userId) return err(res, 404, "not_found");
        if (m.role !== "user") return err(res, 400, "validation", "only user messages are editable");
        let body; try { body = await readJsonBody(req); } catch (e) { return err(res, 400, "bad_json", e.message); }
        if (typeof body.content !== "string" || !body.content.trim()) return err(res, 400, "validation", "content required");
        if (body.content.length > 32_000) return err(res, 400, "validation", "content too long");
        await messages.updateContent(id, userId, body.content);
        return json(res, 200, { ok: true });
      }

      // ---- per-message feedback (thumbs up/down) ----
      // Body: { rating: 1 | -1, comment?: string, metadata?: {} }
      // Stored in vireo_message_feedback; powers future auto-tune pipeline.
      const feedbackMatch = url.match(/^\/api\/messages\/([^/]+)\/feedback$/);
      if (feedbackMatch) {
        if (req.method !== "POST") return err(res, 405, "method_not_allowed");
        const messageId = decodeURIComponent(feedbackMatch[1]);
        const m = await messages.get(messageId);
        if (!m || m.user_id !== userId) return err(res, 404, "not_found");
        if (m.role !== "assistant") return err(res, 400, "validation", "feedback only on assistant messages");
        if (await guardBody(req, res)) return;
        let body; try { body = await readJsonBody(req, MAX_BODY_BYTES); } catch (e) { return err(res, 400, "bad_json", e.message); }
        const rating = Number(body.rating);
        if (rating !== 1 && rating !== -1) return err(res, 400, "validation", "rating must be 1 or -1");
        let meta = {}; try { meta = capMetadata(body.metadata); } catch (e) { return err(res, e.httpStatus || 400, e.code || "validation", e.message); }
        const f = await feedback.add({
          id: newId("fb"),
          messageId,
          conversationId: m.conversation_id,
          userId,
          rating,
          comment: body.comment ? String(body.comment).slice(0, 1000) : null,
          metadata: meta,
        });
        return json(res, 201, { ok: true, feedback: f });
      }

      // ---- feedback summary for current user ----
      if (key === "GET /api/feedback/summary") {
        const s = await feedback.summaryForUser(userId);
        return json(res, 200, { ok: true, summary: s });
      }

      // ---- welcome interview (one-shot guided onboarding) ----
      if (key === "GET /api/welcome") {
        const w = await welcome.get(userId);
        return json(res, 200, { ok: true, answers: w, completed: !!w });
      }
      if (key === "POST /api/welcome") {
        if (await guardBody(req, res)) return;
        let body; try { body = await readJsonBody(req, MAX_BODY_BYTES); } catch (e) { return err(res, 400, "bad_json", e.message); }
        if (!body.niche || typeof body.niche !== "string") return err(res, 400, "validation", "niche required");
        const platforms = Array.isArray(body.platforms) ? body.platforms.slice(0, 8).map(String) : [];
        let meta = {}; try { meta = capMetadata(body.metadata); } catch (e) { return err(res, e.httpStatus || 400, e.code || "validation", e.message); }
        const w = await welcome.upsert({
          userId,
          niche: body.niche.slice(0, 200),
          platforms,
          tone: body.tone ? String(body.tone).slice(0, 50) : null,
          goals: body.goals ? String(body.goals).slice(0, 1000) : null,
          metadata: meta,
        });
        // Backwards-compat shim (Wave 1): mirror the welcome answers into
        // vireo_user_prefs so the LLM has a single source of truth. The
        // user doesn't have to fill out onboarding twice; this write is
        // idempotent and merge-safe. We do this AFTER the welcome row
        // is committed so a prefs failure doesn't break onboarding.
        preferences.upsert({
          userId,
          niche: w.niche,
          platforms: w.platforms,
          tone: w.tone,
          goals: w.goals,
          metadata: { ...(w.metadata || {}), _source: "welcome_backfill" },
        }).catch((e) => {
          // Log but don't fail the request — welcome is the primary
          // onboarding record; prefs will be filled in next time the
          // user updates any field.
          console.warn("[studio] preferences backfill from welcome failed:", e?.message || e);
        });
        return json(res, 201, { ok: true, answers: w });
      }

      // ---- user preferences (Wave 1: long-term memory per user) ----
      //
      // vireo_user_prefs is the row the LLM sees on every /api/chat call.
      // Welcome interview is the entry point (one-shot, 4 fields), but
      // prefs is what grows with the user — audience, voice_keywords,
      // default_target_sec, default_aspect_ratio. The fields are
      // overlapping on purpose: welcome answers are auto-mirrored into
      // prefs as a backfill, so the chat LLM never sees a half-empty
      // record during onboarding.
      if (key === "GET /api/preferences") {
        const p = await preferences.get(userId);
        return json(res, 200, { ok: true, preferences: p, has_preferences: !!p });
      }
      if (key === "POST /api/preferences") {
        if (await guardBody(req, res)) return;
        let body; try { body = await readJsonBody(req, MAX_BODY_BYTES); } catch (e) { return err(res, 400, "bad_json", e.message); }
        // Validation: each field is optional, but if present must be of
        // the right shape. We don't reject unknown keys here — forward
        // compatibility: future migrations adding columns should not
        // start breaking old clients.
        const platforms = body.platforms == null ? undefined
          : (Array.isArray(body.platforms) ? body.platforms.slice(0, 8).map(String) : (() => { throw { httpStatus: 400, code: "validation", message: "platforms must be array" }; })());
        const voiceKeywords = body.voice_keywords == null ? undefined
          : (Array.isArray(body.voice_keywords) ? body.voice_keywords.slice(0, 64).map((s) => String(s).toLowerCase().slice(0, 64)) : (() => { throw { httpStatus: 400, code: "validation", message: "voice_keywords must be array" }; })());
        let meta = body.metadata == null ? undefined : body.metadata;
        if (meta !== undefined) {
          try { meta = capMetadata(meta); } catch (e) { return err(res, e.httpStatus || 400, e.code || "validation", e.message); }
        }
        let p;
        try {
          p = await preferences.upsert({
            userId,
            niche: body.niche ?? undefined,
            platforms,
            tone: body.tone ?? undefined,
            goals: body.goals ?? undefined,
            audience: body.audience ?? undefined,
            voiceKeywords,
            defaultTargetSec: Number.isFinite(body.default_target_sec) ? body.default_target_sec : undefined,
            defaultAspectRatio: body.default_aspect_ratio ?? undefined,
            metadata: meta,
            merge: body.merge !== false, // default merge=true
          });
        } catch (e) {
          if (e && (e.httpStatus || e.code)) return err(res, e.httpStatus || 400, e.code || "validation", e.message);
          throw e;
        }
        return json(res, 200, { ok: true, preferences: p });
      }

      // ---- auto-title via LLM (P1 #25) ----
      // Takes the first user message of a conversation and asks the LLM
      // for a 3-5 word descriptive title. Falls back to a deterministic
      // client-side truncation if the LLM call fails (network, mock, etc).
      const autoTitleMatch = url.match(/^\/api\/conversations\/([^/]+)\/auto-title$/);
      if (autoTitleMatch && req.method === "POST") {
        const id = decodeURIComponent(autoTitleMatch[1]);
        const c = await conversations.get(id);
        if (!c || c.user_id !== userId) return err(res, 404, "not_found");
        if (c.title) return json(res, 200, { ok: true, title: c.title, cached: true });
        const msgs = await messages.listForConversation(id, { limit: 10 });
        const firstUser = msgs.find((m) => m.role === "user");
        if (!firstUser) return err(res, 400, "validation", "no user message yet");
        let title = null;
        try {
          const sys = "You are a title generator. Output ONLY a 3-5 word descriptive title (no quotes, no punctuation at end). Lower-case is fine.";
          const user = `First user message in a chat:\n\n"""${firstUser.content.slice(0, 500)}"""\n\nTitle:`;
          const r = await llmClient.chat({ system: sys, messages: [{ role: "user", content: user }], temperature: 0.5, maxTokens: 30 });
          title = (r.content || "").trim().replace(/^["'`]+|["'`]+$/g, "").split("\n")[0].slice(0, 80);
        } catch (e) {
          // LLM unavailable (mock mode without an api key, network, etc.) — fall back
        }
        if (!title) {
          title = (firstUser.content || "New chat").slice(0, 50).replace(/\s+/g, " ").trim();
        }
        await conversations.update(id, userId, { title });
        return json(res, 200, { ok: true, title });
      }

      return err(res, 404, "not_found", `no route for ${key}`);
    } catch (e) {
      console.error("[studio] error:", e);
      if (res.writableEnded) return;
      return err(res, 500, "server_error", e.message);
    }
  });

  return { server, port, host, pool, llm: llmClient, stores: { projects, pieces, conversations, messages, styleDNA } };
}

export async function start(opts = {}) {
  const { server, port, host, pool } = buildServer(opts);

  // If we're running with Postgres, make sure the schema is up to date BEFORE
  // we start accepting requests. This is idempotent — migrations track their
  // own apply state in vireo_migrations, so re-running is a no-op.
  if (pool) {
    try {
      await applyMigrations(pool);
      const applied = await listAppliedMigrations(pool);
      console.log(`[studio] postgres migrations applied: ${applied.length}`);
    } catch (e) {
      console.error("[studio] CRITICAL: migration failed:", e.message);
      // Fail loud: if the user configured VIREO_PG_URL they expect PG to work.
      // A 500 on every request because the schema is missing is worse than a crash.
      process.exit(1);
    }
  }

  server.listen(port, host, () => {
    console.log(`[studio] listening on http://${host}:${port}`);
    console.log(`[studio] llm: ${opts.llm?.isMock() ? "MOCK" : "real"} model=${opts.llm?.model || OPENAI_MODEL}`);
    console.log(`[studio] postgres: ${pool ? "connected" : "in-memory"}`);
  });

  // Graceful shutdown — drain in-flight requests and close the pool.
  // Without this, SIGTERM in k8s/docker leaves dangling PG connections
  // that the server has to reap on its own (slow, fills connection limits).
  const shutdown = async (signal) => {
    console.log(`[studio] received ${signal}, shutting down...`);
    // Stop accepting new connections, then wait for in-flight handlers
    // to finish. close() callback fires once all sockets are drained.
    await new Promise((resolve) => {
      server.close((err) => {
        if (err) console.error("[studio] http server close error:", err.message);
        else console.log("[studio] http server closed");
        resolve();
      });
      // server.close() waits for sockets — don't let it block past a sane
      // deadline. The handler-level AbortController on /api/chat/stream
      // means we won't hang for long even on a stuck SSE.
      setTimeout(() => { console.warn("[studio] shutdown timeout reached, forcing close"); resolve(); }, 10_000).unref();
    });
    if (pool) {
      try {
        await pool.end();
        console.log("[studio] pg pool closed");
      } catch (e) {
        console.error("[studio] pg pool close error:", e.message);
      }
    }
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  return server;
}

// ---- In-memory fallback stores (used when no Postgres pool is provided) ----

class InMemoryProjectStore {
  constructor() { this.items = new Map(); }
  async create(data) { const p = { id: newId("p"), user_id: data.userId, ...data, target_platforms: data.targetPlatforms, style_dna_id: data.styleDnaId, status: "active", metadata: data.metadata || {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }; delete p.userId; delete p.styleDnaId; this.items.set(p.id, p); return this._row(p); }
  async get(id) { const p = this.items.get(id); return p ? this._row(p) : null; }
  async listForUser(uid, { limit = 50 } = {}) { return [...this.items.values()].filter((p) => p.user_id === uid).sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, limit).map((p) => this._row(p)); }
  async update(id, fields) { const p = this.items.get(id); if (!p || p.user_id !== fields.userId) return null; Object.assign(p, { name: fields.name ?? p.name, niche: fields.niche ?? p.niche, description: fields.description ?? p.description, target_platforms: fields.targetPlatforms ?? p.target_platforms, style_dna_id: fields.styleDnaId ?? p.style_dna_id, status: fields.status ?? p.status, metadata: fields.metadata ?? p.metadata, updated_at: new Date().toISOString() }); return this._row(p); }
  async delete(id, uid) { const p = this.items.get(id); if (!p || p.user_id !== uid) return false; this.items.delete(id); return true; }
  _row(p) { return { ...p }; }
}

class InMemoryPieceStore {
  constructor() { this.items = new Map(); }
  async add(data) { const p = { id: newId("cp"), user_id: data.userId, project_id: data.projectId, source: data.source, source_id: data.sourceId, kind: data.kind, language: data.language || "en", text: data.text, metadata: data.metadata || {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }; this.items.set(p.id, p); return this._row(p); }
  async get(id) { const p = this.items.get(id); return p ? this._row(p) : null; }
  async listForUser(uid, { projectId = null, source = null, limit = 100 } = {}) { let list = [...this.items.values()].filter((p) => p.user_id === uid); if (projectId) list = list.filter((p) => p.project_id === projectId); if (source) list = list.filter((p) => p.source === source); return list.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit).map((p) => this._row(p)); }
  async delete(id, uid) { const p = this.items.get(id); if (!p || p.user_id !== uid) return false; this.items.delete(id); return true; }
  _row(p) { return { ...p }; }
}

class InMemoryConvStore {
  constructor() { this.items = new Map(); }
  async create(data) { const c = { id: newId("conv"), user_id: data.userId, project_id: data.projectId, title: data.title, system_prompt: data.systemPrompt, metadata: data.metadata || {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }; this.items.set(c.id, c); return this._row(c); }
  async get(id) { const c = this.items.get(id); return c ? this._row(c) : null; }
  async listForUser(uid, { projectId = null, limit = 50 } = {}) { let list = [...this.items.values()].filter((c) => c.user_id === uid); if (projectId) list = list.filter((c) => c.project_id === projectId); return list.sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, limit).map((c) => this._row(c)); }
  async touch(id) { const c = this.items.get(id); if (c) c.updated_at = new Date().toISOString(); }
  async update(id, userId, { title, metadata }) {
    const c = this.items.get(id);
    if (!c || c.user_id !== userId) return null;
    if (title !== undefined) c.title = title;
    if (metadata !== undefined) c.metadata = metadata;
    c.updated_at = new Date().toISOString();
    return this._row(c);
  }
  async delete(id, uid) { const c = this.items.get(id); if (!c || c.user_id !== uid) return false; this.items.delete(id); return true; }
  _row(c) { return { ...c }; }
}

class InMemoryMsgStore {
  constructor() { this.items = new Map(); this._seq = 0; }
  async add(data) { const m = { id: newId("m"), conversation_id: data.conversationId, user_id: data.userId, role: data.role, content: data.content, tool_calls: data.toolCalls, tool_results: data.toolResults, tokens_used: data.tokensUsed || 0, cost_usd: data.costUsd || 0, seq: ++this._seq, created_at: new Date().toISOString() }; this.items.set(m.id, m); return this._row(m); }
  async get(id) { const m = this.items.get(id); return m ? this._row(m) : null; }
  // Order by `seq` (monotonic) instead of created_at — same reason as the
  // PG store: ISO timestamps have 1ms granularity and user/assistant in
  // a single LLM turn tie, which would make findIndex on a created_at-
  // sorted list land on the wrong row.
  async listForConversation(cid, { limit = 100 } = {}) { return [...this.items.values()].filter((m) => m.conversation_id === cid).sort((a, b) => a.seq - b.seq).slice(-limit).map((m) => this._row(m)); }
  async deleteForConversation(cid, uid) { for (const [id, m] of this.items.entries()) if (m.conversation_id === cid && m.user_id === uid) this.items.delete(id); }
  async deleteAfter(cid, anchorId, uid) {
    // seq-based deletion mirrors the PG `seq > anchor.seq` query — single
    // pass, no list position lookup, no created_at tie concerns.
    const anchor = this.items.get(anchorId);
    if (!anchor || anchor.user_id !== uid) return 0;
    const anchorSeq = anchor.seq;
    let n = 0;
    for (const [id, m] of this.items.entries()) {
      if (m.conversation_id === cid && m.user_id === uid && m.seq > anchorSeq) {
        this.items.delete(id);
        n++;
      }
    }
    return n;
  }
  async updateContent(messageId, uid, content) {
    const m = this.items.get(messageId);
    if (!m || m.user_id !== uid || m.role !== "user") return 0;
    m.content = content;
    return 1;
  }
  _row(m) { return { ...m }; }
}

class InMemoryFeedbackStore {
  constructor() { this.items = new Map(); }
  async add({ id, messageId, conversationId, userId, rating, comment, metadata = {} }) {
    const f = { id, message_id: messageId, conversation_id: conversationId, user_id: userId, rating, comment: comment || null, metadata, created_at: new Date().toISOString() };
    this.items.set(id, f);
    return { ...f };
  }
  // listForUser was previously unused — kept for future feedback-explorer UI
  // but capped at 1000 rows to avoid loading the whole world into memory.
  async listForUser(uid, { limit = 100 } = {}) {
    return [...this.items.values()].filter((f) => f.user_id === uid).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, Math.min(limit, 1000));
  }
  async summaryForUser(uid) {
    // summary only needs upcount/downcount/total — no need to enumerate.
    let total = 0, upvotes = 0, downvotes = 0;
    for (const f of this.items.values()) {
      if (f.user_id !== uid) continue;
      total++;
      if (f.rating === 1) upvotes++;
      else if (f.rating === -1) downvotes++;
    }
    return { total, upvotes, downvotes };
  }
}

class InMemoryWelcomeStore {
  constructor() { this.items = new Map(); }
  async upsert({ userId, niche, platforms, tone, goals, metadata = {} }) {
    // Track created_at on first write so the dashboard can show "completed on" —
    // PG WelcomeAnswersStore sets it; the in-memory version was inconsistent.
    const existing = this.items.get(userId);
    const w = {
      user_id: userId, niche: niche || null, platforms: platforms || [], tone: tone || null, goals: goals || null, metadata,
      created_at: existing?.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.items.set(userId, w);
    return { ...w };
  }
  async get(uid) { return this.items.get(uid) || null; }
}

// In-memory shim for UserPreferencesStore.
//
// We implement the merge semantics explicitly (instead of relying on SQL
// COALESCE) because (a) the mock pool only supports simple EXCLUDED.col
// setters, and (b) keeping the merge rule here is what the tests will
// exercise. The PG path uses the same idea (COALESCE) in SQL — this
// class is the spec that the SQL is checked against.
//
// Semantics: matching the PG path, NULL/undefined fields KEEP the prior
// value. Empty arrays and empty objects also KEEP the prior value
// (so PATCH voice_keywords with [] doesn't wipe them). Pass `merge: false`
// to wipe explicitly.
class InMemoryUserPreferencesStore {
  constructor() { this.items = new Map(); }

  async upsert({
    userId,
    niche,
    platforms,
    tone,
    goals,
    audience,
    voiceKeywords,
    defaultTargetSec,
    defaultAspectRatio,
    metadata,
    merge = true,
  }) {
    const existing = this.items.get(userId) || null;
    const base = existing || {
      user_id: userId,
      niche: null,
      platforms: [],
      tone: null,
      goals: null,
      audience: null,
      voice_keywords: [],
      default_target_sec: 30,
      default_aspect_ratio: "9:16",
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const pickText = (a, b) => (a == null || a === "" ? (merge ? b : a ?? null) : a);
    const pickArray = (a, b) => {
      if (!Array.isArray(a) || a.length === 0) return merge ? (b || []) : (a || []);
      return a;
    };
    const pickObject = (a, b) => {
      if (!a || typeof a !== "object" || Object.keys(a).length === 0) {
        return merge ? (b || {}) : (a || {});
      }
      return a;
    };
    const pickNum = (a, b) => (Number.isFinite(a) ? a : (merge ? b : a ?? null));

    const row = {
      ...base,
      niche: pickText(niche, base.niche),
      platforms: pickArray(platforms, base.platforms),
      tone: pickText(tone, base.tone),
      goals: pickText(goals, base.goals),
      audience: pickText(audience, base.audience),
      voice_keywords: pickArray(voiceKeywords, base.voice_keywords),
      default_target_sec: pickNum(defaultTargetSec, base.default_target_sec),
      default_aspect_ratio: defaultAspectRatio || (merge ? base.default_aspect_ratio : (defaultAspectRatio ?? "9:16")),
      metadata: pickObject(metadata, base.metadata),
      updated_at: new Date().toISOString(),
    };
    this.items.set(userId, row);
    return { ...row };
  }

  async get(userId) {
    const v = this.items.get(userId);
    return v ? { ...v } : null;
  }

  async appendVoiceKeyword(userId, keyword) {
    if (!keyword || typeof keyword !== "string") return this.get(userId);
    const k = keyword.toLowerCase().trim().slice(0, 64);
    if (!k) return this.get(userId);
    const cur = this.items.get(userId);
    if (!cur) return null;
    const set = new Set(cur.voice_keywords || []);
    set.add(k);
    cur.voice_keywords = [...set];
    cur.updated_at = new Date().toISOString();
    this.items.set(userId, cur);
    return { ...cur };
  }
}

class InMemoryStyleDNAStore {
  constructor() { this.items = new Map(); }
  async getByName(userId, name) {
    return [...this.items.values()].find((d) => d.user_id === userId && d.name === name) || null;
  }
  async get(id) { const d = this.items.get(id); return d ? { ...d } : null; }
  async listForUser(uid) { return [...this.items.values()].filter((d) => d.user_id === uid).map((d) => ({ ...d })); }
  async upsert({ userId, name, tone, pacing, vocabulary, humor, hooks, ctas, topics, confidence, sourceCorpusSize }) {
    const existing = [...this.items.values()].find((d) => d.user_id === userId && d.name === name);
    const id = existing?.id || newId("dna");
    const d = {
      id, user_id: userId, name, tone, pacing,
      vocabulary: Array.isArray(vocabulary) ? vocabulary : (typeof vocabulary === "string" ? [vocabulary] : []),
      humor, hooks, ctas, topics,
      confidence, source_corpus_size: sourceCorpusSize,
      created_at: existing?.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.items.set(id, d);
    return { ...d };
  }
}

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  let Pool = null;
  let poolErr = null;
  try {
    ({ Pool } = await import("pg"));
  } catch (e) {
    poolErr = e;
  }
  let pool = null;
  if (process.env.VIREO_PG_URL) {
    if (!Pool) {
      // Fail loud: VIREO_PG_URL was set, meaning the operator wants Postgres.
      // Silently falling back to in-memory would mean writes vanish on restart
      // and the user has no idea why. Crash with a clear error.
      console.error("[studio] FATAL: VIREO_PG_URL is set but the 'pg' package is not installed.");
      console.error("  Install it with:  npm install pg");
      if (poolErr) console.error("  Underlying error:", poolErr.message);
      process.exit(1);
    }
    pool = new Pool({ connectionString: process.env.VIREO_PG_URL });
  }
  start({ pool });
}
