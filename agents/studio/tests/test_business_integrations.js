// test_business_integrations.js — Comprehensive tests for the business_integrations module.
//
// Validates all 10 business integration tools, webhook lifecycle, and edge cases.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  connectTrello,
  connectAsana,
  connectMonday,
  connectMake,
  connectN8N,
  createWebhook,
  listWebhooks,
  testWebhook,
  deleteWebhook,
  getWebhookLogs,
  VALID_WEBHOOK_EVENTS,
  _resetAll,
  _getConnections,
  _getWebhooks,
} from "../src/business_integrations.js";

// Reset stores before each test
test.beforeEach(() => {
  _resetAll();
});

// =====================================================================
// 1. connectTrello — returns all required fields
// =====================================================================
test("connectTrello returns all required fields", () => {
  const result = connectTrello({ apiKey: "tk-abc", boardId: "board-123" });
  assert.equal(result.connected, true);
  assert.equal(result.board_id, "board-123");
  assert.equal(result.type, "trello");
  assert.equal(typeof result.lists_count, "number");
  assert.equal(typeof result.cards_count, "number");
  assert.ok(result.connection_id.startsWith("trello-"));
  assert.ok(result.created_at);
});

// =====================================================================
// 2. connectTrello — throws without apiKey
// =====================================================================
test("connectTrello throws without apiKey", () => {
  assert.throws(
    () => connectTrello({ boardId: "b1" }),
    /apiKey is required/
  );
});

// =====================================================================
// 3. connectTrello — throws without boardId
// =====================================================================
test("connectTrello throws without boardId", () => {
  assert.throws(
    () => connectTrello({ apiKey: "k1" }),
    /boardId is required/
  );
});

// =====================================================================
// 4. connectAsana — returns all required fields
// =====================================================================
test("connectAsana returns all required fields", () => {
  const result = connectAsana({ apiKey: "ak-xyz", projectId: "proj-789" });
  assert.equal(result.connected, true);
  assert.equal(result.project_id, "proj-789");
  assert.equal(result.type, "asana");
  assert.equal(typeof result.tasks_count, "number");
  assert.equal(typeof result.sections_count, "number");
  assert.ok(result.connection_id.startsWith("asana-"));
  assert.ok(result.created_at);
});

// =====================================================================
// 5. connectAsana — throws without required fields
// =====================================================================
test("connectAsana throws without apiKey", () => {
  assert.throws(
    () => connectAsana({ projectId: "p1" }),
    /apiKey is required/
  );
});

test("connectAsana throws without projectId", () => {
  assert.throws(
    () => connectAsana({ apiKey: "k1" }),
    /projectId is required/
  );
});

// =====================================================================
// 6. connectMonday — returns all required fields
// =====================================================================
test("connectMonday returns all required fields", () => {
  const result = connectMonday({ apiKey: "mk-def", boardId: "mb-456" });
  assert.equal(result.connected, true);
  assert.equal(result.board_id, "mb-456");
  assert.equal(result.type, "monday");
  assert.equal(typeof result.items_count, "number");
  assert.equal(typeof result.groups_count, "number");
  assert.ok(result.connection_id.startsWith("monday-"));
  assert.ok(result.created_at);
});

// =====================================================================
// 7. connectMonday — throws without required fields
// =====================================================================
test("connectMonday throws without apiKey", () => {
  assert.throws(
    () => connectMonday({ boardId: "b1" }),
    /apiKey is required/
  );
});

test("connectMonday throws without boardId", () => {
  assert.throws(
    () => connectMonday({ apiKey: "k1" }),
    /boardId is required/
  );
});

// =====================================================================
// 8. connectMake — returns all required fields
// =====================================================================
test("connectMake returns all required fields", () => {
  const result = connectMake({ apiKey: "mk-ghi", scenarioId: "sc-101" });
  assert.equal(result.connected, true);
  assert.equal(result.scenario_id, "sc-101");
  assert.equal(result.type, "make");
  assert.ok(Array.isArray(result.triggers));
  assert.ok(result.triggers.length > 0);
  assert.equal(result.status, "active");
  assert.ok(result.connection_id.startsWith("make-"));
  assert.ok(result.created_at);
});

// =====================================================================
// 9. connectMake — throws without required fields
// =====================================================================
test("connectMake throws without apiKey", () => {
  assert.throws(
    () => connectMake({ scenarioId: "s1" }),
    /apiKey is required/
  );
});

test("connectMake throws without scenarioId", () => {
  assert.throws(
    () => connectMake({ apiKey: "k1" }),
    /scenarioId is required/
  );
});

