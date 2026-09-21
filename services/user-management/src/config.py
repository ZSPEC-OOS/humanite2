from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://dev:dev@postgres:5432/humanite_dev"
    redis_url: str = "redis://redis:6379/0"
    jwt_private_key: str = ""
    jwt_public_key: str = ""
    jwt_access_expire_minutes: int = 15
    jwt_refresh_expire_days: int = 7
    environment: str = "development"
    log_level: str = "INFO"

    class Config:
        env_file = ".env.local"
        env_file_encoding = "utf-8"


settings = Settings()
