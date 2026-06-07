"""CLI entry for Editor.

Reads JSON from stdin, writes JSON to stdout.
Input:  {"content": {...}, "style_dna": {...}, "target_sec": 60}
Output: {"edit_plan": {...}}
"""
from __future__ import annotations
import json
import sys

from .editor import edit_piece


def main() -> None:
    raw = sys.stdin.read()
    if not raw.strip():
        print(json.dumps({"error": "empty_input"}))
        sys.exit(1)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        print(json.dumps({"error": "bad_json", "message": str(e)}))
        sys.exit(1)
    content = data.get("content", {})
    style_dna = data.get("style_dna", {})
    target_sec = float(data.get("target_sec", 60.0))
    plan = edit_piece(content, style_dna, target_sec)
    out = {
        "edit_plan": {
            "source_id": plan.source_id,
            "cuts": plan.cuts,
            "output_duration_sec": plan.output_duration_sec,
            "style_applied": plan.style_applied,
            "notes": plan.notes,
        }
    }
    sys.stdout.write(json.dumps(out, ensure_ascii=False))
    sys.stdout.flush()


if __name__ == "__main__":
    main()
