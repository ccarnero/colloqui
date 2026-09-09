"""Regression tests for G19: manual-loop role texts identical in Codex and Claude Code."""

import importlib.util
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "checks" / "check-loop-roles-sync.py"
SPEC = importlib.util.spec_from_file_location("check_loop_roles_sync", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)

BODY = "You implement exactly ONE task per launch.\n\n## Return\n\nReport files changed."


def write_pair(root: Path, codex_body: str, claude_body: str) -> None:
    (root / ".codex/agents").mkdir(parents=True)
    (root / ".claude/agents").mkdir(parents=True)
    for codex_rel, claude_rel in MODULE.PAIRS:
        (root / codex_rel).write_text(
            f'name = "{Path(codex_rel).stem}"\ndescription = "d"\nmodel = "m"\nmodel_reasoning_effort = "medium"\n'
            f"sandbox_mode = \"read-only\"\ndeveloper_instructions = '''{codex_body}'''\n",
            encoding="utf-8",
        )
        (root / claude_rel).write_text(
            f"---\nname: x\ndescription: d\ntools: Read\nmodel: opus\n---\n\n{claude_body}\n", encoding="utf-8"
        )


class LoopRolesSyncTests(unittest.TestCase):
    def test_identical_bodies_pass(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            write_pair(Path(tmp), BODY, BODY)
            self.assertEqual(MODULE.compare(Path(tmp)), [])

    def test_front_matter_is_ignored_and_whitespace_tolerated(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            write_pair(Path(tmp), BODY + "\n\n", "  " + BODY)
            self.assertEqual(MODULE.compare(Path(tmp)), [])

    def test_different_bodies_fail_naming_the_pair(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            write_pair(Path(tmp), BODY, BODY.replace("ONE", "TWO"))
            errors = MODULE.compare(Path(tmp))
            self.assertEqual(len(errors), len(MODULE.PAIRS))
            self.assertIn("fp-dev.toml vs .claude/agents/implementer.md", errors[0])

    def test_missing_file_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            write_pair(Path(tmp), BODY, BODY)
            (Path(tmp) / ".claude/agents/reviewer.md").unlink()
            self.assertTrue(any("missing role file" in e for e in MODULE.compare(Path(tmp))))

    def test_malformed_codex_role_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            write_pair(Path(tmp), BODY, BODY)
            (Path(tmp) / ".codex/agents/extra.toml").write_text('name = "other"\nmodel = "m"\n', encoding="utf-8")
            errors = MODULE.compare(Path(tmp))
            self.assertTrue(any("extra.toml: missing or empty description" in e for e in errors))
            self.assertTrue(any("must equal the file stem" in e for e in errors))

    def test_repository_roles_are_in_sync(self) -> None:
        self.assertEqual(MODULE.compare(MODULE.ROOT), [])


if __name__ == "__main__":
    unittest.main()
