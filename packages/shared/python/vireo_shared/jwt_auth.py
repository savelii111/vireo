"""HS256 JWT verification — zero dependencies, stdlib only.

Usage:
    from vireo_shared.jwt_auth import verify_token, extract_bearer

    claims = verify_token(token, secret)
    if claims is None:
        return 401

    user_id = claims.get("sub")
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import Any


class JWTError(Exception):
    """Raised when JWT verification fails."""


def _b64url_decode(s: str) -> bytes:
    s = s.replace("-", "+").replace("_", "/")
    pad = 4 - len(s) % 4
    if pad != 4:
        s += "=" * pad
    return base64.b64decode(s)


def _b64url_encode(data: bytes) -> str:
    return base64.b64encode(data).rstrip(b"=").decode("ascii").replace("+", "-").replace("/", "_")


def verify_token(token: str, secret: str, clock_skew_sec: int = 30) -> dict[str, Any] | None:
    """Verify an HS256 JWT. Returns claims dict or None on failure."""
    if not token or not secret:
        return None
    parts = token.split(".")
    if len(parts) != 3:
        return None
    header_b64, payload_b64, sig_b64 = parts

    # Verify signature
    data = f"{header_b64}.{payload_b64}".encode("ascii")
    expected = hmac.new(secret.encode("ascii"), data, hashlib.sha256).digest()
    expected_b64 = _b64url_encode(expected)

    if not hmac.compare_digest(expected_b64, sig_b64):
        return None

    # Decode payload
    try:
        payload_bytes = _b64url_decode(payload_b64)
        payload = json.loads(payload_bytes.decode("utf-8"))
    except Exception:
        return None

    # Check expiry
    exp = payload.get("exp")
    if exp is not None:
        now = int(time.time())
        if now > exp + clock_skew_sec:
            return None

    return payload


def extract_bearer(headers: dict[str, str]) -> str | None:
    """Extract the token from an Authorization: Bearer <token> header.

    Accepts both HTTP-style header dicts and Python http.server
    request.headers (which support .get()).
    """
    auth = None
    if hasattr(headers, "get"):
        auth = headers.get("Authorization") or headers.get("authorization")
    elif isinstance(headers, dict):
        auth = headers.get("Authorization") or headers.get("authorization")
    if not auth or not isinstance(auth, str):
        return None
    if not auth.lower().startswith("bearer "):
        return None
    token = auth[7:].strip()
    return token if token else None


def require_auth(handler, secret: str) -> dict[str, Any] | None:
    """Check Authorization header on an http.server request handler.

    Returns claims dict on success, or sends 401 response and returns None.
    """
    token = extract_bearer(handler.headers)
    if not token:
        handler.send_response(401)
        handler.send_header("Content-Type", "application/json")
        handler.send_header("Access-Control-Allow-Origin", "*")
        handler.end_headers()
        handler.wfile.write(json.dumps({
            "error": "unauthorized",
            "message": "missing or invalid Authorization header",
        }).encode("utf-8"))
        return None
    claims = verify_token(token, secret)
    if not claims:
        handler.send_response(401)
        handler.send_header("Content-Type", "application/json")
        handler.send_header("Access-Control-Allow-Origin", "*")
        handler.end_headers()
        handler.wfile.write(json.dumps({
            "error": "unauthorized",
            "message": "invalid or expired token",
        }).encode("utf-8"))
        return None
    return claims
