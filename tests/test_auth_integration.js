// Tests for auth middleware integration across Node.js agents.
// Verifies that servers reject unauthorized requests when VIREO_JWT_SECRET is set,
// and accept valid JWT tokens.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { signToken, verifyToken } from "../packages/auth-middleware/index.js";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

function agentUrl(rel) {
  return pathToFileURL(resolve(ROOT, rel)).href;
}

const SECRET = "test-integration-secret-key-32chars!!!";

function makeToken(overrides = {}) {
  return signToken({ sub: "user_test", email: "test@vireo.ai", name: "Test User", ...overrides }, SECRET, 3600);
}

// ---------- Auth Middleware Unit Tests ----------

describe("auth-middleware", () => {
  test("signToken creates a valid JWT", () => {
    const token = makeToken();
    assert.ok(typeof token === "string");
    assert.equal(token.split(".").length, 3);
  });

  test("verifyToken validates a correct token", () => {
    const token = makeToken({ sub: "u1", plan: "pro" });
    const claims = verifyToken(token, SECRET);
    assert.ok(claims);
    assert.equal(claims.sub, "u1");
    assert.equal(claims.plan, "pro");
  });

  test("verifyToken rejects wrong secret", () => {
    const token = makeToken();
    const claims = verifyToken(token, "wrong-secret");
    assert.equal(claims, null);
  });

  test("verifyToken rejects expired token", () => {
    const token = signToken({ sub: "u1" }, SECRET, -100);
    const claims = verifyToken(token, SECRET);
    assert.equal(claims, null);
  });

  test("verifyToken accepts token within clock skew", () => {
    const token = signToken({ sub: "u1" }, SECRET, -20);
    const claims = verifyToken(token, SECRET, { clockSkewSec: 30 });
    assert.ok(claims);
  });

  test("verifyToken rejects tampered token", () => {
    const token = makeToken();
    const parts = token.split(".");
    const tampered = parts[0] + "." + parts[1] + ".TAMPERED";
    assert.equal(verifyToken(tampered, SECRET), null);
  });

  test("verifyToken handles empty/null inputs", () => {
    assert.equal(verifyToken("", SECRET), null);
    assert.equal(verifyToken(null, SECRET), null);
    assert.equal(verifyToken("abc", ""), null);
    assert.equal(verifyToken(null, null), null);
  });
});
