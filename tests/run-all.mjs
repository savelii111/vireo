// Master test runner — runs every agent's tests and reports a unified score.
//
// Usage:
//   node tests/run-all.mjs                          # print summary, exit 0/1
//   node tests/run-all.mjs --junit=path/to/out.xml  # also write JUnit XML
//                                                    # for CI test reporters
//                                                    # (e.g. dorny/test-reporter)

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// Parse --junit=<path> flag (no external deps).
const junitArg = process.argv.slice(2).find((a) => a.startsWith("--junit="));
const junitPath = junitArg ? junitArg.slice("--junit=".length) : null;

const SUITES = [
  { name: "Style Learner (Python)", cmd: "python", args: ["-m", "pytest", "agents/style-learner/tests/", "-v", "--tb=no", "-q"] },
  { name: "Editor (Python)",        cmd: "python", args: ["-m", "pytest", "agents/editor/tests/", "-v", "--tb=no", "-q"] },
  { name: "Video (Python)",         cmd: "python", args: ["-m", "pytest", "agents/video/tests/", "-v", "--tb=no", "-q"] },
  { name: "Distributor (Node)",     cmd: "node",   args: ["--test", "agents/distributor/tests/test_adapters.js", "agents/distributor/tests/test_scheduler.js", "agents/distributor/tests/test_distributor.js", "agents/distributor/tests/test_youtube_publisher.js", "agents/distributor/tests/test_platform_publishers.js", "agents/distributor/tests/test_fixes.js"] },
  { name: "Distributor server (Node)", cmd: "node", args: ["--test", "agents/distributor/tests/test_server.js"] },
  { name: "Analyst (Node)",         cmd: "node",   args: ["--test", "agents/analyst/tests/test_metrics.js", "agents/analyst/tests/test_analyst.js"] },
  { name: "Analyst server (Node)",  cmd: "node",   args: ["--test", "agents/analyst/tests/test_server.js"] },
  { name: "Storage (Node)",         cmd: "node",   args: ["--test", "agents/storage/tests/test_storage.js", "agents/storage/tests/test_migrations.js", "agents/storage/tests/test_storage_timeline_migration.js"] },
  { name: "Auth (Node)",            cmd: "node",   args: ["--test", "agents/auth/tests/test_auth.js", "agents/auth/tests/test_users_pg.js"] },
  { name: "Billing (Node)",         cmd: "node",   args: ["--test", "agents/billing/tests/test_billing.js"] },
  { name: "Billing Stripe (Node)",  cmd: "node",   args: ["--test", "agents/billing/tests/test_billing_stripe.js"] },
  { name: "StripeClient (Node)",    cmd: "node",   args: ["--test", "agents/billing/tests/test_stripe_client.js"] },
  { name: "Ingest (Node)",          cmd: "node",   args: ["--test", "agents/ingest/tests/test_ingest.js"] },
  { name: "OAuth core (Python)",    cmd: "python", args: ["-m", "pytest", "tests/test_oauth.py", "-v", "--tb=no", "-q"], cwd: "agents/oauth", env: { PYTHONPATH: "." } },
  { name: "OAuth server (Node)",    cmd: "node",   args: ["--test", "agents/oauth/tests/test_oauth_server.js"] },
  { name: "Dashboard (Node)",       cmd: "node",   args: ["--test", "apps/dashboard/tests/test_server.js"] },
  { name: "Studio (Node)",          cmd: "node",   args: ["--test", "agents/studio/tests/test_server.js", "agents/studio/tests/test_server_pg.js", "agents/studio/tests/test_fixes.js", "agents/studio/tests/test_api_timeline.js", "agents/studio/tests/test_timeline_ops.js"] },
  { name: "Storage chat store (Node)", cmd: "node", args: ["--test", "agents/storage/tests/test_chat_store.js"] },
  { name: "E2E Pipeline (Node)",    cmd: "node",   args: ["--test", "apps/orchestrator/tests/test_e2e.js"] },
  { name: "Integration (Node)", cmd: "node",  args: ["--test", "apps/orchestrator/tests/test_integration.js"] },
  { name: "Auth Integration (Node)", cmd: "node", args: ["--test", "tests/test_auth_integration.js"] },
  { name: "Shared Timeline Contract (Node)", cmd: "node", args: ["--test", "tests/test_shared_timeline.js"] },
  { name: "Desktop (Node)", cmd: "node", args: ["--test", "tests/test_desktop_app.js"] },
  { name: "Studio E2E (Node)",      cmd: "node",  args: ["--test", "tests/test_studio_e2e.mjs"] },
  { name: "Phase 3 Smoke (Node)",   cmd: "node",   args: ["--test", "tests/test_phase3_smoke.mjs"] },
  { name: "Phase 4 CI JUnit writer (Node)", cmd: "node", args: ["--test", "tests/test_junit_writer.mjs"] },
  { name: "Monitoring (Node)",      cmd: "node",  args: ["--test", "agents/monitoring/tests/test_monitoring.js"] },
  { name: "JWT Auth (Python)",      cmd: "python", args: ["-m", "pytest", "packages/shared/python/tests/test_jwt_auth.py", "-v", "--tb=no", "-q"] },
];

