"""W1D2 smoke tests for the 4 newly-wired endpoints.

Day 2 of Week 1: chapters, hooks-style, moments, broll. None of these
needed an LLM (the LLM-dependent paths are left as `llm_response` to
the caller). We just verify the routes parse inputs, call the right
helper, and return the documented shape.
"""
import json
import sys
import threading
import time
from http.client import HTTPConnection
from pathlib import Path

# Make vireo_video importable when run from agents/video/.
sys.path.insert(0, str(Path(__file__).parent.parent))

from vireo_video.server import build_server


def _start_server():
  built = build_server(host="127.0.0.1", port=0)
  server = built["server"]
  # Replace the placeholder port (0) with the real one the OS picked.
  port = server.server_address[1]
  thread = threading.Thread(target=server.serve_forever, daemon=True)
  thread.start()
  time.sleep(0.1)
  return server, port


def _post(port: int, path: str, body: dict) -> dict:
  conn = HTTPConnection("127.0.0.1", port, timeout=5)
  try:
    payload = json.dumps(body).encode()
    conn.request("POST", path, body=payload, headers={"Content-Type": "application/json"})
    resp = conn.getresponse()
    return {"status": resp.status, "body": json.loads(resp.read().decode() or "{}")}
  finally:
    conn.close()


def test_chapters_endpoint_happy_path():
  server, port = _start_server()
  try:
    r = _post(port, "/chapters", {
      "transcript": {
        "text": "Welcome to the channel. Today we cover Python decorators. "
                "Decorators wrap functions. They take callable and return callable.",
        "duration": 60.0,
        "language": "en",
      },
      "llm_response": json.dumps({
        "chapters": [
          {"start": 0.0, "end": 5.0, "title": "Introduction", "summary": "Welcome"},
          {"start": 5.0, "end": 60.0, "title": "Python Decorators", "summary": "The topic"},
        ]
      }),
    })
    assert r["status"] == 200, r
    assert "chapters" in r["body"]
    assert "prompt" in r["body"]
    assert r["body"]["prompt_chars"] > 0
    chapters = r["body"]["chapters"]
    assert len(chapters) == 2
    # Every chapter has start, end, title.
    for c in chapters:
      assert "start" in c and "end" in c and "title" in c
  finally:
    server.shutdown()


def test_chapters_endpoint_rejects_missing_transcript():
  server, port = _start_server()
  try:
    r = _post(port, "/chapters", {"transcript": {}})
    assert r["status"] == 400
    assert r["body"]["error"] == "missing_transcript"
  finally:
    server.shutdown()


def test_hooks_style_endpoint_classifies_question():
  server, port = _start_server()
  try:
    r = _post(port, "/hooks-style", {
      "transcript": {
        "text": "Did you know that Python decorators can wrap any callable? Let me show you.",
        "duration": 10.0,
        "language": "en",
      },
      "topic": "Python decorators",
    })
    assert r["status"] == 200, r
    assert "style" in r["body"]
    assert "confidence" in r["body"]
    assert 0.0 <= r["body"]["confidence"] <= 1.0
    assert "suggested_rewrite" in r["body"]
  finally:
    server.shutdown()


def test_moments_endpoint_returns_prompt():
  server, port = _start_server()
  try:
    r = _post(port, "/moments", {
      "transcript": {
        "text": "The most surprising thing about Python is how simple decorators are. "
                "Five lines of code, and you've just modified every function in the program.",
        "duration": 30.0,
        "language": "en",
      },
      "platform": "tiktok",
      "max_moments": 3,
    })
    assert r["status"] == 200, r
    assert "prompt" in r["body"]
    assert r["body"]["platform"] == "tiktok"
    assert r["body"]["max_moments"] == 3
    # No llm_response supplied → moments list is empty
    assert r["body"]["moments"] == []
  finally:
    server.shutdown()


def test_moments_endpoint_parses_llm_response():
  server, port = _start_server()
  try:
    r = _post(port, "/moments", {
      "transcript": {
        "text": "Some transcript text. It has two sentences.",
        "duration": 20.0,
        "language": "en",
      },
      "platform": "youtube_shorts",
      "max_moments": 2,
      # parse_moments_response expects the same JSON shape chapters
      # does: {"moments": [{"start":, "end":, ...}, ...]}.
      "llm_response": json.dumps({
        "moments": [
          {"start": 5.0, "end": 10.0, "score": 0.9, "reason": "Big claim"},
          {"start": 15.0, "end": 20.0, "score": 0.7, "reason": "Surprise"},
        ]
      }),
    })
    assert r["status"] == 200, r
    moments = r["body"]["moments"]
    assert len(moments) == 2
    for m in moments:
      assert "start" in m and "end" in m
  finally:
    server.shutdown()


def test_broll_endpoint_extracts_queries():
  server, port = _start_server()
  try:
    r = _post(port, "/broll", {
      "text": "The golden gate bridge looks beautiful at sunset. "
              "Engineers built it in 1937. Today it carries a million cars per day.",
      "max_query_words": 3,
      "max_queries": 5,
    })
    assert r["status"] == 200, r
    queries = r["body"]["queries"]
    assert 1 <= len(queries) <= 3
    # Each query is short.
    for q in queries:
      assert 1 <= len(q.split()) <= 3
  finally:
    server.shutdown()


def test_broll_endpoint_rejects_empty_text():
  server, port = _start_server()
  try:
    r = _post(port, "/broll", {"text": ""})
    assert r["status"] == 400
    assert r["body"]["error"] == "missing_text"
  finally:
    server.shutdown()


def test_unknown_route_returns_404():
  server, port = _start_server()
  try:
    conn = HTTPConnection("127.0.0.1", port, timeout=5)
    conn.request("POST", "/this-route-does-not-exist", body=b"{}", headers={"Content-Type": "application/json"})
    resp = conn.getresponse()
    body = json.loads(resp.read().decode() or "{}")
    assert resp.status == 404
    assert body["error"] == "not_found"
    conn.close()
  finally:
    server.shutdown()


if __name__ == "__main__":
  import pytest
  sys.exit(pytest.main([__file__, "-v"]))
