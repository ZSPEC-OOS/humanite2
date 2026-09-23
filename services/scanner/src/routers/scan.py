import hashlib
import json
import logging
import os
import sys
import time
from uuid import uuid4

import redis.asyncio as aioredis
from fastapi import APIRouter, HTTPException

from ..config import settings
from ..detection.classifier import classify, _load_model
from ..detection.features import extract_features, FEATURE_NAMES
from ..detection.perplexity import compute_perplexity
from ..detection.rule_filter import is_underdetermined
from ..schemas import FeatureContribution, ScanRequest, ScanResponse

sys.path.insert(0, os.path.normpath(os.path.join(os.path.dirname(__file__), "../../..")))
from shared.metrics import SCAN_JOBS_TOTAL, SCAN_CONFIDENCE, SCAN_DURATION, ACTIVE_JOBS

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/scan", tags=["scanner"])

_redis: aioredis.Redis | None = None
# In-process fallback used when Redis is unavailable (tests, dev without Redis)
_local_cache: dict[str, str] = {}


def _get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(settings.redis_url, decode_responses=True)
    return _redis


async def _cache_get(key: str) -> str | None:
    try:
        val = await _get_redis().get(key)
        if val:
            return val
    except Exception:
        pass
    return _local_cache.get(key)


async def _cache_set(key: str, value: str, ttl: int) -> None:
    try:
        await _get_redis().set(key, value, ex=ttl)
        return
    except Exception:
        pass
    _local_cache[key] = value


def _cache_key(text: str) -> str:
    return "scan:v1:" + hashlib.sha256(text.encode()).hexdigest()


def _build_explanation(
    classification: str,
    confidence: float,
    human_prob: float,
    ai_prob: float,
    model_used: str,
    perplexity: list[float],
) -> dict:
    summary = f"Text classified as {classification} with {confidence:.0%} confidence."

    avg_perp = sum(perplexity) / len(perplexity) if perplexity else 0.0
    detail = (
        f"Detector ({model_used}): AI={ai_prob:.2f}, Human={human_prob:.2f}."
    )
    if perplexity:
        detail += (
            f" Average sentence perplexity: {avg_perp:.1f} — one diagnostic "
            "input among several, not independent proof of authorship."
        )

    return {"summary": summary, "detail": detail}


# Features that point toward AI when high. Statistical features get full
# weight (0-1); lexical-rule counts (bot signatures/patterns) are deliberately
# capped lower — a regex hit is weak evidence, not a verdict (see
# classifier._statistical_fallback and features.py module docstring).
_AI_HIGH_FEATURES = {
    "transition_density", "ai_vocab_density", "passive_ratio",
    "nominalization_ratio",
}
_AI_HIGH_WEAK_FEATURES = {"bot_signature_count", "bot_pattern_count"}

# Features that point toward human when high, same weak/strong split.
_HUMAN_HIGH_FEATURES = {
    "ttr", "hapax_ratio", "burstiness_index",
    "sentence_length_cv", "punct_entropy",
}
_HUMAN_HIGH_WEAK_FEATURES = {"first_person_marker_count", "informal_phrase_count"}


def _top_features(
    feature_vec: list[float],
    classification: str,
) -> list[FeatureContribution]:
    """Return top 5 most informative features for the given classification."""
    feat_dict = dict(zip(FEATURE_NAMES, feature_vec))
    contributions: list[FeatureContribution] = []

    for name, value in feat_dict.items():
        if name in _AI_HIGH_FEATURES:
            direction, contrib = "ai_indicator", min(value * 5.0, 1.0)
        elif name in _AI_HIGH_WEAK_FEATURES:
            direction, contrib = "ai_indicator", min(value / 3.0, 1.0) * 0.5
        elif name in _HUMAN_HIGH_FEATURES:
            direction, contrib = "human_indicator", min(value, 1.0)
        elif name in _HUMAN_HIGH_WEAK_FEATURES:
            direction, contrib = "human_indicator", min(value / 3.0, 1.0) * 0.5
        else:
            continue

        contributions.append(FeatureContribution(
            feature=name,
            observed_value=round(float(value), 4),
            direction=direction,
            contribution=round(float(contrib), 4),
        ))

    contributions.sort(key=lambda c: c.contribution, reverse=True)
    return contributions[:5]


