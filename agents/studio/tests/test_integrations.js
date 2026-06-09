// test_integrations.js — Comprehensive tests for the integrations module.
//
// Validates all 10 integration tools, connection management, disconnection,
// batch connections, and edge cases.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  connectGoogleDrive,
  connectDropbox,
  connectOneDrive,
  connectAWS,
  connectSFTP,
  connectWebDAV,
  connectSlack,
  connectDiscord,
  connectNotion,
  connectZapier,
  listConnections,
  getConnection,
  disconnect,
  connectAll,
  _resetConnections,
  _getConnections,
} from "../src/integrations.js";

// Reset connection store before each test
test.beforeEach(() => {
  _resetConnections();
});

// =====================================================================
// 1. connectGoogleDrive — returns all required fields
// =====================================================================
test("connectGoogleDrive returns all required fields", () => {
  const result = connectGoogleDrive({
    projectId: "proj-001",
    folderId: "folder-abc",
  });
  assert.equal(result.connected, true);
  assert.equal(result.folder_id, "folder-abc");
  assert.equal(result.sync_enabled, true);
  assert.equal(result.quota_mb, 15000);
  assert.ok(result.connection_id.startsWith("gdrive-"));
  assert.equal(result.project_id, "proj-001");
});

// =====================================================================
// 2. connectGoogleDrive — throws without projectId
// =====================================================================
test("connectGoogleDrive throws without projectId", () => {
  assert.throws(
    () => connectGoogleDrive({ folderId: "f1" }),
    /projectId is required/
  );
});

// =====================================================================
// 3. connectGoogleDrive — throws without folderId
// =====================================================================
test("connectGoogleDrive throws without folderId", () => {
  assert.throws(
    () => connectGoogleDrive({ projectId: "p1" }),
    /folderId is required/
  );
});

// =====================================================================
// 4. connectDropbox — returns all required fields
// =====================================================================
test("connectDropbox returns all required fields", () => {
  const result = connectDropbox({
    projectId: "proj-002",
    path: "/vireo/projects",
  });
  assert.equal(result.connected, true);
  assert.equal(result.path, "/vireo/projects");
  assert.equal(result.sync_enabled, true);
  assert.equal(result.space_used_mb, 2048);
  assert.ok(result.connection_id.startsWith("dropbox-"));
  assert.equal(result.project_id, "proj-002");
});

// =====================================================================
// 5. connectDropbox — normalizes path without leading slash
// =====================================================================
test("connectDropbox normalizes path without leading slash", () => {
  const result = connectDropbox({
    projectId: "proj-003",
    path: "vireo/projects",
  });
  assert.equal(result.path, "/vireo/projects");
});

// =====================================================================
// 6. connectDropbox — throws without path
// =====================================================================
test("connectDropbox throws without path", () => {
  assert.throws(
    () => connectDropbox({ projectId: "p1" }),
    /path is required/
  );
});

// =====================================================================
// 7. connectOneDrive — returns all required fields
// =====================================================================
test("connectOneDrive returns all required fields", () => {
  const result = connectOneDrive({
    projectId: "proj-004",
    folderId: "ms-folder-xyz",
  });
  assert.equal(result.connected, true);
  assert.equal(result.folder_id, "ms-folder-xyz");
  assert.equal(result.sync_enabled, true);
  assert.equal(result.quota_mb, 5000);
  assert.ok(result.connection_id.startsWith("onedrive-"));
});

// =====================================================================
// 8. connectOneDrive — throws without folderId
// =====================================================================
test("connectOneDrive throws without folderId", () => {
  assert.throws(
    () => connectOneDrive({ projectId: "p1" }),
    /folderId is required/
  );
});

// =====================================================================
// 9. connectAWS — returns all required fields
// =====================================================================
test("connectAWS returns all required fields", () => {
  const result = connectAWS({
    projectId: "proj-005",
    bucket: "my-vireo-bucket",
    region: "eu-west-1",
  });
  assert.equal(result.connected, true);
  assert.equal(result.bucket, "my-vireo-bucket");
  assert.equal(result.region, "eu-west-1");
  assert.equal(result.sync_enabled, true);
  assert.ok(result.connection_id.startsWith("aws-"));
});

