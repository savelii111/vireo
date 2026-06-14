// Vireo Auth — comprehensive tests.

import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, PasswordTooShortError } from "../src/password.js";
import { sign, verify, TokenError } from "../src/tokens.js";
import { UserStore, ValidationError, EmailTakenError } from "../src/users.js";
import { authMiddleware, readJsonBody } from "../src/middleware.js";
import { buildServer, start } from "../src/server.js";

// =====================================================================
// password.js
// =====================================================================

test("password: hashes a password and returns a scrypt$ string", async () => {
  const h = await hashPassword("hunter2hunter2");
  assert.match(h, /^scrypt\$\d+\$\d+\$\d+\$[a-f0-9]+\$[a-f0-9]+$/);
  // hash should be different each time (random salt)
  const h2 = await hashPassword("hunter2hunter2");
  assert.notEqual(h, h2);
});

test("password: verifies correct password", async () => {
  const h = await hashPassword("correcthorsebatterystaple");
  assert.equal(await verifyPassword("correcthorsebatterystaple", h), true);
});

test("password: rejects wrong password", async () => {
  const h = await hashPassword("correcthorsebatterystaple");
  assert.equal(await verifyPassword("wrongpassword", h), false);
});

test("password: rejects empty/short password with PasswordTooShortError", async () => {
  await assert.rejects(() => hashPassword(""), PasswordTooShortError);
  await assert.rejects(() => hashPassword("short"), PasswordTooShortError);
  await assert.rejects(() => hashPassword(123), PasswordTooShortError);
});

test("password: verify returns false for malformed stored hash", async () => {
  assert.equal(await verifyPassword("foo", "not-a-real-hash"), false);
  assert.equal(await verifyPassword("foo", "scrypt$1$2$3$abcd"), false);
  assert.equal(await verifyPassword("foo", ""), false);
});

// =====================================================================
// tokens.js
// =====================================================================

test("tokens: sign produces 3-part JWT", () => {
  const t = sign({ sub: "u1" }, "secret");
  assert.equal(typeof t, "string");
  assert.equal(t.split(".").length, 3);
});

test("tokens: sign/verify round-trip", () => {
  const t = sign({ sub: "user-123", email: "a@b.com" }, "secret");
  const claims = verify(t, "secret");
  assert.equal(claims.sub, "user-123");
  assert.equal(claims.email, "a@b.com");
  assert.ok(claims.iat, "should have iat");
  assert.ok(claims.exp > claims.iat, "exp > iat");
  assert.ok(claims.jti, "should have jti");
});

test("tokens: verify rejects wrong secret", () => {
  const t = sign({ sub: "u1" }, "secret-a");
  assert.throws(() => verify(t, "secret-b"), (e) => e instanceof TokenError && e.code === "bad_signature");
});

test("tokens: verify rejects malformed token", () => {
  assert.throws(() => verify("not-a-jwt", "secret"), TokenError);
  assert.throws(() => verify("a.b", "secret"), TokenError);
  assert.throws(() => verify("a.b.c.d", "secret"), TokenError);
  assert.throws(() => verify("", "secret"), TokenError);
  assert.throws(() => verify(null, "secret"), TokenError);
});

test("tokens: verify rejects expired token", () => {
  const t = sign({ sub: "u1" }, "secret", -10); // expired 10s ago
  assert.throws(() => verify(t, "secret"), (e) => e instanceof TokenError && e.code === "expired");
});

test("tokens: verify accepts token within clock skew", () => {
  const t = sign({ sub: "u1" }, "secret", -2); // expired 2s ago, within 5s skew
  const c = verify(t, "secret", { clockSkewSec: 5 });
  assert.equal(c.sub, "u1");
});

test("tokens: each signed token has unique jti", () => {
  const t1 = sign({ sub: "u1" }, "secret");
  const t2 = sign({ sub: "u1" }, "secret");
  const c1 = verify(t1, "secret");
  const c2 = verify(t2, "secret");
  assert.notEqual(c1.jti, c2.jti);
});

