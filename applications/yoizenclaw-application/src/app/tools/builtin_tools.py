"""Built-in tools migrated to ToolDef format.

Migrates the existing communicate, resource, and memory tools
from the registry methods to proper ToolDef instances with JSON schemas.
"""

from __future__ import annotations

from typing import Any

from src.app.tools.tool_def import ToolDef
from src.app.tools.registry import ToolRegistry


def create_communicate_tool() -> ToolDef:
    """Create ToolDef for the communicate functionality."""

    async def communicate_func(params: dict[str, Any], config: dict[str, Any]) -> Any:
        """Execute communicate action via registry."""
        registry = ToolRegistry()
        return await registry.communicate(
            action=params.get("action", ""),
            target_id=params.get("target_id", ""),
            message=params.get("message", ""),
            channel=params.get("channel", "whatsapp"),
            priority=params.get("priority", "medium"),
            context=params.get("context", ""),
            metadata=params.get("metadata"),
        )

    return ToolDef(
        name="communicate",
        description="Send, reply, notify, or escalate messages through communication channels",
        input_schema={
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["send", "reply", "notify", "escalate"],
                    "description": "Action to perform",
                },
                "target_id": {
                    "type": "string",
                    "description": "Recipient identifier (user ID, thread ID, etc.)",
                },
                "message": {"type": "string", "description": "Message content to send"},
                "channel": {
                    "type": "string",
                    "enum": ["whatsapp", "email", "sms", "push"],
                    "default": "whatsapp",
                    "description": "Communication channel",
                },
                "priority": {
                    "type": "string",
                    "enum": ["low", "medium", "high", "urgent"],
                    "default": "medium",
                    "description": "Priority level",
                },
                "context": {
                    "type": "string",
                    "description": "Additional context about the communication",
                },
                "metadata": {
                    "type": "object",
                    "description": "Custom metadata dictionary",
                },
            },
            "required": ["action", "target_id"],
        },
        func=communicate_func,
        read_only=False,
        max_output_chars=16_384,  # Smaller limit for communication responses
    )


def create_resource_tool() -> ToolDef:
    """Create ToolDef for the resource functionality."""

    async def resource_func(params: dict[str, Any], config: dict[str, Any]) -> Any:
        """Execute resource action via registry."""
        registry = ToolRegistry()
        return await registry.resource(
            action=params.get("action", ""),
            resource_type=params.get("resource_type", ""),
            resource_id=params.get("resource_id", ""),
            filters=params.get("filters"),
            patch=params.get("patch"),
        )

    return ToolDef(
        name="resource",
        description="Read or update external resources (users, tickets, orders, etc.)",
        input_schema={
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["read", "list", "create", "update", "delete"],
                    "description": "Action to perform",
                },
                "resource_type": {
                    "type": "string",
                    "description": "Resource type (e.g., 'user', 'ticket', 'order')",
                },
                "resource_id": {
                    "type": "string",
                    "description": "Specific resource ID (required for read, update, delete)",
                },
                "filters": {
                    "type": "object",
                    "description": "Query filters for list action",
                },
                "patch": {
                    "type": "object",
                    "description": "Fields to create or update",
                },
            },
            "required": ["action", "resource_type"],
        },
        func=resource_func,
        read_only=False,
        max_output_chars=32_768,  # Larger limit for resource data
    )


def create_memory_tool() -> ToolDef:
    """Create ToolDef for the memory functionality."""

    async def memory_func(params: dict[str, Any], config: dict[str, Any]) -> Any:
        """Execute memory action via registry."""
        registry = ToolRegistry()
        return await registry.memory(
            action=params.get("action", ""),
            namespace=params.get("namespace", ""),
            key=params.get("key", ""),
            value=params.get("value"),
            query=params.get("query", ""),
            limit=params.get("limit", 10),
            metadata=params.get("metadata"),
            scope=params.get("scope"),
            kind=params.get("kind"),
            subject_id=params.get("subject_id", params.get("subjectId")),
            title=params.get("title"),
            content=params.get("content"),
            source_chat_id=params.get(
                "source_chat_id",
                params.get("sourceChatId"),
            ),
        )

    return ToolDef(
        name="memory",
        description="Store or retrieve scoped runtime memory",
        input_schema={
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["put", "get", "search", "delete", "propose"],
                    "description": "Action to perform",
                },
                "scope": {
                    "type": "string",
                    "enum": ["session", "user", "tenant"],
                    "description": "Scoped memory target",
                },
                "namespace": {
                    "type": "string",
                    "description": "Memory namespace (e.g., 'conversation_123', 'agent_state')",
                },
                "key": {
                    "type": "string",
                    "description": "Memory key (required for put, get, delete)",
                },
                "value": {
                    "description": "Value to store (any JSON-serializable object)"
                },
                "query": {
                    "type": "string",
                    "description": "Search query string (case-insensitive substring match)",
                },
                "limit": {
                    "type": "integer",
                    "default": 10,
                    "description": "Maximum number of results for search",
                },
                "metadata": {
                    "type": "object",
                    "description": "Optional metadata dictionary stored with the value",
                },
                "kind": {
                    "type": "string",
                    "description": "Domain kind for scoped memories (e.g. promo, incident, notice)",
                },
                "subject_id": {
                    "type": "string",
                    "description": "Explicit subject identifier for user/session scope resolution",
                },
                "title": {
                    "type": "string",
                    "description": "Human-readable memory title",
                },
                "content": {
                    "type": "string",
                    "description": "Compact textual summary of the memory entry",
                },
                "source_chat_id": {
                    "type": "string",
                    "description": "Tracing chat identifier for provenance",
                },
            },
            "required": ["action"],
        },
        func=memory_func,
        read_only=False,
        max_output_chars=16_384,
    )


def register_builtin_tools(registry: ToolRegistry) -> None:
    """Register all built-in tools as ToolDef instances."""
    tools = [
        create_communicate_tool(),
        create_resource_tool(),
        create_memory_tool(),
    ]

    for tool in tools:
        registry.register_tool_def(tool)
