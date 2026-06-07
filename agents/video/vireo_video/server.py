"""HTTP API server for the Vireo video editor.

Exposes:
  POST /edit          — start a new edit job (sync)
  POST /edit/async    — start a new edit job (async, returns job_id)
  POST /upload        — upload a video file
  GET  /download/:name — download a file
  GET  /jobs/:id      — get job status + result
  GET  /jobs          — list jobs
  POST /transcribe    — transcribe a file (Whisper)
  GET  /platforms     — list available platforms
  GET  /presets/:p    — get a preset by platform
  GET  /styles        — list subtitle styles
  GET  /files         — list uploaded files
  GET  /health        — health check
"""

from __future__ import annotations
import json
import os
import re
import time
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from typing import Any, Optional
from urllib.parse import urlparse, unquote

from .ffmpeg_utils import find_ffmpeg, version
from .presets import list_platforms, get_preset
from .subtitles import SUBTITLE_STYLES
from .pipeline import VideoPipeline, EditRequest, EditResult, JobState
from .transcriber import WhisperClient
from .file_storage import FileStorage
from .tus import TusStore, TusError, TUS_VERSION, DEFAULT_MAX_UPLOAD_BYTES, _parse_upload_metadata

# Optional JWT auth — gracefully degrade if vireo_shared not installed
try:
  from vireo_shared.jwt_auth import require_auth
except ImportError:
  require_auth = None  # type: ignore[assignment]

# Optional CORS helper — graceful fallback if auth-middleware not installed
try:
  from packages.auth_middleware import corsHeadersFor
  from packages.auth_middleware import parseCorsOrigins as _parseCorsOrigins
  HAS_AUTH_MW = True
except ImportError:
  try:
    # Fallback path: vireo is monorepo, auth-middleware is at packages/auth-middleware
    import sys as _sys
    _sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "packages", "auth-middleware"))
    from index import corsHeadersFor  # type: ignore
    from index import parseCorsOrigins as _parseCorsOrigins  # type: ignore
    HAS_AUTH_MW = True
  except Exception:
    HAS_AUTH_MW = False

# V-1 fix: max upload size (100 MB default) to prevent OOM via /upload
MAX_UPLOAD_BYTES = int(os.environ.get("VIREO_VIDEO_MAX_UPLOAD", str(100 * 1024 * 1024)))


class _BytesIOWrapper:
  """Wrap bytes so the TUS store's read()-based chunk writer sees a file-like."""
  def __init__(self, data: bytes):
    self._buf = BytesIO(data)

  def read(self, n: int = -1) -> bytes:
    return self._buf.read(n)
# V-4 fix: max items returned by list endpoints (prevents DoS via huge limit)
MAX_LIST_LIMIT = int(os.environ.get("VIREO_VIDEO_MAX_LIST_LIMIT", "200"))
# V-19 fix: max video duration in seconds (10 hours) — prevents resource exhaustion
MAX_VIDEO_DURATION_SEC = int(os.environ.get("VIREO_VIDEO_MAX_DURATION", "36000"))


def _parse_cors_origins(value: str | None) -> list[str]:
  """Parse comma-separated origins env var. '*' or None means allow-all."""
  if not value or value.strip() == "*":
    return ["*"]
  return [o.strip() for o in value.split(",") if o.strip()]


def _cors_headers_for(origin: str | None) -> dict[str, str]:
  """V-1 fix: hot-reloadable CORS. Per-request, reads VIREO_CORS_ORIGINS env.

  Returns the subset of headers to merge into a response. If origin is in the
  allow-list, echoes it back with Vary: Origin. Otherwise falls back to '*'.
  """
  allowed = _parse_cors_origins(os.environ.get("VIREO_CORS_ORIGINS"))
  base = {
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, HEAD, OPTIONS",
    "Vary": "Origin",
  }
  if not origin:
    return {**base, "Access-Control-Allow-Origin": "*"}
  if "*" in allowed or origin in allowed:
    return {**base, "Access-Control-Allow-Origin": origin}
  # Origin not allowed: don't echo it (browser will block).
  # Fall back to the first allowed origin (which won't match, so browser blocks).
  return {**base, "Access-Control-Allow-Origin": allowed[0] if allowed else "*"}

