## For humans

Certification stopped because the predecessor's commits omit configuration files
that were present when its checks passed. One reviewer rejected this dependency
boundary and the other approved; the required pair of approvals does not exist.
The deviations report is committed, and the certification packet is preserved.
Recommended next step: finish the existing configuration repair in its own scope,
then certify the integrated committed state without rewriting predecessor history.
The human decides that scope; no retry or repair starts from this record.

## Implementer handoff note

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

## Evidence

- SPEC: `manual-loops/architecture/blocker-handoff-certification.md`, revision 3.
- Blocked task: T02, 2026-09-08, attempt 1. Human-boundary stop after predecessor
  merits rejection, not attempt-budget exhaustion. No retry was launched.
- T01 completed with four exit-0 commands and two APPROVED reviews, committed
  as `4e26001a`. T02 has four exit-0 commands but A REJECTED / B APPROVED;
  it is unchecked and uncommitted. T03-T05 were not started.
- Exact rejection and approval: `T02-review-verdicts.md`, also copied verbatim
  to SPEC Progress. Both assessed the packet/evidence AND the required full
  predecessor diff/log. No principal verdict substitutes for either reviewer.
- Reviewed T02 state: `T02-state.json`, SHA-256
  `27a4eb92bfd3155d55bfd5bb3b18659455e3a7219cdcc122bd389d9ba1461894`.
  Packet SHA-256: `1c5617dba36c44c348bda325dd5e26813154d9c563cb0771776a04040974e6db`.
- Gates: `T02-gates.json`, four raw result JSON and stdout files. Each exact
  command ran once, sequentially; exit statuses, native durations and outputs
  are preserved. No gate was rerun to diagnose the committed target.
- Native roles: Sol medium implementation/QA, Luna low runner, two Astra high
  reviewers. Actual session/turn identities: `T02-dev-provenance.json`,
  `T02-qa-provenance.json`, `T02-gates.json`, `T02-review-provenance.json`.
  Read-only handoff identity: `T02-handoff-provenance.json`.
- Preservation: `T02-post-gate-preservation.json` verified the frozen state;
  `T02-block-preservation.json` verifies only the authorized evidence-only SPEC
  Progress changed afterwards. Handoff and verdict records do not change the
  reviewed packet or predecessor artifacts.
- This diagnosis inspects Git objects now; it is not represented as original
  predecessor evidence or a reconstructed original gate result.
- Non-causal exceptions: inspection truncations were recovered; reviewer B
  corrected an inspection parser schema mismatch. Earlier T01 reading/inventory
  and Git sandbox exceptions remain in preflight and Progress. No model fallback,
  implementation/gate retry, skipped declared command, or service rebuild.
