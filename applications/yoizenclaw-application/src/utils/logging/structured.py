"""Structured logging with tenant context and PII sanitization.

Per wdocs/06-observabilidad.md section 3.4, logs MUST include
tenant, traceid, causation_id fields and MUST NEVER log data.payload.
"""

from __future__ import annotations

import logging
from contextvars import ContextVar
from typing import Any

_tenant_var: ContextVar[str] = ContextVar("tenant_id", default="")
_traceid_var: ContextVar[str] = ContextVar("traceid", default="")
_causation_id_var: ContextVar[str] = ContextVar("causation_id", default="")

PII_FIELD_NAMES: frozenset[str] = frozenset({
    "payload",
    "system_prompt",
    "credentials",
})

PII_KEY_SUBSTRINGS: frozenset[str] = frozenset({
    "password",
    "secret",
    "token",
    "key",
})


def set_tenant_context(tenant: str) -> None:
    _tenant_var.set(tenant)


def get_tenant_context() -> str:
    return _tenant_var.get()


def set_traceid_context(traceid: str) -> None:
    _traceid_var.set(traceid)


def get_traceid_context() -> str:
    return _traceid_var.get()


def set_causation_id_context(causation_id: str) -> None:
    _causation_id_var.set(causation_id)


def get_causation_id_context() -> str:
    return _causation_id_var.get()


def clear_tenant_context() -> None:
    _tenant_var.set("")
    _traceid_var.set("")
    _causation_id_var.set("")


class TenantContextFilter(logging.Filter):
    """Inject tenant, traceid, causation_id into every log record."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.tenant = _tenant_var.get()  # type: ignore[attr-defined]
        record.traceid = _traceid_var.get()  # type: ignore[attr-defined]
        record.causation_id = _causation_id_var.get()  # type: ignore[attr-defined]
        return True


def _is_pii_key(key: str) -> bool:
    if key in PII_FIELD_NAMES:
        return True
    key_lower = key.lower()
    return any(substr in key_lower for substr in PII_KEY_SUBSTRINGS)


def _sanitize_value(value: Any) -> Any:
    if isinstance(value, dict):
        return _sanitize_dict(value)
    if isinstance(value, list):
        return [_sanitize_value(item) for item in value]
    return value


def _sanitize_dict(data: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in data.items():
        if _is_pii_key(key):
            result[key] = "[REDACTED]"
        elif isinstance(value, dict):
            sanitized = _sanitize_dict(value)
            result[key] = sanitized
        elif isinstance(value, list):
            result[key] = [_sanitize_value(item) for item in value]
        else:
            result[key] = value
    return result


class PIISanitizerFilter(logging.Filter):
    """Strip PII fields (data.payload, credentials, etc.) from log records."""

    def filter(self, record: logging.LogRecord) -> bool:
        if record.args is not None:
            if isinstance(record.args, dict):
                record.args = _sanitize_dict(record.args)
            elif isinstance(record.args, tuple):
                record.args = tuple(_sanitize_value(arg) for arg in record.args)

        for attr_name in list(vars(record)):
            if attr_name.startswith("_"):
                continue
            attr_value = getattr(record, attr_name, None)
            if isinstance(attr_value, dict):
                sanitized = _sanitize_dict(attr_value)
                object.__setattr__(record, attr_name, sanitized)

        return True


def init_structured_logging(target_logger: logging.Logger) -> None:
    """Attach TenantContextFilter and PIISanitizerFilter to a logger."""
    has_tenant = any(isinstance(f, TenantContextFilter) for f in target_logger.filters)
    if not has_tenant:
        target_logger.addFilter(TenantContextFilter())

    has_pii = any(isinstance(f, PIISanitizerFilter) for f in target_logger.filters)
    if not has_pii:
        target_logger.addFilter(PIISanitizerFilter())
