# SPEC: Existing loops alignment

> Origin: user authorization on 2026-09-05 to adapt existing loops and document usage.
> Engram topic: architecture/existing-loops-alignment

## Goal

Existing loop records cannot accidentally restart completed work. A concise index
distinguishes recorded completion, unresolved status, and reference material, and
explains how to continue work using the current engineering contract.

## User decisions

Preserve task IDs, functional acceptance criteria, decisions, and completed evidence.
Apply current AGENTS.md through the engine; do not copy it into every historical SPEC.
Do not introduce an FP migration or new product behavior while adapting records.

## Constraints

- Full AGENTS.md applies. This is documentation maintenance, not service execution.
- Repair only demonstrably template-generated duplicate pending markers and misplaced
  Progress headings. Do not infer implementation completion from task headings alone.
- Preserve historical task bodies, gates, decisions, and checked entries byte-for-byte.
- Reference documents remain reference documents; list them without executable tasks.
- English artifacts. No service changes, commits, deployment, or destructive cleanup.
- Capture original contents before edits for isolated review and preservation checks.

## Gates

```sh
/bin/bash -n scripts/checks/doc-code-guards.sh
/bin/bash scripts/checks/doc-code-guards.sh
```

Additionally compare original and updated records: task IDs, completed checkbox
entries, task bodies, functional gates, and decisions must be unchanged except
the explicitly identified duplicate marker/heading repair. Record actual evidence.

## Task queue

### T01: Classify existing loops, repair misleading status, and document usage

Allowed writes: new `manual-loops/README.md`; the nine console-redesign SPECs with
the exact synthetic `T01` pending marker; `console-redesign-builder-v2.md` for its
missing Progress heading; `connector-trace-linking.md`, `declarative-provisioning.md`,
and `demos/crm-support-telegram.md` for the same synthetic marker repair.

Read all existing loop records as necessary to produce an inventory. The initial
scan found 41 Markdown files before this SPEC: 3 references, 37 SPECs with checked
tasks (12 also have a contradictory template placeholder), and tenant-messaging-tiers
with dated implementation reports but no task checklist. Treat the latter as a
historical execution record with unverified formal closure, not a new pending queue.
If actual evidence differs, report it rather than changing completion state.

In repaired files, place Progress above the existing completion list and remove
only the synthetic pending block. Keep the substantive record intact. The index
must list every original file, classify based on recorded evidence, identify
repairs/uncertainties, and provide concrete instructions for a new follow-up SPEC
and `/manual-loop <spec> [task-id]`. Explain that the slash command belongs to
the configured command host, not a shell executable. Never instruct rerunning a
completed task to adopt new rules. Include a short checklist for future active
SPECs: scope, concrete gates and acceptance, authorizations, baseline, evidence.

**Accept:** Gates pass, preservation checks pass, all 41 original files appear
in the index, and two independent reviews approve the isolated changes. User-facing
summary distinguishes historical recorded completion from fresh runtime validation.

## Progress

- [x] T01: Inventory, repair status metadata, and document use.

Evidence (2026-09-05):

- Inventory: 41 original files, excluding this maintenance SPEC and the new index.
  37 recorded completed checklists; 3 references; 1 historical execution with
  formal closure unverified. No genuine pending task identified in that inventory.
- Changed 13 original files: removed 12 synthetic pending T01 blocks and placed
  Progress before their existing completed lists; restored builder-v2's heading.
  Added `manual-loops/README.md`. No functional task or acceptance text changed.
- Baseline: `/tmp/loops-t01-6org4sfs/baseline/`; isolated diff:
  `/tmp/loops-t01-6org4sfs/changes.diff`.
- Preservation check: `ruby /tmp/loops-t01-6org4sfs/check.rb`, exit 0:
  41 records indexed; 13 metadata-only repairs; 28 records byte-identical;
  all completed entries, task headings and substantive content preserved;
  no synthetic pending markers remain. Both reviewers independently reran it.
- `/bin/bash -n scripts/checks/doc-code-guards.sh`: exit 0.
- `/bin/bash scripts/checks/doc-code-guards.sh`: exit 0,
  `KISS doc/code guards passed.` DI scanned zero modified code files, so this
  is not service-wide validation. The guard's internal read-only Git queries ran;
  no direct Git operation, commit, push, or deployment was performed.
- Verification retry: the initial checker used `\s*` before checkbox entries,
  which captured blank lines and produced a false preservation failure. Restricted
  the helper to spaces/tabs; it passed. No document correction was needed.
- Execution fallback: delegated implementer `01a071e7-4ecd-71c3-a1c6-11206f456fa3`
  captured the baseline and inventory but stalled on interpreting the no-Git
  restriction as forbidding the approved guard. Parent stopped it and performed
  the documentation edits and gates directly. This departure from agent-only
  implementation is recorded explicitly; independent reviews were retained.
- Reviewer A `01a07207-0475-73d1-a14e-dd16662acdd5`: APPROVED.
- Reviewer B `01a07207-04ca-7551-bd06-a17ce8b956b6`: APPROVED.
  Both inherited the parent's model without weaker overrides, inspected the
  isolated diff, and independently passed preservation checks. Runtime, migration,
  cluster and remote CI tests were not run: this task changes documentation only.
- Reviewed diff SHA256:
  `fea6e12227a8b66035885b3f4598f1e980475eb6e611389a33c39273abe7ecec`.
  Index SHA256:
  `f1fd58c3e4d61f77b15a9f6a322ccf894261399293b11845b8bd774c8f560c7d`.
- Engram is unavailable in this session; this SPEC persists the decision and
  evidence. Temporary baseline/check artifacts are local review aids, not a
  permanent test suite or portable artifact archive.

## Out of scope

Executing historic tasks, certifying current runtime behavior, changing product
requirements, rewriting reference reports, and remote CI/protection configuration.

## Human boundaries

The user authorized this adaptation. New functional work requires its own SPEC;
conflicting business decisions are not resolved by this documentation change.
