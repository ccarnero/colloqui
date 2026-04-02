"""Generic pipeline execution engine for YoizenClaw.

Executes multi-step workflows defined entirely via JSON/YAML configuration
pushed from the backend.  The engine has zero domain knowledge — it only
understands primitive step types and template rendering.

Supported step types
--------------------
- **api_call**      – HTTP request to any URL
- **llm_generate**  – Generate text with the configured LLM
- **condition**     – Branch based on a simple expression
- **loop**          – Iterate over a collection executing sub-steps
- **transform**     – Map / filter / reshape data
- **notify**        – Send an event to the backend via NATS
"""

from __future__ import annotations

import copy
import httpx
import json
import logging
import re
from typing import Any

logger = logging.getLogger(__name__)

def get_pipeline_http_client() -> httpx.AsyncClient:
    """Get or create the shared pipeline HTTP client.

    Returns:
        Shared httpx.AsyncClient instance.
    """
    from src.shared.di import AppContainer

    container = AppContainer.get()
    if container.pipeline_http_client is None:
        container.pipeline_http_client = httpx.AsyncClient(
            timeout=30.0,
            limits=httpx.Limits(max_keepalive_connections=20, max_connections=100),
        )
    return container.pipeline_http_client


async def close_pipeline_http_client() -> None:
    """Close the shared pipeline HTTP client."""
    from src.shared.di import AppContainer

    container = AppContainer.get()
    if container.pipeline_http_client is not None:
        await container.pipeline_http_client.aclose()
    container.pipeline_http_client = None

# Regex for ``{{variable}}`` or ``{{step_id.field.nested}}`` templates.
_TEMPLATE_RE = re.compile(r"\{\{\s*([\w.]+)\s*\}\}")


class PipelineError(Exception):
    """Raised when pipeline execution encounters a fatal error."""


class StepError(Exception):
    """Raised when a single step fails."""

    def __init__(self, step_id: str, message: str) -> None:
        self.step_id = step_id
        super().__init__(f"Step '{step_id}': {message}")


# ------------------------------------------------------------------
# Template helpers
# ------------------------------------------------------------------

def render_template(template: str, context: dict[str, Any]) -> str:
    """Replace ``{{key}}`` / ``{{key.sub}}`` placeholders with *context* values.

    Args:
        template: String potentially containing ``{{…}}`` placeholders.
        context: Flat or nested dictionary of available values.

    Returns:
        Rendered string with placeholders replaced.
    """

    def _replace(match: re.Match) -> str:
        path = match.group(1)
        value = _resolve_path(path, context)
        if value is None:
            return match.group(0)  # leave placeholder as-is
        return str(value)

    return _TEMPLATE_RE.sub(_replace, template)


def render_value(value: Any, context: dict[str, Any]) -> Any:
    """Recursively render templates inside *value*.

    - ``str``   → template-rendered string
    - ``dict``  → each value rendered recursively
    - ``list``  → each element rendered recursively
    - anything else → returned as-is
    """

    if isinstance(value, str):
        rendered = render_template(value, context)
        # If the entire string was a single placeholder, return the raw value
        # so that non-string types (lists, dicts, ints) are preserved.
        single_match = _TEMPLATE_RE.fullmatch(value.strip())
        if single_match:
            resolved = _resolve_path(single_match.group(1), context)
            if resolved is not None:
                return resolved
        return rendered

    if isinstance(value, dict):
        return {k: render_value(v, context) for k, v in value.items()}

    if isinstance(value, list):
        return [render_value(item, context) for item in value]

    return value


def _resolve_path(path: str, context: dict[str, Any]) -> Any:
    """Walk a dotted *path* (``a.b.c``) through nested dicts / objects."""

    parts = path.split(".")
    current: Any = context
    for part in parts:
        if isinstance(current, dict):
            current = current.get(part)
        elif hasattr(current, part):
            current = getattr(current, part)
        else:
            return None
        if current is None:
            return None
    return current


# ------------------------------------------------------------------
# Pipeline context
# ------------------------------------------------------------------

class PipelineContext:
    """Mutable bag of data flowing through a pipeline execution.

    Every step stores its output under ``outputs[step_id]``.  Steps can
    reference earlier outputs via ``{{step_id.field}}`` templates.
    """

    def __init__(self, initial_data: dict[str, Any] | None = None) -> None:
        self.outputs: dict[str, Any] = dict(initial_data or {})
        self.logs: list[str] = []

    def set(self, key: str, value: Any) -> None:
        self.outputs[key] = value

    def get(self, key: str, default: Any = None) -> Any:
        return self.outputs.get(key, default)

    def add_log(self, message: str) -> None:
        self.logs.append(message)

    def to_template_dict(self) -> dict[str, Any]:
        """Return a flat-ish dictionary suitable for template rendering."""
        return dict(self.outputs)


