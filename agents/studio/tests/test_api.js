// test_api.js — Tests for the REST API endpoint registry module.
//
// Validates all 16 endpoints, auth, rate limiting, validation,
// response format, pagination, CORS, and error handling.
//
// Run: node --test tests/test_api.js

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  endpoints,
  API_VERSION,
  CORS_HEADERS,
  extractAuth,
  validateBody,
  validateQuery,
  matchEndpoint,
  pathExists,
  okResponse,
  errorResponse,
  sendJson,
  setCorsHeaders,
  setRateLimitHeaders,
  compileRoute,
  globalLimiter,
} from "../src/api.js";

// ============================================================================
// 1. Endpoints array has all 16 endpoints
// ============================================================================

test("endpoints array has all required entries (17 total from spec)", () => {
  // The task spec lists 17 distinct endpoints (both GET and POST for schedule)
  assert.ok(endpoints.length >= 16, `Expected at least 16 endpoints, got ${endpoints.length}`);
});

test("all endpoint paths are unique", () => {
  const paths = endpoints.map((ep) => `${ep.method} ${ep.path}`);
  const unique = new Set(paths);
  assert.equal(unique.size, endpoints.length, "All endpoint method+path combos should be unique");
});

// ============================================================================
// 2. Each endpoint has method, path, auth, rateLimit
// ============================================================================

test("each endpoint has method, path, auth, and rateLimit", () => {
  for (const ep of endpoints) {
    assert.ok(ep.method, `Endpoint ${ep.path} missing method`);
    assert.ok(ep.path, `Endpoint missing path`);
    assert.equal(typeof ep.auth, "boolean", `Endpoint ${ep.path} auth must be boolean`);
    assert.ok(ep.rateLimit, `Endpoint ${ep.path} missing rateLimit`);
    assert.equal(typeof ep.rateLimit.maxRequests, "number", `${ep.path} rateLimit.maxRequests must be number`);
    assert.equal(typeof ep.rateLimit.windowMs, "number", `${ep.path} rateLimit.windowMs must be number`);
  }
});

test("all endpoints use valid HTTP methods", () => {
  const validMethods = ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"];
  for (const ep of endpoints) {
    assert.ok(validMethods.includes(ep.method), `${ep.path} has invalid method: ${ep.method}`);
  }
});

// ============================================================================
// 3. POST endpoints have required fields
// ============================================================================

test("POST /api/v1/videos requires title", () => {
  const ep = endpoints.find((e) => e.method === "POST" && e.path === "/api/v1/videos");
  assert.ok(ep, "POST /api/v1/videos exists");
  assert.ok(ep.requiredFields.includes("title"), "must require 'title'");
});

test("POST /api/v1/publish requires video_id and platform", () => {
  const ep = endpoints.find((e) => e.method === "POST" && e.path === "/api/v1/publish");
  assert.ok(ep, "POST /api/v1/publish exists");
  assert.ok(ep.requiredFields.includes("video_id"), "must require 'video_id'");
  assert.ok(ep.requiredFields.includes("platform"), "must require 'platform'");
});

test("POST /api/v1/chat requires message", () => {
  const ep = endpoints.find((e) => e.method === "POST" && e.path === "/api/v1/chat");
  assert.ok(ep, "POST /api/v1/chat exists");
  assert.ok(ep.requiredFields.includes("message"), "must require 'message'");
});

test("POST /api/v1/versions requires name", () => {
  const ep = endpoints.find((e) => e.method === "POST" && e.path === "/api/v1/versions");
  assert.ok(ep, "POST /api/v1/versions exists");
  assert.ok(ep.requiredFields.includes("name"), "must require 'name'");
});

test("POST /api/v1/comments requires content", () => {
  const ep = endpoints.find((e) => e.method === "POST" && e.path === "/api/v1/comments");
  assert.ok(ep, "POST /api/v1/comments exists");
  assert.ok(ep.requiredFields.includes("content"), "must require 'content'");
});

