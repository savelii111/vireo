# Vireo Deep Audit Roadmap + OAuth Audit Plan

**Дата:** 2026-06-07
**Текущее состояние:** 1148/1148 tests passing, 24 suites, 2 deep audits complete (Studio, Distributor)

---

## 🎯 Цель roadmap'а

Довести каждый агент Vireo до production-ready уровня через deep audits + закрыть Phase 3 infra для запуска.

---

## 📊 Roadmap (4 фазы)

| Phase | Что | Effort | Зачем | Блокирует |
|---|---|---|---|---|
| **Phase 1: OAuth** | Deep audit OAuth агента (Python+Node, 10 providers) | **5-7ч** | Security-critical (token leak, CSRF, state mgmt) | Ничего — параллельно |
| **Phase 2: Video** | Deep audit Video агента (Whisper, ffmpeg pipeline, 392 теста) | **8-10ч** | Main product feature, самая сложная pipeline | Phase 4 (deploy) |
| **Phase 3: E2E** | Поднять docker-compose, прогнать full pipeline: signup → project → chat → video → publish | **4-6ч** | Валидация всего стека end-to-end | Phase 4 |
| **Phase 4: Phase 3 infra** | Dockerfile, CI/CD, README, deploy guide, env-validator, healthchecks | **1-2 дня** | Blocking launch | Launch |

**Параллелизация:** Phase 1 (OAuth) сейчас, потом Phase 2 (Video), потом Phase 3 (E2E) как gate перед Phase 4.

---

## 🔐 Phase 1: OAuth Deep Audit — DETAILED PLAN

**Goal:** Закрыть все security-критичные и логические баги в OAuth агенте + добавить regression tests.

**Architecture:** Python `oauth.py` (10-platform registry, token exchange, profile fetch, TokenStore, StateStore) ↔ Node `server.js` (HTTP routes: /connect, /callback, /me/accounts, /platforms). Внешние зависимости: auth-middleware, urllib.

**Tech Stack:** Python 3.13, Node 24, secrets/threading, HTTP via urllib (Python) + node:http (Node)

### Bug Inventory (preliminary, 14 enumerated)

| # | Sev | File | Bug | Fix Direction |
|---|-----|------|-----|---------------|
| **O-1** | P0 | server.js:76-78 | CORS hardcoded `*` | Use `corsHeadersFor()` from auth-middleware |
| **O-2** | P0 | oauth.py:241-251 | **PKCE verifier/challenge mismatch for X** — generates challenge from one pair, verifier from another | Store pair once, return both |
| **O-3** | P0 | server.js:152 | State entries never expire in Node server (only Python StateStore has TTL) | Add periodic cleanup or TTL check on consume |
| **O-4** | P1 | server.js:144 | `clientId` fallback to YOUTUBE_CLIENT_ID for non-YouTube platforms — silently misroutes auth | Throw 500 if no client_id for platform |
| **O-5** | P1 | server.js:245 | `tokenStore: tokens` exposes internal Map for mutation | Return immutable view or deep copy |
| **O-6** | P1 | server.js:50 | `saveToken` accepts both `token.access_token` and `token.accessToken` — schema drift | Normalize to snake_case only |
| **O-7** | P1 | oauth.py:204 | PKCE verifier `secrets.token_urlsafe(64)[:96]` — no-op truncation, comment misleading | Either remove or document |
| **O-8** | P1 | oauth.py:281-291 | `urllib.request.urlopen` blocks event loop, no retry on transient errors | Wrap in `run_in_executor` + retry on 5xx/TimeoutError |
| **O-9** | P1 | server.js:95 | x-forwarded-for spoofable (no trusted proxy list) | Document or make configurable |
| **O-10** | P1 | oauth.py:259-260 | `OAuthError(Exception)` — no status/code fields, callers can't distinguish 400 vs 502 | Add `status` and `code` like other platform publishers |
| **O-11** | P2 | oauth.py:312-317 | `_safe_json` returns `{"_raw": raw}` wrapper for invalid JSON — leaks provider internals to error | Log raw internally, return generic error |
| **O-12** | P2 | server.js:39-43 | `oauth` default is empty stub — silent failures when called with no oauth | Require non-null or document |
| **O-13** | P2 | server.js:48 | `cors` snapshot taken once at buildServer time — env changes don't propagate | Per-request (already fixed in distributor) |
| **O-14** | P3 | server.js:79 | OPTIONS preflight returns 204 without CORS headers (line 76-78 do set them, but 204 override may strip) | Verify with test |

