# Delta Specification: adapter-service-internal-sync

## Purpose

Behavior of the `adapter-service` internal-sync consumer that materializes
the `http_adapters` mirror table from `service.upserted.v1` /
`service.deleted.v1` events emitted by `registry-service`. This change
moves the consumer from a Core NATS subscription (best-effort, no replay)
to a JetStream durable per tenant (at-least-once, replayable), bound to the
existing per-tenant `INGRESS-<TENANT>` streams.

## ADDED Requirements

### REQ-ASIS-001: Per-tenant durable consumer bound to tenant ingress stream

**Priority**: P0 (Critical)

The system MUST bind a JetStream durable consumer named
`adapter-internal-sync` per tenant on the existing tenant ingress stream
`INGRESS-<TENANT>`, with subject filter
`evt.<tenant>.registry-service.platform.service.system.*.v1`. There MUST be
exactly one durable per tenant per logical service (the durable name is
shared across tenants but each tenant binding is on a distinct stream).

The consumer MUST use **at-least-once** delivery semantics with explicit
acknowledgement.

#### Scenario: Durable bound on startup for an existing tenant

- GIVEN tenant `acme` whose `INGRESS-acme` stream exists
- WHEN the worker process starts
- THEN a durable named `adapter-internal-sync` MUST be bound (created if
  missing) on stream `INGRESS-acme`
- AND its subject filter MUST be
  `evt.acme.registry-service.platform.service.system.*.v1`
- AND its delivery policy MUST be at-least-once with explicit ack

#### Scenario: Two tenants — two independent durables

- GIVEN tenants `acme` and `globex` both have ingress streams
- WHEN the worker is running
- THEN there MUST be one `adapter-internal-sync` durable on
  `INGRESS-acme` AND one on `INGRESS-globex`
- AND a redelivery on the `acme` durable MUST NOT cause any redelivery on
  the `globex` durable

#### Scenario: Stream missing for a tenant (error)

- GIVEN tenant `newco` exists in the platform but `INGRESS-newco` has not
  been provisioned yet
- WHEN the worker attempts to bind a durable for `newco`
- THEN binding MUST fail gracefully without crashing the process
- AND the failure MUST be logged with `tenantId` and the broker error
- AND the system MUST retry on the next reconcile tick (REQ-ASIS-005)
- AND no other tenant's durable MUST be impacted

### REQ-ASIS-002: Idempotent application of redelivered events

**Priority**: P0 (Critical)

Because delivery is at-least-once, the system MUST treat every delivery as
potentially a redelivery. Re-applying the same `service.upserted.v1` or
`service.deleted.v1` MUST NOT corrupt the mirror state — the resulting
mirror row MUST be byte-equivalent to a single delivery.

#### Scenario: Same upsert event delivered twice

- GIVEN a `service.upserted.v1` event has already been processed and the
  mirror row exists
- WHEN the same event is redelivered (same logical service identity)
- THEN the mirror MUST converge to the same final state
- AND no duplicate row MUST be created
- AND no foreign-key or uniqueness constraint MUST be violated

#### Scenario: Delete redelivered after successful delete

- GIVEN a `service.deleted.v1` event for service `s1` has been processed
  and the mirror row has been removed
- WHEN the same `service.deleted.v1` is redelivered
- THEN processing MUST be a no-op
- AND the message MUST still be acknowledged

#### Scenario: Out-of-order redelivery — old upsert after newer state

- GIVEN the mirror reflects an `upserted.v1` at version `v2`
- WHEN an older `upserted.v1` at version `v1` is redelivered
- THEN the mirror MUST NOT regress to `v1`'s state
- AND the older event MUST be acknowledged (not redelivered forever)

### REQ-ASIS-003: Acknowledgement, negative-ack, and poison-message semantics

**Priority**: P0 (Critical)

The system MUST distinguish three outcomes per delivery and apply the
correct broker disposition:

1. **Success** → `ack` (message removed from pending)
2. **Transient failure** (network blip, DB connection reset, broker
   timeout) → `nak` with bounded backoff so the broker redelivers later
3. **Poison message** (malformed envelope, unknown CloudEvents type,
   permanent validation failure) → `term` after exhausting `max_deliver`,
   recorded as a metric and a structured error log; MUST NOT redeliver
   forever

In-flight messages MUST be tracked so the consumer can drain them on
shutdown (REQ-ASIS-004).

