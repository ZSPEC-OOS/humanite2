from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    redis_url: str = "redis://redis:6379/0"
    environment: str = "development"
    log_level: str = "INFO"
    cache_ttl_seconds: int = 3600       # 1 hour
    min_text_chars: int = 20
    max_text_chars: int = 100_000
    supported_languages: set[str] = {"en"}

    class Config:
        env_file = ".env.local"


settings = Settings()
