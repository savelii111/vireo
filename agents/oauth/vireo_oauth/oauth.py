"""OAuth helpers for real platform integrations.

Each platform has its own:
- authorize URL
- token URL
- scope set
- profile fetch URL (to get user info after auth)

This module:
1. Defines the platform registry (10 platforms)
2. Generates authorize URLs
3. Exchanges auth codes for access tokens (via injectable transport)
4. Fetches user profile info
5. Provides a TokenStore for persisting tokens (in-memory for now)

When a real `requests` or `httpx` package is available and env vars are set,
this will work with real platform APIs. For tests, transport is injected.
"""
from __future__ import annotations
import os
import json
import time
import secrets
import logging
import threading
from typing import Any
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone, timedelta
from urllib.parse import urlencode, parse_qs
import urllib.request
import urllib.error

log = logging.getLogger("vireo.oauth")


# ---------------------------------------------------------------------------
# Platform registry
# ---------------------------------------------------------------------------

@dataclass
class Platform:
    id: str
    name: str
    authorize_url: str
    token_url: str
    profile_url: str
    scopes: list[str]
    supports_refresh: bool = True
    # Which env vars must be set for this platform to work
    env_keys: list[str] = field(default_factory=list)
    notes: str = ""


PLATFORMS: dict[str, Platform] = {
    "youtube": Platform(
        id="youtube",
        name="YouTube",
        authorize_url="https://accounts.google.com/o/oauth2/v2/auth",
        token_url="https://oauth2.googleapis.com/token",
        profile_url="https://www.googleapis.com/oauth2/v2/userinfo",
        scopes=[
            "https://www.googleapis.com/auth/youtube.upload",
            "https://www.googleapis.com/auth/youtube.readonly",
            "https://www.googleapis.com/auth/userinfo.profile",
        ],
        supports_refresh=True,
        env_keys=["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET"],
        notes="Google OAuth; YouTube Data API v3",
    ),
    "tiktok": Platform(
        id="tiktok",
        name="TikTok",
        authorize_url="https://www.tiktok.com/v2/auth/authorize/",
        token_url="https://open.tiktokapis.com/v2/oauth/token/",
        profile_url="https://open.tiktokapis.com/v2/user/info/",
        scopes=["user.info.basic", "video.upload", "video.publish"],
        env_keys=["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
        notes="TikTok for Developers",
    ),
    "instagram": Platform(
        id="instagram",
        name="Instagram",
        authorize_url="https://www.facebook.com/v18.0/dialog/oauth",
        token_url="https://graph.facebook.com/v18.0/oauth/access_token",
        profile_url="https://graph.facebook.com/v18.0/me",
        scopes=["instagram_basic", "instagram_content_publish", "pages_show_list"],
        env_keys=["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET"],
        notes="Instagram Graph API (Business/Creator only)",
    ),
    "x": Platform(
        id="x",
        name="X (Twitter)",
        authorize_url="https://twitter.com/i/oauth2/authorize",
        token_url="https://api.twitter.com/2/oauth2/token",
        profile_url="https://api.twitter.com/2/users/me",
        scopes=["tweet.read", "tweet.write", "users.read", "offline.access"],
        env_keys=["X_CLIENT_ID", "X_CLIENT_SECRET"],
        notes="X API v2 with OAuth 2.0 + PKCE",
    ),
    "linkedin": Platform(
        id="linkedin",
        name="LinkedIn",
        authorize_url="https://www.linkedin.com/oauth/v2/authorization",
        token_url="https://www.linkedin.com/oauth/v2/accessToken",
        profile_url="https://api.linkedin.com/v2/userinfo",
        scopes=["openid", "profile", "email", "w_member_social"],
        env_keys=["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"],
        notes="LinkedIn API v2 (sign in with LinkedIn + share)",
    ),
    "threads": Platform(
        id="threads",
        name="Threads",
        authorize_url="https://www.threads.net/oauth/authorize",
        token_url="https://graph.threads.net/oauth/access_token",
        profile_url="https://graph.threads.net/v1.0/me",
        scopes=["threads_basic", "threads_content_publish"],
        env_keys=["THREADS_APP_ID", "THREADS_APP_SECRET"],
        notes="Meta Threads API",
    ),
    "telegram": Platform(
        id="telegram",
        name="Telegram",
        authorize_url="",  # Telegram uses bot tokens, not OAuth
        token_url="",
        profile_url=f"https://api.telegram.org/bot{{token}}/getMe",
        scopes=[],
        supports_refresh=False,
        env_keys=["TELEGRAM_BOT_TOKEN"],
        notes="Bot-based; user authorizes via @BotFather",
    ),
    "substack": Platform(
        id="substack",
        name="Substack",
        authorize_url="",
        token_url="",
        profile_url="",
        scopes=[],
        supports_refresh=False,
        env_keys=["SUBSTACK_PUBLICATION_URL", "SUBSTACK_API_KEY"],
        notes="Newsletter via email API; Substack has no public OAuth yet",
    ),
    "podcast": Platform(
        id="podcast",
        name="Podcast (RSS)",
        authorize_url="",
        token_url="",
        profile_url="",
        scopes=[],
        supports_refresh=False,
        env_keys=["PODCAST_RSS_URL"],
        notes="Generic RSS feed (Spotify, Apple, etc.); no auth required",
    ),
    "youtube_shorts": Platform(
        id="youtube_shorts",
        name="YouTube Shorts",
        # Same as youtube — Shorts are uploaded as regular YouTube videos.
        authorize_url="https://accounts.google.com/o/oauth2/v2/auth",
        token_url="https://oauth2.googleapis.com/token",
        profile_url="https://www.googleapis.com/oauth2/v2/userinfo",
        scopes=[
            "https://www.googleapis.com/auth/youtube.upload",
            "https://www.googleapis.com/auth/youtube.readonly",
        ],
        env_keys=["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET"],
        notes="Alias for YouTube (vertical video)",
    ),
}


# Some platforms (telegram, substack, podcast) don't use OAuth.
OAUTH_PLATFORMS = [p for p in PLATFORMS.values() if p.authorize_url]
NON_OAUTH_PLATFORMS = [p for p in PLATFORMS.values() if not p.authorize_url]


def get_platform(pid: str) -> Platform | None:
    return PLATFORMS.get(pid)


def list_platforms() -> list[dict]:
    """Public list for the dashboard / settings UI."""
    out = []
    for p in PLATFORMS.values():
        out.append({
            "id": p.id,
            "name": p.name,
            "uses_oauth": bool(p.authorize_url),
            "scopes": p.scopes,
            "env_keys": p.env_keys,
            "configured": all(os.environ.get(k) for k in p.env_keys) if p.env_keys else True,
        })
    return out


# ---------------------------------------------------------------------------
# Authorize URL generation
# ---------------------------------------------------------------------------

def make_state() -> str:
    """Cryptographically random state for CSRF protection."""
    return secrets.token_urlsafe(24)


def make_pkce_pair() -> tuple[str, str]:
    """PKCE verifier + S256 challenge (for platforms that require it, e.g. X).

    Per RFC 7636 the verifier is 43-128 chars; secrets.token_urlsafe(64) gives
    86 chars (no truncation needed). Bug O-7: previous code had `[:96]` which
    was a no-op truncation that misled readers about the length contract.
    """
    import hashlib
    import base64
    verifier = secrets.token_urlsafe(64)  # 86 chars, in [43, 128]
    challenge = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge_b64 = base64.urlsafe_b64encode(challenge).rstrip(b"=").decode("ascii")
    return verifier, challenge_b64


def build_authorize_url(
    platform_id: str,
    *,
    client_id: str,
    redirect_uri: str,
    state: str | None = None,
    scopes: list[str] | None = None,
    code_challenge: str | None = None,
    code_challenge_method: str = "S256",
    extra: dict | None = None,
) -> dict:
    """Build the authorize URL for a platform.

    Returns { url, state, code_verifier (if PKCE pair was generated here) }.

    PKCE: when ``code_challenge`` is NOT provided AND platform requires PKCE
    (currently just X), we generate a single (verifier, challenge) pair and
    return the verifier. The caller MUST send the same verifier back to the
    token endpoint, otherwise the token exchange will fail.
    """
    p = get_platform(platform_id)
    if not p or not p.authorize_url:
        raise ValueError(f"platform {platform_id} does not support OAuth")
    state = state or make_state()
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "state": state,
    }
    # Track the PKCE verifier we generated (so the caller can use the SAME pair
    # at the token endpoint). Bug O-2: previous implementation called
    # make_pkce_pair() twice, returning a challenge from one pair and a
    # verifier from another, which broke X OAuth.
    pkce_verifier: str | None = None
    s = scopes or p.scopes
    if s:
        if platform_id in ("youtube", "youtube_shorts"):
            params["scope"] = " ".join(s)
        elif platform_id == "x":
            params["scope"] = " ".join(s)
            if code_challenge:
                params["code_challenge"] = code_challenge
                # Caller owns the verifier
                pkce_verifier = None
            else:
                # Generate the pair ONCE and keep both
                pkce_verifier, challenge = make_pkce_pair()
                params["code_challenge"] = challenge
            params["code_challenge_method"] = code_challenge_method
        else:
            params["scope"] = " ".join(s)
    if extra:
        params.update(extra)
    url = f"{p.authorize_url}?{urlencode(params)}"
    result = {"url": url, "state": state}
    if pkce_verifier is not None:
        result["code_verifier"] = pkce_verifier
    return result


