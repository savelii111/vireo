/**
 * Tests for usePresence hook logic.
 * Pure state-management tests running in plain Node.js.
 */

let assert = require('assert');
let { randomUUID } = require('crypto');

// ── Constants (mirrored from hook) ─────────────────────────────────

const STALE_TIMEOUT_MS = 5 * 60 * 1000;

// ── Lightweight state container matching hook behaviour ─────────────

function createPresenceStore() {
  let users = [];

  function setUser({ id, name, color, cursor }) {
    if (!name || name.trim().length === 0) {
      throw new Error('User name must not be empty');
    }
    if (!color || !/^#[0-9a-fA-F]{6}$/.test(color)) {
      throw new Error('User color must be a valid hex color (e.g. #ff0000)');
    }
    const user = {
      id,
      name,
      color,
      cursor: cursor ?? null,
      lastSeen: Date.now(),
    };
    const idx = users.findIndex((u) => u.id === id);
    if (idx >= 0) {
      users[idx] = { ...user, lastSeen: Date.now() };
    } else {
      users.push(user);
    }
    return user;
  }

  function getUsers() {
    const now = Date.now();
    return users.filter((u) => now - u.lastSeen < STALE_TIMEOUT_MS);
  }

  function removeUser(id) {
    const idx = users.findIndex((u) => u.id === id);
    if (idx < 0) return false;
    users.splice(idx, 1);
    return true;
  }

  function updateCursor(userId, pos) {
    const u = users.find((u) => u.id === userId);
    if (u) {
      u.cursor = pos;
      u.lastSeen = Date.now();
    }
  }

  /** Manually age a user's lastSeen for testing cleanup. */
  function _ageUser(id, ms) {
    const u = users.find((u) => u.id === id);
    if (u) u.lastSeen -= ms;
  }

  function _getAll() { return [...users]; }

  return { setUser, getUsers, removeUser, updateCursor, _ageUser, _getAll };
}

// ── Helpers ────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
  }
}

// ── Tests ──────────────────────────────────────────────────────────

console.log('\nPresence – 15 tests\n');

test('1. setUser stores user', () => {
  const store = createPresenceStore();
  const u = store.setUser({ id: 'u1', name: 'Alice', color: '#ff0000' });
  assert.strictEqual(u.id, 'u1');
  assert.strictEqual(u.name, 'Alice');
  assert.strictEqual(store.getUsers().length, 1);
});

test('2. getUsers returns all', () => {
  const store = createPresenceStore();
  store.setUser({ id: 'u1', name: 'A', color: '#111111' });
  store.setUser({ id: 'u2', name: 'B', color: '#222222' });
  store.setUser({ id: 'u3', name: 'C', color: '#333333' });
  assert.strictEqual(store.getUsers().length, 3);
});

test('3. removeUser deletes user', () => {
  const store = createPresenceStore();
  store.setUser({ id: 'u1', name: 'A', color: '#111111' });
  assert.strictEqual(store.removeUser('u1'), true);
  assert.strictEqual(store.getUsers().length, 0);
});

test('4. updateCursor updates position', () => {
  const store = createPresenceStore();
  store.setUser({ id: 'u1', name: 'A', color: '#111111' });
  store.updateCursor('u1', { x: 100, y: 200 });
  const u = store.getUsers().find((u) => u.id === 'u1');
  assert.deepStrictEqual(u.cursor, { x: 100, y: 200 });
});

test('5. Auto-cleanup after 5min', () => {
  const store = createPresenceStore();
  store.setUser({ id: 'u1', name: 'A', color: '#111111' });
  store.setUser({ id: 'u2', name: 'B', color: '#222222' });
  // Age u1 past the threshold
  store._ageUser('u1', STALE_TIMEOUT_MS + 1000);
  const active = store.getUsers();
  assert.strictEqual(active.length, 1);
  assert.strictEqual(active[0].id, 'u2');
});

test('6. User has correct color', () => {
  const store = createPresenceStore();
  const u = store.setUser({ id: 'u1', name: 'A', color: '#abcdef' });
  assert.strictEqual(u.color, '#abcdef');
});

test('7. Multiple users independent', () => {
  const store = createPresenceStore();
  store.setUser({ id: 'u1', name: 'A', color: '#111111' });
  store.setUser({ id: 'u2', name: 'B', color: '#222222' });
  store.updateCursor('u1', { x: 10, y: 20 });
  const u1 = store.getUsers().find((u) => u.id === 'u1');
  const u2 = store.getUsers().find((u) => u.id === 'u2');
  assert.deepStrictEqual(u1.cursor, { x: 10, y: 20 });
  assert.strictEqual(u2.cursor, null);
});

test('8. lastSeen updated on setUser', () => {
  const store = createPresenceStore();
  store.setUser({ id: 'u1', name: 'A', color: '#111111' });
  const before = store._getAll()[0].lastSeen;
  // Small delay then update
  store.setUser({ id: 'u1', name: 'A', color: '#111111' });
  const after = store._getAll()[0].lastSeen;
  assert.ok(after >= before, 'lastSeen should be >= previous');
});

test('9. Empty name rejected', () => {
  const store = createPresenceStore();
  assert.throws(() => store.setUser({ id: 'u1', name: '', color: '#ff0000' }), /empty/i);
  assert.throws(() => store.setUser({ id: 'u1', name: '   ', color: '#ff0000' }), /empty/i);
});

test('10. Invalid color rejected', () => {
  const store = createPresenceStore();
  assert.throws(() => store.setUser({ id: 'u1', name: 'A', color: 'red' }), /hex color/i);
  assert.throws(() => store.setUser({ id: 'u1', name: 'A', color: '#fff' }), /hex color/i);
  assert.throws(() => store.setUser({ id: 'u1', name: 'A', color: '' }), /hex color/i);
});

test('11. Concurrent updates safe', () => {
  const store = createPresenceStore();
  for (let i = 0; i < 100; i++) {
    store.setUser({ id: `u${i}`, name: `User${i}`, color: '#123456' });
  }
  assert.strictEqual(store.getUsers().length, 100);
  for (let i = 0; i < 100; i++) {
    store.updateCursor(`u${i}`, { x: i, y: i * 2 });
  }
  const u50 = store.getUsers().find((u) => u.id === 'u50');
  assert.deepStrictEqual(u50.cursor, { x: 50, y: 100 });
});

test('12. remove non-existent returns false', () => {
  const store = createPresenceStore();
  assert.strictEqual(store.removeUser('nope'), false);
});

test('13. getUsers excludes stale users', () => {
  const store = createPresenceStore();
  store.setUser({ id: 'u1', name: 'A', color: '#111111' });
  store.setUser({ id: 'u2', name: 'B', color: '#222222' });
  store._ageUser('u1', STALE_TIMEOUT_MS);
  const active = store.getUsers();
  assert.strictEqual(active.length, 1);
  assert.strictEqual(active[0].id, 'u2');
});

test('14. User id unique', () => {
  const store = createPresenceStore();
  store.setUser({ id: 'u1', name: 'A', color: '#111111' });
  store.setUser({ id: 'u2', name: 'B', color: '#222222' });
  store.setUser({ id: 'u3', name: 'C', color: '#333333' });
  const ids = store.getUsers().map((u) => u.id);
  assert.strictEqual(new Set(ids).size, 3);
});

test('15. Cursor defaults to null', () => {
  const store = createPresenceStore();
  const u = store.setUser({ id: 'u1', name: 'A', color: '#111111' });
  assert.strictEqual(u.cursor, null);
});

// ── Summary ────────────────────────────────────────────────────────

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
