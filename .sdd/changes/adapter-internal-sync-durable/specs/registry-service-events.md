# Delta Specification: registry-service-events

## Purpose

Behavior of `registry-service` when emitting service-lifecycle events
(`service.upserted.v1`, `service.deleted.v1`) over the platform message bus.
This change moves the publisher from Core NATS (fire-and-forget) to JetStream
(durable, replayable), and makes per-tenant ingress streams a precondition of
publish.

## ADDED Requirements

### REQ-RSE-001: Durable JetStream emission of service-lifecycle events

**Priority**: P0 (Critical)

The system MUST publish `service.upserted.v1` and `service.deleted.v1` events
to **JetStream** (not Core NATS) on the canonical 8-token subject
`evt.<tenant>.registry-service.platform.service.system.<verb>.v1`, so that
events survive consumer downtime and are eligible for at-least-once redelivery.

The publisher MUST attach a publish-side dedup identifier (`Nats-Msg-Id` /
JetStream `msgID`) so that JetStream-side dedup discards a duplicate publish
within the dedup window.

#### Scenario: Successful upsert publish

- GIVEN a tenant `acme` whose `INGRESS-acme` stream exists
- AND `REGISTRY_EMIT_ADAPTER_SYNC=true`
- WHEN a `POST /registry/services` request for tenant `acme` succeeds and the
  database insert is committed
- THEN the publisher MUST publish a `service.upserted.v1` event to JetStream
  on subject `evt.acme.registry-service.platform.service.system.upserted.v1`
- AND the publish MUST be acknowledged by the JetStream stream (PUB ack
  received with a stream sequence) before the publish call returns
- AND a stable `Nats-Msg-Id` derived from the service identity MUST be
  attached so that a retried publish of the same logical event is deduped

#### Scenario: Successful delete publish

- GIVEN a tenant `acme` whose `INGRESS-acme` stream exists
- AND `REGISTRY_EMIT_ADAPTER_SYNC=true`
- WHEN a `DELETE /registry/services/{id}` request for tenant `acme` succeeds
- THEN the publisher MUST publish a `service.deleted.v1` event to JetStream
  on subject `evt.acme.registry-service.platform.service.system.deleted.v1`
- AND the publish MUST be JetStream-acknowledged before the call returns

#### Scenario: NATS broker unavailable on publish (error)

- GIVEN the NATS broker is unreachable from the registry pod
- WHEN a service is upserted and the publisher attempts to emit the event
- THEN the publish MUST fail without breaking the HTTP response (best-effort)
- AND the failure MUST be logged with `tenantId`, `serviceId`, `subject`, and
  the error class
- AND a retry MUST be attempted with bounded backoff
- AND if retries are exhausted, the event MUST be reported via metrics so
  operators can run the offline backfill recovery path

#### Scenario: JetStream publish ACK timeout (error)

- GIVEN the broker is reachable but does not return a publish-ack within the
  configured timeout
- WHEN the publisher emits a `service.upserted.v1`
- THEN the publish MUST be considered failed for that attempt
- AND the same retry/log/metric path as broker-unavailable MUST be taken
- AND the publisher MUST NOT block the originating HTTP response

### REQ-RSE-002: Stream-ensure precondition before publish

**Priority**: P0 (Critical)

The system MUST guarantee that the per-tenant ingress stream
`INGRESS-<TENANT>` exists **before** any service-lifecycle event for that
tenant is published. Stream existence MUST be ensured idempotently and the
result MAY be cached per pod for the lifetime of that pod.

#### Scenario: First publish for a new tenant

- GIVEN tenant `newco` has never been published to from this registry pod
- AND the stream `INGRESS-newco` does not yet exist on the broker
- WHEN the publisher is asked to emit `service.upserted.v1` for `newco`
- THEN the publisher MUST first ensure stream `INGRESS-newco` exists,
  creating it if missing, with the canonical subject filter for tenant
  ingress (`evt.newco.>`)
- AND only after that confirmation MUST the publish proceed
- AND subsequent publishes for `newco` from the same pod MAY skip the
  ensure step (cached as already-ensured)

#### Scenario: Stream already exists

- GIVEN stream `INGRESS-acme` already exists on the broker
- WHEN the publisher is asked to emit `service.upserted.v1` for `acme`
- THEN the ensure step MUST be a no-op (idempotent)
- AND the publish MUST proceed

#### Scenario: Stream creation rejected by broker (error)

- GIVEN the ensure step encounters a broker-side rejection (auth, quota,
  conflicting subject filter)
- WHEN the publisher attempts to emit a service-lifecycle event
- THEN the publish MUST NOT proceed
- AND the failure MUST be logged with `tenantId`, the broker error class,
  and the offending subject filter