// =====================================================================
// 10. connectAWS — throws without region
// =====================================================================
test("connectAWS throws without region", () => {
  assert.throws(
    () => connectAWS({ projectId: "p1", bucket: "b1" }),
    /region is required/
  );
});

// =====================================================================
// 11. connectAWS — throws without bucket
// =====================================================================
test("connectAWS throws without bucket", () => {
  assert.throws(
    () => connectAWS({ projectId: "p1", region: "us-east-1" }),
    /bucket is required/
  );
});

// =====================================================================
// 12. connectSFTP — returns all required fields
// =====================================================================
test("connectSFTP returns all required fields", () => {
  const result = connectSFTP({
    projectId: "proj-006",
    host: "sftp.example.com",
    port: 2222,
    username: "admin",
  });
  assert.equal(result.connected, true);
  assert.equal(result.host, "sftp.example.com");
  assert.equal(result.port, 2222);
  assert.equal(result.sync_enabled, true);
  assert.equal(result.path, "/home/admin/vireo");
  assert.ok(result.connection_id.startsWith("sftp-"));
});

// =====================================================================
// 13. connectSFTP — defaults port to 22
// =====================================================================
test("connectSFTP defaults port to 22", () => {
  const result = connectSFTP({
    projectId: "proj-007",
    host: "sftp.example.com",
    username: "user",
  });
  assert.equal(result.port, 22);
});

// =====================================================================
// 14. connectSFTP — throws without username
// =====================================================================
test("connectSFTP throws without username", () => {
  assert.throws(
    () => connectSFTP({ projectId: "p1", host: "h1" }),
    /username is required/
  );
});

// =====================================================================
// 15. connectWebDAV — returns all required fields
// =====================================================================
test("connectWebDAV returns all required fields", () => {
  const result = connectWebDAV({
    projectId: "proj-008",
    url: "https://dav.example.com",
    username: "webdav-user",
  });
  assert.equal(result.connected, true);
  assert.equal(result.url, "https://dav.example.com");
  assert.equal(result.sync_enabled, true);
  assert.equal(result.quota_mb, 10000);
  assert.equal(result.username, "webdav-user");
  assert.ok(result.connection_id.startsWith("webdav-"));
});

// =====================================================================
// 16. connectWebDAV — throws without url
// =====================================================================
test("connectWebDAV throws without url", () => {
  assert.throws(
    () => connectWebDAV({ projectId: "p1", username: "u1" }),
    /url is required/
  );
});

// =====================================================================
// 17. connectSlack — returns all required fields
// =====================================================================
test("connectSlack returns all required fields", () => {
  const result = connectSlack({
    workspaceId: "ws-abc",
    channelId: "ch-123",
  });
  assert.equal(result.connected, true);
  assert.equal(result.workspace, "ws-abc");
  assert.equal(result.channel, "ch-123");
  assert.equal(result.notifications_enabled, true);
  assert.ok(result.connection_id.startsWith("slack-"));
  assert.equal(result.project_id, null);
});

// =====================================================================
// 18. connectSlack — throws without workspaceId
// =====================================================================
test("connectSlack throws without workspaceId", () => {
  assert.throws(
    () => connectSlack({ channelId: "ch1" }),
    /workspaceId is required/
  );
});

// =====================================================================
// 19. connectSlack — throws without channelId
// =====================================================================
test("connectSlack throws without channelId", () => {
  assert.throws(
    () => connectSlack({ workspaceId: "ws1" }),
    /channelId is required/
  );
});

// =====================================================================
// 20. connectDiscord — returns all required fields
// =====================================================================
test("connectDiscord returns all required fields", () => {
  const result = connectDiscord({
    guildId: "guild-xyz",
    channelId: "ch-discord-001",
  });
  assert.equal(result.connected, true);
  assert.equal(result.guild, "guild-xyz");
  assert.equal(result.channel, "ch-discord-001");
  assert.equal(result.notifications_enabled, true);
  assert.ok(result.connection_id.startsWith("discord-"));
  assert.equal(result.project_id, null);
});

