#!/usr/bin/env python3
"""extract_dominant_colors.py — Color palette extraction via k-means.

Uses PIL + numpy + sklearn to extract the dominant colors from
an image (or a single frame from a video).

Usage:
    python extract_dominant_colors.py <image_path> <n_colors>

Output JSON:
    {"palette": [{"hex": "#3366cc", "percentage": 35.2}, ...]}
"""
import sys
import json
import os

def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "usage: extract_dominant_colors.py <image_path> <n_colors>"}))
        sys.exit(1)
    image_path = sys.argv[1]
    n_colors = int(sys.argv[2])

    if not os.path.exists(image_path):
        print(json.dumps({"error": f"file not found: {image_path}"}))
        sys.exit(1)

    try:
        from PIL import Image
        import numpy as np
    except ImportError:
        print(json.dumps({"error": "PIL/numpy not installed; pip install pillow numpy"}))
        sys.exit(1)

    # Try sklearn KMeans, fall back to simple quantization
    use_sklearn = True
    try:
        from sklearn.cluster import KMeans
    except ImportError:
        use_sklearn = False

    img = Image.open(image_path).convert("RGB")
    # Resize to speed up k-means
    img.thumbnail((200, 200))
    arr = np.array(img).reshape(-1, 3)

    if use_sklearn and n_colors > 0:
        kmeans = KMeans(n_clusters=n_colors, n_init=3, random_state=42)
        kmeans.fit(arr)
        centers = kmeans.cluster_centers_.astype(int)
        labels = kmeans.labels_
        # Count pixels per cluster to get percentage
        unique, counts = np.unique(labels, return_counts=True)
        total = len(labels)
        # Sort by count descending
        order = np.argsort(-counts)
        palette = []
        for idx in order:
            r, g, b = centers[idx]
            hex_code = f"#{r:02x}{g:02x}{b:02x}"
            percentage = round(100.0 * counts[idx] / total, 1)
            palette.append({"hex": hex_code, "percentage": percentage})
    else:
        # Simple fallback: count unique colors, return top N
        unique, counts = np.unique(arr.reshape(-1, 3), axis=0, return_counts=True)
        order = np.argsort(-counts)[:n_colors]
        total = counts.sum()
        palette = []
        for idx in order:
            r, g, b = unique[idx]
            hex_code = f"#{r:02x}{g:02x}{b:02x}"
            percentage = round(100.0 * counts[idx] / total, 1)
            palette.append({"hex": hex_code, "percentage": percentage})

    print(json.dumps({"palette": palette}))

if __name__ == "__main__":
    main()
