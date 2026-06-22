# ADR — Narrow `buildChainTree` to a structural interface (`ChainInputEvent`)

**Status:** Accepted
**Date:** 2026-06-21
**Change:** `traceability-channel-chain-endpoint`

---

## Context

`buildChainTree` is a pure, backend-agnostic function that assembles a causal-chain tree from a
flat list of events. Its current signature is:

```ts
export function buildChainTree(events: IAuditEvent[], correlationId: string): ChainTreeResult | null
```

`IAuditEvent` is defined in `audit.repository.interface.ts` and carries fields that are specific
to the `events` table schema: `payload`, `metadata`, and `correlation_id` (the chain query filter
key). Channel events (`channel_events`) use different field names for the chain-relevant fields:
`kind` (not `type`), `natsSubject` (not `subject`), `causationId` (not `causation_id`), `createdAt`
(not `created_at`).

We need `buildChainTree` to work for both `events` and `channel_events` rows without duplicating
the algorithm.

## Decision

Define and export a narrow structural interface `ChainInputEvent` that contains only the fields
`buildChainTree` actually reads inside its body:

```ts
export interface ChainInputEvent {
  id: string;
  type: string;
  subject: string;
  causation_id: string | null | undefined;
  depth?: number;
  created_at: string;
}
```

Change `buildChainTree` and the internal `toNode` helper to accept `ChainInputEvent[]` instead of
`IAuditEvent[]`. Because TypeScript uses structural subtyping, `IAuditEvent` already satisfies
`ChainInputEvent` (all required fields are present with compatible types) — the existing
`AuditService.getChain` call compiles unchanged with no runtime changes.

For channel events, a pure mapper function `toChainInput(row: IStoredChannelEvent): ChainInputEvent`
bridges the field-name differences before calling `buildChainTree`.

## Consequences

**Positive:**
- Single tree-assembly algorithm; channel and audit event chains stay consistent.
- `buildChainTree` is now explicitly contract-driven — it documents which fields it actually needs.
- Adding future event sources (e.g. gateway chain) requires only a new mapper, not a new function.
- No runtime behavior change for existing `events` path; purely a type widening at the call site.

**Negative / Risks:**
- If a future change adds a new field read inside `buildChainTree` (e.g. reading `payload`), the
  author must remember to also add it to `ChainInputEvent` — otherwise it will be a compile error.
  This is a feature, not a bug (it forces the interface to stay accurate).
- The mapper `toChainInput` introduces a field rename (`kind → type`, `natsSubject → subject`,
  `causationId → causation_id`, `createdAt → created_at`). The tree node's `type` field will
  carry the channel `kind` value (`received`, `sent`), which is semantically correct.

## Alternatives Rejected

### Alternative: Duplicate `buildChainTree` as `buildChannelChainTree`

Create a separate function that accepts `IStoredChannelEvent[]` directly. Simpler to understand
in isolation, but:
- Duplicates ~120 lines of non-trivial algorithm (the tree building logic including synthetic root,
  orphan collection, BFS depth traversal, MAX_CHAIN_NODES guard).
- Two copies will diverge over time as the algorithm evolves (e.g. max-depth fix, truncation
  logic change).
- Rejected: code duplication without benefit; structural subtyping solves this cleanly.

### Alternative: Union type `IAuditEvent | IStoredChannelEvent`

Change the signature to `events: (IAuditEvent | IStoredChannelEvent)[]`. Requires the function
body to handle two different field shapes with conditional access. Couples the pure function to
both concrete types, defeating its backend-agnostic design. Rejected.

### Alternative: Generic + adapter at call site only

Keep the function typed as `IAuditEvent[]` and cast channel rows at the call site with `as unknown
as IAuditEvent[]`. Works at runtime but is a lie at the type level and suppresses legitimate type
errors. Rejected.
