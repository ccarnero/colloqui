"""Regression tests for mandatory project-local Codex manual-loop policy."""

import hashlib
import importlib.util
import json
import tempfile
import tomllib
import unittest
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "checks" / "check-codex-manual-loop.py"
SPEC = importlib.util.spec_from_file_location("check_codex_manual_loop", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)

CONFIG_TEXT = '''model = "gpt-6-astra"
model_reasoning_effort = "medium"

[agents]
enabled = true
default_subagent_model = "gpt-5.6-sol"
default_subagent_reasoning_effort = "medium"
'''

NON_STRING_INSTRUCTION_LITERALS = (
    "7",
    "123",
    "true",
    "1.5",
    "1979-05-27",
    "07:32:00",
    "1979-05-27T07:32:00Z",
    '["AGENTS.md"]',
    '{ contract = "AGENTS.md" }',
)


def role_data(role: str) -> dict:
    model, effort, sandbox = MODULE.EXPECTED_ROLES[role]
    return {
        "name": role,
        "description": f"{role} role",
        "model": model,
        "model_reasoning_effort": effort,
        "sandbox_mode": sandbox,
        "developer_instructions": (
            "Read AGENTS.md, DOCS/guides/manual-loop.md, and "
            "DOCS/guides/agent-roles.md. Do not create a competing orchestration loop."
        ),
    }


def encode_role(values: dict) -> str:
    lines = []
    for key, value in values.items():
        encoded = str(value).lower() if isinstance(value, bool) else json.dumps(value)
        lines.append(f"{key} = {encoded}\n")
    return "".join(lines)


def write_project(root: Path) -> Path:
    codex = root / ".codex"
    agents = codex / "agents"
    agents.mkdir(parents=True)
    codex.joinpath("config.toml").write_text(CONFIG_TEXT, encoding="utf-8")
    for role in MODULE.EXPECTED_ROLES:
        agents.joinpath(f"{role}.toml").write_text(
            encode_role(role_data(role)), encoding="utf-8"
        )
    for relative in MODULE.CONTRACT_FILES:
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("contract\n", encoding="utf-8")
    files = {}
    for relative in MODULE.LOCKED_FILES:
        data = (root / relative).read_bytes()
        files[relative] = hashlib.sha256(data).hexdigest()
    codex.joinpath("manual-loop.lock.json").write_text(
        json.dumps({"version": 1, "algorithm": "sha256", "files": files}),
        encoding="utf-8",
    )
    return codex


class PolicyDataTests(unittest.TestCase):
    def test_policy_constants_match_approved_role_pins(self):
        self.assertEqual(
            MODULE.EXPECTED_ROLES,
            {
                "fp-dev": ("gpt-5.6-sol", "medium", "workspace-write"),
                "fp-qa": ("gpt-5.6-sol", "medium", "workspace-write"),
                "fp-architect": ("gpt-6-astra", "high", "read-only"),
                "fp-reviewer": ("gpt-6-astra", "high", "read-only"),
                "script-runner": ("gpt-5.6-luna", "low", "workspace-write"),
            },
        )

    def test_accepts_exact_mandatory_policy(self):
        roles = {role: role_data(role) for role in MODULE.EXPECTED_ROLES}
        self.assertEqual(MODULE.validate_policy_data(MODULE.EXPECTED_CONFIG, roles), [])

    def test_rejects_empty_config(self):
        roles = {role: role_data(role) for role in MODULE.EXPECTED_ROLES}
        errors = MODULE.validate_policy_data({}, roles)
        self.assertTrue(any("mandatory model/effort policy" in error for error in errors))

    def test_rejects_each_missing_role(self):
        for missing in MODULE.EXPECTED_ROLES:
            with self.subTest(role=missing):
                roles = {
                    role: role_data(role)
                    for role in MODULE.EXPECTED_ROLES
                    if role != missing
                }
                errors = MODULE.validate_policy_data(MODULE.EXPECTED_CONFIG, roles)
                self.assertIn(f"missing mandatory Codex role: {missing}", errors)

    def test_rejects_wrong_role_pins_and_name(self):
        cases = (
            ("model", "other-model"),
            ("model_reasoning_effort", "max"),
            ("name", "other-role"),
            ("sandbox_mode", "danger-full-access"),
        )
        for role in MODULE.EXPECTED_ROLES:
            for field, value in cases:
                with self.subTest(role=role, field=field):
                    roles = {
                        configured_role: role_data(configured_role)
                        for configured_role in MODULE.EXPECTED_ROLES
                    }
                    roles[role][field] = value
                    errors = MODULE.validate_policy_data(MODULE.EXPECTED_CONFIG, roles)
                    self.assertTrue(
                        any(f"{role} {field} must be" in error for error in errors)
                    )

    def test_rejects_unexpected_role_and_missing_contract_reference(self):
        roles = {role: role_data(role) for role in MODULE.EXPECTED_ROLES}
        roles["extra"] = role_data("fp-dev")
        roles["fp-qa"]["developer_instructions"] = "competing orchestration loop"
        errors = MODULE.validate_policy_data(MODULE.EXPECTED_CONFIG, roles)
        self.assertIn("unexpected project Codex role: extra", errors)
        for contract in MODULE.CONTRACT_FILES:
            self.assertIn(f"fp-qa instructions must reference {contract}", errors)

    def test_rejects_non_string_instructions_as_structural_diagnostics(self):
        expected = "fp-reviewer requires non-empty developer_instructions when provided"
        for literal in NON_STRING_INSTRUCTION_LITERALS:
            with self.subTest(literal=literal):
                roles = {role: role_data(role) for role in MODULE.EXPECTED_ROLES}
                roles["fp-reviewer"]["developer_instructions"] = tomllib.loads(
                    f"developer_instructions = {literal}"
                )["developer_instructions"]
                errors = MODULE.validate_policy_data(MODULE.EXPECTED_CONFIG, roles)
                self.assertIn(expected, errors)


