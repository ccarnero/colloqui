# Design — `processes-message-trace`

## Problem Statement

When a message misbehaves (e.g. a Telegram reply never arrives) there is no in-product way to
follow it across services. Today an operator must hand-craft `curl` calls against the audit
endpoints, then jump to `kubectl logs` for the egress consumer and to the Temporal UI for the
workflow run. The platform already persists everything needed to reconstruct the journey — the
causal chain (`correlation_id`/`causation_id`/`depth`) in the audit DB and the OTel `traceid` —
but nothing surfaces it.

This change adds a role-gated **Message trace** debug view under **Processes** that renders a
single message's causal chain, the pub/sub fan-out between services, and deep-links into the
technical traces (Temporal for the run, Tempo for the OTel spans).

It maps onto the two traceability threads documented in `DOCS/archive/audits/TRACEABILITY-audit.md`:

- **Business trace** — the causal chain + pub/sub topology + audit rows. Durable, queryable
  forever. This view renders it natively.
- **Tech trace** — the OTel `traceid`. Live, ephemeral (Tempo retention). This view **links out**
  rather than redrawing the span waterfall.

## Scope & Slices

The feature is delivered in slices so each is independently shippable and verifiable. Slice 1 is
the bulk of the value and uses only endpoints that already exist.

| Slice | What | New backend? |
|---|---|---|
| **1 — View (this change's primary slice)** | Route, component-level `diagnostics:read` gate, recent-traces list, causal chain assembled client-side, static pub/sub topology, Temporal/Tempo links (conditional), Executions-row entry link | No — reuses existing audit + executions endpoints |
| 2 — Live consumer health | `pending`/`ack`/`redelivered` per durable from JetStream + channel-service circuit-breaker status | Yes (2 small read endpoints) |
| 3 — Per-message delivery (tier 3) | Stamp delivery attempt metadata at consume time for strict per-message verdicts | Yes (write-path) |

Slices 2 and 3 are specified here and tracked in `tasks.md` but are **not** implemented in this
change. The view degrades gracefully when their data is absent (health shows `—`, verdict falls
back to "published, delivery not confirmed — open Temporal").

## Solution Overview (Slice 1)

### 1. Domain logic (pure, unit-tested) — `features/processes/trace/domain/`

`message-trace.model.ts` — view types: `ITraceNode`, `ITraceSubscriber`, `ITraceResult`,
`IRecentTrace`, `TraceVerdict`.

`assemble-trace.ts` — `assembleTrace(channelEvents, platformEvents): ITraceResult`. Pure function.
Orders rows by `created_at`, links `causation_id → id` into a chain, attaches each event's
known subscribers (from the topology registry below), and derives the round-trip `verdict`
(`received` only / `replied` / `published-unconfirmed` / `failed`). Mirrors the backend
`buildChainTree` shape but consumes the gateway list rows.

`transport-topology.ts` — `subscribersFor(subject): ITraceSubscriber[]`. A static registry of the
known durable consumers per subject family (deterministic from the codebase): `*.received.v1` →
`workflow-service/workflow-triggers` (producer of next node) + `audit-service/channel-events-audit`
(sink); `*.send.v1` → `channel-service/channel-egress` + `audit-service/channel-events-audit`.
Returns `{ service, durable, role: 'producer' | 'sink', health?: IConsumerHealth }`.

### 2. Data service — `core/services/message-trace.service.ts`

Reuses existing gateway endpoints (no backend change):

```
recentTraces(windowMin)   GET /audit/channel-events?from={now-windowMin}&limit=200
                          → group by correlation_id, newest per group (client-side)
getTrace(cid, windowMin)  GET /audit/channel-events?from={now-windowMin}&limit=500 → filter cid
                          GET /audit/events?from={now-windowMin}&limit=500          → filter cid
                          temporal_workflow_id resolved best-effort from platform rows' metadata
```

> **Gateway constraint (verified).** The gateway audit proxy whitelists only `from`/`to`/`limit`/
> `offset` (+ `channel`/`kind`/`accountId`) — it does **not** allow `correlation_id`
> (`QueryChannelEventsProxyDto` / `QueryAuditEventsProxyDto`), so `?correlation_id=` returns 400.
> It also exposes list + by-id but **not** `chain/:id`. Slice 1 therefore fetches a **time window**
> (`from`) and filters by `correlation_id` **client-side**, assembling the tree in the browser. This
> covers recent traffic (the common debug case) with zero backend change. The platform-events fetch
> is best-effort (errors → empty, Temporal link hidden).
>
> **Follow-up (Slice 1.5).** For arbitrary-age lookup, add a correlation-scoped read through the
> gateway — either whitelist `correlation_id` on the proxy DTOs (+ filter in the channel-events
> list) or expose the existing audit-service `chain/:correlationId` via a
> `ChannelAuditProxyController` passthrough. Then `getTrace` calls it directly and the time-window
> filter is dropped.

### 3. Component, route, gate — `features/processes/trace/`

`message-trace.component.ts` (standalone, OnPush, signals) renders: correlation-id input + Trace
button, recent-traces list (last 5 min, auto), the two trace keys (business `correlation_id`,
tech `traceid` + Open in Tempo), the causal chain with per-node pub/sub fan-out, and the
per-execution Open in Temporal link. Links render only when their base URL is configured.

Routing: `processes/trace` and `processes/trace/:correlationId`, lazy, guarded by the existing
permission mechanism with `diagnostics:read`. No nav entry is currently wired; if added, it should be hidden unless the user holds the
permission.

### 4. Entry point — Executions row

Add a "View chain" action to the Workflow → Executions list row that routes to
`processes/trace/{correlationId}` for that execution.

### 5. Config surfaced to admin-console (read-only)

`temporalUiBaseUrl`, `tempoBaseUrl`, `temporalNamespace` (+ the `diagnostics:read` permission key).
When `temporalUiBaseUrl` / `tempoBaseUrl` are empty the respective links are hidden.

## Data Flow (Slice 1)

```
Operator → direct `/processes/trace` URL  (component gated by diagnostics:read)
  │
  ├─ recent list:  GET /audit/channel-events?from=now-5m&limit=200
  │                  → group by correlation_id → newest per group → IRecentTrace[]
  │
  └─ pick / paste correlation_id
       │
       ├─ GET /audit/channel-events?correlation_id={cid}   → channel rows (received/send)
       ├─ GET /audit/events?correlation_id={cid}           → platform rows (workflow, …)
       │
       ├─ assembleTrace(channel, platform)                 → ITraceResult (tree + verdict)
       │     each node ← subscribersFor(subject)           → pub/sub fan-out
       │
       ├─ executionFor(cid) (best effort)                  → temporal_workflow_id
       │     → Open in Temporal  {temporalUiBaseUrl}/namespaces/{ns}/workflows/{wfId}
       │
       └─ traceid (from a node's metadata)                 → Open in Tempo {tempoBaseUrl}?traceid=…
```

## Acceptance Criteria

- `/processes/trace` is under the shell auth guard; without `diagnostics:read` the component shows access restricted and
  the nav item is hidden.
- Pasting (or deep-linking) a `correlation_id` renders the causal chain in `created_at` order with
  `received` as root and `send` as a descendant under the same `correlation_id`.
- Each node lists its NATS subject and the known subscriber durables (producer + audit sink).
- A `correlation_id` with no rows shows an empty state, not an error.
- The recent list shows distinct `correlation_id`s from the last 5 minutes, newest first.
- Temporal / Tempo links render only when their base URLs are configured; otherwise hidden (no dead
  links).
- `assembleTrace` and `subscribersFor` are covered by unit tests (Vitest), including the
  received-only, replied, and published-unconfirmed verdicts.

## Error Scenarios

- Audit endpoint 401 (expired token) → standard auth refresh/redirect (existing interceptor).
- Unknown `correlation_id` → empty state ("no events for this correlation in the selected window").
- Execution lookup fails or returns no `temporal_workflow_id` → Temporal link hidden, rest renders.
- `traceid` is a fallback UUID (D9) or Tempo retention expired → Tempo link still offered but
  labeled best-effort; failure to resolve is Tempo's, not ours.
- Topology registry has no entry for a subject → node renders with "subscribers: unknown" rather
  than failing.

## Non-Goals (Scope Fence)

- NO backend changes in Slice 1 — no new endpoints, no gateway proxy route, no DB migration.
- NO rebuilding of the Tempo span waterfall or Temporal history in-app — link out only.
- NO write-path changes (tier-3 per-message delivery is a later slice).
- NO changes to the workflow builder, channel adapters, or messaging runtime.
- NO cross-tenant access — the view is tenant-scoped like every other audit call.

## Rollback

Slice 1 is additive and frontend-only: remove the route, nav entry, component, service, domain
folder, and the Executions-row link. No data or backend state to revert.

## Effort

8 (fibonacci) for Slice 1. Slice 2 ≈ 5, Slice 3 ≈ 8 (separate changes).