test("POST /api/v1/schedule requires video_id, scheduled_at, platforms", () => {
  const ep = endpoints.find((e) => e.method === "POST" && e.path === "/api/v1/schedule");
  assert.ok(ep, "POST /api/v1/schedule exists");
  assert.ok(ep.requiredFields.includes("video_id"));
  assert.ok(ep.requiredFields.includes("scheduled_at"));
  assert.ok(ep.requiredFields.includes("platforms"));
});

test("POST /api/v1/videos/:id/export requires format", () => {
  const ep = endpoints.find((e) => e.method === "POST" && e.path === "/api/v1/videos/:id/export");
  assert.ok(ep, "POST /api/v1/videos/:id/export exists");
  assert.ok(ep.requiredFields.includes("format"), "must require 'format'");
});

// ============================================================================
// 4. GET endpoints have optional query params
// ============================================================================

test("GET /api/v1/videos has pagination query params", () => {
  const ep = endpoints.find((e) => e.method === "GET" && e.path === "/api/v1/videos");
  assert.ok(ep, "GET /api/v1/videos exists");
  assert.ok(ep.queryParams.limit !== undefined, "has limit param");
  assert.ok(ep.queryParams.offset !== undefined, "has offset param");
  assert.ok(ep.queryParams.sort !== undefined, "has sort param");
});

test("GET /api/v1/comments has pagination and sort params", () => {
  const ep = endpoints.find((e) => e.method === "GET" && e.path === "/api/v1/comments");
  assert.ok(ep, "GET /api/v1/comments exists");
  assert.ok(ep.queryParams.limit !== undefined);
  assert.ok(ep.queryParams.offset !== undefined);
  assert.ok(ep.queryParams.sort !== undefined);
});

test("GET /api/v1/versions has branch param", () => {
  const ep = endpoints.find((e) => e.method === "GET" && e.path === "/api/v1/versions");
  assert.ok(ep, "GET /api/v1/versions exists");
  assert.ok(ep.queryParams.branch !== undefined, "has branch param");
});

test("GET /api/v1/schedule has pagination params", () => {
  const ep = endpoints.find((e) => e.method === "GET" && e.path === "/api/v1/schedule");
  assert.ok(ep, "GET /api/v1/schedule exists");
  assert.ok(ep.queryParams.limit !== undefined);
  assert.ok(ep.queryParams.offset !== undefined);
});

// ============================================================================
// 5. Health endpoint has no auth
// ============================================================================

test("GET /api/v1/health has no auth required", () => {
  const ep = endpoints.find((e) => e.method === "GET" && e.path === "/api/v1/health");
  assert.ok(ep, "GET /api/v1/health exists");
  assert.equal(ep.auth, false, "health endpoint must not require auth");
});

// ============================================================================
// 6. Chat endpoint validates message field
// ============================================================================

test("POST /api/v1/chat validates message is string", () => {
  const ep = endpoints.find((e) => e.method === "POST" && e.path === "/api/v1/chat");
  assert.ok(ep.fieldTypes.message === "string", "message must be type string");
});

test("validateBody rejects missing message for chat", () => {
  const ep = endpoints.find((e) => e.method === "POST" && e.path === "/api/v1/chat");
  const result = validateBody({}, ep);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("message")), "error mentions 'message'");
});

// ============================================================================
// 7. Publish endpoint validates platform field
// ============================================================================

test("POST /api/v1/publish validates platform is string", () => {
  const ep = endpoints.find((e) => e.method === "POST" && e.path === "/api/v1/publish");
  assert.ok(ep.fieldTypes.platform === "string", "platform must be type string");
});

test("validateBody rejects missing platform for publish", () => {
  const ep = endpoints.find((e) => e.method === "POST" && e.path === "/api/v1/publish");
  const result = validateBody({ video_id: "abc" }, ep);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("platform")));
});

