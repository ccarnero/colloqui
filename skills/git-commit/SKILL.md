---
name: git-commit
description: >
  Git commit standards for THIS repo (platform-cluster): conventional commits,
  no AI attribution, one commit per green manual-loop task, and the repo's real
  (very small) hook surface.
  Trigger: When creating commits, preparing a release, or wiring git hooks.
license: Apache-2.0
metadata:
  author: Yoizen
  version: "2.0"
  scope: [root]
  auto_invoke:
    - "commit"
    - "git"
    - "versioning"
    - "changelog"
    - "release"
allowed-tools: []
---

> **Normative source**: `AGENTS.md` → "Universal rules" 5 — "All artifacts in
> English: code, comments, UI strings, docs, commit messages. Conventional
> commits, no AI attribution." Where this skill and AGENTS.md disagree,
> **AGENTS.md wins** and this file is the one that gets fixed.
>
> **Corrected 2026-08-03 (docs-truth-audit T08).** v1 of this skill described a
> lefthook + commitlint + `develop`-branch + GitHub-issues setup that this repo
> has never had, and its frontmatter carried the `metadata:` block three times
> over (two of the copies auto-invoking on the retired `sdd` keyword). Every
> claim below is now checked against the repo.

## When to Use It

- When creating commits in this repository
- When bumping `sdk/`'s version or its `CHANGELOG.md` (the only changelog here)

## Critical Patterns

- **ALWAYS** follow the **Conventional Commits** format: `type(scope): subject`
- **ALWAYS** write commit messages in English (`AGENTS.md` universal rule 5)
- **NEVER** add `Co-Authored-By` or any AI attribution. `AGENTS.md` rule 5 says
  "no AI attribution" and the loop engine `.claude/commands/manual-loop.md`
  step 6 says "No Co-Authored-By" outright. A human co-author trailer is still
  allowed for real pair programming, but never for a tool.
- **NEVER** write subjects in past tense ("fixed", "added"); use imperative mood ("fix", "add")
- **ALWAYS** keep the title at **50 characters** or fewer
- **ALWAYS** add a `BREAKING CHANGE:` footer for backward-incompatible changes
- **NEVER** bundle multiple logical changes into one commit; keep them atomic and focused
- **Scope a manual-loop commit to its task**, e.g.
  `feat(workflow-service): T03 block disabled executions`, and include the SPEC
  file in the same commit (`.claude/commands/manual-loop.md` step 6).
- **`Fixes #123` issue trailers do nothing here.** This repo has no GitHub issue
  workflow: `.github/` contains zero tracked files
  (`git ls-files .github | wc -l` → 0). Use them only if that changes.

## Commit Conventions

### Conventional Commits

This project uses **Conventional Commits** for structured commit messages:

**Format**:
```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types**:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only changes
- `style`: Code style changes (formatting, missing semi colons, etc.)
- `refactor`: Code refactoring without adding features or fixing bugs
- `perf`: Performance improvement
- `test`: Adding or updating tests
- `chore`: Maintenance tasks, build process, dependency updates
- `ci`: CI/CD configuration changes

**Scopes** (common examples):
- `api`: API changes
- `backend`: Backend changes
- `frontend`: Frontend changes
- `domain`: Domain layer changes
- `infrastructure`: Infrastructure changes
- `migration`: Database migrations
- `docs`: Documentation changes
- `tests`: Test changes

## Commit Message Examples

### Feature Commit

```bash
feat(agents): add agent versioning support

- Implement agent version tracking
- Add version comparison endpoint
- Add version restoration functionality
```

### Bug Fix Commit

```bash
fix(api-gateway): resolve NaN flowId in metrics

- Validate flowId before processing
- Add error logging for invalid IDs
- Fix metrics aggregation
```

### Refactor Commit

```bash
refactor(agents): simplify agent creation flow

- Remove duplicate validation logic
- Consolidate versioning service
- Improve error handling

BREAKING CHANGE: Agent creation API now requires version parameter
```

### Documentation Commit

```bash
docs: update agent skill documentation

- Add integration patterns section
- Update examples
- Fix typos in README
```

## Commit Standards

### Title Guidelines

- Use imperative mood: "add" not "added" or "adds"
- Don't end with period
- Limit to 50 characters (including type/scope)

### Body Guidelines

- Wrap at 72 characters
- Use imperative mood
- Explain **what** and **why** (not **how**)
- Reference issues with `Fixes #123`

### Footer Guidelines

- **Breaking changes**: Start with `BREAKING CHANGE:`
- **References**: `Fixes #123`, `Closes #456`
- **Co-authors**: For multiple authors

## Git Hooks

