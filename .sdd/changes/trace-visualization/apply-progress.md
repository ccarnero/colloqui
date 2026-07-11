# Apply progress — trace-visualization

## T0 — Reconcile with existing traceability UI

- Status: DONE
- Files: `.sdd/changes/trace-visualization/design.md` (created)
- Verification: manual review — cites `processes-message-trace`, `channel-trace-entry`, `connector-call-detail`; states non-duplication boundary explicitly.

## T1 — Span pairing + pure span mapping in the ingester

- Status: DONE
- Files:
  - `services/tracking-ingester-service/src/sql/span-pairs.sql` (created)
  - `services/tracking-ingester-service/src/lib/to-otel-span.ts` (created)
  - `services/tracking-ingester-service/test/to-otel-span.spec.ts` (created)
  - `services/tracking-ingester-service/src/scripts/apply-schema.ts` (modified — loads span-pairs.sql after tracked-events.sql)
- Verification command: `cd services/tracking-ingester-service && bun test test/to-otel-span.spec.ts && bun tsc --noEmit`
- Result: 10 pass / 0 fail; tsc clean. Full suite (`bun test`): 144 pass / 0 fail (Postgres integration test self-skips, no DSN in this environment).
- Biome: `bunx biome check` on touched files — clean, no fixes needed.
  - RE-VERIFIED (cleanup pass, see "Post-verify cleanup" below): re-ran `bunx biome check` on `test/to-otel-span.spec.ts` alone — still 0 errors. This claim was accurate; the verify-phase WARNING traced to T8's e2e file, not T1's files.
- Note: TDD followed — test written first, implementation added until green.
- Discovery: `fixtures/bus-events/` has no pre-built 11-event "telegram chain" fixture (only 7 standalone fixture files). Built a minimal 4-row hand-crafted chain inline in the test (ingress → workflow pair → point event → dropped-causation event) that exercises every T1 acceptance case. The same style will be reused/extended for T8's e2e chain.
- span-pairs.sql pairing key: `correlation_id` + best-effort `entity_id` extracted from `envelope` jsonb (workflow run_id/workflow_id, agent execution_id, connector call_id — checked at both `data.payload_inline.*` and `data.*` paths). Rows that never resolve an entity_id (or find no sibling) pass through as zero-duration point spans — documented in the SQL header as a safe degradation, not a hard requirement. NOT unit-tested directly per T1's acceptance check (only `to-otel-span.test.ts` + `tsc` are required for T1); will need a live-Postgres check if the pairing needs validation before T8.

## T2 — OTLP exporter wired into the ingest path

- Status: DONE
- Files:
  - `services/tracking-ingester-service/src/lib/emit-otel-spans.ts` (created)
  - `services/tracking-ingester-service/src/lib/to-span-source-row.ts` (created)
  - `services/tracking-ingester-service/src/lib/load-config.ts` (modified — `otelExportEnabled`/`otelExporterOtlpEndpoint`)
  - `services/tracking-ingester-service/src/lib/tracked-event-buffer.ts` (modified — optional `emitSpans` fire-and-forget hook)
  - `services/tracking-ingester-service/src/main.ts` (modified — wires `emitOtelSpans` into the buffer)
  - `services/tracking-ingester-service/test/emit-otel-spans.spec.ts` (created)
  - `services/tracking-ingester-service/test/to-span-source-row.spec.ts` (created)
  - `services/tracking-ingester-service/test/tracked-event-buffer.spec.ts` (created — buffer had NO prior dedicated test file)
  - `services/tracking-ingester-service/test/load-config.spec.ts` (modified — added OTel config test group)
- Verification command: `cd services/tracking-ingester-service && bun test && bun tsc --noEmit`
- Result: 162 pass / 0 fail; tsc clean. Biome clean on all touched files (one pre-existing `!` assertion at `test/load-config.spec.ts:102` left untouched — predates this change).
  - RE-VERIFIED (cleanup pass, see "Post-verify cleanup" below): re-ran `bunx biome check` on `emit-otel-spans.spec.ts`, `to-span-source-row.spec.ts`, and `tracked-event-buffer.spec.ts` individually — still 0 errors each. This claim was accurate; the verify-phase WARNING traced to T8's e2e file, not T2's files.
