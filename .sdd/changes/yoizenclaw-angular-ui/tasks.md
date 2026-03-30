# Tasks: YoizenClaw Angular UI

**Total Effort**: 52-68 hours | **Critical Path**: Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5  
**TDD**: Disabled (standard testing approach)

---

## Phase 1: Foundation

*Prerequisites: None. These tasks establish the base infrastructure that all other phases depend on.*

### 1.1 Type Definitions & Models

- [ ] 1.1.1 Create `features/yoizenclaw/models/agent.model.ts` with Agent interfaces and DTOs `[S]`  
  **Acceptance Criteria:**
  - Interfaces: `IAgent` with properties: id, name, description, status, systemPrompt, modelConfig, tools[], channels[], isActive, createdAt, updatedAt, publishedAt
  - DTOs: `ICreateAgentDto` with snake_case properties for backend: name, description, system_prompt, model_config, tools, channels
  - DTOs: `IUpdateAgentDto` with all optional properties plus status and is_active
  - Response interface: `IAgentListResponse` with `{ agents: IAgent[], total: number }` - NOT "items"
  - **Spec Ref:** REQ-YZAGENTS-001, REQ-YZAGENTS-002, REQ-YZAGENTS-005

- [ ] 1.1.2 Create `features/yoizenclaw/models/job.model.ts` with Job, JobExecution interfaces and DTOs `[S]`  
  **Acceptance Criteria:**
  - Interfaces: `IJob` with properties: id, name, description, agentId, schedule (cron string), payload, isActive, lastRun, nextRun, createdAt, updatedAt - NO "status" field, NO "timezone"
  - Interfaces: `IJobExecution` with status (pending|running|success|failed|cancelled), startedAt, completedAt, duration, input, output, error, logs
  - DTOs: `ICreateJobDto` with snake_case: name, description, agent_id, schedule, payload, is_active
  - DTOs: `IUpdateJobDto` with all optional snake_case properties
  - DTOs: `ITriggerJobDto` with event_payload for custom trigger
  - Response interface: `IJobListResponse` with `{ jobs: IJob[], total: number }` - NOT "items"
  - Response interface: `IExecutionListResponse` with `{ executions: IJobExecution[], total: number }` - NOT "items"
  - **Spec Ref:** REQ-YZJOBS-001, REQ-YZJOBS-007

- [ ] 1.1.3 Create `features/yoizenclaw/models/credential.model.ts` with Credential interfaces and DTOs `[S]`  
  **Acceptance Criteria:**
  - Interfaces: `ICredential` with properties: id, name, type ('api_key'|'oauth'|'basic'|'custom'), metadata (Record<string,any>), isEncrypted, isActive, expiresAt, createdAt, updatedAt - NO "value" field (never returned), NO "provider" (use "type")
  - DTOs: `ICreateCredentialDto` with snake_case: name, type, value, metadata, expires_at, is_active - value ONLY in create
  - DTOs: `IUpdateCredentialDto` with optional properties
  - DTOs: `IRotateCredentialDto` with snake_case: new_value, new_expires_at
  - Response interface: `ICredentialListResponse` with `{ credentials: ICredential[], total: number }` - NOT "items"
  - **Spec Ref:** REQ-YZCREDS-001, REQ-YZCREDS-002, REQ-YZCREDS-005

- [ ] 1.1.4 Create `features/yoizenclaw/models/config-file.model.ts` with ConfigFile interfaces and DTOs `[S]`  
  **Acceptance Criteria:**
  - Interfaces: `IConfigFile` with properties: id, name, path, content, format ('yaml'|'json'), version, isActive, createdAt, updatedAt
  - DTOs: `ICreateConfigFileDto` with snake_case: name, path, content, format
  - DTOs: `IUpdateConfigFileDto` with optional properties
  - DTOs: `IDeployConfigFilesDto` with snake_case: delete_paths
  - Response interface: `IConfigFileListResponse` with `{ files: IConfigFile[], total: number }` - NOT "items"
  - **Spec Ref:** REQ-YZCONFIG-001, REQ-YZCONFIG-002

- [ ] 1.1.5 Create `features/yoizenclaw/models/index.ts` barrel export `[XS]`  
  **Acceptance Criteria:**
  - Exports all interfaces and DTOs from agent, job, credential, and config-file models
  - Organized by domain (agents/, jobs/, credentials/, config-files/)

### 1.2 API Service Layer

- [ ] 1.2.1 Create `features/yoizenclaw/agents/services/agent.service.ts` with CRUD operations `[M]`  
  **Acceptance Criteria:**
  - Signals: `agents`, `loading`, `error`, `selectedAgent`
  - Methods: `loadAgents()` - GET `/admin/agents?limit=&offset=` expecting `{ agents: [], total: number }`
  - Methods: `getAgent(id)` - GET `/admin/agents/:id`
  - Methods: `createAgent(dto)` - POST `/admin/agents` with snake_case DTO `{ name, description, system_prompt, model_config, tools, channels }`
  - Methods: `updateAgent(id, dto)` - PUT `/admin/agents/:id` with ALL updates (model_config, tools, etc. together) - NO separate endpoints
  - Methods: `deleteAgent(id)` - DELETE `/admin/agents/:id`
  - Methods: `publishAgent(id)` - POST `/admin/agents/:id/publish`
  - Methods: `unpublishAgent(id)` - POST `/admin/agents/:id/unpublish`
  - Error handling with `NotificationService` toast notifications
  - **Spec Ref:** REQ-YZAGENTS-001..008