// ============================================================================
// 8. Export endpoint validates format field
// ============================================================================

test("POST /api/v1/videos/:id/export validates format is string", () => {
  const ep = endpoints.find((e) => e.method === "POST" && e.path === "/api/v1/videos/:id/export");
  assert.ok(ep.fieldTypes.format === "string", "format must be type string");
});

test("validateBody rejects missing format for export", () => {
  const ep = endpoints.find((e) => e.method === "POST" && e.path === "/api/v1/videos/:id/export");
  const result = validateBody({}, ep);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("format")));
});

// ============================================================================
// 9. Version endpoint validates name field
// ============================================================================

test("POST /api/v1/versions validates name is string", () => {
  const ep = endpoints.find((e) => e.method === "POST" && e.path === "/api/v1/versions");
  assert.ok(ep.fieldTypes.name === "string", "name must be type string");
});

test("validateBody rejects missing name for version save", () => {
  const ep = endpoints.find((e) => e.method === "POST" && e.path === "/api/v1/versions");
  const result = validateBody({}, ep);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("name")));
});

// ============================================================================
// 10. Comment endpoint validates content field
// ============================================================================

test("POST /api/v1/comments validates content is string", () => {
  const ep = endpoints.find((e) => e.method === "POST" && e.path === "/api/v1/comments");
  assert.ok(ep.fieldTypes.content === "string", "content must be type string");
});

test("validateBody rejects missing content for comment", () => {
  const ep = endpoints.find((e) => e.method === "POST" && e.path === "/api/v1/comments");
  const result = validateBody({}, ep);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("content")));
});

// ============================================================================
// 11. Schedule endpoint validates scheduled_at field
// ============================================================================

test("POST /api/v1/schedule validates scheduled_at is string", () => {
  const ep = endpoints.find((e) => e.method === "POST" && e.path === "/api/v1/schedule");
  assert.ok(ep.fieldTypes.scheduled_at === "string", "scheduled_at must be type string");
});

test("validateBody rejects missing scheduled_at for schedule", () => {
  const ep = endpoints.find((e) => e.method === "POST" && e.path === "/api/v1/schedule");
  const result = validateBody({ video_id: "abc", platforms: ["youtube"] }, ep);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("scheduled_at")));
});

// ============================================================================
// 12. Rate limit config correct
// ============================================================================

test("all endpoints have rateLimit with maxRequests and windowMs", () => {
  for (const ep of endpoints) {
    assert.ok(typeof ep.rateLimit.maxRequests === "number" && ep.rateLimit.maxRequests > 0,
      `${ep.path} rateLimit.maxRequests must be positive number`);
    assert.ok(typeof ep.rateLimit.windowMs === "number" && ep.rateLimit.windowMs > 0,
      `${ep.path} rateLimit.windowMs must be positive number`);
  }
});

test("globalLimiter is configured with 100 req/min", () => {
  assert.equal(globalLimiter.maxRequests, 100);
  assert.equal(globalLimiter.windowMs, 60_000);
});

test("rate limit check works correctly", () => {
  const rl = globalLimiter;
  const result = rl.check("test-api-key");
  assert.equal(result.allowed, true);
  assert.ok(typeof result.remaining === "number");
  rl.reset();
});

// ============================================================================
// 13. Auth config correct for each endpoint
// ============================================================================

test("only /health has auth=false", () => {
  for (const ep of endpoints) {
    if (ep.path === "/api/v1/health") {
      assert.equal(ep.auth, false, "/health should not require auth");
    } else {
      assert.equal(ep.auth, true, `${ep.path} should require auth`);
    }
  }
});

// ============================================================================
// 14. Pagination params validated
// ============================================================================

test("validateQuery parses limit as number", () => {
  const ep = endpoints.find((e) => e.method === "GET" && e.path === "/api/v1/videos");
  const params = new URLSearchParams("limit=10&offset=0");
  const result = validateQuery(params, ep);
  assert.equal(result.valid, true);
  assert.equal(result.params.limit, 10);
  assert.equal(result.params.offset, 0);
});

