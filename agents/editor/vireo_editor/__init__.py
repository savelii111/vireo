"""Editor agent for Vireo.

Takes raw content (a transcript with timestamps, or just text) and produces
an EditPlan — a list of cuts, the target output duration, and notes about
what was applied. Honors a StyleDNA so the cuts feel like the creator.

Capabilities (MVP, all offline):
  - Score every sentence in the transcript
  - Cut filler, repetition, dead air markers
  - Pick the top-scoring N seconds to keep (target duration)
  - Generate 3 hook variants for the first 3 seconds
  - Generate 3 CTA variants for the last 5 seconds
  - Output an EditPlan ready for the Distributor
"""
from .editor import Editor, edit_piece
from .scorer import score_sentence
from .hooks_gen import generate_hooks, generate_ctas
from .server import create_app, run

__all__ = [
    "Editor",
    "edit_piece",
    "score_sentence",
    "generate_hooks",
    "generate_ctas",
    "create_app",
    "run",
]