- [ ] 1.2.2 Create `features/yoizenclaw/jobs/services/job.service.ts` with CRUD + polling `[M]`  
  **Acceptance Criteria:**
  - Signals: `jobs`, `loading`, `executions`, `pollingActive`
  - Methods: `loadJobs()` - GET `/admin/jobs?limit=&offset=&agent_id=&is_active=` expecting `{ jobs: [], total: number }`
  - Methods: `getJob(id)` - GET `/admin/jobs/:id`
  - Methods: `createJob(dto)` - POST `/admin/jobs` with snake_case DTO `{ name, description, agent_id, schedule, payload, is_active }` - NO "timezone"
  - Methods: `updateJob(id, dto)` - PUT `/admin/jobs/:id`
  - Methods: `deleteJob(id)` - DELETE `/admin/jobs/:id`
  - Methods: `enableJob(id)` - POST `/admin/jobs/:id/enable`
  - Methods: `disableJob(id)` - POST `/admin/jobs/:id/disable`
  - Methods: `runJob(id)` - POST `/admin/jobs/:id/run` - separate endpoint
  - Methods: `triggerJob(id, payload)` - POST `/admin/jobs/:id/trigger` with `{ event_payload }` - separate endpoint
  - Methods: `loadExecutions(jobId)` - GET `/admin/jobs/executions?job_id=:id&limit=&offset=` expecting `{ executions: [], total: number }` - NOT `GET /admin/jobs/:id/executions`
  - Methods: `startPolling()`, `stopPolling()` with exponential backoff (5s → 30s max)
  - Auto-stop polling after 10 minutes or when all executions terminal
  - **Spec Ref:** REQ-YZJOBS-001..008

- [ ] 1.2.3 Create `features/yoizenclaw/credentials/services/credential.service.ts` with CRUD + rotate `[M]`  
  **Acceptance Criteria:**
  - Signals: `credentials`, `loading`
  - Methods: `loadCredentials()` - GET `/admin/credentials?limit=&offset=&type=&is_active=` expecting `{ credentials: [], total: number }`
  - Methods: `getCredential(id)` - GET `/admin/credentials/:id` - response NEVER includes value field
  - Methods: `createCredential(dto)` - POST `/admin/credentials` with snake_case DTO `{ name, type, value, metadata, expires_at, is_active }`
  - Methods: `updateCredential(id, dto)` - PUT `/admin/credentials/:id` - value only included if changing secret
  - Methods: `deleteCredential(id)` - DELETE `/admin/credentials/:id`
  - Methods: `rotateCredential(id, dto)` - PUT `/admin/credentials/:id/rotate` (NOT POST) with `{ new_value, new_expires_at }`
  - **Spec Ref:** REQ-YZCREDS-001..007

- [ ] 1.2.4 Create `features/yoizenclaw/config-files/services/config-file.service.ts` with CRUD + deploy `[M]`  
  **Acceptance Criteria:**
  - Signals: `configFiles`, `loading`, `selectedConfigFile`
  - Methods: `loadConfigFiles()` - GET `/admin/config-files?limit=&offset=` expecting `{ files: [], total: number }`
  - Methods: `getConfigFileByPath(path)` - GET `/admin/config-files/file?path=:path`
  - Methods: `createOrUpdateConfigFile(dto)` - PUT `/admin/config-files` with snake_case DTO `{ name, path, content, format }` - auto-increments version on update
  - Methods: `deleteConfigFile(id)` - DELETE `/admin/config-files/:id`
  - Methods: `deployConfigFiles(deletePaths?)` - POST `/admin/config-files/deploy` with `{ delete_paths }` - emits NATS event
  - **Spec Ref:** REQ-YZCONFIG-001..003

### 1.3 Infrastructure

- [ ] 1.3.1 Create `features/yoizenclaw/interceptors/yoizenclaw.interceptor.ts` for tenant header `[S]`  
  **Acceptance Criteria:**
  - Reads tenant ID from `ConfigService`
  - Injects `x-yoizen-tenant` header on all `/api/yoizenclaw/*` requests
  - Execution order: AuthInterceptor → YoizenClawInterceptor
  - Throws error if tenant ID not configured
  - Does not overwrite existing tenant header (logs warning)
  - **Spec Ref:** REQ-YZINFRA-001

- [ ] 1.3.2 Create `features/yoizenclaw/validators/cron.validator.ts` with cron expression validation `[S]`  
  **Acceptance Criteria:**
  - Validator function: `cronValidator(): ValidatorFn`
  - Validates 5-part cron format
  - Returns `{ invalidCron: true }` error object for invalid input
  - Helper: `isValidCron(expression: string): boolean`
  - **Spec Ref:** REQ-YZJOBS-002

- [ ] 1.3.3 Create `features/yoizenclaw/validators/json.validator.ts` with JSON validation `[XS]`  
  **Acceptance Criteria:**
  - Validator function: `jsonValidator(): ValidatorFn`
  - Validates string is valid JSON
  - Returns `{ invalidJson: true }` error object for invalid input
  - Used for model_config, tools, channels, payload, metadata fields
  - Helper: `isValidJson(value: string): boolean`
  - **Spec Ref:** REQ-YZAGENTS-005 (Model Config), REQ-YZJOBS-002 (Payload), REQ-YZCREDS-002 (Metadata)