### Task Plan (bite-sized)

#### Task 1: Read all OAuth files completely + run baseline tests

**Files to read:**
- `agents/oauth/vireo_oauth/oauth.py` (517 lines)
- `agents/oauth/src/server.js` (258 lines)
- `agents/oauth/tests/test_oauth.py` (existing 35 tests)
- `agents/oauth/tests/test_oauth_server.js` (existing 25 tests)

**Verification:** `cd agents/oauth && python -m pytest tests/ -q && node --test tests/test_oauth_server.js`

#### Task 2: O-1 — Fix CORS to use corsHeadersFor (platform-wide consistency)

**File:** `agents/oauth/src/server.js:76-78`

**Step 1:** Replace `corsHeaders()` import with `corsHeadersFor` (per-request).

```js
import { authMiddleware, corsHeadersFor, RateLimiter } from "../../../packages/auth-middleware/index.js";
```

```js
// Per-request CORS so VIREO_CORS_ORIGINS env changes propagate
res.setHeader("Access-Control-Allow-Origin", corsHeadersFor({ headers: { origin: req.headers.origin || "" } })["Access-Control-Allow-Origin"]);
res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
```

**Step 2:** Add test in `tests/test_oauth_server.js`:

```js
test("OAuth: CORS echoes allowed origin (env-based)", async () => {
  const origEnv = process.env.VIREO_CORS_ORIGINS;
  process.env.VIREO_CORS_ORIGINS = "https://app.vireo.io";
  try {
    const { server, port } = await startTestServer();
    const r = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: { Origin: "https://app.vireo.io" },
    });
    assert.equal(r.headers.get("Access-Control-Allow-Origin"), "https://app.vireo.io");
  } finally {
    if (origEnv == null) delete process.env.VIREO_CORS_ORIGINS;
    else process.env.VIREO_CORS_ORIGINS = origEnv;
  }
});
```

**Verification:** `node --test tests/test_oauth_server.js` — new test passes, no regressions.

#### Task 3: O-2 — Fix PKCE verifier/challenge mismatch (X OAuth)

**File:** `agents/oauth/vireo_oauth/oauth.py:241-252`

**Root cause:** `make_pkce_pair()` is called twice — first to get the challenge, then again to get the verifier. The two calls return different pairs.

**Fix:** Generate the pair ONCE, return both.

```python
elif platform_id == "x":
    params["scope"] = " ".join(s)
    if code_challenge:
        params["code_challenge"] = code_challenge
    else:
        verifier, challenge = make_pkce_pair()
        params["code_challenge"] = challenge
    params["code_challenge_method"] = code_challenge_method
```

```python
if platform_id == "x" and not code_challenge:
    # Reuse the same pair generated above by calling make_pkce_pair() once
    # and threading the verifier through params. Simplest fix: return the
    # verifier from the params dict when we generated the challenge.
    result["code_verifier"] = params.get("_internal_code_verifier") or make_pkce_pair()[0]
```

Actually cleaner: refactor `build_authorize_url` to track the verifier:

```python
def build_authorize_url(...) -> dict:
    ...
    code_verifier: str | None = None
    s = scopes or p.scopes
    if s:
        if platform_id == "x":
            params["scope"] = " ".join(s)
            if code_challenge:
                params["code_challenge"] = code_challenge
                code_verifier = None  # caller provided, they own it
            else:
                code_verifier, challenge = make_pkce_pair()
                params["code_challenge"] = challenge
            params["code_challenge_method"] = code_challenge_method
        else:
            params["scope"] = " ".join(s)
    if extra:
        params.update(extra)
    url = f"{p.authorize_url}?{urlencode(params)}"
    result = {"url": url, "state": state}
    if code_verifier is not None:
        result["code_verifier"] = code_verifier
    return result
```

**Test:** Add to `tests/test_oauth.py`:

```python
def test_x_pkce_challenge_matches_verifier():
    result = build_authorize_url("x", client_id="cid", redirect_uri="https://x/cb")
    import hashlib, base64
    expected = base64.urlsafe_b64encode(
        hashlib.sha256(result["code_verifier"].encode("ascii")).digest()
    ).rstrip(b"=").decode("ascii")
    assert expected in result["url"]
    assert f"code_challenge={expected}" in result["url"]
```

**Verification:** `python -m pytest tests/ -k pkce -v` — passes.

#### Task 4: O-3 — Add State expiration to Node server

**File:** `agents/oauth/src/server.js` (state mgmt section)

