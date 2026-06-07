"""Unit tests for the Style Learner analyzer."""
import pytest
from vireo_style_learner import analyze_corpus, StyleAnalyzer
from vireo_style_learner.hooks import extract_hooks, extract_ctas, suggest_hooks_for_dna
from vireo_shared import StyleDNA

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "..", "tests", "fixtures"))
from creators import (
    ENERGETIC_YOUTUBER,
    PROFESSIONAL_LINKEDIN,
    CASUAL_TIKTOKER,
    RUSSIAN_CREATOR,
)


# ---------- Basic correctness ----------

def test_empty_corpus_returns_zero_confidence():
    dna = analyze_corpus([], user_id="empty")
    assert dna.confidence == 0.0
    assert dna.sample_count == 0
    assert dna.tone == "neutral"

def test_corpus_with_empty_pieces_is_skipped():
    dna = analyze_corpus([{"text": ""}, {"text": "   "}], user_id="x")
    assert dna.confidence == 0.0
    assert dna.sample_count == 0

def test_single_piece_still_produces_dna():
    dna = analyze_corpus([{"text": "Hello world this is a test", "title": "Test"}], user_id="x")
    assert dna.sample_count == 1
    assert 0.0 < dna.confidence <= 1.0
    assert dna.tone != "neutral" or dna.pacing != "medium"

def test_confidence_increases_with_more_samples():
    d1 = analyze_corpus([{"text": "hello world"}], user_id="x")
    d5 = analyze_corpus([{"text": "hello world"}] * 5, user_id="x")
    d20 = analyze_corpus([{"text": "hello world"}] * 20, user_id="x")
    assert d1.confidence < d5.confidence <= d20.confidence


# ---------- Style differentiation (the IMPORTANT test) ----------

def test_energetic_youtuber_style():
    dna = analyze_corpus(ENERGETIC_YOUTUBER, user_id="yt_energetic")
    assert dna.tone in ("energetic", "casual"), f"Expected energetic, got {dna.tone}"
    assert dna.pacing in ("fast", "medium"), f"Expected fast/medium, got {dna.pacing}"
    assert dna.avg_content_length_sec >= 300, f"Expected long-form, got {dna.avg_content_length_sec}"
    assert dna.confidence > 0.5, f"Low confidence for clear style: {dna.confidence}"
    # Should have CTA patterns
    assert len(dna.cta_patterns) > 0, "No CTAs detected in energetic content"
    # Should have at least one hook pattern
    assert len(dna.hook_patterns) > 0, "No hooks detected in energetic content"

def test_professional_linkedin_style():
    dna = analyze_corpus(PROFESSIONAL_LINKEDIN, user_id="li_pro")
    assert dna.tone == "professional", f"Expected professional, got {dna.tone}"
    assert dna.pacing == "slow", f"Expected slow, got {dna.pacing}"
    assert dna.vocabulary_level in ("educated", "academic"), f"Expected educated+, got {dna.vocabulary_level}"
    # Should detect educational or provocative tone markers
    features = StyleAnalyzer().analyze_piece(PROFESSIONAL_LINKEDIN[0]["text"])
    assert features["avg_sentence_len"] > 10, "Professional text should have long sentences"

def test_casual_tiktoker_style():
    dna = analyze_corpus(CASUAL_TIKTOKER, user_id="tt_casual")
    assert dna.tone in ("casual", "energetic"), f"Expected casual, got {dna.tone}"
    assert dna.pacing == "fast", f"Expected fast, got {dna.pacing}"
    assert dna.vocabulary_level == "simple", f"Expected simple, got {dna.vocabulary_level}"
    assert dna.avg_content_length_sec < 60, f"Expected short, got {dna.avg_content_length_sec}"
    # Lots of filler words
    assert dna.hook_patterns, "No hooks detected"

def test_russian_creator_style():
    dna = analyze_corpus(RUSSIAN_CREATOR, user_id="ru_creator")
    # Russian energetic content should classify as energetic
    assert dna.tone in ("energetic", "casual"), f"Expected energetic, got {dna.tone}"
    assert dna.avg_content_length_sec >= 300
    # Topics should pick up some Russian words
    assert len(dna.topics) > 0


# ---------- Styles must be DISTINGUISHABLE ----------

def test_styles_are_distinguishable():
    yt = analyze_corpus(ENERGETIC_YOUTUBER, user_id="yt")
    li = analyze_corpus(PROFESSIONAL_LINKEDIN, user_id="li")
    tt = analyze_corpus(CASUAL_TIKTOKER, user_id="tt")
    ru = analyze_corpus(RUSSIAN_CREATOR, user_id="ru")

    # Tone differentiation
    assert yt.tone != li.tone, "YT and LinkedIn should have different tones"
    assert li.tone == "professional"
    # Pacing differentiation
    assert li.pacing == "slow"
    assert tt.pacing == "fast"
    # Length differentiation
    assert yt.avg_content_length_sec > tt.avg_content_length_sec * 5
    # Vocabulary differentiation
    assert li.vocabulary_level != tt.vocabulary_level


# ---------- Hooks & CTAs ----------

def test_extract_hooks_with_curiosity():
    text = "Did you know that AI can clone voices? Here's why this matters."
    hooks = extract_hooks(text, "Did you know about AI?")
    labels = [h["label"] for h in hooks]
    assert "curiosity" in labels or "question" in labels

def test_extract_hooks_empty_text_falls_back():
    hooks = extract_hooks("", "")
    assert len(hooks) >= 1
    assert hooks[0]["label"] == "statement"

def test_extract_ctas_finds_engagement():
    text = "Like, subscribe, and hit the bell for more content like this!"
    ctas = extract_ctas(text)
    labels = [c["label"] for c in ctas]
    assert "engagement" in labels

def test_suggest_hooks_uses_dna_patterns():
    dna = {
        "hook_patterns": ["curiosity", "command"],
        "tone": "energetic",
    }
    suggestions = suggest_hooks_for_dna(dna, n=4)
    assert len(suggestions) == 4
    for s in suggestions:
        assert "template" in s
        assert "{TOPIC}" in s["template"] or "{BAD_THING}" in s["template"]


# ---------- Single-piece analysis ----------

def test_analyze_piece_returns_features():
    features = StyleAnalyzer().analyze_piece("This is a test. With multiple sentences! And a question?")
    assert features["word_count"] == 10
    assert features["exclamation_ratio"] > 0
    assert features["question_ratio"] > 0
    assert "tone" in features
    assert "humor" in features

def test_analyze_piece_with_title():
    features = StyleAnalyzer().analyze_piece("Some content here", "Did you know?")
    assert features["title"]["starts_with_question"] is True
    assert features["title"]["has_number"] is False

def test_analyze_piece_handles_empty():
    features = StyleAnalyzer().analyze_piece("")
    assert features["empty"] is True
    assert features["word_count"] == 0


# ---------- StyleDNA serialization ----------

def test_style_dna_serialization():
    dna = analyze_corpus(ENERGETIC_YOUTUBER, user_id="x")
    d = dna.to_dict()
    assert d["user_id"] == "x"
    assert d["sample_count"] == 3
    j = dna.to_json()
    assert "user_id" in j
    # Round trip
    dna2 = StyleDNA.from_dict(d)
    assert dna2.user_id == dna.user_id
    assert dna2.tone == dna.tone
    assert dna2.confidence == dna.confidence
