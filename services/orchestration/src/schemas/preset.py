from pydantic import BaseModel, field_validator


class PresetCreate(BaseModel):
    name: str
    intensity: int
    tone: str
    domain: str
    preserve_citations: bool = True

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Preset name must not be empty.")
        if len(v) > 100:
            raise ValueError("Preset name must not exceed 100 characters.")
        return v

    @field_validator("intensity")
    @classmethod
    def intensity_range(cls, v: int) -> int:
        if not (1 <= v <= 10):
            raise ValueError("Intensity must be between 1 and 10.")
        return v


class PresetResponse(BaseModel):
    id: str
    name: str
    intensity: int
    tone: str
    domain: str
    preserve_citations: bool
    created_at: str
