// Vireo Ingest — HTTP server with /health, /transcribe, /pieces, /ingest/text.

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import { authMiddleware, corsHeaders, readJsonBody, RateLimiter } from "../../../packages/auth-middleware/index.js";

const DEFAULT_PORT = Number(process.env.PORT || 8007);
const DEFAULT_HOST = process.env.HOST || "127.0.0.1";
const JWT_SECRET = process.env.VIREO_JWT_SECRET || "";

const KNOWN_FORMATS = {
  ".mp4":  { mime: "video/mp4", category: "video" },
  ".mov":  { mime: "video/quicktime", category: "video" },
  ".webm": { mime: "video/webm", category: "video" },
  ".mkv":  { mime: "video/x-matroska", category: "video" },
  ".avi":  { mime: "video/x-msvideo", category: "video" },
  ".mp3":  { mime: "audio/mpeg", category: "audio" },
  ".wav":  { mime: "audio/wav", category: "audio" },
  ".m4a":  { mime: "audio/mp4", category: "audio" },
  ".ogg":  { mime: "audio/ogg", category: "audio" },
  ".flac": { mime: "audio/flac", category: "audio" },
  ".opus": { mime: "audio/opus", category: "audio" },
  ".txt":  { mime: "text/plain", category: "text" },
  ".md":   { mime: "text/markdown", category: "text" },
};

const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_AUDIO_BYTES = 500 * 1024 * 1024;
const MAX_TEXT_BYTES = 5 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

function detectFormat(pathOrName) {
  const ext = extname(pathOrName).toLowerCase();
  if (KNOWN_FORMATS[ext]) return { extension: ext, ...KNOWN_FORMATS[ext] };
  return null;
}

function sizeWithinLimits(sizeBytes, category) {
  if (category === "video") return sizeBytes <= MAX_VIDEO_BYTES;
  if (category === "audio") return sizeBytes <= MAX_AUDIO_BYTES;
  if (category === "text") return sizeBytes <= MAX_TEXT_BYTES;
  return false;
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

// In-memory store for testing.
export class PieceStore {
  constructor() {
    this.pieces = [];   // { id, source_id, text, title, language, duration_sec, created_at, metadata }
  }
  add(piece) { this.pieces.push(piece); return piece; }
  addAll(pieces) { this.pieces.push(...pieces); return pieces; }
  bySource(sourceId) { return this.pieces.filter((p) => p.source_id === sourceId); }
  all() { return [...this.pieces]; }
  size() { return this.pieces.length; }
  clear() { this.pieces.length = 0; }
}

function newId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function splitIntoChunks(text, targetWords = 120) {
  if (!text || !text.trim()) return [];
  const sentences = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const chunks = [];
  let current = [];
  let currentWords = 0;
  for (const s of sentences) {
    const w = (s.match(/\b\w+\b/g) || []).length;
    if (current.length && currentWords + w > targetWords * 1.5) {
      chunks.push(current.join(" "));
      current = [s];
      currentWords = w;
    } else {
      current.push(s);
      currentWords += w;
      if (currentWords >= targetWords) {
        chunks.push(current.join(" "));
        current = [];
        currentWords = 0;
      }
    }
  }
  if (current.length) chunks.push(current.join(" "));
  return chunks.filter((c) => (c.match(/\b\w+\b/g) || []).length > 0);
}

function transcriptToPieces({ sourceId, text, language, durationSec, title, chunkWords = 120 }) {
  const chunks = splitIntoChunks(text, chunkWords);
  if (chunks.length === 0) {
    return [{
      id: newId("piece"),
      source_id: sourceId,
      text: text.trim(),
      title: title || "Untitled",
      language,
      duration_sec: durationSec,
      created_at: new Date().toISOString(),
      metadata: {},
    }];
  }
  const totalWords = chunks.reduce((acc, c) => acc + (c.match(/\b\w+\b/g) || []).length, 0) || 1;
  return chunks.map((chunk, i) => {
    const w = (chunk.match(/\b\w+\b/g) || []).length;
    const dur = durationSec * (w / totalWords);
    return {
      id: newId("piece"),
      source_id: sourceId,
      text: chunk,
      title: `${title || "Transcript"} (part ${i + 1}/${chunks.length})`,
      language,
      duration_sec: Math.round(dur * 100) / 100,
      created_at: new Date().toISOString(),
      metadata: { chunk_index: i, total_chunks: chunks.length },
    };
  });
}

// Read raw body as Buffer with size cap.
function readRawBody(req, res, maxBytes = MAX_UPLOAD_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (c) => {
      total += c.length;
      if (total > maxBytes) {
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "payload_too_large" }));
        req.destroy();
        reject(new Error("payload_too_large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", (e) => reject(e));
  });
}

