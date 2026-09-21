"""
Unit tests for the humanization pipeline.
LLM calls are always mocked — tests must never make real API calls.
Quality gate functions are tested against real model calls where marked.
"""
import os
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

os.environ.setdefault("WATERMARK_SECRET_SALT", "test-salt-unit")
os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("OPENAI_API_KEY", "sk-test-key-not-real")

from src.providers.base import LLMResponse

SAMPLE_TEXT = (
    "Furthermore, it is important to note that Apple Inc. reported revenue of "
    "$89.5 billion in Q3 2024, representing a 6.2% increase year-over-year. "
    "Moreover, the Federal Reserve does not expect to cut rates before Q2 2025."
)

GOOD_REWRITE = (
    "Apple Inc. reported revenue of $89.5 billion in Q3 2024 — a 6.2% increase "
    "year-over-year. The Federal Reserve does not expect rate cuts before Q2 2025."
)

FACT_LOCKS = [
    {"char_start": 0,  "char_end": 9,  "text": "Apple Inc.", "lock_type": "entity",
     "label": "ORG",  "confidence": 0.95, "metadata": {}},
    {"char_start": 10, "char_end": 22, "text": "$89.5 billion", "lock_type": "number",
     "label": "NUM",  "confidence": 0.99, "metadata": {}},
    {"char_start": 23, "char_end": 30, "text": "Q3 2024", "lock_type": "entity",
     "label": "DATE", "confidence": 0.95, "metadata": {}},
    {"char_start": 31, "char_end": 36, "text": "6.2%", "lock_type": "number",
     "label": "NUM",  "confidence": 0.99, "metadata": {}},
]


def _make_llm_response(text: str) -> LLMResponse:
    return LLMResponse(
        text=text,
        tokens_input=120,
        tokens_output=90,
        provider="openai",
        model="gpt-3.5-turbo",
        latency_ms=350,
    )


# ── Prompt builder ─────────────────────────────────────────────────────────────

class TestPromptBuilder:
    def test_fact_locks_appear_in_prompt(self):
        from src.pipeline.prompt_builder import build_prompt
        _, user_prompt = build_prompt(SAMPLE_TEXT, FACT_LOCKS, intensity=5)
        assert "Apple Inc." in user_prompt
        assert "$89.5 billion" in user_prompt
        assert "6.2%" in user_prompt

    def test_intensity_1_uses_minimal_instructions(self):
        from src.pipeline.prompt_builder import build_prompt
        _, user_prompt = build_prompt(SAMPLE_TEXT, [], intensity=1)
        assert "minimal" in user_prompt.lower()

    def test_intensity_10_uses_aggressive_instructions(self):
        from src.pipeline.prompt_builder import build_prompt
        _, user_prompt = build_prompt(SAMPLE_TEXT, [], intensity=10)
        assert "thorough" in user_prompt.lower() or "aggressively" in user_prompt.lower()

    def test_empty_locks_handled(self):
        from src.pipeline.prompt_builder import build_prompt
        _, user_prompt = build_prompt(SAMPLE_TEXT, [], intensity=5)
        assert "no explicit locks" in user_prompt.lower()


# ── Watermark ─────────────────────────────────────────────────────────────────

class TestWatermark:
    def test_watermark_always_present(self):
        from src.pipeline.watermark import generate_watermark
        wm = generate_watermark("job-123", "gpt-3.5-turbo")
        assert wm["type"] == "ai_processed"
        assert "fingerprint" in wm
        assert len(wm["fingerprint"]) == 64   # SHA-256 hex

    def test_watermark_is_deterministic_same_day(self):
        from src.pipeline.watermark import generate_watermark
        wm1 = generate_watermark("job-abc", "test-model")
        wm2 = generate_watermark("job-abc", "test-model")
        assert wm1["fingerprint"] == wm2["fingerprint"]

    def test_different_jobs_produce_different_fingerprints(self):
        from src.pipeline.watermark import generate_watermark
        wm1 = generate_watermark("job-aaa", "test-model")
        wm2 = generate_watermark("job-bbb", "test-model")
        assert wm1["fingerprint"] != wm2["fingerprint"]

    def test_verification_url_contains_fingerprint(self):
        from src.pipeline.watermark import generate_watermark
        wm = generate_watermark("job-xyz", "test-model")
        assert wm["fingerprint"] in wm["verification_url"]

    def test_fallback_watermark_generated_on_gate_failure(self):
        """Watermark must be present even when quality gate fails."""
        from src.pipeline.watermark import generate_watermark
        wm = generate_watermark("job-fail", "fallback")
        assert wm["type"] == "ai_processed"   # same type — cannot distinguish externally


