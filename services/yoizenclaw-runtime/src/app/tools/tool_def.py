"""Tool definition dataclass for the runtime tool registry.

Provides a structured way to define tools with JSON schemas for LLM integration,
output truncation, and execution metadata.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Callable


@dataclass
class ToolDef:
    """Definition of a runtime tool with schema and execution metadata.

    Replaces the current unstructured tool objects with a proper
    dataclass that includes JSON schema for LLM integration.
    """

    name: str  # Unique identifier for the tool
    description: str  # Description shown to the LLM
    input_schema: dict[str, Any]  # JSON schema for tool parameters
    func: Callable  # Function that executes the tool
    read_only: bool = False  # True = tool does not modify state
    max_output_chars: int = 32_000  # Output truncation threshold

    def __post_init__(self) -> None:
        """Validate the tool definition after creation."""
        if not self.name or not isinstance(self.name, str):
            raise ValueError("Tool name must be a non-empty string")

        if not self.description or not isinstance(self.description, str):
            raise ValueError("Tool description must be a non-empty string")

        if not isinstance(self.input_schema, dict):
            raise ValueError("input_schema must be a dictionary")

        if not callable(self.func):
            raise ValueError("func must be callable")

        if self.max_output_chars <= 0:
            raise ValueError("max_output_chars must be positive")

    def get_schema_for_llm(self) -> dict[str, Any]:
        """Return the JSON schema in the format expected by LLM APIs."""
        return {
            "name": self.name,
            "description": self.description,
            "input_schema": self.input_schema,
        }

    def truncate_output(self, output: Any) -> dict[str, Any]:
        """Truncate tool output if it exceeds max_output_chars.

        Returns the original output if under the limit, or a truncated
        summary with metadata if over the limit.
        """
        serialized = json.dumps(output, default=str)
        size_bytes = len(serialized.encode("utf-8"))

        if size_bytes <= self.max_output_chars:
            return output

        # Calculate truncation points
        serialized_str = serialized
        if isinstance(output, dict):
            # For dict responses, keep first half + last quarter
            serialized_str = json.dumps(output, default=str, indent=2)

        size_bytes = len(serialized_str.encode("utf-8"))
        if size_bytes <= self.max_output_chars:
            return output

        # Truncate with marker
        half_size = self.max_output_chars // 2
        quarter_size = self.max_output_chars // 4

        first_half = serialized_str[:half_size]
        last_quarter = (
            serialized_str[-quarter_size:] if len(serialized_str) > quarter_size else ""
        )

        truncation_marker = f"\n\n[... {size_bytes - self.max_output_chars} characters truncated ...]\n\n"

        if isinstance(output, dict):
            # Try to maintain JSON structure in truncated output
            return {
                "_truncated": True,
                "original_size_bytes": size_bytes,
                "truncated_content": f"{first_half}{truncation_marker}{last_quarter}",
                "message": f"Tool output truncated: {size_bytes} bytes exceeded limit of {self.max_output_chars} bytes",
            }
        else:
            return f"{first_half}{truncation_marker}{last_quarter}"

    async def execute(self, params: dict[str, Any], config: dict[str, Any]) -> Any:
        """Execute the tool with parameters and return truncated result.

        Supports both sync and async tool functions transparently.
        """
        try:
            result = self.func(params, config)
            # Handle async tool functions
            if hasattr(result, "__await__"):
                result = await result
            return self.truncate_output(result)
        except Exception as e:
            # Return error in structured format
            return {
                "success": False,
                "error": str(e),
                "tool": self.name,
                "params": params,
            }
