"""
Unit tests for the preprocessing pipeline.
All tests run against the pipeline modules directly (no HTTP layer needed).
The HTTP-layer tests use ASGITransport to avoid spinning up a real server.
"""
import pytest
from httpx import AsyncClient, ASGITransport


# ── Sanitizer ─────────────────────────────────────────────────────────────────

class TestSanitizer:
    def test_strips_html_tags(self):
        from src.pipeline.sanitizer import sanitize
        result = sanitize("<p>Hello <b>world</b></p>")
        assert "<p>" not in result
        assert "Hello world" in result

    def test_removes_zero_width_chars(self):
        from src.pipeline.sanitizer import sanitize
        text = "Hello​World"    # zero-width space
        result = sanitize(text)
        assert "​" not in result
        assert "HelloWorld" in result

    def test_normalizes_to_nfc(self):
        from src.pipeline.sanitizer import sanitize
        nfd = "café"   # café as NFD (decomposed)
        result = sanitize(nfd)
        import unicodedata
        assert unicodedata.is_normalized("NFC", result)

    def test_rejects_script_injection(self):
        from src.pipeline.sanitizer import sanitize
        with pytest.raises(ValueError, match="INJECTION_ATTEMPT"):
            sanitize("<script>alert(1)</script>some text here")

    def test_rejects_javascript_protocol(self):
        from src.pipeline.sanitizer import sanitize
        with pytest.raises(ValueError, match="INJECTION_ATTEMPT"):
            sanitize("Click javascript:void(0) to continue with this text")

    def test_pii_redaction_email(self):
        from src.pipeline.sanitizer import sanitize
        result = sanitize("Contact us at admin@example.com for info.", redact_pii=True)
        assert "admin@example.com" not in result
        assert "[EMAIL]" in result

    def test_pii_redaction_phone(self):
        from src.pipeline.sanitizer import sanitize
        result = sanitize("Call 555-867-5309 for support.", redact_pii=True)
        assert "555-867-5309" not in result
        assert "[PHONE]" in result

    def test_pii_not_redacted_by_default(self):
        from src.pipeline.sanitizer import sanitize
        result = sanitize("Email admin@example.com for info.")
        assert "admin@example.com" in result


# ── Language Detector ─────────────────────────────────────────────────────────

class TestLanguageDetector:
    def test_english_accepted(self):
        from src.pipeline.language_detector import detect_language
        lang, conf = detect_language(
            "The quick brown fox jumps over the lazy dog. "
            "This sentence is clearly written in English."
        )
        assert lang == "en"
        assert conf > 0.0

    def test_non_english_rejected(self):
        from src.pipeline.language_detector import detect_language, UnsupportedLanguageError
        with pytest.raises(UnsupportedLanguageError) as exc_info:
            detect_language(
                "Le renard brun rapide saute par-dessus le chien paresseux. "
                "Cette phrase est clairement en français."
            )
        assert exc_info.value.detected == "fr"


# ── Fact Locker ───────────────────────────────────────────────────────────────