# ---------------------------------------------------------------------------
# Token exchange
# ---------------------------------------------------------------------------

class OAuthError(Exception):
    """Raised when an OAuth call fails at the protocol level.

    ``status`` is the upstream HTTP status (0 if the call didn't reach the
    provider, e.g. network timeout). ``code`` is a stable machine-readable
    identifier that callers can switch on. Both are optional but strongly
    recommended at raise sites so the server can produce a correct 4xx/5xx
    response without re-inspecting the message string. Bug O-10.
    """

    def __init__(self, message: str, status: int = 0, code: str = "oauth_error") -> None:
        super().__init__(message)
        self.status = status
        self.code = code


class HTTPTokenClient:
    """Performs the actual HTTP calls for token exchange + profile fetch.

    In production: uses urllib (no extra deps).
    In tests: transport is injected to return canned responses.

    Bug O-8: previous code made a single attempt and surfaced
    TimeoutError/URLError as OAuthError. Transient 5xx and network blips would
    bubble up to the user. Now we retry on 5xx + transient network errors with
    jittered exponential backoff (0.2s, 0.4s, 0.8s by default).
    """

    def __init__(self, transport: Any = None, timeout_sec: float = 30.0, retries: int = 2) -> None:
        self._transport = transport
        self.timeout_sec = timeout_sec
        self.retries = max(0, retries)

    def _backoff(self, attempt: int) -> float:
        # Jittered exponential: 0.2, 0.4, 0.8 (+/- 20% jitter) for attempt 0, 1, 2
        import random
        base = 0.2 * (2 ** attempt)
        return base * (0.8 + 0.4 * random.random())

    def _raw_post(self, url: str, body: bytes, headers: dict) -> tuple[int, dict]:
        req = urllib.request.Request(url, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=self.timeout_sec) as resp:
                raw = resp.read().decode("utf-8")
                return resp.status, _safe_json(raw)
        except urllib.error.HTTPError as e:
            raw = e.read().decode("utf-8") if e.fp else ""
            return e.code, _safe_json(raw)

    def _raw_get(self, url: str, headers: dict) -> tuple[int, dict]:
        req = urllib.request.Request(url, headers=headers, method="GET")
        try:
            with urllib.request.urlopen(req, timeout=self.timeout_sec) as resp:
                raw = resp.read().decode("utf-8")
                return resp.status, _safe_json(raw)
        except urllib.error.HTTPError as e:
            raw = e.read().decode("utf-8") if e.fp else ""
            return e.code, _safe_json(raw)

    def _retry_loop(self, method_label: str, attempt_call, *, attempts: int, err_code: str):
        """Generic retry loop. attempt_call is a zero-arg callable returning
        (status, payload). On 5xx or transient network errors, retries with
        jittered backoff. Returns (status, payload) on success or non-retryable
        status; raises OAuthError after exhausted retries.

        Bug O-8.
        """
        last_error: str | None = None
        for attempt in range(attempts + 1):
            try:
                status, payload = attempt_call()
                if 500 <= status < 600:
                    last_error = f"server error {status}"
                    if attempt < attempts:
                        time.sleep(self._backoff(attempt))
                        continue
                    # 5xx on the last attempt → exhaust, raise below
                    break
                return status, payload
            except (TimeoutError, urllib.error.URLError) as e:
                last_error = str(e)
                if attempt < attempts:
                    time.sleep(self._backoff(attempt))
                    continue
                raise OAuthError(
                    f"{method_label} failed after {attempts + 1} attempts: {e}",
                    status=0,
                    code=err_code,
                ) from e
        # 5xx exhausted retries
        raise OAuthError(
            f"{method_label} failed after {attempts + 1} attempts: {last_error}",
            status=0,
            code=err_code,
        )

    def post_form(self, url: str, data: dict, headers: dict | None = None, retries: int | None = None) -> tuple[int, dict]:
        body = urlencode(data).encode("utf-8")
        h = {"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"}
        if headers:
            h.update(headers)
        attempts = self.retries if retries is None else max(0, retries)
        if self._transport is not None:
            transport = self._transport
            def call():
                return transport("POST", url, h, body)
        else:
            def call():
                return self._raw_post(url, body, h)
        return self._retry_loop("token request", call, attempts=attempts, err_code="token_request_failed")

    def get_json(self, url: str, headers: dict | None = None, retries: int | None = None) -> tuple[int, dict]:
        h = {"Accept": "application/json"}
        if headers:
            h.update(headers)
        attempts = self.retries if retries is None else max(0, retries)
        if self._transport is not None:
            transport = self._transport
            def call():
                return transport("GET", url, h, b"")
        else:
            def call():
                return self._raw_get(url, h)
        return self._retry_loop("profile request", call, attempts=attempts, err_code="profile_request_failed")


