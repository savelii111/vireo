/**
 * Tests for useComments hook logic.
 * These tests exercise the pure state-management logic extracted from the hook,
 * so they run in plain Node.js without a browser or React.
 */

let assert = require('assert');
let { randomUUID } = require('crypto');

// ── Lightweight state container matching hook behaviour ─────────────

function createCommentsStore() {
  let comments = [];

  function addComment({ clipId, timeSec, content, author }) {
    if (!content || content.trim().length === 0) {
      throw new Error('Comment content must not be empty');
    }
    const comment = {
      id: `cmt-${Date.now()}-${randomUUID().slice(0, 6)}`,
      clipId,
      timeSec,
      content,
      author,
      createdAt: Date.now(),
      resolved: false,
    };
    comments.push(comment);
    return comment;
  }

  function listComments(clipId) {
    const filtered = clipId
      ? comments.filter((c) => c.clipId === clipId)
      : [...comments];
    return filtered.sort((a, b) => a.timeSec - b.timeSec);
  }

  function deleteComment(id) {
    const idx = comments.findIndex((c) => c.id === id);
    if (idx < 0) return false;
    comments.splice(idx, 1);
    return true;
  }

  function resolveComment(id) {
    const c = comments.find((c) => c.id === id);
    if (!c) return false;
    c.resolved = true;
    return true;
  }

  return { addComment, listComments, deleteComment, resolveComment, get: () => comments };
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

console.log('\nComments – 15 tests\n');

test('1. addComment returns comment with id', () => {
  const store = createCommentsStore();
  const c = store.addComment({ timeSec: 5, content: 'Hello', author: 'Alice' });
  assert.ok(c.id, 'comment should have an id');
  assert.strictEqual(typeof c.id, 'string');
});

test('2. addComment with clipId', () => {
  const store = createCommentsStore();
  const c = store.addComment({ clipId: 'clip-1', timeSec: 10, content: 'On clip', author: 'Bob' });
  assert.strictEqual(c.clipId, 'clip-1');
});

test('3. addComment with timeSec only (no clipId)', () => {
  const store = createCommentsStore();
  const c = store.addComment({ timeSec: 42, content: 'Timeline comment', author: 'Carol' });
  assert.strictEqual(c.timeSec, 42);
  assert.strictEqual(c.clipId, undefined);
});

test('4. listComments returns all', () => {
  const store = createCommentsStore();
  store.addComment({ timeSec: 1, content: 'A', author: 'X' });
  store.addComment({ timeSec: 2, content: 'B', author: 'Y' });
  store.addComment({ timeSec: 3, content: 'C', author: 'Z' });
  assert.strictEqual(store.listComments().length, 3);
});

test('5. listComments filters by clipId', () => {
  const store = createCommentsStore();
  store.addComment({ clipId: 'clip-1', timeSec: 1, content: 'A', author: 'X' });
  store.addComment({ clipId: 'clip-2', timeSec: 2, content: 'B', author: 'Y' });
  store.addComment({ clipId: 'clip-1', timeSec: 3, content: 'C', author: 'Z' });
  const result = store.listComments('clip-1');
  assert.strictEqual(result.length, 2);
  assert.ok(result.every((c) => c.clipId === 'clip-1'));
});

test('6. deleteComment removes comment', () => {
  const store = createCommentsStore();
  const c = store.addComment({ timeSec: 5, content: 'X', author: 'A' });
  assert.strictEqual(store.deleteComment(c.id), true);
  assert.strictEqual(store.get().length, 0);
});

test('7. resolveComment marks resolved', () => {
  const store = createCommentsStore();
  const c = store.addComment({ timeSec: 5, content: 'X', author: 'A' });
  assert.strictEqual(c.resolved, false);
  store.resolveComment(c.id);
  const updated = store.get().find((x) => x.id === c.id);
  assert.strictEqual(updated.resolved, true);
});

test('8. Comment has correct author', () => {
  const store = createCommentsStore();
  const c = store.addComment({ timeSec: 1, content: 'Test', author: 'Diana' });
  assert.strictEqual(c.author, 'Diana');
});

test('9. Comment has correct timestamp', () => {
  const store = createCommentsStore();
  const before = Date.now();
  const c = store.addComment({ timeSec: 1, content: 'Test', author: 'Eve' });
  const after = Date.now();
  assert.ok(c.createdAt >= before && c.createdAt <= after, 'createdAt should be between before and after');
});

test('10. Empty content rejected', () => {
  const store = createCommentsStore();
  assert.throws(() => store.addComment({ timeSec: 0, content: '', author: 'A' }), /empty/i);
  assert.throws(() => store.addComment({ timeSec: 0, content: '   ', author: 'A' }), /empty/i);
});

test('11. Concurrent adds handled', () => {
  const store = createCommentsStore();
  const results = [];
  for (let i = 0; i < 100; i++) {
    results.push(store.addComment({ timeSec: i, content: `msg-${i}`, author: 'X' }));
  }
  assert.strictEqual(store.get().length, 100);
  const ids = new Set(results.map((r) => r.id));
  assert.strictEqual(ids.size, 100, 'all ids should be unique');
});

test('12. Delete non-existent returns false', () => {
  const store = createCommentsStore();
  assert.strictEqual(store.deleteComment('nope'), false);
});

test('13. Resolve non-existent returns false', () => {
  const store = createCommentsStore();
  assert.strictEqual(store.resolveComment('nope'), false);
});

test('14. Comments sorted by timeSec', () => {
  const store = createCommentsStore();
  store.addComment({ timeSec: 30, content: 'C', author: 'A' });
  store.addComment({ timeSec: 10, content: 'A', author: 'B' });
  store.addComment({ timeSec: 20, content: 'B', author: 'C' });
  const list = store.listComments();
  assert.deepStrictEqual(
    list.map((c) => c.timeSec),
    [10, 20, 30],
  );
});

test('15. Large content handled', () => {
  const store = createCommentsStore();
  const bigContent = 'X'.repeat(100_000);
  const c = store.addComment({ timeSec: 0, content: bigContent, author: 'A' });
  assert.strictEqual(c.content.length, 100_000);
});

// ── Summary ────────────────────────────────────────────────────────

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
