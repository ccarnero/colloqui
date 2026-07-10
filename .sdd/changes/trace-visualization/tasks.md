# Tasks: Trace Visualization — Tempo waterfall + causal node graph in Grafana

Tasks are ordered by dependency. Each task is independently verifiable before the next begins.

**Context**: `services/tracking-ingester-service` already persists classified events to Postgres (`tracked-events.sql`). Infra already ships `infrastructure/base/observability/{tempo,otel-collector,grafana}`. This change adds: OTel span emission from tracked events, two provisioned Grafana dashboards (trace waterfall via Tempo + causal node graph via SQL), and click-through data links (connector detail, Temporal UI, Tempo trace).

**Open decisions (USER — blocking only where noted):**
1. Payload policy for the trace detail table: show `payload` jsonb as-is, truncated, or masked? Claim-check events: show reference only, or resolve the payload? → blocks the detail-table panel of T5 only. Note: connector-call events already ship redacted headers + truncated bodies (see `.sdd/changes/connector-call-detail`), so this decision covers the remaining event families.

---

## T0 — Reconcile with existing traceability UI (docs only, no code)

✅ DONE — `design.md` created with the complementarity note, citing `processes-message-trace`, `channel-trace-entry`, and `connector-call-detail`; states the non-duplication boundary.

**Files to read:**
- `.sdd/changes/processes-message-trace/design.md`
- `.sdd/changes/channel-trace-entry/design.md`
- `.sdd/changes/connector-call-detail/design.md` (trace link to `/processes/trace/:correlationId`)

**Deliverable:** `design.md` in this change folder with a short "complementarity note": admin-console trace page = per-message product/support view; Grafana/Tempo = operational view (latency, bottlenecks, cross-trace analytics). Document which view links to which (admin-console trace page MAY link out to the Grafana trace dashboard by correlation_id; Grafana does NOT duplicate the admin-console UI).

**Acceptance check:** design.md exists, cites the three prior changes, and states the non-duplication boundary explicitly.

---

## T1 — Span pairing + pure span mapping in the ingester

✅ DONE — `to-otel-span.ts` (pure mapper) + `span-pairs.sql` (idempotent `CREATE OR REPLACE VIEW tracking.tracked_event_spans`) + `test/to-otel-span.spec.ts` (10 tests, hand-built telegram-chain fixture since no pre-existing chain fixture exists in `fixtures/bus-events/`). `bun test test/to-otel-span.spec.ts && bun tsc --noEmit` green. Wired `span-pairs.sql` into `src/scripts/apply-schema.ts` load order (after `tracked-events.sql`).

**Files to create (verify final paths with codegraph before editing):**
- `services/tracking-ingester-service/src/sql/span-pairs.sql` — view `tracked_event_spans`: pairs `*_started`/`*_completed` rows sharing correlation_id + entity id (workflow execution, agent execution, connector call) into (span_start, span_end, duration_ms); unpaired/point events yield zero-duration spans. Idempotent `CREATE OR REPLACE VIEW`, loaded via the existing `load-schema-statements.ts` mechanism.
- `services/tracking-ingester-service/src/lib/to-otel-span.ts` — pure function: span row → OTLP span object.
  - trace_id = correlation_id UUID without dashes (32 hex chars)
  - span_id = first 16 hex chars of event_id UUID without dashes
  - parent_span_id = same derivation over causation_id (absent when causation is null)
  - service.name = emitting service; attributes: `tech`, `business_fn`, `is_claim_check`, `compliance`, `tenant`
- `services/tracking-ingester-service/test/to-otel-span.test.ts`

**Test cases (fixtures from `fixtures/bus-events/`):**
- telegram chain fixture → root span has no parent; every other span's parent_span_id equals the span_id derived from its causation event
- workflow started/completed pair → single span with duration_ms = ts_completed − ts_started
- point event (`sent`) → zero-duration span
- event with causation null → span emitted without parent (NOT dropped), attribute `causation_missing=true`

**Acceptance check:**
```bash
cd services/tracking-ingester-service && bun test test/to-otel-span.test.ts && bun tsc --noEmit
```

---

## T2 — OTLP exporter wired into the ingest path