// =====================================================================
// 21. connectDiscord — throws without guildId
// =====================================================================
test("connectDiscord throws without guildId", () => {
  assert.throws(
    () => connectDiscord({ channelId: "ch1" }),
    /guildId is required/
  );
});

// =====================================================================
// 22. connectNotion — returns all required fields
// =====================================================================
test("connectNotion returns all required fields", () => {
  const result = connectNotion({
    workspaceId: "notion-ws-001",
    databaseId: "notion-db-001",
  });
  assert.equal(result.connected, true);
  assert.equal(result.workspace, "notion-ws-001");
  assert.equal(result.database, "notion-db-001");
  assert.equal(result.sync_enabled, true);
  assert.ok(result.connection_id.startsWith("notion-"));
});

// =====================================================================
// 23. connectNotion — throws without databaseId
// =====================================================================
test("connectNotion throws without databaseId", () => {
  assert.throws(
    () => connectNotion({ workspaceId: "ws1" }),
    /databaseId is required/
  );
});

// =====================================================================
// 24. connectZapier — returns all required fields
// =====================================================================
test("connectZapier returns all required fields", () => {
  const result = connectZapier({
    webhookUrl: "https://hooks.zapier.com/hooks/catch/123456",
  });
  assert.equal(result.connected, true);
  assert.equal(result.webhook_url, "https://hooks.zapier.com/hooks/catch/123456");
  assert.equal(result.status, "active");
  assert.ok(Array.isArray(result.events));
  assert.ok(result.events.length > 0);
  assert.ok(result.connection_id.startsWith("zapier-"));
});

// =====================================================================
// 25. connectZapier — events include expected types
// =====================================================================
test("connectZapier events include expected types", () => {
  const result = connectZapier({ webhookUrl: "https://hooks.zapier.com/test" });
  assert.ok(result.events.includes("project.created"));
  assert.ok(result.events.includes("export.completed"));
  assert.ok(result.events.includes("asset.uploaded"));
});

// =====================================================================
// 26. connectZapier — throws without webhookUrl
// =====================================================================
test("connectZapier throws without webhookUrl", () => {
  assert.throws(() => connectZapier({}), /webhookUrl is required/);
});

// =====================================================================
// 27. listConnections — returns all connections
// =====================================================================
test("listConnections returns all connections", () => {
  connectGoogleDrive({ projectId: "p1", folderId: "f1" });
  connectSlack({ workspaceId: "ws1", channelId: "ch1" });
  const all = listConnections();
  assert.equal(all.length, 2);
});

// =====================================================================
// 28. listConnections — filters by type
// =====================================================================
test("listConnections filters by type", () => {
  connectGoogleDrive({ projectId: "p1", folderId: "f1" });
  connectDropbox({ projectId: "p1", path: "/test" });
  connectSlack({ workspaceId: "ws1", channelId: "ch1" });
  const cloudOnly = listConnections({ type: "google_drive" });
  assert.equal(cloudOnly.length, 1);
  assert.equal(cloudOnly[0].type, "google_drive");
});

// =====================================================================
// 29. listConnections — filters by projectId
// =====================================================================
test("listConnections filters by projectId", () => {
  connectGoogleDrive({ projectId: "proj-A", folderId: "f1" });
  connectDropbox({ projectId: "proj-B", path: "/test" });
  connectAWS({ projectId: "proj-A", bucket: "b1", region: "us-east-1" });
  const projA = listConnections({ projectId: "proj-A" });
  assert.equal(projA.length, 2);
});

// =====================================================================
// 30. getConnection — returns specific connection
// =====================================================================
test("getConnection returns specific connection", () => {
  const gdrive = connectGoogleDrive({ projectId: "p1", folderId: "f1" });
  const conn = getConnection(gdrive.connection_id);
  assert.ok(conn);
  assert.equal(conn.type, "google_drive");
  assert.equal(conn.folder_id, "f1");
});

