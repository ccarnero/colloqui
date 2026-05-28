"""PostgreSQL advisory-lock leader election for the runtime scheduler."""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

SCHEDULER_LOCK_KEY = 4_242_001


class PostgresAdvisoryLeader:
    """Holds a PostgreSQL advisory lock for the scheduler lifecycle."""

    def __init__(self, pool: Any, lock_key: int = SCHEDULER_LOCK_KEY) -> None:
        self._connection = None
        self._lock_key = lock_key
        self._pool = pool

    async def acquire(self) -> bool:
        """Try to acquire the scheduler leader lock."""

        if self._connection is not None:
            return True

        connection = await self._pool.acquire()
        acquired = await connection.fetchval(
            "SELECT pg_try_advisory_lock($1)",
            self._lock_key,
        )
        if acquired:
            self._connection = connection
            logger.info("Scheduler leader lock acquired")
            return True

        await self._pool.release(connection)
        logger.info("Scheduler leader lock not acquired; running as follower")
        return False

    async def release(self) -> None:
        """Release the scheduler leader lock if held."""

        if self._connection is None:
            return

        try:
            await self._connection.execute(
                "SELECT pg_advisory_unlock($1)",
                self._lock_key,
            )
            logger.info("Scheduler leader lock released")
        finally:
            await self._pool.release(self._connection)
            self._connection = None
