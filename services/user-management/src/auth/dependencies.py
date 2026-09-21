from typing import Annotated

from fastapi import Header, HTTPException

from .tokens import verify_access_token


async def require_auth(
    authorization: Annotated[str | None, Header()] = None,
) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            401,
            detail={
                "code": "AUTHENTICATION_REQUIRED",
                "message": "Authorization header with Bearer token required.",
            },
        )
    token = authorization.removeprefix("Bearer ")
    try:
        claims = verify_access_token(token)
    except ValueError:
        raise HTTPException(
            401,
            detail={
                "code": "TOKEN_INVALID",
                "message": "Token is invalid or expired.",
            },
        )
    return claims
