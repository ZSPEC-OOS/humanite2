"""
Orchestration service tests.
All upstream services (preprocessing, humanization, scanner) are mocked via httpx.
PostgreSQL is mocked at the SQLAlchemy session level via app.dependency_overrides.
"""
import contextlib
import os
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost/test")
os.environ.setdefault("REDIS_URL",    "redis://localhost:6379/0")
os.environ.setdefault("ENVIRONMENT",  "test")

SAMPLE_TEXT = (
    "Furthermore, Apple Inc. reported revenue of $89.5 billion in Q3 2024, "
    "representing a 6.2% increase year-over-year. The Federal Reserve does not "
    "expect to cut rates before Q2 2025."
)

MOCK_PREP_RESPONSE = {
    "sanitized_text": SAMPLE_TEXT,
    "language": "en",
    "language_confidence": 0.95,
    "fact_locks": [
        {"char_start": 13, "char_end": 23, "text": "Apple Inc.",
         "lock_type": "entity", "label": "ORG", "confidence": 0.95, "metadata": {}},
        {"char_start": 44, "char_end": 56, "text": "$89.5 billion",
         "lock_type": "number", "label": "NUM", "confidence": 0.99, "metadata": {}},
    ],
    "segments": [],
    "complexity_metrics": {"word_count": 38, "flesch_kincaid_grade": 12.1},
    "ai_artifacts": {"flags": ["transition:furthermore"], "flag_count": 1,
                     "opener_flags": [], "vocabulary_flags": [], "ai_signal_strength": 0.1},
    "word_count": 38,
    "char_count": len(SAMPLE_TEXT),
    "cache_hit": False,
}

MOCK_HUM_RESPONSE = {
    "job_id": "test-job-id",
    "status": "completed",
    "output_text": (
        "Apple Inc. reported revenue of $89.5 billion in Q3 2024 — a 6.2% "
        "increase year-over-year. The Federal Reserve does not expect rate cuts before Q2 2025."
    ),
    "quality_scores": {
        "bertscore_f1": 0.943, "nli_entailment": 0.887,
        "entity_overlap": 1.0, "passed": True,
        "failed_gate": None, "retry_count": 0,
    },
    "watermark": {
        "type": "ai_processed",
        "fingerprint": "a" * 64,
        "job_id": "test-job-id",
        "model": "gpt-3.5-turbo",
        "verification_url": "https://api.humanite.ai/v1/verify/" + "a" * 64,
        "issued_at": "2024-01-01T00:00:00+00:00",
    },
    "model_used": "gpt-3.5-turbo",
    "provider_used": "openai",
    "processing_duration_ms": 1240,
    "postprocessor_substitutions": 2,
    "warning": None,
}

MOCK_SCAN_RESPONSE = {
    "scan_id": "scan-test-id",
    "classification": "ai-generated",
    "confidence": 0.88,
    "human_probability": 0.12,
    "ai_probability": 0.88,
    "uncertain_probability": 0.0,
    "per_sentence_perplexity": [42.1, 38.6, 55.2],
    "top_features": [
        {"feature": "transition_density", "observed_value": 0.33,
         "direction": "ai_indicator", "contribution": 0.72},
    ],
    "explanation": {
        "summary": "Text classified as ai-generated with 88% confidence.",
        "detail": "Transformer classifier output: AI=0.88, Human=0.12.",
    },
    "model_used": "mock-roberta",
    "processing_duration_ms": 320,
}


def _make_mock_db():
    """Return a mock AsyncSession that does nothing but succeed."""
    db = AsyncMock()
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.flush  = AsyncMock()
    db.get    = AsyncMock(return_value=MagicMock(
        status="pending", attempt_count=0,
        completed_at=None,
    ))
    return db


def _make_http_response(data: dict, status_code: int = 200):
    resp = MagicMock()
    resp.status_code = status_code
    resp.json.return_value = data
    resp.raise_for_status = MagicMock()
    return resp


