import hashlib
import logging
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..database import get_db
from ..middleware.auth import get_user_claims
from ..models.job import Job
from ..schemas.scan import ScanRequest, ScanResponse
from ..services.scan_service import run_scan_job

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/v1/scan", response_model=ScanResponse)
async def scan(
    body: ScanRequest,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_user_claims),
) -> ScanResponse:

    text = body.text.strip()

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

    job = Job(
        id=job_id,
        user_id=user["user_id"],
        job_type="scan",
        status="pending",
        input_text_hash=input_hash,
        settings={"mode": body.mode, "domain_hint": body.domain_hint},
    )
    db.add(job)
    await db.commit()

    if len(text) > settings.sync_max_chars or body.async_mode:
        from ..tasks import queue_scan
        queue_scan.delay(
            job_id=job_id,
            text=text,
            settings={"mode": body.mode, "domain_hint": body.domain_hint},
        )
        return ScanResponse(
            job_id=job_id,
            status="pending",
            result_url=f"/v1/jobs/{job_id}",
        )

    try:
        result = await run_scan_job(
            text=text,
            job_settings={"mode": body.mode, "domain_hint": body.domain_hint},
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

    return ScanResponse(**result)
