"""Tests for the real LLM clients (HTTP + OpenAI).

These tests use an injected `transport` function so no real network
calls happen. They verify retry, rate-limit, timeout, cost tracking,
and error mapping.
"""
from __future__ import annotations
import json
import time
import pytest
from vireo_style_learner.llm_client import (
    HTTPLLMClient,
    OpenAIClient,
    MockLLMClient,
    UsageStats,
    LLMError,
    LLMAuthError,
    LLMRateLimitError,
    LLMTimeoutError,
    estimate_cost_cents,
    approx_tokens,
    PRICING_CENTS_PER_1K,
)


# ----- helpers -----

def make_transport(responses: list):
    """Create a transport that returns canned responses in order.

    Each response is a tuple (status, body_dict).
    """
    it = iter(responses)

    def transport(method, url, headers, body):
        try:
            return next(it)
        except StopIteration:
            return (500, {"error": {"message": "no more canned responses"}})

    return transport


def ok_response(content: str = "Hello!", input_tokens: int = 10, output_tokens: int = 5):
    return (200, {
        "id": "test",
        "choices": [{"message": {"role": "assistant", "content": content}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": input_tokens, "completion_tokens": output_tokens},
    })


# ===== approx_tokens =====

def test_approx_tokens_empty():
    assert approx_tokens("") == 0


def test_approx_tokens_short_text():
    n = approx_tokens("hi there")
    assert n >= 1


def test_approx_tokens_cyrillic_uses_smaller_divisor():
    # 100 cyrillic chars → ~50 tokens
    n = approx_tokens("а" * 100)
    assert n >= 40


def test_approx_tokens_english_uses_larger_divisor():
    # 100 english chars → ~25 tokens
    n = approx_tokens("a" * 100)
    assert n <= 30


# ===== estimate_cost_cents =====

def test_estimate_cost_known_model():
    cost = estimate_cost_cents("gpt-4o-mini", 1000, 500)
    expected = 1.0 * 0.015 + 0.5 * 0.06
    assert abs(cost - expected) < 1e-6


def test_estimate_cost_unknown_model_is_zero():
    assert estimate_cost_cents("nonexistent-model", 1000, 500) == 0.0


# ===== UsageStats =====

def test_usage_stats_initial_zero():
    u = UsageStats()
    assert u.input_tokens == 0
    assert u.request_count == 0


def test_usage_stats_add_combines():
    a = UsageStats(input_tokens=10, output_tokens=5, request_count=1, total_cost_cents=0.01)
    b = UsageStats(input_tokens=20, output_tokens=10, request_count=2, total_cost_cents=0.02)
    a.add(b)
    assert a.input_tokens == 30
    assert a.output_tokens == 15
    assert a.request_count == 3
    assert abs(a.total_cost_cents - 0.03) < 1e-9


def test_usage_stats_to_dict_has_all_fields():
    u = UsageStats(input_tokens=5, output_tokens=3)
    d = u.to_dict()
    for k in ["input_tokens", "output_tokens", "request_count", "error_count", "retry_count", "total_cost_cents"]:
        assert k in d


# ===== MockLLMClient =====

def test_mock_llm_call_count_increments():
    c = MockLLMClient()
    c.json_complete("test prompt")
    c.json_complete("another")
    assert c.call_count == 2


def test_mock_llm_get_usage_starts_zero():
    c = MockLLMClient()
    u = c.get_usage()
    assert u.request_count == 0


def test_mock_llm_usage_increments_after_call():
    c = MockLLMClient()
    c.json_complete("a" * 200)
    u = c.get_usage()
    assert u.request_count == 1
    assert u.input_tokens > 0
    assert u.output_tokens > 0


# ===== HTTPLLMClient =====

def test_http_client_uses_transport_and_parses_response():
    c = HTTPLLMClient(api_key="sk-test", model="gpt-4o-mini", transport=make_transport([ok_response("hi")]))
    out = c.complete("hello")
    assert out == "hi"


def test_http_client_tracks_tokens_and_cost():
    c = HTTPLLMClient(api_key="sk-test", model="gpt-4o-mini", transport=make_transport([ok_response("hi", 100, 50)]))
    c.complete("hello")
    u = c.get_usage()
    assert u.input_tokens == 100
    assert u.output_tokens == 50
    assert u.request_count == 1
    assert u.total_cost_cents > 0


def test_http_client_json_complete_parses_json():
    transport = make_transport([ok_response('{"tone": "energetic", "pacing": "fast"}')])
    c = HTTPLLMClient(api_key="sk-test", model="gpt-4o-mini", transport=transport)
    result = c.json_complete("test")
    assert result["tone"] == "energetic"


def test_http_client_json_complete_extracts_json_from_text():
    transport = make_transport([ok_response('Here is the analysis: {"tone": "casual"} -- end')])
    c = HTTPLLMClient(api_key="sk-test", model="gpt-4o-mini", transport=transport)
    result = c.json_complete("test")
    assert result["tone"] == "casual"


def test_http_client_401_raises_auth_error():
    transport = make_transport([(401, {"error": {"message": "invalid key"}})])
    c = HTTPLLMClient(api_key="sk-bad", model="gpt-4o-mini", transport=transport)
    with pytest.raises(LLMAuthError):
        c.complete("hello")


def test_http_client_403_raises_auth_error():
    transport = make_transport([(403, {"error": {"message": "forbidden"}})])
    c = HTTPLLMClient(api_key="sk-bad", model="gpt-4o-mini", transport=transport)
    with pytest.raises(LLMAuthError):
        c.complete("hello")


def test_http_client_400_raises_llm_error():
    transport = make_transport([(400, {"error": {"message": "bad request"}})])
    c = HTTPLLMClient(api_key="sk", model="gpt-4o-mini", transport=transport)
    with pytest.raises(LLMError):
        c.complete("hello")


def test_http_client_500_raises_and_retries_then_succeeds():
    # First two calls 500, third call 200
    responses = [
        (500, {"error": "internal"}),
        (500, {"error": "internal"}),
        ok_response("recovered"),
    ]
    c = HTTPLLMClient(api_key="sk", model="gpt-4o-mini", max_retries=3, backoff_base=0.01, transport=make_transport(responses))
    out = c.complete("hello")
    assert out == "recovered"
    u = c.get_usage()
    assert u.retry_count == 2
    assert u.request_count == 1  # only counts final success


def test_http_client_429_retries_with_backoff():
    responses = [
        (429, {"error": "rate limited", "retry_after": 0.01}),
        ok_response("ok"),
    ]
    c = HTTPLLMClient(api_key="sk", model="gpt-4o-mini", max_retries=2, backoff_base=0.01, transport=make_transport(responses))
    out = c.complete("hello")
    assert out == "ok"
    assert c.get_usage().retry_count == 1


def test_http_client_429_exhausted_retries_raises():
    responses = [(429, {"error": "rate limited"})] * 5
    c = HTTPLLMClient(api_key="sk", model="gpt-4o-mini", max_retries=2, backoff_base=0.01, transport=make_transport(responses))
    with pytest.raises(LLMRateLimitError):
        c.complete("hello")
    assert c.get_usage().error_count == 1


def test_http_client_5xx_exhausted_retries_raises():
    responses = [(500, {"error": "internal"})] * 5
    c = HTTPLLMClient(api_key="sk", model="gpt-4o-mini", max_retries=2, backoff_base=0.01, transport=make_transport(responses))
    with pytest.raises(LLMError):
        c.complete("hello")
    assert c.get_usage().error_count == 1


def test_http_client_does_not_retry_auth_errors():
    responses = [(401, {"error": "bad key"})] * 3
    c = HTTPLLMClient(api_key="sk", model="gpt-4o-mini", max_retries=3, backoff_base=0.01, transport=make_transport(responses))
    with pytest.raises(LLMAuthError):
        c.complete("hello")
    # 401 doesn't retry — only one call
    assert c.get_usage().retry_count == 0


def test_http_client_backoff_timing_with_short_intervals():
    """3 retries × 0.01s backoff should not take more than 0.5s."""
    responses = [(500, {"error": "x"})] * 4
    c = HTTPLLMClient(api_key="sk", model="gpt-4o-mini", max_retries=3, backoff_base=0.01, transport=make_transport(responses))
    t0 = time.time()
    with pytest.raises(LLMError):
        c.complete("x")
    elapsed = time.time() - t0
    assert elapsed < 1.0, f"backoff too slow: {elapsed}s"


def test_http_client_no_api_key_sends_empty_auth_header():
    """The transport should see Authorization: '' (or no header)."""
    seen_headers = {}

    def capture(method, url, headers, body):
        seen_headers.update(headers)
        return ok_response("ok")

    c = HTTPLLMClient(api_key="", model="gpt-4o-mini", transport=capture)
    c.complete("x")
    # Either Authorization is "" or absent
    assert seen_headers.get("Authorization", "") == ""


def test_http_client_sends_correct_request_body():
    """Verify the body shape matches OpenAI's chat completions spec."""
    seen = {}
    def capture(method, url, headers, body):
        seen["body"] = body
        return ok_response("ok")

    c = HTTPLLMClient(api_key="sk", model="gpt-4o-mini", transport=capture)
    c.complete("hello", system="be terse", max_tokens=200)
    body = seen["body"]
    assert body["model"] == "gpt-4o-mini"
    assert body["max_tokens"] == 200
    assert body["temperature"] == 0.3
    assert body["messages"][0] == {"role": "system", "content": "be terse"}
    assert body["messages"][1] == {"role": "user", "content": "hello"}


def test_http_client_json_complete_sends_schema_hint_in_system():
    seen = {}
    def capture(method, url, headers, body):
        seen["body"] = body
        return ok_response('{"a": 1}')

    c = HTTPLLMClient(api_key="sk", model="gpt-4o-mini", transport=capture)
    c.json_complete("test", schema_hint={"a": "int", "b": "str"})
    sys_msg = seen["body"]["messages"][0]["content"]
    assert "JSON" in sys_msg
    assert '"a"' in sys_msg  # schema hint included


def test_http_client_uses_correct_url():
    seen_urls = []
    def capture(method, url, headers, body):
        seen_urls.append(url)
        return ok_response("ok")

    c = HTTPLLMClient(api_key="sk", model="gpt-4o-mini", base_url="https://api.openai.com/v1", transport=capture)
    c.complete("x")
    assert seen_urls[0] == "https://api.openai.com/v1/chat/completions"


def test_http_client_custom_base_url():
    seen_urls = []
    def capture(method, url, headers, body):
        seen_urls.append(url)
        return ok_response("ok")

    c = HTTPLLMClient(api_key="sk", model="llama3", base_url="http://localhost:11434/v1", transport=capture)
    c.complete("x")
    assert seen_urls[0] == "http://localhost:11434/v1/chat/completions"


def test_http_client_strips_trailing_slash_from_base_url():
    seen_urls = []
    def capture(method, url, headers, body):
        seen_urls.append(url)
        return ok_response("ok")

    c = HTTPLLMClient(api_key="sk", model="x", base_url="http://localhost:11434/v1/", transport=capture)
    c.complete("x")
    assert seen_urls[0] == "http://localhost:11434/v1/chat/completions"


# ===== OpenAIClient =====

def test_openai_client_falls_back_to_http_when_sdk_missing():
    """Even without the openai package, OpenAIClient should work via HTTP."""
    c = OpenAIClient(api_key="sk", model="gpt-4o-mini", transport=make_transport([ok_response("via-http")]))
    out = c.complete("x")
    assert out == "via-http"


def test_openai_client_no_api_key_does_not_crash():
    """Without key, client should not raise at construction time."""
    c = OpenAIClient(api_key="", model="gpt-4o-mini", transport=make_transport([ok_response("x")]))
    # With transport, we never hit the SDK
    out = c.complete("x")
    assert out == "x"


def test_openai_client_json_complete():
    c = OpenAIClient(api_key="sk", model="gpt-4o-mini", transport=make_transport([ok_response('{"a": 1, "b": "hello"}')]))
    out = c.json_complete("x")
    assert out == {"a": 1, "b": "hello"}


def test_openai_client_get_usage_via_http():
    c = OpenAIClient(api_key="sk", model="gpt-4o-mini", transport=make_transport([ok_response("x", 100, 50)]))
    c.complete("x")
    u = c.get_usage()
    assert u.input_tokens == 100
    assert u.output_tokens == 50


# ===== MockLLMClient still works as a drop-in =====

def test_mock_drop_in_replacement():
    """MockLLMClient should satisfy the LLMClient protocol."""
    mock = MockLLMClient()
    text = mock.complete("hello world")
    assert "mock-llm" in text

    j = mock.json_complete("test")
    assert "tone" in j
    assert "pacing" in j
