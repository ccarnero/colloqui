#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

. ../lib/resolve-env.sh

echo "[run] provisioning AI playground agent + executing one runtime message..."
exec ./setup.sh
