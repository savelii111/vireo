#!/usr/bin/env python3
"""generate_video.py — Text-to-video via Stable Video Diffusion or Replicate.

For v1: stub that creates a 1-second video with a moving gradient.
For production: Stable Video Diffusion (img2vid) or Replicate API.

Usage:
    python generate_video.py <prompt> <duration_sec> <aspect_ratio> <motion> <style> <ref_image_path> <output_path>

Output JSON:
    {"video_path": "...", "model": "stub", "duration_sec": 4, "frames": 120}
"""
import sys
import json
import os
import time
import subprocess
import tempfile
import random

def main():
    if len(sys.argv) < 8:
        print(json.dumps({"error": "usage: generate_video.py <prompt> <dur> <ar> <motion> <style> <ref> <output>"}))
        sys.exit(1)
    prompt = sys.argv[1]
    try:
        duration = float(sys.argv[2])
    except ValueError:
        print(json.dumps({"error": f"invalid duration: {sys.argv[2]}"}))
        sys.exit(1)
    aspect = sys.argv[3]
    motion = sys.argv[4]
    style = sys.argv[5]
    ref_image = sys.argv[6] if len(sys.argv) > 6 and sys.argv[6] != "_" else None
    output = sys.argv[7]

    if duration < 1 or duration > 60:
        print(json.dumps({"error": "duration must be 1-60 seconds"}))
        sys.exit(1)

    # Aspect → resolution
    aspect_map = {
        "16:9": (1280, 720),
        "9:16": (720, 1280),
        "1:1": (1024, 1024),
    }
    width, height = aspect_map.get(aspect, (1024, 1024))

    # For v1 we create a short "animated gradient" video using ffmpeg.
    # The color depends on the prompt hash so different prompts → different
    # videos. In production this becomes SVD or Replicate.
    start_time = time.time()
    try:
        prompt_hash = abs(hash(prompt)) % (256**3)
        r = (prompt_hash >> 16) & 0xFF
        g = (prompt_hash >> 8) & 0xFF
        b = prompt_hash & 0xFF
        # Motion parameter affects the color shift speed
        motion_factor = {"low": 0.5, "medium": 1.0, "high": 2.0}.get(motion, 1.0)
        fps = 24
        frames = int(duration * fps)
        # Use ffmpeg's geq filter to make a moving gradient
        # geq generates a per-frame color based on time (t) and position
        # r = (r_base + t*motion*20) % 256
        # Note: geq is complex; for v1 we use a simpler approach with
        # a color source that shifts over time via the "color" filter
        # chained with "fade" (which we approximate with hue filter).
        # Simpler: use a solid color video. Visual: not great, but
        # proves the pipeline works end-to-end.
        cmd = [
            "ffmpeg", "-y",
            "-f", "lavfi",
            "-i", f"color=c=0x{r:02x}{g:02x}{b:02x}:s={width}x{height}:d={duration}:r={fps}",
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-crf", "28",
            "-pix_fmt", "yuv420p",
            output,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if result.returncode != 0:
            print(json.dumps({"error": f"ffmpeg failed: {result.stderr[:500]}"}))
            sys.exit(1)
        total_dur = time.time() - start_time
        print(json.dumps({
            "video_path": output,
            "model": "stub",
            "duration_sec": duration,
            "frames": frames,
            "width": width,
            "height": height,
            "elapsed_sec": round(total_dur, 2),
            "note": "Stub generator. Production version uses SVD or Replicate API.",
        }))
    except subprocess.TimeoutExpired:
        print(json.dumps({"error": "ffmpeg timed out"}))
        sys.exit(1)
    except FileNotFoundError:
        print(json.dumps({"error": "ffmpeg not found in PATH"}))
        sys.exit(1)

if __name__ == "__main__":
    main()
