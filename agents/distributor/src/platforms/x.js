// Vireo X (Twitter) Publisher — X API v2 with v1.1 media upload.
//
// Flow:
//   1. Upload media (POST media/upload v1.1) — INIT + APPEND + FINALIZE
//   2. Post tweet (POST /2/tweets) with text + media_ids
//
// Auth: OAuth 2.0 Bearer token (user context, app-only) or OAuth 1.0a user creds.
// For media upload we need user context (OAuth 1.0a or OAuth 2.0 with user scope).
// Docs: https://developer.twitter.com/en/docs/twitter-api/tweets/manage-tweets/api-reference/post-tweets

const X_API_BASE = "https://api.twitter.com/2";
const X_UPLOAD_BASE = "https://upload.twitter.com/1.1/media/upload.json";

export class XError extends Error {
  constructor(message, status, code = null) {
    super(message);
    this.name = "XError";
    this.status = status;
    this.code = code;
  }
}

export class XPublisher {
  /**
   * @param {object} opts
   * @param {string} opts.accessToken  - OAuth 2.0 user access token (with tweet.read, tweet.write, media.write)
   * @param {function} [opts.transport]
   */
  constructor({ accessToken, transport } = {}) {
    if (!accessToken) throw new XError("accessToken is required", 0, "config_missing");
    this.accessToken = accessToken;
    this.transport = transport || this._defaultTransport;
  }

  async _defaultTransport(method, url, opts = {}) {
    const res = await fetch(url, { method, ...opts });
    const text = await res.text();
    let body = text;
    try { body = JSON.parse(text); } catch {}
    return { status: res.status, body };
  }

  _headers(extra = {}) {
    return { Authorization: `Bearer ${this.accessToken}`, ...extra };
  }

  /**
   * Upload a video file via chunked media upload.
   * X requires chunked upload for videos > 5MB.
   * @param {string} filePath
   * @param {string} [mimeType]  - default video/mp4
   * @param {number} [chunkBytes]  - default 5MB
   * @returns {Promise<string>} media_id_string
   */
  async uploadMedia(filePath, mimeType = "video/mp4", chunkBytes = 5 * 1024 * 1024) {
    if (!filePath) throw new XError("filePath is required", 0, "validation_error");
    const fs = await import("node:fs");
    if (!fs.existsSync(filePath)) {
      throw new XError(`file not found: ${filePath}`, 0, "file_not_found");
    }
    const data = fs.readFileSync(filePath);
    const totalBytes = data.length;
    const filename = filePath.split(/[\\/]/).pop();

    // Step 1: INIT
    const initResp = await this.transport("POST", X_UPLOAD_BASE, {
      headers: this._headers({ "Content-Type": "application/x-www-form-urlencoded" }),
      body: new URLSearchParams({
        command: "INIT",
        total_bytes: String(totalBytes),
        media_type: mimeType,
        media_category: "tweet_video",
      }).toString(),
    });
    if (initResp.status !== 202) {
      throw new XError(`init failed: ${JSON.stringify(initResp.body)}`, initResp.status, "init_failed");
    }
    const mediaId = initResp.body.media_id_string;
    if (!mediaId) {
      throw new XError("no media_id in init response", 202, "init_failed");
    }

    // Step 2: APPEND chunks
    const numChunks = Math.ceil(totalBytes / chunkBytes);
    for (let i = 0; i < numChunks; i++) {
      const start = i * chunkBytes;
      const end = Math.min(start + chunkBytes, totalBytes);
      const chunk = data.slice(start, end);
      const formData = new FormData();
      formData.append("command", "APPEND");
      formData.append("media_id", mediaId);
      formData.append("segment_index", String(i));
      formData.append("media", new Blob([chunk], { type: mimeType }), filename);
      const appendResp = await this.transport("POST", X_UPLOAD_BASE, {
        headers: this._headers(),
        body: formData,
      });
      if (appendResp.status !== 204) {
        throw new XError(`append chunk ${i} failed: ${appendResp.status}`, appendResp.status, "append_failed");
      }
    }

    // Step 3: FINALIZE
    const finalizeResp = await this.transport("POST", X_UPLOAD_BASE, {
      headers: this._headers({ "Content-Type": "application/x-www-form-urlencoded" }),
      body: new URLSearchParams({ command: "FINALIZE", media_id: mediaId }).toString(),
    });
    if (finalizeResp.status !== 200) {
      throw new XError(`finalize failed: ${JSON.stringify(finalizeResp.body)}`, finalizeResp.status, "finalize_failed");
    }
    // X requires polling processing_info for async media (videos especially).
    // If we return before the media is "succeeded", the subsequent tweet
    // post may fail or include a still-processing video.
    return await this._waitForProcessing(mediaId, finalizeResp.body);
  }