// =====================================================================
// 31. getConnection — returns undefined for unknown id
// =====================================================================
test("getConnection returns undefined for unknown id", () => {
  const conn = getConnection("nonexistent-id");
  assert.equal(conn, undefined);
});

// =====================================================================
// 32. disconnect — disconnects an active connection
// =====================================================================
test("disconnect disconnects an active connection", () => {
  const conn = connectSlack({ workspaceId: "ws1", channelId: "ch1" });
  const result = disconnect(conn.connection_id);
  assert.equal(result.ok, true);
  assert.equal(result.connection_id, conn.connection_id);

  const stored = getConnection(conn.connection_id);
  assert.equal(stored.connected, false);
  assert.equal(stored.notifications_enabled, false);
  assert.ok(stored.disconnected_at);
});

// =====================================================================
// 33. disconnect — returns error for unknown id
// =====================================================================
test("disconnect returns error for unknown id", () => {
  const result = disconnect("nonexistent-id");
  assert.equal(result.ok, false);
  assert.ok(result.error.includes("not found"));
});

// =====================================================================
// 34. connectAll — connects multiple services
// =====================================================================
test("connectAll connects multiple services", () => {
  const result = connectAll({
    projectId: "proj-batch",
    services: {
      google_drive: { folderId: "f1" },
      slack: { workspaceId: "ws1", channelId: "ch1" },
      zapier: { webhookUrl: "https://hooks.zapier.com/test" },
    },
  });
  assert.equal(result.total_connected, 3);
  assert.equal(result.failures, 0);
  assert.equal(result.results.length, 3);
  for (const r of result.results) {
    assert.equal(r.success, true);
  }
});

// =====================================================================
// 35. connectAll — throws without projectId
// =====================================================================
test("connectAll throws without projectId", () => {
  assert.throws(() => connectAll({}), /projectId is required/);
});

// =====================================================================
// 36. connectAll — empty services returns zero results
// =====================================================================
test("connectAll with empty services returns zero results", () => {
  const result = connectAll({ projectId: "proj-empty", services: {} });
  assert.equal(result.total_connected, 0);
  assert.equal(result.failures, 0);
  assert.equal(result.results.length, 0);
});

// =====================================================================
// 37. Each connection gets a unique ID
// =====================================================================
test("Each connection gets a unique ID", () => {
  const ids = new Set();
  for (let i = 0; i < 10; i++) {
    const r = connectGoogleDrive({ projectId: `p${i}`, folderId: `f${i}` });
    ids.add(r.connection_id);
  }
  assert.equal(ids.size, 10);
});

// =====================================================================
// 38. All connections have created_at timestamp
// =====================================================================
test("All connections have created_at timestamp", () => {
  const gdrive = connectGoogleDrive({ projectId: "p1", folderId: "f1" });
  const slack = connectSlack({ workspaceId: "ws1", channelId: "ch1" });
  const zapier = connectZapier({ webhookUrl: "https://hooks.test" });

  assert.ok(gdrive.created_at);
  assert.ok(slack.created_at);
  assert.ok(zapier.created_at);

  // Should be valid ISO date strings
  assert.ok(!isNaN(new Date(gdrive.created_at).getTime()));
  assert.ok(!isNaN(new Date(slack.created_at).getTime()));
  assert.ok(!isNaN(new Date(zapier.created_at).getTime()));
});

// =====================================================================
// 39. connectSFTP — default path uses username
// =====================================================================
test("connectSFTP default path includes username", () => {
  const result = connectSFTP({
    projectId: "p1",
    host: "sftp.test.com",
    username: "myuser",
  });
  assert.equal(result.path, "/home/myuser/vireo");
});

// =====================================================================
// 40. connectDropbox — preserves path with leading slash
// =====================================================================
test("connectDropbox preserves path with leading slash", () => {
  const result = connectDropbox({
    projectId: "p1",
    path: "/existing/path",
  });
  assert.equal(result.path, "/existing/path");
});
