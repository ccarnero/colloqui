# Skill Resolver — Universal Protocol

Any agent that **delegates work to sub-agents** MUST follow this protocol to
resolve and pass relevant skills. This applies to the ATL orchestrator,
judgment-day, and ANY future skill or workflow that launches sub-agents.

## The contract: paths, not summaries

The registry is an **index, not a summary**. The delegator selects skills and
passes their exact `SKILL.md` paths; the sub-agent reads those files itself.
This is the registry's own contract, verbatim (`.atl/skill-registry.md:24-26`):

> **Delegator use only.** This registry is an index, not a summary. Any agent
> that launches subagents reads it to select relevant skills, then passes exact
> `SKILL.md` paths for the subagent to read before work.
>
> `SKILL.md` remains the source of truth. Do not inject generated summaries or
> compact rules by default; pass paths so subagents load the full runtime
> contract and preserve author intent.

Human decision, 2026-07-31 (SPEC `manual-loops/architecture/skills-cleanup.md`,
T03): paths win. Generated summaries drift from the `SKILL.md` they summarize
and strip author intent; a path always resolves to the current text.

## Why This Exists

Sub-agents are born with NO context about what skills exist. Without skill
resolution, a judge reviewing admin-console code will not know the token rules
in `yz-ui`, and a fix agent will not know the tenancy rules in `multi-tenant`.

## When to Apply

Before EVERY sub-agent launch that involves **reading, writing, or reviewing
code**. Skip only for purely mechanical delegations (e.g. "run this test
command").

## The Protocol

### Step 1: Obtain the Skill Registry (once per session)

Resolution order:

1. Already cached from earlier in this session? → use cache
2. `mem_search(query: "skill-registry", project: "{project}")` →
   `mem_get_observation(id)` for full content
3. Fallback: read `.atl/skill-registry.md` in the project root — the real
   artifact. Its own header names the command that produces it,
   `gentle-ai skill-registry refresh --force` (`.atl/skill-registry.md:3`). The
   file is gitignored (`.gitignore:96`), so it may be absent in a fresh clone;
   run that command to create it.
4. No registry found? → proceed without skills, and warn the user: "No skill
   registry found — sub-agents will work without project-specific standards.
   Run `gentle-ai skill-registry refresh --force` to fix this."

### Step 2: Match Relevant Skills

The registry's `## Skills` table has four columns —
`Skill | Trigger / description | Scope | Path` (`.atl/skill-registry.md:30-31`).
Match on TWO dimensions, always deferring to the `Trigger / description` column
as the source of truth:

**A. Code Context** — what files will the sub-agent touch or review?

- `services/admin-console/**`, `.scss`, Angular components → `yz-ui`, `angular-*`
- `.ts` in `services/` or `packages/` → the relevant domain skill
  (`multi-tenant` for tenancy, `envelope-messages` for bus code)
- `*.test.*`, `*.spec.*` → testing skills
- Commit authoring → `git-commit`

**B. Task Context** — what ACTIONS will the sub-agent perform?

| Sub-agent action | Match skills whose trigger mentions… |
|-----------------|--------------------------------------|
| Write/review code | the specific framework, language, or domain |
| Create a commit | "commit" |
| Adversarial review | "dual review", "judgment day" |

### Step 3: Pass Paths to the Sub-Agent

Add a block to the sub-agent's prompt listing the selected `Path` values
verbatim from the registry table, and instruct it to read them first — this is
the registry's own loading protocol (`.atl/skill-registry.md:67-69`):

```
## Skills to load before work

Read these files before reading, writing, reviewing, testing, or creating
anything:
- {absolute path to SKILL.md #1}
- {absolute path to SKILL.md #2}
```

This goes BEFORE the sub-agent's task-specific instructions.

**Key rule**: pass PATHS. Do not paste digests or summaries — the sub-agent
reads the full `SKILL.md`, which is the source of truth.

### Step 4: Include Project Conventions

The repo's normative document is `AGENTS.md`; it indexes the rest
(`AGENTS.md:96-106`). When the sub-agent will work on the project's code, add:

```
## Project Conventions
- AGENTS.md — normative; read the sections relevant to your target
- {any file AGENTS.md points at that is directly relevant}
```

Paths are cheap; the sub-agent reads them only if relevant to its task.

## Token Budget

Passing paths costs ~10-20 tokens per skill, so a delegation matching 3-4
skills adds well under 100 tokens. The sub-agent then pays the read cost only
for the skills it actually needs.

If more than **5 skill paths** match, keep only the 5 most relevant (prioritize
code-context matches over task-context matches).

## Compaction Safety

This protocol is compaction-safe because:

- The registry lives in engram / on the filesystem, not in the orchestrator's
  memory
- Each delegation re-reads the registry if needed (Step 1 handles cache miss)
- Paths are copied into each sub-agent's prompt at launch time — even if the
  orchestrator forgets, the sub-agents already have their reading list

## Feedback Loop

Sub-agents MUST report their skill resolution status in their return envelope:

- `injected` — received a `## Skills to load before work` list from the
  orchestrator and read those files (ideal path)
- `fallback-registry` — no list received, self-resolved from the registry
- `fallback-path` — no list received, loaded a `SKILL.md` by guessing its path
- `none` — no skills loaded at all

**Orchestrator self-correction rule**: if a sub-agent reports anything other
than `injected`, the orchestrator MUST:

1. Re-read the skill registry immediately (it may have been lost to compaction)
2. Ensure ALL subsequent delegations include `## Skills to load before work`
3. Log a warning to the user: "Skill cache miss detected — reloaded registry
   for future delegations."

This prevents silent degradation where the orchestrator forgets skills after
compaction and all subsequent sub-agents work without standards.

## Integration Points

- **ATL Orchestrator**: follows this protocol for ALL delegations
- **judgment-day** (`skills/judgment-day/SKILL.md`, Pattern 0): follows this
  protocol before launching Judge A, Judge B, and the Fix Agent
- **Any future skill that delegates**: MUST reference this protocol
