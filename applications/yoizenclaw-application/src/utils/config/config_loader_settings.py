"""Global settings loaded from the runtime settings files.

Provides a centralized access point for application settings
with support for dynamic reloading when configuration changes.
"""

import logging
from typing import Any, Optional

from src.utils.config.loader import ConfigLoader
from src.utils.config.runtime_paths import (
    get_runtime_config_dir,
    get_runtime_prompts_dir,
    get_runtime_tools_dir,
)

logger = logging.getLogger(__name__)


def _default_config_dir() -> str:
    """Resolve the writable runtime config directory."""

    return str(get_runtime_config_dir())


class Settings:
    """Dynamic settings from YAML config.
    
    Provides class-level properties for quick access to commonly used
    configuration values. All settings are loaded from the config
    directory with support for hot-reload.
    
    Class Attributes:
        _loader: Shared ConfigLoader instance for all Settings access.
    """
    
    _loader: ConfigLoader = ConfigLoader(_default_config_dir())
    _initialized: bool = False
    
    @classmethod
    def _ensure_initialized(cls) -> None:
        """Ensure settings are initialized on first access."""
        if not cls._initialized:
            cls._loader.preload_configs("settings.yaml")
            cls._initialized = True
    
    @classmethod
    def reload(cls) -> None:
        """Reload all configuration settings.
        
        Clears cached configs and re-reads all configuration files.
        """
        cls._loader.reload()
        logger.info("Settings reloaded")
    
    @classmethod
    def get(cls, key: str, default: Any = None) -> Any:
        """Get a configuration value by dot-notation key.
        
        Args:
            key: Dot-notation key for nested value (e.g., "llm.provider").
            default: Default value to return if key not found.
            
        Returns:
            Configuration value or default if not found.
        """
        cls._ensure_initialized()
        return cls._loader.get(key, default, "settings.yaml")
    
    @classmethod
    def get_settings(cls, key: str, default: Any = None) -> Any:
        """Get a value specifically from settings.yaml.
        
        Args:
            key: Dot-notation key for nested value.
            default: Default value to return if key not found.
            
        Returns:
            Value from settings.yaml or default if not found.
        """
        return cls.get(key, default)
    
    @classmethod
    def on_reload(cls, callback) -> None:
        """Register a callback to be called when settings reload.
        
        Args:
            callback: Callable that takes no arguments.
        """
        cls._loader.on_reload(callback)
    
    @classmethod
    def start_reload_polling(cls, interval: float = 1.0) -> None:
        """Start background polling for config changes.
        
        Args:
            interval: Polling interval in seconds.
        """
        cls._loader.start_polling(interval)
    
    @classmethod
    def stop_reload_polling(cls) -> None:
        """Stop background polling for config changes."""
        cls._loader.stop_polling()
    
    @classmethod
    def watch_file(cls, path: str) -> None:
        """Watch a specific config file for changes.
        
        Args:
            path: Relative path to config file in config directory.
        """
        cls._loader.watch(path)
    
    @property
    def llm_provider(self) -> str:
        """LLM provider name from backend config."""
        value = self.get("llm.provider")
        if not value:
            raise RuntimeError(
                "llm.provider not configured. "
                "Backend must push configuration via NATS."
            )
        return value
    
    @property
    def llm_model(self) -> str:
        """LLM model identifier from backend config."""
        value = self.get("llm.model")
        if not value:
            raise RuntimeError(
                "llm.model not configured. "
                "Backend must push configuration via NATS."
            )
        return value
    
    @property
    def llm_api_key(self) -> str:
        """LLM API key from backend config."""
        value = self.get("llm.api_key")
        if not value:
            raise RuntimeError(
                "llm.api_key not configured. "
                "Backend must push configuration via NATS."
            )
        return value
    
    @property
    def llm_temperature(self) -> float:
        """LLM temperature setting from backend config."""
        value = self.get("llm.temperature")
        if value is None:
            raise RuntimeError(
                "llm.temperature not configured. "
                "Backend must push configuration via NATS."
            )
        return float(value)
    
    @property
    def llm_max_tokens(self) -> int:
        """LLM max tokens setting from backend config."""
        value = self.get("llm.max_tokens")
        if value is None:
            raise RuntimeError(
                "llm.max_tokens not configured. "
                "Backend must push configuration via NATS."
            )
        return int(value)
    
    @property
    def backend_http_url(self) -> str:
        """Backend HTTP URL from runtime config."""

        value = self.get("backend.http_url")
        if not value:
            value = self.get("yoizen.api_url")
        if not value:
            raise RuntimeError(
                "backend.http_url not configured. "
                "Backend must push configuration via NATS."
            )
        return value

    @property
    def backend_http_api_key(self) -> str:
        """Backend HTTP API key from runtime config."""

        value = self.get("backend.http_api_key")
        if not value:
            value = self.get("yoizen.api_key")
        if not value:
            raise RuntimeError(
                "backend.http_api_key not configured. "
                "Backend must push configuration via NATS."
            )
        return value

    @property
    def yoizen_check_interval(self) -> int:
        """Check interval in seconds from backend config."""
        value = self.get("yoizen.check_interval")
        if value is None:
            raise RuntimeError(
                "yoizen.check_interval not configured. "
                "Backend must push configuration via NATS."
            )
        return int(value)
    
    @property
    def max_retries(self) -> int:
        """Maximum number of retry attempts from backend config."""
        value = self.get("retry.max_retries")
        if value is None:
            raise RuntimeError(
                "retry.max_retries not configured. "
                "Backend must push configuration via NATS."
            )
        return int(value)
    
    @property
    def retry_delay(self) -> float:
        """Delay between retry attempts from backend config."""
        value = self.get("retry.delay")
        if value is None:
            raise RuntimeError(
                "retry.delay not configured. "
                "Backend must push configuration via NATS."
            )
        return float(value)
    
    @property
    def host(self) -> str:
        """Application host address."""
        return self.get("server.host", "0.0.0.0")
    
    @property
    def port(self) -> int:
        """Application port number."""
        return int(self.get("server.port", 8000))
    
    @property
    def log_level(self) -> str:
        """Logging level."""
        return self.get("logging.level", "INFO")
    
    @property
    def log_format(self) -> str:
        """Logging format."""
        return self.get("logging.format", "json")
    
    @property
    def database_url(self) -> Optional[str]:
        """Database connection URL."""
        return self.get("database.url")
    
    @property
    def redis_url(self) -> Optional[str]:
        """Redis connection URL."""
        return self.get("redis.url")
    
    @property
    def agent_max_iterations(self) -> int:
        """Maximum iterations for agent loop from backend config."""
        value = self.get("agent.max_iterations")
        if value is None:
            raise RuntimeError(
                "agent.max_iterations not configured. "
                "Backend must push configuration via NATS."
            )
        return int(value)
    
    @property
    def agent_timeout(self) -> int:
        """Agent timeout in seconds from backend config."""
        value = self.get("agent.timeout")
        if value is None:
            raise RuntimeError(
                "agent.timeout not configured. "
                "Backend must push configuration via NATS."
            )
        return int(value)
    
    @property
    def memory_max_size(self) -> int:
        """Maximum size for memory storage from backend config."""
        value = self.get("memory.max_size")
        if value is None:
            raise RuntimeError(
                "memory.max_size not configured. "
                "Backend must push configuration via NATS."
            )
        return int(value)
    
    @property
    def tools_dir(self) -> str:
        """Directory containing tool definitions."""
        return self.get("tools.dir", str(get_runtime_tools_dir()))
    
    @property
    def prompts_dir(self) -> str:
        """Directory containing prompt templates."""
        return self.get("prompts.dir", str(get_runtime_prompts_dir()))