- [ ] 1.3.4 Create `features/yoizenclaw/utils/polling.util.ts` with exponential backoff `[S]`  
  **Acceptance Criteria:**
  - Function: `createPoller<T>()` with configurable options
  - Options: `initialInterval`, `maxInterval`, `maxDuration`, `backoffMultiplier`
  - Returns `{ start(): Observable<T>, stop(): void }`
  - Implements exponential backoff (interval * multiplier)
  - Stops when `isCompleteFn()` returns true or maxDuration reached
  - **Spec Ref:** REQ-YZJOBS-008, NFR-008

- [ ] 1.3.5 Create `features/yoizenclaw/utils/mask-secret.util.ts` with secret masking `[XS]`  
  **Acceptance Criteria:**
  - Function: `maskSecret(secret: string): string` → shows `sk-...abcd` format
  - Function: `maskProviderSecret(secret, provider)` with provider-aware masking
  - Handles edge cases: null, short strings (< 8 chars)
  - **Spec Ref:** REQ-YZCREDS-001, NFR-009

### 1.4 Feature Module Scaffolding

- [ ] 1.4.1 Create `features/yoizenclaw/yoizenclaw.routes.ts` with feature-level route configuration `[S]`  
  **Acceptance Criteria:**
  - Routes: `/` → redirect to `agents`, `/agents`, `/jobs`, `/credentials`
  - Child routes for create/edit forms
  - Lazy-loaded standalone components
  - Wildcard route redirects to `/agents`
  - **Spec Ref:** REQ-YZINFRA-003

- [ ] 1.4.2 Create `features/yoizenclaw/agents/agents.routes.ts` with agent sub-routes `[XS]`  
  **Acceptance Criteria:**
  - Routes: `/agents` (list), `/agents/new` (create), `/agents/:id` (edit)
  - Route data: `{ mode: 'create' | 'edit' }`
  - Lazy load components
  - **Spec Ref:** REQ-YZINFRA-002, REQ-YZINFRA-003

- [ ] 1.4.3 Create `features/yoizenclaw/jobs/jobs.routes.ts` with job sub-routes `[XS]`  
  **Acceptance Criteria:**
  - Routes: `/jobs` (list), `/jobs/:id/executions` (executions view)
  - (Create/edit forms to be added in Phase 3)
  - **Spec Ref:** REQ-YZINFRA-003

- [ ] 1.4.4 Create `features/yoizenclaw/credentials/credentials.routes.ts` with credential sub-routes `[XS]`  
  **Acceptance Criteria:**
  - Routes: `/credentials` (list)
  - (Create/edit forms to be added in Phase 4)
  - **Spec Ref:** REQ-YZINFRA-003

- [ ] 1.4.5 Create `features/yoizenclaw/config-files/config-files.routes.ts` with credential sub-routes `[XS]`  
  **Acceptance Criteria:**
  - Routes: `/config-files` (list), `/config-files/edit` (editor)
  - Lazy-loaded standalone components
  - **Spec Ref:** REQ-YZINFRA-003

- [ ] 1.4.6 Create `features/yoizenclaw/index.ts` barrel export `[XS]`  
  **Acceptance Criteria:**
  - Exports routes, models, services for external use

---

## Phase 2: Agents Feature

*Prerequisites: Phase 1 complete. Depends on models, AgentService, and routes.*

### 2.1 Agent List Component

- [ ] 2.1.1 Create `features/yoizenclaw/agents/components/agent-list/agent-list.component.ts` `[M]`  
  **Acceptance Criteria:**
  - Uses shared `DataTableComponent` with custom cell templates
  - Columns: name, description, status (with `StatusBadgeComponent`), model config summary (e.g., "GPT-4 @ 0.7"), last modified, actions
  - Pagination: default 25 items, supports page change events
  - Sorting by name and last modified
  - Empty state: "No agents configured" with "Create First Agent" button
  - Error state: "Failed to load agents" with retry button
  - New Agent button navigates to `/yoizenclaw/agents/new`
  - **Spec Ref:** REQ-YZAGENTS-001

### 2.2 Agent Form Component

- [ ] 2.2.1 Create `features/yoizenclaw/agents/components/agent-form/agent-form.component.ts` - base form `[M]`  
  **Acceptance Criteria:**
  - Reactive Form with fields: name (required), description (optional), system prompt (required textarea), model config (Monaco JSON editor with validation), tools (Monaco JSON array editor), channels (Monaco JSON array editor)
  - Validation: required fields, JSON validity for model_config/tools/channels using jsonValidator
  - Model config structure: `{ model: string, temperature: number, top_p?: number, ... }` - editable as JSON
  - Tools are JSON array of tool objects - editable as JSON via Monaco
  - NO separate "skills" editor - skills are managed via Config Files feature
  - Supports create mode (empty form) and edit mode (populated from route param)
  - Cancel button returns to list
  - Save button calls `AgentService.createAgent()` or `updateAgent()` with snake_case DTO transformation
  - Success: toast + navigate to list
  - Error: inline validation + toast
  - JSON validation error displays inline with line numbers
  - **Spec Ref:** REQ-YZAGENTS-002, REQ-YZAGENTS-003

