// Vireo YouTube Publisher — real YouTube Data API v3 client.
//
// Flow:
//   1. videos.insert (resumable upload) — uploads the video file
//   2. videos.update (optional) — adds tags, category, description
//   3. thumbnails.set (optional) — uploads a custom thumbnail
//
// All HTTP calls go through a transport function (injectable for tests).
// The mock transport is used in CI; real transport uses `fetch` against
// https://www.googleapis.com/youtube/v3/
//
// Authentication: requires a Google OAuth2 access token with scope
//   https://www.googleapis.com/auth/youtube.upload
// Tokens are stored in vireo_oauth_tokens (managed by oauth agent).

const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";
const UPLOAD_BASE = "https://www.googleapis.com/upload/youtube/v3";

export class YouTubeError extends Error {
  constructor(message, status, code = null) {
    super(message);
    this.name = "YouTubeError";
    this.status = status;
    this.code = code;
  }
}

export class YouTubePublisher {
  /**
   * @param {object} opts
   * @param {string} opts.accessToken  - OAuth2 access token with youtube.upload scope
   * @param {function} [opts.transport] - (method, url, {headers, body}) => Promise<{status, body, headers}>
   * @param {string} [opts.apiBase]    - override API base URL (for tests)
   * @param {string} [opts.uploadBase] - override upload base URL (for tests)
   */
  constructor({ accessToken, transport, apiBase = YOUTUBE_API_BASE, uploadBase = UPLOAD_BASE } = {}) {
    if (!accessToken) {
      throw new YouTubeError("accessToken is required", 0, "config_missing");
    }
    this.accessToken = accessToken;
    this.apiBase = apiBase;
    this.uploadBase = uploadBase;
    this.transport = transport || this._defaultTransport;
  }

  async _defaultTransport(method, url, opts = {}) {
    const res = await fetch(url, { method, ...opts });
    const text = await res.text();
    let body = text;
    try { body = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body, headers: res.headers };
  }

  _authHeaders(extra = {}) {
    return { Authorization: `Bearer ${this.accessToken}`, ...extra };
  }

  /**
   * Upload a video file via resumable upload protocol.
   * Step 1: POST metadata to get an upload URL.
   * Step 2: PUT the actual video bytes to that URL.
   *
   * @param {object} opts
   * @param {string} opts.filePath  - path to video file
   * @param {string} opts.title     - video title
   * @param {string} [opts.description]  - video description
   * @param {string[]} [opts.tags]  - video tags
   * @param {string} [opts.privacyStatus] - "public"|"unlisted"|"private" (default: private for safety)
   * @param {string} [opts.categoryId]    - YouTube category (default: 22 = People & Blogs)
   * @returns {Promise<{id, kind, status}>}
   */
  async uploadVideo({
    filePath,
    title,
    description = "",
    tags = [],
    privacyStatus = "private",
    categoryId = "22",
  }) {
    if (!filePath) throw new YouTubeError("filePath is required", 0, "config_missing");
    if (!title) throw new YouTubeError("title is required", 0, "validation_error");

    const fs = await import("node:fs");
    const path = await import("node:path");
    if (!fs.existsSync(filePath)) {
      throw new YouTubeError(`file not found: ${filePath}`, 0, "file_not_found");
    }
    const fileSize = fs.statSync(filePath).size;
    const fileName = path.basename(filePath);

    const metadata = {
      snippet: {
        title: title.slice(0, 100),
        description: description.slice(0, 5000),
        tags: tags.slice(0, 500),  // YT limit
        categoryId,
        defaultLanguage: "en",
        defaultAudioLanguage: "en",
      },
      status: {
        privacyStatus,
        selfDeclaredMadeForKids: false,
        embeddable: true,
        publicStatsViewable: true,
      },
    };

    // Step 1: initiate resumable upload
    const initUrl = `${this.uploadBase}/videos?uploadType=resumable&part=snippet,status`;
    const initResp = await this.transport("POST", initUrl, {
      headers: this._authHeaders({ "Content-Type": "application/json; charset=UTF-8" }),
      body: JSON.stringify(metadata),
    });
    if (initResp.status !== 200 && initResp.status !== 308) {
      const msg = initResp.body?.error?.message || JSON.stringify(initResp.body);
      throw new YouTubeError(`initiate upload failed: ${msg}`, initResp.status, "init_failed");
    }
    const uploadUrl = initResp.headers.get?.("location") ||
                       initResp.headers.get?.("Location") ||
                       initResp.body?.uploadUrl;
    if (!uploadUrl) {
      throw new YouTubeError("no upload URL returned", initResp.status, "init_failed");
    }

    // Step 2: upload the bytes
    const fileData = fs.readFileSync(filePath);
    const uploadResp = await this.transport("POST", uploadUrl, {
      headers: { "Content-Type": "application/octet-stream" },
      body: fileData,
    });
    if (uploadResp.status !== 200 && uploadResp.status !== 201) {
      const msg = uploadResp.body?.error?.message || JSON.stringify(uploadResp.body);
      throw new YouTubeError(`upload failed: ${msg}`, uploadResp.status, "upload_failed");
    }
    const videoId = uploadResp.body.id;
    return {
      id: videoId,
      kind: uploadResp.body.kind || "youtube#video",
      status: uploadResp.body.status?.uploadStatus || "uploaded",
      url: `https://youtu.be/${videoId}`,
    };
  }

