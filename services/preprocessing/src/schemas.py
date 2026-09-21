from pydantic import BaseModel, field_validator


class PreprocessRequest(BaseModel):
    text: str
    redact_pii: bool = False
    domain_hint: str = "general"

    @field_validator("text")
    @classmethod
    def text_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Text must not be empty.")
        return v


class FactLockSchema(BaseModel):
    char_start: int
    char_end: int
    text: str
    lock_type: str
    label: str
    confidence: float
    metadata: dict = {}


class SegmentSchema(BaseModel):
    index: int
    segment_type: str
    text: str
    char_start: int
    char_end: int
    sentence_count: int


class AIArtifactSchema(BaseModel):
    flags: list[str]
    flag_count: int
    opener_flags: list[str]
    vocabulary_flags: list[str]
    ai_signal_strength: float


class PreprocessResponse(BaseModel):
    sanitized_text: str
    language: str
    language_confidence: float
    fact_locks: list[FactLockSchema]
    segments: list[SegmentSchema]
    complexity_metrics: dict
    ai_artifacts: AIArtifactSchema
    word_count: int
    char_count: int
    cache_hit: bool = False
