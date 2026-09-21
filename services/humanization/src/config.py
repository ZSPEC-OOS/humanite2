from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    environment: str = "development"
    log_level: str = "INFO"
    redis_url: str = "redis://redis:6379/0"

    # LLM routing
    ollama_base_url: str = "http://ollama:11434"
    ollama_model: str = "mistral:7b-instruct-q4_0"
    openai_api_key: str = ""
    openai_model: str = "gpt-3.5-turbo"
    anthropic_api_key: str = ""

    # Watermark
    watermark_secret_salt: str = "dev-salt-replace-in-production"

    # Quality gate thresholds — hardcoded, never configurable via API
    bertscore_threshold: float = 0.92
    nli_threshold: float = 0.80
    entity_overlap_threshold: float = 0.95

    # Retry policy
    max_retries: int = 3
    retry_temperatures: list[float] = [0.7, 0.5, 0.3]

    # LLM timeouts (seconds)
    llm_timeout_sync: float = 45.0
    llm_timeout_ollama: float = 120.0

    class Config:
        env_file = ".env.local"


settings = Settings()
