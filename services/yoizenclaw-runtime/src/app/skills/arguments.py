"""Argument substitution system for skill templates.

Provides $ARGUMENT and $ARG_NAME substitution for skill instructions
similar to nano-claude-code's argument handling.
"""

from __future__ import annotations

import logging
import re
from typing import Any

logger = logging.getLogger(__name__)


class ArgumentSubstitutor:
    """Handles argument substitution in skill instruction templates."""

    def __init__(self) -> None:
        """Initialize the argument substitutor."""
        # Pattern to find $ARGUMENT and $ARG_NAME placeholders
        self.arg_pattern = re.compile(r"\$(ARGUMENTS|\w+)")

    def substitute(
        self, template: str, arguments: list[str], raw_args: str = "", **kwargs: Any
    ) -> str:
        """Substitute arguments in a template string.

        Args:
            template: The template string with $ARGUMENTS and $ARG_NAME placeholders
            arguments: List of argument names defined for the skill
            raw_args: The complete raw argument string for $ARGUMENTS
            **kwargs: Additional named arguments for substitution

        Returns:
            Template with all placeholders substituted
        """
        if not template:
            return template

        def replace_match(match: re.Match[str]) -> str:
            placeholder = match.group(1)

            if placeholder == "ARGUMENTS":
                return raw_args

            # Named argument ($ARG_NAME)
            if placeholder in kwargs:
                result = str(kwargs[placeholder])
                return result
            # Also try case-insensitive kwargs match
            for key, value in kwargs.items():
                if key.lower() == placeholder.lower():
                    return str(value)

            # Try to get from defined arguments by name
            if placeholder.lower() in [arg.lower() for arg in arguments]:
                try:
                    # Find the actual argument name with correct case
                    arg_index = next(
                        i
                        for i, arg in enumerate(arguments)
                        if arg.lower() == placeholder.lower()
                    )
                    arg_parts = raw_args.strip().split()
                    if arg_index < len(arg_parts):
                        result = arg_parts[arg_index]
                        return result
                except (ValueError, IndexError):
                    pass

            # Try positional arguments ($ARG_1, $ARG_2, etc.)
            if placeholder.startswith("ARG_"):
                try:
                    index = int(placeholder[4:]) - 1  # ARG_1 -> index 0
                    arg_parts = raw_args.strip().split()
                    if index < len(arg_parts):
                        result = arg_parts[index]
                        return result
                except (ValueError, IndexError):
                    pass

            logger.warning(
                "Missing argument substitution for $%s in template",
                placeholder,
            )
            return ""

        return self.arg_pattern.sub(replace_match, template)

    def extract_argument_names(self, template: str) -> list[str]:
        """Extract all argument names referenced in a template."""
        if not template:
            return []

        matches = self.arg_pattern.findall(template)
        arg_names = []

        for match in matches:
            if match != "ARGUMENTS":
                arg_names.append(match)

        return list(set(arg_names))  # Remove duplicates

    def validate_arguments(
        self, template: str, defined_arguments: list[str], provided_args: str = ""
    ) -> tuple[bool, list[str]]:
        """Validate that template arguments match defined arguments.

        Returns:
            (is_valid, list_of_warnings)
        """
        warnings = []
        referenced_args = self.extract_argument_names(template)

        # Check for undefined arguments (case-insensitive)
        defined_lower = [arg.lower() for arg in defined_arguments]
        for ref_arg in referenced_args:
            if ref_arg.lower() not in defined_lower:
                warnings.append(f"Template references undefined argument: ${ref_arg}")

        # Check for unused defined arguments (case-insensitive)
        referenced_lower = [arg.lower() for arg in referenced_args]
        for def_arg in defined_arguments:
            if def_arg.lower() not in referenced_lower:
                warnings.append(f"Defined argument not used in template: {def_arg}")

        # Check if we have enough positional arguments
        if referenced_args and provided_args:
            arg_parts = provided_args.strip().split()
            needed_count = len(
                [arg for arg in referenced_args if arg.startswith("ARG_")]
            )

            if len(arg_parts) < needed_count:
                warnings.append(
                    f"Expected {needed_count} positional arguments, got {len(arg_parts)}"
                )

        is_valid = len(warnings) == 0
        return is_valid, warnings

    def get_substitution_summary(
        self, template: str, arguments: list[str], raw_args: str = "", **kwargs: Any
    ) -> dict[str, Any]:
        """Get a summary of what would be substituted."""
        if not template:
            return {"template": template, "substitutions": {}}

        substitutions = {}

        def replace_match_summary(match: re.Match[str]) -> str:
            placeholder = match.group(1)

            if placeholder == "ARGUMENTS":
                substitutions[f"$ARGUMENTS"] = raw_args
                return raw_args

            # Named argument
            if placeholder in kwargs:
                value = str(kwargs[placeholder])
                substitutions[f"${placeholder}"] = value
                return value
            # Also try case-insensitive kwargs match
            for key, value in kwargs.items():
                if key.lower() == placeholder.lower():
                    substitutions[f"${placeholder}"] = str(value)
                    return str(value)

            # Try positional arguments
            if placeholder.lower() in [arg.lower() for arg in arguments]:
                try:
                    arg_index = next(
                        i
                        for i, arg in enumerate(arguments)
                        if arg.lower() == placeholder.lower()
                    )
                    arg_parts = raw_args.strip().split()
                    if arg_index < len(arg_parts):
                        value = arg_parts[arg_index]
                        substitutions[f"${placeholder}"] = value
                        return value
                except (ValueError, IndexError):
                    substitutions[f"${placeholder}"] = "[MISSING]"
                    return "[MISSING]"

            # Positional argument ($ARG_1, $ARG_2, etc.)
            if placeholder.startswith("ARG_"):
                try:
                    index = int(placeholder[4:]) - 1
                    arg_parts = raw_args.strip().split()
                    if index < len(arg_parts):
                        value = arg_parts[index]
                        substitutions[f"${placeholder}"] = value
                        return value
                except (ValueError, IndexError):
                    substitutions[f"${placeholder}"] = "[MISSING]"
                    return "[MISSING]"

            substitutions[f"${placeholder}"] = "[MISSING]"
            return "[MISSING]"

        result_template = self.arg_pattern.sub(replace_match_summary, template)

        return {
            "template": template,
            "result": result_template,
            "substitutions": substitutions,
            "referenced_args": self.extract_argument_names(template),
        }


# Global instance for convenience
_substitutor = ArgumentSubstitutor()


def substitute_arguments(
    template: str, arguments: list[str], raw_args: str = "", **kwargs: Any
) -> str:
    """Convenience function for argument substitution."""
    return _substitutor.substitute(template, arguments, raw_args, **kwargs)


def validate_skill_arguments(
    template: str, defined_arguments: list[str], provided_args: str = ""
) -> tuple[bool, list[str]]:
    """Convenience function for argument validation."""
    return _substitutor.validate_arguments(template, defined_arguments, provided_args)
