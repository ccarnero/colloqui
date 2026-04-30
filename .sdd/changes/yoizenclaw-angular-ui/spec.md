# yoizenclaw-angular-ui Specification

## Document Information

| Attribute | Value |
|-----------|-------|
| **Change** | yoizenclaw-angular-ui |
| **Type** | Full Specification (New Domain) |
| **Based on Proposal** | proposal.md (M-size change) |
| **Domains** | yoizenclaw/agents, yoizenclaw/jobs, yoizenclaw/credentials, yoizenclaw/config-files, yoizenclaw/infrastructure |

---

# Domain: yoizenclaw/agents

## Purpose
Agent management domain for creating, configuring, and deploying AI agents within the admin-console.

## ADDED Requirements

### REQ-YZAGENTS-001: Agent List View

**Priority**: P0 (Critical)

The system SHALL display a paginated list of all agents for the current tenant.

**Scenario: Happy Path - View Agent List**

- GIVEN the operator navigates to `/yoizenclaw/agents`
- WHEN the page loads
- THEN the system SHALL fetch agents via `GET /admin/agents` with tenant header
- AND display them in a data-table with columns: name, description, status (draft/published/archived), model config summary, last modified
- AND support pagination (default 25 items per page)
- AND support filtering by status
- AND display response format: `{ agents: Agent[], total: number }`

**Scenario: Edge Case - Empty State**

- GIVEN no agents exist for the tenant
- WHEN the page loads
- THEN the system SHALL display an empty state message "No agents configured"
- AND provide a "Create First Agent" button linking to the create form

**Scenario: Error Case - API Failure**

- GIVEN the agents API is unavailable
- WHEN the page attempts to load
- THEN the system SHALL display an error toast: "Failed to load agents"
- AND provide a "Retry" button to re-fetch
- AND log the error via the logging service

---

### REQ-YZAGENTS-002: Agent Create Operation

**Priority**: P0 (Critical)

The system SHALL allow operators to create new agents with required configuration fields.

**Scenario: Happy Path - Create Agent**

- GIVEN the operator clicks "New Agent" button
- WHEN they fill the form with: name (required), description (optional), system prompt (required textarea), model config (JSON object with model name, temperature, etc.)
- AND click "Create"
- THEN the system SHALL validate all required fields
- AND POST to `/admin/agents` with the payload: `{ name, description, system_prompt, model_config, tools, channels }`
- AND navigate to the agent detail/edit view on success
- AND display a success toast: "Agent created successfully"

**Scenario: Edge Case - Duplicate Name**

- GIVEN an agent named "Support Bot" already exists
- WHEN the operator attempts to create another agent with the same name
- THEN the system SHALL display a validation error: "Agent name must be unique"
- AND prevent form submission

---

### REQ-YZAGENTS-003: Agent Edit Operation

**Priority**: P0 (Critical)

The system SHALL allow operators to modify existing agent configurations.

**Scenario: Happy Path - Edit Agent**

- GIVEN the operator clicks "Edit" on an agent row
- WHEN they modify any editable field (name, description, system_prompt, model_config, tools, channels)
- AND click "Save"
- THEN the system SHALL PUT to `/admin/agents/{id}` with the update DTO
- AND show a success toast on completion
- AND update the list view on return

**Scenario: Edge Case - Concurrent Edit Conflict**

- GIVEN another operator modified the agent while current user had the edit form open
- WHEN the current user attempts to save
- THEN the system SHALL detect the version conflict (via updated_at mismatch or 409 error)
- AND display: "Agent was modified by another user. Refresh to see changes."
- AND provide "Refresh" and "Overwrite" options

**Scenario: Error Case - Published Agent Edit Restrictions**

- GIVEN the agent is in "published" status
- WHEN the operator attempts to change the model configuration
- THEN the system SHALL display a warning dialog
- AND require explicit confirmation: "Changing the model will affect live interactions. Continue?"

---

### REQ-YZAGENTS-004: Agent Delete Operation

**Priority**: P1 (High)

The system SHALL allow operators to delete agents with appropriate safeguards.

**Scenario: Happy Path - Delete Draft Agent**

- GIVEN an agent with "draft" status
- WHEN the operator clicks "Delete" and confirms
- THEN the system SHALL DELETE to `/admin/agents/{id}`
- AND remove the agent from the list
- AND display success toast

**Scenario: Edge Case - Delete Published Agent**

- GIVEN an agent with "published" status
- WHEN the operator clicks "Delete"
- THEN the system SHALL display a warning dialog: "This agent is published. Deleting will stop all active interactions."
- AND require typing the agent name to confirm deletion

**Scenario: Error Case - Agent Has Active Jobs**

- GIVEN the agent is associated with one or more jobs
- WHEN the operator attempts to delete
- THEN the system SHALL display error: "Cannot delete: Agent is used by 3 jobs. Reassign or delete jobs first."
- AND list the associated job names

---

### REQ-YZAGENTS-005: Model Configuration Editor

**Priority**: P0 (Critical)

The system SHALL provide a UI for editing agent model configuration in JSON format.

**Scenario: Happy Path - Edit Model Config**

- GIVEN the operator navigates to the Model Config tab in agent edit view
- WHEN the Monaco editor loads (lazy-loaded on tab activation)
- THEN the system SHALL display the current model_config JSON
- AND provide syntax highlighting and validation
- AND allow editing of model parameters (model name, temperature, top_p, etc.)

**Scenario: Happy Path - Save Model Config**

- GIVEN the operator has edited the model configuration
- WHEN they click "Save"
- THEN the system SHALL validate the JSON syntax
- AND PUT the update to `/admin/agents/{id}` with the new model_config
- AND display success or error feedback

**Scenario: Edge Case - Invalid JSON**

- GIVEN the operator enters malformed JSON
- WHEN they attempt to save
- THEN the system SHALL highlight syntax errors in the editor
- AND display an error message
- AND prevent saving until fixed

**Scenario: Error Case - Monaco Load Failure**

