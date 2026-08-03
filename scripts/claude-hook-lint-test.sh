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
# CAVEAT on the "test" half: it runs `vitest related`, but vitest is a devDependency
# of services/admin-console ONLY — every other package in this repo runs its tests
# with `bun test` or `tsx --test`. So for almost every edited file this step finds no
# vitest project and reports nothing useful; treat the biome half as the real check.
# Swapping the runner is a behavior change, tracked as E28 in
# cowork/DOCS-TRUTH-LEDGER.md.

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

# 2) Related tests (best-effort, won't block). Passes with no tests so source-only edits are quiet.
if "$runner" vitest related "$FILE" --run --passWithNoTests >>"$LOG" 2>&1; then
  say "vitest related: ok"
else
  say "vitest related: FAILURES for $(basename "$FILE") (see .claude/hook.log) — not blocking"
fi

exit 0
