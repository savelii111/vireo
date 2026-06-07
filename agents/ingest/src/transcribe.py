"""Audio transcription via OpenAI Whisper API (HTTP, no SDK required).

Features:
- file upload (multipart/form-data)
- language hint
- response_format = verbose_json (returns segments with timestamps)
- cost tracking
- retries via injected transport

Drop-in testable: tests inject a transport function that returns canned
Whisper responses without hitting the network.
"""
from __future__ import annotations
import os
import json
import time
import base64
import logging
import threading
from typing import Any
from dataclasses import dataclass, field

log = logging.getLogger("vireo.transcribe")


@dataclass
class Segment:
    start: float
    end: float
    text: str

    def to_dict(self) -> dict:
        return {"start": self.start, "end": self.end, "text": self.text}


@dataclass
class TranscriptResult:
    text: str
    language: str
    duration_sec: float
    segments: list[Segment]
    cost_cents: float = 0.0
    model: str = "whisper-1"
    file_size_bytes: int = 0

    def to_dict(self) -> dict:
        return {
            "text": self.text,
            "language": self.language,
            "duration_sec": self.duration_sec,
            "segments": [s.to_dict() for s in self.segments],
            "cost_cents": self.cost_cents,
            "model": self.model,
            "file_size_bytes": self.file_size_bytes,
        }


# Pricing: $0.006 per minute of audio. Convert USD to cents (1 USD = 100 cents)
WHISPER_PRICE_USD_PER_MIN = 0.006
USD_TO_CENTS = 100.0


def whisper_cost_cents(duration_sec: float) -> float:
    if duration_sec <= 0:
        return 0.0
    minutes = duration_sec / 60.0
    return minutes * WHISPER_PRICE_USD_PER_MIN * USD_TO_CENTS


class WhisperError(Exception):
    pass