- GIVEN the Monaco editor fails to load (network error)
- WHEN the Model Config tab is activated
- THEN the system SHALL fall back to a standard textarea
- AND display a warning: "Advanced editor unavailable. Using basic mode."
- AND still allow editing and saving

---

### REQ-YZAGENTS-006: Tools Configuration Editor

**Priority**: P1 (High)

The system SHALL provide a UI for configuring agent tools (function calling capabilities).

**Scenario: Happy Path - Edit Tools**

- GIVEN the operator is on the Tools tab
- WHEN they edit the tools array via JSON editor or form interface
- THEN the system SHALL display the current tools configuration (array of tool objects)
- AND validate tool structure (name, description, parameters schema)
- AND on save, PUT to `/admin/agents/{id}` with the updated tools array

**Scenario: Edge Case - Tool Limit**

- GIVEN the agent has many tools configured
- WHEN the tools configuration grows large
- THEN the system SHALL provide JSON editor for efficient bulk editing
- AND validate JSON structure before saving

---

### REQ-YZAGENTS-007: Publish Workflow

**Priority**: P0 (Critical)

The system SHALL support publishing agents to make them available for use.

**Scenario: Happy Path - Publish Agent**

- GIVEN an agent in "draft" status with valid configuration
- WHEN the operator clicks "Publish"
- THEN the system SHALL POST to `/admin/agents/{id}/publish`
- AND display a confirmation dialog: "Publish 'Agent Name'? This will make it available for jobs."
- AND on confirmation, update status to "published"
- AND show success toast

**Scenario: Happy Path - Unpublish Agent**

- GIVEN a "published" agent with no active job executions
- WHEN the operator clicks "Unpublish"
- THEN the system SHALL POST to `/admin/agents/{id}/unpublish`
- AND update status to "draft"
- AND show confirmation toast

**Scenario: Error Case - Publish Validation Failures**

- GIVEN the agent is missing required configuration (no system_prompt)
- WHEN the operator attempts to publish
- THEN the system SHALL display validation errors
- AND prevent publishing until resolved
- AND list specific issues: "System prompt required", "Model configuration required"

**Scenario: Edge Case - Unpublish with Active Jobs**

- GIVEN a published agent with enabled jobs
- WHEN the operator attempts to unpublish
- THEN the system SHALL display warning: "This agent is used by 2 enabled jobs. Unpublishing will disable them."
- AND list the affected jobs
- AND require explicit confirmation

---

### REQ-YZAGENTS-008: Agent Status Visualization

**Priority**: P1 (High)

The system SHALL visually indicate agent lifecycle status in all views.

**Scenario: Happy Path - Status Display**

- GIVEN the agent list or detail view is displayed
- THEN the system SHALL show status badges with:
  - "draft" - gray badge
  - "published" - green badge
  - "archived" - orange badge
- AND update in real-time after status change operations

---

# Domain: yoizenclaw/config-files

## Purpose
Configuration files management domain for storing agent skills, prompts, and other configuration in YAML/JSON format.

## ADDED Requirements

### REQ-YZCONFIG-001: Config Files List View

**Priority**: P1 (High)

The system SHALL display a list of configuration files for the current tenant.

**Scenario: Happy Path - View Config Files**

- GIVEN the operator navigates to `/yoizenclaw/config-files`
- WHEN the page loads
- THEN the system SHALL fetch via `GET /admin/config-files` with tenant header
- AND display columns: name, path, format (yaml/json), version, last modified
- AND support pagination (25 items per page)
- AND display response format: `{ files: ConfigFile[], total: number }`

**Scenario: Edge Case - No Config Files**

- GIVEN no config files exist for the tenant
- WHEN the page loads
- THEN the system SHALL display empty state with message "No configuration files"
- AND provide "Create Config File" button

---

### REQ-YZCONFIG-002: Config File Editor

**Priority**: P1 (High)

The system SHALL provide a Monaco editor for creating and editing configuration files.

**Scenario: Happy Path - Create Config File**

- GIVEN the operator clicks "New Config File"
- WHEN they fill: name, path (e.g., "/skills/greeting.yaml"), select format (yaml/json)
- AND enter content in Monaco editor
- AND click "Save"
- THEN the system SHALL validate syntax
- AND PUT to `/admin/config-files` with the payload
- AND show success toast

**Scenario: Happy Path - Edit Config File**

- GIVEN the operator clicks "Edit" on a config file
- WHEN they modify the content in Monaco editor
- AND click "Save"
- THEN the system SHALL PUT to `/admin/config-files` (updates version automatically)
- AND show success toast with new version number

**Scenario: Edge Case - Invalid YAML/JSON**

- GIVEN the operator enters malformed content
- WHEN they attempt to save
- THEN the system SHALL display syntax error with line number
- AND prevent saving until fixed

**Scenario: Error Case - Monaco Load Failure**

- GIVEN Monaco fails to load
- WHEN the editor is needed
- THEN the system SHALL fall back to textarea
- AND display warning message

---

### REQ-YZCONFIG-003: Config Files Deploy

**Priority**: P1 (High)

The system SHALL support deploying configuration files to the runtime.

**Scenario: Happy Path - Deploy Config Files**

- GIVEN the operator is viewing config files
- WHEN they click "Deploy to Runtime"
- THEN the system SHALL display confirmation dialog
- AND on confirmation, POST to `/admin/config-files/deploy`
- AND show progress: "Deploying configuration..."
- AND on success, show: "Configuration deployed successfully"
- AND emit NATS event for runtime sync

---

# Domain: yoizenclaw/jobs

## Purpose
Job management domain for scheduling, monitoring, and executing automated tasks with AI agents.

## ADDED Requirements

### REQ-YZJOBS-001: Job List View

**Priority**: P0 (Critical)

The system SHALL display a paginated list of all scheduled jobs for the current tenant.

**Scenario: Happy Path - View Job List**

- GIVEN the operator navigates to `/yoizenclaw/jobs`
- WHEN the page loads
- THEN the system SHALL fetch jobs via `GET /admin/jobs` with tenant header
- AND display columns: name, associated agent, schedule (cron expression), is_active (enabled/disabled), last run time, next run time
- AND support filtering by agent_id and is_active
- AND support pagination (25 items per page)
- AND display response format: `{ jobs: Job[], total: number }`

