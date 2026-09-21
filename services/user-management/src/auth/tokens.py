import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from jose import jwt, JWTError

from ..config import settings

ALGORITHM = "RS256"


def _scopes_for_tier(tier: str) -> list[str]:
    base = ["humanize:write", "scan:write"]
    if tier in ("pro", "enterprise"):
        base += ["batch:write", "user:read"]
    if tier == "enterprise":
        base += ["admin:read"]
    return base


def issue_access_token(user_id: str, email: str, tier: str, region: str) -> str:
    now = datetime.now(tz=timezone.utc)
    payload = {
        "sub": user_id,
        "email_hash": hashlib.sha256(email.encode()).hexdigest(),
        "tier": tier,
        "scopes": _scopes_for_tier(tier),
        "region": region,
        "iat": now,
        "exp": now + timedelta(minutes=settings.jwt_access_expire_minutes),
        "jti": str(uuid4()),
    }
    # Replace literal \n in env var with real newlines
    private_key = settings.jwt_private_key.replace("\\n", "\n")
    return jwt.encode(payload, private_key, algorithm=ALGORITHM)


def verify_access_token(token: str) -> dict:
    public_key = settings.jwt_public_key.replace("\\n", "\n")
    try:
        payload: dict = jwt.decode(token, public_key, algorithms=[ALGORITHM])
        return payload
    except JWTError as e:
        raise ValueError(f"Invalid token: {e}")


def generate_refresh_token(user_id: str, family_id: str) -> tuple[str, str]:
    """Returns (raw_token, sha256_hash). Store only the hash."""
    raw = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(raw.encode()).hexdigest()
    return raw, token_hash
