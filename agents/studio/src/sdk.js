// sdk.js — Vireo Studio JavaScript SDK client.
//
// Provides a typed client for the Vireo Studio REST API with built-in
// retry (exponential backoff), request timeouts, and structured errors.

// =====================================================================
// VireoError
// =====================================================================

export class VireoError extends Error {
  /**
   * @param {string}  message  Human-readable error description
   * @param {number}  status   HTTP status code (0 for network errors)
   * @param {string}  [code]   Machine-readable error code from the API
   */
  constructor(message, status = 0, code = undefined) {
    super(message);
    this.name = "VireoError";
    this.status = status;
    this.code = code;
  }
}

// =====================================================================
// Helpers
// =====================================================================

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

/**
 * Sleep for `ms` milliseconds (resolves a promise).
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Build a query-string from a plain object, ignoring undefined/null values.
 */
function qs(params) {
  if (!params) return "";
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== null,
  );
  if (entries.length === 0) return "";
  return "?" + entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
}

// =====================================================================
// VireoClient
// =====================================================================

export class VireoClient {
  /**
   * @param {object} opts
   * @param {string} opts.baseUrl   Base URL of the Vireo Studio API (no trailing slash)
   * @param {string} [opts.apiKey]  API key sent as `Authorization: Bearer <key>`
   * @param {number} [opts.timeout] Request timeout in ms (default 30 000)
   * @param {number} [opts.maxRetries] Max retries on 5xx / network errors (default 3)
   */
  constructor({ baseUrl, apiKey, timeout = DEFAULT_TIMEOUT_MS, maxRetries = MAX_RETRIES } = {}) {
    if (!baseUrl) throw new VireoError("baseUrl is required", 0, "INVALID_CONFIG");
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.apiKey = apiKey || null;
    this.timeout = timeout;
    this.maxRetries = maxRetries;

    // Sub-resources ---------------------------------------------------
    this.videos = {
      create: (title, opts) => this._request("POST", "/api/videos", { title, ...opts }),
      list: (params) => this._request("GET", "/api/videos" + qs(params)),
      get: (id) => this._request("GET", `/api/videos/${encodeURIComponent(id)}`),
      update: (id, patch) => this._request("PATCH", `/api/videos/${encodeURIComponent(id)}`, patch),
      delete: (id) => this._request("DELETE", `/api/videos/${encodeURIComponent(id)}`),
      export: (id, opts) => this._request("POST", `/api/videos/${encodeURIComponent(id)}/export`, opts),
      analytics: (id, params) => this._request("GET", `/api/videos/${encodeURIComponent(id)}/analytics` + qs(params)),
    };

    this.publish = {
      toPlatform: (opts) => this._request("POST", "/api/publish", opts),
      status: (jobId) => this._request("GET", `/api/publish/${encodeURIComponent(jobId)}/status`),
    };

    this.chat = {
      send: (message, opts) => this._request("POST", "/api/chat", { message, ...opts }),
    };

    this.versions = {
      list: (videoId) => this._request("GET", `/api/videos/${encodeURIComponent(videoId)}/versions`),
      save: (videoId, name) => this._request("POST", `/api/videos/${encodeURIComponent(videoId)}/versions`, { name }),
    };

    this.comments = {
      add: (opts) => this._request("POST", "/api/comments", opts),
      list: (videoId) => this._request("GET", `/api/videos/${encodeURIComponent(videoId)}/comments`),
    };

    this.schedule = {
      create: (opts) => this._request("POST", "/api/schedule", opts),
      list: (params) => this._request("GET", "/api/schedule" + qs(params)),
    };

    this.health = {
      check: () => this._request("GET", "/health"),
    };
  }

  // -------------------------------------------------------------------
  // Internal request helper with retry + timeout
  // -------------------------------------------------------------------

  /**
   * @param {string}  method   HTTP method
   * @param {string}  path     Path appended to baseUrl
   * @param {object}  [body]   JSON body (skipped for GET/DELETE)
   * @param {number}  [attempt] Current attempt (0-based)
   * @returns {Promise<any>}   Parsed JSON response
   */
  async _request(method, path, body, attempt = 0) {
    const url = this.baseUrl + path;
    const headers = { "Content-Type": "application/json" };
    if (this.apiKey) headers["Authorization"] = `Bearer ${this.apiKey}`;

    const fetchOpts = { method, headers };
    if (body && method !== "GET" && method !== "DELETE") {
      fetchOpts.body = JSON.stringify(body);
    }

    // AbortController for timeout
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    fetchOpts.signal = controller.signal;

    try {
      const res = await fetch(url, fetchOpts);
      clearTimeout(timer);

      // Parse response
      let data;
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        data = await res.json();
      } else {
        data = await res.text();
      }

      if (!res.ok) {
        const errMsg = (data && typeof data === "object" && (data.error || data.message)) || `HTTP ${res.status}`;
        const errCode = (data && typeof data === "object" && data.code) || undefined;

        // Retry on 5xx
        if (res.status >= 500 && attempt < this.maxRetries) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt);
          await sleep(delay);
          return this._request(method, path, body, attempt + 1);
        }

        throw new VireoError(errMsg, res.status, errCode);
      }

      return data;
    } catch (err) {
      clearTimeout(timer);

      // Already a VireoError thrown above — rethrow
      if (err instanceof VireoError) throw err;

      // AbortError = timeout
      if (err.name === "AbortError") {
        if (attempt < this.maxRetries) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt);
          await sleep(delay);
          return this._request(method, path, body, attempt + 1);
        }
        throw new VireoError(`Request timed out after ${this.timeout}ms`, 0, "TIMEOUT");
      }

      // Network / other errors — retry
      if (attempt < this.maxRetries) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        await sleep(delay);
        return this._request(method, path, body, attempt + 1);
      }

      throw new VireoError(err.message || "Network error", 0, "NETWORK_ERROR");
    }
  }
}

export default VireoClient;