- Design decision (important, not in tasks.md verbatim): real-time span export does NOT use the `tracking.tracked_event_spans` pairing view from T1. Each inserted row is exported immediately as its own zero-duration point span (`to-span-source-row.ts`), because the `_completed` sibling of a just-`_started` row may not exist yet at insert time, and cross-batch/cross-restart buffering to wait for pairing would trade emission latency for a duration Tempo's own point-span sequencing already approximates via causation-linked spans in the same trace. The `tracked_event_spans` SQL view remains the query-time artifact `T6`'s "latency p50/p95 (from paired spans view)" panel reads directly from Postgres — the two mechanisms are intentionally decoupled. Saved as a discovery; flag for review at T5/T6 if the dashboard design assumes real-time paired spans in Tempo instead.
- Non-envelope rows (T07's synthesized-id branch) can have `correlation_id === null`; `to-span-source-row.ts` falls back to `event_id` so such rows still form a valid single-span trace in Tempo rather than being silently dropped from export.

## T3 — Collector → Tempo pipeline + Grafana Tempo datasource verified

- Status: DONE (live-verified against dev cluster)
- Files: none modified — `infrastructure/base/observability/otel-collector/configmap.yaml` already has the traces pipeline (`otlp` receiver → `batch` processor → `otlp/tempo` exporter → `tempo:4317`); `infrastructure/base/observability/grafana/configmap.yaml` already has the `Tempo` datasource (`uid: tempo`, `url: http://tempo:3200`).
- Verification: `kubectl kustomize infrastructure/base/observability >/dev/null` clean. Live dev-cluster smoke (sandbox network bypass required — cluster reachable but blocked by default sandbox network policy): confirmed `grafana`, `otel-collector`, `tempo` pods Running in `support-services-dev`; port-forwarded `otel-collector:4318` and `tempo:3200`; POSTed a synthetic OTLP span → HTTP 200 `{"partialSuccess":{}}`; queried `GET /api/traces/{traceId}` on Tempo ~5s later → HTTP 200 with the span present (`service.name: trace-visualization-smoke`); queried Grafana `/api/datasources` (basic auth admin/admin) → confirmed a `type: "tempo"` entry.
- No blockers; no changes needed.

## T4 — Detail columns for click-through: workflow_id, run_id, connector_id, cache_status

- Status: DONE
- Files:
  - `services/tracking-ingester-service/src/sql/tracked-events.sql` (modified — 4 nullable `ADD COLUMN IF NOT EXISTS`, `connector_id` index)
  - `services/tracking-ingester-service/src/sql/span-pairs.sql` (modified — fixed a bug found while writing this: `data.payload_inline` is a BOOLEAN flag, not a nested object; the actual payload lives at `data.payload`. Corrected the jsonb extraction paths before they shipped incorrect.)
  - `services/tracking-ingester-service/src/lib/extract-detail-columns.ts` (created)
  - `services/tracking-ingester-service/src/lib/to-tracked-event-row.ts` (modified — wires `extractDetailColumns`, extends `TrackedEventRow`)
  - `services/tracking-ingester-service/src/lib/build-non-envelope-row.ts` (modified — always-null for the 4 new columns)
  - `services/tracking-ingester-service/src/lib/insert-tracked-events.ts` (modified — 22 UNNEST columns now, up from 18)
  - `services/tracking-ingester-service/test/extract-detail-columns.spec.ts` (created)
  - `services/tracking-ingester-service/test/to-tracked-event-row.spec.ts` (modified — added T4 fixture-per-family describe block)
  - `services/tracking-ingester-service/test/insert-tracked-events.spec.ts` (modified — sampleRow + column-count/order assertions updated 18→22, new T4 index tests)
  - `services/tracking-ingester-service/test/tracked-event-buffer.spec.ts`, `test/to-span-source-row.spec.ts` (modified — sampleRow helpers extended with the 4 new fields)
- Verification command: `cd services/tracking-ingester-service && bun test && bun tsc --noEmit`
- Result: 176 pass / 0 fail; tsc clean.
- Live verification (bonus, not required by T4's acceptance check but done for confidence before T5/T6 depend on these columns): port-forwarded dev Postgres, ran `bun run src/scripts/apply-schema.ts` against it — applied cleanly (13 statements, including the 4 new `ALTER TABLE` + the `connector_id` index + the T1 `span-pairs.sql` view). Ran it a SECOND time — fully idempotent (every statement returned a Postgres NOTICE "already exists, skipping" or matched 0 rows; no errors, no duplicate side effects).
- Field-name provenance verified against real publishers (not guessed): `connector-runtime/src/activities/_shared/event-publisher.ts` emits `{ adapterId, endpointId, cacheResult: "hit"|"miss"|"bypass"|null, cacheKey?, ... }` at `envelope.data.payload` — confirms `connector_id`/`cache_status` extraction.
- MAJOR DISCOVERY / RISK: `workflow-service/src/temporal/activities/execution-completed-publisher.activity.ts` (the ONLY publisher of rule-19 workflow-execution bus events found in the codebase) emits `payload = { executionId, status, workflowName? }` — it does NOT carry Temporal's own `workflowId`/`runId` (those exist inside `workflows.service.ts` as `handle.firstExecutionRunId` / `temporalWorkflowId` but are never put on the bus event). `extract-detail-columns.ts` is written forward-compatible (checks `workflowId`/`runId` first) but for TODAY's real traffic, `workflow_id` = `executionId` (the internal DB execution id, not Temporal's workflowId) and `run_id` is ALWAYS null. **This blocks T6's "Temporal-UI deep link returns HTTP 200" acceptance criterion** unless T6/T9 either (a) accepts linking by `executionId` if Temporal's workflowId happens to equal it (needs verification — NOT assumed here), or (b) the publisher is extended first (out of this change's scope per tasks.md file list) to also emit `workflowId`/`runId`. Flagging explicitly for the T9 human checkpoint and the final report.

## T5 — Dashboard "Message traces" (provisioned JSON)

- Status: DONE (live-verified)
- Files: `infrastructure/base/observability/grafana/dashboards-configmap.yaml` (modified — added `message-traces.json` key; NO new `dashboards/` directory, see path-deviation note in tasks.md)
- Verification commands + results:
  - `jq . message-traces.json` (extracted) → clean parse, 3 panels, 4 template vars.
  - `kubectl kustomize infrastructure/base/observability >/dev/null` → clean.
  - `kubectl apply -f .../dashboards-configmap.yaml` then `GET /api/dashboards/uid/message-traces` (basic auth) → HTTP 200, `provisioned: true`.
  - Both SQL queries (node-graph nodes + edges) executed directly against dev Postgres for a REAL already-ingested 11-event telegram chain (`correlation_id=8c2479be-95c1-460f-bbd7-a9b79312952c`) → 11 nodes, 10 edges, 11 detail-table rows. This independently confirms the telegram fixture chain used across this change is genuinely an 11-event/10-edge chain (matches T8's spec exactly), which is reassuring since T1's test used a hand-built 4-event mini-chain, not this real one.
- Open decision 1 (payload column policy): NOT resolved (per apply instructions, must not guess). Implemented as `NULL::text AS payload` with a `-- TODO(open decision 1, .sdd/changes/trace-visualization/tasks.md)` SQL comment in the detail-table query, exactly as instructed.
- Design note: solved the "$correlation_id needs dashes for Postgres but Tempo's trace_id has dashes stripped" mismatch with a hidden derived Grafana variable (`$trace_id`, a `query`-type variable running `SELECT replace('$correlation_id','-','')` against the Postgres datasource) — a standard, supported Grafana pattern (chained/computed template variables), not a workaround.
- Known follow-up (not a T5 blocker): the Tempo waterfall panel has not been visually confirmed with real span data — the already-ingested rows predate this change's code, so `tracking-ingester-worker` needs a rebuild/redeploy before spans exist in Tempo for any correlation_id. Relevant for T9.

## T6 — Dashboard "Connector detail" + data links

- Status: DONE (JSON/SQL live-verified); Temporal-UI e2e link NOT verified (documented risk, inherited from T4)
- Files:
  - `infrastructure/base/observability/grafana/dashboards-configmap.yaml` (modified — added `connector-detail.json`; added `fieldConfig.overrides` links to `message-traces.json`'s table AND node-graph panels)
  - `services/tracking-ingester-service/src/sql/span-pairs.sql` (modified — added `connector_id`/`cache_status` passthrough columns to `base`/`paired`/`unpaired`/final SELECT)
- Grep-documented string assertions (ran, all matched — see tasks.md for the search commands):
  ```bash
  rg -o '\$\{temporal_ui_base\}/namespaces/default/workflows/\$\{__data\.fields\.[a-z_]+\}/\$\{__data\.fields\.[a-z_]+\}' infrastructure/base/observability/grafana/dashboards-configmap.yaml
  rg -o '/d/connector-detail\?var-connector=\$\{__data\.fields\.[a-z_]+\}' infrastructure/base/observability/grafana/dashboards-configmap.yaml
  rg -o '/d/message-traces\?var-correlation_id=(\$\{__data\.fields\.correlation_id\}|\$correlation_id)' infrastructure/base/observability/grafana/dashboards-configmap.yaml
  ```
  All three matched (2 occurrences each — table + node-graph variants for the first two).
- Verification: `jq .` clean on both extracted JSONs; `kubectl kustomize infrastructure/base/observability >/dev/null` clean; live `kubectl apply` + `GET /api/dashboards/uid/connector-detail` → HTTP 200; re-checked `message-traces` still HTTP 200 after adding the link overrides (no provisioning regression). `span-pairs.sql` re-applied live via `apply-schema.ts` (idempotent, `CREATE OR REPLACE VIEW`) and spot-checked with `SELECT count(*) FROM tracking.tracked_event_spans` → 15,296 rows (no query errors from the new columns).
- **RISK carried from T4, now concretely blocking**: `SELECT * FROM tracking.tracked_events WHERE workflow_id IS NOT NULL` on dev Postgres returns 0 rows. Root cause: `tracking-ingester-worker` in the cluster is running the pre-T4 image (schema was applied via the standalone `apply-schema.ts` script, not a service redeploy), so no row has been ingested through the NEW `to-tracked-event-row.ts` code yet. Even after a redeploy, per the T4 finding, `workflow_id` will only ever equal `executionId` (not Temporal's real workflowId) until `execution-completed-publisher.activity.ts` is extended — OUT of this change's file scope (not listed in any task's file list). **Recommendation for T9**: either (a) accept this as a known limitation and scope a follow-up change to extend the publisher, or (b) the user explicitly descopes the Temporal-UI link's live-200 acceptance criterion for this change.

## T7 — Entry points & direct-access links

- Status: DONE (fully live-verified)
- Files:
  - `DOCS/guides/trace-console.md` (created)
  - `infrastructure/base/observability/grafana/dashboards-message-tracking-configmap.yaml` (created — moved `message-traces.json` + `connector-detail.json` here from `dashboards-configmap.yaml`)
  - `infrastructure/base/observability/grafana/dashboards-configmap.yaml` (modified — the two dashboards moved OUT, trimmed back to its original content)
  - `infrastructure/base/observability/grafana/dashboards-provider.yaml` (modified — added a second `message-tracking` provider, `folder: "Message tracking"`)
  - `infrastructure/base/observability/grafana/deployment.yaml` (modified — new volume + volumeMount for the new ConfigMap)
  - `infrastructure/base/observability/grafana/kustomization.yaml` (modified — added the new file to `resources`)
  - `port-forward.sh` (modified — `grafana`/`tempo` added to `SUPPORT_SERVICES`; `print_trace_console_urls` function)
- Verification commands + results (all live, dev cluster):
  ```bash
  kubectl apply -f infrastructure/base/observability/grafana/dashboards-configmap.yaml -n support-services-dev
  kubectl apply -f infrastructure/base/observability/grafana/dashboards-message-tracking-configmap.yaml -n support-services-dev
  kubectl apply -f infrastructure/base/observability/grafana/dashboards-provider.yaml -n support-services-dev
  kubectl apply -f infrastructure/base/observability/grafana/deployment.yaml -n support-services-dev
  kubectl rollout status -n support-services-dev deployment/grafana   # succeeded
  curl -u admin:admin http://localhost:3000/api/folders                # -> [{"title":"Message tracking", ...}]
  curl -u admin:admin "http://localhost:3000/api/search?folderUIDs=<uid>"  # -> both dashboards, folderTitle "Message tracking"
  curl -o /dev/null -w '%{http_code}' "http://localhost:3000/dashboards?tag=message-tracking"                                  # 200
  curl -o /dev/null -w '%{http_code}' "http://localhost:3000/d/message-traces?var-correlation_id=8c2479be-95c1-460f-bbd7-a9b79312952c"  # 200
  curl -o /dev/null -w '%{http_code}' "http://localhost:3000/d/connector-detail?var-connector=adapter-x"                       # 200
  curl -o /dev/null -w '%{http_code}' "http://localhost:3000/explore?left=%7B%22datasource%22:%22tempo%22%7D"                  # 200
  ```
- Discovery/decision: Grafana folder UIDs are server-generated per-provision, not derivable from the folder title — a hardcoded `/dashboards/f/message-tracking` URL would be WRONG (confirmed live: actual uid was `efrpy4lo92l1cb`). Used the tag-filtered dashboard list (`/dashboards?tag=message-tracking`) instead, which is deterministic since both dashboards' JSON already carries the `"message-tracking"` tag. Documented this choice in both the guide and `port-forward.sh`'s comment so nobody "fixes" it back to a folder-uid URL.
- `bash -n port-forward.sh` clean; no existing tests cover this script (shell, not part of the Bun test suite) — verified by direct execution semantics review + the live loop above.

## T8 — End-to-end verification (machine)

- Status: DONE (live-verified, 38/38 assertions pass against the full dev stack)
- Files: `services/tracking-ingester-service/test/e2e/trace-visualization.e2e.spec.ts` (created)
- Verification command + result:
  ```bash
  POSTGRES_URL=postgres://... OTEL_COLLECTOR_URL=http://localhost:4318/v1/traces TEMPO_QUERY_URL=http://localhost:3200 \
    bun test test/e2e/trace-visualization.e2e.spec.ts
  # -> 1 pass, 0 fail, 38 expect() calls
  ```
  Full suite (`bun test`, no env): 177 pass / 0 fail (both integration + e2e self-skip cleanly).
- MAJOR DISCOVERY (generalizable beyond this test): a freshly-opened `postgres.js` connection's very FIRST query can spuriously fail with `cannot cast type boolean to boolean[]` on an array-typed multi-row UNNEST insert — isolated through ~8 progressively narrowed repro scripts (single row via fixture: passed; 2/11 synthetic rows: passed; mixed null/non-null columns: passed; ONLY the real 11-row e2e chain as the very FIRST query on a brand-new connection: failed; the SAME query as a SECOND-OR-LATER call on that connection: passed). Root cause: a connection-warmup/type-OID-negotiation race between Bun's postgres.js and the server, not a defect in `insertTrackedEvents` or the mapper. Fix: run `SELECT 1` immediately after opening the connection, before any real query — `src/main.ts` already does exactly this as its first Postgres action (line ~103), so the e2e test now mirrors it. **Actionable for future work**: any NEW one-shot script or test that opens its own `postgres()` client should do the same warmup, or it may see this exact spurious failure.
- Discovery: Tempo's `/api/traces/{id}` HTTP query API returns `spanId`/`parentSpanId` as **base64**, not hex — even though `to-otel-span.ts` and the OTLP/HTTP exporter send hex. Confirmed against the live T3 smoke test earlier too (`"spanId":"1Aw97TPdRvA="`). Any future Tempo-consuming code (a Grafana panel is fine — Grafana handles this internally — but a custom script/UI reading Tempo's REST API directly) needs a base64→hex decode step to compare against IDs derived via `toSpanId`/`toTraceId`.
- Confirms (independently, via a live-ingested real dev chain inspected while debugging): the platform's causal chains are TREES with fan-out, not flat linear chains — `received` events commonly cause 2-3 children directly (e.g. `execution_requested`, `send`, `execution_completed`). The T1 test fixture (a linear 4-event mini-chain) and this T8 fixture (an 11-event tree) both remain valid/correct — just noting the tree shape is now empirically confirmed, not assumed.

## Post-verify cleanup — Biome `noNonNullAssertion` in test/e2e/trace-visualization.e2e.spec.ts

- Status: DONE
- Context: verify phase flagged one WARNING — `bunx biome check` reported 18 `lint/style/noNonNullAssertion` errors, all in `test/e2e/trace-visualization.e2e.spec.ts` (T8's file). Re-checking the other 5 test files created by this change (T1's `to-otel-span.spec.ts`, T2's `emit-otel-spans.spec.ts`/`to-span-source-row.spec.ts`/`tracked-event-buffer.spec.ts`, and `extract-detail-columns.spec.ts`) individually confirmed they were already clean — the earlier "Biome clean" claims for T1/T2 hold; only T8's e2e file was affected and its entry never made a Biome claim.
- Files: `services/tracking-ingester-service/test/e2e/trace-visualization.e2e.spec.ts` (modified — no other files touched)
- Fix approach: added a local `requireDefined<T>(value, message)` guard that throws loudly on `undefined` (used for every fixed-index array/destructure access: `ids[index]`, `ids[opts.causationOf]`, subject-segment destructure, `ids[0]`, `ids[parentIndex]`, `ids[i]`, `fixtures[i]`). For values already covered by a preceding `expect(x).toBeDefined()` (`agentPairSpan`, `workflowSpan`, `rootTempoSpan`, `span`), switched to optional chaining (`?.`) per Biome's own suggested fix — the preceding `toBeDefined()` assertion is what actually fails the test loudly if the value is absent, so `?.` doesn't weaken coverage there.
- Verification command: `bunx biome check <6 files>` && `cd services/tracking-ingester-service && bun test && bun tsc --noEmit`
- Result: Biome — 18 `noNonNullAssertion` errors before, all in the e2e file (`bunx biome check` confirmed "Found 18 errors"; the other 5 files were already at 0) → 0 errors after, across all 6 files. Tests: 177 pass / 0 fail (e2e self-skips, no DSN in this environment). `bun tsc --noEmit`: clean.
- Not committed — left as working tree changes per instruction.

## Defect fix — OTLP export 404 (base endpoint missing `/v1/traces` path)

- Status: DONE
- Root cause: `emit-otel-spans.ts` posted OTLP JSON directly to the raw `OTEL_EXPORTER_OTLP_ENDPOINT` value. The deployed env sets this to a BASE URL (`http://otel-collector.support-services-dev.svc.cluster.local:4318`), per OTel spec convention — the exporter, not the operator, is responsible for appending the per-signal path. Since the code posted to the base URL verbatim, the collector's OTLP/HTTP receiver (which only listens on `/v1/traces`) returned `404 page not found`, confirmed live via worker log line `emitOtelSpans: export FAILED — otel-collector responded 404`.
- Fix: added `toTracesUrl(endpoint)` in `emit-otel-spans.ts` — appends `/v1/traces` unless the endpoint already ends with it (tolerates one trailing slash on the base, no double slash, no duplicate append for full-URL configs). The derived URL is used for the POST and is now the one logged (`emitOtelSpans: exporting N span(s) to <url>`), so future debugging sees the real destination.
- Files:
  - `services/tracking-ingester-service/src/lib/emit-otel-spans.ts` (modified — added `toTracesUrl` + wired into POST/log)
  - `services/tracking-ingester-service/test/emit-otel-spans.spec.ts` (modified — 3 new regression tests: base URL no trailing slash, base URL with trailing slash, endpoint already ending in `/v1/traces`)
- TDD: tests written first, confirmed failing against pre-fix code (`http://collector:4318` expected `.../v1/traces`, actual `http://collector:4318`; trailing-slash case similarly failed), then the fix was applied and tests went green.
- Verification command: `cd services/tracking-ingester-service && bun test && bun tsc --noEmit`
- Result: 180 pass / 0 fail (up from 177 — 3 new tests); tsc clean. `bunx biome check` on both touched files: clean, no non-null assertions.
- Live verification: rebuilt/redeployed `tracking-ingester-worker` via `./rebuild-redeploy.sh tracking-ingester-worker`. Post-deploy worker logs (`kubectl logs deployment/tracking-ingester-worker -n platform-services-dev`) confirm the exact `404` symptom is GONE: every export line now shows `emitOtelSpans: exporting N span(s) to http://otel-collector.support-services-dev.svc.cluster.local:4318/v1/traces` and the collector responds with a real OTLP-level status (400, see below) instead of `404 page not found` — proving the request now reaches the receiver's actual endpoint.
- NEW DISCOVERY (separate, pre-existing defect — NOT fixed here, out of this task's scope): the collector now rejects some spans with `400 readSpan.traceId: parse trace_id:invalid length for ID` because `to-otel-span.ts` (T1) is emitting a non-hex `trace_id` for at least one event shape (observed value: `"gateway_audit:58076"` — a correlation-id-like string, not a 32-hex-char OTLP trace ID). This reproduced repeatedly (3+ occurrences within 30s of live traffic) and is unrelated to the URL bug fixed in this task. Flagging for a follow-up fix in `to-otel-span.ts`'s trace_id derivation for the `gateway_audit`/similar event source — not addressed here since it is outside this task's stated scope (URL path only).

## Defect fix — non-UUID correlation_ids break OTLP export + Tempo panel (two-part fix)

- Status: DONE
- Root cause: `correlation_id` is NOT guaranteed to be a UUID in real data — non-envelope families (TAXONOMY.md §4 rules 1/12/13/14/15/18) carry synthesized ids like `memory:057092b6-9699-4dc6-96db-13eeec1d8167` or `gateway_audit:58076`. `toTraceId`/`toSpanId` (`to-otel-span.ts`, T1) strip dashes and lowercase WITHOUT validating UUID shape, so these ids derive non-hex `traceId`/`spanId` values. This is exactly the follow-up flagged in the previous defect-fix entry above ("NEW DISCOVERY... gateway_audit:58076..."). Two consumers were affected: (1) the OTLP exporter — the otel-collector rejects the WHOLE batch item with `400 readSpan.traceId: parse trace_id: invalid length`, dropping every span in that batch, not just the bad one; (2) the Grafana dashboard's `$trace_id` templating variable (`replace('$correlation_id', '-', '')`) fed a non-hex string straight into the Tempo waterfall panel's TraceQL query, producing a query error instead of a clean "no data" state. Also verified `event_id`/`causation_id` are NOT guaranteed UUID either — T07's non-envelope branch synthesizes `event_id` as `"<stream>:<seq>"` (e.g. `GATEWAY_AUDIT:41771`, see `to-tracked-event-row.ts` doc comment), so `span_id`/`parent_span_id` needed the same guard, not just `trace_id`.
- Fix (Part 1 — exporter guard, `services/tracking-ingester-service`):
  - `src/lib/is-valid-trace-id.ts` (created) — pure predicate, 32 lowercase hex chars, rejects all-zeros.
  - `src/lib/is-valid-span-id.ts` (created) — pure predicate, 16 lowercase hex chars, rejects all-zeros.
  - `src/lib/filter-exportable-spans.ts` (created) — pure function; partitions a span batch into `valid`/skipped using the two predicates against `trace_id`/`span_id`/`parent_span_id`; logs one line per skipped span (includes the offending derived id) plus a batch summary line `"skipped N non-UUID-correlation span(s)"` when N > 0 — same log-and-count style as the existing `skipped` counted-not-persisted pattern in `consume-events.ts`.
  - `src/lib/emit-otel-spans.ts` (modified) — calls `filterExportableSpans` before building the OTLP envelope/POSTing; only valid spans are sent; an all-invalid batch is a logged no-op (`sent: 0`, no `fetch` call) instead of a collector 400 killing the whole batch.
  - `test/is-valid-trace-id.spec.ts`, `test/is-valid-span-id.spec.ts`, `test/filter-exportable-spans.spec.ts` (created); `test/emit-otel-spans.spec.ts` (modified — 2 new regression tests: mixed batch skips only the bad spans and still exports the good one, all-invalid batch is a no-op).
- TDD: tests written first for all 3 new files (confirmed `Cannot find module` failures pre-implementation), then implementations added until green.
- Verification command: `cd services/tracking-ingester-service && bun test && bun tsc --noEmit`
- Result: 202 pass / 0 fail (up from 180); tsc clean. `bunx biome check --write` on all 8 touched/created files: clean, no fixes applied.
- Fix (Part 2 — dashboard tolerance, `infrastructure/base/observability/grafana/dashboards-message-tracking-configmap.yaml`, `message-traces.json` only):
  - `$trace_id` templating variable query changed from `SELECT replace('$correlation_id', '-', '') AS trace_id` to `SELECT CASE WHEN '$correlation_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN replace(lower('$correlation_id'), '-', '') ELSE '' END AS trace_id` — returns the hex trace id only for a dashed-UUID-shaped `$correlation_id`, empty string otherwise, so the Tempo waterfall panel query returns "no data" instead of erroring. Kept the existing single-quote string-interpolation idiom (inherited debt, not extended further, per instruction).
  - "Trace waterfall (Tempo)" panel description: appended one sentence — "Non-UUID correlation ids (e.g. memory:..., gateway_audit:...) have no Tempo trace and this panel shows no data."
  - "Recent traces" panel: NOT modified — it already only filters `correlation_id IS NOT NULL` (not UUID-shaped), so non-UUID rows (memory:..., gateway_audit:...) remain visible there for the node graph/detail table, as required.
- Validation: `yq eval '.data."message-traces.json"' ... | jq empty` → valid JSON; `jq -r '.templating.list[] | select(.name=="trace_id") | .query'` → confirmed new SQL string present; `kubectl kustomize infrastructure/base/observability >/dev/null` → clean.
- Live verification:
  - Rebuilt/redeployed via `./rebuild-redeploy.sh tracking-ingester-worker` (namespace `platform-services-dev`) — rollout succeeded, deployment Ready.
  - Post-deploy logs (`kubectl logs -n platform-services-dev deployment/tracking-ingester-worker`) confirm the fix live: `filterExportableSpans: skipping span with non-UUID-derived id — trace_id=gateway_audit:58168 span_id=gateway_audit:58` followed by `filterExportableSpans: skipped 1 non-UUID-correlation span(s)` and `emitOtelSpans: all 1 span(s) filtered out (non-UUID-derived ids) — nothing to export`. No `otel-collector responded 400` lines observed after the guard kicked in (previously reproduced 3+ times within 30s per the earlier discovery note).
  - Applied the ConfigMap with the CORRECT namespace: `kubectl apply -n support-services-dev -f infrastructure/base/observability/grafana/dashboards-message-tracking-configmap.yaml` → `configmap/grafana-dashboards-message-tracking configured`. Then `kubectl rollout restart deployment/grafana -n support-services-dev` → rollout succeeded.
  - Grafana's port-forward on localhost:3000 had dropped (pod restart); restarted it (`kubectl port-forward -n support-services-dev svc/grafana 3000:3000`). Smoke: `GET http://localhost:3000/api/dashboards/uid/message-traces` → HTTP 200; response body's `templating.list[name=trace_id].query` confirmed to contain the new CASE/regex SQL.
- Not committed — left as working tree changes per instruction. Producer root-cause fix (making correlation_id always a UUID upstream) is explicitly OUT of scope here per user decision — this is a guard/tolerance fix only, both parts.
- Could not verify: end-to-end confirmation that a REAL memory:... correlation_id (as opposed to the gateway_audit: one observed live) also triggers the guard — only `gateway_audit:...` families were observed flowing through live traffic during this session's verification window. The unit/regression tests do cover the `memory:...` shape explicitly, so behavior is proven at the unit level even though it wasn't independently reproduced against live cluster traffic.

## Open decisions carried forward

- Open decision 1 (T5 payload column policy): not yet reached.
