import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..middleware.auth import get_user_claims
from ..models.preset import Preset
from ..schemas.preset import PresetCreate, PresetResponse

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/v1/user/presets", response_model=list[PresetResponse])
async def list_presets(
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_user_claims),
) -> list[PresetResponse]:
    result = await db.execute(
        select(Preset)
        .where(Preset.user_id == user["user_id"])
        .order_by(Preset.created_at.desc())
    )
    presets = result.scalars().all()
    return [
        PresetResponse(
            id=str(p.id),
            name=p.name,
            intensity=p.intensity,
            tone=p.tone,
            domain=p.domain,
            preserve_citations=p.preserve_citations,
            created_at=p.created_at.isoformat(),
        )
        for p in presets
    ]


@router.post("/v1/user/presets", response_model=PresetResponse, status_code=201)
async def create_preset(
    body: PresetCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_user_claims),
) -> PresetResponse:
    now = datetime.now(timezone.utc)
    preset = Preset(
        id=uuid.uuid4(),
        user_id=user["user_id"],
        name=body.name,
        intensity=body.intensity,
        tone=body.tone,
        domain=body.domain,
        preserve_citations=body.preserve_citations,
        created_at=now,
        updated_at=now,
    )
    db.add(preset)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            409,
            detail={
                "code": "PRESET_NAME_TAKEN",
                "message": f"A preset named '{body.name}' already exists.",
            },
        )
    logger.info(
        "Preset created user_id=%s preset_id=%s",
        user["user_id"], str(preset.id),
    )
    return PresetResponse(
        id=str(preset.id),
        name=preset.name,
        intensity=preset.intensity,
        tone=preset.tone,
        domain=preset.domain,
        preserve_citations=preset.preserve_citations,
        created_at=preset.created_at.isoformat(),
    )


@router.get("/v1/user/presets/{preset_id}", response_model=PresetResponse)
async def get_preset(
    preset_id: str,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_user_claims),
) -> PresetResponse:
    preset = await db.get(Preset, preset_id)
    if not preset or str(preset.user_id) != user["user_id"]:
        raise HTTPException(
            404,
            detail={"code": "PRESET_NOT_FOUND", "message": "Preset not found."},
        )
    return PresetResponse(
        id=str(preset.id),
        name=preset.name,
        intensity=preset.intensity,
        tone=preset.tone,
        domain=preset.domain,
        preserve_citations=preset.preserve_citations,
        created_at=preset.created_at.isoformat(),
    )


@router.delete("/v1/user/presets/{preset_id}", status_code=204)
async def delete_preset(
    preset_id: str,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_user_claims),
) -> None:
    preset = await db.get(Preset, preset_id)
    if not preset or str(preset.user_id) != user["user_id"]:
        raise HTTPException(
            404,
            detail={"code": "PRESET_NOT_FOUND", "message": "Preset not found."},
        )
    await db.delete(preset)
    await db.commit()
    logger.info(
        "Preset deleted user_id=%s preset_id=%s",
        user["user_id"], preset_id,
    )