def _safe_json(raw: str) -> dict:
    import json
    try:
        return json.loads(raw) if raw else {}
    except json.JSONDecodeError:
        return {"_raw": raw}


def exchange_code(
    platform_id: str,
    code: str,
    *,
    client_id: str,
    client_secret: str,
    redirect_uri: str,
    code_verifier: str | None = None,
    client: HTTPTokenClient | None = None,
) -> "AccessToken":
    p = get_platform(platform_id)
    if not p or not p.token_url:
        raise ValueError(f"platform {platform_id} does not support token exchange")
    client = client or HTTPTokenClient()
    data = {
        "grant_type": "authorization_code",
        "code": code,
        "client_id": client_id,
        "client_secret": client_secret,
        "redirect_uri": redirect_uri,
    }
    if code_verifier:
        data["code_verifier"] = code_verifier
    status, payload = client.post_form(p.token_url, data)
    if status >= 400:
        # Bug O-11: log raw provider response internally, but don't echo it
        # back to the caller — it can leak internal error details (e.g.
        # "invalid_client_secret" which would help an attacker).
        log.warning("token exchange failed for %s: status=%s body=%s", platform_id, status, payload)
        raise OAuthError(
            f"token exchange failed (status {status})",
            status=status,
            code="token_exchange_failed",
        )
    return AccessToken.from_response(platform_id, payload)


