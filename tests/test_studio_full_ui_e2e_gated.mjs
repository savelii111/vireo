// Day 25: real end-to-end Studio UI happy path. Brings up the
// real Studio HTTP server, drives Chromium through the full
// flow (onboarding → import → drag → export → ffprobe) and
// asserts the resulting mp4. Self-gates when the Playwright
// Chromium binary or ffmpeg is missing so CI can skip cleanly.
//
// IMPORTANT: this wrapper is a copy of the D22 gated pattern
// (tests/test_studio_media_playwright_gated.mjs) with only
// the source/temp spec paths and skip reason swapped. The
// probe step uses `cwd: ROOT` so the spawned `node -e` finds
// the local @playwright/test from the project node_modules.
// Do NOT change to NODE_PATH or absolute require() — those
// earlier attempts failed because the actual bug was `ROOT`
// being two levels up (off the repo).
//
// The temp .spec.mjs is copied into tests/playwright/ (next
// to the source) instead of tests/ so that __dirname = "../
// playwright" inside the spec gives a stable `..` for the
// project root, regardless of which folder the spec is run
// from. The D22 spec lives next to its source, so we follow
// the same convention.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SOURCE = "tests/playwright/studio_full_ui_e2e.mjs";
const SPEC = "tests/playwright/studio_full_ui_e2e.spec.mjs";

function skip(reason) {
  console.log(`SKIPPED: Studio Day 25 full UI e2e — ${reason}`);
  process.exit(0);
}

if (process.env.VIREO_SKIP_PLAYWRIGHT_D25 === "1") {
  skip("VIREO_SKIP_PLAYWRIGHT_D25=1");
}

const ffmpeg = spawnSync(process.platform === "win32" ? "where.exe" : "command", process.platform === "win32" ? ["ffmpeg"] : ["-v", "ffmpeg"], {
  cwd: ROOT,
  shell: true,
});
if (ffmpeg.status !== 0) skip("ffmpeg binary not found");

const probe = spawnSync("node", ["-e", "const p=require('@playwright/test'); console.log(p.chromium.executablePath());"], {
  cwd: ROOT,
  encoding: "utf8",
});
if (probe.status !== 0) skip("@playwright/test package not installed");
const exe = String(probe.stdout || "").trim();
if (!exe || !fs.existsSync(exe)) skip(`Chromium binary not found at ${exe || "<unknown>"}`);

const PLAYWRIGHT_CLI = path.join(ROOT, "node_modules/@playwright/test/cli.js");
if (!fs.existsSync(PLAYWRIGHT_CLI)) skip("Playwright CLI not found in local node_modules/@playwright/test");
const sourceSpec = path.join(ROOT, SOURCE);
if (!fs.existsSync(sourceSpec)) skip(`Playwright source spec not found at ${sourceSpec}`);

fs.copyFileSync(sourceSpec, path.join(ROOT, SPEC));
let result;
try {
  result = spawnSync(process.execPath, [PLAYWRIGHT_CLI, "test", SPEC, "--reporter=line"], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, VIREO_D25_FULL_UI: "1" },
  });
} finally {
  fs.rmSync(path.join(ROOT, SPEC), { force: true });
}

for (const dir of ["test-results", "playwright-report"]) {
  fs.rmSync(path.join(ROOT, dir), { recursive: true, force: true });
}

if (result.error) {
  console.error(`failed to run Playwright D25: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
