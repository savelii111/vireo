#!/usr/bin/env python3
"""detect_objects.py — YOLOv8 object detection for Vireo.

Uses the ultralytics package. Prints JSON to stdout:
    {"objects": [{"class": "person", "confidence": 0.87, "bbox": {"x": 100, "y": 200, "w": 50, "h": 100}}], "model": "yolov8n"}

Usage:
    python detect_objects.py <frame_path> <confidence_threshold> [classes...]

Args:
    frame_path: Path to PNG/JPG image
    confidence_threshold: 0.0-1.0, default 0.5
    classes: Optional comma-separated list of class names to limit detection

Returns:
    JSON object with detected objects and model name
"""
import sys
import json
import os

def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "usage: detect_objects.py <frame_path> <conf> [classes]"}))
        sys.exit(1)
    frame_path = sys.argv[1]
    conf = float(sys.argv[2])
    classes = []
    if len(sys.argv) > 3 and sys.argv[3]:
        classes = [c.strip() for c in sys.argv[3].split(",") if c.strip()]

    try:
        from ultralytics import YOLO
    except ImportError:
        print(json.dumps({"error": "ultralytics not installed; pip install ultralytics"}))
        sys.exit(1)

    # Use the smallest model for speed. Larger models available:
    # yolov8s/m/l/x for more accuracy
    model = YOLO("yolov8n.pt")
    results = model(frame_path, conf=conf, classes=classes if classes else None, verbose=False)
    objects = []
    for r in results:
        boxes = r.boxes
        for box in boxes:
            cls_id = int(box.cls[0])
            cls_name = model.names[cls_id]
            conf_score = float(box.conf[0])
            xyxy = box.xyxy[0].tolist()  # [x1, y1, x2, y2]
            objects.append({
                "class": cls_name,
                "confidence": round(conf_score, 3),
                "bbox": {
                    "x": int(xyxy[0]),
                    "y": int(xyxy[1]),
                    "w": int(xyxy[2] - xyxy[0]),
                    "h": int(xyxy[3] - xyxy[1]),
                },
            })
    print(json.dumps({"objects": objects, "model": "yolov8n"}))

if __name__ == "__main__":
    main()
