"""Tests for Vireo OAuth helpers (platform registry, URL building, token exchange).

These tests don't make real network calls — they use an injected
`transport` to return canned responses.
"""
from __future__ import annotations
import json
import time
import pytest
from vireo_oauth.oauth import (
    Platform,
    PLATFORMS,
    OAUTH_PLATFORMS,
    NON_OAUTH_PLATFORMS,
    get_platform,
    list_platforms,
    make_state,
    make_pkce_pair,
    build_authorize_url,
    exchange_code,
    refresh_token,
    fetch_profile,
    AccessToken,
    TokenStore,
    StateStore,
    HTTPTokenClient,
    OAuthError,
)


# ===== PLATFORMS registry =====

def test_platforms_registry_has_10():
    assert len(PLATFORMS) == 10


def test_platforms_have_required_fields():
    for pid, p in PLATFORMS.items():
        assert p.id == pid
        assert p.name
        assert isinstance(p.scopes, list)
        assert isinstance(p.env_keys, list)


def test_oauth_platforms_separated():
    oauth_ids = {p.id for p in OAUTH_PLATFORMS}
    non_oauth = {p.id for p in NON_OAUTH_PLATFORMS}
    # YouTube, YouTube Shorts, TikTok, Instagram, X, LinkedIn, Threads use OAuth
    assert {"youtube", "youtube_shorts", "tiktok", "instagram", "x", "linkedin", "threads"}.issubset(oauth_ids)
    # Telegram, Substack, Podcast are non-OAuth
    assert {"telegram", "substack", "podcast"}.issubset(non_oauth)


def test_get_platform_returns_none_for_unknown():
    assert get_platform("nope") is None
    assert get_platform("youtube").id == "youtube"


def test_list_platforms_includes_oauth_flag():
    platforms = list_platforms()
    assert any(p["id"] == "youtube" and p["uses_oauth"] for p in platforms)
    assert any(p["id"] == "telegram" and not p["uses_oauth"] for p in platforms)


# ===== make_state / make_pkce_pair =====

def test_make_state_unique():
    s1 = make_state()
    s2 = make_state()
    assert s1 != s2
    assert len(s1) >= 20


def test_make_pkce_pair_format():
    verifier, challenge = make_pkce_pair()
    assert 43 <= len(verifier) <= 128
    # Challenge is base64url of SHA-256
    import base64
    padded = challenge + "=" * (-len(challenge) % 4)
    decoded = base64.urlsafe_b64decode(padded)
    assert len(decoded) == 32


def test_pkce_challenge_matches_verifier():
    import hashlib, base64
    verifier, challenge = make_pkce_pair()
    expected = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode("ascii")).digest()
    ).rstrip(b"=").decode("ascii")
    assert challenge == expected


# ===== build_authorize_url =====

def test_build_authorize_url_youtube():
    r = build_authorize_url(
        "youtube",
        client_id="cid", redirect_uri="http://localhost/cb",
    )
    assert "accounts.google.com" in r["url"]
    assert "client_id=cid" in r["url"]
    assert "redirect_uri=" in r["url"]
    assert "state=" in r["url"]
    assert "response_type=code" in r["url"]
    assert "scope=" in r["url"]


def test_build_authorize_url_x_includes_pkce():
    r = build_authorize_url(
        "x",
        client_id="cid", redirect_uri="http://localhost/cb",
    )
    assert "code_challenge=" in r["url"]
    assert "code_challenge_method=S256" in r["url"]
    assert "code_verifier" in r  # returned for storage


def test_build_authorize_url_youtube_shorts():
    r = build_authorize_url("youtube_shorts", client_id="cid", redirect_uri="http://localhost/cb")
    assert "accounts.google.com" in r["url"]


def test_build_authorize_url_uses_custom_scopes():
    r = build_authorize_url(
        "linkedin",
        client_id="cid", redirect_uri="http://localhost/cb",
        scopes=["openid", "profile"],
    )
    assert "scope=openid+profile" in r["url"] or "scope=openid%20profile" in r["url"]


def test_build_authorize_url_rejects_non_oauth_platform():
    with pytest.raises(ValueError):
        build_authorize_url("telegram", client_id="cid", redirect_uri="http://x")


def test_build_authorize_url_uses_passed_state():
    r = build_authorize_url("youtube", client_id="cid", redirect_uri="http://x", state="my-state")
    assert r["state"] == "my-state"
    assert "state=my-state" in r["url"]


# ===== AccessToken =====

