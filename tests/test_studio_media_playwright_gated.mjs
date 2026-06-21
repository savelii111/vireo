import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SOURCE = "tests/playwright/studio_media_playwright.mjs";
const SPEC = "tests/studio_media_playwright.spec.mjs";

function skip(reason) {
  console.log(`SKIPPED: Studio Day 22 Playwright C — ${reason}`);
  process.exit(0);
}

if (process.env.VIREO_SKIP_PLAYWRIGHT_C === "1") {
  skip("VIREO_SKIP_PLAYWRIGHT_C=1");
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
  });
} finally {
  fs.rmSync(path.join(ROOT, SPEC), { force: true });
}

for (const dir of ["test-results", "playwright-report"]) {
  fs.rmSync(path.join(ROOT, dir), { recursive: true, force: true });
}

if (result.error) {
  console.error(`failed to run Playwright C: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
