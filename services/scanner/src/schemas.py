from pydantic import BaseModel, field_validator


class ScanRequest(BaseModel):
    text: str
    mode: str = "standard"        # "quick" | "standard"
    domain_hint: str = "general"

    @field_validator("text")
    @classmethod
    def text_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Text must not be empty.")
        return v


class FeatureContribution(BaseModel):
    feature: str
    observed_value: float
    direction: str          # "ai_indicator" | "human_indicator"
    contribution: float     # 0.0–1.0 relative weight


class ScanResponse(BaseModel):
    scan_id: str
    classification: str           # "human-written" | "ai-generated" | "uncertain"
    confidence: float
    human_probability: float
    ai_probability: float
    uncertain_probability: float
    per_sentence_perplexity: list[float]
    top_features: list[FeatureContribution]
    explanation: dict
    model_used: str
    processing_duration_ms: int
    evasion_indicators: dict = {"detected": False, "details": []}
    cache_hit: bool = False
