from pydantic import BaseModel, field_validator


class ExportRequest(BaseModel):
    text: str
    format: str
    watermark: dict
    job_id: str
    title: str = "Humanite Export"

    @field_validator("format")
    @classmethod
    def valid_format(cls, v: str) -> str:
        if v not in ("text", "markdown", "docx"):
            raise ValueError("Format must be 'text', 'markdown', or 'docx'.")
        return v

    @field_validator("text")
    @classmethod
    def text_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Export text must not be empty.")
        return v
