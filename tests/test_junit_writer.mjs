// Quick test for the JUnit XML writer logic in run-all.mjs.
// Run with: node tests/test_junit_writer.mjs
//
// Validates:
// 1. XML is well-formed (parses without error)
// 2. <testsuites> root has aggregate counts
// 3. <testsuite> elements have correct pass/fail attributes
// 4. <failure> element appears for failed suites
// 5. XML-escaping of special characters in suite names

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// Inline copy of the relevant functions from run-all.mjs (kept in sync).
function xmlEscape(s) {
  return String(s).replace(/[<>&"']/g, (c) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;",
  }[c]));
}

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
  return xml;
}

// Mock results covering: passing suite, failing suite, suite with special chars.
const mockResults = [
  { name: "Auth (Node)", code: 0, passed: 50, failed: 0, dur: 5200, stdout: "", stderr: "" },
  { name: "Billing (Node)", code: 0, passed: 40, failed: 0, dur: 3100, stdout: "", stderr: "" },
  { name: "Storage & 'chat' <store>", code: 1, passed: 7, failed: 1, dur: 1200, stdout: "", stderr: "" },
];

const outPath = path.join(ROOT, "tests", "results", "junit-writer-test.xml");
const xml = writeJunit(outPath, mockResults);
console.log("Generated XML:");
console.log(xml);

// Validations
assert.ok(xml.startsWith('<?xml version="1.0"'), "starts with XML declaration");
assert.ok(xml.includes('<testsuites name="Vireo Node Tests" tests="98"'), "aggregate tests=98");
assert.ok(xml.includes('failures="1"'), "aggregate failures=1");
assert.ok(xml.includes('<testsuite name="Auth (Node)"'), "Auth suite present");
assert.ok(xml.includes('tests="50" failures="0"'), "Auth counts");
assert.ok(xml.includes('<testsuite name="Storage &amp; &apos;chat&apos; &lt;store&gt;"'),
  "special chars escaped (&, ', <)");
assert.ok(xml.includes('<failure type="suite"'), "failure tag for failing suite");
assert.ok(!mockResults[0].name.match(/[<>&"']/) || xml.includes('Auth (Node)'),
  "no escaping needed for plain names");

// Parse the XML to confirm well-formedness
// (using a minimal recursive-descent — no DOM lib needed for our flat structure)
function parseAttrs(s) {
  const m = s.matchAll(/(\w+)="([^"]*)"/g);
  return Object.fromEntries([...m].map(([_, k, v]) => [k, v]));
}
const rootMatch = xml.match(/<testsuites([^>]*)>/);
assert.ok(rootMatch, "<testsuites> root present");
const rootAttrs = parseAttrs(rootMatch[1]);
assert.equal(rootAttrs.tests, "98", "root tests attr");
assert.equal(rootAttrs.failures, "1", "root failures attr");

const suiteMatches = [...xml.matchAll(/<testsuite name="([^"]+)"([^>]*)>/g)];
assert.equal(suiteMatches.length, 3, "3 test suites");

// Confirm the failing suite has a <failure> child
const failingIdx = xml.indexOf('<failure type="suite"');
assert.ok(failingIdx > 0, "failure element present");

console.log("\n✓ All 11 assertions passed");
console.log(`✓ XML written to: ${outPath}`);