function run(suite) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(suite.cmd, suite.args, { cwd: suite.cwd ? path.join(ROOT, suite.cwd) : ROOT, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (c) => { out += c.toString(); process.stdout.write(c); });
    child.stderr.on("data", (c) => { err += c.toString(); });
    child.on("close", (code) => {
      const dur = Date.now() - t0;
      // Parse pytest format: "X passed in Y" or "X passed, Y failed in Z"
      // Parse Node test runner format: "ℹ tests X\nℹ pass Y\nℹ fail Z"
      let passed = 0;
      let failed = 0;

      // pytest: "X passed" or "X passed, Y failed"
      const pytestPassed = out.match(/(\d+)\s+passed/g);
      if (pytestPassed) {
        // Take the LAST match (final summary)
        passed = Number(pytestPassed[pytestPassed.length - 1].match(/(\d+)/)[1]);
        const pytestFailed = out.match(/(\d+)\s+failed/g);
        if (pytestFailed) {
          failed = Number(pytestFailed[pytestFailed.length - 1].match(/(\d+)/)[1]);
        }
      }

      // Node test runner: "ℹ pass X" / "ℹ fail X"
      const nodePass = out.match(/ℹ pass (\d+)/);
      const nodeFail = out.match(/ℹ fail (\d+)/);
      if (nodePass) passed = Number(nodePass[1]);
      if (nodeFail) failed = Number(nodeFail[1]);

      resolve({ name: suite.name, code, passed, failed, dur, stdout: out, stderr: err });
    });
  });
}

function sumMatches(s, re) {
  const matches = [...s.matchAll(re)];
  return matches.reduce((acc, m) => acc + Number(m[1]), 0);
}

// XML-escape a string for JUnit output.
function xmlEscape(s) {
  return String(s).replace(/[<>&"']/g, (c) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;",
  }[c]));
}

// Write JUnit XML aggregating per-suite pass/fail counts.
// Schema: standard <testsuites> with one <testsuite> per run-all suite.
// CI tools like dorny/test-reporter parse this directly.
function writeJunit(filePath, results) {
  const totalTests = results.reduce((s, r) => s + r.passed + r.failed, 0);
  const totalFail = results.reduce((s, r) => s + r.failed, 0);
  const totalTime = (results.reduce((s, r) => s + r.dur, 0) / 1000).toFixed(3);

  const suites = results.map((r) => {
    const tests = r.passed + r.failed;
    const time = (r.dur / 1000).toFixed(3);
    const safeName = xmlEscape(r.name);
    const failTag =
      r.failed > 0
        ? `\n    <failure type="suite" message="${r.failed} of ${tests} test(s) failed">Suite: ${safeName} (exit code ${r.code})</failure>`
        : "";
    return (
      `  <testsuite name="${safeName}" tests="${tests}" failures="${r.failed}" ` +
      `errors="0" skipped="0" time="${time}" timestamp="${new Date().toISOString()}">${failTag}\n  </testsuite>`
    );
  });

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<testsuites name="Vireo Node Tests" tests="${totalTests}" ` +
    `failures="${totalFail}" errors="0" time="${totalTime}">\n` +
    suites.join("\n") +
    `\n</testsuites>\n`;

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, xml, "utf8");
  console.log(`\n📝 JUnit XML written: ${filePath}`);
}

(async () => {
  console.log("=".repeat(70));
  console.log("  VIREO — Multi-Agent Test Suite");
  console.log("=".repeat(70));

  let totalPass = 0;
  let totalFail = 0;
  const results = [];

  for (const suite of SUITES) {
    console.log(`\n▶ ${suite.name}`);
    const r = await run(suite);
    results.push(r);
    totalPass += r.passed;
    totalFail += r.failed;
  }

  console.log("\n" + "=".repeat(70));
  console.log("  RESULTS SUMMARY");
  console.log("=".repeat(70));
  for (const r of results) {
    const status = r.failed === 0 ? "✓ PASS" : "✗ FAIL";
    console.log(`${status.padEnd(8)} ${r.name.padEnd(36)} ${String(r.passed).padStart(4)} passed, ${String(r.failed).padStart(2)} failed  (${r.dur}ms)`);
  }
  console.log("=".repeat(70));
  console.log(`  TOTAL: ${totalPass} passed, ${totalFail} failed across ${results.length} suites`);
  console.log("=".repeat(70));

  if (junitPath) {
    writeJunit(junitPath, results);
  }

  process.exit(totalFail === 0 ? 0 : 1);
})();
