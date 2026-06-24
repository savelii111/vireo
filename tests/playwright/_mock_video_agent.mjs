// Phase 0: minimal TUS video-agent mock for the e2e test.
// The real video agent (PID 5760) uses an empty JWT
// secret and rejects our signed token, so the test owns
// the upload endpoint. This mock implements only the
// methods Studio's TUS proxy uses: POST (create), PATCH
// (write chunk), HEAD (offset), plus /ingest. It accepts
// any token, writes bytes to a temp file, and returns
// the protocol headers Studio expects.
import { createServer } from "node:http";
import { writeFileSync, statSync, mkdirSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const MOCK_TMP_DIR = mkdtempSync(path.join(tmpdir(), "vireo-mock-video-"));
const tmp = MOCK_TMP_DIR;
const uploads = new Map();

export async function mockVideoAgent() {
  const srv = createServer((req, res) => {
    const url = req.url.split("?")[0];
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Tus-Resumable": "1.0.0",
        "Tus-Version": "1.0.0",
        "Tus-Max-Size": String(8 * 1024 * 1024),
        "Tus-Extension": "creation,creation-with-upload,termination",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, HEAD, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type, Upload-Length, Upload-Offset, Upload-Metadata, Content-Range, Tus-Resumable",
        "Access-Control-Expose-Headers": "Location, Upload-Offset, Tus-Resumable",
      });
      return res.end();
    }
    if (url === "/upload/resumable" && req.method === "POST") {
      const len = Number(req.headers["upload-length"] || 0);
      const id = "u_" + Math.random().toString(36).slice(2, 10);
      const file = path.join(tmp, id + ".mp4");
      uploads.set(id, { file, len, offset: 0 });
      res.writeHead(201, {
        Location: "/upload/resumable/" + id,
        "Upload-Offset": "0",
        "Tus-Resumable": "1.0.0",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Expose-Headers": "Location, Upload-Offset",
      });
      return res.end();
    }
    const m = url.match(/^\/upload\/resumable\/([^/]+)(?:\/ingest)?$/);
    if (m) {
      const id = m[1];
      const u = uploads.get(id);
      if (!u) {
        res.writeHead(404).end();
        return;
      }
      if (req.method === "HEAD") {
        try {
          const st = statSync(u.file);
          res.writeHead(200, {
            "Upload-Offset": String(st.size),
            "Tus-Resumable": "1.0.0",
            "Upload-Length": String(u.len),
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Expose-Headers": "Upload-Offset, Upload-Length, Tus-Resumable",
          });
        } catch {
          res.writeHead(404).end();
        }
        return res.end();
      }
      if (req.method === "PATCH") {
        const off = Number(req.headers["upload-offset"] || 0);
        if (off !== u.offset) {
          res.writeHead(409, { "Content-Type": "text/plain" });
          return res.end("offset mismatch");
        }
        const chunks = [];
        let received = 0;
        req.on("data", (c) => {
          chunks.push(c);
          received += c.length;
        });
        req.on("end", () => {
          const buf = Buffer.concat(chunks);
          // Append to file
          let existing = Buffer.alloc(0);
          if (existsSync(u.file)) existing = readFileSync(u.file);
          const out = Buffer.concat([existing, buf]);
          writeFileSync(u.file, out);
          u.offset += buf.length;
          res.writeHead(204, {
            "Upload-Offset": String(u.offset),
            "Tus-Resumable": "1.0.0",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Expose-Headers": "Upload-Offset",
          });
          res.end();
        });
        return;
      }
      if (url.endsWith("/ingest") && req.method === "GET") {
        // Stub: return metadata that lets the asset register
        // successfully. Studio does its own ffprobe in the
        // /ingest handler so this mock only has to return a
        // valid response shape.
        const ffmpeg = (() => {
          // Inline ffprobe-lite: read file size and return
          // dummy duration. The real test exercises the
          // upload path, not the encode path.
          try {
            const st = statSync(u.file);
            return { size: st.size, duration_sec: 5.0, width: 1280, height: 720, fps: 30 };
          } catch {
            return { size: 0, duration_sec: 5.0, width: 1280, height: 720, fps: 30 };
          }
        })();
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        });
        // Studio's waitForIngest (MediaPanel.tsx) polls until
        // result.real_decode === true. Studio wraps our body
        // as {ok:true, result: <our body>}, and the client
        // unwraps once: body.result || body. So we need
        // real_decode at the TOP of the body we return, not
        // buried under another .result. We also include all
        // the asset fields the client posts to /api/assets
        // when it registers the asset record.
        res.end(JSON.stringify({
          ok: true,
          real_decode: true,
          status: "ready",
          id,
          upload_id: id,
          filename: "sample_5s.mp4",
          file_path: u.file,
          storage_path: u.file,
          duration_sec: ffmpeg.duration_sec,
          duration: ffmpeg.duration_sec,
          width: ffmpeg.width,
          height: ffmpeg.height,
          fps: ffmpeg.fps,
          video_codec: "h264",
          codec: "h264",
          container: "mp4",
        }));
        return;
      }
    }
    res.writeHead(404).end();
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const port = srv.address().port;
  const url = "http://127.0.0.1:" + port;
  console.log("[mock-video-agent] listening on", url, "tmp:", tmp);
  return url;
}
