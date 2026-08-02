# Archived runbooks

Historical, one-time procedures kept for the record. **Nothing in this
directory is a current operating procedure** — each file carries a
`Status: Historical` banner stating what superseded it. For day-2
operations of the current cluster, start at
[`DOCS/runbooks/temporal.md`](../temporal.md).

## Why these files exist

Both runbooks document the response to the 2026-05-22 Temporal stress run
(its post-mortem was later deleted from the repo). The headline incident:
after a Postgres restart, all 16 Temporal history shards re-assigned to a
single pod (16/0 split) — one pod at 1248m CPU with ~12,890
`context deadline exceeded` errors in 5 minutes while its sibling idled.
Root cause: the `temporalio/auto-setup` image runs all four Temporal roles
(frontend, history, matching, worker) in one process.

Both migrations were applied on 2026-05-22 and later **reverted** when the
project collapsed to a single developer-mode configuration
(`be62ae89`, "collapse to dev-only config"): dev has no use for a 4-role HA
topology, so the cluster went back to one `temporalio/auto-setup`
Deployment.

## Contents

| Runbook | What it did (2026-05-22) | Current state |
|---|---|---|
| [`temporal-ha-migration.md`](./temporal-ha-migration.md) | Split `temporalio/auto-setup` into 4 per-role Deployments (2 replicas each) + one-shot schema/namespace Jobs, isolating the history shard ring from frontend/matching/worker. | Reverted — dev mode runs a single `auto-setup` Deployment (`DOCS/runbooks/temporal.md`). The split-role manifests were **deleted**, not merely unapplied: `infrastructure/base/temporal/` holds only `deployment-autosetup.yaml`, `job-namespace-bootstrap.yaml`, `configmap-dynamic-config.yaml`, `service-frontend.yaml`, `service-metrics.yaml` and `kustomization.yaml`, and no `temporal-frontend/history/matching/worker` manifest exists anywhere under `infrastructure/` or `knative/`. |
| [`temporal-visibility-split.md`](./temporal-visibility-split.md) | Moved `temporal_visibility` onto its own CNPG cluster (`postgres-temporal-visibility`) because visibility autovacuum/insert pressure starved the hot `executions` write path. Includes the `auto-setup` bug workaround (it ignores `VISIBILITY_POSTGRES_SEEDS` during schema setup). | Reverted — dev mode points both datastores at `postgres-temporal-rw`; the helper script `infrastructure/scripts/ensure-temporal-visibility-schema.sh` was deleted from the repo. The visibility cluster manifest still exists but is inactive. |

## Rules for this directory

- Files here are **records, not procedures** — do not "modernize" their
  bodies to match current code; that would falsify what the migration
  actually did (same rule as `DOCS/adr/` decision bodies).
- Corrections are limited to mechanical defects. Precedent (2026-07-31):
  seven relative links in these two files were dead because their depth
  was one level short (`../../` resolves to `DOCS/`, not the repo root —
  from this directory the repo root is `../../../`). The targets all
  existed; only the paths were fixed.
- New retirements land here with a `Status: Historical` banner stating the
  date, what replaced them, and a pointer to the current runbook.