- [ ] 2.2.2 Add concurrent edit detection to agent form `[S]`  
  **Acceptance Criteria:**
  - On save error with conflict status (409), show dialog: "Agent was modified by another user"
  - Options: "Refresh" (re-loads data), "Overwrite" (forces save)
  - **Spec Ref:** REQ-YZAGENTS-003 (Edge Case - Concurrent Edit)

- [ ] 2.2.3 Add published agent edit restrictions `[S]`  
  **Acceptance Criteria:**
  - When editing published agent and model_config changes (JSON comparison), show confirmation dialog
  - Message: "Changing the model configuration will affect live interactions. Continue?"
  - Require explicit confirmation before saving model_config change
  - **Spec Ref:** REQ-YZAGENTS-003 (Error Case - Published Agent Edit)

### 2.3 Model Config Editor Component

- [ ] 2.3.1 Create `features/yoizenclaw/agents/components/model-config-editor/model-config-editor.component.ts` with Monaco integration `[M]`  
  **Acceptance Criteria:**
  - Reusable Monaco-based JSON editor component
  - Lazy-loads `@monaco-editor/loader` on component init
  - Shows skeleton loader while Monaco downloads (~1MB)
  - Initializes editor with JSON language mode and schema validation
  - Sets value from `initialConfig` input (JSON string or object)
  - Tracks dirty state (unsaved changes indicator)
  - Save button emits `saveConfig` event with validated JSON
  - Validate button checks JSON validity and shows errors
  - **Spec Ref:** REQ-YZAGENTS-005

- [ ] 2.3.2 Add Monaco fallback to textarea `[XS]`  
  **Acceptance Criteria:**
  - If Monaco load fails (catch error), render `<textarea>` fallback
  - Warning message: "Advanced editor unavailable. Using basic mode."
  - Textarea supports same JSON content
  - Save still works via textarea value
  - ARIA label: "Model Configuration (JSON)"
  - **Spec Ref:** REQ-YZAGENTS-005 (Error Case), NFR-006

### 2.4 Tools Editor Component

- [ ] 2.4.1 Create `features/yoizenclaw/agents/components/tools-editor/tools-editor.component.ts` `[M]`  
  **Acceptance Criteria:**
  - Reuses Model Config Editor component for tools array JSON
  - Edit tools as JSON array of tool objects
  - Tool structure: `{ name: string, description: string, parameters: object }`
  - JSON validation ensures valid tool structure
  - Emits `saveTools` event with validated array
  - **Spec Ref:** REQ-YZAGENTS-006

### 2.5 Agent Dialogs

- [ ] 2.5.1 Create `features/yoizenclaw/agents/components/agent-delete-dialog/agent-delete-dialog.component.ts` `[S]`  
  **Acceptance Criteria:**
  - Draft agent: simple confirmation dialog
  - Published agent: warning dialog + require typing agent name to confirm
  - Message: "This agent is published. Deleting will stop all active interactions."
  - Error case: if agent has jobs, show "Cannot delete: Agent is used by N jobs"
  - List associated job names
  - **Spec Ref:** REQ-YZAGENTS-004

- [ ] 2.5.2 Create `features/yoizenclaw/agents/components/agent-publish-dialog/agent-publish-dialog.component.ts` `[S]`  
  **Acceptance Criteria:**
  - Publish: confirmation dialog "Publish 'Agent Name'? This will make it available for jobs."
  - Unpublish: warning if agent has enabled jobs
  - Message: "This agent is used by N enabled jobs. Unpublishing will disable them."
  - List affected jobs
  - Validation errors before publish: "Skills configuration required", "At least one tool recommended"
  - **Spec Ref:** REQ-YZAGENTS-007

### 2.6 Agent Status Visualization

- [ ] 2.6.1 Add status badges to agent list `[XS]`  
  **Acceptance Criteria:**
  - Uses shared `StatusBadgeComponent` with color mapping:
    - "draft" → gray
    - "published" → green
    - "archived" → orange
  - Updates in real-time after publish/unpublish operations
  - **Spec Ref:** REQ-YZAGENTS-008

---

## Phase 3: Jobs Feature

*Prerequisites: Phase 1 and Phase 2 (for agent selection dropdown). Depends on JobService.*

### 3.1 Job List Component

- [ ] 3.1.1 Create `features/yoizenclaw/jobs/components/job-list/job-list.component.ts` `[M]`  
  **Acceptance Criteria:**
  - Uses shared `DataTableComponent`
  - Columns: name, associated agent, schedule (cron expression), isActive (enabled/disabled boolean), last run, next run - NO "status" string
  - Filter by agent_id and is_active
  - Pagination (25 items per page)
  - Never-run jobs show "Never" in last run column
  - Invalid cron expressions show "Invalid schedule" in red with edit link
  - Enable/Disable toggle switch per row (calls `JobService.enableJob/disableJob`)
  - "Run Now" button calls `JobService.runJob()` with confirmation
  - "Trigger with Payload" button opens dialog for custom payload and calls `JobService.triggerJob()`
  - "Executions" button navigates to executions view
  - **Spec Ref:** REQ-YZJOBS-001, REQ-YZJOBS-005, REQ-YZJOBS-006

- [ ] 3.1.2 Add cron helper dialog `[S]`  
  **Acceptance Criteria:**
  - Helper icon next to schedule (cron expression) column
  - Click opens dialog with common patterns:
    - "Every hour" → `0 * * * *`
    - "Daily at 9am" → `0 9 * * *`
    - "Weekly on Monday" → `0 9 * * 1`
  - Selecting pattern fills the schedule field (used in create/edit forms)
  - **Spec Ref:** REQ-YZJOBS-002

