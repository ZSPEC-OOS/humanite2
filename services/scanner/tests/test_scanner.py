"""
Unit tests for the scanner pipeline.
Transformer classifier is mocked in HTTP tests to avoid model dependency.
Feature extraction and rule filter tests run against real implementations.
"""
import os
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("SCANNER_MODEL_PATH", "/nonexistent/path")  # Force fallback in tests

# ── Short text samples ─────────────────────────────────────────────────────────

BOT_TEXT = (
    "As an AI language model, I must note that this topic requires careful "
    "consideration. Furthermore, it is important to acknowledge the multifaceted "
    "nature of the issue at hand and leverage appropriate frameworks."
)

HUMAN_TEXT = (
    "I woke up at six and couldn't get back to sleep. Just lay there staring "
    "at the ceiling. Made coffee eventually. The meeting ran forty minutes over — "
    "nothing was decided. To be honest, I think we all knew it was pointless "
    "going in. You know what I mean? Three of us said as much afterward."
)

AI_TEXT = (
    "Furthermore, it is important to note that machine learning models have "
    "demonstrated remarkable capabilities across a diverse range of tasks. "
    "Moreover, these models leverage large-scale training data to achieve "
    "state-of-the-art performance. The robust framework ensures comprehensive "
    "coverage of the problem space, facilitating optimal outcomes."
)


# ── Evidence-sufficiency gate tests ─────────────────────────────────────────────

class TestEvidenceGate:
    def test_short_text_is_underdetermined(self):
        from src.detection.rule_filter import is_underdetermined
        assert is_underdetermined("This is too short.") is True

    def test_exactly_49_words_is_underdetermined(self):
        from src.detection.rule_filter import is_underdetermined
        text = " ".join(["word"] * 49)
        assert is_underdetermined(text) is True

    def test_standard_text_is_not_underdetermined(self):
        from src.detection.rule_filter import is_underdetermined
        text = (
            "The Federal Reserve held interest rates steady at its September meeting. "
            "Officials cited continued uncertainty about the inflation trajectory "
            "as a reason to pause. Markets had widely expected the decision, "
            "though some analysts were surprised by the tone of the statement "
            "and its implications for the December meeting timeline."
        )
        assert is_underdetermined(text) is False


# ── Lexical rule features (weak evidence, not a verdict) ────────────────────────

class TestLexicalRuleFeatures:
    def test_bot_signature_counted_as_feature_not_verdict(self):
        """A bot-signature match must surface as a numeric feature, not force
        a classification the way the old rule_filter() did."""
        from src.detection.features import extract_features, FEATURE_NAMES
        text = (
            "As an AI language model, I cannot provide that information. "
            "However, I can explain the general principles involved in "
            "a way that is both accurate and informative for educational purposes."
        )
        feat = dict(zip(FEATURE_NAMES, extract_features(text)))
        assert feat["bot_signature_count"] >= 1

    def test_human_signals_counted_as_features(self):
        from src.detection.features import extract_features, FEATURE_NAMES
        feat = dict(zip(FEATURE_NAMES, extract_features(HUMAN_TEXT)))
        assert feat["first_person_marker_count"] + feat["informal_phrase_count"] >= 3

    def test_standard_text_has_no_lexical_rule_hits(self):
        from src.detection.features import extract_features, FEATURE_NAMES
        text = (
            "The Federal Reserve held interest rates steady at its September meeting. "
            "Officials cited continued uncertainty about the inflation trajectory "
            "as a reason to pause."
        )
        feat = dict(zip(FEATURE_NAMES, extract_features(text)))
        assert feat["bot_signature_count"] == 0
        assert feat["bot_pattern_count"] == 0


# ── Feature extraction tests ───────────────────────────────────────────────────