**Scenario: Edge Case - Job with No Executions**

- GIVEN a job has never been executed
- WHEN displayed in the list
- THEN the system SHALL show "Never" in the last run column
- AND show calculated next run based on cron expression

**Scenario: Error Case - Cron Parse Error**

- GIVEN a job has an invalid cron expression stored
- WHEN the list attempts to display next run time
- THEN the system SHALL display "Invalid schedule" in red
- AND provide a link to edit the job

---

### REQ-YZJOBS-002: Job Create Operation

**Priority**: P0 (Critical)

The system SHALL allow operators to create scheduled jobs with cron expressions.

**Scenario: Happy Path - Create Job**

- GIVEN the operator clicks "New Job"
- WHEN they fill: name (required), description (optional), select agent from dropdown (all agents), enter cron expression in schedule field, optional payload JSON
- AND click "Create"
- THEN the system SHALL validate the cron expression syntax
- AND validate the agent exists
- AND POST to `/admin/jobs` with payload: `{ name, description, agent_id, schedule, payload, is_active }`
- AND display success toast
- AND return to job list

**Scenario: Happy Path - Cron Helper**

- GIVEN the operator is entering a cron expression
- WHEN they click the "Help" icon
- THEN the system SHALL display a cheat sheet with common patterns ("Every hour", "Daily at 9am", etc.)
- AND allow selecting a pattern to auto-fill the expression

**Scenario: Edge Case - Draft Agent Selected**

- GIVEN the operator selects an agent in "draft" status
- WHEN they attempt to create the job
- THEN the system SHALL display warning: "Selected agent is not published. Job will be disabled until agent is published."
- AND create job with is_active=false

**Scenario: Error Case - Invalid Cron Expression**

- GIVEN the operator enters "invalid-cron" as the schedule
- WHEN they attempt to save
- THEN the system SHALL display validation error: "Invalid cron expression. Format: * * * * *"
- AND prevent submission

---

### REQ-YZJOBS-003: Job Edit Operation

**Priority**: P0 (Critical)

The system SHALL allow operators to modify job configuration.

**Scenario: Happy Path - Edit Job**

- GIVEN the operator clicks "Edit" on a job
- WHEN they modify name, description, agent_id, schedule, or payload
- AND click "Save"
- THEN the system SHALL PUT to `/admin/jobs/{id}` with update DTO
- AND recalculate next run time
- AND display success toast

**Scenario: Edge Case - Change Agent on Enabled Job**

- GIVEN a job is currently enabled (is_active=true)
- WHEN the operator changes the associated agent
- THEN the system SHALL display confirmation: "Changing the agent will apply to the next scheduled run. Continue?"
- AND on save, reset execution history association for clarity

---

### REQ-YZJOBS-004: Job Delete Operation

**Priority**: P1 (High)

The system SHALL allow operators to delete jobs.

**Scenario: Happy Path - Delete Disabled Job**

- GIVEN a job with is_active=false
- WHEN the operator clicks "Delete" and confirms
- THEN the system SHALL DELETE to `/admin/jobs/{id}`
- AND remove from list
- AND show success toast

**Scenario: Edge Case - Delete Job with Execution History**

- GIVEN a job has execution history
- WHEN the operator deletes the job
- THEN the system SHALL display: "Job and all 45 execution records will be permanently deleted."
- AND require explicit confirmation
- AND retain execution logs in system audit log for compliance

---

### REQ-YZJOBS-005: Enable/Disable Toggle

**Priority**: P0 (Critical)

The system SHALL allow operators to enable or disable jobs with immediate effect.

**Scenario: Happy Path - Enable Job**

- GIVEN a job with is_active=false
- WHEN the operator toggles the enable switch
- THEN the system SHALL POST to `/admin/jobs/{id}/enable`
- AND update the job is_active to true immediately
- AND schedule the next execution based on cron
- AND show toast: "Job enabled. Next run: [calculated time]"

**Scenario: Happy Path - Disable Job**

- GIVEN a job with is_active=true
- WHEN the operator toggles the enable switch
- THEN the system SHALL POST to `/admin/jobs/{id}/disable`
- AND update the job is_active to false
- AND show toast: "Job disabled"

**Scenario: Error Case - Enable with Unpublished Agent**

- GIVEN a job is associated with an unpublished agent (status='draft')
- WHEN the operator attempts to enable
- THEN the system SHALL display error: "Cannot enable: Associated agent is not published"
- AND prevent enabling

---

### REQ-YZJOBS-006: Manual Run and Trigger

**Priority**: P1 (High)

The system SHALL allow operators to manually execute jobs on-demand via two separate operations.

**Scenario: Happy Path - Run Job**

- GIVEN a job exists (any is_active status)
- WHEN the operator clicks "Run Now"
- THEN the system SHALL POST to `/admin/jobs/{id}/run`
- AND display confirmation dialog: "Run 'Job Name' immediately with default payload?"
- AND on confirmation, initiate execution
- AND navigate to executions view to show progress
- AND display newly created execution

**Scenario: Happy Path - Trigger Job with Payload**

- GIVEN a job exists
- WHEN the operator clicks "Trigger with Payload"
- THEN the system SHALL open dialog to input custom event_payload JSON
- AND on confirmation, POST to `/admin/jobs/{id}/trigger` with the payload
- AND initiate execution with custom payload
- AND navigate to executions view

**Scenario: Edge Case - Run Already Running Job**

- GIVEN a job has an execution currently in "running" status
- WHEN the operator attempts to run again
- THEN the system SHALL display: "Job is already running (started 2 minutes ago). Run anyway?"
- AND allow forcing a parallel execution

**Scenario: Error Case - Run/Trigger Fails**

- GIVEN the API returns an error
- WHEN the operator attempts to run/trigger
- THEN the system SHALL display error toast with message from API
- AND log the failure

---

