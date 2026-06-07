// Regression tests for OAuth audit fixes (2026-06-07).

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildServer, makeStateStore } from "../src/server.js";
import { signToken } from "../../../packages/auth-middleware/index.js";

// Set test env defaults (matches test_oauth_server.js)
process.env.YOUTUBE_CLIENT_ID ??= "test-youtube-client";
process.env.X_CLIENT_ID ??= "test-x-client";
process.env.TIKTOK_CLIENT_ID ??= "test-tiktok-client";
process.env.INSTAGRAM_CLIENT_ID ??= "test-instagram-client";
process.env.LINKEDIN_CLIENT_ID ??= "test-linkedin-client";

const SECRET = "test-oauth-fixes-secret";
const makeToken = (uid) => signToken({ sub: uid, email: `${uid}@t.com`, name: uid }, SECRET, 3600);

const mockOauth = {
  PLATFORMS: {
    youtube: { id: "youtube", name: "YouTube", authorize_url: "https://accounts.google.com/o/oauth2/v2/auth", token_url: "https://oauth2.googleapis.com/token", profile_url: "https://www.googleapis.com/oauth2/v2/userinfo", scopes: ["https://www.googleapis.com/auth/youtube.upload"], supports_refresh: true, env_keys: ["YOUTUBE_CLIENT_ID"], notes: "" },
    x: { id: "x", name: "X", authorize_url: "https://twitter.com/i/oauth2/authorize", token_url: "https://api.twitter.com/2/oauth2/token", profile_url: "https://api.twitter.com/2/users/me", scopes: ["tweet.read", "tweet.write"], supports_refresh: true, env_keys: ["X_CLIENT_ID"], notes: "" },
    tiktok: { id: "tiktok", name: "TikTok", authorize_url: "https://www.tiktok.com/v2/auth/authorize/", token_url: "https://open.tiktokapis.com/v2/oauth/token/", profile_url: "https://open.tiktokapis.com/v2/user/info/", scopes: ["user.info.basic", "video.publish"], supports_refresh: true, env_keys: ["TIKTOK_CLIENT_ID"], notes: "" },
    instagram: { id: "instagram", name: "Instagram", authorize_url: "https://api.instagram.com/oauth/authorize", token_url: "https://api.instagram.com/oauth/access_token", profile_url: "https://graph.instagram.com/me", scopes: ["user_profile", "user_media"], supports_refresh: true, env_keys: ["INSTAGRAM_CLIENT_ID"], notes: "" },
    linkedin: { id: "linkedin", name: "LinkedIn", authorize_url: "https://www.linkedin.com/oauth/v2/authorization", token_url: "https://www.linkedin.com/oauth/v2/accessToken", profile_url: "https://api.linkedin.com/v2/userinfo", scopes: ["openid", "profile", "email", "w_member_social"], supports_refresh: true, env_keys: ["LINKEDIN_CLIENT_ID"], notes: "" },
  },
  listPlatforms: function() { return Object.values(this.PLATFORMS).map(p => ({ id: p.id, name: p.name, uses_oauth: !!p.authorize_url, scopes: p.scopes, env_keys: p.env_keys, configured: false })); },
  getPlatform: function(id) { return this.PLATFORMS[id] || null; },
};

function client(server) {
  const addr = server.address();
  return {
    get: (path, headers = {}) => fetch(`http://127.0.0.1:${addr.port}${path}`, { headers }),
    post: (path, body, headers = {}) => fetch(`http://127.0.0.1:${addr.port}${path}`, { method: "POST", body, headers }),
    delete: (path, headers = {}) => fetch(`http://127.0.0.1:${addr.port}${path}`, { method: "DELETE", headers }),
  };
}

const tests = [];
function t(name, fn) { tests.push([name, fn]); }

// ─────────────────────────────────────────────────────────────────────
// O-1: CORS uses VIREO_CORS_ORIGINS env var (not hardcoded "*")
// ─────────────────────────────────────────────────────────────────────
t("O-1: CORS Allow-Origin reflects VIREO_CORS_ORIGINS env (allowlist)", async () => {
  const prev = process.env.VIREO_CORS_ORIGINS;
  process.env.VIREO_CORS_ORIGINS = "https://app.vireo.studio,https://studio.example.com";
  let server;
  try {
    ({ server } = buildServer({ port: 0, oauth: mockOauth, secret: SECRET }));
    await new Promise(res => server.listen(0, "127.0.0.1", res));
    const resp = await fetch(`http://127.0.0.1:${server.address().port}/health`, {
      headers: { origin: "https://app.vireo.studio" },
    });
    await resp.text();
    assert.equal(resp.headers.get("access-control-allow-origin"), "https://app.vireo.studio");
  } finally {
    if (server) await new Promise(res => server.close(res));
    process.env.VIREO_CORS_ORIGINS = prev;
  }
});

