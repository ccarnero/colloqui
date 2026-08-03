# scripts/reset/README.md — wiping dev-environment data by hand

How to clean ALL message/event/test data from the local dev cluster
(OrbStack). Values below are baked in on purpose: this is the throwaway dev
environment — every service in it uses the same `yoizen / yoizen-dev-password`
app credentials, and the `*.svc.cluster.local` DNS names are routable from the
host (OrbStack). See `INVENTORY.md` for the audit of exactly what each
stage touches.

## 1. Main reset — `scripts/reset/reset-dev.ts`

Wipes JetStream stream contents (`INGRESS-*`, `DLQ-*`, `GATEWAY_AUDIT`,
`PLATFORM_TENANTS`, the legacy global `DLQ` if it still exists, and the
`PAYLOAD-<tenant>` claim-check buckets), per-tenant Postgres data tables, the
usage Timescale DB, and derived Redis keys. Never touches topology, schemas,
the tenant registry, or `credentials` (deliberately excluded — real
per-tenant connector secrets).

Read the exclusion list carefully: it is NOT "definitions are safe". Per
`INVENTORY.md`'s approved UNCERTAIN section, the script DOES truncate
`agent_versions`, `document_chunks`/`document_chunks_embedding`,
`canary_deployments`, and the `adapter:oauth:*` Redis keys. Channel accounts,
workflows, agents and adapters themselves survive — those need
`reset-tenant.sh` (§6).

Dry-run first (default — prints counts only, deletes nothing):

```bash
NATS_URL=nats://nats.support-services-dev.svc.cluster.local:4222 \
POSTGRES_HOST=postgres.support-services-dev.svc.cluster.local POSTGRES_PORT=5432 \
POSTGRES_USER=yoizen POSTGRES_PASSWORD=yoizen-dev-password POSTGRES_DB=yoizen \
TENANT_POSTGRES_SHARED_HOST=postgres-shared-rw.support-services-dev.svc.cluster.local \
TENANT_POSTGRES_SHARED_PORT=5432 \
USAGE_POSTGRES_HOST=postgres-usage-shared-rw.support-services-dev.svc.cluster.local \
USAGE_POSTGRES_PORT=5432 \
USAGE_POSTGRES_USER=yoizen USAGE_POSTGRES_PASSWORD=yoizen-dev-password \
USAGE_POSTGRES_DB=yoizen_usage \
REDIS_HOST=redis.support-services-dev.svc.cluster.local REDIS_PORT=6379 \
bun run scripts/reset/reset-dev.ts
```

To actually delete, append `--apply` (asks for a typed `yes`) or
`--apply --yes` (no prompt).

Notes that cost real debugging time — do not "fix" them:

- Do NOT set `TENANT_POSTGRES_SHARED_USER`. Tenant tables are owned by
  per-tenant roles (`tenant_<id>_app`); when the var is unset the connection
  manager derives the right role per tenant. Forcing `yoizen` gives
  `permission denied for table events`.
- The CNPG `postgres-shared-app` secret's password is stale — every service
  (and every tenant role) authenticates with `yoizen-dev-password`.
- The Mongo stage self-skips: this cluster is Postgres-only.

## 2. Tracking traces — `tracking.tracked_events` (NOT covered by reset-dev)

The trace/causal store (what the console shows under Processes → Trace) lives
in the platform DB and post-dates `INVENTORY.md`, so `reset-dev.ts` does
not wipe it. Manual wipe:

```bash
kubectl exec -n support-services-dev postgres-0 -- \
  psql -U yoizen -d yoizen -c "TRUNCATE tracking.tracked_events;"
```

Payload claim-check blobs referenced by those rows live in the JetStream
`PAYLOAD-<tenant>` buckets, which reset-dev DOES purge — run both for a full
trace wipe.

## 3. Temporal state — `scripts/reset/purge-temporal.sh`

Truncates workflow histories + visibility rows without dropping databases or
namespaces. ~5-10s. It scales Temporal down first, so it auto-detects the
topology (4-role HA set, or the single `temporal` auto-setup Deployment) and
RESOLVES where `executions_visibility` actually lives — dedicated
`postgres-temporal-visibility-1`, else the workflow-state primary
`postgres-temporal-1`, else the visibility stage is skipped with a warning.

