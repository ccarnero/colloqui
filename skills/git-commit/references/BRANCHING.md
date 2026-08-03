# Git Branching Strategy

Guide for Git branching strategy.

> **Corrected 2026-08-03 (docs-truth-audit T08).** This file was written as
> generic GitFlow and prescribed a `develop` integration branch, protected-branch
> rules, and a GitHub PR workflow. **None of the three exists here.** Checked:
> `git branch -a --format='%(refname:short)' | rg 'develop|/dev$'` returns
> **zero** matches locally and on `origin`; `.github/` contains zero tracked
> files (`git ls-files .github | wc -l` → 0), so there is no PR template, no
> CODEOWNERS and no status check to require. Everything below has been rewritten
> to the single-trunk flow the repo actually uses. The GitFlow release-branch
> material that remains is kept only as the convention for `sdk/`, the one
> package that is versioned at all — see `git-commit/SKILL.md` § Versioning.

## Overview

**Single trunk: `main`.** Work happens on a topic branch cut from `main` and
merges back to `main`. There is no integration branch.

## Branch Types

### Main Branch

| Branch | Purpose | Protected |
|--------|---------|-----------|
| `main` | The trunk — the only long-lived branch | Not enforced by any config in this repo; treat it as protected by convention |

### Topic Branches

Create topic branches from `main`:

```bash
git checkout main
git pull origin main
git checkout -b feature/dashboard-updates
```

The prefixes actually in use in this repo today are `feature/`, `features/`,
`bugfix/` and `poc/`. Several older branches carry no prefix at all
(`yzclaw`, `orbstack-sh-fixes`, `kustomize+dev-ai-wf`) — those are history, not
a pattern to copy. Use `feature/` or `bugfix/` for new work.

Under the manual-loop system a SPEC runs on one topic branch and each green task
becomes one commit on it (`.claude/commands/manual-loop.md` step 6).

### Bugfix Branches

Create bugfix branches from `main`:

```bash
git checkout main
git pull origin main
git checkout -b bugfix/login-timeout
```

There is no `hotfix/` convention here and no production environment to hotfix:
developer mode ships a single `dev` environment
(`ENVIRONMENTS=(dev)` in both bootstrap scripts), so a bugfix branch is the
whole story.

## Branch Naming Conventions

### Feature Branches

Pattern: `feature/{description}`

```
✅ Good Examples:
feature/user-authentication
feature/dashboard-updates
feature/agent-execution-metrics
feature/analytics-reports

❌ Bad Examples:
new-feature
authentication
feature
feat-user-auth
```

### Bugfix Branches

Pattern: `bugfix/{description}`

```
✅ Good Examples:
bugfix/login-timeout
bugfix/memory-leak
bugfix/orbstack-cluster-setup   ← a real branch in this repo

❌ Bad Examples:
fix
bug
fix-login
patch
```

### Release Branches

Pattern: `release/{version}`

```
✅ Good Examples:
release/v1.0.0
release/v2.1.0

❌ Bad Examples:
release
v1.0.0
release-1.0.0
```

## Workflow: Feature Development

### 1. Create Feature Branch

```bash
# Start from main — there is no develop branch in this repo
git checkout main
git pull origin main

# Create feature branch
git checkout -b feature/user-authentication
```

### 2. Work on Feature

```bash
# Make changes
# Write code
# Run tests
# Commit with proper format
git add .
git commit -m "feat: add user authentication service"
```

### 3. Sync with Main

```bash
# Periodically sync with main
git fetch origin
git rebase origin/main

# Or merge main into the topic branch
git merge origin/main
```

### 4. Push Topic Branch

```bash
# Push to remote
git push origin feature/user-authentication
```

### 5. Create Pull Request

```bash
gh pr create --base main --head feature/user-authentication
```

Note: `.github/` holds zero tracked files, so there is no PR template, no
CODEOWNERS, and no required status check — a PR here is a review surface, not a
gate. The gate is the SPEC's own **Gates** section plus dual adversarial review.

### 6. Merge to Main

```bash
# After review and approval
# Squash merge, or merge commit — team preference
```

### 7. Delete Feature Branch

```bash
# Delete local branch
git branch -d feature/user-authentication

# Delete remote branch
git push origin --delete feature/user-authentication
```

## Workflow: Bugfix

```bash
# Create bugfix from main — the only base branch here
git checkout main
git pull origin main
git checkout -b bugfix/login-timeout

# Fix the bug, with its regression test in the same commit
# (AGENTS.md universal rule 4)
git add .
git commit -m "fix(api-gateway): resolve login timeout issue"

# Push and create PR
git push origin bugfix/login-timeout
gh pr create --base main --head bugfix/login-timeout
```

