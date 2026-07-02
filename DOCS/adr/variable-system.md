# ADR: Scoped Variable System for Agent/Workflow Platform

**Status**: Partially implemented — Phase 1 (system variables CRUD in `agent-admin-service`, `inputVariables`/`outputVariables` on `IAgentConfig`, `variables` namespace added to `PROMPT_ALLOWED_NAMESPACES` in `TemplateRendererService`, `knowledgeBaseIds` on agent config) is implemented. Variable resolution is further along than a system-only Phase 1: `workflow-service` (`src/temporal/workflows.ts`) builds a full `VariableResolutionContext` with all five scopes — `system` (via `SystemVariablesProvider`), `workflow`, `previous`, `node`, and `request` — updating `previous`/`node` per executed action, and `AgentCallArgs` carries it as an optional `variables` field. The `variableBindings` field on `AgentCallArgs` and Phase 3 (visual canvas wiring, `DATA` connection type) are not implemented. `variable.interfaces.ts` exists in `packages/shared/src/`. Note: the system-variables controller exposes GET/GET:id/POST/DELETE but no update (PUT/PATCH) endpoint.
**Author**: Architect  
**Date**: 2026-06-07

---

## 1. Problem Statement

### What we're solving

Today the platform has three independent variable gaps:

1. **No typed variable declarations.** Agent `systemPrompt` templates resolve `{{agent.x}}` and `{{context.x}}` against a raw `Record<string, unknown>` runtime context, but there is no mechanism for an agent author to _declare_ what variables it expects or produces. Everything is an undocumented string.

2. **No data flow between workflow nodes.** When `Agent A` runs and produces structured output (e.g. a temperature lookup), that output cannot feed into `Agent B`'s input. Workflow connections today are exclusively _control flow_ — "A runs, then B runs." Users must hard-code values or write connector code to bridge steps.

3. **No scoped configuration variables.** There is no place for a tenant admin to define system-wide values (e.g. `companyName`, `defaultLanguage`) that agents across multiple workflows should reference. Similarly, there is no mechanism for workflow-scoped variables (e.g. `maxRetries`, `region`).

### Why this matters

- **Agent reusability.** An agent like "Weather Lookup" should be reusable across workflows _without_ hard-coding city names or API keys into its prompt. Declared inputs make it a composable unit.
- **Workflow expressiveness.** Without data flow wiring, users resort to brittle workarounds — inline JS functions, connector calls, or manual copy-paste.
- **Admin control.** System variables let platform operators change global defaults (branding, compliance text, feature flags) without editing individual agents or workflows.

---

## 2. Scope Model

### Three scopes, one resolution order

| Priority | Scope | Owned by | Lifetime | Example |
|----------|-------|----------|----------|---------|
| 1 (highest) | **Node** | Workflow runtime | Per execution step | `variables.previous.temperature` — the output of the immediately preceding node |
| 2 | **Workflow** | Workflow definition | Per workflow version | `variables.workflow.maxRetries` — defined in the workflow canvas |
| 3 (lowest) | **System** | Tenant admin | Per tenant | `variables.system.companyName` — set once in admin panel |

**Shadowing rule**: A workflow variable named `companyName` shadows a system variable with the same name. Node outputs always take precedence over both.

### Variable lifecycle per scope

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────┐
│ System vars  │────▶│ Workflow vars    │────▶│ Node outputs │
│ (persistent) │     │ (per workflow    │     │ (per exec    │
│ tenant admin │     │  definition)     │     │  step)       │
└──────────────┘     └──────────────────┘     └─────────────┘
    Always               Loaded at              Created at
    available             execution start        runtime
