"""Application configuration.

All secrets come from the environment. The development defaults below are
deliberately obvious so they can never be mistaken for production values.
"""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(BACKEND_DIR / ".env", PROJECT_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "FDR Sentinel"
    app_env: str = "development"
    api_prefix: str = "/api/v1"

    # SQLite runs the local demo. PostgreSQL is the intended production
    # database; set DATABASE_URL to postgresql+psycopg://... to switch.
    database_url: str = f"sqlite:///{(BACKEND_DIR / 'var' / 'fdr_sentinel.db').as_posix()}"

    jwt_secret_key: str = "dev-only-insecure-secret-change-me"
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 15
    refresh_token_hours: int = 8

    cookie_secure: bool = False
    frontend_origin: str = "http://localhost:5173"

    upload_dir: str = str(BACKEND_DIR / "var" / "private_uploads")
    max_upload_bytes: int = 5 * 1024 * 1024

    # "manual" (default, no bank access) or "simulated" (clearly labelled demo
    # adapter). A real adapter is not implemented because no authorised bank
    # API or credentials exist.
    bank_verification_mode: str = "manual"
    ocr_engine: str = "text_layer"

    # Business-date policy: maturity thresholds are evaluated in this timezone.
    business_timezone: str = "Asia/Kolkata"

    scheduler_enabled: bool = True
    scan_on_startup: bool = True
    maturity_scan_hour_utc: int = 2
    maturity_thresholds: str = "30,15,7"
    expiry_grace_days: int = 90
    review_sla_hours: int = 48
    approval_sla_hours: int = 48

    login_max_attempts: int = 5
    login_lockout_minutes: int = 15

    demo_password: str = "Sentinel#2026"

    @property
    def thresholds(self) -> list[int]:
        values = [int(part) for part in self.maturity_thresholds.split(",") if part.strip()]
        return sorted({v for v in values if 1 <= v <= 365}, reverse=True) or [30, 15, 7]

    @property
    def is_production(self) -> bool:
        return self.app_env.lower() in {"production", "prod"}

    def validate_for_startup(self) -> None:
        if self.is_production:
            if self.jwt_secret_key.startswith("dev-only") or len(self.jwt_secret_key) < 32:
                raise RuntimeError(
                    "JWT_SECRET_KEY must be a random value of at least 32 characters in production."
                )
            if not self.cookie_secure:
                raise RuntimeError("COOKIE_SECURE must be true in production (HTTPS only).")
        if self.bank_verification_mode not in {"manual", "simulated"}:
            raise RuntimeError("BANK_VERIFICATION_MODE must be 'manual' or 'simulated'.")

    def ensure_directories(self) -> None:
        Path(self.upload_dir).mkdir(parents=True, exist_ok=True)
        if self.database_url.startswith("sqlite:///"):
            db_path = Path(self.database_url.removeprefix("sqlite:///"))
            db_path.parent.mkdir(parents=True, exist_ok=True)


@lru_cache
def get_settings() -> Settings:
    return Settings()