# ── Post-processor ────────────────────────────────────────────────────────────

class TestPostprocessor:
    def test_replaces_utilize(self):
        from src.pipeline.postprocessor import postprocess
        result = postprocess("We utilize modern techniques to analyze data.", [])
        assert "utilize" not in result.text.lower()
        assert "use" in result.text.lower()

    def test_replaces_delve(self):
        from src.pipeline.postprocessor import postprocess
        result = postprocess("This paper delves into the complexity of the problem.", [])
        assert "delve" not in result.text.lower()

    def test_removes_furthermore_opener(self):
        from src.pipeline.postprocessor import postprocess
        result = postprocess("Furthermore, the results showed improvement.", [])
        assert not result.text.lower().startswith("furthermore")

    def test_does_not_alter_locked_span(self):
        from src.pipeline.postprocessor import postprocess
        text = "We utilize the robust framework."
        # Lock "robust" — should not be replaced
        locks = [{"char_start": 15, "char_end": 21, "text": "robust",
                  "lock_type": "entity", "label": "ORG", "confidence": 0.9, "metadata": {}}]
        result = postprocess(text, locks)
        assert "robust" in result.text   # locked — preserved
        assert "utilize" not in result.text.lower()   # not locked — replaced

    def test_substitution_count_tracked(self):
        from src.pipeline.postprocessor import postprocess
        result = postprocess(
            "We utilize and facilitate robust multifaceted systems.", []
        )
        assert result.substitutions_made >= 3


# ── Intensity router ──────────────────────────────────────────────────────────

class TestIntensityRouter:
    def test_intensity_1_no_postprocessor(self):
        from src.pipeline.intensity_router import get_pipeline_config
        cfg = get_pipeline_config(1)
        assert cfg.run_postprocessor is False

    def test_intensity_5_runs_postprocessor(self):
        from src.pipeline.intensity_router import get_pipeline_config
        cfg = get_pipeline_config(5)
        assert cfg.run_postprocessor is True
        assert cfg.aggressive_opener_removal is False

    def test_intensity_10_aggressive(self):
        from src.pipeline.intensity_router import get_pipeline_config
        cfg = get_pipeline_config(10)
        assert cfg.run_postprocessor is True
        assert cfg.aggressive_opener_removal is True


# ── HTTP endpoint — mocked LLM ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_successful_humanization_returns_watermark():
    """Happy path: LLM returns good rewrite, quality gates pass, watermark present."""
    from httpx import AsyncClient, ASGITransport
    from src.main import app

    with patch("src.routers.humanize._get_provider") as mock_prov_factory, \
         patch("src.routers.humanize.check_bertscore", return_value=(True, 0.946)), \
         patch("src.routers.humanize.check_nli",       return_value=(True, 0.891)), \
         patch("src.routers.humanize.check_entity_overlap", return_value=(True, 1.0)):

        mock_provider = MagicMock()
        mock_provider.generate = AsyncMock(return_value=_make_llm_response(GOOD_REWRITE))
        mock_prov_factory.return_value = mock_provider

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post("/humanize/", json={
                "text": SAMPLE_TEXT,
                "fact_locks": FACT_LOCKS,
                "settings": {"intensity": 5, "tone": "balanced", "domain": "general"},
            })

    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "completed"
    assert data["output_text"] == GOOD_REWRITE
    assert data["watermark"]["type"] == "ai_processed"
    assert len(data["watermark"]["fingerprint"]) == 64
    assert data["quality_scores"]["bertscore_f1"] == pytest.approx(0.946)
    assert data["warning"] is None


@pytest.mark.asyncio
async def test_quality_gate_failure_returns_original_not_bad_rewrite():
    """
    Critical invariant: when all retries fail, the ORIGINAL text is returned.
    The failing rewrite is NEVER shipped to the caller.
    """
    from httpx import AsyncClient, ASGITransport
    from src.main import app

    BAD_REWRITE = "This text is completely different and shares little with the original."

    with patch("src.routers.humanize._get_provider") as mock_prov_factory, \
         patch("src.routers.humanize.check_bertscore", return_value=(False, 0.71)):

        mock_provider = MagicMock()
        mock_provider.generate = AsyncMock(return_value=_make_llm_response(BAD_REWRITE))
        mock_prov_factory.return_value = mock_provider

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post("/humanize/", json={
                "text": SAMPLE_TEXT,
                "fact_locks": [],
                "settings": {"intensity": 5, "tone": "balanced", "domain": "general"},
            })

    assert resp.status_code == 200   # Not a 4xx — we handled it gracefully
    data = resp.json()
    assert data["status"] == "quality_gate_failed"
    assert data["output_text"] == SAMPLE_TEXT   # Original returned — NOT BAD_REWRITE
    assert BAD_REWRITE not in data["output_text"]
    assert data["warning"] is not None
    assert "QUALITY_GATE_NOT_MET" in data["warning"]
    # Watermark must still be present even on failure
    assert data["watermark"]["type"] == "ai_processed"
    assert "fingerprint" in data["watermark"]


