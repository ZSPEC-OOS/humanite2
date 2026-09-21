"""
Orchestrates: preprocessing (language + sanitization only) → scanner.
"""
import logging
from datetime import datetime, timezone

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..models.job import Job

logger = logging.getLogger(__name__)


async def run_scan_job(
    text: str,
    job_settings: dict,
    job_id: str,
    db: AsyncSession,
) -> dict:
    job = await db.get(Job, job_id)
    if job:
        job.status = "processing"
        job.attempt_count += 1
        await db.commit()

    try:
        async with httpx.AsyncClient() as client:

            # ── Step 1: Preprocessing (sanitize + language gate only) ─────────
            try:
                prep_resp = await client.post(
                    f"{settings.preprocessing_url}/preprocess/",
                    json={
                        "text": text,
                        "domain_hint": job_settings.get("domain_hint", "general"),
                        "redact_pii": False,
                    },
                    timeout=settings.preprocessing_timeout,
                )
                prep_resp.raise_for_status()
            except httpx.HTTPStatusError as exc:
                raise RuntimeError(
                    f"Preprocessing failed: HTTP {exc.response.status_code}"
                )
            except httpx.TimeoutException:
                raise RuntimeError("Preprocessing service timed out")

            prep = prep_resp.json()

            # ── Step 2: Scan ─────────────────────────────────────────────────
            try:
                scan_resp = await client.post(
                    f"{settings.scanner_url}/scan/",
                    json={
                        "text": prep["sanitized_text"],
                        "mode": job_settings.get("mode", "standard"),
                        "domain_hint": job_settings.get("domain_hint", "general"),
                    },
                    timeout=settings.scanner_timeout,
                )
                scan_resp.raise_for_status()
            except httpx.HTTPStatusError as exc:
                raise RuntimeError(
                    f"Scanner failed: HTTP {exc.response.status_code}"
                )
            except httpx.TimeoutException:
                raise RuntimeError("Scanner service timed out")

            scan = scan_resp.json()

        if job:
            job.status = "completed"
            job.completed_at = datetime.now(timezone.utc)
            await db.commit()

        return {
            "job_id": job_id,
            "status": "completed",
            "scan_id": scan.get("scan_id"),
            "classification": scan.get("classification"),
            "confidence": scan.get("confidence"),
            "human_probability": scan.get("human_probability"),
            "ai_probability": scan.get("ai_probability"),
            "uncertain_probability": scan.get("uncertain_probability"),
            "per_sentence_perplexity": scan.get("per_sentence_perplexity", []),
            "top_features": scan.get("top_features", []),
            "explanation": scan.get("explanation"),
            "model_used": scan.get("model_used"),
            "processing_duration_ms": scan.get("processing_duration_ms"),
        }

    except Exception as exc:
        if job:
            job.status = "failed"
            job.error_code = "INTERNAL_PIPELINE_ERROR"
            job.error_type = type(exc).__name__
            await db.commit()
        logger.error(
            "Scan job failed job_id=%s exception_type=%s",
            job_id, type(exc).__name__,
        )
        raise
