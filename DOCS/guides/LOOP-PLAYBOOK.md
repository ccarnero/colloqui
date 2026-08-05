# Loop Engineering — the project playbook

Class: prescriptive
Summary: How to build and maintain an autonomous task loop in this repo — the four pieces, the human boundaries, the verification rings, the seven golden rules, and the knowledge-preservation protocol.

> Distilled from building the message-tracking system (July 2026).
> This document is the recipe for assembling and maintaining loops in this repo,
> and the protocol for preserving knowledge over a horizon of years.
>
> **Pointers refreshed 2026-08-03** (docs-truth-audit T08). The distillation —
> the 4 pieces, the human boundaries, the verification rings, the 7 golden rules
> — is kept verbatim; the only corrections were the concrete artifacts it named
> that no longer exist. The current engine is `.claude/commands/manual-loop.md`
> and the current norm is `AGENTS.md`; where this playbook and AGENTS.md
> disagree, **AGENTS.md wins**.
>
> **Translated to English 2026-08-04** (docs-truth-audit T10, ruling D33). It was
> written in Spanish, which AGENTS.md rule 5 forbids for repo artifacts. Content
> is unchanged — this is a translation, not a rewrite.

---

## 1. What a loop is (one sentence)

Make Claude repeat, without human intervention, the cycle
**take a small task → do it → verify it against an automatic judge →
persist → take the next one** — and stop only at the human boundaries.

## 2. The 4 pieces (always the same ones)

| # | Piece | What it is | In this repo |
|---|-------|--------|--------------|
| 1 | **The queue** | Small, ordered tasks, each with an executable acceptance criterion. Machine-generated or decomposed from a SPEC. | `manual-loops/<area>/<name>.md` (authored from `manual-loops-templates/`); historically also `.sdd/changes/*/tasks.md`. There is no `SPEC.md` at the repo root. |
| 2 | **The judge** | A deterministic signal that says yes/no without asking: tests, the compiler, a golden set. **It is built BEFORE the product.** | per-service tests, `golden/labeled.tsv` (≥90%), each SPEC's gates (`G0` = `scripts/checks/doc-code-guards.sh`). The synthetic `lab/expected.tsv` used by the message-tracking system is no longer in the repo. |
| 3 | **The rules** | Prohibitions and obligations in files the agent always reads. What matters is enforced in code/permissions, not in prose. | **`AGENTS.md` is the constitution** (the single normative file, root only — guard G6g in `doc-code-guards.sh` forbids per-component agent files); `TAXONOMY.md`; `CLAUDE.md` is reduced to a 5-line pointer at AGENTS.md and is gitignored on top of that |
| 4 | **The written cycle** | The loop as a slash command: pop → implement → verify → review → commit or revert. | `.claude/commands/manual-loop.md` (the current generic engine; `build-console.md` is its console-specific predecessor and is still in the repo), `.claude/agents/{implementer,reviewer}.md` |

## 3. The standard cycle (sequential, no worktrees)

```
INVARIANT: clean git status between tasks. One task at a time.

Per task:
1. Pre-flight: codegraph_status → sync if anything is pending
2. IMPLEMENTER (model: opus): codegraph_explore before reading,
   codegraph_impact before editing. Repo style: pure functions,
   one function per file, Result types, schemas imported from
   packages/shared, correlation via packages/observability.
3. Verify: the package's tests + the gates (classifier vs golden).
   Red = iterate. Max 4 attempts. Same error twice = no progress:
   revert, note it in BLOCKED.md, move on to the next task.
4. 2 REVIEWERS in parallel (they inherit the session's model,
   read-only + codegraph, they see only the diff, they assume it is
   wrong). They reject: a duplicated schema, a classification with no
   rule cited, reinvented correlation, a workaround with a long
   justification.
5. Green + APPROVED = atomic commit. Otherwise = revert.
6. Next task.
```

**Parallelism principle**: parallelize what reads (reviewers),
serialize what writes (a single implementer). Like an RWLock.

**Models per role**: expensive intelligence where there is judgement
(orchestration and review), cheap throughput where there is volume
(implementation). The concrete model names from July 2026 age within weeks and
are omitted on purpose. The `.ywai/sdd-profiles.json` once cited as a reference
no longer exists: `.ywai/` is retired and must not be resurrected (AGENTS.md,
"Retired 2026-07-29").

## 4. The human boundaries (the loop MUST stop here)

- Naming a business function / creating a taxonomy rule
- Approving the scope of an exception (e.g. stage-1 compliance)
- Labelling/correcting the golden set
- Approving destructive inventories (reset) — Claude writes the idempotent
  script with a dry-run; the human runs `--apply`
- Any change under a declared sensitive area

If something a machine could have resolved reaches the human → the loop is
badly assembled. If the loop resolves something on this list by itself → worse.

## 5. Verification rings (strictest to most tolerant)

