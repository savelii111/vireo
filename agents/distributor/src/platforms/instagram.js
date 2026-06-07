// Vireo Instagram Publisher — Instagram Graph API (for Reels).
//
// Flow:
//   1. Create media container (POST /{ig-user-id}/media) with video_url + caption
//   2. Poll for container status (GET /{ig-user-id}/media_container_status?container_id=...)
//   3. Publish container (POST /{ig-user-id}/media_publish) with creation_id
//
// Auth: Facebook Page access token with instagram_content_publish permission.
// Docs: https://developers.facebook.com/docs/instagram-api/guides/content-publishing

const GRAPH_API_BASE = "https://graph.facebook.com/v20.0";

export class InstagramError extends Error {
  constructor(message, status, code = null) {
    super(message);
    this.name = "InstagramError";
    this.status = status;
    this.code = code;
  }
}

export class InstagramPublisher {
  /**
   * @param {object} opts
   * @param {string} opts.accessToken  - Long-lived Facebook Page access token
   * @param {string} opts.igUserId     - Instagram Business/Creator account ID
   * @param {string} [opts.apiBase]
   * @param {function} [opts.transport]
   */
  constructor({ accessToken, igUserId, transport, apiBase = GRAPH_API_BASE } = {}) {
    if (!accessToken) throw new InstagramError("accessToken is required", 0, "config_missing");
    if (!igUserId) throw new InstagramError("igUserId is required", 0, "config_missing");
    this.accessToken = accessToken;
    this.igUserId = igUserId;
    this.apiBase = apiBase;
    this.transport = transport || this._defaultTransport;
  }

  async _defaultTransport(method, url, opts = {}) {
    const res = await fetch(url, { method, ...opts });
    const text = await res.text();
    let body = text;
    try { body = JSON.parse(text); } catch {}
    return { status: res.status, body };
  }

  /**
   * Publish a Reel to Instagram.
   * Note: video_url must be publicly accessible (we use S3/CDN URLs, not local files).
   * @param {object} opts
   * @param {string} opts.videoUrl   - publicly accessible video URL
   * @param {string} opts.caption    - caption text
   * @param {string} [opts.coverUrl] - optional cover image URL
   * @param {number} [opts.maxWaitMs]  - max time to wait for processing (default 5min)
   */
  async publishReel({ videoUrl, caption, coverUrl = null, maxWaitMs = 5 * 60 * 1000 }) {
    if (!videoUrl) throw new InstagramError("videoUrl is required", 0, "validation_error");
    if (!caption) throw new InstagramError("caption is required", 0, "validation_error");

    // Step 1: create container
    const createUrl = `${this.apiBase}/${this.igUserId}/media`;
    const createBody = new URLSearchParams({
      media_type: "REELS",
      video_url: videoUrl,
      caption: caption.slice(0, 2200),  // IG caption limit
      access_token: this.accessToken,
    });
    if (coverUrl) createBody.set("cover_url", coverUrl);
    const createResp = await this.transport("POST", createUrl, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: createBody.toString(),
    });
    if (createResp.status !== 200 || createResp.body.error) {
      const msg = createResp.body?.error?.message || JSON.stringify(createResp.body);
      throw new InstagramError(`create container failed: ${msg}`, createResp.status, "create_failed");
    }
    const containerId = createResp.body.id;

    // Step 2: poll for status
    const start = Date.now();
    let status = null;
    let pollTimer = null;
    try {
      while (Date.now() - start < maxWaitMs) {
        const statusUrl = `${this.apiBase}/${containerId}?fields=status_code,status&access_token=${this.accessToken}`;
        const statusResp = await this.transport("GET", statusUrl, {});
        if (statusResp.status !== 200) {
          throw new InstagramError(`status check failed: ${statusResp.status}`, statusResp.status, "status_failed");
        }
        status = statusResp.body.status_code;
        if (status === "FINISHED") break;
        if (status === "ERROR" || status === "EXPIRED") {
          throw new InstagramError(`container ${status}`, 200, "container_failed");
        }
        // Wait 5s before next poll (tracked so we can clear on early exit)
        await new Promise((r) => {
          pollTimer = setTimeout(r, 5000);
        });
        pollTimer = null;
      }
    } finally {
      // Clear any pending poll timer so an early throw doesn't leave a
      // timer holding the event loop alive.
      if (pollTimer) clearTimeout(pollTimer);
    }
    if (status !== "FINISHED") {
      throw new InstagramError(`timeout waiting for container (last status: ${status})`, 200, "timeout");
    }

    // Step 3: publish
    const publishUrl = `${this.apiBase}/${this.igUserId}/media_publish`;
    const publishBody = new URLSearchParams({
      creation_id: containerId,
      access_token: this.accessToken,
    });
    const publishResp = await this.transport("POST", publishUrl, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: publishBody.toString(),
    });
    if (publishResp.status !== 200 || publishResp.body.error) {
      const msg = publishResp.body?.error?.message || JSON.stringify(publishResp.body);
      throw new InstagramError(`publish failed: ${msg}`, publishResp.status, "publish_failed");
    }
    return {
      containerId,
      mediaId: publishResp.body.id,
      permalink: null,  // not returned by API; client must construct
    };
  }

  /**
   * Get media insights (views, likes, comments, saves, shares).
   * @param {string} mediaId
   */
  async getMediaInsights(mediaId) {
    if (!mediaId) throw new InstagramError("mediaId is required", 0, "validation_error");
    const url = `${this.apiBase}/${mediaId}/insights?metric=plays,likes,comments,shares,saves,reach&access_token=${this.accessToken}`;
    const r = await this.transport("GET", url, {});
    if (r.status !== 200) {
      throw new InstagramError(`insights failed: ${r.status}`, r.status, "insights_failed");
    }
    const out = {};
    for (const m of r.body.data || []) {
      out[m.name] = m.values?.[0]?.value || 0;
    }
    return out;
  }
}
