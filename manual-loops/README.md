# Manual loops: status and usage

Snapshot: 2026-09-05. Inventory of the 41 records that existed before
`architecture/existing-loops-alignment.md`. Completion below means **recorded
completion**, not a fresh audit of the implementation or its runtime behavior.

## Additional working queues

[PENDIENTES](../PENDIENTES/README.md) maintains separate work items and SPECs.
The 41-record snapshot below covers this directory's original records only;
it does not establish that the repository has no outstanding work. Existing
SPECs in PENDIENTES use the same engine and current AGENTS.md when resumed.
FP-scoped work follows the current [FP delivery guide](../DOCS/guides/manual-loop.md),
including its role routing and evidence rules.

## Draft evaluations awaiting approval

- [Platform-cluster end-to-end evaluation](architecture/end-to-end-evaluation.md):
  product understanding, runtime validation, one real delivery through the existing
  loop, then a record-cleanup proposal. Draft only: complete concrete gates after
  read-only preflight and obtain approval before execution. No cleanup authorized.

## Current state

- 37 SPECs have recorded completed task checklists.
- 1 historical execution record has unverified formal closure: tenant messaging tiers.
- 3 files are reference material, not executable queues.
- No genuine pending task was identified in this inventory. Do not rerun completed
  tasks merely to adopt the current engineering contract.

Maintenance repaired 12 synthetic duplicate pending T01 markers left by an earlier
formatting pass and restored the missing Progress heading in builder-v2. Existing
checked tasks, IDs, decisions, gates, acceptance text, and findings were preserved.
Other historical records remain unchanged, even where their old gate syntax is
unsuitable for a new run. The table identifies each repaired record.

## Inventory

| Record | Recorded status | Maintenance |
|:---|:---|:---|
| [admin-console/README-migracion.md](admin-console/README-migracion.md) | Reference only | Preserved |
| [admin-console/console-redesign-ai.md](admin-console/console-redesign-ai.md) | Recorded complete | Removed synthetic pending T01; restored Progress placement |
| [admin-console/console-redesign-builder-v2.md](admin-console/console-redesign-builder-v2.md) | Recorded complete | Restored Progress heading |
| [admin-console/console-redesign-channels.md](admin-console/console-redesign-channels.md) | Recorded complete | Removed synthetic pending T01; restored Progress placement |
| [admin-console/console-redesign-connections.md](admin-console/console-redesign-connections.md) | Recorded complete | Removed synthetic pending T01; restored Progress placement |
| [admin-console/console-redesign-dashboard.md](admin-console/console-redesign-dashboard.md) | Recorded complete | Removed synthetic pending T01; restored Progress placement |
| [admin-console/console-redesign-foundation.md](admin-console/console-redesign-foundation.md) | Recorded complete | Removed synthetic pending T01; restored Progress placement |
| [admin-console/console-redesign-polish.md](admin-console/console-redesign-polish.md) | Recorded complete | Removed synthetic pending T01; restored Progress placement |
| [admin-console/console-redesign-processes-builder.md](admin-console/console-redesign-processes-builder.md) | Recorded complete | Removed synthetic pending T01; restored Progress placement |
| [admin-console/console-redesign-trace.md](admin-console/console-redesign-trace.md) | Recorded complete | Removed synthetic pending T01; restored Progress placement |
| [admin-console/console-redesign-users-analytics-settings.md](admin-console/console-redesign-users-analytics-settings.md) | Recorded complete | Removed synthetic pending T01; restored Progress placement |
| [admin-console/design/builder-v2-reference/NOTES.md](admin-console/design/builder-v2-reference/NOTES.md) | Reference only | Preserved |
| [agent-mcp-tool-naming.md](agent-mcp-tool-naming.md) | Recorded complete | Preserved |
| [agents/long-running-agent-executions.md](agents/long-running-agent-executions.md) | Recorded complete | Preserved |
| [architecture/dev-mode-validator-fix.md](architecture/dev-mode-validator-fix.md) | Recorded complete | Preserved |
| [architecture/docs-consistency.md](architecture/docs-consistency.md) | Recorded complete | Preserved |
| [architecture/docs-truth-audit.md](architecture/docs-truth-audit.md) | Recorded complete | Preserved |
| [architecture/phase0-rules-inventory.md](architecture/phase0-rules-inventory.md) | Reference only | Preserved |
| [architecture/skills-cleanup.md](architecture/skills-cleanup.md) | Recorded complete | Preserved |
| [architecture/system-validation.md](architecture/system-validation.md) | Recorded complete | Preserved |
| [architecture/uniform-engineering-contract.md](architecture/uniform-engineering-contract.md) | Recorded complete | Preserved |
| [connector-invoke-api.md](connector-invoke-api.md) | Recorded complete | Preserved |
| [connector-trace-linking.md](connector-trace-linking.md) | Recorded complete | Removed synthetic pending T01; restored Progress placement |
| [connectors/connection-call-inspector.md](connectors/connection-call-inspector.md) | Recorded complete | Preserved |
| [connectors/endpoint-scoped-recent-calls.md](connectors/endpoint-scoped-recent-calls.md) | Recorded complete | Preserved |
| [declarative-provisioning.md](declarative-provisioning.md) | Recorded complete | Removed synthetic pending T01; restored Progress placement |
| [demos/crm-support-telegram.md](demos/crm-support-telegram.md) | Recorded complete | Removed synthetic pending T01; restored Progress placement |
| [messaging/envelope-drift.md](messaging/envelope-drift.md) | Recorded complete | Preserved |
| [messaging/tenant-messaging-tiers.md](messaging/tenant-messaging-tiers.md) | Historical execution; closure unverified | Preserved |
| [payload-capture.md](payload-capture.md) | Recorded complete | Preserved |
| [provisioning-manifest-gaps-2.md](provisioning-manifest-gaps-2.md) | Recorded complete | Preserved |
| [provisioning-manifest-gaps-3.md](provisioning-manifest-gaps-3.md) | Recorded complete | Preserved |
| [provisioning-manifest-gaps-4.md](provisioning-manifest-gaps-4.md) | Recorded complete | Preserved |
| [provisioning-manifest-gaps-5.md](provisioning-manifest-gaps-5.md) | Recorded complete | Preserved |
| [provisioning-manifest-gaps.md](provisioning-manifest-gaps.md) | Recorded complete | Preserved |
| [provisioning-skills-section.md](provisioning-skills-section.md) | Recorded complete | Preserved |
| [run-view.md](run-view.md) | Recorded complete | Preserved |
| [samples-reorg.md](samples-reorg.md) | Recorded complete | Preserved |
| [trace-console.md](trace-console.md) | Recorded complete | Preserved |
| [workflow-step-events.md](workflow-step-events.md) | Recorded complete | Preserved |
| [workflow-toggle.md](workflow-toggle.md) | Recorded complete | Preserved |

