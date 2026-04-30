"""Chat request models for NATS messaging."""

from __future__ import annotations

from pydantic import BaseModel, Field, validator
from typing import Optional
from datetime import datetime


class ChatRequest(BaseModel):
    """Chat request for NATS - only essential fields."""

    chat_id: str = Field(..., description="Unique identifier for this chat interaction")
    agent_id: str = Field(..., description="ID of the published agent to use")
    message: str = Field(..., description="User message content")
    turn_number: int = Field(
        ..., description="Sequential turn number in conversation", ge=1
    )
    session_id: str = Field(
        ..., description="Session identifier for conversation memory"
    )
    user_id: str | None = Field(
        default=None,
        description="Stable user identifier for scoped memory",
        alias="userId",
    )
    timestamp: datetime = Field(..., description="Message timestamp")

    @validator("timestamp", pre=True)
    @classmethod
    def parse_timestamp(cls, v):
        """Accept both datetime objects and ISO format strings."""
        if isinstance(v, datetime):
            return v
        if isinstance(v, str):
            return datetime.fromisoformat(v.replace("Z", "+00:00"))
        return v


class ChatResponse(BaseModel):
    """Chat response for NATS."""

    chat_id: str = Field(..., description="Corresponding chat request ID")
    agent_id: str = Field(..., description="Agent that generated the response")
    response: str = Field(..., description="Generated response content")
    turn_number: int = Field(..., description="Turn number this response belongs to")
    session_id: str = Field(..., description="Session identifier")
    user_id: str | None = Field(
        default=None,
        description="Stable user identifier used during execution",
        alias="userId",
    )
    timestamp: datetime = Field(..., description="Response timestamp")
    metadata: Optional[dict] = Field(
        None, description="Optional metadata like model, provider"
    )
