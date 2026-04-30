from __future__ import annotations

from pathlib import Path

import pytest

from src.shared.config.config_files import ConfigFileStore, ConfigFileSyncError


def test_config_file_store_writes_synced_seed_files(tmp_path: Path) -> None:
    store = ConfigFileStore(str(tmp_path / "config"))

    written_paths = store.write_files(
        [
            {"path": "skills/default.yaml", "content": 'name: "default"\n'},
            {
                "path": "prompts/system/recovery_agent.txt",
                "content": "You are a recovery agent.",
            },
        ]
    )

    assert written_paths == [
        "skills/default.yaml",
        "prompts/system/recovery_agent.txt",
    ]
    assert (tmp_path / "config" / "skills" / "default.yaml").read_text(
        encoding="utf-8"
    ) == 'name: "default"\n'


def test_config_file_store_accepts_runtime_secret_env_files(tmp_path: Path) -> None:
    store = ConfigFileStore(str(tmp_path / "config"))

    written_paths = store.write_files(
        [
            {
                "path": "runtime-secrets/credentials.env",
                "content": "LLM_CREDENTIAL_OPENAI_PROD_API_KEY=secret\n",
            }
        ]
    )

    assert written_paths == ["runtime-secrets/credentials.env"]
    assert (tmp_path / "config" / "runtime-secrets" / "credentials.env").read_text(
        encoding="utf-8"
    ) == "LLM_CREDENTIAL_OPENAI_PROD_API_KEY=secret\n"


def test_config_file_store_rejects_path_traversal(tmp_path: Path) -> None:
    store = ConfigFileStore(str(tmp_path / "config"))

    with pytest.raises(ConfigFileSyncError):
        store.write_files(
            [{"path": "../secrets.txt", "content": "should fail"}]
        )


def test_config_file_store_syncs_deletions(tmp_path: Path) -> None:
    store = ConfigFileStore(str(tmp_path / "config"))
    target_path = tmp_path / "config" / "agents" / "runtime" / "agent-001.yaml"
    target_path.parent.mkdir(parents=True, exist_ok=True)
    target_path.write_text('name: "agent"\n', encoding="utf-8")

    written_paths, deleted_paths = store.sync_files(
        delete_paths=["agents/runtime/agent-001.yaml"]
    )

    assert written_paths == []
    assert deleted_paths == ["agents/runtime/agent-001.yaml"]
    assert not target_path.exists()


def test_config_file_store_requires_changes(tmp_path: Path) -> None:
    store = ConfigFileStore(str(tmp_path / "config"))

    with pytest.raises(ConfigFileSyncError):
        store.sync_files()