  /**
   * Update video metadata (title, description, tags, privacy).
   * @param {string} videoId
   * @param {object} patch - { title?, description?, tags?, privacyStatus? }
   */
  async updateVideo(videoId, patch = {}) {
    if (!videoId) throw new YouTubeError("videoId is required", 0, "validation_error");
    const parts = ["snippet", "status"];
    const url = `${this.apiBase}/videos?part=${parts.join(",")}`;
    const body = { id: videoId };
    if (patch.title || patch.description || patch.tags) {
      body.snippet = {};
      if (patch.title) body.snippet.title = patch.title.slice(0, 100);
      if (patch.description !== undefined) body.snippet.description = patch.description.slice(0, 5000);
      if (patch.tags) body.snippet.tags = patch.tags.slice(0, 500);
    }
    if (patch.privacyStatus) {
      body.status = { privacyStatus: patch.privacyStatus };
    }
    const r = await this.transport("PUT", url, {
      headers: this._authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
    if (r.status !== 200) {
      throw new YouTubeError(`update failed: ${r.body?.error?.message || r.status}`, r.status, "update_failed");
    }
    return r.body;
  }

  /**
   * Upload a custom thumbnail for a video.
   * @param {string} videoId
   * @param {string} filePath  - PNG/JPEG, max 2MB, recommended 1280x720
   */
  async setThumbnail(videoId, filePath) {
    if (!videoId || !filePath) throw new YouTubeError("videoId and filePath are required", 0, "validation_error");
    const fs = await import("node:fs");
    const path = await import("node:path");
    if (!fs.existsSync(filePath)) {
      throw new YouTubeError(`thumbnail file not found: ${filePath}`, 0, "file_not_found");
    }
    // YouTube only accepts PNG or JPEG for thumbnails. Anything else
    // (gif/webp/bmp) is rejected with 400. Validate up-front so the caller
    // gets a clear error instead of an opaque API response.
    const ext = path.extname(filePath).toLowerCase().replace(".", "");
    const SUPPORTED = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" };
    const mime = SUPPORTED[ext];
    if (!mime) {
      throw new YouTubeError(
        `unsupported thumbnail format: .${ext} (use .png, .jpg, .jpeg)`,
        0,
        "validation_error"
      );
    }
    // YouTube caps thumbnails at 2MB. Catch client-side before the upload.
    const stat = fs.statSync(filePath);
    if (stat.size > 2 * 1024 * 1024) {
      throw new YouTubeError(
        `thumbnail too large: ${stat.size} bytes (max 2MB)`,
        0,
        "validation_error"
      );
    }
    const data = fs.readFileSync(filePath);
    const url = `${this.uploadBase}/thumbnails/set?videoId=${encodeURIComponent(videoId)}`;
    const r = await this.transport("POST", url, {
      headers: this._authHeaders({ "Content-Type": mime }),
      body: data,
    });
    if (r.status !== 200) {
      throw new YouTubeError(`thumbnail failed: ${r.body?.error?.message || r.status}`, r.status, "thumbnail_failed");
    }
    return r.body;
  }

  /**
   * Get video statistics (views, likes, etc).
   * @param {string} videoId
   */
  async getVideoStats(videoId) {
    if (!videoId) throw new YouTubeError("videoId is required", 0, "validation_error");
    const url = `${this.apiBase}/videos?part=statistics,snippet&id=${encodeURIComponent(videoId)}`;
    const r = await this.transport("GET", url, { headers: this._authHeaders() });
    if (r.status !== 200) {
      throw new YouTubeError(`stats failed: ${r.status}`, r.status, "stats_failed");
    }
    const item = r.body.items?.[0];
    if (!item) return null;
    return {
      id: item.id,
      title: item.snippet?.title,
      views: Number(item.statistics?.viewCount || 0),
      likes: Number(item.statistics?.likeCount || 0),
      comments: Number(item.statistics?.commentCount || 0),
    };
  }
}