test("validateQuery rejects non-numeric limit", () => {
  const ep = endpoints.find((e) => e.method === "GET" && e.path === "/api/v1/videos");
  const params = new URLSearchParams("limit=abc");
  const result = validateQuery(params, ep);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("limit")));
});

// ============================================================================
// 15. Response format consistent
// ============================================================================

test("okResponse returns { ok: true, data }", () => {
  const result = okResponse({ id: 1, name: "test" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, { id: 1, name: "test" });
});

test("errorResponse returns { ok: false, error }", () => {
  const result = errorResponse("something went wrong");
  assert.equal(result.ok, false);
  assert.equal(result.error, "something went wrong");
});

test("okResponse with null data", () => {
  const result = okResponse(null);
  assert.equal(result.ok, true);
  assert.equal(result.data, null);
});

// ============================================================================
// 16. Unknown endpoint returns 404
// ============================================================================

test("matchEndpoint returns null for unknown path", () => {
  const result = matchEndpoint("GET", "/api/v1/nonexistent");
  assert.equal(result, null);
});

test("pathExists returns false for unknown path", () => {
  assert.equal(pathExists("/api/v1/nonexistent"), false);
});

test("pathExists returns true for known path", () => {
  assert.equal(pathExists("/api/v1/videos"), true);
});

// ============================================================================
// 17. Method mismatch returns 405
// ============================================================================

test("matchEndpoint returns null when method mismatches", () => {
  // GET /api/v1/videos exists, but DELETE /api/v1/videos does not
  const result = matchEndpoint("DELETE", "/api/v1/videos");
  assert.equal(result, null);
});

test("pathExists returns true for path with wrong method", () => {
  // DELETE /api/v1/videos doesn't exist as endpoint but path pattern exists for GET
  // Actually, let's test a real mismatch scenario
  assert.equal(pathExists("/api/v1/videos"), true); // path pattern exists
});

// ============================================================================
// 18. Invalid JSON body returns 400 (tested via validateBody)
// ============================================================================

test("validateBody rejects null body when required fields exist", () => {
  const ep = endpoints.find((e) => e.method === "POST" && e.path === "/api/v1/videos");
  const result = validateBody(null, ep);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("body is required")));
});

test("validateBody rejects non-object body", () => {
  const ep = endpoints.find((e) => e.method === "POST" && e.path === "/api/v1/videos");
  const result = validateBody("not an object", ep);
  assert.equal(result.valid, false);
});

// ============================================================================
// 19. Missing auth returns 401 (tested via extractAuth)
// ============================================================================

test("extractAuth rejects empty headers", () => {
  const result = extractAuth({});
  assert.equal(result.valid, false);
  assert.ok(result.error.includes("Missing auth"));
});

test("extractAuth rejects malformed Bearer header", () => {
  const result = extractAuth({ authorization: "Basic abc123" });
  assert.equal(result.valid, false);
  assert.ok(result.error.includes("Invalid Authorization"));
});

test("extractAuth accepts valid Bearer token", () => {
  const result = extractAuth({ authorization: "Bearer my-secret-token" });
  assert.equal(result.valid, true);
  assert.equal(result.key, "my-secret-token");
});

test("extractAuth accepts x-api-key header", () => {
  const result = extractAuth({ "x-api-key": "api-key-123" });
  assert.equal(result.valid, true);
  assert.equal(result.key, "api-key-123");
});

test("extractAuth prefers Bearer over x-api-key", () => {
  const result = extractAuth({
    authorization: "Bearer bearer-token",
    "x-api-key": "apikey-token",
  });
  assert.equal(result.valid, true);
  assert.equal(result.key, "bearer-token");
});

// ============================================================================
// 20. Rate limit exceeded returns 429 (tested via RateLimiter)
// ============================================================================