✅ DONE — `emit-otel-spans.ts` (OTLP/HTTP JSON POST, fire-and-forget, injected `fetch`), `load-config.ts` extended (`OTEL_EXPORT_ENABLED` / `OTEL_EXPORTER_OTLP_ENDPOINT`, hard error only when enabled-but-unset), `tracked-event-buffer.ts` extended with an optional `emitSpans` callback fired (not awaited) after successful insert, `to-span-source-row.ts` (real-time point-span projection — see apply-progress.md discovery note on why pairing is NOT done at emit time), `main.ts` wired end-to-end. `bun test && bun tsc --noEmit` green (162 pass).

**Files to create/modify:**
- `services/tracking-ingester-service/src/lib/emit-otel-spans.ts` — posts OTLP/HTTP JSON to `OTEL_EXPORTER_OTLP_ENDPOINT` (the in-cluster otel-collector). Result type return; verbose log on export failure; export failure MUST NOT fail ingestion (fire-and-forget with error logging).
- `services/tracking-ingester-service/src/lib/load-config.ts` — add `OTEL_EXPORTER_OTLP_ENDPOINT` (explicit error if unset AND `OTEL_EXPORT_ENABLED=true`; disabled = no-op emitter).
- Wire into the flush path of `tracked-event-buffer.ts` (after successful Postgres insert, emit spans for the flushed batch).
- `services/tracking-ingester-service/test/emit-otel-spans.test.ts` — mock fetch: correct OTLP envelope shape (resourceSpans/scopeSpans), batch of N events → N spans, export error → ok(inserted) still returned + error logged.

**Acceptance check:**
```bash
cd services/tracking-ingester-service && bun test && bun tsc --noEmit
```

---

## T3 — Collector → Tempo pipeline + Grafana Tempo datasource verified

✅ DONE — no infra changes needed; the traces pipeline (OTLP receiver → batch → `otlp/tempo` exporter) and the Grafana Tempo datasource already existed and were verified LIVE against the dev cluster. `kubectl kustomize infrastructure/base/observability` clean. Live smoke: POSTed a synthetic OTLP span to `otel-collector:4318/v1/traces` (HTTP 200), retrieved it via `tempo:3200/api/traces/{traceId}` within ~5s (HTTP 200, span present), confirmed Grafana's `/api/datasources` lists a `tempo`-type datasource. Commands used:
```bash
kubectl port-forward -n support-services-dev svc/otel-collector 4318:4318 &
kubectl port-forward -n support-services-dev svc/tempo 3200:3200 &
curl -X POST http://localhost:4318/v1/traces -H "Content-Type: application/json" -d @otlp-smoke.json   # -> 200
curl http://localhost:3200/api/traces/<traceId>   # -> 200, span present
```

**Files to verify/modify:**
- `infrastructure/base/observability/otel-collector/*` — traces pipeline receives OTLP/HTTP and exports to Tempo (extend config if missing).
- `infrastructure/base/observability/grafana/configmap.yaml` — Tempo datasource present (add if missing).

**Acceptance check:**
```bash
kubectl kustomize infrastructure/base/observability >/dev/null
```
Plus dev smoke: `curl` one OTLP span to the collector endpoint → span retrievable via Tempo query API (`/api/traces/{traceId}`) within 30s. Document the exact smoke commands in the task completion note.

---

## T4 — Detail columns for click-through: workflow_id, run_id, connector_id, cache_status

✅ DONE — `tracked-events.sql` (4 idempotent `ADD COLUMN IF NOT EXISTS`, all nullable, + an index on `connector_id`), `extract-detail-columns.ts` (new pure extractor, rule 19 → workflow_id/run_id, rule 11 → connector_id/cache_status), wired into `to-tracked-event-row.ts` and `build-non-envelope-row.ts` (always null there), `insert-tracked-events.ts` extended to persist all 4 (22 total UNNEST columns now). `bun test && bun tsc --noEmit` green (176 pass). Schema live-applied + idempotency-verified against dev Postgres (`bun run src/scripts/apply-schema.ts` run twice, second run pure NOTICE/no-op).
- IMPORTANT DISCOVERY (documented in `extract-detail-columns.ts` + apply-progress.md): the live workflow `execution_completed` publisher (`execution-completed-publisher.activity.ts`) does NOT emit Temporal's real `workflowId`/`runId` — only `executionId`/`status`/`workflowName?`. `workflow_id` currently falls back to `executionId`; `run_id` is null for every real row today. This is a RISK for T6's Temporal-UI data link (needs a real workflowId+runId pair) — flagged for the T6/T9 checkpoint.