### REQ-YZJOBS-007: Job Executions View

**Priority**: P0 (Critical)

The system SHALL display execution history with status, duration, and output.

**Scenario: Happy Path - View Executions**

- GIVEN the operator clicks "Executions" on a job or navigates to the executions page
- WHEN the page loads
- THEN the system SHALL fetch via `GET /admin/jobs/executions?job_id={id}`
- AND display a table with: execution ID, start time, end time, duration, status (pending/running/success/failed/cancelled)
- AND default sort by start time descending (newest first)
- AND support pagination
- AND display response format: `{ executions: JobExecution[], total: number }`

**Scenario: Happy Path - Execution Detail**

- GIVEN the operator clicks on an execution row
- WHEN the detail view opens (modal or expand)
- THEN the system SHALL display: full execution log, input payload, output/result, error message (if failed)
- AND provide copy-to-clipboard for logs

**Scenario: Edge Case - Long-Running Execution**

- GIVEN an execution has been running for > 5 minutes
- WHEN the executions view is displayed
- THEN the system SHALL show elapsed time updating every second
- AND display current runtime duration

---

### REQ-YZJOBS-008: Execution Polling Mechanism

**Priority**: P1 (High)

The system SHALL poll for execution status updates on active executions.

**Scenario: Happy Path - Polling Updates**

- GIVEN the operator is viewing the executions page
- WHEN there are executions in "pending" or "running" status
- THEN the system SHALL poll every 5 seconds via `GET /admin/jobs/executions?job_id={id}&status=pending,running`
- AND update the display without full page refresh
- AND stop polling when all executions reach terminal state

**Scenario: Edge Case - Polling Overhead Protection**

- GIVEN an execution has been running for > 5 minutes
- WHEN polling continues
- THEN the system SHALL implement exponential backoff (5s → 10s → 15s → max 30s)
- AND auto-stop polling after 10 minutes

**Scenario: Error Case - Polling Failure**

- GIVEN the polling request fails (network error)
- WHEN 3 consecutive polls fail
- THEN the system SHALL display: "Live updates paused. Reconnecting..."
- AND retry with exponential backoff
- AND provide a "Refresh Now" button for manual update

---

# Domain: yoizenclaw/credentials

## Purpose
Credential management domain for securely storing and rotating API keys and other credentials.

## ADDED Requirements

### REQ-YZCREDS-001: Credential List View

**Priority**: P0 (Critical)

The system SHALL display a list of all API credentials for the current tenant.

**Scenario: Happy Path - View Credentials**

- GIVEN the operator navigates to `/yoizenclaw/credentials`
- WHEN the page loads
- THEN the system SHALL fetch via `GET /admin/credentials` with tenant header
- AND display columns: name, type (api_key/oauth/basic/custom), is_active (active/inactive), created date, last rotated (if available in metadata)
- AND mask the actual secret values (API NEVER returns value field)
- AND support filtering by type and is_active
- AND display response format: `{ credentials: CredentialWithoutValue[], total: number }`

**Scenario: Edge Case - No Credentials**

- GIVEN no credentials exist for the tenant
- WHEN the page loads
- THEN the system SHALL display empty state with message: "No credentials configured"
- AND provide "Add Credential" button
- AND link to documentation about provider setup

**Scenario: Error Case - List Fetch Failure**

- GIVEN the credentials API is unavailable
- WHEN the page loads
- THEN the system SHALL display error: "Unable to load credentials"
- AND provide retry button

---

### REQ-YZCREDS-002: Credential Create Operation

**Priority**: P0 (Critical)

The system SHALL allow operators to add new API credentials.

**Scenario: Happy Path - Create API Key Credential**

- GIVEN the operator clicks "Add Credential"
- WHEN they select "api_key" as type
- THEN the system SHALL display form: name (required), value (password input with toggle visibility), metadata JSON editor for provider-specific settings
- AND on save, POST to `/admin/credentials` with `{ name, type, value, metadata }`
- AND show success toast
- AND value is never displayed again (backend never returns it)

**Scenario: Happy Path - Create OAuth Credential**

- GIVEN the operator selects "oauth" as type
- WHEN the form displays
- THEN the system SHALL show OAuth-specific metadata fields: client_id, client_secret, token_url, scope
- AND validate required fields per credential type conventions

**Scenario: Edge Case - Credential Name Conflict**

- GIVEN a credential named "Production OpenAI" already exists
- WHEN the operator attempts to create another with the same name
- THEN the system SHALL show validation error: "Credential name must be unique"

---

### REQ-YZJOBS-003: Job Edit Operation

**Priority**: P0 (Critical)

The system SHALL allow operators to modify job configuration.

**Scenario: Happy Path - Edit Job**

- GIVEN the operator clicks "Edit" on a job
- WHEN they modify name, description, agent, or cron expression
- AND click "Save"
- THEN the system SHALL PUT to `/admin/jobs/{id}`
- AND recalculate next run time
- AND display success toast

**Scenario: Edge Case - Change Agent on Enabled Job**

- GIVEN a job is currently enabled
- WHEN the operator changes the associated agent
- THEN the system SHALL display confirmation: "Changing the agent will apply to the next scheduled run. Continue?"
- AND on save, reset execution history association for clarity

---

### REQ-YZJOBS-004: Job Delete Operation

**Priority**: P1 (High)

The system SHALL allow operators to delete jobs.

**Scenario: Happy Path - Delete Disabled Job**

- GIVEN a job in "disabled" status with no pending executions
- WHEN the operator clicks "Delete" and confirms
- THEN the system SHALL DELETE to `/admin/jobs/{id}`
- AND remove from list
- AND show success toast

**Scenario: Edge Case - Delete Job with Execution History**

- GIVEN a job has execution history
- WHEN the operator deletes the job
- THEN the system SHALL display: "Job and all 45 execution records will be permanently deleted."
- AND require explicit confirmation
- AND retain execution logs in system audit log for compliance

---

### REQ-YZJOBS-005: Enable/Disable Toggle

**Priority**: P0 (Critical)