class TestFeatureExtraction:
    def test_returns_22_features(self):
        from src.detection.features import extract_features, FEATURE_NAMES
        vec = extract_features(HUMAN_TEXT)
        assert vec.shape == (22,)
        assert len(FEATURE_NAMES) == 22

    def test_all_features_finite(self):
        import numpy as np
        from src.detection.features import extract_features
        vec = extract_features(AI_TEXT)
        assert not np.any(np.isnan(vec)), "NaN in feature vector"
        assert not np.any(np.isinf(vec)), "Inf in feature vector"

    def test_ttr_between_0_and_1(self):
        from src.detection.features import extract_features, FEATURE_NAMES
        vec  = extract_features(HUMAN_TEXT)
        feat = dict(zip(FEATURE_NAMES, vec))
        assert 0.0 <= feat["ttr"] <= 1.0

    def test_ai_text_has_higher_transition_density(self):
        from src.detection.features import extract_features, FEATURE_NAMES
        ai_feat    = dict(zip(FEATURE_NAMES, extract_features(AI_TEXT)))
        human_feat = dict(zip(FEATURE_NAMES, extract_features(HUMAN_TEXT)))
        assert ai_feat["transition_density"] > human_feat["transition_density"]

    def test_ai_text_has_higher_ai_vocab_density(self):
        from src.detection.features import extract_features, FEATURE_NAMES
        ai_feat    = dict(zip(FEATURE_NAMES, extract_features(AI_TEXT)))
        human_feat = dict(zip(FEATURE_NAMES, extract_features(HUMAN_TEXT)))
        assert ai_feat["ai_vocab_density"] > human_feat["ai_vocab_density"]

    def test_human_text_has_higher_sentence_length_cv(self):
        from src.detection.features import extract_features, FEATURE_NAMES
        # Human text has more varied sentence lengths → higher CV
        ai_feat    = dict(zip(FEATURE_NAMES, extract_features(AI_TEXT)))
        human_feat = dict(zip(FEATURE_NAMES, extract_features(HUMAN_TEXT)))
        assert human_feat["sentence_length_cv"] >= ai_feat["sentence_length_cv"]

    def test_single_sentence_std_is_zero(self):
        from src.detection.features import extract_features, FEATURE_NAMES
        vec  = extract_features("This is a single sentence with enough words to process.")
        feat = dict(zip(FEATURE_NAMES, vec))
        assert feat["sentence_length_std"] == 0.0

    def test_features_deterministic(self):
        from src.detection.features import extract_features
        vec1 = extract_features(HUMAN_TEXT)
        vec2 = extract_features(HUMAN_TEXT)
        import numpy as np
        np.testing.assert_array_equal(vec1, vec2)


# ── Perplexity tests ───────────────────────────────────────────────────────────

class TestPerplexity:
    def test_returns_list_of_floats(self):
        from src.detection.perplexity import compute_perplexity
        scores = compute_perplexity(HUMAN_TEXT)
        assert isinstance(scores, list)
        assert all(isinstance(s, float) for s in scores)

    def test_one_score_per_sentence(self):
        from src.detection.perplexity import compute_perplexity
        from nltk.tokenize import sent_tokenize
        text   = "This is sentence one. This is sentence two. And this is three."
        scores = compute_perplexity(text)
        n_sents = len(sent_tokenize(text))
        assert len(scores) == n_sents

    def test_caps_at_50_sentences(self):
        from src.detection.perplexity import compute_perplexity
        long_text = " ".join(["This is a test sentence."] * 100)
        scores    = compute_perplexity(long_text)
        assert len(scores) <= 50

    def test_scores_are_positive(self):
        from src.detection.perplexity import compute_perplexity
        scores = compute_perplexity(HUMAN_TEXT)
        assert all(s >= 0.0 for s in scores)


# ── HTTP endpoint tests (mocked classifier) ───────────────────────────────────

@pytest.mark.asyncio
async def test_bot_signature_influences_but_does_not_force_verdict():
    """
    A bot-signature phrase should push the classifier toward ai-generated
    (it also has heavy AI-vocabulary/transition-word density), but the
    verdict must come from the classifier — not a 99%-confidence rule
    override, and not labeled model_used="rule_filter".
    """
    from httpx import AsyncClient, ASGITransport
    from src.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post("/scan/", json={"text": BOT_TEXT})

    assert resp.status_code == 200
    data = resp.json()
    assert data["classification"] == "ai-generated"
    assert data["model_used"] != "rule_filter"


@pytest.mark.asyncio
async def test_short_text_returns_uncertain():
    from httpx import AsyncClient, ASGITransport
    from src.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post("/scan/", json={"text": "This is way too short."})

    assert resp.status_code == 200
    assert resp.json()["classification"] == "uncertain"


