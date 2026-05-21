from __future__ import annotations

import pytest
from pydantic_settings import BaseSettings

from src.config import BootstrapSettings as RootBootstrapSettings
from src.shared.config.settings import BootstrapSettings as SharedBootstrapSettings


def test_bootstrap_settings_accept_neutral_aliases(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _assert_bootstrap_settings_accepts_aliases(
        monkeypatch,
        RootBootstrapSettings,
        "BACKEND_HTTP_URL",
        "BACKEND_HTTP_API_KEY",
    )
    _assert_bootstrap_settings_accepts_aliases(
        monkeypatch,
        SharedBootstrapSettings,
        "BACKEND_HTTP_URL",
        "BACKEND_HTTP_API_KEY",
    )


def test_bootstrap_settings_accept_legacy_aliases(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _assert_bootstrap_settings_accepts_aliases(
        monkeypatch,
        RootBootstrapSettings,
        "YOIZEN_API_URL",
        "YOIZEN_API_KEY",
    )
    _assert_bootstrap_settings_accepts_aliases(
        monkeypatch,
        SharedBootstrapSettings,
        "YOIZEN_API_URL",
        "YOIZEN_API_KEY",
    )


def _assert_bootstrap_settings_accepts_aliases(
    monkeypatch: pytest.MonkeyPatch,
    settings_class: type[BaseSettings],
    url_env: str,
    key_env: str,
) -> None:
    monkeypatch.setenv(url_env, "http://backend.local:3000")
    monkeypatch.setenv(key_env, "backend-key")
    monkeypatch.setenv("DB_HOST", "postgres")
    monkeypatch.setenv("DB_PORT", "6543")
    monkeypatch.setenv("DB_NAME", "yoizen_runtime")
    monkeypatch.setenv("DB_USER", "runtime_user")
    monkeypatch.setenv("DB_PASSWORD", "runtime_password")

    settings = settings_class()

    assert settings.backend_http_url == "http://backend.local:3000"
    assert settings.backend_http_api_key == "backend-key"
    assert settings.yoizen_api_url == "http://backend.local:3000"
    assert settings.yoizen_api_key == "backend-key"
    assert settings.POSTGRES_HOST == "postgres"
    assert settings.POSTGRES_PORT == 6543
    assert settings.POSTGRES_DB == "yoizen_runtime"
    assert settings.POSTGRES_USER == "runtime_user"
    assert settings.POSTGRES_PASSWORD == "runtime_password"
