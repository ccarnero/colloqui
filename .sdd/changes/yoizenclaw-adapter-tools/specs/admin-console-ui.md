# Delta for admin-console-ui (Angular)

## ADDED Requirements

### REQ-UI-001: Adapter Tool Configuration UI

**Priority**: P0 (Critical)

The system MUST provide UI controls for selecting adapters and endpoints when configuring agent tools.

#### Scenario: User selects adapter as tool source

- GIVEN an agent being edited with a tool configuration form
- WHEN the user selects "Adapter" from the "Tool Source" dropdown
- THEN an "Adapter" dropdown appears with available adapters
- AND an "Endpoint" dropdown appears (empty until adapter is selected)

#### Scenario: User selects adapter from dropdown

- GIVEN the "Tool Source" is set to "Adapter"
- WHEN the user clicks the "Adapter" dropdown
- THEN the dropdown shows all adapters for the current tenant
- AND each adapter displays: name, status (active/inactive)

#### Scenario: User selects endpoint after adapter selection

- GIVEN an adapter is selected in the "Adapter" dropdown
- WHEN the user clicks the "Endpoint" dropdown
- THEN the dropdown shows all endpoints for the selected adapter
- AND each endpoint displays: label, method (GET/POST/PUT/DELETE), path

#### Scenario: Tool fields disabled when adapter is selected

- GIVEN the "Tool Source" is set to "Adapter"
- THEN the "Endpoint URL" field is hidden or disabled
- AND the "Method" field is disabled (inherited from adapter endpoint)
- AND the "Headers" field is disabled (inherited from adapter)

### REQ-UI-002: Tool Source Toggle

**Priority**: P0 (Critical)

The system MUST allow users to choose between "HTTP Endpoint" and "Adapter" as tool source.

#### Scenario: Default tool source is HTTP

- GIVEN a new tool is being created
- WHEN the tool configuration form loads
- THEN "Tool Source" defaults to "HTTP Endpoint"
- AND the HTTP endpoint fields are visible

#### Scenario: Switching to adapter source clears HTTP fields

- GIVEN a tool configured with HTTP endpoint
- WHEN the user switches "Tool Source" to "Adapter"
- THEN the `endpoint` and `headers` fields are cleared
- AND `adapterRef` is set to empty

#### Scenario: Switching to HTTP clears adapter fields

- GIVEN a tool configured with adapter reference
- WHEN the user switches "Tool Source" to "HTTP Endpoint"
- THEN the `adapterRef` field is cleared
- AND `endpoint` field is set to empty string

### REQ-UI-003: Adapter Preview

**Priority**: P2 (Medium)

The system SHOULD display a preview of the adapted endpoint configuration.

#### Scenario: Preview shows resolved URL

- GIVEN an adapter and endpoint are selected
- WHEN the tool configuration form displays
- THEN a "Preview" section shows:
  - Resolved URL: `{baseUrl}{path}`
  - Method: `GET | POST | PUT | DELETE`
  - Auth Type: `None | API Key | Bearer | Basic | OAuth2`
- AND auth credentials are NOT displayed

#### Scenario: Preview updates on selection change

- GIVEN a different adapter is selected
- WHEN the adapter dropdown changes
- THEN the preview updates immediately
- AND the endpoint dropdown resets to empty

### REQ-UI-004: Validation Feedback

**Priority**: P1 (High)

The system MUST display validation errors for invalid adapter configurations.

#### Scenario: Invalid adapter shows error

- GIVEN an adapter that was deleted
- WHEN the tool configuration loads
- THEN a warning banner displays: "Adapter '{name}' not found"
- AND the adapter selection shows "Invalid Reference"
- AND the tool is marked as "Disabled" until fixed

#### Scenario: Invalid endpoint shows error

- GIVEN a valid adapter but deleted endpoint
- WHEN the tool configuration loads
- THEN a warning banner displays: "Endpoint not found in adapter"
- AND the tool is marked as "Disabled" until fixed

#### Scenario: Inactive adapter shows warning

- GIVEN an adapter with status "inactive"
- WHEN the adapter is selected
- THEN a warning badge displays: "Adapter inactive"
- AND the tool can still be saved (runtime will fail)

## MODIFIED Requirements

### REQ-UI-005: Agent Tools Form

**Priority**: P0 (Critical)

The existing agent tools form MUST be extended to support adapter-backed tools.

(Previously: Tools only supported HTTP endpoint configuration)

#### Scenario: Form preserves existing tools

- GIVEN an agent with existing HTTP tools
- WHEN the agent is loaded for editing
- THEN all existing tools are displayed correctly
- AND "Tool Source" for each is set to "HTTP Endpoint"

#### Scenario: Form saves adapter tools

- GIVEN a tool configured with adapter reference
- WHEN the agent is saved
- THEN the tool JSON includes `adapterRef` object
- AND `endpoint` and `method` fields are omitted

## Non-Functional Requirements

### NFR-UI-001: Adapter List Load Time

**Category**: Performance
**Priority**: P2

The adapter list MUST load within 500ms (p95) for up to 100 adapters.

- **Metric**: Time from dropdown click to list display
- **Target**: < 500ms p95
- **Measurement**: Angular Performance profiler or custom timing

### NFR-UI-002: Accessibility

**Category**: Accessibility
**Priority**: P1

The adapter selection UI MUST be fully accessible via keyboard navigation.

- **Metric**: WCAG 2.1 Level AA compliance
- **Target**: All dropdowns and toggles keyboard-accessible
- **Measurement**: Accessibility audit with axe-core