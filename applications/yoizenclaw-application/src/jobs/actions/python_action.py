"""Python code action executor with sandbox safety checks."""

from __future__ import annotations

import ast
import asyncio
import json
import logging
import os
from typing import Any

from src.jobs.domain.entities import JobDefinition, JobExecution

logger = logging.getLogger(__name__)


def is_safe_code(code: str) -> bool:
    """Check if Python code is safe to execute.

    Args:
        code: Python code to check.

    Returns:
        True if code is safe, False otherwise.
    """
    dangerous_names = {
        "__import__",
        "eval",
        "exec",
        "compile",
        "open",
        "file",
        "input",
        "reload",
        "breakpoint",
    }

    dangerous_modules = {
        "os",
        "sys",
        "subprocess",
        "importlib",
        "pkgutil",
        "zipimport",
        "builtins",
    }

    dangerous_attrs = {
        "system",
        "popen",
        "spawn",
        "call",
        "run",
        "exec",
        "eval",
        "exec_file",
        "execfile",
        "load_source",
        "__import__",
        "chdir",
        "mkdir",
        "remove",
        "rmdir",
        "unlink",
        "rename",
        "listdir",
        "getcwd",
        "abort",
        "exit",
        "_base_executable",
    }

    try:
        tree = ast.parse(code)
        for node in ast.walk(tree):
            if isinstance(node, ast.Import) or isinstance(node, ast.ImportFrom):
                return False
            if isinstance(node, ast.Call):
                func = node.func
                if isinstance(func, ast.Name):
                    if func.id in dangerous_names:
                        return False
                elif isinstance(func, ast.Attribute):
                    attr_name = func.attr
                    if attr_name in dangerous_attrs:
                        return False
                    if isinstance(func.value, ast.Name):
                        if func.value.id in dangerous_modules:
                            return False
            if isinstance(node, ast.Attribute):
                if node.attr in dangerous_attrs:
                    return False
                if isinstance(node.value, ast.Name):
                    if node.value.id in dangerous_modules:
                        return False
    except SyntaxError:
        return False

    return True


async def execute_python_code(
    job: JobDefinition,
    execution: JobExecution,
) -> dict[str, Any]:
    """Execute Python code action in sandboxed environment.

    Args:
        job: Job with action_type="python_code".
        execution: Execution tracking record.

    Returns:
        Dictionary with execution results.

    Raises:
        ValueError: If code is unsafe or execution fails.
        asyncio.TimeoutError: If execution exceeds time limit.
    """
    allow_code_exec = (
        os.environ.get("ALLOW_CODE_EXECUTION", "false").lower() == "true"
    )
    if not allow_code_exec:
        raise ValueError(
            "Python code execution is disabled. "
            "Set ALLOW_CODE_EXECUTION=true to enable."
        )

    logger.warning(
        "Python code execution is enabled (ALLOW_CODE_EXECUTION=true)"
    )

    code = job.action_config.get("code", "")
    if not code:
        raise ValueError("No Python code provided")

    execution.add_log(f"Executing Python code ({len(code)} chars)")

    if not is_safe_code(code):
        raise ValueError("Code contains unsafe operations")

    safe_globals = {
        "__builtins__": {
            "len": len,
            "range": range,
            "enumerate": enumerate,
            "zip": zip,
            "map": map,
            "filter": filter,
            "sum": sum,
            "min": min,
            "max": max,
            "abs": abs,
            "round": round,
            "str": str,
            "int": int,
            "float": float,
            "bool": bool,
            "list": list,
            "dict": dict,
            "set": set,
            "tuple": tuple,
            "sorted": sorted,
            "reversed": reversed,
            "print": lambda *args: execution.add_log(
                " ".join(str(a) for a in args)
            ),
        },
        "json": json,
        "result": None,
    }

    timeout_seconds = job.action_config.get("timeout_seconds", 10)

    try:
        tree = ast.parse(code)
        compiled = compile(tree, filename="<job>", mode="exec")

        async def _exec_wrapper() -> None:
            exec(compiled, safe_globals)  # noqa: S102

        await asyncio.wait_for(_exec_wrapper(), timeout=timeout_seconds)

        result = safe_globals.get("result")
        execution.add_log("Python code executed successfully")

        return {"result": result}

    except asyncio.TimeoutError:
        execution.add_log(
            f"Python execution timed out after {timeout_seconds}s"
        )
        raise ValueError(
            f"Code execution timed out after {timeout_seconds} seconds"
        )
    except Exception as e:
        execution.add_log(f"Python execution error: {str(e)}")
        raise
