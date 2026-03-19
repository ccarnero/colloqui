---
name: sdd-init
description: >
  Bootstrap the SDD structure in any project. Detects stack, conventions, and initializes
  the active persistence backend.
  Trigger: "sdd init", "iniciar sdd", "initialize specs", "setup sdd", "bootstrap sdd",
  "configurar sdd", "preparar proyecto", "/sdd:init".

metadata:
  author: Yoizen
  version: "3.0"
  scope: [root]
---

## Purpose

You are a sub-agent responsible for bootstrapping Spec-Driven Development (SDD) in a project. You detect the project stack and conventions, then initialize the active persistence backend.

## Execution and Persistence Contract

Read and follow `skills/_shared/persistence-contract.md` for mode resolution rules.

- If mode is `engram`: Read and follow `skills/_shared/engram-convention.md`. Persist project context to Engram. Do NOT create `openspec/`.
- If mode is `openspec`: Read and follow `skills/_shared/openspec-convention.md`. Run full directory bootstrap.
- If mode is `none`: Return detected context inline without writing project files.

## What to Do

### Step 1: Detect Project Context

Read the project to understand:
- Tech stack (check package.json, go.mod, pyproject.toml, Cargo.toml, *.csproj, etc.)
- Existing conventions (linters, test frameworks, CI/CD pipelines)
- Architecture patterns in use
- Monorepo vs single-project structure (check for workspaces, nx.json, lerna.json, turbo.json)
- Existing documentation patterns (ADRs, RFCs, CHANGELOG)

> **Monorepo detection**: If the project is a monorepo, initialize at the root level.
> Individual packages/apps should reference the root config unless they need independent SDD cycles.

### Step 2: Initialize Persistence Backend

#### engram mode

Persist project context following `skills/_shared/engram-convention.md` with `topic_key: sdd-init/{project-name}`.

Content to persist:

```markdown
# Project Context: {project-name}

## Stack
{detected stack}

## Architecture
{detected patterns}

## Testing
{detected test framework}

## Style
{detected linting/formatting}

## CI/CD
{detected pipeline}

## Monorepo
{yes/no — if yes, list workspace packages}
```

#### openspec mode

Create this directory structure:

```
openspec/
├── config.yaml              ← Project-specific SDD config
├── specs/                   ← Source of truth (empty initially)
└── changes/                 ← Active changes
    └── archive/             ← Completed changes
```

Generate `openspec/config.yaml` based on what you detected. See `skills/_shared/openspec-convention.md` for the full config format.

Keep `context:` concise — no more than 10 lines.

#### none mode

Return the detected context inline. Do not write any files.

### Step 3: Handle Existing Installation

| Situation | Action |
|-----------|--------|
| `openspec/` already exists | Read existing config, report current state, ask orchestrator whether to upgrade or skip |
| Engram artifact `sdd-init/{project}` already exists | Read it, report current state, ask orchestrator whether to update |
| Config is corrupted (openspec mode) | Back up to `openspec/config.yaml.bak`, generate fresh config |
| Schema version mismatch (upgrading from v1) | Migrate config: add `schema_version: 2` and new rule keys, preserve custom rules |

### Step 4: Return Summary

#### engram mode

```markdown
## SDD Initialized

**Project**: {project name}
**Stack**: {detected stack}
**Persistence**: engram

### Context Saved
- **Engram ID**: #{observation-id}
- **Topic key**: sdd-init/{project-name}

No project files created.

### Next Steps
Ready for /sdd:explore <topic> or /sdd:new <change-name>.
```

#### openspec mode

```markdown
## SDD Initialized

**Project**: {project name}
**Stack**: {detected stack}
**Persistence**: openspec

### Structure Created
- openspec/config.yaml ← Project config with detected context
- openspec/specs/      ← Ready for specifications
- openspec/changes/    ← Ready for change proposals

### Next Steps
Ready for /sdd:explore <topic> or /sdd:new <change-name>.
```

#### none mode

```markdown
## SDD Initialized

**Project**: {project name}
**Stack**: {detected stack}
**Persistence**: none (ephemeral)

### Context Detected
{summary of detected stack and conventions}

### Recommendation
Enable engram or openspec for artifact persistence across sessions.
Without persistence, all SDD artifacts will be lost when the conversation ends.

### Next Steps
Ready for /sdd:explore <topic> or /sdd:new <change-name>.
```

## Rules

- NEVER create placeholder spec files — specs are created via sdd-spec during a change
- ALWAYS detect the real tech stack, don't guess
- NEVER force `openspec/` creation unless mode explicitly resolves to `openspec`
- Keep config.yaml context CONCISE — no more than 10 lines
- Return a structured envelope with: `status`, `executive_summary`, `artifacts`, `next_recommended`, and `risks`
