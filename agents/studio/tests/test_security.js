// test_security.js — Tests for the 10 Security tools.
//
//   1.  enableSSOSAML       — SAML-based SSO for a domain
//   2.  enableSSOOAuth      — OAuth-based SSO (Google, GitHub, Microsoft, Okta)
//   3.  enable2FA           — two-factor authentication per user
//   4.  rotateAPIKey        — rotate a project-scoped API key
//   5.  setIPWhitelist      — restrict access by IP address
//   6.  getAuditLog         — query project audit log
//   7.  getDataEncryption   — encryption status for a project
//   8.  exportGDPRData      — GDPR data export for a user
//   9.  deleteUserData      — GDPR-compliant user data deletion
//  10.  getSecurityReport   — composite security score & recommendations
//
// Uses node:test + node:assert/strict (ESM).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SECURITY_TOOLS,
  SECURITY_TOOL_NAMES,
  executeSecurityToolCall,
  enableSSOSAML,
  enableSSOOAuth,
  enable2FA,
  rotateAPIKey,
  setIPWhitelist,
  getAuditLog,
  getDataEncryption,
  exportGDPRData,
  deleteUserData,
  getSecurityReport,
  // Also re-export existing primitives for coverage
  filterByOwner,
  isOwnedBy,
  findForeignIds,
  withTimeout,
  getToolTimeoutMs,
  undoStore,
  confirmationStore,
  isDestructiveTool,
  getDestructiveTools,
} from "../src/security.js";

// ================================================================
// Tool shape
// ================================================================

test("Security: 10 tools exported with valid OpenAI shape", () => {
  assert.equal(SECURITY_TOOLS.length, 10);
  for (const t of SECURITY_TOOLS) {
    assert.equal(t.type, "function");
    assert.ok(t.function.name);
    assert.ok(t.function.description.length > 30);
    assert.ok(t.function.parameters);
    assert.equal(t.function.parameters.type, "object");
  }
  const names = SECURITY_TOOLS.map((t) => t.function.name).sort();
  assert.deepEqual(names, [
    "delete_user_data",
    "enable_2fa",
    "enable_sso_oauth",
    "enable_sso_saml",
    "export_gdpr_data",
    "get_audit_log",
    "get_data_encryption",
    "get_security_report",
    "rotate_api_key",
    "set_ip_whitelist",
  ]);
});

test("Security: SECURITY_TOOL_NAMES set has 10 names", () => {
  assert.equal(SECURITY_TOOL_NAMES.size, 10);
  assert.ok(SECURITY_TOOL_NAMES.has("enable_sso_saml"));
  assert.ok(SECURITY_TOOL_NAMES.has("get_security_report"));
});

// ================================================================
// 1. enableSSOSAML
// ================================================================

test("enableSSOSAML: enables SAML SSO for a domain", () => {
  const r = enableSSOSAML({
    domain: "acme.com",
    certificate: "-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----",
    metadata_url: "https://idp.acme.com/metadata",
  });
  assert.equal(r.enabled, true);
  assert.equal(r.domain, "acme.com");
  assert.ok(r.certificate_fingerprint.length === 64); // SHA-256 hex
  assert.equal(r.metadata_url, "https://idp.acme.com/metadata");
});

test("enableSSOSAML: throws when domain is missing", () => {
  assert.throws(() => enableSSOSAML({ certificate: "cert", metadata_url: "url" }), /domain is required/);
});

test("enableSSOSAML: throws when certificate is missing", () => {
  assert.throws(() => enableSSOSAML({ domain: "x.com", metadata_url: "url" }), /certificate is required/);
});

test("enableSSOSAML: throws when metadata_url is missing", () => {
  assert.throws(() => enableSSOSAML({ domain: "x.com", certificate: "cert" }), /metadata_url is required/);
});

// ================================================================
// 2. enableSSOOAuth
// ================================================================