// =====================================================================
// 10. connectN8N — returns all required fields
// =====================================================================
test("connectN8N returns all required fields", () => {
  const result = connectN8N({ apiKey: "n8n-abc", workflowId: "wf-202" });
  assert.equal(result.connected, true);
  assert.equal(result.workflow_id, "wf-202");
  assert.equal(result.type, "n8n");
  assert.equal(typeof result.nodes_count, "number");
  assert.equal(result.status, "active");
  assert.ok(result.connection_id.startsWith("n8n-"));
  assert.ok(result.created_at);
});

// =====================================================================
// 11. connectN8N — throws without required fields
// =====================================================================
test("connectN8N throws without apiKey", () => {
  assert.throws(
    () => connectN8N({ workflowId: "w1" }),
    /apiKey is required/
  );
});

test("connectN8N throws without workflowId", () => {
  assert.throws(
    () => connectN8N({ apiKey: "k1" }),
    /workflowId is required/
  );
});

// =====================================================================
// 12. createWebhook — returns all required fields
// =====================================================================
test("createWebhook returns all required fields", () => {
  const result = createWebhook({
    url: "https://example.com/hook",
    events: ["video.created", "video.exported"],
  });
  assert.ok(result.id.startsWith("wh-"));
  assert.equal(result.url, "https://example.com/hook");
  assert.deepEqual(result.events, ["video.created", "video.exported"]);
  assert.ok(result.secret);
  assert.equal(typeof result.secret, "string");
  assert.equal(result.secret.length, 48);
  assert.equal(result.status, "active");
  assert.ok(result.created_at);
});

// =====================================================================
// 13. createWebhook — throws without url
// =====================================================================
test("createWebhook throws without url", () => {
  assert.throws(
    () => createWebhook({ events: ["video.created"] }),
    /url is required/
  );
});

// =====================================================================
// 14. createWebhook — throws without events
// =====================================================================
test("createWebhook throws without events", () => {
  assert.throws(
    () => createWebhook({ url: "https://example.com" }),
    /events array is required/
  );
});

test("createWebhook throws with empty events array", () => {
  assert.throws(
    () => createWebhook({ url: "https://example.com", events: [] }),
    /events array is required/
  );
});

// =====================================================================
// 15. createWebhook — throws on invalid events
// =====================================================================
test("createWebhook throws on invalid event type", () => {
  assert.throws(
    () =>
      createWebhook({
        url: "https://example.com",
        events: ["video.created", "invalid.event"],
      }),
    /Invalid event\(s\): invalid.event/
  );
});

// =====================================================================
// 16. createWebhook — stores webhook for later retrieval
// =====================================================================
test("createWebhook stores webhook in store", () => {
  const wh = createWebhook({
    url: "https://example.com/hook",
    events: ["video.published"],
  });
  const stored = _getWebhooks().get(wh.id);
  assert.ok(stored);
  assert.equal(stored.id, wh.id);
  assert.equal(stored.url, "https://example.com/hook");
});

// =====================================================================
// 17. listWebhooks — returns all webhooks
// =====================================================================
test("listWebhooks returns all registered webhooks", () => {
  createWebhook({ url: "https://a.com", events: ["video.created"] });
  createWebhook({ url: "https://b.com", events: ["comment.added"] });

  const result = listWebhooks();
  assert.equal(result.total_count, 2);
  assert.ok(Array.isArray(result.webhooks));
  assert.equal(result.webhooks.length, 2);

  // Each webhook has required fields
  for (const wh of result.webhooks) {
    assert.ok(wh.id);
    assert.ok(wh.url);
    assert.ok(Array.isArray(wh.events));
    assert.equal(wh.status, "active");
  }
});

// =====================================================================
// 18. listWebhooks — returns empty list when no webhooks exist
// =====================================================================
test("listWebhooks returns empty list when no webhooks exist", () => {
  const result = listWebhooks();
  assert.equal(result.total_count, 0);
  assert.deepEqual(result.webhooks, []);
});

// =====================================================================
// 19. testWebhook — returns success response
// =====================================================================
test("testWebhook returns success with response code and time", () => {
  const wh = createWebhook({
    url: "https://example.com/hook",
    events: ["video.created"],
  });

  const result = testWebhook(wh.id);
  assert.equal(result.success, true);
  assert.equal(result.response_code, 200);
  assert.equal(typeof result.response_time_ms, "number");
  assert.ok(result.response_time_ms > 0);
});

// =====================================================================
// 20. testWebhook — throws for nonexistent webhook
// =====================================================================
test("testWebhook throws for nonexistent webhook", () => {
  assert.throws(
    () => testWebhook("wh-nonexistent"),
    /Webhook not found/
  );
});

// =====================================================================
// 21. testWebhook — throws without webhookId
// =====================================================================
test("testWebhook throws without webhookId", () => {
  assert.throws(() => testWebhook(), /webhookId is required/);
});