### 3.2 Job Form Component

- [ ] 3.2.1 Create `features/yoizenclaw/jobs/components/job-form/job-form.component.ts` `[M]`  
  **Acceptance Criteria:**
  - Reactive Form: name (required), description (optional), agent dropdown (shows all agents), schedule (required cron expression), payload (optional JSON editor), isActive (boolean toggle)
  - Agent dropdown shows all agents (draft and published) - draft selection shows warning
  - NO "timezone" field - backend doesn't support it
  - Cron validation using `cronValidator()` - inline error for invalid format: "Invalid cron expression. Format: * * * * *"
  - Cron helper button opens cheat sheet dialog
  - Payload is JSON editor for optional custom data `{ event_payload }`
  - Draft agent selection shows warning: "Selected agent is not published. Job will be disabled until agent is published."
  - Save calls `JobService.createJob()` or `updateJob()` with snake_case DTO: `{ name, description, agent_id, schedule, payload, is_active }`
  - On success: toast + return to list
  - **Spec Ref:** REQ-YZJOBS-002, REQ-YZJOBS-003

- [ ] 3.2.2 Add agent change confirmation `[XS]`  
  **Acceptance Criteria:**
  - When editing enabled job and agent changes, show confirmation:
    "Changing the agent will apply to the next scheduled run. Continue?"
  - **Spec Ref:** REQ-YZJOBS-003 (Edge Case)

### 3.3 Job Delete Dialog

- [ ] 3.3.1 Create `features/yoizenclaw/jobs/components/job-delete-dialog/job-delete-dialog.component.ts` `[S]`  
  **Acceptance Criteria:**
  - Disabled job: simple confirmation
  - Job with execution history: warning with count
  - Message: "Job and all N execution records will be permanently deleted."
  - Confirmation required
  - Note: execution logs retained in audit log
  - **Spec Ref:** REQ-YZJOBS-004

### 3.4 Executions List Component

- [ ] 3.4.1 Create `features/yoizenclaw/jobs/components/executions-list/executions-list.component.ts` `[M]`  
  **Acceptance Criteria:**
  - Table with: execution ID, start time, end time, duration, status, actions
  - Status column uses `StatusBadgeComponent` (pending, running, success, failed, cancelled)
  - Running executions show elapsed time (updating every second)
  - Cancel button for executions running > 5 minutes
  - Click row opens execution detail (modal or expand)
  - Detail shows: full log, input parameters, output/result, error message (if failed)
  - Copy-to-clipboard for logs
  - **Spec Ref:** REQ-YZJOBS-007

### 3.5 Execution Polling Mechanism

- [ ] 3.5.1 Implement polling in `ExecutionsListComponent` `[S]`  
  **Acceptance Criteria:**
  - On init: identify pending/running executions
  - Start polling via `JobService.startPolling()` (5s interval)
  - Display "Live updates" indicator when polling active
  - Stop polling when all executions reach terminal state (success/failed/cancelled)
  - **Spec Ref:** REQ-YZJOBS-008

- [ ] 3.5.2 Add exponential backoff to polling `[S]`  
  **Acceptance Criteria:**
  - After 5 minutes running, increase interval: 5s → 10s → 15s → max 30s
  - Auto-stop polling after 10 minutes total
  - **Spec Ref:** REQ-YZJOBS-008 (Edge Case - Polling Overhead)

- [ ] 3.5.3 Add polling failure recovery `[S]`  
  **Acceptance Criteria:**
  - After 3 consecutive poll failures: show "Live updates paused. Reconnecting..."
  - Retry with exponential backoff
  - Provide "Refresh Now" button for manual update
  - Resume normal polling when connection restored
  - Show "Live updates resumed" toast
  - **Spec Ref:** REQ-YZJOBS-008 (Error Case - Polling Failure), NFR-008

---

## Phase 4: Config Files Feature

*Prerequisites: Phase 1. Depends on ConfigFileService. This is where skills/prompts are stored as YAML/JSON files.*

### 4.1 Config File List Component

- [ ] 4.1.1 Create `features/yoizenclaw/config-files/components/config-file-list/config-file-list.component.ts` `[M]`  
  **Acceptance Criteria:**
  - Uses shared `DataTableComponent`
  - Columns: name, path, format (yaml/json badge), version, isActive, last modified
  - Pagination (25 items per page)
  - Filter by format and is_active
  - Empty state: "No configuration files" + "Create Config File" button
  - "Edit" button navigates to editor
  - "Deploy" button calls `ConfigFileService.deployConfigFiles()`
  - **Spec Ref:** REQ-YZCONFIG-001

### 4.2 Config File Editor Component

- [ ] 4.2.1 Create `features/yoizenclaw/config-files/components/config-file-editor/config-file-editor.component.ts` with Monaco `[M]`  
  **Acceptance Criteria:**
  - Monaco editor with YAML/JSON language mode based on selected format
  - Form fields: name, path (e.g., "/skills/greeting.yaml"), format selector (yaml/json), content editor
  - Syntax validation for selected format
  - Save button calls `ConfigFileService.createOrUpdateConfigFile()`
  - On save success: show version number incremented toast
  - Monaco fallback to textarea if load fails
  - **Spec Ref:** REQ-YZCONFIG-002