**Step 1:** Replace the `Map`-based state store with a wrapper that tracks `created_at` and auto-expires entries.

```js
function makeStateStore(ttlMs = 10 * 60 * 1000) {
  const map = new Map();
  // Periodic cleanup (every minute, remove entries older than ttl)
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [state, entry] of map) {
      if (now - entry.created_at > ttlMs) map.delete(state);
    }
  }, 60_000);
  cleanup.unref?.();  // Don't keep event loop alive
  return {
    set: (state, entry) => map.set(state, { ...entry, created_at: entry.created_at || Date.now() }),
    get: (state) => {
      const entry = map.get(state);
      if (!entry) return null;
      if (Date.now() - entry.created_at > ttlMs) {
        map.delete(state);
        return null;
      }
      return entry;
    },
    delete: (state) => map.delete(state),
    size: () => map.size,
    stop: () => clearInterval(cleanup),
  };
}
```

**Step 2:** Update `buildServer` to use it:

```js
const states = stateStore || makeStateStore();
```

And in the callback handler, check `if (!entry) return json(res, 400, { error: "invalid_or_expired_state" });` — already exists, just needs the new check.

**Step 3:** Add test:

```js
test("OAuth: state expires after TTL", async () => {
  const states = makeStateStore(50);  // 50ms TTL
  states.set("abc", { user_id: "u1", platform_id: "youtube", code_verifier: null });
  assert.ok(states.get("abc"));
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(states.get("abc"), null, "state should have expired");
});
```

**Verification:** `node --test tests/test_oauth_server.js`

#### Task 5: O-4 — Don't fallback to YOUTUBE_CLIENT_ID for non-YouTube platforms

**File:** `agents/oauth/src/server.js:144`

**Fix:** Use platform-specific env var; throw if missing.

```js
const envKey = `${pid.toUpperCase()}_CLIENT_ID`;
const clientId = process.env[envKey];
if (!clientId) {
  return json(res, 503, {
    error: "platform_not_configured",
    platform_id: pid,
    required_env: envKey,
  });
}
```

**Test:**

```js
test("OAuth: /connect returns 503 when client_id env not set", async () => {
  // clear all platform envs first
  for (const k of Object.keys(process.env)) {
    if (k.endsWith("_CLIENT_ID")) delete process.env[k];
  }
  const { server, port } = await startTestServer();
  const r = await fetch(`http://127.0.0.1:${port}/connect/youtube`, { headers: authHeaders() });
  assert.equal(r.status, 503);
  const body = await r.json();
  assert.equal(body.error, "platform_not_configured");
});
```

#### Task 6: O-5 — Return immutable view of tokenStore

**File:** `agents/oauth/src/server.js:245`

**Fix:** Wrap in `Object.freeze` or return a getter.

```js
return {
  server, port, host,
  get tokenStore() { return new Map([...tokens]); },  // shallow copy
  get stateStore() { return states; },  // wrapper has its own API
};
```

Actually, a `get` accessor in a returned object literal is fine, but `tokens` is `Map<string, Map<string, ...>>` so a deep copy would be needed for true immutability. For now, a shallow copy + documentation is acceptable.

**Test:** Mutate returned store, verify internal state unchanged.

#### Task 7: O-6 — Normalize token schema to snake_case

**File:** `agents/oauth/src/server.js:50-62`

**Fix:** Only accept snake_case (since `AccessToken` from Python uses snake_case). Remove camelCase fallbacks.

```js
function saveToken(userId, token) {
  if (!tokens.has(userId)) tokens.set(userId, new Map());
  // Defensive copy with strict snake_case — schema drift is a bug source
  const pub = {
    platform_id: token.platform_id,
    access_token: token.access_token,
    refresh_token: token.refresh_token || null,
    token_type: token.token_type || "Bearer",
    expires_at: token.expires_at || null,
    scope: token.scope || "",
  };
  if (!pub.platform_id || !pub.access_token) {
    throw new Error("token missing required fields");
  }
  tokens.get(userId).set(pub.platform_id, pub);
  return pub;
}
```

**Test:** Reject tokens without required fields.

#### Task 8: O-7 — Document or remove PKCE truncation

**File:** `agents/oauth/vireo_oauth/oauth.py:204`

**Fix:** Remove `[:96]` (it's a no-op, secrets.token_urlsafe(64) returns 86 chars) and update comment.

```python
def make_pkce_pair() -> tuple[str, str]:
    """PKCE verifier + S256 challenge (for platforms that require it, e.g. X).
    Verifier: 43-128 chars per RFC 7636. token_urlsafe(64) gives 86 chars.
    """
    verifier = secrets.token_urlsafe(64)  # 86 chars
    challenge = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge_b64 = base64.urlsafe_b64encode(challenge).rstrip(b"=").decode("ascii")
    return verifier, challenge_b64
