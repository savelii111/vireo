"""HTTP server for Style Learner agent.

Exposes:
  POST /analyze       — rule-based analyze a corpus, return StyleDNA
  POST /analyze-llm   — LLM-enhanced analyze (deeper, requires LLM client)
  POST /hooks         — extract hooks from a single piece
  POST /suggest       — suggest hooks for an existing StyleDNA
  GET  /health        — health check
  GET  /version       — version info
"""
from __future__ import annotations
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from .analyzer import StyleAnalyzer
from .hooks import extract_hooks, extract_ctas, suggest_hooks_for_dna
from .llm_client import MockLLMClient, OpenAIClient
from .llm_enhanced import LLMEnhancedStyleLearner

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


def _make_llm_client(req: dict[str, Any]):
    """Pick the LLM client based on request + env.

    Priority (was confusing; now explicit):
      1. req.use_openai is truthy AND OPENAI_API_KEY is set → OpenAI
      2. OPENAI_API_KEY is set in env (auto-promote) → OpenAI
         This is the "env propagation" fix: previously, callers had to
         explicitly send use_openai:true. Now if the env has the key, we
         use OpenAI automatically. Tests that want mock must send
         use_mock:true.
      3. req.use_mock OR default → MockLLMClient
    """
    if req.get("use_openai") and os.environ.get("OPENAI_API_KEY"):
        return OpenAIClient(api_key=os.environ["OPENAI_API_KEY"])
    # Env propagation: if OPENAI_API_KEY is set, prefer OpenAI over mock
    # unless the caller explicitly opts into mock with use_mock:true.
    if os.environ.get("OPENAI_API_KEY") and not req.get("use_mock", False):
        return OpenAIClient(api_key=os.environ["OPENAI_API_KEY"])
    return MockLLMClient()


class StyleLearnerHandler(BaseHTTPRequestHandler):
    server_version = "VireoStyleLearner/0.2.0"

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[style-learner] {self.address_string()} {fmt % args}")

    def _check_auth(self) -> bool:
        """Check JWT auth. Returns True if authorized, False if 401 sent."""
        if require_auth is None or not JWT_SECRET:
            return True
        claims = require_auth(self, JWT_SECRET)
        return claims is not None

    def do_GET(self) -> None:
        if self.path == "/health":
            _json(self, 200, {"status": "ok", "agent": "style-learner", "version": "0.2.0"})
        elif self.path == "/version":
            _json(self, 200, {"version": "0.2.0", "agent": "style-learner"})
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

        if self.path == "/analyze":
            pieces = data.get("pieces", [])
            user_id = data.get("user_id", "anonymous")
            dna = StyleAnalyzer().analyze_corpus(pieces, user_id)
            _json(self, 200, {
                "ok": True,
                "style_dna": dna.to_dict(),
                "engine": "rule-based",
                "version": "0.2.0",
            })
            return

        if self.path == "/analyze-llm":
            pieces = data.get("pieces", [])
            user_id = data.get("user_id", "anonymous")
            llm = _make_llm_client(data)
            learner = LLMEnhancedStyleLearner(llm=llm)
            dna = learner.analyze_corpus(pieces, user_id)
            _json(self, 200, {
                "ok": True,
                "style_dna": dna.to_dict(),
                "engine": "llm-enhanced",
                "llm_calls": getattr(llm, "call_count", 0),
                "version": "0.2.0",
            })
            return

        if self.path == "/hooks":
            text = data.get("text", "")
            title = data.get("title", "")
            _json(self, 200, {
                "ok": True,
                "hooks": extract_hooks(text, title),
                "ctas": extract_ctas(text),
            })
            return

        if self.path == "/suggest":
            dna = data.get("style_dna", {})
            n = int(data.get("n", 5))
            _json(self, 200, {
                "ok": True,
                "suggestions": suggest_hooks_for_dna(dna, n),
            })
            return

        _json(self, 404, {"error": "not_found", "path": self.path})


def create_app(host: str = "127.0.0.1", port: int = 8001) -> ThreadingHTTPServer:
    return ThreadingHTTPServer((host, port), StyleLearnerHandler)


def run(host: str = "127.0.0.1", port: int = 8001) -> None:
    server = create_app(host, port)
    print(f"[style-learner] listening on http://{host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("[style-learner] shutting down")
        server.server_close()


if __name__ == "__main__":
    run()
