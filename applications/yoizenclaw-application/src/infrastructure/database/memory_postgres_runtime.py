"""Runtime state and vector operations for PostgreSQL backend.

Provides vector storage and search operations for embeddings.
"""

from typing import Optional

import asyncpg


async def save_embedding(
    pool: asyncpg.Pool,
    tenant_id: str,
    content: str,
    embedding: list[float],
    metadata: Optional[dict] = None,
) -> int:
    """Save an embedding vector to the database.

    Args:
        pool: PostgreSQL connection pool.
        tenant_id: Tenant identifier for row-level isolation.
        content: The content being embedded.
        embedding: The vector embedding.
        metadata: Optional metadata dictionary.

    Returns:
        The row ID of the inserted record.
    """
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO embeddings
            (tenant_id, content, embedding, metadata, created_at)
            VALUES ($1, $2, $3, $4, NOW())
            RETURNING id
            """,
            tenant_id,
            content,
            embedding,
            metadata if metadata is not None else None,
        )
        return row["id"]


async def search_similar_embeddings(
    pool: asyncpg.Pool,
    tenant_id: str,
    query_embedding: list[float],
    limit: int = 10,
    similarity_threshold: float = 0.7,
) -> list[dict]:
    """Search for similar embeddings using vector similarity.

    Args:
        pool: PostgreSQL connection pool.
        tenant_id: Tenant identifier for row-level isolation.
        query_embedding: The query vector.
        limit: Maximum number of results to return.
        similarity_threshold: Minimum cosine similarity.

    Returns:
        List of similar embeddings with metadata.
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, content, metadata, 1 - (embedding <=> $1) as similarity
            FROM embeddings
            WHERE tenant_id = $2 AND 1 - (embedding <=> $1) > $3
            ORDER BY similarity DESC
            LIMIT $4
            """,
            query_embedding, tenant_id, similarity_threshold, limit,
        )

    return [
        {
            "id": row["id"],
            "content": row["content"],
            "metadata": row["metadata"],
            "similarity": row["similarity"],
        }
        for row in rows
    ]
