"""Application settings. All values come from environment variables (JUNE_*)."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="JUNE_", env_file=(".env", "../.env"), extra="ignore")

    env: str = "development"
    debug: bool = True
    secret_key: str
    frontend_origin: str = "http://localhost:3000"

    database_url: str = "sqlite+aiosqlite:///./june.db"
    auto_create_tables: bool = True
    seed_on_start: bool = False
    seed_password: str | None = None
    redis_url: str | None = None

    access_token_minutes: int = 30
    refresh_token_days: int = 7
    cookie_secure: bool = False
    cookie_domain: str | None = None

    storage_dir: str = "./storage"
    sandbox_dir: str = "./sandboxes"

    # Optional integrations — blank means "not configured" in the product.
    jenkins_url: str = ""
    jenkins_user: str = ""
    jenkins_token: str = ""
    buildpiper_url: str = ""
    buildpiper_token: str = ""
    argo_url: str = ""
    argo_token: str = ""
    opa_url: str = ""
    keycloak_issuer: str = ""
    openbao_addr: str = ""
    openbao_token: str = ""
    s3_endpoint: str = ""
    s3_bucket: str = ""
    grafana_url: str = ""
    prometheus_url: str = ""
    loki_url: str = ""

    log_level: str = Field(default="INFO")

    @property
    def sync_database_url(self) -> str:
        """Alembic runs synchronously."""
        return (
            self.database_url.replace("+aiosqlite", "")
            .replace("+asyncpg", "+psycopg")
            .replace("+asyncmy", "+pymysql")
        )

    @property
    def is_production(self) -> bool:
        return self.env.lower() in {"production", "prod"}

    @property
    def storage_path(self) -> Path:
        path = Path(self.storage_dir).resolve()
        path.mkdir(parents=True, exist_ok=True)
        return path

    @property
    def sandbox_path(self) -> Path:
        path = Path(self.sandbox_dir).resolve()
        path.mkdir(parents=True, exist_ok=True)
        return path

    def integration_configured(self, key: str) -> bool:
        mapping = {
            "jenkins": bool(self.jenkins_url),
            "buildpiper": bool(self.buildpiper_url),
            "argo": bool(self.argo_url),
            "opa": bool(self.opa_url),
            "keycloak": bool(self.keycloak_issuer),
            "openbao": bool(self.openbao_addr),
            "s3": bool(self.s3_endpoint and self.s3_bucket),
            "grafana": bool(self.grafana_url),
            "prometheus": bool(self.prometheus_url),
            "loki": bool(self.loki_url),
            "redis": bool(self.redis_url),
        }
        return mapping.get(key, False)


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    if not settings.secret_key.strip():
        raise RuntimeError("JUNE_SECRET_KEY must be set")
    if settings.is_production:
        weak_markers = ("change-me", "dev-only", "replace-with")
        if len(settings.secret_key) < 32 or any(marker in settings.secret_key.lower() for marker in weak_markers):
            raise RuntimeError("JUNE_SECRET_KEY must be set to a strong unique value in production")
        if not settings.cookie_secure:
            raise RuntimeError("JUNE_COOKIE_SECURE must be true in production")
        if settings.seed_on_start:
            raise RuntimeError("JUNE_SEED_ON_START must be false in production")
    if settings.seed_on_start and (
        settings.seed_password is None or len(settings.seed_password) < 16
    ):
        raise RuntimeError("Set JUNE_SEED_PASSWORD to a unique value of at least 16 characters when seeding")
    return settings


settings = get_settings()
