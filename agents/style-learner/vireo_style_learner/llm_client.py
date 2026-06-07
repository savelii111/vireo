"""LLM client interface and implementations.

The LLMEnhancedStyleLearner uses a client to get deeper understanding
of the corpus. The interface is pluggable:

  - MockLLMClient: deterministic, offline, perfect for tests + dev
  - OpenAIClient: real OpenAI Chat Completions API (with retries, cost tracking)
  - HTTPClient: generic HTTP client (for Anthropic, local models, proxies)

The mock is realistic enough to drive end-to-end behavior. When you swap
in a real client, the call site doesn't change.
"""
from __future__ import annotations
import json
import re
import time
import hashlib
import logging
import threading
from typing import Any, Protocol
from dataclasses import dataclass, field

log = logging.getLogger("vireo.llm")


class LLMClient(Protocol):
    def complete(self, prompt: str, *, system: str = "", max_tokens: int = 1024) -> str: ...
    def json_complete(self, prompt: str, *, system: str = "", schema_hint: dict | None = None) -> dict: ...
    def get_usage(self) -> "UsageStats": ...


@dataclass
class UsageStats:
    """Token usage and cost tracking for LLM calls."""
    input_tokens: int = 0
    output_tokens: int = 0
    request_count: int = 0
    error_count: int = 0
    retry_count: int = 0
    total_cost_cents: float = 0.0

    def add(self, other: "UsageStats") -> None:
        self.input_tokens += other.input_tokens
        self.output_tokens += other.output_tokens
        self.request_count += other.request_count
        self.error_count += other.error_count
        self.retry_count += other.retry_count
        self.total_cost_cents += other.total_cost_cents

    def to_dict(self) -> dict:
        return {
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "request_count": self.request_count,
            "error_count": self.error_count,
            "retry_count": self.retry_count,
            "total_cost_cents": round(self.total_cost_cents, 6),
        }


# Pricing in cents per 1K tokens (USD ~ EUR ~ 1:1 for simplicity).
# Updated for 2025-2026 models.
PRICING_CENTS_PER_1K = {
    "gpt-4o-mini":   {"input": 0.015, "output": 0.06},
    "gpt-4o":        {"input": 0.25,  "output": 1.0},
    "gpt-4-turbo":   {"input": 1.0,   "output": 3.0},
    "gpt-3.5-turbo": {"input": 0.05,  "output": 0.15},
    "claude-3-haiku":  {"input": 0.025, "output": 0.125},
    "claude-3-sonnet": {"input": 0.30,  "output": 1.50},
}


def estimate_cost_cents(model: str, input_tokens: int, output_tokens: int) -> float:
    p = PRICING_CENTS_PER_1K.get(model)
    if not p:
        return 0.0
    return (input_tokens / 1000.0) * p["input"] + (output_tokens / 1000.0) * p["output"]


def approx_tokens(text: str) -> int:
    """Rough token count: 1 token ~ 4 chars (English), ~2 chars (CJK/RU)."""
    if not text:
        return 0
    has_cyrillic = bool(re.search(r"[а-яё]", text))
    divisor = 2.0 if has_cyrillic else 4.0
    return max(1, int(len(text) / divisor))


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------

class LLMError(Exception):
    """Base error for LLM client."""
    pass


class LLMAuthError(LLMError):
    pass


class LLMRateLimitError(LLMError):
    def __init__(self, message: str, retry_after_sec: float = 0):
        super().__init__(message)
        self.retry_after_sec = retry_after_sec


class LLMTimeoutError(LLMError):
    pass


# ---------------------------------------------------------------------------
# Mock LLM — deterministic, pattern-driven, no network
# ---------------------------------------------------------------------------

