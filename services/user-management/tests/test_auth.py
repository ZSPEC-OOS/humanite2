import hashlib
import os

import pytest

# Set env vars before importing app modules
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5432/test")
os.environ.setdefault("JWT_PRIVATE_KEY", "")
os.environ.setdefault("JWT_PUBLIC_KEY", "")
os.environ.setdefault("WATERMARK_SECRET_SALT", "test-salt")

from src.auth.passwords import hash_password, verify_password  # noqa: E402
from src.auth.tokens import (  # noqa: E402
    generate_refresh_token,
    issue_access_token,
    verify_access_token,
)


# ── RSA pair helper ────────────────────────────────────────────────────────────

def _make_rsa_pair() -> tuple[str, str]:
    """Generate a temporary RSA pair for unit testing."""
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = private_key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.TraditionalOpenSSL,
        serialization.NoEncryption(),
    ).decode()
    public_pem = private_key.public_key().public_bytes(
        serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()
    return private_pem, public_pem


# ── Password tests (no DB required) ───────────────────────────────────────────

def test_hash_and_verify_password():
    hashed = hash_password("securepassword123")
    assert hashed != "securepassword123"  # Never stored as plain text
    assert verify_password("securepassword123", hashed) is True


def test_wrong_password_fails():
    hashed = hash_password("correct")
    assert verify_password("wrong", hashed) is False


def test_hash_is_argon2id():
    hashed = hash_password("test")
    assert hashed.startswith("$argon2id$")  # Confirm algorithm


# ── Token tests (no DB required) ──────────────────────────────────────────────

def test_access_token_round_trip(monkeypatch):
    priv, pub = _make_rsa_pair()
    monkeypatch.setattr("src.auth.tokens.settings.jwt_private_key", priv)
    monkeypatch.setattr("src.auth.tokens.settings.jwt_public_key", pub)

    token = issue_access_token("user-123", "test@example.com", "pro", "us-east-1")
    assert isinstance(token, str)
    assert len(token) > 50

    claims = verify_access_token(token)
    assert claims["sub"] == "user-123"
    assert claims["tier"] == "pro"
    assert "humanize:write" in claims["scopes"]
    assert "batch:write" in claims["scopes"]    # pro tier gets batch
    assert "admin:read" not in claims["scopes"]  # pro tier does NOT get admin


def test_enterprise_scopes(monkeypatch):
    priv, pub = _make_rsa_pair()
    monkeypatch.setattr("src.auth.tokens.settings.jwt_private_key", priv)
    monkeypatch.setattr("src.auth.tokens.settings.jwt_public_key", pub)
    token = issue_access_token("u", "e@e.com", "enterprise", "eu-west-1")
    claims = verify_access_token(token)
    assert "admin:read" in claims["scopes"]


def test_free_tier_scopes(monkeypatch):
    priv, pub = _make_rsa_pair()
    monkeypatch.setattr("src.auth.tokens.settings.jwt_private_key", priv)
    monkeypatch.setattr("src.auth.tokens.settings.jwt_public_key", pub)
    token = issue_access_token("u", "f@f.com", "free", "us-east-1")
    claims = verify_access_token(token)
    assert "batch:write" not in claims["scopes"]


def test_tampered_token_rejected(monkeypatch):
    priv, pub = _make_rsa_pair()
    monkeypatch.setattr("src.auth.tokens.settings.jwt_private_key", priv)
    monkeypatch.setattr("src.auth.tokens.settings.jwt_public_key", pub)
    token = issue_access_token("u", "t@t.com", "free", "us-east-1")
    tampered = token[:-5] + "XXXXX"
    with pytest.raises(ValueError):
        verify_access_token(tampered)


def test_refresh_token_generates_hash():
    raw, token_hash = generate_refresh_token("user-id", "family-id")
    expected = hashlib.sha256(raw.encode()).hexdigest()
    assert token_hash == expected
    assert raw != token_hash  # Raw is never equal to its own hash


def test_different_key_rejected(monkeypatch):
    priv1, pub1 = _make_rsa_pair()
    _, pub2 = _make_rsa_pair()
    monkeypatch.setattr("src.auth.tokens.settings.jwt_private_key", priv1)
    monkeypatch.setattr("src.auth.tokens.settings.jwt_public_key", pub2)  # Wrong public key
    token = issue_access_token("u", "x@x.com", "free", "us-east-1")
    with pytest.raises(ValueError):
        verify_access_token(token)


def test_email_not_stored_in_token(monkeypatch):
    priv, pub = _make_rsa_pair()
    monkeypatch.setattr("src.auth.tokens.settings.jwt_private_key", priv)
    monkeypatch.setattr("src.auth.tokens.settings.jwt_public_key", pub)
    email = "secret@example.com"
    token = issue_access_token("u", email, "free", "us-east-1")
    # Raw email must not appear in any part of the token
    assert email not in token
    claims = verify_access_token(token)
    assert "email" not in claims  # Only email_hash present
    assert "email_hash" in claims
