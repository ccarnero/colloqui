# SPEC — Message Tracking Ingester (Phase 1)

Task queue for the message-tracking-system implementation. Phase 0 (read-only) is closed:
SCHEMAS.md, TAXONOMY.md (approved), DRIFT.md, and the definitive golden sample
(`golden/labeled.tsv`, 72 events, 6/6 chains closing) are the inputs to this phase.

## Scope

A Bun ingester service that consumes every bus event from JetStream, classifies it
per TAXONOMY.md, and persists it to the existing dev Postgres; plus a provisioned
Grafana datasource and dashboard on top of that table.

## Hard constraints (from decision `tracking/message-tracking-system`)

- Runtime: existing K8s dev cluster. The ingester holds durable JetStream consumers,
  so it deploys as a plain `Deployment` (worker pattern, like
  `knative/services/base/usage-aggregator-worker.yaml`), NOT a Knative Service.
- Code style: Bun, pure functions, no classes, Result types, one function per file,
  verbose logging.
- Envelope/event schemas are ALWAYS imported from `@yoizen/shared`
  (`envelope.utils.ts`, `interfaces.ts`). Never redefined.
- Correlation/causation handling and structured logging ALWAYS via
  `@yoizen/observability` (`envelopeLogFields`, `logWithEnvelope`, NATS trace
  propagation). Never reimplemented.
- Persistence: idempotent — `ON CONFLICT (event_id) DO NOTHING`. DDL follows the
  repo's idempotent raw-SQL pattern (`CREATE ... IF NOT EXISTS`), applied at startup.
- Classifier accuracy gate: >= 90% against `golden/labeled.tsv` (columns `tech`,
  `business_fn`, `rule`). Unknown classification is an ALARM (error log + counter),
  never a silent fallback.
- Dashboards are provisioned as code into
  `infrastructure/base/observability/grafana/` (ConfigMap pattern already in place).

## Target layout

```
services/tracking-ingester-service/
  src/
    main.ts                      # thin wiring only
    lib/                         # pure functions, one per file
    sql/                         # idempotent DDL
  test/
package: @yoizen/tracking-ingester-service
table:   tracking.tracked_events   (existing platform Postgres, new schema "tracking")
```

`tracked_events` columns: `event_id` (PK), `subject`, `tenant`, `producer`, `domain`,
`kind`, `version`, `correlation_id`, `causation_id`, `causation_depth`, `occurred_at`,
`tech`, `business_fn`, `rule` (TAXONOMY rule number), `consumed_by text[]`,
`is_claim_check boolean`, `envelope jsonb`, `ingested_at`.

---

## Task queue (dependency order)

Each task is one commit. Acceptance criteria are executable — the build loop runs them verbatim.

### T01 — Scaffold `services/tracking-ingester-service`

`package.json` (name `@yoizen/tracking-ingester-service`, scripts `test`/`build` matching
`usage-aggregator-service`), `tsconfig.json`, empty `src/main.ts`, one placeholder spec.
Depends on nothing.

**Accept:**
```sh
cd services/tracking-ingester-service && bun test && bunx tsc -p tsconfig.json --noEmit
```

### T02 — Classifier: `src/lib/classify.ts`

Implements TAXONOMY.md §4 rules 1–18, first-match-wins, over the subject string
(use `parseSubject` from `@yoizen/shared` for canonical 8-token subjects). Returns
`Result<{ tech, businessFn, rule }>`. Every rule branch carries a comment citing its
TAXONOMY.md rule number. Rules 16/17/18 results are flagged `unknown` for alarm handling.

**Accept:** unit tests covering all 18 rules, plus the golden gate:
```sh
cd services/tracking-ingester-service && bun test test/classify.golden.spec.ts
```
`classify.golden.spec.ts` parses `golden/labeled.tsv` (72 rows) and asserts accuracy >= 0.90
on (`tech`, `business_fn`, `rule`) simultaneously.

### T03 — Facets: `src/lib/consumed-by.ts` and `src/lib/is-claim-check.ts`