The system SHALL allow operators to enable or disable jobs with immediate effect.

**Scenario: Happy Path - Enable Job**

- GIVEN a job in "disabled" status
- WHEN the operator toggles the enable switch
- THEN the system SHALL POST to `/admin/jobs/{id}/enable`
- AND update the job status immediately
- AND schedule the next execution based on cron
- AND show toast: "Job enabled. Next run: [calculated time]"

**Scenario: Happy Path - Disable Job**

- GIVEN a job in "enabled" status
- WHEN the operator toggles the enable switch
- THEN the system SHALL POST to `/admin/jobs/{id}/disable`
- AND cancel any pending scheduled executions
- AND show toast: "Job disabled"

**Scenario: Error Case - Enable with Unpublished Agent**

- GIVEN a job is associated with an unpublished agent
- WHEN the operator attempts to enable
- THEN the system SHALL display error: "Cannot enable: Associated agent is not published"
- AND prevent enabling

---

### REQ-YZJOBS-006: Manual Run/Trigger

**Priority**: P1 (High)

The system SHALL allow operators to manually trigger job execution on-demand.

**Scenario: Happy Path - Trigger Job**

- GIVEN a job exists (enabled or disabled)
- WHEN the operator clicks "Run Now"
- THEN the system SHALL POST to `/admin/jobs/{id}/trigger`
- AND display confirmation dialog: "Trigger 'Job Name' immediately?"
- AND on confirmation, initiate execution
- AND navigate to executions view to show progress

**Scenario: Edge Case - Trigger Already Running Job**

- GIVEN a job has an execution currently in "running" status
- WHEN the operator attempts to trigger again
- THEN the system SHALL display: "Job is already running (started 2 minutes ago). Trigger anyway?"
- AND allow forcing a parallel execution

**Scenario: Error Case - Trigger Fails**

- GIVEN the trigger API returns an error
- WHEN the operator attempts to run
- THEN the system SHALL display error toast with message from API
- AND log the failure

---

### REQ-YZJOBS-007: Job Executions View

**Priority**: P0 (Critical)

The system SHALL display execution history with status, duration, and output.

**Scenario: Happy Path - View Executions**

- GIVEN the operator clicks "Executions" on a job
- WHEN the page loads
- THEN the system SHALL fetch via `GET /admin/jobs/{id}/executions`
- AND display a table with: execution ID, start time, end time, duration, status (pending/running/success/failed/cancelled)
- AND default sort by start time descending (newest first)
- AND support pagination

**Scenario: Happy Path - Execution Detail**

- GIVEN the operator clicks on an execution row
- WHEN the detail view opens
- THEN the system SHALL display: full execution log, input parameters, output/result, error message (if failed)
- AND provide copy-to-clipboard for logs

**Scenario: Edge Case - Long-Running Execution**

- GIVEN an execution has been running for > 5 minutes
- WHEN the executions view is displayed
- THEN the system SHALL show a "Cancel" button for that execution
- AND display elapsed time updating every second

---

### REQ-YZJOBS-008: Execution Polling Mechanism

**Priority**: P1 (High)

The system SHALL poll for execution status updates on active executions.

**Scenario: Happy Path - Polling Updates**

- GIVEN the operator is viewing the executions page
- WHEN there are executions in "pending" or "running" status
- THEN the system SHALL poll every 5 seconds for status updates
- AND update the display without full page refresh
- AND stop polling when all executions reach terminal state

**Scenario: Edge Case - Polling Overhead Protection**

- GIVEN an execution has been running for > 5 minutes
- WHEN polling continues
- THEN the system SHALL implement exponential backoff (5s → 10s → 15s → max 30s)
- AND auto-stop polling after 10 minutes

**Scenario: Error Case - Polling Failure**

- GIVEN the polling request fails (network error)
- WHEN 3 consecutive polls fail
- THEN the system SHALL display: "Live updates paused. Reconnecting..."
- AND retry with exponential backoff
- AND provide a "Refresh Now" button for manual update

---

# Domain: yoizenclaw/credentials

## Purpose
Credential management domain for securely storing and rotating API keys for AI service providers.

## ADDED Requirements

### REQ-YZCREDS-001: Credential List View

**Priority**: P0 (Critical)

The system SHALL display a list of all API credentials for the current tenant.

**Scenario: Happy Path - View Credentials**

- GIVEN the operator navigates to `/yoizenclaw/credentials`
- WHEN the page loads
- THEN the system SHALL fetch via `GET /admin/credentials` with tenant header
- AND display columns: name, provider (OpenAI/Anthropic/etc.), status (active/revoked), created date, last rotated
- AND mask the actual secret values (show only last 4 characters: "sk-...abcd")
- AND support filtering by provider and status

**Scenario: Edge Case - No Credentials**

- GIVEN no credentials exist for the tenant
- WHEN the page loads
- THEN the system SHALL display empty state with message: "No credentials configured"
- AND provide "Add Credential" button
- AND link to documentation about provider setup

**Scenario: Error Case - List Fetch Failure**

- GIVEN the credentials API is unavailable
- WHEN the page loads
- THEN the system SHALL display error: "Unable to load credentials"
- AND provide retry button

---

### REQ-YZCREDS-002: Credential Create Operation

**Priority**: P0 (Critical)

The system SHALL allow operators to add new API credentials.

**Scenario: Happy Path - Create OpenAI Credential**

- GIVEN the operator clicks "Add Credential"
- WHEN they select "OpenAI" as provider
- THEN the system SHALL display provider-specific form: name (required), API key (password input with toggle visibility), organization ID (optional)
- AND on save, POST to `/admin/credentials`
- AND mask the key in the request/response logs
- AND show success toast

**Scenario: Happy Path - Create Anthropic Credential**

- GIVEN the operator selects "Anthropic" as provider
- WHEN the form displays
- THEN the system SHALL show Anthropic-specific fields: name, API key, API version selector
- AND validate the key format (starts with "sk-ant-")

**Scenario: Edge Case - Credential Name Conflict**