test("tokens: sign with custom TTL", () => {
  const t = sign({ sub: "u1" }, "secret", 60);
  const c = verify(t, "secret");
  assert.equal(c.exp - c.iat, 60);
});

// =====================================================================
// users.js
// =====================================================================

test("users: signup creates a new user", async () => {
  const s = new UserStore();
  const u = await s.signup({ email: "Alice@Example.COM", password: "hunter2hunter2", name: "Alice" });
  assert.equal(u.email, "alice@example.com");
  assert.equal(u.name, "Alice");
  assert.equal(s.size(), 1);
  assert.ok(u.id, "should have id");
  assert.ok(u.createdAt, "should have createdAt");
  assert.ok(u.passwordHash.startsWith("scrypt$"));
});

test("users: signup lowercases email and dedupes", async () => {
  const s = new UserStore();
  await s.signup({ email: "bob@x.com", password: "hunter2hunter2" });
  await assert.rejects(
    () => s.signup({ email: "BOB@x.com", password: "different" }),
    EmailTakenError
  );
});

test("users: signup rejects invalid email", async () => {
  const s = new UserStore();
  await assert.rejects(() => s.signup({ email: "no-at-sign", password: "hunter2hunter2" }), ValidationError);
  await assert.rejects(() => s.signup({ email: "", password: "hunter2hunter2" }), ValidationError);
  await assert.rejects(() => s.signup({ email: null, password: "hunter2hunter2" }), ValidationError);
});

test("users: signup rejects weak password", async () => {
  const s = new UserStore();
  await assert.rejects(() => s.signup({ email: "a@b.com", password: "short" }), PasswordTooShortError);
});

test("users: login with correct password returns user", async () => {
  const s = new UserStore();
  await s.signup({ email: "c@d.com", password: "hunter2hunter2" });
  const u = await s.login({ email: "C@D.com", password: "hunter2hunter2" });
  assert.ok(u, "should return user");
  assert.equal(u.email, "c@d.com");
});

test("users: login with wrong password returns null", async () => {
  const s = new UserStore();
  await s.signup({ email: "c@d.com", password: "hunter2hunter2" });
  const u = await s.login({ email: "c@d.com", password: "WRONG" });
  assert.equal(u, null);
});

test("users: login with unknown email returns null", async () => {
  const s = new UserStore();
  const u = await s.login({ email: "noone@x.com", password: "whatever" });
  assert.equal(u, null);
});

test("users: getById returns user or null", async () => {
  const s = new UserStore();
  const u = await s.signup({ email: "x@y.com", password: "hunter2hunter2" });
  assert.equal(s.getById(u.id).email, "x@y.com");
  assert.equal(s.getById("nope"), null);
});

// =====================================================================
// middleware.js
// =====================================================================

test("middleware: rejects request without Authorization header", async () => {
  const auth = authMiddleware("secret");
  const req = { headers: {} };
  const res = { writeHead(s, h) { this._status = s; }, end(b) { this._body = b; this.writableEnded = true; } };
  await auth(req, res);
  assert.equal(res._status, 401);
  assert.match(res._body, /missing_authorization/);
});

test("middleware: rejects non-Bearer Authorization", async () => {
  const auth = authMiddleware("secret");
  const req = { headers: { authorization: "Basic abcdef" } };
  const res = { writeHead(s, h) { this._status = s; }, end(b) { this._body = b; this.writableEnded = true; } };
  await auth(req, res);
  assert.equal(res._status, 401);
  assert.match(res._body, /malformed_authorization/);
});

test("middleware: rejects invalid token", async () => {
  const auth = authMiddleware("secret");
  const req = { headers: { authorization: "Bearer not-a-real-token" } };
  const res = { writeHead(s, h) { this._status = s; }, end(b) { this._body = b; this.writableEnded = true; } };
  await auth(req, res);
  assert.equal(res._status, 401);
  assert.match(res._body, /invalid_token/);
});

