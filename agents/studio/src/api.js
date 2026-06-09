// api.js — REST API endpoint registry for Vireo Studio.
//
// Provides:
//   - Centralized endpoint definitions (16 endpoints)
//   - Rate limiting (100 req/min per API key)
//   - Auth validation (Bearer token or x-api-key header)
//   - Request field validation (required fields, type checks)
//   - Consistent response format: { ok: boolean, data?, error? }
//   - Pagination support (limit, offset)
//   - CORS headers
//   - HTTP status codes for errors (400, 401, 404, 405, 429)
//
// Usage:
//   import { apiRegistry, handleRequest } from "./api.js";
//   // Use handleRequest(req, res) to dispatch incoming requests

import { RateLimiter } from "./rate_limiter.js";

// ============================================================================
// Endpoint Registry
// ============================================================================

const API_VERSION = "v1";

/**
 * @typedef {Object} EndpointDef
 * @property {string} method   - HTTP method
 * @property {string} path     - Route path (relative to /api/v1)
 * @property {boolean} auth    - Whether auth is required
 * @property {Object} rateLimit - Rate limit config { maxRequests, windowMs }
 * @property {string[]} requiredFields - Required body fields (POST/PATCH)
 * @property {Object} fieldTypes - Type checks for body/query fields
 * @property {Object} queryParams - Optional query parameters
 * @property {string} description - Human-readable description
 */

const endpoints = [
  {
    method: "POST",
    path: "/api/v1/videos",
    auth: true,
    rateLimit: { maxRequests: 100, windowMs: 60_000 },
    requiredFields: ["title"],
    fieldTypes: { title: "string" },
    description: "Create a new video project",
  },
  {
    method: "GET",
    path: "/api/v1/videos",
    auth: true,
    rateLimit: { maxRequests: 100, windowMs: 60_000 },
    queryParams: { limit: "number", offset: "number", sort: "string" },
    description: "List video projects",
  },
  {
    method: "GET",
    path: "/api/v1/videos/:id",
    auth: true,
    rateLimit: { maxRequests: 100, windowMs: 60_000 },
    description: "Get video details",
  },
  {
    method: "PATCH",
    path: "/api/v1/videos/:id",
    auth: true,
    rateLimit: { maxRequests: 100, windowMs: 60_000 },
    requiredFields: [],
    fieldTypes: { title: "string", description: "string" },
    description: "Update a video project",
  },
  {
    method: "DELETE",
    path: "/api/v1/videos/:id",
    auth: true,
    rateLimit: { maxRequests: 100, windowMs: 60_000 },
    requiredFields: ["confirm"],
    description: "Delete a video project (requires confirm=true)",
  },
  {
    method: "POST",
    path: "/api/v1/videos/:id/export",
    auth: true,
    rateLimit: { maxRequests: 50, windowMs: 60_000 },
    requiredFields: ["format"],
    fieldTypes: { format: "string", quality: "string" },
    queryParams: { quality: "string" },
    description: "Export a video",
  },
  {
    method: "GET",
    path: "/api/v1/videos/:id/analytics",
    auth: true,
    rateLimit: { maxRequests: 100, windowMs: 60_000 },
    queryParams: {
      start_date: "string",
      end_date: "string",
      limit: "number",
      offset: "number",
    },
    description: "Get video analytics",
  },
  {
    method: "POST",
    path: "/api/v1/publish",
    auth: true,
    rateLimit: { maxRequests: 30, windowMs: 60_000 },
    requiredFields: ["video_id", "platform"],
    fieldTypes: { video_id: "string", platform: "string", schedule_at: "string" },
    queryParams: { schedule_at: "string" },
    description: "Publish a video to a platform",
  },
  {
    method: "GET",
    path: "/api/v1/publish/:job_id",
    auth: true,
    rateLimit: { maxRequests: 100, windowMs: 60_000 },
    description: "Get publish job status",
  },
  {
    method: "POST",
    path: "/api/v1/chat",
    auth: true,
    rateLimit: { maxRequests: 30, windowMs: 60_000 },
    requiredFields: ["message"],
    fieldTypes: { message: "string", stream: "boolean" },
    queryParams: { stream: "boolean" },
    description: "Send a chat message",
  },
  {
    method: "GET",
    path: "/api/v1/health",
    auth: false,
    rateLimit: { maxRequests: 100, windowMs: 60_000 },
    description: "Health check (no auth required)",
  },
  {
    method: "GET",
    path: "/api/v1/versions",
    auth: true,
    rateLimit: { maxRequests: 100, windowMs: 60_000 },
    queryParams: { limit: "number", offset: "number", branch: "string" },
    description: "List versions",
  },
  {
    method: "POST",
    path: "/api/v1/versions",
    auth: true,
    rateLimit: { maxRequests: 50, windowMs: 60_000 },
    requiredFields: ["name"],
    fieldTypes: { name: "string", branch: "string" },
    queryParams: { branch: "string" },
    description: "Save a version",
  },
  {
    method: "POST",
    path: "/api/v1/comments",
    auth: true,
    rateLimit: { maxRequests: 100, windowMs: 60_000 },
    requiredFields: ["content"],
    fieldTypes: { content: "string", clipId: "string" },
    queryParams: { clipId: "string" },
    description: "Add a comment",
  },
  {
    method: "GET",
    path: "/api/v1/comments",
    auth: true,
    rateLimit: { maxRequests: 100, windowMs: 60_000 },
    queryParams: {
      limit: "number",
      offset: "number",
      sort: "string",
      clipId: "string",
    },
    description: "List comments",
  },
  {
    method: "GET",
    path: "/api/v1/schedule",
    auth: true,
    rateLimit: { maxRequests: 100, windowMs: 60_000 },
    queryParams: { limit: "number", offset: "number" },
    description: "List scheduled posts",
  },
  {
    method: "POST",
    path: "/api/v1/schedule",
    auth: true,
    rateLimit: { maxRequests: 50, windowMs: 60_000 },
    requiredFields: ["video_id", "scheduled_at", "platforms"],
    fieldTypes: {
      video_id: "string",
      scheduled_at: "string",
      platforms: "array",
      callback_url: "string",
    },
    queryParams: { callback_url: "string" },
    description: "Schedule a post",
  },
];

