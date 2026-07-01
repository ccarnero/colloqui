#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

. ../lib/resolve-env.sh

echo "[run] provisioning knowledge base + AI agent, then asking a KB-backed question..."
exec ./setup.sh
