# ADR — `processes-message-trace`

## ADR-1: Home is Processes, owner is observability — not Channels/Analytics

**Decision.** The trace view lives under **Processes** (`/processes/trace`), not Channels,
Overview, or Analytics.

**Rationale.** A chain spans `channel_events` *and* platform `events` (the workflow run), so it is
cross-cutting — it doesn't belong to the channel domain. Analytics is aggregate KPIs and lives
under Overview; a per-message forensic tool is the opposite mental model. Processes ("things that
ran") is the natural runtime/observability bucket and is currently only a landing, so there is room
to grow it. Entry points stay contextual (Executions row, later a Channels message view); the
Processes view is the owner + direct lookup.

## ADR-2: Business trace native, tech trace via hand-off

**Decision.** Render the causal/business trace in-app; link out to Temporal (run history) and Tempo
(OTel spans) for the technical trace rather than embedding them.

**Rationale.** The two threads have different lifetimes (`TRACEABILITY-audit.md`): the causal chain
is durable in the audit DB; the OTel `traceid` is ephemeral in Tempo. The business trace is what
the platform can answer months later, so it is the spine. Re-implementing Tempo's waterfall or
Temporal's history would be large and redundant when a deep link does the job. Both keys
(`correlation_id`, `traceid`) are shown so neither thread is hidden.

## ADR-3: Assemble the tree client-side from the list endpoint

**Decision.** Slice 1 assembles the causal tree in the browser from
`GET /audit/channel-events?correlation_id=…` + `GET /audit/events?correlation_id=…`, instead of
calling a server `chain/:id` endpoint.

**Rationale.** The gateway audit proxy exposes list + by-id but not `chain/:id` (only audit-service
does, and it isn't routed through the gateway). The tree assembly is trivial and pure
(`causation_id → id`), so doing it client-side avoids a backend change and keeps Slice 1
frontend-only. A future slice can add the gateway passthrough if server-side assembly is preferred.

## ADR-4: pub/sub topology is a static registry; health is best-effort

**Decision.** Subscribers per subject come from a static registry derived from the codebase; live
consumer health (`pending`/`redelivered`/circuit) is a later slice and renders as `—` when absent.

**Rationale.** Who subscribes to a subject is deterministic and stable, so a registry is accurate
and free. Live health requires a JetStream consumer-info endpoint and the channel-service breaker
status (Slice 2). Strict per-message delivery requires capturing delivery metadata at consume time
(Slice 3, write-path). Separating these keeps Slice 1 cheap and the verdict honest ("published,
delivery not confirmed" until health/tier-3 data exists).

## ADR-5: Role-gated, links conditional on config

**Decision.** Gate the route + nav with `diagnostics:read`; render Temporal/Tempo links only when
their base URLs are configured.

**Rationale.** The view exposes raw `correlation_id`/`causation_id`, internal NATS subjects, and
cross-service IDs — elevated/admin-or-developer territory, not for regular tenant users. Temporal
and Tempo are internal and per-environment (often reached via port-forward), so a missing base URL
must hide the link rather than render a dead one.

## Consequences

- Slice 1 ships with no backend or infra change and degrades gracefully without Slices 2/3.
- The verdict is a strong hint, not conclusive, until consumer health (Slice 2) or per-message
  delivery (Slice 3) lands — this is surfaced in the UI copy.
- New read-only config (`temporalUiBaseUrl`, `tempoBaseUrl`, `temporalNamespace`) and a
  `diagnostics:read` permission must be provisioned for the links/gate to activate.