test("enableSSOOAuth: enables OAuth for a valid provider", () => {
  const r = enableSSOOAuth({
    provider: "google",
    client_id: "abc123",
    client_secret: "secret456",
  });
  assert.equal(r.enabled, true);
  assert.equal(r.provider, "google");
  assert.equal(r.client_id, "abc123");
  assert.ok(r.redirect_url.includes("google"));
});

test("enableSSOOAuth: supports all 4 providers", () => {
  for (const p of ["google", "github", "microsoft", "okta"]) {
    const r = enableSSOOAuth({ provider: p, client_id: `${p}_id`, client_secret: `${p}_secret` });
    assert.equal(r.provider, p);
    assert.ok(r.redirect_url.includes(p));
  }
});

test("enableSSOOAuth: throws for invalid provider", () => {
  assert.throws(
    () => enableSSOOAuth({ provider: "facebook", client_id: "x", client_secret: "y" }),
    /Invalid provider/
  );
});

test("enableSSOOAuth: throws when client_id is missing", () => {
  assert.throws(
    () => enableSSOOAuth({ provider: "google", client_secret: "y" }),
    /client_id is required/
  );
});

// ================================================================
// 3. enable2FA
// ================================================================

test("enable2FA: enables TOTP for a user", () => {
  const r = enable2FA({ userId: "user-1", method: "totp" });
  assert.equal(r.enabled, true);
  assert.equal(r.method, "totp");
  assert.equal(r.backup_codes.length, 8);
  assert.ok(r.recovery_email.includes("user-1"));
});

test("enable2FA: supports sms and email methods", () => {
  const sms = enable2FA({ userId: "u2", method: "sms" });
  assert.equal(sms.method, "sms");
  const email = enable2FA({ userId: "u3", method: "email" });
  assert.equal(email.method, "email");
});

test("enable2FA: throws for invalid method", () => {
  assert.throws(() => enable2FA({ userId: "u", method: "push" }), /Invalid 2FA method/);
});

test("enable2FA: throws when userId is missing", () => {
  assert.throws(() => enable2FA({ method: "totp" }), /userId is required/);
});

// ================================================================
// 4. rotateAPIKey
// ================================================================

test("rotateAPIKey: generates a new key and returns previews", () => {
  const r = rotateAPIKey({ userId: "u1", projectId: "proj-1" });
  assert.ok(r.new_key.startsWith("vsk_"));
  assert.ok(r.old_key_preview.includes("…"));
  assert.ok(r.new_key_preview.includes("…"));
  assert.ok(r.rotated_at);
});

test("rotateAPIKey: old_key_preview shows previous key on second rotation", () => {
  const first = rotateAPIKey({ userId: "u1", projectId: "proj-r" });
  const second = rotateAPIKey({ userId: "u1", projectId: "proj-r" });
  assert.ok(second.old_key_preview.includes("…"));
  // The old_key_preview of the second rotation should match new_key_preview of the first
  assert.equal(second.old_key_preview, first.new_key_preview);
});

test("rotateAPIKey: throws when userId is missing", () => {
  assert.throws(() => rotateAPIKey({ projectId: "p" }), /userId is required/);
});

test("rotateAPIKey: throws when projectId is missing", () => {
  assert.throws(() => rotateAPIKey({ userId: "u" }), /projectId is required/);
});

// ================================================================
// 5. setIPWhitelist
// ================================================================

test("setIPWhitelist: sets IPs and returns config", () => {
  const r = setIPWhitelist({ projectId: "p1", ips: ["10.0.0.1", "192.168.1.0/24"] });
  assert.equal(r.enabled, true);
  assert.deepEqual(r.ips, ["10.0.0.1", "192.168.1.0/24"]);
  assert.equal(r.rules_count, 2);
});

test("setIPWhitelist: throws for empty IPs array", () => {
  assert.throws(() => setIPWhitelist({ projectId: "p", ips: [] }), /ips must be a non-empty array/);
});

test("setIPWhitelist: throws when projectId is missing", () => {
  assert.throws(() => setIPWhitelist({ ips: ["1.2.3.4"] }), /projectId is required/);
});

// ================================================================
// 6. getAuditLog
// ================================================================