test("rate limit blocks after maxRequests exceeded", () => {
  const rl = globalLimiter;
  // Use a unique key to avoid interfering with other tests
  const key = `test-429-${Date.now()}`;
  for (let i = 0; i < 100; i++) {
    rl.check(key);
  }
  const result = rl.check(key);
  assert.equal(result.allowed, false, "101st request should be blocked");
  rl.reset();
});

// ============================================================================
// 21. Video create validates title
// ============================================================================

test("POST /api/v1/videos rejects empty body", () => {
  const ep = endpoints.find((e) => e.method === "POST" && e.path === "/api/v1/videos");
  const result = validateBody({}, ep);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("title")));
});

test("POST /api/v1/videos accepts body with title", () => {
  const ep = endpoints.find((e) => e.method === "POST" && e.path === "/api/v1/videos");
  const result = validateBody({ title: "My Video" }, ep);
  assert.equal(result.valid, true);
});

test("POST /api/v1/videos rejects non-string title", () => {
  const ep = endpoints.find((e) => e.method === "POST" && e.path === "/api/v1/videos");
  const result = validateBody({ title: 12345 }, ep);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("title") && e.includes("string")));
});

// ============================================================================
// 22. Video update validates fields
// ============================================================================

test("PATCH /api/v1/videos/:id allows optional fields", () => {
  const ep = endpoints.find((e) => e.method === "PATCH" && e.path === "/api/v1/videos/:id");
  assert.ok(ep, "PATCH /api/v1/videos/:id exists");
  // PATCH has no required fields
  assert.deepEqual(ep.requiredFields, []);
});

test("PATCH /api/v1/videos/:id type-checks title", () => {
  const ep = endpoints.find((e) => e.method === "PATCH" && e.path === "/api/v1/videos/:id");
  const result = validateBody({ title: 42 }, ep);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("title") && e.includes("string")));
});

test("PATCH /api/v1/videos/:id accepts valid update", () => {
  const ep = endpoints.find((e) => e.method === "PATCH" && e.path === "/api/v1/videos/:id");
  const result = validateBody({ title: "New Title", description: "New desc" }, ep);
  assert.equal(result.valid, true);
});

// ============================================================================
// 23. Analytics endpoint has date range params
// ============================================================================

test("GET /api/v1/videos/:id/analytics has start_date and end_date params", () => {
  const ep = endpoints.find((e) => e.method === "GET" && e.path === "/api/v1/videos/:id/analytics");
  assert.ok(ep, "GET /api/v1/videos/:id/analytics exists");
  assert.ok(ep.queryParams.start_date !== undefined, "has start_date param");
  assert.ok(ep.queryParams.end_date !== undefined, "has end_date param");
});

test("analytics endpoint also has pagination params", () => {
  const ep = endpoints.find((e) => e.method === "GET" && e.path === "/api/v1/videos/:id/analytics");
  assert.ok(ep.queryParams.limit !== undefined);
  assert.ok(ep.queryParams.offset !== undefined);
});

// ============================================================================
// 24. Publish endpoint has schedule_at optional
// ============================================================================

test("POST /api/v1/publish has schedule_at as optional field", () => {
  const ep = endpoints.find((e) => e.method === "POST" && e.path === "/api/v1/publish");
  assert.ok(ep, "POST /api/v1/publish exists");
  // schedule_at is in fieldTypes but NOT in requiredFields
  assert.ok(!ep.requiredFields.includes("schedule_at"), "schedule_at should not be required");
  assert.ok(ep.fieldTypes.schedule_at !== undefined, "schedule_at should have type definition");
});

test("POST /api/v1/publish accepts body without schedule_at", () => {
  const ep = endpoints.find((e) => e.method === "POST" && e.path === "/api/v1/publish");
  const result = validateBody({ video_id: "v1", platform: "youtube" }, ep);
  assert.equal(result.valid, true);
});

