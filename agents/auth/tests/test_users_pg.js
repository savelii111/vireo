// Tests for PostgresUserStore — auth agent persistent storage adapter.

import { test } from "node:test";
import assert from "node:assert/strict";
import { PostgresUserStore, ValidationError, EmailTakenError } from "../src/users_pg.js";

function makeMockUsersStore() {
  const users = new Map(); // id -> user
  const emailIndex = new Map(); // email -> id
  return {
    _users: users,
    _emailIndex: emailIndex,
    async findByEmail(email) {
      const id = emailIndex.get(email.toLowerCase());
      return id ? users.get(id) : null;
    },
    async findById(id) {
      return users.get(id) || null;
    },
    async create({ email, password_hash, name, plan = "free" }) {
      const id = "u_" + Math.random().toString(36).slice(2, 10);
      const user = { id, email: email.toLowerCase(), password_hash, name, plan,
                     created_at: new Date().toISOString(),
                     updated_at: new Date().toISOString() };
      users.set(id, user);
      emailIndex.set(user.email, id);
      return user;
    },
    async update(id, patch) {
      const u = users.get(id);
      if (!u) return null;
      Object.assign(u, patch);
      return u;
    },
    async count() { return users.size; },
  };
}

test("signup: creates a new user with hashed password", async () => {
  const users = makeMockUsersStore();
  const store = new PostgresUserStore(users);
  const u = await store.signup({ email: "test@example.com", password: "securepassword" });
  assert.equal(u.email, "test@example.com");
  assert.ok(u.passwordHash.startsWith("scrypt$"));
  assert.equal(u.name, "test");
});

test("signup: lowercases email", async () => {
  const users = makeMockUsersStore();
  const store = new PostgresUserStore(users);
  const u = await store.signup({ email: "USER@EXAMPLE.COM", password: "securepassword" });
  assert.equal(u.email, "user@example.com");
});

test("signup: rejects invalid email", async () => {
  const users = makeMockUsersStore();
  const store = new PostgresUserStore(users);
  await assert.rejects(
    () => store.signup({ email: "not-an-email", password: "securepassword" }),
    ValidationError,
  );
});

test("signup: rejects weak password", async () => {
  const users = makeMockUsersStore();
  const store = new PostgresUserStore(users);
  await assert.rejects(
    () => store.signup({ email: "test@example.com", password: "short" }),
  );
});

test("signup: rejects duplicate email", async () => {
  const users = makeMockUsersStore();
  const store = new PostgresUserStore(users);
  await store.signup({ email: "test@example.com", password: "securepassword" });
  await assert.rejects(
    () => store.signup({ email: "test@example.com", password: "differentpw1" }),
    EmailTakenError,
  );
});

test("login: returns user on correct password", async () => {
  const users = makeMockUsersStore();
  const store = new PostgresUserStore(users);
  await store.signup({ email: "test@example.com", password: "securepassword" });
  const u = await store.login({ email: "test@example.com", password: "securepassword" });
  assert.ok(u);
  assert.equal(u.email, "test@example.com");
});

test("login: returns null on wrong password", async () => {
  const users = makeMockUsersStore();
  const store = new PostgresUserStore(users);
  await store.signup({ email: "test@example.com", password: "securepassword" });
  const u = await store.login({ email: "test@example.com", password: "wrongpassword" });
  assert.equal(u, null);
});

test("login: returns null on unknown email", async () => {
  const users = makeMockUsersStore();
  const store = new PostgresUserStore(users);
  const u = await store.login({ email: "nobody@example.com", password: "any" });
  assert.equal(u, null);
});

test("getById: returns user or null", async () => {
  const users = makeMockUsersStore();
  const store = new PostgresUserStore(users);
  const u = await store.signup({ email: "test@example.com", password: "securepassword" });
  const found = await store.getById(u.id);
  assert.ok(found);
  assert.equal(found.email, "test@example.com");
  const missing = await store.getById("nonexistent");
  assert.equal(missing, null);
});

test("size: returns user count", async () => {
  const users = makeMockUsersStore();
  const store = new PostgresUserStore(users);
  await store.signup({ email: "a@example.com", password: "securepassword" });
  await store.signup({ email: "b@example.com", password: "securepassword" });
  assert.equal(await store.size(), 2);
});
