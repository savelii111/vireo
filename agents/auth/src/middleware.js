// Vireo Auth — middleware for protecting routes with Bearer JWT.

import { verify, TokenError } from "./tokens.js";

export function authMiddleware(secret) {
  return async function (req, res, next) {
    const auth = req.headers["authorization"] || req.headers["Authorization"];
    if (!auth || typeof auth !== "string") {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "missing_authorization" }));
      return;
    }
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (!m) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "malformed_authorization" }));
      return;
    }
    const token = m[1].trim();
    try {
      const claims = verify(token, secret);
      req.user = {
        id: claims.sub,
        email: claims.email,
        name: claims.name,
      };
      req.token = { raw: token, claims };
      if (typeof next === "function") return next();
      return claims;
    } catch (e) {
      const code = e instanceof TokenError ? e.code : "invalid_token";
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_token", code }));
      return;
    }
  };
}

// Read body for handlers that need it (POST/PUT).
// Use as: const body = await readJsonBody(req, res, 16_000);
export function readJsonBody(req, res, maxBytes = 16_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (c) => {
      total += c.length;
      if (total > maxBytes) {
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "payload_too_large" }));
        req.destroy();
        reject(new Error("payload_too_large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_json" }));
        reject(new Error("invalid_json"));
      }
    });
    req.on("error", (e) => reject(e));
  });
}

// Read the raw request body as a string (no JSON parsing).
// Useful for webhook signature verification where you must hash the
// exact bytes the sender sent.
export function readRawBody(req, res, maxBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (c) => {
      total += c.length;
      if (total > maxBytes) {
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "payload_too_large" }));
        req.destroy();
        reject(new Error("payload_too_large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", (e) => reject(e));
  });
}