- GIVEN a credential named "Production OpenAI" already exists
- WHEN the operator attempts to create another with the same name
- THEN the system SHALL show validation error: "Credential name must be unique"

**Scenario: Error Case - Invalid API Key Format**

- GIVEN the operator enters an API key that doesn't match provider format
- WHEN attempting to save
- THEN the system SHALL display: "Invalid API key format. Expected: sk-... for OpenAI"
- AND prevent submission

---

### REQ-YZCREDS-003: Credential Edit Operation

**Priority**: P1 (High)

The system SHALL allow operators to modify credential metadata (not the secret).

**Scenario: Happy Path - Edit Credential Name**

- GIVEN the operator clicks "Edit" on a credential
- WHEN they modify the name or other metadata
- AND click "Save"
- THEN the system SHALL PUT to `/admin/credentials/{id}`
- AND update the display
- AND show success toast

**Scenario: Edge Case - Edit Revoked Credential**

- GIVEN a credential is in "revoked" status
- WHEN the operator attempts to edit
- THEN the system SHALL display warning: "This credential is revoked. Changes will not affect active usage."
- AND gray out the secret field (cannot be changed)

---

### REQ-YZCREDS-004: Credential Delete Operation

**Priority**: P1 (High)

The system SHALL allow operators to delete credentials with safeguards.

**Scenario: Happy Path - Delete Unused Credential**

- GIVEN a credential not associated with any agents
- WHEN the operator clicks "Delete" and confirms
- THEN the system SHALL DELETE to `/admin/credentials/{id}`
- AND remove from list

**Scenario: Edge Case - Delete Credential in Use**

- GIVEN a credential is used by 2 agents
- WHEN the operator attempts to delete
- THEN the system SHALL display: "Cannot delete: Used by 2 agents. Reassign agents first."
- AND list the affected agents

---

### REQ-YZCREDS-005: Credential Rotation Workflow

**Priority**: P0 (Critical)

The system SHALL support secure credential rotation (generate new, revoke old).

**Scenario: Happy Path - Rotate Credential**

- GIVEN an active credential
- WHEN the operator clicks "Rotate"
- THEN the system SHALL display a dialog with:
  - Current credential info (masked)
  - Input field for new API key
  - Option: "Revoke old immediately" or "Keep active for 24h (grace period)"
- AND on confirmation with new key, PUT to `/admin/credentials/{id}/rotate` with `{ new_value, new_expires_at }`
- AND show progress: "Rotation in progress..."
- AND on success, show: "Credential rotated successfully. Old key expires in 24 hours."

**Scenario: Edge Case - Rotation with Grace Period**

- GIVEN the operator selects "Keep active for 24h"
- WHEN rotation completes
- THEN the system SHALL mark old key as "expiring"
- AND show countdown in the list
- AND auto-revoke after 24 hours

**Scenario: Error Case - Rotation Failure**

- GIVEN the new API key is invalid
- WHEN rotation is attempted
- THEN the system SHALL display error: "Rotation failed: New key rejected by provider"
- AND keep the old key active (no partial rotation)
- AND allow retry with different key

**Scenario: Error Case - Concurrent Rotation**

- GIVEN another operator is currently rotating the same credential
- WHEN this operator attempts rotation
- THEN the system SHALL display: "Rotation in progress by another user. Please wait."
- AND poll for completion

---

### REQ-YZCREDS-006: Provider-Specific Forms

**Priority**: P1 (High)

The system SHALL display configuration forms tailored to each provider.

**Scenario: Happy Path - Provider Selection**

- GIVEN the operator selects a provider from dropdown
- WHEN the form updates
- THEN the system SHALL show relevant fields:
  - OpenAI: API Key, Org ID, Default Model
  - Anthropic: API Key, API Version, Default Model
  - Azure OpenAI: Endpoint URL, API Key, Deployment Name
- AND validate required fields per provider

---

### REQ-YZCREDS-007: Credential Status Tracking

**Priority**: P1 (High)

The system SHALL track and display credential lifecycle status.

**Scenario: Happy Path - Status Display**

- GIVEN the credential list is displayed
- THEN the system SHALL show status badges:
  - "active" - green (key is valid and in use)
  - "revoked" - red (key is disabled)
  - "expiring" - orange (grace period active, shows countdown)
- AND update status in real-time after rotation

---

# Domain: yoizenclaw/infrastructure

## Purpose
Infrastructure domain for multi-tenancy support, routing, and HTTP interceptors enabling the YoizenClaw feature module.

## ADDED Requirements

### REQ-YZINFRA-001: Tenant HTTP Interceptor

**Priority**: P0 (Critical)

The system SHALL inject tenant identification header on all YoizenClaw API requests.

**Scenario: Happy Path - Header Injection**

- GIVEN any HTTP request to `yoizenclaw-admin-service` endpoints
- WHEN the request is initiated
- THEN the system SHALL read tenant ID from `ConfigService`
- AND inject `x-yoizen-tenant: {tenant-id}` header
- AND log the tenant context for debugging

**Scenario: Happy Path - Interceptor Registration**

- GIVEN the admin-console application starts
- WHEN the HTTP client is configured
- THEN the system SHALL register `TenantInterceptor` alongside existing interceptors
- AND ensure execution order: AuthInterceptor → TenantInterceptor → Request

**Scenario: Edge Case - Missing Tenant Configuration**

- GIVEN the tenant ID is not configured in ConfigService
- WHEN a YoizenClaw API request is made
- THEN the system SHALL throw an error: "Tenant ID not configured"
- AND display error toast to user
- AND prevent the request from reaching the backend

**Scenario: Error Case - Header Collision**

- GIVEN a request already has `x-yoizen-tenant` header (from test or manual override)
- WHEN the interceptor processes it
- THEN the system SHALL log a warning: "Tenant header already present, using existing value"
- AND not overwrite the header

---

### REQ-YZINFRA-002: Feature Module Structure

**Priority**: P0 (Critical)

The system SHALL organize YoizenClaw functionality as a dedicated feature module.

**Scenario: Happy Path - Module Organization**

