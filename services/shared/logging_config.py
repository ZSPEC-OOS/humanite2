"""
Shared structured JSON logging for all Humanite services.

Usage:
    from shared.logging_config import configure_logging
    configure_logging(service_name="orchestration")
"""
import json
import logging
import re
import sys
import traceback
from typing import Any

# Field names whose values are always redacted
_SECRET_FIELDS: frozenset[str] = frozenset(
    {
        "password", "passwd", "secret", "token", "api_key", "apikey",
        "access_token", "refresh_token", "authorization", "private_key",
        "client_secret", "jwt", "credential", "credentials",
    }
)

# Patterns that indicate a value looks like a secret regardless of field name
_SECRET_PATTERNS: tuple[re.Pattern, ...] = (
    re.compile(r"^Bearer\s+\S+", re.IGNORECASE),
    re.compile(r"^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$"),  # JWT
    re.compile(r"^(?:ghp|github_pat|sk-|rk-)[\w]+"),                       # common API key prefixes
)


def _redact(key: str, value: Any) -> Any:
    if isinstance(key, str) and key.lower() in _SECRET_FIELDS:
        return "***REDACTED***"
    if isinstance(value, str):
        for pattern in _SECRET_PATTERNS:
            if pattern.match(value):
                return "***REDACTED***"
    return value


def _sanitize_record(record: logging.LogRecord) -> dict:
    """Build a flat dict from a LogRecord, redacting secrets."""
    base: dict[str, Any] = {
        "timestamp": _format_time(record),
        "level": record.levelname,
        "logger": record.name,
        "message": record.getMessage(),
        "service": getattr(record, "service_name", "unknown"),
    }

    # Structured extra fields from record.__dict__ (skip standard attrs)
    _standard = frozenset(logging.LogRecord(
        "", 0, "", 0, "", (), None
    ).__dict__.keys()) | {"service_name", "message", "asctime"}
    for k, v in record.__dict__.items():
        if k.startswith("_") or k in _standard:
            continue
        base[k] = _redact(k, v)

    if record.exc_info:
        exc_type, _exc_val, _tb = record.exc_info
        base["exception_type"] = (
            f"{exc_type.__module__}.{exc_type.__qualname__}" if exc_type else None
        )
        # Never log exception message or traceback — type only

    return base


def _format_time(record: logging.LogRecord) -> str:
    import datetime
    return datetime.datetime.fromtimestamp(
        record.created, tz=datetime.timezone.utc
    ).isoformat()


class _JSONFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        return json.dumps(_sanitize_record(record), default=str)


def configure_logging(service_name: str, level: int = logging.INFO) -> None:
    """
    Replaces the root logger's handlers with a single JSON-to-stdout handler.
    Injects service_name into every log record via a factory.
    """
    old_factory = logging.getLogRecordFactory()

    def _factory(*args, **kwargs):  # type: ignore[no-untyped-def]
        record = old_factory(*args, **kwargs)
        record.service_name = service_name  # type: ignore[attr-defined]
        return record

    logging.setLogRecordFactory(_factory)

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(_JSONFormatter())

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level)
