"""Port interfaces for the LLM application layer.

Defines abstract interfaces that infrastructure adapters must implement,
allowing the application layer to remain decoupled from concrete providers
and configuration stores.
"""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable

from src.utils.utils.credentials import CredentialSettings


@runtime_checkable
class ILLMProviderRegistry(Protocol):
    """Port interface for LLM provider resolution.

    Infrastructure adapters register concrete provider specifications
    that the application layer can resolve without direct imports.
    """

    def create_provider(
        self,
        provider: str,
        model: str,
        credentials: CredentialSettings,
    ) -> Any:
        """Instantiate a provider model with the given credentials.

        Args:
            provider: Provider name (e.g., "anthropic", "openai").
            model: Model identifier string.
            credentials: Resolved credential settings.

        Returns:
            An instantiated provider model object.

        Raises:
            RuntimeError: If the provider is not supported.
        """
        ...


@runtime_checkable
class IRuntimeConfigStore(Protocol):
    """Port interface for accessing runtime configuration.

    Decouples application services from the concrete configuration
    store implementation in the interfaces layer.
    """

    def get_optional(self) -> Any:
        """Return current runtime config if available, None otherwise."""
        ...

    async def get(self) -> Any:
        """Return current runtime config.

        Raises:
            RuntimeError: If the runtime is not yet configured.
        """
        ...

    async def update(self, config_dict: dict[str, Any]) -> None:
        """Update the runtime configuration from a dictionary."""
        ...

    @classmethod
    def clear(cls) -> None:
        """Clear the current configuration."""
        ...
