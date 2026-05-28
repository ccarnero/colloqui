"""Database bootstrap helpers for postgres (alembic) and mongo (indexes)."""

from __future__ import annotations

import logging
from pathlib import Path

from alembic import command
from alembic.config import Config

logger = logging.getLogger(__name__)

_SERVICE_ROOT = Path(__file__).resolve().parents[3]


def run_alembic_upgrade(revision: str = "head") -> None:
    """Apply pending Alembic migrations for the postgres engine.

    Sync-only: call from a worker thread (e.g. ``asyncio.to_thread``) when the
    FastAPI/Uvicorn event loop is already running.
    """

    alembic_ini = _SERVICE_ROOT / "alembic.ini"
    if not alembic_ini.is_file():
        raise FileNotFoundError(f"Alembic config not found: {alembic_ini}")

    cfg = Config(str(alembic_ini))
    logger.info("Running alembic upgrade %s", revision)
    command.upgrade(cfg, revision)
    logger.info("Alembic upgrade complete")
