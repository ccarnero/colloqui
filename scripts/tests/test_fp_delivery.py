"""Regression coverage for inherited Codex configuration and shared contracts.

The old fixed-model assertions are superseded by structural inheritance and
explicit-override cases because provider resolution belongs to the active tool.
"""

import importlib.util
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "checks" / "check-fp-delivery.py"
SPEC = importlib.util.spec_from_file_location("check_fp_delivery", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


def role_data(role, **overrides):
    """Build a complete explicit native role definition for override tests."""

    values = {
        "name": role,
        "description": f"{role} local tuning",
        "sandbox_mode": MODULE.ROLE_SANDBOX[role],
        "developer_instructions": "Follow the shared role contract.",
    }
    values.update(overrides)
    return values


def write_codex(root: Path, overrides=None, config="\n# Inherit the active global profile.\n"):
    (root / "agents").mkdir(parents=True)
    root.joinpath("config.toml").write_text(config, encoding="utf-8")
    for role, values in (overrides or {}).items():
        lines = []
        for key, value in values.items():
            encoded = str(value).lower() if isinstance(value, bool) else f'"{value}"'
            lines.append(f"{key} = {encoded}\n")
        (root / "agents" / f"{role}.toml").write_text("".join(lines), encoding="utf-8")


class CodexRoutingTests(unittest.TestCase):
    def test_accepts_comment_only_project_config_and_absent_local_roles(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "codex"
            write_codex(root)
            self.assertEqual(MODULE.validate_codex_dir(root), [])

    def test_accepts_structural_project_tuning(self):
        cases = (
            'model = "provider/model"\nmodel_reasoning_effort = "medium"\n',
            '[agents]\nenabled = true\ndefault_subagent_model = "provider/cheap"\n'
            'default_subagent_reasoning_effort = "low"\n',
        )
        for config in cases:
            with self.subTest(config=config):
                with tempfile.TemporaryDirectory() as directory:
                    root = Path(directory) / "codex"
                    write_codex(root, config=config)
                    self.assertEqual(MODULE.validate_codex_dir(root), [])

    def test_accepts_data_driven_structural_role_overrides(self):
        cases = (
            ("fp-dev", {"model": "provider/cheap", "model_reasoning_effort": "medium", "sandbox_mode": "workspace-write"}),
            ("fp-qa", {"model_reasoning_effort": "low", "sandbox_mode": "workspace-write"}),
            ("fp-reviewer", {"model": "provider/judgment", "sandbox_mode": "read-only"}),
            ("fp-architect", {"description": "Architecture tuning"}),
        )
        for role, tuning in cases:
            with self.subTest(role=role):
                with tempfile.TemporaryDirectory() as directory:
                    root = Path(directory) / "codex"
                    write_codex(root, {role: role_data(role, **tuning)})
                    self.assertEqual(MODULE.validate_codex_dir(root), [])

    def test_rejects_structurally_invalid_overrides(self):
        cases = (
            ("empty model", "fp-dev", {"model": ""}, "non-empty provider-owned model"),
            ("unsupported provider key", "fp-dev", {"provider": "other"}, "unsupported settings"),
            ("automatic fallback", "fp-dev", {"fallback_model": "provider/judgment"}, "automatic provider/model fallback"),
            ("bad name", "fp-qa", {"name": "fp-dev"}, "name must be"),
            ("reviewer escalation", "fp-reviewer", {"sandbox_mode": "workspace-write"}, "sandbox_mode"),
            ("unknown field", "fp-dev", {"temperature": 0}, "unsupported settings"),
            ("bad effort", "fp-qa", {"model_reasoning_effort": "turbo"}, "unsupported reasoning effort"),
            ("bad agents table", "fp-dev", {"model": "provider/dev"}, "unsupported keys"),
        )
        for label, role, tuning, expected in cases:
            with self.subTest(case=label):
                with tempfile.TemporaryDirectory() as directory:
                    root = Path(directory) / "codex"
                    if label == "bad agents table":
                        write_codex(root, {role: role_data(role, **tuning)})
                        config = root / "config.toml"
                        config.write_text('[agents]\nunsupported = true\n', encoding="utf-8")
                    else:
                        write_codex(root, {role: role_data(role, **tuning)})
                    errors = MODULE.validate_codex_dir(root)
                    self.assertTrue(any(expected in error for error in errors), errors)

    def test_rejects_project_model_or_agent_defaults(self):
        cases = (
            ('model = ""\n', "non-empty provider-owned model"),
            ('[projects.host]\ntrust_level = "trusted"\n', "unsupported settings"),
        )
        for config, expected in cases:
            with self.subTest(config=config):
                with tempfile.TemporaryDirectory() as directory:
                    root = Path(directory) / "codex"
                    write_codex(root, config=config)
                    errors = MODULE.validate_codex_dir(root)
                    self.assertTrue(any(expected in error for error in errors), errors)

    def test_rejects_incomplete_local_role_definition(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "codex"
            write_codex(root, {"fp-dev": {"model": "provider/dev"}})
            errors = MODULE.validate_codex_dir(root)
            self.assertTrue(any("missing settings" in error for error in errors))

    def test_rejects_each_missing_required_native_role_field(self):
        required = ("name", "description", "developer_instructions", "sandbox_mode")
        for field in required:
            with self.subTest(field=field):
                values = role_data("fp-dev")
                del values[field]
                errors = MODULE.validate_codex_config(
                    {}, {"fp-dev": values}, Path("/staged/codex")
                )
                self.assertTrue(any(field in error for error in errors), errors)

    def test_rejects_unknown_local_role_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "codex"
            write_codex(root, {"implementer": {"name": "implementer"}})
            errors = MODULE.validate_codex_dir(root)
            self.assertTrue(any("unsupported local Codex role" in error for error in errors))

    def test_rejects_malformed_role_toml(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "codex"
            write_codex(root)
            role = root / "agents" / "fp-dev.toml"
            role.write_text('model = "unterminated\n', encoding="utf-8")
            errors = MODULE.validate_codex_dir(root)
            self.assertTrue(any("cannot parse" in error for error in errors))

    def test_claude_adapter_references_shared_contract(self):
        engine = (
            "Read AGENTS.md and execute DOCS/guides/manual-loop.md with the same "
            "$ARGUMENTS."
        )
        self.assertEqual(MODULE.validate_claude_contract(engine), [])

    def test_rejects_stale_local_claude_route(self):
        engine = "Launch the `implementer` agent for every task."
        errors = MODULE.validate_claude_contract(engine)
        self.assertTrue(any("shared contract reference" in error for error in errors))

    def test_optional_local_claude_role_is_a_pointer_only(self):
        path = Path(".claude/agents/custom.md")
        self.assertEqual(
            MODULE.validate_local_claude_role(
                "Read AGENTS.md and DOCS/guides/agent-roles.md for the role contract.", path
            ),
            [],
        )
        errors = MODULE.validate_local_claude_role(
            "Read AGENTS.md.\n## Invariants\nmanual-loop owns this.", path
        )
        self.assertTrue(any("recreate" in error for error in errors))

    def test_native_tool_tuning_is_structural_and_superpowers_is_forbidden(self):
        self.assertEqual(
            MODULE.validate_opencode_config(
                {"$schema": "schema", "plugin": ["approved-plugin"], "model": "provider/model"}
            ),
            [],
        )
        self.assertTrue(
            any("Superpowers" in error for error in MODULE.validate_opencode_config(
                {"plugin": ["superpowers@git+https://example.invalid/plugin.git"]}
            ))
        )
        self.assertTrue(
            any("list of strings" in error for error in MODULE.validate_opencode_config({"plugin": "bad"}))
        )
        self.assertEqual(MODULE.validate_claude_settings({"model": "provider/model"}), [])
        self.assertTrue(
            MODULE.validate_claude_settings({"model": ""}),
        )

    def test_rejects_malformed_native_json_objects(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ("opencode.json", "settings.json"):
                path = root / name
                path.write_text("{ malformed", encoding="utf-8")
                value, error = MODULE._parse_json(path)
                self.assertIsNone(value)
                self.assertIn("cannot parse", error)

    def test_shared_contract_checker_preserves_context_retry_and_review_rules(self):
        errors = MODULE.validate_manual_loop_contract(
            "full AGENTS.md and task packet; max 4 implementation attempts; "
            "same error appearing in 2 consecutive attempts; regression tests; "
            "QA edits finish before any gate runs; changed code or task artifacts "
            "invalidate gates and both reviews; explicitly delegate its role packet; "
            "never silently skip QA or independent review; two independent reviews; "
            "staged and unstaged diffs",
            "",
        )
        self.assertEqual(errors, [])

        errors = MODULE.validate_manual_loop_contract("full AGENTS.md", "")
        self.assertTrue(any("same error" in error for error in errors))

    def test_repository_integration_passes_with_staged_inherited_config(self):
        with tempfile.TemporaryDirectory() as directory:
            codex = Path(directory) / "codex"
            write_codex(codex)
            self.assertEqual(MODULE.validate_repository(Path(__file__).parents[2], codex), [])


if __name__ == "__main__":
    unittest.main()
