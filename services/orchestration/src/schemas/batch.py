from pydantic import BaseModel, field_validator


class BatchItem(BaseModel):
    item_id: str
    text: str
    operation: str = "humanize"
    settings: dict = {}

    @field_validator("item_id")
    @classmethod
    def item_id_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("item_id must not be empty.")
        return v.strip()

    @field_validator("operation")
    @classmethod
    def valid_operation(cls, v: str) -> str:
        if v not in ("humanize", "scan"):
            raise ValueError("operation must be 'humanize' or 'scan'.")
        return v


class BatchRequest(BaseModel):
    items: list[BatchItem]

    @field_validator("items")
    @classmethod
    def items_not_empty(cls, v: list) -> list:
        if not v:
            raise ValueError("Batch must contain at least 1 item.")
        return v


class BatchItemStatus(BaseModel):
    item_id: str
    status: str
    job_id: str | None = None
    error_code: str | None = None
    skipped_reason: str | None = None


class BatchResponse(BaseModel):
    batch_job_id: str
    status: str
    total_items: int
    accepted_items: int
    rejected_items: int
    item_statuses: list[BatchItemStatus]
    poll_url: str


class BatchJobStatus(BaseModel):
    batch_job_id: str
    status: str
    total_items: int
    completed_items: int
    failed_items: int
    progress_percent: float
    created_at: str
    completed_at: str | None = None