### 4.3 Config File Deploy Dialog

- [ ] 4.3.1 Create `features/yoizenclaw/config-files/components/config-file-deploy-dialog/config-file-deploy-dialog.component.ts` `[S]`  
  **Acceptance Criteria:**
  - Confirmation dialog: "Deploy all active configuration files to runtime?"
  - Option: delete_paths for files to remove from runtime
  - Calls `ConfigFileService.deployConfigFiles()`
  - Progress indicator during deployment
  - Success: "Configuration deployed successfully. Runtime will sync."
  - **Spec Ref:** REQ-YZCONFIG-003

---

## Phase 5: Credentials Feature

*Prerequisites: Phase 1. Depends on CredentialService.*

### 5.1 Credential List Component

- [ ] 5.1.1 Create `features/yoizenclaw/credentials/components/credential-list/credential-list.component.ts` `[M]`  
  **Acceptance Criteria:**
  - Uses shared `DataTableComponent`
  - Columns: name, type (api_key/oauth/basic/custom badge), isActive (boolean), created date, expiresAt, actions - NO "provider", NO "status"
  - Backend NEVER returns value - no masking needed in UI, just don't show it
  - Filter by type and is_active
  - Empty state: "No credentials configured" + "Add Credential" button + documentation link
  - **Spec Ref:** REQ-YZCREDS-001, NFR-009

### 5.2 Credential Form Component

- [ ] 5.2.1 Create `features/yoizenclaw/credentials/components/credential-form/credential-form.component.ts` `[M]`  
  **Acceptance Criteria:**
  - Type selection dropdown (api_key, oauth, basic, custom) triggers dynamic metadata fields
  - Common fields: name (required), value (password input with visibility toggle - only for create/edit value), metadata (JSON editor), expiresAt (optional date), isActive (toggle)
  - API Key type: metadata includes provider name (openai, anthropic, etc.), model settings
  - OAuth type: metadata includes client_id, token_url, scope
  - Basic type: metadata includes username
  - Custom type: free-form metadata JSON
  - Save calls `CredentialService.createCredential()` or `updateCredential()` with snake_case DTO
  - **Spec Ref:** REQ-YZCREDS-002, REQ-YZCREDS-006

- [ ] 4.2.2 Add credential name conflict validation `[XS]`  
  **Acceptance Criteria:**
  - On blur or submit, check for duplicate name
  - Error: "Credential name must be unique"
  - **Spec Ref:** REQ-YZCREDS-002 (Edge Case)

- [ ] 4.2.3 Add revoked credential edit handling `[XS]`  
  **Acceptance Criteria:**
  - When editing revoked credential, show warning:
    "This credential is revoked. Changes will not affect active usage."
  - Secret field disabled/grayed out
  - **Spec Ref:** REQ-YZCREDS-003

### 4.3 Credential Delete Dialog

- [ ] 4.3.1 Create `features/yoizenclaw/credentials/components/credential-delete-dialog/credential-delete-dialog.component.ts` `[S]`  
  **Acceptance Criteria:**
  - Unused credential: simple confirmation
  - In-use credential: error message with list of using agents
  - Message: "Cannot delete: Used by N agents. Reassign agents first."
  - **Spec Ref:** REQ-YZCREDS-004

### 4.4 Rotate Dialog Component

- [ ] 5.4.1 Create `features/yoizenclaw/credentials/components/rotate-dialog/rotate-dialog.component.ts` `[M]`  
  **Acceptance Criteria:**
  - Dialog shows current credential info (type and name only - value never shown)
  - Input field for new credential value
  - Expires at date picker for new credential
  - Confirm button calls `CredentialService.rotateCredential()` with PUT `/admin/credentials/:id/rotate` (NOT POST)
  - Progress indicator: "Rotation in progress..."
  - Success: "Credential rotated successfully"
  - Failure: "Rotation failed" + keep old key active
  - **Spec Ref:** REQ-YZCREDS-005

- [ ] 4.4.2 Add grace period countdown display `[S]`  
  **Acceptance Criteria:**
  - When credential has `expiresAt` (grace period), show countdown in list
  - Badge: "expiring" (orange) with time remaining
  - Auto-revoke visual indication after 24h
  - **Spec Ref:** REQ-YZCREDS-005 (Edge Case), REQ-YZCREDS-007

- [ ] 4.4.3 Add concurrent rotation detection `[XS]`  
  **Acceptance Criteria:**
  - If rotation API returns conflict (409), show:
    "Rotation in progress by another user. Please wait."
  - Poll for completion status
  - **Spec Ref:** REQ-YZCREDS-005 (Error Case)

### 4.5 Credential Status Tracking

- [ ] 4.5.1 Add status badges to credential list `[XS]`  
  **Acceptance Criteria:**
  - Color mapping:
    - "active" → green badge
    - "revoked" → red badge
    - "expiring" → orange badge with countdown
  - Updates after rotation
  - **Spec Ref:** REQ-YZCREDS-007

---

## Phase 5: Integration & Polish

*Prerequisites: Phases 1-4 complete. Wiring everything together.*

### 5.1 Routing & Navigation

- [ ] 5.1.1 Modify `app.routes.ts` to add `/yoizenclaw` lazy-loaded route `[XS]`  
  **Acceptance Criteria:**
  - Route: `path: 'yoizenclaw'` with `loadChildren` pointing to yoizenclaw.routes.ts
  - Lazy-loaded on navigation
  - **Spec Ref:** REQ-YZINFRA-003

