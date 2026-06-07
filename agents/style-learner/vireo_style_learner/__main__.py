"""CLI entry for Style Learner.

Reads JSON from stdin, writes JSON to stdout.
Input:  {"pieces": [...], "user_id": "..."}
Output: {"style_dna": {...}, ...}
"""
from __future__ import annotations
import json
import sys

from .analyzer import analyze_corpus


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
    pieces = data.get("pieces", [])
    user_id = data.get("user_id", "anonymous")
    dna = analyze_corpus(pieces, user_id)
    sys.stdout.write(json.dumps({"style_dna": dna.to_dict()}, ensure_ascii=False))
    sys.stdout.flush()


if __name__ == "__main__":
    main()
