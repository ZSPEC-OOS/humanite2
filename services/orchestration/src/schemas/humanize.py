import re

from pydantic import BaseModel, field_validator

# Patterns that indicate XSS or injection attempts
_XSS_PATTERNS: tuple[re.Pattern, ...] = (
    re.compile(r'<\s*script[\s>]', re.IGNORECASE),
    re.compile(r'javascript\s*:', re.IGNORECASE),
    re.compile(r'on\w+\s*=\s*["\']', re.IGNORECASE),  # onerror=, onload=, etc.
    re.compile(r'<\s*iframe[\s>]', re.IGNORECASE),
    re.compile(r'<\s*object[\s>]', re.IGNORECASE),
    re.compile(r'<\s*embed[\s>]', re.IGNORECASE),
    re.compile(r'vbscript\s*:', re.IGNORECASE),
    re.compile(r'data\s*:\s*text/html', re.IGNORECASE),
)

_SQL_PATTERNS: tuple[re.Pattern, ...] = (
    re.compile(r"(?:'\s*(?:OR|AND)\s*'[^']*'\s*=\s*'[^']*')", re.IGNORECASE),
    re.compile(r';\s*(?:DROP|DELETE|INSERT|UPDATE|TRUNCATE)\s+', re.IGNORECASE),
    re.compile(r'UNION\s+(?:ALL\s+)?SELECT\b', re.IGNORECASE),
    re.compile(r'--\s*$', re.MULTILINE),
    re.compile(r'/\*.*?\*/', re.DOTALL),
)


def _validate_text_safety(v: str) -> str:
    for pattern in _XSS_PATTERNS:
        if pattern.search(v):
            raise ValueError("Input contains disallowed HTML/script content.")
    for pattern in _SQL_PATTERNS:
        if pattern.search(v):
            raise ValueError("Input contains disallowed SQL injection pattern.")
    return v


class HumanizeSettings(BaseModel):
    intensity: int = 5
    tone: str = "balanced"
    domain: str = "general"
    preserve_citations: bool = True

    @field_validator("intensity")
    @classmethod
    def intensity_range(cls, v: int) -> int:
        if not (1 <= v <= 10):
            raise ValueError("Intensity must be between 1 and 10.")
        return v


class HumanizeRequest(BaseModel):
    text: str
    settings: HumanizeSettings = HumanizeSettings()
    async_mode: bool = False
    idempotency_key: str | None = None

    @field_validator("text")
    @classmethod
    def text_no_injection(cls, v: str) -> str:
        return _validate_text_safety(v)


class HumanizeOutput(BaseModel):
    text: str
    quality_scores: dict
    watermark: dict
    postprocessor_substitutions: int = 0


class HumanizeResponse(BaseModel):
    job_id: str
    status: str
    output: HumanizeOutput | None = None
    preprocessing_metadata: dict | None = None
    processing_metadata: dict | None = None
    result_url: str | None = None
    warning: str | None = None