`consumed-by` seeded from `transport-topology.ts` (TAXONOMY §5); `is-claim-check` from
`envelope.data.payload_inline === false` (TAXONOMY §6). Both pure, both Result-typed.

**Accept:**
```sh
cd services/tracking-ingester-service && bun test test/consumed-by.spec.ts test/is-claim-check.spec.ts
```
`is-claim-check` output must match the `is_claim_check` column of `golden/labeled.tsv` at 100%.

### T04 — Row mapper: `src/lib/to-tracked-event-row.ts`

Envelope → `TrackedEventRow`. Non-compliant envelopes (fails `isCompliantEnvelope`)
return the error branch with a reason — never throw. Envelope types imported from
`@yoizen/shared` only.

**Accept:**
```sh
cd services/tracking-ingester-service && bun test test/to-tracked-event-row.spec.ts
```
Tests include every fixture in `fixtures/bus-events/` and at least one malformed envelope.

### T05 — DDL: `src/sql/tracked-events.sql` + `src/lib/apply-schema.ts`

`CREATE SCHEMA IF NOT EXISTS tracking`, `CREATE TABLE IF NOT EXISTS tracking.tracked_events`,
indexes (`correlation_id`, `occurred_at`, `business_fn`) all `IF NOT EXISTS`.
`apply-schema.ts` runs the statements sequentially via postgres.js `sql.unsafe`
(same semantics as `SchemaInitializer` in `packages/database`).

**Accept:**
```sh
cd services/tracking-ingester-service && bun test test/apply-schema.spec.ts   # asserts every statement is idempotent
bun run src/scripts/apply-schema.ts && bun run src/scripts/apply-schema.ts    # twice against dev Postgres, both exit 0
```

### T06 — Insert: `src/lib/insert-tracked-events.ts`

Batch insert via `INSERT ... SELECT FROM UNNEST(...) ON CONFLICT (event_id) DO NOTHING`
(same pattern as `usage-aggregator-service/batch-inserter.postgres.ts`).

**Accept:**
```sh
cd services/tracking-ingester-service && bun test test/insert-tracked-events.spec.ts
```
Integration test against dev Postgres: inserting the same event twice yields exactly 1 row.

### T07 — Consumer: `src/lib/consume-events.ts`

Durable JetStream consumers over `INGRESS-*`, `GATEWAY_AUDIT` and `DLQ-*` streams
(durable prefix `trk-`), mimicking `usage-aggregator-service/aggregator.engine.ts`
(`MultiTenantConsumerManager`, `maxAckPending`, nack on transient failure).
Pipeline per message: parse → classify → facets → row → buffered insert.
Rules 16/17/18 (`unknown`) emit an error-level log via `logWithEnvelope` plus an
OTel counter `tracking_ingester_unknown_total`.

**Accept:**
```sh
cd services/tracking-ingester-service && bun test test/consume-events.spec.ts
```
Unit tests with a mocked consumer: ack on success, nack on insert failure, alarm on unknown.

### T08 — Wiring: `src/main.ts` + `/health`

Thin main: env config (Result-validated), apply schema, start consumers, `Bun.serve`
health endpoint on port 3000. Verbose startup logging via `createPinoLogger`.

**Accept:**
```sh
cd services/tracking-ingester-service && bun test && bunx tsc -p tsconfig.json --noEmit
```
Local smoke: `bun run src/main.ts` with dev env reaches `GET /health` → 200.

### T09 — Deploy: Dockerfile + kustomize manifest

Follow the existing k8s pattern exactly:

- `services/tracking-ingester-service/Dockerfile` mirroring `usage-aggregator-service`'s
  (built from repo root, tagged `dev.local/tracking-ingester-service:local`).
- `knative/services/base/tracking-ingester-worker.yaml`: plain `apps/v1.Deployment`
  (worker-only service, no `*-api` KSVC), `replicas: 1`, readiness probe on
  `/health:3000`, mirroring `usage-aggregator-worker.yaml`.