#### Scenario: Successful processing → ack

- GIVEN a well-formed `service.upserted.v1`
- WHEN the handler upserts the mirror row successfully
- THEN the message MUST be `ack`'d
- AND the message MUST NOT be redelivered

#### Scenario: Transient DB failure → nak with backoff

- GIVEN the database is momentarily unavailable
- WHEN the handler attempts to upsert and gets a connection-class error
- THEN the message MUST be `nak`'d with a bounded backoff
- AND the broker MUST redeliver the message after the backoff
- AND the redelivery counter for this message MUST be observable

#### Scenario: Malformed envelope → term after max-deliver

- GIVEN a delivered message whose CloudEvents envelope cannot be parsed
- WHEN the handler is invoked
- THEN the system MUST classify it as poison
- AND after the configured `max_deliver` attempts the message MUST be
  `term`'d
- AND a `poison_message` metric MUST be incremented with `reason=parse_error`
- AND a structured error log MUST be emitted with the subject and a
  truncated payload reference (no PII leakage)

#### Scenario: Unknown CloudEvents type → term

- GIVEN a delivery whose envelope is well-formed but whose `type` is not
  one of `service.upserted.v1` / `service.deleted.v1`
- WHEN the handler is invoked
- THEN the message MUST be classified as poison and `term`'d
- AND a `poison_message` metric MUST be incremented with
  `reason=unknown_type`

#### Scenario: Permanent DB constraint violation → term

- GIVEN a delivery that would always violate a non-recoverable constraint
  regardless of retry
- WHEN the handler attempts to apply it
- THEN after `max_deliver` attempts the message MUST be `term`'d with
  `reason=permanent_db_error`
- AND tenant operators MUST be able to discover the failure via metrics
  and logs

### REQ-ASIS-004: Graceful shutdown drains in-flight messages

**Priority**: P0 (Critical)

The system MUST drain in-flight messages on shutdown without ack-leaking.
On receipt of a termination signal:

1. The consumer MUST stop fetching new messages.
2. Already-fetched messages MUST be processed to completion **or** explicitly
   `nak`'d before the process exits, so the broker can redeliver them.
3. The shutdown MUST complete within a bounded grace period; messages still
   in flight at the end of that grace period MUST be `nak`'d (not silently
   dropped, not silently `ack`'d).

#### Scenario: SIGTERM with no in-flight messages

- GIVEN the worker has zero in-flight messages
- WHEN it receives SIGTERM
- THEN it MUST stop fetching, close the consumer cleanly, and exit `0`

#### Scenario: SIGTERM with in-flight messages within grace

- GIVEN the worker has 5 in-flight messages
- WHEN SIGTERM is received and processing of all 5 finishes within the
  grace window
- THEN each MUST be `ack`'d and the worker MUST exit `0`
- AND no message MUST be left as ack-pending after exit

#### Scenario: SIGTERM exceeds grace window (error)

- GIVEN in-flight messages whose handlers do not finish within the grace
  window
- WHEN the grace window expires
- THEN the consumer MUST `nak` those messages so the broker redelivers
  them on the next worker start
- AND no message MUST be silently `ack`'d
- AND a `shutdown_naked_inflight` metric MUST be incremented

### REQ-ASIS-005: Reconciliation against tenant set at runtime

**Priority**: P0 (Critical)

The system MUST attach durables for **all** tenants whose ingress streams
exist at startup, AND MUST reconcile its bindings as the tenant set
changes at runtime — picking up newly-provisioned `INGRESS-<TENANT>`
streams without restart, and tolerating tenants whose streams are
temporarily missing.

#### Scenario: New tenant onboarded while worker is running

- GIVEN the worker is running with durables on tenants `{acme, globex}`
- WHEN tenant `newco` is provisioned and `INGRESS-newco` is created
- THEN within the next reconcile tick the worker MUST bind a new durable
  on `INGRESS-newco`
- AND it MUST start consuming `service.upserted.v1` /
  `service.deleted.v1` events for `newco` without process restart

#### Scenario: Tenant temporarily missing on startup (error)

- GIVEN tenant `newco` exists in tenant inventory but its `INGRESS-newco`
  stream has not yet been created
- WHEN the worker starts and tries to bind a durable for `newco`
- THEN the binding MUST be deferred (not crashing the worker)
- AND the worker MUST retry on subsequent reconcile ticks until the
  stream appears