- GIVEN the feature is implemented
- THEN the system SHALL have directory structure:
  ```
  features/yoizenclaw/
  ├── agents/
  ├── jobs/
  ├── credentials/
  ├── interceptors/
  ├── models/
  └── yoizenclaw.routes.ts
  ```
- AND each sub-feature SHALL have its own components, services, and routes

**Scenario: Happy Path - Service Registration**

- GIVEN the feature module is imported
- WHEN the application initializes
- THEN the system SHALL register `AgentService`, `JobService`, and `CredentialService` as injectable providers
- AND make them available to components via DI

---

### REQ-YZINFRA-003: Route Configuration

**Priority**: P0 (Critical)

The system SHALL configure lazy-loaded routes for all YoizenClaw features.

**Scenario: Happy Path - Route Registration**

- GIVEN the operator navigates to `/yoizenclaw`
- WHEN the route is accessed
- THEN the system SHALL lazy-load the YoizenClaw feature module
- AND display the agents list as default child route

**Scenario: Happy Path - Child Routes**

- GIVEN the feature routes are configured
- THEN the system SHALL support:
  - `/yoizenclaw/agents` → AgentListComponent
  - `/yoizenclaw/agents/new` → AgentFormComponent (create)
  - `/yoizenclaw/agents/:id` → AgentFormComponent (edit)
  - `/yoizenclaw/jobs` → JobListComponent
  - `/yoizenclaw/jobs/:id/executions` → ExecutionsListComponent
  - `/yoizenclaw/credentials` → CredentialListComponent

**Scenario: Edge Case - Unknown Route**

- GIVEN the operator navigates to `/yoizenclaw/invalid-path`
- WHEN the route doesn't match
- THEN the system SHALL redirect to `/yoizenclaw/agents`
- AND log the navigation attempt

---

### REQ-YZINFRA-004: Navigation Sidebar Integration

**Priority**: P1 (High)

The system SHALL integrate YoizenClaw navigation into the admin-console sidebar.

**Scenario: Happy Path - Sidebar Menu**

- GIVEN the sidebar is rendered
- THEN the system SHALL display "YoizenClaw" as a section
- WITH submenu items: Agents, Jobs, Credentials
- AND highlight the active route

**Scenario: Happy Path - Feature Flag Control**

- GIVEN the `yoizenclaw` feature flag is enabled
- WHEN the sidebar config is loaded
- THEN the system SHALL show the YoizenClaw section
- AND if disabled, hide the entire section

---

### REQ-YZINFRA-005: Error Handling & Feedback

**Priority**: P1 (High)

The system SHALL provide consistent error handling across all YoizenClaw operations.

**Scenario: Happy Path - Toast Notifications**

- GIVEN any CRUD operation completes
- WHEN it succeeds or fails
- THEN the system SHALL display a toast notification with:
  - Success: green checkmark, brief message
  - Error: red X, descriptive message, retry option where applicable

**Scenario: Happy Path - Global Error Handler**

- GIVEN an unhandled error occurs in a YoizenClaw component
- WHEN the error bubbles up
- THEN the system SHALL catch it in the global error handler
- AND display user-friendly message
- AND log full error details for debugging

---

# Non-Functional Requirements

## Performance

### NFR-001: Page Load Performance

**Category**: Performance
**Priority**: P1 (High)

The system SHALL load YoizenClaw feature pages within acceptable time limits.

- **Metric**: Time to Interactive (TTI)
- **Target**: < 2 seconds for initial page load on standard broadband (10 Mbps)
- **Measurement**: Lighthouse performance audit, manual stopwatch testing

**Scenario: Lazy Loading**

- GIVEN the operator navigates to `/yoizenclaw` for the first time
- WHEN the feature module loads
- THEN the system SHALL download the chunk asynchronously
- AND display a loading indicator
- AND cache the module for subsequent navigation

---

### NFR-002: Monaco Editor Load Performance

**Category**: Performance
**Priority**: P1 (High)

The system SHALL lazy-load Monaco Editor to avoid blocking initial page load.

- **Metric**: Editor load time from tab activation
- **Target**: < 3 seconds for editor to become interactive
- **Measurement**: Performance.now() from tab click to editor ready event

**Scenario: On-Demand Loading**

- GIVEN the operator is on the agent edit page
- WHEN they click the "Skills" tab
- THEN the system SHALL dynamically import @monaco-editor/loader
- AND show a skeleton loader while downloading
- AND initialize editor once loaded

---

### NFR-003: API Response Times

**Category**: Performance
**Priority**: P1 (High)

The system SHALL display data within acceptable timeframes after API calls.

- **Metric**: List display after API response
- **Target**: < 500ms from response to rendered table
- **Measurement**: Browser DevTools Performance tab

---

## Accessibility

### NFR-004: Keyboard Navigation

**Category**: Accessibility
**Priority**: P0 (Critical)

The system SHALL support full keyboard navigation for all YoizenClaw features.

- **Metric**: WCAG 2.1 Level AA compliance for keyboard operability
- **Target**: 100% of interactive elements reachable via Tab key
- **Measurement**: Manual keyboard testing, axe-core automated scan

**Scenario: Tab Navigation**

- GIVEN the operator is using keyboard only
- WHEN they press Tab
- THEN the system SHALL move focus through all interactive elements in logical order
- AND show visible focus indicators
- AND allow Enter/Space to activate buttons

**Scenario: Modal Dialog Focus Trap**

- GIVEN a modal dialog is open (e.g., delete confirmation)
- WHEN the operator presses Tab repeatedly
- THEN the system SHALL trap focus within the modal
- AND return focus to trigger element on close

---

### NFR-005: Screen Reader Support

**Category**: Accessibility
**Priority**: P0 (Critical)

The system SHALL provide appropriate ARIA labels and roles for screen reader users.

- **Metric**: Screen reader announcement accuracy
- **Target**: All form fields, buttons, and status changes announced correctly
- **Measurement**: NVDA/VoiceOver manual testing

**Scenario: Form Labels**