@router.post("/", response_model=ScanResponse)
async def scan(body: ScanRequest) -> ScanResponse:
    start_time = time.monotonic()
    scan_id    = str(uuid4())
    text       = body.text.strip()

    if len(text) < 20:
        raise HTTPException(
            400,
            detail={"code": "SCAN_INSUFFICIENT_LENGTH",
                    "message": "Text must be at least 20 characters."},
        )

    ACTIVE_JOBS.labels(job_type="scan").inc()

    try:
        # ── Cache lookup ──────────────────────────────────────────────────────────
        cache_key = _cache_key(text)
        cached = await _cache_get(cache_key)
        if cached:
            data = json.loads(cached)
            data["scan_id"]    = scan_id   # Fresh scan_id per request
            data["cache_hit"]  = True
            data["processing_duration_ms"] = int((time.monotonic() - start_time) * 1000)
            return ScanResponse(**data)

        # ── Stage 1: Evidence-sufficiency gate ───────────────────────────────────
        # Short + low-vocabulary text is insufficient for any classifier — this
        # is the only remaining early return. Bot-signature/human-signal regex
        # hits no longer short-circuit classification (see rule_filter.py); they
        # are numeric features fed into the classifier below instead.
        if is_underdetermined(text):
            return _uncertain_response(scan_id, start_time, reason="text_too_short")

        # ── Stage 2: Statistical feature extraction (includes lexical-rule counts) ─
        feature_vec = extract_features(text)

        # ── Stage 3: Classifier (trained model, or statistical fallback which
        # blends in the weak lexical-rule features) ──────────────────────────────
        cls_result = classify(text)

        # ── Stage 4: Per-sentence perplexity (skip in quick mode) ─────────────────
        perplexity: list[float] = []
        if body.mode != "quick":
            perplexity = compute_perplexity(text)

        # ── Assemble response ─────────────────────────────────────────────────────
        classification     = cls_result["classification"]
        confidence         = cls_result["confidence"]
        human_prob         = cls_result["human_probability"]
        ai_prob            = cls_result["ai_probability"]
        uncertain_prob     = 1.0 - confidence if classification == "uncertain" else 0.0
        top_feats          = _top_features(feature_vec.tolist(), classification)
        explanation        = _build_explanation(
            classification, confidence, human_prob, ai_prob,
            model_used=cls_result["model_used"], perplexity=perplexity,
        )

        resp = ScanResponse(
            scan_id=scan_id,
            classification=classification,
            confidence=confidence,
            human_probability=human_prob,
            ai_probability=ai_prob,
            uncertain_probability=round(uncertain_prob, 4),
            per_sentence_perplexity=perplexity,
            top_features=top_feats,
            explanation=explanation,
            model_used=cls_result["model_used"],
            processing_duration_ms=int((time.monotonic() - start_time) * 1000),
        )

        SCAN_JOBS_TOTAL.labels(classification=classification).inc()
        SCAN_CONFIDENCE.observe(confidence)
        SCAN_DURATION.observe(time.monotonic() - start_time)

        await _cache_result(cache_key, resp)
        return resp
    finally:
        ACTIVE_JOBS.labels(job_type="scan").dec()


def _uncertain_response(
    scan_id: str,
    start_time: float,
    reason: str = "low_confidence",
) -> ScanResponse:
    SCAN_JOBS_TOTAL.labels(classification="uncertain").inc()
    SCAN_CONFIDENCE.observe(0.50)
    SCAN_DURATION.observe(time.monotonic() - start_time)
    return ScanResponse(
        scan_id=scan_id,
        classification="uncertain",
        confidence=0.50,
        human_probability=0.50,
        ai_probability=0.50,
        uncertain_probability=0.50,
        per_sentence_perplexity=[],
        top_features=[],
        explanation={
            "summary": "Classification is uncertain.",
            "detail": f"Reason: {reason}. Insufficient signal for reliable classification.",
        },
        model_used="evidence_gate",
        processing_duration_ms=int((time.monotonic() - start_time) * 1000),
    )


async def _cache_result(key: str, resp: ScanResponse) -> None:
    data = resp.model_dump()
    data.pop("scan_id", None)    # Don't cache the per-request scan_id
    data.pop("cache_hit", None)
    await _cache_set(key, json.dumps(data), settings.cache_ttl_seconds)