@pytest.mark.asyncio
async def test_text_under_20_chars_returns_400():
    from httpx import AsyncClient, ASGITransport
    from src.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post("/scan/", json={"text": "Too short."})

    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "SCAN_INSUFFICIENT_LENGTH"


@pytest.mark.asyncio
async def test_full_scan_returns_required_fields():
    """Full scan pipeline — classifier mocked to return ai-generated."""
    from httpx import AsyncClient, ASGITransport
    from src.main import app

    mock_cls = {
        "classification": "ai-generated",
        "confidence": 0.87,
        "human_probability": 0.13,
        "ai_probability": 0.87,
        "model_used": "mock-roberta",
    }

    with patch("src.routers.scan.classify", return_value=mock_cls), \
         patch("src.routers.scan.compute_perplexity", return_value=[45.2, 38.1, 52.7]):

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post("/scan/", json={"text": AI_TEXT, "mode": "standard"})

    assert resp.status_code == 200
    data = resp.json()

    required_fields = {
        "scan_id", "classification", "confidence",
        "human_probability", "ai_probability", "uncertain_probability",
        "ai_fraction", "coverage", "segments",
        "per_sentence_perplexity", "top_features", "explanation",
        "model_used", "processing_duration_ms",
    }
    missing = required_fields - set(data.keys())
    assert not missing, f"Missing fields: {missing}"

    assert data["classification"] == "ai-generated"
    # Confidence is now derived from segment agreement x coverage, not
    # passed through from the (mocked) classifier's own confidence field —
    # AI_TEXT is short enough to be a single window, so agreement is
    # trivially perfect and coverage is complete: confidence should be high.
    assert data["confidence"] > 0.7
    # ai_fraction is the token-level reconstruction (spec §9) — for a
    # single-window document it equals that window's ai_probability, and
    # ai_probability mirrors it for backward compatibility (spec §34).
    assert data["ai_fraction"] == pytest.approx(0.87)
    assert data["ai_probability"] == pytest.approx(0.87)
    assert data["coverage"]["fraction"] == pytest.approx(1.0)
    assert data["coverage"]["analyzed_tokens"] == data["coverage"]["total_tokens"]
    assert len(data["segments"]) >= 1
    assert data["segments"][0]["classification"] == "ai-generated"
    assert data["segments"][0]["start_char"] == 0
    assert data["segments"][-1]["end_char"] == len(AI_TEXT)
    assert len(data["per_sentence_perplexity"]) == 3
    assert len(data["top_features"]) > 0
    assert "summary" in data["explanation"]
    assert "detail"  in data["explanation"]


@pytest.mark.asyncio
async def test_uncertain_when_classifier_low_confidence():
    from httpx import AsyncClient, ASGITransport
    from src.main import app

    mock_cls = {
        "classification": "uncertain",
        "confidence": 0.55,
        "human_probability": 0.55,
        "ai_probability": 0.45,
        "model_used": "mock-roberta",
    }

    with patch("src.routers.scan.classify", return_value=mock_cls), \
         patch("src.routers.scan.compute_perplexity", return_value=[]):

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post("/scan/", json={"text": AI_TEXT})

    assert resp.json()["classification"] == "uncertain"


# ── Segmentation / coverage (spec §9, §11, §12, §85) ────────────────────────────

@pytest.mark.asyncio
async def test_standard_mode_covers_entire_long_document():
    """
    A document long enough to span multiple windows must be fully covered
    in standard mode — the fix for the old behavior where only the first
    ~400 words of any document were ever classified.
    """
    from httpx import AsyncClient, ASGITransport
    from src.main import app

    long_text = " ".join([f"paragraph{i} content word filler" for i in range(500)])  # ~2500 words

    mock_cls = {
        "classification": "ai-generated", "confidence": 0.8,
        "human_probability": 0.2, "ai_probability": 0.8,
        "model_used": "mock-roberta",
    }

    with patch("src.routers.scan.classify", return_value=mock_cls), \
         patch("src.routers.scan.compute_perplexity", return_value=[]):

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post("/scan/", json={"text": long_text, "mode": "standard"})

    data = resp.json()
    assert data["coverage"]["fraction"] == pytest.approx(1.0)
    assert data["coverage"]["analyzed_tokens"] == data["coverage"]["total_tokens"]
    assert len(data["segments"]) >= 1
    # Segments must span from the very start to the very end of the document.
    assert data["segments"][0]["start_char"] == 0
    assert data["segments"][-1]["end_char"] == len(long_text)


