# Predecessor certification deviations

This record reports the two deviations established from
`manual-loops/architecture/blocker-handoff-diagnosis-evidence/`. It does not
correct either deviation or assess blame or intent.

## DEVIATION A — approved Accept and recorded execution differ

The current T01 Accept in
`manual-loops/architecture/blocker-handoff-diagnosis.md:174-180` is:

```text
**Accept**
```

```sh
grep -n "For humans" DOCS/guides/manual-loop.md && \
grep -n "non-causal" DOCS/guides/manual-loop.md && \
grep -n "creates no budget" DOCS/guides/manual-loop.md && \
grep -c "Max 4 implementation attempts per task" DOCS/guides/manual-loop.md
```

`T01-attempt2-gate-04.txt` records this execution in full:

```text
COMMAND: grep -n "For humans" DOCS/guides/manual-loop.md && grep -n "non-causal" DOCS/guides/manual-loop.md && grep -n "creates no budget" DOCS/guides/manual-loop.md && grep -c "Max 4 implementation attempts per task" DOCS/guides/manual-loop.md
EXIT_STATUS: 0
ELAPSED_SECONDS: 0.012824874953366816
STDOUT:
157:     those paths are not allowed. The record OPENS with a "## For humans"
164:   - Label execution exceptions that did not cause the failure as non-causal, so
167:     creates no budget, and creates no continuation SPEC. Requesting it does not
1

STDERR:
```

The human-approved certification SPEC records that the approved predecessor T01
Accept used `grep -n "Para humanos"`, while the attempt 2 evidence above records
`grep -n "For humans"`. The executed command therefore differed from the approved
command, contrary to the mechanical-execution contract in
`DOCS/guides/agent-roles.md`, which requires the executor to execute only the
exact commands supplied by the approved SPEC.

The predecessor evidence does not contain an approval-time copy of the SPEC or
the original `Para humanos` command. The present predecessor SPEC is the final
file and already contains `For humans`; by itself it cannot establish who changed
the command or when. The available record therefore does not distinguish between
a runner substitution and an edit to the SPEC during execution. That cause is
not recorded.

`T01-gate-04.stdout.txt`, the attempt 1 output, contains:

```text
157:     those paths are not allowed. The record OPENS with a "## For humans"
164:   - Label execution exceptions that did not cause the failure as non-causal, so
167:     creates no budget, and creates no continuation SPEC. Requesting it does not
1
```

`T01-gates.json` associates that output with the `grep -n "For humans"` command.
The substitution was therefore already present in the recorded attempt 1 gate,
before the objection round. These records still do not establish whether the
runner substituted the command or the SPEC had already been changed.

## DEVIATION B — final independent verdicts are absent

`independent-review-verdicts.json` reads in full:

```json
[
  {
    "run": "01a08230-49e4-7700-bf92-c2ccaef49efb",
    "final_verdicts": []
  },
  {
    "run": "01a08230-94f8-7673-89b0-e35ee7090c30",
    "final_verdicts": []
  }
]
```

Enumerating evidence names with `ls -1 ... | grep -i review` returns only:

```text
T01-review-attempt1.md
independent-review-verdicts.json
```

`T01-review-attempt1.md` records two verdicts over T01 attempt 1: Reviewer A
returned APPROVED and Reviewer B returned REJECTED. Both runs in
`independent-review-verdicts.json` have empty `final_verdicts` arrays. No
predecessor task therefore has two recorded APPROVED verdicts over its final
state. No verdict of any kind is recorded for T01 attempt 2 or for T02 through
T05.

The attempt 1 review closes with: "No implementation edit is currently indicated
by either verdict." The objection round was therefore consumed by evidence
defects while the implementation was already correct. The attempt-budget
consequence is out of scope here and belongs to the separate SPEC.
