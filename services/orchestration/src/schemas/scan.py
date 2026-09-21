from pydantic import BaseModel, field_validator

from .humanize import _validate_text_safety


class ScanRequest(BaseModel):
    text: str
    mode: str = "standard"
    domain_hint: str = "general"
    async_mode: bool = False

    @field_validator("text")
    @classmethod
    def text_no_injection(cls, v: str) -> str:
        return _validate_text_safety(v)


class ScanResponse(BaseModel):
    job_id: str
    status: str
    scan_id: str | None = None
    classification: str | None = None
    confidence: float | None = None
    human_probability: float | None = None
    ai_probability: float | None = None
    uncertain_probability: float | None = None
    per_sentence_perplexity: list[float] = []
    top_features: list[dict] = []
    explanation: dict | None = None
    model_used: str | None = None
    processing_duration_ms: int | None = None
    result_url: str | None = None
    warning: str | None = None