def refresh_token(
    platform_id: str,
    refresh_tok: str,
    *,
    client_id: str,
    client_secret: str,
    client: HTTPTokenClient | None = None,
) -> "AccessToken":
    p = get_platform(platform_id)
    if not p or not p.token_url:
        raise ValueError(f"platform {platform_id} does not support token refresh")
    if not p.supports_refresh:
        raise ValueError(f"platform {platform_id} does not support refresh")
    client = client or HTTPTokenClient()
    data = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_tok,
        "client_id": client_id,
        "client_secret": client_secret,
    }
    status, payload = client.post_form(p.token_url, data)
    if status >= 400:
        log.warning("token refresh failed for %s: status=%s body=%s", platform_id, status, payload)
        raise OAuthError(
            f"token refresh failed (status {status})",
            status=status,
            code="token_refresh_failed",
        )
    return AccessToken.from_response(platform_id, payload)


def fetch_profile(
    platform_id: str,
    access_token: str,
    *,
    client: HTTPTokenClient | None = None,
) -> dict:
    p = get_platform(platform_id)
    if not p or not p.profile_url:
        raise ValueError(f"platform {platform_id} has no profile URL")
    if platform_id == "telegram":
        # Telegram uses bot tokens, not user tokens
        raise ValueError("telegram profile uses bot token; different path")
    client = client or HTTPTokenClient()
    url = p.profile_url
    if "{token}" in url:
        url = url.format(token=access_token)
    headers = {"Authorization": f"Bearer {access_token}"}
    status, payload = client.get_json(url, headers)
    if status >= 400:
        log.warning("profile fetch failed for %s: status=%s body=%s", platform_id, status, payload)
        raise OAuthError(
            f"profile fetch failed (status {status})",
            status=status,
            code="profile_fetch_failed",
        )
    return payload


