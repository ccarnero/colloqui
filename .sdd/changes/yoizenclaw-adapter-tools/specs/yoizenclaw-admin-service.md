# Delta for yoizenclaw-admin-service (NestJS)

## ADDED Requirements

### REQ-ADMIN-001: Adapter Reference DTO

**Priority**: P0 (Critical)

The system MUST provide DTOs for validating adapter references in agent tool configurations.

```typescript
class AdapterReferenceDto {
  @IsString()
  @IsNotEmpty()
  adapterId!: string;

  @IsString()
  @IsNotEmpty()
  endpointId!: string;
}

class AgentToolDto {
  // Existing fields...

  @ValidateNested()
  @IsOptional()
  adapterRef?: AdapterReferenceDto;
}
```

#### Scenario: Valid adapter reference passes validation

- GIVEN a tool configuration with `adapterRef: { adapterId: "uuid", endpointId: "uuid" }`
- WHEN the DTO is validated
- THEN validation passes
- AND the tool is saved with the adapter reference

#### Scenario: Invalid adapter ID fails validation

- GIVEN a tool configuration with `adapterRef: { adapterId: "", endpointId: "uuid" }`
- WHEN the DTO is validated
- THEN validation fails with error "adapterId must be a non-empty string"

#### Scenario: Adapter reference and endpoint both present fails validation

- GIVEN a tool configuration with both `endpoint: "/tools/custom"` and `adapterRef: {...}`
- WHEN the DTO is validated
- THEN validation fails with error "Tool must have either endpoint OR adapterRef, not both"

### REQ-ADMIN-002: Adapter Existence Validation

**Priority**: P1 (High)

The system SHOULD validate that referenced adapters and endpoints exist before saving the agent configuration.

#### Scenario: Referenced adapter does not exist

- GIVEN a tool configuration with `adapterRef.adapterId: "nonexistent-uuid"`
- WHEN the agent is saved
- THEN a warning is logged: "Adapter nonexistent-uuid not found, tool may fail at runtime"
- AND the configuration is saved (eventual consistency)

#### Scenario: Referenced endpoint does not exist

- GIVEN a tool configuration with valid `adapterId` but invalid `endpointId`
- WHEN the agent is saved
- THEN a warning is logged: "Endpoint invalid-uuid not found in adapter, tool may fail at runtime"
- AND the configuration is saved

#### Scenario: Validation skipped when feature disabled

- GIVEN environment variable `VALIDATE_ADAPTER_REFS=false`
- WHEN an agent is saved with adapter references
- THEN no adapter existence validation is performed
- AND the configuration is saved immediately

### REQ-ADMIN-003: Agent Tool Schema Update

**Priority**: P0 (Critical)

The system MUST update the agent schema to support `adapterRef` field in the tools array.

#### Scenario: Database stores adapter reference

- GIVEN an agent configuration is saved
- WHEN the tools array contains an adapter reference
- THEN the `adapterRef` object is stored in the `tools` JSONB column
- AND existing tools without `adapterRef` are unaffected

#### Scenario: Migration adds adapter_ref column if needed

- GIVEN an existing database without `adapterRef` support
- WHEN the migration runs
- THEN no schema change is required (JSONB already supports nested objects)
- AND existing tools continue to work

### REQ-ADMIN-004: Adapter Lookup Endpoint

**Priority**: P1 (High)

The system MUST expose an endpoint for listing available adapters and their endpoints for UI selection.

```typescript
GET /admin/adapters
Response: { adapters: AdapterSummaryDto[] }

GET /admin/adapters/:adapterId
Response: AdapterDetailDto
```

#### Scenario: List adapters returns tenant adapters

- GIVEN a tenant with 3 configured adapters
- WHEN `GET /admin/adapters` is called
- THEN response contains 3 adapters with id, name, status
- AND each adapter includes `endpoints` array with id, label, method, path

#### Scenario: Get adapter by ID returns full config

- GIVEN an adapter with ID "salesforce-001"
- WHEN `GET /admin/adapters/salesforce-001` is called
- THEN response includes:
  - `id`, `name`, `baseUrl`, `status`
  - `authType` (without sensitive credentials)
  - `endpoints` array with full details

#### Scenario: Auth credentials are redacted

- GIVEN an adapter with `authType: "bearer"` and `authConfig: { token: "secret123" }`
- WHEN the adapter detail is returned
- THEN `authConfig` is NOT included in response
- AND `hasAuth: true` is included instead

## MODIFIED Requirements

### REQ-ADMIN-005: Agent CRUD Operations

**Priority**: P0 (Critical)

The existing agent CRUD operations MUST be updated to handle `adapterRef` in tool configurations.

(Previously: Tools only supported `endpoint` field)

#### Scenario: Create agent with adapter tool

- GIVEN a valid agent creation request with adapter tool
- WHEN `POST /admin/agents` is called
- THEN the agent is created with the tool referencing the adapter
- AND `201 Created` is returned

#### Scenario: Update agent adds adapter tool

- GIVEN an existing agent with HTTP tools only
- WHEN `PUT /admin/agents/:id` adds a new adapter tool
- THEN the agent is updated with both HTTP and adapter tools
- AND `200 OK` is returned

## Non-Functional Requirements

### NFR-ADMIN-001: Adapter Lookup Performance

**Category**: Performance
**Priority**: P2

The adapter list endpoint MUST respond within 200ms (p95) for tenants with up to 100 adapters.

- **Metric**: Response time for `GET /admin/adapters`
- **Target**: < 200ms p95
- **Measurement**: Distributed tracing on admin-service routes