"""Runtime state and vector operations for MongoDB backend."""

from __future__ import annotations

import math
from typing import Optional

from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo import ReturnDocument


def _cosine_similarity(left: list[float], right: list[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0

    dot_product = 0.0
    left_norm = 0.0
    right_norm = 0.0
    for left_value, right_value in zip(left, right, strict=True):
        dot_product += left_value * right_value
        left_norm += left_value * left_value
        right_norm += right_value * right_value

    if left_norm == 0.0 or right_norm == 0.0:
        return 0.0

    return dot_product / (math.sqrt(left_norm) * math.sqrt(right_norm))


async def _next_sequence(db: AsyncIOMotorDatabase, name: str) -> int:
    counter = await db.counters.find_one_and_update(
        {"_id": name},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    return int(counter["seq"])


async def save_embedding(
    db: AsyncIOMotorDatabase,
    tenant_id: str,
    content: str,
    embedding: list[float],
    metadata: Optional[dict] = None,
) -> int:
    """Save an embedding vector to MongoDB."""

    embedding_id = await _next_sequence(db, "embeddings")
    await db.embeddings.insert_one(
        {
            "id": embedding_id,
            "tenant_id": tenant_id,
            "content": content,
            "embedding": embedding,
            "metadata": metadata if metadata is not None else None,
        },
    )
    return embedding_id


async def search_similar_embeddings(
    db: AsyncIOMotorDatabase,
    tenant_id: str,
    query_embedding: list[float],
    limit: int = 10,
    similarity_threshold: float = 0.7,
) -> list[dict]:
    """Search embeddings via brute-force cosine similarity (dev fallback)."""

    matches: list[dict] = []
    cursor = db.embeddings.find(
        {
            "tenant_id": tenant_id,
            "embedding": {"$type": "array"},
        },
    )

    async for document in cursor:
        stored_embedding = document.get("embedding")
        if not isinstance(stored_embedding, list):
            continue

        similarity = _cosine_similarity(query_embedding, stored_embedding)
        if similarity <= similarity_threshold:
            continue

        matches.append(
            {
                "id": document.get("id"),
                "content": document.get("content"),
                "metadata": document.get("metadata"),
                "similarity": similarity,
            },
        )

    matches.sort(key=lambda item: item["similarity"], reverse=True)
    return matches[:limit]
