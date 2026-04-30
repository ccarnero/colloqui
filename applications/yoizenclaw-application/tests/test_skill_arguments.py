"""Tests for skill argument substitution system."""

import pytest
from src.app.skills.arguments import (
    ArgumentSubstitutor,
    substitute_arguments,
    validate_skill_arguments
)


class TestArgumentSubstitutor:
    """Test cases for argument substitution."""

    def test_substitute_arguments_basic(self) -> None:
        """Test basic argument substitution."""
        template = "Deploy $VERSION to $ENV environment"
        result = substitute_arguments(
            template,
            arguments=["env", "version"],
            raw_args="staging 2.1.0"
        )
        
        assert result == "Deploy 2.1.0 to staging environment"

    def test_substitute_arguments_with_kwargs(self) -> None:
        """Test substitution with keyword arguments."""
        template = "Deploy $VERSION to $ENV environment"
        result = substitute_arguments(
            template,
            arguments=["env", "version"],
            raw_args="",
            env="production",
            version="3.0.0"
        )
        
        assert result == "Deploy 3.0.0 to production environment"

    def test_substitute_arguments_mixed(self) -> None:
        """Test substitution with both positional and keyword arguments."""
        template = "Deploy $VERSION to $ENV environment. Full args: $ARGUMENTS"
        result = substitute_arguments(
            template,
            arguments=["env", "version"],
            raw_args="staging 2.1.0",
            version="3.0.0"  # Should override positional
        )
        
        assert result == "Deploy 3.0.0 to staging environment. Full args: staging 2.1.0"

    def test_substitute_arguments_positional(self) -> None:
        """Test positional argument substitution ($ARG_1, $ARG_2)."""
        template = "First: $ARG_1, Second: $ARG_2, All: $ARGUMENTS"
        result = substitute_arguments(
            template,
            arguments=["first", "second"],
            raw_args="alpha beta gamma"
        )
        
        assert result == "First: alpha, Second: beta, All: alpha beta gamma"

    def test_substitute_arguments_missing_positional(self) -> None:
        """Test missing positional arguments."""
        template = "First: $ARG_1, Second: $ARG_2, Third: $ARG_3"
        result = substitute_arguments(
            template,
            arguments=[],
            raw_args="only_one"
        )
        
        # Missing arguments become empty strings
        assert result == "First: only_one, Second: , Third: "

    def test_substitute_arguments_named_from_list(self) -> None:
        """Test substitution using named arguments from the arguments list."""
        template = "Product: $product, Quantity: $quantity"
        result = substitute_arguments(
            template,
            arguments=["product", "quantity"],
            raw_args="laptop 5"
        )
        
        assert result == "Product: laptop, Quantity: 5"

    def test_substitute_arguments_no_template(self) -> None:
        """Test substitution with empty template."""
        result = substitute_arguments(
            "",
            arguments=["test"],
            raw_args="args"
        )
        
        assert result == ""

    def test_substitute_arguments_no_arguments(self) -> None:
        """Test substitution with no arguments in template."""
        template = "Just a regular message"
        result = substitute_arguments(
            template,
            arguments=[],
            raw_args="some args"
        )
        
        assert result == "Just a regular message"

    def test_extract_argument_names(self) -> None:
        """Test extraction of argument names from template."""
        template = "Deploy $VERSION to $ENV. Args: $ARGUMENTS. Extra: $EXTRA"
        substitutor = ArgumentSubstitutor()
        
        names = substitutor.extract_argument_names(template)
        
        assert set(names) == {"VERSION", "ENV", "EXTRA"}
        assert "ARGUMENTS" not in names  # ARGUMENTS is special

    def test_extract_argument_names_empty(self) -> None:
        """Test extraction from empty template."""
        substitutor = ArgumentSubstitutor()
        names = substitutor.extract_argument_names("")
        assert names == []

    def test_extract_argument_names_no_placeholders(self) -> None:
        """Test extraction from template with no placeholders."""
        template = "Just a regular message without placeholders"
        substitutor = ArgumentSubstitutor()
        
        names = substitutor.extract_argument_names(template)
        assert names == []

    def test_validate_arguments_valid(self) -> None:
        """Test validation with valid arguments."""
        template = "Deploy $VERSION to $ENV"
        defined_args = ["version", "env"]
        
        is_valid, warnings = validate_skill_arguments(template, defined_args, "staging 2.1.0")
        
        assert is_valid is True
        assert len(warnings) == 0

    def test_validate_arguments_undefined_reference(self) -> None:
        """Test validation with undefined argument reference."""
        template = "Deploy $VERSION to $ENV"
        defined_args = ["version"]  # Missing 'env'
        
        is_valid, warnings = validate_skill_arguments(template, defined_args)
        
        assert is_valid is False
        assert any("undefined argument: $ENV" in w for w in warnings)

    def test_validate_arguments_unused_defined(self) -> None:
        """Test validation with unused defined arguments."""
        template = "Deploy $VERSION to $ENV"
        defined_args = ["version", "env", "extra"]  # 'extra' not used
        
        is_valid, warnings = validate_skill_arguments(template, defined_args)
        
        assert is_valid is False
        assert any("not used in template: extra" in w for w in warnings)

    def test_validate_arguments_insufficient_positional(self) -> None:
        """Test validation with insufficient positional arguments."""
        template = "First: $ARG_1, Second: $ARG_2, Third: $ARG_3"
        defined_args = []
        
        is_valid, warnings = validate_skill_arguments(template, defined_args, "only_one_arg")
        
        assert is_valid is False
        assert any("Expected 3 positional arguments, got 1" in w for w in warnings)

    def test_get_substitution_summary(self) -> None:
        """Test getting substitution summary."""
        template = "Deploy $VERSION to $ENV. Args: $ARGUMENTS"
        substitutor = ArgumentSubstitutor()
        
        summary = substitutor.get_substitution_summary(
            template,
            arguments=["env", "version"],
            raw_args="production 3.0.0"
        )
        
        assert summary["template"] == template
        assert summary["result"] == "Deploy 3.0.0 to production. Args: production 3.0.0"
        assert summary["substitutions"]["$VERSION"] == "3.0.0"
        assert summary["substitutions"]["$ENV"] == "production"
        assert summary["substitutions"]["$ARGUMENTS"] == "production 3.0.0"
        assert set(summary["referenced_args"]) == {"VERSION", "ENV"}

    def test_get_substitution_summary_missing_args(self) -> None:
        """Test substitution summary with missing arguments."""
        template = "Deploy $VERSION to $ENV"
        substitutor = ArgumentSubstitutor()
        
        summary = substitutor.get_substitution_summary(
            template,
            arguments=[],
            raw_args=""
        )
        
        assert summary["substitutions"]["$VERSION"] == "[MISSING]"
        assert summary["substitutions"]["$ENV"] == "[MISSING]"

    def test_complex_substitution_scenario(self) -> None:
        """Test a complex substitution scenario."""
        template = """
Task: Deploy $COMPONENT
Environment: $ENV
Version: $VERSION
Arguments: $ARGUMENTS
Contact: $CONTACT
Priority: $PRIORITY
"""
        
        result = substitute_arguments(
            template,
            arguments=["component", "env", "version"],
            raw_args="frontend staging v2.1.0",
            CONTACT="admin@company.com",
            PRIORITY="high"
        )
        
        assert "Task: frontend" in result
        assert "Environment: staging" in result
        assert "Version: v2.1.0" in result
        assert "Arguments: frontend staging v2.1.0" in result
        assert "Contact: admin@company.com" in result
        assert "Priority: high" in result

    def test_argument_edge_cases(self) -> None:
        """Test edge cases in argument substitution."""
        # Test with special characters
        template = "Path: $PATH, Command: $COMMAND"
        result = substitute_arguments(
            template,
            arguments=["path", "command"],
            raw_args="/home/user 'ls -la'",
        )
        
        assert result == "Path: /home/user, Command: 'ls -la'"
        
        # Test with empty arguments
        template = "Empty: $EMPTY, Missing: $MISSING"
        result = substitute_arguments(
            template,
            arguments=["empty"],
            raw_args="",
        )
        
        assert result == "Empty: , Missing: "

    def test_multiple_ARGUMENTS_references(self) -> None:
        """Test multiple $ARGUMENTS references in template."""
        template = "Start: $ARGUMENTS\nMiddle: $ARGUMENTS\nEnd: $ARGUMENTS"
        raw_args = "arg1 arg2 arg3"
        
        result = substitute_arguments(template, [], raw_args)
        
        assert "Start: arg1 arg2 arg3" in result
        assert "Middle: arg1 arg2 arg3" in result
        assert "End: arg1 arg2 arg3" in result
