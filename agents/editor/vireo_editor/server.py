"""HTTP server for Editor agent."""
from __future__ import annotations
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from .editor import Editor

# Optional JWT auth
try:
    from vireo_shared.jwt_auth import require_auth
except ImportError:
    require_auth = None  # type: ignore[assignment]

JWT_SECRET = os.environ.get("VIREO_JWT_SECRET", "")


def _json(handler: BaseHTTPRequestHandler, status: int, payload: Any) -> None:
    body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.end_headers()
    handler.wfile.write(body)


def _read_body(handler: BaseHTTPRequestHandler) -> dict[str, Any]:
    length = int(handler.headers.get("Content-Length", "0") or "0")
    if not length:
        return {}
    raw = handler.rfile.read(length)
    try:
        return json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid JSON: {e}") from e


class EditorHandler(BaseHTTPRequestHandler):
    server_version = "VireoEditor/0.1.0"

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[editor] {self.address_string()} {fmt % args}")

    def _check_auth(self) -> bool:
        """Check JWT auth. Returns True if authorized, False if 401 sent."""
        if require_auth is None or not JWT_SECRET:
            return True
        claims = require_auth(self, JWT_SECRET)
        return claims is not None

    def do_GET(self) -> None:
        if self.path == "/health":
            _json(self, 200, {"status": "ok", "agent": "editor"})
        elif self.path == "/version":
            _json(self, 200, {"version": "0.1.0", "agent": "editor"})
        else:
            _json(self, 404, {"error": "not_found", "path": self.path})

    def do_POST(self) -> None:
        try:
            if not self._check_auth():
                return
            data = _read_body(self)
        except ValueError as e:
            _json(self, 400, {"error": "bad_json", "message": str(e)})
            return

        if self.path == "/edit":
            content = data.get("content", {})
            style_dna = data.get("style_dna", {})
            target = float(data.get("target_sec", 60.0))
            plan = Editor().edit(content, style_dna, target)
            _json(self, 200, {"ok": True, "edit_plan": plan.__dict__})
            return

        if self.path == "/hooks":
            style_dna = data.get("style_dna", {})
            n = int(data.get("n", 3))
            _json(self, 200, {
                "ok": True,
                "hooks": Editor().generate_hooks_for(style_dna, n),
                "ctas": Editor().generate_ctas_for(style_dna, n),
            })
            return

        if self.path == "/score":
            sentence = data.get("sentence", "")
            position = int(data.get("position", -1))
            total = int(data.get("total", 0))
            style_dna = data.get("style_dna", {})
            from .scorer import score_sentence
            s = score_sentence(sentence, position=position, total=total, style_dna=style_dna)
            _json(self, 200, {"ok": True, "score": round(s, 3)})
            return

        _json(self, 404, {"error": "not_found", "path": self.path})


def create_app(host: str = "127.0.0.1", port: int = 8002) -> ThreadingHTTPServer:
    return ThreadingHTTPServer((host, port), EditorHandler)


def run(host: str = "127.0.0.1", port: int = 8002) -> None:
    server = create_app(host, port)
    print(f"[editor] listening on http://{host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("[editor] shutting down")
        server.server_close()


if __name__ == "__main__":
    run()