## Tenant messaging tiers: closure exception

`messaging/tenant-messaging-tiers.md` records T01-T05 execution but has no task
checkboxes. Its final report leaves the live shrink-refusal test unit-tested only
and does not record a final dual-review approval. Its Gates also contain labels
and a `<touched-svc>` placeholder. Keep it as historical evidence. If closure is
needed, create a follow-up SPEC scoped to that verification, with concrete gates;
do not restart T01 or infer a completed formal closeout.

## Using existing records

Use completed records as context and precedent. For a correction, missing proof,
or new requirement, create a follow-up SPEC and link its predecessor. Preserve
historical task IDs and checkboxes; the new SPEC has its own IDs.

## Starting or resuming work

1. Start a new SPEC from `../manual-loops-templates/spec-simple-template.md`.
   Use the canonical template only when dependencies or prior art require it.
   Example new path: `manual-loops/messaging/tenant-messaging-followup.md`.
2. Define the outcome, allowed paths, non-goals, concrete gates and per-task
   acceptance checks. Link required predecessor decisions. Remove placeholders;
   do not copy historical gate commands without checking their applicability.
3. Obtain SPEC approval. Document any required production, deployment, data-change,
   or destructive-operation authorization separately. Checkpoints are not blanket
   authorization for actions outside the approved task.
4. Run the engine preflight: preserve the existing workspace baseline, resolve
   conflicting scope/decisions, and satisfy applicable environment preconditions.
   Every agent receives the current AGENTS.md through the updated engine.
5. In a host configured with `.claude/commands/manual-loop.md`, invoke the slash
   command below after the new SPEC exists and is approved. It is not a shell
   executable. Omit the task ID to process the remaining approved queue.

```text
/manual-loop manual-loops/messaging/tenant-messaging-followup.md T01
```

In Codex or another host without that slash command, ask the principal to execute
T01 of the approved SPEC using `DOCS/guides/manual-loop.md`, including its
implementer, two independent reviewers, and evidence requirements. Missing tools
or capabilities must be reported; they are not implicit permission to skip review.

For a genuinely active SPEC found later, retain IDs and progress; align only the
remaining tasks with current AGENTS.md, explicit scope, and executable acceptance
checks before resuming. Stop on conflicting business decisions rather than silently
changing the feature. No service-wide FP migration follows from adopting the rules.

## Completion and blocking

KISS is the default repository guard. Applicable service tests, typechecks and
integration gates still run. Record commands, exit statuses, output, independent
review results, and exceptions in Progress. A failed gate or missing review blocks
completion; preserve work and report the blocker. Commit only when authorized.

The maintenance evidence lives in
[existing-loops-alignment](architecture/existing-loops-alignment.md). This index is
navigation, not another source of engineering rules: `../AGENTS.md` governs them.