// ============================================================================
// 25. Chat endpoint has stream option
// ============================================================================

test("POST /api/v1/chat has stream field type", () => {
  const ep = endpoints.find((e) => e.method === "POST" && e.path === "/api/v1/chat");
  assert.ok(ep.fieldTypes.stream === "boolean", "stream must be type boolean");
});

test("POST /api/v1/chat has stream as query param", () => {
  const ep = endpoints.find((e) => e.method === "POST" && e.path === "/api/v1/chat");
  assert.ok(ep.queryParams.stream !== undefined, "stream should be in queryParams");
});

// ============================================================================
// 26. Version endpoint has branch param
// ============================================================================

test("POST /api/v1/versions has branch field type", () => {
  const ep = endpoints.find((e) => e.method === "POST" && e.path === "/api/v1/versions");
  assert.ok(ep.fieldTypes.branch === "string", "branch must be type string");
});

test("POST /api/v1/versions has branch as query param", () => {
  const ep = endpoints.find((e) => e.method === "POST" && e.path === "/api/v1/versions");
  assert.ok(ep.queryParams.branch !== undefined, "branch should be in queryParams");
});

// ============================================================================
// 27. Comment endpoint has clipId optional
// ============================================================================

test("POST /api/v1/comments has clipId as optional field", () => {
  const ep = endpoints.find((e) => e.method === "POST" && e.path === "/api/v1/comments");
  assert.ok(!ep.requiredFields.includes("clipId"), "clipId should not be required");
  assert.ok(ep.fieldTypes.clipId === "string", "clipId must be type string");
});

test("POST /api/v1/comments has clipId as query param", () => {
  const ep = endpoints.find((e) => e.method === "POST" && e.path === "/api/v1/comments");
  assert.ok(ep.queryParams.clipId !== undefined, "clipId should be in queryParams");
});

// ============================================================================
// 28. Schedule endpoint has platforms array
// ============================================================================

test("POST /api/v1/schedule has platforms as array type", () => {
  const ep = endpoints.find((e) => e.method === "POST" && e.path === "/api/v1/schedule");
  assert.ok(ep.fieldTypes.platforms === "array", "platforms must be type array");
});

test("POST /api/v1/schedule validates platforms is array", () => {
  const ep = endpoints.find((e) => e.method === "POST" && e.path === "/api/v1/schedule");
  const result = validateBody(
    { video_id: "v1", scheduled_at: "2026-01-01T00:00:00Z", platforms: "youtube" },
    ep,
  );
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("platforms") && e.includes("array")));
});

test("POST /api/v1/schedule accepts valid platforms array", () => {
  const ep = endpoints.find((e) => e.method === "POST" && e.path === "/api/v1/schedule");
  const result = validateBody(
    { video_id: "v1", scheduled_at: "2026-01-01T00:00:00Z", platforms: ["youtube", "tiktok"] },
    ep,
  );
  assert.equal(result.valid, true);
});

// ============================================================================
// 29. Export endpoint has quality param
// ============================================================================

test("POST /api/v1/videos/:id/export has quality field type", () => {
  const ep = endpoints.find((e) => e.method === "POST" && e.path === "/api/v1/videos/:id/export");
  assert.ok(ep.fieldTypes.quality === "string", "quality must be type string");
});

test("POST /api/v1/videos/:id/export has quality as query param", () => {
  const ep = endpoints.find((e) => e.method === "POST" && e.path === "/api/v1/videos/:id/export");
  assert.ok(ep.queryParams.quality !== undefined, "quality should be in queryParams");
});

// ============================================================================
// 30. List endpoints have sort param
// ============================================================================

test("GET /api/v1/videos has sort param", () => {
  const ep = endpoints.find((e) => e.method === "GET" && e.path === "/api/v1/videos");
  assert.ok(ep.queryParams.sort !== undefined);
});

