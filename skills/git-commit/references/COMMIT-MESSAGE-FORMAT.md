# Commit Message Format

Guide for writing commit messages using Conventional Commits.

## Overview

This project uses **Conventional Commits** format for all git commits. This convention:
- Makes commit history readable
- Enables automated changelog generation
- Facilitates semantic versioning
- Supports automated release processes

## Commit Message Format

```
type(scope): description

[optional body]

[optional footer]
```

### Components

| Component | Description | Required |
|-----------|-------------|----------|
| `type` | Type of change | **Required** |
| `scope` | Area of change | Optional |
| `description` | Brief description of change | **Required** |
| `body` | Detailed description | Optional |
| `footer` | Breaking changes or references | Optional |

## Commit Types

The project supports these commit types:

| Type | Description | Example |
|------|-------------|---------|
| `feat` | New feature | `feat: add user authentication` |
| `fix` | Bug fix | `fix(api): resolve null pointer exception` |
| `docs` | Documentation changes | `docs: update README with setup instructions` |
| `style` | Code style changes (formatting, etc.) | `style: format code with Biome` |
| `refactor` | Code refactoring | `refactor(agent): simplify execution flow` |
| `test` | Adding or updating tests | `test: add unit tests for UserService` |
| `chore` | Maintenance tasks | `chore: update dependencies` |
| `perf` | Performance improvements | `perf(optimize database queries)` |
| `ci` | CI/CD changes | `ci: add GitHub Actions workflow` |
| `build` | Build system changes | `build: update webpack configuration` |
| `revert` | Revert previous commit | `revert: feat(user authentication)` |
| `merge` | Merge branches | `merge: branch feature/login` |

## Scope

The **scope** indicates which part of the codebase is affected. Use project folder names or feature names:

### Common Scopes

| Scope | Example |
|-------|---------|
| `api` | `fix(api): resolve timeout issue` |
| `executor` | `feat(executor): add retry logic` |
| `agent` | `fix(agent): correct variable interpolation` |
| `domain` | `refactor(domain): simplify repository pattern` |
| `ui` | `style(ui): improve button spacing` |
| `web` | `feat(web): add dashboard component` |
| `integration` | `fix(integration): handle API errors` |
| `analytics` | `feat(analytics): add metrics collection` |
| `infrastructure` | `chore(infrastructure): update Redis config` |

## Description

The **description** should be concise and clear:
- Use **imperative mood** ("add", "fix", "update")
- **Lowercase** first letter
- **No period** at the end
- **50 characters or less** (recommended)

### Good Examples

```
feat: add user authentication
fix(api): resolve null pointer exception
docs: update README with setup instructions
refactor: simplify agent execution flow
```

### Bad Examples

```
feat: Adding user authentication  // ❌ Capitalized, "Adding"
fix: Resolve the null pointer exception  // ❌ Capitalized, "the"
update README  // ❌ Missing type
fixes bug in API  // ❌ Imperative tense, but too vague
```

## Body

The **body** provides detailed context:
- **What** changed and why
- Reference related issues/PRs
- Additional technical details

### Body Format

```
type(scope): description

More detailed explanation of the change:
- Bullet points for multiple items
- Reference issues with #issue-number
- Provide context for reviewers

Closes #123
```

### Example

```
feat(agent): add version control system

This introduces a versioning mechanism for agents:

- Auto-create versions on save
- Compare versions side-by-side
- Restore previous versions
- Track version history in database

Addresses requirement for agent audit trail.

Closes #123, #456
```

## Footer

The **footer** is used for:
- **Breaking changes**: Indicate API-breaking changes
- **Issue references**: Link to related issues
- **Co-authored commits**: For pair programming

### Breaking Changes

```
feat(api): add new response format

BREAKING CHANGE: Response structure changed from
{ success: boolean, data: any }
to
{ status: 'success'|'error', payload: any }
```

### Issue References

