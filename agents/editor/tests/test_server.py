"""Integration tests for the Editor HTTP server."""
import json
import threading
import time
import pytest
import urllib.request
import urllib.error

from vireo_editor import create_app


@pytest.fixture(scope="module")
def server():
    srv = create_app(host="127.0.0.1", port=18002)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    time.sleep(0.2)
    yield srv
    srv.shutdown()
    srv.server_close()


def _post(path, payload):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"http://127.0.0.1:18002{path}",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _get(path):
    with urllib.request.urlopen(f"http://127.0.0.1:18002{path}", timeout=5) as resp:
        return json.loads(resp.read().decode("utf-8"))


def test_health(server):
    out = _get("/health")
    assert out == {"status": "ok", "agent": "editor"}


def test_version(server):
    out = _get("/version")
    assert out["version"] == "0.1.0"


def test_edit_endpoint(server):
    out = _post("/edit", {
        "content": {
            "id": "x",
            "text": "First. Second. Third with 50% growth. Fourth. Subscribe!",
            "duration_sec": 30,
        },
        "style_dna": {"tone": "educational"},
        "target_sec": 15,
    })
    assert out["ok"] is True
    plan = out["edit_plan"]
    assert plan["source_id"] == "x"
    assert plan["output_duration_sec"] <= 15
    assert len(plan["cuts"]) > 0


def test_edit_endpoint_with_segments(server):
    out = _post("/edit", {
        "content": {
            "id": "seg-1",
            "segments": [
                {"text": "Intro. Hook sentence!", "start": 0, "end": 3},
                {"text": "Body. The result is 99% accuracy.", "start": 3, "end": 8},
                {"text": "Subscribe!", "start": 8, "end": 10},
            ],
        },
        "style_dna": {"tone": "energetic"},
        "target_sec": 10,
    })
    assert out["ok"] is True
    assert len(out["edit_plan"]["cuts"]) > 0


def test_hooks_endpoint(server):
    out = _post("/hooks", {
        "style_dna": {"hook_patterns": ["curiosity"], "topics": ["AI"], "cta_patterns": ["engagement"]},
        "n": 3,
    })
    assert out["ok"] is True
    assert len(out["hooks"]) == 3
    assert len(out["ctas"]) == 3


def test_score_endpoint(server):
    out = _post("/score", {
        "sentence": "Did you know that 73% of users prefer this?",
        "position": 0,
        "total": 5,
        "style_dna": {"tone": "curious"},
    })
    assert out["ok"] is True
    assert 0.0 <= out["score"] <= 1.0
    assert out["score"] > 0.6  # question + number + hook position


def test_bad_json_400(server):
    req = urllib.request.Request(
        "http://127.0.0.1:18002/edit",
        data=b"{bad}",
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with pytest.raises(urllib.error.HTTPError) as e:
        urllib.request.urlopen(req, timeout=5)
    assert e.value.code == 400


def test_404(server):
    with pytest.raises(urllib.error.HTTPError) as e:
        _get("/nope")
    assert e.value.code == 404
