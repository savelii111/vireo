#!/usr/bin/env python3
"""generate_image.py — Text-to-image via Stable Diffusion (local) or HTTP API.

For v1 we use a simple local diffusers pipeline. Future versions can
swap to cloud APIs (OpenAI DALL-E, Stability, Replicate).

Usage:
    python generate_image.py <prompt> [negative_prompt] [aspect_ratio] [seed] [style] [output_path]

Output JSON:
    {"image_path": "...", "model": "sdxl-base-1.0", "seed": 12345, "duration_sec": 8.3}
"""
import sys
import json
import os
import time
import random

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: generate_image.py <prompt> [neg] [aspect] [seed] [style] [output]"}))
        sys.exit(1)
    prompt = sys.argv[1]
    negative = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else None
    aspect = sys.argv[3] if len(sys.argv) > 3 else "1:1"
    seed = int(sys.argv[4]) if len(sys.argv) > 4 and sys.argv[4] else None
    style = sys.argv[5] if len(sys.argv) > 5 and sys.argv[5] else None
    output = sys.argv[6] if len(sys.argv) > 6 else None

    if output is None:
        # Default output path: ./generated_<seed>.png
        if seed is None:
            seed = random.randint(0, 2**32 - 1)
        output = os.path.abspath(f"generated_{seed}.png")

    # Resolve aspect ratio to width/height
    aspect_map = {
        "1:1": (1024, 1024),
        "16:9": (1344, 768),
        "9:16": (768, 1344),
        "4:3": (1152, 896),
        "3:4": (896, 1152),
        "21:9": (1536, 640),
    }
    width, height = aspect_map.get(aspect, (1024, 1024))

    # Try local diffusers; if not available, write a placeholder PNG
    # and return it (so the pipeline still works for testing).
    start_time = time.time()
    try:
        import torch
        from diffusers import StableDiffusionXLPipeline
        # Heavy import: takes a few seconds even if model not present
        has_diffusers = True
    except ImportError:
        has_diffusers = False

    if has_diffusers and os.environ.get("USE_DIFFUSERS", "0") == "1":
        try:
            # Load model (caches in HF cache)
            pipe = StableDiffusionXLPipeline.from_pretrained(
                "stabilityai/stable-diffusion-xl-base-1.0",
                torch_dtype=torch.float16,
                variant="fp16",
                use_safetensors=True,
            )
            if torch.cuda.is_available():
                pipe = pipe.to("cuda")
            else:
                pipe = pipe.to("cpu")
            if seed is not None:
                generator = torch.Generator(device=pipe.device).manual_seed(seed)
            else:
                generator = None
            image = pipe(
                prompt=prompt,
                negative_prompt=negative,
                width=width,
                height=height,
                num_inference_steps=30,
                guidance_scale=7.5,
                generator=generator,
            ).images[0]
            image.save(output)
            duration = time.time() - start_time
            print(json.dumps({
                "image_path": output,
                "model": "sdxl-base-1.0",
                "seed": seed,
                "width": width,
                "height": height,
                "duration_sec": round(duration, 1),
            }))
            return
        except Exception as e:
            print(json.dumps({"error": f"diffusers failed: {e}. Falling back to placeholder."}), file=sys.stderr)

    # Fallback: create a placeholder PNG so the pipeline is testable
    # without the heavy diffusers dep. The placeholder is a solid
    # color with text indicating it's a stub.
    try:
        from PIL import Image, ImageDraw, ImageFont
        img = Image.new("RGB", (width, height), color=(80, 80, 120))
        draw = ImageDraw.Draw(img)
        # Try to use a system font; fall back to default
        try:
            if os.name == "nt":
                font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 36)
            else:
                font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 36)
        except (OSError, IOError):
            font = ImageFont.load_default()
        # Truncate prompt for display
        display_prompt = prompt[:60] + "..." if len(prompt) > 60 else prompt
        draw.text((20, 20), f"[STUB] {display_prompt}", fill=(255, 255, 255), font=font)
        if style:
            draw.text((20, 70), f"style: {style}", fill=(200, 200, 200), font=font)
        draw.text((20, height - 50), f"aspect: {aspect}, seed: {seed}", fill=(180, 180, 180), font=font)
        img.save(output)
        duration = time.time() - start_time
        print(json.dumps({
            "image_path": output,
            "model": "stub",
            "seed": seed,
            "width": width,
            "height": height,
            "duration_sec": round(duration, 1),
            "note": "diffusers not available or USE_DIFFUSERS!=1. Wrote placeholder.",
        }))
    except ImportError:
        print(json.dumps({"error": "PIL not installed; pip install pillow"}))
        sys.exit(1)

if __name__ == "__main__":
    main()
