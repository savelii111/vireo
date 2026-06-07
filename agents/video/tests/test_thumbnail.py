"""Tests for DALL-E 3 thumbnail generation."""

import base64
import json
import pytest
from unittest.mock import AsyncMock, patch
from vireo_video.thumbnail import generate_thumbnail, save_thumbnail, ThumbnailError, _build_prompt


# --- Prompt builder ---

def test_build_prompt_title_only():
    p = _build_prompt("My Video", "", "")
    assert "My Video" in p
    assert "YouTube thumbnail" in p

def test_build_prompt_with_description():
    p = _build_prompt("Title", "About cooking", "")
    assert "cooking" in p

def test_build_prompt_with_style():
    p = _build_prompt("Title", "", "energetic, bold")
    assert "energetic" in p
    assert "bold" in p

def test_build_prompt_includes_quality_keywords():
    p = _build_prompt("T", "", "")
    assert "eye-catching" in p
    assert "Vibrant" in p


# --- generate_thumbnail ---

@pytest.mark.asyncio
async def test_generate_thumbnail_missing_api_key():
    with patch.dict("os.environ", {"OPENAI_API_KEY": ""}, clear=False):
        with pytest.raises(ThumbnailError) as exc_info:
            await generate_thumbnail("Test", api_key="")
        assert exc_info.value.code == "MISSING_API_KEY"

@pytest.mark.asyncio
async def test_generate_thumbnail_success():
    fake_b64 = base64.b64encode(b"fake-png-data").decode()
    mock_result = {
        "data": [{
            "b64_json": fake_b64,
            "revised_prompt": "A bold YouTube thumbnail for Test Video",
        }]
    }

    async def mock_transport(url, **kwargs):
        return mock_result

    result = await generate_thumbnail(
        "Test Video",
        description="Tutorial",
        style_hints="energetic",
        transport=mock_transport,
        api_key="test-key",
    )
    assert result["image_bytes"] == b"fake-png-data"
    assert "bold" in result["revised_prompt"]
    assert result["size"] == "1792x1024"

@pytest.mark.asyncio
async def test_generate_thumbnail_custom_size():
    fake_b64 = base64.b64encode(b"x").decode()
    mock_result = {"data": [{"b64_json": fake_b64}]}

    async def mock_transport(url, **kwargs):
        return mock_result

    result = await generate_thumbnail("T", size="1024x1024", transport=mock_transport, api_key="k")
    assert result["size"] == "1024x1024"

@pytest.mark.asyncio
async def test_generate_thumbnail_api_error():
    async def mock_transport(url, **kwargs):
        raise ThumbnailError("Rate limited", 429, "API_ERROR")

    with pytest.raises(ThumbnailError) as exc_info:
        await generate_thumbnail("T", transport=mock_transport, api_key="k")
    assert exc_info.value.status == 429

@pytest.mark.asyncio
async def test_generate_thumbnail_no_data():
    async def mock_transport(url, **kwargs):
        return {"data": []}

    with pytest.raises(ThumbnailError) as exc_info:
        await generate_thumbnail("T", transport=mock_transport, api_key="k")
    assert exc_info.value.code == "NO_IMAGE_DATA"

@pytest.mark.asyncio
async def test_generate_thumbnail_transport_exception():
    async def mock_transport(url, **kwargs):
        raise ConnectionError("network down")

    with pytest.raises(ThumbnailError) as exc_info:
        await generate_thumbnail("T", transport=mock_transport, api_key="k")
    assert exc_info.value.code == "API_REQUEST_FAILED"

@pytest.mark.asyncio
async def test_generate_thumbnail_sends_correct_headers():
    captured = {}

    async def mock_transport(url, **kwargs):
        captured["url"] = url
        captured["headers"] = kwargs.get("headers", {})
        captured["data"] = json.loads(kwargs.get("data", "{}"))
        return {"data": [{"b64_json": base64.b64encode(b"x").decode()}]}

    await generate_thumbnail(
        "My Vid",
        description="Desc",
        style_hints="fun",
        size="1024x1792",
        quality="hd",
        transport=mock_transport,
        api_key="sk-test123",
    )
    assert captured["url"].endswith("/v1/images/generations")
    assert captured["headers"]["Authorization"] == "Bearer sk-test123"
    assert captured["data"]["model"] == "dall-e-3"
    assert captured["data"]["size"] == "1024x1792"
    assert captured["data"]["quality"] == "hd"
    assert captured["data"]["response_format"] == "b64_json"


# --- save_thumbnail ---

@pytest.mark.asyncio
async def test_save_thumbnail(tmp_path):
    fake_b64 = base64.b64encode(b"test-image-bytes").decode()
    result = {
        "image_bytes": b"test-image-bytes",
        "revised_prompt": "test",
        "size": "1024x1024",
        "quality": "standard",
    }
    out = str(tmp_path / "thumb.png")
    saved = await save_thumbnail(result, out)
    assert saved == out
    with open(out, "rb") as f:
        assert f.read() == b"test-image-bytes"
