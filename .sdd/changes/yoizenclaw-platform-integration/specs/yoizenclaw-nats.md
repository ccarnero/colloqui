# Delta Specification: yoizenclaw-nats

## ADDED Requirements

### REQ-YZC-NATS-001: Tenant-scoped NATS subjects (wdocs/01 compliance)

**Priority**: P0 (Critical)

The system MUST use NATS subjects following the `evt.{tenant}.yoizenclaw.{action}.v1` convention defined in `wdocs/01-service-bus.md`.

**Subject mappings** (per wdocs convention):
- Config sync: `evt.{tenant}.yoizenclaw.config_sync.v1`
- Jobs sync: `evt.{tenant}.yoizenclaw.jobs_sync.v1`
- Job trigger: `evt.{tenant}.yoizenclaw.job_trigger.v1`
- Chat respond: `evt.{tenant}.yoizenclaw.chat_respond.v1`
- Runtime online: `evt.{tenant}.yoizenclaw.online.v1`
- Agent outbound: `evt.{tenant}.yoizenclaw.agent.outbound.v1`
- Execution status: `evt.{tenant}.yoizenclaw.job.execution_status.v1`
- Event (generic): `evt.{tenant}.yoizenclaw.event.v1`

**Wildcard subscription**: `evt.{tenant}.yoizenclaw.>` (catches all YoizenClaw actions for a tenant)

**Stream per tenant**: `INGRESS-{tenant}` (per wdocs/01-service-bus.md)

#### Scenario: Config sync for specific tenant

- GIVEN YoizenClaw Admin Service publishes config for tenant "acme"
- WHEN the message is published to `evt.acme.yoizenclaw.config_sync.v1`
- THEN only the YoizenClaw runtime instance for tenant "acme" MUST process it
- AND runtimes for other tenants MUST NOT receive this message

#### Scenario: Cross-tenant message isolation via NATS Accounts

- GIVEN multiple tenants have active runtimes, each in its own NATS Account
- WHEN a config sync message is sent for tenant "acme"
- THEN NATS Account ACLs MUST ensure only the acme runtime receives it
- AND messages MUST NOT leak between tenants (per wdocs/05-seguridad.md)

#### Scenario: Runtime subscribes to wildcard

- GIVEN the YoizenClaw runtime for tenant "acme" starts
- WHEN it subscribes to `evt.acme.yoizenclaw.>`
- THEN it MUST receive all YoizenClaw events for tenant "acme"
- AND extract the tenant from the subject using `extract_tenant_from_subject()`

### REQ-YZC-NATS-002: CloudEvents envelope compliance (wdocs/02 compliance)

**Priority**: P0 (Critical)

All NATS messages MUST use CloudEvents envelope with transport metadata per `wdocs/02-diseño-de-mensajes.md`.

**Required envelope fields**:
- `specversion: "1.0"`
- `id`, `source`, `type`, `time` (CloudEvents standard)
- `traceid`, `causation_id`, `correlation_id` (tracing)
- `tenant` (tenant identifier)
- `transport.method`, `transport.protocol`, `transport.agent_id`, `transport.depth` (wdocs/03)
- `data` (payload)

YoizenClaw operates as **internal agent** (per wdocs/03-ingress-agentes.md):
- `transport.protocol: "internal"`
- `transport.agent_id: "yoizenclaw-runtime"`
- MAX_DEPTH: 5

#### Scenario: Valid envelope received from Admin Service

- GIVEN a NATS message with CloudEvents envelope on `evt.acme.yoizenclaw.config_sync.v1`
- WHEN the runtime receives it
- THEN it MUST validate required envelope fields
- AND extract tenant from the envelope for database operations
- AND extract `depth` from `transport.depth` for anti-loop enforcement

#### Scenario: Message without valid envelope

- GIVEN a NATS message without CloudEvents envelope structure
- WHEN the runtime receives it
- THEN it MUST reject the message with a warning log
- AND increment `yoizenclaw.ingress.publish_failed` metric

### REQ-YZC-NATS-003: Depth tracking and anti-loop (wdocs/03 compliance)

**Priority**: P0 (Critical)

The system MUST enforce depth limits to prevent infinite message loops per `wdocs/03-ingress-agentes.md` section 5.

**Rules**:
- MAX_DEPTH for internal agents: 5
- Every outbound message increments depth by 1
- When depth >= MAX_DEPTH, the event MUST be rejected and sent to DLQ

#### Scenario: Inbound message within depth limit

- GIVEN an inbound envelope with `transport.depth: 3`
- WHEN the runtime processes it
- THEN it MUST allow processing (3 < 5)
- AND any outbound message MUST have depth = 4

#### Scenario: Depth limit exceeded

- GIVEN an inbound envelope with `transport.depth: 5`
- WHEN the runtime receives it
- THEN it MUST reject the event
- AND send to DLQ with reason `depth_exceeded`
- AND increment `yoizenclaw.agent.depth_exceeded` metric
- AND log warning with tenant, traceid, depth value

## Non-Functional Requirements

### NFR-NATS-001: Message delivery latency

**Category**: Performance
**Priority**: P1 (High)

The system MUST deliver messages to the correct tenant runtime within acceptable latency.

- **Metric**: End-to-end message delivery time
- **Target**: < 500ms from publish to processing start
- **Measurement**: Trace spans from publisher to consumer

### NFR-NATS-002: Subject naming convention compliance

**Category**: Reliability
**Priority**: P0 (Critical)

All tenant-scoped subjects MUST follow the pattern: `evt.{tenant}.yoizenclaw.{action}.v1` per wdocs/01.

- **Metric**: Subject naming compliance
- **Target**: 100% of subjects follow wdocs convention
- **Measurement**: Code review and runtime validation