- AND it MUST be surfaced via metrics so operators are alerted
- AND the HTTP response of the originating request MUST NOT be failed by
  this condition (publish is best-effort relative to the API)

### REQ-RSE-003: Publish is non-blocking and post-commit

**Priority**: P0 (Critical)

The system MUST treat event publication as a side effect that runs **after**
the originating database write has been committed, and MUST NOT fail the HTTP
response on publish errors. Publish errors MUST be retried with bounded
backoff and surfaced via logs and metrics rather than propagated to the
caller.

#### Scenario: DB commit succeeds, publish succeeds

- GIVEN a successful `POST /registry/services` for tenant `acme`
- WHEN the registry transaction commits
- THEN the publish MUST be invoked after the commit
- AND the HTTP response MUST be `2xx` regardless of any subsequent publish
  outcome

#### Scenario: DB commit succeeds, publish fails permanently

- GIVEN a successful `POST /registry/services` for tenant `acme`
- AND publish retries are exhausted due to broker outage
- WHEN the publisher gives up
- THEN the API MUST have already returned `2xx` to the client
- AND a structured error log MUST be emitted with sufficient context to
  reconcile via the offline backfill tool
- AND a publish-failure metric MUST be incremented

#### Scenario: DB commit fails

- GIVEN a `POST /registry/services` whose database commit is rolled back
- WHEN the request fails
- THEN the publisher MUST NOT emit any event for that operation
- AND no `service.upserted.v1` or `service.deleted.v1` MUST appear on the
  bus

### REQ-RSE-004: Feature-flag–gated emission (`REGISTRY_EMIT_ADAPTER_SYNC`)

**Priority**: P0 (Critical)

The system MUST gate all service-lifecycle emissions behind the feature flag
`REGISTRY_EMIT_ADAPTER_SYNC`. When the flag is set to `false`, the publisher
MUST NOT emit any event and MUST NOT contact the broker for stream-ensure or
publish — providing a no-redeploy rollback path.

#### Scenario: Flag enabled

- GIVEN `REGISTRY_EMIT_ADAPTER_SYNC=true`
- WHEN a service is upserted
- THEN the publish flow defined in REQ-RSE-001 MUST run

#### Scenario: Flag disabled (rollback path)

- GIVEN `REGISTRY_EMIT_ADAPTER_SYNC=false`
- WHEN a service is upserted or deleted
- THEN the publisher MUST NOT publish any event
- AND it MUST NOT call stream-ensure
- AND no broker connection MUST be required for the HTTP request to succeed

#### Scenario: Flag toggled live

- GIVEN the flag was `false` and the publisher has been quiet
- WHEN the flag is flipped to `true` without redeploy
- THEN the next service mutation MUST emit normally per REQ-RSE-001

### REQ-RSE-005: Tenant context required on every emission

**Priority**: P0 (Critical)

The system MUST refuse to publish a service-lifecycle event when no
`tenantId` is resolvable for the originating operation, since the canonical
subject is tenant-scoped and a missing tenant would route the event into an
ambiguous namespace.

#### Scenario: Missing tenant id (error)

- GIVEN a service operation reaches the publisher with no resolvable
  `tenantId`
- WHEN the publisher is invoked
- THEN it MUST NOT publish the event
- AND it MUST log the condition as an error with the `serviceId` and the
  operation type
- AND it MUST increment a publish-failure metric tagged with reason
  `missing_tenant`

#### Scenario: Tenant id present

- GIVEN a service operation with `tenantId=acme`
- WHEN the publisher is invoked
- THEN the publish MUST proceed per REQ-RSE-001 with subject prefix
  `evt.acme.…`

## Non-Functional Requirements

### NFR-RSE-001: Publisher observability

**Category**: Observability
**Priority**: P1 (High)

The publisher SHALL expose metrics and logs sufficient to operate the flow
without inspecting NATS internals.

- **Metric**: publish attempts, publish successes, publish failures (by
  reason class), and stream-ensure attempts (cache hit vs broker call)
- **Target**: every publish attempt MUST be reflected in exactly one
  outcome counter
- **Measurement**: Prometheus counters scraped by the platform observability
  stack

### NFR-RSE-002: Publish latency budget

**Category**: Performance
**Priority**: P1 (High)

The publish path SHOULD not dominate the HTTP request latency budget of the
originating registry endpoint.

- **Metric**: time from end-of-DB-commit to publish-ack
- **Target**: ≤ 250ms p95 when stream is already ensured (cache hit)
- **Target**: ≤ 750ms p95 on first publish per tenant per pod (cache miss
  with stream-ensure)
- **Measurement**: histogram around the publish call site