// =====================================================================
// 22. testWebhook — logs the test event
// =====================================================================
test("testWebhook logs the test event", () => {
  const wh = createWebhook({
    url: "https://example.com/hook",
    events: ["video.created"],
  });

  testWebhook(wh.id);
  const logs = getWebhookLogs(wh.id);
  assert.equal(logs.total_count, 1);
  assert.equal(logs.logs[0].event, "webhook.test");
  assert.equal(logs.logs[0].status, "success");
  assert.equal(logs.logs[0].response_code, 200);
  assert.ok(logs.logs[0].timestamp);
});

// =====================================================================
// 23. deleteWebhook — removes webhook from store
// =====================================================================
test("deleteWebhook removes webhook from store", () => {
  const wh = createWebhook({
    url: "https://example.com/hook",
    events: ["video.created"],
  });

  const result = deleteWebhook(wh.id);
  assert.equal(result.deleted, true);
  assert.equal(result.webhook_id, wh.id);

  // Verify removal
  assert.equal(_getWebhooks().has(wh.id), false);
  const list = listWebhooks();
  assert.equal(list.total_count, 0);
});

// =====================================================================
// 24. deleteWebhook — throws for nonexistent webhook
// =====================================================================
test("deleteWebhook throws for nonexistent webhook", () => {
  assert.throws(
    () => deleteWebhook("wh-doesnotexist"),
    /Webhook not found/
  );
});

// =====================================================================
// 25. deleteWebhook — throws without webhookId
// =====================================================================
test("deleteWebhook throws without webhookId", () => {
  assert.throws(() => deleteWebhook(), /webhookId is required/);
});

// =====================================================================
// 26. getWebhookLogs — returns logs for existing webhook
// =====================================================================
test("getWebhookLogs returns logs with total count", () => {
  const wh = createWebhook({
    url: "https://example.com/hook",
    events: ["video.created"],
  });

  testWebhook(wh.id);
  testWebhook(wh.id);

  const result = getWebhookLogs(wh.id);
  assert.equal(result.total_count, 2);
  assert.equal(result.logs.length, 2);
  for (const log of result.logs) {
    assert.ok(log.timestamp);
    assert.ok(log.event);
    assert.ok(log.status);
    assert.ok(typeof log.response_code === "number");
  }
});

// =====================================================================
// 27. getWebhookLogs — respects limit parameter
// =====================================================================
test("getWebhookLogs respects limit parameter", () => {
  const wh = createWebhook({
    url: "https://example.com/hook",
    events: ["video.created"],
  });

  // Create 5 test events
  for (let i = 0; i < 5; i++) testWebhook(wh.id);

  const result = getWebhookLogs(wh.id, { limit: 3 });
  assert.equal(result.total_count, 5);
  assert.equal(result.logs.length, 3);
});

// =====================================================================
// 28. getWebhookLogs — throws for nonexistent webhook
// =====================================================================
test("getWebhookLogs throws for nonexistent webhook", () => {
  assert.throws(
    () => getWebhookLogs("wh-ghost"),
    /Webhook not found/
  );
});

// =====================================================================
// 29. getWebhookLogs — throws without webhookId
// =====================================================================
test("getWebhookLogs throws without webhookId", () => {
  assert.throws(() => getWebhookLogs(), /webhookId is required/);
});

// =====================================================================
// 30. _resetAll clears all stores
// =====================================================================
test("_resetAll clears all connection and webhook stores", () => {
  connectTrello({ apiKey: "k1", boardId: "b1" });
  connectAsana({ apiKey: "k2", projectId: "p1" });
  createWebhook({ url: "https://example.com", events: ["video.created"] });

  assert.ok(_getConnections().size > 0);
  assert.ok(_getWebhooks().size > 0);

  _resetAll();

  assert.equal(_getConnections().size, 0);
  assert.equal(_getWebhooks().size, 0);
});

// =====================================================================
// 31. deleteWebhook also cleans up logs
// =====================================================================
test("deleteWebhook cleans up associated logs", () => {
  const wh = createWebhook({
    url: "https://example.com/hook",
    events: ["video.created"],
  });

  testWebhook(wh.id);
  testWebhook(wh.id);
  assert.equal(getWebhookLogs(wh.id).total_count, 2);

  deleteWebhook(wh.id);

  // Logs should also be removed
  assert.throws(() => getWebhookLogs(wh.id), /Webhook not found/);
});

// =====================================================================
// 32. All connection types store correctly
// =====================================================================
test("all 5 connection types store in connections map", () => {
  connectTrello({ apiKey: "k", boardId: "b" });
  connectAsana({ apiKey: "k", projectId: "p" });
  connectMonday({ apiKey: "k", boardId: "b" });
  connectMake({ apiKey: "k", scenarioId: "s" });
  connectN8N({ apiKey: "k", workflowId: "w" });

  assert.equal(_getConnections().size, 5);
});
