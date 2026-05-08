"""Generic runtime tool registry for communication, resources, and memory.

Refactored to use ToolDef dataclass with JSON schemas for LLM integration.
Maintains backward compatibility with legacy tool registration.
"""

from __future__ import annotations

import logging
from typing import Any, Callable

from src.app.memory.scoped_service import (
    coerce_content,
    default_tenant_id,
    get_scoped_memory_service,
)
from src.app.memory.session_store import SESSION_MEMORY_STORE
from src.app.tools.tool_def import ToolDef
from src.app.tools.yoizen import BackendClient, YoizenClient

logger = logging.getLogger(__name__)
_MEMORY_STORE = SESSION_MEMORY_STORE
COMMUNICATE_ENDPOINT = "/tools/communicate"
RESOURCE_ENDPOINT = "/tools/resource"


class ToolRegistry:
    """Registry of tools available to the runtime agent.

    Refactored to use ToolDef dataclass with JSON schemas.
    Maintains backward compatibility with legacy tool objects.
    """

    def __init__(self) -> None:
        self._backend: BackendClient | None = None
        self._tools: dict[str, ToolDef] = {}  # Changed from list to dict
        self._legacy_tools: list[Any] = []  # Backward compatibility

    @property
    def backend(self) -> BackendClient:
        """Return the backend client lazily."""

        if self._backend is None:
            self._backend = BackendClient()
        return self._backend

    @property
    def yoizen(self) -> YoizenClient:
        """Legacy alias for backend client."""

        return self.backend

    def get_tools(self) -> list[Any]:
        """Return the registered tools (legacy format for backward compatibility)."""
        # Return legacy tools first, then ToolDef tools converted to legacy format
        legacy = []

        # Add legacy tools as-is
        for legacy_tool in self._legacy_tools:
            legacy.append(legacy_tool)

        # Convert ToolDef to legacy format
        for tool_def in self._tools.values():
            legacy_tool = {
                "name": tool_def.name,
                "description": tool_def.description,
                "input_schema": tool_def.input_schema,
                "read_only": tool_def.read_only,
                "max_output_chars": tool_def.max_output_chars,
            }
            legacy.append(legacy_tool)

        return legacy

    def register_tool_def(self, tool_def: ToolDef) -> None:
        """Register a ToolDef instance."""
        self._tools[tool_def.name] = tool_def
        logger.info(f"Registered ToolDef: {tool_def.name}")

    def register_tool(self, tool: Any) -> None:
        """Register a tool descriptor (legacy method for backward compatibility)."""
        if isinstance(tool, ToolDef):
            self.register_tool_def(tool)
            return

        # Legacy registration
        if not hasattr(tool, "name"):
            raise ValueError("Tool must have a 'name' attribute")
        self._legacy_tools.append(tool)
        logger.info(f"Registered legacy tool: {tool.name}")

    def get_tool(self, name: str) -> ToolDef | None:
        """Get a ToolDef by name."""
        return self._tools.get(name)

    def get_all_schemas(self) -> list[dict[str, Any]]:
        """Return JSON schemas for all registered ToolDef tools."""
        return [tool_def.get_schema_for_llm() for tool_def in self._tools.values()]

    def execute_tool(
        self, name: str, params: dict[str, Any], config: dict[str, Any]
    ) -> Any:
        """Execute a tool by name with parameters."""
        tool_def = self.get_tool(name)
        if tool_def is None:
            # Try legacy tools
            for legacy_tool in self._legacy_tools:
                if hasattr(legacy_tool, "name") and legacy_tool.name == name:
                    # Legacy tool execution (no truncation)
                    if hasattr(legacy_tool, "__call__"):
                        return legacy_tool(params, config)
                    else:
                        raise ValueError(f"Legacy tool '{name}' is not callable")
            raise ValueError(f"Tool '{name}' not found in registry")

        return tool_def.execute(params, config)

    def clear(self) -> None:
        """Remove all registered tools."""
        self._tools.clear()
        self._legacy_tools.clear()
        logger.info("Cleared all tools from registry")

    async def inspect_memory(
        self,
        namespace: str | None = None,
        query: str = "",
        limit: int = 25,
        scope: str | None = None,
        kind: str | None = None,
        subject_id: str | None = None,
        tenant_id: str | None = None,
    ) -> dict[str, Any]:
        """Return a snapshot of runtime memory for demo and debugging."""

        normalized_scope = (scope or "").strip().lower()
        if normalized_scope in {"user", "tenant"}:
            service = get_scoped_memory_service()
            resolved_tenant_id = (tenant_id or default_tenant_id()).strip() or "default"
            resolved_subject_id = (
                resolved_tenant_id
                if normalized_scope == "tenant"
                else (subject_id or "").strip()
            )
            if normalized_scope == "user" and not resolved_subject_id:
                return {
                    "items": [],
                    "total_entries": 0,
                    "scope": normalized_scope,
                    "namespace": namespace,
                    "query": query.strip(),
                    "limit": min(max(limit, 0), 250),
                    "error": "subject_id is required for user scope inspection",
                }

            records = await service.search_persistent_memories(
                tenant_id=resolved_tenant_id,
                scope_type=normalized_scope,
                scope_id=resolved_subject_id,
                namespace=namespace.strip() if namespace else None,
                query=query,
                kind=kind,
                limit=min(max(limit, 0), 250),
                include_statuses=["published", "proposed", "rejected"],
            )
            return {
                "items": [service.serialize_record(record) for record in records],
                "total_entries": len(records),
                "scope": normalized_scope,
                "namespace": namespace,
                "query": query.strip(),
                "limit": min(max(limit, 0), 250),
            }

        normalized_namespace = namespace.strip() if namespace else None
        lowered_query = query.strip().lower()
        normalized_limit = min(max(limit, 0), 250)

        if normalized_namespace:
            namespaces_to_scan = [normalized_namespace]
        else:
            namespaces_to_scan = sorted(_MEMORY_STORE.keys())

        namespace_items: list[dict[str, Any]] = []
        total_entries = 0

        for namespace_name in namespaces_to_scan:
            namespace_store = _MEMORY_STORE.get(namespace_name, {})
            matching_entries: list[dict[str, Any]] = []

            for entry_key in sorted(namespace_store.keys()):
                entry_value = namespace_store[entry_key]
                value = entry_value.get("value")
                metadata = entry_value.get("metadata", {})
                haystack = " ".join(
                    [
                        entry_key,
                        str(value),
                        str(metadata),
                    ]
                ).lower()
                if lowered_query and lowered_query not in haystack:
                    continue

                matching_entries.append(
                    {
                        "key": entry_key,
                        "value": value,
                        "metadata": metadata,
                    }
                )

            total_entries += len(matching_entries)
            returned_entries = matching_entries[:normalized_limit]
            namespace_items.append(
                {
                    "namespace": namespace_name,
                    "entry_count": len(matching_entries),
                    "returned_entries": len(returned_entries),
                    "truncated": len(returned_entries) < len(matching_entries),
                    "entries": returned_entries,
                }
            )

        return {
            "namespaces": namespace_items,
            "total_namespaces": len(namespace_items),
            "total_entries": total_entries,
            "query": query.strip(),
            "limit": normalized_limit,
        }

    async def build_tenant_memory_context(
        self,
        tools: list[dict[str, Any]] | None,
    ) -> dict[str, Any]:
        """Return published tenant memories for memory-enabled agents."""

        service = get_scoped_memory_service()
        return await service.build_tenant_auto_read_context(
            tenant_id=default_tenant_id(),
            tools=tools,
        )

    async def communicate(
        self,
        action: str,
        target_id: str,
        message: str = "",
        channel: str = "whatsapp",
        priority: str = "medium",
        context: str = "",
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Send, reply, notify, or escalate a thread through the backend.

        Args:
            action: One of "send", "reply", "notify", "escalate"
            target_id: Recipient identifier (user ID, thread ID, etc.)
            message: Message content to send
            channel: Communication channel ("whatsapp", "email", "sms", "push")
            priority: Priority level ("low", "medium", "high", "urgent")
            context: Additional context about the communication
            metadata: Custom metadata dictionary

        Returns:
            dict with keys: success (bool), action, target_id, message, channel,
            priority, context, and additional fields from backend response.

        Raises:
            Exception: On backend communication failure (caught and returned in response)

        See: SYSTEM_TOOLS.md for detailed documentation and examples
        """

        normalized_action = action.strip().lower()
        normalized_target_id = target_id.strip()
        if not normalized_action or not normalized_target_id:
            return {
                "success": False,
                "action": normalized_action,
                "target_id": normalized_target_id,
                "error": "action and target_id are required",
            }

        payload: dict[str, Any] = {
            "action": normalized_action,
            "target_id": normalized_target_id,
            "message": message,
            "channel": channel,
            "priority": priority,
            "context": context,
        }
        if metadata is not None:
            payload["metadata"] = metadata

        try:
            data = await self.backend.post(COMMUNICATE_ENDPOINT, payload)
            result = {
                "success": data.get("success", True),
                "action": normalized_action,
                "target_id": normalized_target_id,
                "message": message,
                "channel": channel,
                "priority": priority,
                "context": context,
            }
            response_data = data.get("data")
            if isinstance(response_data, dict):
                result.update(response_data)
            return result
        except Exception as error:
            logger.exception(
                "Failed to execute communicate action '%s' for %s: %s",
                normalized_action,
                normalized_target_id,
                error,
            )
            return {
                "success": False,
                "action": normalized_action,
                "target_id": normalized_target_id,
                "message": message,
                "channel": channel,
                "priority": priority,
                "context": context,
                "error": str(error),
            }

    async def resource(
        self,
        action: str,
        resource_type: str,
        resource_id: str = "",
        filters: dict[str, Any] | None = None,
        patch: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Read or update an external resource through the backend.

        Args:
            action: One of "read", "list", "create", "update", "delete"
            resource_type: Resource type (lowercase): "user", "ticket", "order", etc.
            resource_id: Specific resource ID (required for read, update, delete)
            filters: Query filters for list action (e.g., {"status": "open"})
            patch: Fields to create or update

        Returns:
            dict with keys: success (bool), action, resource_type, resource_id,
            and response data. For "list" actions, includes "items" array.

        Raises:
            Exception: On backend communication failure (caught and returned in response)

        See: SYSTEM_TOOLS.md for detailed documentation and examples
        """

        normalized_action = action.strip().lower()
        normalized_resource_type = resource_type.strip().lower()
        normalized_resource_id = resource_id.strip()
        if not normalized_action or not normalized_resource_type:
            return {
                "success": False,
                "action": normalized_action,
                "resource_type": normalized_resource_type,
                "resource_id": normalized_resource_id,
                "error": "action and resource_type are required",
            }

        payload: dict[str, Any] = {
            "action": normalized_action,
            "resource_type": normalized_resource_type,
        }
        if normalized_resource_id:
            payload["resource_id"] = normalized_resource_id
        if filters is not None:
            payload["filters"] = filters
        if patch is not None:
            payload["patch"] = patch

        try:
            data = await self.backend.post(RESOURCE_ENDPOINT, payload)
            result: dict[str, Any] = {
                "success": data.get("success", True),
                "action": normalized_action,
                "resource_type": normalized_resource_type,
            }
            if normalized_resource_id:
                result["resource_id"] = normalized_resource_id

            response_data = data.get("data")
            if isinstance(response_data, dict):
                result.update(response_data)
            elif isinstance(response_data, list):
                result["items"] = response_data
            else:
                result["data"] = response_data

            return result
        except Exception as error:
            logger.exception(
                "Failed to execute resource action '%s' for %s/%s: %s",
                normalized_action,
                normalized_resource_type,
                normalized_resource_id,
                error,
            )
            return {
                "success": False,
                "action": normalized_action,
                "resource_type": normalized_resource_type,
                "resource_id": normalized_resource_id,
                "items": [],
                "error": str(error),
            }

    async def memory(
        self,
        action: str,
        namespace: str = "",
        key: str = "",
        value: Any = None,
        query: str = "",
        limit: int = 10,
        metadata: dict[str, Any] | None = None,
        scope: str | None = None,
        kind: str | None = None,
        subject_id: str | None = None,
        title: str | None = None,
        content: str | None = None,
        source_chat_id: str | None = None,
        source_user_id: str | None = None,
        user_id: str | None = None,
        conversation_id: str | None = None,
        session_id: str | None = None,
        chat_id: str | None = None,
        tenant_id: str | None = None,
        agent_id: str | None = None,
        created_by: str | None = None,
        memory: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Store or retrieve scoped runtime memory.

        Args:
            action: One of "put", "get", "search", "delete"
            namespace: Memory namespace (e.g., "conversation_123", "agent_state")
            key: Memory key (required for put, get, delete)
            value: Value to store (any JSON-serializable object)
            query: Search query string (case-insensitive substring match)
            limit: Maximum number of results for search (default: 10)
            metadata: Optional metadata dictionary stored with the value

        Returns:
            dict with keys: success (bool), action, namespace, and action-specific fields
            - put/get: includes key, value, metadata
            - search: includes items list with key/value/metadata
            - delete: includes key

        Raises:
            Exception: On validation failure (caught and returned in response)

        See: SYSTEM_TOOLS.md for detailed documentation and examples
        """

        normalized_action = action.strip().lower()
        normalized_namespace = namespace.strip() or "default"
        normalized_key = key.strip()
        normalized_scope = (scope or "session").strip().lower()
        normalized_tenant_id = (tenant_id or default_tenant_id()).strip() or "default"
        resolved_chat_id = (
            source_chat_id or chat_id or conversation_id or ""
        ).strip() or None
        resolved_user_id = (source_user_id or user_id or "").strip() or None
        resolved_subject_id = (subject_id or "").strip()
        policy = memory.get("policy", {}) if isinstance(memory, dict) else {}
        allow_user_write = bool(policy.get("allow_user_write", True))
        allow_tenant_proposal = bool(policy.get("allow_tenant_proposal", True))
        if not resolved_subject_id:
            if normalized_scope == "user":
                resolved_subject_id = resolved_user_id or ""
            elif normalized_scope == "session":
                resolved_subject_id = (
                    session_id or conversation_id or resolved_chat_id or ""
                ).strip()
            else:
                resolved_subject_id = normalized_tenant_id

        if not normalized_action:
            return {
                "success": False,
                "action": normalized_action,
                "namespace": normalized_namespace,
                "key": normalized_key,
                "scope": normalized_scope,
                "error": "action is required",
            }

        if normalized_scope not in {"session", "user", "tenant"}:
            return {
                "success": False,
                "action": normalized_action,
                "namespace": normalized_namespace,
                "key": normalized_key,
                "scope": normalized_scope,
                "error": f"Unsupported memory scope: {normalized_scope}",
            }

        if normalized_scope in {"user", "tenant"} and not resolved_subject_id:
            return {
                "success": False,
                "action": normalized_action,
                "namespace": normalized_namespace,
                "key": normalized_key,
                "scope": normalized_scope,
                "error": f"Unable to resolve subject_id for {normalized_scope} scope",
            }

        service = get_scoped_memory_service()

        if normalized_scope == "session":
            if normalized_action == "put":
                entry = await service.put_session_memory(
                    namespace=normalized_namespace,
                    key=normalized_key,
                    value=value,
                    metadata=metadata or {},
                )
                return {
                    "success": True,
                    "action": normalized_action,
                    "namespace": normalized_namespace,
                    "scope": normalized_scope,
                    **entry,
                }

            if normalized_action == "get":
                entry = await service.get_session_memory(
                    namespace=normalized_namespace,
                    key=normalized_key,
                )
                if entry is None:
                    return {
                        "success": False,
                        "action": normalized_action,
                        "namespace": normalized_namespace,
                        "key": normalized_key,
                        "scope": normalized_scope,
                        "value": None,
                    }
                return {
                    "success": True,
                    "action": normalized_action,
                    "namespace": normalized_namespace,
                    "scope": normalized_scope,
                    **entry,
                }

            if normalized_action == "search":
                items = await service.search_session_memory(
                    namespace=normalized_namespace,
                    query=query,
                    limit=limit,
                )
                return {
                    "success": True,
                    "action": normalized_action,
                    "namespace": normalized_namespace,
                    "scope": normalized_scope,
                    "items": items,
                }

            if normalized_action == "delete":
                deleted = await service.delete_session_memory(
                    namespace=normalized_namespace,
                    key=normalized_key,
                )
                return {
                    "success": deleted,
                    "action": normalized_action,
                    "namespace": normalized_namespace,
                    "key": normalized_key,
                    "scope": normalized_scope,
                }

            return {
                "success": False,
                "action": normalized_action,
                "namespace": normalized_namespace,
                "key": normalized_key,
                "scope": normalized_scope,
                "error": f"Unsupported memory action for session scope: {normalized_action}",
            }

        if normalized_scope == "tenant" and normalized_action == "put":
            normalized_action = "propose"

        if normalized_scope == "user" and normalized_action in {"put", "delete"}:
            if not allow_user_write:
                return {
                    "success": False,
                    "action": normalized_action,
                    "namespace": normalized_namespace,
                    "key": normalized_key,
                    "scope": normalized_scope,
                    "error": "User-scoped memory writes are disabled by memory policy",
                }

        if normalized_scope == "tenant" and normalized_action == "propose":
            if not allow_tenant_proposal:
                return {
                    "success": False,
                    "action": normalized_action,
                    "namespace": normalized_namespace,
                    "key": normalized_key,
                    "scope": normalized_scope,
                    "error": "Tenant-scoped memory proposals are disabled by memory policy",
                }

        if normalized_action in {"put", "propose"}:
            status = "published"
            if normalized_action == "propose":
                if normalized_scope != "tenant":
                    return {
                        "success": False,
                        "action": normalized_action,
                        "namespace": normalized_namespace,
                        "key": normalized_key,
                        "scope": normalized_scope,
                        "error": "propose is only supported for tenant scope",
                    }
                status = "proposed"

            record = await service.put_persistent_memory(
                tenant_id=normalized_tenant_id,
                scope_type=normalized_scope,
                scope_id=resolved_subject_id,
                namespace=normalized_namespace,
                memory_key=normalized_key,
                title=(title or normalized_key or kind or normalized_namespace).strip(),
                content=(content or coerce_content(value)).strip(),
                payload=value,
                metadata=metadata or {},
                kind=(kind or "general").strip() or "general",
                agent_id=agent_id,
                source_chat_id=resolved_chat_id,
                source_user_id=resolved_user_id,
                created_by=created_by,
                status=status,
            )
            return {
                "success": True,
                "action": normalized_action,
                "namespace": normalized_namespace,
                "key": normalized_key,
                "scope": normalized_scope,
                "subject_id": resolved_subject_id,
                "record": service.serialize_record(record),
                "value": record.payload,
                "metadata": record.metadata,
            }

        if normalized_action == "get":
            record = await service.get_persistent_memory(
                tenant_id=normalized_tenant_id,
                scope_type=normalized_scope,
                scope_id=resolved_subject_id,
                namespace=normalized_namespace,
                memory_key=normalized_key,
                include_statuses=["published"],
            )
            if record is None:
                return {
                    "success": False,
                    "action": normalized_action,
                    "namespace": normalized_namespace,
                    "key": normalized_key,
                    "scope": normalized_scope,
                    "value": None,
                }
            return {
                "success": True,
                "action": normalized_action,
                "namespace": normalized_namespace,
                "key": record.memory_key,
                "scope": normalized_scope,
                "value": record.payload,
                "metadata": record.metadata,
                "record": service.serialize_record(record),
            }

        if normalized_action == "search":
            records = await service.search_persistent_memories(
                tenant_id=normalized_tenant_id,
                scope_type=normalized_scope,
                scope_id=resolved_subject_id,
                namespace=normalized_namespace if normalized_namespace else None,
                query=query,
                kind=kind,
                limit=limit,
                include_statuses=["published"],
            )
            return {
                "success": True,
                "action": normalized_action,
                "namespace": normalized_namespace,
                "scope": normalized_scope,
                "items": [
                    {
                        "key": record.memory_key,
                        "value": record.payload,
                        "metadata": record.metadata,
                        "kind": record.kind,
                        "title": record.title,
                        "content": record.content,
                        "status": record.status,
                        "id": record.id,
                    }
                    for record in records
                ],
            }

        if normalized_action == "delete":
            deleted = await service.delete_persistent_memory(
                tenant_id=normalized_tenant_id,
                scope_type=normalized_scope,
                scope_id=resolved_subject_id,
                namespace=normalized_namespace,
                memory_key=normalized_key,
            )
            return {
                "success": deleted,
                "action": normalized_action,
                "namespace": normalized_namespace,
                "key": normalized_key,
                "scope": normalized_scope,
            }

        return {
            "success": False,
            "action": normalized_action,
            "namespace": normalized_namespace,
            "key": normalized_key,
            "items": [],
            "error": f"Unsupported memory action: {normalized_action}",
        }


def _create_registry() -> ToolRegistry:
    """Factory function for ToolRegistry singleton."""
    return ToolRegistry()


def get_tools() -> list[Any]:
    """Return the globally registered tools via Container."""
    from src.utils.di import get_container

    return get_container().get_or_create("tool_registry", _create_registry).get_tools()


def register_tool(tool: Any) -> None:
    """Register a global tool descriptor via Container."""
    from src.utils.di import get_container

    get_container().get_or_create("tool_registry", _create_registry).register_tool(tool)


def get_registry() -> ToolRegistry:
    """Get the ToolRegistry instance (for testing)."""
    from src.utils.di import get_container

    registry = get_container().get_or_create("tool_registry", _create_registry)

    # Auto-register built-in tools if not already registered
    if not registry.get_tool("communicate"):
        from src.app.tools.builtin_tools import register_builtin_tools

        register_builtin_tools(registry)

    return registry
