// Vireo Auth — UserStore (in-memory, deterministic ID).
// Use this for dev/tests; swap with Postgres adapter later (Phase 1.11).

import { randomUUID } from "node:crypto";
import { hashPassword, verifyPassword, PasswordTooShortError } from "./password.js";

export class UserStore {
  constructor() {
    this.users = new Map();     // id -> { id, email, passwordHash, createdAt }
    this.emailIndex = new Map(); // email -> id
  }

  async signup({ email, password, name }) {
    if (!email || typeof email !== "string" || !email.includes("@")) {
      throw new ValidationError("invalid email");
    }
    const normEmail = email.trim().toLowerCase();
    if (this.emailIndex.has(normEmail)) {
      throw new EmailTakenError("email already registered");
    }
    const passwordHash = await hashPassword(password);
    const id = randomUUID();
    const user = {
      id,
      email: normEmail,
      name: name || normEmail.split("@")[0],
      passwordHash,
      createdAt: new Date().toISOString(),
    };
    this.users.set(id, user);
    this.emailIndex.set(normEmail, id);
    return user;
  }

  async login({ email, password }) {
    if (!email || !password) {
      throw new ValidationError("email and password required");
    }
    const normEmail = email.trim().toLowerCase();
    const id = this.emailIndex.get(normEmail);
    if (!id) return null;
    const user = this.users.get(id);
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) return null;
    return user;
  }

  getById(id) {
    return this.users.get(id) || null;
  }

  size() {
    return this.users.size;
  }

  // For tests only
  _reset() {
    this.users.clear();
    this.emailIndex.clear();
  }
}

export class ValidationError extends Error {
  constructor(message) { super(message); this.name = "ValidationError"; }
}
export class EmailTakenError extends Error {
  constructor(message) { super(message); this.name = "EmailTakenError"; }
}
