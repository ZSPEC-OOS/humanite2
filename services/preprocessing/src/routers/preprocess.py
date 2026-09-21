import hashlib
import json
import logging

import redis.asyncio as aioredis
from fastapi import APIRouter, HTTPException

from ..config import settings
from ..pipeline.ai_artifact_detector import detect_ai_artifacts
from ..pipeline.complexity import compute_complexity
from ..pipeline.content_moderator import moderate
from ..pipeline.fact_locker import extract_fact_locks
from ..pipeline.language_detector import UnsupportedLanguageError, detect_language
from ..pipeline.sanitizer import sanitize
from ..pipeline.segmenter import segment_text
from ..schemas import (
    AIArtifactSchema,
    FactLockSchema,
    PreprocessRequest,
    PreprocessResponse,
    SegmentSchema,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/preprocess", tags=["preprocessing"])

# Redis client — initialised lazily
_redis: aioredis.Redis | None = None


def _get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(settings.redis_url, decode_responses=True)
    return _redis


def _cache_key(text: str) -> str:
    return "preprocess:v1:" + hashlib.sha256(text.encode()).hexdigest()


@router.post("/", response_model=PreprocessResponse)
async def preprocess(body: PreprocessRequest) -> PreprocessResponse:

    # ── 0. Content moderation — always first, no caching ─────────────────────
    mod = moderate(body.text)
    if not mod.allowed:
        # Log category only — never the text
        logger.warning("Content policy violation", extra={"category": mod.violation_category})
        raise HTTPException(
            400,
            detail={
                "code": "CONTENT_POLICY_VIOLATION",
                "message": (
                    "This content cannot be processed under our usage policy. "
                    "See https://humanite.ai/policy for details."
                ),
                "violation_category": mod.violation_category,
            },
        )

    # ── 1. Sanitize ──────────────────────────────────────────────────────────
    try:
        clean_text = sanitize(body.text, redact_pii=body.redact_pii)
    except ValueError as exc:
        raise HTTPException(
            400,
            detail={"code": "VALIDATION_INJECTION_ATTEMPT", "message": str(exc)},
        )

    # ── 2. Length gates ──────────────────────────────────────────────────────
    if len(clean_text) < settings.min_text_chars:
        raise HTTPException(
            400,
            detail={
                "code": "VALIDATION_MIN_LENGTH",
                "message": f"Text must be at least {settings.min_text_chars} characters after sanitization.",
            },
        )
    if len(clean_text) > settings.max_text_chars:
        raise HTTPException(
            413,
            detail={
                "code": "VALIDATION_MAX_LENGTH",
                "message": f"Text exceeds the {settings.max_text_chars:,} character limit.",
            },
        )

    # ── 3. Cache lookup — keyed on sanitized text ────────────────────────────
    cache_key = _cache_key(clean_text)
    try:
        cached = await _get_redis().get(cache_key)
        if cached:
            data = json.loads(cached)
            data["cache_hit"] = True
            return PreprocessResponse(**data)
    except Exception:
        # Cache failures are non-fatal — continue without cache
        pass

    # ── 4. Language detection ────────────────────────────────────────────────
    try:
        language, lang_confidence = detect_language(clean_text)
    except UnsupportedLanguageError as exc:
        raise HTTPException(
            400,
            detail={
                "code": "VALIDATION_UNSUPPORTED_LANGUAGE",
                "message": str(exc),
                "detected_language": exc.detected,
            },
        )
    except ValueError as exc:
        raise HTTPException(
            400,
            detail={"code": "VALIDATION_LANGUAGE_DETECTION_FAILED", "message": str(exc)},
        )

    # ── 5. NLP pipeline — all stages run on sanitized text ───────────────────
    fact_locks_raw = extract_fact_locks(clean_text)
    segments_raw = segment_text(clean_text)
    complexity = compute_complexity(clean_text)
    ai_artifacts_raw = detect_ai_artifacts(clean_text)

    # ── 6. Build response ────────────────────────────────────────────────────
    response = PreprocessResponse(
        sanitized_text=clean_text,
        language=language,
        language_confidence=lang_confidence,
        fact_locks=[FactLockSchema(**lock.__dict__) for lock in fact_locks_raw],
        segments=[SegmentSchema(**seg.__dict__) for seg in segments_raw],
        complexity_metrics=complexity,
        ai_artifacts=AIArtifactSchema(
            flags=ai_artifacts_raw.flags,
            flag_count=ai_artifacts_raw.flag_count,
            opener_flags=ai_artifacts_raw.opener_flags,
            vocabulary_flags=ai_artifacts_raw.vocabulary_flags,
            ai_signal_strength=ai_artifacts_raw.ai_signal_strength,
        ),
        word_count=complexity["word_count"],
        char_count=len(clean_text),
        cache_hit=False,
    )

    # ── 7. Cache result ──────────────────────────────────────────────────────
    try:
        await _get_redis().set(
            cache_key,
            response.model_dump_json(),
            ex=settings.cache_ttl_seconds,
        )
    except Exception:
        pass  # Cache write failure is non-fatal

    return response