# ---------------------------------------------------------------------------
# AccessToken + TokenStore
# ---------------------------------------------------------------------------

@dataclass
class AccessToken:
    platform_id: str
    access_token: str
    refresh_token: str | None = None
    token_type: str = "Bearer"
    expires_at: str | None = None
    scope: str = ""
    raw: dict = field(default_factory=dict)

    @classmethod
    def from_response(cls, platform_id: str, payload: dict) -> "AccessToken":
        expires_in = payload.get("expires_in")
        expires_at = None
        if isinstance(expires_in, (int, float)):
            expires_at = (datetime.now(timezone.utc) + timedelta(seconds=int(expires_in))).isoformat()
        return cls(
            platform_id=platform_id,
            access_token=payload.get("access_token", ""),
            refresh_token=payload.get("refresh_token"),
            token_type=payload.get("token_type", "Bearer"),
            expires_at=expires_at,
            scope=payload.get("scope", ""),
            raw=payload,
        )

    def is_expired(self, skew_sec: int = 60) -> bool:
        if not self.expires_at:
            return False
        try:
            t = datetime.fromisoformat(self.expires_at)
            return datetime.now(timezone.utc) >= t - timedelta(seconds=skew_sec)
        except ValueError:
            return False

    def to_dict(self) -> dict:
        d = asdict(self)
        # Don't leak raw payload in public output
        d.pop("raw", None)
        return d


class TokenStore:
    """In-memory store: userId × platformId → AccessToken.

    Production would use Postgres; the Storage adapter from Phase 1
    can back this in the future.
    """

    def __init__(self) -> None:
        self._tokens: dict[tuple[str, str], AccessToken] = {}
        self._lock = threading.Lock()

    def save(self, user_id: str, token: AccessToken) -> None:
        with self._lock:
            self._tokens[(user_id, token.platform_id)] = token

    def get(self, user_id: str, platform_id: str) -> AccessToken | None:
        with self._lock:
            return self._tokens.get((user_id, platform_id))

    def list_for_user(self, user_id: str) -> list[AccessToken]:
        with self._lock:
            return [t for (u, _), t in self._tokens.items() if u == user_id]

    def delete(self, user_id: str, platform_id: str) -> bool:
        with self._lock:
            return self._tokens.pop((user_id, platform_id), None) is not None

    def size(self) -> int:
        with self._lock:
            return len(self._tokens)

    def _reset(self) -> None:
        with self._lock:
            self._tokens.clear()


# ---------------------------------------------------------------------------
# State store (for CSRF protection during OAuth flow)
# ---------------------------------------------------------------------------

class StateStore:
    """Short-lived state tokens for OAuth CSRF protection.

    States are single-use and expire after 10 minutes.
    """

    def __init__(self, ttl_sec: int = 600) -> None:
        self._states: dict[str, dict] = {}
        self._ttl = ttl_sec
        self._lock = threading.Lock()

    def create(self, user_id: str, platform_id: str, code_verifier: str | None = None) -> str:
        state = make_state()
        with self._lock:
            self._states[state] = {
                "user_id": user_id,
                "platform_id": platform_id,
                "code_verifier": code_verifier,
                "created_at": time.time(),
            }
        return state

    def consume(self, state: str) -> dict | None:
        with self._lock:
            entry = self._states.pop(state, None)
        if not entry:
            return None
        if time.time() - entry["created_at"] > self._ttl:
            return None
        return entry

    def size(self) -> int:
        with self._lock:
            return len(self._states)