```

**Test:** N/A (cosmetic). Verify existing tests still pass.

#### Task 9: O-8 — Add retry logic to HTTPTokenClient

**File:** `agents/oauth/vireo_oauth/oauth.py:281-291`

**Fix:** Add `retries` parameter, retry on TimeoutError / 5xx with exponential backoff.

```python
def post_form(self, url, data, headers=None, retries=2):
    body = urlencode(data).encode("utf-8")
    h = {"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"}
    if headers:
        h.update(headers)
    last_error = None
    for attempt in range(retries + 1):
        try:
            if self._transport is not None:
                status, payload = self._transport("POST", url, h, body)
            else:
                status, payload = self._raw_post(url, body, h)
            # Retry on 5xx (server transient error)
            if 500 <= status < 600 and attempt < retries:
                last_error = f"server error {status}"
                time.sleep(0.2 * (2 ** attempt))
                continue
            return status, payload
        except (TimeoutError, urllib.error.URLError) as e:
            last_error = str(e)
            if attempt < retries:
                time.sleep(0.2 * (2 ** attempt))
                continue
            raise OAuthError(f"token request failed after {retries + 1} attempts: {e}") from e
    # If we get here, last error was a 5xx
    raise OAuthError(f"token request failed after {retries + 1} attempts: {last_error}")
```

**Test:** Mock transport that returns 500 twice then 200 — verify retries and success.

#### Task 10: O-10 — Add status/code to OAuthError

**File:** `agents/oauth/vireo_oauth/oauth.py:259-260`

**Fix:**

```python
class OAuthError(Exception):
    def __init__(self, message: str, status: int = 0, code: str = "oauth_error") -> None:
        super().__init__(message)
        self.status = status
        self.code = code
```

And update raise sites:

```python
raise OAuthError("token exchange failed", status, "token_exchange_failed")
```

**Test:** N/A (additive).

#### Task 11: O-11 — Don't leak raw provider JSON in errors

**File:** `agents/oauth/vireo_oauth/oauth.py:344-345`

**Fix:** Log raw internally, return generic message to caller.

```python
if status >= 400:
    log.warning("token exchange failed: %s %s", status, payload)
    # Don't echo raw provider response — could leak internal error details
    raise OAuthError(f"token exchange failed (status {status})", status, "token_exchange_failed")
```

**Test:** N/A.

#### Task 12: O-12 — Require oauth module to be non-null

**File:** `agents/oauth/src/server.js:39-43`

**Fix:** Throw at buildServer if `oauth` is null and not in test mode.

```js
export function buildServer({ oauth, ... } = {}) {
  if (!oauth) {
    throw new Error("buildServer requires an `oauth` module — pass it explicitly or use the python bridge");
  }
  const o = oauth;
  ...
}
```

This is a breaking change — update existing tests to always pass a stub.

#### Task 13: O-13 + O-14 — Per-request CORS headers (already covered in O-1)

#### Task 14: Final verification + full project test run

**Run:** `cd "C:/Users/koval/OneDrive/случайный проект/vireo" && node tests/run-all.mjs`

**Expected:** 1148+18 = 1166+ tests passing (OAuth goes from 60 to 60+ new tests).

### Success Criteria

- [ ] All 14 enumerated bugs either fixed or explicitly deferred with rationale
- [ ] All existing 60 OAuth tests still pass
- [ ] New regression tests cover all P0/P1 fixes
- [ ] `node tests/run-all.mjs` green at 1166+/1166+ across 24 suites
- [ ] CORS hardened platform-wide (OAuth was the last holdout using hardcoded `*`)
- [ ] Audit report written: `docs/OAUTH_AUDIT_2026-06-07.md`

---

## 🚀 After Phase 1

Proceed to **Phase 2 (Video deep audit)** following same Component-Deep pattern. Estimated 8-10h.

If you want to defer Phase 2/3/4 — they all have clear scope and can be tackled later without blocking each other.

---

**План готов. С чего начинаем?**
1. **Phase 1 (OAuth)** — recommend, follows "perfect then expand" pattern
2. **Phase 3 (E2E smoke)** — alternative if you want validation gate first
3. **Phase 4 (infra)** — if you want to ship soon over deep quality
