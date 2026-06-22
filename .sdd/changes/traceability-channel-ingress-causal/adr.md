# ADR-001 — Causal field threading via optional params (channel ingress)

**Status:** Accepted
**Date:** 2026-06-21
**Change:** `traceability-channel-ingress-causal`

---

## Context

The two-stage webhook ingress produces two envelopes: a `WebhookIngressEnvelope` (stage 1, from
api-gateway) and a canonical `ChannelEnvelope` (stage 2, from channel-service). The factory
function `createChannelEnvelope` already accepts `correlationId`, `causationId`, and `depth` as
optional params, but the call site in `IngressService.publishMessage` never receives those values.
The result is that every canonical envelope is a causal root (`causation_id: null`,
`correlation_id: own id`, `depth: 0`), severing the audit chain between the two stages.

The fix must be backward-compatible: non-webhook callers of `processInbound` must not be broken,
and the default factory behavior (no causal = root event) must be preserved.

---

## Decision

Thread the three causal fields (`correlationId`, `causationId`, `depth`) as **optional parameters**
through the existing private call chain:

```
processEnvelope(+causal?) → scheduleIngress(+causal?) → processInbound(+causal?) → publishMessage(+causal?) → createChannelEnvelope(+causal?)
```

The extraction point is `WebhookIngressConsumerService.processMessage`, which is the only site that
holds the `WebhookIngressEnvelope` before the call chain begins.

---

## Consequences

**Positive:**
- Minimal surface change: three optional fields on two private interfaces, one new optional param on
  one public method (`processEnvelope`).
- Zero risk to non-webhook callers: all new params are optional; undefined propagates to the factory
  defaults unchanged.
- No new types, no imports, no package changes.
- Rollback is a single commit revert — no data migration involved.
- The audit chain (`GET /audit/events/chain/:correlationId`) will correctly include both the webhook
  envelope and the canonical envelope under the same `correlation_id`.

**Negative / risks:**
- `processEnvelope` grows a 6th parameter. If more callers are added in future, the signature may
  become unwieldy. Acceptable at current call count (1 real caller).
- `depth` incremented at the consumer layer means any non-webhook future caller that passes a
  webhook envelope with `depth` would need to be aware of the convention. Documented in the spec.

---

## Alternatives Considered

### A. Context object passed as a separate arg

Group the three fields into a named `ICausalContext` interface passed as a single optional object.

**Why rejected:** This is what the chosen approach already does — the `causal?` parameter in
`processEnvelope` and the optional fields on `IProcessInboundOptions` / `IPublishMessageOptions` are
structurally equivalent. A separate exported `ICausalContext` type would add a shared-package
dependency for no runtime benefit given that only one call path uses it.

### B. ThreadLocal / AsyncLocalStorage context

Store causal context in Node's `AsyncLocalStorage` at the consumer level and read it inside
`publishMessage` without changing any signatures.

**Why rejected:** Implicit coupling between distant layers. Harder to test (requires mocking async
context). Creates an invisible dependency that is not expressed in types. Overkill for a call chain
that is already synchronous from the consumer perspective.

### C. Deriving from `WebhookIngressEnvelope` inside `IngressService`

Pass the full `WebhookIngressEnvelope` down to `IngressService` and let it extract the causal
fields.

**Why rejected:** `IngressService` is a generic ingress layer that should not know about the webhook
envelope type. Passing the full envelope violates layer boundaries and couples the ingress service
to the webhook-specific type from `@yoizen/shared`.

### D. Deriving via `deriveEnvelope` utility

Use the existing `deriveEnvelope` function from `@yoizen/shared` instead of passing raw causal
fields.

**Why rejected:** `deriveEnvelope` requires an `EventEnvelope` as input and produces a new derived
envelope. `createChannelEnvelope` is a purpose-built factory for the canonical channel event — using
`deriveEnvelope` would require restructuring the factory or producing an intermediate envelope,
adding complexity for no benefit. The three optional params on `createChannelEnvelope` already cover
the causal propagation contract.
