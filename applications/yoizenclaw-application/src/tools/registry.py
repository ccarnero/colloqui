"""Generic runtime tool registry for communication, resources, and memory."""

from __future__ import annotations

import logging
from typing import Any

from src.tools.yoizen import BackendClient, YoizenClient

logger = logging.getLogger(__name__)
_MEMORY_STORE: dict[str, dict[str, dict[str, Any]]] = {}
COMMUNICATE_ENDPOINT = "/tools/communicate"
RESOURCE_ENDPOINT = "/tools/resource"


class ToolRegistry:
    """Registry of tools available to the runtime agent."""

    def __init__(self) -> None:
        self._backend: BackendClient | None = None
        self._tools: list[Any] = []

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
        """Return the registered tools."""

        return list(self._tools)

    def register_tool(self, tool: Any) -> None:
        """Register a tool descriptor."""

        if not hasattr(tool, "name"):
            raise ValueError("Tool must have a 'name' attribute")
        self._tools.append(tool)

    def clear(self) -> None:
        """Remove all registered tools."""

        self._tools.clear()

    def inspect_memory(
        self,
        namespace: str | None = None,
        query: str = "",
        limit: int = 25,
    ) -> dict[str, Any]:
        """Return a snapshot of runtime-local memory for demo and debugging."""

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
        namespace: str,
        key: str = "",
        value: Any = None,
        query: str = "",
        limit: int = 10,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Store or retrieve runtime-local memory organized by namespace.

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
        normalized_namespace = namespace.strip()
        normalized_key = key.strip()
        if not normalized_action or not normalized_namespace:
            return {
                "success": False,
                "action": normalized_action,
                "namespace": normalized_namespace,
                "key": normalized_key,
                "error": "action and namespace are required",
            }

        namespace_store = _MEMORY_STORE.setdefault(normalized_namespace, {})

        if normalized_action == "put":
            entry = {
                "key": normalized_key,
                "value": value,
                "metadata": metadata or {},
            }
            namespace_store[normalized_key] = entry
            return {
                "success": True,
                "action": normalized_action,
                "namespace": normalized_namespace,
                **entry,
            }

        if normalized_action == "get":
            entry = namespace_store.get(normalized_key)
            if entry is None:
                return {
                    "success": False,
                    "action": normalized_action,
                    "namespace": normalized_namespace,
                    "key": normalized_key,
                    "value": None,
                }
            return {
                "success": True,
                "action": normalized_action,
                "namespace": normalized_namespace,
                **entry,
            }

        if normalized_action == "search":
            lowered_query = query.strip().lower()
            items = [
                {
                    "key": entry_key,
                    "value": entry_value.get("value"),
                    "metadata": entry_value.get("metadata", {}),
                }
                for entry_key, entry_value in namespace_store.items()
                if not lowered_query
                or lowered_query in str(entry_value.get("value", "")).lower()
            ][: max(limit, 0)]
            return {
                "success": True,
                "action": normalized_action,
                "namespace": normalized_namespace,
                "items": items,
            }

        if normalized_action == "delete":
            deleted = normalized_key in namespace_store
            namespace_store.pop(normalized_key, None)
            return {
                "success": deleted,
                "action": normalized_action,
                "namespace": normalized_namespace,
                "key": normalized_key,
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
    from src.shared.di import get_container

    return get_container().get_or_create("tool_registry", _create_registry).get_tools()


def register_tool(tool: Any) -> None:
    """Register a global tool descriptor via Container."""
    from src.shared.di import get_container

    get_container().get_or_create("tool_registry", _create_registry).register_tool(tool)


def get_registry() -> ToolRegistry:
    """Get the ToolRegistry instance (for testing)."""
    from src.shared.di import get_container

    return get_container().get_or_create("tool_registry", _create_registry)
