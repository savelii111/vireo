"""Integration tests for the Style Learner HTTP server."""
import json
import threading
import time
import pytest
import urllib.request
import urllib.error

from vireo_style_learner import create_app


@pytest.fixture(scope="module")
def server():
    srv = create_app(host="127.0.0.1", port=18001)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    time.sleep(0.2)
    yield srv
    srv.shutdown()
    srv.server_close()


def _post(path, payload):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"http://127.0.0.1:18001{path}",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _get(path):
    with urllib.request.urlopen(f"http://127.0.0.1:18001{path}", timeout=5) as resp:
        return json.loads(resp.read().decode("utf-8"))


def test_health(server):
    out = _get("/health")
    assert out["status"] == "ok"
    assert out["agent"] == "style-learner"


def test_version(server):
    out = _get("/version")
    assert "version" in out
    assert out["version"] == "0.2.0"


def test_analyze_endpoint(server):
    pieces = [
        {"text": "Did you know that AI is changing everything? Subscribe for more!", "title": "AI is INSANE"},
        {"text": "Holy cow, this tech is wild. Watch till the end.", "title": "Tech you MUST see"},
    ]
    out = _post("/analyze", {"pieces": pieces, "user_id": "u1"})
    assert out["ok"] is True
    dna = out["style_dna"]
    assert dna["user_id"] == "u1"
    assert dna["sample_count"] == 2
    assert dna["confidence"] > 0


def test_analyze_with_real_energetic_corpus(server):
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "..", "tests", "fixtures"))
    from creators import ENERGETIC_YOUTUBER, PROFESSIONAL_LINKEDIN
    out = _post("/analyze", {"pieces": ENERGETIC_YOUTUBER, "user_id": "yt"})
    assert out["style_dna"]["tone"] in ("energetic", "casual")
    out2 = _post("/analyze", {"pieces": PROFESSIONAL_LINKEDIN, "user_id": "li"})
    assert out2["style_dna"]["tone"] == "professional"
    assert out2["style_dna"]["tone"] != out["style_dna"]["tone"]


def test_hooks_endpoint(server):
    out = _post("/hooks", {"text": "Did you know that X is true?", "title": "Did you know?"})
    assert out["ok"] is True
    assert len(out["hooks"]) > 0


def test_suggest_endpoint(server):
    out = _post("/suggest", {"style_dna": {"hook_patterns": ["curiosity", "command"]}, "n": 3})
    assert out["ok"] is True
    assert len(out["suggestions"]) == 3


def test_bad_json_returns_400(server):
    req = urllib.request.Request(
        "http://127.0.0.1:18001/analyze",
        data=b"{not json}",
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with pytest.raises(urllib.error.HTTPError) as e:
        urllib.request.urlopen(req, timeout=5)
    assert e.value.code == 400


def test_unknown_route_404(server):
    with pytest.raises(urllib.error.HTTPError) as e:
        _get("/nope")
    assert e.value.code == 404


def test_analyze_endpoint_unknown_route(server):
    with pytest.raises(urllib.error.HTTPError) as e:
        _post("/nope", {})
    assert e.value.code == 404
