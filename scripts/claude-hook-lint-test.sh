#!/usr/bin/env bash
#
# Claude Code PostToolUse hook: lint + (best-effort) test the file just edited/written.
#
# Wired from .claude/settings.json on Edit|Write|MultiEdit. Claude Code passes the hook
# payload as JSON on stdin (contains tool_input.file_path) and sets $CLAUDE_PROJECT_DIR.
#
# Non-blocking by design: ALWAYS exits 0 so it never interrupts the agent. It prints a
# short result to stderr (which Claude sees) and a verbose log to .claude/hook.log.
# To make lint failures BLOCK instead, change the final `exit 0` after biome to `exit 2`.
#
# The "test" half is SCOPED: `vitest related` runs only for files under
# services/admin-console/, the single package that declares vitest as a devDependency.
# Every other package runs its tests with `bun test`, `tsx --test` or
# `node --import tsx`, and none of those runners has `related` semantics (no way to
# map a source file to its tests), so for those paths the test half is skipped
# explicitly and logged. The biome half always runs and is the real check.

set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
LOG="$ROOT/.claude/hook.log"
note() { printf '[hook %(%H:%M:%S)T] %s\n' -1 "$*" >>"$LOG" 2>/dev/null; }
say()  { printf '[lint+test] %s\n' "$*" >&2; }

# Extract the edited file path from the JSON payload on stdin (node is always present here).
FILE="$(node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d||"{}");process.stdout.write(j.tool_input?.file_path||j.tool_input?.path||"")}catch{process.stdout.write("")}})' 2>/dev/null)"

note "invoked file='${FILE}'"

# Only act on TypeScript source files inside the workspace.
case "$FILE" in
  *.ts|*.tsx) ;;
  *) note "skip (not .ts/.tsx)"; exit 0 ;;
esac
[ -f "$FILE" ] || { note "skip (file not found)"; exit 0; }

runner=""
if command -v bunx >/dev/null 2>&1; then runner="bunx"
elif command -v npx >/dev/null 2>&1; then runner="npx"
else say "biome/vitest skipped (no bunx/npx on PATH)"; note "no runner"; exit 0; fi

# 1) Lint + format autofix (fast). Best-effort.
if "$runner" biome check --write "$FILE" >>"$LOG" 2>&1; then
  say "biome ok: $(basename "$FILE")"
else
  say "biome reported issues on $(basename "$FILE") (see .claude/hook.log) — not blocking"
fi

# 2) Related tests (best-effort, won't block), but ONLY for the one package that has
#    vitest: services/admin-console. Other packages have no per-file test runner.
case "$FILE" in
  services/admin-console/*|*/services/admin-console/*) has_vitest="yes" ;;
  *) has_vitest="no" ;;
esac

if [ "$has_vitest" = "no" ]; then
  note "test half skipped (no per-file runner for this package): $FILE"
  say "tests skipped: no per-file runner for this package ($(basename "$FILE"))"
# Passes with no tests so source-only edits are quiet.
elif "$runner" vitest related "$FILE" --run --passWithNoTests >>"$LOG" 2>&1; then
  note "vitest related ok: $FILE"
  say "vitest related: ok"
else
  note "vitest related FAILURES: $FILE"
  say "vitest related: FAILURES for $(basename "$FILE") (see .claude/hook.log) — not blocking"
fi

exit 0
