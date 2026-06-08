// C4: PII scrubber tests (2026-06-08).
import { test } from "node:test";
import assert from "node:assert/strict";
import { scrubMetadata, scrubMetadataJson } from "../src/gdpr_store.js";

test("C4: scrubs known PII keys at top level", () => {
  const out = scrubMetadata({ email: "user@example.com", phone: "555-1234", name: "John" });
  assert.equal(out.email, "[redacted:pii]");
  assert.equal(out.phone, "[redacted:pii]");
  assert.equal(out.name, "John", "non-PII keys are kept");
});

test("C4: scrubs PII keys at any depth", () => {
  const out = scrubMetadata({ user: { profile: { email: "a@b.com", name: "A" } } });
  assert.equal(out.user.profile.email, "[redacted:pii]");
  assert.equal(out.user.profile.name, "A");
});

test("C4: scrubs arrays of PII objects", () => {
  const out = scrubMetadata({ contacts: [{ email: "a@b.com" }, { email: "c@d.com", phone: "555" }] });
  assert.equal(out.contacts[0].email, "[redacted:pii]");
  assert.equal(out.contacts[1].email, "[redacted:pii]");
  assert.equal(out.contacts[1].phone, "[redacted:pii]");
});

test("C4: scrubs PII values that look like emails (not just keys)", () => {
  const out = scrubMetadata({ note: "Reach me at user@example.com please" });
  assert.equal(out.note, "[redacted:sensitive]");
});

test("C4: scrubs PII values that look like JWTs", () => {
  const out = scrubMetadata({ token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature_xx" });
  assert.equal(out.token, "[redacted:pii]", "key-based: token is in PII_KEYS");
  const out2 = scrubMetadata({ note: "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature_xx" });
  assert.equal(out2.note, "[redacted:sensitive]", "value-based: JWT shape detected");
});

test("C4: scrubs PII values that look like credit cards", () => {
  const out = scrubMetadata({ note: "4532015112830366" });
  assert.equal(out.note, "[redacted:sensitive]");
});

test("C4: truncates strings > 200 chars", () => {
  const long = "x".repeat(500);
  const out = scrubMetadata({ text: long });
  assert.match(out.text, /^\[truncated \d+ chars\]$/);
  assert.ok(out.text.length < 100, "truncated marker is short");
});

test("C4: caps recursion depth at 8 levels", () => {
  const deep = { a: { b: { c: { d: { e: { f: { g: { h: { i: "deep" } } } } } } } } };
  const out = scrubMetadata(deep);
  // After 8 levels we should see [depth-exceeded]
  assert.equal(out.a.b.c.d.e.f.g.h.i, "[depth-exceeded]");
});

test("C4: handles null, undefined, primitives", () => {
  assert.equal(scrubMetadata(null), null);
  assert.equal(scrubMetadata(undefined), undefined);
  assert.equal(scrubMetadata(42), 42);
  assert.equal(scrubMetadata(true), true);
  assert.equal(scrubMetadata("short"), "short");
});

test("C4: scrubsVariant key matches: API_KEY, ApiKey, api_key all work", () => {
  const out = scrubMetadata({ API_KEY: "x", ApiKey: "y", api_key: "z", apiKey: "w", "api-key": "u" });
  // All should be redacted (case-insensitive comparison)
  assert.equal(out.API_KEY, "[redacted:pii]");
  assert.equal(out.ApiKey, "[redacted:pii]");
  assert.equal(out.api_key, "[redacted:pii]");
  assert.equal(out.apiKey, "[redacted:pii]");
  assert.equal(out["api-key"], "[redacted:pii]", "dash-form also matches");
});

test("C4: scrubMetadataJson never throws on circular refs", () => {
  const obj = { name: "test" };
  obj.self = obj; // circular
  const json = scrubMetadataJson(obj);
  // The outer call returns "[unserializable]" or similar; the
  // outer scrubMetadataJson wraps in a try/catch and returns
  // an error envelope. Both are acceptable.
  const parsed = JSON.parse(json);
  assert.ok(parsed._error || parsed._truncated || parsed.name, "returns valid JSON envelope");
});

test("C4: scrubMetadataJson caps output at 4KB", () => {
  const huge = { items: Array.from({ length: 1000 }, (_, i) => ({ id: i, text: "x".repeat(50) })) };
  const json = scrubMetadataJson(huge);
  assert.ok(json.length <= 4096, `output should be <= 4KB, got ${json.length}`);
});

test("C4: scrubMetadataJson returns valid JSON", () => {
  const json = scrubMetadataJson({ email: "a@b.com", name: "X" });
  const parsed = JSON.parse(json);
  assert.equal(parsed.email, "[redacted:pii]");
  assert.equal(parsed.name, "X");
});

test("C4: scrubMetadata preserves numbers and booleans", () => {
  const out = scrubMetadata({ count: 42, active: true, ratio: 3.14, missing: null });
  assert.equal(out.count, 42);
  assert.equal(out.active, true);
  assert.equal(out.ratio, 3.14);
  assert.equal(out.missing, null);
});
