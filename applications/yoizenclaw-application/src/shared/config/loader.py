"""Configuration loader with hot-reload support.

Watches config files and reloads automatically when they change.
Uses watchdog for file system events (or polling as fallback).
"""

import os
import logging
import time
import threading
from pathlib import Path
from typing import Any, Callable, Optional

import yaml
import json

from src.shared.config.runtime_paths import get_runtime_config_dir

logger = logging.getLogger(__name__)


class ConfigLoadError(Exception):
    """Raised when configuration loading fails."""
    pass


class ConfigLoader:
    """Dynamic configuration loader with hot-reload.
    
    Loads configurations from YAML/JSON files and supports automatic
    reload when files are modified. Uses file polling as a fallback
    when watchdog is not available.
    
    Attributes:
        config_dir: Base directory for configuration files.
        _configs: Cached configurations by file path.
        _callbacks: List of callbacks to invoke on reload.
        _last_modified: Last modification times for watched files.
        _lock: Thread lock for safe concurrent access.
    """
    
    def __init__(self, config_dir: str | None = None):
        """Initialize the configuration loader.
        
        Args:
            config_dir: Base directory for configuration files.
                        Can be absolute or relative path.
        """
        self.config_dir = (
            Path(config_dir) if config_dir is not None else get_runtime_config_dir()
        )
        self._configs: dict[str, Any] = {}
        self._callbacks: list[Callable[[], None]] = []
        self._last_modified: dict[str, float] = {}
        self._lock = threading.RLock()
        self._poll_thread: Optional[threading.Thread] = None
        self._stop_polling: bool = False
        self._poll_interval: float = 1.0
        
    def _resolve_path(self, path: str) -> Path:
        """Resolve a relative path to absolute path.
        
        Args:
            path: File path (relative to config_dir or absolute).
            
        Returns:
            Absolute Path object.
        """
        p = Path(path)
        if p.is_absolute():
            return p
        return self.config_dir / path
    
    def _get_file_modified_time(self, path: Path) -> float:
        """Get file modification time with error handling.
        
        Args:
            path: Path to file.
            
        Returns:
            Modification time as float, or 0 if file doesn't exist.
        """
        try:
            return path.stat().st_mtime if path.exists() else 0.0
        except OSError:
            return 0.0
    
    def load_yaml(self, path: str) -> dict[str, Any]:
        """Load a YAML file.
        
        Args:
            path: Relative or absolute path to YAML file.
            
        Returns:
            Dictionary containing parsed YAML data.
            
        Raises:
            ConfigLoadError: If file cannot be loaded or parsed.
        """
        file_path = self._resolve_path(path)
        
        if not file_path.exists():
            raise ConfigLoadError(f"YAML file not found: {file_path}")
        
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f)
                return data if data is not None else {}
        except yaml.YAMLError as e:
            raise ConfigLoadError(f"Failed to parse YAML file {file_path}: {e}")
        except OSError as e:
            raise ConfigLoadError(f"Failed to read YAML file {file_path}: {e}")
    
    def load_json(self, path: str) -> dict[str, Any]:
        """Load a JSON file.
        
        Args:
            path: Relative or absolute path to JSON file.
            
        Returns:
            Dictionary containing parsed JSON data.
            
        Raises:
            ConfigLoadError: If file cannot be loaded or parsed.
        """
        file_path = self._resolve_path(path)
        
        if not file_path.exists():
            raise ConfigLoadError(f"JSON file not found: {file_path}")
        
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                return data if data is not None else {}
        except json.JSONDecodeError as e:
            raise ConfigLoadError(f"Failed to parse JSON file {file_path}: {e}")
        except OSError as e:
            raise ConfigLoadError(f"Failed to read JSON file {file_path}: {e}")
    
    def load_file(self, path: str) -> dict[str, Any]:
        """Load any config file (auto-detect format by extension).
        
        Args:
            path: Relative or absolute path to config file.
            
        Returns:
            Dictionary containing parsed file data.
            
        Raises:
            ConfigLoadError: If file format is unsupported or loading fails.
        """
        file_path = self._resolve_path(path)
        suffix = file_path.suffix.lower()
        
        if suffix in (".yaml", ".yml"):
            return self.load_yaml(path)
        elif suffix == ".json":
            return self.load_json(path)
        else:
            raise ConfigLoadError(f"Unsupported config file format: {suffix}")
    
    def _set_nested(self, data: dict[str, Any], key: str, value: Any) -> None:
        """Set a value in nested dictionary using dot notation.
        
        Args:
            data: Dictionary to modify.
            key: Dot-notation key like "a.b.c".
            value: Value to set.
        """
        keys = key.split(".")
        current = data
        for k in keys[:-1]:
            if k not in current:
                current[k] = {}
            current = current[k]
        current[keys[-1]] = value
    
    def _get_nested(self, data: dict[str, Any], key: str, default: Any = None) -> Any:
        """Get a value from nested dictionary using dot notation.
        
        Args:
            data: Dictionary to search.
            key: Dot-notation key like "a.b.c".
            default: Default value if key not found.
            
        Returns:
            Value at key or default if not found.
        """
        keys = key.split(".")
        current = data
        for k in keys:
            if isinstance(current, dict) and k in current:
                current = current[k]
            else:
                return default
        return current
    
    def get(self, key: str, default: Any = None, config_file: str = "config.yaml") -> Any:
        """Get a config value by dot-notation key.
        
        Args:
            key: Dot-notation key for nested value (e.g., "llm.provider").
            default: Default value if key not found.
            config_file: Config file to read from (default: "config.yaml").
            
        Returns:
            Value at key location or default if not found.
        """
        with self._lock:
            if config_file not in self._configs:
                try:
                    self._configs[config_file] = self.load_file(config_file)
                except ConfigLoadError as e:
                    logger.warning("Failed to load config file %s: %s", config_file, e)
                    return default
            
            return self._get_nested(self._configs[config_file], key, default)
    
    def watch(self, path: str) -> None:
        """Watch a file for changes.
        
        Args:
            path: Relative or absolute path to file to watch.
        """
        file_path = self._resolve_path(path)
        with self._lock:
            self._last_modified[str(file_path)] = self._get_file_modified_time(file_path)
            logger.debug("Watching file for changes: %s", file_path)
    
    def check_updates(self) -> bool:
        """Check if any watched files changed.
        
        Returns:
            True if any watched file has been modified since last check.
        """
        changed = False
        with self._lock:
            for file_path_str, last_mtime in list(self._last_modified.items()):
                file_path = Path(file_path_str)
                current_mtime = self._get_file_modified_time(file_path)
                if current_mtime > last_mtime:
                    logger.info("Detected change in config file: %s", file_path)
                    self._last_modified[file_path_str] = current_mtime
                    changed = True
        return changed
    
    def reload(self, config_file: Optional[str] = None) -> None:
        """Reload all or specific configuration.
        
        Args:
            config_file: Optional specific file to reload.
                        If None, reloads all cached configs.
        """
        with self._lock:
            if config_file:
                if config_file in self._configs:
                    try:
                        self._configs[config_file] = self.load_file(config_file)
                        logger.info("Reloaded config file: %s", config_file)
                    except ConfigLoadError as e:
                        logger.error("Failed to reload config file %s: %s", config_file, e)
            else:
                for file_path in list(self._configs.keys()):
                    try:
                        self._configs[file_path] = self.load_file(file_path)
                    except ConfigLoadError as e:
                        logger.error("Failed to reload config file %s: %s", file_path, e)
                logger.info("Reloaded all configuration files")
        
        if self.check_updates():
            self._notify_callbacks()
    
    def _notify_callbacks(self) -> None:
        """Notify all registered callbacks of a reload."""
        with self._lock:
            callbacks = list(self._callbacks)
        
        for callback in callbacks:
            try:
                callback()
            except Exception as e:
                logger.error("Error in reload callback: %s", e)
    
    def on_reload(self, callback: Callable[[], None]) -> None:
        """Register a callback to be called on reload.
        
        Args:
            callback: Callable that takes no arguments.
        """
        with self._lock:
            self._callbacks.append(callback)
    
    def start_polling(self, interval: float = 1.0) -> None:
        """Start polling for file changes in a background thread.
        
        Args:
            interval: Polling interval in seconds (default: 1.0).
        """
        if self._poll_thread is not None and self._poll_thread.is_alive():
            logger.warning("Polling already started")
            return
        
        self._poll_interval = interval
        self._stop_polling = False
        self._poll_thread = threading.Thread(
            target=self._poll_loop,
            name="config-loader-poll",
            daemon=True
        )
        self._poll_thread.start()
        logger.info("Started config file polling")
    
    def _poll_loop(self) -> None:
        """Background polling loop."""
        while not self._stop_polling:
            try:
                if self.check_updates():
                    self.reload()
                    self._notify_callbacks()
            except Exception as e:
                logger.error("Error in poll loop: %s", e)
            time.sleep(self._poll_interval)
    
    def stop_polling(self) -> None:
        """Stop the background polling thread."""
        self._stop_polling = True
        if self._poll_thread is not None:
            self._poll_thread.join(timeout=5.0)
            self._poll_thread = None
            logger.info("Stopped config file polling")
    
    def preload_configs(self, *file_paths: str) -> None:
        """Preload multiple config files.
        
        Args:
            file_paths: Variable number of config file paths to load.
        """
        for file_path in file_paths:
            try:
                self.load_file(file_path)
                self.watch(file_path)
            except ConfigLoadError as e:
                logger.error("Failed to preload config %s: %s", file_path, e)
