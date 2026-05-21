"""Tool definitions loaded from YAML files."""

import logging
from pathlib import Path
from typing import Any, Optional

import yaml

from src.utils.config.runtime_paths import get_runtime_tools_dir

logger = logging.getLogger(__name__)


class ToolLoadError(Exception):
    """Raised when tool loading fails."""
    pass


class ToolDefinition:
    """Represents a tool definition loaded from YAML.
    
    Provides a structured interface to tool configuration
    with property-based access to common attributes.
    
    Attributes:
        name: Tool name identifier.
        description: Human-readable tool description.
        definition: Full tool definition dictionary.
    """
    
    def __init__(self, name: str, definition: dict[str, Any]):
        """Initialize a tool definition.
        
        Args:
            name: Tool name identifier.
            definition: Dictionary containing tool definition.
        """
        self.name = name
        self.definition = definition
        self._schema: Optional[dict[str, Any]] = None
    
    @property
    def description(self) -> str:
        """Tool description from definition."""
        return self.definition.get("description", "")
    
    @property
    def enabled(self) -> bool:
        """Whether the tool is enabled."""
        return self.definition.get("enabled", True)
    
    @property
    def category(self) -> str:
        """Tool category."""
        return self.definition.get("category", "general")
    
    @property
    def parameters(self) -> dict[str, Any]:
        """Tool parameters schema."""
        return self.definition.get("parameters", {})
    
    @property
    def handler(self) -> str:
        """Handler function name or path."""
        return self.definition.get("handler", "")
    
    @property
    def config(self) -> dict[str, Any]:
        """Tool-specific configuration."""
        return self.definition.get("config", {})
    
    def get(self, key: str, default: Any = None) -> Any:
        """Get a value from the tool definition.
        
        Args:
            key: Key to look up.
            default: Default value if key not found.
            
        Returns:
            Value from definition or default.
        """
        return self.definition.get(key, default)
    
    def __repr__(self) -> str:
        return f"ToolDefinition(name={self.name!r}, enabled={self.enabled})"


