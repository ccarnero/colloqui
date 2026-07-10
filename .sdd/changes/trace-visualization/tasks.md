# Tasks: Trace Visualization — Tempo waterfall + causal node graph in Grafana

Tasks are ordered by dependency. Each task is independently verifiable before the next begins.

**Context**: `services/tracking-ingester-service` already persists classified events to Postgres (`tracked-events.sql`). Infra already ships `infrastructure/base/observability/{tempo,otel-collector,grafana}`. This change adds: OTel span emission from tracked events, two provisioned Grafana dashboards (trace waterfall via Tempo + causal node graph via SQL), and click-through data links (connector detail, Temporal UI, Tempo trace).

**Open decisions (USER — blocking only where noted):**
1. Payload policy for the trace detail table: show `payload` jsonb as-is, truncated, or masked? Claim-check events: show reference only, or resolve the payload? → blocks the detail-table panel of T5 only. Note: connector-call events already ship redacted headers + truncated bodies (see `.sdd/changes/connector-call-detail`), so this decision covers the remaining event families.

---

## T0 — Reconcile with existing traceability UI (docs only, no code)

**Files to read:**
- `.sdd/changes/processes-message-trace/design.md`
- `.sdd/changes/channel-trace-entry/design.md`
- `.sdd/changes/connector-call-detail/design.md` (trace link to `/processes/trace/:correlationId`)

**Deliverable:** `design.md` in this change folder with a short "complementarity note": admin-console trace page = per-message product/support view; Grafana/Tempo = operational view (latency, bottlenecks, cross-trace analytics). Document which view links to which (admin-console trace page MAY link out to the Grafana trace dashboard by correlation_id; Grafana does NOT duplicate the admin-console UI).

**Acceptance check:** design.md exists, cites the three prior changes, and states the non-duplication boundary explicitly.

---

## T1 — Span pairing + pure span mapping in the ingester

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

**Files to create/modify:**
- `infrastructure/base/observability/grafana/dashboards/connector-detail.json` — variable `$connector`; panels: invocations/hour, latency p50/p95 (from paired spans view), error rate, cache hit-rate (from `cache_status`), last 50 calls table with JSON cell inspection.
- `message-traces.json` (T5) — add data links:
  - workflow rows/nodes → Temporal UI: `${temporal_ui_base}/namespaces/default/workflows/${__data.fields.workflow_id}/${__data.fields.run_id}` (base URL as dashboard variable, not hardcoded)
  - connector rows/nodes → connector-detail dashboard with `$connector` interpolated
  - any event row → Tempo trace panel by correlation_id

**Acceptance check:** both JSONs parse; link templates contain the exact variable interpolations above (string assertion test in repo or documented grep); e2e: with the fixture chain ingested, the interpolated Temporal URL for the workflow row returns HTTP 200 against temporal-ui in dev.

---

## T7 — Entry points & direct-access links

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
