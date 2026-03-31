"""LLM provider registry for dynamic provider instantiation.

Eliminates repetitive if/elif chains by using a registry pattern
for provider model and provider classes.
"""

from __future__ import annotations

import importlib
from typing import Any, Callable, TypeVar
from dataclasses import dataclass

from src.shared.utils.credentials import CredentialSettings

T = TypeVar("T")


@dataclass(frozen=True)
class ProviderSpec:
    """Specification for an LLM provider.
    
    Contains the model class, provider class, and credential keys needed.
    """
    model_module: str
    model_class: str
    provider_module: str
    provider_class: str
    credential_keys: tuple[str, ...]
    optional_params: tuple[str, ...] = ()


class ProviderRegistry:
    """Registry for LLM provider specifications.
    
    Centralizes provider configuration to eliminate repetitive if/elif chains.
    """
    
    _providers: dict[str, ProviderSpec] = {
        "anthropic": ProviderSpec(
            model_module="pydantic_ai.models.anthropic",
            model_class="AnthropicModel",
            provider_module="pydantic_ai.providers.anthropic",
            provider_class="AnthropicProvider",
            credential_keys=("api_key", "base_url"),
        ),
        "bedrock": ProviderSpec(
            model_module="pydantic_ai.models.bedrock",
            model_class="BedrockConverseModel",
            provider_module="pydantic_ai.providers.bedrock",
            provider_class="BedrockProvider",
            credential_keys=(
                "api_key",
                "aws_access_key_id",
                "aws_secret_access_key",
                "aws_session_token",
                "aws_profile_name",
                "region",
                "base_url",
            ),
        ),
        "cerebras": ProviderSpec(
            model_module="pydantic_ai.models.cerebras",
            model_class="CerebrasModel",
            provider_module="pydantic_ai.providers.cerebras",
            provider_class="CerebrasProvider",
            credential_keys=("api_key",),
        ),
        "cohere": ProviderSpec(
            model_module="pydantic_ai.models.cohere",
            model_class="CohereModel",
            provider_module="pydantic_ai.providers.cohere",
            provider_class="CohereProvider",
            credential_keys=("api_key",),
        ),
        "google": ProviderSpec(
            model_module="pydantic_ai.models.google",
            model_class="GoogleModel",
            provider_module="pydantic_ai.providers.google_gla",
            provider_class="GoogleGLAProvider",
            credential_keys=("api_key",),
        ),
        "google-vertex": ProviderSpec(
            model_module="pydantic_ai.models.google",
            model_class="GoogleModel",
            provider_module="pydantic_ai.providers.google_vertex",
            provider_class="GoogleVertexProvider",
            credential_keys=(
                "project_id",
                "region",
                "service_account_file",
                "service_account_info",
            ),
            optional_params=("region",),  # Has default "us-central1"
        ),
        "groq": ProviderSpec(
            model_module="pydantic_ai.models.groq",
            model_class="GroqModel",
            provider_module="pydantic_ai.providers.groq",
            provider_class="GroqProvider",
            credential_keys=("api_key", "base_url"),
        ),
        "huggingface": ProviderSpec(
            model_module="pydantic_ai.models.huggingface",
            model_class="HuggingFaceModel",
            provider_module="pydantic_ai.providers.huggingface",
            provider_class="HuggingFaceProvider",
            credential_keys=("api_key", "base_url", "provider_name"),
            optional_params=("base_url", "provider_name"),  # Mutually exclusive
        ),
        "mistral": ProviderSpec(
            model_module="pydantic_ai.models.mistral",
            model_class="MistralModel",
            provider_module="pydantic_ai.providers.mistral",
            provider_class="MistralProvider",
            credential_keys=("api_key", "base_url"),
        ),
        "openai": ProviderSpec(
            model_module="pydantic_ai.models.openai",
            model_class="OpenAIModel",
            provider_module="pydantic_ai.providers.openai",
            provider_class="OpenAIProvider",
            credential_keys=("api_key", "base_url"),
        ),
        "openrouter": ProviderSpec(
            model_module="pydantic_ai.models.openrouter",
            model_class="OpenRouterModel",
            provider_module="pydantic_ai.models.openrouter",
            provider_class="OpenRouterProvider",
            credential_keys=("api_key", "app_title", "app_url"),
        ),
        "xai": ProviderSpec(
            model_module="pydantic_ai.models.xai",
            model_class="XaiModel",
            provider_module="pydantic_ai.providers.xai",
            provider_class="XaiProvider",
            credential_keys=("api_key",),
        ),
    }
    
    @classmethod
    def get_spec(cls, provider: str) -> ProviderSpec | None:
        """Get provider specification by name.
        
        Args:
            provider: Provider name (e.g., "anthropic", "openai")
            
        Returns:
            ProviderSpec if found, None otherwise.
        """
        return cls._providers.get(provider.lower())
    
    @classmethod
    def create_provider(
        cls,
        provider: str,
        model: str,
        credentials: CredentialSettings,
    ) -> Any:
        """Instantiate a provider model with credentials.
        
        Args:
            provider: Provider name
            model: Model identifier
            credentials: Resolved credential settings
            
        Returns:
            Instantiated provider model
            
        Raises:
            RuntimeError: If provider not supported or instantiation fails.
        """
        spec = cls.get_spec(provider)
        if spec is None:
            raise RuntimeError(f"Unsupported LLM provider: {provider}")
        
        # Dynamically import classes
        ModelClass = cls._import_class(spec.model_module, spec.model_class)
        ProviderClass = cls._import_class(spec.provider_module, spec.provider_class)
        
        # Build provider kwargs from credentials
        provider_kwargs: dict[str, Any] = {}
        for key in spec.credential_keys:
            value = getattr(credentials, key)
            if value is not None and value != "":
                # Map internal field names to provider parameter names
                param_name = cls._map_param_name(key)
                provider_kwargs[param_name] = value
        
        # Special handling for specific providers
        if provider == "huggingface":
            # HuggingFace uses either base_url or provider_name, not both
            if credentials.base_url:
                provider_kwargs["base_url"] = credentials.base_url
            elif credentials.provider_name:
                provider_kwargs["provider_name"] = credentials.provider_name
            if "base_url" in provider_kwargs and "provider_name" in provider_kwargs:
                del provider_kwargs["provider_name"]  # base_url takes precedence
        
        if provider == "google-vertex":
            # Add default region if not provided
            if not credentials.region:
                provider_kwargs["region"] = "us-central1"
        
        try:
            provider_instance = ProviderClass(**provider_kwargs)
            return ModelClass(model, provider=provider_instance)
        except Exception as e:
            raise RuntimeError(
                f"Failed to instantiate {provider} provider: {e}"
            ) from e
    
    @staticmethod
    def _import_class(module_name: str, class_name: str) -> type:
        """Dynamically import a class from a module.
        
        Args:
            module_name: Full module path
            class_name: Class name to import
            
        Returns:
            The imported class
            
        Raises:
            ImportError: If module or class not found.
        """
        module = importlib.import_module(module_name)
        return getattr(module, class_name)
    
    @staticmethod
    def _map_param_name(internal_name: str) -> str:
        """Map internal credential field names to provider parameter names.
        
        Some providers use different parameter names than our internal fields.
        """
        mapping = {
            "aws_access_key_id": "aws_access_key_id",
            "aws_secret_access_key": "aws_secret_access_key",
            "aws_session_token": "aws_session_token",
            "aws_profile_name": "profile_name",
            "region": "region_name",
        }
        return mapping.get(internal_name, internal_name)


# Singleton instance for convenience
provider_registry = ProviderRegistry()