- [ ] 5.1.2 Modify `layout/sidebar/sidebar.component.ts` to activate YoizenClaw section `[XS]`  
  **Acceptance Criteria:**
  - Update existing YoizenClaw route entry to use new component structure
  - Submenu: Agents, Jobs, Credentials
  - Active route highlighting works
  - Feature flag controlled (already exists)
  - **Spec Ref:** REQ-YZINFRA-004

### 5.2 Error Handling & Feedback

- [ ] 5.2.1 Implement global error handling for YoizenClaw operations `[S]`  
  **Acceptance Criteria:**
  - All services use `NotificationService` for toasts
  - Success toasts: green checkmark, brief message
  - Error toasts: red X, descriptive message, retry option where applicable
  - Unhandled errors caught in global handler with user-friendly message
  - Full error details logged for debugging
  - **Spec Ref:** REQ-YZINFRA-005

- [ ] 5.2.2 Add loading states to all components `[S]`  
  **Acceptance Criteria:**
  - List views show skeleton/table loading state while `loading()` signal is true
  - Form save buttons show spinner during submission
  - Monaco editor shows skeleton while loading
  - Disable interactions during loading
  - **NFR:** UX consistency

- [ ] 5.2.3 Add empty states to all list views `[S]`  
  **Acceptance Criteria:**
  - Agents empty: "No agents configured" + "Create First Agent" button
  - Jobs empty: "No jobs scheduled" + "Create First Job" button
  - Credentials empty: "No credentials configured" + "Add Credential" button + docs link
  - Illustrations/icons for empty states
  - **Spec Ref:** REQ-YZAGENTS-001, REQ-YZJOBS-001, REQ-YZCREDS-001

### 5.3 Accessibility

- [ ] 5.3.1 Implement keyboard navigation `[S]`  
  **Acceptance Criteria:**
  - All interactive elements reachable via Tab key
  - Visible focus indicators (outline/border)
  - Enter/Space activates buttons
  - Logical tab order through forms and dialogs
  - **Spec Ref:** NFR-004

- [ ] 5.3.2 Add ARIA labels and screen reader support `[S]`  
  **Acceptance Criteria:**
  - All form fields have associated labels
  - Required fields announced as required
  - Validation errors announced via ARIA live regions
  - Status changes announced (polite for non-critical, assertive for errors)
  - Modal dialogs trap focus
  - Focus returns to trigger element on dialog close
  - **Spec Ref:** NFR-005

- [ ] 5.3.3 Verify color contrast compliance `[XS]`  
  **Acceptance Criteria:**
  - All text meets WCAG AA 4.5:1 contrast ratio
  - UI components meet 3:1 contrast ratio
  - Status badges readable
  - **Spec Ref:** NFR-007

### 5.4 Testing

- [ ] 5.4.1 Write unit tests for services `[M]`  
  **Acceptance Criteria:**
  - `AgentService`: test loadAgents, createAgent, error handling, signal updates
  - `JobService`: test polling start/stop, enable/disable, trigger
  - `CredentialService`: test rotate, masking, error cases
  - Mock `HttpClient` and `NotificationService`
  - Verify tenant header presence in requests
  - **NFR:** Quality assurance

- [ ] 5.4.2 Write unit tests for validators `[S]`  
  **Acceptance Criteria:**
  - `cronValidator`: test valid/invalid cron expressions, edge cases
  - `api-key.validator`: test OpenAI, Anthropic, Azure formats
  - Test null/empty handling
  - **Spec Ref:** REQ-YZJOBS-002, REQ-YZCREDS-002

- [ ] 5.4.3 Write component tests for forms `[M]`  
  **Acceptance Criteria:**
  - `AgentFormComponent`: test validation (temperature range, required fields), submit emission
  - `JobFormComponent`: test cron validation, agent selection
  - `CredentialFormComponent`: test provider-specific fields, secret validation
  - Mock services, use `ReactiveFormsModule`
  - **Spec Ref:** REQ-YZAGENTS-002, REQ-YZJOBS-002, REQ-YZCREDS-002

- [ ] 5.4.4 Write component tests for complex components `[M]`  
  **Acceptance Criteria:**
  - `ModelConfigEditorComponent`: test Monaco JSON editing, fallback to textarea
  - `ConfigFileEditorComponent`: test YAML/JSON editing, validation
  - `ExecutionsListComponent`: test polling lifecycle, status display
  - `RotateDialogComponent`: test rotation flow with PUT endpoint
  - **Spec Ref:** REQ-YZAGENTS-005, REQ-YZCONFIG-002, REQ-YZJOBS-007, REQ-YZCREDS-005

- [ ] 5.4.5 Add dependency and update configuration `[XS]`  
  **Acceptance Criteria:**
  - Add `@monaco-editor/loader` to `package.json` dependencies
  - Verify version compatibility with Angular 21
  - **Spec Ref:** NFR-002

---

## Task Summary

