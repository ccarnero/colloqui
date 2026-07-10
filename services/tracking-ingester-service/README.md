# Tracking Ingester Service

Bus→Postgres message-tracking ingester. Consumes every NATS JetStream bus event
(per-tenant `INGRESS-*`, cross-tenant `GATEWAY_AUDIT`, per-tenant `DLQ-*`),
classifies it, and persists one row per event to `tracking.tracked_events` for
Grafana/analytical use. Pure functions at the core, side effects (NATS, Postgres,
telemetry) at the edges (`src/main.ts`).

## Quick Start

```bash
bun install
bun run --cwd services/tracking-ingester-service src/main.ts
```

Requires: NATS (credentials in `NATS_URL`), Postgres (DSN in `POSTGRES_URL` /
`DATABASE_URL`).

## Pipeline

Per message (`src/lib/process-tracked-message.ts` → `to-tracked-event-row.ts`):

1. **Classify** the subject into `{ tech, business_fn, rule }` — deterministic,
   first-match-wins, `TAXONOMY.md` §4 (`src/lib/classify.ts`).
2. **Facets** — `consumed_by` (durable consumers, §5) and `is_claim_check`
   (`data.payload_inline === false`, §6).
3. **Disposition** — most rules are *counted-and-persisted* (one row). Rule 20
   (`runtime-presence` heartbeats) is *counted-not-persisted*: counted via an OTel
   metric, **no row written** (`SKIP_PERSIST_RULES`, `TAXONOMY.md` §4 note).
4. **Insert** — batched, `ON CONFLICT (event_id) DO NOTHING` (idempotent).

## `compliance` column

Every row records how close its stored body is to a canonical `EventEnvelope`:

- `full` — compliant `EventEnvelope` outright.
- `partial` — stage-1 `webhook_received` canonical-with-known-drift exception
  (compliant except the intentionally-absent `accountid`; `DRIFT.md` items 6/7).
- `none` — non-envelope/drift bodies (rules 1/12/13/14/15 and rule-18 drift).

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NATS_URL` | — (required) | NATS server URL (carries credentials, never defaulted). |
| `POSTGRES_URL` / `DATABASE_URL` | — (required) | Postgres DSN (precedence order). |
| `PORT` | `3000` | HTTP port for `/health`. |
| `TRK_MAX_ACK_PENDING` | `1000` | Max unacked in-flight messages per durable. |
| `TRK_BATCH_SIZE` | `100` | Rows coalesced per insert round trip. |
| `TRK_BATCH_FLUSH_MS` | `1000` | Max wait before flushing a partial batch. |
| `TRK_CONCURRENCY` | `= TRK_BATCH_SIZE` | Concurrent handlers per tenant runner (clamped to `TRK_MAX_ACK_PENDING`). |
| `TRK_MAX_DELIVER` | `-1` | Max delivery attempts; `-1` = unlimited (DLQ disabled). |
| `TRK_BACKOFF_MS` | `30000,60000,120000,300000` | Redelivery backoff schedule (ms). |

## Testing + golden gate

```bash
cd services/tracking-ingester-service
bun test                         # unit specs (colocated under test/)
bunx tsc -p tsconfig.json --noEmit
```

The golden gate re-applies the `TAXONOMY.md` §4 rules to `golden/labeled.tsv`
(the audited truth) and asserts >= 90% accuracy on (`tech`, `business_fn`, `rule`)
across the 72 audited rows (currently 72/72). Drift in `classify.ts` beyond that
threshold fails the gate.

## Schema

Idempotent DDL in `src/sql/tracked-events.sql` (source of truth), applied at
startup (`src/lib/apply-schema.ts`) and re-runnable safely
(`CREATE ... IF NOT EXISTS`, convergent backfill).

## Deploy

Worker `Deployment` (no ingress; `/health` is a readiness probe). Rebuild +
redeploy on the dev cluster:

```bash
./rebuild-redeploy.sh tracking-ingester-service dev
```

## Observability

- `tracking_ingester_unknown_total{reason}` — the **alarm**: any non-zero value is
  actionable (unrecognized traffic, rules 16/17/18, or drift).
- `tracking_ingester_skipped_total{family,tenant}` — *counted-not-persisted* signal;
  a heartbeat rate dropping to 0 while a tenant is active means the agent runtime is
  down.
- `tracking_ingester_processed_total` / `tracking_ingester_insert_failures_total`.
- **Message Tracking** Grafana dashboard surfaces these plus per-`business_fn` volume.
  Access Grafana via `kubectl port-forward` to the monitoring stack.
