# DOCS/v_next — future design

**Status: FUTURE. Nothing in this folder describes how the platform behaves today.**

The repo's documentation had two classes until now
(`manual-loops/architecture/docs-consistency.md` decision 5):

| Class | Meaning | Example |
|---|---|---|
| **descriptive** | Describes the system AS BUILT. Code wins on any disagreement; the doc is the bug. | `DOCS/messaging/service-bus.md`, service READMEs |
| **prescriptive** | Defines the CONTRACT the code must satisfy. The doc wins; the code is the bug. | `DOCS/messaging/envelope.md` |

`DOCS/v_next/` is the **third class**:

| Class | Meaning |
|---|---|
| **future** | An agreed DIRECTION that is not implemented. Neither the code nor the doc is a bug — the work simply has not been done. |

## Rules

1. **Never cite a `v_next/` document as as-built behavior.** If you need to know
   what the platform does today, read the code or a descriptive doc. A `v_next/`
   doc is a plan; quoting it as current behaviour is how "documented" features
   that never shipped get believed.
2. **Never cite it as a binding contract either.** Prescriptive docs say what the
   code MUST do now. These say what we intend to build later. A reviewer cannot
   reject code for disagreeing with a `v_next/` doc.
3. **Guards do not validate this folder against today's code.**
   `scripts/checks/doc-code-guards.sh` locks descriptive claims to the code;
   applying it here would fail by construction, because these documents
   deliberately describe absent behaviour.
4. **Every document lists its prerequisites to become active** — the concrete,
   numbered work that must land first. That list is the whole point: it turns
   "someday" into a reviewable scope.
5. **When a design ships, the document leaves.** Move the content into the
   descriptive/prescriptive doc it belongs to, and leave a dated pointer behind
   in the loop SPEC that shipped it. `v_next/` is a staging area, not an archive.

## Why this class exists

Without it, an agreed-but-unbuilt design has only two homes, and both corrupt:
written into a descriptive doc it becomes a false claim about the system, and
dropped entirely it gets rediscovered as a "finding" every few months. The
`TENANT_TIER_LIMITS` tier design was rediscovered exactly that way
(docs-consistency T07 finding 8) after living for months as constants with no
consumer on the primary path.

## Contents

| Document | Subject | Prerequisites |
|---|---|---|
| [`tenant-messaging-tiers.md`](tenant-messaging-tiers.md) | Per-tenant messaging capacity tiers (`free`/`pro`/`enterprise`) for the ingress stream | 5, listed in the doc |