test("middleware: accepts valid token and populates req.user", async () => {
  const t = sign({ sub: "u-1", email: "a@b.com" }, "secret");
  const auth = authMiddleware("secret");
  const req = { headers: { authorization: `Bearer ${t}` } };
  const res = {
    writeHead(s) { this._status = s; },
    end() { this.writableEnded = true; },
  };
  let nextCalled = false;
  await auth(req, res, () => { nextCalled = true; });
  assert.ok(nextCalled, "next should be called");
  assert.equal(req.user.id, "u-1");
  assert.equal(req.user.email, "a@b.com");
  assert.equal(req.token.claims.sub, "u-1");
});

test("middleware: case-insensitive Bearer", async () => {
  const t = sign({ sub: "u-1" }, "secret");
  const auth = authMiddleware("secret");
  const req = { headers: { authorization: `bearer ${t}` } };
  const res = { writeHead() {}, end() { this.writableEnded = true; } };
  let nextCalled = false;
  await auth(req, res, () => { nextCalled = true; });
  assert.ok(nextCalled, "lowercase 'bearer' should be accepted");
});

test("middleware: readJsonBody parses JSON", async () => {
  const { Readable } = await import("node:stream");
  const req = Readable.from([Buffer.from('{"a":1}')]);
  req.headers = {};
  const res = { writeHead() {}, end() {} };
  const body = await readJsonBody(req, res);
  assert.deepEqual(body, { a: 1 });
});

test("middleware: readJsonBody returns {} for empty body", async () => {
  const { Readable } = await import("node:stream");
  const req = Readable.from([]);
  req.headers = {};
  const res = { writeHead() {}, end() {} };
  const body = await readJsonBody(req, res);
  assert.deepEqual(body, {});
});

test("middleware: readJsonBody returns 400 on invalid JSON", async () => {
  const { Readable } = await import("node:stream");
  const req = Readable.from([Buffer.from("not json")]);
  req.headers = {};
  let ended = null;
  const res = {
    writeHead(s, h) { this._status = s; },
    end(b) { ended = b; this.writableEnded = true; },
  };
  await assert.rejects(() => readJsonBody(req, res), /invalid_json/);
  assert.match(ended, /invalid_json/);
});

test("middleware: readJsonBody returns 413 for payload too large", async () => {
  const { Readable } = await import("node:stream");
  const big = "x".repeat(20_000);
  const req = Readable.from([Buffer.from(big)]);
  req.headers = {};
  let ended = null;
  const res = {
    writeHead(s, h) { this._status = s; },
    end(b) { ended = b; this.writableEnded = true; },
  };
  await assert.rejects(() => readJsonBody(req, res, 1000), /payload_too_large/);
  assert.match(ended, /payload_too_large/);
});

// =====================================================================
// server.js (HTTP integration)
// =====================================================================

function client(server) {
  const addr = server.address();
  const port = addr.port;
  const host = addr.address || "127.0.0.1";
  return {
    get: (path, headers = {}) => fetch(`http://${host}:${port}${path}`, { headers }),
    post: (path, body, headers = {}) => fetch(`http://${host}:${port}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
    postRaw: (path, raw, headers = {}) => fetch(`http://${host}:${port}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: raw,
    }),
  };
}

test("server: buildServer requires VIREO_JWT_SECRET when secret is omitted", () => {
  const previous = process.env.VIREO_JWT_SECRET;
  delete process.env.VIREO_JWT_SECRET;
  try {
    assert.throws(() => buildServer({ port: 0 }), /VIREO_JWT_SECRET/);
  } finally {
    if (previous === undefined) delete process.env.VIREO_JWT_SECRET;
    else process.env.VIREO_JWT_SECRET = previous;
  }
});

