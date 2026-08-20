from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_env: str = "development"
    market_data_provider: str = "mock"
    twelve_data_api_key: str = ""
    database_url: str = "sqlite:///./signals.db"
    cors_origins: str = "http://localhost:3000"
    signal_mode: str = "HIGH_PRECISION"
    min_signal_score: int = 85
    min_rr: float = 1.5
    poll_seconds: int = 30

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def cors_origin_list(self) -> list[str]:
        return [x.strip() for x in self.cors_origins.split(",") if x.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