  /**
   * Poll the media/status endpoint until processing completes, or timeout.
   * Returns the media_id_string (so caller can use it in a tweet).
   */
  async _waitForProcessing(mediaId, finalizeBody, { maxWaitMs = 60_000, intervalMs = 1000 } = {}) {
    // No processing_info means the media is already ready (e.g. small image).
    if (!finalizeBody?.processing_info) return mediaId;
    const start = Date.now();
    let info = finalizeBody.processing_info;
    while (Date.now() - start < maxWaitMs) {
      if (info.state === "succeeded") return mediaId;
      if (info.state === "failed") {
        throw new XError(`media processing failed: ${info.error?.message || "unknown"}`, 200, "processing_failed");
      }
      // Check back after the suggested delay, capped at 5s and floored at 500ms.
      const wait = Math.min(5000, Math.max(500, Number(info.check_after_secs || 1) * 1000));
      await new Promise((r) => setTimeout(r, wait));
      const statusResp = await this.transport("GET", `${X_UPLOAD_BASE}.json?command=STATUS&media_id=${mediaId}`, {
        headers: this._headers(),
      });
      if (statusResp.status !== 200) {
        throw new XError(`status check failed: ${statusResp.status}`, statusResp.status, "status_failed");
      }
      info = statusResp.body.processing_info || info;
    }
    throw new XError(`media processing timeout after ${maxWaitMs}ms`, 200, "processing_timeout");
  }

  /**
   * Post a tweet with optional media.
   * @param {object} opts
   * @param {string} opts.text       - tweet text (max 280 for free, 4000 for premium)
   * @param {string[]} [opts.mediaIds]  - media_id_strings from uploadMedia
   * @param {string} [opts.replyTo]   - tweet ID to reply to
   */
  async postTweet({ text, mediaIds = [], replyTo = null }) {
    if (!text) throw new XError("text is required", 0, "validation_error");
    const body = { text: text.slice(0, 280) };
    if (mediaIds.length) body.media = { media_ids: mediaIds };
    if (replyTo) body.reply = { in_reply_to_tweet_id: replyTo };
    const r = await this.transport("POST", `${X_API_BASE}/tweets`, {
      headers: this._headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
    if (r.status !== 201) {
      const msg = r.body?.detail || r.body?.title || JSON.stringify(r.body);
      throw new XError(`post failed: ${msg}`, r.status, "post_failed");
    }
    return {
      id: r.body.data?.id,
      text: r.body.data?.text,
    };
  }

  /**
   * Convenience: upload + tweet in one call.
   */
  async postVideoTweet({ text, filePath, mimeType }) {
    const mediaId = await this.uploadMedia(filePath, mimeType);
    return this.postTweet({ text, mediaIds: [mediaId] });
  }

  /**
   * Get tweet metrics.
   * @param {string} tweetId
   */
  async getTweetMetrics(tweetId) {
    if (!tweetId) throw new XError("tweetId is required", 0, "validation_error");
    const url = `${X_API_BASE}/tweets/${tweetId}?tweet.fields=public_metrics`;
    const r = await this.transport("GET", url, { headers: this._headers() });
    if (r.status !== 200) {
      throw new XError(`metrics failed: ${r.status}`, r.status, "metrics_failed");
    }
    const m = r.body.data?.public_metrics || {};
    return {
      id: r.body.data?.id,
      views: m.impression_count || 0,
      likes: m.like_count || 0,
      retweets: m.retweet_count || 0,
      replies: m.reply_count || 0,
      quotes: m.quote_count || 0,
      bookmarks: m.bookmark_count || 0,
    };
  }
}
