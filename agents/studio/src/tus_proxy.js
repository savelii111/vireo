// Vireo Studio — TUS 1.0 protocol proxy to the video agent.
//
// Week 1 Day 1 (2026-06-07): the dashboard needs multi-GB resumable uploads
// but we don't want to expose the video agent port to the browser. We proxy
// through Studio. The video agent already implements TUS 1.0 at /upload/resumable
// (430 LOC of protocol handling in agents/video/vireo_video/tus.py) — this
// module just bridges HTTP from Studio to the agent.
//
// TUS 1.0 spec: https://tus.io/protocols/resumable-upload
//
//  HEAD    /upload/resumable/<id>   → check upload progress
//  PATCH   /upload/resumable/<id>   → upload a chunk
//  POST    /upload/resumable         → create a new session (Upload-Length required)
//  DELETE  /upload/resumable/<id>   → abort a session
//  OPTIONS /upload/resumable         → CORS preflight + TUS capability discovery
//
// We preserve TUS headers verbatim. We do NOT inspect the body bytes — they
// are streamed through, 8 MB at a time, backpressure handled by Node's
// Stream.pipe semantics.

import { request as httpRequest } from "node:http";

/**
 * Resolve the video-agent base URL at request time, not module load.
 *
 * Reading process.env at module init would freeze the value at first
 * import, which breaks tests that swap VIREO_VIDEO_URL between cases.
 */
function videoBaseUrl() {
  const raw = process.env.VIREO_VIDEO_URL || "http://video:8004";
  return raw.replace(/\/+$/, "");
}

/**
 * Headers that must be passed through unchanged between client and upstream
 * (TUS protocol + a few HTTP transport headers).
 *
 * Auth (Cookie, Authorization) and CSRF are intentionally excluded — the
 * dashboard uses a different auth scheme than the agent and we don't want
 * to leak the agent's session cookie to the browser.
 */
export const TUS_PASSTHROUGH_HEADERS = [
  "upload-length", "upload-offset", "upload-metadata",
  "content-range", "content-type", "tus-resumable",
];

/**
 * Append a base64-encoded user_id key to a TUS Upload-Metadata header value
 * (TUS 1.0 §3.2.1 — Metadata is a comma-separated list of `key value` pairs,
 * where value is base64-encoded). On the agent side, this lets us attribute
 * ownership of an upload to a user without a separate database lookup.
 *
 * Returns the original metadata unchanged if userId is null/undefined.
 */
export function stampUserIdInMetadata(metadataValue, userId) {
  if (!userId) return metadataValue;
  const userKey = "user_id";
  const userVal = Buffer.from(String(userId), "utf8").toString("base64");
  if (!metadataValue) return `${userKey} ${userVal}`;
  return metadataValue + "," + userKey + " " + userVal;
}

/**
 * Proxy a single TUS request from `req` (Studio client) to the video agent
 * and stream the response back. Returns void; handles the response lifecycle
 * internally. On upstream error, returns 502 with a JSON body.
 *
 * @param {import("node:http").IncomingMessage} req - Client request (already routed)
 * @param {import("node:http").ServerResponse} res - Client response
 * @param {Record<string, string>} passthroughHeaders - TUS headers from client
 * @param {string|null} sessionId - Resumable upload session id, or null for POST
 * @param {string|null} userId - Authenticated user id, for logging + metadata
 * @returns {void}
 *
 * Known issue (Week 1 Day 1, see Day 5 bug-bash):
 *   HEAD/DELETE with no body races with the underlying socket. Direct
 *   tests on these verbs sometimes hang up. POST/PATCH with body work.
 *   Workaround: client retries HEAD with backoff. Fix: switch to
 *   undici/fetch in Day 2 refactor.
 */
export function proxyTusRequest(req, res, passthroughHeaders, sessionId, userId) {
  const targetPath = `/upload/resumable${sessionId ? "/" + encodeURIComponent(sessionId) : ""}`;
  const target = `${videoBaseUrl()}${targetPath}`;
  const upstreamReq = httpRequest(target, {
    method: req.method,
    headers: passthroughHeaders,
  }, (upstreamRes) => {
    // Forward upstream status and headers verbatim — TUS protocol requires
    // exact header echo (e.g. Upload-Offset, Location on POST 201).
    res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
    upstreamRes.pipe(res);
  });
  upstreamReq.on("error", (e) => {
    console.error(`[studio] TUS proxy error (${req.method} ${target}):`, e?.message || e);
    if (!res.headersSent) {
      try {
        res.writeHead(502, { "content-type": "application/json" });
      } catch (_) { /* socket closed before we could write */ }
    }
    try {
      res.end(JSON.stringify({
        error: "tus_upstream_unreachable",
        detail: String(e?.message || e),
        userId,
      }));
    } catch (_) { /* socket may be closed */ }
  });
  // Client disconnected mid-upload? Abort the upstream request so we don't
  // silently consume its chunk and bill storage for a half-uploaded file.
  req.on("close", () => {
    if (!upstreamReq.destroyed) upstreamReq.destroy();
  });
  req.on("error", (e) => {
    if (!upstreamReq.destroyed) upstreamReq.destroy(e);
  });
  // Stream body (if any) to upstream. We collect data/end events from req
  // and forward to upstreamReq. We deliberately do NOT use req.pipe() because
  // pipe() couples the readable's lifecycle to the writable's `finish` event
  // in ways that interact poorly with proxy error handling — manual
  // forwarding lets us treat upstream errors and client disconnects cleanly.
  //
  // Empty-body workaround (Day 1): when req has no body and fires 'end'
  // before the upstream socket is bound, calling upstreamReq.end() in 'end'
  // races with httpRequest's internal write queue and the upstream hangs up.
  // Writing a 0-byte chunk BEFORE end() forces the request headers onto
  // the wire as soon as the socket binds, which is what the upstream needs
  // to see a complete request. Cost: one extra syscall per empty-body verb.
  let dataSeen = false;
  req.on("data", (chunk) => {
    dataSeen = true;
    if (!upstreamReq.destroyed && !upstreamReq.writableEnded) {
      upstreamReq.write(chunk);
    }
  });
  req.on("end", () => {
    if (!upstreamReq.destroyed && !upstreamReq.writableEnded) {
      if (!dataSeen) {
        try { upstreamReq.write(Buffer.alloc(0)); } catch (_) { /* socket closed */ }
      }
      upstreamReq.end();
    }
  });
}
