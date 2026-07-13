# RESET-README — wiping dev-environment data by hand

How to clean ALL message/event/test data from the local dev cluster
(OrbStack). Values below are baked in on purpose: this is the throwaway dev
environment — every service in it uses the same `yoizen / yoizen-dev-password`
app credentials, and the `*.svc.cluster.local` DNS names are routable from the
host (OrbStack). See `RESET-INVENTORY.md` for the audit of exactly what each
stage touches.

## 1. Main reset — `scripts/reset-dev.ts`

Wipes JetStream stream contents (ingress, DLQ, gateway audit, claim-check
payload buckets), per-tenant Postgres data tables, the usage Timescale DB, and
derived Redis keys. Never touches topology, schemas, tenant registry,
credentials, or connector/channel/agent configuration.

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
bun run scripts/reset-dev.ts
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
in the platform DB and post-dates `RESET-INVENTORY.md`, so `reset-dev.ts` does
not wipe it. Manual wipe:

```bash
kubectl exec -n support-services-dev postgres-0 -- \
  psql -U yoizen -d yoizen -c "TRUNCATE tracking.tracked_events;"
```

Payload claim-check blobs referenced by those rows live in the JetStream
`PAYLOAD-<tenant>` buckets, which reset-dev DOES purge — run both for a full
trace wipe.

## 3. Temporal state — `scripts/purge-temporal.sh`

Truncates workflow histories + visibility rows (both CNPG clusters) without
dropping databases or namespaces. ~5-10s.

```bash
./scripts/purge-temporal.sh
```

## 4. Circuit breakers — `scripts/purge-circuit-breakers.sh`

Clears `cb:*` Redis state only (also included in reset-dev's Redis stage).

## 5. e2e leftovers

Since T08 (`manual-loops/connector-trace-linking.md`), `e2e-http-workflow.sh`
cleans its own workflows/account/agent on exit and its triggers are scoped to
its per-run account. If a pre-T08 run left `e2e-http-log` / `e2e-http-agent`
definitions behind, either run the current script once (it converges and then
deletes them) or delete them via the console.

## Full wipe, in order

```bash
# 1. messages/events/usage/redis (dry-run shown above; add --apply)
# 2. traces
kubectl exec -n support-services-dev postgres-0 -- \
  psql -U yoizen -d yoizen -c "TRUNCATE tracking.tracked_events;"
# 3. temporal histories
./scripts/purge-temporal.sh
```