class MockLLMClient:
    """Deterministic mock that produces realistic LLM-style output.

    Key insight: it analyzes the SAME inputs the rule-based analyzer does
    and returns a JSON object compatible with the LLM enhancer contract.
    The output is fully deterministic per input (uses SHA-256) so tests
    are reproducible.
    """

    def __init__(self, latency_ms: int = 0) -> None:
        self.latency_ms = latency_ms
        self.call_count = 0
        self.last_prompt = ""
        self._usage = UsageStats()
        self._lock = threading.Lock()

    def complete(self, prompt: str, *, system: str = "", max_tokens: int = 1024) -> str:
        with self._lock:
            self.call_count += 1
            self.last_prompt = prompt
            self._usage.request_count += 1
            self._usage.input_tokens += approx_tokens(prompt) + approx_tokens(system)
            self._usage.output_tokens += min(20, approx_tokens(prompt) // 10)
        if self.latency_ms:
            time.sleep(self.latency_ms / 1000)
        return f"[mock-llm] analyzed {len(prompt)} chars"

    def json_complete(self, prompt: str, *, system: str = "", schema_hint: dict | None = None) -> dict:
        with self._lock:
            self.call_count += 1
            self.last_prompt = prompt
            self._usage.request_count += 1
            self._usage.input_tokens += approx_tokens(prompt) + approx_tokens(system)
            self._usage.output_tokens += 200
        if self.latency_ms:
            time.sleep(self.latency_ms / 1000)
        return _mock_style_analysis(prompt)

    def get_usage(self) -> UsageStats:
        return UsageStats(**self._usage.to_dict())


def _mock_style_analysis(prompt: str) -> dict:
    """Produce a deterministic style analysis from the prompt."""
    text = prompt.lower()

    has_excl = text.count("!")
    has_q = text.count("?")
    has_emoji = bool(re.search(r"[\U0001F300-\U0001FAFF]|[\U00002600-\U000027BF]", prompt))
    has_ru = bool(re.search(r"[а-яё]", prompt))
    has_formal = bool(re.search(r"\b(therefore|furthermore|however|moreover|однако|следовательно|таким образом)\b", text))
    has_casual = bool(re.search(r"\b(bro|dude|yeah|nope|короче|блин|норм|типа)\b", text))
    has_story = bool(re.search(r"\b(i remember|once|years ago|однажды|помню)\b", text))
    has_edu = bool(re.search(r"\b(because|therefore|means|example|suppose|допустим|например)\b", text))
    has_provoc = bool(re.search(r"\b(nobody|truth|hot take|controversial|ничего не понимают)\b", text))
    has_number = len(re.findall(r"\b\d+(?:\.\d+)?%?\b", prompt))

    tones = {
        "professional": has_formal,
        "casual": has_casual,
        "energetic": has_excl > 5 or has_emoji,
        "storytelling": has_story,
        "educational": has_edu,
        "provocative": has_provoc,
    }
    dominant_tone = max(tones, key=lambda k: tones[k]) if any(tones.values()) else "neutral"

    avg_words_per_sent = _avg_sentence_words(prompt)
    if avg_words_per_sent < 8:
        pacing = "fast"
    elif avg_words_per_sent > 15:
        pacing = "slow"
    else:
        pacing = "medium"

    avg_word_len = _avg_word_len(prompt)
    if avg_word_len < 4.5:
        vocab = "simple"
    elif avg_word_len < 6:
        vocab = "conversational"
    elif avg_word_len < 7:
        vocab = "educated"
    else:
        vocab = "academic"

    humor = "subtle"
    if re.search(r"\b(lol|lmao|wtf|bro|yooo|ахах|ору)\b", text):
        humor = "absurd"
    elif re.search(r"\b(sarcasm|sarcastic|ирония|сарказм)\b", text):
        humor = "sarcastic"
    elif re.search(r"\b(everyone does|we all|все знают)\b", text):
        humor = "observational"

    first_lines = re.findall(r"(?:^|\n)([^\n.!?]{5,80}[.!?])", prompt)[:8]
    hook_patterns = []
    for line in first_lines:
        ll = line.lower().strip()
        if ll.startswith(("did you know", "here's why", "the truth is")):
            hook_patterns.append("curiosity")
        elif ll.startswith(("stop", "wait", "listen", "look")):
            hook_patterns.append("command")
        elif ll.startswith(("i ", "yesterday", "today")):
            hook_patterns.append("temporal")
        elif ll.endswith("?"):
            hook_patterns.append("question")
        elif ll.startswith(('"', "'")):
            hook_patterns.append("quote")
        elif re.match(r"^\d", ll):
            hook_patterns.append("number")
        else:
            hook_patterns.append("statement")
    if has_ru:
        hook_patterns.append("curiosity_ru")
    hook_patterns = list(dict.fromkeys(hook_patterns))[:5]

    cta_patterns = []
    if re.search(r"\b(subscribe|follow|like|comment|подпишись|лайк)\b", text):
        cta_patterns.append("engagement")
    if re.search(r"\b(check|see more|description|ссылка|описание)\b", text):
        cta_patterns.append("traffic")
    if re.search(r"\b(thoughts|what do you think|что думаете)\b", text):
        cta_patterns.append("discussion")
    if re.search(r"\b(see you|next video|до встречи|в следующем)\b", text):
        cta_patterns.append("retention")
    if re.search(r"\b(dm me|direct message|пиши в лс|в директ)\b", text):
        cta_patterns.append("dm")

    topics = re.findall(r"\b[A-ZА-Я][a-zа-я]{2,}\b", prompt)
    topic_counts: dict[str, int] = {}
    for t in topics:
        topic_counts[t] = topic_counts.get(t, 0) + 1
    top_topics = [w for w, _ in sorted(topic_counts.items(), key=lambda x: -x[1])[:8]]

    confidence = min(1.0, 0.5 + 0.05 * len(prompt) / 1000 + 0.1 * len(hook_patterns))

    return {
        "tone": dominant_tone,
        "pacing": pacing,
        "vocabulary_level": vocab,
        "humor_style": humor,
        "hook_patterns": hook_patterns,
        "cta_patterns": cta_patterns,
        "topics": top_topics,
        "avg_content_length_sec": max(60, int(avg_words_per_sent * 30)),
        "confidence": round(confidence, 3),
        "_signals": {
            "exclamations": has_excl,
            "questions": has_q,
            "numbers": has_number,
            "russian": has_ru,
            "english": bool(re.search(r"[a-z]", prompt)),
        },
    }


def _avg_sentence_words(text: str) -> float:
    sentences = [s for s in re.split(r"[.!?]+", text) if s.strip()]
    if not sentences:
        return 0.0
    return sum(len(re.findall(r"\b\w+\b", s)) for s in sentences) / len(sentences)


def _avg_word_len(text: str) -> float:
    words = re.findall(r"\b\w+\b", text)
    if not words:
        return 0.0
    return sum(len(w) for w in words) / len(words)


# ---------------------------------------------------------------------------
# HTTP LLM client — generic, supports OpenAI Chat Completions + custom URLs
# ---------------------------------------------------------------------------

class HTTPLLMClient:
    """Generic HTTP LLM client.

    Targets OpenAI's /v1/chat/completions endpoint by default, but can be
    pointed at any OpenAI-compatible URL (Anthropic via proxy, Ollama,
    vLLM, LM Studio, etc.).

    Features:
    - retries with exponential backoff
    - rate-limit (429) handling
    - timeout
    - token + cost tracking
    - injected transport for tests (no real network in unit tests)
    """

    def __init__(
        self,
        *,
        base_url: str = "https://api.openai.com/v1",
        api_key: str = "",
        model: str = "gpt-4o-mini",
        timeout_sec: float = 30.0,
        max_retries: int = 3,
        backoff_base: float = 0.5,
        transport: Any = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.timeout_sec = timeout_sec
        self.max_retries = max_retries
        self.backoff_base = backoff_base
        self._transport = transport  # callable: (method, url, headers, body) -> (status, body_dict)
        self._usage = UsageStats()
        self._lock = threading.Lock()

    def _request(self, method: str, path: str, body: dict) -> dict:
        url = f"{self.base_url}{path}"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}" if self.api_key else "",
        }
        # Use injected transport if provided (for tests); else real HTTP.
        if self._transport is not None:
            response = self._transport(method, url, headers, body)
            status, payload = response
        else:
            try:
                import urllib.request, urllib.error
                data = json.dumps(body).encode("utf-8")
                req = urllib.request.Request(url, data=data, headers=headers, method=method)
                with urllib.request.urlopen(req, timeout=self.timeout_sec) as resp:
                    raw = resp.read().decode("utf-8")
                    status = resp.status
                    payload = json.loads(raw) if raw else {}
            except urllib.error.HTTPError as e:
                raw = e.read().decode("utf-8") if e.fp else ""
                try:
                    payload = json.loads(raw) if raw else {}
                except json.JSONDecodeError:
                    payload = {"error": {"message": raw or str(e), "type": "http_error"}}
                status = e.code
            except (TimeoutError, urllib.error.URLError) as e:
                raise LLMTimeoutError(f"request timed out: {e}") from e

        # Map status to errors
        if status == 401 or status == 403:
            raise LLMAuthError(f"auth failed ({status}): {payload}")
        if status == 429:
            ra = 0.0
            # Try to parse Retry-After
            if isinstance(payload, dict) and payload.get("retry_after"):
                ra = float(payload["retry_after"])
            raise LLMRateLimitError(f"rate limited ({status}): {payload}", retry_after_sec=ra)
        if status >= 500:
            raise LLMError(f"server error ({status}): {payload}")
        if status >= 400:
            raise LLMError(f"client error ({status}): {payload}")
        return payload

    def _request_with_retry(self, body: dict) -> dict:
        last_err: Exception | None = None
        for attempt in range(self.max_retries + 1):
            try:
                return self._request("POST", "/chat/completions", body)
            except LLMRateLimitError as e:
                wait = e.retry_after_sec or self.backoff_base * (2 ** attempt)
                if attempt < self.max_retries:
                    with self._lock:
                        self._usage.retry_count += 1
                    log.warning(f"rate limited, retrying in {wait:.2f}s (attempt {attempt+1})")
                    time.sleep(wait)
                last_err = e
            except (LLMTimeoutError, LLMError) as e:
                # Auth errors are not retriable
                if isinstance(e, LLMAuthError):
                    with self._lock:
                        self._usage.error_count += 1
                    raise
                if attempt < self.max_retries:
                    with self._lock:
                        self._usage.retry_count += 1
                    wait = self.backoff_base * (2 ** attempt)
                    log.warning(f"request failed ({type(e).__name__}), retrying in {wait:.2f}s (attempt {attempt+1})")
                    time.sleep(wait)
                    last_err = e
                else:
                    with self._lock:
                        self._usage.error_count += 1
                    raise
        # Exhausted retries
        with self._lock:
            self._usage.error_count += 1
        raise last_err or LLMError("max retries exceeded")

    def complete(self, prompt: str, *, system: str = "", max_tokens: int = 1024) -> str:
        msgs = []
        if system:
            msgs.append({"role": "system", "content": system})
        msgs.append({"role": "user", "content": prompt})
        body = {
            "model": self.model,
            "messages": msgs,
            "max_tokens": max_tokens,
            "temperature": 0.3,
        }
        r = self._request_with_retry(body)
        # Track usage
        usage = r.get("usage", {}) if isinstance(r, dict) else {}
        in_tok = usage.get("prompt_tokens", approx_tokens(prompt) + approx_tokens(system))
        out_tok = usage.get("completion_tokens", 0)
        cost = estimate_cost_cents(self.model, in_tok, out_tok)
        with self._lock:
            self._usage.request_count += 1
            self._usage.input_tokens += in_tok
            self._usage.output_tokens += out_tok
            self._usage.total_cost_cents += cost
        choice = (r.get("choices") or [{}])[0]
        return (choice.get("message") or {}).get("content") or ""

    def json_complete(self, prompt: str, *, system: str = "", schema_hint: dict | None = None) -> dict:
        sys_msg = (system or "You are a JSON API. Respond with only valid JSON.")
        if schema_hint:
            sys_msg += f"\n\nExpected JSON shape: {json.dumps(schema_hint)[:2000]}"
        text = self.complete(prompt, system=sys_msg, max_tokens=2048)
        # Try to extract JSON
        m = re.search(r"\{.*\}", text, re.DOTALL)
        if m:
            return json.loads(m.group(0))
        return json.loads(text)

    def get_usage(self) -> UsageStats:
        with self._lock:
            return UsageStats(**self._usage.to_dict())


