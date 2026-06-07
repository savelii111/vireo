"""Unit tests for the Editor agent."""
import pytest
from vireo_editor import Editor, edit_piece, score_sentence
from vireo_editor.scorer import score_sentence
from vireo_editor.hooks_gen import generate_hooks, generate_ctas


# ---------- Scoring ----------

def test_score_empty_sentence():
    assert score_sentence("") == 0.0
    assert score_sentence("   ") == 0.0

def test_score_optimal_length():
    s = "The results showed a 47% increase in conversion rate."
    score = score_sentence(s)
    assert 0.5 < score < 1.0

def test_score_too_short_penalized():
    short = score_sentence("Ok.")
    long = score_sentence("This is a normal length sentence with several words and ideas.")
    assert short < long

def test_score_too_long_penalized():
    very_long = " ".join(["word"] * 50) + "."
    normal = "This is a normal length sentence with several words."
    assert score_sentence(very_long) < score_sentence(normal)

def test_score_with_number_boosted():
    with_num = score_sentence("We got 1000 users in 24 hours.")
    without = score_sentence("We got many users in a short time.")
    assert with_num > without

def test_score_with_question_boosted():
    with_q = score_sentence("Did you know this works?")
    without = score_sentence("This works.")
    assert with_q > without

def test_score_with_exclamation_boosted():
    with_e = score_sentence("This is amazing!")
    without = score_sentence("This is fine.")
    assert with_e > without

def test_score_filler_penalized():
    with_filler = score_sentence("Um, like, basically, you know, this is a thing.")
    without = score_sentence("This is a thing and it works well.")
    assert with_filler < without

def test_score_repetition_penalized():
    s1 = "The key insight is that AI is changing the world of content creation."
    s2 = "The key insight is that AI is changing the world of content creation again."
    s3 = "Something completely different is happening in the market today."
    recent = s1 + " " + s2
    base = score_sentence(s2, recent_text=s1)
    penalized = score_sentence(s2, recent_text=recent)
    fresh = score_sentence(s3, recent_text=recent)
    assert penalized < fresh

def test_score_cta_at_end_bonus():
    cta = "Subscribe for more content like this!"
    body = "Here is a regular informative sentence about something."
    cta_at_end = score_sentence(cta, position=10, total=11)
    cta_in_middle = score_sentence(cta, position=5, total=11)
    body_at_end = score_sentence(body, position=10, total=11)
    assert cta_at_end > cta_in_middle
    assert cta_at_end > body_at_end

def test_score_style_dna_energetic():
    energetic_dna = {"tone": "energetic"}
    professional_dna = {"tone": "professional"}
    s = "This is amazing! What a wild result!"
    assert score_sentence(s, style_dna=energetic_dna) > score_sentence(s, style_dna=professional_dna)

def test_score_style_dna_educational():
    edu_dna = {"tone": "educational"}
    casual_dna = {"tone": "casual"}
    s = "The data shows a 73% increase in efficiency."
    assert score_sentence(s, style_dna=edu_dna) > score_sentence(s, style_dna=casual_dna)

def test_score_position_hook_bonus():
    base = "This is a normal sentence."
    assert score_sentence(base, position=0, total=10) > score_sentence(base, position=5, total=10)

def test_score_in_valid_range():
    for s in ["", "ok", "Normal sentence.", "Wow this is amazing and great!",
              "Um, like, this is filler, you know, basically."]:
        score = score_sentence(s)
        assert 0.0 <= score <= 1.0, f"Score out of range for: {s}"


# ---------- Hook/CTA generation ----------

def test_generate_hooks_returns_n():
    dna = {"hook_patterns": ["curiosity"], "topics": ["AI"]}
    hooks = generate_hooks(dna, n=3)
    assert len(hooks) == 3
    for h in hooks:
        assert isinstance(h, str)
        assert len(h) > 5

def test_generate_hooks_uses_topic():
    dna = {"hook_patterns": ["curiosity"], "topics": ["neural networks"]}
    hooks = generate_hooks(dna, n=2)
    assert any("neural networks" in h.lower() for h in hooks)

def test_generate_hooks_fallback():
    dna = {}  # no patterns
    hooks = generate_hooks(dna, n=3)
    assert len(hooks) == 3

def test_generate_hooks_russian():
    dna = {"hook_patterns": ["curiosity_ru"], "topics": ["Python"]}
    hooks = generate_hooks(dna, n=2)
    assert any("Python" in h for h in hooks)
    # Should be Russian templates
    assert any(h.startswith(("Знаете", "Вот", "Никто")) for h in hooks)

def test_generate_ctas_returns_n():
    dna = {"cta_patterns": ["engagement"]}
    ctas = generate_ctas(dna, n=3)
    assert len(ctas) == 3

def test_generate_ctas_fallback():
    dna = {}
    ctas = generate_ctas(dna, n=2)
    assert len(ctas) == 2


# ---------- Main editor ----------