def test_access_token_from_response_with_expires_in():
    payload = {
        "access_token": "at-123",
        "refresh_token": "rt-456",
        "token_type": "Bearer",
        "expires_in": 3600,
        "scope": "profile email",
    }
    t = AccessToken.from_response("youtube", payload)
    assert t.platform_id == "youtube"
    assert t.access_token == "at-123"
    assert t.refresh_token == "rt-456"
    assert t.scope == "profile email"
    assert t.expires_at is not None


def test_access_token_from_response_no_expiry():
    payload = {"access_token": "at", "token_type": "Bearer"}
    t = AccessToken.from_response("x", payload)
    assert t.expires_at is None
    assert not t.is_expired()


def test_access_token_is_expired_uses_skew():
    # Expires 30 seconds from now — with 60s skew, considered expired
    from datetime import datetime, timezone, timedelta
    payload = {
        "access_token": "at",
        "expires_in": 30,
    }
    t = AccessToken.from_response("x", payload)
    assert t.is_expired(skew_sec=60)


def test_access_token_to_dict_strips_raw():
    t = AccessToken(platform_id="x", access_token="at", raw={"secret": "data"})
    d = t.to_dict()
    assert "raw" not in d
    assert d["access_token"] == "at"


# ===== TokenStore =====

def test_token_store_save_and_get():
    s = TokenStore()
    t = AccessToken(platform_id="youtube", access_token="at")
    s.save("u1", t)
    got = s.get("u1", "youtube")
    assert got.access_token == "at"


def test_token_store_get_returns_none_for_missing():
    s = TokenStore()
    assert s.get("u1", "youtube") is None


def test_token_store_list_for_user():
    s = TokenStore()
    s.save("u1", AccessToken(platform_id="youtube", access_token="a"))
    s.save("u1", AccessToken(platform_id="x", access_token="b"))
    s.save("u2", AccessToken(platform_id="youtube", access_token="c"))
    assert len(s.list_for_user("u1")) == 2
    assert len(s.list_for_user("u2")) == 1
    assert len(s.list_for_user("nope")) == 0


def test_token_store_delete():
    s = TokenStore()
    s.save("u1", AccessToken(platform_id="x", access_token="a"))
    assert s.delete("u1", "x") is True
    assert s.get("u1", "x") is None
    assert s.delete("u1", "x") is False


# ===== StateStore =====

def test_state_store_create_and_consume():
    s = StateStore()
    state = s.create("u1", "youtube")
    entry = s.consume(state)
    assert entry["user_id"] == "u1"
    assert entry["platform_id"] == "youtube"
    # Single-use
    assert s.consume(state) is None


def test_state_store_expires():
    s = StateStore(ttl_sec=0)
    state = s.create("u1", "youtube")
    time.sleep(0.01)
    assert s.consume(state) is None


def test_state_store_includes_code_verifier():
    s = StateStore()
    state = s.create("u1", "x", code_verifier="my-verifier")
    entry = s.consume(state)
    assert entry["code_verifier"] == "my-verifier"


# ===== HTTPTokenClient + transport =====

def make_transport(responses):
    it = iter(responses)
    def t(method, url, headers, body):
        try:
            return next(it)
        except StopIteration:
            return (500, {"error": "no more canned responses"})
    return t


def test_token_exchange_youtube():
    responses = [(200, {
        "access_token": "ya29.at-123",
        "refresh_token": "rt-456",
        "expires_in": 3600,
        "scope": "youtube.upload",
        "token_type": "Bearer",
    })]
    client = HTTPTokenClient(transport=make_transport(responses))
    t = exchange_code(
        "youtube", "auth-code-xyz",
        client_id="cid", client_secret="csec",
        redirect_uri="http://localhost/cb",
        client=client,
    )
    assert t.access_token == "ya29.at-123"
    assert t.refresh_token == "rt-456"
    assert t.scope == "youtube.upload"
    assert not t.is_expired()


def test_token_exchange_error_raises():
    responses = [(400, {"error": "invalid_grant", "error_description": "bad code"})]
    client = HTTPTokenClient(transport=make_transport(responses))
    with pytest.raises(OAuthError):
        exchange_code("youtube", "bad", client_id="c", client_secret="s", redirect_uri="x", client=client)


def test_refresh_token_x():
    responses = [(200, {
        "access_token": "new-at",
        "refresh_token": "new-rt",
        "expires_in": 3600,
    })]
    client = HTTPTokenClient(transport=make_transport(responses))
    t = refresh_token("x", "old-rt", client_id="c", client_secret="s", client=client)
    assert t.access_token == "new-at"


def test_refresh_token_unsupported_platform():
    with pytest.raises(ValueError):
        refresh_token("telegram", "rt", client_id="c", client_secret="s")


