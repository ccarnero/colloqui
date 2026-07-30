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

## Payload capture, retention & access

`manual-loops/payload-capture.md` — every event payload is durably captured
(claim-checked payloads resolved at ingest, not just inline ones) and access is
tenant-admin-only with an audit trail. Storage stays bounded via a scheduled
retention scrub.

### Payload lifecycle (`tracked_events.payload_status`)

Every row carries a `payload_status` state machine:

| State | Meaning | Set by |
|---|---|---|
| `inline` | Envelope arrived with `data.payload` already present. | Insert (`to-tracked-event-row.ts`). |
| `resolved` | Envelope was claim-checked (`data.payload_inline === false`); the ingester resolved `payload_ref` against cache-service at ingest time and persisted the full payload. | `resolve-payload.ts` success path. |
| `unresolved` | Claim-check resolution failed (expired ref, cache unreachable, malformed ref, timeout). The slim envelope is persisted exactly as it arrived — no payload. | `resolve-payload.ts` failure path. |
| `scrubbed` | Retention scrub emptied `envelope.data.payload` for a row past `PAYLOAD_RETENTION_DAYS`; `payload_scrubbed_at` records when. | `src/scripts/scrub-payloads.ts`. |
| `none` | The event never carried a payload (non-envelope bodies, drift rows, heartbeats). | Insert. |

Transitions: `inline`/`resolved` → `scrubbed` (one-way, by the scrub job).
`unresolved` and `none` are terminal — a claim-check that failed to resolve is
never retried, and an event with no payload shape never gains one.

### Claim-check resolution at ingest

`is_claim_check` (`data.payload_inline === false`) events are resolved BEFORE
persisting, via `resolve-payload.ts` wrapping
`resolveClaimCheckEnvelope` (`packages/database/src/claim-check.ts`):

- **Timeout**: `CLAIM_CHECK_RESOLVE_TIMEOUT_MS` (default `2000`).
- **Never blocks ingestion**: on any resolution failure the slim envelope is
  persisted as-is with `payload_status = 'unresolved'` and a warn log carrying
  the `payload_ref` and the failure reason. The consumer message is **never
  nacked** for a resolution failure — ingestion latency is the priority, and
  this service runs DLQ-disabled with unbounded `maxDeliver`, so a
  resolve-then-nak retry loop on an expired ref would poison the stream
  forever without ever persisting the row.
- **Middleware opt-out**: the ingester's `MultiTenantConsumerManager` config
  sets `resolveClaimChecks: false` (`main.ts`) so the shared consumer
  middleware never resolves claim-checks itself. Resolution happens exactly
  once, inside `makeTrackedEventHandler`, right before insert.

### Retention

`PAYLOAD_RETENTION_DAYS` (default `30`) is the single source of truth for how
long payload *content* lives. Causal-chain metadata (everything except
`envelope.data.payload`) is retained forever — the scrub only empties the
payload field and flips `payload_status` to `scrubbed`.

**Scrub runbook** (`src/scripts/scrub-payloads.ts`):

1. **Dry-run by default** — running the script with no flags prints
   per-tenant candidate counts (rows with `occurred_at` older than the
   retention cutoff and `payload_status IN ('inline', 'resolved')`) and
   changes nothing.
2. **First `--apply`, run by a human**: a scheduled, unattended CronJob is not
   allowed to be the first thing that ever scrubs production data. A human
   runs the script once against the live cluster and verifies the result:
   ```bash
   kubectl exec -n platform-services-dev deploy/tracking-ingester-worker -- \
     bun src/scripts/scrub-payloads.ts --apply
   # or against the built image:
   bun dist/scripts/scrub-payloads.js --apply
   ```
   The script is idempotent (a `scrubbed` row can never match the predicate
   again) and batched (5000 rows per round trip, `FOR UPDATE SKIP LOCKED`,
   looping until a batch affects zero rows).
