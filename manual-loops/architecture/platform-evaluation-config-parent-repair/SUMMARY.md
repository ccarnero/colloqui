# Configuration-test parent repair — current summary

Status: implementation complete; validation failed procedurally; awaiting a narrow human boundary amendment. This task is not complete or terminally closed.

Achieved: native fp-dev added exactly two recursive EVIDENCE_ROOT parent mkdir calls before existing strict UUID leaf mkdir calls in e2e/platform-evaluation-config.test.mjs. No other test byte changed. Hash: 9a9fd4a7694c7505ecbdc7b29806e177bb0d9a7990624d2bb26984ab52e8aa48. QA confirmed exact patch and sufficient existing 14-case cold/warm coverage. Read-only reconciliation preserves 3817 other baseline entries, including prior harness and compaction work. No commit, configuration change or product runtime operation.

Attempts: T01 1/4 consumed; attempt2/4 unused. Prior R01 stays exhausted1/1 and J1–J5 NOT RUN. No budget reset.

Observed failure: native Luna-low runner dispatched the packet twice inside attempt1, violating no-replay. The first dispatch lost its process identity/full output; its manifests establish ownership of four new UUID sentinel files, not reusable gate passes. The second dispatch overwrote gate-results.json: G0 exit0 (1.890s), G1 exit1 (0.043s) at cold prerequisite; its tests/G2/G3 did not run. First G3 is unknown. No final independent approval exists. The runner acknowledged its incorrect initial report of exactly one dispatch.

Remaining: approve the concrete active/proposed-boundary-amendment.md before exact generated-fixture retirement and fresh attempt2/4 validation. Existing SPEC explicitly forbids cold cleanup before gates and retains sentinels through review; the intermediate failed-attempt record does not authorize the exception. QA confirmed this boundary. The prepared exclusive-dispatch wrapper has not been executed. All temporary evidence and four fixtures are preserved while the decision is pending.

Actual native provenance: dev run01a0874b-0e02-7f80-9eb1-6298e1b26bca / turn01a0874b-0e4f-7bc1-bed7-cbaf9126dffc, Sol-medium. Runner run01a08747-c3e8-7810-9b14-0e7a74630a2e / turn01a0874e-832c-78f1-8e0c-7ccc36234400, Luna-low. QA run01a086ab-0d43-7703-8d15-a6706bd2a579, Sol-medium. Detailed current native evidence remains active, not retired. User subscription applicability and existing economical-tier exception remain settled; no new billing permission is required.

Engram topic: platform-cluster/platform-evaluation-config-parent-repair. Repository record only.
