// Vireo Auth — PostgresUserStore (persistent, uses storage extended).
// Drop-in replacement for the in-memory UserStore.

import { hashPassword, verifyPassword } from "./password.js";

export class ValidationError extends Error {
  constructor(message) { super(message); this.name = "ValidationError"; }
}
export class EmailTakenError extends Error {
  constructor(message) { super(message); this.name = "EmailTakenError"; }
}

export class PostgresUserStore {
  constructor(usersStore) {
    // usersStore is a PostgresUsersStore instance from storage/extended
    this.users = usersStore;
  }

  async signup({ email, password, name }) {
    if (!email || typeof email !== "string" || !email.includes("@")) {
      throw new ValidationError("invalid email");
    }
    const normEmail = email.trim().toLowerCase();
    const existing = await this.users.findByEmail(normEmail);
    if (existing) {
      throw new EmailTakenError("email already registered");
    }
    const passwordHash = await hashPassword(password);
    const user = await this.users.create({
      email: normEmail,
      password_hash: passwordHash,
      name: name || normEmail.split("@")[0],
    });
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      passwordHash: user.password_hash,
      createdAt: user.created_at,
    };
  }

  async login({ email, password }) {
    if (!email || !password) {
      throw new ValidationError("email and password required");
    }
    const normEmail = email.trim().toLowerCase();
    const user = await this.users.findByEmail(normEmail);
    if (!user) return null;
    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) return null;
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      passwordHash: user.password_hash,
      createdAt: user.created_at,
    };
  }

  async getById(id) {
    const user = await this.users.findById(id);
    if (!user) return null;
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      passwordHash: user.password_hash,
      createdAt: user.created_at,
    };
  }

  async size() {
    return await this.users.count();
  }
}