```

---

## 3. Type System

### Chosen approach: Simple enum, NOT JSON Schema

**Decision**: Use a flat enum of primitive types with optional validation constraints. Do NOT adopt JSON Schema for variable declarations.

### Types

| Type | Serialization | UI treatment | Example value |
|------|--------------|--------------|---------------|
| `string` | String | Text input | `"Buenos Aires"` |
| `number` | Number | Number input | `28.5` |
| `boolean` | Boolean | Toggle/checkbox | `true` |
| `json` | Any JSON-serializable | Code editor (monospace) | `{"lat": -34.6, "lng": -58.4}` |
| `array` | JSON array | Tag/chip input | `["email", "push"]` |
| `secret` | String (masked) | Password input + eye toggle | `"sk-abc123..."` |

### Variable declaration shape

```typescript
interface VariableDeclaration {
  name: string;            // e.g. "temperature", "city"
  type: VariableType;      // from enum above
  label?: string;          // human-readable for UI
  description?: string;    // help text / tooltip
  required?: boolean;      // default: true
  defaultValue?: unknown;  // must match type
}
```

### Why not JSON Schema?

| JSON Schema | Simple enum |
|-------------|-------------|
| Correct for validating structured data payloads | Correct for declaring "this agent needs a city name" |
| Heavy tooling footprint in admin UI (schema editor) | Fits the existing `key: value` mental model of node config |
| Overkill for 90% of agent I/O (strings, numbers, booleans) | Covers 100% of current use patterns |
| `json` type still available for complex payloads | `json` gives an escape hatch for structured data |

### Type coercion rules at resolution time

When `agentA.output.temperature` (declared as `number`) is referenced as `{{variables.previous.temperature}}` in a **string** context (e.g. inside a message template), the value is stringified via `String(value)`. When referenced as the **whole value** of a field (e.g. `{{variables.previous.temperature}}` as the entire `args.data` for an endpoint call), the **raw typed value** is passed through — the `number` stays a number.

This matches the existing `TemplateRendererService` behaviour: `renderToolTemplateString` preserves raw values for exact-match placeholders and stringifies for inline placeholders.

---

## 4. Resolution Engine

### Syntax: extending the existing pattern

The current `TemplateRendererService` uses:
- `{{namespace.key.nested}}` for prompts (whitelisted namespaces: `agent`, `context`, `input`, `memory`, `skill`)
- `{{key}}` / `{path.to.key}` for tool configs and args

**Decision**: Add `variables` to the whitelisted prompt namespaces and define a canonical path structure under it:

```
{{variables.<scope>.<variableName>}}
```

Where `<scope>` is one of:

| Scope path | Meaning | Example reference | Resolves to |
|------------|---------|-------------------|-------------|
| `system.<name>` | Tenant-wide system variable | `{{variables.system.companyName}}` | `"Yoizen"` |
| `workflow.<name>` | Workflow-scoped variable | `{{variables.workflow.maxRetries}}` | `3` |
| `previous.<name>` | Output of the immediately preceding executed node | `{{variables.previous.temperature}}` | `28.5` |
| `node.<nodeName>.<name>` | Output of a specific named node in the workflow | `{{variables.node.weatherAgent.humidity}}` | `0.65` |
| `request.<field>` | Field from the workflow execution request payload | `{{variables.request.userId}}` | `"usr_123"` |

### Resolution at runtime

When a workflow execution reaches an `agentCall` step:

```
1. Build resolution context:
   a. Load system variables from system_variables (tenant-scoped)
   b. Load workflow variables from the definition's `variables` field  
   c. Load accumulated node outputs from previous steps (from execution.variableValues)

2. Merge into TemplateState:
   {
     variables: {
       system: { companyName: "Yoizen", ... },
       workflow: { maxRetries: 3, ... },
       previous: { temperature: 28.5, ... },
       node: {
         weatherAgent: { temperature: 28.5, humidity: 0.65 },
         ...
       },
       request: { userId: "usr_123", ... }
     }
   }

3. Resolve templates in agent args (message, context, metadata):
   - {{variables.previous.temperature}} → 28.5
   - {{variables.system.companyName}} → "Yoizen"

4. Dispatch agent call with resolved args

5. After agent completes:
   a. Parse agent response for declared output variables
   b. Store { nodeName: { outputVar: value, ... } } in execution.variableValues
   c. Set "previous" = last node's outputs for next step