@contextlib.contextmanager
def _override_db(mock_db):
    """Override the get_db dependency for the duration of the context."""
    from src.main import app
    from src.database import get_db

    async def _mock_get_db():
        yield mock_db

    app.dependency_overrides[get_db] = _mock_get_db
    try:
        yield
    finally:
        app.dependency_overrides.pop(get_db, None)


# ── Auth middleware tests ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_missing_user_id_header_returns_401():
    from httpx import AsyncClient, ASGITransport
    from src.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post("/v1/humanize", json={"text": SAMPLE_TEXT})

    assert resp.status_code == 401
    assert resp.json()["detail"]["code"] == "AUTHENTICATION_REQUIRED"


@pytest.mark.asyncio
async def test_missing_user_id_header_on_scan_returns_401():
    from httpx import AsyncClient, ASGITransport
    from src.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post("/v1/scan", json={"text": SAMPLE_TEXT})

    assert resp.status_code == 401


# ── Input validation tests ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_humanize_short_text_returns_400():
    from httpx import AsyncClient, ASGITransport
    from src.main import app

    with _override_db(_make_mock_db()):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test",
            headers={"X-User-ID": "user-1", "X-User-Tier": "pro"},
        ) as client:
            resp = await client.post("/v1/humanize", json={"text": "Too short."})

    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "VALIDATION_MIN_LENGTH"


@pytest.mark.asyncio
async def test_scan_short_text_returns_400():
    from httpx import AsyncClient, ASGITransport
    from src.main import app

    with _override_db(_make_mock_db()):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test",
            headers={"X-User-ID": "user-1", "X-User-Tier": "free"},
        ) as client:
            resp = await client.post("/v1/scan", json={"text": "Short."})

    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "VALIDATION_MIN_LENGTH"


# ── Full pipeline tests ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_full_humanize_pipeline_success():
    from httpx import AsyncClient, ASGITransport
    from src.main import app

    with _override_db(_make_mock_db()), \
         patch("src.services.humanize_service.httpx.AsyncClient") as mock_http:

        mock_client = AsyncMock()
        mock_http.return_value.__aenter__.return_value = mock_client
        mock_client.post = AsyncMock(side_effect=[
            _make_http_response(MOCK_PREP_RESPONSE),
            _make_http_response(MOCK_HUM_RESPONSE),
        ])

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test",
            headers={"X-User-ID": "user-123", "X-User-Tier": "pro"},
        ) as client:
            resp = await client.post("/v1/humanize", json={
                "text": SAMPLE_TEXT,
                "settings": {"intensity": 5, "tone": "balanced", "domain": "general"},
            })

    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "completed"
    assert data["output"] is not None
    assert data["output"]["watermark"]["type"] == "ai_processed"
    assert "Apple Inc." in data["output"]["text"]
    assert "$89.5 billion" in data["output"]["text"]
    assert data["output"]["quality_scores"]["passed"] is True
    assert data["preprocessing_metadata"]["fact_lock_count"] == 2


@pytest.mark.asyncio
async def test_full_scan_pipeline_success():
    from httpx import AsyncClient, ASGITransport
    from src.main import app

    with _override_db(_make_mock_db()), \
         patch("src.services.scan_service.httpx.AsyncClient") as mock_http:

        mock_client = AsyncMock()
        mock_http.return_value.__aenter__.return_value = mock_client
        mock_client.post = AsyncMock(side_effect=[
            _make_http_response(MOCK_PREP_RESPONSE),
            _make_http_response(MOCK_SCAN_RESPONSE),
        ])

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test",
            headers={"X-User-ID": "user-123", "X-User-Tier": "free"},
        ) as client:
            resp = await client.post("/v1/scan", json={
                "text": SAMPLE_TEXT,
                "mode": "standard",
            })

    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "completed"
    assert data["classification"] == "ai-generated"
    assert data["confidence"] == pytest.approx(0.88)
    assert len(data["per_sentence_perplexity"]) == 3
    assert data["explanation"]["summary"] is not None