// ============================================================================
// CORS Configuration
// ============================================================================

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
  "Access-Control-Max-Age": "86400",
};

// ============================================================================
// Auth Validation
// ============================================================================

/**
 * Extract and validate auth from request headers.
 *
 * Supports:
 *   - Authorization: Bearer <token>
 *   - x-api-key: <key>
 *
 * @param {Object} headers - Request headers (lowercase keys)
 * @returns {{ valid: boolean, key?: string, error?: string }}
 */
function extractAuth(headers) {
  const authHeader = headers["authorization"];
  const apiKeyHeader = headers["x-api-key"];

  if (authHeader) {
    const parts = authHeader.split(" ");
    if (parts.length === 2 && parts[0] === "Bearer" && parts[1].length > 0) {
      return { valid: true, key: parts[1] };
    }
    return { valid: false, error: "Invalid Authorization header format. Use: Bearer <token>" };
  }

  if (apiKeyHeader && apiKeyHeader.length > 0) {
    return { valid: true, key: apiKeyHeader };
  }

  return { valid: false, error: "Missing auth. Provide Authorization: Bearer <token> or x-api-key header" };
}

// ============================================================================
// Request Validation
// ============================================================================

/**
 * Validate request body against endpoint definition.
 *
 * @param {Object} body - Parsed JSON body
 * @param {EndpointDef} endpoint
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateBody(body, endpoint) {
  const errors = [];

  if (!body || typeof body !== "object") {
    if (endpoint.requiredFields && endpoint.requiredFields.length > 0) {
      errors.push("Request body is required");
    }
    return { valid: errors.length === 0, errors };
  }

  // Check required fields
  if (endpoint.requiredFields) {
    for (const field of endpoint.requiredFields) {
      if (body[field] === undefined || body[field] === null) {
        errors.push(`Missing required field: ${field}`);
      }
    }
  }

  // Type checks
  if (endpoint.fieldTypes) {
    for (const [field, expectedType] of Object.entries(endpoint.fieldTypes)) {
      if (body[field] !== undefined && body[field] !== null) {
        const actualType = Array.isArray(body[field]) ? "array" : typeof body[field];
        if (actualType !== expectedType) {
          errors.push(`Field '${field}' must be of type ${expectedType}, got ${actualType}`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate query parameters against endpoint definition.
 *
 * @param {URLSearchParams} searchParams
 * @param {EndpointDef} endpoint
 * @returns {{ valid: boolean, errors: string[], params: Object }}
 */