test("server: GET /health returns 200 with user count", async () => {
  const { server } = buildServer({ port: 0, secret: "test-secret" });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/health");
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.status, "ok");
  assert.equal(body.agent, "auth");
  assert.equal(body.users, 0);
  await new Promise((r) => server.close(r));
});

test("server: POST /signup creates user and returns token", async () => {
  const { server } = buildServer({ port: 0, secret: "test-secret" });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.post("/signup", { email: "alice@x.com", password: "hunter2hunter2", name: "Alice" });
  assert.equal(r.status, 201);
  const body = await r.json();
  assert.ok(body.token, "should return token");
  assert.equal(body.user.email, "alice@x.com");
  assert.equal(body.user.name, "Alice");
  assert.equal(body.ttl, 86400);
  // token is verifiable
  const claims = verify(body.token, "test-secret");
  assert.equal(claims.email, "alice@x.com");
  await new Promise((r) => server.close(r));
});

test("server: POST /signup with weak password returns 400", async () => {
  const { server } = buildServer({ port: 0, secret: "test-secret" });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.post("/signup", { email: "a@x.com", password: "short" });
  assert.equal(r.status, 400);
  const body = await r.json();
  assert.equal(body.error, "weak_password");
  await new Promise((r) => server.close(r));
});

test("server: POST /signup with duplicate email returns 409", async () => {
  const { server } = buildServer({ port: 0, secret: "test-secret" });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  await c.post("/signup", { email: "dup@x.com", password: "hunter2hunter2" });
  const r = await c.post("/signup", { email: "DUP@x.com", password: "different" });
  assert.equal(r.status, 409);
  const body = await r.json();
  assert.equal(body.error, "email_taken");
  await new Promise((r) => server.close(r));
});

test("server: POST /signup with invalid email returns 400", async () => {
  const { server } = buildServer({ port: 0, secret: "test-secret" });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.post("/signup", { email: "no-at", password: "hunter2hunter2" });
  assert.equal(r.status, 400);
  const body = await r.json();
  assert.equal(body.error, "validation_error");
  await new Promise((r) => server.close(r));
});

test("server: POST /login with correct creds returns token", async () => {
  const { server } = buildServer({ port: 0, secret: "test-secret" });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  await c.post("/signup", { email: "l@x.com", password: "hunter2hunter2" });
  const r = await c.post("/login", { email: "l@x.com", password: "hunter2hunter2" });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(body.token);
  assert.equal(body.user.email, "l@x.com");
  await new Promise((r) => server.close(r));
});

test("server: POST /login with wrong password returns 401", async () => {
  const { server } = buildServer({ port: 0, secret: "test-secret" });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  await c.post("/signup", { email: "l@x.com", password: "hunter2hunter2" });
  const r = await c.post("/login", { email: "l@x.com", password: "WRONG" });
  assert.equal(r.status, 401);
  const body = await r.json();
  assert.equal(body.error, "invalid_credentials");
  await new Promise((r) => server.close(r));
});

test("server: POST /login with unknown email returns 401", async () => {
  const { server } = buildServer({ port: 0, secret: "test-secret" });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.post("/login", { email: "noone@x.com", password: "whatever" });
  assert.equal(r.status, 401);
  await new Promise((r) => server.close(r));
});

test("server: GET /me with valid token returns user", async () => {
  const { server } = buildServer({ port: 0, secret: "test-secret" });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const signup = await c.post("/signup", { email: "me@x.com", password: "hunter2hunter2" });
  const { token } = await signup.json();
  const r = await c.get("/me", { Authorization: `Bearer ${token}` });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.user.email, "me@x.com");
  await new Promise((r) => server.close(r));
});

test("server: GET /me without token returns 401", async () => {
  const { server } = buildServer({ port: 0, secret: "test-secret" });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/me");
  assert.equal(r.status, 401);
  await new Promise((r) => server.close(r));
});

