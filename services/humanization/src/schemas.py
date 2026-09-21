from pydantic import BaseModel, field_validator


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


class FactLockInput(BaseModel):
    char_start: int
    char_end: int
    text: str
    lock_type: str
    label: str
    confidence: float
    metadata: dict = {}


class HumanizeRequest(BaseModel):
    text: str
    fact_locks: list[FactLockInput] = []
    settings: HumanizeSettings = HumanizeSettings()
    job_id: str | None = None


class QualityScores(BaseModel):
    bertscore_f1: float
    nli_entailment: float
    entity_overlap: float
    passed: bool
    failed_gate: str | None = None
    retry_count: int


class HumanizeResponse(BaseModel):
    job_id: str
    status: str                 # "completed" | "quality_gate_failed"
    output_text: str
    quality_scores: QualityScores
    watermark: dict
    model_used: str
    provider_used: str
    processing_duration_ms: int
    postprocessor_substitutions: int = 0
    warning: str | None = None
