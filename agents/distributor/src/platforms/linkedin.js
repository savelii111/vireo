// Vireo LinkedIn Publisher — LinkedIn Marketing API for video posts.
//
// Flow:
//   1. Register upload (POST /rest/posts?action=initializeUpload) — gets upload URL + URN
//   2. PUT binary to upload URL
//   3. Create post (POST /rest/posts) with media URN + commentary + author
//
// Auth: OAuth 2.0 access token with w_member_social scope.
// Docs: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/video-posts

const LINKEDIN_API_BASE = "https://api.linkedin.com/rest";

export class LinkedInError extends Error {
  constructor(message, status, code = null) {
    super(message);
    this.name = "LinkedInError";
    this.status = status;
    this.code = code;
  }
}

export class LinkedInPublisher {
  /**
   * @param {object} opts
   * @param {string} opts.accessToken  - OAuth 2.0 access token
   * @param {string} opts.authorUrn    - "urn:li:person:{id}" or "urn:li:organization:{id}"
   * @param {function} [opts.transport]
   * @param {string} [opts.apiBase]
   */
  constructor({ accessToken, authorUrn, transport, apiBase = LINKEDIN_API_BASE } = {}) {
    if (!accessToken) throw new LinkedInError("accessToken is required", 0, "config_missing");
    if (!authorUrn) throw new LinkedInError("authorUrn is required", 0, "config_missing");
    this.accessToken = accessToken;
    this.authorUrn = authorUrn;
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
      "X-Restli-Protocol-Version": "2.0.0",
      "LinkedIn-Version": "202403",
      ...extra,
    };
  }

  /**
   * Publish a video to LinkedIn.
   * @param {object} opts
   * @param {string} opts.filePath  - local video file
   * @param {string} opts.text      - post commentary
   * @param {string} [opts.title]   - video title
   * @returns {Promise<{postUrn, mediaUrn}>}
   */
  async publishVideo({ filePath, text, title = "" }) {
    if (!filePath) throw new LinkedInError("filePath is required", 0, "validation_error");
    if (!text) throw new LinkedInError("text is required", 0, "validation_error");

    const fs = await import("node:fs");
    if (!fs.existsSync(filePath)) {
      throw new LinkedInError(`file not found: ${filePath}`, 0, "file_not_found");
    }
    const fileSize = fs.statSync(filePath).size;

    // Step 1: initialize upload
    const initUrl = `${this.apiBase}/posts?action=initializeUpload`;
    const initBody = {
      initializeUploadRequest: {
        owner: this.authorUrn,
        fileSizeBytes: fileSize,
        uploadThrottleOptIn: false,
        supportedUploadMechanism: ["SINGLE_REQUEST_UPLOAD"],
      },
    };
    const initResp = await this.transport("POST", initUrl, {
      headers: this._headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(initBody),
    });
    if (initResp.status !== 200) {
      const msg = initResp.body?.message || JSON.stringify(initResp.body);
      throw new LinkedInError(`init failed: ${msg}`, initResp.status, "init_failed");
    }
    const value = initResp.body.value || {};
    const uploadMechanism = value.uploadMechanism || {};
    const uploadUrl =
      uploadMechanism["com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"]?.uploadUrl ||
      Object.values(uploadMechanism)[0]?.uploadUrl;
    const mediaUrn = value.mediaArtifact || value.asset;
    if (!uploadUrl) {
      throw new LinkedInError("no upload URL returned", 200, "init_failed");
    }

    // Step 2: upload bytes (single request)
    const fileData = fs.readFileSync(filePath);
    const uploadResp = await this.transport("PUT", uploadUrl, {
      headers: { "Content-Type": "application/octet-stream" },
      body: fileData,
    });
    if (uploadResp.status !== 200 && uploadResp.status !== 201) {
      throw new LinkedInError(`upload failed: ${uploadResp.status}`, uploadResp.status, "upload_failed");
    }

    // Step 3: create post
    const postUrl = `${this.apiBase}/posts`;
    const postBody = {
      author: this.authorUrn,
      commentary: text.slice(0, 3000),
      visibility: "PUBLIC",
      distribution: {
        feedDistribution: "MAIN_FEED",
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      content: {
        media: {
          id: mediaUrn,
          title: title.slice(0, 200) || "Video",
        },
      },
      lifecycleState: "PUBLISHED",
    };
    const postResp = await this.transport("POST", postUrl, {
      headers: this._headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(postBody),
    });
    if (postResp.status !== 201) {
      const msg = postResp.body?.message || JSON.stringify(postResp.body);
      throw new LinkedInError(`post failed: ${msg}`, postResp.status, "post_failed");
    }
    return {
      postUrn: postResp.headers.get?.("x-restli-id") || postResp.body?.id,
      mediaUrn,
    };
  }

  /**
   * Get social actions (likes, comments) on a post.
   * @param {string} postUrn
   */
  async getPostStats(postUrn) {
    if (!postUrn) throw new LinkedInError("postUrn is required", 0, "validation_error");
    const url = `${this.apiBase}/socialActions/${encodeURIComponent(postUrn)}`;
    const r = await this.transport("GET", url, { headers: this._headers() });
    if (r.status !== 200) {
      throw new LinkedInError(`stats failed: ${r.status}`, r.status, "stats_failed");
    }
    return r.body;
  }
}