class WhisperClient:
    """Whisper transcription client.

    Usage:
        c = WhisperClient(api_key="sk-...")
        result = c.transcribe_file("path/to/audio.mp3")
        print(result.text, result.segments)

    For tests, pass `transport` to inject canned responses.
    """

    def __init__(
        self,
        *,
        api_key: str = "",
        model: str = "whisper-1",
        base_url: str = "https://api.openai.com/v1",
        timeout_sec: float = 120.0,
        max_retries: int = 2,
        transport: Any = None,
    ) -> None:
        self.api_key = api_key
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.timeout_sec = timeout_sec
        self.max_retries = max_retries
        self._transport = transport
        self._lock = threading.Lock()
        self._stats = {
            "request_count": 0,
            "error_count": 0,
            "retry_count": 0,
            "total_minutes": 0.0,
            "total_cost_cents": 0.0,
        }

    def get_stats(self) -> dict:
        with self._lock:
            return dict(self._stats)

    def _request(self, audio_bytes: bytes, filename: str, language: str | None) -> dict:
        boundary = "----vireo-boundary-x7y3k"
        # Build multipart body manually (no extra deps).
        parts: list[bytes] = []
        # model field
        parts.append(f"--{boundary}\r\n".encode())
        parts.append(b'Content-Disposition: form-data; name="model"\r\n\r\n')
        parts.append(self.model.encode() + b"\r\n")
        # response_format field
        parts.append(f"--{boundary}\r\n".encode())
        parts.append(b'Content-Disposition: form-data; name="response_format"\r\n\r\n')
        parts.append(b"verbose_json\r\n")
        # language field (optional)
        if language:
            parts.append(f"--{boundary}\r\n".encode())
            parts.append(b'Content-Disposition: form-data; name="language"\r\n\r\n')
            parts.append(language.encode() + b"\r\n")
        # file field
        parts.append(f"--{boundary}\r\n".encode())
        parts.append(f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'.encode())
        parts.append(b"Content-Type: application/octet-stream\r\n\r\n")
        parts.append(audio_bytes)
        parts.append(b"\r\n")
        # close
        parts.append(f"--{boundary}--\r\n".encode())
        body = b"".join(parts)
        headers = {
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        }
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        url = f"{self.base_url}/audio/transcriptions"

        if self._transport is not None:
            response = self._transport("POST", url, headers, body)
            status, payload = response
        else:
            try:
                import urllib.request, urllib.error
                req = urllib.request.Request(url, data=body, headers=headers, method="POST")
                with urllib.request.urlopen(req, timeout=self.timeout_sec) as resp:
                    raw = resp.read().decode("utf-8")
                    status = resp.status
                    payload = json.loads(raw) if raw else {}
            except urllib.error.HTTPError as e:
                raw = e.read().decode("utf-8") if e.fp else ""
                try:
                    payload = json.loads(raw) if raw else {}
                except json.JSONDecodeError:
                    payload = {"error": {"message": raw or str(e)}}
                status = e.code
            except (TimeoutError, urllib.error.URLError) as e:
                raise WhisperError(f"request timed out: {e}") from e

        if status == 401 or status == 403:
            raise WhisperError(f"auth failed ({status}): {payload}")
        if status >= 500:
            raise WhisperError(f"server error ({status}): {payload}")
        if status >= 400:
            raise WhisperError(f"client error ({status}): {payload}")
        return payload

    def transcribe_file(
        self,
        path: str,
        *,
        language: str | None = None,
        max_bytes: int = 500 * 1024 * 1024,
    ) -> TranscriptResult:
        if not os.path.isfile(path):
            raise FileNotFoundError(f"file not found: {path}")
        size = os.path.getsize(path)
        if size > max_bytes:
            raise ValueError(f"file too large: {size} > {max_bytes}")
        with open(path, "rb") as f:
            data = f.read()
        return self._transcribe_with_retry(data, os.path.basename(path), language, size)

    def transcribe_bytes(
        self,
        audio_bytes: bytes,
        filename: str = "audio.mp3",
        *,
        language: str | None = None,
    ) -> TranscriptResult:
        return self._transcribe_with_retry(audio_bytes, filename, language, len(audio_bytes))

    def _transcribe_with_retry(
        self, data: bytes, filename: str, language: str | None, size: int
    ) -> TranscriptResult:
        last_err: Exception | None = None
        for attempt in range(self.max_retries + 1):
            try:
                payload = self._request(data, filename, language)
                with self._lock:
                    self._stats["request_count"] += 1
                return self._parse_response(payload, size)
            except WhisperError as e:
                msg = str(e)
                retriable = "server error" in msg or "timed out" in msg
                if retriable and attempt < self.max_retries:
                    with self._lock:
                        self._stats["retry_count"] += 1
                    time.sleep(0.5 * (2 ** attempt))
                    last_err = e
                    continue
                with self._lock:
                    self._stats["error_count"] += 1
                raise
        with self._lock:
            self._stats["error_count"] += 1
        raise last_err or WhisperError("max retries exceeded")

    def _parse_response(self, payload: dict, file_size: int) -> TranscriptResult:
        text = payload.get("text", "")
        language = payload.get("language", "unknown")
        duration = float(payload.get("duration", 0.0))
        segments_raw = payload.get("segments") or []
        segments = []
        for s in segments_raw:
            try:
                segments.append(Segment(
                    start=float(s.get("start", 0.0)),
                    end=float(s.get("end", 0.0)),
                    text=str(s.get("text", "")).strip(),
                ))
            except (TypeError, ValueError):
                continue
        cost = whisper_cost_cents(duration)
        with self._lock:
            self._stats["total_minutes"] += duration / 60.0
            self._stats["total_cost_cents"] += cost
        return TranscriptResult(
            text=text,
            language=language,
            duration_sec=duration,
            segments=segments,
            cost_cents=cost,
            model=self.model,
            file_size_bytes=file_size,
        )
