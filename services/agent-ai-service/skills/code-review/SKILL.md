---
name: code-review
description: >
  Review source code for bugs, security vulnerabilities, performance issues, and style improvements.
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
