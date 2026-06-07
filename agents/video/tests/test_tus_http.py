"""HTTP-level integration test for TUS resumable upload endpoints.

Brings up the real video HTTP server (in-memory), then exercises the
TUS protocol: create -> PATCH chunk -> PATCH chunk -> complete.
"""
import io
import os
import json
import socket
import time
import threading
import urllib.request
import urllib.error
from http.client import HTTPConnection

import pytest

# Force dev-mode auth (no JWT_SECRET required).
os.environ.setdefault("VIREO_ENV", "development")
os.environ.setdefault("VIREO_VIDEO_AUTH_REQUIRED", "false")

from vireo_video.server import build_server


def _free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


@pytest.fixture(scope="module")
def server():
    port = _free_port()
    built = build_server(host="127.0.0.1", port=port)
    thread = threading.Thread(target=built["server"].serve_forever, daemon=True)
    thread.start()
    # Give the socket a moment to start listening.
    time.sleep(0.1)
    yield {"port": port, "host": "127.0.0.1", "built": built}
    built["server"].shutdown()
    built["server"].server_close()


def _http_request(conn: HTTPConnection, method: str, path: str,
                  headers: dict = None, body: bytes = b""):
    conn.request(method, path, body=body, headers=headers or {})
    resp = conn.getresponse()
    return resp


# ---------- TUS protocol over real HTTP ----------

def test_tus_create_returns_201_with_location(server):
    conn = HTTPConnection(server["host"], server["port"])
    headers = {
        "Tus-Resumable": "1.0.0",
        "Upload-Length": "100",
        "Upload-Metadata": "filename dmlkZW8ubXA0,filetype dmlkZW8vbXA0",
    }
    resp = _http_request(conn, "POST", "/upload/resumable", headers=headers)
    assert resp.status == 201, f"expected 201 got {resp.status}: {resp.read()!r}"
    loc = resp.getheader("Location")
    assert loc and loc.startswith("/upload/resumable/"), f"bad Location: {loc!r}"
    body = json.loads(resp.read().decode("utf-8"))
    assert body["upload_length"] == 100
    assert body["offset"] == 0
    assert body["filename"] == "video.mp4"
    conn.close()


def test_tus_full_round_trip(server):
    conn = HTTPConnection(server["host"], server["port"])
    # 1) create
    headers = {
        "Tus-Resumable": "1.0.0",
        "Upload-Length": "20",
        "Upload-Metadata": "filename dGVzdC5tcDQ=",
    }
    resp = _http_request(conn, "POST", "/upload/resumable", headers=headers)
    assert resp.status == 201
    location = resp.getheader("Location")
    resp.read()
    # 2) HEAD -> offset 0
    resp = _http_request(conn, "HEAD", location, headers={"Tus-Resumable": "1.0.0"})
    assert resp.status == 200
    assert resp.getheader("Upload-Offset") == "0"
    assert resp.getheader("Upload-Length") == "20"
    # 3) PATCH chunk 1 (0-9)
    resp = _http_request(
        conn, "PATCH", location,
        headers={
            "Tus-Resumable": "1.0.0",
            "Content-Range": "bytes 0-9/20",
            "Content-Type": "application/offset+octet-stream",
        },
        body=b"0123456789",
    )
    assert resp.status == 204
    assert resp.getheader("Upload-Offset") == "10"
    # 4) PATCH chunk 2 (10-19)
    resp = _http_request(
        conn, "PATCH", location,
        headers={
            "Tus-Resumable": "1.0.0",
            "Content-Range": "bytes 10-19/20",
            "Content-Type": "application/offset+octet-stream",
        },
        body=b"abcdefghij",
    )
    assert resp.status == 204
    assert resp.getheader("Upload-Offset") == "20"
    # 5) HEAD -> offset 20 (complete)
    resp = _http_request(conn, "HEAD", location, headers={"Tus-Resumable": "1.0.0"})
    assert resp.status == 200
    assert resp.getheader("Upload-Offset") == "20"
    conn.close()


def test_tus_rejects_oversize(server):
    conn = HTTPConnection(server["host"], server["port"])
    resp = _http_request(
        conn, "POST", "/upload/resumable",
        headers={"Upload-Length": str(10 * 1024 * 1024 * 1024)},  # 10 GB > 5 GB cap
    )
    assert resp.status == 413
    conn.close()


def test_tus_rejects_missing_upload_length(server):
    conn = HTTPConnection(server["host"], server["port"])
    resp = _http_request(
        conn, "POST", "/upload/resumable",
        headers={"Tus-Resumable": "1.0.0"},
    )
    assert resp.status == 400
    conn.close()


def test_tus_resume_after_offset(server):
    """Simulate a client that lost connection mid-upload and resumes."""
    conn = HTTPConnection(server["host"], server["port"])
    # 1) create for 100 bytes
    resp = _http_request(
        conn, "POST", "/upload/resumable",
        headers={"Upload-Length": "100", "Upload-Metadata": "filename dGVzdC5tcDQ="},
    )
    loc = resp.getheader("Location")
    resp.read()
    # 2) Upload 50 bytes
    resp = _http_request(
        conn, "PATCH", loc,
        headers={"Content-Range": "bytes 0-49/100"},
        body=b"x" * 50,
    )
    assert resp.status == 204
    # 3) Connection drops (simulated by reopening)
    conn.close()
    # 4) New connection: HEAD to discover where to resume
    conn2 = HTTPConnection(server["host"], server["port"])
    resp = _http_request(conn2, "HEAD", loc, headers={"Tus-Resumable": "1.0.0"})
    assert resp.getheader("Upload-Offset") == "50"
    # 5) Resume from offset 50
    resp = _http_request(
        conn2, "PATCH", loc,
        headers={"Content-Range": "bytes 50-99/100"},
        body=b"y" * 50,
    )
    assert resp.status == 204
    assert resp.getheader("Upload-Offset") == "100"
    conn2.close()


def test_tus_delete_aborts(server):
    conn = HTTPConnection(server["host"], server["port"])
    resp = _http_request(
        conn, "POST", "/upload/resumable",
        headers={"Upload-Length": "100"},
    )
    loc = resp.getheader("Location")
    resp.read()
    resp = _http_request(conn, "DELETE", loc, headers={"Tus-Resumable": "1.0.0"})
    assert resp.status == 204
    # HEAD should now 404
    resp = _http_request(conn, "HEAD", loc, headers={"Tus-Resumable": "1.0.0"})
    assert resp.status == 404
    conn.close()


def test_tus_options_advertises_protocol(server):
    conn = HTTPConnection(server["host"], server["port"])
    resp = _http_request(conn, "OPTIONS", "/upload/resumable")
    assert resp.status == 204
    assert resp.getheader("Tus-Resumable") == "1.0.0"
    assert "creation" in (resp.getheader("Tus-Extension") or "")
    conn.close()


def test_tus_unknown_session_404(server):
    conn = HTTPConnection(server["host"], server["port"])
    resp = _http_request(
        conn, "HEAD", "/upload/resumable/deadbeef",
        headers={"Tus-Resumable": "1.0.0"},
    )
    assert resp.status == 404
    conn.close()
