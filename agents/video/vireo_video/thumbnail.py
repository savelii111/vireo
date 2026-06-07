"""DALL-E 3 thumbnail generation for Vireo video agent.

Generates YouTube-style thumbnails from title + description using OpenAI DALL-E 3.
"""

import base64
import json
from typing import Any, Callable, Optional


class ThumbnailError(Exception):
    def __init__(self, message: str, status: int = 500, code: str = "THUMBNAIL_ERROR"):
        super().__init__(message)
        self.status = status
        self.code = code


async def generate_thumbnail(
    title: str,
    description: str = "",
    style_hints: str = "",
    size: str = "1792x1024",
    quality: str = "standard",
    model: str = "dall-e-3",
    api_key: Optional[str] = None,
    transport: Optional[Callable] = None,
    base_url: str = "https://api.openai.com",
) -> dict[str, Any]:
    """Generate a thumbnail image using DALL-E 3.

    Args:
        title: Video title to base the thumbnail on.
        description: Additional context about the video.
        style_hints: Style DNA hints (e.g. "energetic, bold colors").
        size: Image size — "1024x1024", "1792x1024", or "1024x1792".
        quality: "standard" or "hd".
        model: Model to use (default "dall-e-3").
        api_key: OpenAI API key. Falls back to OPENAI_API_KEY env var.
        transport: Injectable async fetch function for testing.
        base_url: OpenAI API base URL.

    Returns:
        dict with keys: image_bytes (base64), revised_prompt, url (if returned).
    """
    import os

    key = api_key or os.environ.get("OPENAI_API_KEY", "")
    if not key:
        raise ThumbnailError("OPENAI_API_KEY not set", 500, "MISSING_API_KEY")

    if transport is None:
        import aiohttp
        _default_session = None

        async def _default_transport(url: str, **kwargs) -> dict:
            nonlocal _default_session
            if _default_session is None or _default_session.closed:
                _default_session = aiohttp.ClientSession()
            async with _default_session.request(**kwargs) as resp:
                data = await resp.json()
                if resp.status >= 400:
                    raise ThumbnailError(
                        data.get("error", {}).get("message", f"HTTP {resp.status}"),
                        resp.status,
                        "API_ERROR",
                    )
                return data

        transport = _default_transport

    prompt = _build_prompt(title, description, style_hints)

    payload = {
        "model": model,
        "prompt": prompt,
        "n": 1,
        "size": size,
        "quality": quality,
        "response_format": "b64_json",
    }

    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }

    try:
        result = await transport(
            f"{base_url}/v1/images/generations",
            method="POST",
            headers=headers,
            data=json.dumps(payload),
        )
    except ThumbnailError:
        raise
    except Exception as e:
        raise ThumbnailError(f"API request failed: {e}", 502, "API_REQUEST_FAILED")

    if "data" not in result or not result["data"]:
        raise ThumbnailError("No image data returned", 502, "NO_IMAGE_DATA")

    img = result["data"][0]
    image_bytes = base64.b64decode(img.get("b64_json", ""))

    return {
        "image_bytes": image_bytes,
        "revised_prompt": img.get("revised_prompt", prompt),
        "url": img.get("url"),
        "size": size,
        "quality": quality,
    }


def _build_prompt(title: str, description: str, style_hints: str) -> str:
    """Build a DALL-E 3 prompt optimized for YouTube thumbnails."""
    parts = [
        f"YouTube thumbnail for video titled: \"{title}\".",
    ]
    if description:
        parts.append(f"Context: {description}.")
    if style_hints:
        parts.append(f"Style: {style_hints}.")
    parts.append(
        "Bold, eye-catching design with strong contrast. "
        "Large text space. Vibrant colors. Professional quality. "
        "No watermarks or borders."
    )
    return " ".join(parts)


async def save_thumbnail(
    result: dict,
    output_path: str,
) -> str:
    """Save thumbnail image bytes to disk.

    Args:
        result: Dict returned by generate_thumbnail().
        output_path: File path to write the image to.

    Returns:
        The output path.
    """
    import os
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    with open(output_path, "wb") as f:
        f.write(result["image_bytes"])
    return output_path