- Register it in `knative/services/base/kustomization.yaml` under the Phase 1.5
  split-services section.

**Accept:**
```sh
kubectl kustomize knative/services/overlays/local/dev >/dev/null
docker build -t dev.local/tracking-ingester-service:local -f services/tracking-ingester-service/Dockerfile .
```

### T10 — Register the service in the bootstrap / rebuild / dev-mode scripts

All entry points that enumerate services must know the new one:

- `services.conf`: append `tracking-ingester-service` to `YZ_SERVICES` — this is what
  `bootstrap-orbstack-osx.sh`, `bootstrap-minikube-linux.sh`, `rebuild-all.sh`,
  `rebuild-changed.sh`, `dev-mode.sh` and `dev-mode-minikube.sh` read for image builds.
- `rebuild-redeploy.sh`: add to `VALID_SERVICES`; add
  `tracking-ingester-service) echo "" ;;` to `get_ksvc_names` (worker-only, no KSVC)
  and `tracking-ingester-service) echo "tracking-ingester-worker" ;;` to
  `get_deployment_names`.
- `rebuild-changed.sh`: same ksvc/deployment mapping in its per-service branch
  (`ksvc_name` empty, `deploy_names="tracking-ingester-worker"`).
- `dev-mode.sh` AND `dev-mode-minikube.sh`: add the per-service case emitting the
  tab-separated tuple `deploy	tracking-ingester-worker	src/main.ts	tracking-ingester-service`
  (same shape as the `usage-aggregator-service` case).

**Accept:**
```sh
rg -l 'tracking-ingester' services.conf rebuild-redeploy.sh rebuild-changed.sh dev-mode.sh dev-mode-minikube.sh | wc -l   # = 5
bash -n rebuild-redeploy.sh rebuild-changed.sh dev-mode.sh dev-mode-minikube.sh bootstrap-orbstack-osx.sh
./rebuild-redeploy.sh tracking-ingester-service dev
kubectl -n platform-services-dev rollout status deploy/tracking-ingester-worker
```
Pod Ready; logs show `trk-*` durables created and first events persisted.

### T11 — Grafana datasource: tracking Postgres

Add a `grafana-postgres` datasource entry to
`infrastructure/base/observability/grafana/configmap.yaml` pointing at the platform
Postgres (dev credentials, dev-only cluster).

**Accept:**
```sh
kubectl kustomize infrastructure/base/observability/grafana >/dev/null
```
After apply: Grafana API `GET /api/datasources` lists the Postgres datasource.

### T12 — Dashboard: `message-tracking.json`

New key in `dashboards-configmap.yaml`. Panels: events/min by `business_fn` and by `tech`,
unknown-classification alarm (rule 16/17/18 count, threshold > 0), claim-check ratio,
DLQ volume, open vs closed correlation chains (chains whose last event is not a
terminal `business_fn`), top correlation chains by depth.

**Accept:**
```sh
kubectl kustomize infrastructure/base/observability/grafana >/dev/null
```
After apply: Grafana API `GET /api/search?query=Message Tracking` returns the dashboard.

### T13 — End-to-end validation

Drive the telegram sample through the cluster; verify the full chain lands in
`tracking.tracked_events` (ingress → channel-processing → agent-execution →
channel-egress under one `correlation_id`, depth increasing) and renders in the dashboard.

**Accept:** SQL over `tracking.tracked_events` for the new `correlation_id` returns the
closed chain (>= 4 stages, `unknown` count = 0); dashboard panels show the traffic.

---

## Progress

- [x] T01 scaffold
- [x] T02 classifier (golden >= 90%)
- [ ] T03 facets
- [ ] T04 row mapper
- [ ] T05 DDL
- [ ] T06 insert
- [ ] T07 consumer
- [ ] T08 wiring
- [ ] T09 deploy (Dockerfile + kustomize)
- [ ] T10 script registration (bootstrap / rebuild / dev-mode)
- [ ] T11 datasource
- [ ] T12 dashboard
- [ ] T13 e2e