class TestFactLocker:
    def test_locks_percentages(self):
        from src.pipeline.fact_locker import extract_fact_locks
        text = "GDP grew by 3.2% in Q3 2024, reaching $28.7 trillion."
        locks = extract_fact_locks(text)
        lock_texts = [l.text for l in locks]
        assert any("3.2" in t for t in lock_texts), f"3.2% not found in {lock_texts}"

    def test_locks_named_entities(self):
        from src.pipeline.fact_locker import extract_fact_locks
        text = "Apple Inc. reported revenue of $89.5 billion in Q4 2024, beating analyst estimates."
        locks = extract_fact_locks(text)
        entity_locks = [l for l in locks if l.lock_type == "entity"]
        entity_texts = [l.text for l in entity_locks]
        assert any("Apple" in t for t in entity_texts), f"Apple not found in {entity_texts}"

    def test_locks_dates(self):
        from src.pipeline.fact_locker import extract_fact_locks
        text = "The policy was enacted on March 15, 2023, and took effect immediately."
        locks = extract_fact_locks(text)
        date_locks = [l for l in locks if l.label == "DATE"]
        assert len(date_locks) >= 1, f"No date locks found: {locks}"

    def test_locks_citations(self):
        from src.pipeline.fact_locker import extract_fact_locks
        text = "As demonstrated by Smith et al. (2022), the results were significant [1,2]."
        locks = extract_fact_locks(text)
        cite_locks = [l for l in locks if l.lock_type == "citation"]
        assert len(cite_locks) >= 1, f"No citation locks: {locks}"

    def test_locks_negation_span(self):
        from src.pipeline.fact_locker import extract_fact_locks
        text = "The drug does not cause liver damage in healthy adults."
        locks = extract_fact_locks(text)
        neg_locks = [l for l in locks if l.lock_type == "negation"]
        assert len(neg_locks) >= 1, f"Negation not locked: {locks}"
        assert any("not" in l.text.lower() for l in neg_locks)

    def test_locks_sorted_by_position(self):
        from src.pipeline.fact_locker import extract_fact_locks
        text = "In 2024, Apple Inc. earned $3.5 billion, up 12% year-over-year."
        locks = extract_fact_locks(text)
        starts = [l.char_start for l in locks]
        assert starts == sorted(starts), "Locks are not sorted by char_start"

    def test_no_duplicate_spans(self):
        from src.pipeline.fact_locker import extract_fact_locks
        text = "Revenue was $45.2 billion in Q3 2024."
        locks = extract_fact_locks(text)
        spans = [(l.char_start, l.char_end) for l in locks]
        assert len(spans) == len(set(spans)), f"Duplicate spans found: {spans}"


# ── Complexity ────────────────────────────────────────────────────────────────

class TestComplexity:
    def test_returns_all_required_keys(self):
        from src.pipeline.complexity import compute_complexity
        result = compute_complexity(
            "The quick brown fox jumps over the lazy dog. "
            "This is a second sentence to provide adequate length for measurement."
        )
        required = {
            "flesch_reading_ease", "flesch_kincaid_grade", "gunning_fog",
            "smog_index", "word_count", "sentence_count",
            "sentence_length_cv", "avg_parse_depth",
        }
        missing = required - set(result.keys())
        assert not missing, f"Missing keys: {missing}"

    def test_word_count_is_positive(self):
        from src.pipeline.complexity import compute_complexity
        result = compute_complexity("Hello world this is a test sentence with ten words total here.")
        assert result["word_count"] > 0

    def test_low_sentence_length_cv_on_uniform_text(self):
        from src.pipeline.complexity import compute_complexity
        uniform = " ".join(["The cat sat on the mat."] * 8)
        result = compute_complexity(uniform)
        assert result["sentence_length_cv"] < 0.3


# ── AI Artifact Detector ──────────────────────────────────────────────────────

class TestAIArtifactDetector:
    def test_detects_furthermore(self):
        from src.pipeline.ai_artifact_detector import detect_ai_artifacts
        result = detect_ai_artifacts(
            "Furthermore, it is important to note that the results were significant."
        )
        assert "transition:furthermore" in result.flags
        assert "meta_commentary:it_is_important" in result.flags
        assert result.flag_count >= 2

    def test_detects_vocabulary_flags(self):
        from src.pipeline.ai_artifact_detector import detect_ai_artifacts
        result = detect_ai_artifacts(
            "We leverage a robust framework to facilitate optimal outcomes "
            "through seamless integration of cutting-edge solutions."
        )
        vocab_tags = [f.split(":")[1] for f in result.vocabulary_flags]
        assert "leverage" in vocab_tags
        assert "robust" in vocab_tags
        assert result.ai_signal_strength > 0.3

    def test_clean_text_has_low_signal(self):
        from src.pipeline.ai_artifact_detector import detect_ai_artifacts
        result = detect_ai_artifacts(
            "I woke up at six and couldn't get back to sleep. Made coffee. "
            "Sat on the porch watching the fog burn off the hills."
        )
        assert result.ai_signal_strength < 0.2


