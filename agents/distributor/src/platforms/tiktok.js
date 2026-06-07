// Vireo TikTok Publisher — real TikTok Business API (Content Posting API).
//
// Flow:
//   1. Initialize upload (POST /v2/post/publish/video/init/) — gets upload URL
//   2. PUT video bytes to the upload URL
//   3. Create post (POST /v2/post/publish/video/) — publishes to TikTok
//
// Auth: TikTok access token (OAuth2, scope: video.upload, video.publish).
// Docs: https://developers.tiktok.com/doc/tiktok-api-v2-video-post/

const TIKTOK_API_BASE = "https://open.tiktokapis.com/v2";

export class TikTokError extends Error {
  constructor(message, status, code = null) {
    super(message);
    this.name = "TikTokError";
    this.status = status;
    this.code = code;
  }
}

export class TikTokPublisher {
  constructor({ accessToken, transport, apiBase = TIKTOK_API_BASE } = {}) {
    if (!accessToken) throw new TikTokError("accessToken is required", 0, "config_missing");
    this.accessToken = accessToken;
    this.apiBase = apiBase;
    this.transport = transport || this._defaultTransport;
  }

  async _defaultTransport(method, url, opts = {}) {
    const res = await fetch(url, { method, ...opts });
    const text = await res.text();
    let body = text;
    try { body = JSON.parse(text); } catch {}
    return { status: res.status, body, headers: res.headers };
  }

  _headers(extra = {}) {
    return {
      Authorization: `Bearer ${this.accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      ...extra,
    };
  }

  /**
   * Publish a video to TikTok.
   * @param {object} opts
   * @param {string} opts.filePath  - local video file path
   * @param {string} opts.title     - video caption
   * @param {string} [opts.description]  - additional text
   * @param {string[]} [opts.tags]  - hashtags (will be formatted as #tag)
   * @param {number} [opts.privacyLevel]  - 0=public, 1=mutual, 2=self (default: 0)
   * @param {number} [opts.chunkSize]     - upload chunk size (default: 10MB)
   * @returns {Promise<{publishId, shareUrl}>}
   */
  async publishVideo({
    filePath,
    title,
    description = "",
    tags = [],
    privacyLevel = 0,
    chunkSize = 10 * 1024 * 1024,
  }) {
    if (!filePath) throw new TikTokError("filePath is required", 0, "validation_error");
    if (!title) throw new TikTokError("title is required", 0, "validation_error");

    const fs = await import("node:fs");
    if (!fs.existsSync(filePath)) {
      throw new TikTokError(`file not found: ${filePath}`, 0, "file_not_found");
    }
    const fileSize = fs.statSync(filePath).size;
    const caption = this._formatCaption(title, description, tags);

    // Step 1: initialize upload
    const initUrl = `${this.apiBase}/post/publish/video/init/`;
    const initBody = {
      post_info: {
        title: caption.slice(0, 2200),  // TikTok caption limit
        privacy_level: privacyLevel,
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
        video_cover_timestamp_ms: 1000,
      },
      source_info: {
        source: "FILE_UPLOAD",
        video_size: fileSize,
        chunk_size: chunkSize,
        total_chunk_count: Math.ceil(fileSize / chunkSize),
      },
    };
    const initResp = await this.transport("POST", initUrl, {
      headers: this._headers(),
      body: JSON.stringify(initBody),
    });
    if (initResp.status !== 200 || initResp.body?.error?.code) {
      const msg = initResp.body?.error?.message || JSON.stringify(initResp.body);
      throw new TikTokError(`init failed: ${msg}`, initResp.status, "init_failed");
    }
    const { publish_id, upload_url } = initResp.body.data;

    // Step 2: upload bytes
    const fileData = fs.readFileSync(filePath);
    const uploadResp = await this.transport("PUT", upload_url, {
      headers: { "Content-Type": "video/mp4" },
      body: fileData,
    });
    if (uploadResp.status !== 200 && uploadResp.status !== 201) {
      throw new TikTokError(`upload failed: ${uploadResp.status}`, uploadResp.status, "upload_failed");
    }

    // Step 3: publish
    const publishUrl = `${this.apiBase}/post/publish/video/?publish_id=${encodeURIComponent(publish_id)}`;
    const publishResp = await this.transport("POST", publishUrl, {
      headers: this._headers(),
    });
    if (publishResp.status !== 200) {
      const msg = publishResp.body?.error?.message || JSON.stringify(publishResp.body);
      throw new TikTokError(`publish failed: ${msg}`, publishResp.status, "publish_failed");
    }
    return {
      publishId: publish_id,
      shareUrl: publishResp.body?.data?.share_url || null,
    };
  }

  _formatCaption(title, description, tags) {
    const tagText = tags.map((t) => t.startsWith("#") ? t : `#${t}`).join(" ");
    return [title, description, tagText].filter(Boolean).join("\n\n");
  }

  /**
   * Get video metrics (views, likes, comments, shares).
   * @param {string[]} videoIds
   */
  async getVideoMetrics(videoIds) {
    if (!Array.isArray(videoIds) || videoIds.length === 0) {
      throw new TikTokError("videoIds must be non-empty array", 0, "validation_error");
    }
    const url = `${this.apiBase}/video/query/?fields=id,view_count,like_count,comment_count,share_count`;
    const r = await this.transport("POST", url, {
      headers: this._headers(),
      body: JSON.stringify({ filters: { video_id: videoIds } }),
    });
    if (r.status !== 200) {
      throw new TikTokError(`metrics failed: ${r.status}`, r.status, "metrics_failed");
    }
    return r.body.data?.videos || [];
  }
}
