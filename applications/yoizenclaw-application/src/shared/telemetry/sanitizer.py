"""PII (Personally Identifiable Information) sanitizer.

Provides utilities to detect and redact sensitive information from
span attributes and log messages before export.
"""

from __future__ import annotations

import logging
import re
from typing import Any

logger = logging.getLogger(__name__)

# PII detection patterns
PII_PATTERNS = {
    "email": re.compile(
        r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}",
        re.IGNORECASE,
    ),
    "phone": re.compile(
        r"\b(?:\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}\b",
    ),
    "ssn": re.compile(
        r"\b\d{3}-\d{2}-\d{4}\b",
    ),
    "credit_card": re.compile(
        r"\b(?:\d{4}[-\s]?){3}\d{4}\b",
    ),
    "ip_address": re.compile(
        r"\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b",
    ),
}

# Sensitive headers that should be redacted
SENSITIVE_HEADERS = frozenset({
    "authorization",
    "cookie",
    "set-cookie",
    "x-api-key",
    "x-auth-token",
    "api-key",
    "token",
    "password",
    "secret",
    "private-key",
})

# Sensitive attribute keys
SENSITIVE_KEYS = frozenset({
    "password",
    "secret",
    "token",
    "api_key",
    "apikey",
    "auth",
    "credential",
    "private_key",
    "access_token",
    "refresh_token",
    "session_id",
    "credit_card",
    "ssn",
    "social_security",
    "phone",
    "email",
})


def _redact_pii_from_string(value: str) -> str:
    """Redact PII patterns from a string value.
    
    Args:
        value: String to sanitize.
        
    Returns:
        Sanitized string with PII redacted.
    """
    result = value
    for pattern_name, pattern in PII_PATTERNS.items():
        result = pattern.sub(f"[{pattern_name}_REDACTED]", result)
    return result


def _is_sensitive_key(key: str) -> bool:
    """Check if a key indicates sensitive data.
    
    Args:
        key: Attribute or header key.
        
    Returns:
        True if the key suggests sensitive data.
    """
    key_lower = key.lower()
    return (
        key_lower in SENSITIVE_HEADERS
        or key_lower in SENSITIVE_KEYS
        or any(sensitive in key_lower for sensitive in SENSITIVE_KEYS)
    )


def sanitize_attributes(attributes: dict[str, Any]) -> dict[str, Any]:
    """Sanitize span attributes by removing PII and sensitive data.
    
    Args:
        attributes: Dictionary of attribute key-value pairs.
        
    Returns:
        Sanitized attributes dictionary.
        
    Example:
        >>> attrs = {"user": "john@example.com", "password": "secret123"}
        >>> sanitize_attributes(attrs)
        {"user": "[email_REDACTED]", "password": "[REDACTED]"}
    """
    sanitized: dict[str, Any] = {}
    
    for key, value in attributes.items():
        # Check for sensitive keys
        if _is_sensitive_key(key):
            sanitized[key] = "[REDACTED]"
            continue
        
        # Sanitize string values
        if isinstance(value, str):
            if len(value) > 10000:
                # Truncate very long strings
                value = value[:10000] + "...[TRUNCATED]"
            sanitized[key] = _redact_pii_from_string(value)
        elif isinstance(value, (list, tuple)):
            # Sanitize lists/tuples
            sanitized_list = []
            for item in value:
                if isinstance(item, str):
                    sanitized_list.append(_redact_pii_from_string(item))
                else:
                    sanitized_list.append(item)
            sanitized[key] = sanitized_list
        elif isinstance(value, dict):
            # Recursively sanitize nested dictionaries
            sanitized[key] = sanitize_attributes(value)
        else:
            # Keep other types as-is
            sanitized[key] = value
    
    return sanitized


def sanitize_headers(headers: dict[str, str]) -> dict[str, str]:
    """Sanitize HTTP headers by redacting sensitive values.
    
    Args:
        headers: HTTP headers dictionary.
        
    Returns:
        Sanitized headers with sensitive values redacted.
    """
    sanitized: dict[str, str] = {}
    
    for key, value in headers.items():
        if _is_sensitive_key(key):
            sanitized[key] = "[REDACTED]"
        else:
            sanitized[key] = value
    
    return sanitized


def sanitize_db_statement(query: str) -> str:
    """Sanitize database query by removing parameter values.
    
    Replaces quoted strings and numeric literals with placeholders
    to avoid logging sensitive data in queries.
    
    Args:
        query: SQL query string.
        
    Returns:
        Sanitized query with values replaced by placeholders.
    """
    # Replace quoted strings
    query = re.sub(r"'[^']*'", "'?'", query)
    query = re.sub(r'"[^"]*"', '"?"', query)
    
    # Replace numeric literals (but keep common patterns like LIMIT, OFFSET)
    query = re.sub(r"(?<![a-zA-Z_])\d+(?![a-zA-Z_])", "?", query)
    
    return query


def sanitize_error_message(message: str) -> str:
    """Sanitize error messages by removing potential PII.
    
    Args:
        message: Error message string.
        
    Returns:
        Sanitized error message.
    """
    # Redact PII patterns
    message = _redact_pii_from_string(message)
    
    # Truncate very long messages
    if len(message) > 5000:
        message = message[:5000] + "...[TRUNCATED]"
    
    return message


def sanitize_log_message(message: str, level: int = logging.INFO) -> str:
    """Sanitize a log message based on log level.
    
    More aggressive sanitization for lower log levels (DEBUG/INFO).
    
    Args:
        message: Log message.
        level: Log level.
        
    Returns:
        Sanitized log message.
    """
    # Always redact PII
    message = _redact_pii_from_string(message)
    
    # For DEBUG level, also truncate
    if level <= logging.DEBUG and len(message) > 2000:
        message = message[:2000] + "...[TRUNCATED]"
    
    return message


def is_safe_to_export(attributes: dict[str, Any]) -> bool:
    """Check if attributes are safe to export (no obvious PII).
    
    This is a quick check; full sanitization should still be applied.
    
    Args:
        attributes: Attributes to check.
        
    Returns:
        False if obvious sensitive data detected, True otherwise.
    """
    for key in attributes.keys():
        if _is_sensitive_key(key):
            return False
    return True
