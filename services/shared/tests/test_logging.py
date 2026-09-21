"""Tests for shared structured JSON logging."""
import json
import logging
import io
import sys

import pytest

# Make shared importable from this test location
import importlib
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))

from shared.logging_config import configure_logging, _redact, _sanitize_record


# ---------------------------------------------------------------------------
# _redact unit tests
# ---------------------------------------------------------------------------

def test_redact_known_secret_field():
    assert _redact("password", "mysecret") == "***REDACTED***"


def test_redact_apikey_field():
    assert _redact("api_key", "sk-abc123") == "***REDACTED***"


def test_redact_token_field():
    assert _redact("token", "eyJsometoken") == "***REDACTED***"


def test_redact_non_secret_field_unchanged():
    assert _redact("user_id", "u-123") == "u-123"


def test_redact_bearer_pattern():
    assert _redact("authorization", "Bearer eyJtoken") == "***REDACTED***"


def test_redact_jwt_value_regardless_of_field():
    jwt = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1MTIzIn0.fakesig123abc"
    assert _redact("some_field", jwt) == "***REDACTED***"


def test_redact_safe_value_unchanged():
    assert _redact("message", "hello world") == "hello world"


# ---------------------------------------------------------------------------
# configure_logging integration tests
# ---------------------------------------------------------------------------

def _capture_log(service_name: str, fn):
    """Helper: configure logging, run fn(), return parsed JSON lines."""
    buf = io.StringIO()
    configure_logging(service_name=service_name)
    # Redirect the root handler to our buffer
    root = logging.getLogger()
    for h in root.handlers:
        h.stream = buf
    fn()
    buf.seek(0)
    return [json.loads(line) for line in buf if line.strip()]


def test_log_output_is_valid_json():
    lines = _capture_log("test-svc", lambda: logging.getLogger("t").info("hello"))
    assert len(lines) >= 1
    assert lines[-1]["message"] == "hello"


def test_log_contains_service_name():
    lines = _capture_log("my-service", lambda: logging.getLogger("t").info("hi"))
    assert lines[-1]["service"] == "my-service"


def test_log_contains_level():
    lines = _capture_log("svc", lambda: logging.getLogger("t").warning("warn"))
    assert lines[-1]["level"] == "WARNING"


def test_exception_type_logged_not_message():
    def _emit():
        try:
            raise ValueError("super sensitive message")
        except ValueError:
            logging.getLogger("t").error("something failed", exc_info=True)

    lines = _capture_log("svc", _emit)
    record = lines[-1]
    assert "exception_type" in record
    assert "ValueError" in record["exception_type"]
    # The exception message must NOT appear in the log record
    assert "super sensitive message" not in json.dumps(record)


def test_secret_field_in_extra_is_redacted():
    def _emit():
        logging.getLogger("t").info("login", extra={"password": "hunter2"})

    lines = _capture_log("svc", _emit)
    assert lines[-1]["password"] == "***REDACTED***"


def test_timestamp_field_present():
    lines = _capture_log("svc", lambda: logging.getLogger("t").info("ts"))
    assert "timestamp" in lines[-1]
