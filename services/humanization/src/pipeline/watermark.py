"""
Cryptographic watermark applied to every humanized output.

This module is non-disablable. The watermark is applied even when:
- Quality gates fail and the original text is returned
- The LLM call times out
- An exception occurs during processing

The fingerprint is a keyed SHA-256 hash of (job_id + model + date + salt).
It can be verified server-side via /v1/verify/{fingerprint} (Phase 6).
"""
import hashlib
import os
from datetime import datetime, timezone


def generate_watermark(job_id: str, model: str) -> dict:
    """
    Returns a watermark dict that is included in every HumanizeResponse.
    The salt is read from the environment — never hardcoded except in tests.
    """
    salt = os.environ.get("WATERMARK_SECRET_SALT", "dev-salt-replace-in-production")
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    raw = f"{job_id}:{model}:{today}:{salt}"
    fingerprint = hashlib.sha256(raw.encode()).hexdigest()

    return {
        "type": "ai_processed",
        "fingerprint": fingerprint,
        "job_id": job_id,
        "model": model,
        "verification_url": f"https://api.humanite.ai/v1/verify/{fingerprint}",
        "issued_at": datetime.now(timezone.utc).isoformat(),
    }
