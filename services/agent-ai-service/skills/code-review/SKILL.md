---
name: code-review
description: Review source code for bugs, security vulnerabilities, performance issues, and style improvements.
---

# Code Review Skill

## When to use this skill
Use this skill when the user asks to review, audit, or analyze code quality.

## Review checklist
1. **Security**: Check for injection flaws, auth bypasses, hardcoded secrets, unsafe deserialization
2. **Performance**: Look for N+1 queries, memory leaks, unnecessary allocations, sync IO in async paths
3. **Correctness**: Off-by-one errors, race conditions, incorrect error handling, edge cases
4. **Maintainability**: Duplicated code, magic numbers, overly complex logic, missing abstractions
5. **Style**: Inconsistencies with the project's established patterns

## How to report
- Group issues by severity: CRITICAL > MAJOR > MINOR > SUGGESTION
- For each issue: explain the problem, show the problematic code, suggest a fix
- End with a summary of overall code health

<!--
MAINTAINER NOTE — frontmatter must stay FLAT `key: value` on ONE line.
`SkillFileService.parseFrontmatter`
(services/agent-ai-service/src/modules/skills/skill-file.service.ts) is a hand-rolled
line splitter, not a YAML parser: it takes the text after the FIRST `:` on each line and
ignores continuation lines entirely. A YAML block scalar (`description: >` followed by an
indented body) therefore parses as the literal string `">"`, and that is what
`discoverSkills()` would put in the catalog and `loadSkill()` would return to the model.
The repo-root `skills/*/SKILL.md` files DO use `>` because those are read by Claude
Code's real YAML parser — this directory is a different consumer with a different parser.
-->