There is no separate hotfix path: developer mode has one `dev` environment and
no production to patch out-of-band.

## Workflow: Release

> Applies to **`sdk/` only** — see `git-commit/SKILL.md` § Versioning. Nothing
> under `services/` or `packages/` is released; those are built as local
> `dev.local/<service>:local` images. No release branch or tag has been cut in
> this repo yet, so treat this as the convention to adopt, not a description of
> past practice.

### 1. Create Release Branch

```bash
# From main
git checkout main
git pull origin main
git checkout -b release/v1.0.0

# Update sdk/package.json version
# Update sdk/CHANGELOG.md
```

### 2. Test Release Branch

```bash
# There is no root test runner: the root package.json declares no "scripts"
# key at all (rg -n '"scripts"' package.json → no matches). For the SDK:
cd sdk && bun run build && bun test
```

### 3. Merge to Main

```bash
# Merge release to main
git checkout main
git merge release/v1.0.0

# Tag release
git tag -a v1.0.0 -m "Release v1.0.0"
git push origin main --tags
```

### 4. Delete Release Branch

```bash
git branch -d release/v1.0.0
git push origin --delete release/v1.0.0
```

(There is no step to merge back into an integration branch — `main` is the only
long-lived branch.)

## Branch Protection

**None is configured in this repository.** `.github/` holds zero tracked files,
so there is no CODEOWNERS, no PR template, and no workflow to require as a
status check; `git config core.hooksPath` is empty and there is no lefthook or
commitlint config (see [GIT-HOOKS.md](GIT-HOOKS.md)). Any protection is either
set server-side on the GitHub repo — outside this tree, so this file cannot
assert it — or is convention.

What actually gates a change here is the manual-loop system: the SPEC's Gates
section run verbatim plus two independent adversarial reviews, both of which
must return APPROVED before the commit (`.claude/commands/manual-loop.md`).

## Common Git Commands

### Branch Management

```bash
# List all branches
git branch -a

# List local branches
git branch

# List remote branches
git branch -r

# Create new branch
git checkout -b feature/new-feature

# Delete local branch
git branch -d feature/new-feature

# Delete remote branch
git push origin --delete feature/new-feature

# Rename branch
git branch -m old-name new-name
```

### Syncing

```bash
# Fetch all branches
git fetch --all

# Pull latest changes
git pull origin main

# Sync with remote
git pull --rebase origin main

# Rebase on top of the trunk
git rebase origin/main
```

### Merging

```bash
# Merge branch into current
git merge feature/new-feature

# Squash merge (single commit)
git merge --squash feature/new-feature

# Merge with no fast-forward
git merge --no-ff feature/new-feature
```

### Divergence

```bash
# Check if branch is ahead/behind
git status

# See commits unique to the branch
git log main..feature/new-feature

# See commits on main the branch does not have
git log feature/new-feature..main
```

## Best Practices

1. **Branch from `main`**: it is the only base branch here
2. **Descriptive Names**: use the `feature/` or `bugfix/` prefix
3. **Frequent Commits**: Commit small, logical changes
4. **Commit Message Format**: Follow Conventional Commits
5. **Sync Regularly**: Rebase or merge with base branch often
6. **Clean Up**: Delete merged branches
7. **Pull Requests**: Use PRs for all merges to protected branches
8. **Code Review**: All changes must be reviewed before merge
9. **Tests**: Ensure all tests pass before creating PR
10. **Update Documentation**: Update docs when needed

## Finding Branches

```bash
# List all branches
git branch -a

# List feature branches
git branch -a | grep feature/

# List bugfix branches
git branch -a | grep bugfix/

# List remote branches
git branch -r

# See which branches are merged
git branch --merged

# See which branches are unmerged
git branch --no-merged

# View commit history of branch
git log feature/new-feature --oneline -10
```

## Troubleshooting

### Merge Conflicts

```bash
# When merging and conflicts occur:
git merge feature/new-feature

# Resolve conflicts manually in files
git add resolved-file.ts
git commit -m "merge: resolve conflicts"
```

### Diverged Branches

```bash
# When branch and remote have diverged:
git pull origin main

# Choose strategy:
# 1. Merge: git pull origin main (default)
# 2. Rebase: git pull --rebase origin main
# 3. Reset: git reset --hard origin/main
```

### Orphaned Branches

```bash
# Find branches that aren't on remote
git branch --no-contains origin/main

# Clean up old branches
git branch -d old-feature-branch
```

## Related Skills

- **`git-commit`** - Commit message format and the real hook surface
- **`playwright`** - the browser E2E suite

(There is no `testing` or `biome` skill in this repo. `fd -g 'SKILL.md' skills`
lists eleven, none of them by those names; run `biome` directly with
`npx biome check .`.)
