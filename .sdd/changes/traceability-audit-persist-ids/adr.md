# ADR — Persist traceability IDs across gateway and channel audit surfaces

- Status: Accepted
- Date: 2026-06-20
- Change: `traceability-audit-persist-ids`

## Context

The prior change `traceability-causal-chain-ingress` made `correlation_id`, `causation_id`,
and `depth` first-class indexed columns on the core `events` audit stream (Mongo + Postgres),
enabling causal-chain reconstruction within that stream.

The same IDs travel end-to-end on the wire (NATS envelopes + headers), but two other audit
surfaces in `audit-service` drop them at persistence time:

- `channel_events` (audit variant): the `ChannelEnvelope` carries `correlation_id`,
  `causation_id`, and `transport.depth`, but the insert path omits all three. Pure data loss —
  the data is already in hand.
- `gateway_audit_events`: persists only `trace_id`. Worse, the producing api-gateway audit
  interceptor builds its event from the raw HTTP request and never has a `correlation_id` in
  scope, even though the webhook ingress publisher mints one at the same request. This is a
  propagation gap, not just a persistence gap.

Consequence today: a request entering at the gateway webhook (which mints `correlation_id`)
cannot be joined to its channel and domain-event descendants. Cross-surface traceability is
broken at exactly the ingress boundary.

## Decision

Adopt **Option B (full end-to-end)** over Option A (persistence-only):

1. Persist `correlation_id`/`causation_id`/`depth` on `channel_events` from the already-available
   `ChannelEnvelope`, mirrored across Mongo and Postgres, with indexes matching the prior
   `events` shape (`correlation_id, depth, created_at` composite + `causation_id`).
2. Add the same columns + indexes to `gateway_audit_events` (Mongo + Postgres).
3. Close the propagation gap: stamp the minted `correlation_id` (with `causation_id = null`,
   `depth = 0`) onto the request object in the webhook ingress publisher, and read it back in
   the gateway audit interceptor, so the webhook ingress HTTP audit row is joinable.

All new columns are nullable (channel `depth` defaults to `0`; gateway `depth` stays nullable).
No historical backfill — cutover semantics identical to the prior change.

### Why not Option A (persistence-only)
Option A delivers `channel_events` (the pure win) but leaves `gateway_audit_events` with empty
correlation columns until a separate change wires the interceptor. The stated end goal — joining
gateway HTTP ingress into the chain — would not be met, and the gateway columns would sit unused,
inviting a redundant follow-up. The interceptor change is small (request-object stamping, the
codebase's established augmentation pattern) and belongs in the same change.

### Why not Option C (store raw, unindexed)
Rejected: it breaks the prior change's indexed-top-level-field convention, makes correlation
lookups slow at audit volume, and guarantees a re-index follow-up.

### Why request-object stamping (not headers / new DI / OTel baggage)
The api-gateway already augments `IYoizenRequest` with `__upstream`, `__rateLimitApplied`, etc.
The webhook publisher and the response-phase interceptor `tap` share the same request instance,
so stamping `__correlationId` on the request is O(1), allocation-free, and needs no header
round-trip or new provider. It also keeps fabrication impossible: only the webhook path stamps,
so every other path correctly persists `null`.

## Consequences

Positive:
- All three audit surfaces (`events`, `gateway_audit_events`, `channel_events`) become joinable
  by `correlation_id`/`causation_id`, with consistent index shapes.
- Channel surface fix is upstream-free and immediate.
- Convention consistency with the prior change lowers reviewer and operator cognitive load.

Negative / trade-offs:
- Touches the api-gateway request lifecycle (publisher signature gains `request`; interceptor
  reads new request fields). Contained, but it is a second service in the blast radius.
- Only the webhook ingress path populates gateway correlation today; all other HTTP audit rows
  store `null`. This is intentional (no ID to join to) but means gateway-side chains are
  webhook-rooted only.
- `GATEWAY_AUDIT_SKIP_WEBHOOKS=true` suppresses the gateway webhook audit row entirely; in that
  config the gateway surface contributes nothing to the chain (channel surface still does).
- Pre-cutover rows have NULL correlation/causation and never appear in correlation joins.

## Non-goals (explicitly deferred)
- Synthetic correlation IDs for scheduler heartbeat and agent-memory events.
- Historical backfill of existing audit rows.
- Query/filter endpoints and chain-tree builders for the gateway and channel surfaces
  (storage-only in this change).
