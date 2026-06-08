// F2+F3: Code quality helpers tests (2026-06-08).
import { test } from "node:test";
import assert from "node:assert/strict";
import { addDeprecationHeaders, runAll, pSettledMap } from "../src/quality.js";

test("F3: addDeprecationHeaders sets Deprecation header", () => {
  const headers = {};
  const res = { setHeader: (k, v) => { headers[k] = v; } };
  addDeprecationHeaders(res, {});
  assert.equal(headers.Deprecation, "true");
});

test("F3: addDeprecationHeaders includes Sunset date when provided", () => {
  const headers = {};
  const res = { setHeader: (k, v) => { headers[k] = v; } };
  addDeprecationHeaders(res, { sunset: "2027-01-01" });
  assert.equal(headers.Sunset, "2027-01-01");
  assert.equal(headers.Deprecation, "true");
});

test("F3: addDeprecationHeaders includes since date in Deprecation header", () => {
  const headers = {};
  const res = { setHeader: (k, v) => { headers[k] = v; } };
  addDeprecationHeaders(res, { since: "2026-06-01" });
  assert.equal(headers.Deprecation, "2026-06-01");
});

test("F3: addDeprecationHeaders includes Link rel successor-version", () => {
  const headers = {};
  const res = { setHeader: (k, v) => { headers[k] = v; } };
  addDeprecationHeaders(res, { replacement: "/api/v2/projects" });
  assert.ok(headers.Link.includes("/api/v2/projects"));
  assert.ok(headers.Link.includes("successor-version"));
});

test("F2: runAll returns ok:true for each successful task", async () => {
  const r = await runAll({
    a: async () => 1,
    b: async () => "two",
    c: async () => null,
  });
  assert.equal(r.a.ok, true);
  assert.equal(r.a.value, 1);
  assert.equal(r.b.ok, true);
  assert.equal(r.b.value, "two");
  assert.equal(r.c.ok, true);
});

test("F2: runAll isolates failures (one error doesn't break others)", async () => {
  const r = await runAll({
    good: async () => "ok",
    bad: async () => { throw new Error("oops"); },
    alsoGood: async () => 42,
  });
  assert.equal(r.good.ok, true);
  assert.equal(r.bad.ok, false);
  assert.match(r.bad.error, /oops/);
  assert.equal(r.alsoGood.ok, true);
  assert.equal(r.alsoGood.value, 42);
});

test("F2: runAll handles empty input", async () => {
  const r = await runAll({});
  assert.deepEqual(r, {});
});

test("F2: pSettledMap runs mapper over each item in parallel", async () => {
  const r = await pSettledMap([1, 2, 3], async (n) => n * 2);
  assert.equal(r.length, 3);
  assert.deepEqual(r.map((x) => x.value), [2, 4, 6]);
});

test("F2: pSettledMap captures per-item errors", async () => {
  const r = await pSettledMap([1, 2, 3], async (n) => {
    if (n === 2) throw new Error("two is bad");
    return n;
  });
  assert.equal(r[0].ok, true);
  assert.equal(r[1].ok, false);
  assert.match(r[1].error, /two is bad/);
  assert.equal(r[2].ok, true);
});

test("F2: pSettledMap returns the same length as input", async () => {
  const r = await pSettledMap([1, 2, 3, 4, 5], async () => { throw new Error(); });
  assert.equal(r.length, 5);
  for (const item of r) assert.equal(item.ok, false);
});

test("F2: pSettledMap passes index to mapper", async () => {
  const seen = [];
  await pSettledMap(["a", "b", "c"], async (v, i) => {
    seen.push([v, i]);
    return v;
  });
  assert.deepEqual(seen, [["a", 0], ["b", 1], ["c", 2]]);
});