def test_fetch_profile_youtube():
    responses = [(200, {
        "id": "1234567890",
        "name": "Test User",
        "email": "test@example.com",
        "picture": "https://example.com/pic.jpg",
    })]
    client = HTTPTokenClient(transport=make_transport(responses))
    profile = fetch_profile("youtube", "at", client=client)
    assert profile["id"] == "1234567890"
    assert profile["name"] == "Test User"


def test_fetch_profile_x():
    responses = [(200, {
        "data": {"id": "123", "username": "testuser", "name": "Test"}
    })]
    client = HTTPTokenClient(transport=make_transport(responses))
    profile = fetch_profile("x", "at", client=client)
    assert profile["data"]["username"] == "testuser"


def test_fetch_profile_404_raises():
    responses = [(404, {"error": "not_found"})]
    client = HTTPTokenClient(transport=make_transport(responses))
    with pytest.raises(OAuthError):
        fetch_profile("youtube", "at", client=client)


def test_exchange_code_uses_correct_token_url():
    """Verify the request hits the platform's token_url."""
    seen_urls = []
    def t(method, url, headers, body):
        seen_urls.append(url)
        return (200, {"access_token": "at"})
    client = HTTPTokenClient(transport=t)
    exchange_code("x", "code", client_id="c", client_secret="s", redirect_uri="r", client=client)
    assert seen_urls[0] == "https://api.twitter.com/2/oauth2/token"


def test_exchange_code_sends_correct_form_data():
    """Verify the request body has grant_type, code, client_id, etc."""
    seen = {}
    def t(method, url, headers, body):
        seen["body"] = body
        return (200, {"access_token": "at"})
    client = HTTPTokenClient(transport=t)
    exchange_code("x", "the-code", client_id="cid", client_secret="csec", redirect_uri="http://cb", client=client)
    body = seen["body"]
    text = body.decode("utf-8") if isinstance(body, bytes) else body
    assert "grant_type=authorization_code" in text
    assert "code=the-code" in text
    assert "client_id=cid" in text
    assert "client_secret=csec" in text
    assert "redirect_uri=" in text


def test_exchange_code_with_pkce_includes_verifier():
    seen = {}
    def t(method, url, headers, body):
        seen["body"] = body
        return (200, {"access_token": "at"})
    client = HTTPTokenClient(transport=t)
    exchange_code("x", "code", client_id="c", client_secret="s", redirect_uri="r",
                  code_verifier="my-verifier", client=client)
    text = seen["body"].decode("utf-8")
    assert "code_verifier=my-verifier" in text


# ===== Regression tests for audit 2026-06-07 =====

def test_audit_o2_x_pkce_pair_consistent():
    """O-2: bug was that make_pkce_pair() was called twice — challenge from
    one pair, verifier from another. Verify the returned code_verifier
    matches the challenge in the URL."""
    import hashlib, base64, urllib.parse
    result = build_authorize_url("x", client_id="c", redirect_uri="r")
    # code_verifier is now returned
    assert "code_verifier" in result
    verifier = result["code_verifier"]
    # Extract challenge from URL
    qs = urllib.parse.urlparse(result["url"]).query
    params = urllib.parse.parse_qs(qs)
    challenge = params["code_challenge"][0]
    # Verify they match
    expected = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode("ascii")).digest()
    ).rstrip(b"=").decode("ascii")
    assert challenge == expected, "PKCE verifier must hash to the challenge in the URL"


def test_audit_o2_x_pkce_caller_supplied_challenge():
    """O-2: when caller supplies code_challenge, no verifier is generated
    (caller owns the pair)."""
    import urllib.parse
    custom_challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    result = build_authorize_url("x", client_id="c", redirect_uri="r",
                                 code_challenge=custom_challenge)
    assert "code_verifier" not in result  # caller owns it
    qs = urllib.parse.urlparse(result["url"]).query
    params = urllib.parse.parse_qs(qs)
    assert params["code_challenge"][0] == custom_challenge


def test_audit_o7_pkce_verifier_length():
    """O-7: PKCE verifier should be 43-128 chars per RFC 7636."""
    for _ in range(20):
        v, _ = make_pkce_pair()
        assert 43 <= len(v) <= 128


def test_audit_o10_oauth_error_has_status_and_code():
    """O-10: OAuthError carries status and code fields."""
    e = OAuthError("test message", status=401, code="invalid_client")
    assert e.status == 401
    assert e.code == "invalid_client"
    assert str(e) == "test message"