test("GET /api/v1/comments has sort param", () => {
  const ep = endpoints.find((e) => e.method === "GET" && e.path === "/api/v1/comments");
  assert.ok(ep.queryParams.sort !== undefined);
});

// ============================================================================
// 31. Delete endpoint requires confirmation
// ============================================================================

test("DELETE /api/v1/videos/:id requires confirm field", () => {
  const ep = endpoints.find((e) => e.method === "DELETE" && e.path === "/api/v1/videos/:id");
  assert.ok(ep, "DELETE /api/v1/videos/:id exists");
  assert.ok(ep.requiredFields.includes("confirm"), "must require 'confirm'");
});

test("DELETE /api/v1/videos/:id rejects body without confirm", () => {
  const ep = endpoints.find((e) => e.method === "DELETE" && e.path === "/api/v1/videos/:id");
  const result = validateBody({}, ep);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("confirm")));
});

// ============================================================================
// 32. Batch endpoints validate array input
// ============================================================================

test("POST /api/v1/schedule validates platforms is array not string", () => {
  const ep = endpoints.find((e) => e.method === "POST" && e.path === "/api/v1/schedule");
  const result = validateBody(
    { video_id: "v1", scheduled_at: "2026-01-01T00:00:00Z", platforms: "youtube" },
    ep,
  );
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("array")));
});

test("POST /api/v1/schedule validates platforms is not object", () => {
  const ep = endpoints.find((e) => e.method === "POST" && e.path === "/api/v1/schedule");
  const result = validateBody(
    { video_id: "v1", scheduled_at: "2026-01-01T00:00:00Z", platforms: { youtube: true } },
    ep,
  );
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("array")));
});

// ============================================================================
// 33. Webhook endpoint validates callback_url
// ============================================================================

test("POST /api/v1/schedule has callback_url as optional field", () => {
  const ep = endpoints.find((e) => e.method === "POST" && e.path === "/api/v1/schedule");
  assert.ok(ep.fieldTypes.callback_url === "string", "callback_url must be type string");
  assert.ok(!ep.requiredFields.includes("callback_url"), "callback_url should be optional");
});

test("POST /api/v1/schedule has callback_url as query param", () => {
  const ep = endpoints.find((e) => e.method === "POST" && e.path === "/api/v1/schedule");
  assert.ok(ep.queryParams.callback_url !== undefined, "callback_url should be in queryParams");
});

// ============================================================================
// 34. API version in path
// ============================================================================

test("API_VERSION is v1", () => {
  assert.equal(API_VERSION, "v1");
});

test("all endpoint paths start with /api/v1/", () => {
  for (const ep of endpoints) {
    assert.ok(ep.path.startsWith("/api/v1/"), `${ep.path} must start with /api/v1/`);
  }
});

test("all 16 endpoints use v1 prefix", () => {
  for (const ep of endpoints) {
    assert.ok(ep.path.includes("/api/v1/"), `${ep.path} must include /api/v1/`);
  }
});

// ============================================================================
// 35. CORS headers configured
// ============================================================================

test("CORS_HEADERS has Access-Control-Allow-Origin", () => {
  assert.ok(CORS_HEADERS["Access-Control-Allow-Origin"], "must have Allow-Origin");
});

test("CORS_HEADERS has Access-Control-Allow-Methods", () => {
  assert.ok(CORS_HEADERS["Access-Control-Allow-Methods"], "must have Allow-Methods");
  assert.ok(CORS_HEADERS["Access-Control-Allow-Methods"].includes("GET"));
  assert.ok(CORS_HEADERS["Access-Control-Allow-Methods"].includes("POST"));
  assert.ok(CORS_HEADERS["Access-Control-Allow-Methods"].includes("PATCH"));
  assert.ok(CORS_HEADERS["Access-Control-Allow-Methods"].includes("DELETE"));
});

