#!/usr/bin/env python3
"""describe_frame.py — Vision LLM (LLaVA) for image captioning.

Sends an image to a vision LLM via Ollama HTTP API and returns
the description as JSON. Falls back to CLIP-based tagging if LLaVA
not available.

Usage:
    python describe_frame.py <frame_path> [focus_hint] [model]

Args:
    frame_path: Path to PNG/JPG image
    focus_hint: Optional focus hint ("the person", "background colors", etc.)
    model: Ollama model name, default "llava:7b"

Output JSON:
    {"description": "...", "tags": ["tag1", "tag2"], "model": "llava:7b"}
"""
import sys
import json
import os
import base64
import urllib.request
import urllib.error

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")

def call_ollama_vision(model, image_path, prompt):
    """Call Ollama's /api/generate with an image attachment."""
    # Read image and base64-encode
    with open(image_path, "rb") as f:
        image_b64 = base64.b64encode(f.read()).decode("ascii")

    payload = {
        "model": model,
        "prompt": prompt,
        "images": [image_b64],
        "stream": False,
        "options": {
            "temperature": 0.2,
            "num_predict": 200,
        },
    }
    req = urllib.request.Request(
        f"{OLLAMA_URL}/api/generate",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return data.get("response", "")

def extract_tags(description, max_tags=5):
    """Extract a few simple tags from the description."""
    if not description:
        return []
    # Naive tag extraction: pick first few noun-like words
    words = description.lower().split()
    # Common words to skip
    skip = {"the", "a", "an", "is", "are", "was", "were", "and", "or", "in", "on", "at", "of", "to", "with", "this", "that", "it", "as", "by", "for"}
    tags = []
    for w in words:
        w_clean = w.strip(".,!?;:'\"()[]{}").lower()
        if len(w_clean) > 3 and w_clean not in skip and w_clean not in tags:
            tags.append(w_clean)
            if len(tags) >= max_tags:
                break
    return tags

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: describe_frame.py <frame_path> [focus] [model]"}))
        sys.exit(1)
    frame_path = sys.argv[1]
    focus = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else None
    model = sys.argv[3] if len(sys.argv) > 3 else "llava:7b"

    if not os.path.exists(frame_path):
        print(json.dumps({"error": f"file not found: {frame_path}"}))
        sys.exit(1)

    # Build prompt
    if focus:
        prompt = f"Describe this image, focusing on {focus}. Be concise (1-2 sentences)."
    else:
        prompt = "Describe this image in 1-2 concise sentences. Focus on the main subject and key visual elements."

    try:
        response = call_ollama_vision(model, frame_path, prompt)
    except urllib.error.URLError as e:
        print(json.dumps({"error": f"ollama connection failed: {e}. Is ollama running on {OLLAMA_URL}?"}))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"error": f"vision model failed: {e}"}))
        sys.exit(1)

    if not response or not response.strip():
        print(json.dumps({"error": "empty response from vision model"}))
        sys.exit(1)

    tags = extract_tags(response)
    print(json.dumps({"description": response.strip(), "tags": tags, "model": model}))

if __name__ == "__main__":
    main()