test("getAuditLog: returns entries after operations", () => {
  // rotateAPIKey and setIPWhitelist create audit entries
  rotateAPIKey({ userId: "u1", projectId: "proj-audit" });
  setIPWhitelist({ projectId: "proj-audit", ips: ["1.1.1.1"] });

  const log = getAuditLog({ projectId: "proj-audit" });
  assert.ok(log.total_count >= 2);
  assert.ok(log.entries.length >= 2);
  assert.ok(log.entries[0].action);
  assert.ok(log.entries[0].timestamp);
});

test("getAuditLog: filters by action", () => {
  rotateAPIKey({ userId: "u1", projectId: "proj-filter" });
  setIPWhitelist({ projectId: "proj-filter", ips: ["2.2.2.2"] });

  const log = getAuditLog({ projectId: "proj-filter", filters: { action: "api_key_rotated" } });
  assert.ok(log.entries.every((e) => e.action === "api_key_rotated"));
});

test("getAuditLog: returns empty for unknown project", () => {
  const log = getAuditLog({ projectId: "unknown-proj-xyz" });
  assert.equal(log.total_count, 0);
  assert.deepEqual(log.entries, []);
});

test("getAuditLog: throws when projectId is missing", () => {
  assert.throws(() => getAuditLog(), /projectId is required/);
});

// ================================================================
// 7. getDataEncryption
// ================================================================

test("getDataEncryption: returns default encryption status", () => {
  const r = getDataEncryption({ projectId: "proj-enc-new" });
  assert.equal(r.at_rest, true);
  assert.equal(r.in_transit, true);
  assert.equal(r.algorithm, "AES-256-GCM");
  assert.equal(r.key_rotation_days, 90);
});

test("getDataEncryption: returns cached status on second call", () => {
  const first = getDataEncryption({ projectId: "proj-enc-cache" });
  const second = getDataEncryption({ projectId: "proj-enc-cache" });
  assert.deepEqual(first, second);
});

test("getDataEncryption: throws when projectId is missing", () => {
  assert.throws(() => getDataEncryption(), /projectId is required/);
});

// ================================================================
// 8. exportGDPRData
// ================================================================

test("exportGDPRData: returns export info", () => {
  const r = exportGDPRData({ userId: "user-gdpr-1" });
  assert.ok(r.export_url.includes("gdpr"));
  assert.equal(r.format, "json");
  assert.ok(r.size_mb > 0);
  assert.ok(r.includes.includes("profile"));
  assert.ok(r.includes.includes("projects"));
  assert.ok(r.includes.includes("audit_log"));
});

test("exportGDPRData: throws when userId is missing", () => {
  assert.throws(() => exportGDPRData(), /userId is required/);
});

// ================================================================
// 9. deleteUserData
// ================================================================

test("deleteUserData: deletes data with confirmation", () => {
  const r = deleteUserData({ userId: "user-del-1", confirm: true });
  assert.equal(r.deleted, true);
  assert.ok(r.data_removed.includes("profile"));
  assert.ok(r.data_removed.includes("projects"));
  assert.ok(r.backup_retained_until);
  const backupDate = new Date(r.backup_retained_until);
  assert.ok(backupDate > new Date());
});

test("deleteUserData: throws without confirmation", () => {
  assert.throws(
    () => deleteUserData({ userId: "user-del-2", confirm: false }),
    /confirm must be true/
  );
});

test("deleteUserData: throws when userId is missing", () => {
  assert.throws(() => deleteUserData({ confirm: true }), /userId is required/);
});

// ================================================================
// 10. getSecurityReport
// ================================================================

test("getSecurityReport: returns score and recommendations", () => {
  const r = getSecurityReport({ projectId: "proj-report-1" });
  assert.ok(typeof r.score === "number");
  assert.ok(r.score >= 0 && r.score <= 100);
  assert.ok(Array.isArray(r.vulnerabilities));
  assert.ok(Array.isArray(r.recommendations));
  assert.ok(r.compliance_status);
  assert.equal(r.compliance_status.gdpr, true);
});

