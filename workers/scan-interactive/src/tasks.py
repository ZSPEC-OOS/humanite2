import asyncio
import logging
import os
from datetime import datetime, timezone

import httpx
from celery import Task

from .celery_app import celery_app

logger = logging.getLogger(__name__)

DATABASE_URL  = os.environ.get("DATABASE_URL", "")
PREPROCESSING = os.environ.get("PREPROCESSING_URL", "http://preprocessing:8001")
SCANNER       = os.environ.get("SCANNER_URL", "http://scanner:8003")


@celery_app.task(
    name="scan.process",
    bind=True,
    max_retries=3,
    default_retry_delay=30,
    queue="scan.interactive",
)
def process_scan(self: Task, job_id: str, text: str, settings: dict) -> dict:
    logger.info("Worker processing scan job_id=%s attempt=%d", job_id, self.request.retries)

    try:
        with httpx.Client(timeout=120.0) as client:
            prep_resp = client.post(
                f"{PREPROCESSING}/preprocess/",
                json={"text": text, "domain_hint": settings.get("domain_hint", "general"), "redact_pii": False},
            )
            prep_resp.raise_for_status()
            prep = prep_resp.json()

            scan_resp = client.post(
                f"{SCANNER}/scan/",
                json={
                    "text": prep["sanitized_text"],
                    "mode": settings.get("mode", "standard"),
                    "domain_hint": settings.get("domain_hint", "general"),
                },
            )
            scan_resp.raise_for_status()

        _update_job_status(job_id, "completed")
        return {"status": "completed", "job_id": job_id}

    except Exception as exc:
        logger.error(
            "Scan worker failed job_id=%s attempt=%d exception_type=%s",
            job_id, self.request.retries, type(exc).__name__,
        )
        if self.request.retries < self.max_retries:
            raise self.retry(exc=exc, countdown=2 ** self.request.retries * 30)
        _update_job_status(job_id, "failed", error_type=type(exc).__name__)
        return {"status": "failed", "job_id": job_id}


def _update_job_status(job_id: str, status: str, error_type: str | None = None) -> None:
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