```

### Resolution in agent system prompts (agent-ai-service side)

The existing `preparePrompt` in `ChatService` calls `templateRenderer.renderPromptText(agent.systemPrompt, state.runtimeContext, warnings)`. The `runtimeContext` is currently built from `ChatRequest` fields. 

**Change**: The execution handler enriches the payload with `variables: ResolutionContext` before dispatching to `ChatService`, and `ChatService` passes `variables` through to `TemplateState`. The template renderer already handles dot-path traversal — adding `variables` to the state root and adding it to `PROMPT_ALLOWED_NAMESPACES` is all that's needed.

### Caching

System variables change rarely. They are loaded once per execution and cached in the `WorkflowExecutionContext.results` object for the duration of the Temporal workflow run. Workflow variables are loaded from the definition at execution start. Node outputs are stored in-memory on the Temporal workflow object.

**No Redis/global cache needed for Phase 1–2.** The execution scope is the natural cache boundary.

---

## 5. Agent I/O Contract

### Declaring inputs and outputs on an agent

Each agent config gains two new fields:

```typescript
// IAgentConfig (services/agent-ai-service/src/modules/agents/agent-config.repository.interface.ts)
export interface IAgentConfig {
  // ... existing fields ...
  readonly inputVariables: VariableDeclaration[];   // what the agent NEEDS
  readonly outputVariables: VariableDeclaration[];   // what the agent PRODUCES
}
```

**Example — "Weather Lookup" agent:**

```json
{
  "id": "agent-weather",
  "name": "Weather Lookup",
  "systemPrompt": "You are a weather agent. Given a city and a threshold, return current conditions. City: {{variables.workflow.city}}",
  "inputVariables": [
    { "name": "city", "type": "string", "required": true, "description": "City name to look up" },
    { "name": "threshold", "type": "number", "required": false, "defaultValue": 25 }
  ],
  "outputVariables": [
    { "name": "temperature", "type": "number", "description": "Current temperature in Celsius" },
    { "name": "summary", "type": "string", "description": "One-sentence weather summary" },
    { "name": "details", "type": "json", "description": "Full weather payload" }
  ]
}
```

### How outputs are extracted

For **LLM agents** (the `agentCall` activity), the agent's response text is unstructured. The workflow executor needs a way to extract structured output variables from the LLM response. **Phase 1** uses the existing `generateStructuredOutput` path in `LLMExecutorService` to produce a typed JSON response from the agent. The workflow runtime then maps the structured object to declared output variables by name.

**Alternative considered**: Post-processing with regex or a secondary LLM call. Rejected — structured output is already supported in the platform via `generateStructuredOutput` and is more reliable.

For future **non-LLM agents** (e.g. HTTP calls, JS functions), outputs are mapped from the activity's return value.

### Validation at design time

When wiring a data connection on the canvas:
- **Source output type** must be compatible with **target input type**
- `number` → `string` is allowed (widening)
- `json` → `number` is NOT allowed (too ambiguous)
- `secret` → `string` is NOT allowed (security boundary)
- The canvas shows a warning icon on incompatible connections

---

## 6. Workflow Canvas Integration

### What changes in the builder

Currently agent nodes show a config form with fields like `agentId`, `message`, `conversationId`. After this change:

1. **Agent nodes display I/O ports**: When an agent is selected and has declared `inputVariables`/`outputVariables`, the node renders small "pins" on its edges — inputs on top/left, outputs on bottom/right.

2. **Data connections are a new connection type**: Currently connections are only `DEFAULT` (control flow) and `BRANCH`. A new type `DATA` carries a variable name from source to target.

```
// EWorkflowConnectionType (workflow-node.types.ts)
export enum EWorkflowConnectionType {
  DEFAULT = "default",
  BRANCH = "branch",
  DATA = "data",       // NEW
}
```

3. **Data connection shape**:
```typescript
// Added to IWorkflowConnection
interface IDataConnectionMetadata {
  sourceVariable: string;   // output variable name on source node
  targetVariable: string;   // input variable name on target node
}
```

4. **Canvas visualization**:
   - Control flow connections remain solid lines (current behaviour)
   - Data flow connections render as **dashed lines** in a distinct color (e.g. blue)
   - Hovering a data connection shows a tooltip: `weatherAgent.temperature → alertAgent.threshold`

5. **Variable wiring panel**: The node config panel for `AGENT_CALL` nodes gains a "Variables" tab that shows:
   - Declared input variables with their types
   - For each input, a dropdown to select: "manual value" / "workflow variable" / "previous step output"
   - A visual preview of resolved connections

### Serialization to backend

The `FlowSerializer` already converts canvas nodes to backend actions. The changes:

1. `serializeFlow` now includes `dataConnections` in the serialized output
2. The `agentCall` action args reference variables by scope+name rather than literal values when a data connection exists:

```typescript
// Before (current)
args: { agentId: "agent-weather", message: "What's the weather in Buenos Aires?" }