**Files to modify (verify with codegraph):**
- `services/tracking-ingester-service/src/sql/tracked-events.sql` — add nullable columns `workflow_id`, `run_id`, `connector_id`, `cache_status` (idempotent ALTER ... IF NOT EXISTS pattern consistent with existing schema loader).
- `services/tracking-ingester-service/src/lib/to-tracked-event-row.ts` — extract from envelope/payload: workflow events → workflowId/runId; connector endpoint-call events → connector id + cacheResult/cacheKey (fields shipped since `.sdd/changes/connector-call-detail`). Absent → null, never throw.
- Extend `test/to-tracked-event-row.test.ts` with one fixture per family (workflow, connector with cache hit, connector without cache, unrelated event → all nulls).

**Acceptance check:**
```bash
cd services/tracking-ingester-service && bun test && bun tsc --noEmit
```

---

## T5 — Dashboard "Message traces" (provisioned JSON)

✅ DONE — live-verified against dev cluster + real ingested data.
- PATH DEVIATION (documented): the repo does NOT use a `grafana/dashboards/*.json` file-per-dashboard layout — every dashboard already ships as an inline JSON block inside `infrastructure/base/observability/grafana/dashboards-configmap.yaml` (verified: `message-tracking.json`, `nats-overview.json`, etc. all live there, and `dashboards-provider.yaml` points its file-provider at `/var/lib/grafana/dashboards`, populated by that single ConfigMap volume mount). Added `message-traces.json` as a new top-level key in that SAME file, matching the existing convention, instead of creating a new `dashboards/` directory tasks.md assumed.
- Implemented: `$correlation_id` (textbox) + `$tenant` (query, multi) variables; a hidden derived `$trace_id` variable (`SELECT replace('$correlation_id','-','')`, Postgres datasource) solves the "Tempo needs dashes stripped, Postgres needs the dashed UUID" mismatch cleanly (a real Grafana pattern — chained query-type variable). Panel 1 (`traces` type, Tempo datasource, TraceQL `${trace_id}`). Panel 2 (`nodeGraph`, Postgres — nodes colored by `business_fn` via a `color` field, edges join `causation_id -> event_id`, null-causation rows naturally render as detached roots). Panel 3 (`table`, all columns incl. taxonomy/is_claim_check/compliance/cache_status; `payload` column is an explicit `NULL::text AS payload` placeholder with a `-- TODO(open decision 1, ...)` SQL comment).
- Verification: JSON extracted + `jq .` clean; `kubectl kustomize infrastructure/base/observability` clean; live Grafana provisioning smoke (`kubectl apply` the configmap, port-forward, poll `GET /api/dashboards/uid/message-traces`) → HTTP 200, `provisioned: true`, all 3 panels + 4 variables present with correct types. BOTH SQL queries (nodes + edges) run against a REAL 11-event telegram chain already ingested in dev (`correlation_id=8c2479be-95c1-460f-bbd7-a9b79312952c`) → 11 nodes / 10 edges / 11 detail rows returned, matching T8's expected chain shape exactly.
- Note: the Tempo waterfall panel itself has NOT been visually confirmed with real span data yet — the pre-existing ingested rows predate this change's T2 span-emission code, so no spans exist in Tempo for that correlation_id until `tracking-ingester-worker` is rebuilt/redeployed with the new code (see final report "services to rebuild"). This is expected and does not block T5's acceptance (SQL correctness + provisioning), only the visual T9 checkpoint.

**Files to create/modify:**
- `infrastructure/base/observability/grafana/dashboards/message-traces.json`
- `infrastructure/base/observability/grafana/dashboards-configmap.yaml` — register the dashboard following the existing provider pattern.

