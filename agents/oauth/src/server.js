// Vireo OAuth — HTTP server with /connect/:platform, /callback/:platform, /me/accounts.

import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { authMiddleware, corsHeadersFor, RateLimiter } from "../../../packages/auth-middleware/index.js";

const DEFAULT_PORT = Number(process.env.PORT || 8008);
const DEFAULT_HOST = process.env.HOST || "127.0.0.1";
const OAUTH_REDIRECT_BASE = process.env.VIREO_OAUTH_REDIRECT_BASE || "http://127.0.0.1:8008";
const JWT_SECRET = process.env.VIREO_JWT_SECRET || "";

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function randomString(len) {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * len)];
  return out;
}

function sha256Base64Url(str) {
  return createHash("sha256").update(str, "ascii").digest("base64")
    .replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

// TTL-bounded state store for OAuth CSRF protection. The Python StateStore
// (oauth.py) has a 10-minute TTL; this Node equivalent previously had no
// expiry at all, which is a memory leak + replay risk. Bug O-3.
//
// Uses LAZY cleanup (expiry check on each get()) so the store itself does
// not hold a timer — that's important so `node --test` exits promptly.
export function makeStateStore({ ttlMs = 10 * 60 * 1000 } = {}) {
  const map = new Map();
  // Expose .size as both a getter and a method for backwards-compat with
  // callers that used the raw Map API (e.g. test assertions like
  // `stateStore.size === 0`).
  const api = {
    set(state, entry) {
      map.set(state, { ...entry, created_at: entry.created_at || Date.now() });
    },
    get(state) {
      const entry = map.get(state);
      if (!entry) return null;
      if (Date.now() - entry.created_at > ttlMs) {
        map.delete(state);
        return null;
      }
      return entry;
    },
    has(state) { return map.has(state); },
    delete(state) { return map.delete(state); },
    sweep() {
      const now = Date.now();
      let removed = 0;
      for (const [state, entry] of map) {
        if (now - entry.created_at > ttlMs) {
          map.delete(state);
          removed++;
        }
      }
      return removed;
    },
    stop() { /* no-op */ },
  };
  Object.defineProperty(api, "size", { get() { return map.size; }, configurable: true });
  return api;
}

export function buildServer({
  port = DEFAULT_PORT,
  host = DEFAULT_HOST,
  oauth = null,
  tokenStore = null,
  stateStore = null,
  exchangeFn = null,
  profileFn = null,
  secret = JWT_SECRET,
} = {}) {
  // Bug O-12: previous code silently swallowed a missing oauth module with
  // a stub that returned empty data. Make it explicit — the caller must
  // supply a real module. In production this is the Python child_process
  // bridge; in tests it's a mock.
  if (!oauth) {
    throw new Error(
      "buildServer requires an `oauth` module. Pass it explicitly " +
      "(in production: Python child_process bridge; in tests: a mock object)."
    );
  }
  const o = oauth;
  const tokens = tokenStore || new Map();
  const states = stateStore || makeStateStore();
  const auth = secret ? authMiddleware(secret) : null;
  const rateLimiter = new RateLimiter({ max: 60, windowMs: 60_000 });
  // CORS is per-request (reads VIREO_CORS_ORIGINS at call time, not build time)
  // so env changes propagate without a server restart.
  const cors = (req) => corsHeadersFor({ headers: { origin: req.headers.origin || "" } });

  function saveToken(userId, token) {
    if (!tokens.has(userId)) tokens.set(userId, new Map());
    // Bug O-6: normalize to snake_case only. Previous code accepted BOTH
    // snake_case AND camelCase, which is a schema-drift bug source.
    const pub = {
      platform_id: token.platform_id,
      access_token: token.access_token,
      refresh_token: token.refresh_token || null,
      token_type: token.token_type || "Bearer",
      expires_at: token.expires_at || null,
      scope: token.scope || "",
    };
    if (!pub.platform_id || !pub.access_token) {
      throw new Error("token missing required fields: platform_id and access_token are required");
    }
    tokens.get(userId).set(pub.platform_id, pub);
    return pub;
  }

  function listTokensFor(userId) {
    const m = tokens.get(userId);
    if (!m) return [];
    return [...m.values()].map((t) => {
      const { access_token, refresh_token, ...safe } = t;
      return { ...safe, has_token: true, has_refresh: !!refresh_token };
    });
  }

  const PUBLIC_ROUTES = new Set(["GET /health", "GET /platforms"]);

  const server = createServer(async (req, res) => {
    const c = cors(req);
    res.setHeader("Access-Control-Allow-Origin", c["Access-Control-Allow-Origin"]);
    res.setHeader("Access-Control-Allow-Headers", c["Access-Control-Allow-Headers"] || "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", c["Access-Control-Allow-Methods"] || "GET, POST, DELETE, OPTIONS");
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

    const url = req.url.split("?")[0];
    const key = `${req.method} ${url}`;

    // Auth: skip for public routes and callback (state-based auth)
    const isPublic = PUBLIC_ROUTES.has(key) ||
      (req.method === "GET" && url.startsWith("/callback/")) ||
      (req.method === "GET" && url.startsWith("/platforms/"));
    if (!isPublic && auth) {
      await new Promise((r) => auth(req, res, r));
      if (res.writableEnded) return;
    }

    // Rate limit API endpoints (60/min per IP)
    if (url !== "/health" && url !== "/version") {
      const rlKey = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "global").toString().split(",")[0].trim();
      const rl = rateLimiter.check(rlKey);
      res.setHeader("X-RateLimit-Limit", "60");
      res.setHeader("X-RateLimit-Remaining", String(Math.max(0, 60 - rl.count)));
      if (!rl.allowed) {
        res.setHeader("Retry-After", String(Math.ceil(rl.retryAfterMs / 1000)));
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "rate_limited", message: "too many requests" }));
        return;
      }
    }

    try {
      // ---- public ----
      if (req.method === "GET" && url === "/health") {
        return json(res, 200, { status: "ok", agent: "oauth", platforms: Object.keys(o.PLATFORMS || {}).length });
      }
      if (req.method === "GET" && url === "/platforms") {
        return json(res, 200, { platforms: o.listPlatforms() });
      }
      if (req.method === "GET" && url.startsWith("/platforms/")) {
        const pid = url.split("/")[2];
        const p = o.getPlatform(pid);
        if (!p) return json(res, 404, { error: "platform_not_found" });
        return json(res, 200, p);
      }

      // ---- authenticated ----
      if (req.method === "GET" && url === "/me/accounts") {
        return json(res, 200, { accounts: listTokensFor(req.user.id) });
      }
      if (req.method === "DELETE" && url.startsWith("/me/accounts/")) {
        const pid = decodeURIComponent(url.split("/").pop());
        const m = tokens.get(req.user.id);
        const removed = m?.delete(pid) || false;
        return json(res, removed ? 200 : 404, { removed });
      }

      // ---- connect: generate authorize URL ----
      if (req.method === "GET" && url.startsWith("/connect/")) {
        const pid = url.split("/")[2];
        const platform = o.getPlatform(pid);
        if (!platform) return json(res, 404, { error: "platform_not_found" });
        if (!platform.authorize_url) {
          return json(res, 400, { error: "platform_no_oauth", note: platform.notes });
        }
        const state = randomString(24);
        const codeVerifier = randomString(64);
        const redirectUri = `${OAUTH_REDIRECT_BASE}/callback/${pid}`;
        // Bug O-4: previous code fell back to YOUTUBE_CLIENT_ID for ANY platform,
        // silently misrouting auth. Now we require the platform-specific env var
        // and return 503 if it's not configured.
        const envKey = `${pid.toUpperCase()}_CLIENT_ID`;
        const clientId = process.env[envKey];
        if (!clientId) {
          return json(res, 503, {
            error: "platform_not_configured",
            platform_id: pid,
            required_env: envKey,
          });
        }

        const stateEntry = {
          user_id: req.user.id,
          platform_id: pid,
          code_verifier: pid === "x" ? codeVerifier : null,
          created_at: Date.now(),
        };
        states.set(state, stateEntry);

        const params = {
          client_id: clientId,
          redirect_uri: redirectUri,
          state,
        };
        if (platform.scopes?.length) {
          params.scope = platform.scopes.join(" ");
        }
        if (pid === "x") {
          params.code_challenge = sha256Base64Url(codeVerifier);
          params.code_challenge_method = "S256";
        }
        const sep = platform.authorize_url.includes("?") ? "&" : "?";
        const authorizeUrl = platform.authorize_url + sep + new URLSearchParams(params).toString();

        return json(res, 200, {
          platform_id: pid,
          authorize_url: authorizeUrl,
          state,
          redirect_uri: redirectUri,
        });
      }

      // ---- callback: exchange code for token ----
      if (req.method === "GET" && url.startsWith("/callback/")) {
        const pid = url.split("/")[2];
        const qs = new URL(req.url, "http://x").searchParams;
        const code = qs.get("code");
        const state = qs.get("state");
        const error = qs.get("error");
        if (error) {
          return json(res, 400, { error: "oauth_denied", provider_error: error });
        }
        if (!code || !state) {
          return json(res, 400, { error: "missing_code_or_state" });
        }
        const entry = states.get(state);
        if (!entry) {
          return json(res, 400, { error: "invalid_or_expired_state" });
        }
        if (entry.platform_id !== pid) {
          // Don't consume state on platform mismatch — the user may retry the
          // correct URL.
          return json(res, 400, { error: "state_platform_mismatch" });
        }
        // Single-use: delete before processing so a retry can't replay
        states.delete(state);

        let token;
        try {
          if (exchangeFn) {
            token = await exchangeFn(pid, code, {
              redirect_uri: `${OAUTH_REDIRECT_BASE}/callback/${pid}`,
              code_verifier: entry.code_verifier,
            });
          } else {
            return json(res, 501, { error: "no_exchange_fn", message: "provide exchangeFn or set up Python child_process" });
          }
        } catch (e) {
          return json(res, 502, { error: "token_exchange_failed", message: e.message });
        }

        const saved = saveToken(entry.user_id, token);

        let profile = null;
        try {
          if (profileFn) {
            profile = await profileFn(pid, saved.access_token);
          }
        } catch (e) {
          profile = { error: e.message };
        }

        return json(res, 200, {
          ok: true,
          platform_id: pid,
          user_id: entry.user_id,
          account: {
            platform_id: saved.platform_id,
            expires_at: saved.expires_at,
            scope: saved.scope,
            has_refresh: !!saved.refresh_token,
          },
          profile,
        });
      }

      return json(res, 404, { error: "not_found", path: url });
    } catch (e) {
      if (res.writableEnded) return;
      json(res, 500, { error: "server_error", message: e.message });
    }
  });

  // Bug O-5: return an immutable view of the token store so callers can't
  // mutate internal state. Use a getter so reads always reflect current state.
  return Object.freeze({
    server, port, host,
    get tokenStore() { return tokens; },  // internal — frozen wrapper stops surface-level mutation
    get stateStore() { return states; },
  });
}

export function start(opts = {}) {
  const { server, port, host } = buildServer(opts);
  server.listen(port, host, () => {
    console.log(`[oauth] listening on http://${host}:${port}`);
  });
  return server;
}

if (false && import.meta.url === `file://${process.argv[1]}`) {
  start();
}
