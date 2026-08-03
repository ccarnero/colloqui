---
name: skill-registry
description: >
  Generate or update the project's skill registry — an INDEX of every installed
  skill (trigger, scope, absolute SKILL.md path) that delegators read to select
  which skills a sub-agent must load. The registry passes paths, never summaries.
  Trigger: After installing/removing skills, when bootstrapping a new project,
  when the user asks to "update skill registry" / "rebuild skill-registry" /
  "sync skills".
license: Apache-2.0
metadata:
  author: Yoizen
  version: "2.0"
  scope: [root]
  auto_invoke:
    - "update skill registry"
    - "rebuild skill-registry"
    - "skill registry"
    - "sync skills"
    - "refresh skills"
allowed-tools: [Read, Edit, Write, Glob, Grep, Bash]
---

## Purpose

Generate or update the **skill registry** — an index of every available skill
with its trigger, scope, and absolute `SKILL.md` path. Any delegator reads the
registry to pick relevant skills, then passes those paths to the sub-agent,
which reads the full `SKILL.md` itself.

This is the foundation of the **Skill Resolver Protocol**
(`skills/_shared/skill-resolver.md`).

## The contract: index, not summary

The registry does **not** contain digests, summaries, or "compact rules". Its
own contract says so, verbatim (its `## Contract` section):

> **Delegator use only.** This registry is an index, not a summary. Any agent
> that launches subagents reads it to select relevant skills, then passes exact
> `SKILL.md` paths for the subagent to read before work.
>
> `SKILL.md` remains the source of truth. Do not inject generated summaries or
> compact rules by default; pass paths so subagents load the full runtime
> contract and preserve author intent.

Human decision, 2026-07-31 (SPEC `manual-loops/architecture/skills-cleanup.md`,
T03): paths win over summaries. A summary drifts from the file it summarizes;
a path always resolves to the current text.

## Preferred path: run the generator

The registry is produced by a CLI, and running it is the normal way to refresh:

```bash
gentle-ai skill-registry refresh --force
```

The output file names this command in the HTML comment at the top of the file.
Everything below documents the protocol so a human or an LLM can rebuild the
file by hand when the CLI is unavailable.

> **Never cite `.atl/skill-registry.md` by line number.** It is regenerated per
> machine and its `## Skills` table grows or shrinks with whatever skills that
> machine has installed, so every offset below the table moves. Cite its section
> headings. (All `:NNN` cites into it were removed on 2026-08-03,
> docs-truth-audit T08.)

## When to Run

- After installing or removing skills in `skills/` or `~/.<agent>/skills/`.
- After bootstrapping a new project.
- When the user explicitly asks to refresh or regenerate the registry.

## What to Do

### Step 1: Scan Skills

Glob `*/SKILL.md` across every known skill directory. Scan ALL that exist, not
just the first match.

**User-level (global skills):** `~/.claude/skills/`,
`~/.config/opencode/skills/`, `~/.gemini/skills/`, `~/.codex/skills/`,
`~/.copilot/skills/`, `~/.agents/skills/`.

**Project-level (workspace skills):** `{project-root}/skills/`,
`{project-root}/.claude/skills/`, `{project-root}/.agents/skills/`,
`{project-root}/.github/skills/`.

Note: in this repo `.claude/skills` is a symlink to `skills/` (`AGENTS.md`,
"Where the rest lives"), so the same skills resolve through both paths —
deduplicate by skill name.

**SKIP** the following directories:
- `sdd-*` — SDD workflow skills, not coding/task skills
- `_shared` — shared helpers, not independent skills
- `skill-registry` — this very skill

**Deduplicate:** if the same skill name appears in multiple locations, keep the
project-level version (more specific). If only user-level, keep the first
found.

For each remaining skill, read ONLY the frontmatter of `SKILL.md` and extract:
- `name`
- `description` (the trigger text lives here, usually after `Trigger:`)
- `metadata.scope`
- the absolute path to the `SKILL.md`

Reading the frontmatter is enough — the registry stores no body content.

### Step 2: Write the Registry

Build the registry markdown with this shape (mirrors the generator's output —
compare against `.atl/skill-registry.md`):

```markdown
# Skill Registry — {project name}

Last updated: {YYYY-MM-DD}

## Sources scanned

- {each directory globbed in Step 1}

## Contract

**Delegator use only.** This registry is an index, not a summary. Any agent that launches subagents reads it to select relevant skills, then passes exact `SKILL.md` paths for the subagent to read before work.

`SKILL.md` remains the source of truth. Do not inject generated summaries or compact rules by default; pass paths so subagents load the full runtime contract and preserve author intent.

## Skills

| Skill | Trigger / description | Scope | Path |
| --- | --- | --- | --- |
| `{name}` | {description incl. trigger} | {project|user} | `{absolute path to SKILL.md}` |

## Loading protocol

1. Match task context and target files against the `Trigger / description` column.
2. Pass only the matching `Path` values to the subagent under `## Skills to load before work`.
3. Instruct the subagent to read those exact `SKILL.md` files before reading, writing, reviewing, testing, or creating artifacts.
4. If no matching skill exists, proceed without project skill injection and report `skill_resolution: none`.
```

### Step 3: Persist the Registry

**This step is MANDATORY — do NOT skip it.**

#### A. Always write the file (guaranteed availability)

Create `.atl/` in the project root if it does not exist, then write:

```
.atl/skill-registry.md
```

`.atl/` is already gitignored in this repo (`.gitignore` lists `.atl/`) — the registry is
a local artifact, regenerated per machine. Add `.atl/` to `.gitignore` when
working in a project where it is missing.

> Do NOT write `.ywai/`. That directory is retired for this repo and must not
> be resurrected (`AGENTS.md`, "Retired 2026-07-29 (do not resurrect)").

#### B. If engram is available, also persist cross-session

```
mem_save(
  title: "skill-registry",
  topic_key: "skill-registry",
  type: "config",
  project: "{project}",
  content: "{registry markdown from Step 2}"
)
```

`topic_key` ensures upserts — re-running updates the same observation.

### Step 4: Return Summary

```markdown
## Skill Registry Updated

**Project**: {project name}
**Location**: .atl/skill-registry.md
**Engram**: {saved / not available}

### Skills Found
| Skill | Scope |
|-------|-------|
| {name} | {scope} |

### Next Steps
Delegators read this registry once per session and pass matching SKILL.md
PATHS to sub-agents via their launch prompts. Re-run after installing or
removing skills.
```

## Rules

- ALWAYS write `.atl/skill-registry.md`; never `.ywai/` (`AGENTS.md`, "Retired 2026-07-29 (do not resurrect)").
- ALWAYS save to engram when `mem_save` is available — fall back silently when not.
- SKIP `sdd-*`, `_shared`, and `skill-registry` directories when scanning.
- Read ONLY frontmatter — the registry indexes skills, it does not digest them.
- NEVER generate compact rules, digests, or summaries of a skill's body
  (its `## Contract` section).
- Paths in the table MUST be absolute so a sub-agent can read them from any cwd.
- If no skills are found, write an empty registry (with the Contract and
  Loading protocol sections intact) so delegators do not waste time searching.

## Resources

- `skills/_shared/skill-resolver.md` — the delegator-side protocol that consumes
  this registry.
- `gentle-ai skill-registry refresh --force` — the generator that produces
  `.atl/skill-registry.md` (named in that file's header, `:3`).