#### Scenario: Tenant deprovisioned while worker is running

- GIVEN the worker has a durable on `INGRESS-oldco`
- WHEN `oldco` is deprovisioned and its stream is removed
- THEN the worker MUST detect the missing stream
- AND it MUST stop attempting to fetch from that durable without crashing
- AND the corresponding metric series MUST stop reporting backlog for
  that tenant

### REQ-ASIS-006: Sink contract — `service.upserted.v1` / `service.deleted.v1`

**Priority**: P0 (Critical)

The system MUST translate each successfully processed event into the
appropriate mirror operation, preserving tenant isolation:

- `service.upserted.v1` → mirror row for the tenant MUST be created or
  updated to reflect the event payload
- `service.deleted.v1` → mirror row for the tenant MUST be removed (or
  no-op if absent)

The mapping MUST honor tenant scope: an event delivered on
`evt.<tenant>.…` MUST only mutate rows belonging to that tenant.

#### Scenario: Upsert creates mirror row

- GIVEN no mirror row exists for `service-id=s1` in tenant `acme`
- WHEN a `service.upserted.v1` for `s1` is processed
- THEN a mirror row scoped to `acme` MUST be created with the event's
  payload
- AND the message MUST be `ack`'d

#### Scenario: Upsert updates existing mirror row

- GIVEN a mirror row exists for `s1` in `acme` with older state
- WHEN a `service.upserted.v1` for `s1` with newer state is processed
- THEN the row MUST be updated to the newer state
- AND only fields included in the event payload MUST be mutated

#### Scenario: Delete removes mirror row

- GIVEN a mirror row exists for `s1` in `acme`
- WHEN a `service.deleted.v1` for `s1` is processed
- THEN the row MUST be removed
- AND the message MUST be `ack`'d

#### Scenario: Cross-tenant leakage attempt (error)

- GIVEN an event delivered on `evt.acme.…` whose payload claims a
  different tenant
- WHEN the handler runs
- THEN the handler MUST trust the subject's tenant (`acme`) for scoping
  the mirror operation
- AND any mismatch between subject-tenant and payload-tenant MUST be
  classified as poison and `term`'d
- AND a `cross_tenant_attempt` metric MUST be incremented

#### Scenario: Mirror write fails transiently → nak

- GIVEN the mirror DB is briefly unavailable
- WHEN the handler attempts to apply an event
- THEN the message MUST be `nak`'d (transient failure, REQ-ASIS-003)
- AND it MUST be redelivered later

## Non-Functional Requirements

### NFR-ASIS-001: Per-durable observability

**Category**: Observability
**Priority**: P0 (Critical)

Each durable MUST emit metrics that allow operators to scale, drain and
debug it independently per tenant.

- **Metric**: messages received, ack rate, nak rate, term rate,
  redelivery count, processing duration histogram, in-flight count
- **Target**: every delivery MUST be reflected in exactly one outcome
  counter; every term MUST also produce a structured error log
- **Measurement**: Prometheus metrics labeled by tenant and durable name,
  plus the broker-side `jetstream_consumer_num_pending` and
  `jetstream_consumer_num_ack_pending` series for the durable

### NFR-ASIS-002: Loss-free under controlled chaos

**Category**: Reliability
**Priority**: P0 (Critical)

The system MUST not lose any `service.upserted.v1` event under a
controlled chaos test in which the worker is killed during the publish
window. With at-least-once semantics + the idempotent sink contract
(REQ-ASIS-002, REQ-ASIS-006), every event published before the kill MUST
be reflected in the mirror after worker recovery.

- **Metric**: count of mirror rows after recovery vs count of published
  events
- **Target**: 100% — zero loss across the chaos run
- **Measurement**: integration test asserting equality between published
  and mirrored sets after worker restart

### NFR-ASIS-003: End-to-end mirror latency

**Category**: Performance
**Priority**: P1 (High)

The system SHOULD apply mirror updates promptly when the worker is hot.

- **Metric**: time from event publish-ack to corresponding mirror row
  visible to readers
- **Target**: ≤ 5s p95 when worker is hot
- **Target**: ≤ 90s p95 when worker is cold (covered by autoscaling spec
  NFR-ASA-001)
- **Measurement**: histogram comparing publish timestamp to mirror-write
  timestamp