3. **Unsuspend the CronJob** (`tracking-payload-scrub`, daily at 04:00 UTC,
   `knative/services/base/tracking-payload-scrub-cronjob.yaml`) once the
   manual run is verified — it starts `suspend: true` for exactly this
   human-runs-first gate:
   ```bash
   kubectl patch cronjob tracking-payload-scrub -n platform-services-dev \
     -p '{"spec":{"suspend":false}}'
   ```

**Current dev state**: the first manual `--apply` has already been run against
`platform-services-dev` and `tracking-payload-scrub` is unsuspended, running
daily at 04:00 UTC.

**Re-creation via `rebuild-redeploy.sh`**: `./rebuild-redeploy.sh
tracking-ingester-service dev` calls `ensure_cronjobs`, which re-creates
`tracking-payload-scrub` automatically if it is ever missing from the
namespace (e.g. a fresh cluster), applying it from the local kustomize
overlay — suspended per the manifest, so the human-runs-first gate above
applies again. If the CronJob already exists, the script leaves
`spec.suspend` completely untouched; it never re-applies or patches an
existing CronJob, so a human-managed unsuspend is never reverted by a
rebuild.

### Chain read endpoint

`GET /chains/:correlationId` (tenant header `x-yoizen-tenant` required, set
by the gateway proxy) → the causal chain for a `correlation_id`: `400` if
the tenant header is missing, `404` if the correlation has zero matching
rows. Built from `build-chain-query.ts` (events) + `build-spans-query.ts`
(spans) + `to-chain-response.ts` (response shaping) — pure functions in
`src/lib/`, with only the query execution living in `main.ts`.

Response shape:

```
{
  correlation_id, tenant,
  events: [...],
  spans: [...],
  summary: { count, first_at, last_at, total_ms, orphan_count }
}
```

- `events[]` are `tracked_events` rows minus the raw `envelope` jsonb, plus
  a derived `has_envelope` boolean (`compliance <> 'none'`) — the list
  payload never carries the full envelope body; use the payload read
  endpoint below for that.
- `spans[]` carry `kind_prefix`, `entity_id`, `started_at`, `completed_at`,
  `duration_ms` from `tracking.tracked_event_spans`.
- `summary.orphan_count` counts events whose `causation_id` is non-null and
  not present as an `event_id` anywhere in the same event set — a true
  root-less orphan, or a parent excluded by the tenant scope.
- `summary.first_at`/`last_at`/`total_ms` are derived from `occurred_at`
  across all returned events.

**Tenant scoping**: rows are scoped by `(tenant = $2 OR tenant IS NULL)` —
rows with `tenant IS NULL` (drift/non-envelope rows that never carried a
tenant) belonging to the correlation are INCLUDED, not excluded, so the
chain stays complete; `has_envelope`/`compliance` on those rows lets a
consumer flag them distinctly. This is a deliberate product decision
(`manual-loops/trace-console.md` §User decisions 4), not an oversight.

The gateway proxies this route (`GET /api/tracking/chains/:correlationId`)
under the standard tenant/auth guards. The admin console's trace views
(waterfall + causal graph, `processes/trace/:correlationId`) are the
consumer — see `DOCS/guides/trace-console.md` for the console-facing
contract.

### Payload read endpoint

`GET /chains/:correlationId/events/:eventId/payload` (tenant header
required) → `{ payload, payload_status }` on success. `404` for an unknown
event, `404` when `payload_status` is `none` or `unresolved` (body explains
why), `410 Gone` when `payload_status` is `scrubbed`. The chain LIST endpoint
still excludes payloads by design — this is a dedicated, separately-guarded
route. The gateway proxies this route with a tenant-admin permission guard
(`tracking:payload:read`) and audits every successful view; see
`DOCS/guides/trace-console.md` for the console-facing contract.

### Run view endpoint

`GET /runs/:workflowId/:runId` (tenant header required) → a per-instance
execution view for a single Temporal run — "what did THIS run do, step by
step", complementary to the chain endpoint above (cross-service causality)
and the Tempo waterfall (span timing). The gateway proxies this route at
`/api/tracking/runs/:workflowId/:runId` as a wildcard route, because the
deployed gateway router does not match colon-bearing named-param segments
and `workflowId` is itself a Temporal id containing colons
(`tenant:name:...:...`).