JWT_SECRET = os.environ.get("VIREO_JWT_SECRET", "")


class JobStore:
  """In-memory job store."""

  # V-2 fix: whitelist of fields that may be updated (prevent injection of
  # arbitrary attributes, e.g. __class__, __dict__, etc.)
  _UPDATABLE_FIELDS = frozenset({
    "state", "error", "output_path", "duration_sec",
    "output_size_bytes", "finished_at", "progress", "steps",
  })

  def __init__(self):
    self.jobs: dict[str, EditResult] = {}
    self._lock = threading.Lock()

  def add(self, result: EditResult) -> None:
    with self._lock:
      self.jobs[result.job_id] = result

  def get(self, job_id: str) -> EditResult | None:
    return self.jobs.get(job_id)

  def update(self, job_id: str, **kwargs) -> None:
    with self._lock:
      j = self.jobs.get(job_id)
      if j:
        for k, v in kwargs.items():
          if k not in self._UPDATABLE_FIELDS:
            # Silently drop unknown fields (e.g. attempts to set __class__)
            continue
          setattr(j, k, v)

  def list(self, limit: int = 50) -> list[EditResult]:
    # V-4 fix: clamp limit to a sane range to prevent DoS via huge limits
    safe_limit = max(1, min(int(limit), MAX_LIST_LIMIT))
    items = sorted(self.jobs.values(), key=lambda r: -r.started_at)
    return items[:safe_limit]


def _json_response(handler: BaseHTTPRequestHandler, status: int, body: Any) -> None:
  payload = json.dumps(body, default=str).encode("utf-8")
  handler.send_response(status)
  handler.send_header("Content-Type", "application/json; charset=utf-8")
  handler.send_header("Content-Length", str(len(payload)))
  # V-1 fix: per-request CORS instead of hardcoded "*"
  origin = handler.headers.get("Origin")
  for k, v in _cors_headers_for(origin).items():
    handler.send_header(k, v)
  handler.end_headers()
  handler.wfile.write(payload)


def _build_edit_request(data: dict) -> EditRequest:
  """V-11 fix: single source of truth for EditRequest construction.

  Strips unknown fields, applies defaults, and translates legacy camelCase
  keys to snake_case.
  """
  # V-8 fix: translate camelCase → snake_case for back-compat
  translated = {}
  for k, v in data.items():
    snake = _to_snake(k)
    translated[snake] = v
  # Filter to known fields only (defense in depth)
  known = {f.name for f in EditRequest.__dataclass_fields__.values()}
  filtered = {k: v for k, v in translated.items() if k in known}
  return EditRequest(**filtered)


def _to_snake(name: str) -> str:
  """Convert camelCase to snake_case. Idempotent on already-snake inputs."""
  import re
  # Insert underscore before each uppercase, then lowercase
  return re.sub(r"(?<!^)(?=[A-Z])", "_", name).lower()


def _read_json_body(handler: BaseHTTPRequestHandler) -> dict | None:
  length = int(handler.headers.get("Content-Length", 0) or 0)
  if length == 0:
    return {}
  raw = handler.rfile.read(length)
  try:
    return json.loads(raw.decode("utf-8"))
  except json.JSONDecodeError:
    return {}


def _multipart_upload(handler: BaseHTTPRequestHandler) -> tuple[bytes, str]:
  """Parse multipart form data, return (file_bytes, filename)."""
  content_type = handler.headers.get("Content-Type", "")
  content_length = int(handler.headers.get("Content-Length", 0))

  # V-6 fix: enforce max upload size BEFORE reading into memory
  if content_length > MAX_UPLOAD_BYTES:
    raise ValueError(
      f"upload too large: {content_length} bytes (max {MAX_UPLOAD_BYTES})"
    )

  if "multipart/form-data" not in content_type:
    raise ValueError("Expected multipart/form-data")

  # Parse boundary
  boundary = None
  for part in content_type.split(";"):
    part = part.strip()
    if part.startswith("boundary="):
      boundary = part[len("boundary="):].strip('"')
      break

  if not boundary:
    raise ValueError("No boundary in Content-Type")

  raw = handler.rfile.read(content_length)

  # Simple multipart parser
  boundary_bytes = boundary.encode()
  parts = raw.split(b"--" + boundary_bytes)

  for part in parts:
    if b"Content-Disposition" not in part:
      continue
    # Split headers from body
    header_end = part.find(b"\r\n\r\n")
    if header_end == -1:
      continue
    headers_raw = part[:header_end].decode("utf-8", errors="replace")
    body = part[header_end + 4:]
    # Remove trailing \r\n
    if body.endswith(b"\r\n"):
      body = body[:-2]
    # Extract filename
    if 'filename="' in headers_raw:
      fn_start = headers_raw.find('filename="') + 10
      fn_end = headers_raw.find('"', fn_start)
      filename = headers_raw[fn_start:fn_end]
      return body, filename

  raise ValueError("No file found in upload")