class ToolRegistry:
    """Registry of tools loaded from the runtime tools directory.
    
    Manages tool definitions with support for loading from
    multiple YAML files and dynamic reload capability.
    
    Attributes:
        tools_dir: Directory containing tool definition YAML files.
        _tools: Dictionary of loaded tools by name.
    """
    
    def __init__(self, tools_dir: str | None = None):
        """Initialize the tool registry.
        
        Args:
            tools_dir: Directory containing tool YAML definitions.
        """
        self.tools_dir = (
            Path(tools_dir) if tools_dir is not None else get_runtime_tools_dir()
        )
        self._tools: dict[str, ToolDefinition] = {}
        self._loaded: bool = False
    
    def _load_yaml_file(self, file_path: Path) -> dict[str, Any]:
        """Load a YAML tool definition file.
        
        Args:
            file_path: Path to YAML file.
            
        Returns:
            Parsed YAML content.
            
        Raises:
            ToolLoadError: If file cannot be parsed.
        """
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f)
                return data if data is not None else {}
        except yaml.YAMLError as e:
            raise ToolLoadError(f"Failed to parse tool file {file_path}: {e}")
        except OSError as e:
            raise ToolLoadError(f"Failed to read tool file {file_path}: {e}")
    
    def _process_tool_data(self, name: str, data: dict[str, Any]) -> Optional[ToolDefinition]:
        """Process raw tool data into a ToolDefinition.
        
        Args:
            name: Tool name.
            data: Tool definition data.
            
        Returns:
            ToolDefinition instance or None if invalid.
        """
        if not isinstance(data, dict):
            logger.warning("Invalid tool definition for '%s': expected dict, got %s", name, type(data).__name__)
            return None
        
        return ToolDefinition(name, data)
    
    def load_all(self) -> list[ToolDefinition]:
        """Load all tool definitions from YAML files.
        
        Scans the tools directory for YAML files and loads
        all tool definitions. Supports both single-tool and
        multi-tool YAML file formats.
        
        Returns:
            List of loaded ToolDefinition objects.
            
        Raises:
            ToolLoadError: If tool files cannot be read or parsed.
        """
        if not self.tools_dir.exists():
            logger.warning("Tools directory does not exist: %s", self.tools_dir)
            return []
        
        loaded_tools: list[ToolDefinition] = []
        self._tools.clear()
        
        for file_path in sorted(self.tools_dir.glob("*.yaml")):
            try:
                data = self._load_yaml_file(file_path)
                self._load_from_data(data, file_path.stem, loaded_tools)
            except ToolLoadError as e:
                logger.error("Error loading tools from %s: %s", file_path, e)
                continue
        
        self._loaded = True
        logger.info("Loaded %d tool definitions", len(loaded_tools))
        return loaded_tools
    
    def _load_from_data(self, data: dict[str, Any], source: str, loaded_tools: list) -> None:
        """Load tools from parsed YAML data.
        
        Handles both single-tool format (direct dict) and
        multi-tool format (tools key containing list/dict).
        
        Args:
            data: Parsed YAML data.
            source: Source file name for logging.
            loaded_tools: List to append loaded tools to.
        """
        if "tools" in data and isinstance(data["tools"], list):
            for tool_data in data["tools"]:
                name = tool_data.get("name", f"{source}_unknown")
                tool_def = self._process_tool_data(name, tool_data)
                if tool_def:
                    self._tools[tool_def.name] = tool_def
                    loaded_tools.append(tool_def)
        
        elif isinstance(data, dict) and "name" in data:
            name = data.get("name", source)
            tool_def = self._process_tool_data(name, data)
            if tool_def:
                self._tools[tool_def.name] = tool_def
                loaded_tools.append(tool_def)
        
        else:
            for key, value in data.items():
                if isinstance(value, dict):
                    tool_def = self._process_tool_data(key, value)
                    if tool_def:
                        self._tools[tool_def.name] = tool_def
                        loaded_tools.append(tool_def)
    
    def get(self, name: str) -> Optional[ToolDefinition]:
        """Get a tool definition by name.
        
        Args:
            name: Tool name to retrieve.
            
        Returns:
            ToolDefinition if found, None otherwise.
        """
        if not self._loaded:
            self.load_all()
        return self._tools.get(name)
    
    def get_all(self) -> list[ToolDefinition]:
        """Get all tool definitions.
        
        Returns:
            List of all loaded ToolDefinition objects.
        """
        if not self._loaded:
            self.load_all()
        return list(self._tools.values())
    
    def list_all(self) -> list[dict[str, Any]]:
        """List all loaded tools as dictionaries.
        
        Returns:
            List of tool definition dictionaries.
        """
        return [tool.definition for tool in self.get_all()]
    
    def list_names(self) -> list[str]:
        """List all tool names.
        
        Returns:
            List of tool name strings.
        """
        if not self._loaded:
            self.load_all()
        return list(self._tools.keys())
    
    def list_enabled(self) -> list[ToolDefinition]:
        """List all enabled tools.
        
        Returns:
            List of enabled ToolDefinition objects.
        """
        return [tool for tool in self.get_all() if tool.enabled]
    
    def list_disabled(self) -> list[ToolDefinition]:
        """List all disabled tools.
        
        Returns:
            List of disabled ToolDefinition objects.
        """
        return [tool for tool in self.get_all() if not tool.enabled]
    
    def list_by_category(self, category: str) -> list[ToolDefinition]:
        """List tools in a specific category.
        
        Args:
            category: Category name to filter by.
            
        Returns:
            List of tools in the specified category.
        """
        return [tool for tool in self.get_all() if tool.category == category]
    
    def list_categories(self) -> list[str]:
        """List all tool categories.
        
        Returns:
            Sorted list of unique category names.
        """
        categories = {tool.category for tool in self.get_all()}
        return sorted(categories)
    
    def is_registered(self, name: str) -> bool:
        """Check if a tool is registered.
        
        Args:
            name: Tool name to check.
            
        Returns:
            True if tool is registered, False otherwise.
        """
        if not self._loaded:
            self.load_all()
        return name in self._tools
    
    def reload(self) -> list[ToolDefinition]:
        """Reload all tool definitions.
        
        Clears existing tools and reloads from disk.
        
        Returns:
            List of reloaded ToolDefinition objects.
        """
        self._loaded = False
        return self.load_all()
    
    def add_tool(self, name: str, definition: dict[str, Any]) -> ToolDefinition:
        """Add a tool definition dynamically.
        
        Args:
            name: Tool name.
            definition: Tool definition dictionary.
            
        Returns:
            Created ToolDefinition.
        """
        tool_def = self._process_tool_data(name, definition)
        if tool_def:
            self._tools[name] = tool_def
            logger.info("Added tool: %s", name)
        return tool_def
    
    def remove_tool(self, name: str) -> bool:
        """Remove a tool definition.
        
        Args:
            name: Tool name to remove.
            
        Returns:
            True if tool was removed, False if not found.
        """
        if name in self._tools:
            del self._tools[name]
            logger.info("Removed tool: %s", name)
            return True
        return False
    
    def enable_tool(self, name: str) -> bool:
        """Enable a tool.
        
        Args:
            name: Tool name to enable.
            
        Returns:
            True if tool was enabled, False if not found.
        """
        tool = self.get(name)
        if tool:
            tool.definition["enabled"] = True
            return True
        return False
    
    def disable_tool(self, name: str) -> bool:
        """Disable a tool.
        
        Args:
            name: Tool name to disable.
            
        Returns:
            True if tool was disabled, False if not found.
        """
        tool = self.get(name)
        if tool:
            tool.definition["enabled"] = False
            return True
        return False
    
    @property
    def count(self) -> int:
        """Total number of registered tools."""
        return len(self._tools)
    
    @property
    def enabled_count(self) -> int:
        """Number of enabled tools."""
        return len(self.list_enabled())
    
    def __len__(self) -> int:
        return self.count
    
    def __contains__(self, name: str) -> bool:
        return self.is_registered(name)
    
    def __iter__(self):
        return iter(self._tools.values())


def get_tool_registry() -> ToolRegistry:
    """Get the default tool registry instance.
    
    Returns:
        Default ToolRegistry configured with the runtime tools directory.
    """
    from src.utils.di import AppContainer

    container = AppContainer.get()
    if container.default_tool_registry is None:
        container.default_tool_registry = ToolRegistry()
    return container.default_tool_registry