t("O-1: CORS does not echo non-allowlisted origin", async () => {
  const prev = process.env.VIREO_CORS_ORIGINS;
  process.env.VIREO_CORS_ORIGINS = "https://app.vireo.studio";
  let server;
  try {
    ({ server } = buildServer({ port: 0, oauth: mockOauth, secret: SECRET }));
    await new Promise(res => server.listen(0, "127.0.0.1", res));
    const resp = await fetch(`http://127.0.0.1:${server.address().port}/health`, {
      headers: { origin: "https://attacker.example" },
    });
    await resp.text();
    const allow = resp.headers.get("access-control-allow-origin");
    // The allow-origin header must NOT echo the attacker origin
    assert.notEqual(allow, "https://attacker.example");
  } finally {
    if (server) await new Promise(res => server.close(res));
    process.env.VIREO_CORS_ORIGINS = prev;
  }
});

// ─────────────────────────────────────────────────────────────────────
// O-3: State TTL — state entries expire after ttlMs
// ─────────────────────────────────────────────────────────────────────
t("O-3: makeStateStore returns null for expired state", () => {
  const store = makeStateStore({ ttlMs: 50 });
  store.set("abc", { user_id: "u1", platform_id: "youtube" });
  assert.ok(store.get("abc"));
  return new Promise((resolve) => {
    setTimeout(() => {
      assert.equal(store.get("abc"), null);
      resolve();
    }, 80);
  });
});

t("O-3: sweep() removes expired entries", () => {
  const store = makeStateStore({ ttlMs: 50 });
  store.set("a", { platform_id: "x" });
  store.set("b", { platform_id: "x" });
  return new Promise((resolve) => {
    setTimeout(() => {
      const removed = store.sweep();
      assert.equal(removed, 2);
      assert.equal(store.size, 0);
      resolve();
    }, 80);
  });
});

// ─────────────────────────────────────────────────────────────────────
// O-4: YOUTUBE_CLIENT_ID fallback removed
// ─────────────────────────────────────────────────────────────────────
t("O-4: /connect/tiktok without TIKTOK_CLIENT_ID returns 503", async () => {
  const prev = process.env.TIKTOK_CLIENT_ID;
  delete process.env.TIKTOK_CLIENT_ID;
  try {
    const { server } = buildServer({ port: 0, oauth: mockOauth, secret: SECRET });
    await new Promise(r => server.listen(0, "127.0.0.1", r));
    const r = await fetch(`http://127.0.0.1:${server.address().port}/connect/tiktok`, {
      headers: { Authorization: `Bearer ${makeToken("u1")}` },
    });
    const body = await r.json();
    assert.equal(r.status, 503);
    assert.equal(body.error, "platform_not_configured");
    assert.equal(body.required_env, "TIKTOK_CLIENT_ID");
    await new Promise(r => server.close(r));
  } finally { if (prev !== undefined) process.env.TIKTOK_CLIENT_ID = prev; }
});

// ─────────────────────────────────────────────────────────────────────
// O-5: buildServer return is frozen (immutable)
// ─────────────────────────────────────────────────────────────────────
t("O-5: buildServer return is frozen", () => {
  const result = buildServer({ port: 0, oauth: mockOauth, secret: SECRET });
  assert.throws(() => { result.newField = "x"; }, TypeError);
  assert.throws(() => { delete result.tokenStore; }, TypeError);
  result.server.close();
});

// ─────────────────────────────────────────────────────────────────────
// O-6: saveToken validates required fields
// ─────────────────────────────────────────────────────────────────────
t("O-6: saveToken throws on missing platform_id", async () => {
  const { server, tokenStore } = buildServer({ port: 0, oauth: mockOauth, secret: SECRET });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  // Use the /callback flow to trigger saveToken with bad data
  const exchangeFn = async () => ({ access_token: "x" });  // missing platform_id
  const { server: s2 } = buildServer({ port: 0, oauth: mockOauth, secret: SECRET, exchangeFn });
  await new Promise(r => s2.listen(0, "127.0.0.1", r));
  // Get state from connect first
  const conn = await fetch(`http://127.0.0.1:${s2.address().port}/connect/youtube`, {
    headers: { Authorization: `Bearer ${makeToken("u2")}` },
  });
  const { state } = await conn.json();
  // Callback should return 500 (saveToken throws)
  const cb = await fetch(`http://127.0.0.1:${s2.address().port}/callback/youtube?code=c&state=${state}`);
  assert.equal(cb.status, 500);
  await new Promise(r => s2.close(r));
  await new Promise(r => server.close(r));
  void tokenStore;
});

// Register all collected tests
for (const [name, fn] of tests) {
  test(name, fn);
}
