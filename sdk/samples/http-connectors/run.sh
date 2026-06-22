#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# One-shot: resolve the dev env (endpoint/host/creds) and provision all the
# HTTP connectors. No variables to set — see ../lib/resolve-env.sh.
. ../lib/resolve-env.sh

echo "[run] provisioning HTTP connectors..."
exec ./setup.sh
