// Vireo Auth — HTTP server with /signup, /login, /me, /verify, /health.

import { createServer } from "node:http";
import { sign } from "./tokens.js";
import { UserStore, ValidationError, EmailTakenError } from "./users.js";
import { authMiddleware, readJsonBody } from "./middleware.js";
import { PasswordTooShortError } from "./password.js";

const DEFAULT_PORT = Number(process.env.PORT || 8005);
const DEFAULT_HOST = process.env.HOST || "127.0.0.1";
const TOKEN_TTL_SEC = Number(process.env.TOKEN_TTL_SEC || 24 * 60 * 60);

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, createdAt: u.createdAt };
}

async function handleSignup(req, res, store, signToken) {
  let body;
  try { body = await readJsonBody(req, res); } catch { return; }
  try {
    const user = await store.signup({
      email: body.email,
      password: body.password,
      name: body.name,
    });
    const token = signToken({ sub: user.id, email: user.email, name: user.name });
    res.writeHead(201, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ user: publicUser(user), token, ttl: TOKEN_TTL_SEC }));
  } catch (e) {
    if (e instanceof PasswordTooShortError) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "weak_password", message: e.message }));
    } else if (e instanceof EmailTakenError) {
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "email_taken", message: e.message }));
    } else if (e instanceof ValidationError) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "validation_error", message: e.message }));
    } else {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "internal_error", message: e.message }));
    }
  }
}

async function handleLogin(req, res, store, signToken) {
  let body;
  try { body = await readJsonBody(req, res); } catch { return; }
  try {
    const user = await store.login({ email: body.email, password: body.password });
    if (!user) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_credentials" }));
      return;
    }
    const token = signToken({ sub: user.id, email: user.email, name: user.name });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ user: publicUser(user), token, ttl: TOKEN_TTL_SEC }));
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "internal_error", message: e.message }));
  }
}

function handleMe(req, res) {
  if (!req.user) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "unauthenticated" }));
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ user: req.user }));
}

function handleVerify(req, res) {
  if (!req.token) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "unauthenticated" }));
    return;
  }
  const { exp, iat, sub } = req.token.claims;
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    valid: true,
    user_id: sub,
    expires_at: new Date(exp * 1000).toISOString(),
    issued_at: new Date(iat * 1000).toISOString(),
  }));
}

async function handleHealth(_req, res, _store) {
  let count = 0;
  try {
    count = await _store.size();
  } catch (e) {
    // Postgres may be unavailable; report 0
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "ok", agent: "auth", users: count }));
}

const DEFAULT_SECRET = process.env.VIREO_JWT_SECRET;

export function buildServer({ port = DEFAULT_PORT, host = DEFAULT_HOST, secret = DEFAULT_SECRET, store = null } = {}) {
  if (!secret) {
    throw new Error("VIREO_JWT_SECRET is required; secrets must come from the environment, not a generated fallback");
  }
  const userStore = store || new UserStore();
  const auth = authMiddleware(secret);
  const signToken = (claims) => sign(claims, secret, TOKEN_TTL_SEC);
  const server = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    const url = req.url.split("?")[0];
    try {
      if (req.method === "GET" && url === "/health") return await handleHealth(req, res, userStore);
      if (req.method === "POST" && url === "/signup") return await handleSignup(req, res, userStore, signToken);
      if (req.method === "POST" && url === "/login") return await handleLogin(req, res, userStore, signToken);
      if (req.method === "GET" && url === "/me") { await new Promise((r) => auth(req, res, r)); if (res.writableEnded) return; return handleMe(req, res); }
      if (req.method === "GET" && url === "/verify") { await new Promise((r) => auth(req, res, r)); if (res.writableEnded) return; return handleVerify(req, res); }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not_found", path: url }));
    } catch (e) {
      if (res.writableEnded) return;
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "server_error", message: e.message }));
    }
  });
  return { server, port, host, store: userStore, secret };
}

export function start(opts = {}) {
  const { server, port, host } = buildServer(opts);
  server.listen(port, host, () => {
    console.log(`[auth] listening on http://${host}:${port}`);
  });
  return server;
}

if (false && import.meta.url === `file://${process.argv[1]}`) {
  start();
}

// Auto-start when invoked directly (not when imported for tests).
import { fileURLToPath as _authFileURLToPath } from "node:url";
import { resolve as _authPathResolve } from "node:path";
const _isAuthMain = (() => {
  if (!process.argv[1]) return false;
  const thisFile = _authFileURLToPath(import.meta.url);
  const argvFile = _authPathResolve(process.argv[1]);
  return thisFile === argvFile;
})();
if (_isAuthMain) {
  start();
}