Response shape:

```
{
  workflow_id, run_id, correlation_id, tenant,
  events: [...],
  spans: [...],
  summary: { status, started_at, completed_at, total_ms, steps_ok, steps_failed },
  cast: [{ kind: "connector" | "agent" | "channel" | "tool", id, name, count }],
  step_detail
}
```

**Run-scoping semantics**: the endpoint resolves the run's correlation via
its `execution_started` row, then filters to that run's own events only —
step events by `causation_id` match against the run's `execution_started`,
and `execution_completed` by `executionId` match. Sibling runs that happen
to share the same trigger's `correlation_id` are excluded; a single
correlation chain can fan out into multiple runs, and this endpoint returns
exactly one of them.

**Errors and degraded state**: `404` for an unknown `workflowId`/`runId`
pair — this also covers genuinely pre-step-events runs (before
`manual-loops/workflow-step-events.md` shipped `execution_started`), since
those never recorded a real `workflowId`/`runId` and are not resolvable by
this endpoint at all (only `GET /chains/:correlationId` can reach them).
`step_detail` is `false` for runs that DO resolve but whose own scoped
events carry no step-level kinds (`action_started` / `action_completed` /
`condition_evaluated`) — e.g. a workflow definition with zero actions — so
the console falls back to an artifact-only view; see
`DOCS/guides/trace-console.md` for the console-facing contract.

### Events-by-type/resource read endpoint

`GET /events?type=<t>&resource=<r>&from=<iso>&limit=<n>` (tenant header
`x-yoizen-tenant` required) → a filtered, `occurred_at DESC` list of
`tracking.tracked_events` rows for a given envelope `type` — the general
read endpoint the connector "Recent calls" panel (and any future
entity-detail "recent activity" panel) uses instead of audit-service's
60-minute window.

Query params:

- `type` (required) — matches `envelope->>'type'` (the CloudEvents-style
  field, e.g. `"connector.endpoint_call.completed.v1"`), NOT the
  `domain`/`kind`/`version` columns derived from the NATS subject (those
  project as a different string for the same event family). `400` when
  missing.
- `resource` (optional) — matches `envelope->>'resource'` (e.g.
  `"adapter/<adapterId>"`).
- `from` (optional) — inclusive lower bound on `occurred_at`, ISO-8601.
  `400` if present but not a parseable date.
- `limit` (optional) — clamped via the shared `clampListLimit` helper:
  default `50`, hard cap `500`.

`400` when the `x-yoizen-tenant` header is missing. Rows are scoped by a
strict `tenant = $1` (no `OR tenant IS NULL` — unlike the chain/payload
endpoints, this event family always carries a real tenant). `200` with an
empty `events` array when nothing matches — this is a filtered list, not a
single-resource lookup, so an empty result is not a `404`.

Response projection excludes the raw `envelope` jsonb (same chain-list
decision as `GET /chains/:correlationId`) but adds payload scalars
extracted server-side — request/response BODIES stay excluded from every
list projection, same as the chain endpoint.

Built from `build-events-query.ts` (query) + `parse-events-query.ts`
(validation) + `handle-events-request.ts` (orchestration) — same pure-core,
I/O-at-the-edges shape as the chain/run endpoints.

### Type-aware scalar projections (`manual-loops/connectors/connection-call-inspector.md` T05/T06)

`build-events-query.ts`'s column set (`EVENTS_COLUMNS`) is a STATIC
superset of scalar columns covering every supported `envelope->>'type'` —
NOT branching SQL per type, since a single `/events` call is already
scoped to exactly one `type` via the `WHERE` clause; a row for a kind that
doesn't carry a given field simply projects `null` for it (Postgres'
"empty jsonb path → null" behavior):