test("getSecurityReport: fresh project has SSO vulnerability", () => {
  const before = getSecurityReport({ projectId: "proj-fresh-1" });
  assert.ok(before.vulnerabilities.includes("No SSO configured"));
  assert.ok(before.recommendations.some((r) => r.includes("SSO")));
});

test("getSecurityReport: throws when projectId is missing", () => {
  assert.throws(() => getSecurityReport(), /projectId is required/);
});

// ================================================================
// executeSecurityToolCall dispatcher
// ================================================================

test("executeSecurityToolCall: dispatches to correct function", async () => {
  const r = await executeSecurityToolCall("get_data_encryption", { projectId: "proj-dispatch" });
  assert.equal(r.at_rest, true);
});

test("executeSecurityToolCall: throws for unknown tool", async () => {
  await assert.rejects(() => executeSecurityToolCall("nonexistent_tool", {}), /Unknown security tool/);
});

// ================================================================
// Existing security primitives (regression coverage)
// ================================================================

test("filterByOwner: filters resources by owner", () => {
  const resources = [
    { id: "1", user_id: "alice" },
    { id: "2", user_id: "bob" },
    { id: "3", owner_id: "alice" },
  ];
  const result = filterByOwner(resources, "alice");
  assert.equal(result.length, 2);
  assert.ok(result.every((r) => r.user_id === "alice" || r.owner_id === "alice"));
});

test("isOwnedBy: checks ownership correctly", () => {
  assert.equal(isOwnedBy({ user_id: "a" }, "a"), true);
  assert.equal(isOwnedBy({ owner_id: "a" }, "a"), true);
  assert.equal(isOwnedBy({ user_id: "b" }, "a"), false);
  assert.equal(isOwnedBy(null, "a"), false);
});

test("findForeignIds: identifies non-owned IDs", () => {
  const foreign = findForeignIds(["1", "2", "3"], ["1", "3"]);
  assert.deepEqual(foreign, ["2"]);
});

test("withTimeout: resolves before timeout", async () => {
  const result = await withTimeout(Promise.resolve("ok"), 5000);
  assert.equal(result, "ok");
});

test("withTimeout: rejects on timeout", async () => {
  const slow = new Promise((resolve) => setTimeout(() => resolve("late"), 100));
  await assert.rejects(() => withTimeout(slow, 10, "test"), /test_timeout/);
});

test("getToolTimeoutMs: returns default for unknown tool", () => {
  const t = getToolTimeoutMs("unknown_tool_xyz");
  assert.equal(t, 30_000);
});

test("getToolTimeoutMs: returns known timeout for known tool", () => {
  const t = getToolTimeoutMs("cut_video");
  assert.equal(t, 120_000);
});

test("undoStore: record and pop work", () => {
  undoStore.clear("test-user");
  const id = undoStore.record("test-user", { tool: "delete_piece", args: { id: "p1" }, rollback: async () => {} });
  assert.ok(id);
  const entry = undoStore.pop("test-user");
  assert.equal(entry.tool, "delete_piece");
  assert.equal(undoStore.pop("test-user"), null);
});

test("confirmationStore: create and consume work", () => {
  const token = confirmationStore.create("u1", { tool: "delete_project", args: { id: "proj" } });
  assert.ok(token);
  const result = confirmationStore.consume("u1", token);
  assert.deepEqual(result, { tool: "delete_project", args: { id: "proj" } });
  // Consumed — second call returns null
  assert.equal(confirmationStore.consume("u1", token), null);
});

test("isDestructiveTool: identifies destructive tools", () => {
  assert.equal(isDestructiveTool("delete_project"), true);
  assert.equal(isDestructiveTool("delete_account"), true);
  assert.equal(isDestructiveTool("list_projects"), false);
});

test("getDestructiveTools: returns list of destructive tools", () => {
  const tools = getDestructiveTools();
  assert.ok(tools.includes("delete_project"));
  assert.ok(tools.includes("delete_account"));
  assert.ok(tools.length >= 4);
});
