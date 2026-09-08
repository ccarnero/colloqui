QA_READY_FOR_GATES

Acceptance coverage:

1. Mandatory configuration and five-role pin validation remains covered.
2. Generic structural validation and all prior tests are preserved.
3. Contract existence, retired-role rejection, direct and ancestor symlink rejection, and lock drift/removal remain covered.
4. Approved model, effort, name, and sandbox pins remain unchanged.
5. Native loading proof still identifies all five roles with matching current role hashes.
6. Runner refusal/no-fallback and cost-policy boundaries remain documented.
7. Sandbox, drift detection, human policy, host mutability, and remote-protection limits remain distinct.
8. Round-3 preservation checks all 3,547 baseline paths with no unexpected changes.
9. The frozen state is ready for new gates and dual review; round-2 gates/reviews are stale after correction.

Correction coverage is sufficient:

- `validate_policy_data` returns the existing structural diagnostic for non-string `developer_instructions` and skips unsafe membership operations.
- `validate_project` preserves and deduplicates that diagnostic.
- Pure and real-filesystem table cases cover `7`, `123`, boolean, float, date, time, datetime, array, and inline-table TOML values.
- Test inventory increased from 16 to 18 methods; none were removed or weakened.
- Ancestor `.codex` and `.codex/agents` symlink regressions remain present.
- Only the checker and its test changed between round 2 and round 3.
- All 17 current artifact hashes match `round3-manifest.json`; its SHA-256 is `8c09af1a22290378414b79b86f6eb10f0b78a285d1ff81fc3075c5ba5aaae050`.
- All nine full new-file packet contents match current files.

Changed test path by implementation: `scripts/tests/test_codex_manual_loop.py`. QA edits: none. Blockers: none.

No tests, gates, builds, E2E, installs, commits, network operations, delegation, retries, or closure ran. The six gates and both independent reviews must now run against round 3.

Provenance requested: native `fp-qa`, `gpt-5.6-sol`, medium, agent path `/root/repair_qa_round3`. Current run/model telemetry is unavailable inside this role and requires the principal’s independent extraction.

Read-only inspection fallbacks: Git’s stat operation attempted a sandbox-denied Xcode cache write, so manifest and plain-diff comparisons were used. Two temporary extraction attempts were sandbox-denied; no file was created, and in-memory `jq` comparisons replaced them. A hash command was retried after zsh reserved-variable and executable-path errors. No repository content changed.
