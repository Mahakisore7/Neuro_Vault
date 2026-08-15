from functools import lru_cache
from typing import Annotated, Literal

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    """Application configuration, validated once at import time.

    Every environment variable the application reads is declared here. Nothing
    else in the codebase touches os.environ — a variable that is not on this
    class does not exist, and a malformed one stops the process instead of
    surfacing as a confusing failure three layers deep.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Application ───────────────────────────────────────────────────────────
    app_name: str = "NeuroVault API"
    version: str = "0.1.0"
    environment: Literal["development", "test", "production"] = "development"
    debug: bool = True

    # ── Database — two URLs, one database, different drivers ──────────────────
    database_url: str  # async — the application (asyncpg)
    database_url_sync: str  # sync — Alembic and psql (plain, no +asyncpg)

    # ── Auth — verifying a Supabase-issued JWT against its published signing key ─
    # Supabase signs session tokens asymmetrically (ES256); core/security.py
    # fetches the public key from {supabase_url}/auth/v1/.well-known/jwks.json.
    # No secret to hold here - only the project URL, which isn't sensitive
    # (it's the same value the frontend exposes as NEXT_PUBLIC_SUPABASE_URL).
    supabase_url: str

    # ── Application-level tuning ───────────────────────────────────────────────
    # ADR-005: NoDecode opts out of pydantic-settings' JSON pre-parsing, which
    # otherwise runs BEFORE validators and crashes on a plain comma-separated
    # string like "http://localhost:3000" (it isn't valid JSON).
    allowed_origins: Annotated[list[str], NoDecode] = ["http://localhost:3000"]

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def _split_origins(cls, v: str | list[str]) -> list[str]:
        if isinstance(v, str):
            return [origin.strip() for origin in v.split(",") if origin.strip()]
        return v

    @field_validator("database_url")
    @classmethod
    def _require_async_driver(cls, v: str) -> str:
        if not v.startswith("postgresql+asyncpg://"):
            raise ValueError(
                "DATABASE_URL must use the postgresql+asyncpg:// driver. "
                "Plain postgresql:// belongs in DATABASE_URL_SYNC."
            )
        return v

    @field_validator("database_url_sync")
    @classmethod
    def _require_sync_driver(cls, v: str) -> str:
        if not v.startswith("postgresql://"):
            raise ValueError(
                "DATABASE_URL_SYNC must be a plain postgresql:// URL so psql "
                "and Alembic can both consume it."
            )
        return v

    @model_validator(mode="after")
    def _production_safety(self) -> "Settings":
        """Make the unsafe development defaults impossible to ship."""
        if self.environment == "production":
            if self.debug:
                raise ValueError("DEBUG must be false when ENVIRONMENT=production")
            if "*" in self.allowed_origins:
                raise ValueError("ALLOWED_ORIGINS must not contain '*' in production")
        return self

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]  # values come from env, not arguments


settings = get_settings()
