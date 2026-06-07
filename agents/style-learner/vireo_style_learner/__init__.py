"""Style Learner agent for Vireo.

Analyzes a creator's past content (transcripts, captions, titles) and builds
a structured Style DNA that downstream agents (Editor, Distributor, Analyst)
use to keep output on-brand.
"""
from .analyzer import StyleAnalyzer, analyze_corpus
from .hooks import extract_hooks, extract_ctas
from .llm_client import LLMClient, MockLLMClient, OpenAIClient
from .llm_enhanced import LLMEnhancedStyleLearner
from .server import create_app, run

__all__ = [
    "StyleAnalyzer",
    "analyze_corpus",
    "extract_hooks",
    "extract_ctas",
    "LLMClient",
    "MockLLMClient",
    "OpenAIClient",
    "LLMEnhancedStyleLearner",
    "create_app",
    "run",
]
