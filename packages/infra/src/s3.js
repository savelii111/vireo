// Vireo S3 client — HTTPS to MinIO or AWS S3, SigV4 signed.
// Zero deps. Supports putObject, getObject, deleteObject, presignedGet, listObjects.

import { createHmac, createHash } from "node:crypto";
import https from "node:https";
import http from "node:http";
import { URL } from "node:url";

const httpsRequest = https.request;
const httpRequest = http.request;

export class S3Error extends Error {
  constructor(message, code, statusCode) {
    super(message);
    this.name = "S3Error";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function sha256Hex(buf) {
  return createHash("sha256").update(buf || "").digest("hex");
}
function hmac(key, data) {
  return createHmac("sha256", key).update(data).digest();
}
function hex(buf) {
  return Buffer.from(buf).toString("hex");
}

export class S3Client {
  constructor({ endpoint, bucket, accessKey, secretKey, region = "us-east-1", publicBaseUrl = null, forcePathStyle = true } = {}) {
    if (!endpoint) throw new Error("S3Client: endpoint required");
    if (!bucket) throw new Error("S3Client: bucket required");
    this.endpoint = endpoint.replace(/\/$/, "");
    this.bucket = bucket;
    this.accessKey = accessKey || "";
    this.secretKey = secretKey || "";
    this.region = region;
    this.publicBaseUrl = publicBaseUrl || null;
    this.forcePathStyle = forcePathStyle;
  }

  _url(key) {
    const u = new URL(this.endpoint);
    if (this.forcePathStyle) {
      u.pathname = `/${this.bucket}/${encodeURI(key)}`;
    } else {
      u.host = `${this.bucket}.${u.host}`;
      u.pathname = `/${encodeURI(key)}`;
    }
    return u;
  }

  _signRequest({ method, url, headers, bodyHash, bodyLength }) {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const date = amzDate.slice(0, 8);

    const host = url.host;
    const path = url.pathname || "/";
    const query = [...url.searchParams.entries()].sort().map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");

    const canonicalHeaders = Object.entries({ ...headers, host, "x-amz-content-sha256": bodyHash, "x-amz-date": amzDate })
      .filter(([k, v]) => v != null)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${typeof v === "string" ? v.trim() : v}\n`)
      .join("");
    const signedHeaders = Object.keys({ ...headers, host, "x-amz-content-sha256": bodyHash, "x-amz-date": amzDate })
      .filter((k) => headers[k] != null || k === "host" || k === "x-amz-content-sha256" || k === "x-amz-date")
      .sort()
      .join(";");

    const canonicalRequest = [method, path, query, canonicalHeaders, signedHeaders, bodyHash].join("\n");
    const credentialScope = `${date}/${this.region}/s3/aws4_request`;
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256Hex(canonicalRequest)].join("\n");

    const kDate = hmac(`AWS4${this.secretKey}`, date);
    const kRegion = hmac(kDate, this.region);
    const kService = hmac(kRegion, "s3");
    const kSigning = hmac(kService, "aws4_request");
    const signature = hex(hmac(kSigning, stringToSign));

    const authHeader = `AWS4-HMAC-SHA256 Credential=${this.accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return {
      ...headers,
      "x-amz-content-sha256": bodyHash,
      "x-amz-date": amzDate,
      Authorization: authHeader,
    };
  }

  _request(method, key, { headers = {}, body = null, query = null, responseType = "buffer" } = {}) {
    const url = this._url(key);
    if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const bodyBuf = body == null ? Buffer.alloc(0) : (Buffer.isBuffer(body) ? body : Buffer.from(body));
    const bodyHash = sha256Hex(bodyBuf);
    const signedHeaders = this._signRequest({ method, url, headers, bodyHash });

    const opts = {
      method,
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: (url.pathname || "/") + (url.search || ""),
      headers: { ...signedHeaders, "Content-Length": String(bodyBuf.length) },
    };
    const isHttps = url.protocol === "https:";
    const lib = isHttps ? httpsRequest : httpRequest;

    return new Promise((resolve, reject) => {
      const req = lib(opts, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(responseType === "buffer" ? buf : buf.toString("utf8"));
          } else {
            let msg = buf.toString("utf8").slice(0, 500);
            try {
              const j = JSON.parse(msg);
              msg = j.message || j.Message || msg;
            } catch {}
            reject(new S3Error(msg || `S3 ${res.statusCode}`, `http_${res.statusCode}`, res.statusCode));
          }
        });
      });
      req.on("error", reject);
      if (bodyBuf.length > 0) req.write(bodyBuf);
      req.end();
    });
  }

  async putObject(key, body, { contentType = "application/octet-stream", metadata = {} } = {}) {
    const bodyBuf = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const headers = { "Content-Type": contentType };
    for (const [k, v] of Object.entries(metadata)) headers[`x-amz-meta-${k.toLowerCase()}`] = String(v);
    await this._request("PUT", key, { body: bodyBuf, headers });
    return { key, etag: null, size: bodyBuf.length };
  }

  async getObject(key) {
    return this._request("GET", key, { responseType: "buffer" });
  }

  async deleteObject(key) {
    await this._request("DELETE", key);
    return { key };
  }

  async headObject(key) {
    const url = this._url(key);
    const bodyHash = sha256Hex(Buffer.alloc(0));
    const signedHeaders = this._signRequest({ method: "HEAD", url, headers: {}, bodyHash });
    const opts = {
      method: "HEAD",
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: url.pathname,
      headers: { ...signedHeaders, "Content-Length": "0" },
    };
    const lib = url.protocol === "https:" ? httpsRequest : httpRequest;
    return new Promise((resolve, reject) => {
      const req = lib(opts, (res) => {
        res.resume();
        res.on("end", () => {
          if (res.statusCode === 200) {
            resolve({ key, size: Number(res.headers["content-length"] || 0), contentType: res.headers["content-type"] });
          } else {
            reject(new S3Error(`S3 HEAD ${res.statusCode}`, `http_${res.statusCode}`, res.statusCode));
          }
        });
      });
      req.on("error", reject);
      req.end();
    });
  }

  async listObjects({ prefix = "", maxKeys = 1000 } = {}) {
    const xml = await this._request("GET", "", { query: { "list-type": "2", prefix, "max-keys": String(maxKeys) }, responseType: "text", headers: {} });
    // Tiny XML parser — extract <Contents><Key>...</Key><Size>...</Size></Contents>
    const out = [];
    const re = /<Contents>([\s\S]*?)<\/Contents>/g;
    let m;
    while ((m = re.exec(xml)) !== null) {
      const block = m[1];
      const key = (block.match(/<Key>([^<]*)<\/Key>/) || [])[1];
      const size = Number((block.match(/<Size>([^<]*)<\/Size>/) || [])[1] || 0);
      if (key) out.push({ key: decodeURIComponent(key), size });
    }
    return out;
  }

  /**
   * Presigned URL for direct download from the browser.
   * @param {string} key
   * @param {number} expiresSec
   */
  presignedGet(key, { expiresSec = 3600 } = {}) {
    const url = this._url(key);
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const date = amzDate.slice(0, 8);
    const host = url.host;
    const credentialScope = `${date}/${this.region}/s3/aws4_request`;
    const signedHeaders = "host";

    // Sorted query params, with X-Amz-* fields first
    const q = {
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": `${this.accessKey}/${credentialScope}`,
      "X-Amz-Date": amzDate,
      "X-Amz-Expires": String(expiresSec),
      "X-Amz-SignedHeaders": signedHeaders,
    };
    const queryString = Object.entries(q).sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");

    const canonicalRequest = ["GET", url.pathname, queryString, `host:${host}\n`, signedHeaders, "UNSIGNED-PAYLOAD"].join("\n");
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256Hex(canonicalRequest)].join("\n");
    const kDate = hmac(`AWS4${this.secretKey}`, date);
    const kRegion = hmac(kDate, this.region);
    const kService = hmac(kRegion, "s3");
    const kSigning = hmac(kService, "aws4_request");
    const signature = hex(hmac(kSigning, stringToSign));

    return `${url.toString()}?${queryString}&X-Amz-Signature=${signature}`;
  }
}
