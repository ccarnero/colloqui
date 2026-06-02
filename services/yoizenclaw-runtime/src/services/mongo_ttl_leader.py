"""MongoDB TTL leader election for the runtime scheduler."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo import ReturnDocument

logger = logging.getLogger(__name__)

LEADER_DOC_ID = "scheduler"
LEASE_SECONDS = 30
HEARTBEAT_INTERVAL_SECONDS = 10


class MongoTtlLeader:
    """Holds a MongoDB leader-election lease for the scheduler lifecycle."""

    def __init__(
        self,
        db: AsyncIOMotorDatabase,
        instance_id: str | None = None,
    ) -> None:
        self._db = db
        self._collection = db["_leader_election"]
        self._instance_id = instance_id or str(uuid4())
        self._is_leader = False
        self._heartbeat_task: asyncio.Task[Any] | None = None

    async def acquire(self) -> bool:
        """Try to acquire the scheduler leader lease."""

        if self._is_leader:
            return True

        if not await self._try_claim():
            logger.info("Scheduler leader lock not acquired; running as follower")
            return False

        self._is_leader = True
        self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())
        logger.info("Scheduler leader lock acquired")
        return True

    async def release(self) -> None:
        """Release the scheduler leader lease if held."""

        self._is_leader = False
        if self._heartbeat_task is not None:
            self._heartbeat_task.cancel()
            try:
                await self._heartbeat_task
            except asyncio.CancelledError:
                pass
            self._heartbeat_task = None

        await self._collection.delete_one(
            {
                "_id": LEADER_DOC_ID,
                "instance": self._instance_id,
            },
        )
        logger.info("Scheduler leader lock released")

    async def _heartbeat_loop(self) -> None:
        while self._is_leader:
            await asyncio.sleep(HEARTBEAT_INTERVAL_SECONDS)
            if not self._is_leader:
                return
            if not await self._renew():
                self._is_leader = False
                logger.warning("Scheduler leader lease lost during heartbeat")
                return

    async def _try_claim(self) -> bool:
        now = datetime.now(timezone.utc)
        expires_at = now + timedelta(seconds=LEASE_SECONDS)
        result = await self._collection.find_one_and_update(
            {
                "_id": LEADER_DOC_ID,
                "$or": [
                    {"instance": self._instance_id},
                    {"expiresAt": {"$lt": now}},
                    {"expiresAt": {"$exists": False}},
                ],
            },
            {
                "$set": {
                    "instance": self._instance_id,
                    "expiresAt": expires_at,
                },
            },
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
        return result is not None and result.get("instance") == self._instance_id

    async def _renew(self) -> bool:
        now = datetime.now(timezone.utc)
        expires_at = now + timedelta(seconds=LEASE_SECONDS)
        result = await self._collection.find_one_and_update(
            {
                "_id": LEADER_DOC_ID,
                "instance": self._instance_id,
            },
            {"$set": {"expiresAt": expires_at}},
            return_document=ReturnDocument.AFTER,
        )
        return result is not None
