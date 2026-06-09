#!/usr/bin/env python3
"""inpaint_frame.py — Inpainting (object removal/replacement) in a video frame.

Extracts a frame at timestamp_sec from the video, applies a mask
(bbox or polygon), runs inpainting, and saves the result. For v1
we use a simple approach: cover the masked region with surrounding
pixels (inpainting via OpenCV inpaint function). For production
this becomes SDXL inpainting pipeline.

Usage:
    python inpaint_frame.py <video_path> <timestamp_sec> <mode> <mask_json> <prompt> <output_path>

mode: "remove" (erase) or "replace" (fill with prompt-suggested content)
mask_json: JSON string with {bbox: {x,y,w,h}} or {polygon: [[x,y],...]}

Output JSON:
    {"frame_path": "...", "model": "opencv-inpaint", "mode": "remove"}
"""
import sys
import json
import os
import subprocess
import tempfile
import time
import re

def parse_mask(mask_json):
    """Parse mask JSON. Returns binary mask as numpy array."""
    mask_data = json.loads(mask_json)
    if "bbox" in mask_data:
        b = mask_data["bbox"]
        return "bbox", (int(b["x"]), int(b["y"]), int(b["w"]), int(b["h"]))
    elif "polygon" in mask_data:
        return "polygon", mask_data["polygon"]
    else:
        raise ValueError("mask must have bbox or polygon")

def extract_frame(video_path, timestamp_sec, output_path):
    """Extract a single frame using ffmpeg."""
    cmd = [
        "ffmpeg", "-y",
        "-ss", str(timestamp_sec),
        "-i", video_path,
        "-frames:v", "1",
        output_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg frame extract failed: {result.stderr[:500]}")

def inpaint_with_opencv(frame_path, mask_data, mode, prompt, output_path):
    """Use OpenCV inpainting algorithm to fill the masked region."""
    try:
        import cv2
        import numpy as np
    except ImportError:
        raise RuntimeError("opencv not installed; pip install opencv-python")

    img = cv2.imread(frame_path)
    if img is None:
        raise RuntimeError(f"failed to read frame: {frame_path}")

    h, w = img.shape[:2]
    mask = np.zeros((h, w), dtype=np.uint8)
    mask_type, mask_value = mask_data

    if mask_type == "bbox":
        x, y, bw, bh = mask_value
        cv2.rectangle(mask, (x, y), (x + bw, y + bh), 255, -1)
    elif mask_type == "polygon":
        pts = np.array(mask_value, dtype=np.int32)
        cv2.fillPoly(mask, [pts], 255)

    # For 'remove' mode: simple inpaint via Telea algorithm.
    # For 'replace' mode (v1): same algorithm, with the result
    # potentially retouched by a generative model in production.
    if mode == "remove":
        result = cv2.inpaint(img, mask, 3, cv2.INPAINT_TELEA)
    elif mode == "replace":
        # v1: same as remove (the prompt would be used by SDXL in production)
        result = cv2.inpaint(img, mask, 3, cv2.INPAINT_TELEA)
    else:
        raise ValueError(f"invalid mode: {mode}")

    cv2.imwrite(output_path, result)
    return output_path

def main():
    if len(sys.argv) < 7:
        print(json.dumps({"error": "usage: inpaint_frame.py <video> <ts> <mode> <mask_json> <prompt> <output>"}))
        sys.exit(1)
    video_path = sys.argv[1]
    try:
        timestamp_sec = float(sys.argv[2])
    except ValueError:
        print(json.dumps({"error": f"invalid timestamp: {sys.argv[2]}"}))
        sys.exit(1)
    mode = sys.argv[3]
    mask_json = sys.argv[4]
    prompt = sys.argv[5] if sys.argv[5] != "_" else None
    output = sys.argv[6]

    if not os.path.exists(video_path):
        print(json.dumps({"error": f"video not found: {video_path}"}))
        sys.exit(1)

    if mode not in ("remove", "replace"):
        print(json.dumps({"error": f"invalid mode: {mode}"}))
        sys.exit(1)

    start_time = time.time()
    try:
        mask_data = parse_mask(mask_json)
    except (ValueError, KeyError, json.JSONDecodeError) as e:
        print(json.dumps({"error": f"invalid mask: {e}"}))
        sys.exit(1)

    # Extract frame to temp file, inpaint, save to output
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        tmp_frame = tmp.name
    try:
        try:
            extract_frame(video_path, timestamp_sec, tmp_frame)
        except RuntimeError as e:
            print(json.dumps({"error": str(e)}))
            sys.exit(1)

        try:
            inpaint_with_opencv(tmp_frame, mask_data, mode, prompt, output)
        except RuntimeError as e:
            print(json.dumps({"error": str(e)}))
            sys.exit(1)
    finally:
        if os.path.exists(tmp_frame):
            os.unlink(tmp_frame)

    total_dur = time.time() - start_time
    print(json.dumps({
        "frame_path": output,
        "model": "opencv-inpaint",
        "mode": mode,
        "elapsed_sec": round(total_dur, 2),
        "note": "OpenCV inpainting. Production uses SDXL inpainting for replace mode.",
    }))

if __name__ == "__main__":
    main()
