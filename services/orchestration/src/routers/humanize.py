import hashlib
import logging
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..database import get_db
from ..middleware.auth import get_user_claims
from ..models.job import Job
from ..schemas.humanize import HumanizeRequest, HumanizeResponse
from ..services.humanize_service import run_humanize_job

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/v1/humanize", response_model=HumanizeResponse)
async def humanize(
    body: HumanizeRequest,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_user_claims),
) -> HumanizeResponse:

    text = body.text.strip()

    # ── Input validation ──────────────────────────────────────────────────────
    if len(text) < 20:
        raise HTTPException(
            400,
            detail={
                "code": "VALIDATION_MIN_LENGTH",
                "message": "Text must be at least 20 characters.",
            },
        )
    if len(text) > settings.absolute_max_chars:
        raise HTTPException(
            413,
            detail={
                "code": "VALIDATION_MAX_LENGTH",
                "message": f"Text exceeds the {settings.absolute_max_chars:,} character limit.",
            },
        )

    job_id     = str(uuid4())
    input_hash = hashlib.sha256(text.encode()).hexdigest()

    # ── Persist job record — hash only, never raw text ────────────────────────
    job = Job(
        id=job_id,
        user_id=user["user_id"],
        job_type="humanize",
        status="pending",
        input_text_hash=input_hash,
        settings=body.settings.model_dump(),
    )
    db.add(job)
    await db.commit()

    # ── Async path: queue and return 202 ─────────────────────────────────────
    if len(text) > settings.sync_max_chars or body.async_mode:
        from ..tasks import queue_humanize
        queue_humanize.delay(
            job_id=job_id,
            text=text,
            settings=body.settings.model_dump(),
        )
        logger.info(
            "Humanize job queued async job_id=%s user_id=%s chars=%d",
            job_id, user["user_id"], len(text),
        )
        return HumanizeResponse(
            job_id=job_id,
            status="pending",
            result_url=f"/v1/jobs/{job_id}",
        )

    # ── Sync path: run pipeline inline ───────────────────────────────────────
    try:
        result = await run_humanize_job(
            text=text,
            job_settings=body.settings.model_dump(),
            job_id=job_id,
            db=db,
        )
    except RuntimeError:
        raise HTTPException(
            502,
            detail={
                "code": "DEPENDENCY_UPSTREAM_ERROR",
                "message": "An upstream service failed. Please retry.",
            },
        )

    return HumanizeResponse(**result)