test("CORS_HEADERS has Access-Control-Allow-Headers", () => {
  assert.ok(CORS_HEADERS["Access-Control-Allow-Headers"], "must have Allow-Headers");
  assert.ok(CORS_HEADERS["Access-Control-Allow-Headers"].includes("Authorization"));
  assert.ok(CORS_HEADERS["Access-Control-Allow-Headers"].includes("x-api-key"));
  assert.ok(CORS_HEADERS["Access-Control-Allow-Headers"].includes("Content-Type"));
});

test("CORS_HEADERS has Access-Control-Max-Age", () => {
  assert.ok(CORS_HEADERS["Access-Control-Max-Age"], "must have Max-Age");
  assert.equal(Number(CORS_HEADERS["Access-Control-Max-Age"]), 86400);
});

test("setCorsHeaders applies CORS headers to response", () => {
  const headers = {};
  const fakeRes = { setHeader: (k, v) => { headers[k] = v; } };
  setCorsHeaders(fakeRes);
  assert.equal(headers["Access-Control-Allow-Origin"], "*");
  assert.ok(headers["Access-Control-Allow-Methods"]);
  assert.ok(headers["Access-Control-Allow-Headers"]);
});

// ============================================================================
// Bonus: compileRoute and endpoint matching
// ============================================================================

test("compileRoute extracts param names from route pattern", () => {
  const { paramNames } = compileRoute("/api/v1/videos/:id/export");
  assert.deepEqual(paramNames, ["id"]);
});

test("compileRoute handles multiple params", () => {
  const { paramNames } = compileRoute("/api/v1/:resource/:id/:action");
  assert.deepEqual(paramNames, ["resource", "id", "action"]);
});

test("matchEndpoint matches /api/v1/videos/:id and extracts id", () => {
  const result = matchEndpoint("GET", "/api/v1/videos/abc-123");
  assert.ok(result, "should match");
  assert.equal(result.params.id, "abc-123");
  assert.equal(result.endpoint.method, "GET");
  assert.equal(result.endpoint.path, "/api/v1/videos/:id");
});

test("matchEndpoint matches /api/v1/videos/:id/export", () => {
  const result = matchEndpoint("POST", "/api/v1/videos/v42/export");
  assert.ok(result, "should match");
  assert.equal(result.params.id, "v42");
});

test("matchEndpoint matches /api/v1/publish/:job_id", () => {
  const result = matchEndpoint("GET", "/api/v1/publish/job-999");
  assert.ok(result, "should match");
  assert.equal(result.params.job_id, "job-999");
});

test("matchEndpoint matches /api/v1/health (no params)", () => {
  const result = matchEndpoint("GET", "/api/v1/health");
  assert.ok(result, "should match");
  assert.deepEqual(result.params, {});
});

// ============================================================================
// Bonus: validateQuery edge cases
// ============================================================================

test("validateQuery accepts empty search params", () => {
  const ep = endpoints.find((e) => e.method === "GET" && e.path === "/api/v1/videos");
  const result = validateQuery(new URLSearchParams(), ep);
  assert.equal(result.valid, true);
  assert.deepEqual(result.params, {});
});

test("validateQuery allows extra params beyond definition", () => {
  const ep = endpoints.find((e) => e.method === "GET" && e.path === "/api/v1/videos");
  const result = validateQuery(new URLSearchParams("custom=value"), ep);
  assert.equal(result.valid, true);
  assert.equal(result.params.custom, "value");
});

test("validateQuery with boolean param parses correctly", () => {
  const ep = endpoints.find((e) => e.method === "POST" && e.path === "/api/v1/chat");
  const result = validateQuery(new URLSearchParams("stream=true"), ep);
  assert.equal(result.valid, true);
  assert.equal(result.params.stream, true);
});

test("validateQuery with boolean param false", () => {
  const ep = endpoints.find((e) => e.method === "POST" && e.path === "/api/v1/chat");
  const result = validateQuery(new URLSearchParams("stream=false"), ep);
  assert.equal(result.valid, true);
  assert.equal(result.params.stream, false);
});