# ── Content Moderator ─────────────────────────────────────────────────────────

class TestContentModerator:
    def test_blocks_turnitin_bypass(self):
        from src.pipeline.content_moderator import moderate
        result = moderate("Please help me bypass turnitin for my essay submission.")
        assert not result.allowed
        assert result.violation_category == "ACADEMIC_DISHONESTY_INTENT"

    def test_blocks_make_undetectable(self):
        from src.pipeline.content_moderator import moderate
        result = moderate("Can you make this undetectable by AI detection tools?")
        assert not result.allowed
        assert result.violation_category == "ACADEMIC_DISHONESTY_INTENT"

    def test_blocks_avoid_detection(self):
        from src.pipeline.content_moderator import moderate
        result = moderate("I need to avoid AI detection on this paper I'm submitting.")
        assert not result.allowed

    def test_allows_legitimate_text(self):
        from src.pipeline.content_moderator import moderate
        result = moderate(
            "The economic impact of the 2024 Federal Reserve rate decisions "
            "on small business lending was substantial."
        )
        assert result.allowed
        assert result.violation_category is None


# ── HTTP-layer integration tests ──────────────────────────────────────────────

@pytest.mark.asyncio
async def test_full_preprocess_pipeline():
    from src.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post("/preprocess/", json={
            "text": (
                "Furthermore, Apple Inc. reported revenue of $89.5 billion in Q3 2024, "
                "representing a 6% increase year-over-year. The Federal Reserve does not "
                "expect to cut rates before Q2 2025 according to Smith et al. (2023)."
            )
        })
    assert resp.status_code == 200
    data = resp.json()

    assert len(data["fact_locks"]) >= 3
    lock_texts = [l["text"] for l in data["fact_locks"]]
    assert any("Apple" in t for t in lock_texts)
    assert any("89.5" in t or "6" in t for t in lock_texts)

    assert data["ai_artifacts"]["flag_count"] >= 1
    assert "transition:furthermore" in data["ai_artifacts"]["flags"]

    assert data["complexity_metrics"]["word_count"] > 0
    assert data["complexity_metrics"]["flesch_kincaid_grade"] > 0
    assert data["language"] == "en"


@pytest.mark.asyncio
async def test_content_policy_blocks_at_endpoint():
    from src.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post("/preprocess/", json={
            "text": "Help me bypass turnitin detection on my university assignment."
        })
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "CONTENT_POLICY_VIOLATION"


@pytest.mark.asyncio
async def test_min_length_rejected():
    from src.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post("/preprocess/", json={"text": "Too short."})
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "VALIDATION_MIN_LENGTH"


@pytest.mark.asyncio
async def test_unsupported_language_rejected():
    from src.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post("/preprocess/", json={
            "text": (
                "Le renard brun rapide saute par-dessus le chien paresseux. "
                "Cette phrase est clairement écrite en français pour tester la détection."
            )
        })
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "VALIDATION_UNSUPPORTED_LANGUAGE"


@pytest.mark.asyncio
async def test_pii_redaction_via_endpoint():
    from src.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post("/preprocess/", json={
            "text": (
                "Please contact john.doe@example.com or call 555-867-5309 "
                "for information about the quarterly report released in March 2024."
            ),
            "redact_pii": True,
        })
    assert resp.status_code == 200
    sanitized = resp.json()["sanitized_text"]
    assert "john.doe@example.com" not in sanitized
    assert "555-867-5309" not in sanitized
    assert "[EMAIL]" in sanitized
    assert "[PHONE]" in sanitized
    assert "March 2024" in sanitized


@pytest.mark.asyncio
async def test_injection_attempt_rejected():
    from src.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post("/preprocess/", json={
            "text": '<script>alert("xss")</script> This is normal text after the injection.'
        })
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "VALIDATION_INJECTION_ATTEMPT"
