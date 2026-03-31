# Delta Specification: shared-constants

## ADDED Requirements

### REQ-SHARED-001: YoizenClaw NATS subjects constants (wdocs/01 compliance)

**Priority**: P0 (Critical)

The system MUST add YoizenClaw-specific NATS subject constants to the `@yoizen/shared` package following the `evt.{tenant}.yoizenclaw.{action}.v1` convention from `wdocs/01-service-bus.md`.

**New constants** (in `packages/shared/src/constants.ts`):
```typescript
export const YOIZENCLAW_SUBJECT_PREFIX = "evt.{tenant}.yoizenclaw";

export const YOIZENCLAW_CONFIG_SYNC = "evt.{tenant}.yoizenclaw.config_sync.v1";
export const YOIZENCLAW_JOBS_SYNC = "evt.{tenant}.yoizenclaw.jobs_sync.v1";
export const YOIZENCLAW_JOB_TRIGGER = "evt.{tenant}.yoizenclaw.job_trigger.v1";
export const YOIZENCLAW_CHAT_RESPOND = "evt.{tenant}.yoizenclaw.chat_respond.v1";
export const YOIZENCLAW_ONLINE = "evt.{tenant}.yoizenclaw.online.v1";
export const YOIZENCLAW_AGENT_OUTBOUND = "evt.{tenant}.yoizenclaw.agent.outbound.v1";
export const YOIZENCLAW_EXECUTION_STATUS = "evt.{tenant}.yoizenclaw.job.execution_status.v1";
export const YOIZENCLAW_EVENT = "evt.{tenant}.yoizenclaw.event.v1";
```

**Helper functions**:
```typescript
export function buildYoizenClawSubject(template: string, tenantId: string): string;
```

#### Scenario: Build tenant-specific subject

- GIVEN the template `evt.{tenant}.yoizenclaw.config_sync.v1`
- WHEN calling `buildYoizenClawSubject(YOIZENCLAW_CONFIG_SYNC, 'acme')`
- THEN it MUST return `evt.acme.yoizenclaw.config_sync.v1`

#### Scenario: Consistent subject usage across services

- GIVEN both YoizenClaw Admin Service and Runtime use `@yoizen/shared`
- WHEN Admin Service publishes to `YOIZENCLAW_CONFIG_SYNC`
- AND Runtime subscribes to `evt.{tenant}.yoizenclaw.>` wildcard
- THEN they MUST use identical subject strings
- AND messages MUST be routed correctly

### REQ-SHARED-002: Tenant header validation utilities

**Priority**: P1 (High)

The system SHOULD provide utility functions for extracting and validating tenant headers in both TypeScript and Python.

**TypeScript** (`packages/shared/src/utils.ts`):
```typescript
export function extractTenantId(headers: Record<string, string>): string | null;
export function validateTenantId(tenantId: string): boolean;
```

**Python** (new file: `shared/types/python/tenant.py`):
```python
def extract_tenant_id(headers: dict) -> Optional[str]:
def validate_tenant_id(tenant_id: str) -> bool:
TENANT_HEADER = "x-yoizen-tenant"
```

#### Scenario: Extract tenant from HTTP headers

- GIVEN HTTP headers include `x-yoizen-tenant: acme`
- WHEN `extractTenantId(headers)` is called
- THEN it MUST return `'acme'`

#### Scenario: Validate tenant ID format

- GIVEN a tenant ID string
- WHEN `validateTenantId(tenantId)` is called
- THEN it MUST return `true` for valid IDs (alphanumeric + hyphens, 3-32 chars)
- AND return `false` for invalid formats

## MODIFIED Requirements

### REQ-SHARED-003: Export new constants from index

**Priority**: P0 (Critical)

The system SHALL export all new YoizenClaw constants from `packages/shared/src/index.ts`.

#### Scenario: Import from shared package

- GIVEN a service imports from `@yoizen/shared`
- WHEN it uses `import { YOIZENCLAW_CONFIG_SYNC } from '@yoizen/shared'`
- THEN the constant MUST be available
- AND TypeScript compilation MUST succeed

## Non-Functional Requirements

### NFR-SHARED-001: Backward compatibility

**Category**: Reliability
**Priority**: P0 (Critical)

Adding new constants MUST NOT break existing imports or functionality.

- **Metric**: Breaking changes
- **Target**: Zero breaking changes
- **Measurement**: Existing tests pass without modification

### NFR-SHARED-002: Cross-language consistency

**Category**: Maintainability
**Priority**: P1 (High)

Constants defined in TypeScript MUST have equivalent definitions in Python where applicable.

- **Metric**: Naming consistency
- **Target**: 100% of shared constants available in both languages with identical semantic meaning
- **Measurement**: Code review comparison
