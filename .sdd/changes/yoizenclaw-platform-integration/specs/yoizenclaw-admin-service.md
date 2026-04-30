# Delta Specification: yoizenclaw-admin-service

## ADDED Requirements

### REQ-YZC-ADM-001: Integration with Tenant Service for runtime provisioning

**Priority**: P0 (Critical)

The system MUST integrate YoizenClaw Admin Service with Tenant Service to automatically provision a YoizenClaw runtime when a tenant creates their first agent.

**Integration flow**:
1. Tenant creates first agent via Admin Console
2. Admin Service checks if tenant has existing runtime
3. If no runtime exists, call Tenant Service to create Knative Service + NATS Account + Stream + Object Store
4. Wait for runtime to be ready (health check)
5. Publish initial config sync via CloudEvents envelope

#### Scenario: First agent creation triggers full provisioning

- GIVEN tenant "acme" has no existing YoizenClaw runtime
- WHEN the tenant creates their first agent via POST /admin/agents
- THEN the Admin Service MUST call Tenant Service to:
  - Create NATS Account for tenant "acme" with ACLs (per wdocs/05)
  - Create stream `INGRESS-acme` (per wdocs/01)
  - Create Object Store bucket `PAYLOAD-acme` (per wdocs/04)
  - Create Knative Service
- AND wait for the service to report "ready" status
- AND publish the initial agent config via CloudEvents envelope to `evt.acme.yoizenclaw.config_sync.v1`

#### Scenario: Subsequent agent uses existing runtime

- GIVEN tenant "acme" already has a running YoizenClaw runtime
- WHEN the tenant creates a second agent
- THEN no new Knative Service SHOULD be created
- AND the new agent config MUST be published to the existing runtime via envelope

### REQ-YZC-ADM-002: Runtime health monitoring

**Priority**: P1 (High)

The system MUST monitor the health of provisioned YoizenClaw runtimes and expose this information via the Admin Service API.

**Health indicators**:
- Runtime connectivity (via NATS heartbeat `evt.{tenant}.yoizenclaw.online.v1`)
- PostgreSQL connectivity
- Last config sync timestamp
- Number of connected runtimes per tenant

#### Scenario: Runtime health check endpoint

- GIVEN tenant "acme" has a provisioned runtime
- WHEN GET /admin/runtime/status is called with tenant header
- THEN the response MUST include:
  - `configured: true`
  - `connected_runtimes: ["runtime-acme-primary"]`
  - `last_sync_at: "2026-03-30T12:00:00Z"`
  - `status: "healthy"`

#### Scenario: Detect disconnected runtime

- GIVEN a runtime has not sent heartbeat for > 60 seconds
- WHEN the health endpoint is queried
- THEN the status MUST reflect "degraded"
- AND a warning MUST be logged (with tenant + traceid, NEVER data.payload per wdocs/06)

### REQ-YZC-ADM-003: Agent publish with CloudEvents envelope (wdocs/02 compliance)

**Priority**: P0 (Critical)

The system MUST publish agent configuration to the tenant's runtime via NATS using CloudEvents envelope with transport metadata when an agent is published.

**Event flow**:
1. Admin receives POST /admin/agents/:id/publish
2. Update agent status to "published"
3. Compile full agent config (system prompt, tools, credentials)
4. Build CloudEvents envelope with `transport.protocol: "internal"`, `transport.agent_id: "yoizenclaw-runtime"`, `depth: 0`
5. Check payload size (Claim Check per wdocs/04 if > 256KB)
6. Publish to `evt.{tenant}.yoizenclaw.config_sync.v1`

#### Scenario: Publishing agent triggers config sync with envelope

- GIVEN agent "sales-assistant" for tenant "acme" is in "draft" status
- WHEN POST /admin/agents/sales-assistant/publish is called
- THEN the agent status MUST change to "published"
- AND a CloudEvents envelope MUST be published to `evt.acme.yoizenclaw.config_sync.v1`
- AND the envelope MUST include `transport.depth: 0`, `transport.protocol: "internal"`
- AND the payload MUST include the complete agent configuration

#### Scenario: Large agent config triggers Claim Check

- GIVEN agent "data-analyzer" has a config > 256KB
- WHEN it is published
- THEN the payload MUST be stored in Object Store `PAYLOAD-acme`
- AND the envelope MUST reference it via `payload_ref`
- AND `payload_inline` MUST be `false`

### REQ-YZC-ADM-004: Structured logging with tenant tags (wdocs/06 compliance)

**Priority**: P1 (High)

All Admin Service logs related to YoizenClaw MUST include structured fields `tenant`, `traceid`, `causation_id` and MUST NEVER log `data.payload` per wdocs/06-observabilidad.md sección 3.4.

#### Scenario: Log agent creation

- GIVEN an agent is created for tenant "acme"
- WHEN the Admin Service logs the event
- THEN the log MUST include `tenant: "acme"`, `traceid`, `agent_id`
- AND MUST NOT include the agent's system prompt or credentials

## MODIFIED Requirements

### REQ-YZC-ADM-005: Tenant-aware database queries

**Priority**: P0 (Critical)

The system SHALL modify all repository methods in YoizenClaw Admin Service to include `tenant_id` in queries.

**Modified repositories**:
- `AgentsRepository`: Filter all queries by tenant_id
- `CredentialsRepository`: Filter by tenant_id
- `JobsRepository`: Filter by tenant_id
- `ConfigFilesRepository`: Filter by tenant_id

#### Scenario: List agents for specific tenant

- GIVEN agents exist for tenants "acme" and "other-tenant"
- WHEN GET /admin/agents is called with header `x-yoizen-tenant: acme`
- THEN only agents with `tenant_id = 'acme'` MUST be returned

## Non-Functional Requirements

### NFR-ADM-001: Provisioning latency

**Category**: Performance
**Priority**: P1 (High)

The system SHOULD provision a new runtime within acceptable time limits.

- **Metric**: Time from first agent creation to runtime ready
- **Target**: < 60 seconds for Knative Service to be ready
- **Measurement**: End-to-end timing from API call to health check success

### NFR-ADM-002: API response time

**Category**: Performance
**Priority**: P1 (High)

Admin Service API endpoints MUST respond within acceptable latency even with tenant filtering.

- **Metric**: HTTP response time
- **Target**: < 200ms p95 for list endpoints
- **Measurement**: APM metrics

### NFR-ADM-003: PII logging policy

**Category**: Security
**Priority**: P0 (Critical)

The Admin Service MUST NEVER log `data.payload` content per wdocs/06 sección 3.4.

- **Metric**: PII exposure in logs
- **Target**: Zero instances of payload logging
- **Measurement**: Log audit
