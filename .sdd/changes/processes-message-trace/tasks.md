# Tasks — `processes-message-trace`

Legend: `[ ]` pending · `[x]` done · `[~]` deferred to a later slice/change.

## Slice 1 — Message trace view (this change)

### T1 — Domain model + pure logic
- [ ] `features/processes/trace/domain/message-trace.model.ts` — `ITraceNode`, `ITraceSubscriber`,
  `IConsumerHealth`, `ITraceResult`, `IRecentTrace`, `TraceVerdict`.
- [ ] `features/processes/trace/domain/transport-topology.ts` — `subscribersFor(subject)` static
  registry (`*.received.v1` → workflow-triggers + channel-events-audit; `*.send.v1` →
  channel-egress + channel-events-audit). Unknown subject → `[]`.
- [ ] `features/processes/trace/domain/assemble-trace.ts` — `assembleTrace(channelRows, platformRows)`:
  order by `created_at`, link `causation_id → id`, attach `subscribersFor(subject)`, derive
  `verdict`. Pure, no Angular imports.

### T2 — Tests (Vitest) — REQUIRED
- [ ] `domain/__tests__/assemble-trace.spec.ts`:
  - received-only rows → verdict `received`, single root.
  - received → workflow → send → verdict `published-unconfirmed`, `send` descendant of `received`.
  - send marked delivered (health ok, Slice 2 shape) → verdict `replied`.
  - empty input → empty result, no throw.
- [ ] `domain/__tests__/transport-topology.spec.ts`: known subjects map to the right durables;
  unknown subject → `[]`.

### T3 — Data service
- [ ] `core/services/message-trace.service.ts`:
  - `recentTraces(windowMin = 5)` → `GET /audit/channel-events?from=…&limit=200`, group by
    `correlation_id`, newest per group.
  - `byCorrelation(cid)` → channel + platform rows in parallel.
  - `executionFor(cid)` (best effort) → resolve `temporal_workflow_id`.
  - Use the existing tenant-scoped HTTP client; no new auth.

### T4 — Component + route + gate
- [ ] `features/processes/trace/message-trace.component.ts` (standalone, OnPush, signals): lookup
  input + Trace, recent list, business/tech keys, causal chain with pub/sub fan-out, Temporal/Tempo
  links (conditional on configured base URLs + resolved IDs).
- [ ] Routes `processes/trace` and `processes/trace/:correlationId` (lazy), guarded with
  `diagnostics:read`.
- [ ] No Processes sub-nav entry is currently wired; if one is added, hide it unless `hasPermission('diagnostics:read')`.

### T5 — Executions entry point
- [ ] Add "View chain" to the Workflow → Executions row → `routerLink` to
  `/processes/trace/{correlationId}`.

### T6 — Config surfacing
- [ ] Expose `temporalUiBaseUrl`, `tempoBaseUrl`, `temporalNamespace` to the admin-console
  (read-only runtime config) and the `diagnostics:read` permission. Links hide when base URL empty.

### T7 — Docs — REQUIRED
- [ ] Extend `DOCS/guides/ui-flows.md` "Workflow Builder / Processes" section with the Message
  trace view (entry points, gating, the two trace keys, link hand-offs).
- [ ] Note in `DOCS/archive/audits/TRACEABILITY-audit.md` that the business trace now has a UI surface.

## Slice 1.5 — Correlation-scoped gateway read (small backend follow-up)
- [~] The gateway audit proxy rejects `?correlation_id=` (not whitelisted) and doesn't expose
  `chain/:id`; Slice 1 works around it with a client-side time-window filter (recent traffic only).
- [~] To support arbitrary-age lookup: either add `correlation_id` to `QueryChannelEventsProxyDto`
  / `QueryAuditEventsProxyDto` (+ mappers + channel-events list filter in audit-service), OR add a
  `chain/:correlationId` passthrough to `ChannelAuditProxyController` / the events proxy controller
  (audit-service already implements those endpoints). Then drop the window filter in `getTrace`.

## Slice 1.7 — Workflow node + Temporal link (backend; chased 2026-06-25)

Finding: from a `correlation_id` there is no path to the workflow run today.
- The execution-completed event is domain `workflow`; the audit `events` store only persists
  `platform` domain (`audit.service.ts` `CANONICAL_AUDIT_PATTERN = "evt.*.*.platform.>"`), so it's
  never stored → no workflow node in the chain.
- That event's payload is `{ executionId, status, workflowName }` — no `temporal_workflow_id`.
- `workflow_executions` has `temporal_workflow_id` but no `correlation_id` column / by-correlation
  endpoint; `temporalWorkflowId` is a random `nanoid()`/hash → not reconstructable client-side.

Option A — IMPLEMENTED 2026-06-25 (executions are the system of record):
- [x] `correlation_id` column + idempotent `ALTER ... ADD COLUMN IF NOT EXISTS` + index in
  `workflow-schema.ts`; persisted on create in PG + Mongo repos; `findExecutionsByCorrelation`.
- [x] `workflows.service` passes `options.causal.correlation_id`; `findExecutionsByCorrelation`.
- [x] `GET /workflows/executions?correlation_id=X` (workflow-service controller, above `:id`) +
  gateway proxy route.
- [x] Frontend `getTrace` calls `/api/workflows/executions?correlation_id=` → synthesizes a
  "workflow run" node + resolves `temporal_workflow_id` for the Temporal link.
- Rebuilds: workflow-service + api-gateway + admin-console. Old executions have NULL correlation_id
  (no backfill); the workflow node/link appears for runs created after the rebuild.

Option B (audit-centric):
- [~] Add `temporalWorkflowId` (+ `temporalRunId`) to the execution-completed event payload.
- [~] Broaden the audit events consumer to also persist workflow-domain events (changes the
  `events` store scope from platform-only). Frontend then finds the node + link from the audit thread.

## Slice 2 — Live consumer health (separate change)
- [~] Read endpoint: JetStream consumer info per durable (`pending`, `ack_pending`, redelivery)
  filtered by subject — owner: audit-service or a small ops endpoint.
- [~] channel-service circuit-breaker status read endpoint (`telegram:telegram` etc.).
- [~] Wire `IConsumerHealth` into `subscribersFor` results; verdict becomes conclusive when health
  shows max-deliver/circuit-open.

## Slice 3 — Per-message delivery (separate change)
- [~] Stamp delivery-attempt metadata (attempts, last error) into audit at consume time.
- [~] Surface strict per-message delivery in the send node; verdict fully conclusive.

## Verification
- [ ] `tsc --noEmit -p tsconfig.app.json` and `-p tsconfig.spec.json` clean.
- [ ] `ng test` (or vitest) green for the new specs. (Full `ng build` template check + `ng test`
  run on a workstation — not available in the authoring sandbox.)
- [ ] Manual: deep-link `/processes/trace/{cid}` for a real Telegram correlation → chain renders,
  recent list populates, links appear when base URLs configured.

## Rollback
Delete the `features/processes/trace/` folder, the route + nav entries, the service, the
Executions-row link, and the config keys. Frontend-only, additive — nothing else to revert.
