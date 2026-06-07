// Vireo — multi-agent orchestrator.
//
// Wires Style Learner (Python) + Editor (Python) + Distributor (Node) + Analyst (Node)
// into a single pipeline. The orchestrator runs them in sequence for a given
// piece of content:
//
//   1. Style Learner   → produce/refresh StyleDNA from creator's past work
//   2. Editor          → cut raw content to target length using StyleDNA
//   3. Distributor     → adapt + schedule for 10 platforms using StyleDNA
//   4. Analyst         → (later) track metrics, refine StyleDNA
//
// The orchestrator can be run in two modes:
//   - inline:  agents are loaded in-process (Node calls Python via dynamic
//              child_process or via the HTTP servers)
//   - http:    each agent is its own microservice (for prod)

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { newId, nowIso, PLATFORMS } from "@vireo/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// In-process Python agents (spawn a child Python process and call it).
// Simpler than HTTP for the orchestrator demo; the HTTP servers are also
// fully usable in production.
// ---------------------------------------------------------------------------

function pythonAgent(scriptPath, args = []) {
  return spawn("python", ["-m", scriptPath, ...args], {
    cwd: ROOT,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function callPython(agent, payload) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const errs = [];
    agent.stdout.on("data", (c) => chunks.push(c));
    agent.stderr.on("data", (c) => errs.push(c));
    agent.on("error", reject);
    agent.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(`Python exited ${code}: ${Buffer.concat(errs).toString()}`));
      }
      const out = Buffer.concat(chunks).toString();
      try {
        resolve(JSON.parse(out));
      } catch (e) {
        reject(new Error(`Bad Python output: ${out.slice(0, 200)}`));
      }
    });
    agent.stdin.write(JSON.stringify(payload));
    agent.stdin.end();
  });
}

export async function callStyleLearnerInline(pieces, userId) {
  const py = pythonAgent("vireo_style_learner.__main__");
  return callPython(py, { pieces, user_id: userId });
}

export async function callEditorInline(content, styleDna, targetSec) {
  const py = pythonAgent("vireo_editor.__main__");
  return callPython(py, { content, style_dna: styleDna, target_sec: targetSec });
}

// ---------------------------------------------------------------------------
// In-process Node agents (imported directly).
// ---------------------------------------------------------------------------

import { adaptToAllPlatforms, PLATFORM_ADAPTERS } from "../../agents/distributor/src/adapters.js";
import { buildSchedule } from "../../agents/distributor/src/scheduler.js";
import { JobStore } from "../../agents/distributor/src/store.js";
import { Distributor } from "../../agents/distributor/src/distributor.js";
import { mockPublisher } from "../../agents/distributor/src/mock_publisher.js";
import { Analyst } from "../../agents/analyst/src/analyst.js";
import { StyleLearner } from "../../agents/analyst/src/learner.js";

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export class VireoPipeline {
  constructor() {
    this.store = new JobStore();
    this.distributor = new Distributor(this.store);
    this.analyst = new Analyst();
  }

  /**
   * Run the full pipeline on a piece of raw content.
   * @param {object} req
   * @param {Array}  req.corpus        - Past pieces for Style Learner (or empty if cold-start)
   * @param {string} req.userId
   * @param {object} req.rawContent    - {id, text, duration_sec} or {id, segments}
   * @param {number} req.targetSec
   * @param {Array}  req.platforms     - defaults to all PLATFORMS
   * @returns {Promise<object>} the full pipeline result
   */
  async run({ corpus, userId = "u1", rawContent, targetSec = 60, platforms = PLATFORMS }) {
    const runId = newId();
    const t0 = Date.now();

    // Step 1: Style Learner
    const dnaResult = await callStyleLearnerInline(corpus || [], userId);
    const styleDna = dnaResult.style_dna;

    // Step 2: Editor
    const editResult = await callEditorInline(rawContent, styleDna, targetSec);
    const editPlan = editResult.edit_plan;

    // Step 3: Distributor
    const distribution = this.distributor.distribute({
      editPlan,
      styleDna,
      platforms,
      contentId: rawContent.id || runId,
    });

    return {
      run_id: runId,
      started_at: nowIso(),
      duration_ms: Date.now() - t0,
      style_dna: styleDna,
      edit_plan: editPlan,
      distribution,
    };
  }

  /**
   * Run the worker tick: publish all due jobs.
   */
  async tick() {
    return this.distributor.runDue(mockPublisher);
  }

  /**
   * Ingest post-publish metrics, then return the next-gen StyleDNA.
   */
  async feedback(snapshots) {
    for (const s of snapshots) this.analyst.ingest(s);
    const currentDna = this.store.jobs[0]?.metadata?.style_dna || {};
    return this.analyst.learn(currentDna);
  }

  report({ days = 7 } = {}) {
    return this.analyst.report({ days });
  }
}

// ---------------------------------------------------------------------------
// CLI entry: `node apps/orchestrator/index.js` runs a smoke test
// ---------------------------------------------------------------------------

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}`) {
  (async () => {
    console.log("[orchestrator] starting smoke test…");

    // The orchestrator can be used inline (call Style Learner / Editor as
    // child processes). For now, the Node parts (Distributor + Analyst) work
    // in-process. The Python parts require a separate child process.

    const { VireoPipeline } = await import("./index.js");
    const pipe = new VireoPipeline();

    // Demo: just test the Node parts
    const dist = pipe.distributor.distribute({
      editPlan: {
        source_id: "demo",
        cuts: [
          { start: 0, end: 5, text: "Stop! You need to see this.", score: 0.9, role: "hook" },
          { start: 5, end: 20, text: "Vireo is the first AI that learns your style.", score: 0.8, role: "body" },
          { start: 20, end: 25, text: "Subscribe!", score: 0.6, role: "cta" },
        ],
        output_duration_sec: 25,
        style_applied: {},
        notes: "Demo",
      },
      styleDna: { tone: "energetic", topics: ["AI"], hook_patterns: ["command"], cta_patterns: ["engagement"] },
      platforms: ["youtube", "youtube_shorts", "tiktok", "x", "linkedin"],
      contentId: "demo-1",
    });
    console.log(`[orchestrator] distributed to ${dist.platforms} platforms`);
    console.log(`[orchestrator] first job:`, dist.jobs[0]);

    // Force due and publish
    for (const j of pipe.store.list()) {
      pipe.store.update(j.id, { scheduled_at: "2020-01-01T00:00:00Z" });
    }
    const ok = await pipe.tick();
    console.log(`[orchestrator] published ${ok} jobs`);

    // Ingest some fake metrics
    for (const job of pipe.store.list({ status: "published" })) {
      pipe.analyst.ingest({
        content_id: job.content_id,
        platform: job.platform,
        views: Math.floor(Math.random() * 10000),
        likes: Math.floor(Math.random() * 500),
        comments: Math.floor(Math.random() * 50),
      });
    }
    console.log("[orchestrator] report:", pipe.report());
  })().catch((e) => {
    console.error("[orchestrator] FAIL:", e.message);
    process.exit(1);
  });
}
