# T02 human-boundary handoff — implementer report verbatim

Plain-language failure: commit `820221a9` is not self-contained enough to reproduce the recorded green checks because its lock references files absent from the commit and a different `.codex/config.toml`.

Current read-only git-object diagnosis:

- `.codex/manual-loop.lock.json:5` expects config hash `0e2aafb3…`; the committed `.codex/config.toml` hashes to `5c3cfb63…`.
- `.codex/manual-loop.lock.json:6,8-10` references four absent files: `fp-architect.toml`, `fp-qa.toml`, `fp-reviewer.toml`, and `script-runner.toml`. Only `fp-dev.toml` exists.
- `DOCS/guides/codex-manual-loop.md:10-12,57-62` references `scripts/checks/check-codex-manual-loop.py` and says G19 invokes it. That checker is absent from `820221a9`; the committed `doc-code-guards.sh` contains no checker/G19 reference.
- The predecessor gate evidence identifies `3fe4263c` as `git_head` and tested additional working-tree hashes. It therefore covers a dirty working tree containing unfinished configuration-repair dependencies, not the standalone `820221a9` tree.

Candidate scopes:

1. **Preferred:** complete the existing configuration-repair work under its own approved scope, including its atomic files, tests, gates, dual review, and commit; then certify the resulting integrated state while preserving predecessor history and this packet. Risk: broader review may uncover more repair defects. Existing certification findings remain valid historical findings; the reviewed-target evidence needs a supplement or replacement for the integrated state.

2. **Narrow dedicated dependency-boundary repair:** add the four missing role files and checker, integrate the checker into the guard, and reconcile the committed config bytes with the lock in one approved task with tests and review. Risk: high chance of splitting or duplicating the unfinished repair’s atomic scope. Existing findings remain valid, but certification must target the new repaired state.

No correction, retry, SPEC, gate, commit, or file edit was performed.
