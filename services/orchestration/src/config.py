from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    environment: str = "development"
    log_level: str = "INFO"

    database_url: str = "postgresql+asyncpg://dev:dev@postgres:5432/humanite_dev"
    redis_url: str = "redis://redis:6379/0"
    celery_broker_url: str = "redis://redis:6379/1"
    celery_result_backend: str = "redis://redis:6379/3"

    # Internal service URLs — resolved by Docker DNS
    preprocessing_url: str = "http://preprocessing:8001"
    humanization_url: str = "http://humanization:8002"
    scanner_url: str = "http://scanner:8003"

    # Sync/async threshold: inputs larger than this go to Celery queue
    sync_max_chars: int = 10_000
    absolute_max_chars: int = 100_000

    # Internal service timeouts (seconds)
    preprocessing_timeout: float = 30.0
    humanization_timeout: float = 120.0
    scanner_timeout: float = 60.0

    class Config:
        env_file = ".env.local"


settings = Settings()