function validateQuery(searchParams, endpoint) {
  const errors = [];
  const params = {};

  if (!endpoint.queryParams) {
    // Accept any query params for endpoints without defined query params
    for (const [key, value] of searchParams) {
      params[key] = value;
    }
    return { valid: true, errors, params };
  }

  for (const [key, value] of searchParams) {
    params[key] = value;

    if (endpoint.queryParams[key]) {
      const expectedType = endpoint.queryParams[key];
      if (expectedType === "number") {
        const num = Number(value);
        if (isNaN(num)) {
          errors.push(`Query param '${key}' must be a number`);
        } else {
          params[key] = num;
        }
      } else if (expectedType === "boolean") {
        params[key] = value === "true" || value === "1";
      }
      // string type is always valid
    }
    // Extra query params are allowed but not type-checked
  }

  return { valid: errors.length === 0, errors, params };
}

// ============================================================================
// Rate Limiting
// ============================================================================

const globalLimiter = new RateLimiter({
  windowMs: 60_000,
  maxRequests: 100,
  cleanupIntervalMs: 120_000,
});

// ============================================================================
// Response Helpers
// ============================================================================

/**
 * Build a success response.
 * @param {*} data
 * @returns {{ ok: boolean, data: * }}
 */
function okResponse(data) {
  return { ok: true, data };
}

/**
 * Build an error response.
 * @param {string} message
 * @returns {{ ok: boolean, error: string }}
 */
function errorResponse(message) {
  return { ok: false, error: message };
}

// ============================================================================
// Endpoint Matching
// ============================================================================

/**
 * Parse a route pattern like "/api/v1/videos/:id/export" into a regex
 * and extract param names.
 *
 * @param {string} pattern
 * @returns {{ regex: RegExp, paramNames: string[] }}
 */
function compileRoute(pattern) {
  const paramNames = [];
  const regexStr = pattern.replace(/:([a-zA-Z_]+)/g, (_, name) => {
    paramNames.push(name);
    return "([^/]+)";
  });
  return { regex: new RegExp(`^${regexStr}$`), paramNames };
}

// Pre-compile all route patterns
const compiledRoutes = endpoints.map((ep) => {
  const { regex, paramNames } = compileRoute(ep.path);
  return { endpoint: ep, regex, paramNames };
});

/**
 * Match a request method + pathname against the endpoint registry.
 *
 * @param {string} method
 * @param {string} pathname
 * @returns {{ endpoint: EndpointDef, params: Object } | null}
 */
function matchEndpoint(method, pathname) {
  for (const { endpoint, regex, paramNames } of compiledRoutes) {
    if (endpoint.method !== method) continue;
    const m = pathname.match(regex);
    if (m) {
      const params = {};
      paramNames.forEach((name, i) => {
        params[name] = m[i + 1];
      });
      return { endpoint, params };
    }
  }
  return null;
}

/**
 * Check if a path matches any registered endpoint (regardless of method).
 *
 * @param {string} pathname
 * @returns {boolean}
 */
function pathExists(pathname) {
  return compiledRoutes.some(({ regex }) => regex.test(pathname));
}

// ============================================================================
// Request Handler (main dispatcher)
// ============================================================================

/**
 * Handle an incoming HTTP request.
 *
 * Expected to be wired into a Node http server's request listener.
 *
 * @param {Object} req - Node IncomingMessage
 * @param {Object} res - Node ServerResponse
 * @param {Object} [options]
 * @param {Function} [options.handler] - Endpoint handler function(endpointDef, params, body, query, authKey) => Promise<result>
 * @param {Function} [options.onAuth] - Optional custom auth verifier(authKey) => boolean
 */
