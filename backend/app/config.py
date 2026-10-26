from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./autoflow.db"
    data_dir: Path = Path("./data")
    cors_origins: str = "http://localhost:5173"
    scheduler_enabled: bool = True
    auth_enabled: bool = True
    auth_cookie_secure: bool = False  # set true when served over https
    session_days: int = 7
    scheduler_tick_seconds: int = 20
    remove_legacy_demo: bool = True  # tidy away demo data that older versions created (tests switch it off)

    @property
    def samples_dir(self) -> Path:
        return self.data_dir / "samples"

    @property
    def uploads_dir(self) -> Path:
        return self.data_dir / "uploads"

    @property
    def reports_dir(self) -> Path:
        return self.data_dir / "reports"


settings = Settings()