# ------------------------------------------------------------------
# Step executors
# ------------------------------------------------------------------

async def _exec_api_call(
    config: dict[str, Any],
    ctx: PipelineContext,
) -> Any:
    """Execute an HTTP request.

    Config keys:
        url (str):           Target URL (supports templates).
        method (str):        HTTP verb, default ``GET``.
        headers (dict):      Optional headers.
        body (dict|str):     Optional request body (JSON).
        timeout (float):     Timeout in seconds, default 30.
    """

    tpl = ctx.to_template_dict()
    url = render_template(config.get("url", ""), tpl)
    method = render_template(config.get("method", "GET"), tpl).upper()
    headers = render_value(config.get("headers", {}), tpl)
    body = render_value(config.get("body"), tpl)
    timeout = float(config.get("timeout", 30))

    ctx.add_log(f"api_call {method} {url}")

    client = get_pipeline_http_client()
    if method == "GET":
        resp = await client.get(url, headers=headers, timeout=timeout)
    elif method in ("POST", "PUT", "PATCH"):
        resp = await client.request(
            method,
            url,
            headers=headers,
            json=body,
            timeout=timeout,
        )
    elif method == "DELETE":
        resp = await client.delete(url, headers=headers, timeout=timeout)
    else:
        raise StepError("api_call", f"Unsupported HTTP method: {method}")

    resp.raise_for_status()

    try:
        return resp.json()
    except (json.JSONDecodeError, ValueError):
        return {"text": resp.text, "status_code": resp.status_code}


async def _exec_llm_generate(
    config: dict[str, Any],
    ctx: PipelineContext,
) -> str:
    """Generate text with the runtime LLM.

    Config keys:
        prompt (str):          User prompt (supports templates).
        system_prompt (str):   Optional system prompt override.
    """

    from src.application.llm.llm_service import LLMClient

    tpl = ctx.to_template_dict()
    prompt = render_template(config.get("prompt", ""), tpl)
    system_prompt = config.get("system_prompt")
    if system_prompt:
        system_prompt = render_template(system_prompt, tpl)

    ctx.add_log(f"llm_generate prompt_len={len(prompt)}")

    client = LLMClient()
    response = await client.generate(prompt=prompt, system_prompt=system_prompt)
    return response.content


async def _exec_condition(
    config: dict[str, Any],
    ctx: PipelineContext,
) -> Any:
    """Evaluate a simple expression and branch.

    Config keys:
        expression (str):  A template string.  Truthy when the rendered
                           value is non-empty, not ``"false"``, and not ``"0"``.
        then (list):       Steps to run when the expression is truthy.
        else (list):       Steps to run otherwise (optional).
    """

    tpl = ctx.to_template_dict()
    raw_expr = render_template(config.get("expression", ""), tpl)
    is_truthy = _is_truthy(raw_expr)

    ctx.add_log(f"condition expression='{raw_expr}' → {is_truthy}")

    branch = config.get("then", []) if is_truthy else config.get("else", [])
    if branch:
        await _run_steps(branch, ctx)

    return {"evaluated": raw_expr, "result": is_truthy}


async def _exec_loop(
    config: dict[str, Any],
    ctx: PipelineContext,
) -> list[Any]:
    """Iterate over a collection executing sub-steps for each item.

    Config keys:
        collection (str|list):  Template resolving to a list, or a literal list.
        as (str):               Variable name for the current item.
        steps (list):           Steps to run per iteration.
    """

    tpl = ctx.to_template_dict()
    collection_raw = render_value(config.get("collection", []), tpl)

    if isinstance(collection_raw, str):
        try:
            collection_raw = json.loads(collection_raw)
        except (json.JSONDecodeError, ValueError):
            collection_raw = []

    if not isinstance(collection_raw, list):
        collection_raw = [collection_raw] if collection_raw else []

    item_name = config.get("as", "item")
    sub_steps = config.get("steps", [])
    results: list[Any] = []

    ctx.add_log(f"loop over {len(collection_raw)} items as '{item_name}'")

    for idx, item in enumerate(collection_raw):
        ctx.set(item_name, item)
        ctx.set(f"{item_name}_index", idx)
        await _run_steps(sub_steps, ctx)
        results.append(item)

    return results