**There is no commit-message enforcement in this repo.** Nothing validates the
conventional-commit format, the 50-character subject, or the imperative mood —
the rules above are enforced by review, not by a hook. Verified:

```bash
fd -H -g 'lefthook*' .        # nothing
fd -H -g 'commitlint*' .      # nothing
fd -H -g '.husky' .           # nothing
git config core.hooksPath     # empty → plain .git/hooks
```

v1 of this skill printed a `lefthook.yml` `pre-commit`/`commit-msg`/`pre-push`
configuration and told you to `cat lefthook.yml`. No such file has ever existed
here, and the `npm run lint:fix` / `npm run typecheck` / `npm run test:unit`
commands it wrapped do not exist either — the root `package.json` declares
**no `scripts` key at all** (`rg -n '"scripts"' package.json` → no matches; its
only keys are `name`, `private` and `devDependencies`). See
`references/GIT-HOOKS.md` for the real surface.

The three hooks that DO exist:

| Hook | Where | What it does |
|---|---|---|
| `post-merge`, `post-checkout` | `.git/hooks/` (untracked — a fresh clone has neither) | Fire `scripts/cbm-reindex.sh` under `nohup`, log to `.git/cbm-reindex.log`, always `exit 0`. Setup: `cowork/codebase-memory-mcp-setup.md`. |
| `PostToolUse` (Claude Code, not git) | `.claude/settings.json`, matcher `Edit\|Write\|MultiEdit` | Runs `scripts/claude-hook-lint-test.sh` on the edited file — biome check plus a `vitest related` step that is inert outside `admin-console` (that script's own header says so). Always exits 0. |

## Versioning

> **Scope check.** Nothing in `services/` or `packages/` is versioned or
> released: they are built as `dev.local/<service>:local` images by
> `rebuild-redeploy.sh`, never published. The SemVer / release-branch / changelog
> material below applies to **`sdk/` only**, the one package with a
> `CHANGELOG.md` (`fd -H -g 'CHANGELOG.md' .` → `sdk/CHANGELOG.md`) — and even
> that is `private: true` at `0.1.0`, so no tag has ever been cut. Treat this
> section as the convention to follow *when* something here starts being
> released, not as a description of today.

### Semantic Versioning

Use **Semantic Versioning** (SemVer):

**Format**: `MAJOR.MINOR.PATCH`

- **MAJOR**: Breaking changes
- **MINOR**: New features (backward compatible)
- **PATCH**: Bug fixes (backward compatible)

**Example**: `1.5.0` → `2.0.0` (breaking)
**Example**: `1.5.0` → `1.6.0` (new feature)
**Example**: `1.5.0` → `1.5.1` (bug fix)

### Version Bumping

When to increment:

| Change | Type | Example |
|--------|------|---------|
| Breaking change | MAJOR | `1.5.0` → `2.0.0` |
| New feature (backward compatible) | MINOR | `1.5.0` → `1.6.0` |
| Bug fix (backward compatible) | PATCH | `1.5.0` → `1.5.1` |

### Release Branches

**Naming**: `release/vX.Y.Z`

```bash
# Create release branch
git checkout -b release/v1.6.0

# Make release commits
git commit -m "chore(release): prepare for v1.6.0 release"

# Merge to main
git checkout main
git merge release/v1.6.0

# Tag release
git tag -a v1.6.0 -m "Release v1.6.0"
```

## Changelog

### Changelog Format

Based on conventional commits, maintain `CHANGELOG.md`:

```markdown
# Changelog

## [2.0.0] - 2024-01-15

### Added
- Agent versioning support
- Agent comparison endpoint
- Version restoration functionality

### Changed
- Improved agent creation flow
- Simplified validation logic

### Deprecated
- Legacy agent API (use agents/v2)

### Removed
- Old agent caching mechanism

### Fixed
- NaN flowId in metrics
- Agent dirty state tracking

### Security
- Added input validation for agent names
- Updated JWT token handling
```

## Finding Related Code

### Search Git Configuration

```bash
# Confirm there is still no commit-message enforcement (all four return nothing)
fd -H -g 'lefthook*' .
fd -H -g 'commitlint*' .
fd -H -g '.husky' .
git config core.hooksPath

# The hooks that do exist
ls -la .git/hooks | rg -v sample
rg -n PostToolUse -A6 .claude/settings.json

# The only changelog / the only versioned package
fd -H -g 'CHANGELOG.md' .
rg -n '"version"' sdk/package.json
```

### Search Commit Patterns

```bash
# Find recent commits
git log --oneline -20

# Find commit messages by type
git log --grep="^feat:" --oneline
git log --grep="^fix:" --oneline

# Find breaking changes
git log --grep="BREAKING CHANGE:" --oneline
```

## Common Patterns

### Feature Addition

```bash
# Make changes
git add .

# Commit with proper format
git commit -m "feat(agents): add agent tools configuration

- Add tool input/output mapping
- Support integration and piece tool types
- Add custom description support"

# Push to remote
git push origin feature/agent-tools

# Create PR from feature/agent-tools to main
```

### Bug Fix

```bash
# Make changes
git add .

# Commit with reference
git commit -m "fix(webapi): handle missing agent ID

- Add null check for agentId parameter
- Return 400 Bad Request instead of 500 error
- Add error logging

Fixes #456"

# Push
git push origin fix/missing-agent-id
```

### Breaking Change

```bash
# Update code to breaking API
git add .

# Commit with BREAKING CHANGE footer
git commit -m "feat(agents): restructure agent configuration model

BREAKING CHANGE: Agent configuration now uses new model
- Old agent format no longer supported
- Migration required for existing agents
- See migration guide in docs/migration.md

Migrates #123"
```

### Release Preparation

```bash
# Update version in package.json
npm version minor --no-git-tag-version

# Update CHANGELOG.md
git add CHANGELOG.md
git commit -m "chore(release): update CHANGELOG for v1.6.0"

# Create release branch
git checkout -b release/v1.6.0

# Update any additional files
vim version.ts
git commit -am "chore(release): bump version to 1.6.0"

# Merge and tag
git checkout main
git merge release/v1.6.0
git tag -a v1.6.0 -m "Release v1.6.0"

# Push tags and main
git push origin main --tags
```

## Troubleshooting

> No git hook can fail your commit in this repo — there is no `commit-msg` and
> no `pre-commit` hook (see `references/GIT-HOOKS.md`). The two entries this
> section used to carry ("Commit Hook Failed", "Pre-commit Hook Failed") were
> describing a lefthook setup that does not exist. What can actually reject your
> work is a **reviewer**, so the checklist is the same one they apply.

### A reviewer rejected the commit message

1. Use conventional format: `type(scope): subject`
2. Keep subject under 50 characters, imperative mood, no trailing period
3. Use a valid type: feat, fix, docs, style, refactor, perf, test, chore, ci
4. Write it in English and strip any `Co-Authored-By` / AI attribution
   (`AGENTS.md` universal rule 5)

### Lint or tests failed

1. `npx biome check --write .` to auto-fix formatting and lint
2. Run the suite of the package you touched (there is no root `npm test`)
3. `./scripts/checks/doc-code-guards.sh` if you touched docs or scripts
4. Fix remaining issues manually, then commit again

### Merge Conflicts

**Error**: Git merge conflict

**Solution**:
```bash
# Start merge
git merge feature/branch

# Resolve conflicts in conflicted files
# Edit and save files

# Mark as resolved
git add <resolved-files>

# Complete merge
git commit -m "chore: resolve merge conflicts with feature/branch"
```

## Best Practices

### Small, Focused Commits

- One logical change per commit
- Keep changes atomic and testable
- Avoid bundling unrelated changes

### Descriptive Messages

- Explain **what** changed and **why**
- Include context for future maintainers
- Reference related issues or PRs

### Consistent Formatting

- Use same format across all commits
- Follow conventional commits specification
- Use proper line wrapping (72 characters)

### Test Before Commit

There is no root test runner — the root `package.json` declares **no `scripts`
key at all** (`rg -n '"scripts"' package.json` → no matches), so
`npm run test:unit` / `npm run lint` / `npm run typecheck` do not exist. Run the
suite of the thing you touched:

- A service or package: its own `test` script (`bun test` or `tsx --test`,
  per that directory's `package.json`)
- `sdk/`: `cd sdk && bun run build && bun test`
- Lint/format: `npx biome check .` (`biome.json` at the repo root)
- Browser e2e: `npx playwright test` (see the `playwright` skill)
- Doc/code drift: `./scripts/checks/doc-code-guards.sh`

Under the manual-loop system the binding list is the SPEC's own **Gates**
section, run verbatim — not this list.

### Atomic Changes

- Each commit should pass all tests
- Never commit broken code
- Use branches for work-in-progress

## References
- [BRANCHING.md](references/BRANCHING.md)
- [COMMIT-MESSAGE-FORMAT.md](references/COMMIT-MESSAGE-FORMAT.md)
- [GIT-HOOKS.md](references/GIT-HOOKS.md)

This skill ships **no `assets/`**. v1 advertised
`assets/scripts/commit.sh` and `assets/scripts/release.sh`; neither has ever
existed (`fd -H . skills/git-commit` lists only this file and the three
references above).