# ---------------------------------------------------------------------------
# OpenAI client — uses the openai SDK if available, else HTTPLLMClient
# ---------------------------------------------------------------------------

class OpenAIClient:
    """Real OpenAI client. Activated when OPENAI_API_KEY is set.

    Prefers the official `openai` SDK if installed; falls back to the
    pure-Python HTTPLLMClient otherwise.
    """

    def __init__(
        self,
        model: str = "gpt-4o-mini",
        api_key: str | None = None,
        base_url: str | None = None,
        timeout_sec: float = 30.0,
        max_retries: int = 3,
        transport: Any = None,
    ) -> None:
        api_key = api_key or ""
        self.model = model
        # If a transport is explicitly provided, use HTTP path (testable without SDK).
        if transport is not None:
            self._sdk_client = None
            self._http = HTTPLLMClient(
                base_url=base_url or "https://api.openai.com/v1",
                api_key=api_key,
                model=model,
                timeout_sec=timeout_sec,
                max_retries=max_retries,
                transport=transport,
            )
            return
        self._sdk_client = None
        try:
            from openai import OpenAI
            kwargs: dict[str, Any] = {"api_key": api_key, "timeout": timeout_sec, "max_retries": max_retries}
            if base_url:
                kwargs["base_url"] = base_url
            self._sdk_client = OpenAI(**kwargs)
        except ImportError:
            pass
        if self._sdk_client is None:
            # Fall back to HTTP
            self._http = HTTPLLMClient(
                base_url=base_url or "https://api.openai.com/v1",
                api_key=api_key,
                model=model,
                timeout_sec=timeout_sec,
                max_retries=max_retries,
                transport=transport,
            )
        else:
            self._http = None

    def complete(self, prompt: str, *, system: str = "", max_tokens: int = 1024) -> str:
        if self._sdk_client is not None:
            msgs = []
            if system:
                msgs.append({"role": "system", "content": system})
            msgs.append({"role": "user", "content": prompt})
            r = self._sdk_client.chat.completions.create(
                model=self.model, messages=msgs, max_tokens=max_tokens, temperature=0.3
            )
            return (r.choices[0].message.content or "")
        return self._http.complete(prompt, system=system, max_tokens=max_tokens)

    def json_complete(self, prompt: str, *, system: str = "", schema_hint: dict | None = None) -> dict:
        if self._sdk_client is not None:
            return _json_via_sdk(self._sdk_client, self.model, prompt, system, schema_hint)
        return self._http.json_complete(prompt, system=system, schema_hint=schema_hint)

    def get_usage(self) -> UsageStats:
        if self._http is not None:
            return self._http.get_usage()
        return UsageStats()  # SDK doesn't expose internal counters without manual wiring


def _json_via_sdk(client: Any, model: str, prompt: str, system: str, schema_hint: dict | None) -> dict:
    sys_msg = (system or "You are a JSON API. Respond with only valid JSON.")
    if schema_hint:
        sys_msg += f"\n\nExpected JSON shape: {json.dumps(schema_hint)[:2000]}"
    msgs = [{"role": "system", "content": sys_msg}, {"role": "user", "content": prompt}]
    r = client.chat.completions.create(model=model, messages=msgs, max_tokens=2048, temperature=0.3)
    text = (r.choices[0].message.content or "")
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if m:
        return json.loads(m.group(0))
    return json.loads(text)
