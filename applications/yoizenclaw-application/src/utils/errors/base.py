"""Base exception classes for YoizenClaw.

All custom exceptions inherit from these base classes for consistent
error handling across the application.
"""


class YoizenClawError(Exception):
    """Base exception for all YoizenClaw errors."""

    def __init__(self, message: str, details: dict | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or {}


class ConfigurationError(YoizenClawError):
    """Raised when configuration is invalid or missing."""


class RequiredFieldMissingError(ConfigurationError):
    """Raised when a required configuration field is missing."""


class InvalidFieldError(ConfigurationError):
    """Raised when a configuration field has an invalid value."""


class RuntimeNotConfiguredError(ConfigurationError):
    """Raised when runtime configuration is not available."""
