from __future__ import annotations

from pathlib import Path

import pytest

from src.shared.config.runtime_paths import get_runtime_config_dir


def test_runtime_config_dir_prefers_neutral_env(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    neutral_dir = tmp_path / "neutral-runtime"
    legacy_dir = tmp_path / "legacy-runtime"
    monkeypatch.setenv("RUNTIME_CONFIG_DIR", str(neutral_dir))
    monkeypatch.setenv("YOIZEN_RUNTIME_CONFIG_DIR", str(legacy_dir))

    assert get_runtime_config_dir() == neutral_dir.resolve()


def test_runtime_config_dir_falls_back_to_legacy_env(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    legacy_dir = tmp_path / "legacy-runtime"
    monkeypatch.delenv("RUNTIME_CONFIG_DIR", raising=False)
    monkeypatch.setenv("YOIZEN_RUNTIME_CONFIG_DIR", str(legacy_dir))

    assert get_runtime_config_dir() == legacy_dir.resolve()