test("server: GET /me with wrong secret returns 401", async () => {
  const { server } = buildServer({ port: 0, secret: "secret-a" });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/me", { Authorization: "Bearer " + sign({ sub: "u1" }, "secret-b") });
  assert.equal(r.status, 401);
  await new Promise((r) => server.close(r));
});

test("server: GET /verify returns token metadata", async () => {
  const { server } = buildServer({ port: 0, secret: "test-secret" });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const signup = await c.post("/signup", { email: "v@x.com", password: "hunter2hunter2" });
  const { token } = await signup.json();
  const r = await c.get("/verify", { Authorization: `Bearer ${token}` });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.valid, true);
  assert.ok(body.user_id);
  assert.ok(body.expires_at);
  assert.ok(body.issued_at);
  await new Promise((r) => server.close(r));
});

test("server: POST /signup with bad JSON returns 400", async () => {
  const { server } = buildServer({ port: 0, secret: "test-secret" });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.postRaw("/signup", "not json at all");
  assert.equal(r.status, 400);
  await new Promise((r) => server.close(r));
});

test("server: GET /unknown returns 404", async () => {
  const { server } = buildServer({ port: 0, secret: "test-secret" });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/nope");
  assert.equal(r.status, 404);
  await new Promise((r) => server.close(r));
});

test("server: OPTIONS preflight returns 204", async () => {
  const { server } = buildServer({ port: 0, secret: "test-secret" });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await fetch(`http://127.0.0.1:${server.address().port}/signup`, { method: "OPTIONS" });
  assert.equal(r.status, 204);
  await new Promise((r) => server.close(r));
});

test("server: start() launches server and can be closed", async () => {
  const server = start({ port: 0, host: "127.0.0.1", secret: "test-secret" });
  await new Promise((r) => setTimeout(r, 50));
  const { port } = server.address();
  assert.ok(port > 0);
  const r = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(r.status, 200);
  await new Promise((r) => server.close(r));
});

test("server: tokens are not interchangeable between secrets", async () => {
  const a = buildServer({ port: 0, secret: "secret-a" });
  await new Promise((r) => a.server.listen(0, "127.0.0.1", r));
  const b = buildServer({ port: 0, secret: "secret-b" });
  await new Promise((r) => b.server.listen(0, "127.0.0.1", r));

  const ca = client(a.server);
  const cb = client(b.server);

  const r1 = await ca.post("/signup", { email: "x@y.com", password: "hunter2hunter2" });
  const { token } = await r1.json();

  // Token from a should not work on b
  const r2 = await cb.get("/me", { Authorization: `Bearer ${token}` });
  assert.equal(r2.status, 401);

  await new Promise((r) => a.server.close(r));
  await new Promise((r) => b.server.close(r));
});

test("server: full user flow — signup, /me, /verify, login again", async () => {
  const { server } = buildServer({ port: 0, secret: "secret-flow" });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);

  // 1. Signup
  const signup = await c.post("/signup", { email: "flow@x.com", password: "hunter2hunter2", name: "Flow" });
  assert.equal(signup.status, 201);
  const { token, user } = await signup.json();
  assert.equal(user.name, "Flow");

  // 2. /me
  const me = await c.get("/me", { Authorization: `Bearer ${token}` });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).user.email, "flow@x.com");

  // 3. /verify
  const verifyRes = await c.get("/verify", { Authorization: `Bearer ${token}` });
  assert.equal(verifyRes.status, 200);
  assert.equal((await verifyRes.json()).valid, true);

  // 4. Login again (gets a new token)
  const login = await c.post("/login", { email: "flow@x.com", password: "hunter2hunter2" });
  assert.equal(login.status, 200);
  const { token: token2 } = await login.json();
  assert.notEqual(token, token2);

  // 5. New token works
  const me2 = await c.get("/me", { Authorization: `Bearer ${token2}` });
  assert.equal(me2.status, 200);

  await new Promise((r) => server.close(r));
});