| Kind | Scalars projected |
|---|---|
| `connector.endpoint_call.completed.v1` (`service/<name>`, `raw/<host>`, `adapter/<id>`, `invocation/<id>` resources) | `payload_method`, `payload_resolved_url`, `payload_http_status`, `payload_duration_ms`, `payload_cache_result` |
| `connector.mcp_call.completed.v1` (`mcp/<mcpServerId>`) | `payload_tool_name`, `payload_success`, `payload_error` (message only — never a full error object) |
| `ai.llm_call.completed.v1` (`execution/<executionId>`) | `payload_model`, `payload_provider`, `payload_duration_ms`, `payload_input_tokens`, `payload_output_tokens`, `payload_cost_usd` |
| Agent `execution_completed` | `payload_state`, `payload_model`, `payload_duration_ms` (if present), `payload_cost_usd` |

Bodies/args/results/prompts (`requestBody`/`responseBody`/`arguments`/
`result`/`prompt`/`completion`) are NEVER projected by this endpoint —
only the guarded payload-read endpoint above returns them, per-event, with
its audit trail.

**`resource=agent/<agentId>` filter alias**: agent-execution events
(TAXONOMY.md rule 6) do not carry an `agent/<agentId>`-shaped
`envelope.resource` — the emitter sets `resource: "execution/<executionId>"`.
Rather than require an emitter change outside this service, `resource`
values prefixed `agent/` are handled as a query-level alias: they filter
on the agent-execution payload's `agentId` field instead
(`COALESCE(envelope->'data'->'payload'->>'agentId',
envelope->'data'->'payload'->'input'->>'agentId')`, covering both
`execution_started`/`execution_completed`'s top-level `agentId` and
`execution_requested`'s nested `input.agentId`). Every other `resource`
value (`service/<name>`, `raw/<host>`, `mcp/<mcpServerId>`, `adapter/<id>`,
`invocation/<id>`) matches `envelope->>'resource'` verbatim, unchanged.

### New event kinds classified (T05)

`src/lib/classify.ts` adds two rules for the two new kinds this loop
introduces (full detail: `TAXONOMY.md` §4 rules 24/25):

- **Rule 24** — `connector.mcp_call.completed.v1`
  (`evt.*.connector-runtime.platform.mcp.system.mcp_call_completed.v1`) →
  `tech: connector`, `business_fn: connector-invocation` (REUSED, not a new
  value — MCP tool calls are grouped with `endpointCall` as one of "every
  connector invocation type" per the SPEC). Evaluated right after rule 11
  (same producer, different channel token — `mcp`, not `endpoint` — so
  rule 11's substring check never matches it).
- **Rule 25** — `ai.llm_call.completed.v1`
  (`evt.*.agent-ai-service.platform.llm.system.llm_call_completed.v1`) →
  `tech: platform`, `business_fn: llm-invocation` (a NEW value, distinct
  from rule 6's `agent-execution` and rules 11/24's `connector-invocation`
  — a standalone LLM call is its own producer-intent business concern).
- `serviceCall`/raw-branch `connector.endpoint_call.completed.v1` events
  classify under the EXISTING rule 11 unchanged — same kind, just new
  `resource` prefixes (`service/<name>`, `raw/<host>`), which rule 11 never
  inspects.

The gateway mirrors this route at `GET /api/tracking/events` under the
standard tenant/auth guards, forwarding query params verbatim — same
explicit-proxy-module pattern as the chain/run/payload routes
(`services/api-gateway/src/modules/tracking`).

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

The golden gate (`test/classify.golden.spec.ts`) re-applies the `TAXONOMY.md` §4
rules to the repo-root dataset `golden/labeled.tsv` (the audited truth — one
header line plus the data rows) and asserts >= 90% accuracy on (`tech`,
`business_fn`, `rule`) across the 92 audited rows. Drift in `classify.ts` beyond
that threshold fails the gate.

Recount the dataset with:

```bash
echo $(( $(rg -c '\S' golden/labeled.tsv) - 1 ))   # from the repo root -> 92
```

`scripts/checks/doc-code-guards.sh` guard **K9b(numeric-claims)** pins the three
numbers above (this README, the spec's row-count assertion, and the file itself)
to the same value, so this paragraph cannot silently go stale.

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
