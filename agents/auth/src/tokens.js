// Vireo Auth — minimal JWT (HS256) implementation.
// No external deps; uses node:crypto for HMAC-SHA256.

import { createHmac, randomBytes } from "node:crypto";

const DEFAULT_TTL_SEC = 24 * 60 * 60; // 24 hours
const ALG = "HS256";

function base64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64urlDecode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  return Buffer.from(str, "base64");
}

export function sign(payload, secret, ttlSec = DEFAULT_TTL_SEC) {
  if (!secret) throw new Error("secret required");
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    ...payload,
    iat: now,
    exp: now + ttlSec,
    jti: randomBytes(8).toString("hex"),
  };
  const header = { alg: ALG, typ: "JWT" };
  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(claims));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = createHmac("sha256", secret).update(signingInput).digest();
  const sigB64 = base64url(sig);
  return `${signingInput}.${sigB64}`;
}

export class TokenError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "TokenError";
    this.code = code;
  }
}

export function verify(token, secret, { clockSkewSec = 5 } = {}) {
  if (typeof token !== "string" || !token.includes(".")) {
    throw new TokenError("malformed token", "malformed");
  }
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new TokenError("malformed token", "malformed");
  }
  const [headerB64, payloadB64, sigB64] = parts;

  // Recompute signature
  const expected = createHmac("sha256", secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest();
  const provided = base64urlDecode(sigB64);
  if (expected.length !== provided.length) {
    throw new TokenError("invalid signature", "bad_signature");
  }
  if (!timingSafeEqualBufs(expected, provided)) {
    throw new TokenError("invalid signature", "bad_signature");
  }

  // Decode header + payload
  let header, payload;
  try {
    header = JSON.parse(base64urlDecode(headerB64).toString("utf8"));
    payload = JSON.parse(base64urlDecode(payloadB64).toString("utf8"));
  } catch {
    throw new TokenError("malformed token", "malformed");
  }

  if (header.alg !== ALG) {
    throw new TokenError("unsupported alg", "bad_alg");
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number") {
    throw new TokenError("missing exp", "no_exp");
  }
  if (now > payload.exp + clockSkewSec) {
    throw new TokenError("token expired", "expired");
  }
  if (typeof payload.nbf === "number" && now + clockSkewSec < payload.nbf) {
    throw new TokenError("token not yet valid", "not_yet_valid");
  }
  return payload;
}

function timingSafeEqualBufs(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a[i] ^ b[i];
  return r === 0;
}