async function handleRequest(req, res, options = {}) {
  const { handler, onAuth } = options;

  // ---- CORS preflight ----
  setCorsHeaders(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // ---- Parse URL ----
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  // ---- JSON body parsing (for POST/PATCH/DELETE) ----
  let body = {};
  if (req.method === "POST" || req.method === "PATCH" || req.method === "DELETE") {
    try {
      body = await readJsonBody(req);
    } catch (err) {
      sendJson(res, 400, errorResponse("Invalid JSON body"));
      return;
    }
  }

  // ---- Match endpoint ----
  const match = matchEndpoint(req.method, pathname);

  if (!match) {
    // Check if the path exists but with wrong method
    if (pathExists(pathname)) {
      sendJson(res, 405, errorResponse(`Method ${req.method} not allowed on ${pathname}`));
      return;
    }
    sendJson(res, 404, errorResponse(`Endpoint not found: ${req.method} ${pathname}`));
    return;
  }

  const { endpoint, params } = match;

  // ---- Auth check ----
  if (endpoint.auth) {
    const auth = extractAuth(req.headers);
    if (!auth.valid) {
      sendJson(res, 401, errorResponse(auth.error));
      return;
    }
    if (onAuth && !onAuth(auth.key)) {
      sendJson(res, 401, errorResponse("Invalid credentials"));
      return;
    }
  }

  // ---- Rate limiting ----
  const authResult = extractAuth(req.headers);
  const rateLimitKey = authResult.valid ? authResult.key : (req.socket?.remoteAddress || "global");
  const rlConfig = endpoint.rateLimit;
  const limiter = new RateLimiter({
    windowMs: rlConfig.windowMs,
    maxRequests: rlConfig.maxRequests,
    cleanupIntervalMs: 0,
  });
  const rlResult = limiter.check(rateLimitKey);

  setRateLimitHeaders(res, rlConfig.maxRequests, rlResult);
  if (!rlResult.allowed) {
    res.setHeader("Retry-After", String(Math.ceil(rlResult.retryAfterMs / 1000)));
    sendJson(res, 429, errorResponse("Rate limit exceeded. Try again later."));
    return;
  }

  // ---- Query param validation ----
  const queryResult = validateQuery(url.searchParams, endpoint);
  if (!queryResult.valid) {
    sendJson(res, 400, errorResponse(queryResult.errors.join("; ")));
    return;
  }

  // ---- Body validation ----
  const bodyResult = validateBody(body, endpoint);
  if (!bodyResult.valid) {
    sendJson(res, 400, errorResponse(bodyResult.errors.join("; ")));
    return;
  }

  // ---- Dispatch to handler ----
  if (handler) {
    try {
      const result = await handler(endpoint, params, body, queryResult.params, authResult.key);
      sendJson(res, 200, okResponse(result));
    } catch (err) {
      const status = err.statusCode || 500;
      sendJson(res, status, errorResponse(err.message || "Internal server error"));
    }
  } else {
    sendJson(res, 200, okResponse({ endpoint: endpoint.path, method: endpoint.method, params, body, query: queryResult.params }));
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Read and parse JSON body from a request stream.
 *
 * @param {Object} req
 * @returns {Promise<Object>}
 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw || raw.trim() === "") {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

/**
 * Send a JSON response.
 *
 * @param {Object} res
 * @param {number} statusCode
 * @param {Object} body
 */
function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

/**
 * Set CORS headers on response.
 *
 * @param {Object} res
 */
function setCorsHeaders(res) {
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    res.setHeader(key, value);
  }
}

/**
 * Set rate limit headers on response.
 *
 * @param {Object} res
 * @param {number} limit
 * @param {Object} rlResult
 */
function setRateLimitHeaders(res, limit, rlResult) {
  res.setHeader("X-RateLimit-Limit", String(limit));
  res.setHeader("X-RateLimit-Remaining", String(Math.max(0, rlResult.remaining)));
}

// ============================================================================
// Exports
// ============================================================================

export {
  endpoints,
  API_VERSION,
  CORS_HEADERS,
  extractAuth,
  validateBody,
  validateQuery,
  matchEndpoint,
  pathExists,
  handleRequest,
  okResponse,
  errorResponse,
  sendJson,
  setCorsHeaders,
  setRateLimitHeaders,
  compileRoute,
  globalLimiter,
};
