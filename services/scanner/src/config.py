from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    environment: str = "development"
    log_level: str = "INFO"
    redis_url: str = "redis://redis:6379/0"
    cache_ttl_seconds: int = 86400          # 24 hours — scan results are stable

    # Model path — overridden in docker-compose to mount ml/models/
    scanner_model_path: str = "/app/models/scanner-roberta-phase5/best"

    # Confidence thresholds
    confidence_threshold_certain: float = 0.70   # Below this → uncertain
    min_words_for_classification: int = 50        # Below this → uncertain

    class Config:
        env_file = ".env.local"


settings = Settings()