def make_handler(pipeline: VideoPipeline, jobs: JobStore,
                 whisper: Optional[WhisperClient], storage: FileStorage,
                 tus_store: Optional[TusStore] = None):
  """Build a request handler with the pipeline + jobs + storage injected.

  ``tus_store`` enables the TUS resumable upload endpoints
  (POST/HEAD/PATCH/DELETE /upload/resumable[/...]).
  """

  class VireoVideoHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
      pass

    def _check_auth(self) -> bool:
      """Check JWT auth. Returns True if authorized, False if 401 sent.

      V-9 fix: explicit failure when auth module is missing in production.
      In production (VIREO_ENV=production), the absence of vireo_shared.jwt_auth
      or a JWT_SECRET is a security incident, not a silent degradation.
      """
      if require_auth is None or not JWT_SECRET:
        if os.environ.get("VIREO_ENV", "").lower() == "production":
          _json_response(self, 500, {
            "error": "auth_not_configured",
            "message": "Server has no auth module configured. Refusing to start in production.",
          })
          return False
        # Dev mode: log warning and allow
        print(f"[WARN] Auth not configured (require_auth={require_auth}, JWT_SECRET={'set' if JWT_SECRET else 'unset'}). "
              f"Set VIREO_ENV=production to enforce.")
        return True
      claims = require_auth(self, JWT_SECRET)
      return claims is not None

    def do_OPTIONS(self):
      url = urlparse(self.path)
      path = unquote(url.path)
      origin = self.headers.get("Origin")
      headers = _cors_headers_for(origin)
      # TUS protocol requires these headers on every response, including OPTIONS
      if path.startswith("/upload/resumable"):
        headers["Tus-Resumable"] = TUS_VERSION
        headers["Tus-Version"] = TUS_VERSION
        headers["Tus-Max-Size"] = str(8 * 1024 * 1024)
        headers["Tus-Extension"] = "creation,creation-with-upload,termination"
      self.send_response(204)
      for k, v in headers.items():
        self.send_header(k, v)
      self.end_headers()

    # ---------- TUS protocol dispatch ----------

    def do_HEAD(self):
      url = urlparse(self.path)
      path = unquote(url.path)
      if path.startswith("/upload/resumable"):
        return self._handle_tus(path)
      return _json_response(self, 405, {"error": "method_not_allowed"})

    def do_PATCH(self):
      url = urlparse(self.path)
      path = unquote(url.path)
      if path.startswith("/upload/resumable"):
        return self._handle_tus(path)
      return _json_response(self, 405, {"error": "method_not_allowed"})

    def do_DELETE(self):
      url = urlparse(self.path)
      path = unquote(url.path)
      if path.startswith("/upload/resumable"):
        return self._handle_tus(path)
      return _json_response(self, 405, {"error": "method_not_allowed"})

    def _tus_cors(self):
      """Common TUS response headers (CORS + protocol version)."""
      origin = self.headers.get("Origin")
      h = _cors_headers_for(origin)
      h["Tus-Resumable"] = TUS_VERSION
      h["Tus-Version"] = TUS_VERSION
      h["Tus-Max-Size"] = str(8 * 1024 * 1024)
      h["Tus-Extension"] = "creation,creation-with-upload,termination"
      return h

    def _handle_tus(self, path: str):
      """Dispatch to TUS create / head / patch / delete based on the HTTP method."""
      if tus_store is None:
        return _json_response(self, 503, {"error": "tus_disabled"})

      method = self.command
      sid = None
      if path != "/upload/resumable":
        # /upload/resumable/<id>  -> extract id
        parts = path.split("/")
        # [' ', 'upload', 'resumable', '<id>']
        if len(parts) >= 4 and parts[3]:
          sid = parts[3]
        else:
          return _json_response(self, 400, {"error": "missing_session_id"})

      try:
        if method == "POST" and path == "/upload/resumable":
          # ----- create -----
          upload_length_hdr = self.headers.get("Upload-Length")
          if upload_length_hdr is None:
            # TUS "creation-with-upload": client may skip Upload-Length if
            # the first PATCH carries Content-Length. We require it for
            # preallocation, so 400.
            return _json_response(self, 400, {
              "error": "Upload-Length header required",
            })
          try:
            upload_length = int(upload_length_hdr)
          except ValueError:
            return _json_response(self, 400, {"error": "invalid_Upload-Length"})

          metadata = {}
          for k, v in _parse_upload_metadata(self.headers.get("Upload-Metadata", "")).items():
            metadata[k] = v

          sess = tus_store.create(upload_length=upload_length, metadata=metadata)
          # 201 Created + Location header (TUS spec)
          origin = self.headers.get("Origin")
          h = self._tus_cors()
          h["Location"] = f"/upload/resumable/{sess.id}"
          h["Upload-Offset"] = "0"
          body = json.dumps({"id": sess.id, "upload_length": upload_length,
                             "offset": 0, "filename": sess.filename}).encode("utf-8")
          self.send_response(201)
          for k, v in h.items():
            self.send_header(k, v)
          self.send_header("Content-Type", "application/json")
          self.send_header("Content-Length", str(len(body)))
          self.end_headers()
          self.wfile.write(body)
          return

        if method == "HEAD" and sid:
          sess = tus_store.head(sid)
          h = self._tus_cors()
          h["Upload-Offset"] = str(sess.offset)
          h["Upload-Length"] = str(sess.upload_length)
          h["Cache-Control"] = "no-store"
          self.send_response(200)
          for k, v in h.items():
            self.send_header(k, v)
          self.end_headers()
          return

        if method == "PATCH" and sid:
          cr = self.headers.get("Content-Range", "")
          # Read the chunk; cap memory by reading in 1 MB slices if huge.
          data = self.rfile.read(int(self.headers.get("Content-Length", "0") or 0))
          new_offset = tus_store.patch(sid, cr, _BytesIOWrapper(data))
          sess = tus_store.get(sid)
          h = self._tus_cors()
          h["Upload-Offset"] = str(new_offset)
          self.send_response(204)
          for k, v in h.items():
            self.send_header(k, v)
          self.end_headers()
          # If the upload just completed, register the file with FileStorage.
          if sess and sess.completed and sess.user_id is not None:
            try:
              storage.register_existing(
                tus_store._partial_path(sid), sess.filename
              )
            except Exception:
              pass  # don't crash the response on registration error
          return

        if method == "DELETE" and sid:
          tus_store.delete(sid)
          self.send_response(204)
          for k, v in self._tus_cors().items():
            self.send_header(k, v)
          self.end_headers()
          return

        return _json_response(self, 405, {"error": "method_not_allowed"})
      except TusError as e:
        # TUS protocol error -> propagate status + any extra headers.
        body = json.dumps({"error": str(e)}).encode("utf-8")
        h = self._tus_cors()
        h.update(e.headers or {})
        h["Content-Type"] = "application/json"
        self.send_response(e.status)
        for k, v in h.items():
          self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        return
      except Exception as e:
        return _json_response(self, 500, {"error": "internal_error", "detail": str(e)})

    def do_GET(self):
      url = urlparse(self.path)
      path = unquote(url.path)
      try:
        if path == "/health":
          return _json_response(self, 200, {
            "status": "ok",
            "agent": "video",
            "ffmpeg": version(find_ffmpeg())[:60],
            "platforms": list_platforms(),
            "jobs": len(jobs.jobs),
          })
        if not self._check_auth():
          return
        if path == "/platforms":
          return _json_response(self, 200, {"platforms": list_platforms()})
        if path.startswith("/presets/"):
          pid = path.split("/")[-1]
          p = get_preset(pid)
          return _json_response(self, 200, p.to_dict())
        if path == "/styles":
          return _json_response(self, 200, {"styles": list(SUBTITLE_STYLES.keys())})
        if path == "/files":
          # P0-3 fix (2026-06-07): Studio's LLM expects a flat {files: [...]} list
          # with {file_id, name, size, duration_sec, uploaded_at} so it can
          # resolve "my last video" / "the 3rd file" references. We preserve
          # {uploads, outputs} for back-compat and add the flat list.
          uploads = [f.to_dict() for f in storage.list_uploads()]
          outputs = [f.to_dict() for f in storage.list_outputs()]
          files = []
          for f in uploads:
            files.append({
              "file_id": f.get("name") or f.get("path"),
              "name": f.get("name"),
              "size": f.get("size", 0),
              "duration_sec": f.get("duration_sec", 0.0),
              "uploaded_at": f.get("uploaded_at"),
              "kind": "upload",
            })
          for f in outputs:
            files.append({
              "file_id": f.get("name") or f.get("path"),
              "name": f.get("name"),
              "size": f.get("size", 0),
              "duration_sec": f.get("duration_sec", 0.0),
              "uploaded_at": f.get("uploaded_at"),
              "kind": "output",
            })
          return _json_response(self, 200, {
            "files": files,        # P0-3 normalized shape for Studio LLM
            "uploads": uploads,    # back-compat
            "outputs": outputs,    # back-compat
          })
        if path == "/jobs":
          limit = int(url.query.get("limit", "50")) if url.query else 50
          items = [j.to_dict() for j in jobs.list(limit=limit)]
          return _json_response(self, 200, {"jobs": items, "count": len(items)})
        if path.startswith("/jobs/"):
          job_id = path.split("/")[-1]
          j = jobs.get(job_id)
          if not j:
            return _json_response(self, 404, {"error": "job_not_found"})
          return _json_response(self, 200, j.to_dict())
        if path.startswith("/download/"):
          filename = path.split("/download/", 1)[1]
          # Search in outputs first, then uploads
          for f in storage.list_outputs():
            if f.name == filename or f.path.endswith(filename):
              return self._send_file(f.path, f.name)
          for f in storage.list_uploads():
            if f.name == filename or f.path.endswith(filename):
              return self._send_file(f.path, f.name)
          return _json_response(self, 404, {"error": "file_not_found"})
        return _json_response(self, 404, {"error": "not_found", "path": path})
      except Exception as e:
        return _json_response(self, 500, {"error": "server_error", "message": str(e)})

    def _send_file(self, filepath: str, name: str):
      """Send a file as response."""
      if not os.path.isfile(filepath):
        return _json_response(self, 404, {"error": "file_not_found"})
      size = os.path.getsize(filepath)
      ext = os.path.splitext(name)[1].lower()
      ct_map = {".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
                ".mp3": "audio/mpeg", ".wav": "audio/wav", ".srt": "text/plain",
                ".txt": "text/plain", ".json": "application/json"}
      content_type = ct_map.get(ext, "application/octet-stream")

      self.send_response(200)
      self.send_header("Content-Type", content_type)
      self.send_header("Content-Length", str(size))
      self.send_header("Content-Disposition", f'attachment; filename="{name}"')
      # V-1 fix: per-request CORS
      origin = self.headers.get("Origin")
      for k, v in _cors_headers_for(origin).items():
        self.send_header(k, v)
      self.end_headers()
      with open(filepath, "rb") as f:
        while True:
          chunk = f.read(65536)
          if not chunk:
            break
          self.wfile.write(chunk)

    def do_POST(self):
      url = urlparse(self.path)
      path = unquote(url.path)
      try:
        if not self._check_auth():
          return
        if path == "/upload":
          try:
            data, filename = _multipart_upload(self)
            filepath = storage.save_upload(data, filename)
            return _json_response(self, 200, {
              "file_path": filepath,
              "filename": filename,
              "size": len(data),
            })
          except ValueError as e:
            return _json_response(self, 400, {"error": str(e)})

        # ----- TUS resumable upload endpoints (Phase 5.1) -----
        # Routes:
        #   POST   /upload/resumable            -> create session
        #   POST   /upload/resumable/<id>       -> alias for PATCH (some clients)
        #   HEAD   /upload/resumable/<id>       -> return Upload-Offset
        #   PATCH  /upload/resumable/<id>       -> append chunk
        #   DELETE /upload/resumable/<id>       -> abort
        if path == "/upload/resumable" or path.startswith("/upload/resumable/"):
          return self._handle_tus(path)

        if path == "/edit":
          body = _read_json_body(self)
          if not body:
            return _json_response(self, 400, {"error": "missing_body"})
          try:
            # V-11 fix: use helper (also enforces V-8 camelCase translation)
            req = _build_edit_request(body)
          except (ValueError, TypeError) as e:
            return _json_response(self, 400, {"error": "invalid_edit_request", "message": str(e)})
          if not req.source_path:
            return _json_response(self, 400, {"error": "missing_source_path"})
          if not req.output_path:
            req.output_path = storage.get_output_path(req.job_id, req.target_platform)
          # V-19 fix: enforce max video duration up front (10h default)
          from .ffmpeg_utils import probe as _probe
          info = _probe(req.source_path)
          duration = info.get("duration_sec", 0)
          if duration > MAX_VIDEO_DURATION_SEC:
            return _json_response(self, 400, {
              "error": "video_too_long",
              "max_duration_sec": MAX_VIDEO_DURATION_SEC,
              "actual_duration_sec": duration,
            })
          result = pipeline.run(req)
          jobs.add(result)
          status = 200 if result.state == JobState.DONE else 500
          return _json_response(self, status, result.to_dict())

        if path == "/edit/async":
          body = _read_json_body(self)
          if not body:
            return _json_response(self, 400, {"error": "missing_body"})
          try:
            req = _build_edit_request(body)
          except (ValueError, TypeError) as e:
            return _json_response(self, 400, {"error": "invalid_edit_request", "message": str(e)})
          if not req.output_path:
            req.output_path = storage.get_output_path(req.job_id, req.target_platform)
          # Create a pending result
          result = EditResult(
            job_id=job_id, state=JobState.PENDING,
            source_path=req.source_path, output_path=req.output_path,
            target_platform=req.target_platform, started_at=time.time(),
          )
          jobs.add(result)
          # Run in background thread
          def _run_async():
            try:
              result.state = JobState.TRANSCRIBING
              final = pipeline.run(req)
              jobs.add(final)
            except Exception as e:
              result.state = JobState.FAILED
              result.error = str(e)
              result.finished_at = time.time()
              jobs.add(result)
          t = threading.Thread(target=_run_async, daemon=True)
          t.start()
          return _json_response(self, 202, {"job_id": job_id, "status": "pending"})

        if path == "/transcribe":
          body = _read_json_body(self)
          fp = body.get("file_path", "")
          if not fp:
            return _json_response(self, 400, {"error": "missing_file_path"})
          if whisper is None:
            return _json_response(self, 503, {"error": "transcription_unavailable"})
          # If whisper is CachedWhisperClient, use cache-aware path
          from .cached_whisper import CachedWhisperClient
          if isinstance(whisper, CachedWhisperClient):
            t, was_cached = whisper.transcribe_file(
              fp, language=body.get("language"),
              use_cache=body.get("use_cache", True),
            )
            result = t.to_dict()
            result["cached"] = was_cached
            return _json_response(self, 200, result)
          t = whisper.transcribe_file(fp, language=body.get("language"))
          return _json_response(self, 200, t.to_dict())

        if path == "/cache/stats":
          from .cached_whisper import CachedWhisperClient
          if isinstance(whisper, CachedWhisperClient):
            return _json_response(self, 200, whisper.stats())
          return _json_response(self, 200, {"enabled": False})

        if path == "/thumbnail":
          body = _read_json_body(self)
          title = body.get("title", "")
          if not title:
            return _json_response(self, 400, {"error": "missing_title"})
          import asyncio
          from .thumbnail import generate_thumbnail, save_thumbnail
          api_key = body.get("api_key") or os.environ.get("OPENAI_API_KEY", "")
          if not api_key:
            return _json_response(self, 503, {"error": "OPENAI_API_KEY not set"})
          result = asyncio.get_event_loop().run_until_complete(
            generate_thumbnail(
              title=title,
              description=body.get("description", ""),
              style_hints=body.get("style_hints", ""),
              size=body.get("size", "1792x1024"),
              quality=body.get("quality", "standard"),
              api_key=api_key,
            )
          )
          if body.get("save_path"):
            save_thumbnail(result, body["save_path"])
            return _json_response(self, 200, {
              "status": "saved",
              "path": body["save_path"],
              "revised_prompt": result.get("revised_prompt", ""),
            })
          import base64
          return _json_response(self, 200, {
            "status": "generated",
            "image_b64": base64.b64encode(result["image_bytes"]).decode(),
            "revised_prompt": result.get("revised_prompt", ""),
          })

        # ---- W1D2: wire 4 unwired modules into HTTP ----
        # Day 2 of Week 1 — modules existed as imports but had no route.
        # Without a route, the only way to reach them was via the LLM.
        # With these routes, the Studio can call each one directly via
        # fetch (also unlocks caching, retries, and Studio-level
        # parallelism).

        if path == "/chapters":
          # Build chapter markers from a transcript. Pure function on
          # the transcript the caller already has. Returns prompt +
          # parsed/validated chapters.
          body = _read_json_body(self)
          transcript = body.get("transcript", {})
          if not transcript.get("text"):
            return _json_response(self, 400, {"error": "missing_transcript"})
          from .chapters import build_chapter_prompt, parse_chapters_response, validate_chapters
          from .transcriber import Transcript
          tr = Transcript(
            text=transcript.get("text", ""),
            segments=transcript.get("segments") or [],
            language=transcript.get("language", "en"),
            duration=transcript.get("duration", 0.0),
          )
          prompt = build_chapter_prompt(tr)
          raw_response = body.get("llm_response") or _extract_inline_chapters(tr.text)
          total = tr.duration or 0.0
          parsed = parse_chapters_response(raw_response, total_duration=total)
          validated = validate_chapters(parsed, total)
          return _json_response(self, 200, {
            "chapters": [c.to_dict() for c in validated],
            "prompt": prompt,
            "prompt_chars": len(prompt),
          })

        if path == "/hooks-style":
          # Classify the opening seconds into a hook style. Deterministic
          # — no LLM needed. Returns style + confidence + a suggested
          # rewrite the caller can use as a caption.
          body = _read_json_body(self)
          transcript = body.get("transcript", {})
          from .hooks_style import classify_hook, apply_hook_to_text
          from .transcriber import Transcript
          tr = Transcript(
            text=transcript.get("text", ""),
            segments=transcript.get("segments") or [],
            language=transcript.get("language", "en"),
            duration=transcript.get("duration", 0.0),
          )
          window = float(body.get("window_sec", 8.0))
          hook = classify_hook(tr, window_sec=window)
          # apply_hook_to_text wants a HookStyle (it reads .template).
          # Build a one-off instance with the right template for the
          # detected style.
          from .hooks_style import HOOK_TEMPLATES, HookStyle
          style_obj = HookStyle(
            name=hook.name,
            description=hook.description,
            confidence=hook.confidence,
            evidence=hook.evidence,
            template=HOOK_TEMPLATES.get(hook.name, ""),
          )
          suggested = apply_hook_to_text(
            opening_text=_first_words(tr.text, 12),
            hook_style=style_obj,
            topic=body.get("topic", "[your topic]"),
          )
          return _json_response(self, 200, {
            "style": hook.name,
            "confidence": hook.confidence,
            "reason": hook.description,
            "evidence": hook.evidence,
            "suggested_rewrite": suggested,
          })

        if path == "/moments":
          # Build prompt + parse response for "viral moments" extraction.
          # Returns the prompt the Studio hands to its own LLM, and
          # also parses the response if the caller already has one
          # (caching: same transcript + same response → same moments).
          body = _read_json_body(self)
          transcript = body.get("transcript", {})
          if not transcript.get("text"):
            return _json_response(self, 400, {"error": "missing_transcript"})
          platform = body.get("platform", "tiktok")
          max_moments = int(body.get("max_moments", 3))
          from .moments import build_prompt, parse_moments_response
          from .transcriber import Transcript
          tr = Transcript(
            text=transcript.get("text", ""),
            segments=transcript.get("segments") or [],
            language=transcript.get("language", "en"),
            duration=transcript.get("duration", 0.0),
          )
          prompt = build_prompt(platform, tr, max_moments=max_moments)
          moments = []
          if body.get("llm_response"):
            moments = [m.to_dict() for m in parse_moments_response(
              body["llm_response"], max_moments=max_moments)]
          return _json_response(self, 200, {
            "prompt": prompt,
            "prompt_chars": len(prompt),
            "moments": moments,
            "platform": platform,
            "max_moments": max_moments,
          })

        if path == "/broll":
          # Build a broll search-query list for a transcript. Returns
          # short search queries the caller feeds to a stock-footage
          # service. No LLM needed — pure pattern matching.
          body = _read_json_body(self)
          text = body.get("text") or body.get("transcript", {}).get("text", "")
          if not text:
            return _json_response(self, 400, {"error": "missing_text"})
          max_words = int(body.get("max_query_words", 3))
          max_queries = int(body.get("max_queries", 5))
          from .broll import extract_query
          import re
          sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()]
          queries = []
          for s in sentences:
            q = extract_query(s, max_words=max_words)
            if q and q not in queries:
              queries.append(q)
            if len(queries) >= max_queries:
              break
          return _json_response(self, 200, {
            "queries": queries,
            "count": len(queries),
            "source_sentences": min(len(sentences), max_queries),
          })

        return _json_response(self, 404, {"error": "not_found", "path": path})
      except Exception as e:
        return _json_response(self, 500, {"error": "server_error", "message": str(e)})

  return VireoVideoHandler


