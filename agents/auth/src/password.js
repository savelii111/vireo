// Vireo Auth — password hashing (scrypt, memory-hard, native to Node).
// No external deps; uses node:crypto.

import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

const N = 16384;     // CPU/memory cost
const r = 8;         // block size
const p = 1;         // parallelization
const KEYLEN = 64;   // derived key length (bytes)
const SALT_LEN = 16; // salt length (bytes)

function toHex(buf) {
  return buf.toString("hex");
}
function fromHex(hex) {
  return Buffer.from(hex, "hex");
}

export async function hashPassword(password) {
  if (typeof password !== "string" || password.length < 8) {
    throw new PasswordTooShortError("password must be at least 8 characters");
  }
  const salt = randomBytes(SALT_LEN);
  const derived = await scryptAsync(password, salt, KEYLEN, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${toHex(salt)}$${toHex(derived)}`;
}

export async function verifyPassword(password, stored) {
  if (typeof stored !== "string" || !stored.startsWith("scrypt$")) {
    return false;
  }
  const parts = stored.split("$");
  if (parts.length !== 6) return false;
  const [, nStr, rStr, pStr, saltHex, hashHex] = parts;
  const salt = fromHex(saltHex);
  const expected = fromHex(hashHex);
  const derived = await scryptAsync(
    password, salt, expected.length,
    { N: Number(nStr), r: Number(rStr), p: Number(pStr) }
  );
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

export class PasswordTooShortError extends Error {
  constructor(message) {
    super(message);
    this.name = "PasswordTooShortError";
  }
}
