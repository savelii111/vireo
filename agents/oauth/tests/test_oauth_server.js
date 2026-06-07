// Vireo OAuth — HTTP server tests.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildServer } from "../src/server.js";
import { signToken } from "../../../packages/auth-middleware/index.js";

// Bug O-4: platform-specific CLIENT_ID env vars are required. Set sensible
// test defaults if a real .env didn't provide them. We do this at module
// load so every test in this file inherits them.
process.env.YOUTUBE_CLIENT_ID ??= "test-youtube-client";
process.env.YOUTUBE_SHORTS_CLIENT_ID ??= "test-youtube-shorts-client";
process.env.X_CLIENT_ID ??= "test-x-client";
process.env.TIKTOK_CLIENT_ID ??= "test-tiktok-client";
process.env.INSTAGRAM_CLIENT_ID ??= "test-instagram-client";
process.env.LINKEDIN_CLIENT_ID ??= "test-linkedin-client";

function client(server) {
  const addr = server.address();
  return {
    get: (path, headers = {}) => fetch(`http://127.0.0.1:${addr.port}${path}`, { headers }),
    delete: (path, headers = {}) => fetch(`http://127.0.0.1:${addr.port}${path}`, {
      method: "DELETE",
      headers,
    }),
  };
}

const SECRET = "test-oauth-secret";
function makeToken(userId) {
  return signToken({ sub: userId, email: `${userId}@test.com`, name: userId }, SECRET, 3600);
}

// Mock OAuth module
const mockPlatforms = {
  youtube: {
    id: "youtube", name: "YouTube",
    authorize_url: "https://accounts.google.com/o/oauth2/v2/auth",
    token_url: "https://oauth2.googleapis.com/token",
    profile_url: "https://www.googleapis.com/oauth2/v2/userinfo",
    scopes: ["https://www.googleapis.com/auth/youtube.upload"],
    supports_refresh: true,
    env_keys: ["YOUTUBE_CLIENT_ID"],
    notes: "",
  },
  x: {
    id: "x", name: "X",
    authorize_url: "https://twitter.com/i/oauth2/authorize",
    token_url: "https://api.twitter.com/2/oauth2/token",
    profile_url: "https://api.twitter.com/2/users/me",
    scopes: ["tweet.read", "tweet.write"],
    supports_refresh: true,
    env_keys: ["X_CLIENT_ID"],
    notes: "",
  },
  telegram: {
    id: "telegram", name: "Telegram",
    authorize_url: "",
    token_url: "",
    profile_url: "",
    scopes: [],
    supports_refresh: false,
    env_keys: ["TELEGRAM_BOT_TOKEN"],
    notes: "Bot-based",
  },
};

const mockOauth = {
  PLATFORMS: mockPlatforms,
  listPlatforms: () => Object.values(mockPlatforms).map((p) => ({
    id: p.id, name: p.name, uses_oauth: !!p.authorize_url, scopes: p.scopes, env_keys: p.env_keys,
    configured: false,
  })),
  getPlatform: (id) => mockPlatforms[id] || null,
};

// ----- /health, /platforms -----