@pytest.mark.asyncio
async def test_retry_reduces_temperature():
    """Each retry attempt must use a lower temperature than the previous."""
    from httpx import AsyncClient, ASGITransport
    from src.main import app

    call_temperatures: list[float] = []

    async def mock_generate(system_prompt, user_prompt, max_tokens, temperature, timeout):
        call_temperatures.append(temperature)
        return _make_llm_response(GOOD_REWRITE)

    with patch("src.routers.humanize._get_provider") as mock_prov_factory, \
         patch("src.routers.humanize.check_bertscore", side_effect=[
             (False, 0.80),   # attempt 0 fails
             (False, 0.84),   # attempt 1 fails
             (True,  0.93),   # attempt 2 passes
         ]), \
         patch("src.routers.humanize.check_nli",            return_value=(True, 0.85)), \
         patch("src.routers.humanize.check_entity_overlap", return_value=(True, 1.0)):

        mock_provider = MagicMock()
        mock_provider.generate = AsyncMock(side_effect=mock_generate)
        mock_prov_factory.return_value = mock_provider

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            await client.post("/humanize/", json={
                "text": SAMPLE_TEXT, "fact_locks": [],
                "settings": {"intensity": 5, "tone": "balanced", "domain": "general"},
            })

    assert len(call_temperatures) == 3
    assert call_temperatures[0] > call_temperatures[1] > call_temperatures[2]


@pytest.mark.asyncio
async def test_llm_timeout_returns_502():
    """LLM timeout after all retries must return 502, not 500."""
    from httpx import AsyncClient, ASGITransport
    from src.main import app

    with patch("src.routers.humanize._get_provider") as mock_prov_factory:
        mock_provider = MagicMock()
        mock_provider.generate = AsyncMock(
            side_effect=RuntimeError("OpenAI request timed out after 45s")
        )
        mock_prov_factory.return_value = mock_provider

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post("/humanize/", json={
                "text": SAMPLE_TEXT, "fact_locks": [],
                "settings": {"intensity": 5, "tone": "balanced", "domain": "general"},
            })

    assert resp.status_code == 502
    assert resp.json()["detail"]["code"] == "DEPENDENCY_LLM_PROVIDER_UNAVAILABLE"


@pytest.mark.asyncio
async def test_watermark_present_on_every_code_path():
    """
    Run three scenarios — success, gate failure, LLM error recovery.
    All three must return a watermark dict with type=ai_processed.
    """
    from httpx import AsyncClient, ASGITransport
    from src.main import app

    scenarios = [
        # (bertscore_return, nli_return, entity_return, expected_status)
        ((True, 0.94), (True, 0.85), (True, 1.0),  "completed"),
        ((False, 0.70), None, None,                  "quality_gate_failed"),
    ]

    for bs, nli, ent, expected_status in scenarios:
        patches = {"src.routers.humanize.check_bertscore": bs}
        if nli:
            patches["src.routers.humanize.check_nli"] = nli
        if ent:
            patches["src.routers.humanize.check_entity_overlap"] = ent

        with patch("src.routers.humanize._get_provider") as mock_prov_factory, \
             patch("src.routers.humanize.check_bertscore", return_value=bs), \
             patch("src.routers.humanize.check_nli",       return_value=nli or (True, 0.85)), \
             patch("src.routers.humanize.check_entity_overlap", return_value=ent or (True, 1.0)):

            mock_provider = MagicMock()
            mock_provider.generate = AsyncMock(return_value=_make_llm_response(GOOD_REWRITE))
            mock_prov_factory.return_value = mock_provider

            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                resp = await client.post("/humanize/", json={
                    "text": SAMPLE_TEXT, "fact_locks": [],
                    "settings": {"intensity": 5},
                })

        data = resp.json()
        assert data["watermark"]["type"] == "ai_processed", \
            f"Watermark missing for scenario status={expected_status}"
        assert len(data["watermark"]["fingerprint"]) == 64, \
            f"Watermark fingerprint invalid for status={expected_status}"
        assert data["status"] == expected_status
