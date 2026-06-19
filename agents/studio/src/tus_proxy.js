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
 * Auth is forwarded because the video agent is a first-class protected
 * service in compose. TUS protocol headers are preserved verbatim so PATCH
 * and creation-with-upload keep the exact contract.
 */
export const TUS_PASSTHROUGH_HEADERS = [
  "authorization", "upload-length", "upload-offset", "upload-metadata",
  "content-length", "content-range", "content-type", "tus-resumable",
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
  const upstreamHeaders = { ...passthroughHeaders };
  if (req.method === "POST" && !sessionId) {
    delete upstreamHeaders["content-length"];
    delete upstreamHeaders["content-type"];
    delete upstreamHeaders["content-range"];
  }
  const sanitizedHeaders = Object.fromEntries(
    Object.entries(upstreamHeaders).map(([k, v]) => [
      k,
      k.toLowerCase() === "authorization" ? "Bearer [REDACTED]" : v,
    ])
  );
  if (process.env.VIREO_TUS_DEBUG) {
    console.log(`[studio] TUS proxy upstream ${req.method} ${target}`, {
      headers: sanitizedHeaders,
      sessionId,
      userId,
    });
  }
  const upstreamReq = httpRequest(target, {
    method: req.method,
    headers: upstreamHeaders,
  }, (upstreamRes) => {
    // Forward upstream status and headers verbatim — TUS protocol requires
    // exact header echo (e.g. Upload-Offset, Location on POST 201).
    res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
    upstreamRes.pipe(res);
  });
  upstreamReq.on("error", (e) => {
    console.error(`[studio] TUS proxy error (${req.method} ${target}):`, e?.stack || e);
    if (!res.headersSent) {
      try {
        res.writeHead(502, { "content-type": "application/json" });
      } catch (_) { /* socket may be closed */ }
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
  req.on("aborted", () => {
    if (!upstreamReq.destroyed) upstreamReq.destroy();
  });
  req.on("error", (e) => {
    if (!upstreamReq.destroyed) upstreamReq.destroy(e);
  });
  // The video TUS handler supports TUS creation-with-upload headers but does
  // not consume a POST body; it finalizes on PATCH. Forwarding the file body
  // on POST lets Python close the HTTP/1.0 socket before Node finishes
  // writing, which manifests as "socket hang up". For POST creation, send the
  // headers only and drain the client body so the proxy can safely return the
  // upstream 201 Location. All real bytes still flow through the proxy on
  // PATCH, where the video agent consumes and ffprobes the upload.
  if (req.method === "POST" && !sessionId) {
    upstreamReq.end();
    req.resume();
    req.on("aborted", () => {
      if (!upstreamReq.destroyed) upstreamReq.destroy();
    });
    return;
  }

  // Stream body (if any) to upstream. Node's pipe handles backpressure and
  // lets the upstream see the real request body. For HEAD/DELETE, req ends
  // immediately and we only send headers. Avoid the old zero-byte write: with
  // Python BaseHTTP/1.0 it can race with socket shutdown and produces
  // "socket hang up" even when the upstream URL is reachable.
  req.pipe(upstreamReq);
}
