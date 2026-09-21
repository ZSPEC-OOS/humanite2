"""
Celery fan-out task for batch processing.
Processes each item sequentially within the worker to respect
upstream service capacity. One Celery task per batch.
"""
import asyncio
import hashlib
import logging
from datetime import datetime, timezone
from uuid import uuid4

import asyncpg
import httpx

from .celery_app import celery_app

logger = logging.getLogger(__name__)

PREPROCESSING   = "http://preprocessing:8001"
HUMANIZATION    = "http://humanization:8002"
SCANNER         = "http://scanner:8003"

import os
DATABASE_URL = os.environ.get("DATABASE_URL", "").replace("+asyncpg", "")


@celery_app.task(
    name="batch.process",
    bind=True,
    max_retries=0,
    queue="humanize.interactive",
)
def process_batch(self, batch_id: str, items: list[dict], user_id: str) -> dict:
    logger.info(
        "Batch worker started batch_id=%s items=%d",
        batch_id, len(items),
    )
    asyncio.run(_process_batch_async(batch_id, items, user_id))
    return {"batch_id": batch_id, "status": "processed"}


async def _process_batch_async(
    batch_id: str, items: list[dict], user_id: str
) -> None:
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        await conn.execute(
            "UPDATE batch_jobs SET status='processing', updated_at=$1 WHERE id=$2",
            datetime.now(timezone.utc), batch_id,
        )

        completed = 0
        failed    = 0

        for item in items:
            item_id   = item["item_id"]
            text      = item["text"]
            operation = item["operation"]
            settings  = item.get("settings", {})
            job_id    = str(uuid4())

            try:
                input_hash = hashlib.sha256(text.encode()).hexdigest()
                await conn.execute(
                    """INSERT INTO jobs (id, user_id, job_type, status, input_text_hash, settings)
                       VALUES ($1, $2, $3, 'processing', $4, $5)""",
                    job_id, user_id, operation, input_hash,
                    str(settings),
                )

                async with httpx.AsyncClient(timeout=180.0) as client:
                    if operation == "humanize":
                        await _run_humanize(client, text, settings, job_id)
                    else:
                        await _run_scan(client, text, settings, job_id)

                await conn.execute(
                    "UPDATE jobs SET status='completed', completed_at=$1, updated_at=$1 WHERE id=$2",
                    datetime.now(timezone.utc), job_id,
                )
                await conn.execute(
                    """UPDATE batch_items
                       SET status='completed', job_id=$1, updated_at=$2
                       WHERE batch_job_id=$3 AND item_id=$4""",
                    job_id, datetime.now(timezone.utc), batch_id, item_id,
                )
                completed += 1

            except Exception as exc:
                logger.error(
                    "Batch item failed batch_id=%s item_id=%s exception_type=%s",
                    batch_id, item_id, type(exc).__name__,
                )
                await conn.execute(
                    """UPDATE batch_items
                       SET status='failed', error_code=$1, updated_at=$2
                       WHERE batch_job_id=$3 AND item_id=$4""",
                    "INTERNAL_PIPELINE_ERROR",
                    datetime.now(timezone.utc),
                    batch_id, item_id,
                )
                await conn.execute(
                    "UPDATE jobs SET status='failed', error_type=$1, updated_at=$2 WHERE id=$3",
                    type(exc).__name__, datetime.now(timezone.utc), job_id,
                )
                failed += 1

        if failed == 0:
            final_status = "completed"
        elif completed == 0:
            final_status = "failed"
        else:
            final_status = "partial"

        await conn.execute(
            """UPDATE batch_jobs
               SET status=$1, completed_items=$2, failed_items=$3,
                   completed_at=$4, updated_at=$4
               WHERE id=$5""",
            final_status,
            completed, failed,
            datetime.now(timezone.utc),
            batch_id,
        )
        logger.info(
            "Batch complete batch_id=%s status=%s completed=%d failed=%d",
            batch_id, final_status, completed, failed,
        )

    finally:
        await conn.close()


async def _run_humanize(
    client: httpx.AsyncClient,
    text: str,
    settings: dict,
    job_id: str,
) -> dict:
    prep_resp = await client.post(
        f"{PREPROCESSING}/preprocess/",
        json={"text": text, "domain_hint": settings.get("domain", "general"), "redact_pii": False},
    )
    prep_resp.raise_for_status()
    prep = prep_resp.json()

    hum_resp = await client.post(
        f"{HUMANIZATION}/humanize/",
        json={
            "text": prep["sanitized_text"],
            "fact_locks": prep["fact_locks"],
            "settings": settings,
            "job_id": job_id,
        },
    )
    hum_resp.raise_for_status()
    return hum_resp.json()


async def _run_scan(
    client: httpx.AsyncClient,
    text: str,
    settings: dict,
    job_id: str,
) -> dict:
    prep_resp = await client.post(
        f"{PREPROCESSING}/preprocess/",
        json={"text": text, "domain_hint": settings.get("domain_hint", "general"), "redact_pii": False},
    )
    prep_resp.raise_for_status()
    prep = prep_resp.json()

    scan_resp = await client.post(
        f"{SCANNER}/scan/",
        json={
            "text": prep["sanitized_text"],
            "mode": settings.get("mode", "standard"),
        },
    )
    scan_resp.raise_for_status()
    return scan_resp.json()
