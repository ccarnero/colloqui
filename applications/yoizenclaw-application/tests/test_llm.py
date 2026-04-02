from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

from src.application.llm.llm_service import LLMClient
from src.interfaces.websocket import RuntimeConfigStore


def test_llm_client_uses_mock_provider_without_api_key() -> None:
    client = LLMClient({"provider": "mock", "model": "mock"})

    assert client.provider == "mock"
    assert client.model == "mock"
    assert client.api_key == ""


def test_llm_client_resolves_api_key_from_credential_id(monkeypatch) -> None:
    monkeypatch.setenv("LLM_CREDENTIAL_OPENAI_PROD_API_KEY", "secret-key")

    client = LLMClient(
        {
            "provider": "openai",
            "model": "gpt-4o-mini",
            "credentialId": "openai-prod",
        }
    )

    assert client.provider == "openai"
    assert client.model == "gpt-4o-mini"
    assert client.credential_id == "openai-prod"
    assert client.api_key == "secret-key"
    assert client._use_mock is False


def test_llm_client_resolves_api_key_from_runtime_default_mode(
    monkeypatch,
) -> None:
    monkeypatch.setenv("LLM_CREDENTIAL_OPENAI_DEFAULT_API_KEY", "sk-default")

    client = LLMClient(
        {
            "provider": "openai",
            "model": "gpt-4o-mini",
            "credentialMode": "runtime-default",
        }
    )

    assert client.provider == "openai"
    assert client.credential_id is None
    assert client.credential_mode == "runtime-default"
    assert client.api_key == "sk-default"
    assert client._use_mock is False


def test_llm_client_resolves_api_key_from_runtime_secret_file(
    monkeypatch,
    tmp_path: Path,
) -> None:
    runtime_dir = tmp_path / "runtime-config"
    secret_dir = runtime_dir / "runtime-secrets"
    secret_dir.mkdir(parents=True, exist_ok=True)
    (secret_dir / "credentials.env").write_text(
        "LLM_CREDENTIAL_OPENAI_PROD_API_KEY=sk-runtime\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("RUNTIME_CONFIG_DIR", str(runtime_dir))

    client = LLMClient(
        {
            "provider": "openai",
            "model": "gpt-4o-mini",
            "credentialId": "openai-prod",
        }
    )

    assert client.provider == "openai"
    assert client.credential_id == "openai-prod"
    assert client.api_key == "sk-runtime"
    assert client._use_mock is False


def test_llm_client_profile_mode_ignores_runtime_default_credentials(
    monkeypatch,
) -> None:
    monkeypatch.setenv("LLM_CREDENTIAL_OPENAI_DEFAULT_API_KEY", "sk-default")
    monkeypatch.delenv("LLM_CREDENTIAL_OPENAI_PROD_API_KEY", raising=False)

    client = LLMClient(
        {
            "provider": "openai",
            "model": "gpt-4o-mini",
            "credentialId": "openai-prod",
            "credentialMode": "profile",
        }
    )

    assert client.credential_id == "openai-prod"
    assert client.credential_mode == "profile"
    assert client.api_key == ""
    assert client._use_mock is True


def test_llm_client_resolves_openai_without_api_key(
    monkeypatch,
    tmp_path: Path,
) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("LLM_CREDENTIAL_OPENAI_DEFAULT_API_KEY", raising=False)
    monkeypatch.delenv("LLM_CREDENTIAL_OPENAI_PROD_API_KEY", raising=False)
    runtime_dir = tmp_path / "runtime-config"
    runtime_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("RUNTIME_CONFIG_DIR", str(runtime_dir))
    monkeypatch.setenv("YOIZEN_RUNTIME_CONFIG_DIR", str(runtime_dir))

    client = LLMClient({"provider": "openai", "model": "gpt-4o-mini"})

    assert client.provider == "openai"
    assert client.model == "gpt-4o-mini"
    assert client.credential_mode == "runtime-default"
    assert client.api_key == ""
    assert client._use_mock is True


def test_llm_client_none_mode_ignores_all_credentials(
    monkeypatch,
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "sk-global")
    monkeypatch.setenv("LLM_CREDENTIAL_OPENAI_DEFAULT_API_KEY", "sk-default")

    client = LLMClient(
        {
            "provider": "openai",
            "model": "gpt-4o-mini",
            "credentialMode": "none",
        }
    )

    assert client.credential_mode == "none"
    assert client.api_key == ""
    assert client._use_mock is True


def test_llm_client_resolves_google_vertex_credential_bundle_with_model(
    monkeypatch,
) -> None:
    monkeypatch.setenv("LLM_CREDENTIAL_VERTEX_PROD_PROJECT_ID", "demo-project")
    monkeypatch.setenv("LLM_CREDENTIAL_VERTEX_PROD_REGION", "europe-west1")
    monkeypatch.setenv(
        "LLM_CREDENTIAL_VERTEX_PROD_SERVICE_ACCOUNT_JSON",
        json.dumps(
            {
                "type": "service_account",
                "project_id": "demo-project",
                "client_email": "demo@demo-project.iam.gserviceaccount.com",
            }
        ),
    )

    client = LLMClient(
        {
            "provider": "google-vertex",
            "model": "gemini-2.5-flash",
            "credentialId": "vertex-prod",
        }
    )

    assert client.provider == "google-vertex"
    assert client.model == "gemini-2.5-flash"
    assert client.credentials.project_id == "demo-project"
    assert client.credentials.region == "europe-west1"
    assert client.credentials.service_account_info == {
        "type": "service_account",
        "project_id": "demo-project",
        "client_email": "demo@demo-project.iam.gserviceaccount.com",
    }
    assert client._use_mock is False


def test_llm_client_uses_runtime_config_store_when_config_missing(monkeypatch) -> None:
    fake_runtime_config = SimpleNamespace(
        llm=SimpleNamespace(
            provider="mock",
            model="mock",
            credential_mode="none",
            credential_id=None,
        )
    )

    def _forbidden_get() -> None:
        raise AssertionError(
            "should not call RuntimeConfigStore.get"
        )

    monkeypatch.setattr(RuntimeConfigStore, "get_optional", lambda: fake_runtime_config)
    monkeypatch.setattr(RuntimeConfigStore, "get", _forbidden_get)

    client = LLMClient()

    assert client.provider == "mock"
    assert client.model == "mock"
    assert client.credential_id is None