// Multipart/form-data parser (basic, for tests with a single file field).
function parseMultipart(buffer, boundary) {
  const text = buffer.toString("binary");
  const parts = text.split(`--${boundary}`);
  const fields = {};
  for (const p of parts) {
    if (!p || p === "--\r\n" || p === "--") continue;
    const headerEnd = p.indexOf("\r\n\r\n");
    if (headerEnd < 0) continue;
    const header = p.slice(0, headerEnd);
    let body = p.slice(headerEnd + 4);
    // Strip trailing \r\n before next boundary
    if (body.endsWith("\r\n")) body = body.slice(0, -2);
    // Parse Content-Disposition
    const cd = header.match(/Content-Disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]+)")?/i);
    if (!cd) continue;
    const name = cd[1];
    const filename = cd[2];
    if (filename) {
      // Re-encode body to Buffer (lossy for binary, but acceptable for our text)
      const buf = Buffer.from(body, "binary");
      fields[name] = { filename, data: buf, contentType: (header.match(/Content-Type:\s*([^\r\n]+)/i) || [])[1] || "application/octet-stream" };
    } else {
      fields[name] = { data: Buffer.from(body, "utf-8") };
    }
  }
  return fields;
}

export function buildServer({ port = DEFAULT_PORT, host = DEFAULT_HOST, store = null, transcribeFn = null, secret = JWT_SECRET } = {}) {
  const pieceStore = store || new PieceStore();
  const transcribe = transcribeFn || (async () => {
    throw new Error("no transcribeFn configured; set OPENAI_API_KEY or inject a mock");
  });
  const auth = secret ? authMiddleware(secret) : null;
  const rateLimiter = new RateLimiter({ max: 60, windowMs: 60_000 });
  const cors = corsHeaders();

  const PUBLIC_ROUTES = new Set(["GET /health", "GET /formats"]);

  const server = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

    const url = req.url.split("?")[0];
    const key = `${req.method} ${url}`;

    // Auth: skip for public routes
    if (!PUBLIC_ROUTES.has(key) && auth) {
      await new Promise((r) => auth(req, res, r));
      if (res.writableEnded) return;
    }

    // Rate limit API endpoints (60/min per IP)
    if (url !== "/health" && url !== "/version") {
      const rlKey = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "global").toString().split(",")[0].trim();
      const rl = rateLimiter.check(rlKey);
      res.setHeader("X-RateLimit-Limit", "60");
      res.setHeader("X-RateLimit-Remaining", String(Math.max(0, 60 - rl.count)));
      if (!rl.allowed) {
        res.setHeader("Retry-After", String(Math.ceil(rl.retryAfterMs / 1000)));
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "rate_limited", message: "too many requests" }));
        return;
      }
    }

    try {
      // ---- public ----
      if (req.method === "GET" && url === "/health") {
        return json(res, 200, { status: "ok", agent: "ingest", pieces: pieceStore.size() });
      }
      if (req.method === "GET" && url === "/formats") {
        return json(res, 200, { formats: KNOWN_FORMATS });
      }

      // ---- pieces store ----
      if (req.method === "GET" && url === "/pieces") {
        return json(res, 200, { pieces: pieceStore.all() });
      }
      if (req.method === "GET" && url.startsWith("/pieces/by-source/")) {
        const sourceId = decodeURIComponent(url.split("/").pop());
        return json(res, 200, { pieces: pieceStore.bySource(sourceId) });
      }

      // ---- ingest: text directly ----
      if (req.method === "POST" && url === "/ingest/text") {
        let body; try { body = await readJsonBody(req, res); } catch { return; }
        const text = (body.text || "").trim();
        if (!text) return json(res, 400, { error: "missing_text" });
        if (text.length > MAX_TEXT_BYTES) return json(res, 413, { error: "text_too_large" });
        const sourceId = body.source_id || `manual_${Date.now()}`;
        const language = body.language || "en";
        const pieces = transcriptToPieces({
          sourceId,
          text,
          language,
          durationSec: body.duration_sec || 0,
          title: body.title || "",
          chunkWords: body.chunk_words || 120,
        });
        pieceStore.addAll(pieces);
        return json(res, 201, { source_id: sourceId, pieces });
      }

      // ---- transcribe (multipart upload) ----
      if (req.method === "POST" && url === "/transcribe") {
        const ctype = req.headers["content-type"] || "";
        const m = ctype.match(/^multipart\/form-data;\s*boundary=(.+)$/i);
        if (!m) return json(res, 400, { error: "expected_multipart" });
        let body; try { body = await readRawBody(req, res); } catch { return; }
        const fields = parseMultipart(body, m[1]);
        const file = fields.file;
        if (!file || !file.data || !file.data.length) {
          return json(res, 400, { error: "missing_file" });
        }
        const format = detectFormat(file.filename || "audio.mp3");
        if (!format) return json(res, 415, { error: "unsupported_format", filename: file.filename });
        if (!sizeWithinLimits(file.data.length, format.category)) {
          return json(res, 413, { error: "file_too_large", size: file.data.length, limit: format.category });
        }
        if (format.category === "text") {
          const text = file.data.toString("utf-8");
          const pieces = transcriptToPieces({
            sourceId: file.filename,
            text,
            language: "en",
            durationSec: 0,
            title: file.filename,
          });
          pieceStore.addAll(pieces);
          return json(res, 201, { source_id: file.filename, pieces, format });
        }
        // Audio or video: transcribe
        const language = fields.language?.data?.toString("utf-8") || null;
        const sourceId = (fields.source_id?.data?.toString("utf-8")) || file.filename;
        const title = (fields.title?.data?.toString("utf-8")) || file.filename;
        let result;
        try {
          result = await transcribe(file.filename, file.data, { language, sourceId, title });
        } catch (e) {
          return json(res, 502, { error: "transcription_failed", message: e.message });
        }
        const pieces = transcriptToPieces({
          sourceId,
          text: result.text,
          language: result.language || "en",
          durationSec: result.duration_sec || 0,
          title,
        });
        pieceStore.addAll(pieces);
        return json(res, 201, {
          source_id: sourceId,
          transcript: {
            text: result.text,
            language: result.language,
            duration_sec: result.duration_sec,
            cost_cents: result.cost_cents,
            segments: result.segments || [],
          },
          pieces,
          format,
        });
      }

      return json(res, 404, { error: "not_found", path: url });
    } catch (e) {
      if (res.writableEnded) return;
      json(res, 500, { error: "server_error", message: e.message });
    }
  });

  return { server, port, host, store: pieceStore };
}

export function start(opts = {}) {
  const { server, port, host } = buildServer(opts);
  server.listen(port, host, () => {
    console.log(`[ingest] listening on http://${host}:${port}`);
  });
  return server;
}

if (false && import.meta.url === `file://${process.argv[1]}`) {
  start();
}