@pytest.mark.asyncio
async def test_quick_mode_reduces_coverage_on_long_document():
    """
    Quick mode samples windows spread across the document (spec §12) rather
    than only reading the beginning — coverage should drop below 100% for a
    document with more than one window, and the reported fraction must be
    honest about it.
    """
    from httpx import AsyncClient, ASGITransport
    from src.main import app

    long_text = " ".join([f"paragraph{i} content word filler" for i in range(500)])

    mock_cls = {
        "classification": "ai-generated", "confidence": 0.8,
        "human_probability": 0.2, "ai_probability": 0.8,
        "model_used": "mock-roberta",
    }

    with patch("src.routers.scan.classify", return_value=mock_cls):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post("/scan/", json={"text": long_text, "mode": "quick"})

    data = resp.json()
    assert 0.0 < data["coverage"]["fraction"] < 1.0
    assert data["coverage"]["analyzed_tokens"] < data["coverage"]["total_tokens"]
    # A gap in coverage must surface as its own segment, not be silently
    # absorbed into a neighboring classified one (see aggregation.document).
    assert any(s["classification"] == "uncertain" for s in data["segments"])


@pytest.mark.asyncio
async def test_cache_hit_on_second_identical_request():
    """Second call with identical text must return cache_hit: true."""
    from httpx import AsyncClient, ASGITransport
    from src.main import app

    mock_cls = {
        "classification": "ai-generated",
        "confidence": 0.91,
        "human_probability": 0.09,
        "ai_probability": 0.91,
        "model_used": "mock-roberta",
    }

    with patch("src.routers.scan.classify", return_value=mock_cls), \
         patch("src.routers.scan.compute_perplexity", return_value=[40.1, 35.5]):

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp1 = await client.post("/scan/", json={"text": AI_TEXT})
            resp2 = await client.post("/scan/", json={"text": AI_TEXT})

    assert resp1.json()["cache_hit"] is False
    assert resp2.json()["cache_hit"] is True
    # Scan IDs must differ — each request gets a fresh scan_id
    assert resp1.json()["scan_id"] != resp2.json()["scan_id"]


@pytest.mark.asyncio
async def test_quick_mode_skips_perplexity():
    """mode=quick should return empty per_sentence_perplexity."""
    from httpx import AsyncClient, ASGITransport
    from src.main import app

    mock_cls = {
        "classification": "ai-generated",
        "confidence": 0.88,
        "human_probability": 0.12,
        "ai_probability": 0.88,
        "model_used": "mock-roberta",
    }

    perplexity_called = []

    def mock_perplexity(text):
        perplexity_called.append(True)
        return [50.0, 60.0]

    with patch("src.routers.scan.classify", return_value=mock_cls), \
         patch("src.routers.scan.compute_perplexity", side_effect=mock_perplexity):

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post("/scan/", json={"text": AI_TEXT, "mode": "quick"})

    assert resp.json()["per_sentence_perplexity"] == []
    assert len(perplexity_called) == 0   # Must not have been called


@pytest.mark.asyncio
async def test_scanner_has_no_humanization_imports():
    """
    Architectural invariant: scanner must share no imports with humanization.
    """
    import ast
    import pathlib

    scanner_dir = pathlib.Path("services/scanner/src")
    if not scanner_dir.exists():
        pytest.skip("Scanner source directory not found — run from repo root.")

    violations: list[str] = []
    for py_file in scanner_dir.rglob("*.py"):
        source = py_file.read_text()
        tree   = ast.parse(source)
        for node in ast.walk(tree):
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                module = ""
                if isinstance(node, ast.ImportFrom) and node.module:
                    module = node.module
                elif isinstance(node, ast.Import):
                    module = ", ".join(alias.name for alias in node.names)
                if "humanization" in module:
                    violations.append(f"{py_file}: imports '{module}'")

    assert not violations, (
        "Scanner imports from humanization — architectural violation:\n"
        + "\n".join(violations)
    )