class HashLockTests(unittest.TestCase):
    def test_detects_each_locked_file_deletion_and_drift(self):
        contents = {path: path.encode() for path in MODULE.LOCKED_FILES}
        lock = {
            "version": 1,
            "algorithm": "sha256",
            "files": {
                path: hashlib.sha256(data).hexdigest()
                for path, data in contents.items()
            },
        }
        self.assertEqual(MODULE.validate_lock_data(lock, contents), [])
        for path in MODULE.LOCKED_FILES:
            with self.subTest(path=path, failure="missing"):
                without = dict(contents)
                del without[path]
                self.assertIn(
                    f"locked Codex file is missing: {path}",
                    MODULE.validate_lock_data(lock, without),
                )
            with self.subTest(path=path, failure="drift"):
                drifted = dict(contents)
                drifted[path] += b"drift"
                self.assertIn(
                    f"locked Codex file drifted: {path}",
                    MODULE.validate_lock_data(lock, drifted),
                )

    def test_rejects_lock_shape_and_path_set_drift(self):
        self.assertTrue(MODULE.validate_lock_data([], {}))
        errors = MODULE.validate_lock_data(
            {"version": 2, "algorithm": "sha256", "files": {}}, {}
        )
        self.assertTrue(any("version 1" in error for error in errors))
        errors = MODULE.validate_lock_data(
            {"version": 1, "algorithm": "sha256", "files": {"extra": "hash"}}, {}
        )
        self.assertIn("manual-loop lock has unexpected path: extra", errors)


class ProjectBoundaryTests(unittest.TestCase):
    def test_accepts_complete_local_project(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_project(root)
            self.assertEqual(MODULE.validate_project(root), [])

    def test_rejects_missing_config_and_malformed_toml(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            codex = write_project(root)
            codex.joinpath("config.toml").unlink()
            errors = MODULE.validate_project(root)
            self.assertTrue(any("missing Codex config" in error for error in errors))

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            codex = write_project(root)
            codex.joinpath("config.toml").write_text('model = "unterminated\n', encoding="utf-8")
            errors = MODULE.validate_project(root)
            self.assertTrue(any("cannot parse" in error for error in errors))

    def test_rejects_non_string_instructions_from_real_toml_files(self):
        expected = "fp-reviewer requires non-empty developer_instructions when provided"
        for literal in NON_STRING_INSTRUCTION_LITERALS:
            with self.subTest(literal=literal), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                codex = write_project(root)
                role = role_data("fp-reviewer")
                del role["developer_instructions"]
                codex.joinpath("agents/fp-reviewer.toml").write_text(
                    encode_role(role) + f"developer_instructions = {literal}\n",
                    encoding="utf-8",
                )
                errors = MODULE.validate_project(root)
                self.assertEqual(errors.count(expected), 1)

    def test_rejects_role_symlink(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            codex = write_project(root)
            role = codex / "agents" / "fp-dev.toml"
            target = root / "external-role.toml"
            target.write_bytes(role.read_bytes())
            role.unlink()
            role.symlink_to(target)
            errors = MODULE.validate_project(root)
            self.assertTrue(any("local regular file" in error for error in errors))

    def test_rejects_config_symlink(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            codex = write_project(root)
            config = codex / "config.toml"
            target = root / "external-config.toml"
            target.write_bytes(config.read_bytes())
            config.unlink()
            config.symlink_to(target)
            errors = MODULE.validate_project(root)
            self.assertTrue(any("Codex config must be a local regular file" in error for error in errors))

    def test_rejects_codex_directory_symlink(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            codex = write_project(root)
            target = root / "external-codex"
            codex.rename(target)
            codex.symlink_to(target, target_is_directory=True)
            errors = MODULE.validate_project(root)
            self.assertTrue(
                any("Codex directory must be a local directory" in error for error in errors)
            )

    def test_rejects_agents_directory_symlink(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            codex = write_project(root)
            agents = codex / "agents"
            target = root / "external-agents"
            agents.rename(target)
            agents.symlink_to(target, target_is_directory=True)
            errors = MODULE.validate_project(root)
            self.assertTrue(
                any(
                    "Codex agents directory must be a local directory" in error
                    for error in errors
                )
            )

    def test_rejects_retired_claude_role(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_project(root)
            retired = root / MODULE.FORBIDDEN_CLAUDE_ROLES[0]
            retired.parent.mkdir(parents=True)
            retired.write_text("retired\n", encoding="utf-8")
            errors = MODULE.validate_project(root)
            self.assertTrue(any("retired local Claude role" in error for error in errors))

    def test_validation_never_refreshes_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            codex = write_project(root)
            lock = codex / "manual-loop.lock.json"
            before = lock.read_bytes()
            codex.joinpath("agents/fp-qa.toml").write_text("drift\n", encoding="utf-8")
            self.assertTrue(MODULE.validate_project(root))
            self.assertEqual(lock.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