```bash
./scripts/reset/purge-temporal.sh            # purge (asks for confirmation)
./scripts/reset/purge-temporal.sh counts     # read-only row counts
./scripts/reset/purge-temporal.sh --dry-run  # print the SQL + kubectl calls
```

## 4. Circuit breakers — `scripts/reset/purge-circuit-breakers.sh`

Clears the three breaker key prefixes only — `cb:workflow:http`,
`cb:workflow:agent`, `cb:channel:egress` (also included in reset-dev's Redis
stage). Sub-commands `purge` (default) and `count`; `--dry-run` counts
without unlinking. Note it currently exits 0 even if a master errors mid-sweep
(its own header documents this).

## 5. e2e leftovers

Since T08 (`manual-loops/connector-trace-linking.md`),
`scripts/e2e/http-workflow.sh` cleans its own workflows/account/agent on exit
(`cleanup_e2e_resources`, from an `EXIT` trap; skipped with `E2E_KEEP=1`) and
its triggers are scoped to its per-run account. The workflow sweep matches by
NAME PREFIX — `e2e-http-log*` and `e2e-http-agentflow*` — and the http
account by the `manifest:e2e-http-workflow` externalId prefix, so leftovers
from crashed or older runs (including the pre-nonce fixed names) are
reclaimed by the next run too; the echo agent `e2e-http-agent-echo` is
deleted by exact name. Anything the sweep misses can be deleted via the
console.

## 6. Tenant definitions — `scripts/reset/reset-tenant.sh`

Manifest-from-zero wipe: truncates the resource-*definition* tables in a
tenant's Postgres database (`workflow_definitions`, `agents`,
`channel_accounts`, etc. — see `INVENTORY.md`'s "Manifest-from-zero" section
for the full table list and rationale) plus `tracking.tracked_events` on the
platform DB. Preserves `tenant_users`, `tenant_roles`,
`tenant_role_permissions`, and `credentials` so login/RBAC survive the wipe.

```bash
./scripts/reset/reset-tenant.sh --tenant acme --dry-run
./scripts/reset/reset-tenant.sh --tenant acme --apply --yes
```

After an apply, re-provision the tenant with `yoizen manifests apply` and
re-register the Telegram webhook by hand (see
`integrations/channels/telegram-transform-reply/README.md` § "Run /
exercise") — the old channel account no longer exists.

## 7. One-shot full wipe — `scripts/reset/reset-all.sh`

Runs all four scripts above in order (reset-dev.ts, purge-temporal.sh,
reset-tenant.sh, purge-circuit-breakers.sh):

```bash
./scripts/reset/reset-all.sh --dry-run
./scripts/reset/reset-all.sh --apply --yes
```

## Full wipe, in order

```bash
# 1. messages/events/usage/redis (dry-run shown above; add --apply)
# 2. traces
kubectl exec -n support-services-dev postgres-0 -- \
  psql -U yoizen -d yoizen -c "TRUNCATE tracking.tracked_events;"
# 3. temporal histories
./scripts/reset/purge-temporal.sh
# 4. tenant definitions (manifest-from-zero) + tracking traces
./scripts/reset/reset-tenant.sh --apply --yes
# 5. circuit breakers
./scripts/reset/purge-circuit-breakers.sh

# ...or just run the orchestrator:
./scripts/reset/reset-all.sh --apply --yes
```

## Folder layout and `.env` convention

- `reset-dev.ts`, `purge-temporal.sh`, `purge-circuit-breakers.sh`,
  `reset-tenant.sh` — individual reset stages, each dry-run by default.
- `reset-all.sh` — orchestrates all four stages in order; the one-shot
  entry point for a full dev-environment wipe.
- `INVENTORY.md` — the DATA-vs-CONFIG audit these scripts implement.
- `.env.example` (committed) — documents every env var the folder's
  scripts read, with placeholder/safe-default values.
- `.env` (gitignored, NOT committed) — real dev-cluster values. Copy
  `.env.example` to `.env` and fill in real credentials; every script in
  this folder auto-loads `scripts/reset/.env` if present (`set -a` /
  `dotenv`-style), so you don't have to export vars by hand each run.