```
fix(auth): resolve login timeout issue

This fixes the authentication timeout caused by
slow database queries.

Fixes #789
```

### Co-authored

```
feat: add analytics dashboard

Co-authored-by: Jane Doe <jane@example.com>
```

## Examples by Type

### Feature

```
feat: add user authentication

Implements OAuth2.0 authentication flow with:
- Login page
- Token management
- Session handling

Related to #123
```

### Fix

```
fix(agent): correct variable interpolation in prompt

Variables were not being replaced correctly when
using nested object paths. Fixed by improving
the regex pattern in variable resolver.

Fixes #456
```

### Documentation

```
docs: update API documentation

Added missing endpoints and updated request/response
examples for the agents API.
```

### Refactoring

```
refactor(domain): simplify repository pattern

Removed unnecessary abstraction layer to improve
code clarity and reduce complexity.
```

### Testing

```
test: add integration tests for agent execution

Tests cover:
- Successful execution
- Error handling
- Timeout scenarios
- Variable substitution
```

### Chore

```
chore: update dependencies

Upgraded to latest stable versions of:
- NestJS 10.0
- TypeScript 5.0
- Sequelize 6.0
```

## Commit Message Validation

> **Corrected 2026-08-03 (docs-truth-audit T08).** This section used to open
> "The project uses a git hook to enforce commit message format" and printed the
> error text that hook would emit. **No such hook exists** — there is no
> `commit-msg` hook, no lefthook, no commitlint and no `core.hooksPath`
> (see [GIT-HOOKS.md](GIT-HOOKS.md) for the four commands that prove it). The
> pattern below is the convention a **reviewer** applies; nothing rejects a
> malformed message automatically, and the message text below is illustrative,
> not something you will ever see printed.

### Validation Rule (applied by review)

```bash
Pattern: ^(feat|fix|docs|style|refactor|test|chore|perf|ci|build|revert|merge)(\(.+\))?: .{1,}
```

Check your own history against it before pushing:

```bash
git log origin/main..HEAD --pretty=%s \
  | rg -v '^(feat|fix|docs|style|refactor|test|chore|perf|ci|build|revert|merge)(\(.+\))?: .' \
  || echo "all subjects conform"
```

### Reference: the accepted types

Nothing prints this — it is the type list the pattern above accepts, kept here
so a reviewer and an author read the same set:

```
Expected format: type(scope): description

Valid types:
  feat:     New feature
  fix:      Bug fix
  docs:     Documentation changes
  style:    Code style changes (formatting, etc.)
  refactor: Code refactoring
  test:     Adding or updating tests
  chore:    Maintenance tasks
  perf:     Performance improvements
  ci:       CI/CD changes
  build:     Build system changes
  revert:   Revert previous commit
  merge:     Merge branches

Examples:
  feat: add user authentication
  fix(api): resolve null pointer exception
  docs: update README with setup instructions
```

## Best Practices

1. **Use imperative mood**: "add" not "added" or "adding"
2. **Keep it short**: Description ≤ 50 characters
3. **Be specific**: Describe what changed, not how
4. **Reference issues**: Link to issue numbers when possible
5. **One commit per feature**: Break down large changes
6. **Test before commit**: Ensure changes work
7. **Format code**: Run `npm run lint:fix` before commit

## Finding Examples

```bash
# View commit history with messages
git log --oneline -20

# View full commit messages
git log -10 --pretty=format:"%h %s%n%b%n---"

# Search for specific types
git log --grep="feat:" --oneline
git log --grep="fix:" --oneline
```

There is no `lefthook.yml` to read: the rules on this page are enforced by
review, not by a hook. See [GIT-HOOKS.md](GIT-HOOKS.md).

## Related Skills

- **`git-commit`** - the parent skill: repo conventions and the real hook surface
- **`judgment-day`** - the adversarial review that actually enforces these rules

(There is no `biome` or `testing` skill in this repo — run `npx biome check .`
directly, and each package's own `test` script for tests.)