def test_audit_o11_token_exchange_error_hides_payload():
    """O-11: when token endpoint returns 4xx, error message must not contain
    the raw provider payload (could leak invalid_client_secret hints)."""
    def t(method, url, headers, body):
        return (401, {"error": "invalid_client", "error_description": "Secret is invalid"})
    client = HTTPTokenClient(transport=t)
    with __import__("pytest").raises(OAuthError) as exc:
        exchange_code("youtube", "code", client_id="c", client_secret="s",
                      redirect_uri="r", client=client)
    msg = str(exc.value)
    assert "invalid_client" not in msg
    assert "Secret is invalid" not in msg
    # But status and code should be exposed
    assert exc.value.status == 401
    assert exc.value.code == "token_exchange_failed"


def test_audit_o8_retries_on_5xx_then_succeeds():
    """O-8: HTTPTokenClient retries on 5xx and eventually returns success."""
    calls = []
    def t(method, url, headers, body):
        calls.append(1)
        if len(calls) < 3:
            return (503, {"error": "temporarily_unavailable"})
        return (200, {"access_token": "AT", "token_type": "Bearer", "expires_in": 3600})
    # Use retries=2 to keep the test fast
    client = HTTPTokenClient(transport=t, retries=2)
    status, payload = client.post_form("https://example.com/token", {"code": "c"})
    assert status == 200
    assert payload["access_token"] == "AT"
    assert len(calls) == 3, f"expected 3 attempts (2 fails + 1 success), got {len(calls)}"


def test_audit_o8_does_not_retry_on_4xx():
    """O-8: 4xx client errors must NOT be retried."""
    calls = []
    def t(method, url, headers, body):
        calls.append(1)
        return (401, {"error": "invalid_client"})
    client = HTTPTokenClient(transport=t, retries=5)
    status, payload = client.post_form("https://example.com/token", {"code": "c"})
    assert status == 401
    assert len(calls) == 1, f"expected 1 attempt on 4xx, got {len(calls)}"


def test_audit_o8_raises_after_exhausted_retries_on_5xx():
    """O-8: after `retries` consecutive 5xx, post_form raises OAuthError."""
    def t(method, url, headers, body):
        return (500, {"error": "internal"})
    client = HTTPTokenClient(transport=t, retries=2)
    with __import__("pytest").raises(OAuthError) as exc:
        client.post_form("https://example.com/token", {"code": "c"})
    assert exc.value.status == 0
    assert exc.value.code == "token_request_failed"
    assert "3 attempts" in str(exc.value)


def test_audit_o8_retries_on_urllib_timeout():
    """O-8: TimeoutError/URLError are retried; success on subsequent attempt."""
    import urllib.error
    calls = []
    def t(method, url, headers, body):
        calls.append(1)
        if len(calls) < 2:
            raise TimeoutError("connect timeout")
        return (200, {"access_token": "AT", "token_type": "Bearer"})
    client = HTTPTokenClient(transport=t, retries=3)
    status, payload = client.post_form("https://example.com/token", {"code": "c"})
    assert status == 200
    assert len(calls) == 2


def test_audit_o8_raises_after_exhausted_network_retries():
    """O-8: after `retries` consecutive TimeoutError, post_form raises OAuthError."""
    def t(method, url, headers, body):
        raise TimeoutError("connect timeout")
    client = HTTPTokenClient(transport=t, retries=2)
    with __import__("pytest").raises(OAuthError) as exc:
        client.post_form("https://example.com/token", {"code": "c"})
    assert exc.value.status == 0
    assert exc.value.code == "token_request_failed"
    assert "3 attempts" in str(exc.value)
    # The original TimeoutError is the cause
    import pytest as _pytest
    assert isinstance(exc.value.__cause__, TimeoutError)


def test_audit_o8_per_call_retries_override():
    """O-8: per-call `retries` argument overrides instance default."""
    calls = []
    def t(method, url, headers, body):
        calls.append(1)
        return (500, {"error": "fail"})
    client = HTTPTokenClient(transport=t, retries=5)
    # Override to 1 → expect 2 calls total
    with __import__("pytest").raises(OAuthError):
        client.post_form("https://example.com/token", {"code": "c"}, retries=1)
    assert len(calls) == 2


def test_audit_o8_get_json_also_retries():
    """O-8: get_json has the same retry behavior as post_form."""
    calls = []
    def t(method, url, headers, body):
        calls.append(1)
        if len(calls) < 2:
            return (502, {"error": "bad_gateway"})
        return (200, {"sub": "you", "name": "Test User"})
    client = HTTPTokenClient(transport=t, retries=2)
    status, payload = client.get_json("https://example.com/profile")
    assert status == 200
    assert payload["name"] == "Test User"
    assert len(calls) == 2


def test_audit_o8_retries_is_non_negative():
    """O-8: negative retries is normalized to 0 (single attempt)."""
    client = HTTPTokenClient(retries=-5)
    assert client.retries == 0
