#!/bin/sh
# =============================================================================
# dev-poll-reload.sh — polling source reloader for minikube source-mounted dev mode
# =============================================================================
# Why this exists:
#   minikube (docker driver) exposes the host repo to the node over a 9p mount
#   (`minikube mount`). 9p propagates file DATA but NOT inotify events, so
#   `bun --watch` never sees host-side edits and does not reload. This script
#   polls source mtimes and restarts `bun <entry>` on change — same outcome,
#   transport-agnostic. Verified on minikube docker driver (9p).
#
#   On OrbStack (VirtioFS) `bun --watch` works natively, so the OrbStack
#   dev-mode.sh keeps using it; this reloader is only wired by
#   dev-mode-minikube.sh.
#
# Usage (runs inside the dev pod; cwd is set to /app/services/<svc> by the patch):
#   sh /app/scripts/dev-poll-reload.sh <service-dir> <entrypoint>
# Example:
#   sh /app/scripts/dev-poll-reload.sh channel-service src/main.ts
#
# Env:
#   DEV_POLL_INTERVAL  seconds between polls (default 1)
#   APP_DIR            app root inside the container (default /app)
# =============================================================================
set -u

SVC_DIR="${1:?service dir required}"
ENTRY="${2:?entrypoint required}"
APP="${APP_DIR:-/app}"
WORK="${APP}/services/${SVC_DIR}"
INTERVAL="${DEV_POLL_INTERVAL:-1}"

# Source roots to watch: the service itself + shared workspace packages.
# Missing roots are ignored by find (2>/dev/null), so this is safe for
# services that do not depend on every shared package.
WATCH_ROOTS="${WORK}/src \
${APP}/packages/shared/src \
${APP}/packages/database/src \
${APP}/packages/observability/src"

cd "${WORK}" || { echo "[dev-poll-reload] cannot cd ${WORK}" >&2; exit 1; }

CHILD=""
start_bun() {
  bun "${ENTRY}" &
  CHILD=$!
  echo "[dev-poll-reload] started: bun ${ENTRY} (pid ${CHILD})"
}
stop_bun() {
  [ -n "${CHILD}" ] && kill "${CHILD}" 2>/dev/null
  wait "${CHILD}" 2>/dev/null
  CHILD=""
}
trap 'echo "[dev-poll-reload] terminating"; stop_bun; exit 0' TERM INT

# Max mtime (epoch seconds) across watched source files. 9p-safe: stat/find
# read fresh attributes on each poll even though inotify events never fire.
fingerprint() {
  find ${WATCH_ROOTS} -type f \
       \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.json' \) \
       -printf '%T@\n' 2>/dev/null | sort -n | tail -1
}

start_bun
PREV="$(fingerprint)"

while true; do
  sleep "${INTERVAL}"
  CUR="$(fingerprint)"
  if [ "${CUR}" != "${PREV}" ]; then
    PREV="${CUR}"
    echo "[dev-poll-reload] source change -> restarting bun"
    stop_bun
    sleep 0.2
    start_bun
  elif [ -n "${CHILD}" ] && ! kill -0 "${CHILD}" 2>/dev/null; then
    echo "[dev-poll-reload] bun exited -> restarting"
    start_bun
  fi
done
