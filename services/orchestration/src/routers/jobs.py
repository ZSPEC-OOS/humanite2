import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..middleware.auth import get_user_claims
from ..models.job import Job

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/v1/jobs/{job_id}")
async def get_job(
    job_id: str,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_user_claims),
) -> dict:
    # Validate UUID format to prevent injection
    try:
        UUID(job_id)
    except ValueError:
        raise HTTPException(
            404,
            detail={"code": "JOB_NOT_FOUND", "message": "Job not found."},
        )

    result = await db.execute(select(Job).where(Job.id == job_id))
    job = result.scalar_one_or_none()

    # Return 404 even if job exists but belongs to a different user
    # This prevents job ID enumeration attacks
    if not job or str(job.user_id) != user["user_id"]:
        raise HTTPException(
            404,
            detail={"code": "JOB_NOT_FOUND", "message": "Job not found."},
        )

    return {
        "job_id": str(job.id),
        "job_type": job.job_type,
        "status": job.status,
        "created_at": job.created_at.isoformat(),
        "updated_at": job.updated_at.isoformat(),
        "completed_at": job.completed_at.isoformat() if job.completed_at else None,
        "result_url": job.result_url,
        "error_code": job.error_code,
        # Never expose error_type in public API — internal only
    }