- GIVEN a form is displayed (agent create, job edit, etc.)
- WHEN a screen reader navigates to input fields
- THEN the system SHALL announce the label associated with each input
- AND announce required field indicators
- AND announce validation errors when they appear

**Scenario: Status Updates**

- GIVEN an async operation completes (save, delete, trigger)
- WHEN the status changes
- THEN the system SHALL announce the result via ARIA live region
- AND use polite announcement for non-critical updates
- AND use assertive announcement for errors

---

### NFR-006: Monaco Editor Accessibility Fallback

**Category**: Accessibility
**Priority**: P1 (High)

The system SHALL provide an accessible fallback for the code editor.

- **Metric**: Screen reader usability for skills editing
- **Target**: Alternative text input method available and functional
- **Measurement**: Manual screen reader testing

**Scenario: Fallback Textarea**

- GIVEN the Monaco editor fails to load or screen reader is detected
- WHEN the skills editor is needed
- THEN the system SHALL display a standard textarea instead
- WITH proper label: "Skills Definition (YAML or JSON)"
- AND syntax validation on save (server-side if client unavailable)

---

### NFR-007: Color Contrast

**Category**: Accessibility
**Priority**: P0 (Critical)

The system SHALL meet WCAG AA color contrast requirements.

- **Metric**: Color contrast ratio
- **Target**: Minimum 4.5:1 for normal text, 3:1 for large text/UI components
- **Measurement**: axe-core automated scan, WebAIM contrast checker

---

## Reliability

### NFR-008: Polling Resilience

**Category**: Reliability
**Priority**: P1 (High)

The system SHALL gracefully handle polling failures for job executions.

- **Metric**: Polling continuation after transient errors
- **Target**: 99% success rate in maintaining live updates during network instability
- **Measurement**: Simulated network failure testing

**Scenario: Network Recovery**

- GIVEN polling is active for job executions
- WHEN the network connection drops for < 30 seconds
- THEN the system SHALL retry with exponential backoff
- AND resume normal polling when connection restored
- AND display "Live updates resumed" toast

---

## Security

### NFR-009: Secret Masking

**Category**: Security
**Priority**: P0 (Critical)

The system SHALL prevent exposure of API credentials in the UI.

- **Metric**: Secret visibility in DOM
- **Target**: Zero full secrets in HTML, console logs, or network responses
- **Measurement**: Code review, browser DevTools inspection

**Scenario: Credential Display**

- GIVEN the credentials list is displayed
- WHEN the page renders
- THEN the system SHALL only show masked values: "sk-...abcd"
- AND the full secret SHALL NOT exist in the DOM
- AND the full secret SHALL NOT be logged to console

---

### NFR-010: Tenant Isolation

**Category**: Security
**Priority**: P0 (Critical)

The system SHALL ensure tenant data isolation through header injection.

- **Metric**: Cross-tenant data access prevention
- **Target**: Zero cross-tenant data leakage
- **Measurement**: API request inspection, integration testing

**Scenario: Header Validation**

- GIVEN any API request to yoizenclaw-admin-service
- WHEN the request is sent
- THEN the system SHALL include the correct `x-yoizen-tenant` header
- AND the header value SHALL match the current user's tenant
- AND requests without the header SHALL be rejected by backend

---

# Traceability Matrix

| Requirement ID | Domain | Priority | Scenarios (Happy/Edge/Error) |
|----------------|--------|----------|------------------------------|
| REQ-YZAGENTS-001 | agents | P0 | 3 |
| REQ-YZAGENTS-002 | agents | P0 | 2 |
| REQ-YZAGENTS-003 | agents | P0 | 3 |
| REQ-YZAGENTS-004 | agents | P1 | 3 |
| REQ-YZAGENTS-005 | agents | P0 | 4 |
| REQ-YZAGENTS-006 | agents | P1 | 2 |
| REQ-YZAGENTS-007 | agents | P0 | 4 |
| REQ-YZAGENTS-008 | agents | P1 | 1 |
| REQ-YZCONFIG-001 | config-files | P1 | 3 |
| REQ-YZCONFIG-002 | config-files | P1 | 4 |
| REQ-YZCONFIG-003 | config-files | P1 | 1 |
| REQ-YZJOBS-001 | jobs | P0 | 3 |
| REQ-YZJOBS-002 | jobs | P0 | 4 |
| REQ-YZJOBS-003 | jobs | P0 | 2 |
| REQ-YZJOBS-004 | jobs | P1 | 2 |
| REQ-YZJOBS-005 | jobs | P0 | 3 |
| REQ-YZJOBS-006 | jobs | P1 | 4 |
| REQ-YZJOBS-007 | jobs | P0 | 3 |
| REQ-YZJOBS-008 | jobs | P1 | 3 |
| REQ-YZCREDS-001 | credentials | P0 | 3 |
| REQ-YZCREDS-002 | credentials | P0 | 3 |
| REQ-YZCREDS-003 | credentials | P1 | 2 |
| REQ-YZCREDS-004 | credentials | P1 | 2 |
| REQ-YZCREDS-005 | credentials | P0 | 4 |
| REQ-YZINFRA-001 | infrastructure | P0 | 4 |
| REQ-YZINFRA-002 | infrastructure | P0 | 2 |
| REQ-YZINFRA-003 | infrastructure | P0 | 3 |
| REQ-YZINFRA-004 | infrastructure | P1 | 2 |
| REQ-YZINFRA-005 | infrastructure | P1 | 2 |
| NFR-001 | performance | P1 | 1 |
| NFR-002 | performance | P1 | 1 |
| NFR-003 | performance | P1 | - |
| NFR-004 | accessibility | P0 | 2 |
| NFR-005 | accessibility | P0 | 2 |
| NFR-006 | accessibility | P1 | 1 |
| NFR-007 | accessibility | P0 | - |
| NFR-008 | reliability | P1 | 1 |
| NFR-009 | security | P0 | 1 |
| NFR-010 | security | P0 | 1 |

**Total Requirements**: 40 (30 functional, 10 non-functional)
**Total Scenarios**: 90+