async def _exec_transform(
    config: dict[str, Any],
    ctx: PipelineContext,
) -> Any:
    """Map / filter / reshape data.

    Config keys:
        input (str):       Template resolving to the input value.
        operation (str):   One of ``map_fields``, ``filter``, ``pick``, ``flatten``.
        fields (dict):     For ``map_fields`` — ``{new_key: "{{source.path}}"}``
        expression (str):  For ``filter`` — truthy check per item.
        keys (list[str]):  For ``pick`` — keys to keep.
    """

    tpl = ctx.to_template_dict()
    raw_input = render_value(config.get("input"), tpl)
    operation = config.get("operation", "passthrough")

    ctx.add_log(f"transform operation={operation}")

    if operation == "map_fields":
        fields = config.get("fields", {})
        if isinstance(raw_input, list):
            return [
                {
                    new_key: render_value(src_tpl, {**tpl, "item": item})
                    for new_key, src_tpl in fields.items()
                }
                for item in raw_input
            ]
        if isinstance(raw_input, dict):
            return {
                new_key: render_value(src_tpl, {**tpl, "item": raw_input})
                for new_key, src_tpl in fields.items()
            }
        return raw_input

    if operation == "filter":
        expression = config.get("expression", "")
        if not isinstance(raw_input, list):
            return raw_input
        filtered = []
        for item in raw_input:
            rendered = render_template(expression, {**tpl, "item": item})
            if _is_truthy(rendered):
                filtered.append(item)
        return filtered

    if operation == "pick":
        keys = config.get("keys", [])
        if isinstance(raw_input, dict):
            return {k: v for k, v in raw_input.items() if k in keys}
        return raw_input

    if operation == "flatten":
        if isinstance(raw_input, list):
            flat: list[Any] = []
            for item in raw_input:
                if isinstance(item, list):
                    flat.extend(item)
                else:
                    flat.append(item)
            return flat
        return raw_input

    # passthrough
    return raw_input


async def _exec_notify(
    config: dict[str, Any],
    ctx: PipelineContext,
) -> dict[str, Any]:
    """Send an event to the backend via NATS.

    Config keys:
        event (str):   Event name.
        data (dict):   Payload (supports templates).
    """

    tpl = ctx.to_template_dict()
    event = render_template(config.get("event", "pipeline:notify"), tpl)
    data = render_value(config.get("data", {}), tpl)

    ctx.add_log(f"notify event={event}")

    try:
        from src.interfaces.nats_bridge import publish_runtime_event

        await publish_runtime_event(event, data)
        return {"sent": True, "event": event}
    except Exception as e:
        logger.warning("notify step failed: %s", e)

    return {"sent": False, "event": event}


# ------------------------------------------------------------------
# Step dispatcher
# ------------------------------------------------------------------

_STEP_EXECUTORS: dict[str, Any] = {
    "api_call": _exec_api_call,
    "llm_generate": _exec_llm_generate,
    "condition": _exec_condition,
    "loop": _exec_loop,
    "transform": _exec_transform,
    "notify": _exec_notify,
}


async def _run_steps(
    steps: list[dict[str, Any]],
    ctx: PipelineContext,
) -> None:
    """Execute a list of step definitions sequentially."""

    for step_def in steps:
        step_id = step_def.get("id", "unnamed")
        step_type = step_def.get("type", "")
        step_config = step_def.get("config", {})
        output_key = step_def.get("output", step_id)
        on_error = step_def.get("on_error", "stop")

        executor = _STEP_EXECUTORS.get(step_type)
        if executor is None:
            msg = f"Unknown step type: {step_type}"
            ctx.add_log(f"[ERROR] {step_id}: {msg}")
            if on_error == "stop":
                raise StepError(step_id, msg)
            continue

        try:
            result = await executor(step_config, ctx)
            ctx.set(output_key, result)
            ctx.add_log(f"[OK] {step_id}")
        except StepError:
            raise
        except Exception as e:
            ctx.add_log(f"[ERROR] {step_id}: {e}")
            if on_error == "stop":
                raise StepError(step_id, str(e)) from e
            elif on_error == "continue":
                ctx.set(output_key, {"error": str(e)})
            # "retry" could be added later


# ------------------------------------------------------------------
# Public entry point
# ------------------------------------------------------------------

async def execute_pipeline(
    steps: list[dict[str, Any]],
    initial_data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Execute a complete pipeline and return the accumulated outputs.

    Args:
        steps: Ordered list of step definitions.
        initial_data: Optional seed data available to templates.

    Returns:
        Dictionary with ``outputs`` and ``logs``.
    """

    ctx = PipelineContext(initial_data)
    ctx.add_log(f"Pipeline started with {len(steps)} steps")

    try:
        await _run_steps(steps, ctx)
        ctx.add_log("Pipeline completed successfully")
        success = True
        error = None
    except (StepError, PipelineError) as e:
        ctx.add_log(f"Pipeline failed: {e}")
        success = False
        error = str(e)

    return {
        "success": success,
        "outputs": ctx.outputs,
        "logs": ctx.logs,
        "error": error,
    }


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

def _is_truthy(value: str) -> bool:
    """Determine if a rendered template value is truthy."""

    if not value:
        return False
    lower = value.strip().lower()
    return lower not in ("false", "0", "none", "null", "no", "")
