"""Tests for vireo_shared.jwt_auth — HS256 JWT verification."""
import time
import json
import base64
import hashlib
import hmac
import pytest
from vireo_shared.jwt_auth import verify_token, extract_bearer, require_auth, _b64url_encode, JWTError


SECRET = "test-secret-key-for-jwt"


def _sign(payload: dict, secret: str = SECRET, exp_offset: int = 3600) -> str:
    """Create a valid HS256 JWT for testing."""
    header = {"alg": "HS256", "typ": "JWT"}
    now = int(time.time())
    full_payload = {"iat": now, "exp": now + exp_offset, "sub": "user_123", "email": "test@example.com", **payload}

    def b64url(data):
        return base64.b64encode(json.dumps(data).encode()).rstrip(b"=").decode().replace("+", "-").replace("/", "_")

    h = b64url(header)
    p = b64url(full_payload)
    sig_input = f"{h}.{p}".encode("ascii")
    sig = hmac.new(secret.encode("ascii"), sig_input, hashlib.sha256).digest()
    sig_b64 = base64.b64encode(sig).rstrip(b"=").decode().replace("+", "-").replace("/", "_")
    return f"{h}.{p}.{sig_b64}"


class TestVerifyToken:
    def test_valid_token(self):
        token = _sign({"sub": "user_1"})
        claims = verify_token(token, SECRET)
        assert claims is not None
        assert claims["sub"] == "user_1"
        assert claims["email"] == "test@example.com"

    def test_wrong_secret(self):
        token = _sign({"sub": "user_1"})
        claims = verify_token(token, "wrong-secret")
        assert claims is None

    def test_expired_token(self):
        token = _sign({}, exp_offset=-100)
        claims = verify_token(token, SECRET)
        assert claims is None

    def test_expired_token_within_clock_skew(self):
        token = _sign({}, exp_offset=-20)
        claims = verify_token(token, SECRET, clock_skew_sec=30)
        assert claims is not None

    def test_empty_token(self):
        assert verify_token("", SECRET) is None

    def test_empty_secret(self):
        token = _sign({})
        assert verify_token(token, "") is None

    def test_none_token(self):
        assert verify_token(None, SECRET) is None

    def test_malformed_token(self):
        assert verify_token("not.a.jwt", SECRET) is None

    def test_two_parts(self):
        assert verify_token("abc.def", SECRET) is None

    def test_four_parts(self):
        assert verify_token("a.b.c.d", SECRET) is None

    def test_tampered_payload(self):
        token = _sign({"sub": "user_1"})
        parts = token.split(".")
        # Tamper with payload
        tampered = parts[0] + "." + parts[1][:-1] + ("A" if parts[1][-1] != "A" else "B") + "." + parts[2]
        assert verify_token(tampered, SECRET) is None

    def test_tampered_signature(self):
        token = _sign({"sub": "user_1"})
        parts = token.split(".")
        tampered = parts[0] + "." + parts[1] + ".INVALIDSIG"
        assert verify_token(tampered, SECRET) is None

    def test_custom_claims(self):
        token = _sign({"sub": "u1", "name": "Alice", "plan": "pro"})
        claims = verify_token(token, SECRET)
        assert claims["name"] == "Alice"
        assert claims["plan"] == "pro"


class TestExtractBearer:
    def test_valid_bearer(self):
        assert extract_bearer({"Authorization": "Bearer abc123"}) == "abc123"

    def test_lowercase(self):
        assert extract_bearer({"authorization": "bearer abc123"}) == "abc123"

    def test_mixed_case(self):
        assert extract_bearer({"Authorization": "BEARER abc123"}) == "abc123"

    def test_no_bearer(self):
        assert extract_bearer({"Authorization": "abc123"}) is None

    def test_no_auth_header(self):
        assert extract_bearer({}) is None

    def test_none_header(self):
        assert extract_bearer({"Authorization": None}) is None

    def test_empty_string(self):
        assert extract_bearer({"Authorization": ""}) is None

    def test_bearer_only(self):
        assert extract_bearer({"Authorization": "Bearer "}) is None

    def test_with_whitespace(self):
        assert extract_bearer({"Authorization": "Bearer  abc123  "}) == "abc123"

    def test_dict_like_object(self):
        class FakeHeaders:
            def get(self, key):
                return {"Authorization": "Bearer tok123"}.get(key)
        assert extract_bearer(FakeHeaders()) == "tok123"


class TestB64UrlEncode:
    def test_encode(self):
        result = _b64url_encode(b"hello world")
        assert "=" not in result
        assert "+" not in result
        assert "/" not in result

    def test_encode_binary(self):
        result = _b64url_encode(bytes(range(256)))
        assert isinstance(result, str)
        assert len(result) > 0


class TestRequireAuth:
    def test_no_auth_header(self):
        class FakeHandler:
            headers = {}
            def send_response(self, code): self.code = code
            def send_header(self, k, v): pass
            def end_headers(self): pass
            wfile = type("W", (), {"write": lambda self, x: None})()

        h = FakeHandler()
        result = require_auth(h, SECRET)
        assert result is None
        assert h.code == 401

    def test_valid_token(self):
        token = _sign({"sub": "user_1"})
        class FakeHandler:
            headers = {"Authorization": f"Bearer {token}"}
            def send_response(self, code): self.code = code
            def send_header(self, k, v): pass
            def end_headers(self): pass
            wfile = type("W", (), {"write": lambda self, x: None})()

        h = FakeHandler()
        result = require_auth(h, SECRET)
        assert result is not None
        assert result["sub"] == "user_1"
        assert not hasattr(h, "code")  # no 401 sent

    def test_invalid_token(self):
        class FakeHandler:
            headers = {"Authorization": "Bearer invalid.token.here"}
            def send_response(self, code): self.code = code
            def send_header(self, k, v): pass
            def end_headers(self): pass
            wfile = type("W", (), {"write": lambda self, x: None})()

        h = FakeHandler()
        result = require_auth(h, SECRET)
        assert result is None
        assert h.code == 401