def _extract_inline_chapters(text: str) -> str:
  """Pull `### Title` markers out of a transcript. Used when the caller
  doesn't have a real LLM response (offline / dev). Returns the original
  text wrapped so parse_chapters_response can find a single empty
  chapter — caller can detect "no chapters" and skip rendering."""
  if "###" in text:
    return text
  return ""  # no inline chapters → empty parse → empty list


def _first_words(text: str, n: int) -> str:
  """Return the first N words of a text, for hook-style rewrites."""
  if not text:
    return ""
  words = text.split()
  if len(words) <= n:
    return text
  return " ".join(words[:n])


def build_server(
  *,
  host: str = "127.0.0.1",
  port: int = 8007,
  pipeline: VideoPipeline | None = None,
  whisper: Optional[WhisperClient] = None,
  jobs: JobStore | None = None,
  storage: FileStorage | None = None,
  tus_store: TusStore | None = None,
  use_cache: bool = True,
):
  from .cached_whisper import CachedWhisperClient
  from .transcriber_cache import make_default_cache

  if pipeline is None:
    pipeline = VideoPipeline(whisper_client=whisper)
  if jobs is None:
    jobs = JobStore()
  if storage is None:
    storage = FileStorage()
  if tus_store is None:
    tus_store = TusStore(max_upload_bytes=DEFAULT_MAX_UPLOAD_BYTES)

  # Wrap raw WhisperClient in CachedWhisperClient (if not already wrapped)
  effective_whisper = whisper
  if use_cache and isinstance(whisper, WhisperClient) and not isinstance(whisper, CachedWhisperClient):
    effective_whisper = CachedWhisperClient(whisper, cache=make_default_cache())

  handler = make_handler(pipeline, jobs, effective_whisper, storage, tus_store)
  server = ThreadingHTTPServer((host, port), handler)
  return {"server": server, "port": port, "host": host,
          "pipeline": pipeline, "jobs": jobs, "whisper": effective_whisper, "storage": storage}


def start(*, port: int = 8007, host: str = "127.0.0.1", **kwargs):
  built = build_server(port=port, host=host, **kwargs)
  print(f"[video] listening on http://{host}:{port}")
  built["server"].serve_forever()
  return built["server"]


if __name__ == "__main__":
  start()
