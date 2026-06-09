#!/usr/bin/env python3
"""extract_colors.py — Dominant color extraction for Vireo.

Uses PIL + scikit-learn KMeans to find the N most dominant colors
in an image. Returns hex codes with percentages.

Usage:
    python extract_colors.py <image_path> <n_colors>

Output JSON:
    {"palette": [{"hex": "#ff5500", "percentage": 0.32, "rgb": [255, 85, 0]}, ...]}
"""
import sys
import json

def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "usage: extract_colors.py <image_path> <n_colors>"}))
        sys.exit(1)
    image_path = sys.argv[1]
    n_colors = int(sys.argv[2])

    try:
        from PIL import Image
        import numpy as np
        from sklearn.cluster import KMeans
    except ImportError as e:
        print(json.dumps({"error": f"required packages not installed: {e}"}))
        sys.exit(1)

    img = Image.open(image_path).convert("RGB")
    # Resize to 100x100 to speed up KMeans (we only need dominant colors)
    img_small = img.resize((100, 100))
    pixels = np.array(img_small).reshape(-1, 3)

    # Detect single-color images (no need to KMeans)
    unique_colors = np.unique(pixels, axis=0)
    if len(unique_colors) == 1:
        c = unique_colors[0]
        hex_code = f"#{c[0]:02x}{c[1]:02x}{c[2]:02x}"
        print(json.dumps({
            "palette": [{
                "hex": hex_code,
                "rgb": [int(c[0]), int(c[1]), int(c[2])],
                "percentage": 1.0,
            }]
        }))
        return

    # KMeans
    actual_n_clusters = min(n_colors, len(unique_colors))
    kmeans = KMeans(n_clusters=actual_n_clusters, n_init=3, random_state=42)
    kmeans.fit(pixels)
    labels = kmeans.labels_
    centers = kmeans.cluster_centers_.astype(int)
    counts = np.bincount(labels, minlength=actual_n_clusters)
    total = counts.sum()

    palette = []
    n = min(n_colors, len(centers))
    for i in range(n):
        c = centers[i]
        hex_code = f"#{c[0]:02x}{c[1]:02x}{c[2]:02x}"
        pct = float(counts[i]) / total if total > 0 else 0
        palette.append({
            "hex": hex_code,
            "rgb": [int(c[0]), int(c[1]), int(c[2])],
            "percentage": round(pct, 3),
        })
    # Sort by percentage descending
    palette.sort(key=lambda p: -p["percentage"])
    print(json.dumps({"palette": palette}))

if __name__ == "__main__":
    main()
