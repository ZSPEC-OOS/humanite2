import hashlib
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.dependencies import require_auth
from ..auth.passwords import hash_password, verify_password
from ..auth.tokens import generate_refresh_token, issue_access_token
from ..database import get_db
from ..models.user import RefreshToken, User
from ..schemas.auth import (
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    TokenResponse,
    UserProfile,
)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse, status_code=201)
async def register(body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == body.email.lower()))
    if result.scalar_one_or_none():
        raise HTTPException(
            409,
            detail={
                "code": "EMAIL_TAKEN",
                "message": "An account with this email already exists.",
            },
        )

    user = User(
        email=body.email.lower(),
        password_hash=hash_password(body.password),
        tier="free",
        region="us-east-1",
    )
    db.add(user)
    await db.flush()  # get user.id without committing

    access_token = issue_access_token(str(user.id), user.email, user.tier, user.region)
    family_id = uuid4()
    raw_refresh, refresh_hash = generate_refresh_token(str(user.id), str(family_id))

    db.add(
        RefreshToken(
            user_id=user.id,
            token_hash=refresh_hash,
            family_id=family_id,
            expires_at=datetime.now(timezone.utc) + timedelta(days=7),
        )
    )
    await db.commit()
    return TokenResponse(access_token=access_token, refresh_token=raw_refresh)


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(User).where(User.email == body.email.lower(), User.deleted_at.is_(None))
    )
    user = result.scalar_one_or_none()

    # Constant-time: always run verify even on missing user to prevent timing attacks
    dummy_hash = "$argon2id$v=19$m=65536,t=3,p=4$dummysaltdummysalt16$dummyhashvaluethatisnotreal12345"
    password_ok = verify_password(body.password, user.password_hash if user else dummy_hash)

    if not user or not password_ok:
        raise HTTPException(
            401,
            detail={
                "code": "AUTHENTICATION_FAILED",
                "message": "Invalid email or password.",
            },
        )

    access_token = issue_access_token(str(user.id), user.email, user.tier, user.region)
    family_id = uuid4()
    raw_refresh, refresh_hash = generate_refresh_token(str(user.id), str(family_id))

    db.add(
        RefreshToken(
            user_id=user.id,
            token_hash=refresh_hash,
            family_id=family_id,
            expires_at=datetime.now(timezone.utc) + timedelta(days=7),
        )
    )
    await db.commit()
    return TokenResponse(access_token=access_token, refresh_token=raw_refresh)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(body: RefreshRequest, db: AsyncSession = Depends(get_db)):
    token_hash = hashlib.sha256(body.refresh_token.encode()).hexdigest()

    result = await db.execute(
        select(RefreshToken).where(
            RefreshToken.token_hash == token_hash,
            RefreshToken.revoked_at.is_(None),
            RefreshToken.expires_at > datetime.now(timezone.utc),
        )
    )
    token_record = result.scalar_one_or_none()

    if not token_record:
        # Check if hash exists but was revoked — indicates token theft
        revoked_result = await db.execute(
            select(RefreshToken).where(RefreshToken.token_hash == token_hash)
        )
        revoked = revoked_result.scalar_one_or_none()
        if revoked:
            # Revoke entire family immediately
            await db.execute(
                update(RefreshToken)
                .where(RefreshToken.family_id == revoked.family_id)
                .values(revoked_at=datetime.now(timezone.utc))
            )
            await db.commit()
        raise HTTPException(
            401,
            detail={
                "code": "INVALID_REFRESH_TOKEN",
                "message": "Refresh token is invalid, expired, or already used.",
            },
        )

    # Rotate: revoke old token, issue new pair
    token_record.revoked_at = datetime.now(timezone.utc)
    await db.flush()

    user = await db.get(User, token_record.user_id)
    if not user or user.deleted_at:
        raise HTTPException(401, detail={"code": "USER_NOT_FOUND", "message": "User not found."})

    access_token = issue_access_token(str(user.id), user.email, user.tier, user.region)
    raw_refresh, refresh_hash = generate_refresh_token(str(user.id), str(token_record.family_id))
    db.add(
        RefreshToken(
            user_id=user.id,
            token_hash=refresh_hash,
            family_id=token_record.family_id,  # Same family
            expires_at=datetime.now(timezone.utc) + timedelta(days=7),
        )
    )
    await db.commit()
    return TokenResponse(access_token=access_token, refresh_token=raw_refresh)


@router.get("/me", response_model=UserProfile)
async def me(claims: dict = Depends(require_auth)):
    return UserProfile(
        user_id=claims["sub"],
        email_hash=claims["email_hash"],
        tier=claims["tier"],
        region=claims["region"],
        scopes=claims["scopes"],
    )
