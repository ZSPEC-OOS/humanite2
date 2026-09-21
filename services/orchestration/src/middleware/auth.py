"""
Extract user identity injected by the Go gateway after JWT validation.
All protected routes depend on this — if headers are absent, reject with 401.
"""
from typing import Annotated

from fastapi import Header, HTTPException


async def get_user_claims(
    x_user_id: Annotated[str | None, Header()] = None,
    x_user_tier: Annotated[str | None, Header()] = None,
    x_user_region: Annotated[str | None, Header()] = None,
) -> dict:
    if not x_user_id:
        raise HTTPException(
            401,
            detail={
                "code": "AUTHENTICATION_REQUIRED",
                "message": "Authentication required.",
            },
        )
    return {
        "user_id": x_user_id,
        "tier": x_user_tier or "free",
        "region": x_user_region or "us-east-1",
    }
