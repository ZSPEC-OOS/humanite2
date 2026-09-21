import hashlib
import logging
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..middleware.auth import get_user_claims
from ..models.batch import BatchItem as BatchItemModel
from ..models.batch import BatchJob
from ..models.job import Job
from ..schemas.batch import (
    BatchItemStatus,
    BatchJobStatus,
    BatchRequest,
    BatchResponse,
)
from ..tasks import queue_batch

logger = logging.getLogger(__name__)
router = APIRouter()

MAX_ITEMS_PER_BATCH = 10
MAX_CHARS_PER_ITEM  = 100_000
MIN_CHARS_PER_ITEM  = 20


@router.post("/v1/batch", response_model=BatchResponse, status_code=202)
async def submit_batch(
    body: BatchRequest,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_user_claims),
) -> BatchResponse:

    if len(body.items) > MAX_ITEMS_PER_BATCH:
        raise HTTPException(
            400,
            detail={
                "code": "BATCH_ITEM_LIMIT_EXCEEDED",
                "message": f"Maximum {MAX_ITEMS_PER_BATCH} items per batch request.",
            },
        )

    batch_id = str(uuid4())
    item_statuses: list[BatchItemStatus] = []
    accepted: list[dict] = []
    rejected_count = 0

    seen_item_ids: set[str] = set()

    for item in body.items:
        if item.item_id in seen_item_ids:
            item_statuses.append(BatchItemStatus(
                item_id=item.item_id,
                status="rejected",
                error_code="DUPLICATE_ITEM_ID",
                skipped_reason="Duplicate item_id within batch.",
            ))
            rejected_count += 1
            continue
        seen_item_ids.add(item.item_id)

        text = item.text.strip()

        if len(text) < MIN_CHARS_PER_ITEM:
            item_statuses.append(BatchItemStatus(
                item_id=item.item_id,
                status="rejected",
                error_code="VALIDATION_MIN_LENGTH",
                skipped_reason=f"Text must be at least {MIN_CHARS_PER_ITEM} characters.",
            ))
            rejected_count += 1
            continue

        if len(text) > MAX_CHARS_PER_ITEM:
            item_statuses.append(BatchItemStatus(
                item_id=item.item_id,
                status="rejected",
                error_code="VALIDATION_MAX_LENGTH",
                skipped_reason=f"Text exceeds {MAX_CHARS_PER_ITEM:,} character limit.",
            ))
            rejected_count += 1
            continue

        input_hash = hashlib.sha256(text.encode()).hexdigest()

        dedup_result = await db.execute(
            select(Job).where(
                Job.user_id == user["user_id"],
                Job.input_text_hash == input_hash,
                Job.job_type == item.operation,
                Job.status == "completed",
            ).limit(1)
        )
        existing_job = dedup_result.scalar_one_or_none()

        if existing_job:
            item_statuses.append(BatchItemStatus(
                item_id=item.item_id,
                status="skipped",
                job_id=str(existing_job.id),
                skipped_reason="Identical content already processed. Existing result linked.",
            ))
            accepted.append({
                "item_id": item.item_id,
                "text": text,
                "operation": item.operation,
                "settings": item.settings,
                "input_hash": input_hash,
                "deduped": True,
                "existing_job_id": str(existing_job.id),
            })
            continue

        item_statuses.append(BatchItemStatus(
            item_id=item.item_id,
            status="pending",
        ))
        accepted.append({
            "item_id": item.item_id,
            "text": text,
            "operation": item.operation,
            "settings": item.settings,
            "input_hash": input_hash,
            "deduped": False,
        })

    batch_job = BatchJob(
        id=batch_id,
        user_id=user["user_id"],
        status="pending",
        total_items=len(accepted),
    )
    db.add(batch_job)

    for acc in accepted:
        db.add(BatchItemModel(
            batch_job_id=batch_id,
            item_id=acc["item_id"],
            operation=acc["operation"],
            status="skipped" if acc["deduped"] else "pending",
            input_hash=acc["input_hash"],
            job_id=acc.get("existing_job_id"),
        ))

    await db.commit()

    items_to_process = [a for a in accepted if not a["deduped"]]
    if items_to_process:
        queue_batch.delay(
            batch_id=batch_id,
            items=items_to_process,
            user_id=user["user_id"],
        )
        logger.info(
            "Batch queued batch_id=%s user_id=%s total=%d processing=%d deduped=%d rejected=%d",
            batch_id, user["user_id"],
            len(accepted), len(items_to_process),
            len(accepted) - len(items_to_process), rejected_count,
        )

    return BatchResponse(
        batch_job_id=batch_id,
        status="pending",
        total_items=len(body.items),
        accepted_items=len(accepted),
        rejected_items=rejected_count,
        item_statuses=item_statuses,
        poll_url=f"/v1/batch/jobs/{batch_id}",
    )


@router.get("/v1/batch/jobs/{batch_id}", response_model=BatchJobStatus)
async def get_batch_status(
    batch_id: str,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_user_claims),
) -> BatchJobStatus:

    result = await db.execute(select(BatchJob).where(BatchJob.id == batch_id))
    batch = result.scalar_one_or_none()

    if not batch or str(batch.user_id) != user["user_id"]:
        raise HTTPException(
            404,
            detail={"code": "BATCH_NOT_FOUND", "message": "Batch job not found."},
        )

    progress = (
        batch.completed_items / batch.total_items
        if batch.total_items > 0
        else 0.0
    )

    return BatchJobStatus(
        batch_job_id=str(batch.id),
        status=batch.status,
        total_items=batch.total_items,
        completed_items=batch.completed_items,
        failed_items=batch.failed_items,
        progress_percent=round(progress * 100, 1),
        created_at=batch.created_at.isoformat(),
        completed_at=batch.completed_at.isoformat() if batch.completed_at else None,
    )
