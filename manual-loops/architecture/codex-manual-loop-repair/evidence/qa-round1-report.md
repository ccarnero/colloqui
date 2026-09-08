QA_NOT_READY_FOR_GATES

Coverage findings:

1. **Stale archive record:** [DOCS/archive/INDEX.md](/Users/chris/sources/yoizen/platform-cluster/DOCS/archive/INDEX.md:1757) says protected-file installation and remaining role invocations are pending. Both are recorded as complete in the SPEC and native provenance. T01 permits one truthful row, so lines 1761–1763 must be updated before gates.

2. **Symlink boundary gap:** [check-codex-manual-loop.py](/Users/chris/sources/yoizen/platform-cluster/scripts/checks/check-codex-manual-loop.py:139) rejects direct file symlinks but accepts a symlinked `.codex` directory or `.codex/agents` directory because child paths appear as regular files. This violates acceptance case 3’s local-file boundary. Reject symlinked configuration and agents directories before traversal.

3. **Missing boundary regressions:** Add cases to [test_codex_manual_loop.py](/Users/chris/sources/yoizen/platform-cluster/scripts/tests/test_codex_manual_loop.py:193) proving symlinked `.codex` and `.codex/agents` directories fail validation. A table-driven expansion across every role’s model, effort, name, and sandbox pins would also fully lock acceptance cases 1 and 4; current negative pin coverage mutates only `fp-dev`.

Other findings:

- Current repair files exactly match all 17 hashes in `final-preqa-manifest.json`.
- Preservation evidence checked 3,547 baseline paths and reports no unexpected changes.
- Generic structural validation and its existing tests remain intact; `script-runner` coverage was added without weakening tests.
- Native provenance identifies all five loaded roles with the approved models and efforts. The configured QA smoke child was `gpt-5.6-sol`, medium, run `01a07e65-4d12-7463-938c-23827324efc6`.
- Protection documentation correctly distinguishes sandbox enforcement, hash drift detection, human policy, host mutability, and remote branch protection.
- No files changed during QA. No tests, gates, builds, E2E, retries, reviews, commits, or network actions ran.

Requested current QA provenance: `gpt-5.6-sol`, medium. Observed current-turn model/run telemetry was unavailable inside this role and must be extracted independently by the principal.