// After (with variables)
args: {
  agentId: "agent-weather",
  message: "What's the weather in {{variables.workflow.city}}?",
  variableBindings: {
    city: { source: "workflow", name: "city" },
    threshold: { source: "previous", name: "threshold" }
  }
}
```

### Data model for the frontend flow

`IWorkflowFlow` gains:
```typescript
interface IWorkflowFlow {
  // ... existing fields ...
  dataConnections: Record<string, IDataConnection>;   // NEW
  variables: VariableDeclaration[];                   // NEW — workflow-scoped vars
}
```

The deserializer (`deserializeFlow`) reconstructs data connections from backend format: `variableBindings` in agent call args are converted back to visual wires on the canvas.

---

## 7. Data Model Changes

### 7a. New collection: `system_variables`

**Collection**: `system_variables` (per-tenant, tenant-scoped Mongo/Postgres)

```typescript
interface ISystemVariableDoc {
  _id: string;              // UUID
  tenant_id: string;        // tenant scope
  name: string;             // e.g. "companyName"
  type: VariableType;       // string | number | boolean | json | array | secret
  value: unknown;           // the actual value (encrypted for secret type)
  label?: string;
  description?: string;
  created_at: Date;
  updated_at: Date;
}
```

**Example document**:
```json
{
  "_id": "sv_01",
  "tenant_id": "tenant-acme",
  "name": "companyName",
  "type": "string",
  "value": "Acme Corp",
  "label": "Company Name",
  "description": "Used in greeting templates across all agents",
  "created_at": "2026-06-01T00:00:00Z",
  "updated_at": "2026-06-01T00:00:00Z"
}
```

**Indexes**:
- `{ tenant_id: 1, name: 1 }` unique — one variable per name per tenant
- `{ tenant_id: 1, type: 1 }` for filtering by type

### 7b. Modified: Agent config (`agents` table / `agent_configs` collection)

Add two columns:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `input_variables` | JSONB / JSON | `[]` | Declared input variables |
| `output_variables` | JSONB / JSON | `[]` | Declared output variables |

### 7c. Modified: Workflow definitions (`workflow_definitions` collection)

Add two fields to `IWorkflowDefinitionRow`:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `variables` | JSON array | `[]` | Workflow-scoped variable declarations |
| `data_connections` | JSON array / object | `{}` | Data flow wiring map |

### 7d. Modified: Workflow executions (`workflow_executions` collection)

Add one field to `IWorkflowExecutionRow`:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `variable_values` | JSON object | `{}` | Resolved variable values at each step, stored for debugging/replay |

Structure:
```json
{
  "variable_values": {
    "weatherAgent": { "temperature": 28.5, "summary": "Sunny" },
    "alertAgent": { "shouldAlert": true },
    "previous": { "shouldAlert": true }
  }
}
```

### 7e. Shared types (`packages/shared/src/`)

New file: `packages/shared/src/variable.interfaces.ts`

Exports all shared types:
- `VariableType`
- `VariableDeclaration`
- `IDataConnection`
- `VariableResolutionContext`

### 7f. Frontend DTO changes

`IWorkflowDefinitionDto` (admin-console):
```typescript
export interface IWorkflowDefinitionDto {
  // ... existing fields ...
  variables: VariableDeclaration[];          // NEW
  dataConnections: Record<string, IDataConnection>;  // NEW
}
```

---

## 8. Implementation Phases

### Phase 1: Foundation — Variable types, system scope, prompt resolution (MVP)

**Goal**: Agents can reference `{{variables.system.x}}` and `{{variables.workflow.x}}` in prompts. Admin can create system variables.

| # | Task | Service(s) | Lines of change |
|---|------|------------|-----------------|
| 1.1 | Add `variable.interfaces.ts` to `@yoizen/shared` | shared | new file |
| 1.2 | Add `inputVariables` / `outputVariables` to `IAgentConfig` | agent-ai-service, agent-admin-service | ~30 |
| 1.3 | Add `variables` to `PROMPT_ALLOWED_NAMESPACES` in `TemplateRendererService` | agent-ai-service | ~5 |
| 1.4 | Create `system_variables` collection + CRUD in `agent-admin-service` | agent-admin-service | ~200 |
| 1.5 | Admin UI: System Variables page (list, create, edit, delete) | admin-console | ~300 |
| 1.6 | Admin UI: Add input/output variable fields to agent editor | admin-console | ~150 |
| 1.7 | Runtime: Enrich `runtimeContext` with resolved variables before prompt rendering | agent-ai-service (execution handler) | ~50 |
| 1.8 | Tests | all affected services | ~200 |

**Deliverable**: An admin can define `system.companyName = "Acme"`, reference `{{variables.system.companyName}}` in an agent prompt, and the runtime resolves it.

### Phase 2: Workflow data flow — Output capture and feed-forward

**Goal**: When Agent A runs in a workflow, its declared output variables are captured and available to downstream Agent B via `{{variables.previous.x}}` and `{{variables.node.X.y}}`.

| # | Task | Service(s) | Lines of change |
|---|------|------------|-----------------|
| 2.1 | Add `variableBindings` to `AgentCallArgs` in shared | shared | ~15 |
| 2.2 | Modify `executeAgentCall` Temporal activity to: (a) resolve input variable bindings before dispatch, (b) capture structured output after, (c) store in execution results | workflow-service, connector-runtime | ~120 |
| 2.3 | Modify `ExecutionHandler` to accept resolved variables in payload and merge into `runtimeContext` | agent-ai-service | ~40 |
| 2.4 | Implement structured output extraction: `generateStructuredOutput` with schema derived from `outputVariables` | agent-ai-service (LLM layer) | ~80 |
| 2.5 | Modify `FlowSerializer` to serialize/deserialize `variableBindings` in agent call args | admin-console | ~60 |
| 2.6 | Add `variableValues` to execution document for debugging | workflow-service | ~40 |
| 2.7 | Tests: end-to-end workflow with variable passing | integration tests | ~300 |

**Deliverable**: A two-agent workflow where "Weather Agent" outputs `temperature` and "Alert Agent" references `{{variables.previous.temperature}}` in its message.

### Phase 3: Full canvas integration — Visual data wiring

**Goal**: Users drag data-flow wires between agent nodes on the canvas. The canvas visualizes both control and data flow.

| # | Task | Service(s) | Lines of change |
|---|------|------------|-----------------|
| 3.1 | Add `DATA` connection type to `EWorkflowConnectionType` | admin-console | ~10 |
| 3.2 | Render I/O pins on agent nodes based on declared variables | admin-console (workflow-node component) | ~150 |
| 3.3 | Enable drag-to-connect for data pins on canvas | admin-console (workflow-builder) | ~200 |
| 3.4 | Variable wiring panel in node config (tab UI, dropdowns for each input) | admin-console (workflow-node-config) | ~250 |
| 3.5 | Visual differentiation: dashed blue lines for data, solid gray for control | admin-console | ~80 |
| 3.6 | Type compatibility validation in wiring UI | admin-console | ~100 |
| 3.7 | Tests | admin-console | ~150 |

**Deliverable**: Full visual data flow wiring in the workflow canvas.

---

## 9. Tradeoffs & Alternatives Considered

### A. `$variable` prefix syntax vs `{{variables.scope.name}}`

| Option | Pros | Cons |
|--------|------|------|
| **A1. `$workflow.city`** | Shorter, familiar (GitHub Actions, Bash) | New parser needed, doesn't compose with existing `{{}}` system, requires escaping in prompts |
| **A2. `{{variables.scope.name}}` (CHOSEN)** | Extends existing template engine, no new parser, same mental model for all templates | Slightly more verbose |

**Why A2 wins**: The platform already has `{{agent.x}}`, `{{context.x}}`, `{{input.x}}`. Adding `{{variables.x}}` is a natural extension. Zero new parsing code.

### B. Where to resolve variables: workflow-service vs agent-ai-service

| Option | Pros | Cons |
|--------|------|------|
| **B1. Resolve in workflow-service (at dispatch time)** | Resolution happens once, agent receives clean input | Workflow-service needs awareness of all variable types; breaks separation of concerns |
| **B2. Resolve in agent-ai-service (at prompt time) (CHOSEN)** | Agent service is the natural boundary, already has TemplateRendererService with namespaces | Slightly more data in NATS payload |

**Why B2 wins**: The `agent-ai-service` already resolves templates for prompts. Moving variable resolution there means the workflow-service only needs to pass along the `variables` context, not understand it. The workflow-service doesn't need to know what a `secret` type is or how to mask it.

### C. Agent output extraction: structured output vs post-hoc parsing

| Option | Pros | Cons |
|--------|------|------|
| **C1. Structured output (CHOSEN)** | Reliable typed extraction, uses existing `generateStructuredOutput` in LLMExecutorService | Requires agent to be configured for structured output |
| **C2. Regex/post-hoc parsing** | Works with any text | Brittle, dependent on prompt wording, unreliable at scale |
| **C3. Secondary LLM call for extraction** | Flexible, works with arbitrary text | Doubles cost and latency |

**Why C1 wins**: `LlmExecutorService.generateStructuredOutput` already exists. For agents that need variable extraction, the system prompt + output schema provide reliable typed outputs. For agents that don't produce structured output (pure chat agents), output variables are simply `null`/absent — which is correct.

### D. System variables: admin-service CRUD vs config-file-based

| Option | Pros | Cons |
|--------|------|------|
| **D1. Database CRUD via admin-service (CHOSEN)** | UI-editable, auditable, fits existing admin API pattern | New collection, new endpoints |
| **D2. Config files (like existing config-files module)** | Reuses existing deploy/sync mechanism | Not user-friendly for quick edits, overengineered for simple key-value pairs |

**Why D1 wins**: System variables are "a few name-value pairs per tenant" — not complex configuration that needs versioning. The `agent-admin-service` already has a CRUD pattern for `agents`, `credentials`, `channels`. System variables follow the same pattern naturally.

### E. What happens when an agent declares variables but is used outside a workflow?

When an agent is called directly (via `/admin/agents/:id/chat` or SDK), there is no workflow context to resolve `{{variables.previous.*}}`. In this case:

- `{{variables.system.*}}` still resolves normally
- `{{variables.workflow.*}}` resolves to `undefined` (the agent's system prompt author should handle defaults)
- `{{variables.previous.*}}` and `{{variables.node.*}}` remain as literal text in the prompt (with a warning logged)
- The caller can pass `context: { variables: { ... } }` in the `ChatRequest` to provide variable overrides

This means **direct agent calls degrade gracefully** — they don't break, they just don't have workflow-scoped data. The agent author should write prompts that work in both contexts.

---

## 10. Naming Convention & Consistency

All references to this system use `variables` (lowercase, plural) as the canonical term:

- Template syntax: `{{variables.*}}`
- API fields: `inputVariables`, `outputVariables`
- DB columns: `input_variables`, `output_variables`
- URL paths: `/admin/system-variables`
- Internal code: `VariableDeclaration`, `VariableType`, `VariableResolutionContext`

No aliases like `vars`, `params`, or `env` — these create confusion with existing concepts in the platform.

---

## Appendix: Files Affected (estimate)

| File | Change |
|------|--------|
| `packages/shared/src/variable.interfaces.ts` | **NEW** — shared types |
| `services/agent-ai-service/src/modules/agents/agent-config.repository.interface.ts` | Add `inputVariables`, `outputVariables` |
| `services/agent-ai-service/src/modules/agents/agent-config.mongo.repository.ts` | Map new fields |
| `services/agent-ai-service/src/modules/agents/agent-config.postgres.repository.ts` | Map new fields |
| `services/agent-ai-service/src/modules/template-renderer/template-renderer.service.ts` | Add `variables` to `PROMPT_ALLOWED_NAMESPACES` |
| `services/agent-ai-service/src/nats-handlers/execution.handler.ts` | Merge variables into payload |
| `services/agent-ai-service/src/modules/llm/llm-executor.service.ts` | Structured output schema from variables |
| `services/agent-admin-service/src/modules/agents/agents.dto.ts` | Add `inputVariables`, `outputVariables` to DTOs |
| `services/agent-admin-service/src/modules/agents/agents.service.ts` | Persist new fields |
| `services/agent-admin-service/src/modules/system-variables/` | **NEW** — system variables CRUD module |
| `services/workflow-service/src/modules/workflows/executions.repository.interface.ts` | Add `variableValues` |
| `services/workflow-service/src/modules/workflows/executions.mongo.repository.ts` | Map `variableValues` |
| `services/workflow-service/src/modules/workflows/workflows.repository.interface.ts` | Add `variables`, `dataConnections` |
| `services/workflow-service/src/temporal/activities.ts` | Resolve variable bindings in agent call activity |
| `services/admin-console/src/app/features/automation/workflows/domain/workflow-node.types.ts` | Add `DATA` connection type, `IDataConnection` |
| `services/admin-console/src/app/features/automation/workflows/domain/flow-serializer.ts` | Serialize/deserialize variable bindings + data connections |
| `services/admin-console/src/app/features/automation/workflows/builder/workflow-builder.component.ts` | Canvas data-flow wiring logic |
| `services/admin-console/src/app/features/automation/workflows/builder/components/workflow-node/` | Render I/O pins |
| `services/admin-console/src/app/features/automation/workflows/builder/components/workflow-node-config/` | Variable wiring panel |
| `services/admin-console/src/app/features/automation/ai/agent-config.component.ts` | Input/output variable editor |
| `services/admin-console/src/app/features/automation/system-variables/` | **NEW** — system variables admin page |