def test_edit_text_input():
    content = {
        "id": "test-1",
        "text": " ".join([f"Sentence number {i} about something interesting." for i in range(20)]),
        "duration_sec": 120,
    }
    dna = {"tone": "casual", "pacing": "fast"}
    plan = edit_piece(content, dna, target_sec=30)
    assert plan.source_id == "test-1"
    assert plan.output_duration_sec <= 30
    assert len(plan.cuts) > 0
    assert plan.style_applied["tone"] == "casual"

def test_edit_segments_input():
    content = {
        "id": "test-2",
        "segments": [
            {"text": "First sentence here.", "start": 0, "end": 2},
            {"text": "Second one. Third one!", "start": 2, "end": 5},
            {"text": "Last sentence for closing.", "start": 5, "end": 7},
        ],
    }
    dna = {"tone": "professional"}
    plan = edit_piece(content, dna, target_sec=10)
    assert plan.source_id == "test-2"
    assert len(plan.cuts) >= 1

def test_edit_always_keeps_opening():
    content = {
        "id": "test-3",
        "text": "Opening hook. " + " ".join([f"Filler {i}." for i in range(20)]),
        "duration_sec": 60,
    }
    dna = {"tone": "casual"}
    plan = edit_piece(content, dna, target_sec=10)
    # First cut should be marked as hook
    assert plan.cuts[0]["role"] == "hook"

def test_edit_marks_cta_role():
    content = {
        "id": "test-4",
        "text": " ".join([f"Body sentence {i}." for i in range(15)]) + " Subscribe for more!",
        "duration_sec": 90,
    }
    dna = {"tone": "casual", "cta_patterns": ["engagement"]}
    plan = edit_piece(content, dna, target_sec=30)
    roles = [c["role"] for c in plan.cuts]
    assert "cta" in roles or "close" in roles

def test_edit_respects_target_duration():
    long_text = " ".join([f"Sentence {i} about topic {i}." for i in range(50)])
    content = {"id": "x", "text": long_text, "duration_sec": 300}
    dna = {"tone": "casual"}
    plan_short = edit_piece(content, dna, target_sec=15)
    plan_long = edit_piece(content, dna, target_sec=90)
    assert plan_short.output_duration_sec <= 15
    assert plan_long.output_duration_sec <= 90
    assert plan_long.output_duration_sec >= plan_short.output_duration_sec

def test_edit_compression_ratio():
    long_text = " ".join([f"Sentence {i} about topic {i}." for i in range(30)])
    content = {"id": "x", "text": long_text, "duration_sec": 180}
    dna = {"tone": "casual"}
    plan = edit_piece(content, dna, target_sec=30)
    assert 0.05 < plan.style_applied["compression_ratio"] < 0.5

def test_edit_empty_input_handled():
    content = {"id": "empty", "text": ""}
    dna = {"tone": "casual"}
    plan = edit_piece(content, dna, target_sec=30)
    assert plan.cuts == []
    assert "WARNING" in plan.notes

def test_edit_prefers_high_value_content():
    content = {
        "id": "test",
        "text": (
            "Um, like, this is filler, you know. "
            "The data shows a 47% increase in revenue after deployment. "
            "Basically, anyway, I mean, it's just noise. "
            "We saved 3 hours per day using this technique. "
            "Ok so, uh, like, you know, this is just chatter. "
        ),
        "duration_sec": 30,
    }
    dna = {"tone": "educational"}
    plan = edit_piece(content, dna, target_sec=20)
    kept_texts = " ".join(c["text"] for c in plan.cuts)
    # High-value sentences with numbers should survive
    assert "47%" in kept_texts or "3 hours" in kept_texts

def test_edit_returns_valid_plan():
    content = {"id": "x", "text": "Hello world. This is a test. Subscribe for more!",
               "duration_sec": 10}
    dna = {"tone": "casual"}
    plan = edit_piece(content, dna, target_sec=10)
    assert hasattr(plan, "cuts")
    assert hasattr(plan, "output_duration_sec")
    assert hasattr(plan, "style_applied")
    assert hasattr(plan, "notes")
    for cut in plan.cuts:
        assert "start" in cut
        assert "end" in cut
        assert "text" in cut
        assert "score" in cut
        assert "role" in cut
        assert "reason" in cut
        assert cut["start"] <= cut["end"]


# ---------- Editor class methods ----------

def test_editor_generate_hooks_for():
    e = Editor()
    hooks = e.generate_hooks_for({"hook_patterns": ["curiosity"], "topics": ["AI"]}, n=3)
    assert len(hooks) == 3

def test_editor_generate_ctas_for():
    e = Editor()
    ctas = e.generate_ctas_for({"cta_patterns": ["engagement"]}, n=2)
    assert len(ctas) == 2


# ---------- Determinism ----------

def test_editor_is_deterministic():
    content = {"id": "x", "text": "Sentence A. Sentence B with 42% growth. Sentence C."}
    dna = {"tone": "casual"}
    plan1 = edit_piece(content, dna, target_sec=10)
    plan2 = edit_piece(content, dna, target_sec=10)
    assert plan1.cuts == plan2.cuts
    assert plan1.output_duration_sec == plan2.output_duration_sec
