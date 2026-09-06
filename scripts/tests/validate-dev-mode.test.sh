#!/usr/bin/env bash
# Integration boundary tests: no real Git, dev-mode entry point or cluster calls.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE="${1:-$ROOT/scripts/validate-dev-mode.sh}"
SUITE="$(mktemp -d /tmp/validate-canary-tests.XXXXXX)"
PASSED=0
FAILED=0
for CASE in early dirty staged untracked git_failure before_append success after_append concurrent already_original restore_failure symlink replaced_symlink missing; do
  FIXTURE="$SUITE/$CASE"
  mkdir -p "$FIXTURE/scripts" "$FIXTURE/services/workflow-service/src" "$FIXTURE/bin"
  cp "$SOURCE" "$FIXTURE/scripts/validate-dev-mode.sh"
  printf 'original local bytes\n' > "$FIXTURE/original"
  cp "$FIXTURE/original" "$FIXTURE/services/workflow-service/src/main.ts"
  printf 'lock\n' > "$FIXTURE/pnpm-lock.yaml"
  cat > "$FIXTURE/bin/stub" <<'STUB'
#!/bin/bash
set -eu
name="${0##*/}"
file="$FIXTURE/services/workflow-service/src/main.ts"
printf '%s %s\n' "$name" "$*" >> "$FIXTURE/calls"
case "$name" in
  git)
    case "$1" in
      status)
        case "$CASE" in
          dirty) printf ' M canary\n';; staged) printf 'M  canary\n';;
          untracked) printf '?? canary\n';; git_failure) exit 23;;
        esac;;
      checkout) printf 'HEAD bytes\n' > "$file";;
      *) exit 98;;
    esac;;
  kubectl)
    case "$*" in
      'config current-context') echo orbstack;;
      *'get pvc'*) [ "$CASE" != early ];;
      *'get configmap'*) echo fixture-sha;;
      *metadata.annotations*) :;;
      *containers*) echo 'image|command';;
      *' wait '*) :;;
      *' logs '*)
        case "$CASE" in
          concurrent) printf 'concurrent edit\n' >> "$file"; cp "$file" "$FIXTURE/expected-current";;
          already_original) cp "$FIXTURE/original" "$file";;
          replaced_symlink) rm "$file"; ln -s "$FIXTURE/original" "$file";;
        esac
        echo 'dev-mode-canary-100';;
      *) exit 98;;
    esac;;
  dev-mode.sh) [ "$CASE" != before_append ] || exit 29;;
  shasum) echo 'fixture-sha  pnpm-lock.yaml';;
  yq|sleep) :;;
  seq) echo 1;;
  date)
    count=0
    [ ! -f "$FIXTURE/date-count" ] || read -r count < "$FIXTURE/date-count"
    count=$((count + 1)); echo "$count" > "$FIXTURE/date-count"
    if [ "$CASE" = after_append ] && [ "$count" -eq 4 ]; then exit 37; fi
    echo 100;;
  jq)
    case "$*" in *access_token*) echo fixture-token;; *) echo array;; esac;;
  curl)
    case "$*" in
      */api/auth/login*) printf '{}\n200';;
      *) if [ -f "$FIXTURE/probed" ]; then printf '[]\n200'; else touch "$FIXTURE/probed"; printf '{}\n503'; fi;;
    esac;;
  mktemp)
    mkdir "$FIXTURE/snapshots"
    echo "$FIXTURE/snapshots";;
  cp)
    if [ "$CASE" = restore_failure ] && [ "$1" = "$FIXTURE/snapshots/canary.original" ] && [ "$2" = 'services/workflow-service/src/main.ts' ]; then exit 41; fi
    /bin/cp "$@";;
  *) exit 98;;
esac
STUB
  chmod +x "$FIXTURE/bin/stub"
  for name in git kubectl shasum yq sleep seq date jq curl mktemp cp; do
    ln -s stub "$FIXTURE/bin/$name"
  done
  cp "$FIXTURE/bin/stub" "$FIXTURE/dev-mode.sh"
  if [ "$CASE" = symlink ]; then
    rm "$FIXTURE/services/workflow-service/src/main.ts"
    ln -s "$FIXTURE/original" "$FIXTURE/services/workflow-service/src/main.ts"
  elif [ "$CASE" = missing ]; then
    rm "$FIXTURE/services/workflow-service/src/main.ts"
  fi
  status=0
  CASE="$CASE" FIXTURE="$FIXTURE" PATH="$FIXTURE/bin:/usr/bin:/bin" /bin/bash "$FIXTURE/scripts/validate-dev-mode.sh" > "$FIXTURE/output" 2>&1 || status=$?
  ok=true
  canary="$FIXTURE/services/workflow-service/src/main.ts"
  case "$CASE" in
    success|already_original) [ "$status" -eq 0 ] || ok=false;;
    before_append) [ "$status" -eq 29 ] || ok=false;;
    after_append) [ "$status" -eq 37 ] || ok=false;;
    *) [ "$status" -ne 0 ] || ok=false;;
  esac
  case "$CASE" in
    concurrent) cmp -s "$canary" "$FIXTURE/expected-current" || ok=false;;
    restore_failure) grep -q dev-mode-canary "$canary" || ok=false;;
    missing) [ ! -e "$canary" ] || ok=false;;
    *) cmp -s "$canary" "$FIXTURE/original" || ok=false;;
  esac
  case "$CASE" in
    concurrent|restore_failure|replaced_symlink)
      [ -f "$FIXTURE/snapshots/canary.original" ] && [ -f "$FIXTURE/snapshots/canary.expected" ] || ok=false
      grep -q "$FIXTURE/snapshots" "$FIXTURE/output" || ok=false
      grep -qi 'recovery' "$FIXTURE/output" || ok=false;;
    *) [ ! -d "$FIXTURE/snapshots" ] || ok=false;;
  esac
  case "$CASE" in symlink|replaced_symlink) [ -L "$canary" ] || ok=false;; esac
  case "$CASE" in
    early|dirty|staged|untracked|git_failure|symlink|missing)
      if grep -Eq '^(mktemp|dev-mode.sh) ' "$FIXTURE/calls"; then ok=false; fi;;
  esac
  if grep -q '^git checkout ' "$FIXTURE/calls"; then ok=false; fi
  if $ok; then
    printf 'PASS %s (exit %s)\n' "$CASE" "$status"; PASSED=$((PASSED + 1))
  else
    printf 'FAIL %s (exit %s): %s\n' "$CASE" "$status" "$FIXTURE/output"; FAILED=$((FAILED + 1))
  fi
done
printf '%s passed, %s failed; fixtures: %s\n' "$PASSED" "$FAILED" "$SUITE"
[ "$FAILED" -eq 0 ]
