"""
Celery worker tasks for async humanization jobs.
Uses synchronous httpx (not async) since Celery workers are synchronous.
"""
import asyncio
import logging
import os
from datetime import datetime, timezone

import httpx
from celery import Task

from .celery_app import celery_app

logger = logging.getLogger(__name__)

DATABASE_URL    = os.environ.get("DATABASE_URL", "")
PREPROCESSING   = os.environ.get("PREPROCESSING_URL", "http://preprocessing:8001")
HUMANIZATION    = os.environ.get("HUMANIZATION_URL", "http://humanization:8002")


@celery_app.task(
    name="humanize.process",
    bind=True,
    max_retries=3,
    default_retry_delay=30,
    queue="humanize.interactive",
)
def process_humanize(self: Task, job_id: str, text: str, settings: dict) -> dict:
    """
    Runs preprocessing → humanization for async jobs.
    Updates job status in PostgreSQL via direct asyncpg call.
    """
    logger.info("Worker processing humanize job_id=%s attempt=%d", job_id, self.request.retries)

    try:
        with httpx.Client(timeout=180.0) as client:
            # Step 1: Preprocessing
            prep_resp = client.post(
                f"{PREPROCESSING}/preprocess/",
                json={"text": text, "domain_hint": settings.get("domain", "general"), "redact_pii": False},
            )
            prep_resp.raise_for_status()
            prep = prep_resp.json()

            # Step 2: Humanization
            hum_resp = client.post(
                f"{HUMANIZATION}/humanize/",
                json={
                    "text": prep["sanitized_text"],
                    "fact_locks": prep["fact_locks"],
                    "settings": settings,
                    "job_id": job_id,
                },
            )
            hum_resp.raise_for_status()

        _update_job_status(job_id, "completed")
        return {"status": "completed", "job_id": job_id}

    except Exception as exc:
        logger.error(
            "Humanize worker failed job_id=%s attempt=%d exception_type=%s",
            job_id, self.request.retries, type(exc).__name__,
        )
        if self.request.retries < self.max_retries:
            raise self.retry(exc=exc, countdown=2 ** self.request.retries * 30)
        _update_job_status(job_id, "failed", error_type=type(exc).__name__)
        return {"status": "failed", "job_id": job_id}


def _update_job_status(job_id: str, status: str, error_type: str | None = None) -> None:
    """Synchronous DB update via asyncpg run in new event loop."""
    import asyncpg

    async def _update():
        conn = await asyncpg.connect(DATABASE_URL.replace("+asyncpg", ""))
        try:
            if status == "completed":
                await conn.execute(
                    "UPDATE jobs SET status=$1, completed_at=$2, updated_at=$2 WHERE id=$3",
                    status, datetime.now(timezone.utc), job_id,
                )
            else:
                await conn.execute(
                    "UPDATE jobs SET status=$1, error_type=$2, updated_at=$3 WHERE id=$4",
                    status, error_type, datetime.now(timezone.utc), job_id,
                )
        finally:
            await conn.close()

    asyncio.run(_update())