```
synthetic set (correct by construction)                   → demands 100%
golden/labeled.tsv (real traffic audited by a human)      → demands ≥90%
unknown at runtime (the alarm)                            → discovers the new
```

(The message-tracking system's synthetic set lived in `lab/expected.tsv`; that
directory is no longer in the repo. The middle ring is still here: `golden/`
keeps `labeled.tsv`, `raw/`, `README.md` and `REVIEW.md`.)

`unknown` is the alarm, never the drawer: legacy has its own bucket, and
anything not implemented is NOT pre-provisioned (it lands in unknown once it
exists, and that is when the rule is added against the real subject).

## 6. Knowledge preservation (a project measured in years)

### The three memories, and what belongs in each

| Memory | What it holds | Lifetime |
|---------|-----------|------|
| **Repo (.md artifacts + golden + fixtures)** | The current truth: rules, schemas, known drift, decisions with their rationale | Years. Versioned. It IS the trunk. |
| **Engram (`~/.engram/engram.db`)** | The narrative WHY: decisions, discoveries, bugs with root cause, session summaries. topic_key = upsert | Years. Cross-session and cross-tool. |
| **Claude sessions** | The reasoning in flight | Disposable. Ephemeral branches. |

### The quadruple behind every decision

Every decision is recorded with: **(1)** the rule (TAXONOMY.md §table),
**(2)** the why (a decision note in §7), **(3)** the evidence (a code citation
**by name**: a constant, a function or a file — NOT `file:line`; the August 2026
docs audit found dozens of `:NNN` cites that had rotted within days, so the
binding form is the symbol's name), **(4)** the engram topic. With that
quadruple, anyone (or Claude) two years from now reconstructs the context in
minutes. Without it, the archaeology costs days.

### The golden rules

1. **If you have to re-explain something in chat, it is missing documentation.**
   Stop, write it into the artifact it belongs in, carry on. Every
   re-explanation is a bug in the project's memory.
2. **The human never hand-edits the artifacts the loop maintains.**
   Decisions arrive by prompt; the loop persists them with their
   justification. That is how the artifacts never diverge from their history.
3. **Rulebook, judge and code move in the same commit.**
   (a new taxonomy rule = update TAXONOMY.md + golden + the classifier
   together, or the gate lies in one direction or the other).
4. **When the output is wrong, fix the process, not the output.**
   Editing the loop's prompt / adding a rule to the reviewer beats fixing the
   commit by hand. The manual fix is lost; the process fix repeats itself
   forever.
5. **Self-sufficiency test**: every so often, a 100% fresh session that reads
   only the repo. If it can continue the work with no explanations, the
   artifacts are healthy. If not, you found the hole.
6. **Exceptions with a name and an exact width**: every special case
   (stage-1 accountid) lives at the edge, references its DRIFT.md entry, and
   carries the inverse test guaranteeing it is no wider than the known case.
7. **Work backwards from the end**: first "how do I know it is right?" (the
   judge), then everything else.

### Maintaining the live system

- **A new event appears** → it lands in `unknown` → alarm → human decision on
  the rule → rule+golden+classifier in one commit → engram.
- **New drift** → DRIFT.md with its state (confirmed / no longer observed /
  no traffic to verify). Re-verify the old findings after every large change:
  drift that "disappears" is information too.
- **The golden ages** → recapture it after significant platform changes;
  archive the old one under a name (`golden/_pre-X/`), never delete it without
  leaving the findings in DRIFT.md.
- **Engram grows** → periodic hygiene: `engram conflicts scan` to detect
  memories that contradict each other (a new decision that overrides an old one
  must supersede it explicitly, not coexist with it).
- **DOCS/archive/INDEX.md** is the map of the session documents — every large
  delivery leaves its doc and updates the index.

## 7. Origin story (for whoever arrives later)

This playbook came out of building the message-tracking system:

1. **Phase 0 (definition)**: schema inventory (SCHEMAS.md), a taxonomy with
   7 user decisions (TAXONOMY.md), the docs-vs-code-vs-traffic verification
   triangle (DRIFT.md), and a golden set labelled and audited through
   Spanish-language stories (golden/REVIEW.md).
2. **The judge found real bugs before the product was written**:
   5 root causes of broken correlation chains, diagnosed and fixed
   (fixes 1-4, commits b8e1480/f3cec02/0f806b0) — the definitive golden
   (72 events) closes 6/6 chains.
3. **Build loop**: SPEC.md + build-console.md +
   implementer(opus)/reviewer(fable). Blockers escalated correctly:
   rule 19 (platform/workflow-execution) and stage-1 ingress
   (canonical-with-known-drift, option A).

Central lesson: **the maturity of the repo's artifacts determines the quality
of the loop far more than the cleverness of the prompt.** A loop is not
designed in a vacuum — it is distilled from what the project already does well.