@pytest.mark.asyncio
async def test_preprocessing_failure_returns_502():
    from httpx import AsyncClient, ASGITransport
    from src.main import app

    with _override_db(_make_mock_db()), \
         patch("src.services.humanize_service.httpx.AsyncClient") as mock_http:

        mock_client = AsyncMock()
        mock_http.return_value.__aenter__.return_value = mock_client
        mock_client.post = AsyncMock(
            side_effect=RuntimeError("Preprocessing service timed out")
        )

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test",
            headers={"X-User-ID": "user-123", "X-User-Tier": "pro"},
        ) as client:
            resp = await client.post("/v1/humanize", json={"text": SAMPLE_TEXT})

    assert resp.status_code == 502
    assert resp.json()["detail"]["code"] == "DEPENDENCY_UPSTREAM_ERROR"


@pytest.mark.asyncio
async def test_async_mode_returns_202_with_result_url():
    from httpx import AsyncClient, ASGITransport
    from src.main import app

    with _override_db(_make_mock_db()), \
         patch("src.tasks.queue_humanize") as mock_queue:

        mock_queue.delay = MagicMock()

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test",
            headers={"X-User-ID": "user-123", "X-User-Tier": "pro"},
        ) as client:
            resp = await client.post("/v1/humanize", json={
                "text": SAMPLE_TEXT,
                "async_mode": True,
            })

    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "pending"
    assert data["result_url"] is not None
    assert data["result_url"].startswith("/v1/jobs/")
    mock_queue.delay.assert_called_once()


@pytest.mark.asyncio
async def test_job_status_returns_404_for_wrong_user():
    """A user must not be able to access another user's job."""
    from httpx import AsyncClient, ASGITransport
    from src.main import app

    mock_job = MagicMock()
    mock_job.user_id = "different-user-id"
    mock_job.id = "some-job-id"

    mock_db = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = mock_job
    mock_db.execute = AsyncMock(return_value=mock_result)

    with _override_db(mock_db):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test",
            headers={"X-User-ID": "attacker-user-id", "X-User-Tier": "free"},
        ) as client:
            resp = await client.get(
                "/v1/jobs/123e4567-e89b-12d3-a456-426614174000"
            )

    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "JOB_NOT_FOUND"


@pytest.mark.asyncio
async def test_job_status_invalid_uuid_returns_404():
    from httpx import AsyncClient, ASGITransport
    from src.main import app

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test",
        headers={"X-User-ID": "user-1", "X-User-Tier": "free"},
    ) as client:
        resp = await client.get("/v1/jobs/not-a-valid-uuid")

    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_input_text_hash_not_raw_text_in_job():
    """
    Verify the job record stores SHA-256 hash, not raw text.
    """
    import hashlib

    captured_jobs: list[dict] = []

    mock_db = AsyncMock()
    mock_db.commit = AsyncMock()

    def capture_add(obj):
        if hasattr(obj, "input_text_hash"):
            captured_jobs.append({
                "input_text_hash": obj.input_text_hash,
            })

    mock_db.add = capture_add
    mock_db.get = AsyncMock(return_value=MagicMock(
        status="pending", attempt_count=0, completed_at=None
    ))

    with _override_db(mock_db), \
         patch("src.routers.humanize.run_humanize_job", new_callable=AsyncMock) as mock_run:

        mock_run.return_value = {
            "job_id": "test", "status": "completed",
            "output": {"text": "rewritten", "quality_scores": {}, "watermark": {},
                       "postprocessor_substitutions": 0},
            "preprocessing_metadata": None,
            "processing_metadata": None,
            "warning": None,
        }

        from httpx import AsyncClient, ASGITransport
        from src.main import app

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test",
            headers={"X-User-ID": "user-1", "X-User-Tier": "pro"},
        ) as client:
            await client.post("/v1/humanize", json={"text": SAMPLE_TEXT})

    assert len(captured_jobs) >= 1
    stored_hash = captured_jobs[0]["input_text_hash"]
    expected    = hashlib.sha256(SAMPLE_TEXT.encode()).hexdigest()

    assert stored_hash == expected, "Job stored hash must match SHA-256 of input text"
    assert stored_hash != SAMPLE_TEXT, "Raw text must never be stored in job record"
