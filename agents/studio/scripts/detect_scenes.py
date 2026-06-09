#!/usr/bin/env python3
"""detect_scenes.py — Scene boundary detection for Vireo.

Uses PySceneDetect for boundary detection. Returns a list of scenes
with start/end timestamps.

Usage:
    python detect_scenes.py <video_path> <min_scene_length_sec>

Output JSON:
    {"scenes": [{"start_sec": 0, "end_sec": 5.2, "duration_sec": 5.2}, ...]}
"""
import sys
import json

def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "usage: detect_scenes.py <video_path> <min_scene_length>"}))
        sys.exit(1)
    video_path = sys.argv[1]
    min_scene_length = int(sys.argv[2])

    try:
        from scenedetect import open_video, SceneManager, AdaptiveDetector
    except ImportError:
        print(json.dumps({"error": "scenedetect not installed; pip install scenedetect[opencv]"}))
        sys.exit(1)

    video = open_video(video_path)
    scene_manager = SceneManager()
    scene_manager.add_detector(AdaptiveDetector(min_scene_len=min_scene_length))
    scene_manager.detect_scenes(video)
    scene_list = scene_manager.get_scene_list()

    scenes = []
    for start, end in scene_list:
        scenes.append({
            "start_sec": round(start.get_seconds(), 2),
            "end_sec": round(end.get_seconds(), 2),
            "duration_sec": round(end.get_seconds() - start.get_seconds(), 2),
        })
    print(json.dumps({"scenes": scenes}))

if __name__ == "__main__":
    main()
