"""
Orchestrates: preprocessing → humanization → job persistence.
Called by both the sync route handler and the Celery worker.
"""
import logging
from datetime import datetime, timezone

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..models.job import Job

logger = logging.getLogger(__name__)


async def run_humanize_job(
    text: str,
    job_settings: dict,
    job_id: str,
    db: AsyncSession,
) -> dict:
    """
    Runs the full humanize pipeline and updates the job record.
    Returns a dict matching HumanizeResponse fields.
    Raises on unrecoverable errors — caller must handle.
    """
    # Mark job as processing
    job = await db.get(Job, job_id)
    if job:
        job.status = "processing"
        job.attempt_count += 1
        await db.commit()

    try:
        async with httpx.AsyncClient() as client:

            # ── Step 1: Preprocessing ────────────────────────────────────────
            try:
                prep_resp = await client.post(
                    f"{settings.preprocessing_url}/preprocess/",
                    json={
                        "text": text,
                        "domain_hint": job_settings.get("domain", "general"),
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

            # ── Step 2: Humanization ─────────────────────────────────────────
            try:
                hum_resp = await client.post(
                    f"{settings.humanization_url}/humanize/",
                    json={
                        "text": prep["sanitized_text"],
                        "fact_locks": prep["fact_locks"],
                        "settings": job_settings,
                        "job_id": job_id,
                    },
                    timeout=settings.humanization_timeout,
                )
                hum_resp.raise_for_status()
            except httpx.HTTPStatusError as exc:
                raise RuntimeError(
                    f"Humanization failed: HTTP {exc.response.status_code}"
                )
            except httpx.TimeoutException:
                raise RuntimeError("Humanization service timed out")

            hum = hum_resp.json()

        # ── Update job to completed ──────────────────────────────────────────
        if job:
            job.status = "completed"
            job.completed_at = datetime.now(timezone.utc)
            await db.commit()

        return {
            "job_id": job_id,
            "status": hum["status"],
            "output": {
                "text": hum["output_text"],
                "quality_scores": hum["quality_scores"],
                "watermark": hum["watermark"],
                "postprocessor_substitutions": hum.get("postprocessor_substitutions", 0),
            },
            "preprocessing_metadata": {
                "language": prep.get("language"),
                "word_count": prep.get("word_count"),
                "char_count": prep.get("char_count"),
                "fact_lock_count": len(prep.get("fact_locks", [])),
                "ai_signal_strength": prep.get("ai_artifacts", {}).get("ai_signal_strength", 0),
            },
            "processing_metadata": {
                "model_used": hum.get("model_used"),
                "provider_used": hum.get("provider_used"),
                "processing_duration_ms": hum.get("processing_duration_ms"),
            },
            "warning": hum.get("warning"),
        }

    except Exception as exc:
        # Mark job as failed — store type only, never message
        if job:
            job.status = "failed"
            job.error_code = "INTERNAL_PIPELINE_ERROR"
            job.error_type = type(exc).__name__
            await db.commit()
        logger.error(
            "Humanize job failed job_id=%s exception_type=%s",
            job_id, type(exc).__name__,
        )
        raise