**Dashboard spec:**
- Variable `$correlation_id` (textbox) + variable `$tenant` (query).
- Panel 1 — Traces (Tempo datasource): query by trace id = `$correlation_id` (dashes stripped) → native waterfall.
- Panel 2 — Node Graph (Postgres datasource): nodes query (id=event_id, title=event kind, subTitle=service, mainStat=t+offset ms, color by `business_fn`) + edges query (id, source=causation_id's event, target=event_id) filtered by `$correlation_id`. Events with null causation appear as detached roots (drift made visible).
- Panel 3 — detail table: all events of the trace ordered by ts, columns incl. taxonomy, `is_claim_check`, `compliance`, `cache_status`; payload column per Open decision 1 (leave placeholder + TODO comment referencing the decision if still unresolved).
- Rules: dashboards ONLY as provisioned JSON in the repo (hand-edits in Grafana UI are rejected in review); all datasource refs by variable, no hardcoded hosts.

**Acceptance check:** JSON parses (`jq . < message-traces.json`); `kubectl kustomize` clean; Grafana provisioning smoke: POST/load via local Grafana API returns 200; both SQL queries return rows for the telegram fixture chain ingested in dev.

---

## T6 — Dashboard "Connector detail" + data links

✅ DONE (JSON + links + SQL-live-verified) — ⚠️ Temporal-UI link NOT e2e-verified, see risk below.
- Added `connector-detail.json` (same inline-ConfigMap convention as T5) with `$connector` query variable, dashboard links (Message traces / Tempo Explore / Temporal UI), and 5 panels: invocations/hour, latency p50/p95 (reads `tracking.tracked_event_spans`, extended in this task to carry `connector_id`/`cache_status` through — see T1 SQL update below), error rate (derived from `envelope.data.payload.status`, no dedicated status column exists), cache hit-rate, and a "Last 50 calls" table with a `raw_envelope` column using Grafana's `json-view` cell type for inspection (connector-call-detail's redaction already applies to what's inside the envelope — no double-redaction here).
- Added data links to BOTH dashboards exactly per spec: `message-traces.json` table rows (`workflow_id`→Temporal, `connector_id`→connector-detail) and node-graph nodes (via `detail__workflow_id`/`detail__run_id`/`detail__connector_id` fields + matching link overrides); `connector-detail.json`'s calls table (`correlation_id`→message-traces).
- Retrofitted `services/tracking-ingester-service/src/sql/span-pairs.sql` (T1) to carry `connector_id`/`cache_status` through the view — required for this task's latency panel to filter by connector; without it the view (built before T4 added those columns) couldn't expose them. Idempotent, live-verified (`CREATE OR REPLACE VIEW` re-applied cleanly against dev Postgres; `SELECT count(*) FROM tracking.tracked_event_spans` → 15,296 rows).
- Verification: both JSONs `jq .` clean; `kubectl kustomize` clean; grep-documented string assertions (see apply-progress.md for exact commands) confirm all 3 required link templates present verbatim; live Grafana provisioning smoke — `kubectl apply` + `GET /api/dashboards/uid/connector-detail` → HTTP 200 (and re-confirmed `message-traces` still 200 after the link additions).
- **RISK — Temporal URL e2e NOT verified**: attempted per the blocker policy (cluster IS reachable). Query `SELECT ... FROM tracking.tracked_events WHERE workflow_id IS NOT NULL` on dev Postgres returned ZERO rows — no workflow-execution event has been ingested with the new `workflow_id` column populated yet, because `tracking-ingester-worker` in the cluster still runs the PRE-T4 image. This is expected (schema-only change deployed via `apply-schema.ts`, not a full service redeploy) and is the SAME root cause flagged in T4: even once workflow_id rows exist, they will carry `executionId` (not Temporal's real `workflowId`), so the interpolated URL is expected to 404 against temporal-ui until the publisher itself is extended (out of this change's file scope). Documented for T9; `tracking-ingester-worker` needs a rebuild+redeploy before this can be re-attempted at all.

**Files to create/modify:**
- `infrastructure/base/observability/grafana/dashboards/connector-detail.json` — variable `$connector`; panels: invocations/hour, latency p50/p95 (from paired spans view), error rate, cache hit-rate (from `cache_status`), last 50 calls table with JSON cell inspection.
- `message-traces.json` (T5) — add data links:
  - workflow rows/nodes → Temporal UI: `${temporal_ui_base}/namespaces/default/workflows/${__data.fields.workflow_id}/${__data.fields.run_id}` (base URL as dashboard variable, not hardcoded)
  - connector rows/nodes → connector-detail dashboard with `$connector` interpolated
  - any event row → Tempo trace panel by correlation_id

**Acceptance check:** both JSONs parse; link templates contain the exact variable interpolations above (string assertion test in repo or documented grep); e2e: with the fixture chain ingested, the interpolated Temporal URL for the workflow row returns HTTP 200 against temporal-ui in dev.

---

## T7 — Entry points & direct-access links

✅ DONE — fully live-verified against dev cluster.
- `DOCS/guides/trace-console.md` created: all required URLs, the "30-second" mini-guide, the admin-console-vs-Grafana view-selection note (cites T0's design.md), the Open decision 1 status, and the T4/T6 Temporal-link limitation flagged transparently.
- Folder grouping: split the two new dashboards into a SEPARATE ConfigMap (`infrastructure/base/observability/grafana/dashboards-message-tracking-configmap.yaml`, new `grafana-dashboards-message-tracking` ConfigMap) + a second `dashboards-provider.yaml` provider entry (`folder: "Message tracking"`) + a second volume/mount in `deployment.yaml`. This was REQUIRED because Grafana's file provisioner assigns one folder per provider/path — a single flat ConfigMap-mounted directory (the existing `grafana-dashboards` layout) cannot split dashboards across folders. `kustomization.yaml` updated to include the new file.
- Dashboard links (top-of-dashboard, native Grafana `links` array) were already added in T5/T6 (sibling dashboard + Tempo Explore + Temporal UI as a variable) — confirmed still present after the folder-provider refactor.
- `port-forward.sh` extended: `grafana` + `tempo` added to `SUPPORT_SERVICES` (alongside the pre-existing `temporal-ui`), with `GRAFANA_PORT`/`TEMPO_PORT` env overrides; a new `print_trace_console_urls` function echoes every guide URL after the existing summary. `bash -n port-forward.sh` clean.
- Live verification (full loop): `kubectl apply` on the new ConfigMap + updated provider + deployment → `kubectl rollout status deployment/grafana` succeeded → `GET /api/folders` shows a "Message tracking" folder → `GET /api/search?folderUIDs=<uid>` lists BOTH dashboards inside it → direct HTTP checks, ALL returned 200: the tag-filtered dashboard list (`/dashboards?tag=message-tracking` — used instead of a folder-UID URL since Grafana folder UIDs are server-generated, not deterministic), `/d/message-traces?var-correlation_id=<real-chain-id>`, `/d/connector-detail?var-connector=<id>`, `/explore?left=...tempo...`.

Goal: the user reaches everything in one click — no URL-crafting, no hunting through Grafana menus.

**Files to create/modify:**
- `DOCS/guides/trace-console.md` — the single entry-point guide: every URL copy-pasteable for the dev environment:
  - Grafana folder "Message tracking" URL
  - "Message traces" dashboard URL with templated example: `.../d/message-traces?var-correlation_id=<PASTE_HERE>`
  - "Connector detail" dashboard URL with `var-connector` example
  - Tempo Explore URL (search traces without knowing the id)
  - Temporal UI base URL
  - admin-console trace page URL pattern (`/processes/trace/:correlationId`)
  - Mini-guide "trace a message in 30 seconds": where to get a correlation_id (admin-console or SQL one-liner provided) and where to paste it.
- Grafana provisioning — both dashboards grouped under folder **"Message tracking"** (via the existing `dashboards-provider.yaml` mechanism); add native **dashboard links** at the top of each dashboard pointing to: the sibling dashboard, Tempo Explore, and Temporal UI (base URL as variable).
- `port-forward.sh` — ensure grafana, tempo and temporal-ui ports are forwarded; on start, echo the entry URLs from the guide so they are always one terminal-scroll away.

**Acceptance check:** guide exists with all URLs; provisioned Grafana shows the folder with both dashboards; dashboard links render at the top of each; `port-forward.sh` prints the URLs; every printed URL returns HTTP 200 in dev.

---

## T8 — End-to-end verification (machine)

✅ DONE — live-verified against the full dev stack (Postgres + otel-collector + Tempo), 38/38 assertions pass.
- `services/tracking-ingester-service/test/e2e/trace-visualization.e2e.spec.ts` created, following the service's OWN existing skip-when-no-DSN convention (`test/insert-tracked-events.spec.ts`), not other services' NestJS/testcontainers `test/e2e/setup.ts` pattern (this service has neither).
- Fixture chain: hand-built 11-event/10-edge CAUSAL TREE (not linear — verified to match the shape of a REAL already-ingested dev chain, which fans out rather than chaining flat), covering ingress/channel-processing/agent-execution (a real started+completed pair)/connector-invocation/workflow-execution/channel-egress — exercises every rule family T1-T4 touch.
- Verifies, live, exactly what T8 asks: (1) Tempo query API returns 11 spans with parent-child matching causation; (2) node-graph SQL (T5's exact query) returns 11 nodes/10 edges; (3) `tracked_events` rows carry `workflow_id` for the workflow event and `cache_status` for the connector event.
- DOCUMENTED INTERPRETATION of "workflow + agent spans carry duration > 0": real-time OTel export (T2's design) always emits zero-duration point spans per row — Tempo's 11 spans are correctly zero-duration. `workflow-service` never publishes an `execution_started` bus event (confirmed against a real dev chain — see T4/T6 discovery), so a workflow span-pair NEVER exists in the real system; the agent-execution pair DOES exist and is verified to have `duration_ms > 0` via T1's `tracking.tracked_event_spans` view (the same surface T6's dashboard reads). Documented in the test file header.
- Discovery during this task: a freshly-opened `postgres.js`/Bun connection's absolute-FIRST query can spuriously fail array-typed UNNEST inserts with `cannot cast type boolean to boolean[]` — a connection type-OID-negotiation race, not a code bug (isolated via ~8 progressively-narrowed repro scripts; every synthetic variant with a `SELECT 1` warmup first, or as a non-first query, passed). `main.ts` already runs `SELECT 1` as its first Postgres action for exactly this class of reason; the e2e test now does the same. Saved as a discovery — this could bite ANY future one-shot script/test that skips a warmup query on a brand-new connection.
- Discovery: Tempo's HTTP query API (`/api/traces/{id}`) returns `spanId`/`parentSpanId` as **base64** (OTLP/JSON "bytes" encoding), not the hex `to-otel-span.ts` sends over OTLP/HTTP export — the test decodes base64→hex before comparing. Anyone building a Tempo-consuming UI/script against this API needs the same decode step.
- Verification command: 
  ```bash
  POSTGRES_URL=postgres://... OTEL_COLLECTOR_URL=http://localhost:4318/v1/traces TEMPO_QUERY_URL=http://localhost:3200 \
    bun test test/e2e/trace-visualization.e2e.spec.ts
  ```
  Result (live dev cluster, via port-forwards): 1 pass, 0 fail, 38 expect() calls. Skips cleanly (1 pass, logged reason) when `POSTGRES_URL`/`DATABASE_URL` unset.

**Deliverable:** `services/tracking-ingester-service/test/e2e/trace-visualization.e2e.test.ts` (or repo-convention location — check existing e2e patterns).

**Scenario:** ingest the full telegram fixture chain (11 events) against dev stack →
1. Tempo query API returns the trace: 11 spans, parent-child relations match causation, workflow + agent spans carry duration > 0.
2. Node-graph SQL returns 11 nodes / 10 edges.
3. `tracked_events` rows carry workflow_id/run_id for workflow events and cache_status for connector events.

**Acceptance check:** e2e test green in dev environment; command documented.

---

## T9 — CHECKPOINT (human, visual)

Load the fixture chain in dev, run `port-forward.sh`, follow the printed links:
1. Entry links work: folder "Message tracking" reachable in one click; the 30-second guide flow (get correlation_id → paste → see trace) works as written.
2. "Message traces" with the fixture correlation_id: waterfall renders with sensible hierarchy and durations; node graph readable; detail table complete.
3. Click-throughs: connector → connector-detail dashboard; workflow → Temporal UI execution; event → Tempo trace.
4. User verdict: approve, or list adjustments (which become new tasks appended here).

**Acceptance check:** explicit user approval recorded in this file + engram (`topic: tracking/trace-visualization-checkpoint`).

---

## Migration notes

- All schema changes additive/nullable; no backfill required (historical rows simply lack detail columns).
- Span emission is fire-and-forget: Tempo/collector outage never blocks ingestion.
- Dashboards are provisioned configmaps: rollback = git revert + re-apply.
- Deployment order: T1–T4 (ingester + infra) independent of T5–T7 (dashboards + links); e2e (T8) requires both.