| Phase | Tasks | Effort | Focus Area |
|-------|-------|--------|------------|
| Phase 1: Foundation | 14 | 16-20 hrs | Models, services, infrastructure |
| Phase 2: Agents | 10 | 16-20 hrs | Agent CRUD, model config/tools editors |
| Phase 3: Jobs | 8 | 12-16 hrs | Job CRUD, run/trigger, executions, polling |
| Phase 4: Config Files | 3 | 6-8 hrs | Skills/prompts management as YAML/JSON files |
| Phase 5: Credentials | 5 | 8-10 hrs | Credentials with type/metadata, rotation workflow |
| Phase 6: Integration | 9 | 12-16 hrs | Routing, polish, testing |
| **Total** | **49** | **58-72 hrs** | |

## Critical Path

The minimum sequence for a working feature:

1. **Foundation** (all tasks) → Models and services must exist before components
2. **Agent List + Form** (2.1, 2.2.1) → Basic agent management
3. **Job List + Form** (3.1, 3.2.1) → Jobs need agents for selection
4. **Executions List** (3.4) → Job runs need execution view
5. **Config Files** (4.1, 4.2.1) → Skills/prompts storage
6. **Credentials** (5.1, 5.2.1) → Can parallel with jobs/config after foundation
7. **Routing + Sidebar** (6.1.x) → Wire everything together
8. **Testing** (6.4.x) → Quality gate before completion

## Parallelizable Work

After Phase 1 is complete, these can proceed in parallel:

- **Stream A**: Agents (2.1 - 2.6) → Independent of jobs/config/credentials
- **Stream B**: Jobs List + Form (3.1 - 3.3) → Needs agents for dropdown
- **Stream C**: Config Files (4.1 - 4.3) → Independent of agents/jobs/credentials
- **Stream D**: Credentials (5.1 - 5.3) → Independent of agents/jobs/config
- **Stream E**: Utilities testing (6.4.2) → Pure functions, no dependencies

## Implementation Recommendations

1. **Start with Phase 1** - All other work depends on these foundations
2. **Agents first** - Most complex UI (Monaco JSON editors for model config and tools)
3. **Jobs second** - Builds on agents, adds polling complexity, separate run vs trigger
4. **Config Files third** - Skills/prompts as YAML/JSON files with Monaco editor
5. **Credentials fourth** - Type-based credentials with metadata JSON
6. **End with integration** - Routing, sidebar, comprehensive testing
7. **Test continuously** - Write component tests as you build each component

## Traceability Matrix

| Task | Spec Requirement | Priority |
|------|-----------------|----------|
| 1.1.1 | REQ-YZAGENTS-001, 002, 005 | P0 |
| 1.1.2 | REQ-YZJOBS-001, 007 | P0 |
| 1.1.3 | REQ-YZCREDS-001, 002, 005 | P0 |
| 1.1.4 | REQ-YZCONFIG-001, 002 | P1 |
| 1.1.5 | Models barrel export | - |
| 1.2.1 | REQ-YZAGENTS-001..008 | P0 |
| 1.2.2 | REQ-YZJOBS-001..008 | P0 |
| 1.2.3 | REQ-YZCREDS-001..007 | P0 |
| 1.2.4 | REQ-YZCONFIG-001..003 | P1 |
| 1.3.1 | REQ-YZINFRA-001 | P0 |
| 1.3.2 | REQ-YZJOBS-002 | P0 |
| 1.3.3 | REQ-YZAGENTS-005, REQ-YZJOBS-002, REQ-YZCREDS-002 | P0 |
| 1.3.4 | REQ-YZJOBS-008, NFR-008 | P1 |
| 1.3.5 | REQ-YZCREDS-001, NFR-009 | P0 |
| 2.1.1 | REQ-YZAGENTS-001 | P0 |
| 2.2.1 | REQ-YZAGENTS-002, 003 | P0 |
| 2.3.1 | REQ-YZAGENTS-005 | P0 |
| 2.3.2 | REQ-YZAGENTS-005, NFR-006 | P0 |
| 2.4.1 | REQ-YZAGENTS-006 | P1 |
| 2.5.1 | REQ-YZAGENTS-004 | P1 |
| 2.5.2 | REQ-YZAGENTS-007 | P0 |
| 3.1.1 | REQ-YZJOBS-001, 005, 006 | P0 |
| 3.2.1 | REQ-YZJOBS-002, 003 | P0 |
| 3.4.1 | REQ-YZJOBS-007 | P0 |
| 3.5.1 | REQ-YZJOBS-008 | P1 |
| 4.1.1 | REQ-YZCONFIG-001 | P1 |
| 4.2.1 | REQ-YZCONFIG-002 | P1 |
| 4.3.1 | REQ-YZCONFIG-003 | P1 |
| 5.1.1 | REQ-YZCREDS-001, NFR-009 | P0 |
| 5.2.1 | REQ-YZCREDS-002, 006 | P0 |
| 5.4.1 | REQ-YZCREDS-005 | P0 |
| 6.1.1 | REQ-YZINFRA-003 | P0 |
| 6.1.2 | REQ-YZINFRA-004 | P1 |
| 6.3.x | NFR-004, 005, 007 | P0/P1 |

## Definition of Done (Per Task)

1. Code written and saved to specified file path
2. Implementation matches relevant spec scenarios
3. Code follows design decisions (signals, reactive forms, etc.)
4. Linting passes (no `any` types, strict mode compliant)
5. Task marked `[x]` in this document
6. For UI tasks: visual verification in browser
7. For service tasks: unit tests pass

## Next Step

Ready for implementation via `sdd-apply`. Begin with Phase 1 tasks in order.
