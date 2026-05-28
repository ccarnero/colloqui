"""Bootstrap configuration - only connection settings.

All functional runtime configuration comes from backend sync after the
connection to the platform is established.
"""

from __future__ import annotations

from typing import Any, Literal
from urllib.parse import quote_plus

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DbEngine = Literal["postgres", "mongo"]


class BootstrapSettings(BaseSettings):
    """ONLY bootstrap configuration required to connect to backend.

    Everything else (prompts, LLM settings, personality, intervals)
    comes from backend runtime sync after connection.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_ignore_empty=True,
        extra="ignore",
    )

    RUNTIME_API_KEY: str = ""
    NATS_URL: str = "nats://localhost:4222"
    backend_http_url: str = Field(
        default="http://localhost:3000",
        validation_alias=AliasChoices(
            "BACKEND_HTTP_URL",
            "YOIZEN_API_URL",
            "yoizen_api_url",
        ),
    )
    backend_http_api_key: str = Field(
        default="",
        validation_alias=AliasChoices(
            "BACKEND_HTTP_API_KEY",
            "YOIZEN_API_KEY",
            "yoizen_api_key",
        ),
    )

    DB_ENGINE: DbEngine = Field(
        default="postgres",
        validation_alias=AliasChoices("DB_ENGINE", "STORAGE_ENGINE"),
    )

    POSTGRES_HOST: str = Field(
        default="localhost",
        validation_alias=AliasChoices("DB_HOST", "POSTGRES_HOST", "MONGO_HOST"),
    )
    POSTGRES_PORT: int = Field(
        default=5432,
        validation_alias=AliasChoices("DB_PORT", "POSTGRES_PORT"),
    )
    POSTGRES_DB: str = Field(
        default="yoizen_claw",
        validation_alias=AliasChoices("DB_NAME", "POSTGRES_DB"),
    )
    POSTGRES_USER: str = Field(
        default="yoizen",
        validation_alias=AliasChoices("DB_USER", "POSTGRES_USER"),
    )
    POSTGRES_PASSWORD: str = Field(
        default="",
        validation_alias=AliasChoices("DB_PASSWORD", "POSTGRES_PASSWORD"),
    )
    DATABASE_URL: str = ""

    MONGO_URI: str = Field(
        default="",
        validation_alias=AliasChoices("MONGO_URI"),
    )
    MONGO_HOST: str = Field(
        default="localhost",
        validation_alias=AliasChoices("MONGO_HOST"),
    )
    MONGO_PORT: int = Field(
        default=27017,
        validation_alias=AliasChoices("MONGO_PORT"),
    )
    MONGO_DB: str = Field(
        default="yoizen_claw",
        validation_alias=AliasChoices("MONGO_DB"),
    )
    MONGO_USER: str = Field(
        default="",
        validation_alias=AliasChoices("MONGO_USER"),
    )
    MONGO_PASSWORD: str = Field(
        default="",
        validation_alias=AliasChoices("MONGO_PASSWORD"),
    )
    MONGO_AUTH_SOURCE: str = Field(
        default="admin",
        validation_alias=AliasChoices("MONGO_AUTH_SOURCE", "MONGO_AUTHSOURCE"),
    )
    MONGO_REPLICA_SET: str = Field(
        default="rs0",
        validation_alias=AliasChoices("MONGO_REPLICA_SET", "MONGO_REPLICA_SET_NAME"),
    )

    CORS_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173"
    RUNTIME_HEARTBEAT_INTERVAL_SECONDS: float = 15.0
    TENANT_ID: str = ""

    YOIZENCLAW_ADAPTER_TOOLS_ENABLED: bool = True
    CONNECTOR_ADMIN_URL: str = Field(
        default="",
        validation_alias=AliasChoices(
            "CONNECTOR_ADMIN_URL",
            "ADAPTER_SERVICE_URL",
        ),
    )
    ADAPTER_CACHE_TTL_SECONDS: int = 60
    ADAPTER_CACHE_HARD_TTL_SECONDS: int = 300
    YOIZENCLAW_TOOL_RESPONSE_MAX_BYTES: int = 100_000

    @field_validator("DB_ENGINE", mode="before")
    @classmethod
    def _normalize_db_engine(cls, value: object) -> object:
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"postgres", "postgresql", "pg"}:
                return "postgres"
            if normalized in {"mongo", "mongodb"}:
                return "mongo"
        return value

    @property
    def postgres_connection_string(self) -> str:
        return (
            f"postgresql://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}@"
            f"{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )

    def _mongo_query_params(self) -> str:
        params = [f"authSource={self.MONGO_AUTH_SOURCE}"]
        if self.MONGO_REPLICA_SET:
            params.append(f"replicaSet={self.MONGO_REPLICA_SET}")
        return "&".join(params)

    @property
    def mongo_uri(self) -> str:
        if self.MONGO_URI:
            return self.MONGO_URI

        query = self._mongo_query_params()
        if self.MONGO_USER:
            user = quote_plus(self.MONGO_USER)
            password = quote_plus(self.MONGO_PASSWORD)
            return (
                f"mongodb://{user}:{password}"
                f"@{self.MONGO_HOST}:{self.MONGO_PORT}/{self.MONGO_DB}"
                f"?{query}"
            )

        return (
            f"mongodb://{self.MONGO_HOST}:{self.MONGO_PORT}/{self.MONGO_DB}?{query}"
        )


class _BootstrapSettingsProxy:
    """Load bootstrap settings on first attribute access."""

    def __init__(self) -> None:
        self._settings: BootstrapSettings | None = None

    def _resolve(self) -> BootstrapSettings:
        if self._settings is None:
            self._settings = BootstrapSettings()
        return self._settings

    def __getattr__(self, name: str) -> Any:
        return getattr(self._resolve(), name)


bootstrap_settings = _BootstrapSettingsProxy()
settings = bootstrap_settings