test("GET /health returns 200", async () => {
  const { server } = buildServer({ port: 0, oauth: mockOauth, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/health");
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.status, "ok");
  assert.equal(body.platforms, 3);
  await new Promise((r) => server.close(r));
});

test("GET /platforms returns 3 platforms with uses_oauth flag", async () => {
  const { server } = buildServer({ port: 0, oauth: mockOauth, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/platforms");
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.platforms.length, 3);
  const yt = body.platforms.find((p) => p.id === "youtube");
  assert.equal(yt.uses_oauth, true);
  const tg = body.platforms.find((p) => p.id === "telegram");
  assert.equal(tg.uses_oauth, false);
  await new Promise((r) => server.close(r));
});

test("GET /platforms/youtube returns youtube config", async () => {
  const { server } = buildServer({ port: 0, oauth: mockOauth, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/platforms/youtube");
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.id, "youtube");
  await new Promise((r) => server.close(r));
});

test("GET /platforms/nope returns 404", async () => {
  const { server } = buildServer({ port: 0, oauth: mockOauth, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/platforms/nope");
  assert.equal(r.status, 404);
  await new Promise((r) => server.close(r));
});

// ----- /connect/:platform -----

test("GET /connect/youtube without user returns 401", async () => {
  const { server } = buildServer({ port: 0, oauth: mockOauth, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/connect/youtube");
  assert.equal(r.status, 401);
  await new Promise((r) => server.close(r));
});

test("GET /connect/youtube returns authorize URL with state", async () => {
  const { server, stateStore } = buildServer({ port: 0, oauth: mockOauth, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/connect/youtube", { "Authorization": `Bearer ${makeToken("u1")}` });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.platform_id, "youtube");
  assert.match(body.authorize_url, /^https:\/\/accounts\.google\.com/);
  assert.match(body.authorize_url, /state=/);
  assert.match(body.authorize_url, /client_id=/);
  assert.match(body.authorize_url, /scope=/);
  assert.ok(body.state, "should return state");
  assert.ok(body.state.length > 10);
  assert.match(body.redirect_uri, /\/callback\/youtube$/);
  // State stored
  assert.equal(stateStore.size, 1);
  await new Promise((r) => server.close(r));
});

test("GET /connect/x returns PKCE challenge", async () => {
  const { server, stateStore } = buildServer({ port: 0, oauth: mockOauth, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/connect/x", { "Authorization": `Bearer ${makeToken("u1")}` });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.match(body.authorize_url, /code_challenge=/);
  assert.match(body.authorize_url, /code_challenge_method=S256/);
  // State entry has code_verifier
  const state = body.state;
  const entry = stateStore.get(state);
  assert.ok(entry.code_verifier, "x should store code_verifier");
  await new Promise((r) => server.close(r));
});

test("GET /connect/telegram returns 400 (no OAuth)", async () => {
  const { server } = buildServer({ port: 0, oauth: mockOauth, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/connect/telegram", { "Authorization": `Bearer ${makeToken("u1")}` });
  assert.equal(r.status, 400);
  const body = await r.json();
  assert.equal(body.error, "platform_no_oauth");
  await new Promise((r) => server.close(r));
});

test("GET /connect/nope returns 404", async () => {
  const { server } = buildServer({ port: 0, oauth: mockOauth, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/connect/nope", { "Authorization": `Bearer ${makeToken("u1")}` });
  assert.equal(r.status, 404);
  await new Promise((r) => server.close(r));
});

// ----- /callback/:platform -----

test("GET /callback/youtube without code returns 400", async () => {
  const { server } = buildServer({ port: 0, oauth: mockOauth, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/callback/youtube");
  assert.equal(r.status, 400);
  await new Promise((r) => server.close(r));
});

test("GET /callback/youtube with bad state returns 400", async () => {
  const { server } = buildServer({ port: 0, oauth: mockOauth, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/callback/youtube?code=abc&state=invalid");
  assert.equal(r.status, 400);
  const body = await r.json();
  assert.equal(body.error, "invalid_or_expired_state");
  await new Promise((r) => server.close(r));
});

test("GET /callback/youtube with state but wrong platform returns 400", async () => {
  const { server } = buildServer({ port: 0, oauth: mockOauth, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  // Connect to youtube
  const conn = await c.get("/connect/youtube", { "Authorization": `Bearer ${makeToken("u1")}` });
  const { state } = await conn.json();
  // Try callback on different platform
  const r = await c.get(`/callback/x?code=abc&state=${state}`);
  assert.equal(r.status, 400);
  const body = await r.json();
  assert.equal(body.error, "state_platform_mismatch");
  await new Promise((r) => server.close(r));
});

test("GET /callback/youtube with error param returns 400", async () => {
  const { server } = buildServer({ port: 0, oauth: mockOauth, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/callback/youtube?error=access_denied");
  assert.equal(r.status, 400);
  const body = await r.json();
  assert.equal(body.error, "oauth_denied");
  assert.equal(body.provider_error, "access_denied");
  await new Promise((r) => server.close(r));
});

test("GET /callback/youtube with valid state exchanges and saves token", async () => {
  const exchangeFn = async (pid, code, opts) => {
    assert.equal(pid, "youtube");
    assert.equal(code, "auth-code-123");
    return {
      platform_id: "youtube",
      platformId: "youtube",
      access_token: "ya29.at-real",
      accessToken: "ya29.at-real",
      refresh_token: "rt-real",
      refreshToken: "rt-real",
      token_type: "Bearer",
      tokenType: "Bearer",
      expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      scope: "youtube.upload",
    };
  };
  const { server, stateStore, tokenStore } = buildServer({ port: 0, oauth: mockOauth, exchangeFn, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);

  // 1. Connect (creates state)
  const conn = await c.get("/connect/youtube", { "Authorization": `Bearer ${makeToken("u1")}` });
  const { state } = await conn.json();

  // 2. Callback
  const r = await c.get(`/callback/youtube?code=auth-code-123&state=${state}`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.ok, true);
  assert.equal(body.platform_id, "youtube");
  assert.equal(body.user_id, "u1");
  assert.equal(body.account.has_refresh, true);

  // 3. State was consumed
  assert.equal(stateStore.size, 0);
  // 4. Token was saved
  assert.equal(tokenStore.size, 1);
  const token = tokenStore.get("u1").get("youtube");
  assert.equal(token.access_token, "ya29.at-real");
  assert.equal(token.refresh_token, "rt-real");

  await new Promise((r) => server.close(r));
});

test("GET /callback returns 502 when exchange throws", async () => {
  const exchangeFn = async () => { throw new Error("upstream OAuth down"); };
  const { server } = buildServer({ port: 0, oauth: mockOauth, exchangeFn, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const conn = await c.get("/connect/youtube", { "Authorization": `Bearer ${makeToken("u1")}` });
  const { state } = await conn.json();
  const r = await c.get(`/callback/youtube?code=code&state=${state}`);
  assert.equal(r.status, 502);
  const body = await r.json();
  assert.equal(body.error, "token_exchange_failed");
  assert.match(body.message, /upstream OAuth down/);
  await new Promise((r) => server.close(r));
});

test("GET /callback fetches profile when profileFn provided", async () => {
  const exchangeFn = async () => ({ platform_id: "youtube", access_token: "at" });
  const profileFn = async (pid, at) => {
    assert.equal(pid, "youtube");
    assert.equal(at, "at");
    return { id: "123", name: "Test User" };
  };
  const { server } = buildServer({ port: 0, oauth: mockOauth, exchangeFn, profileFn, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const conn = await c.get("/connect/youtube", { "Authorization": `Bearer ${makeToken("u1")}` });
  const { state } = await conn.json();
  const r = await c.get(`/callback/youtube?code=code&state=${state}`);
  const body = await r.json();
  assert.equal(body.profile.id, "123");
  await new Promise((r) => server.close(r));
});

test("GET /callback does not fetch profile by default", async () => {
  const exchangeFn = async () => ({ platform_id: "youtube", access_token: "at" });
  const { server } = buildServer({ port: 0, oauth: mockOauth, exchangeFn, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const conn = await c.get("/connect/youtube", { "Authorization": `Bearer ${makeToken("u1")}` });
  const { state } = await conn.json();
  const r = await c.get(`/callback/youtube?code=code&state=${state}`);
  const body = await r.json();
  assert.equal(body.profile, null);
  await new Promise((r) => server.close(r));
});

// ----- /me/accounts -----

test("GET /me/accounts returns connected accounts (no secrets)", async () => {
  const exchangeFn = async (pid) => ({ platform_id: pid, access_token: "secret-at", refresh_token: "rt" });
  const { server } = buildServer({ port: 0, oauth: mockOauth, exchangeFn, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);

  // Connect both
  const conn1 = await c.get("/connect/youtube", { "Authorization": `Bearer ${makeToken("u1")}` });
  const { state: s1 } = await conn1.json();
  await c.get(`/callback/youtube?code=c&state=${s1}`);

  const conn2 = await c.get("/connect/x", { "Authorization": `Bearer ${makeToken("u1")}` });
  const { state: s2 } = await conn2.json();
  await c.get(`/callback/x?code=c&state=${s2}`);

  const r = await c.get("/me/accounts", { "Authorization": `Bearer ${makeToken("u1")}` });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.accounts.length, 2);
  for (const a of body.accounts) {
    assert.equal(a.has_token, true);
    assert.ok(!("access_token" in a), "should not leak access_token");
  }
  await new Promise((r) => server.close(r));
});

test("GET /me/accounts returns empty for new user", async () => {
  const { server } = buildServer({ port: 0, oauth: mockOauth, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/me/accounts", { "Authorization": `Bearer ${makeToken("u-new")}` });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.deepEqual(body.accounts, []);
  await new Promise((r) => server.close(r));
});

test("GET /me/accounts without user returns 401", async () => {
  const { server } = buildServer({ port: 0, oauth: mockOauth, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/me/accounts");
  assert.equal(r.status, 401);
  await new Promise((r) => server.close(r));
});

test("DELETE /me/accounts/:platform disconnects", async () => {
  const exchangeFn = async (pid) => ({ platform_id: pid, access_token: "at" });
  const { server } = buildServer({ port: 0, oauth: mockOauth, exchangeFn, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const conn = await c.get("/connect/youtube", { "Authorization": `Bearer ${makeToken("u1")}` });
  const { state } = await conn.json();
  await c.get(`/callback/youtube?code=c&state=${state}`);
  const r = await c.delete("/me/accounts/youtube", { "Authorization": `Bearer ${makeToken("u1")}` });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.removed, true);
  // Verify gone
  const after = await c.get("/me/accounts", { "Authorization": `Bearer ${makeToken("u1")}` });
  assert.equal((await after.json()).accounts.length, 0);
  await new Promise((r) => server.close(r));
});

test("DELETE /me/accounts/:platform for unconnected returns 404", async () => {
  const { server } = buildServer({ port: 0, oauth: mockOauth, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.delete("/me/accounts/youtube", { "Authorization": `Bearer ${makeToken("u1")}` });
  assert.equal(r.status, 404);
  await new Promise((r) => server.close(r));
});

// ----- 404 -----

test("GET /unknown returns 404", async () => {
  const { server } = buildServer({ port: 0, oauth: mockOauth, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);
  const r = await c.get("/nope", { "Authorization": `Bearer ${makeToken("u1")}` });
  assert.equal(r.status, 404);
  await new Promise((r) => server.close(r));
});

test("OPTIONS preflight returns 204", async () => {
  const { server } = buildServer({ port: 0, oauth: mockOauth, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const r = await fetch(`http://127.0.0.1:${server.address().port}/me/accounts`, { method: "OPTIONS" });
  assert.equal(r.status, 204);
  await new Promise((r) => server.close(r));
});

// ----- Full flow -----

test("integration: full connect → callback → list → delete flow", async () => {
  const exchangeFn = async (pid) => ({ platform_id: pid, access_token: `${pid}-at`, refresh_token: `${pid}-rt` });
  const profileFn = async (pid) => ({ id: `${pid}-user`, name: `${pid} test` });
  const { server, tokenStore } = buildServer({ port: 0, oauth: mockOauth, exchangeFn, profileFn, secret: SECRET });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const c = client(server);

  // 1. List platforms
  const ps = await c.get("/platforms");
  const psBody = await ps.json();
  const oauthPlatforms = psBody.platforms.filter((p) => p.uses_oauth);
  assert.equal(oauthPlatforms.length, 2);

  // 2. Connect both
  for (const p of oauthPlatforms) {
    const conn = await c.get(`/connect/${p.id}`, { "Authorization": `Bearer ${makeToken("u1")}` });
    const { state } = await conn.json();
    const cb = await c.get(`/callback/${p.id}?code=c&state=${state}`);
    const cbBody = await cb.json();
    assert.equal(cbBody.ok, true);
    assert.ok(cbBody.profile);
  }

  // 3. List accounts
  const acc = await c.get("/me/accounts", { "Authorization": `Bearer ${makeToken("u1")}` });
  const accBody = await acc.json();
  assert.equal(accBody.accounts.length, 2);

  // 4. Disconnect one
  await c.delete("/me/accounts/x", { "Authorization": `Bearer ${makeToken("u1")}` });
  const acc2 = await c.get("/me/accounts", { "Authorization": `Bearer ${makeToken("u1")}` });
  const acc2Body = await acc2.json();
  assert.equal(acc2Body.accounts.length, 1);
  assert.equal(acc2Body.accounts[0].platform_id, "youtube");

  await new Promise((r) => server.close(r));
});
